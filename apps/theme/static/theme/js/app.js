/**
 * @file app.js
 * @description Orquestador principal de la UI para la Calculadora de Autopartes de SAO6 S.A.S.
 * Gestiona el estado reactivo, la interactividad de los diagramas SVG, la sincronización
 * del carrito, el almacenamiento local temporal (localStorage) y el resalte
 * visual automático de piezas al editar cotizaciones.
 */

import { 
    fetchPartPrice, 
    cancelAllPendingRequests, 
    cancelPendingRequest 
} from './api.js';

import { 
    downloadQuotePDF, 
    getQuotePDFBlobUrl, 
    formatCOP 
} from './pdfGenerator.js?v=20261028_3';

// ─── CLAVES DE PERSISTENCIA EN LOCALSTORAGE ──────────────────────────────────

const DRAFT_PARTS_KEY = 'sao6_calc_draft_parts';
const DRAFT_BUS_KEY = 'sao6_calc_draft_bus';
const DRAFT_VEHICLE_KEY = 'sao6_calc_draft_vehicle';
const DRAFT_VIEW_KEY = 'sao6_calc_draft_view';

// ─── ESTADO CENTRALIZADO DE LA APLICACIÓN ────────────────────────────────────

const VEHICLE_LABELS = {
    standard: 'Runner',
    runner: 'Runner',
    npr: 'NPR',
    agrale: 'Agrale'
};

const state = {
    currentVehicleType: 'standard', // 'standard' (Runner) | 'npr' | 'agrale'
    currentBusNumber: '',           // Número de móvil / bus asignado (ej: '165')
    currentBusLine: 'Runner',       // Nombre legible de la línea (ej: 'Runner', 'NPR', 'Agrale')
    currentViewName: 'Izquierdo',   // 'Izquierdo' | 'Derecho' | 'Frontal' | 'Posterior'
    /**
     * Mapa de piezas seleccionadas:
     * {
     *   [globalId]: { 
     *     baseId: string, 
     *     name: string, 
     *     price: number|'loading'|null, 
     *     qty: number,
     *     viewName: string,
     *     vehicleType: string,
     *     globalId: string 
     *   }
     * }
     */
    selectedParts: {}
};

// ─── GESTOR DE ALMACENAMIENTO LOCAL (LOCALSTORAGE) ──────────────────────────

/**
 * Guarda el borrador de piezas y vehículo en el localStorage para evitar
 * pérdidas ante recargas accidentales. No sobrescribe borradores si se está editando.
 */
export function saveDraftToStorage() {
    const isEditing = Boolean(typeof EDIT_QUOTE_DATA !== 'undefined' && EDIT_QUOTE_DATA && EDIT_QUOTE_DATA.id);
    if (isEditing) {
        return; // En modo edición de una cotización existente se preserva el borrador general
    }

    try {
        const busInput = document.getElementById('inputNumeroBus');
        const activeBus = (busInput && busInput.value.trim()) || state.currentBusNumber;

        if (activeBus) {
            localStorage.setItem(DRAFT_BUS_KEY, activeBus);
            localStorage.setItem(DRAFT_VEHICLE_KEY, state.currentVehicleType);
            localStorage.setItem(DRAFT_VIEW_KEY, state.currentViewName);
        }

        const partIds = Object.keys(state.selectedParts);
        if (partIds.length > 0) {
            localStorage.setItem(DRAFT_PARTS_KEY, JSON.stringify(state.selectedParts));
        } else {
            localStorage.removeItem(DRAFT_PARTS_KEY);
        }
    } catch (e) {
        console.warn('[SAO6] No se pudo guardar el borrador en localStorage:', e);
    }
}

/**
 * Borra las referencias y datos temporales de selección en localStorage
 * cuando el usuario termina y guarda la cotización, o limpia el carrito.
 */
export function clearDraftStorage() {
    try {
        localStorage.removeItem(DRAFT_PARTS_KEY);
        localStorage.removeItem(DRAFT_BUS_KEY);
        localStorage.removeItem(DRAFT_VEHICLE_KEY);
        localStorage.removeItem(DRAFT_VIEW_KEY);
    } catch (e) {
        console.warn('[SAO6] Error al limpiar localStorage:', e);
    }
}
window.clearDraftStorage = clearDraftStorage;

/**
 * Restaura el borrador guardado en localStorage si el usuario entra a una nueva cotización.
 * @returns {string|null} Nombre de la vista guardada o null si no había borrador.
 */
function restoreSavedDraft() {
    const isEditing = Boolean(typeof EDIT_QUOTE_DATA !== 'undefined' && EDIT_QUOTE_DATA && EDIT_QUOTE_DATA.id);
    if (isEditing) {
        return null;
    }

    try {
        const savedBus = localStorage.getItem(DRAFT_BUS_KEY);
        const savedVehicle = localStorage.getItem(DRAFT_VEHICLE_KEY) || 'standard';
        const savedView = localStorage.getItem(DRAFT_VIEW_KEY) || 'Izquierdo';

        if (savedBus) {
            state.currentBusNumber = savedBus;
            state.currentVehicleType = savedVehicle;
            const lineaLabel = VEHICLE_LABELS[savedVehicle] || 'Runner';
            state.currentBusLine = lineaLabel;

            const busInput = document.getElementById('inputNumeroBus');
            if (busInput) busInput.value = savedBus;

            actualizarTarjetaUnidadActiva(savedBus, lineaLabel, savedVehicle);

            const savedPartsJson = localStorage.getItem(DRAFT_PARTS_KEY);
            if (savedPartsJson) {
                const savedParts = JSON.parse(savedPartsJson);
                if (savedParts && Object.keys(savedParts).length > 0) {
                    state.selectedParts = savedParts;
                    renderCart();
                }
            }

            state.currentViewName = savedView;
            return savedView;
        }
    } catch (e) {
        console.warn('[SAO6] Error restaurando borrador de localStorage:', e);
    }
    return null;
}

