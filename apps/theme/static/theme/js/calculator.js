// Estado global
let selectedParts = {}; // Formato: { "partId": { name: "Name", price: 150, qty: 1 } }

document.addEventListener("DOMContentLoaded", () => {
    // Cargar vista inicial
    changeView('Izquierdo', document.querySelector('.view-btn.active'));
});

/**
 * Cambia la vista del vehículo
 */
let currentVehicleType = 'standard';
let currentViewName = 'Izquierdo';

function changeVehicle(vehicleType, buttonElement) {
    currentVehicleType = vehicleType;
    document.querySelectorAll('.vehicle-btn').forEach(btn => btn.classList.remove('active'));
    if (buttonElement) buttonElement.classList.add('active');

    // Recargar la vista actual con el nuevo vehículo
    const activeViewBtn = document.querySelector('.view-controls .view-btn.active:not(.vehicle-btn)');
    if (activeViewBtn) {
        changeView(activeViewBtn.innerText.trim(), activeViewBtn);
    } else {
        changeView('Izquierdo');
    }
}

function changeView(viewName, buttonElement = null) {
    currentViewName = viewName;
    if (!buttonElement) {
        const buttons = document.querySelectorAll('.view-controls .view-btn:not(.vehicle-btn)');
        buttons.forEach(btn => {
            if (btn.innerText.includes(viewName)) {
                buttonElement = btn;
            }
        });
    }

    if (buttonElement) {
        document.querySelectorAll('.view-controls .view-btn:not(.vehicle-btn)').forEach(btn => btn.classList.remove('active'));
        buttonElement.classList.add('active');
    }

    if (typeof STATIC_BASE_URL !== 'undefined') {
        let folder = 'Igm-Svg';
        let fileName = viewName;

        if (currentVehicleType === 'npr') {
            folder = 'img-npr';
            fileName = viewName + 'Npr';
        } else if (currentVehicleType === 'agrale') {
            folder = 'img-agrale';
            fileName = viewName + 'Agrale';
        }

        const timestamp = new Date().getTime();
        loadInteractiveSVG(`${STATIC_BASE_URL}${folder}/${fileName}.svg?v=${timestamp}`, "svgWrapper");
    }
}

/**
 * Carga un SVG desde una URL y lo inyecta en el contenedor.
 */
function loadInteractiveSVG(svgUrl, containerId) {
    fetch(svgUrl)
        .then(response => response.text())
        .then(svgText => {
            const container = document.getElementById(containerId);
            container.innerHTML = svgText;
            const svg = container.querySelector('svg');

            // Solución para imágenes base64 dentro de patrones (bug de renderizado al inyectar SVG)
            const patterns = svg.querySelectorAll('pattern');
            patterns.forEach(pattern => {
                const use = pattern.querySelector('use');
                if (use) {
                    let href = use.getAttribute('href') || use.getAttribute('xlink:href');
                    if (href && href.startsWith('#')) {
                        const imgDef = svg.querySelector(`[id="${href.substring(1)}"]`);
                        if (imgDef && imgDef.tagName.toLowerCase() === 'image') {
                            const patternId = pattern.getAttribute('id');
                            // querySelectorAll falla si hay espacios en el atributo fill, por lo que buscamos todos los rects
                            const rects = svg.querySelectorAll('rect');
                            rects.forEach(rect => {
                                const fill = rect.getAttribute('fill');
                                if (fill && fill.includes(`url(#${patternId})`)) {
                                    const newImg = document.createElementNS('http://www.w3.org/2000/svg', 'image');
                                    Array.from(rect.attributes).forEach(attr => {
                                        if (attr.name !== 'fill') {
                                            newImg.setAttribute(attr.name, attr.value);
                                        }
                                    });
                                    newImg.setAttribute('preserveAspectRatio', 'none');
                                    newImg.setAttribute('href', imgDef.getAttribute('href') || imgDef.getAttribute('xlink:href'));
                                    rect.parentNode.replaceChild(newImg, rect);
                                }
                            });
                        }
                    }
                }
            });

            initSVGInteractivity(svg);
        })
        .catch(error => console.error("Error al cargar el SVG:", error));
}

/**
 * Genera un precio constante para una pieza basado en su nombre
 */
