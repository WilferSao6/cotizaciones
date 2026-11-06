/**
 * @file pdfGenerator.js
 * @description Generador de cotizaciones en PDF con diseño corporativo premium para SAO6 S.A.S.
 * Utiliza jsPDF (2.5.1). Gestiona renderizado vectorial por coordenadas (x, y),
 * paginación dinámica, cálculo de liquidación (Subtotal, AI 35%, Mano de obra 30%) y
 * reglas de dictamen para aseguradoras según el SMMLV en Colombia.
 */

// ─── CONSTANTES DE NEGOCIO Y CONFIGURACIÓN CORPORATIVA ───────────────────────

/** Salario Mínimo Mensual Legal Vigente (Colombia) */
export const SMMLV_COLOMBIA = 1423500;
export const UMBRAL_DOS_SMMLV = SMMLV_COLOMBIA * 2; // $2.847.000 COP

/** Factores de liquidación SAO6 */
export const FACTOR_AI = 0.35;               // AI (Administración e Imprevistos): 35% del subtotal
export const FACTOR_RECARGO_SUBTOTAL = 0.35; // Alias de retrocompatibilidad
export const FACTOR_MANO_DE_OBRA = 0.30;     // Mano de obra: 30% del subtotal

/** Paleta de color institucional (RGB) */
const PALETTE = {
    PRIMARY: [0, 180, 75],       // Verde esmeralda SAO6
    PRIMARY_DARK: [0, 130, 55],  // Verde corporativo oscuro
    DARK: [24, 30, 42],          // Azul antracita de contraste
    TEXT: [45, 55, 72],          // Gris grafito para lectura
    MUTED: [115, 128, 142],      // Gris secundario / metadatos
    LIGHT: [247, 249, 251],      // Fondo de filas alternadas
    BORDER: [226, 232, 240],     // Separadores sutiles
    SEVERO: [217, 48, 37],       // Rojo dictamen: Cobrar aseguradora
    LEVE: [24, 134, 75],         // Verde dictamen: No cobrar aseguradora
    WHITE: [255, 255, 255]
};

// Caché en memoria para el logo corporativo convertido a Base64
let cachedLogoDataUrl = null;

// ─── UTILIDADES FINANCIERAS Y DE FORMATO ─────────────────────────────────────

/**
 * Formatea un valor numérico a Pesos Colombianos (COP) sin decimales.
 * @param {number} value
 * @returns {string}
 */
export function formatCOP(value) {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value || 0);
}

/**
 * Realiza la liquidación financiera formal de la cotización según la lógica de negocio SAO6:
 * Total Final = Subtotal + AI (35%) + Mano de obra (30%)
 * @param {Array<Object>|Object} parts - Colección o mapa de piezas cotizadas.
 */
export function calculateQuoteFinancials(parts) {
    const partsArray = Array.isArray(parts) ? parts : Object.values(parts || {});

    let costoRepuestos = 0;
    let itemsCount = 0;
    let missingPricesCount = 0;

    partsArray.forEach(part => {
        const qty = Number(part.qty) || 1;
        const validPrice = typeof part.price === 'number' && part.price > 0;

        if (validPrice) {
            costoRepuestos += part.price * qty;
        } else {
            missingPricesCount++;
        }
        itemsCount += qty;
    });

    const subtotal = costoRepuestos;
    const costoTotalRepuesto = costoRepuestos;
    const ai = subtotal * FACTOR_AI;
    const manoDeObra = subtotal * FACTOR_MANO_DE_OBRA;
    const totalLiquidacion = subtotal + ai + manoDeObra;
    const esMayorAseguradora = costoRepuestos >= UMBRAL_DOS_SMMLV;

    return {
        subtotal,
        costoRepuestos,
        costoTotalRepuesto,
        ai,
        recargoSubtotal: ai, // Mantener para compatibilidad
        manoDeObra,
        totalLiquidacion,
        itemsCount,
        missingPricesCount,
        esMayorAseguradora,
        accionAseguradora: esMayorAseguradora ? 'Cobrar a Aseguradora' : 'No cobrar a la aseguradora',
        etiquetaSeveridad: esMayorAseguradora ? 'Severo' : 'Leve'
    };
}

