import os
import time
from types import SimpleNamespace

import pyodbc
import pymssql

# ==========================================================================
# CONFIGURACIÓN DE BASE DE DATOS (SQL Server)
# ==========================================================================
_DRIVER = os.environ.get("DB_DRIVER", "ODBC Driver 17 for SQL Server")
_SERVER = os.environ.get("DB_SERVER", "servidor-martin.database.windows.net")
_DATABASE = os.environ.get("DB_NAME", "CertificadosDB")
_PORT = os.environ.get("DB_PORT", "1433")
_TRUSTED = os.environ.get("DB_TRUSTED", "no").lower() in ("1", "true", "yes", "y")
_ENCRYPT = os.environ.get("DB_ENCRYPT", "yes").lower() in ("1", "true", "yes", "y")
_TRUST_SERVER_CERT = os.environ.get("DB_TRUST_SERVER_CERTIFICATE", "no").lower() in ("1", "true", "yes", "y")
_CONNECTION_TIMEOUT = int(os.environ.get("DB_CONNECTION_TIMEOUT", "30"))
_CONNECT_RETRIES = max(1, int(os.environ.get("DB_CONNECT_RETRIES", "5")))
_CONNECT_RETRY_DELAY = float(os.environ.get("DB_CONNECT_RETRY_DELAY_SEC", "0.6"))


def _build_connection_string():
    parts = [
        f"DRIVER={{{_DRIVER}}};",
        f"SERVER={_SERVER},{_PORT};",
        f"DATABASE={_DATABASE};",
        f"Encrypt={'yes' if _ENCRYPT else 'no'};",
        f"TrustServerCertificate={'yes' if _TRUST_SERVER_CERT else 'no'};",
        f"Connection Timeout={_CONNECTION_TIMEOUT};",
    ]
    if _TRUSTED:
        parts.append("Trusted_Connection=yes;")
    else:
        user = os.environ.get("DB_USER", "")
        pwd = os.environ.get("DB_PASSWORD", "")
        parts.append(f"UID={user};PWD={pwd};")
    return "".join(parts)


DB_CONNECTION_STRING = _build_connection_string()


class _AttrRow(SimpleNamespace):
    """Fila compatible con acceso por atributo y por índice (row[0])."""

    def __getitem__(self, idx):
        values = list(self.__dict__.values())
        return values[idx]


def _adapt_params_for_pymssql(query, params):
    if params is None:
        return query, ()
    if isinstance(params, tuple):
        values = params
    elif isinstance(params, list):
        values = tuple(params)
    else:
        values = (params,)
    return query.replace("?", "%s"), values


class _PymssqlCursorAdapter:
    def __init__(self, raw_cursor):
        self._raw = raw_cursor
        self._last_columns = []

    @property
    def rowcount(self):
        return self._raw.rowcount

    def execute(self, query, params=None):
        q, p = _adapt_params_for_pymssql(query, params)
        self._raw.execute(q, p)
        self._last_columns = [col[0] for col in (self._raw.description or [])]
        return self

    def fetchone(self):
        row = self._raw.fetchone()
        if row is None:
            return None
        return self._to_row(row)

    def fetchall(self):
        rows = self._raw.fetchall()
        return [self._to_row(r) for r in rows]

    def _to_row(self, row):
        if isinstance(row, dict):
            return _AttrRow(**row)
        if not self._last_columns:
            return row
        data = {self._last_columns[i]: row[i] for i in range(min(len(row), len(self._last_columns)))}
        return _AttrRow(**data)

    def __getattr__(self, name):
        return getattr(self._raw, name)


class _PymssqlConnectionAdapter:
    def __init__(self, raw_conn):
        self._raw = raw_conn

    def cursor(self):
        return _PymssqlCursorAdapter(self._raw.cursor())

    def __getattr__(self, name):
        return getattr(self._raw, name)


def _get_db_connection_once():
    """Un intento de conexión (pyodbc, luego pymssql si aplica)."""
    try:
        conn = pyodbc.connect(DB_CONNECTION_STRING)
        return conn
    except Exception as e:
        err = str(e)
        if "Can't open lib" in err or "SQLDriverConnect" in err:
            try:
                # Fallback útil para Render cuando no está instalado msodbcsql18.
                conn = pymssql.connect(
                    server=_SERVER,
                    user=os.environ.get("DB_USER", ""),
                    password=os.environ.get("DB_PASSWORD", ""),
                    database=_DATABASE,
                    port=int(_PORT),
                    login_timeout=_CONNECTION_TIMEOUT,
                    timeout=_CONNECTION_TIMEOUT,
                )
                print("Conexión SQL Server establecida con fallback pymssql.")
                return _PymssqlConnectionAdapter(conn)
            except Exception as e2:
                print(f"ADVERTENCIA: Falló pyodbc y también pymssql. Error pyodbc: {e}; error pymssql: {e2}")
                return None
        print(f"ADVERTENCIA: No se pudo conectar a SQL Server. Error: {e}")
        return None