function getPriceForPart(partId) {
    let hash = 0;
    for (let i = 0; i < partId.length; i++) {
        hash = partId.charCodeAt(i) + ((hash << 5) - hash);
    }
    return Math.abs(hash) % 900 + 100;
}

/**
 * Añade clases y eventos a los elementos del SVG
 */
function initSVGInteractivity(svgElement) {
    if (!svgElement) return;

    svgElement.setAttribute('width', '100%');
    svgElement.setAttribute('height', 'auto');
    svgElement.removeAttribute('preserveAspectRatio');

    const parts = svgElement.querySelectorAll('path, ellipse, polygon, circle');

    parts.forEach(part => {
        part.classList.add('part-interactive');
        let rawId = part.id || "";
        let uniqueId = rawId;

        // Si no hay ID, creamos uno determinista basado en su grupo padre
        if (!uniqueId && part.parentElement && part.parentElement.tagName === 'g' && part.parentElement.id) {
            const index = Array.from(part.parentElement.children).indexOf(part);
            uniqueId = part.parentElement.id + "_p" + index;
        } else if (!uniqueId) {
            // Si está suelto y sin id, no lo hacemos interactivo
            part.classList.remove('part-interactive');
            return;
        }

        // Extraemos el ID base (limpiando _2, _3, _p0, etc.) para consultar la BD
        let baseId = uniqueId.replace(/(_\d+)?(_p\d+)?$/, '');

        // Creamos un ID global para que las selecciones no choquen entre vistas (ej: Derecho vs Izquierdo)
        let globalId = `${currentVehicleType}_${currentViewName}_${uniqueId}`;

        // Guardamos el globalId en el elemento para poder buscarlo después
        part.setAttribute('data-part-id', globalId);

        // Restaurar estado si la pieza ya estaba seleccionada
        if (selectedParts[globalId]) {
            part.classList.add('selected');
        }

        // Eventos de clic (Toggle)
        part.addEventListener('click', (e) => {
            console.log("Clic detectado en:", uniqueId, "-> Global ID:", globalId, "-> Consultando BD con:", baseId);

            if (part.classList.contains('selected')) {
                part.classList.remove('selected');
                delete selectedParts[globalId];
                renderCart();
            } else {
                part.classList.add('selected');

                // 1. Mostrar pieza en carrito YA con spinner (feedback instantáneo)
                selectedParts[globalId] = {
                    baseId: baseId,
                    name: baseId,
                    price: 'loading',
                    qty: 1
                };
                renderCart();

                // 2. Consultar precio a la API
                fetch(`/api/get-price/?code=${encodeURIComponent(baseId)}`)
                    .then(response => {
                        if (!response.ok) throw new Error('No encontrado');
                        return response.json();
                    })
                    .then(data => {
                        selectedParts[globalId] = {
                            baseId: baseId,
                            name: data.name,
                            price: (data.price && data.price > 0) ? data.price : null,
                            qty: selectedParts[globalId]?.qty || 1
                        };
                        renderCart();
                    })
                    .catch(() => {
                        selectedParts[globalId] = {
                            baseId: baseId,
                            name: baseId,
                            price: null,
                            qty: selectedParts[globalId]?.qty || 1
                        };
                        renderCart();
                    });
            }
        });
    });
}

/**
 * Formatea un número a pesos colombianos (COP)
 */
function formatCurrency(value) {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(value);
}

/**
 * Actualiza la cantidad de una pieza en el carrito
 */
function updateQty(partId, value) {
    const qty = Math.max(1, parseInt(value) || 1);
    if (selectedParts[partId]) {
        selectedParts[partId].qty = qty;
        renderCart();
    }
}

/**
 * Función para borrar una pieza directamente desde el carrito
 */
function removePartFromCart(partId) {
    delete selectedParts[partId];

    // Buscar si el elemento SVG está actualmente renderizado y quitarle la clase "selected"
    const svgPart = document.querySelector(`[data-part-id="${partId}"]`);
    if (svgPart) {
        svgPart.classList.remove('selected');
    }

    renderCart();
}

/**
 * Actualiza la UI del carrito/cotización
 */
