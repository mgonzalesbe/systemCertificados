"""
Elimina certificados duplicados conservando SOLO 1 por alumno (IdUsuarioDestinatario).

Regla de conservación:
- Se conserva el más reciente por FechaCreacion DESC, y en empate por IdCertificado DESC.

Uso (simulación):
  python scripts/dedupe_certificados.py --dry-run

Uso (aplicar borrado):
  python scripts/dedupe_certificados.py --apply
"""
from __future__ import annotations

import argparse
import sys
from typing import Any

from modelo.database import get_db_connection


def fetch_duplicate_groups(cur) -> list[tuple[int, int]]:
    cur.execute(
        """
        SELECT IdUsuarioDestinatario, COUNT(*) AS Total
        FROM Certificados
        WHERE IdUsuarioDestinatario IS NOT NULL
        GROUP BY IdUsuarioDestinatario
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, IdUsuarioDestinatario ASC
        """
    )
    out = []
    for r in cur.fetchall():
        out.append((int(r[0]), int(r[1])))
    return out


def get_ids_to_delete_for_student(cur, user_id: int) -> list[str]:
    cur.execute(
        """
        SELECT IdCertificado
        FROM Certificados
        WHERE IdUsuarioDestinatario = ?
        ORDER BY
            CASE WHEN FechaCreacion IS NULL THEN 1 ELSE 0 END ASC,
            FechaCreacion DESC,
            IdCertificado DESC
        """,
        (user_id,),
    )
    ids = [str(r[0]) for r in cur.fetchall()]
    # conservar el primero (más reciente), borrar el resto
    return ids[1:]


def delete_ids(cur, ids: list[str]) -> int:
    if not ids:
        return 0
    deleted = 0
    for cid in ids:
        cur.execute("DELETE FROM Certificados WHERE IdCertificado = ?", (cid,))
        deleted += int(cur.rowcount or 0)
    return deleted


def main() -> int:
    ap = argparse.ArgumentParser(description="Depurar certificados duplicados por alumno.")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Solo mostrar qué se borraría.")
    mode.add_argument("--apply", action="store_true", help="Aplicar borrado.")
    args = ap.parse_args()

    conn = get_db_connection()
    if not conn:
        print("ERROR: No se pudo conectar a la base de datos.", file=sys.stderr)
        return 2

    try:
        cur = conn.cursor()

        cur.execute("SELECT COUNT(*) FROM Certificados")
        total_before = int(cur.fetchone()[0])

        groups = fetch_duplicate_groups(cur)
        if not groups:
            print("No se detectaron duplicados por alumno.")
            print(f"Total certificados: {total_before}")
            return 0

        all_to_delete: list[str] = []
        print(f"Grupos duplicados detectados: {len(groups)}")
        for user_id, count in groups:
            ids_to_delete = get_ids_to_delete_for_student(cur, user_id)
            all_to_delete.extend(ids_to_delete)
            print(
                f"- Alumno {user_id}: {count} certificados -> conservar 1, borrar {len(ids_to_delete)}"
            )

        print(f"\nTotal a borrar: {len(all_to_delete)}")
        print(f"Total esperado final: {total_before - len(all_to_delete)}")

        if args.dry_run:
            print("\nModo simulación: no se realizaron cambios.")
            return 0

        deleted = delete_ids(cur, all_to_delete)
        conn.commit()

        cur.execute("SELECT COUNT(*) FROM Certificados")
        total_after = int(cur.fetchone()[0])

        print("\nBorrado aplicado correctamente.")
        print(f"Registros eliminados: {deleted}")
        print(f"Total antes: {total_before}")
        print(f"Total después: {total_after}")
        return 0
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        print(f"ERROR durante depuración: {e}", file=sys.stderr)
        return 1
    finally:
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())

