from django.urls import path
from . import views

app_name = 'calculator'

urlpatterns = [
    path('', views.home, name='home'),
    path('calculadora/', views.index, name='index'),
    path('cotizaciones/', views.lista_cotizaciones, name='lista_cotizaciones'),
    path('cotizaciones/guardar/', views.guardar_cotizacion, name='guardar_cotizacion'),
    path('cotizaciones/<int:pk>/eliminar/', views.eliminar_cotizacion, name='eliminar_cotizacion'),
    path('login/', views.login_view, name='login'),
    path('logout/', views.logout_view, name='logout'),
    path('api/get-price/', views.get_part_price, name='get_part_price'),
    path('api/vehiculos/buscar/', views.api_buscar_vehiculo, name='api_buscar_vehiculo'),
]