def get_db_connection():
    """
    Conexión a SQL Server con reintentos (Azure / Render: arranque en frío, firewall, pausa serverless).

    Variables opcionales: DB_CONNECT_RETRIES (default 5), DB_CONNECT_RETRY_DELAY_SEC (default 0.6).
    """
    for attempt in range(_CONNECT_RETRIES):
        conn = _get_db_connection_once()
        if conn:
            if attempt > 0:
                print(f"Conexión SQL establecida tras {attempt + 1} intento(s).")
            return conn
        if attempt < _CONNECT_RETRIES - 1:
            delay = _CONNECT_RETRY_DELAY * (attempt + 1)
            time.sleep(delay)
    print(f"ADVERTENCIA: Sin conexión a SQL tras {_CONNECT_RETRIES} intento(s).")
    return None


def _table_exists(cursor, nombre_tabla: str) -> bool:
    cursor.execute("SELECT 1 FROM sys.tables WHERE name = ?", (nombre_tabla,))
    return cursor.fetchone() is not None


def _column_exists(cursor, nombre_tabla: str, nombre_columna: str) -> bool:
    cursor.execute(
        """
        SELECT 1 FROM sys.columns
        WHERE object_id = OBJECT_ID(?) AND name = ?
        """,
        (nombre_tabla, nombre_columna),
    )
    return cursor.fetchone() is not None


def _rename_if_exists(cursor, tabla: str, columna_ant: str, columna_nueva: str):
    if _column_exists(cursor, tabla, columna_ant) and not _column_exists(cursor, tabla, columna_nueva):
        cursor.execute(f"EXEC sp_rename N'{tabla}.{columna_ant}', N'{columna_nueva}', N'COLUMN'")


def _quote_ident(identifier: str) -> str:
    return f"[{identifier.replace(']', ']]')}]"


def _drop_column_and_dependencies(cursor, tabla: str, columna: str):
    if not _column_exists(cursor, tabla, columna):
        return

    cursor.execute(
        """
        SELECT dc.name
        FROM sys.default_constraints dc
        INNER JOIN sys.columns c
            ON c.default_object_id = dc.object_id
        WHERE dc.parent_object_id = OBJECT_ID(?) AND c.name = ?
        """,
        (tabla, columna),
    )
    for row in cursor.fetchall():
        cursor.execute(
            f"ALTER TABLE {_quote_ident(tabla)} DROP CONSTRAINT {_quote_ident(row.name)}"
        )

    cursor.execute(
        """
        SELECT i.name, i.is_primary_key, i.is_unique_constraint
        FROM sys.indexes i
        INNER JOIN sys.index_columns ic
            ON ic.object_id = i.object_id AND ic.index_id = i.index_id
        INNER JOIN sys.columns c
            ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE i.object_id = OBJECT_ID(?) AND c.name = ?
        """,
        (tabla, columna),
    )
    for row in cursor.fetchall():
        if row.is_primary_key:
            continue
        if row.is_unique_constraint:
            cursor.execute(
                f"ALTER TABLE {_quote_ident(tabla)} DROP CONSTRAINT {_quote_ident(row.name)}"
            )
        else:
            cursor.execute(
                f"DROP INDEX {_quote_ident(row.name)} ON {_quote_ident(tabla)}"
            )

    cursor.execute(
        f"ALTER TABLE {_quote_ident(tabla)} DROP COLUMN {_quote_ident(columna)}"
    )


def _ensure_tipos_credencial(cursor):
    if _table_exists(cursor, "TiposCredencial"):
        if _column_exists(cursor, "TiposCredencial", "OrdenPresentacion"):
            cursor.execute("ALTER TABLE TiposCredencial DROP COLUMN OrdenPresentacion")
        _drop_column_and_dependencies(cursor, "TiposCredencial", "Codigo")
        return
    cursor.execute(
        """
        CREATE TABLE TiposCredencial (
            IdTipoCredencial INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            Nombre NVARCHAR(200) NOT NULL,
            Activo BIT NOT NULL DEFAULT 1
        )
        """
    )


