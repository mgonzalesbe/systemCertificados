"""
Rehace certificados para alumnos listados en un CSV (por DNI), corrigiendo:
- cuerpo del certificado
- uso de múltiples centros educativos (round-robin)
- verificación posterior para actualizar métricas

Flujo:
1) Lee alumnos del CSV (columnas requeridas: dni,nombres,apellidos)
2) Busca esos alumnos en Usuarios
3) Elimina certificados existentes de esos alumnos
4) Genera certificados nuevos para ellos
5) Verifica cada certificado (actualiza TV/validaciones)

Uso:
  python scripts/reseed_certificados_alumnos.py --csv-path scripts/alumnos_template.csv

Opcional:
  --admin-user admin
  --issue-date 2026-05-07
  --students-group-a 17
  --validations-group-a 3
  --validations-group-b 2
  --dry-run
"""
from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from datetime import date
from typing import Iterable

from modelo import certificado
from modelo.database import get_db_connection


class ReseedError(RuntimeError):
    pass


@dataclass
class AlumnoCSV:
    dni: str
    nombres: str
    apellidos: str

    @property
    def full_name(self) -> str:
        return f"{self.nombres} {self.apellidos}".strip()


@dataclass
class AlumnoDb:
    user_id: int
    dni: str
    nombres: str
    apellidos: str

    @property
    def full_name(self) -> str:
        return f"{self.nombres} {self.apellidos}".strip()


def _read_csv(path: str) -> list[AlumnoCSV]:
    out: list[AlumnoCSV] = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        rd = csv.DictReader(f)
        required = {"dni", "nombres", "apellidos"}
        missing = [k for k in required if k not in (rd.fieldnames or [])]
        if missing:
            raise ReseedError(f"CSV sin columnas requeridas: {', '.join(missing)}")
        seen_dni: set[str] = set()
        for i, row in enumerate(rd, start=2):
            dni = str(row.get("dni") or "").strip()
            nombres = str(row.get("nombres") or "").strip()
            apellidos = str(row.get("apellidos") or "").strip()
            if not dni and not nombres and not apellidos:
                continue
            if len(dni) != 8 or not dni.isdigit():
                raise ReseedError(f"DNI inválido en fila {i}: '{dni}'")
            if dni in seen_dni:
                raise ReseedError(f"DNI duplicado en CSV: {dni}")
            seen_dni.add(dni)
            if not nombres or not apellidos:
                raise ReseedError(f"Fila {i}: nombres/apellidos vacíos")
            out.append(AlumnoCSV(dni=dni, nombres=nombres, apellidos=apellidos))
    if not out:
        raise ReseedError("CSV vacío (sin alumnos).")
    return out


