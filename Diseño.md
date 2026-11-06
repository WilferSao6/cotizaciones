# Guía de Diseño: Estética Premium y Minimalista (Estilo Vuesax)

Esta guía explica los principios y técnicas utilizados para crear interfaces modernas, limpias y de alta calidad. Puedes aplicar estos conceptos en cualquier proyecto web, independientemente del framework que utilices.

---

## 🏗 Principios Fundamentales

1.  **Menos es Más (Minimalismo)**: Evita el uso de tarjetas pesadas o bordes innecesarios. El contenido debe respirar.
2.  **Profundidad con Sombras (Elevación)**: En lugar de bordes negros o grises oscuros, usa sombras suaves y difusas para separar elementos.
3.  **Bordes Ultra-redondeados**: El uso de radios amplios (`12px` a `28px`) suaviza la interfaz y la hace sentir más orgánica y moderna.
4.  **Micro-interacciones**: Cada acción (hover, focus, click) debe tener una respuesta visual suave (transiciones de `0.25s`).

---

## 🎨 Paleta de Colores Inteligente

No uses colores planos. Define una variable base en RGB o HSL para poder aplicar transparencias dinámicas.

```css
:root {
  /* Usamos valores separados para poder aplicar opacidad en CSS */
  --vs-primary-raw: 76, 194, 83; 
  --color-primario: rgb(var(--vs-primary-raw));
  
  /* Fondos sutiles */
  --color-fondo-app: #ffffff;
  --color-fondo-soft: #f4f7f8; /* Gris azulado muy suave */
  
  /* Tipografía */
  --color-texto-dark: #2c3e50;
  --color-texto-grey: #a0a6ae;
}
```

---

## ⌨️ Componentes de Diseño

### 1. Campos de Entrada (Inputs Premium)
La clave es un fondo suave que se transforma al recibir el foco.

*   **Estado Base**: Fondo `--color-soft`, sin borde (o transparente), esquinas redondeadas (`14px`).
*   **Estado Focus**: Fondo blanco, borde con el color primario, y una **sombra de color** (no negra).
*   **Técnica**: `transform: translateY(-2px)` al hacer focus da una sensación de "elevación".

```css
.input-premium {
  background: var(--color-fondo-soft);
  border: 2px solid transparent;
  transition: all 0.25s ease;
}

.input-premium:focus {
  background: #fff;
  border-color: var(--color-primario);
  box-shadow: 0px 5px 20px 0px rgba(var(--vs-primary-raw), 0.15);
  transform: translateY(-2px);
}
```

### 2. Botones con "Glow"
Un botón premium no solo cambia de color, sino que parece emitir luz.

*   **Sombra de Color**: Usa una sombra que sea una versión semitransparente del color del botón.
*   **Efecto de Presión**: Reduce la escala ligeramente (`scale(0.95)`) al hacer click.

```css
.boton-premium {
  background: var(--color-primario);
  box-shadow: 0px 10px 20px -10px rgba(var(--vs-primary-raw), 0.5);
}

.boton-premium:hover {
  transform: translateY(-3px);
  box-shadow: 0px 10px 20px -5px rgba(var(--vs-primary-raw), 0.5);
}
```

### 3. Modales y Blur (Glassmorphism)
Para que un modal se sienta integrado, el fondo debe desenfocarse.

*   **Backdrop Blur**: Usa `backdrop-filter: blur(8px)` en el overlay del modal.
*   **Animación de Entrada**: No uses solo opacidad. Usa un escalado con un "rebote" suave.
*   **Curva de Animación**: `cubic-bezier(0.34, 1.56, 0.64, 1)` es ideal para ese efecto elástico.

```css
.modal-overlay {
  backdrop-filter: blur(8px);
  background: rgba(0, 0, 0, 0.3);
}

.modal-content {
  border-radius: 28px;
  animation: modalIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

---

## ✨ Detalles que Marcan la Diferencia

### Sombras de Capas Múltiples
Para los elementos más importantes (como Toasts o Modales), usa varias sombras para una profundidad realista:
```css
box-shadow: 
  0 25px 50px -12px rgba(0, 0, 0, 0.25), 
  0 15px 30px -5px rgba(0, 0, 0, 0.2);
```

### Tipografía Moderna
*   **Fuente Sugerida**: `Poppins`, `Inter` u `Outfit`.
*   **Jerarquía**: Usa un peso `700` para títulos y `500` para etiquetas. El color de las etiquetas debe ser más suave (`--color-texto-grey`) que el del valor introducido.

### Feedback Visual (Toasts)
Cuando algo sale bien (Success), no solo muestres un check. Añade una **animación de trazo (stroke-dasharray)** para que el símbolo parezca estarse dibujando en el momento.

---

## 🚀 Cómo Recrear esto en otro Proyecto

1.  **Define tu color base** en una variable RGB.
2.  **Limpia los estilos CSS nativos** (quitar bordes, outlines azules por defecto).
3.  **Implementa los radios amplios** (`12px+`) en todo.
4.  **Usa fondos claros (`#f4f7f8`)** para distinguir áreas sin usar líneas divisorias negras.
5.  **Añade transiciones** de `0.25s` a absolutamente todos los estados `:hover` y `:focus`.