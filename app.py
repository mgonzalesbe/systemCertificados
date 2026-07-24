"""
Punto de entrada del sistema de certificados (arquitectura de 4 capas).

Capas:
  - Presentacion: Rutas Flask + templates/static
  - Aplicacion: casos de uso / servicios
  - Dominio: entidades y reglas
  - Persistencia: acceso a BD

Ejecutar desde la raíz del proyecto:
  python app.py
"""

import os
import sys

# Asegura imports de paquetes locales
ROOT = os.path.abspath(os.path.dirname(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from Presentacion.Rutas.app import app  # noqa: E402
from Persistencia.database import init_db  # noqa: E402
from Aplicacion.Servicios import auth_usuarios, certificado  # noqa: E402


if __name__ == "__main__":
    init_db()
    auth_usuarios.asegurar_admin_por_defecto()
    try:
        certificado.init_stats_from_db()
    except Exception:
        pass

    debug = os.environ.get("FLASK_DEBUG", "false").lower() in ("1", "true", "yes", "y")
    port = int(os.environ.get("PORT", "5000"))
    host = os.environ.get("FLASK_HOST", "0.0.0.0")

    print("\n" + "=" * 60)
    print("CERTIFICADOS — Hospital Distrital Laredo (prácticas)")
    print(f"http://127.0.0.1:{port}")
    print("Arquitectura: Presentacion / Dominio / Aplicacion / Persistencia")
    print("=" * 60 + "\n")

    app.run(debug=debug, port=port, host=host)
