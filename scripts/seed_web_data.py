"""
Carga de datos demo para la web:
- registra alumnos via /api/auth/register
- genera certificados via /api/generate
- verifica certificados via /api/verify

Permite usar un CSV con correos propios y completar faltantes automaticos.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import re
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date
from http.cookiejar import CookieJar
from typing import Any


class ApiError(RuntimeError):
    pass


@dataclass
class StudentSeed:
    idx: int
    username: str
    email: str
    password: str
    dni: str
    nombres: str
    apellidos: str

    @property
    def full_name(self) -> str:
        return f"{self.nombres} {self.apellidos}".strip()


class ApiClient:
    def __init__(self, base_url: str, timeout_sec: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.timeout_sec = timeout_sec
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )

    def _url(self, path: str) -> str:
        if path.startswith("http://") or path.startswith("https://"):
            return path
        if not path.startswith("/"):
            path = "/" + path
        return self.base_url + path

    def request_json(
        self,
        path: str,
        method: str = "GET",
        payload: dict[str, Any] | None = None,
        ok_statuses: tuple[int, ...] = (200,),
    ) -> tuple[int, dict[str, Any]]:
        raw = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            raw = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            self._url(path), data=raw, method=method.upper(), headers=headers
        )
        try:
            with self.opener.open(req, timeout=self.timeout_sec) as resp:
                status = int(resp.getcode() or 0)
                data = json.loads(resp.read().decode("utf-8", errors="replace") or "{}")
        except urllib.error.HTTPError as e:
            status = int(e.code or 0)
            body = e.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(body or "{}")
            except Exception:
                data = {"error": body[:500]}
        except Exception as e:
            raise ApiError(f"Error de red contra {path}: {e}") from e

        if status not in ok_statuses:
            msg = data.get("error") if isinstance(data, dict) else None
            raise ApiError(f"{path} devolvio HTTP {status}. {msg or data}")
        return status, data if isinstance(data, dict) else {}


def sanitize_username(value: str, fallback: str) -> str:
    base = re.sub(r"[^a-z0-9_]+", "_", value.lower()).strip("_")
    return base[:30] if base else fallback


def parse_domains(raw: str) -> list[str]:
    domains = [d.strip().lower() for d in (raw or "").split(",") if d.strip()]
    if not domains:
        raise ApiError("Debe indicar al menos un dominio en --email-domains.")
    return domains


def load_students_from_csv(
    csv_path: str, default_password: str, used_dnis: set[str], used_users: set[str]
) -> list[StudentSeed]:
    rows: list[StudentSeed] = []
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        required = {"email", "dni", "nombres", "apellidos"}
        missing = [k for k in required if k not in (reader.fieldnames or [])]
        if missing:
            raise ApiError(f"CSV sin columnas requeridas: {', '.join(missing)}")
        for i, r in enumerate(reader, start=1):
            email = str(r.get("email") or "").strip().lower()
            dni = str(r.get("dni") or "").strip()
            nombres = str(r.get("nombres") or "").strip()
            apellidos = str(r.get("apellidos") or "").strip()
            if not email or not dni or not nombres or not apellidos:
                continue
            if not re.fullmatch(r"\d{8}", dni):
                raise ApiError(f"DNI invalido en CSV (fila {i}): {dni}")
            if dni in used_dnis:
                raise ApiError(f"DNI duplicado en CSV: {dni}")
            used_dnis.add(dni)
            user_raw = str(r.get("username") or f"{nombres}_{apellidos}_{dni[-3:]}").strip()
            username = sanitize_username(user_raw, f"alumno_csv_{i:03d}")
            while username in used_users:
                username = f"{username}_{random.randint(10,99)}"
            used_users.add(username)
            pwd = str(r.get("password") or "").strip() or default_password
            rows.append(
                StudentSeed(
                    idx=len(rows) + 1,
                    username=username,
                    email=email,
                    password=pwd,
                    dni=dni,
                    nombres=nombres,
                    apellidos=apellidos,
                )
            )
    return rows


def build_auto_students(
    count: int,
    email_domains: list[str],
    password: str,
    dni_start: int,
    used_dnis: set[str],
    used_users: set[str],
) -> list[StudentSeed]:
    nombres = [
        "Ana", "Luis", "Maria", "Jorge", "Paola", "Carlos", "Lucia", "Raul", "Diana",
        "Hector", "Rosa", "Kevin", "Andrea", "Miguel", "Sofia", "David", "Elena", "Ivan",
        "Camila", "Bruno", "Noelia", "Gerson", "Valeria", "Renzo", "Nadia", "Marco",
    ]
    apellidos = [
        "Perez", "Gonzales", "Ramirez", "Quispe", "Flores", "Rojas", "Torres", "Sanchez",
        "Vargas", "Cruz", "Huaman", "Castillo", "Diaz", "Romero", "Aguilar", "Campos",
    ]
    random.seed(2026)
    out: list[StudentSeed] = []
    n = 0
    next_dni = int(dni_start)
    while n < count:
        nom = nombres[n % len(nombres)]
        ape = apellidos[(n * 3) % len(apellidos)]
        while True:
            dni = str(next_dni).zfill(8)
            next_dni += 1
            if dni not in used_dnis:
                break
        used_dnis.add(dni)
        username = sanitize_username(f"alumno_auto_{n+1:02d}", f"alumno_{n+1:02d}")
        while username in used_users:
            username = f"{username}_{random.randint(10,99)}"
        used_users.add(username)
        domain = email_domains[n % len(email_domains)]
        out.append(
            StudentSeed(
                idx=n + 1,
                username=username,
                email=f"alumno.auto.{n+1:02d}@{domain}",
                password=password,
                dni=dni,
                nombres=nom,
                apellidos=ape,
            )
        )
        n += 1
    return out


def pick_first_active_id(rows: list[dict[str, Any]], key_id: str = "id") -> int:
    active = [r for r in rows if bool(r.get("active"))]
    if not active:
        raise ApiError("No hay registros activos en catalogo requerido.")
    return int(active[0][key_id])


def get_student_id_by_dni(client: ApiClient, dni: str) -> int:
    q = urllib.parse.quote(dni)
    _, data = client.request_json(f"/api/students?q={q}", method="GET")
    rows = data.get("students") or []
    for s in rows:
        if str(s.get("dni") or "").strip() == dni:
            return int(s["id"])
    raise ApiError(f"No se encontro alumno con DNI {dni} tras registro.")


def maybe_register_student(client: ApiClient, s: StudentSeed) -> bool:
    payload = {
        "username": s.username,
        "email": s.email,
        "password": s.password,
        "documento_identidad": s.dni,
        "nombres": s.nombres,
        "apellidos": s.apellidos,
    }
    try:
        client.request_json(
            "/api/auth/register", method="POST", payload=payload, ok_statuses=(200,)
        )
        return True
    except ApiError as e:
        txt = str(e).lower()
        if (
            "correo electrónico ya está registrado" in txt
            or "nombre de usuario ya existe" in txt
            or "documento de identidad ya está registrado" in txt
        ):
            return False
        raise


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Seed de alumnos+certificados+verificaciones via API web."
    )
    ap.add_argument("--base-url", required=True, help="Ej: https://www.certificadoseduhdl.com")
    ap.add_argument("--admin-user", required=True)
    ap.add_argument("--admin-pass", required=True)
    ap.add_argument("--count", type=int, default=26, help="Total alumnos objetivo.")
    ap.add_argument("--csv-path", default="", help="CSV opcional con alumnos propios.")
    ap.add_argument(
        "--email-domains",
        default="gmail.com,hotmail.com,outlook.com",
        help="Dominios para alumnos auto (separados por coma).",
    )
    ap.add_argument("--student-pass", default="Alumno123!")
    ap.add_argument("--dni-start", type=int, default=76000000)
    args = ap.parse_args()

    domains = parse_domains(args.email_domains)
    used_dnis: set[str] = set()
    used_users: set[str] = set()

    csv_students: list[StudentSeed] = []
    if args.csv_path:
        csv_students = load_students_from_csv(
            args.csv_path, args.student_pass, used_dnis, used_users
        )
        print(f"CSV cargado: {len(csv_students)} alumnos propios.")

    if len(csv_students) > args.count:
        print(
            f"ADVERTENCIA: CSV tiene {len(csv_students)} filas y --count={args.count}. "
            f"Se usaran las primeras {args.count}."
        )
        csv_students = csv_students[: args.count]

    auto_needed = max(0, args.count - len(csv_students))
    auto_students = build_auto_students(
        count=auto_needed,
        email_domains=domains,
        password=args.student_pass,
        dni_start=args.dni_start,
        used_dnis=used_dnis,
        used_users=used_users,
    )
    students = csv_students + auto_students
    for i, s in enumerate(students, start=1):
        s.idx = i
    print(
        f"Total objetivo: {args.count} | propios CSV: {len(csv_students)} | auto: {len(auto_students)}"
    )

    client = ApiClient(args.base_url)
    print("1) Login admin...")
    client.request_json(
        "/api/auth/login",
        method="POST",
        payload={"username": args.admin_user, "password": args.admin_pass},
        ok_statuses=(200,),
    )

    print("2) Leyendo catalogos activos...")
    _, c = client.request_json("/api/admin/courses", method="GET")
    _, t = client.request_json("/api/admin/credential-types", method="GET")
    _, ce = client.request_json("/api/admin/centros-educativos", method="GET")
    _, fd = client.request_json("/api/admin/firma-doctores", method="GET")
    course_id = pick_first_active_id(c.get("courses") or [])
    type_id = pick_first_active_id(t.get("types") or [])
    centro_id = pick_first_active_id(ce.get("centers") or [])
    firma_id = pick_first_active_id(fd.get("doctors") or [])
    print(
        f"   -> course_id={course_id}, type_id={type_id}, centro_id={centro_id}, firma_id={firma_id}"
    )

    created_students = 0
    generated = 0
    verified = 0
    tgc_values: list[float] = []
    tv_values: list[float] = []
    today = date.today().isoformat()

    print(f"3) Registrando/emitiendo/verificando {len(students)} alumnos...")
    for s in students:
        was_created = maybe_register_student(client, s)
        if was_created:
            created_students += 1
        sid = get_student_id_by_dni(client, s.dni)
        gen_payload = {
            "name": s.full_name,
            "date": today,
            "recipient_user_id": sid,
            "course_id": course_id,
            "type_id": type_id,
            "centro_educativo_id": centro_id,
            "firma_doctor_id": firma_id,
        }
        _, gen = client.request_json("/api/generate", method="POST", payload=gen_payload)
        cert = gen.get("cert") or {}
        qr_payload = cert.get("qrPayload")
        if not qr_payload:
            raise ApiError(f"Certificado sin qrPayload para {s.username}")
        generated += 1
        tgc_values.append(float(gen.get("time") or 0.0))
        _, ver = client.request_json(
            "/api/verify", method="POST", payload={"qrPayload": qr_payload}
        )
        if bool(ver.get("isValid")):
            verified += 1
        tv_values.append(float(ver.get("time") or 0.0))
        print(
            f"   [{s.idx:02d}/{len(students)}] {s.username} | {s.email} | created={was_created} | cert={cert.get('id')} | valid={bool(ver.get('isValid'))}"
        )

    _, stats = client.request_json("/api/stats", method="GET")
    avg_tgc_local = (sum(tgc_values) / len(tgc_values)) if tgc_values else 0.0
    avg_tv_local = (sum(tv_values) / len(tv_values)) if tv_values else 0.0

    print("\n=== RESUMEN ===")
    print(f"Alumnos creados nuevos: {created_students}")
    print(f"Certificados generados: {generated}")
    print(f"Certificados verificados validos: {verified}")
    print(f"TGC promedio (lote actual): {avg_tgc_local:.4f} s")
    print(f"TV promedio (lote actual):  {avg_tv_local:.4f} s")
    print(
        "Stats servidor -> "
        f"verCount={stats.get('verCount')}, validCount={stats.get('validCount')}, "
        f"avgGenTime={stats.get('avgGenTime')}, avgVerTime={stats.get('avgVerTime')}"
    )
    print("\nListo.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ApiError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        raise SystemExit(2)