def _ensure_cursos(cursor):
    if _table_exists(cursor, "Cursos"):
        _drop_column_and_dependencies(cursor, "Cursos", "Codigo")
        _drop_column_and_dependencies(cursor, "Cursos", "Descripcion")
        return
    cursor.execute(
        """
        CREATE TABLE Cursos (
            IdCurso INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            Nombre NVARCHAR(200) NOT NULL,
            Activo BIT NOT NULL DEFAULT 1,
            FechaCreacion DATETIME2 NOT NULL DEFAULT SYSDATETIME()
        )
        """
    )


def _migrate_users_to_usuarios(cursor):
    if _table_exists(cursor, "Usuarios") or not _table_exists(cursor, "Users"):
        return
    cursor.execute("EXEC sp_rename N'Users', N'Usuarios'")


def _ensure_usuarios_columns(cursor):
    if not _table_exists(cursor, "Usuarios"):
        return
    _rename_if_exists(cursor, "Usuarios", "Username", "NombreUsuario")
    _rename_if_exists(cursor, "Usuarios", "Email", "Correo")
    _rename_if_exists(cursor, "Usuarios", "PasswordHash", "HashContrasena")
    _rename_if_exists(cursor, "Usuarios", "Role", "Rol")
    _rename_if_exists(cursor, "Usuarios", "Id", "IdUsuario")


def _create_usuarios_fresh(cursor):
    cursor.execute(
        """
        CREATE TABLE Usuarios (
            IdUsuario INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            NombreUsuario NVARCHAR(100) NOT NULL UNIQUE,
            Correo NVARCHAR(200) NOT NULL UNIQUE,
            HashContrasena NVARCHAR(256) NOT NULL,
            Rol NVARCHAR(20) NOT NULL,
            DocumentoIdentidad NVARCHAR(32) NULL,
            Nombres NVARCHAR(100) NULL,
            Apellidos NVARCHAR(100) NULL
        )
        """
    )


def _ensure_usuarios_index(cursor):
    cursor.execute(
        """
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Usuarios_DocumentoIdentidad' AND object_id = OBJECT_ID(N'Usuarios'))
        CREATE UNIQUE NONCLUSTERED INDEX UX_Usuarios_DocumentoIdentidad ON Usuarios(DocumentoIdentidad)
        WHERE DocumentoIdentidad IS NOT NULL
        """
    )


def _ensure_usuarios(cursor):
    if not _table_exists(cursor, "Usuarios"):
        if _table_exists(cursor, "Users"):
            _migrate_users_to_usuarios(cursor)
        else:
            _create_usuarios_fresh(cursor)
    _ensure_usuarios_columns(cursor)
    _ensure_usuarios_index(cursor)


def _migrate_estadisticas_table(cursor):
    if _table_exists(cursor, "EstadisticasAplicacion") or not _table_exists(cursor, "EstadisticasApp"):
        return
    cursor.execute("EXEC sp_rename N'EstadisticasApp', N'EstadisticasAplicacion'")


def _ensure_estadisticas_columns(cursor):
    if not _table_exists(cursor, "EstadisticasAplicacion"):
        return
    _rename_if_exists(cursor, "EstadisticasAplicacion", "Id", "IdEstadistica")
    _rename_if_exists(cursor, "EstadisticasAplicacion", "TotalGenTime", "TiempoTotalGeneracionSeg")
    _rename_if_exists(cursor, "EstadisticasAplicacion", "GenCount", "CantidadGeneraciones")
    _rename_if_exists(cursor, "EstadisticasAplicacion", "TotalVerTime", "TiempoTotalVerificacionSeg")
    _rename_if_exists(cursor, "EstadisticasAplicacion", "VerCount", "CantidadVerificaciones")
    _rename_if_exists(cursor, "EstadisticasAplicacion", "ValidCount", "CantidadValidas")
    _rename_if_exists(cursor, "EstadisticasAplicacion", "InvalidCount", "CantidadInvalidas")
    if not _column_exists(cursor, "EstadisticasAplicacion", "IdUltimoCertificadoGenerado"):
        cursor.execute("ALTER TABLE EstadisticasAplicacion ADD IdUltimoCertificadoGenerado VARCHAR(50) NULL")