// ─── GESTIÓN DE CONSECUTIVOS LOCALES ─────────────────────────────────────────

const CONSECUTIVE_STORAGE_KEY = 'sao6_quote_consecutive';

export function getNextConsecutive() {
    let current = parseInt(localStorage.getItem(CONSECUTIVE_STORAGE_KEY), 10);
    if (isNaN(current) || current < 1) {
        current = 1;
    }
    const year = new Date().getFullYear();
    return {
        formatted: `COT-${year}-${String(current).padStart(4, '0')}`,
        rawNumber: current
    };
}

export function commitConsecutiveIncrement() {
    const { rawNumber } = getNextConsecutive();
    localStorage.setItem(CONSECUTIVE_STORAGE_KEY, String(rawNumber + 1));
}

// ─── CARGADOR ASÍNCRONO DE DEPENDENCIAS EXTERNAS ──────────────────────────────

/**
 * Asegura la carga de la librería jsPDF 2.5.1 en el entorno global.
 * @returns {Promise<void>}
 */
export function ensureJsPdfLoaded() {
    return new Promise((resolve, reject) => {
        if (window.jspdf && window.jspdf.jsPDF) {
            return resolve();
        }
        const existingScript = document.querySelector('script[src*="jspdf"]');
        if (existingScript) {
            existingScript.addEventListener('load', () => resolve());
            existingScript.addEventListener('error', () => reject(new Error('Error al cargar jsPDF')));
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Fallo de red al descargar jsPDF 2.5.1'));
        document.head.appendChild(script);
    });
}

/**
 * Pre-carga el logotipo institucional y lo convierte a DataURL para jsPDF.
 * @param {string} [logoUrl]
 * @returns {Promise<string|null>}
 */
export function preloadCorporateLogo(logoUrl) {
    if (cachedLogoDataUrl) {
        return Promise.resolve(cachedLogoDataUrl);
    }
    const source = logoUrl
        || (typeof SAO6_LOGO_URL !== 'undefined' ? SAO6_LOGO_URL : null)
        || ((typeof STATIC_BASE_URL !== 'undefined') ? `${STATIC_BASE_URL}logo_sao6.png.ico` : '/static/assets/logo_sao6.png.ico');

    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || img.width || 64;
                canvas.height = img.naturalHeight || img.height || 64;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                cachedLogoDataUrl = canvas.toDataURL('image/png');
                resolve(cachedLogoDataUrl);
            } catch (err) {
                cachedLogoDataUrl = null;
                resolve(null);
            }
        };
        img.onerror = () => {
            cachedLogoDataUrl = null;
            resolve(null);
        };
        img.src = source;
    });
}

// ─── CONSTRUCTOR PRINCIPAL DEL DOCUMENTO PDF ─────────────────────────────────

/**
 * Construye el archivo PDF de la cotización calculando coordenadas milimétricas exactas.
 * 
 * @param {Object} params
 * @param {Object|Array} params.parts - Piezas seleccionadas en la calculadora.
 * @param {string} [params.vehicleType='standard'] - 'standard' | 'npr' | 'agrale'.
 * @param {boolean} [params.incrementConsecutive=false] - Incrementar consecutivo en almacenamiento.
 * @returns {Promise<{doc: Object, fileName: string, financials: Object}>}
 */
