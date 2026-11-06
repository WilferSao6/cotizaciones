"""
Servicio para la lectura, consulta y resolución de tipología vehicular
a partir del archivo corporativo apps/data/vehiculo.xlsx.
"""

import os
import re
import logging
from pathlib import Path
from django.conf import settings

logger = logging.getLogger(__name__)

EXCEL_PATH = Path(settings.BASE_DIR) / 'apps' / 'data' / 'vehiculo.xlsx'

_VEHICLES_CACHE = None


def _load_excel_with_openpyxl(file_path):
    import openpyxl
    wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
    sheet = wb.active
    rows = list(sheet.iter_rows(values_only=True))
    wb.close()
    return rows


def _load_excel_with_zipfile(file_path):
    """
    Fallback usando la librería estándar de Python (zipfile + xml.etree)
    en caso de que openpyxl no esté disponible.
    """
    import zipfile
    import xml.etree.ElementTree as ET

    with zipfile.ZipFile(file_path, 'r') as z:
        # 1. Shared Strings
        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
            ns = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            for si in tree.findall('.//main:si', ns) or tree.findall('.//{*}si'):
                texts = [t.text or '' for t in (si.findall('.//main:t', ns) or si.findall('.//{*}t'))]
                shared_strings.append(''.join(texts))

        # 2. Sheet 1 Data
        sheet_xml = None
        for name in z.namelist():
            if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
                sheet_xml = name
                break
        if not sheet_xml:
            return []

        tree = ET.fromstring(z.read(sheet_xml))
        rows_data = []
        for row in tree.findall('.//{*}row'):
            row_cells = {}
            max_col = 0
            for c in row.findall('.//{*}c'):
                r_coord = c.attrib.get('r', '')
                col_match = re.match(r'([A-Z]+)', r_coord)
                if col_match:
                    col_str = col_match.group(1)
                    col_idx = 0
                    for char in col_str:
                        col_idx = col_idx * 26 + (ord(char) - ord('A') + 1)
                    col_idx -= 1
                else:
                    col_idx = len(row_cells)

                val_elem = c.find('.//{*}v')
                val = val_elem.text if val_elem is not None else None
                cell_type = c.attrib.get('t')

                if cell_type == 's' and val is not None and val.isdigit():
                    idx = int(val)
                    cell_val = shared_strings[idx] if idx < len(shared_strings) else val
                else:
                    cell_val = val

                row_cells[col_idx] = cell_val
                if col_idx > max_col:
                    max_col = col_idx

            row_list = [row_cells.get(i) for i in range(max_col + 1)] if row_cells else []
            rows_data.append(row_list)
        return rows_data


def get_all_vehicles(force_reload=False):
    """
    Lee y estructura todos los vehículos de apps/data/vehiculo.xlsx.
    Retorna un diccionario mapeado por número de vehículo normalizado:
    {
        "101": { "numero": "101", "linea": "Runner", "linea_key": "runner", "raw": {...} },
        ...
    }
    """
    global _VEHICLES_CACHE
    if _VEHICLES_CACHE is not None and not force_reload:
        return _VEHICLES_CACHE

    if not os.path.exists(EXCEL_PATH):
        logger.error("No se encontró el archivo de vehículos en %s", EXCEL_PATH)
        return {}

    raw_rows = []
    try:
        raw_rows = _load_excel_with_openpyxl(EXCEL_PATH)
    except Exception as e:
        logger.warning("Fallo al leer vehiculo.xlsx con openpyxl (%s), intentando con zipfile...", e)
        try:
            raw_rows = _load_excel_with_zipfile(EXCEL_PATH)
        except Exception as e2:
            logger.error("Error crítico leyendo vehiculo.xlsx: %s", e2)
            return {}

    if not raw_rows or len(raw_rows) < 2:
        return {}

    # Identificar encabezados de columnas
    headers = [str(h).strip().lower() if h is not None else '' for h in raw_rows[0]]
    
    # Buscar índice de "numero de vehiculo" / "vehiculo" / "bus" / "movil" / "unidad"
    num_idx = -1
    for idx, h in enumerate(headers):
        clean_h = h.replace('_', ' ').replace('.', ' ')
        if any(term in clean_h for term in ['numero de vehiculo', 'num vehiculo', 'numero vehiculo', 'vehiculo', 'movil', 'unidad', 'bus']):
            num_idx = idx
            break

    # Buscar índice de "linea" / "modelo" / "tipologia"
    linea_idx = -1
    for idx, h in enumerate(headers):
        clean_h = h.replace('_', ' ').replace('.', ' ')
        if any(term in clean_h for term in ['linea', 'modelo', 'tipologia', 'marca']):
            linea_idx = idx
            break

    # Fallback a columnas 0 y 1 si no se encuentran por nombre
    if num_idx == -1 and len(headers) > 0:
        num_idx = 0
    if linea_idx == -1 and len(headers) > 1:
        linea_idx = 1

    vehicles_map = {}
    for row in raw_rows[1:]:
        if not row:
            continue
        num_val = row[num_idx] if num_idx < len(row) else None
        linea_val = row[linea_idx] if linea_idx < len(row) else None

        if num_val is None:
            continue

        num_str = str(num_val).strip()
        if not num_str or num_str.lower() == 'none':
            continue

        # Normalizar clave (remover decimales si viene como 101.0)
        clean_key = re.sub(r'\.0$', '', num_str).strip()
        clean_key = re.sub(r'^[A-Za-z\s:\-_]+', '', clean_key).strip() or clean_key

        linea_str = str(linea_val).strip() if linea_val is not None else 'Runner'
        if linea_str.lower() == 'none' or not linea_str:
            linea_str = 'Runner'

        # Mapeo a las tipologías soportadas en la aplicación
        # (runner, npr, agrale)
        linea_upper = linea_str.upper()
        if 'NPR' in linea_upper or 'ISUZU' in linea_upper or 'CHEVROLET' in linea_upper:
            norm_key = 'npr'
            norm_label = 'NPR'
        elif 'AGRALE' in linea_upper:
            norm_key = 'agrale'
            norm_label = 'Agrale'
        else:
            norm_key = 'standard'
            norm_label = 'Runner'

        row_dict = {
            'numero': clean_key,
            'numero_original': num_str,
            'linea': norm_label,
            'linea_original': linea_str,
            'linea_key': norm_key,
        }
        vehicles_map[clean_key.lower()] = row_dict
        # También mapear con prefijo unidad/bus por si se busca con texto
        vehicles_map[f"unidad {clean_key}".lower()] = row_dict
        vehicles_map[f"bus {clean_key}".lower()] = row_dict

    _VEHICLES_CACHE = vehicles_map
    logger.info("Cargados %d vehículos desde vehiculo.xlsx (columnas: num=%d, linea=%d)", len(vehicles_map), num_idx, linea_idx)
    return vehicles_map


def lookup_vehicle(query):
    """
    Busca una unidad por número o texto.
    Retorna el diccionario de vehículo o None si no existe.
    """
    if not query:
        return None
    vehicles = get_all_vehicles()
    q = str(query).strip().lower()
    
    # 1. Búsqueda exacta directa
    if q in vehicles:
        return vehicles[q]

    # 2. Normalizar quitando prefijos
    clean_q = re.sub(r'^[a-z\s:\-_]+', '', q).strip()
    if clean_q in vehicles:
        return vehicles[clean_q]

    # 3. Quitar ceros a la izquierda
    no_leading_zeros = clean_q.lstrip('0')
    if no_leading_zeros in vehicles:
        return vehicles[no_leading_zeros]

    return None