def _create_estadisticas_fresh(cursor):
    cursor.execute(
        """
        CREATE TABLE EstadisticasAplicacion (
            IdEstadistica INT NOT NULL PRIMARY KEY DEFAULT 1,
            TiempoTotalGeneracionSeg FLOAT NOT NULL DEFAULT 0,
            CantidadGeneraciones INT NOT NULL DEFAULT 0,
            TiempoTotalVerificacionSeg FLOAT NOT NULL DEFAULT 0,
            CantidadVerificaciones INT NOT NULL DEFAULT 0,
            CantidadValidas INT NOT NULL DEFAULT 0,
            CantidadInvalidas INT NOT NULL DEFAULT 0,
            IdUltimoCertificadoGenerado VARCHAR(50) NULL
        )
        """
    )


def _ensure_estadisticas(cursor):
    if not _table_exists(cursor, "EstadisticasAplicacion"):
        if _table_exists(cursor, "EstadisticasApp"):
            _migrate_estadisticas_table(cursor)
        else:
            _create_estadisticas_fresh(cursor)
    _ensure_estadisticas_columns(cursor)


def _migrate_certificados_columns(cursor):
    if not _table_exists(cursor, "Certificados"):
        return
    _rename_if_exists(cursor, "Certificados", "ID", "IdCertificado")
    _rename_if_exists(cursor, "Certificados", "StudentName", "NombreEstudiante")
    _rename_if_exists(cursor, "Certificados", "IssueDate", "FechaEmision")
    _rename_if_exists(cursor, "Certificados", "SignatureData", "FirmaDigital")
    _rename_if_exists(cursor, "Certificados", "Status", "Estado")
    _rename_if_exists(cursor, "Certificados", "PdfContent", "ContenidoPdf")
    _rename_if_exists(cursor, "Certificados", "RecipientUserId", "IdUsuarioDestinatario")
    _rename_if_exists(cursor, "Certificados", "CreatedByUserId", "IdUsuarioCreador")
    _rename_if_exists(cursor, "Certificados", "BodyText", "TextoCuerpo")
    if not _column_exists(cursor, "Certificados", "IdCurso"):
        cursor.execute("ALTER TABLE Certificados ADD IdCurso INT NULL")
    if not _column_exists(cursor, "Certificados", "IdTipoCredencial"):
        cursor.execute("ALTER TABLE Certificados ADD IdTipoCredencial INT NULL")
    if not _column_exists(cursor, "Certificados", "FechaCreacion"):
        cursor.execute("ALTER TABLE Certificados ADD FechaCreacion DATETIME2 NOT NULL DEFAULT SYSDATETIME()")
    if not _column_exists(cursor, "Certificados", "TiempoGeneracionSeg"):
        cursor.execute("ALTER TABLE Certificados ADD TiempoGeneracionSeg FLOAT NULL")
    if not _column_exists(cursor, "Certificados", "TiempoVerificacionSeg"):
        cursor.execute("ALTER TABLE Certificados ADD TiempoVerificacionSeg FLOAT NULL")
    if not _column_exists(cursor, "Certificados", "EsValido"):
        cursor.execute("ALTER TABLE Certificados ADD EsValido BIT NULL")
    if not _column_exists(cursor, "Certificados", "IdCentroEducativo"):
        cursor.execute("ALTER TABLE Certificados ADD IdCentroEducativo INT NULL")
    if not _column_exists(cursor, "Certificados", "IdFirmaDoctores"):
        cursor.execute("ALTER TABLE Certificados ADD IdFirmaDoctores INT NULL")
    if not _column_exists(cursor, "Certificados", "IdTextoCuerpoCatalogo"):
        cursor.execute("ALTER TABLE Certificados ADD IdTextoCuerpoCatalogo INT NULL")
    if not _column_exists(cursor, "Certificados", "NumeroValidaciones"):
        cursor.execute(
            "ALTER TABLE Certificados ADD NumeroValidaciones INT NOT NULL CONSTRAINT DF_Certificados_NumeroValidaciones DEFAULT 0"
        )
    _drop_horas_formacion_columns(cursor)
    _drop_meses_formacion_columns(cursor)


def _drop_horas_formacion_columns(cursor):
    """Elimina columnas de horas/carga horaria (modelo de certificado actual sin ese dato)."""
    if not _table_exists(cursor, "Certificados"):
        return
    for col in ("HorasFormacion", "TrainingHours"):
        if _column_exists(cursor, "Certificados", col):
            try:
                cursor.execute(f"ALTER TABLE Certificados DROP COLUMN {col}")
            except Exception as e:
                print(f"No se pudo eliminar columna Certificados.{col}: {e}")


