"""Generación de PDF horizontal estilo reconocimiento oficial (marco, logos, cuerpo, firma, QR)."""

import io
import os

import qrcode
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

MUTED = colors.Color(0.35, 0.35, 0.37)

# Tipografía alineada al diploma de referencia (Helvetica ≈ Arial; Times-Italic ≈ Times New Roman cursiva)
FONT_SANS_BOLD = "Helvetica-Bold"
FONT_SANS = "Helvetica"
FONT_SERIF_ITALIC = "Times-Italic"
# «HOSPITAL DISTRITAL DE LAREDO» y línea de tipo de credencial: mismo tamaño (Helvetica-Bold)
FONT_HEADER_LINE_PT = 23.0
FONT_HEADER_LINE_MIN = 16.0
FONT_OTORGADO_SIZE = 13.5
FONT_NAME_SIZE = 22.0
FONT_NAME_MIN = 17.0
FONT_BODY_SIZE = 16.8
FONT_BODY_LEADING_MULT = 1.5
FONT_META_SIZE = 9.5
FONT_FIRMANTE_SIZE = 9.8
FONT_CARGO_SIZE = 9.8

_ASSETS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "vista", "assets", "imagenes", "certificados")
)


def _asset_path(*candidates: str) -> str | None:
    for name in candidates:
        p = os.path.join(_ASSETS_DIR, name)
        if os.path.isfile(p):
            return p
    return None


def _open_plantilla_reader(plantilla_fondo_bytes: bytes | None) -> ImageReader | None:
    """Imagen de página completa (PNG/JPEG). Sin transparencia forzada: use el archivo tal cual."""
    if plantilla_fondo_bytes:
        try:
            return ImageReader(io.BytesIO(plantilla_fondo_bytes))
        except Exception:
            return None
    path = (os.environ.get("CERT_PDF_PLANTILLA_FONDO") or "").strip().strip('"')
    if path and os.path.isfile(path):
        try:
            return ImageReader(path)
        except Exception:
            return None
    for name in (
        "fondo_certificado.png",
        "plantilla_certificado.png",
        "fondo_certificado.jpg",
        "plantilla_certificado.jpg",
    ):
        p = os.path.join(_ASSETS_DIR, name)
        if os.path.isfile(p):
            try:
                return ImageReader(p)
            except Exception:
                return None
    return None


def _draw_background_cover(c, w: float, h: float, ir: ImageReader):
    """Escala la plantilla para cubrir toda la página (tipo «cover»), centrada."""
    iw, ih = ir.getSize()
    sc = max(w / float(iw), h / float(ih))
    sw, sh = iw * sc, ih * sc
    x = (w - sw) / 2.0
    y = (h - sh) / 2.0
    c.drawImage(ir, x, y, width=sw, height=sh, mask="auto")


def _wrap_centered_lines(
    c, text: str, cx: float, y_top: float, max_w: float, font: str, size: float, leading_pt: float
):
    words = text.split()
    if not words:
        return y_top
    line = ""
    y = y_top
    for word in words:
        test = (line + " " + word).strip()
        if c.stringWidth(test, font, size) <= max_w:
            line = test
        else:
            c.drawCentredString(cx, y, line)
            y -= leading_pt
            line = word
    if line:
        c.drawCentredString(cx, y, line)
        y -= leading_pt
    return y


def expand_diploma_placeholders(text: str, curso: str, tipo_credencial: str) -> str:
    """
    Sustituye marcadores del cuerpo del diploma al emitir (curso y tipo vienen del catálogo).

    Marcadores reconocidos: ``[[CURSO]]`` → nombre del curso; ``[[TIPO]]`` → tipo de credencial.
    """
    if not text:
        return text
    curso_txt = (curso or "").strip()
    tipo_txt = (tipo_credencial or "").strip()
    return text.replace("[[CURSO]]", curso_txt).replace("[[TIPO]]", tipo_txt)