function renderCart() {
    const container = document.getElementById('cartItemsContainer');
    const totalEl = document.getElementById('cartTotalValue');
    const totalContainer = document.getElementById('cartTotalContainer');

    const partIds = Object.keys(selectedParts);

    if (partIds.length === 0) {
        container.innerHTML = '<p class="empty-cart-msg">Aún no has seleccionado piezas.</p>';
        totalEl.innerText = formatCurrency(0);
        totalContainer.style.display = 'none';
        return;
    }

    let html = '';
    let total = 0;

    partIds.forEach(id => {
        const part = selectedParts[id];
        const qty = part.qty || 1;

        const isLoading = part.price === 'loading';
        const hasPrice = !isLoading && part.price !== null && part.price !== undefined;
        if (hasPrice) total += part.price * qty;

        let precioHtml;
        if (isLoading) {
            precioHtml = `<span class="price-loading">Consultando...</span>`;
        } else if (hasPrice) {
            precioHtml = `<span style="font-weight: 700; font-size: 0.85rem; color: var(--color-texto-dark); white-space: nowrap;">${formatCurrency(part.price)}</span>`;
        } else {
            precioHtml = `<span style="font-size: 0.75rem; color: #aaa; font-style: italic; white-space: nowrap;">Sin precio</span>`;
        }

        html += `
            <div class="cart-item">
                <span class="cart-item-name" style="font-size: 0.85rem; flex: 1; min-width: 0;">
                    <strong style="color: var(--color-primario); display: block; margin-bottom: 2px; font-size: 0.78rem;">Ref: ${part.baseId}</strong>
                    <span style="display: block; overflow: hidden; text-overflow: ellipsis;">${part.name.replace(/_/g, ' ')}</span>
                </span>
                <div style="display: flex; align-items: center; gap: 8px; margin-left: 8px; flex-shrink: 0;">
                    <input 
                        type="number" 
                        min="1" 
                        value="${qty}"
                        onchange="updateQty('${id}', this.value)"
                        style="width: 46px; padding: 3px 5px; border: 1px solid var(--color-borde); border-radius: 6px; font-size: 0.8rem; text-align: center; background: var(--color-fondo-soft);"
                        title="Cantidad"
                    />
                    ${precioHtml}
                    <button onclick="removePartFromCart('${id}')" 
                            style="background: none; border: none; cursor: pointer; color: #ff4757; font-size: 1.1rem; padding: 0;" 
                            title="Quitar pieza">
                        &times;
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    totalEl.innerText = formatCurrency(total);
    totalContainer.style.display = 'flex';
}

/**
 * Helpers y generador de PDF de cotización corporativo con jsPDF
 */

function canBuildQuote() {
    const partIds = Object.keys(selectedParts);
    if (partIds.length === 0) {
        alert('Agrega al menos una pieza antes de generar o previsualizar el presupuesto.');
        return false;
    }
    return true;
}

function withJsPDF(callback) {
    if (window.jspdf && window.jspdf.jsPDF) {
        callback();
    } else {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = () => callback();
        script.onerror = () => alert('Error al cargar la librería de PDF. Verifica tu conexión a internet.');
        document.head.appendChild(script);
    }
}

/**
 * Obtiene o incrementa el número consecutivo de cotización guardado localmente
 */
function getNextQuoteConsecutive() {
    const KEY = 'sao6_quote_consecutive';
    let current = parseInt(localStorage.getItem(KEY), 10);
    if (isNaN(current) || current < 1) {
        current = 1;
    }
    const year = new Date().getFullYear();
    const formatted = `COT-${year}-${String(current).padStart(4, '0')}`;
    return { formatted, current, key: KEY };
}

function incrementQuoteConsecutive() {
    const { current, key } = getNextQuoteConsecutive();
    localStorage.setItem(key, String(current + 1));
}

/**
 * Cache del logo cargado en memoria para generación instantánea en móviles
 */
let sao6LogoCachedImage = null;

function preloadLogo(callback) {
    if (sao6LogoCachedImage) {
        if (callback) callback(sao6LogoCachedImage);
        return;
    }
    const logoUrl = (typeof SAO6_LOGO_URL !== 'undefined' && SAO6_LOGO_URL) 
        ? SAO6_LOGO_URL 
        : ((typeof STATIC_BASE_URL !== 'undefined') ? `${STATIC_BASE_URL}logo_sao6.png.ico` : '/static/assets/logo_sao6.png.ico');

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = function () {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width || 64;
            canvas.height = img.naturalHeight || img.height || 64;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            sao6LogoCachedImage = canvas.toDataURL('image/png');
        } catch (e) {
            sao6LogoCachedImage = img;
        }
        if (callback) callback(sao6LogoCachedImage);
    };
    img.onerror = function () {
        sao6LogoCachedImage = null;
        if (callback) callback(null);
    };
    img.src = logoUrl;
}

// Iniciar precarga temprana
document.addEventListener("DOMContentLoaded", () => {
    preloadLogo();
});

/**
 * Salario Mínimo Mensual Legal Vigente (Colombia)
 * 2 SMMLV de referencia para la condición de aseguradora
 */
const SMMLV_COLOMBIA = 1423500; // SMMLV (ajustable)
const DOS_SMMLV = SMMLV_COLOMBIA * 2; // $2.847.000 COP

/**
 * Construye el documento PDF con diseño corporativo premium
 * Retorna { doc, fileName }
 */
function buildQuotePDF(options = { incrementConsecutive: false }) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentW = pageW - margin * 2;

    // Paleta corporativa SAO6
    const C_PRIMARY = [0, 180, 75];       // Verde esmeralda SAO6
    const C_PRIMARY_DARK = [0, 130, 55];  // Verde oscuro
    const C_DARK = [24, 30, 42];          // Azul medianoche / antracita
    const C_TEXT = [45, 55, 72];          // Gris oscuro legible
    const C_MUTED = [115, 128, 142];      // Gris secundario
    const C_LIGHT = [247, 249, 251];      // Fondo filas alternadas
    const C_BORDER = [226, 232, 240];     // Bordes sutiles
    const C_SEVERO = [217, 48, 37];       // Rojo severo
    const C_LEVE = [24, 134, 75];         // Verde leve

    const now = new Date();
    const consecInfo = getNextQuoteConsecutive();
    const quoteNum = consecInfo.formatted;

    if (options.incrementConsecutive) {
        incrementQuoteConsecutive();
    }

    const vehicleNames = { standard: 'Runner', npr: 'NPR', agrale: 'Agrale' };
    const vehicleLabel = vehicleNames[currentVehicleType] || currentVehicleType.toUpperCase();

    // ── 1. Encabezado Premium Superior con Datos de la Empresa ──────────────
    doc.setFillColor(...C_DARK);
    doc.rect(0, 0, pageW, 38, 'F');

    // Acento decorativo verde
    doc.setFillColor(...C_PRIMARY);
    doc.rect(0, 38, pageW, 2.5, 'F');

    // Logo SAO6 (Si está cargado lo renderiza, si no dibuja el badge de respaldo)
    let logoRendered = false;
    if (sao6LogoCachedImage) {
        try {
            doc.setFillColor(255, 255, 255);
            doc.roundedRect(margin, 8, 22, 22, 3, 3, 'F');
            doc.addImage(sao6LogoCachedImage, 'PNG', margin + 1, 9, 20, 20);
            logoRendered = true;
        } catch (e) {
            logoRendered = false;
        }
    }

    if (!logoRendered) {
        // Badge Logo alternativo "S6"
        doc.setFillColor(...C_PRIMARY);
        doc.roundedRect(margin, 8, 22, 22, 3.5, 3.5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text('S6', margin + 11, 22.5, { align: 'center' });
    }

    // Información Empresarial (SAO6)
    doc.setFontSize(14);
    doc.text('SISTEMA ALIMENTADOR ORIENTAL S.A.S', margin + 27, 15);

    doc.setFontSize(8.2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(200, 215, 230);
    doc.text('Empresa: Sao6  |  NIT: 900566324', margin + 27, 21.5);
    doc.text('Dirección: Carrera 56 # 62-50', margin + 27, 27);

    // Bloque derecho: No. Cotización Consecutivo y Fechas
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(quoteNum, pageW - margin, 15, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(200, 215, 230);
    doc.text(`Fecha: ${now.toLocaleDateString('es-CO')}  ${now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`, pageW - margin, 21.5, { align: 'right' });

    // ── 2. Ficha de Datos / Metadata ───────────────────────────────────────
    let y = 46;
    doc.setFillColor(...C_LIGHT);
    doc.setDrawColor(...C_BORDER);
    doc.roundedRect(margin, y, contentW, 16, 2, 2, 'FD');

    // Columna 1: Información del Vehículo
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...C_MUTED);
    doc.text('LÍNEA / MODELO VEHÍCULO', margin + 5, y + 5.5);

    doc.setFontSize(9.5);
    doc.setTextColor(...C_DARK);
    doc.text(vehicleLabel, margin + 5, y + 11.5);

    // Columna 2: Moneda
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...C_MUTED);
    doc.text('MONEDA', pageW - margin - 5, y + 5.5, { align: 'right' });

    doc.setFontSize(9);
    doc.setTextColor(...C_DARK);
    doc.text('COP (Pesos Colombianos)', pageW - margin - 5, y + 11.5, { align: 'right' });

    // ── 3. Tabla de Piezas ──────────────────────────────────────────────────
    y += 22;

    const cols = {
        item:  { x: margin,       w: 10, label: '#',           align: 'center' },
        ref:   { x: margin + 10,  w: 28, label: 'REFERENCIA',  align: 'left'   },
        desc:  { x: margin + 38,  w: 74, label: 'DESCRIPCIÓN', align: 'left'   },
        qty:   { x: margin + 112, w: 16, label: 'CANT.',       align: 'center' },
        price: { x: margin + 128, w: 26, label: 'UNITARIO',    align: 'right'  },
        total: { x: margin + 154, w: 28, label: 'VALOR TOTAL', align: 'right'  },
    };

    // Cabecera de la tabla
    const headerHeight = 7.5;
    doc.setFillColor(...C_DARK);
    doc.rect(margin, y, contentW, headerHeight, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');

    Object.values(cols).forEach(col => {
        const textX = col.align === 'right' ? col.x + col.w : col.align === 'center' ? col.x + (col.w / 2) : col.x + 2;
        doc.text(col.label, textX, y + 5.2, { align: col.align });
    });

    y += headerHeight;

    const partIds = Object.keys(selectedParts);
    let costoRepuestos = 0;
    let itemsCount = 0;
    let missingPricesCount = 0;

    partIds.forEach((id, index) => {
        const part = selectedParts[id];
        const qty = part.qty || 1;
        const hasPrice = part.price !== null && part.price !== undefined && part.price !== 'loading' && part.price > 0;
        const lineTotal = hasPrice ? part.price * qty : 0;
        if (hasPrice) {
            costoRepuestos += lineTotal;
        } else {
            missingPricesCount++;
        }
        itemsCount += qty;

        const rowHeight = 9;

        // Comprobar salto de página
        if (y + rowHeight > pageH - 65) {
            doc.addPage();
            y = 20;

            // Repetir cabecera en nueva página
            doc.setFillColor(...C_DARK);
            doc.rect(margin, y, contentW, headerHeight, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(7.5);
            doc.setFont('helvetica', 'bold');
            Object.values(cols).forEach(col => {
                const textX = col.align === 'right' ? col.x + col.w : col.align === 'center' ? col.x + (col.w / 2) : col.x + 2;
                doc.text(col.label, textX, y + 5.2, { align: col.align });
            });
            y += headerHeight;
        }

        // Fondo alternado
        doc.setFillColor(...(index % 2 === 0 ? [255, 255, 255] : C_LIGHT));
        doc.rect(margin, y, contentW, rowHeight, 'F');

        // Borde inferior sutil
        doc.setDrawColor(...C_BORDER);
        doc.line(margin, y + rowHeight, pageW - margin, y + rowHeight);

        // Número de ítem
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...C_MUTED);
        doc.text(String(index + 1), cols.item.x + (cols.item.w / 2), y + 5.8, { align: 'center' });

        // Referencia
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...C_PRIMARY_DARK);
        doc.text(part.baseId || id, cols.ref.x + 2, y + 5.8);

        // Descripción
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...C_TEXT);
        const rawName = (part.name || id).replace(/_/g, ' ');
        const cleanName = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
        const descLines = doc.splitTextToSize(cleanName, cols.desc.w - 4);
        doc.text(descLines[0], cols.desc.x + 2, y + 5.8);

        // Cantidad
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...C_DARK);
        doc.text(String(qty), cols.qty.x + (cols.qty.w / 2), y + 5.8, { align: 'center' });

        // Precio unitario
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...C_TEXT);
        doc.text(hasPrice ? formatCurrency(part.price) : 'Por cotizar', cols.price.x + cols.price.w, y + 5.8, { align: 'right' });

        // Total línea
        doc.setFont('helvetica', 'bold');
        if (hasPrice) {
            doc.setTextColor(...C_DARK);
            doc.text(formatCurrency(lineTotal), cols.total.x + cols.total.w, y + 5.8, { align: 'right' });
        } else {
            doc.setTextColor(...C_MUTED);
            doc.text('—', cols.total.x + cols.total.w, y + 5.8, { align: 'right' });
        }

        y += rowHeight;
    });

    // ── 4. Cálculos Financieros: Subtotal 15% y Mano de Obra 30% ────────────
    const recargoSubtotal = costoRepuestos * 0.15; // 15%
    const manoDeObra = costoRepuestos * 0.30;     // 30%
    const totalLiquidacion = costoRepuestos + recargoSubtotal + manoDeObra;

    // Condición de 2 SMMLV para la Aseguradora
    const esMayorAseguradora = costoRepuestos >= DOS_SMMLV;
    const etiquetaSeveridad = esMayorAseguradora ? 'Severo' : 'Leve';

    // Si no queda espacio suficiente para el bloque de totales y notas, saltar página
    if (y + 60 > pageH - 22) {
        doc.addPage();
        y = 20;
    }

    y += 5;

    // Caja de Totales y Liquidación a la derecha
    const totalBoxW = 90;
    const totalBoxX = pageW - margin - totalBoxW;

    // ── Resumen Financiero Desglosado a la Derecha ─────────────────────────
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...C_BORDER);
    doc.roundedRect(totalBoxX, y, totalBoxW, 46, 2, 2, 'FD');

    let ty = y + 7;
    const addFinancialRow = (label, valueStr, isBold = false) => {
        doc.setFont('helvetica', isBold ? 'bold' : 'normal');
        doc.setFontSize(7.8);
        doc.setTextColor(...(isBold ? C_DARK : C_MUTED));
        doc.text(label, totalBoxX + 4, ty);
        doc.text(valueStr, totalBoxX + totalBoxW - 4, ty, { align: 'right' });
        ty += 6.5;
    };

    addFinancialRow('Costo Repuestos:', formatCurrency(costoRepuestos));
    addFinancialRow('Subtotal (15%):', formatCurrency(recargoSubtotal));
    addFinancialRow('Mano de obra (30%):', formatCurrency(manoDeObra));
    addFinancialRow('Piezas cotizadas:', `${itemsCount} und`);

    // Caja de Total Final
    doc.setFillColor(...C_PRIMARY);
    doc.roundedRect(totalBoxX, ty - 1.5, totalBoxW, 11, 2, 2, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('TOTAL:', totalBoxX + 4, ty + 5.5);
    doc.setFontSize(10.5);
    doc.text(formatCurrency(totalLiquidacion), totalBoxX + totalBoxW - 4, ty + 5.8, { align: 'right' });

    // ── 5. Pie de página profesional en cada página ─────────────────────────
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setDrawColor(...C_BORDER);
        doc.line(margin, pageH - 12, pageW - margin, pageH - 12);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...C_MUTED);
        doc.text('SISTEMA ALIMENTADOR ORIENTAL S.A.S • NIT: 900566324 • Carrera 56 # 62-50', margin, pageH - 7);
        doc.text(`Página ${i} de ${pageCount}`, pageW - margin, pageH - 7, { align: 'right' });
    }

    const fileName = `Cotizacion_${quoteNum}_${vehicleLabel}_${now.toISOString().slice(0, 10)}.pdf`;
    return { doc, fileName };
}

/**
 * Genera y descarga el PDF de cotización usando jsPDF e incrementa consecutivo
 */
function generatePDF() {
    if (!canBuildQuote()) return;

    withJsPDF(function () {
        preloadLogo(function () {
            const { doc, fileName } = buildQuotePDF({ incrementConsecutive: true });
            doc.save(fileName);
        });
    });
}