def _drop_meses_formacion_columns(cursor):
    """Elimina meses de formación (no se usan en el diploma actual)."""
    if not _table_exists(cursor, "Certificados"):
        return
    for col in ("MesesFormacion", "TrainingMonths"):
        if _column_exists(cursor, "Certificados", col):
            try:
                cursor.execute(f"ALTER TABLE Certificados DROP COLUMN {col}")
            except Exception as e:
                print(f"No se pudo eliminar columna Certificados.{col}: {e}")


def _create_certificados_fresh(cursor):
    cursor.execute(
        """
        CREATE TABLE Certificados (
            IdCertificado VARCHAR(50) NOT NULL PRIMARY KEY,
            NombreEstudiante NVARCHAR(100) NULL,
            IdCurso INT NULL,
            FechaEmision VARCHAR(50) NULL,
            IdTipoCredencial INT NULL,
            FirmaDigital NVARCHAR(MAX) NULL,
            Estado NVARCHAR(20) NULL,
            ContenidoPdf VARBINARY(MAX) NULL,
            IdUsuarioDestinatario INT NULL,
            IdUsuarioCreador INT NULL,
            TextoCuerpo NVARCHAR(MAX) NULL,
            FechaCreacion DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
            TiempoGeneracionSeg FLOAT NULL,
            TiempoVerificacionSeg FLOAT NULL,
            NumeroValidaciones INT NOT NULL DEFAULT 0,
            EsValido BIT NULL,
            IdCentroEducativo INT NULL,
            IdFirmaDoctores INT NULL,
            IdTextoCuerpoCatalogo INT NULL
        )
        """
    )


def _ensure_textos_cuerpo_catalogo(cursor):
    if _table_exists(cursor, "TextosCuerpoCertificado"):
        return
    cursor.execute(
        """
        CREATE TABLE TextosCuerpoCertificado (
            IdTextoCuerpo INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            Nombre NVARCHAR(200) NOT NULL,
            Texto NVARCHAR(MAX) NOT NULL,
            Activo BIT NOT NULL DEFAULT 1
        )
        """
    )


def _ensure_certificados(cursor):
    if not _table_exists(cursor, "Certificados"):
        _create_certificados_fresh(cursor)
    else:
        _migrate_certificados_columns(cursor)
    cursor.execute(
        """
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Certificados_IdUsuarioDestinatario' AND object_id = OBJECT_ID(N'Certificados'))
        CREATE NONCLUSTERED INDEX IX_Certificados_IdUsuarioDestinatario ON Certificados(IdUsuarioDestinatario)
        """
    )
    cursor.execute(
        """
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Certificados_IdCurso' AND object_id = OBJECT_ID(N'Certificados'))
        CREATE NONCLUSTERED INDEX IX_Certificados_IdCurso ON Certificados(IdCurso)
        """
    )
    cursor.execute(
        """
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Certificados_IdTipoCredencial' AND object_id = OBJECT_ID(N'Certificados'))
        CREATE NONCLUSTERED INDEX IX_Certificados_IdTipoCredencial ON Certificados(IdTipoCredencial)
        """
    )
    cursor.execute(
        """
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Certificados_IdCentroEducativo' AND object_id = OBJECT_ID(N'Certificados'))
        CREATE NONCLUSTERED INDEX IX_Certificados_IdCentroEducativo ON Certificados(IdCentroEducativo)
        """
    )
    cursor.execute(
        """
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Certificados_IdFirmaDoctores' AND object_id = OBJECT_ID(N'Certificados'))
        CREATE NONCLUSTERED INDEX IX_Certificados_IdFirmaDoctores ON Certificados(IdFirmaDoctores)
        """
    )


def _migrate_centro_educativo_columns(cursor):
    if not _table_exists(cursor, "CentroEducativo"):
        return
    if not _column_exists(cursor, "CentroEducativo", "LogoDerecho"):
        cursor.execute("ALTER TABLE CentroEducativo ADD LogoDerecho VARBINARY(MAX) NULL")
    if _column_exists(cursor, "CentroEducativo", "Logo"):
        try:
            cursor.execute("ALTER TABLE CentroEducativo DROP COLUMN Logo")
        except Exception as e:
            print(f"No se pudo eliminar columna CentroEducativo.Logo: {e}")


def _ensure_centro_educativo(cursor):
    if not _table_exists(cursor, "CentroEducativo"):
        cursor.execute(
            """
            CREATE TABLE CentroEducativo (
                IdCentroEducativo INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                LogoDerecho VARBINARY(MAX) NULL,
                Nombre NVARCHAR(200) NOT NULL,
                Estado NVARCHAR(20) NOT NULL DEFAULT N'Activo',
                CONSTRAINT CK_CentroEducativo_Estado CHECK (Estado IN (N'Activo', N'Inactivo')),
                CONSTRAINT UX_CentroEducativo_Nombre UNIQUE (Nombre)
            )
            """
        )
    else:
        _migrate_centro_educativo_columns(cursor)