def _draw_scaled_image(c, ir: ImageReader, cx: float, top_y: float, max_w: float, max_h: float, anchor: str):
    """anchor: 'left' (borde izquierdo en cx) o 'right' (borde derecho en cx)."""
    iw, ih = ir.getSize()
    sc = min(max_w / float(iw), max_h / float(ih))
    sw, sh = iw * sc, ih * sc
    base_y = top_y - sh
    if anchor == "right":
        x = cx - sw
    else:
        x = cx
    c.drawImage(ir, x, base_y, width=sw, height=sh, mask="auto")
    return top_y - sh - 0.15 * cm


def _draw_certificate_header(
    c,
    w: float,
    h: float,
    margin_x: float,
    inner_w: float,
    cx: float,
    logo_derecho_bytes: bytes | None,
    tipo_credencial: str,
    institucion_nombre: str | None = None,
) -> float:
    """
    Logos superior izquierdo (regional, assets) y derecho (universidad, bytes): mismo tamaño máximo,
    misma altura (y_header_top) y misma separación respecto al borde interior (espejo).
    Devuelve la coordenada Y (baseline) debajo del bloque de títulos.
    """
    y_header_top = h - 1.55 * cm
    y_below_logos = y_header_top
    # Mismo tope para ambos logos (simetría). Variables de entorno con prefijo REGIONAL por compatibilidad.
    logo_max_w = float(os.environ.get("CERT_PDF_LOGO_REGIONAL_MAX_W_CM", "4.95")) * cm
    logo_max_h = float(os.environ.get("CERT_PDF_LOGO_REGIONAL_MAX_H_CM", "3.5")) * cm
    # Misma distancia del borde interior: izquierda desde margin_x, derecha desde w - margin_x
    logo_inset_x = float(os.environ.get("CERT_PDF_LOGO_REGIONAL_OFFSET_X_CM", "3.8")) * cm
    left_x = margin_x + logo_inset_x
    right_x = w - margin_x - logo_inset_x

    left_path = _asset_path(
        "logo_gobierno_regional.png",
        "logo_regional.png",
        "logo_izquierda.png",
        "logo_gobierno.png",
        "logo.png",
    )
    if left_path:
        try:
            left_ir = ImageReader(left_path)
            y_below_logos = min(
                y_below_logos,
                _draw_scaled_image(c, left_ir, left_x, y_header_top, logo_max_w, logo_max_h, "left"),
            )
        except Exception:
            pass

    if logo_derecho_bytes:
        try:
            right_ir = ImageReader(io.BytesIO(logo_derecho_bytes))
            y_below_logos = min(
                y_below_logos,
                _draw_scaled_image(c, right_ir, right_x, y_header_top, logo_max_w, logo_max_h, "right"),
            )
        except Exception:
            pass

    # Baja el bloque de títulos y todo lo que sigue (Hospital / Reconocimiento / cuerpo…)
    title_block_drop = float(os.environ.get("CERT_PDF_TITLE_BLOCK_DROP_CM", "1.55")) * cm
    y = y_below_logos - 0.28 * cm - title_block_drop

    inst = ((institucion_nombre or "").strip() or "CENTRO EDUCATIVO").upper()
    titulo = ((tipo_credencial or "").strip() or "RECONOCIMIENTO").upper()
    c.setFillColor(colors.black)
    fs = FONT_HEADER_LINE_PT
    while fs >= FONT_HEADER_LINE_MIN and (
        c.stringWidth(inst, FONT_SANS_BOLD, fs) > inner_w
        or c.stringWidth(titulo, FONT_SANS_BOLD, fs) > inner_w
    ):
        fs -= 0.5
    c.setFont(FONT_SANS_BOLD, fs)
    c.drawCentredString(cx, y, inst)
    y -= max(0.55 * cm, fs * 1.22)
    c.drawCentredString(cx, y, titulo)
    y -= max(0.55 * cm, fs * 1.18)
    y -= 0.42 * cm
    return y