/**
 * Vacía la selección activa de piezas y refresca la UI preservando la unidad asignada.
 */
export function clearCart() {
    if (confirm('¿Deseas vaciar todas las piezas seleccionadas y reiniciar el carrito?')) {
        state.selectedParts = {};
        try {
            localStorage.removeItem(DRAFT_PARTS_KEY);
        } catch (e) {}

        document.querySelectorAll('.part-interactive.selected').forEach(el => el.classList.remove('selected'));
        renderCart();
    }
}
window.clearCart = clearCart;

// ─── CONTROLADORES DE VEHÍCULO Y VISTA ───────────────────────────────────────

/**
 * Conmuta el tipo de vehículo activo y recarga la vista SVG actual.
 * @param {string} vehicleType - 'standard' | 'npr' | 'agrale'
 * @param {HTMLElement} [buttonElement]
 */
export function changeVehicle(vehicleType, buttonElement = null) {
    state.currentVehicleType = vehicleType;

    // Actualizar botones en UI
    document.querySelectorAll('.vehicle-btn').forEach(btn => btn.classList.remove('active'));
    if (buttonElement) {
        buttonElement.classList.add('active');
    }

    // Mantener la vista activa seleccionada o fallback a 'Izquierdo'
    const activeViewBtn = document.querySelector('.view-controls .view-btn.active:not(.vehicle-btn)');
    if (activeViewBtn) {
        changeView(activeViewBtn.innerText.trim(), activeViewBtn);
    } else {
        changeView('Izquierdo');
    }
}

/**
 * Conmuta la perspectiva visual (vista) del vehículo e inyecta el nuevo SVG.
 * @param {string} viewName - Ej: 'Izquierdo', 'Derecho', 'Frontal', 'Posterior'
 * @param {HTMLElement} [buttonElement]
 */
export function changeView(viewName, buttonElement = null) {
    state.currentViewName = viewName;

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

    // Cancelar cualquier petición en curso antes de cambiar de diagrama SVG
    cancelAllPendingRequests();

    if (typeof STATIC_BASE_URL !== 'undefined') {
        let folder = 'Igm-Svg';
        let fileName = viewName;

        if (state.currentVehicleType === 'npr') {
            folder = 'img-npr';
            fileName = viewName + 'Npr';
        } else if (state.currentVehicleType === 'agrale') {
            folder = 'img-agrale';
            fileName = viewName + 'Agrale';
        }

        const cacheBuster = Date.now();
        const svgUrl = `${STATIC_BASE_URL}${folder}/${fileName}.svg?v=${cacheBuster}`;
        loadInteractiveSVG(svgUrl, 'svgWrapper');
    }
}

// ─── CARGA E INTERACTIVIDAD DE DIAGRAMAS SVG ─────────────────────────────────

/**
 * Carga el archivo SVG vía Fetch e inyecta su contenido en el contenedor DOM.
 * @param {string} svgUrl
 * @param {string} containerId
 */
export async function loadInteractiveSVG(svgUrl, containerId) {
    try {
        const response = await fetch(svgUrl);
        if (!response.ok) {
            throw new Error(`Error al descargar SVG (${response.status})`);
        }

        const svgText = await response.text();
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = svgText;

        const svgElement = container.querySelector('svg');
        if (!svgElement) return;

        // Corrección de renderizado para patrones con imágenes embebidas en Base64
        resolveBase64SvgPatterns(svgElement);

        // Inicializar listeners y clases sobre las piezas
        initSVGInteractivity(svgElement);

    } catch (error) {
        console.error('Error cargando diagrama SVG:', error);
        const container = document.getElementById(containerId);
        if (container) {
            const modelName = VEHICLE_LABELS[state.currentVehicleType] || state.currentVehicleType;
            container.innerHTML = `
                <div style="text-align: center; padding: 48px 20px; color: var(--color-texto-grey); background: #ffffff; border-radius: var(--border-radius-md);">
                    <div style="font-size: 2.2rem; margin-bottom: 8px;">📐</div>
                    <h4 style="margin: 0 0 6px 0; color: var(--color-texto-dark); font-size: 1rem;">Diagrama ${state.currentViewName} (${modelName})</h4>
                    <p style="margin: 0; font-size: 0.82rem;">Este diagrama se encuentra en fase de digitalización. Por favor selecciona otra de las caras disponibles arriba.</p>
                </div>
            `;
        }
    }
}

/**
 * Resuelve el bug de renderizado al inyectar SVGs con patrones de imágenes en el DOM.
 * @param {SVGSVGElement} svg
 */
