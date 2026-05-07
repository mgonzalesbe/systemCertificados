import sys
import os
import re
import base64
from functools import wraps

from io import BytesIO

from dotenv import load_dotenv

# Cargar variables de entorno desde .env si existe
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from flask import (
    Flask,
    request,
    jsonify,
    render_template,
    session,
    redirect,
    url_for,
    send_file,
    abort,
)

ruta_raiz = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.append(ruta_raiz)

from modelo import certificado
from modelo.database import init_db, get_db_connection
from modelo import auth_usuarios
from modelo.image_transparency import strip_uniform_background_to_png
from modelo.email_certificado import enviar_correo_credenciales_registro, correo_habilitado
from modelo.pdf_qr_extract import extract_first_qr_payload_from_pdf

app = Flask(__name__,
            template_folder='../vista/IU',
            static_folder='../vista/assets',
            static_url_path='/assets')

app.secret_key = os.environ.get('SECRET_KEY', 'dev-cambiar-SECRET_KEY-en-produccion')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

CERT_ID_RE = re.compile(
    r'^UCV-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
)


def login_required_api(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        if not session.get('user_id'):
            return jsonify({'error': 'Debe iniciar sesión'}), 401
        return f(*args, **kwargs)
    return wrapped


def admin_required_api(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        if session.get('role') != auth_usuarios.ROLE_ADMIN:
            return jsonify({'error': 'Solo administradores'}), 403
        return f(*args, **kwargs)
    return wrapped


def student_required_api(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        if session.get('role') != auth_usuarios.ROLE_STUDENT:
            return jsonify({'error': 'Solo estudiantes'}), 403
        return f(*args, **kwargs)
    return wrapped


@app.route('/')
def index():
    if session.get('user_id'):
        if session.get('role') == auth_usuarios.ROLE_ADMIN:
            return redirect(url_for('admin_panel'))
        return redirect(url_for('alumno_panel'))
    return render_template('login.html')


@app.route('/verificar')
def verificar_publico():
    """Verificación por PDF sin sesión (página pública)."""
    return render_template('verificar_publico.html')


@app.route('/app/admin')
def admin_panel():
    if not session.get('user_id'):
        return redirect(url_for('index'))
    if session.get('role') != auth_usuarios.ROLE_ADMIN:
        return redirect(url_for('index'))
    return render_template('admin_dashboard.html', username=session.get('username'))


@app.route('/app/alumno')
def alumno_panel():
    if not session.get('user_id'):
        return redirect(url_for('index'))
    if session.get('role') != auth_usuarios.ROLE_STUDENT:
        return redirect(url_for('index'))
    return render_template('alumno_dashboard.html', username=session.get('username'))


# --- Autenticación ---

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    datos = request.get_json(silent=True) or {}
    user = datos.get('username', '').strip()
    password = datos.get('password', '')
    u = auth_usuarios.autenticar(user, password)
    if not u:
        return jsonify({'success': False, 'error': 'Usuario o contraseña incorrectos'}), 401
    session['user_id'] = u['id']
    session['username'] = u['username']
    session['role'] = u['role']
    return jsonify({'success': True, 'user': {'username': u['username'], 'role': u['role']}})


@app.route('/api/auth/register', methods=['POST'])
def auth_register():
    datos = request.get_json(silent=True) or {}
    username = (datos.get('username') or '').strip()
    email = (datos.get('email') or '').strip()
    password = datos.get('password') or ''
    try:
        auth_usuarios.crear_usuario(
            username,
            email,
            password,
            auth_usuarios.ROLE_STUDENT,
            documento_identidad=datos.get('documento_identidad'),
            nombres=datos.get('nombres'),
            apellidos=datos.get('apellidos'),
        )
    except ValueError as e:
        msg = str(e)
        ml = msg.lower()
        field_errors = {}
        if 'documento de identidad' in ml or (
            'documento' in ml and 'identidad' in ml
        ):
            field_errors['reg-doc'] = msg
        elif 'correo electrónico' in ml or 'este correo' in ml:
            field_errors['reg-email'] = msg
        elif 'nombre de usuario' in ml:
            field_errors['reg-user'] = msg
        elif 'dni debe' in ml or '8 dígitos' in ml:
            field_errors['reg-doc'] = msg
        elif ('correo electrónico inválido' in ml) or (
            'inválido' in ml and 'correo' in ml
        ):
            field_errors['reg-email'] = msg
        elif 'usuario debe tener' in ml:
            field_errors['reg-user'] = msg
        elif 'contraseña' in ml:
            field_errors['reg-pass'] = msg
        return jsonify({
            'success': False,
            'error': msg,
            'fieldErrors': field_errors,
        }), 400
    except RuntimeError as e:
        return jsonify({'success': False, 'error': str(e)}), 503
    mail_sent = False
    if correo_habilitado():
        mail_sent = enviar_correo_credenciales_registro(
            destinatario=email,
            username=username,
            password=password,
            rol=auth_usuarios.ROLE_STUDENT,
            portal_url=request.url_root,
        )
    return jsonify({
        'success': True,
        'message': 'Registro exitoso. Ya puede iniciar sesión.',
        'mailSent': mail_sent,
    })


@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    session.clear()
    return jsonify({'success': True})


@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    if not session.get('user_id'):
        return jsonify({'authenticated': False})
    return jsonify({
        'authenticated': True,
        'username': session.get('username'),
        'role': session.get('role'),
    })


# --- Administración: usuarios ---

@app.route('/api/admin/users', methods=['POST'])
@login_required_api
@admin_required_api
def admin_create_user():
    datos = request.get_json(silent=True) or {}
    username = (datos.get('username') or '').strip()
    email = (datos.get('email') or '').strip()
    password = datos.get('password') or ''
    try:
        auth_usuarios.crear_usuario(
            username,
            email,
            password,
            auth_usuarios.ROLE_ADMIN,
            documento_identidad=None,
        )
    except ValueError as e:
        return jsonify({'success': False, 'error': str(e)}), 400
    except RuntimeError as e:
        return jsonify({'success': False, 'error': str(e)}), 503
    mail_sent = False
    if correo_habilitado():
        mail_sent = enviar_correo_credenciales_registro(
            destinatario=email,
            username=username,
            password=password,
            rol=auth_usuarios.ROLE_ADMIN,
            portal_url=request.url_root,
        )
    return jsonify({'success': True, 'mailSent': mail_sent})


# --- Certificados (admin) RUTAS API ---

@app.route('/api/generate', methods=['POST'])
@login_required_api
@admin_required_api
def generate_certificate():
    datos = request.get_json(silent=True)
    try:
        certificado.validar_datos_generacion(datos)
    except (ValueError, TypeError) as e:
        return jsonify({"success": False, "error": str(e)}), 400

    try:
        cert_data, tiempo_tgc = certificado.crear_certificado(
            datos,
            created_by_user_id=session.get('user_id'),
        )
    except RuntimeError as e:
        return jsonify({"success": False, "error": str(e)}), 503

    return jsonify({
        "success": True,
        "time": tiempo_tgc,
        "cert": cert_data,
    })


@app.route('/api/list', methods=['GET'])
@login_required_api
@admin_required_api
def list_certificates():
    certs = certificado.obtener_todos_los_certificados()
    return jsonify(certs)


@app.route('/api/students', methods=['GET'])
@login_required_api
@admin_required_api
def list_students():
    query = request.args.get('q', '').strip()
    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        if query:
            # Search by name or DNI
            cursor.execute("""
                SELECT IdUsuario, Nombres, Apellidos, DocumentoIdentidad
                FROM Usuarios
                WHERE Rol = 'student' AND (
                    Nombres LIKE ? OR Apellidos LIKE ? OR DocumentoIdentidad LIKE ?
                )
                ORDER BY Apellidos, Nombres
            """, (f'%{query}%', f'%{query}%', f'%{query}%'))
        else:
            # Return all students
            cursor.execute("""
                SELECT IdUsuario, Nombres, Apellidos, DocumentoIdentidad
                FROM Usuarios
                WHERE Rol = 'student'
                ORDER BY Apellidos, Nombres
            """)
        students = []
        for row in cursor.fetchall():
            full_name = f"{row.Nombres or ''} {row.Apellidos or ''}".strip()
            students.append({
                "id": int(row.IdUsuario),
                "name": full_name,
                "dni": row.DocumentoIdentidad or "",
            })
        return jsonify({"success": True, "students": students})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        conn.close()


# --- Administración: catálogos (Cursos, TiposCredencial) ---

@app.route('/api/admin/courses', methods=['GET'])
@login_required_api
@admin_required_api
def admin_list_courses():
    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT IdCurso, Nombre, Activo
            FROM Cursos
            ORDER BY Nombre ASC
            """
        )
        courses = []
        for row in cursor.fetchall():
            courses.append({
                "id": int(row.IdCurso),
                "name": row.Nombre,
                "active": bool(row.Activo),
            })
        return jsonify({"success": True, "courses": courses})
    finally:
        conn.close()


@app.route('/api/admin/courses', methods=['POST'])
@login_required_api
@admin_required_api
def admin_create_course():
    datos = request.get_json(silent=True) or {}
    name = (datos.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "El nombre del curso es obligatorio"}), 400
    if len(name) > 200:
        return jsonify({"success": False, "error": "El nombre del curso es demasiado largo"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO Cursos (Nombre, Activo)
            VALUES (?, 1)
            """,
            (name,),
        )
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400
    finally:
        conn.close()


@app.route('/api/admin/courses/<int:course_id>/active', methods=['PATCH'])
@login_required_api
@admin_required_api
def admin_update_course_active(course_id: int):
    datos = request.get_json(silent=True) or {}
    active = datos.get("active")
    if not isinstance(active, bool):
        return jsonify({"success": False, "error": "El campo 'active' debe ser booleano"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE Cursos
            SET Activo = ?
            WHERE IdCurso = ?
            """,
            (1 if active else 0, course_id),
        )
        if cursor.rowcount == 0:
            conn.rollback()
            return jsonify({"success": False, "error": "Curso no encontrado"}), 404
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 400
    finally:
        conn.close()


@app.route('/api/admin/credential-types', methods=['GET'])
@login_required_api
@admin_required_api
def admin_list_credential_types():
    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT IdTipoCredencial, Nombre, Activo
            FROM TiposCredencial
            ORDER BY Nombre ASC
            """
        )
        types = []
        for row in cursor.fetchall():
            types.append({
                "id": int(row.IdTipoCredencial),
                "name": row.Nombre,
                "active": bool(row.Activo),
            })
        return jsonify({"success": True, "types": types})
    finally:
        conn.close()


@app.route('/api/admin/credential-types/<int:type_id>/active', methods=['PATCH'])
@login_required_api
@admin_required_api
def admin_update_credential_type_active(type_id: int):
    datos = request.get_json(silent=True) or {}
    active = datos.get("active")
    if not isinstance(active, bool):
        return jsonify({"success": False, "error": "El campo 'active' debe ser booleano"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE TiposCredencial
            SET Activo = ?
            WHERE IdTipoCredencial = ?
            """,
            (1 if active else 0, type_id),
        )
        if cursor.rowcount == 0:
            conn.rollback()
            return jsonify({"success": False, "error": "Tipo de credencial no encontrado"}), 404
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 400
    finally:
        conn.close()


@app.route('/api/admin/credential-types', methods=['POST'])
@login_required_api
@admin_required_api
def admin_create_credential_type():
    datos = request.get_json(silent=True) or {}
    name = (datos.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "El nombre es obligatorio"}), 400
    if len(name) > 200:
        return jsonify({"success": False, "error": "El nombre no puede superar 200 caracteres"}), 400

    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO TiposCredencial (Nombre, Activo)
            VALUES (?, 1)
            """,
            (name,),
        )
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400
    finally:
        conn.close()


@app.route("/api/admin/body-text-presets", methods=["GET"])
@login_required_api
@admin_required_api
def admin_list_body_text_presets():
    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT IdTextoCuerpo, Nombre, Texto, Activo
            FROM TextosCuerpoCertificado
            ORDER BY Nombre ASC
            """
        )
        rows = []
        for row in cursor.fetchall():
            rows.append({
                "id": int(row.IdTextoCuerpo),
                "name": row.Nombre,
                "text": row.Texto or "",
                "active": bool(getattr(row, "Activo", 1)),
            })
        return jsonify({"success": True, "presets": rows})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400
    finally:
        conn.close()


@app.route("/api/admin/body-text-presets", methods=["POST"])
@login_required_api
@admin_required_api
def admin_create_body_text_preset():
    datos = request.get_json(silent=True) or {}
    name = (datos.get("name") or "").strip()
    text = (datos.get("text") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "El nombre es obligatorio"}), 400
    if not text:
        return jsonify({"success": False, "error": "El texto es obligatorio"}), 400
    if len(name) > 200:
        return jsonify({"success": False, "error": "El nombre no puede superar 200 caracteres"}), 400
    if len(text) > 4000:
        return jsonify({"success": False, "error": "El texto no puede superar 4000 caracteres"}), 400
    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO TextosCuerpoCertificado (Nombre, Texto, Activo)
            VALUES (?, ?, 1)
            """,
            (name, text),
        )
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 400
    finally:
        conn.close()


@app.route("/api/admin/body-text-presets/<int:preset_id>/active", methods=["PATCH"])
@login_required_api
@admin_required_api
def admin_patch_body_text_preset_active(preset_id: int):
    datos = request.get_json(silent=True) or {}
    if "active" not in datos:
        return jsonify({"success": False, "error": "Indique active (true/false)"}), 400
    active = bool(datos.get("active"))
    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE TextosCuerpoCertificado SET Activo = ? WHERE IdTextoCuerpo = ?
            """,
            (1 if active else 0, preset_id),
        )
        if cursor.rowcount == 0:
            conn.rollback()
            return jsonify({"success": False, "error": "Texto guardado no encontrado"}), 404
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 400
    finally:
        conn.close()


@app.route('/api/admin/centros-educativos', methods=['GET'])
@login_required_api
@admin_required_api
def admin_list_centros_educativos():
    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT IdCentroEducativo, Nombre, Estado,
                   CASE WHEN LogoDerecho IS NOT NULL AND DATALENGTH(LogoDerecho) > 0 THEN 1 ELSE 0 END AS HasLogoDerecho
            FROM CentroEducativo
            ORDER BY Nombre ASC
            """
        )
        rows = []
        for row in cursor.fetchall():
            rows.append({
                "id": int(row.IdCentroEducativo),
                "name": row.Nombre,
                "active": (row.Estado or "").strip().lower() == "activo",
                "hasLogoDerecho": bool(getattr(row, "HasLogoDerecho", 0)),
            })
        return jsonify({"success": True, "centers": rows})
    finally:
        conn.close()


@app.route('/api/admin/centros-educativos', methods=['POST'])
@login_required_api
@admin_required_api
def admin_create_centro_educativo():
    datos = request.get_json(silent=True) or {}
    name = (datos.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "El nombre del centro es obligatorio"}), 400
    if len(name) > 200:
        return jsonify({"success": False, "error": "El nombre no puede superar 200 caracteres"}), 400
    estado = (datos.get("estado") or "Activo").strip()
    if estado not in ("Activo", "Inactivo"):
        return jsonify({"success": False, "error": "Estado debe ser Activo o Inactivo"}), 400
    logo_derecho_bin = None
    b64d = datos.get("logo_derecho_base64")
    if b64d:
        try:
            raw_d = base64.b64decode(str(b64d).strip())
        except Exception:
            return jsonify({"success": False, "error": "logo_derecho_base64 no es Base64 válido"}), 400
        if len(raw_d) > 5 * 1024 * 1024:
            return jsonify({"success": False, "error": "El logo derecho no puede superar 5 MB"}), 400
        try:
            logo_derecho_bin = strip_uniform_background_to_png(raw_d)
        except Exception:
            logo_derecho_bin = raw_d

    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO CentroEducativo (LogoDerecho, Nombre, Estado)
            VALUES (?, ?, ?)
            """,
            (logo_derecho_bin, name, estado),
        )
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400
    finally:
        conn.close()


@app.route('/api/admin/centros-educativos/<int:centro_id>/active', methods=['PATCH'])
@login_required_api
@admin_required_api
def admin_update_centro_educativo_active(centro_id: int):
    datos = request.get_json(silent=True) or {}
    active = datos.get("active")
    if not isinstance(active, bool):
        return jsonify({"success": False, "error": "El campo 'active' debe ser booleano"}), 400
    nuevo_estado = "Activo" if active else "Inactivo"

    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE CentroEducativo
            SET Estado = ?
            WHERE IdCentroEducativo = ?
            """,
            (nuevo_estado, centro_id),
        )
        if cursor.rowcount == 0:
            conn.rollback()
            return jsonify({"success": False, "error": "Centro educativo no encontrado"}), 404
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 400
    finally:
        conn.close()