export async function buildQuotePDF({
    parts,
    vehicleType = 'standard',
    incrementConsecutive = false,
    quoteNumber = null,
    quoteDate = null,
    quoteUser = null,
    busNumber = null
} = {}) {
    await ensureJsPdfLoaded();
    const logoDataUrl = await preloadCorporateLogo();

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentW = pageW - margin * 2;

    const partsList = Array.isArray(parts) ? parts : Object.entries(parts || {}).map(([id, item]) => ({ id, ...item }));
    if (partsList.length === 0) {
        throw new Error('No se pueden generar cotizaciones con la lista de repuestos vacía.');
    }

    const financials = calculateQuoteFinancials(partsList);

    let quoteNum;
    if (quoteNumber) {
        quoteNum = String(quoteNumber).startsWith('COT-') ? String(quoteNumber) : `COT-${quoteNumber}`;
    } else {
        const consecutive = getNextConsecutive();
        quoteNum = consecutive.formatted;
        if (incrementConsecutive) {
            commitConsecutiveIncrement();
        }
    }

    const vehicleLabels = { standard: 'Runner', runner: 'Runner', npr: 'NPR', agrale: 'Agrale' };
    const vehicleKey = String(vehicleType).toLowerCase();
    const vehicleName = vehicleLabels[vehicleKey] || (vehicleType ? vehicleType.toUpperCase() : 'GENERAL');
    const now = new Date();
    const responsibleUser = quoteUser || 'Natalia Ospina';

    // ── 1. Encabezado Premium Superior ───────────────────────────────────────
    doc.setFillColor(...PALETTE.DARK);
    doc.rect(0, 0, pageW, 38, 'F');

    // Acento decorativo verde SAO6
    doc.setFillColor(...PALETTE.PRIMARY);
    doc.rect(0, 38, pageW, 2.5, 'F');

    // Renderizado del Logo o Fallback Vectorial
    let logoRendered = false;
    if (logoDataUrl) {
        try {
            doc.setFillColor(...PALETTE.WHITE);
            doc.roundedRect(margin, 8, 22, 22, 3, 3, 'F');
            doc.addImage(logoDataUrl, 'PNG', margin + 1, 9, 20, 20);
            logoRendered = true;
        } catch {
            logoRendered = false;
        }
    }

    if (!logoRendered) {
        doc.setFillColor(...PALETTE.PRIMARY);
        doc.roundedRect(margin, 8, 22, 22, 3.5, 3.5, 'F');
        doc.setTextColor(...PALETTE.WHITE);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text('S6', margin + 11, 22.5, { align: 'center' });
    }

    // Datos Institucionales SAO6
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13.5);
    doc.setTextColor(...PALETTE.WHITE);
    doc.text('SISTEMA ALIMENTADOR ORIENTAL S.A.S', margin + 27, 15);

    doc.setFontSize(8.2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 215, 230);
    doc.text('Empresa: SAO6 S.A.S.  |  NIT: 900566324', margin + 27, 21.5);
    doc.text('Dirección: Carrera 56 # 62-50, Medellin, Colombia', margin + 27, 27);

    // Bloque derecho: Consecutivo y Fecha
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...PALETTE.WHITE);
    doc.text(quoteNum, pageW - margin, 15, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(200, 215, 230);
    const dateFormatted = quoteDate ? `Fecha: ${quoteDate}` : `Fecha: ${now.toLocaleDateString('es-CO')} ${now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`;
    doc.text(dateFormatted, pageW - margin, 21.5, { align: 'right' });

    // ── 2. Ficha de Datos / Metadatos ────────────────────────────────────────
    let y = 46;
    doc.setFillColor(...PALETTE.LIGHT);
    doc.setDrawColor(...PALETTE.BORDER);
    doc.roundedRect(margin, y, contentW, 16, 2, 2, 'FD');

    // Metadato 1: Vehículo y Unidad
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...PALETTE.MUTED);
    doc.text('LÍNEA / MODELO VEHÍCULO', margin + 5, y + 5.5);
    let busFormatted = '';
    if (busNumber) {
        const b = String(busNumber).trim();
        if (b.toUpperCase().startsWith('UNIDAD')) {
            busFormatted = b;
        } else if (b.toUpperCase().startsWith('BUS')) {
            busFormatted = b.replace(/^bus[\s:\-_]*/i, 'Unidad: ');
        } else {
            busFormatted = `Unidad: ${b}`;
        }
    }
    const vehicleDisplay = busFormatted ? `${vehicleName}  |  ${busFormatted}` : vehicleName;
    doc.setFontSize(9);
    doc.setTextColor(...PALETTE.DARK);
    doc.text(vehicleDisplay, margin + 5, y + 11.5);

    // Metadato 2: Moneda
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...PALETTE.MUTED);
    doc.text('DIVISA BASE', pageW - margin - 5, y + 5.5, { align: 'right' });
    doc.setFontSize(9);
    doc.setTextColor(...PALETTE.DARK);
    doc.text('COP (Pesos Colombianos)', pageW - margin - 5, y + 11.5, { align: 'right' });

    // ── 3. Tabla Dinámica de Repuestos ───────────────────────────────────────
    y += 22;

    const cols = {
        item: { x: margin, w: 10, label: '#', align: 'center' },
        ref: { x: margin + 10, w: 28, label: 'REFERENCIA', align: 'left' },
        desc: { x: margin + 38, w: 74, label: 'DESCRIPCIÓN', align: 'left' },
        qty: { x: margin + 112, w: 16, label: 'CANT.', align: 'center' },
        price: { x: margin + 128, w: 26, label: 'UNITARIO', align: 'right' },
        total: { x: margin + 154, w: 28, label: 'VALOR TOTAL', align: 'right' },
    };

    const headerHeight = 7.5;
    const drawTableHeader = (cursorY) => {
        doc.setFillColor(...PALETTE.DARK);
        doc.rect(margin, cursorY, contentW, headerHeight, 'F');
        doc.setTextColor(...PALETTE.WHITE);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');

        Object.values(cols).forEach(col => {
            const textX = col.align === 'right' ? col.x + col.w : col.align === 'center' ? col.x + (col.w / 2) : col.x + 2;
            doc.text(col.label, textX, cursorY + 5.2, { align: col.align });
        });
    };

    drawTableHeader(y);
    y += headerHeight;

    const rowHeight = 9;

    partsList.forEach((part, index) => {
        const qty = Number(part.qty) || 1;
        const validPrice = typeof part.price === 'number' && part.price > 0;
        const lineTotal = validPrice ? part.price * qty : 0;

        // Salto de página preventivo para la tabla
        if (y + rowHeight > pageH - 65) {
            doc.addPage();
            y = 20;
            drawTableHeader(y);
            y += headerHeight;
        }

        // Fondo alternado
        doc.setFillColor(...(index % 2 === 0 ? PALETTE.WHITE : PALETTE.LIGHT));
        doc.rect(margin, y, contentW, rowHeight, 'F');

        // Borde inferior sutil
        doc.setDrawColor(...PALETTE.BORDER);
        doc.line(margin, y + rowHeight, pageW - margin, y + rowHeight);

        // Columna #: Índice
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...PALETTE.MUTED);
        doc.text(String(index + 1), cols.item.x + (cols.item.w / 2), y + 5.8, { align: 'center' });

        // Columna Referencia
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...PALETTE.PRIMARY_DARK);
        doc.text(String(part.baseId || part.code || part.id || 'N/A'), cols.ref.x + 2, y + 5.8);

        // Columna Descripción (Truncado limpio)
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...PALETTE.TEXT);
        const rawName = String(part.name || part.id || 'Pieza sin descripción').replace(/_/g, ' ');
        const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
        const descLines = doc.splitTextToSize(cleanName, cols.desc.w - 4);
        doc.text(descLines[0], cols.desc.x + 2, y + 5.8);

        // Columna Cantidad
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...PALETTE.DARK);
        doc.text(String(qty), cols.qty.x + (cols.qty.w / 2), y + 5.8, { align: 'center' });

        // Columna Precio Unitario
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...PALETTE.TEXT);
        doc.text(validPrice ? formatCOP(part.price) : 'Por cotizar', cols.price.x + cols.price.w, y + 5.8, { align: 'right' });

        // Columna Total Línea
        doc.setFont('helvetica', 'bold');
        if (validPrice) {
            doc.setTextColor(...PALETTE.DARK);
            doc.text(formatCOP(lineTotal), cols.total.x + cols.total.w, y + 5.8, { align: 'right' });
        } else {
            doc.setTextColor(...PALETTE.MUTED);
            doc.text('—', cols.total.x + cols.total.w, y + 5.8, { align: 'right' });
        }

        y += rowHeight;
    });

    // ── 4. Bloque Inferior: Resumen Financiero ────────────────────────────────
    // Control de salto si el bloque de cierre no cabe (requiere 62mm)
    if (y + 62 > pageH - 22) {
        doc.addPage();
        y = 20;
    }

    y += 6;

    const totalBoxW = 90;
    const totalBoxX = pageW - margin - totalBoxW;
    const totalBoxH = 52;

    // Caja de Resumen Financiero Desglosado (Opción 4: Subtotal arriba de Costo total repuesto, AI 35%, MO 30%)
    doc.setFillColor(...PALETTE.WHITE);
    doc.setDrawColor(...PALETTE.BORDER);
    doc.roundedRect(totalBoxX, y, totalBoxW, totalBoxH, 2, 2, 'FD');

    let rowY = y + 7;
    const renderFinancialRow = (label, valText, isBold = false) => {
        doc.setFont('helvetica', isBold ? 'bold' : 'normal');
        doc.setFontSize(7.8);
        doc.setTextColor(...(isBold ? PALETTE.DARK : PALETTE.MUTED));
        doc.text(label, totalBoxX + 4, rowY);
        doc.text(valText, totalBoxX + totalBoxW - 4, rowY, { align: 'right' });
        rowY += 6.5;
    };

    renderFinancialRow('Subtotal:', formatCOP(financials.subtotal));
    renderFinancialRow('Costo total repuesto:', formatCOP(financials.costoTotalRepuesto));
    renderFinancialRow('AI (35%):', formatCOP(financials.ai));
    renderFinancialRow('Mano de obra (30%):', formatCOP(financials.manoDeObra));
    renderFinancialRow('Piezas cotizadas:', `${financials.itemsCount} und`);

    // Banner Destacado Total Final
    doc.setFillColor(...PALETTE.PRIMARY);
    doc.roundedRect(totalBoxX, rowY - 1.5, totalBoxW, 11, 2, 2, 'F');
    doc.setTextColor(...PALETTE.WHITE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('TOTAL:', totalBoxX + 4, rowY + 5.5);
    doc.setFontSize(10.5);
    doc.text(formatCOP(financials.totalLiquidacion), totalBoxX + totalBoxW - 4, rowY + 5.8, { align: 'right' });

    // ── 5. Pie de Página Numerado Dinámico ────────────────────────────────────
    const totalPages = doc.internal.getNumberOfPages();
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        doc.setPage(pageNum);
        doc.setDrawColor(...PALETTE.BORDER);
        doc.line(margin, pageH - 12, pageW - margin, pageH - 12);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...PALETTE.MUTED);
        doc.text('SISTEMA ALIMENTADOR ORIENTAL S.A.S • NIT: 900566324 • Carrera 56 # 62-50', margin, pageH - 7);
        doc.text(`Página ${pageNum} de ${totalPages}`, pageW - margin, pageH - 7, { align: 'right' });
    }

    const fileName = `Cotizacion_${quoteNum}_${vehicleName}_${now.toISOString().slice(0, 10)}.pdf`;
    return { doc, fileName, financials };
}