def _ensure_firma_doctores(cursor):
    if _table_exists(cursor, "FirmaDoctores"):
        return
    cursor.execute(
        """
        CREATE TABLE FirmaDoctores (
            IdFirmaDoctores INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            Firma VARBINARY(MAX) NULL,
            Estado NVARCHAR(20) NOT NULL DEFAULT N'Activo',
            Nombres NVARCHAR(200) NOT NULL,
            Genero NVARCHAR(20) NOT NULL,
            CONSTRAINT CK_FirmaDoctores_Estado CHECK (Estado IN (N'Activo', N'Inactivo')),
            CONSTRAINT CK_FirmaDoctores_Genero CHECK (Genero IN (N'Masculino', N'Femenino'))
        )
        """
    )


def _seed_centro_educativo_default(cursor):
    if not _table_exists(cursor, "CentroEducativo"):
        return
    cursor.execute("SELECT COUNT(*) FROM CentroEducativo")
    row = cursor.fetchone()
    n = int(row[0]) if row is not None else 0
    if n > 0:
        return
    cursor.execute(
        """
        INSERT INTO CentroEducativo (Nombre, Estado)
        VALUES (N'Institución predeterminada', N'Activo')
        """
    )


def _drop_inscripciones_legacy(cursor):
    if not _table_exists(cursor, "Inscripciones"):
        return
    cursor.execute(
        """
        SELECT name FROM sys.foreign_keys
        WHERE parent_object_id = OBJECT_ID(N'Inscripciones')
        """
    )
    fk_rows = cursor.fetchall()
    for fk_row in fk_rows:
        fk_name = fk_row.name if hasattr(fk_row, "name") else fk_row[0]
        cursor.execute(
            f"ALTER TABLE Inscripciones DROP CONSTRAINT {_quote_ident(fk_name)}"
        )
    cursor.execute("DROP TABLE Inscripciones")


def _ensure_auditoria(cursor):
    if _table_exists(cursor, "AuditoriaCertificados"):
        return
    cursor.execute(
        """
        CREATE TABLE AuditoriaCertificados (
            IdAuditoria BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
            IdCertificado VARCHAR(50) NULL,
            Accion NVARCHAR(50) NOT NULL,
            IdUsuario INT NULL,
            FechaHora DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
            Detalle NVARCHAR(MAX) NULL
        )
        """
    )


def _ensure_non_cyclic_support_fks(cursor):
    """
    Conecta tablas de soporte a Certificados (topología estrella) sin ciclos:
    - AuditoriaCertificados -> Certificados
    """
    cursor.execute(
        """
        IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Auditoria_Certificado')
            RETURN;
        IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = N'AuditoriaCertificados')
            RETURN;
        ALTER TABLE AuditoriaCertificados
        ADD CONSTRAINT FK_Auditoria_Certificado
        FOREIGN KEY (IdCertificado) REFERENCES Certificados(IdCertificado)
        """
    )


def _ensure_foreign_keys_certificados(cursor):
    if not _table_exists(cursor, "Certificados"):
        return

    def add_fk(nombre, sql):
        cursor.execute(
            "SELECT 1 FROM sys.foreign_keys WHERE name = ?",
            (nombre,),
        )
        if cursor.fetchone():
            return
        try:
            cursor.execute(sql)
        except Exception as e:
            print(f"No se pudo crear FK {nombre}: {e}")

    add_fk(
        "FK_Certificados_Cursos",
        """
        ALTER TABLE Certificados ADD CONSTRAINT FK_Certificados_Cursos
        FOREIGN KEY (IdCurso) REFERENCES Cursos(IdCurso)
        """,
    )
    add_fk(
        "FK_Certificados_TipoCredencial",
        """
        ALTER TABLE Certificados ADD CONSTRAINT FK_Certificados_TipoCredencial
        FOREIGN KEY (IdTipoCredencial) REFERENCES TiposCredencial(IdTipoCredencial)
        """,
    )
    add_fk(
        "FK_Certificados_UsuarioDestinatario",
        """
        ALTER TABLE Certificados ADD CONSTRAINT FK_Certificados_UsuarioDestinatario
        FOREIGN KEY (IdUsuarioDestinatario) REFERENCES Usuarios(IdUsuario)
        """,
    )
    add_fk(
        "FK_Certificados_CentroEducativo",
        """
        ALTER TABLE Certificados ADD CONSTRAINT FK_Certificados_CentroEducativo
        FOREIGN KEY (IdCentroEducativo) REFERENCES CentroEducativo(IdCentroEducativo)
        """,
    )
    add_fk(
        "FK_Certificados_FirmaDoctores",
        """
        ALTER TABLE Certificados ADD CONSTRAINT FK_Certificados_FirmaDoctores
        FOREIGN KEY (IdFirmaDoctores) REFERENCES FirmaDoctores(IdFirmaDoctores)
        """,
    )
    if _table_exists(cursor, "TextosCuerpoCertificado") and _column_exists(
        cursor, "Certificados", "IdTextoCuerpoCatalogo"
    ):
        add_fk(
            "FK_Certificados_TextoCuerpoCatalogo",
            """
            ALTER TABLE Certificados ADD CONSTRAINT FK_Certificados_TextoCuerpoCatalogo
            FOREIGN KEY (IdTextoCuerpoCatalogo) REFERENCES TextosCuerpoCertificado(IdTextoCuerpo)
            ON DELETE SET NULL
            """,
        )


