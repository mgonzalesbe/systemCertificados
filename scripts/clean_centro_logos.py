"""
Reprocesa logos de CentroEducativo aplicando transparencia para quitar fondo/artefactos.

Uso:
  python scripts/clean_centro_logos.py --dry-run
  python scripts/clean_centro_logos.py --apply

Opcional filtrar por nombre:
  python scripts/clean_centro_logos.py --apply --name-like UCV
"""
from __future__ import annotations

import argparse
import hashlib
import sys

from modelo.database import get_db_connection
from modelo.image_transparency import strip_uniform_background_to_png


def _sha1(data: bytes | None) -> str:
    if not data:
        return ""
    return hashlib.sha1(data).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description="Limpiar logos de CentroEducativo en BD.")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    ap.add_argument("--name-like", default="", help="Filtrar por nombre de centro (LIKE %%x%%).")
    args = ap.parse_args()

    conn = get_db_connection()
    if not conn:
        print("ERROR: Sin conexion a BD.", file=sys.stderr)
        return 2

    try:
        cur = conn.cursor()
        if args.name_like:
            cur.execute(
                """
                SELECT IdCentroEducativo, Nombre, LogoDerecho
                FROM CentroEducativo
                WHERE LogoDerecho IS NOT NULL AND DATALENGTH(LogoDerecho) > 0
                  AND Nombre LIKE ?
                ORDER BY IdCentroEducativo
                """,
                (f"%{args.name_like}%",),
            )
        else:
            cur.execute(
                """
                SELECT IdCentroEducativo, Nombre, LogoDerecho
                FROM CentroEducativo
                WHERE LogoDerecho IS NOT NULL AND DATALENGTH(LogoDerecho) > 0
                ORDER BY IdCentroEducativo
                """
            )
        rows = cur.fetchall()
        if not rows:
            print("No hay logos para procesar.")
            return 0

        candidates: list[tuple[int, str, bytes]] = []
        changed_count = 0
        for r in rows:
            cid = int(r[0])
            name = str(r[1] or "")
            raw = bytes(r[2]) if not isinstance(r[2], (bytes, bytearray)) else bytes(r[2])
            new = strip_uniform_background_to_png(raw)
            old_h = _sha1(raw)
            new_h = _sha1(new)
            changed = old_h != new_h
            if changed:
                changed_count += 1
            candidates.append((cid, name, new))
            print(f"- {cid} | {name} | changed={changed}")

        print(f"\nTotal logos leidos: {len(rows)}")
        print(f"Total logos con cambios: {changed_count}")

        if args.dry_run:
            print("DRY-RUN: no se actualizo la BD.")
            return 0

        updated = 0
        for cid, _name, new in candidates:
            cur.execute(
                "UPDATE CentroEducativo SET LogoDerecho = ? WHERE IdCentroEducativo = ?",
                (new, cid),
            )
            updated += int(cur.rowcount or 0)
        conn.commit()
        print(f"Logos actualizados: {updated}")
        return 0
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    finally:
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())

