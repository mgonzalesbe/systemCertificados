import os
import re
from werkzeug.security import generate_password_hash, check_password_hash

from Persistencia.database import get_db_connection, ensure_usuarios_practica_columns

ROLE_ADMIN = "admin"
ROLE_STUDENT = "student"

_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", re.I)
_DOC_RE = re.compile(r"^[0-9A-Za-z]{8,20}$")


def validar_email(email):
    return bool(email and _EMAIL_RE.match(email.strip()))


def normalizar_documento(texto):
    """Solo dígitos y letras, sin espacios ni guiones (DNI, CE, etc.)."""
    if not texto:
        return ""
    return re.sub(r"[^0-9A-Za-z]", "", str(texto).strip()).upper()


def validar_documento_estudiante(doc_norm):
    # Para estudiantes, DNI debe ser exactamente 8 dígitos numéricos
    if not re.match(r'^[0-9]{8}$', doc_norm):
        return False
    return True


def crear_usuario(
    username,
    email,
    password,
    role,
    documento_identidad=None,
    nombres=None,
    apellidos=None,
    universidad=None,
    area=None,
):
    ensure_usuarios_practica_columns()
    if role not in (ROLE_ADMIN, ROLE_STUDENT):
        raise ValueError("Rol inválido")
    username = (username or "").strip()
    email = (email or "").strip().lower()
    nombres = (nombres or "").strip()
    apellidos = (apellidos or "").strip()
    universidad = (universidad or "").strip()
    area = (area or "").strip()
    if len(username) < 3 or len(username) > 80:
        raise ValueError("El usuario debe tener entre 3 y 80 caracteres")
    if not validar_email(email):
        raise ValueError("Correo electrónico inválido")
    if not password or len(password) < 6:
        raise ValueError("La contraseña debe tener al menos 6 caracteres")

    doc_db = None
    if role == ROLE_STUDENT:
        doc_norm = normalizar_documento(documento_identidad)
        if not validar_documento_estudiante(doc_norm):
            raise ValueError(
                "DNI debe ser exactamente 8 dígitos numéricos."
            )
        doc_db = doc_norm
        if not universidad:
            raise ValueError("La universidad es obligatoria")
        if not area:
            raise ValueError("El área de prácticas es obligatoria")
        if len(universidad) > 200:
            raise ValueError("La universidad no debe superar 200 caracteres")
        if len(area) > 150:
            raise ValueError("El área no debe superar 150 caracteres")

    ph = generate_password_hash(password)
    conn = get_db_connection()
    if not conn:
        raise RuntimeError("Base de datos no disponible")
    try:
        cursor = conn.cursor()
        if role == ROLE_STUDENT and doc_db:
            cursor.execute(
                """
                SELECT 1 FROM Usuarios
                WHERE DocumentoIdentidad = ? AND Rol = ?
                """,
                (doc_db, ROLE_STUDENT),
            )
            if cursor.fetchone():
                raise ValueError("Ya existe una cuenta con este documento de identidad")
        cursor.execute(
            "SELECT 1 FROM Usuarios WHERE LOWER(LTRIM(RTRIM(Correo))) = LOWER(?)",
            (email,),
        )
        if cursor.fetchone():
            raise ValueError("Ya existe un usuario con este correo electrónico")
        cursor.execute(
            "SELECT 1 FROM Usuarios WHERE LOWER(LTRIM(RTRIM(NombreUsuario))) = LOWER(?)",
            (username,),
        )
        if cursor.fetchone():
            raise ValueError("Ya existe un usuario con este nombre de usuario")

        cursor.execute(
            """
            INSERT INTO Usuarios (
                NombreUsuario, Correo, HashContrasena, Rol, DocumentoIdentidad,
                Nombres, Apellidos, Universidad, Area
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                username,
                email,
                ph,
                role,
                doc_db,
                nombres or None,
                apellidos or None,
                universidad or None,
                area or None,
            ),
        )
        conn.commit()
        return True
    except ValueError:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        msg = str(e).lower()
        if "unique" in msg or "duplicate" in msg:
            if "documento" in msg or "documentoidentidad" in msg:
                raise ValueError("Ya existe una cuenta con este documento de identidad") from e
            if "correo" in msg or "email" in msg:
                raise ValueError("Ya existe un usuario con este correo electrónico") from e
            raise ValueError("Ya existe un usuario con este nombre de usuario") from e
        raise RuntimeError("No se pudo registrar el usuario") from e
    finally:
        conn.close()


def autenticar(username_or_email, password):
    u = (username_or_email or "").strip()
    if not u or not password:
        return None
    doc_norm = normalizar_documento(u)
    conn = get_db_connection()
    if not conn:
        return None
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT IdUsuario, NombreUsuario, Correo, HashContrasena, Rol, Nombres, Apellidos FROM Usuarios
            WHERE LOWER(LTRIM(RTRIM(NombreUsuario))) = LOWER(?)
               OR LOWER(LTRIM(RTRIM(Correo))) = LOWER(?)
               OR DocumentoIdentidad = ?
            """,
            (u, u, doc_norm),
        )
        row = cursor.fetchone()
        if not row:
            return None
        if not check_password_hash(row.HashContrasena, password):
            return None
        return {
            "id": int(row.IdUsuario),
            "username": row.NombreUsuario,
            "email": row.Correo,
            "role": row.Rol,
            "nombres": row.Nombres,
            "apellidos": row.Apellidos,
        }
    finally:
        conn.close()


def obtener_usuario_por_id(user_id):
    conn = get_db_connection()
    if not conn:
        return None
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT IdUsuario, NombreUsuario, Correo, Rol, Nombres, Apellidos FROM Usuarios WHERE IdUsuario = ?",
            (user_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "id": int(row.IdUsuario),
            "username": row.NombreUsuario,
            "email": row.Correo,
            "role": row.Rol,
            "nombres": row.Nombres,
            "apellidos": row.Apellidos,
        }
    finally:
        conn.close()


def resolver_destinatario_por_email(email):
    email = (email or "").strip().lower()
    if not validar_email(email):
        return None
    conn = get_db_connection()
    if not conn:
        return None
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT IdUsuario FROM Usuarios WHERE Correo = ? AND Rol = ?",
            (email, ROLE_STUDENT),
        )
        row = cursor.fetchone()
        return int(row.IdUsuario) if row else None
    finally:
        conn.close()


def asegurar_admin_por_defecto():
    """Si no hay usuarios, crea un administrador inicial (variable ADMIN_DEFAULT_PASSWORD)."""
    conn = get_db_connection()
    if not conn:
        return
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM Usuarios")
        n = int(cursor.fetchone()[0])
        if n > 0:
            return
        pwd = os.environ.get("ADMIN_DEFAULT_PASSWORD", "Admin123!")
        ph = generate_password_hash(pwd)
        cursor.execute(
            """
            INSERT INTO Usuarios (NombreUsuario, Correo, HashContrasena, Rol, DocumentoIdentidad)
            VALUES (?, ?, ?, ?, NULL)
            """,
            ("admin", "admin@local.dev", ph, ROLE_ADMIN),
        )
        conn.commit()
        print("Usuario administrador inicial: usuario «admin», revise ADMIN_DEFAULT_PASSWORD.")
    except Exception as e:
        print(f"No se pudo crear administrador por defecto: {e}")
    finally:
        conn.close()