@app.route('/api/admin/firma-doctores', methods=['GET'])
@login_required_api
@admin_required_api
def admin_list_firma_doctores():
    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT IdFirmaDoctores, Nombres, Genero, Estado,
                   CASE WHEN Firma IS NOT NULL AND DATALENGTH(Firma) > 0 THEN 1 ELSE 0 END AS HasFirma
            FROM FirmaDoctores
            ORDER BY Nombres ASC
            """
        )
        rows = []
        for row in cursor.fetchall():
            rows.append({
                "id": int(row.IdFirmaDoctores),
                "nombres": row.Nombres,
                "genero": row.Genero,
                "active": (row.Estado or "").strip().lower() == "activo",
                "hasFirma": bool(getattr(row, "HasFirma", 0)),
            })
        return jsonify({"success": True, "doctors": rows})
    finally:
        conn.close()


@app.route('/api/admin/firma-doctores', methods=['POST'])
@login_required_api
@admin_required_api
def admin_create_firma_doctor():
    datos = request.get_json(silent=True) or {}
    nombres = (datos.get("nombres") or "").strip()
    if not nombres:
        return jsonify({"success": False, "error": "El nombre del director es obligatorio"}), 400
    if len(nombres) > 200:
        return jsonify({"success": False, "error": "El nombre no puede superar 200 caracteres"}), 400
    genero = (datos.get("genero") or "").strip()
    if genero not in ("Masculino", "Femenino"):
        return jsonify({"success": False, "error": "Género debe ser Masculino o Femenino"}), 400
    estado = (datos.get("estado") or "Activo").strip()
    if estado not in ("Activo", "Inactivo"):
        return jsonify({"success": False, "error": "Estado debe ser Activo o Inactivo"}), 400
    firma_bin = None
    b64 = datos.get("firma_base64")
    if b64:
        try:
            raw = base64.b64decode(str(b64).strip())
        except Exception:
            return jsonify({"success": False, "error": "firma_base64 no es Base64 válido"}), 400
        if len(raw) > 5 * 1024 * 1024:
            return jsonify({"success": False, "error": "La imagen de firma no puede superar 5 MB"}), 400
        try:
            firma_bin = strip_uniform_background_to_png(raw)
        except Exception:
            firma_bin = raw

    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO FirmaDoctores (Firma, Estado, Nombres, Genero)
            VALUES (?, ?, ?, ?)
            """,
            (firma_bin, estado, nombres, genero),
        )
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 400
    finally:
        conn.close()


