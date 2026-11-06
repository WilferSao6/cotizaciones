# Permite a Django usar PyMySQL como backend de MySQLdb si mysqlclient no está instalado
try:
    import pymysql
    pymysql.install_as_MySQLdb()
except ImportError:
    pass

# Parche de compatibilidad: Permite operar MariaDB 10.5.x en Django 6.x
try:
    from django.db.backends.base.base import BaseDatabaseWrapper
    BaseDatabaseWrapper.check_database_version_supported = lambda self: None
except Exception:
    pass

try:
    from django.db.backends.mysql.base import DatabaseWrapper
    DatabaseWrapper.check_database_version_supported = lambda self: None
except Exception:
    pass

try:
    from django.db.backends.mysql.features import DatabaseFeatures
    DatabaseFeatures.minimum_database_version = (10, 4)
except Exception:
    pass