def generar_pdf_diploma(
    dest,
    cert_id: str,
    nombre: str,
    curso: str,
    fecha_emision: str,
    tipo_credencial: str,
    qr_payload: str,
    texto_cuerpo: str | None = None,
    *,
    logo_derecho_bytes: bytes | None = None,
    doctor_firma_bytes: bytes | None = None,
    doctor_nombres: str | None = None,
    doctor_genero: str | None = None,
    plantilla_fondo_bytes: bytes | None = None,
    institucion_nombre: str | None = None,
):
    """
    Diploma horizontal: plantilla de página (env o PNG/JPG en assets), cabecera con logos,
    títulos, cuerpo opcional, firma y QR. Sin plantilla solo se deja el fondo blanco (el marco va en la imagen).
    El logo izquierdo es el archivo estático regional (assets).
    Si ``texto_cuerpo`` está vacío, no se dibuja párrafo de cuerpo (el redactor define el inicio al escribir).
    En el cuerpo se expanden ``[[CURSO]]`` y ``[[TIPO]]`` con los valores de ``curso`` y ``tipo_credencial``.
    """
    w, h = landscape(A4)
    c = canvas.Canvas(dest, pagesize=(w, h))

    margin_x = float(os.environ.get("CERT_PDF_MARGIN_X_CM", "2.35")) * cm
    inner_w = w - 2 * margin_x
    cx = w / 2

    plantilla_ir = _open_plantilla_reader(plantilla_fondo_bytes)

    c.setFillColor(colors.white)
    c.rect(0, 0, w, h, fill=1, stroke=0)

    if plantilla_ir:
        _draw_background_cover(c, w, h, plantilla_ir)

    y = _draw_certificate_header(
        c, w, h, margin_x, inner_w, cx, logo_derecho_bytes, tipo_credencial, institucion_nombre
    )

    c.setFillColor(colors.black)
    c.setFont(FONT_SERIF_ITALIC, FONT_OTORGADO_SIZE)
    c.drawString(margin_x, y, "Otorgado a :")
    y -= 0.58 * cm

    # Nombre del beneficiario
    nombre_clean = (nombre or "").strip().upper()
    name_size = FONT_NAME_SIZE
    c.setFont(FONT_SANS_BOLD, name_size)
    while name_size >= FONT_NAME_MIN and c.stringWidth(nombre_clean, FONT_SANS_BOLD, name_size) > inner_w:
        name_size -= 0.5
    c.setFont(FONT_SANS_BOLD, name_size)
    c.drawCentredString(cx, y, nombre_clean)
    y -= name_size * 1.2

    y -= 0.42 * cm

    # Cuerpo (cursiva Times, centrado — solo si el usuario o catálogo aportan texto)
    if texto_cuerpo and texto_cuerpo.strip():
        body = expand_diploma_placeholders(texto_cuerpo.strip(), curso, tipo_credencial)
        body_size = FONT_BODY_SIZE
        leading = body_size * FONT_BODY_LEADING_MULT
        c.setFont(FONT_SERIF_ITALIC, body_size)
        c.setFillColor(colors.black)
        y = _wrap_centered_lines(c, body, cx, y, inner_w, FONT_SERIF_ITALIC, body_size, leading)
        y -= 0.48 * cm

    # --- Firma central (imagen + Dr./Dra. + cargo fijo) ---
    # Un poco más arriba para dejar sitio al QR centrado bajo el cargo
    line_y = float(os.environ.get("CERT_PDF_PLANTILLA_LINEA_FIRMA_CM", "3.05")) * cm
    line_half = 4.2 * cm
    max_sig_w, max_sig_h = 4.8 * cm, 2.1 * cm
    if doctor_firma_bytes:
        try:
            ir_sig = ImageReader(io.BytesIO(doctor_firma_bytes))
            iw, ih = ir_sig.getSize()
            sc = min(max_sig_w / float(iw), max_sig_h / float(ih))
            sw, sh = iw * sc, ih * sc
            c.drawImage(
                ir_sig,
                cx - sw / 2,
                line_y + 0.12 * cm,
                width=sw,
                height=sh,
                mask="auto",
            )
        except Exception:
            pass

    c.setStrokeColor(colors.black)
    c.setLineWidth(0.6)
    c.line(cx - line_half, line_y, cx + line_half, line_y)

    gen = (doctor_genero or "").strip()
    pref = "Dr. " if gen == "Masculino" else "Dra. " if gen == "Femenino" else ""
    nom_doc = (doctor_nombres or "").strip().upper()
    firmante_line = (pref + nom_doc).strip() or (os.environ.get("CERT_FIRMANTE_NOMBRE") or "").strip()
    if firmante_line:
        c.setFont(FONT_SANS, FONT_FIRMANTE_SIZE)
        c.setFillColor(colors.black)
        c.drawCentredString(cx, line_y - 0.4 * cm, firmante_line)
    c.setFont(FONT_SANS_BOLD, FONT_CARGO_SIZE)
    c.setFillColor(colors.black)
    cargo_baseline = line_y - 0.78 * cm
    inst_cargo = ((institucion_nombre or "").strip() or "CENTRO EDUCATIVO").upper()
    c.drawCentredString(cx, cargo_baseline, f"DIRECTOR DE {inst_cargo}")

    # --- QR centrado debajo del cargo (pequeño; no tapa esquinas del marco) ---
    qr = qrcode.QRCode(version=None, box_size=1, border=1)
    qr.add_data(qr_payload)
    qr.make(fit=True)
    pil_img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    buf.seek(0)
    qr_size = float(os.environ.get("CERT_PDF_QR_SIZE_CM", "1.12")) * cm
    # Espacio bajo la línea de base del cargo (descendentes + separación)
    drop_below_cargo = 0.45 * cm
    qy = cargo_baseline - drop_below_cargo - qr_size
    qx = cx - qr_size / 2.0
    c.setStrokeColor(MUTED)
    c.setLineWidth(0.35)
    pad = 0.06 * cm
    c.rect(qx - pad, qy - pad, qr_size + 2 * pad, qr_size + 2 * pad, fill=0, stroke=1)
    c.drawImage(ImageReader(buf), qx, qy, width=qr_size, height=qr_size, mask="auto")

    c.showPage()
    c.save()


