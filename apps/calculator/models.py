from django.db import models
from django.conf import settings


class UnoeeManager(models.Manager):
    """Enruta automáticamente las consultas a la base de datos externa UNOEE (SQL Server)."""
    def get_queryset(self):
        return super().get_queryset().using('unoee')


class SalidaAlmacen(models.Model):
    """
    Modelo de solo lectura que mapea la tabla dbo.ADMIN-SALIDAS_ALMACEN_1 en SQL Server (UNOEE).
    Se usa para consultar referencias, descripciones y costos de piezas.
    """
    referencia_inteligente        = models.CharField(max_length=50, verbose_name="Referencia")
    descripcion_parte             = models.CharField(max_length=255, verbose_name="Descripción")
    codigo_documento_transaccion  = models.CharField(max_length=100, primary_key=True, verbose_name="Documento")
    fecha_transaccion             = models.DateField(verbose_name="Fecha")
    cantidad_entrada              = models.DecimalField(max_digits=14, decimal_places=4, verbose_name="Cantidad")
    costo_promedio_entrada        = models.DecimalField(max_digits=18, decimal_places=4, verbose_name="Costo promedio")

    # Gestor que redirige automáticamente a la conexión 'unoee'
    objects = UnoeeManager()

    class Meta:
        managed  = False                              # Django NO crea ni modifica esta tabla
        db_table = 'ADMIN-SALIDAS_ALMACEN_1'          # Nombre de la tabla en SQL Server
        verbose_name        = 'Salida de almacén'
        verbose_name_plural = 'Salidas de almacén'

    def __str__(self):
        return f"{self.referencia_inteligente} — {self.descripcion_parte}"


class CotizacionAccidentalidad(models.Model):
    """
    Modelo de persistencia en MySQL (bdsaocomco_cotizacion_accidentes)
    para el registro y auditoría de cotizaciones de accidentalidad en SAO6 S.A.S.
    Tabla física en MySQL: Cotizaciones_acidentalidad
    """
    # 1. Llave primaria autoincremental
    id = models.BigAutoField(
        primary_key=True,
        verbose_name="ID Registro"
    )

    # 2. Consecutivo de negocio (COT-XXXX)
    id_cotizacion = models.PositiveIntegerField(
        unique=True,
        db_index=True,
        verbose_name="Consecutivo Cotización"
    )

    # 3. Opción A: Relación con el usuario de Django auth.User que inició sesión
    usuario_creador = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="cotizaciones_creadas",
        verbose_name="Usuario Creador"
    )

    # 4. Tipología vehicular (Runner, NPR, Agrale)
    tipologia = models.CharField(
        max_length=250,
        verbose_name="Tipología Vehicular"
    )

    # 5. Identificador de bus o móvil de la flota
    numero_bus = models.CharField(
        max_length=250,
        db_index=True,
        verbose_name="Número de Bus"
    )

    # 6. ID o Referencia de la(s) pieza(s) cotizada(s)
    id_pieza = models.CharField(
        max_length=250,
        null=True,
        blank=True,
        db_index=True,
        verbose_name="ID de la Pieza"
    )

    # 7. Repuesto(s) cotizado(s)
    pieza = models.TextField(
        verbose_name="Pieza(s) Cotizada(s)"
    )

    # 7. Valor original cotizado (exactitud financiera)
    valor_pieza = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        verbose_name="Valor Original (COP)"
    )

    # 8. Valor editado si fue modificado (permite nulos)
    valor_pieza_editada = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name="Valor Editado (COP)"
    )

    # 9. Usuario que realizó la modificación (permite nulos)
    usuario_editor = models.CharField(
        max_length=250,
        null=True,
        blank=True,
        verbose_name="Usuario Editor"
    )

    # 10. Timestamp de creación con zona horaria de Colombia
    timestamp = models.DateTimeField(
        auto_now_add=True,
        db_index=True,
        verbose_name="Fecha/Hora de Creación"
    )

    # 11. Timestamp de edición (solo se llena al modificar)
    timestamp_editor = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Fecha/Hora de Edición"
    )

    class Meta:
        db_table = "Cotizaciones_acidentalidad"
        verbose_name = "Cotización de Accidentalidad"
        verbose_name_plural = "Cotizaciones de Accidentalidad"
        ordering = ["-timestamp"]
        indexes = [
            models.Index(fields=["id_cotizacion"], name="idx_cot_consecutivo"),
            models.Index(fields=["numero_bus"], name="idx_cot_numero_bus"),
            models.Index(fields=["timestamp"], name="idx_cot_timestamp"),
        ]

    def __str__(self):
        return f"COT-{self.id_cotizacion} | Bus: {self.numero_bus} | ${self.valor_final:,.0f} COP"

    @property
    def valor_final(self):
        """Retorna el valor vigente considerando si fue editada o se conserva el original."""
        return self.valor_pieza_editada if self.valor_pieza_editada is not None else self.valor_pieza


class PerfilUsuario(models.Model):
    """
    Tabla de usuarios corporativos en MySQL para SAO6 S.A.S.
    Conectada de forma 1 a 1 con auth.User de Django.
    Tabla física en MySQL: Usuarios
    """
    # 1. ID primario autoincremental
    id = models.BigAutoField(
        primary_key=True,
        verbose_name="ID"
    )

    # 2. Conexión estricta 1 a 1 con auth.User
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="perfil",
        verbose_name="Usuario de Autenticación"
    )

    # 3. Nombre completo
    nombre = models.CharField(
        max_length=250,
        verbose_name="Nombre Completo"
    )

    # 4. Cédula de ciudadanía o documento de identidad
    cedula = models.CharField(
        max_length=50,
        unique=True,
        db_index=True,
        verbose_name="Cédula / Documento"
    )

    # 5. Correo electrónico
    correo = models.EmailField(
        max_length=254,
        unique=True,
        verbose_name="Correo Electrónico"
    )

    # 6. Hora de inicio de sesión (último login)
    hora_inicio_sesion = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Hora de Inicio de Sesión"
    )

    # 7. Hora de última edición de una cotización
    hora_edicion_cotizacion = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name="Hora de Edición de Cotización"
    )

    class Meta:
        db_table = "Usuarios"
        verbose_name = "Usuario"
        verbose_name_plural = "Usuarios"
        ordering = ["nombre"]

    def __str__(self):
        return f"{self.nombre} (CC: {self.cedula}) — @{self.user.username}"


# ── SEÑALES: Actualización automática de hora_inicio_sesion al hacer login ──
from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver
from django.utils import timezone


@receiver(user_logged_in)
def registrar_hora_inicio_sesion(sender, request, user, **kwargs):
    """Actualiza automáticamente hora_inicio_sesion cada vez que el usuario ingresa al sistema."""
    if hasattr(user, 'perfil') and user.perfil:
        user.perfil.hora_inicio_sesion = timezone.now()
        user.perfil.save(update_fields=['hora_inicio_sesion'])