def _fetch_admin_id(conn, admin_user: str) -> int:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT TOP 1 IdUsuario
        FROM Usuarios
        WHERE Rol = 'admin' AND NombreUsuario = ?
        ORDER BY IdUsuario ASC
        """,
        (admin_user,),
    )
    row = cur.fetchone()
    if not row:
        raise ReseedError(f"No se encontró admin '{admin_user}' en Usuarios.")
    return int(row[0])


def _fetch_active_ids(conn, table: str, id_col: str) -> list[int]:
    cur = conn.cursor()
    cur.execute(
        """
        SELECT name
        FROM sys.columns
        WHERE object_id = OBJECT_ID(?) AND name IN (N'Activo', N'Estado')
        ORDER BY CASE WHEN name = N'Activo' THEN 0 ELSE 1 END
        """,
        (table,),
    )
    cols = [str(r[0]) for r in cur.fetchall()]
    if not cols:
        raise ReseedError(f"La tabla {table} no tiene columna Activo/Estado para filtrar activos.")

    col = cols[0]
    if col.lower() == "activo":
        where = "Activo = 1"
    else:
        where = "Estado = N'Activo'"

    cur.execute(
        f"""
        SELECT {id_col}
        FROM {table}
        WHERE {where}
        ORDER BY {id_col} ASC
        """
    )
    return [int(r[0]) for r in cur.fetchall()]


def _fetch_first_active(conn, table: str, id_col: str) -> int:
    rows = _fetch_active_ids(conn, table, id_col)
    if not rows:
        raise ReseedError(f"No hay registros activos en {table}.")
    return rows[0]


def _resolve_students(conn, csv_rows: Iterable[AlumnoCSV]) -> list[AlumnoDb]:
    cur = conn.cursor()
    resolved: list[AlumnoDb] = []
    missing: list[str] = []
    for r in csv_rows:
        cur.execute(
            """
            SELECT TOP 1 IdUsuario, Nombres, Apellidos
            FROM Usuarios
            WHERE Rol = 'student' AND DocumentoIdentidad = ?
            ORDER BY IdUsuario ASC
            """,
            (r.dni,),
        )
        row = cur.fetchone()
        if not row:
            missing.append(r.dni)
            continue
        # Sincronizar nombre/apellido desde CSV para reemisión correcta
        cur.execute(
            """
            UPDATE Usuarios
            SET Nombres = ?, Apellidos = ?
            WHERE IdUsuario = ?
            """,
            (r.nombres, r.apellidos, int(row[0])),
        )
        resolved.append(
            AlumnoDb(
                user_id=int(row[0]),
                dni=r.dni,
                nombres=r.nombres,
                apellidos=r.apellidos,
            )
        )
    if missing:
        raise ReseedError(
            "No se encontraron estos DNI en Usuarios (registre alumnos primero): "
            + ", ".join(missing)
        )
    return resolved


def _delete_old_certs(conn, user_ids: list[int]) -> int:
    if not user_ids:
        return 0
    cur = conn.cursor()
    deleted = 0
    for uid in user_ids:
        cur.execute("DELETE FROM Certificados WHERE IdUsuarioDestinatario = ?", (uid,))
        deleted += int(cur.rowcount or 0)
    return deleted


def main() -> int:
    ap = argparse.ArgumentParser(description="Rehacer certificados de alumnos del CSV.")
    ap.add_argument("--csv-path", required=True)
    ap.add_argument("--admin-user", default="admin")
    ap.add_argument("--issue-date", default=date.today().isoformat())
    ap.add_argument("--students-group-a", type=int, default=17)
    ap.add_argument("--validations-group-a", type=int, default=3)
    ap.add_argument("--validations-group-b", type=int, default=2)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.students_group_a < 0:
        raise ReseedError("--students-group-a no puede ser negativo.")
    if args.validations_group_a < 1 or args.validations_group_b < 1:
        raise ReseedError("Las validaciones por grupo deben ser >= 1.")

    csv_rows = _read_csv(args.csv_path)
    conn = get_db_connection()
    if not conn:
        raise ReseedError("No hay conexión a base de datos.")

    try:
        admin_id = _fetch_admin_id(conn, args.admin_user)
        course_id = _fetch_first_active(conn, "Cursos", "IdCurso")
        type_id = _fetch_first_active(conn, "TiposCredencial", "IdTipoCredencial")
        doctor_id = _fetch_first_active(conn, "FirmaDoctores", "IdFirmaDoctores")
        center_ids = _fetch_active_ids(conn, "CentroEducativo", "IdCentroEducativo")
        if len(center_ids) < 1:
            raise ReseedError("No hay centros educativos activos.")

        alumnos = _resolve_students(conn, csv_rows)
        user_ids = [a.user_id for a in alumnos]

        print(f"Alumnos CSV: {len(csv_rows)}")
        print(f"Alumnos resueltos: {len(alumnos)}")
        print(f"Admin actor ID: {admin_id}")
        print(
            f"Catálogos -> curso={course_id}, tipo={type_id}, firma={doctor_id}, centros_activos={len(center_ids)}"
        )

        to_delete = 0
        cur = conn.cursor()
        for uid in user_ids:
            cur.execute(
                "SELECT COUNT(*) FROM Certificados WHERE IdUsuarioDestinatario = ?",
                (uid,),
            )
            to_delete += int(cur.fetchone()[0])
        print(f"Certificados actuales de esos alumnos: {to_delete}")

        if args.dry_run:
            print("DRY-RUN: sin cambios en BD.")
            return 0

        deleted = _delete_old_certs(conn, user_ids)
        conn.commit()
        print(f"Certificados eliminados: {deleted}")

        body_tpl = (
            "Por haber culminado satisfactoriamente el programa [[CURSO]], "
            "cumpliendo los estándares académicos y competencias establecidas."
        )

        generated = 0
        verified = 0
        total_validations = 0
        for i, a in enumerate(alumnos):
            centro_id = center_ids[i % len(center_ids)]
            validations_for_cert = (
                args.validations_group_a if i < args.students_group_a else args.validations_group_b
            )
            payload = {
                "name": a.full_name,
                "date": args.issue_date,
                "recipient_user_id": a.user_id,
                "course_id": course_id,
                "type_id": type_id,
                "centro_educativo_id": centro_id,
                "firma_doctor_id": doctor_id,
                "body_text": body_tpl,
            }
            cert, _tgc = certificado.crear_certificado(payload, created_by_user_id=admin_id)
            generated += 1
            all_valid = True
            for _ in range(validations_for_cert):
                is_valid, _tv, _parsed = certificado.verificar_certificado(cert["qrPayload"])
                total_validations += 1
                all_valid = all_valid and bool(is_valid)
            if all_valid:
                verified += 1
            print(
                f"[{i+1:02d}/{len(alumnos)}] {a.dni} | {a.full_name} | centro={centro_id} | cert={cert.get('id')} | "
                f"validations={validations_for_cert} | valid={all_valid}"
            )

        print("\nProceso completado.")
        print(f"Generados: {generated}")
        print(f"Verificados válidos: {verified}")
        print(f"Total validaciones ejecutadas: {total_validations}")
        return 0
    finally:
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReseedError as e:
        print(f"ERROR: {e}")
        raise SystemExit(2)
