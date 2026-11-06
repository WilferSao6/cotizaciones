from decimal import Decimal
import json
import logging
import zoneinfo
import re

from django.shortcuts import render, redirect, get_object_or_404
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_POST
from django.core.cache import cache
from django.core.exceptions import PermissionDenied
from django.contrib.auth import get_user_model, login, logout
from django.contrib.auth.decorators import login_required
from django.db import connection
from django.db.models import Max, Q

from .models import SalidaAlmacen, CotizacionAccidentalidad, PerfilUsuario
from .vehicle_service import get_all_vehicles, lookup_vehicle
from .reference_service import lookup_part_in_excel

logger = logging.getLogger(__name__)

# Tiempo de vida del caché: 4 horas (en segundos)
PRICE_CACHE_TTL = 60 * 60 * 4

# Prefijo de documentos que representan compras reales (entradas de almacén)
PREFIJO_COMPRA_REAL = 'EAC'

User = get_user_model()


def asegurar_columna_id_pieza():
    """
    Verifica y asegura la existencia física de la columna 'id_pieza' en MySQL
    (tabla Cotizaciones_acidentalidad) y registra la migración 0002 en django_migrations.
    """
    try:
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT COUNT(*) 
                FROM information_schema.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                  AND TABLE_NAME = 'Cotizaciones_acidentalidad' 
                  AND COLUMN_NAME = 'id_pieza'
            """)
            col_exists = cursor.fetchone()[0] > 0
            if not col_exists:
                cursor.execute("""
                    ALTER TABLE `Cotizaciones_acidentalidad` 
                    ADD COLUMN `id_pieza` VARCHAR(250) NULL DEFAULT NULL 
                    AFTER `numero_bus`;
                """)
                try:
                    cursor.execute("ALTER TABLE `Cotizaciones_acidentalidad` ADD INDEX `idx_cot_id_pieza` (`id_pieza`);")
                except Exception:
                    pass
                logger.info("Columna 'id_pieza' agregada correctamente a Cotizaciones_acidentalidad en MySQL.")

            cursor.execute("""
                SELECT COUNT(*) 
                FROM django_migrations 
                WHERE app = 'calculator' AND name = '0002_cotizacionaccidentalidad_id_pieza'
            """)
            mig_exists = cursor.fetchone()[0] > 0
            if not mig_exists:
                cursor.execute("""
                    INSERT INTO django_migrations (app, name, applied) 
                    VALUES ('calculator', '0002_cotizacionaccidentalidad_id_pieza', NOW())
                """)
    except Exception as e:
        logger.warning("Verificación de columna id_pieza en MySQL: %s", e)


def obtener_usuario_activo(request):
    """
    Retorna el usuario autenticado en la sesión activa.
    """
    if request.user.is_authenticated:
        return request.user
    return None


def inicializar_cotizaciones_semilla():
    """
    Asegura la estructura relacional de la tabla Cotizaciones_acidentalidad en MySQL.
    """
    asegurar_columna_id_pieza()


def extraer_detalle_piezas(pieza_campo):
    """
    Separa el texto descriptivo del detalle estructurado JSON si existe el delimitador '|||'.
    """
    if not pieza_campo:
        return '', {}
    if '|||' in pieza_campo:
        partes = pieza_campo.split('|||', 1)
        texto = partes[0].strip()
        try:
            detalle = json.loads(partes[1].strip())
        except Exception:
            detalle = {}
        return texto, detalle
    return pieza_campo.strip(), {}


def home(request):
    """
    Renderiza la página de inicio de la aplicación.
    Si el usuario no ha iniciado sesión, lo redirige inmediatamente
    a la pantalla de Login corporativo.
    """
    if not request.user.is_authenticated:
        return redirect('calculator:login')
    return render(request, 'calculator/home.html')


@login_required(login_url='calculator:login')
def index(request):
    """
    Renderiza la vista principal de la calculadora de autopartes.
    Si detecta el parámetro 'editar_id' en la URL (GET), consulta la cotización
    directamente en MySQL (CotizacionAccidentalidad) y envía al contexto de la
    plantilla los datos correspondientes en formato JSON para reactivar el carrito
    y resaltar visualmente las piezas previamente seleccionadas en el SVG.
    """
    inicializar_cotizaciones_semilla()

    editar_id = request.GET.get('editar_id')
    cotizacion_editar = None

    if editar_id:
        try:
            cotizacion_obj = CotizacionAccidentalidad.objects.filter(pk=editar_id).first()
            if cotizacion_obj:
                piezas_raw = cotizacion_obj.pieza or ''
                piezas_texto, piezas_detalle = extraer_detalle_piezas(piezas_raw)
                piezas_lista = [p.strip() for p in piezas_texto.split(',') if p.strip()]

                valor_vigente = float(
                    cotizacion_obj.valor_pieza_editada
                    if cotizacion_obj.valor_pieza_editada is not None
                    else cotizacion_obj.valor_pieza
                )

                cotizacion_editar = {
                    'id': cotizacion_obj.id,
                    'id_cotizacion': cotizacion_obj.id_cotizacion,
                    'numero_bus': cotizacion_obj.numero_bus,
                    'tipologia': cotizacion_obj.tipologia,
                    'id_pieza': cotizacion_obj.id_pieza or '',
                    'piezas': piezas_lista,
                    'piezas_detalle': piezas_detalle,
                    'valor_pieza': valor_vigente,
                }
        except Exception:
            logger.exception("Error al recuperar la cotización con ID %s de MySQL", editar_id)

    context = {
        'editar_id': editar_id,
        'cotizacion_editar': cotizacion_editar,
    }
    return render(request, 'calculator/index.html', context)


@login_required(login_url='calculator:login')
def get_part_price(request):
    """
    Consulta descripción y costo unitario de una pieza a partir de su referencia.
    Paso 1: Consulta prioritaria en apps/data/Referencias.xlsx (columna 'Referencia' y 'costo').
    Paso 2: Si no existe en el Excel, consulta en la base de datos externa UNOEE (SQL Server).
    """
    code = request.GET.get('code', '').strip()
    if not code:
        return JsonResponse({'error': 'Código no proporcionado'}, status=400)
    if len(code) > 50:
        return JsonResponse({'error': 'Código inválido'}, status=400)

    cache_key = f'part_price_{code.upper()}'
    cached = cache.get(cache_key)
    if cached is not None:
        return JsonResponse(cached)

    # ── PASO 1: Consulta previa y prioritaria en apps/data/Referencias.xlsx ───
    try:
        part_excel = lookup_part_in_excel(code)
        if part_excel is not None:
            cache.set(cache_key, part_excel, PRICE_CACHE_TTL)
            return JsonResponse(part_excel)
    except Exception:
        logger.exception('Error al consultar referencia %s en Referencias.xlsx', code)

    # ── PASO 2: Fallback en base de datos externa UNOEE (SQL Server) ──────────
    try:
        qs_base = SalidaAlmacen.objects.filter(
            referencia_inteligente=code,
            costo_promedio_entrada__gt=0
        )

        if not qs_base.exists():
            return JsonResponse({'error': 'Pieza no encontrada'}, status=404)

        orden = ('-fecha_transaccion', '-codigo_documento_transaccion')
        campos = ('descripcion_parte', 'costo_promedio_entrada', 'cantidad_entrada')

        registro = (
            qs_base
            .filter(codigo_documento_transaccion__startswith=PREFIJO_COMPRA_REAL)
            .order_by(*orden)
            .values(*campos)
            .first()
        )

        if registro:
            fuente = 'EAC'
        else:
            registro = qs_base.order_by(*orden).values(*campos).first()
            fuente = 'fallback'

        costo_total = float(registro['costo_promedio_entrada'])
        cantidad_lote = float(registro['cantidad_entrada'] or 0)
        precio_unitario = costo_total / cantidad_lote if cantidad_lote > 0 else costo_total

        resultado = {
            'code': code,
            'name': registro['descripcion_parte'],
            'price': round(precio_unitario, 2),
            'qty_lote': cantidad_lote,
            'fuente': fuente,
        }
        cache.set(cache_key, resultado, PRICE_CACHE_TTL)
        return JsonResponse(resultado)

    except Exception:
        logger.exception('Error consultando precio para la referencia %s', code)
        return JsonResponse({'error': 'Error interno al consultar el precio'}, status=500)


@require_POST
@login_required(login_url='calculator:login')
def guardar_cotizacion(request):
    """
    Procesa la petición POST del formulario y almacena o actualiza la cotización
    directamente en la tabla Cotizaciones_acidentalidad en MySQL.
    """
    asegurar_columna_id_pieza()
    usuario_obj = obtener_usuario_activo(request)
    now = timezone.now()

    # 1. Capturar y sanear los campos del formulario
    try:
        valor_original = float(request.POST.get('valor_pieza', 0))
    except (ValueError, TypeError):
        valor_original = 0.0

    tipologia = request.POST.get('tipologia', 'Runner').strip()
    numero_bus = request.POST.get('numero_bus', 'SIN-NUMERO').strip().upper()
    id_pieza = request.POST.get('id_pieza', '').strip()
    pieza = request.POST.get('pieza', 'Repuesto general').strip()
    piezas_json_str = request.POST.get('piezas_json', '').strip()
    editar_id = request.POST.get('editar_id')

    # Si id_pieza no vino directamente en el POST, extraer automáticamente de piezas_json
    if not id_pieza and piezas_json_str:
        try:
            piezas_map = json.loads(piezas_json_str)
            if isinstance(piezas_map, dict):
                extracted_ids = []
                for p_key, p_data in piezas_map.items():
                    if isinstance(p_data, dict):
                        ref = p_data.get('baseId') or p_data.get('code') or p_key
                    else:
                        ref = str(p_key)
                    if ref and ref not in extracted_ids:
                        extracted_ids.append(str(ref))
                if extracted_ids:
                    id_pieza = ', '.join(extracted_ids)[:250]
        except Exception:
            pass

    # Guardar resumen legible + mapa estructurado JSON para reactivación precisa de formas SVG
    if piezas_json_str:
        pieza_a_guardar = f"{pieza} ||| {piezas_json_str}"
    else:
        pieza_a_guardar = pieza

    # 2. Si viene un editar_id, actualizar registro existente en MySQL con CAMPOS DE AUDITORÍA
    if editar_id:
        try:
            cotizacion = CotizacionAccidentalidad.objects.get(pk=editar_id)
            cotizacion.tipologia = tipologia
            cotizacion.numero_bus = numero_bus
            if id_pieza:
                cotizacion.id_pieza = id_pieza
            cotizacion.pieza = pieza_a_guardar
            cotizacion.valor_pieza_editada = Decimal(str(round(valor_original, 2)))
            nombre_editor = usuario_obj.perfil.nombre if hasattr(usuario_obj, 'perfil') and usuario_obj.perfil and usuario_obj.perfil.nombre else usuario_obj.username
            cotizacion.usuario_editor = nombre_editor
            cotizacion.timestamp_editor = now
            cotizacion.save()

            # Actualizar timestamp en la tabla Usuarios (PerfilUsuario)
            if hasattr(usuario_obj, 'perfil') and usuario_obj.perfil:
                try:
                    usuario_obj.perfil.hora_edicion_cotizacion = now
                    usuario_obj.perfil.save(update_fields=['hora_edicion_cotizacion'])
                except Exception:
                    pass

            if request.headers.get('x-requested-with') == 'XMLHttpRequest' or 'application/json' in request.headers.get('Accept', ''):
                return JsonResponse({
                    'status': 'ok',
                    'cotizacion': {
                        'id': cotizacion.id,
                        'id_cotizacion': cotizacion.id_cotizacion,
                        'numero_bus': cotizacion.numero_bus,
                        'tipologia': cotizacion.tipologia,
                        'id_pieza': cotizacion.id_pieza,
                        'pieza': pieza,
                        'valor_pieza': float(cotizacion.valor_pieza),
                        'valor_pieza_editada': float(cotizacion.valor_pieza_editada) if cotizacion.valor_pieza_editada else None,
                        'usuario_editor': cotizacion.usuario_editor,
                    }
                })

            return redirect('calculator:lista_cotizaciones')

        except CotizacionAccidentalidad.DoesNotExist:
            logger.warning("Intento de editar cotización inexistente ID %s", editar_id)

    # 3. Generar consecutivo autoincremental de negocio en MySQL
    max_consecutivo = CotizacionAccidentalidad.objects.aggregate(Max('id_cotizacion'))['id_cotizacion__max'] or 1000
    siguiente_consecutivo = max_consecutivo + 1

    # 4. Crear registro en la tabla física Cotizaciones_acidentalidad
    nueva_cotizacion = CotizacionAccidentalidad.objects.create(
        id_cotizacion=siguiente_consecutivo,
        usuario_creador=usuario_obj,
        tipologia=tipologia,
        numero_bus=numero_bus,
        id_pieza=id_pieza or None,
        pieza=pieza_a_guardar,
        valor_pieza=Decimal(str(round(valor_original, 2))),
        valor_pieza_editada=None,
        usuario_editor=None,
        timestamp_editor=None,
    )

    if request.headers.get('x-requested-with') == 'XMLHttpRequest' or 'application/json' in request.headers.get('Accept', ''):
        return JsonResponse({
            'status': 'ok',
            'cotizacion': {
                'id': nueva_cotizacion.id,
                'id_cotizacion': nueva_cotizacion.id_cotizacion,
                'numero_bus': nueva_cotizacion.numero_bus,
                'tipologia': nueva_cotizacion.tipologia,
                'id_pieza': nueva_cotizacion.id_pieza,
                'pieza': pieza,
                'valor_pieza': float(nueva_cotizacion.valor_pieza),
            }
        })

    return redirect('calculator:lista_cotizaciones')


@login_required(login_url='calculator:login')
def lista_cotizaciones(request):
    """
    Vista para listar las cotizaciones registradas en la Calculadora de Autopartes.
    Consulta en tiempo real la tabla Cotizaciones_acidentalidad en MySQL.
    """
    inicializar_cotizaciones_semilla()

    # Consulta optimizada con select_related para traer usuario_creador y su perfil institucional en 1 solo query
    qs = CotizacionAccidentalidad.objects.select_related('usuario_creador', 'usuario_creador__perfil').order_by('-timestamp')

    tz_colombia = zoneinfo.ZoneInfo('America/Bogota')
    cotizaciones = []

    for c in qs:
        # Resolver nombre de usuario o nombre completo institucional del creador
        if c.usuario_creador:
            if hasattr(c.usuario_creador, 'perfil') and c.usuario_creador.perfil and c.usuario_creador.perfil.nombre:
                nombre_creador = c.usuario_creador.perfil.nombre
            else:
                nombre_creador = c.usuario_creador.get_full_name().strip() or c.usuario_creador.username
        else:
            nombre_creador = 'SAO6'

        # Formateo de fechas a la zona horaria de Colombia
        fecha_creacion = timezone.localtime(c.timestamp, timezone=tz_colombia).strftime('%d/%m/%Y %H:%M:%S') if c.timestamp else ''
        fecha_edicion = timezone.localtime(c.timestamp_editor, timezone=tz_colombia).strftime('%d/%m/%Y %H:%M:%S') if c.timestamp_editor else ''

        piezas_texto, piezas_detalle = extraer_detalle_piezas(c.pieza)

        valor_original_subtotal = float(c.valor_pieza)
        valor_editado_subtotal = float(c.valor_pieza_editada) if c.valor_pieza_editada is not None else None
        valor_vigente_subtotal = valor_editado_subtotal if valor_editado_subtotal is not None else valor_original_subtotal

        # Regla de negocio formal SAO6:
        # Total Final = Subtotal + AI (35%) + Mano de obra (30%) = Subtotal * 1.65
        FACTOR_TOTAL_LIQUIDACION = 1.65
        valor_total_liquidado = round(valor_vigente_subtotal * FACTOR_TOTAL_LIQUIDACION)
        valor_total_original = round(valor_original_subtotal * FACTOR_TOTAL_LIQUIDACION)

        cotizaciones.append({
            'id': c.id,
            'id_cotizacion': c.id_cotizacion,
            'usuario_creador': nombre_creador,
            'tipologia': c.tipologia,
            'numero_bus': c.numero_bus,
            'id_pieza': c.id_pieza or '',
            'pieza': piezas_texto,
            'piezas_detalle': piezas_detalle,
            'valor_pieza': valor_original_subtotal,
            'valor_pieza_editada': valor_editado_subtotal,
            'valor_pieza_vigente': valor_vigente_subtotal,
            'valor_total_liquidado': valor_total_liquidado,
            'valor_total_original': valor_total_original,
            'usuario_editor': c.usuario_editor,
            'timestamp': fecha_creacion,
            'timestamp_editor': fecha_edicion,
        })

    # Control de acceso para edición
    puede_editar = False
    if request.user.is_authenticated:
        puede_editar = (
            request.user.is_superuser
            or request.user.is_staff
            or request.user.has_perm('calculator.can_edit_cotizacion')
        )

    context = {
        'cotizaciones': cotizaciones,
        'puede_editar': puede_editar,
        'total_registros': len(cotizaciones),
    }
    return render(request, 'calculator/lista_cotizaciones.html', context)


@require_POST
@login_required(login_url='calculator:login')
def eliminar_cotizacion(request, pk):
    """
    Elimina físicamente una cotización de la tabla Cotizaciones_acidentalidad en MySQL.
    """
    try:
        cotizacion = get_object_or_404(CotizacionAccidentalidad, pk=pk)
        id_cot = cotizacion.id_cotizacion
        cotizacion.delete()
        return JsonResponse({'status': 'ok', 'id': pk, 'id_cotizacion': id_cot})
    except Exception as e:
        logger.exception("Error al eliminar cotización con ID %s", pk)
        return JsonResponse({'status': 'error', 'message': str(e)}, status=500)


def login_view(request):
    """
    Autenticación corporativa de SAO6 S.A.S. mediante Correo Electrónico y Cédula.
    Localiza el PerfilUsuario activo y autentica la sesión en Django auth.User.
    """
    if request.user.is_authenticated:
        return redirect('calculator:home')

    error_mensaje = None
    next_url = request.GET.get('next') or request.POST.get('next') or ''

    if request.method == 'POST':
        correo = request.POST.get('correo', '').strip()
        cedula = request.POST.get('cedula', '').strip()

        if not correo or not cedula:
            error_mensaje = "Por favor ingresa tanto tu correo institucional como tu número de cédula."
        else:
            # Limpieza básica de la cédula para admitir entradas con puntos o espacios
            cedula_limpia = cedula.replace('.', '').replace(' ', '').replace('-', '')
            perfil = PerfilUsuario.objects.select_related('user').filter(
                correo__iexact=correo
            ).filter(
                Q(cedula=cedula) | Q(cedula=cedula_limpia)
            ).first()

            # Soporte dual: verificar si introdujo la contraseña del usuario en lugar de la cédula
            if not perfil:
                user_match = User.objects.filter(email__iexact=correo).first() or User.objects.filter(username__iexact=correo).first()
                if user_match and user_match.check_password(cedula) and hasattr(user_match, 'perfil') and user_match.perfil:
                    perfil = user_match.perfil

            if perfil:
                user = perfil.user
                if not user.is_active:
                    error_mensaje = "Esta cuenta corporativa se encuentra inactiva. Por favor contacta al administrador."
                else:
                    # Iniciar sesión en Django usando ModelBackend
                    login(request, user, backend='django.contrib.auth.backends.ModelBackend')

                    # Actualizar fecha y hora de inicio de sesión
                    perfil.hora_inicio_sesion = timezone.now()
                    perfil.save(update_fields=['hora_inicio_sesion'])

                    if next_url and next_url.startswith('/') and next_url not in ('/login/', '/logout/'):
                        return redirect(next_url)
                    return redirect('calculator:home')
            else:
                error_mensaje = "Credenciales no válidas. No se encontró ningún usuario activo con el correo y cédula suministrados."

    return render(request, 'calculator/login.html', {
        'error_mensaje': error_mensaje,
        'next': next_url,
    })


def logout_view(request):
    """Cierra la sesión activa del usuario y redirige a la pantalla de login."""
    logout(request)
    return redirect('calculator:login')


@login_required(login_url='calculator:login')
def api_buscar_vehiculo(request):
    """
    Endpoint JSON para consultar el vehículo y su línea desde vehiculo.xlsx.
    """
    q = request.GET.get('q', '').strip()
    if q:
        vehiculo = lookup_vehicle(q)
        if vehiculo:
            return JsonResponse({'status': 'ok', 'encontrado': True, 'vehiculo': vehiculo})
        return JsonResponse({'status': 'ok', 'encontrado': False, 'q': q})

    # Si no hay query, retornar lista única para autocompletado en la calculadora
    vehicles_dict = get_all_vehicles()
    seen = set()
    units_list = []
    for v in vehicles_dict.values():
        num = v['numero']
        if num not in seen:
            seen.add(num)
            units_list.append({
                'numero': num,
                'linea': v['linea'],
                'linea_key': v['linea_key']
            })

    try:
        units_list.sort(key=lambda x: int(re.sub(r'\D', '', x['numero']) or 0))
    except Exception:
        units_list.sort(key=lambda x: x['numero'])

    return JsonResponse({'status': 'ok', 'vehiculos': units_list})

