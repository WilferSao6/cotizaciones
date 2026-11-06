from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import User
from .models import CotizacionAccidentalidad, PerfilUsuario


class PerfilUsuarioInline(admin.StackedInline):
    model = PerfilUsuario
    can_delete = False
    verbose_name_plural = 'Perfil de Usuario (Datos Corporativos SAO6)'
    fk_name = 'user'


# Re-registrar UserAdmin para incluir el perfil inline en el admin de Django
class UserAdmin(BaseUserAdmin):
    inlines = (PerfilUsuarioInline,)


admin.site.unregister(User)
admin.site.register(User, UserAdmin)


@admin.register(PerfilUsuario)
class PerfilUsuarioAdmin(admin.ModelAdmin):
    list_display = ('id', 'nombre', 'cedula', 'correo', 'user', 'hora_inicio_sesion', 'hora_edicion_cotizacion')
    search_fields = ('nombre', 'cedula', 'correo', 'user__username')
    list_filter = ('hora_inicio_sesion', 'hora_edicion_cotizacion')
    readonly_fields = ('hora_inicio_sesion', 'hora_edicion_cotizacion')


@admin.register(CotizacionAccidentalidad)
class CotizacionAccidentalidadAdmin(admin.ModelAdmin):
    list_display = ('id_cotizacion', 'numero_bus', 'id_pieza', 'tipologia', 'usuario_creador', 'valor_pieza', 'valor_pieza_editada', 'timestamp')
    search_fields = ('id_cotizacion', 'numero_bus', 'id_pieza', 'pieza', 'usuario_creador__username', 'usuario_editor')
    list_filter = ('tipologia', 'timestamp')
    readonly_fields = ('timestamp',)