function resolveBase64SvgPatterns(svg) {
    const patterns = svg.querySelectorAll('pattern');
    patterns.forEach(pattern => {
        const useTag = pattern.querySelector('use');
        if (!useTag) return;

        const href = useTag.getAttribute('href') || useTag.getAttribute('xlink:href');
        if (href && href.startsWith('#')) {
            const imgDef = svg.querySelector(`[id="${href.substring(1)}"]`);
            if (imgDef && imgDef.tagName.toLowerCase() === 'image') {
                const patternId = pattern.getAttribute('id');
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
    });
}

/**
 * Analiza el SVG inyectado, añade clases interactivas y asocia eventos de selección.
 * Resalta en verde brillante (.selected) cualquier pieza previamente seleccionada
 * al editar cotizaciones o recuperar borradores.
 * @param {SVGSVGElement} svgElement
 */
function initSVGInteractivity(svgElement) {
    if (!svgElement) return;

    svgElement.setAttribute('width', '100%');
    svgElement.setAttribute('height', 'auto');
    svgElement.removeAttribute('preserveAspectRatio');

    const interactiveShapes = svgElement.querySelectorAll('path, ellipse, polygon, circle');

    interactiveShapes.forEach(shape => {
        shape.classList.add('part-interactive');
        let uniqueId = (shape.id || '').trim();

        // Si la forma no tiene ID propio, usar identificador determinista del grupo padre
        if (!uniqueId && shape.parentElement && shape.parentElement.tagName === 'g' && shape.parentElement.id) {
            const index = Array.from(shape.parentElement.children).indexOf(shape);
            uniqueId = `${shape.parentElement.id}_p${index}`.trim();
        } else if (!uniqueId) {
            shape.classList.remove('part-interactive');
            return;
        }

        // Referencia base limpia para consultar inventario en UNOEE / MySQL (remueve sufijos _2, _p0, etc.)
        const baseId = uniqueId.replace(/(_\d+)?(_p\d+)?$/, '').trim();

        // Identificador global único para aislar vistas (ej: standard_Izquierdo_RCEX0024)
        const globalId = `${state.currentVehicleType}_${state.currentViewName}_${uniqueId}`;
        shape.setAttribute('data-part-id', globalId);

        // ── RESALTADO INTELIGENTE DE PIEZAS PREVIAMENTE SELECCIONADAS ──
        let isSelected = false;

        // 1. Coincidencia directa por globalId exacto
        if (state.selectedParts[globalId]) {
            isSelected = true;
        }

        // 2. Coincidencia por baseId o uniqueId si fue importado o guardado sin prefijo estricto
        if (!isSelected) {
            const matchEntry = Object.entries(state.selectedParts).find(([gid, p]) => {
                const partBase = (p.baseId || '').trim();
                const partUnique = (p.uniqueId || '').trim();
                return (partBase && (partBase === baseId || partBase === uniqueId)) ||
                       (partUnique && (partUnique === uniqueId || partUnique === baseId));
            });

            if (matchEntry) {
                isSelected = true;
                const [oldKey, oldData] = matchEntry;
                // Normalizar clave a la vista actual para que toggles futuros operen con total precisión
                if (oldKey !== globalId) {
                    state.selectedParts[globalId] = {
                        ...oldData,
                        globalId: globalId,
                        viewName: state.currentViewName,
                        vehicleType: state.currentVehicleType
                    };
                    delete state.selectedParts[oldKey];
                }
            }
        }

        // 3. Fallback para cotizaciones históricas que solo tenían nombre de texto (EDIT_QUOTE_DATA)
        if (!isSelected && typeof EDIT_QUOTE_DATA !== 'undefined' && EDIT_QUOTE_DATA && EDIT_QUOTE_DATA.piezas) {
            const match = EDIT_QUOTE_DATA.piezas.some(p => {
                const clean = p.replace(/\s*\(x\d+\)/, '')
                               .replace(/^[A-Z0-9_\-\s]+:\s*/, '')
                               .toLowerCase()
                               .trim();
                return (baseId && baseId.toLowerCase().includes(clean)) ||
                       (clean && clean.includes(baseId.toLowerCase())) ||
                       (shape.id && shape.id.toLowerCase().includes(clean));
            });

            if (match) {
                isSelected = true;
                if (!state.selectedParts[globalId]) {
                    state.selectedParts[globalId] = {
                        baseId: baseId,
                        uniqueId: uniqueId,
                        name: baseId,
                        price: 'loading',
                        qty: 1,
                        globalId: globalId,
                        viewName: state.currentViewName,
                        vehicleType: state.currentVehicleType
                    };
                    fetchPartPrice(baseId).then(data => {
                        if (state.selectedParts[globalId]) {
                            state.selectedParts[globalId].name = data.name || baseId;
                            state.selectedParts[globalId].price = data.price;
                            renderCart();
                        }
                    }).catch(() => {
                        if (state.selectedParts[globalId]) {
                            state.selectedParts[globalId].price = null;
                            renderCart();
                        }
                    });
                }
            }
        }

        // Aplicar clase .selected con el resalte visual en verde esmeralda si coincide
        if (isSelected) {
            shape.classList.add('selected');
        } else {
            shape.classList.remove('selected');
        }

        // Listener de clic (Toggle de selección)
        shape.addEventListener('click', () => handlePartToggle(shape, globalId, baseId, uniqueId));
    });
}

/**
 * Gestiona la selección y deselección de una pieza interactiva del SVG.
 * @param {SVGElement} shape
 * @param {string} globalId
 * @param {string} baseId
 * @param {string} uniqueId
 */
async function handlePartToggle(shape, globalId, baseId, uniqueId = '') {
    if (shape.classList.contains('selected')) {
        // Deselección
        shape.classList.remove('selected');
        cancelPendingRequest(baseId);
        delete state.selectedParts[globalId];
        renderCart();
    } else {
        // Selección
        shape.classList.add('selected');

        // Optimistic UI: Mostrar inmediatamente con spinner de carga
        state.selectedParts[globalId] = {
            baseId: baseId,
            uniqueId: uniqueId || baseId,
            name: baseId,
            price: 'loading',
            qty: 1,
            globalId: globalId,
            viewName: state.currentViewName,
            vehicleType: state.currentVehicleType
        };
        renderCart();

        try {
            // Consulta asíncrona a la API de Django (con AbortController y caché)
            const partData = await fetchPartPrice(baseId);

            // Verificar si el usuario aún la tiene seleccionada al momento de resolver
            if (state.selectedParts[globalId]) {
                state.selectedParts[globalId] = {
                    baseId: baseId,
                    uniqueId: uniqueId || baseId,
                    name: partData.name || baseId,
                    price: partData.price,
                    qty: state.selectedParts[globalId].qty || 1,
                    globalId: globalId,
                    viewName: state.currentViewName,
                    vehicleType: state.currentVehicleType
                };
                renderCart();
            }
        } catch (error) {
            if (error.isAborted || error.name === 'AbortError') {
                return;
            }

            console.warn(`[SAO6] No se pudo obtener precio para "${baseId}":`, error.message);

            if (state.selectedParts[globalId]) {
                state.selectedParts[globalId] = {
                    baseId: baseId,
                    uniqueId: uniqueId || baseId,
                    name: baseId,
                    price: null,
                    qty: state.selectedParts[globalId].qty || 1,
                    globalId: globalId,
                    viewName: state.currentViewName,
                    vehicleType: state.currentVehicleType
                };
                renderCart();
            }
        }
    }
}

// ─── GESTIÓN DE LA INTERFAZ DEL CARRITO / COTIZACIÓN ─────────────────────────

/**
 * Actualiza la cantidad de una pieza en la lista.
 * @param {string} globalId
 * @param {number|string} value
 */
export function updateQty(globalId, value) {
    const qty = Math.max(1, parseInt(value, 10) || 1);
    if (state.selectedParts[globalId]) {
        state.selectedParts[globalId].qty = qty;
        renderCart();
    }
}

/**
 * Elimina una pieza directamente desde el botón del carrito y actualiza el SVG si está visible.
 * @param {string} globalId
 */
export function removePartFromCart(globalId) {
    const part = state.selectedParts[globalId];
    if (part) {
        cancelPendingRequest(part.baseId);
        delete state.selectedParts[globalId];
    }

    // Remover clase .selected del elemento SVG si pertenece a la vista actual
    const svgShape = document.querySelector(`[data-part-id="${globalId}"]`);
    if (svgShape) {
        svgShape.classList.remove('selected');
    }

    renderCart();
}

/**
 * Renderiza el listado de piezas seleccionadas, actualiza el total en el DOM
 * y sincroniza la persistencia en localStorage.
 */
export function renderCart() {
    const container = document.getElementById('cartItemsContainer');
    const totalEl = document.getElementById('cartTotalValue');
    const totalContainer = document.getElementById('cartTotalContainer');

    if (!container || !totalEl || !totalContainer) return;

    const partIds = Object.keys(state.selectedParts);

    if (partIds.length === 0) {
        container.innerHTML = '<p class="empty-cart-msg">Aún no has seleccionado piezas.</p>';
        totalEl.innerText = formatCOP(0);
        totalContainer.style.display = 'none';

        const formPieza = document.getElementById('formPieza');
        const formValorPieza = document.getElementById('formValorPieza');
        const formPiezasJson = document.getElementById('formPiezasJson');
        const formIdPieza = document.getElementById('formIdPieza');

        if (formPieza) formPieza.value = '';
        if (formValorPieza) formValorPieza.value = '0';
        if (formPiezasJson) formPiezasJson.value = '{}';
        if (formIdPieza) formIdPieza.value = '';

        // Si no hay piezas, limpiar el borrador de localStorage
        clearDraftStorage();
        return;
    }

    let html = '';
    let totalCosto = 0;

    partIds.forEach(id => {
        const item = state.selectedParts[id];
        const qty = item.qty || 1;
        const isLoading = item.price === 'loading';
        const hasValidPrice = !isLoading && typeof item.price === 'number' && item.price > 0;

        if (hasValidPrice) {
            totalCosto += item.price * qty;
        }

        let priceMarkup;
        if (isLoading) {
            priceMarkup = '<span class="price-loading">Consultando...</span>';
        } else if (hasValidPrice) {
            priceMarkup = `<span style="font-weight: 700; font-size: 0.85rem; color: var(--color-texto-dark); white-space: nowrap;">${formatCOP(item.price)}</span>`;
        } else {
            priceMarkup = '<span style="font-size: 0.75rem; color: #aaa; font-style: italic; white-space: nowrap;">Sin precio</span>';
        }

        html += `
            <div class="cart-item">
                <span class="cart-item-name" style="font-size: 0.85rem; flex: 1; min-width: 0;">
                    <strong style="color: var(--color-primario); display: block; margin-bottom: 2px; font-size: 0.78rem;">Ref: ${item.baseId}</strong>
                    <span style="display: block; overflow: hidden; text-overflow: ellipsis;">${String(item.name).replace(/_/g, ' ')}</span>
                </span>
                <div style="display: flex; align-items: center; gap: 8px; margin-left: 8px; flex-shrink: 0;">
                    <input 
                        type="number" 
                        min="1" 
                        value="${qty}"
                        onchange="window.updateQty('${id}', this.value)"
                        style="width: 46px; padding: 3px 5px; border: 1px solid var(--color-borde); border-radius: 6px; font-size: 0.8rem; text-align: center; background: var(--color-fondo-soft);"
                        title="Cantidad"
                    />
                    ${priceMarkup}
                    <button onclick="window.removePartFromCart('${id}')" 
                            style="background: none; border: none; cursor: pointer; color: #ff4757; font-size: 1.1rem; padding: 0;" 
                            title="Quitar pieza">
                        &times;
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    totalEl.innerText = formatCOP(totalCosto);
    totalContainer.style.display = 'flex';

    // Sincronizar formulario de envío
    const formWrapper = document.getElementById('formGuardarCotizacionWrapper');
    if (formWrapper) {
        formWrapper.style.display = 'block';
        const formTipologia = document.getElementById('formTipologia');
        const formPieza = document.getElementById('formPieza');
        const formValorPieza = document.getElementById('formValorPieza');
        const formPiezasJson = document.getElementById('formPiezasJson');
        const formIdPieza = document.getElementById('formIdPieza');

        if (formTipologia) {
            const label = VEHICLE_LABELS[state.currentVehicleType] || state.currentVehicleType;
            formTipologia.value = label;
            const sidebarLineDisplay = document.getElementById('sidebarLineDisplay');
            if (sidebarLineDisplay) {
                sidebarLineDisplay.innerText = label;
            }
        }

        const busInput = document.getElementById('inputNumeroBus');
        if (busInput && state.currentBusNumber) {
            busInput.value = state.currentBusNumber;
        }

        if (formPieza) {
            const names = partIds.map(id => {
                const item = state.selectedParts[id];
                const ref = item.baseId ? `${item.baseId}: ` : '';
                return `${ref}${String(item.name || item.baseId).replace(/_/g, ' ')} (x${item.qty || 1})`;
            });
            formPieza.value = names.join(', ');
        }

        if (formValorPieza) {
            formValorPieza.value = totalCosto;
        }

        if (formPiezasJson) {
            formPiezasJson.value = JSON.stringify(state.selectedParts);
        }

        if (formIdPieza) {
            const refs = [...new Set(partIds.map(id => {
                const item = state.selectedParts[id];
                return item?.baseId || item?.code || id;
            }))].filter(Boolean);
            formIdPieza.value = refs.join(', ');
        }
    }

    // Guardar copia local en localStorage para protección de datos
    saveDraftToStorage();
}

// ─── INTEGRACIÓN CON EL GENERADOR DE REPORTES PDF ────────────────────────────

/**
 * Valida si hay piezas cotizadas antes de iniciar cualquier operación PDF.
 * @returns {boolean}
 */
function validateQuoteCreation() {
    const totalParts = Object.keys(state.selectedParts).length;
    if (totalParts === 0) {
        alert('Debes seleccionar al menos una pieza antes de generar o previsualizar el PDF.');
        return false;
    }
    return true;
}

/**
 * Acción: Generar y descargar directamente el PDF corporativo de cotización.
 */
export async function generatePDF() {
    if (!validateQuoteCreation()) return;

    try {
        const busNumberInput = document.getElementById('inputNumeroBus');
        const busNumber = busNumberInput ? busNumberInput.value.trim() : null;

        await downloadQuotePDF({
            parts: state.selectedParts,
            vehicleType: state.currentVehicleType,
            busNumber: busNumber || 'SIN-NUMERO'
        });
    } catch (error) {
        console.error('Error al generar PDF corporativo:', error);
        alert('Ocurrió un error al compilar el documento PDF.');
    }
}

/**
 * Acción: Renderizar vista previa interactiva del PDF en el modal sin forzar descarga.
 */
export async function previewPDF() {
    if (!validateQuoteCreation()) return;

    try {
        const busNumberInput = document.getElementById('inputNumeroBus');
        const busNumber = busNumberInput ? busNumberInput.value.trim() : null;

        const { blobUrl } = await getQuotePDFBlobUrl({
            parts: state.selectedParts,
            vehicleType: state.currentVehicleType,
            busNumber: busNumber || 'SIN-NUMERO'
        });

        const modal = document.getElementById('pdfPreviewModal');
        const iframe = document.getElementById('pdfIframe');

        if (iframe && modal) {
            iframe.src = blobUrl;
            iframe.dataset.blobUrl = blobUrl;
            modal.classList.add('open');
            document.addEventListener('keydown', handleEscPdf);
        }
    } catch (error) {
        console.error('Error generando vista previa de PDF:', error);
        alert('No se pudo generar la vista previa del documento.');
    }
}

/**
 * Cierra el modal de vista previa y revoca la URL del Blob para liberar memoria.
 */
export function closePDFModal() {
    const modal = document.getElementById('pdfPreviewModal');
    const iframe = document.getElementById('pdfIframe');

    if (modal) {
        modal.classList.remove('open');
    }

    if (iframe && iframe.dataset.blobUrl) {
        URL.revokeObjectURL(iframe.dataset.blobUrl);
        iframe.dataset.blobUrl = '';
        iframe.src = '';
    }

    document.removeEventListener('keydown', handleEscPdf);
}

function handleEscPdf(e) {
    if (e.key === 'Escape') {
        closePDFModal();
    }
}

// ─── GESTIÓN DE FLOTA Y SELECCIÓN DE VEHÍCULO (vehiculo.xlsx) ───────────────

let fleetCache = [];
const fleetMap = {};
let selectedModalVehicle = null;
let debounceTimer = null;

/**
 * Pre-carga el catálogo de la flota desde el endpoint /api/vehiculos/buscar/
 * para alimentar el autocompletado y permitir búsqueda instantánea en cliente.
 */
async function initFleetCache() {
    try {
        const res = await fetch('/api/vehiculos/buscar/');
        if (!res.ok) return;
        const data = await res.json();
        if (data && Array.isArray(data.vehiculos)) {
            fleetCache = data.vehiculos;
            const datalist = document.getElementById('fleetDatalist');
            if (datalist) {
                datalist.innerHTML = fleetCache.map(v => 
                    `<option value="${v.numero}">Móvil ${v.numero} — ${v.linea}</option>`
                ).join('');
            }
            fleetCache.forEach(v => {
                const num = String(v.numero).trim().toLowerCase();
                fleetMap[num] = v;
                // Indexar sin ceros a la izquierda (ej: "045" -> "45")
                const noZeros = num.replace(/^0+/, '');
                if (noZeros && noZeros !== num) {
                    fleetMap[noZeros] = v;
                }
                // Indexar rellenado con ceros a 3 dígitos (ej: "1" -> "001")
                const padded = num.padStart(3, '0');
                if (padded !== num) {
                    fleetMap[padded] = v;
                }
                // Variantes con prefijos comunes
                fleetMap[`bus${num}`] = v;
                fleetMap[`bus-${num}`] = v;
                fleetMap[`movil${num}`] = v;
                fleetMap[`movil-${num}`] = v;
                fleetMap[`unidad${num}`] = v;
                fleetMap[`unidad-${num}`] = v;
            });
        }
    } catch (e) {
        console.warn('[SAO6] No se pudo pre-cargar el inventario de vehículos:', e);
    }
}

/**
 * Busca una unidad en la caché local normalizada.
 * @param {string} query
 * @returns {object|null}
 */
function lookupUnitInClient(query) {
    if (!query) return null;
    const clean = query.trim().toLowerCase().replace(/\s+/g, '');
    if (fleetMap[clean]) return fleetMap[clean];

    // Intentar solo dígitos numéricos
    const digits = clean.replace(/\D/g, '');
    if (digits) {
        if (fleetMap[digits]) return fleetMap[digits];
        const noZeros = digits.replace(/^0+/, '');
        if (noZeros && fleetMap[noZeros]) return fleetMap[noZeros];
        const padded = digits.padStart(3, '0');
        if (fleetMap[padded]) return fleetMap[padded];
    }
    return null;
}

/**
 * Evalúa el texto ingresado en el modal y actualiza el feedback visual en tiempo real.
 * @param {string} query
 */
async function evaluarBusInput(query) {
    const feedbackBox = document.getElementById('modalVehicleFeedback');
    const fallbackBox = document.getElementById('modalManualFallback');
    const btnConfirmar = document.getElementById('btnConfirmarVehiculo');
    if (!feedbackBox || !btnConfirmar) return;

    const val = (query || '').trim();
    if (!val) {
        selectedModalVehicle = null;
        feedbackBox.innerHTML = `
            <div class="feedback-waiting">
                <span>💡 Digita el número de móvil para detectar la línea automáticamente.</span>
            </div>
        `;
        if (fallbackBox) fallbackBox.style.display = 'none';
        btnConfirmar.disabled = true;
        return;
    }

    // 1. Búsqueda instantánea en caché cliente
    const localMatch = lookupUnitInClient(val);
    if (localMatch) {
        aplicarVehiculoDetectado(localMatch, feedbackBox, fallbackBox, btnConfirmar);
        return;
    }

    // 2. Consulta al servidor vía endpoint con debounce
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
        try {
            const res = await fetch(`/api/vehiculos/buscar/?q=${encodeURIComponent(val)}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.encontrado && data.vehiculo) {
                    aplicarVehiculoDetectado(data.vehiculo, feedbackBox, fallbackBox, btnConfirmar);
                    return;
                }
            }
        } catch (e) {
            console.warn('[SAO6] Error en búsqueda de vehículo en backend:', e);
        }

        // Si no se encontró en la flota base
        selectedModalVehicle = null;
        btnConfirmar.disabled = true;
        feedbackBox.innerHTML = `
            <div class="feedback-notfound">
                <strong>⚠️ Unidad "${val}" no encontrada en el inventario base.</strong>
                <div style="margin-top: 2px;">Puedes seleccionar la línea correspondiente para continuar:</div>
            </div>
        `;
        if (fallbackBox) {
            fallbackBox.style.display = 'block';
            document.querySelectorAll('.fallback-btn').forEach(b => b.classList.remove('active'));
        }
    }, 200);
}