def _ensure_foreign_keys_estadisticas(cursor):
    if not _table_exists(cursor, "EstadisticasAplicacion") or not _table_exists(cursor, "Certificados"):
        return
    cursor.execute(
        """
        IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Estadisticas_UltimoCertificado')
            RETURN;
        IF NOT EXISTS (
            SELECT 1 FROM sys.columns
            WHERE object_id = OBJECT_ID(N'EstadisticasAplicacion') AND name = N'IdUltimoCertificadoGenerado'
        )
            RETURN;
        ALTER TABLE EstadisticasAplicacion
        ADD CONSTRAINT FK_Estadisticas_UltimoCertificado
        FOREIGN KEY (IdUltimoCertificadoGenerado) REFERENCES Certificados(IdCertificado)
        """
    )


def _drop_unnecessary_foreign_keys(cursor):
    """
    Elimina FKs que generan recorridos cíclicos en el diagrama.
    Auditoría mantiene referencias lógicas (IdCertificado/IdUsuario) sin acoplar por FK.
    """
    cursor.execute(
        """
        IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Certificados_UsuarioCreador')
        ALTER TABLE Certificados DROP CONSTRAINT FK_Certificados_UsuarioCreador
        """
    )
    cursor.execute(
        """
        IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Auditoria_Certificado')
        ALTER TABLE AuditoriaCertificados DROP CONSTRAINT FK_Auditoria_Certificado
        """
    )
    cursor.execute(
        """
        IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = N'FK_Auditoria_Usuario')
        ALTER TABLE AuditoriaCertificados DROP CONSTRAINT FK_Auditoria_Usuario
        """
    )


def _ensure_estadisticas_row(cursor):
    if not _table_exists(cursor, "EstadisticasAplicacion"):
        return
    cursor.execute(
        """
        IF NOT EXISTS (SELECT 1 FROM EstadisticasAplicacion WHERE IdEstadistica = 1)
        INSERT INTO EstadisticasAplicacion (IdEstadistica) VALUES (1)
        """
    )


def _remove_default_tipos_credencial(cursor):
    nombres_default = (
        "Certificado de Aprobación",
        "Certificado de Participación",
        "Constancia de Asistencia",
        "Diploma de Extensión Universitaria",
    )
    for nombre in nombres_default:
        cursor.execute(
            """
            DELETE t
            FROM TiposCredencial t
            WHERE t.Nombre = ?
            AND NOT EXISTS (
                SELECT 1
                FROM Certificados c
                WHERE c.IdTipoCredencial = t.IdTipoCredencial
            )
            """,
            (nombre,),
        )


def _backfill_id_tipo_credencial(cursor):
    if not _table_exists(cursor, "Certificados") or not _table_exists(cursor, "TiposCredencial"):
        return
    if not _column_exists(cursor, "Certificados", "NombreTipoCredencial"):
        return
    cursor.execute(
        """
        UPDATE c
        SET c.IdTipoCredencial = t.IdTipoCredencial
        FROM Certificados c
        INNER JOIN TiposCredencial t ON t.Nombre = c.NombreTipoCredencial
        WHERE c.IdTipoCredencial IS NULL AND c.NombreTipoCredencial IS NOT NULL
        """
    )


