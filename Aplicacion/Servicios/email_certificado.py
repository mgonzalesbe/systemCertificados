import os
import base64
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

# Seguridad: nunca exponer credenciales en codigo fuente.
# Configure estas variables en su entorno local/servidor (Render).
ENV_GMAIL_CLIENT_ID = "GMAIL_CLIENT_ID"
ENV_GMAIL_CLIENT_SECRET = "GMAIL_CLIENT_SECRET"
ENV_GMAIL_REFRESH_TOKEN = "GMAIL_REFRESH_TOKEN"
ENV_GMAIL_SENDER = "GMAIL_SENDER"
GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send"


def _required_env(var_name: str) -> str:
    value = (os.environ.get(var_name) or "").strip()
    if not value:
        raise RuntimeError(f"Falta variable de entorno obligatoria: {var_name}")
    return value


def _gmail_settings():
    client_id = _required_env(ENV_GMAIL_CLIENT_ID)
    client_secret = _required_env(ENV_GMAIL_CLIENT_SECRET)
    refresh_token = _required_env(ENV_GMAIL_REFRESH_TOKEN)
    sender = _required_env(ENV_GMAIL_SENDER)
    return client_id, client_secret, refresh_token, sender


def _gmail_service():
    client_id, client_secret, refresh_token, _sender = _gmail_settings()
    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=[GMAIL_SCOPE],
    )
    creds.refresh(Request())
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _send_via_gmail_api(msg: MIMEMultipart) -> bool:
    try:
        service = _gmail_service()
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
        service.users().messages().send(userId="me", body={"raw": raw}).execute()
        return True
    except Exception as e:
        print(f"Error Gmail API enviando correo: {e}")
        return False


def correo_habilitado():
    if os.environ.get("MAIL_ENABLED", "true").lower() in ("0", "false", "no", "n"):
        return False
    try:
        _gmail_settings()
        return True
    except Exception:
        return False


def enviar_correo_certificado_asignado(
    destinatario: str,
    nombre_estudiante: str,
    cert_id: str,
    curso: str,
    tipo_credencial: str,
    url_descarga_pdf: str,
    remitente_preferido: str = "",
    pdf_bytes: bytes = None,
    pdf_filename: str = "certificado.pdf",
) -> bool:
    """
    Envía aviso de certificado asignado con enlace directo de descarga (token)
    y opcionalmente adjunta el archivo PDF.
    Usa SIEMPRE la cuenta unica configurada por variables SMTP_* y MAIL_FROM.
    """
    try:
        _, _, _, mail_from = _gmail_settings()
    except Exception as e:
        print(f"Correo no enviado: {e}")
        return False
    if not destinatario:
        return False

    from_header = mail_from

    subject = f"Certificado asignado: {tipo_credencial}"
    text_body = (
        f"Hola {nombre_estudiante},\n\n"
        f"Se le ha asignado un certificado en el sistema.\n\n"
        f"Identificador: {cert_id}\n"
        f"Curso / programa: {curso}\n"
        f"Tipo: {tipo_credencial}\n\n"
        f"Se adjunta el certificado en formato PDF para su comodidad.\n\n"
        f"También puede descargarlo usando este enlace temporal:\n{url_descarga_pdf}\n\n"
        f"Si el enlace vence, puede iniciar sesión en el portal del alumno y descargarlo desde allí.\n"
    )
    html_body = f"""\
<html>
<body>
<p>Hola <strong>{nombre_estudiante}</strong>,</p>
<p>Se le ha asignado un certificado en el sistema.</p>
<p>Se adjunta el certificado en formato PDF a este correo.</p>
<ul>
<li><strong>Identificador:</strong> {cert_id}</li>
<li><strong>Curso / programa:</strong> {curso}</li>
<li><strong>Tipo:</strong> {tipo_credencial}</li>
</ul>
<p><a href="{url_descarga_pdf}">Descargar certificado (Enlace alternativo)</a></p>
<p><small>Si el enlace vence, inicie sesión en el portal del alumno para descargarlo.</small></p>
</body>
</html>
"""

    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = from_header
    msg["To"] = destinatario

    # Cuerpo del mensaje (texto y HTML)
    msg_alt = MIMEMultipart("alternative")
    msg_alt.attach(MIMEText(text_body, "plain", "utf-8"))
    msg_alt.attach(MIMEText(html_body, "html", "utf-8"))
    msg.attach(msg_alt)

    # Adjuntar PDF si se proporcionan los bytes
    if pdf_bytes:
        part = MIMEBase("application", "octet-stream")
        part.set_payload(pdf_bytes)
        encoders.encode_base64(part)
        part.add_header(
            "Content-Disposition",
            f"attachment; filename={pdf_filename}",
        )
        msg.attach(part)

    return _send_via_gmail_api(msg)


def enviar_correo_credenciales_registro(
    destinatario: str,
    username: str,
    password: str,
    rol: str = "student",
    portal_url: str = "",
) -> bool:
    """
    Envía las credenciales iniciales al correo registrado.
    Nota: se envía la contraseña en texto plano por requerimiento funcional.
    """
    try:
        _, _, _, mail_from = _gmail_settings()
    except Exception as e:
        print(f"Correo de credenciales no enviado: {e}")
        return False

    destinatario = (destinatario or "").strip()
    username = (username or "").strip()
    if not destinatario or not username or not password:
        return False

    rol_label = "Administrador" if (rol or "").strip().lower() == "admin" else "Alumno"
    access_url = portal_url.strip() or "http://127.0.0.1:5000/"

    subject = "Credenciales de acceso — Sistema de Certificados"
    text_body = (
        f"Hola,\n\n"
        f"Se creó su cuenta en el Sistema de Certificados.\n\n"
        f"Rol: {rol_label}\n"
        f"Usuario: {username}\n"
        f"Contraseña: {password}\n\n"
        f"Ingreso: {access_url}\n\n"
        f"Recomendación: cambie su contraseña después del primer ingreso.\n"
    )
    html_body = f"""\
<html>
<body>
<p>Hola,</p>
<p>Se creó su cuenta en el <strong>Sistema de Certificados</strong>.</p>
<ul>
<li><strong>Rol:</strong> {rol_label}</li>
<li><strong>Usuario:</strong> {username}</li>
<li><strong>Contraseña:</strong> {password}</li>
</ul>
<p><a href="{access_url}">Ingresar al sistema</a></p>
<p><small>Recomendación: cambie su contraseña después del primer ingreso.</small></p>
</body>
</html>
"""

    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = mail_from
    msg["To"] = destinatario

    msg_alt = MIMEMultipart("alternative")
    msg_alt.attach(MIMEText(text_body, "plain", "utf-8"))
    msg_alt.attach(MIMEText(html_body, "html", "utf-8"))
    msg.attach(msg_alt)

    return _send_via_gmail_api(msg)