function aplicarVehiculoDetectado(vehiculo, feedbackBox, fallbackBox, btnConfirmar) {
    let key = vehiculo.linea_key || (vehiculo.linea.toLowerCase().includes('npr') ? 'npr' : vehiculo.linea.toLowerCase().includes('agrale') ? 'agrale' : 'standard');
    if (key === 'runner') key = 'standard';

    selectedModalVehicle = {
        numero: vehiculo.numero || vehiculo.numero_original,
        linea: vehiculo.linea,
        linea_key: key
    };

    feedbackBox.innerHTML = `
        <div class="feedback-found">
            <div class="feedback-found-info">
                <div class="feedback-found-title">
                    <span>✔ Unidad ${selectedModalVehicle.numero} verificada en flota SAO6</span>
                </div>
                <div class="feedback-found-desc">
                    Línea asignada: <strong>${selectedModalVehicle.linea}</strong> • Se filtrarán únicamente sus diagramas oficiales.
                </div>
            </div>
            <span class="line-badge line-badge-${selectedModalVehicle.linea_key}">
                ${selectedModalVehicle.linea}
            </span>
        </div>
    `;

    if (fallbackBox) fallbackBox.style.display = 'none';
    btnConfirmar.disabled = false;
}

/**
 * Abre el modal de selección de unidad.
 * @param {boolean} permitirCancelar - True si el usuario ya tenía una unidad activa y puede cancelar sin cambiarla.
 */
