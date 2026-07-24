"""Extrae el primer texto de QR legible desde un PDF (primeras páginas, varias escalas)."""

import fitz
import cv2
import numpy as np


def _decode_qr_text(image_bgr):
    det = cv2.QRCodeDetector()
    candidates = [image_bgr]
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    candidates.append(gray)
    # Mejorar contraste para reducir errores de lectura en PDFs comprimidos.
    thr = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 8
    )
    candidates.append(thr)

    for img in candidates:
        try:
            val, _, _ = det.detectAndDecode(img)
            if val:
                return val.strip()
        except Exception:
            continue
    return None


def extract_first_qr_payload_from_pdf(pdf_bytes: bytes):
    if not pdf_bytes:
        return None
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        return None

    try:
        max_pages = min(len(doc), 3)
        for page_index in range(max_pages):
            page = doc[page_index]
            for scale in (2.0, 3.0, 4.0):
                mat = fitz.Matrix(scale, scale)
                try:
                    pix = page.get_pixmap(matrix=mat, alpha=False)
                except Exception:
                    continue
                h = pix.height
                w = pix.width
                n = pix.n
                raw = pix.samples
                img = np.frombuffer(raw, dtype=np.uint8).reshape(h, w, n)
                if n == 3:
                    img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
                elif n == 4:
                    img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
                else:
                    continue
                val = _decode_qr_text(img)
                if val:
                    return val
        return None
    finally:
        doc.close()
