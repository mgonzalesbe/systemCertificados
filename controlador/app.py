"""
Punto de entrada legado. Preferir ejecutar desde la raíz:

  python app.py

Este archivo redirige a la arquitectura de 4 capas.
"""

import os
import runpy
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
os.chdir(ROOT)
runpy.run_path(os.path.join(ROOT, "app.py"), run_name="__main__")