@app.route('/api/admin/firma-doctores/<int:doctor_id>/active', methods=['PATCH'])
@login_required_api
@admin_required_api
def admin_update_firma_doctor_active(doctor_id: int):
    datos = request.get_json(silent=True) or {}
    active = datos.get("active")
    if not isinstance(active, bool):
        return jsonify({"success": False, "error": "El campo 'active' debe ser booleano"}), 400
    nuevo_estado = "Activo" if active else "Inactivo"

    conn = get_db_connection()
    if not conn:
        return jsonify({"success": False, "error": "Base de datos no disponible"}), 503
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE FirmaDoctores
            SET Estado = ?
            WHERE IdFirmaDoctores = ?
            """,
            (nuevo_estado, doctor_id),
        )
        if cursor.rowcount == 0:
            conn.rollback()
            return jsonify({"success": False, "error": "Registro no encontrado"}), 404
        conn.commit()
        return jsonify({"success": True})
    except Exception as e:
        conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 400
    finally:
        conn.close()


@app.route('/api/toggle', methods=['POST'])
@login_required_api
@admin_required_api
def toggle_status():
    datos = request.get_json(silent=True)
    if datos is None:
        return jsonify({"success": False, "error": "Se requiere un cuerpo JSON válido"}), 400

    cert_id = datos.get('id')
    if not isinstance(cert_id, str) or not cert_id.strip():
        return jsonify({"success": False, "error": "Falta un identificador de certificado válido"}), 400

    cert_id = cert_id.strip()
    if len(cert_id) > 50:
        return jsonify({"success": False, "error": "Identificador demasiado largo"}), 400

    exito = certificado.cambiar_estado_certificado(cert_id, session.get('user_id'))
    if not exito:
        return jsonify({
            "success": False,
            "error": "No se pudo actualizar el estado (certificado inexistente o base de datos inactiva)"
        }), 503

    return jsonify({"success": True})


@app.route('/api/stats', methods=['GET'])
@login_required_api
@admin_required_api
def get_stats():
    estadisticas = certificado.obtener_estadisticas()
    return jsonify(estadisticas)


@app.route('/api/dashboard/insights', methods=['GET'])
@login_required_api
@admin_required_api
def get_dashboard_insights():
    return jsonify(certificado.obtener_dashboard_insights())


@app.route('/api/dashboard/export-excel', methods=['GET'])
@login_required_api
@admin_required_api
def dashboard_export_excel():
    from datetime import datetime, timezone

    from modelo.dashboard_excel_export import build_dashboard_excel_bytes

    raw = build_dashboard_excel_bytes()
    if not raw:
        return jsonify({"success": False, "error": "No se pudo generar el archivo"}), 503
    buf = BytesIO(raw)
    buf.seek(0)
    fn = f"panel_certificados_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.xlsx"
    return send_file(
        buf,
        as_attachment=True,
        download_name=fn,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


# --- Verificación pública (cámara o datos) ---

@app.route('/api/verify', methods=['POST'])
def verify_certificate():
    datos = request.get_json(silent=True)
    if datos is None:
        return jsonify({"error": "Se requiere un cuerpo JSON válido", "isValid": False}), 400

    qr_payload = datos.get('qrPayload', '')
    if not isinstance(qr_payload, str):
        qr_payload = ''

    is_valid, tiempo_tv, parsed_data = certificado.verificar_certificado(qr_payload)

    return jsonify({
        "isValid": is_valid,
        "time": tiempo_tv,
        "data": parsed_data
    })


@app.route('/api/verify-pdf', methods=['POST'])
def verify_pdf_upload():
    if 'file' not in request.files:
        return jsonify({"isValid": False, "error": "No se envió ningún archivo (campo=file)"}), 400
    f = request.files['file']
    if not f.filename:
        return jsonify({"isValid": False, "error": "Nombre de archivo vacío"}), 400
    raw = f.read()
    if len(raw) > 15 * 1024 * 1024:
        return jsonify({"isValid": False, "error": "El PDF es demasiado grande (máx. 15 MB)"}), 400

    payload = extract_first_qr_payload_from_pdf(raw)
    if not payload:
        return jsonify({
            "isValid": False,
            "error": "No se encontró un código QR legible en el PDF. Pruebe con mejor calidad o otra página.",
            "time": 0,
            "data": {},
        }), 200

    is_valid, tiempo_tv, parsed_data = certificado.verificar_certificado(payload, pdf_bytes=raw)
    return jsonify({
        "isValid": is_valid,
        "time": tiempo_tv,
        "data": parsed_data,
    })


# --- Alumno ---

@app.route('/api/my/certificates', methods=['GET'])
@login_required_api
@student_required_api
def my_certificates():
    rows = certificado.obtener_certificados_por_alumno(session['user_id'])
    return jsonify(rows)


@app.route('/api/certificates/<cert_id>/pdf/by-token', methods=['GET'])
def download_certificate_pdf_by_token(cert_id):
    """Descarga con token firmado (correo de asignación); no requiere sesión."""
    if not CERT_ID_RE.match(cert_id):
        abort(404)
    token = (request.args.get('token') or '').strip()
    if not token:
        return jsonify({'error': 'Falta el parámetro token'}), 400
    from modelo.pdf_download_token import verificar_token_descarga_pdf

    parsed = verificar_token_descarga_pdf(token)
    if not parsed:
        return jsonify({'error': 'Enlace inválido o vencido'}), 403
    t_cert_id, user_id = parsed
    if t_cert_id != cert_id:
        return jsonify({'error': 'El token no corresponde a este certificado'}), 403
    ok, pdf_data = certificado.usuario_puede_descargar_pdf(
        cert_id, user_id, auth_usuarios.ROLE_STUDENT
    )
    if not ok or not pdf_data:
        return jsonify({'error': 'No tiene permiso o el PDF no está disponible'}), 403
    return send_file(
        BytesIO(pdf_data),
        as_attachment=True,
        download_name=f'certificado_{cert_id}.pdf',
        mimetype='application/pdf',
    )


@app.route('/api/certificates/<cert_id>/pdf')
@login_required_api
def download_certificate_pdf(cert_id):
    if not CERT_ID_RE.match(cert_id):
        abort(404)
    ok, pdf_data = certificado.usuario_puede_descargar_pdf(
        cert_id, session['user_id'], session['role']
    )
    if not ok or not pdf_data:
        return jsonify({'error': 'No tiene permiso o el PDF no existe'}), 403
    return send_file(
        BytesIO(pdf_data),
        as_attachment=True,
        download_name=f'certificado_{cert_id}.pdf',
        mimetype='application/pdf',
    )


@app.route('/api/certificates', methods=['GET'])
@login_required_api
@admin_required_api
def api_certificates():
    q = request.args.get('q', '').strip() or None
    try:
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 5))
        if page < 1: page = 1
        if page_size < 1: page_size = 5
    except Exception:
        page, page_size = 1, 5
    certs, total, db_ok = certificado.buscar_certificados(q, page, page_size)
    total_pages = (total + page_size - 1) // page_size if page_size else 1
    if not db_ok:
        return jsonify({
            "success": False,
            "error": "No se pudo conectar con la base de datos. Suele ocurrir tras un periodo de inactividad (servidor o SQL en frío). Pulse Reintentar o espere unos segundos.",
            "certificates": [],
            "total": 0,
            "page": page,
            "page_size": page_size,
            "total_pages": 1,
            "dbAvailable": False,
        }), 503
    return jsonify({
        "success": True,
        "certificates": certs,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
        "dbAvailable": True,
    })


if __name__ == '__main__':
    init_db()
    auth_usuarios.asegurar_admin_por_defecto()
    certificado.init_stats_from_db()

    _debug = os.environ.get('FLASK_DEBUG', 'false').lower() in ('1', 'true', 'yes', 'y')
    _port = int(os.environ.get('PORT', '5000'))
    _host = os.environ.get('FLASK_HOST', '0.0.0.0')

    print("\n" + "=" * 60)
    print("SISTEMA DE CERTIFICADOS -- panel admin / alumno")
    print(f"http://127.0.0.1:{_port}")
    print("   Usuario inicial: admin  (defina ADMIN_DEFAULT_PASSWORD o use Admin123!)")
    print("=" * 60 + "\n")

    app.run(debug=_debug, port=_port, host=_host)
