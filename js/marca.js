/**
 * marca.js — Configuración de marca (branding) de ESTE cliente
 * -----------------------------------------------------------------------
 * Este es el ÚNICO archivo de texto/color que hay que tocar para armar la
 * versión de un kiosco nuevo. El resto del código (index.html, css,
 * app.js) lee estos valores en vez de tener el nombre o los colores
 * escritos a mano en varios lugares.
 *
 * Lo que SÍ hay que reemplazar aparte, por afuera de este archivo, porque
 * son imágenes y no texto:
 *   assets/iconos/logo-mark.png            (ícono chico, sidebar/login)
 *   assets/iconos/logo-splash.png          (pantalla de carga)
 *   assets/iconos/icon-192.png / icon-512.png
 *   assets/iconos/icon-maskable-192.png / icon-maskable-512.png
 *   assets/iconos/apple-touch-icon.png
 * Y en manifest.json: "name", "short_name", "theme_color" (mismo valor
 * que colorAcento acá abajo).
 */

const MARCA = {
  nombre: 'NOMBRE',
  sufijo: 'KIOSCO',

  nombreCompleto: 'COMPLETAR-NOMBRE-CLIENTE',
  descripcion: 'Control de stock, ventas y turnos de tu kiosco, todo en un solo lugar.',

  tagline: 'COMPLETAR TAGLINE',

  colorAcento: '#787880',
  colorAcentoClaro: '#A0A0A8',
  colorAcentoRgb: '120, 120, 128',
};

(function aplicarMarca() {
  document.title = `${MARCA.nombreCompleto} — Panel de kiosco`;
  const setMeta = (selector, attr, valor) => {
    const el = document.querySelector(selector);
    if (el) el.setAttribute(attr, valor);
  };
  setMeta('meta[name="description"]', 'content', `${MARCA.nombreCompleto}: ${MARCA.descripcion}`);
  setMeta('meta[name="theme-color"]', 'content', MARCA.colorAcento);
  setMeta('meta[name="apple-mobile-web-app-title"]', 'content', MARCA.nombreCompleto);
  const raiz = document.documentElement.style;
  raiz.setProperty('--color-acento', MARCA.colorAcento);
  raiz.setProperty('--color-acento-claro', MARCA.colorAcentoClaro);
  raiz.setProperty('--color-acento-rgb', MARCA.colorAcentoRgb);
})();
