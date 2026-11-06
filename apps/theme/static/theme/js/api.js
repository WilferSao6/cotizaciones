/**
 * @file api.js
 * @description Capa de comunicación asíncrona con el backend Django para SAO6 S.A.S.
 * Centraliza las peticiones a /api/get-price/, gestiona el ciclo de vida de AbortController
 * para prevenir condiciones de carrera y mantiene una caché en memoria en el cliente.
 */

// Registro de controladores activos mapeados por código de pieza (trimmedCode -> AbortController)
const activeRequests = new Map();

// Caché en memoria del cliente para evitar peticiones HTTP redundantes
const clientCache = new Map();

// Configuración de endpoints internos de Django
const API_ENDPOINTS = {
    GET_PRICE: '/api/get-price/',
};

/**
 * Clase personalizada para tipar y normalizar los errores devueltos por el backend o la red.
 */
export class ApiError extends Error {
    constructor(message, status = null, code = null) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}

/**
 * Consulta la descripción y precio unitario de una pieza a partir de su referencia inteligente.
 * 
 * @param {string} code - Código o identificador base de la pieza (baseId).
 * @param {Object} [options={}] - Opciones de consulta.
 * @param {boolean} [options.useCache=true] - Habilitar/deshabilitar lectura de caché en cliente.
 * @returns {Promise<{code: string, name: string, price: number|null, qty_lote: number|null, fuente: string}>}
 * @throws {ApiError|Error} Lanza ApiError para fallos HTTP/red, o Error con nombre 'AbortError' si fue cancelada.
 */
export async function fetchPartPrice(code, { useCache = true } = {}) {
    const trimmedCode = (code || '').trim();

    if (!trimmedCode) {
        throw new ApiError('El código de la pieza no puede estar vacío.', 400, trimmedCode);
    }

    // 1. Verificar si ya tenemos el resultado en caché del cliente
    if (useCache && clientCache.has(trimmedCode)) {
        return clientCache.get(trimmedCode);
    }

    // 2. Prevenir Race Conditions: Si hay una petición en curso para este mismo código, la abortamos
    if (activeRequests.has(trimmedCode)) {
        activeRequests.get(trimmedCode).abort();
        activeRequests.delete(trimmedCode);
    }

    // 3. Crear y registrar un nuevo AbortController para esta petición
    const controller = new AbortController();
    activeRequests.set(trimmedCode, controller);

    try {
        const queryUrl = `${API_ENDPOINTS.GET_PRICE}?code=${encodeURIComponent(trimmedCode)}`;
        
        const response = await fetch(queryUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            },
            signal: controller.signal
        });

        // Manejo detallado de respuestas HTTP
        if (!response.ok) {
            let serverErrorMsg = `Error HTTP ${response.status}`;
            try {
                const errorPayload = await response.json();
                if (errorPayload && errorPayload.error) {
                    serverErrorMsg = errorPayload.error;
                }
            } catch {
                // Si la respuesta no es un JSON estructurado
            }

            if (response.status === 404) {
                throw new ApiError(serverErrorMsg || 'Pieza no encontrada en inventario', 404, trimmedCode);
            } else if (response.status === 400) {
                throw new ApiError(serverErrorMsg || 'Código de pieza inválido', 400, trimmedCode);
            } else {
                throw new ApiError(serverErrorMsg || 'Error interno del servidor al consultar precio', response.status, trimmedCode);
            }
        }

        const data = await response.json();

        // Estructura normalizada esperada por app.js
        const result = {
            code: data.code || trimmedCode,
            name: data.name || trimmedCode,
            price: typeof data.price === 'number' && data.price > 0 ? data.price : null,
            qty_lote: data.qty_lote ?? null,
            fuente: data.fuente || 'unknown'
        };

        // Almacenar en caché del cliente si la opción está activa
        if (useCache) {
            clientCache.set(trimmedCode, result);
        }

        return result;

    } catch (error) {
        // Si fue abortada intencionalmente, relanzamos con bandera explícita
        if (error.name === 'AbortError') {
            const abortErr = new Error(`Consulta cancelada para la pieza: ${trimmedCode}`);
            abortErr.name = 'AbortError';
            abortErr.isAborted = true;
            abortErr.code = trimmedCode;
            throw abortErr;
        }

        // Si ya es un ApiError conocido, lo propagamos
        if (error instanceof ApiError) {
            throw error;
        }

        // Error general de conexión (servidor inaccesible, offline, timeout de red)
        throw new ApiError(
            'Error de conexión con el servidor. Verifique el estado de la red.',
            0,
            trimmedCode
        );
    } finally {
        // 4. Limpieza del ciclo de vida del AbortController
        if (activeRequests.get(trimmedCode) === controller) {
            activeRequests.delete(trimmedCode);
        }
    }
}

/**
 * Cancela una petición pendiente específica si está en vuelo.
 * @param {string} code - Código de la pieza.
 */
export function cancelPendingRequest(code) {
    const trimmedCode = (code || '').trim();
    if (activeRequests.has(trimmedCode)) {
        activeRequests.get(trimmedCode).abort();
        activeRequests.delete(trimmedCode);
    }
}

/**
 * Cancela todas las peticiones activas.
 * Debe invocarse cuando el usuario cambie de vista (Izquierdo/Derecho) o cambie de vehículo.
 */
export function cancelAllPendingRequests() {
    activeRequests.forEach((controller) => controller.abort());
    activeRequests.clear();
}

/**
 * Limpia la caché local del cliente.
 */
export function clearClientCache() {
    clientCache.clear();
}
