import os
from typing import Optional, Tuple

from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

_SALT = "cert-pdf-direct-download-v1"
_DEFAULT_MAX_AGE_SEC = 7 * 24 * 3600


def _secret():
    return os.environ.get("SECRET_KEY", "dev-cambiar-SECRET_KEY-en-produccion")


def crear_token_descarga_pdf(cert_id: str, user_id: int) -> str:
    s = URLSafeTimedSerializer(_secret(), salt=_SALT)
    return s.dumps({"c": cert_id, "u": int(user_id)})


def verificar_token_descarga_pdf(
    token: str, max_age_seconds: Optional[int] = None
) -> Optional[Tuple[str, int]]:
    if max_age_seconds is None:
        max_age_seconds = int(os.environ.get("CERT_DOWNLOAD_TOKEN_MAX_AGE", str(_DEFAULT_MAX_AGE_SEC)))
    s = URLSafeTimedSerializer(_secret(), salt=_SALT)
    try:
        data = s.loads(token, max_age=max_age_seconds)
        return str(data["c"]), int(data["u"])
    except (BadSignature, SignatureExpired, KeyError, TypeError, ValueError):
        return None
