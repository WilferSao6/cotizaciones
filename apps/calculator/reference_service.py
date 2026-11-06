"""
Servicio para la lectura, consulta e indexación de referencias de repuestos y costos
a partir del archivo corporativo apps/data/Referencias.xlsx.
Opera como paso previo antes de consultar la base de datos externa de UNOEE (SQL Server).
"""

import os
import re
import logging
from pathlib import Path
from django.conf import settings

logger = logging.getLogger(__name__)

# Caché en memoria de referencias cargadas desde el Excel
_REFERENCES_CACHE = None


def _get_excel_path():
    """Localiza el archivo de referencias en apps/data/ con soporte case-insensitive."""
    base_dir = Path(settings.BASE_DIR) / 'apps' / 'data'
    candidates = ['Referencias.xlsx', 'referencias.xlsx', 'referencis.xlsx', 'Referencia.xlsx']
    for candidate in candidates:
        p = base_dir / candidate
        if p.exists():
            return p
    return base_dir / 'Referencias.xlsx'


def _load_excel_with_openpyxl(file_path):
    """Carga filas usando openpyxl si la librería está disponible."""
    import openpyxl
    wb = openpyxl.load_workbook(file_path, data_only=True, read_only=True)
    sheet = wb.active
    rows = list(sheet.iter_rows(values_only=True))
    wb.close()
    return rows


def _load_excel_with_zipfile(file_path):
    """
    Fallback usando la librería estándar de Python (zipfile + xml.etree)
    en caso de que openpyxl no esté disponible o falle.
    """
    import zipfile
    import xml.etree.ElementTree as ET

    with zipfile.ZipFile(file_path, 'r') as z:
        # 1. Cargar Shared Strings
        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
            ns = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            si_elements = tree.findall('.//main:si', ns) or tree.findall('.//{*}si')
            for si in si_elements:
                text_elems = si.findall('.//main:t', ns) or si.findall('.//{*}t')
                texts = [t.text or '' for t in text_elems]
                shared_strings.append(''.join(texts))

        # 2. Localizar hoja principal
        sheet_xml = None
        for name in z.namelist():
            if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
                sheet_xml = name
                break
        if not sheet_xml:
            return []

        # 3. Parsear celdas de la hoja
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


def get_all_excel_references(force_reload=False):
    """
    Lee y estructura todas las referencias de repuestos de apps/data/Referencias.xlsx.
    Retorna un diccionario indexado por la referencia en mayúsculas y limpia:
    {
        "RCEX0174": {
            "code": "RCEX0174",
            "name": "PUNTERA BOMPER DELANTERO IZQUIERDA NUEVO",
            "price": 323870.40,
            "fuente": "EXCEL"
        },
        ...
    }
    """
    global _REFERENCES_CACHE
    if _REFERENCES_CACHE is not None and not force_reload:
        return _REFERENCES_CACHE

    excel_file = _get_excel_path()
    if not os.path.exists(excel_file):
        logger.warning("No se encontró el archivo de referencias en %s", excel_file)
        return {}

    raw_rows = []
    try:
        raw_rows = _load_excel_with_openpyxl(excel_file)
    except Exception as e:
        logger.warning("Fallo al leer Referencias.xlsx con openpyxl (%s), intentando con zipfile...", e)
        try:
            raw_rows = _load_excel_with_zipfile(excel_file)
        except Exception as e2:
            logger.error("Error crítico leyendo Referencias.xlsx: %s", e2)
            return {}

    if not raw_rows or len(raw_rows) < 2:
        return {}

    # Identificar encabezados de columnas
    header_row = [str(h).strip().lower() if h is not None else '' for h in raw_rows[0]]

    ref_idx = -1
    desc_idx = -1
    costo_idx = -1

    for idx, h in enumerate(header_row):
        clean_h = h.replace('_', ' ').replace('.', ' ')
        if ref_idx == -1 and any(t in clean_h for t in ['referencia', 'ref']):
            ref_idx = idx
        elif desc_idx == -1 and any(t in clean_h for t in ['desc', 'descripcion', 'item']):
            desc_idx = idx
        elif costo_idx == -1 and any(t in clean_h for t in ['costo', 'precio', 'valor']):
            costo_idx = idx

    # Si desc_idx no se asignó o coincidió con detalle secundario, fallback a columna 2 (Desc. item)
    if ref_idx == -1:
        ref_idx = 0
    if desc_idx == -1 or desc_idx == 1:
        desc_idx = 2 if len(header_row) > 2 else 1
    if costo_idx == -1:
        costo_idx = 4 if len(header_row) > 4 else len(header_row) - 1

    ref_map = {}

    for row in raw_rows[1:]:
        if not row:
            continue

        raw_ref = row[ref_idx] if ref_idx < len(row) else None
        raw_desc = row[desc_idx] if desc_idx < len(row) else None
        raw_costo = row[costo_idx] if costo_idx < len(row) else None

        if raw_ref is None:
            continue

        ref_str = str(raw_ref).strip()
        if not ref_str or ref_str.lower() == 'none':
            continue

        # Convertir costo a float
        try:
            costo_val = float(str(raw_costo).replace(',', '').strip())
        except (ValueError, TypeError):
            continue

        if costo_val <= 0:
            continue

        desc_str = str(raw_desc).strip() if raw_desc is not None and str(raw_desc).lower() != 'none' else ref_str

        # Normalizar claves de búsqueda
        key_upper = ref_str.upper()
        key_compact = re.sub(r'[\s_\-]+', '', key_upper)

        item_data = {
            'code': key_upper,
            'name': desc_str,
            'price': round(costo_val, 2),
            'fuente': 'EXCEL',
        }

        # Indexación por clave estándar y compacta
        ref_map[key_upper] = item_data
        if key_compact != key_upper:
            ref_map[key_compact] = item_data

    _REFERENCES_CACHE = ref_map
    logger.info("Cargadas %d referencias desde %s (columnas: ref=%d, desc=%d, costo=%d)",
                len(ref_map), os.path.basename(excel_file), ref_idx, desc_idx, costo_idx)
    return ref_map


def lookup_part_in_excel(code):
    """
    Busca una referencia en el archivo Referencias.xlsx.
    Retorna el diccionario con 'code', 'name', 'price', 'fuente' o None si no existe.
    """
    if not code:
        return None

    clean_code = str(code).strip().upper()
    ref_map = get_all_excel_references()

    # 1. Búsqueda directa por código en mayúsculas
    if clean_code in ref_map:
        return ref_map[clean_code]

    # 2. Búsqueda compacta (sin espacios, guiones o barras bajas)
    compact = re.sub(r'[\s_\-]+', '', clean_code)
    if compact in ref_map:
        return ref_map[compact]

    return None