def generar_pdf_diploma_bytes(
    cert_id: str,
    nombre: str,
    curso: str,
    fecha_emision: str,
    tipo_credencial: str,
    qr_payload: str,
    texto_cuerpo: str | None = None,
    *,
    logo_derecho_bytes: bytes | None = None,
    doctor_firma_bytes: bytes | None = None,
    doctor_nombres: str | None = None,
    doctor_genero: str | None = None,
    plantilla_fondo_bytes: bytes | None = None,
    institucion_nombre: str | None = None,
) -> bytes:
    """Genera el PDF en memoria (para guardar en SQL Server VARBINARY).

    En ``texto_cuerpo`` se expanden ``[[CURSO]]`` y ``[[TIPO]]`` con ``curso`` y ``tipo_credencial``.
    """
    buf = io.BytesIO()
    generar_pdf_diploma(
        buf,
        cert_id=cert_id,
        nombre=nombre,
        curso=curso,
        fecha_emision=fecha_emision,
        tipo_credencial=tipo_credencial,
        qr_payload=qr_payload,
        texto_cuerpo=texto_cuerpo,
        logo_derecho_bytes=logo_derecho_bytes,
        doctor_firma_bytes=doctor_firma_bytes,
        doctor_nombres=doctor_nombres,
        doctor_genero=doctor_genero,
        plantilla_fondo_bytes=plantilla_fondo_bytes,
        institucion_nombre=institucion_nombre,
    )
    return buf.getvalue()
