"""
Coherencia entre el PDF (capa de texto) y el registro oficial en base de datos.

La firma del QR ya ata criptográficamente nombre, curso, fecha y tipo; aquí se
comprueba que nombre y (si aplica) curso aparezcan en el texto extraíble del
archivo, para detectar sustitución solo visual sin tocar el QR.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional, Tuple

import fitz

# Cursos más cortos que esto (tras normalizar) no se exigen en el PDF para
# evitar falsos positivos/negativos con códigos muy breves ("IPE", "CE", etc.).
MIN_COURSE_CHARS_FOR_VISUAL_CHECK = 8


def _normalize_match_key(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = s.casefold()
    s = re.sub(r"\s+", " ", s).strip()
    return s


def extract_pdf_plaintext(pdf_bytes: bytes, max_pages: int = 10) -> str:
    if not pdf_bytes:
        return ""
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return ""
    try:
        parts = []
        for i in range(min(len(doc), max_pages)):
            t = doc[i].get_text("text") or ""
            if t.strip():
                parts.append(t)
        return "\n".join(parts)
    finally:
        doc.close()


def _phrase_in_normalized_body(norm_body: str, phrase: str) -> bool:
    p = _normalize_match_key(phrase)
    if not p:
        return True
    if p in norm_body:
        return True
    p_compact = re.sub(r"\s+", "", p)
    body_compact = re.sub(r"\s+", "", norm_body)
    return bool(p_compact and p_compact in body_compact)


def check_official_record_in_pdf_text(
    pdf_bytes: bytes,
    official_name: str,
    official_course: str,
    *,
    min_course_chars: int = MIN_COURSE_CHARS_FOR_VISUAL_CHECK,
) -> Tuple[str, Optional[bool]]:
    """
    Devuelve (código, coherente) donde coherente es:
      True  — nombre (y curso, si aplica) aparecen en el texto del PDF
      False — hay texto pero falta nombre o curso esperado
      None  — no hay capa de texto utilizable (p. ej. PDF solo imagen)
    Códigos: ok, name_mismatch, course_mismatch, no_text_layer
    """
    body = extract_pdf_plaintext(pdf_bytes)
    norm_body = _normalize_match_key(body)
    if not norm_body:
        return "no_text_layer", None

    if not _phrase_in_normalized_body(norm_body, official_name):
        return "name_mismatch", False

    c_norm = _normalize_match_key(official_course or "")
    if len(c_norm) < min_course_chars:
        return "ok", True

    if not _phrase_in_normalized_body(norm_body, official_course or ""):
        return "course_mismatch", False

    return "ok", True


def check_official_name_in_pdf_text(
    pdf_bytes: bytes, official_name: str
) -> Tuple[str, Optional[bool]]:
    """Compatibilidad: solo comprueba el nombre (sin exigir curso)."""
    return check_official_record_in_pdf_text(pdf_bytes, official_name, "")