export function abrirModalVehiculo(permitirCancelar = false) {
    const modal = document.getElementById('modalSeleccionVehiculo');
    const input = document.getElementById('modalInputBus');
    const btnCancelar = document.getElementById('btnCancelarModalVehiculo');
    if (!modal) return;

    if (btnCancelar) {
        btnCancelar.style.display = permitirCancelar ? 'inline-block' : 'none';
    }

    if (input) {
        input.value = state.currentBusNumber || '';
        setTimeout(() => input.focus(), 100);
        evaluarBusInput(input.value);
    }

    modal.style.display = 'flex';
}

/**
 * Cierra el modal de selección de unidad.
 */
export function cerrarModalVehiculo(cambiado = true) {
    const modal = document.getElementById('modalSeleccionVehiculo');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Selecciona una unidad a través de los chips de sugerencia rápida en el modal.
 * @param {string} num
 */
export function seleccionarChipUnidad(num) {
    const input = document.getElementById('modalInputBus');
    if (input) {
        input.value = num;
        evaluarBusInput(num);
    }
}

/**
 * Permite seleccionar manualmente la línea si la unidad no está en la base.
 * @param {string} lineKey - 'standard' | 'npr' | 'agrale'
 * @param {string} lineLabel - 'Runner' | 'NPR' | 'Agrale'
 * @param {HTMLElement} btnEl
 */
export function seleccionarLineaManual(lineKey, lineLabel, btnEl) {
    const input = document.getElementById('modalInputBus');
    const busNum = input && input.value.trim() ? input.value.trim().toUpperCase() : 'BUS-000';
    const btnConfirmar = document.getElementById('btnConfirmarVehiculo');

    document.querySelectorAll('.fallback-line-buttons .fallback-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');

    selectedModalVehicle = {
        numero: busNum,
        linea: lineLabel,
        linea_key: lineKey
    };

    if (btnConfirmar) {
        btnConfirmar.disabled = false;
    }
}

/**
 * Confirma la selección del vehículo en el modal y actualiza la aplicación.
 */
export function confirmarSeleccionVehiculo() {
    if (!selectedModalVehicle) return;

    state.currentVehicleType = selectedModalVehicle.linea_key;
    state.currentBusNumber = selectedModalVehicle.numero;
    state.currentBusLine = selectedModalVehicle.linea;

    // Sincronizar input del formulario y resumen lateral
    const busInput = document.getElementById('inputNumeroBus');
    if (busInput) {
        busInput.value = selectedModalVehicle.numero;
    }

    const sidebarLineDisplay = document.getElementById('sidebarLineDisplay');
    if (sidebarLineDisplay) {
        sidebarLineDisplay.innerText = selectedModalVehicle.linea;
    }

    const formTipologia = document.getElementById('formTipologia');
    if (formTipologia) {
        formTipologia.value = selectedModalVehicle.linea;
    }

    // Actualizar tarjeta superior de unidad activa
    actualizarTarjetaUnidadActiva(
        selectedModalVehicle.numero, 
        selectedModalVehicle.linea, 
        selectedModalVehicle.linea_key
    );

    // Guardar en localStorage
    try {
        localStorage.setItem(DRAFT_BUS_KEY, selectedModalVehicle.numero);
        localStorage.setItem(DRAFT_VEHICLE_KEY, selectedModalVehicle.linea_key);
    } catch (e) {
        console.warn('[SAO6] Error guardando unidad en localStorage:', e);
    }

    cerrarModalVehiculo(true);

    // Cargar la primera cara de este vehículo
    changeView('Izquierdo');
}

/**
 * Maneja la solicitud de cambiar de unidad activa.
 */
export function solicitarCambioVehiculo() {
    const partCount = Object.keys(state.selectedParts).length;
    if (partCount > 0) {
        const confirmar = confirm(
            `Tienes ${partCount} pieza(s) seleccionada(s) para la unidad actual.\n` +
            `Al cambiar de unidad se reiniciará la cotización para evitar discrepancias de diagramas.\n\n` +
            `¿Deseas continuar y seleccionar otra unidad?`
        );
        if (!confirmar) return;

        state.selectedParts = {};
        clearDraftStorage();
        renderCart();
    }

    abrirModalVehiculo(Boolean(state.currentBusNumber));
}

/**
 * Actualiza la tarjeta visual de unidad activa en la interfaz.
 */
export function actualizarTarjetaUnidadActiva(numero, linea, lineaKey) {
    const displayBus = document.getElementById('displayActiveBus');
    const displayLine = document.getElementById('displayActiveLine');
    const sidebarLine = document.getElementById('sidebarLineDisplay');

    if (displayBus) {
        displayBus.innerText = numero || '---';
    }
    if (displayLine) {
        displayLine.innerText = linea || '---';
        displayLine.className = `line-badge line-badge-${lineaKey || 'standard'}`;
    }
    if (sidebarLine) {
        sidebarLine.innerText = linea || '---';
    }
}

// ─── EXPOSICIÓN DE APIS GLOBALES ─────────────────────────────────────────────

window.changeVehicle = changeVehicle;
window.changeView = changeView;
window.updateQty = updateQty;
window.removePartFromCart = removePartFromCart;
window.generatePDF = generatePDF;
window.previewPDF = previewPDF;
window.closePDFModal = closePDFModal;
window.solicitarCambioVehiculo = solicitarCambioVehiculo;
window.abrirModalVehiculo = abrirModalVehiculo;
window.cerrarModalVehiculo = cerrarModalVehiculo;
window.confirmarSeleccionVehiculo = confirmarSeleccionVehiculo;
window.seleccionarChipUnidad = seleccionarChipUnidad;
window.seleccionarLineaManual = seleccionarLineaManual;

/**
 * Restaura automáticamente el número de bus, tipología y piezas cuando
 * se ingresa en modo edición mediante el parámetro 'editar_id'.
 * @returns {string} Nombre de la vista que contiene la pieza para enfocarla inmediatamente.
 */
function restoreEditQuoteState() {
    if (typeof EDIT_QUOTE_DATA === 'undefined' || !EDIT_QUOTE_DATA || !EDIT_QUOTE_DATA.id) {
        return null;
    }

    const busNum = EDIT_QUOTE_DATA.numero_bus || '---';
    state.currentBusNumber = busNum;

    // 1. Rellenar input del número de bus
    const inputNumeroBus = document.getElementById('inputNumeroBus');
    if (inputNumeroBus) {
        inputNumeroBus.value = busNum;
    }

    const formEditarId = document.getElementById('formEditarId');
    if (formEditarId && EDIT_QUOTE_DATA.id) {
        formEditarId.value = EDIT_QUOTE_DATA.id;
    }

    const formIdPieza = document.getElementById('formIdPieza');
    if (formIdPieza && EDIT_QUOTE_DATA.id_pieza) {
        formIdPieza.value = EDIT_QUOTE_DATA.id_pieza;
    }

    // 2. Conmutar tipo de vehículo si difiere
    let targetType = 'standard';
    let targetLine = 'Runner';
    if (EDIT_QUOTE_DATA.tipologia) {
        const tipoLower = EDIT_QUOTE_DATA.tipologia.toLowerCase();
        if (tipoLower.includes('npr')) {
            targetType = 'npr';
            targetLine = 'NPR';
        } else if (tipoLower.includes('agrale')) {
            targetType = 'agrale';
            targetLine = 'Agrale';
        }
    }

    state.currentVehicleType = targetType;
    state.currentBusLine = targetLine;

    // Actualizar tarjeta visual de unidad activa
    actualizarTarjetaUnidadActiva(busNum, targetLine, targetType);

    // 3. Restaurar piezas en state.selectedParts y renderizar carrito
    let targetView = 'Izquierdo';

    if (EDIT_QUOTE_DATA.piezas_detalle && Object.keys(EDIT_QUOTE_DATA.piezas_detalle).length > 0) {
        state.selectedParts = { ...EDIT_QUOTE_DATA.piezas_detalle };

        // Encontrar la primera pieza que indique su vista para cargarla directamente
        const firstPart = Object.values(state.selectedParts).find(p => p && p.viewName);
        if (firstPart && firstPart.viewName) {
            targetView = firstPart.viewName;
        }
        renderCart();
    } else if (EDIT_QUOTE_DATA.piezas && Array.isArray(EDIT_QUOTE_DATA.piezas) && EDIT_QUOTE_DATA.piezas.length > 0) {
        EDIT_QUOTE_DATA.piezas.forEach((piezaRaw, idx) => {
            const cleanName = piezaRaw.replace(/\s*\(x\d+\)/, '')
                                      .replace(/^[A-Z0-9_\-\s]+:\s*/, '')
                                      .trim();
            const mockId = `${state.currentVehicleType}_${state.currentViewName}_part_${idx}`;
            state.selectedParts[mockId] = {
                baseId: cleanName,
                uniqueId: cleanName,
                name: cleanName,
                price: EDIT_QUOTE_DATA.valor_pieza ? (EDIT_QUOTE_DATA.valor_pieza / EDIT_QUOTE_DATA.piezas.length) : null,
                qty: 1,
                viewName: state.currentViewName,
                vehicleType: state.currentVehicleType,
                globalId: mockId
            };
        });
        renderCart();
    }

    return targetView;
}

// ─── INICIALIZACIÓN DE LA APLICACIÓN ─────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Inicializar catálogo de vehículos desde API de vehiculo.xlsx
    await initFleetCache();

    // 2. Configurar eventos de interacción en el modal de selección
    const modalInput = document.getElementById('modalInputBus');
    if (modalInput) {
        modalInput.addEventListener('input', (e) => {
            evaluarBusInput(e.target.value);
        });
        modalInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const btnConfirmar = document.getElementById('btnConfirmarVehiculo');
                if (btnConfirmar && !btnConfirmar.disabled) {
                    confirmarSeleccionVehiculo();
                }
            }
        });
    }

    // Modal de preview PDF: cerrar al pulsar backdrop
    const modal = document.getElementById('pdfPreviewModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closePDFModal();
            }
        });
    }

    const isEditing = Boolean(typeof EDIT_QUOTE_DATA !== 'undefined' && EDIT_QUOTE_DATA && EDIT_QUOTE_DATA.id);

    // Validación y limpieza al enviar el formulario de guardar cotización
    const formCotizacion = document.getElementById('formGuardarCotizacion');
    if (formCotizacion) {
        formCotizacion.addEventListener('submit', (e) => {
            const count = Object.keys(state.selectedParts).length;
            if (count === 0) {
                e.preventDefault();
                alert('Debes seleccionar al menos una pieza interactiva en el vehículo antes de guardar la cotización.');
                return;
            }

            // Garantizar que el input oculto viaje con el número de bus asignado
            const busInput = document.getElementById('inputNumeroBus');
            if (busInput && (!busInput.value || !busInput.value.trim()) && state.currentBusNumber) {
                busInput.value = state.currentBusNumber;
            }

            // Al terminar y guardar la cotización, borrar el borrador de localStorage
            clearDraftStorage();
        });
    }

    // Escuchar cambios en el input del bus para actualizar el borrador en localStorage
    const busInput = document.getElementById('inputNumeroBus');
    if (busInput) {
        busInput.addEventListener('input', () => {
            if (!isEditing) {
                saveDraftToStorage();
            }
        });
    }

    // Restaurar cotización si se cargó en modo edición o recuperar borrador previo
    let viewToLoad = 'Izquierdo';

    if (isEditing) {
        viewToLoad = restoreEditQuoteState() || 'Izquierdo';
        changeView(viewToLoad);
    } else {
        const savedView = restoreSavedDraft();
        if (savedView && state.currentBusNumber) {
            changeView(savedView);
        } else {
            // Flujo UX requerido: abrir el modal antes de que el usuario seleccione piezas
            abrirModalVehiculo(false);
            changeView('Izquierdo');
        }
    }
});