def _seed_estadisticas_row(cursor):
    if not _table_exists(cursor, "EstadisticasAplicacion"):
        return
    cursor.execute(
        """
        IF NOT EXISTS (SELECT 1 FROM EstadisticasAplicacion WHERE IdEstadistica = 1)
        INSERT INTO EstadisticasAplicacion (IdEstadistica) VALUES (1)
        """
    )


def get_app_stats():
    """Lee agregados de métricas (fila única IdEstadistica=1). Devuelve dict o None."""
    conn = get_db_connection()
    if not conn:
        return None
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT TiempoTotalGeneracionSeg, CantidadGeneraciones,
                TiempoTotalVerificacionSeg, CantidadVerificaciones,
                CantidadValidas, CantidadInvalidas
            FROM EstadisticasAplicacion WHERE IdEstadistica = 1
            """
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "totalGenTime": float(row.TiempoTotalGeneracionSeg),
            "genCount": int(row.CantidadGeneraciones),
            "totalVerTime": float(row.TiempoTotalVerificacionSeg),
            "verCount": int(row.CantidadVerificaciones),
            "validCount": int(row.CantidadValidas),
            "invalidCount": int(row.CantidadInvalidas),
        }
    except Exception:
        return None
    finally:
        conn.close()


def save_app_stats(stats):
    """Persiste stats_tesis en SQL Server."""
    conn = get_db_connection()
    if not conn:
        return False
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE EstadisticasAplicacion SET
                TiempoTotalGeneracionSeg = ?, CantidadGeneraciones = ?,
                TiempoTotalVerificacionSeg = ?, CantidadVerificaciones = ?,
                CantidadValidas = ?, CantidadInvalidas = ?
            WHERE IdEstadistica = 1
            """,
            (
                stats["totalGenTime"],
                stats["genCount"],
                stats["totalVerTime"],
                stats["verCount"],
                stats["validCount"],
                stats["invalidCount"],
            ),
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"Error al guardar estadísticas: {e}")
        return False
    finally:
        conn.close()


def obtener_id_tipo_credencial_por_nombre(nombre: str):
    """Devuelve IdTipoCredencial activo o None."""
    nombre = (nombre or "").strip()
    if not nombre:
        return None
    conn = get_db_connection()
    if not conn:
        return None
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT IdTipoCredencial FROM TiposCredencial
            WHERE Nombre = ? AND Activo = 1
            """,
            (nombre,),
        )
        row = cursor.fetchone()
        return int(row.IdTipoCredencial) if row else None
    except Exception:
        return None
    finally:
        conn.close()


def registrar_auditoria_certificado(id_certificado, accion, id_usuario=None, detalle=None):
    """Registra un evento en AuditoriaCertificados (no interrumpe si falla)."""
    conn = get_db_connection()
    if not conn:
        return
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO AuditoriaCertificados (IdCertificado, Accion, IdUsuario, Detalle)
            VALUES (?, ?, ?, ?)
            """,
            (id_certificado, accion, id_usuario, detalle),
        )
        conn.commit()
    except Exception as e:
        print(f"Auditoría no registrada: {e}")
    finally:
        conn.close()


def init_db():
    """Crea o migra el esquema en español (tablas normalizadas)."""
    conn = get_db_connection()
    if not conn:
        return
    try:
        cursor = conn.cursor()
        _ensure_tipos_credencial(cursor)
        _ensure_cursos(cursor)
        _ensure_usuarios(cursor)
        _ensure_estadisticas(cursor)
        _ensure_textos_cuerpo_catalogo(cursor)
        _ensure_certificados(cursor)
        _ensure_centro_educativo(cursor)
        _ensure_firma_doctores(cursor)
        _seed_centro_educativo_default(cursor)
        _drop_inscripciones_legacy(cursor)
        _ensure_auditoria(cursor)
        _remove_default_tipos_credencial(cursor)
        _backfill_id_tipo_credencial(cursor)
        _seed_estadisticas_row(cursor)
        _ensure_foreign_keys_certificados(cursor)
        _ensure_foreign_keys_estadisticas(cursor)
        _drop_unnecessary_foreign_keys(cursor)
        _ensure_non_cyclic_support_fks(cursor)
        conn.commit()
        print(
            "Esquema verificado: TiposCredencial, Cursos, Usuarios, EstadisticasAplicacion, "
            "Certificados, TextosCuerpoCertificado, CentroEducativo, FirmaDoctores, AuditoriaCertificados."
        )
    except Exception as e:
        print(f"Error al crear o migrar tablas: {e}")
        conn.rollback()
    finally:
        conn.close()