// ─── ACCIONES DIRECTAS DE USUARIO (EXPORTADAS) ──────────────────────────────

/**
 * Genera el documento y activa la descarga automática en el navegador.
 * @param {Object} options
 */
export async function downloadQuotePDF(options) {
    const shouldIncrement = (options && options.incrementConsecutive !== undefined)
        ? options.incrementConsecutive
        : (!options || !options.quoteNumber);
    const { doc, fileName } = await buildQuotePDF({ ...options, incrementConsecutive: shouldIncrement });
    doc.save(fileName);
}

/**
 * Genera el blob del PDF para inyección en iframe de vista previa.
 * @param {Object} options
 * @returns {Promise<{blobUrl: string, fileName: string}>}
 */
export async function getQuotePDFBlobUrl(options) {
    const { doc, fileName } = await buildQuotePDF({ ...options, incrementConsecutive: false });
    const blob = doc.output('blob');
    const blobUrl = URL.createObjectURL(blob);
    return { blobUrl, fileName };
}

// Registro global en window para consumo desde cualquier script inline
window.buildQuotePDF = buildQuotePDF;
window.downloadQuotePDF = downloadQuotePDF;
window.getQuotePDFBlobUrl = getQuotePDFBlobUrl;
window.ensureJsPdfLoaded = ensureJsPdfLoaded;
