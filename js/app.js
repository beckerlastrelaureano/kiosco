/**
 * app.js — KioscoBase
 * -----------------------------------------------------------------------
 * Controlador principal. Dos roles: dueño (administra su kiosco) y
 * superadmin (Becker). No hay Authentication para empleados: el turno
 * queda "firmado" con el PIN del empleado que lo abrió, pero quien
 * escribe en Firestore es siempre la sesión del dueño logueado en el
 * dispositivo — ver README.md.
 */

const App = (() => {

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function icon(nombre, clase = '') {
    return `<svg class="icon ${clase}" aria-hidden="true"><use href="assets/iconos/sprite.svg#icon-${nombre}"></use></svg>`;
  }
  function escapeHtml(str = '') {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function formatMoneda(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function formatFechaHora(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }
  function formatHora(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  function hoyISO() { return new Date().toISOString().slice(0, 10); }
  function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  const state = {
    vistaActual: null,
    usuario: null,
    productos: [],
    empleados: [],
    turnoActual: null,
    carrito: [], // [{productoId, nombre, precioUnitario, cantidad, stockDisponible}]
  };

  // ---------------------------------------------------------------------
  // Toast + Modal
  // ---------------------------------------------------------------------
  function toast(mensaje, tipo = 'info', duracion = 3200) {
    const cont = $('#toast-container');
    if (!cont) return;
    const el = document.createElement('div');
    el.className = `toast toast-${tipo}`;
    const iconos = { info: 'info', exito: 'check-circle', error: 'warning' };
    el.innerHTML = `${icon(iconos[tipo] || 'info')}<span>${escapeHtml(mensaje)}</span>`;
    cont.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast-show'));
    setTimeout(() => { el.classList.remove('toast-show'); setTimeout(() => el.remove(), 300); }, duracion);
  }

  function abrirModal(html, { ancho = 'md', id = 'modal-generico' } = {}) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-overlay" data-modal-overlay><div class="modal modal-${ancho}" id="${id}" role="dialog" aria-modal="true">${html}</div></div>`;
    root.classList.add('modal-root-visible');
    document.body.classList.add('no-scroll');
    $('[data-modal-overlay]', root).addEventListener('click', (e) => { if (e.target.hasAttribute('data-modal-overlay')) cerrarModal(); });
    $$('[data-cerrar-modal]', root).forEach(b => b.addEventListener('click', cerrarModal));
  }
  function cerrarModal() {
    const root = $('#modal-root');
    root.innerHTML = '';
    root.classList.remove('modal-root-visible');
    document.body.classList.remove('no-scroll');
  }

  function traducirErrorFirebase(ex) {
    const c = ex.code || '';
    if (c === 'app/clave-invalida') return ex.message;
    if (c.includes('email-already-in-use')) return 'Ese email ya está registrado. Probá iniciar sesión.';
    if (c.includes('weak-password')) return 'La contraseña necesita al menos 6 caracteres.';
    if (c.includes('user-not-found') || c.includes('wrong-password') || c.includes('invalid-credential')) return 'Email o contraseña incorrectos.';
    if (c.includes('invalid-email')) return 'El email no es válido.';
    if (c.includes('too-many-requests')) return 'Demasiados intentos. Probá de nuevo en un rato.';
    if (c.includes('permission-denied')) return 'No se pudo completar por un problema de permisos. Avisale a Becker.';
    if (!c && ex.message) return ex.message;
    return 'Ocurrió un error. Probá de nuevo.';
  }

  // =======================================================================
  // NAVEGACIÓN POR ROL
  // =======================================================================
  const RENDERERS = {};
  function cambiarVista(vista) {
    if (!RENDERERS[vista]) return;
    state.vistaActual = vista;
    $$('.view').forEach(v => v.classList.remove('view-active'));
    $(`#view-${vista}`)?.classList.add('view-active');
    $$('.nav-item').forEach(a => a.classList.toggle('nav-item-active', a.dataset.view === vista));
    $('#sidebar').classList.remove('sidebar-abierto');
    RENDERERS[vista]();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function construirSidebar(usuario) {
    const nav = $('#sidebar-nav');
    if (usuario.rol === 'superadmin') {
      nav.innerHTML = `<a href="#" class="nav-item" data-view="superadmin">${icon('settings')}<span>Superadmin</span></a>`;
    } else {
      nav.innerHTML = `
        <a href="#" class="nav-item" data-view="turno">${icon('home')}<span>Turno</span></a>
        <a href="#" class="nav-item" data-view="productos">${icon('exercises')}<span>Productos</span></a>
        <a href="#" class="nav-item" data-view="empleados">${icon('settings')}<span>Empleados</span></a>
        <a href="#" class="nav-item" data-view="ventas">${icon('history')}<span>Historial</span></a>`;
    }
    $$('.nav-item', nav).forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); cambiarVista(a.dataset.view); }));
    const etiquetaRol = { superadmin: 'Superadmin', dueño: 'Dueño' }[usuario.rol] || usuario.rol;
    $('#sidebar-usuario').textContent = `${usuario.nombreNegocio || usuario.email} · ${etiquetaRol}`;
  }

  // =======================================================================
  // VISTA SUPERADMIN (mínima — la gestión de clientes es manual por ahora)
  // =======================================================================
  async function renderSuperadmin() {
    const cont = $('#view-superadmin');
    cont.innerHTML = `<p class="texto-suave">Cargando...</p>`;
    const claveActual = await FirebaseService.obtenerClaveAcceso();

    cont.innerHTML = `
      <div class="vista-header"><h2>${icon('settings')} Superadmin</h2></div>

      <div class="panel">
        <div class="panel-header-flex"><h3 style="margin:0">Clave de acceso para dueños nuevos</h3></div>
        <p class="texto-suave texto-pequeno" style="margin-bottom:.9rem">Cualquiera que tenga el link de esta app y esta clave puede registrarse como dueño de su propio kiosco. Cambiala cuando quieras — no hace falta tocar la consola de Firebase ni volver a subir código.</p>
        <div class="campo-fila" style="align-items:end">
          <label class="campo" style="margin-bottom:0"><span>Clave actual</span><input type="text" id="input-clave-acceso" value="${escapeHtml(claveActual)}" placeholder="ej: kiosco2026"></label>
          <button class="btn btn-primario" id="btn-guardar-clave" style="height:fit-content">${icon('save')} Guardar</button>
        </div>
        ${!claveActual ? `<p class="auth-error" style="margin-top:.8rem">Todavía no hay ninguna clave configurada — nadie se puede registrar hasta que pongas una acá.</p>` : ''}
      </div>

      <div class="panel">
        <p class="texto-suave texto-pequeno">Alternativa manual, sin usar la clave: Firebase Console → Authentication → Add user. Esa cuenta entra directo sin pedir clave la primera vez que loguea.</p>
      </div>`;

    $('#btn-guardar-clave').addEventListener('click', async () => {
      const nueva = $('#input-clave-acceso').value.trim();
      if (!nueva) { toast('Poné una clave antes de guardar.', 'error'); return; }
      try {
        await FirebaseService.actualizarClaveAcceso(nueva);
        toast('Clave actualizada.', 'exito');
        renderSuperadmin();
      } catch (ex) { toast(traducirErrorFirebase(ex), 'error'); }
    });
  }

  // =======================================================================
  // VISTA: TURNO (inicio — abrir/cerrar caja y registrar venta)
  // =======================================================================
  async function renderTurno() {
    const cont = $('#view-turno');
    cont.innerHTML = `<p class="texto-suave">Cargando...</p>`;

    state.turnoActual = await FirebaseService.getTurnoAbierto(state.usuario.uid);

    if (!state.turnoActual) {
      cont.innerHTML = `
        <div class="vista-header"><h2>${icon('home')} Turno</h2></div>
        <div class="panel estado-vacio">
          <p>${icon('bell')} No hay un turno abierto ahora mismo.</p>
          <button class="btn btn-primario" id="btn-abrir-turno">${icon('plus')} Abrir turno</button>
        </div>`;
      $('#btn-abrir-turno').addEventListener('click', abrirModalAbrirTurno);
      return;
    }

    const t = state.turnoActual;
    const ventas = await FirebaseService.listarVentasPorTurno(t.id);
    const totalTurno = ventas.reduce((s, v) => s + v.total, 0);

    cont.innerHTML = `
      <div class="vista-header">
        <h2>${icon('home')} Turno abierto</h2>
        <div style="display:flex;gap:.5rem">
          <button class="btn btn-primario" id="btn-registrar-venta">${icon('plus')} Registrar venta</button>
          <button class="btn btn-fantasma" id="btn-cerrar-turno">${icon('close')} Cerrar turno</button>
        </div>
      </div>

      <div class="grid-cards-resumen">
        <div class="card-stat">
          <span class="card-stat-icono">${icon('history')}</span>
          <span class="card-stat-valor">${escapeHtml(t.empleadoNombre || '—')}</span>
          <span class="card-stat-label">Abierto por</span>
        </div>
        <div class="card-stat">
          <span class="card-stat-icono">${icon('calendar')}</span>
          <span class="card-stat-valor">${formatHora(t.horaApertura)}</span>
          <span class="card-stat-label">Hora de apertura</span>
        </div>
        <div class="card-stat">
          <span class="card-stat-icono">${icon('save')}</span>
          <span class="card-stat-valor">${formatMoneda(t.fondoInicial)}</span>
          <span class="card-stat-label">Fondo inicial</span>
        </div>
        <div class="card-stat exito">
          <span class="card-stat-icono">${icon('stats')}</span>
          <span class="card-stat-valor">${formatMoneda(totalTurno)}</span>
          <span class="card-stat-label">Vendido en este turno</span>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header-flex"><h3 style="margin:0">Ventas de este turno</h3></div>
        <div id="lista-ventas-turno"></div>
      </div>`;

    const lista = $('#lista-ventas-turno');
    if (!ventas.length) {
      lista.innerHTML = `<p class="texto-suave">Todavía no se registró ninguna venta en este turno.</p>`;
    } else {
      lista.innerHTML = `<div class="tabla-wrap"><table class="tabla">
        <thead><tr><th>Hora</th><th>Ítems</th><th class="num">Total</th><th>Pago</th></tr></thead>
        <tbody>${ventas.slice().reverse().map(v => `
          <tr>
            <td>${formatHora(v.fecha)}</td>
            <td>${v.items.map(i => `${i.cantidad}× ${escapeHtml(i.nombre)}`).join(', ')}</td>
            <td class="num">${formatMoneda(v.total)}</td>
            <td><span class="badge">${etiquetaMetodoPago(v.metodoPago)}</span></td>
          </tr>`).join('')}</tbody>
      </table></div>`;
    }

    $('#btn-registrar-venta').addEventListener('click', abrirModalVenta);
    $('#btn-cerrar-turno').addEventListener('click', () => abrirModalCerrarTurno(t, ventas));
  }

  function etiquetaMetodoPago(m) {
    return { efectivo: 'Efectivo', qr: 'QR', tarjeta: 'Tarjeta' }[m] || m;
  }

  // -------------------------- Abrir turno --------------------------
  async function abrirModalAbrirTurno() {
    state.empleados = await FirebaseService.listarEmpleados(state.usuario.uid);
    const activos = state.empleados.filter(e => e.activo !== false);

    if (!activos.length) {
      abrirModal(`
        <div class="modal-header"><h3>${icon('warning')} No hay empleados cargados</h3><button data-cerrar-modal class="btn-icono">${icon('close')}</button></div>
        <div class="modal-body"><p>Antes de abrir un turno necesitás dar de alta al menos un empleado (o a vos mismo) en la sección "Empleados".</p></div>
        <div class="modal-footer"><button class="btn btn-primario" data-cerrar-modal>Entendido</button></div>`, { id: 'modal-sin-empleados' });
      return;
    }

    abrirModal(`
      <div class="modal-header"><h3>${icon('plus')} Abrir turno</h3><button data-cerrar-modal class="btn-icono">${icon('close')}</button></div>
      <div class="modal-body">
        <p class="texto-suave" style="margin-bottom:.8rem">¿Quién abre el turno?</p>
        <div class="lista-empleados-elegir">
          ${activos.map(e => `<button class="empleado-elegir-item" data-empleado-id="${e.id}">${icon('history')} ${escapeHtml(e.nombre)}</button>`).join('')}
        </div>
      </div>`, { id: 'modal-abrir-turno' });

    $$('.empleado-elegir-item').forEach(btn => btn.addEventListener('click', () => {
      const empleado = activos.find(e => e.id === btn.dataset.empleadoId);
      pedirPinYAbrirTurno(empleado);
    }));
  }

  function pedirPinYAbrirTurno(empleado) {
    let pinIngresado = '';
    const render = () => {
      abrirModal(`
        <div class="modal-header"><h3>${icon('history')} PIN de ${escapeHtml(empleado.nombre)}</h3><button data-cerrar-modal class="btn-icono">${icon('close')}</button></div>
        <div class="modal-body">
          <div class="pin-pantalla">
            <div class="pin-display ${pinIngresado ? '' : 'pin-display-placeholder'}">${pinIngresado ? '•'.repeat(pinIngresado.length) : 'PIN'}</div>
            <div class="teclado-numerico">
              ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="tecla-numerica" data-num="${n}">${n}</button>`).join('')}
              <button class="tecla-numerica" data-accion="borrar">${icon('close')}</button>
              <button class="tecla-numerica" data-num="0">0</button>
              <button class="tecla-numerica tecla-numerica-accion" data-accion="confirmar">${icon('check')}</button>
            </div>
            <p class="auth-error" id="pin-error" hidden style="margin-top:1rem"></p>
          </div>
        </div>`, { id: 'modal-pin' });

      $$('.tecla-numerica[data-num]').forEach(b => b.addEventListener('click', () => {
        if (pinIngresado.length < 6) pinIngresado += b.dataset.num;
        render();
      }));
      $('[data-accion="borrar"]').addEventListener('click', () => { pinIngresado = pinIngresado.slice(0, -1); render(); });
      $('[data-accion="confirmar"]').addEventListener('click', async () => {
        if (pinIngresado !== String(empleado.pin)) {
          $('#pin-error').textContent = 'PIN incorrecto.'; $('#pin-error').hidden = false;
          pinIngresado = ''; return;
        }
        pedirFondoInicial(empleado);
      });
    };
    render();
  }

  function pedirFondoInicial(empleado) {
    abrirModal(`
      <div class="modal-header"><h3>${icon('save')} Fondo inicial de caja</h3><button data-cerrar-modal class="btn-icono">${icon('close')}</button></div>
      <div class="modal-body">
        <label class="campo"><span>¿Con cuánto efectivo abrís la caja?</span><input type="number" id="input-fondo-inicial" min="0" step="0.01" autofocus value="0"></label>
      </div>
      <div class="modal-footer">
        <button class="btn btn-fantasma" data-cerrar-modal>Cancelar</button>
        <button class="btn btn-primario" id="btn-confirmar-apertura">${icon('check')} Abrir turno</button>
      </div>`, { id: 'modal-fondo-inicial' });

    $('#btn-confirmar-apertura').addEventListener('click', async () => {
      const fondoInicial = Number($('#input-fondo-inicial').value) || 0;
      try {
        await FirebaseService.abrirTurno({
          duenioId: state.usuario.uid, empleadoId: empleado.id, empleadoNombre: empleado.nombre, fondoInicial
        });
        cerrarModal();
        toast('Turno abierto.', 'exito');
        renderTurno();
      } catch (ex) { toast(traducirErrorFirebase(ex), 'error'); }
    });
  }

  // -------------------------- Cerrar turno --------------------------
  function abrirModalCerrarTurno(turno, ventas) {
    const totalEfectivo = ventas.filter(v => v.metodoPago === 'efectivo').reduce((s, v) => s + v.total, 0);
    const totalOtros = ventas.filter(v => v.metodoPago !== 'efectivo').reduce((s, v) => s + v.total, 0);
    const fondoEsperado = turno.fondoInicial + totalEfectivo;

    abrirModal(`
      <div class="modal-header"><h3>${icon('close')} Cerrar turno</h3><button data-cerrar-modal class="btn-icono">${icon('close')}</button></div>
      <div class="modal-body">
        <p class="texto-suave">Fondo inicial: <strong>${formatMoneda(turno.fondoInicial)}</strong></p>
        <p class="texto-suave">Vendido en efectivo: <strong>${formatMoneda(totalEfectivo)}</strong></p>
        <p class="texto-suave">Vendido en QR/tarjeta: <strong>${formatMoneda(totalOtros)}</strong></p>
        <p style="margin:.8rem 0">Debería haber en caja: <strong>${formatMoneda(fondoEsperado)}</strong></p>
        <label class="campo"><span>Contá el efectivo real y anotalo acá</span><input type="number" id="input-fondo-final" min="0" step="0.01" autofocus></label>
        <p class="auth-error" id="cierre-error" hidden></p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-fantasma" data-cerrar-modal>Cancelar</button>
        <button class="btn btn-primario" id="btn-confirmar-cierre">${icon('check')} Cerrar turno</button>
      </div>`, { id: 'modal-cerrar-turno', ancho: 'md' });

    $('#btn-confirmar-cierre').addEventListener('click', async () => {
      const fondoFinalContado = $('#input-fondo-final').value;
      if (fondoFinalContado === '') { $('#cierre-error').textContent = 'Contá la caja antes de cerrar.'; $('#cierre-error').hidden = false; return; }
      try {
        const diferencia = await FirebaseService.cerrarTurno(turno.id, { fondoFinalContado, totalEfectivo, totalOtros });
        cerrarModal();
        if (Math.abs(diferencia) < 0.01) toast('Turno cerrado. Caja exacta.', 'exito');
        else if (diferencia > 0) toast(`Turno cerrado. Sobran ${formatMoneda(diferencia)}.`, 'info');
        else toast(`Turno cerrado. Faltan ${formatMoneda(Math.abs(diferencia))}.`, 'error');
        renderTurno();
      } catch (ex) { toast(traducirErrorFirebase(ex), 'error'); }
    });
  }

  // -------------------------- Registrar venta --------------------------
  async function abrirModalVenta() {
    state.productos = await FirebaseService.listarProductos(state.usuario.uid);
    state.carrito = [];
    renderModalVenta();
  }

  function renderModalVenta(filtro = '') {
    const disponibles = state.productos.filter(p => p.activo !== false &&
      (!filtro || p.nombre.toLowerCase().includes(filtro.toLowerCase()) || (p.codigoBarras || '').includes(filtro)));
    const total = state.carrito.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0);

    abrirModal(`
      <div class="modal-header"><h3>${icon('plus')} Registrar venta</h3><button data-cerrar-modal class="btn-icono">${icon('close')}</button></div>
      <div class="modal-body">
        <div class="buscador-wrap">${icon('search')}<input type="text" id="input-buscar-producto" placeholder="Buscar producto o código..." value="${escapeHtml(filtro)}" autofocus></div>
        <div id="lista-productos-venta" style="max-height:180px;overflow-y:auto;margin-bottom:1rem">
          ${disponibles.length ? disponibles.map(p => `
            <button class="empleado-elegir-item" data-producto-id="${p.id}" style="justify-content:space-between">
              <span>${escapeHtml(p.nombre)}</span>
              <span class="texto-suave">${formatMoneda(p.precioVenta)} · stock ${p.stock}</span>
            </button>`).join('') : `<p class="texto-suave texto-pequeno">Sin resultados.</p>`}
        </div>

        <div class="carrito-lista" id="carrito-lista">
          ${state.carrito.length ? state.carrito.map((i, idx) => `
            <div class="carrito-fila">
              <div style="flex:1">
                <div class="carrito-fila-nombre">${escapeHtml(i.nombre)}</div>
                <div class="carrito-fila-precio">${formatMoneda(i.precioUnitario)} c/u</div>
              </div>
              <div class="carrito-cantidad">
                <button class="btn-icono btn-sm" data-carrito-menos="${idx}">${icon('minus')}</button>
                <span>${i.cantidad}</span>
                <button class="btn-icono btn-sm" data-carrito-mas="${idx}">${icon('plus')}</button>
              </div>
              <strong>${formatMoneda(i.precioUnitario * i.cantidad)}</strong>
              <button class="btn-icono btn-icono-peligro btn-sm" data-carrito-quitar="${idx}">${icon('trash')}</button>
            </div>`).join('') : `<p class="texto-suave texto-pequeno">Todavía no agregaste productos.</p>`}
        </div>

        <div class="carrito-total"><span>Total</span><span>${formatMoneda(total)}</span></div>

        <p class="texto-suave texto-pequeno" style="margin:.9rem 0 .4rem">Método de pago</p>
        <div class="metodos-pago">
          ${['efectivo', 'qr', 'tarjeta'].map(m => `<button class="chip ${state.metodoPagoSeleccionado === m ? 'chip-activo' : ''}" data-metodo="${m}">${etiquetaMetodoPago(m)}</button>`).join('')}
        </div>
        <p class="auth-error" id="venta-error" hidden></p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-fantasma" data-cerrar-modal>Cancelar</button>
        <button class="btn btn-primario" id="btn-confirmar-venta">${icon('check')} Confirmar venta</button>
      </div>`, { id: 'modal-venta', ancho: 'lg' });

    $('#input-buscar-producto').addEventListener('input', debounce((e) => renderModalVenta(e.target.value), 200));
    $$('[data-producto-id]').forEach(btn => btn.addEventListener('click', () => agregarAlCarrito(btn.dataset.productoId, filtro)));
    $$('[data-carrito-mas]').forEach(btn => btn.addEventListener('click', () => cambiarCantidadCarrito(Number(btn.dataset.carritoMas), 1, filtro)));
    $$('[data-carrito-menos]').forEach(btn => btn.addEventListener('click', () => cambiarCantidadCarrito(Number(btn.dataset.carritoMenos), -1, filtro)));
    $$('[data-carrito-quitar]').forEach(btn => btn.addEventListener('click', () => { state.carrito.splice(Number(btn.dataset.carritoQuitar), 1); renderModalVenta(filtro); }));
    $$('[data-metodo]').forEach(btn => btn.addEventListener('click', () => { state.metodoPagoSeleccionado = btn.dataset.metodo; renderModalVenta(filtro); }));
    $('#btn-confirmar-venta').addEventListener('click', () => confirmarVenta());

    // Restaurar el foco y la posición del cursor en el buscador tras cada re-render.
    const inputBuscar = $('#input-buscar-producto');
    inputBuscar.focus();
    inputBuscar.setSelectionRange(filtro.length, filtro.length);
  }

  function agregarAlCarrito(productoId, filtroActual) {
    const producto = state.productos.find(p => p.id === productoId);
    if (!producto) return;
    const yaEnCarrito = state.carrito.find(i => i.productoId === productoId);
    const cantidadActual = yaEnCarrito ? yaEnCarrito.cantidad : 0;
    if (cantidadActual + 1 > producto.stock) { toast('No hay más stock de ese producto.', 'error'); return; }
    if (yaEnCarrito) yaEnCarrito.cantidad += 1;
    else state.carrito.push({ productoId, nombre: producto.nombre, precioUnitario: producto.precioVenta, cantidad: 1, stockDisponible: producto.stock });
    renderModalVenta(filtroActual);
  }

  function cambiarCantidadCarrito(idx, delta, filtroActual) {
    const item = state.carrito[idx];
    if (!item) return;
    const nueva = item.cantidad + delta;
    if (nueva <= 0) { state.carrito.splice(idx, 1); renderModalVenta(filtroActual); return; }
    if (nueva > item.stockDisponible) { toast('No hay más stock de ese producto.', 'error'); return; }
    item.cantidad = nueva;
    renderModalVenta(filtroActual);
  }

  async function confirmarVenta() {
    const errEl = $('#venta-error');
    if (!state.carrito.length) { errEl.textContent = 'Agregá al menos un producto.'; errEl.hidden = false; return; }
    if (!state.metodoPagoSeleccionado) { errEl.textContent = 'Elegí un método de pago.'; errEl.hidden = false; return; }

    const total = state.carrito.reduce((s, i) => s + i.precioUnitario * i.cantidad, 0);
    const items = state.carrito.map(i => ({ productoId: i.productoId, nombre: i.nombre, precioUnitario: i.precioUnitario, cantidad: i.cantidad, subtotal: i.precioUnitario * i.cantidad }));

    // Optimista: descontamos el stock localmente y cerramos el modal ya,
    // guardamos en Firestore en segundo plano.
    items.forEach(item => {
      const p = state.productos.find(pr => pr.id === item.productoId);
      if (p) p.stock -= item.cantidad;
    });
    const turno = state.turnoActual;
    cerrarModal();
    toast('Venta registrada.', 'exito');

    try {
      await FirebaseService.registrarVenta({
        duenioId: state.usuario.uid, turnoId: turno.id, empleadoId: turno.empleadoId, empleadoNombre: turno.empleadoNombre,
        items, total, metodoPago: state.metodoPagoSeleccionado
      });
    } catch (ex) {
      toast('No se pudo guardar la venta: ' + traducirErrorFirebase(ex), 'error');
    }
    state.metodoPagoSeleccionado = null;
    renderTurno();
  }

  // =======================================================================
  // VISTA: PRODUCTOS
  // =======================================================================
  async function renderProductos(filtro = '') {
    const cont = $('#view-productos');
    if (!cont.dataset.cargado) {
      cont.innerHTML = `<p class="texto-suave">Cargando...</p>`;
      state.productos = await FirebaseService.listarProductos(state.usuario.uid);
      cont.dataset.cargado = '1';
    }

    const lista = state.productos.filter(p => !filtro || p.nombre.toLowerCase().includes(filtro.toLowerCase()));
    const stockBajo = state.productos.filter(p => p.stock <= p.stockMinimo);

    cont.innerHTML = `
      <div class="vista-header">
        <h2>${icon('exercises')} Productos</h2>
        <button class="btn btn-primario btn-sm" id="btn-nuevo-producto">${icon('plus')} Nuevo producto</button>
      </div>

      <div class="grid-cards-resumen" style="grid-template-columns:repeat(2,1fr)">
        <div class="card-stat"><span class="card-stat-icono">${icon('exercises')}</span><span class="card-stat-valor">${state.productos.length}</span><span class="card-stat-label">Productos cargados</span></div>
        <div class="card-stat ${stockBajo.length ? 'peligro' : ''}"><span class="card-stat-icono">${icon('warning')}</span><span class="card-stat-valor">${stockBajo.length}</span><span class="card-stat-label">Con stock bajo</span></div>
      </div>

      <div class="buscador-wrap">${icon('search')}<input type="text" id="input-buscar-producto-lista" placeholder="Buscar producto..." value="${escapeHtml(filtro)}"></div>

      <div class="tabla-wrap">
        <table class="tabla">
          <thead><tr><th>Nombre</th><th>Categoría</th><th class="num">Costo</th><th class="num">Venta</th><th class="num">Stock</th><th></th></tr></thead>
          <tbody>
            ${lista.length ? lista.map(p => `
              <tr class="${p.stock <= p.stockMinimo ? 'fila-stock-bajo' : ''}">
                <td>${escapeHtml(p.nombre)}</td>
                <td>${escapeHtml(p.categoria || '—')}</td>
                <td class="num">${formatMoneda(p.precioCosto)}</td>
                <td class="num">${formatMoneda(p.precioVenta)}</td>
                <td class="num">${p.stock}${p.stock <= p.stockMinimo ? ' ' + icon('warning') : ''}</td>
                <td class="tabla-acciones">
                  <button class="btn-icono btn-sm" data-editar-producto="${p.id}">${icon('edit')}</button>
                  <button class="btn-icono btn-icono-peligro btn-sm" data-eliminar-producto="${p.id}">${icon('trash')}</button>
                </td>
              </tr>`).join('') : `<tr><td colspan="6"><div class="estado-vacio texto-suave">Sin productos todavía.</div></td></tr>`}
          </tbody>
        </table>
      </div>`;

    $('#btn-nuevo-producto').addEventListener('click', () => abrirModalProducto());
    $('#input-buscar-producto-lista').addEventListener('input', debounce((e) => renderProductos(e.target.value), 200));
    $$('[data-editar-producto]').forEach(btn => btn.addEventListener('click', () => abrirModalProducto(state.productos.find(p => p.id === btn.dataset.editarProducto))));
    $$('[data-eliminar-producto]').forEach(btn => btn.addEventListener('click', () => confirmarEliminarProducto(btn.dataset.eliminarProducto)));
  }

  function abrirModalProducto(producto = null) {
    abrirModal(`
      <div class="modal-header"><h3>${icon(producto ? 'edit' : 'plus')} ${producto ? 'Editar' : 'Nuevo'} producto</h3><button data-cerrar-modal class="btn-icono">${icon('close')}</button></div>
      <div class="modal-body">
        <label class="campo"><span>Nombre</span><input type="text" id="prod-nombre" value="${producto ? escapeHtml(producto.nombre) : ''}" autofocus></label>
        <div class="campo-fila">
          <label class="campo"><span>Categoría</span><input type="text" id="prod-categoria" value="${producto ? escapeHtml(producto.categoria || '') : ''}"></label>
          <label class="campo"><span>Código de barras (opcional)</span><input type="text" id="prod-codigo" value="${producto ? escapeHtml(producto.codigoBarras || '') : ''}"></label>
        </div>
        <div class="campo-fila">
          <label class="campo"><span>Precio de costo</span><input type="number" id="prod-costo" min="0" step="0.01" value="${producto ? producto.precioCosto : ''}"></label>
          <label class="campo"><span>Precio de venta</span><input type="number" id="prod-venta" min="0" step="0.01" value="${producto ? producto.precioVenta : ''}"></label>
        </div>
        <div class="campo-fila">
          <label class="campo"><span>Stock actual</span><input type="number" id="prod-stock" min="0" value="${producto ? producto.stock : 0}"></label>
          <label class="campo"><span>Alertar si el stock baja de</span><input type="number" id="prod-stock-minimo" min="0" value="${producto ? producto.stockMinimo : 0}"></label>
        </div>
        <p class="auth-error" id="producto-error" hidden></p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-fantasma" data-cerrar-modal>Cancelar</button>
        <button class="btn btn-primario" id="btn-guardar-producto">${icon('save')} Guardar</button>
      </div>`, { id: 'modal-producto' });

    $('#btn-guardar-producto').addEventListener('click', async () => {
      const nombre = $('#prod-nombre').value.trim();
      if (!nombre) { $('#producto-error').textContent = 'Poné un nombre.'; $('#producto-error').hidden = false; return; }
      const datos = {
        nombre, categoria: $('#prod-categoria').value.trim(), codigoBarras: $('#prod-codigo').value.trim(),
        precioCosto: $('#prod-costo').value, precioVenta: $('#prod-venta').value,
        stock: $('#prod-stock').value, stockMinimo: $('#prod-stock-minimo').value
      };
      try {
        if (producto) {
          Object.assign(producto, datos, { precioCosto: Number(datos.precioCosto) || 0, precioVenta: Number(datos.precioVenta) || 0, stock: Number(datos.stock) || 0, stockMinimo: Number(datos.stockMinimo) || 0 });
          await FirebaseService.actualizarProducto(producto.id, datos);
        } else {
          const id = await FirebaseService.crearProducto(state.usuario.uid, datos);
          state.productos.push({ id, duenioId: state.usuario.uid, activo: true, ...datos, precioCosto: Number(datos.precioCosto) || 0, precioVenta: Number(datos.precioVenta) || 0, stock: Number(datos.stock) || 0, stockMinimo: Number(datos.stockMinimo) || 0 });
        }
        cerrarModal();
        toast('Producto guardado.', 'exito');
        renderProductos();
      } catch (ex) { $('#producto-error').textContent = traducirErrorFirebase(ex); $('#producto-error').hidden = false; }
    });
  }

  function confirmarEliminarProducto(id) {
    abrirModal(`
      <div class="modal-header"><h3>${icon('warning')} Eliminar producto</h3><button data-cerrar-modal class="btn-icono">${icon('close')}</button></div>
      <div class="modal-body"><p>Esto borra el producto de la lista. Las ventas ya registradas no se ven afectadas. ¿Seguro?</p></div>
      <div class="modal-footer">
        <button class="btn btn-fantasma" data-cerrar-modal>Cancelar</button>
        <button class="btn btn-peligro" id="btn-confirmar-eliminar-producto">${icon('trash')} Eliminar</button>
      </div>`, { id: 'modal-eliminar-producto' });

    $('#btn-confirmar-eliminar-producto').addEventListener('click', async () => {
      try {
        await FirebaseService.eliminarProducto(id);
        state.productos = state.productos.filter(p => p.id !== id);
        cerrarModal();
        toast('Producto eliminado.', 'exito');
        renderProductos();
      } catch (ex) { toast(traducirErrorFirebase(ex), 'error'); }
    });
  }

  // =======================================================================
  // VISTA: EMPLEADOS
  // =======================================================================
  async function renderEmpleados() {
    const cont = $('#view-empleados');
    cont.innerHTML = `<p class="texto-suave">Cargando...</p>`;
    state.empleados = await FirebaseService.listarEmpleados(state.usuario.uid);

    cont.innerHTML = `
      <div class="vista-header">
        <h2>${icon('settings')} Empleados</h2>
        <button class="btn btn-primario btn-sm" id="btn-nuevo-empleado">${icon('plus')} Nuevo empleado</button>
      </div>
      <p class="texto-suave texto-pequeno" style="margin-bottom:1rem">El PIN se usa solo para identificar quién abre cada turno — no es una contraseña de sistema, así que no hace falta que sea muy compleja.</p>
      <div class="tabla-wrap">
        <table class="tabla">
          <thead><tr><th>Nombre</th><th>PIN</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${state.empleados.length ? state.empleados.map(e => `
              <tr>
                <td>${escapeHtml(e.nombre)}</td>
                <td>${'•'.repeat(String(e.pin).length)}</td>
                <td>${e.activo === false ? '<span class="badge badge-peligro">Inactivo</span>' : '<span class="badge badge-exito">Activo</span>'}</td>
                <td class="tabla-acciones">
                  <button class="btn-icono btn-sm" data-editar-empleado="${e.id}">${icon('edit')}</button>
                  <button class="btn-icono btn-icono-peligro btn-sm" data-eliminar-empleado="${e.id}">${icon('trash')}</button>
                </td>
              </tr>`).join('') : `<tr><td colspan="4"><div class="estado-vacio texto-suave">Sin empleados todavía.</div></td></tr>`}
          </tbody>
        </table>
      </div>`;

    $('#btn-nuevo-empleado').addEventListener('click', () => abrirModalEmpleado());
    $$('[data-editar-empleado]').forEach(btn => btn.addEventListener('click', () => abrirModalEmpleado(state.empleados.find(e => e.id === btn.dataset.editarEmpleado))));
    $$('[data-eliminar-empleado]').forEach(btn => btn.addEventListener('click', () => confirmarEliminarEmpleado(btn.dataset.eliminarEmpleado)));
  }

  function abrirModalEmpleado(empleado = null) {
    abrirModal(`
      <div class="modal-header"><h3>${icon(empleado ? 'edit' : 'plus')} ${empleado ? 'Editar' : 'Nuevo'} empleado</h3><button data-cerrar-modal class="btn-icono">${icon('close')}</button></div>
      <div class="modal-body">
        <label class="campo"><span>Nombre</span><input type="text" id="emp-nombre" value="${empleado ? escapeHtml(empleado.nombre) : ''}" autofocus></label>
        <label class="campo"><span>PIN (4 dígitos)</span><input type="text" id="emp-pin" inputmode="numeric" maxlength="6" value="${empleado ? escapeHtml(String(empleado.pin)) : ''}"></label>
        ${empleado ? `<label class="campo"><span>Estado</span><select id="emp-activo"><option value="true" ${empleado.activo !== false ? 'selected' : ''}>Activo</option><option value="false" ${empleado.activo === false ? 'selected' : ''}>Inactivo</option></select></label>` : ''}
        <p class="auth-error" id="empleado-error" hidden></p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-fantasma" data-cerrar-modal>Cancelar</button>
        <button class="btn btn-primario" id="btn-guardar-empleado">${icon('save')} Guardar</button>
      </div>`, { id: 'modal-empleado' });

    $('#btn-guardar-empleado').addEventListener('click', async () => {
      const nombre = $('#emp-nombre').value.trim();
      const pin = $('#emp-pin').value.trim();
      if (!nombre || !pin) { $('#empleado-error').textContent = 'Completá nombre y PIN.'; $('#empleado-error').hidden = false; return; }
      try {
        if (empleado) {
          const activo = $('#emp-activo').value === 'true';
          await FirebaseService.actualizarEmpleado(empleado.id, { nombre, pin, activo });
        } else {
          await FirebaseService.crearEmpleado(state.usuario.uid, { nombre, pin });
        }
        cerrarModal();
        toast('Empleado guardado.', 'exito');
        renderEmpleados();
      } catch (ex) { $('#empleado-error').textContent = traducirErrorFirebase(ex); $('#empleado-error').hidden = false; }
    });
  }

  function confirmarEliminarEmpleado(id) {
    abrirModal(`
      <div class="modal-header"><h3>${icon('warning')} Eliminar empleado</h3><button data-cerrar-modal class="btn-icono">${icon('close')}</button></div>
      <div class="modal-body"><p>Los turnos que ya abrió quedan igual en el historial. ¿Seguro que querés eliminarlo?</p></div>
      <div class="modal-footer">
        <button class="btn btn-fantasma" data-cerrar-modal>Cancelar</button>
        <button class="btn btn-peligro" id="btn-confirmar-eliminar-empleado">${icon('trash')} Eliminar</button>
      </div>`, { id: 'modal-eliminar-empleado' });

    $('#btn-confirmar-eliminar-empleado').addEventListener('click', async () => {
      try {
        await FirebaseService.eliminarEmpleado(id);
        cerrarModal();
        toast('Empleado eliminado.', 'exito');
        renderEmpleados();
      } catch (ex) { toast(traducirErrorFirebase(ex), 'error'); }
    });
  }

  // =======================================================================
  // VISTA: HISTORIAL DE VENTAS
  // =======================================================================
  async function renderVentas(fechaDia = hoyISO()) {
    const cont = $('#view-ventas');
    cont.innerHTML = `<p class="texto-suave">Cargando...</p>`;
    const ventas = await FirebaseService.listarVentasDelDia(state.usuario.uid, fechaDia);
    const total = ventas.reduce((s, v) => s + v.total, 0);

    cont.innerHTML = `
      <div class="vista-header">
        <h2>${icon('history')} Historial de ventas</h2>
        <input type="date" id="input-fecha-historial" value="${fechaDia}" class="campo" style="margin:0;padding:.5rem .7rem;border-radius:8px;border:1px solid var(--color-borde);background:var(--color-fondo-elevado);color:var(--color-texto)">
      </div>
      <div class="grid-cards-resumen" style="grid-template-columns:repeat(2,1fr)">
        <div class="card-stat"><span class="card-stat-icono">${icon('history')}</span><span class="card-stat-valor">${ventas.length}</span><span class="card-stat-label">Ventas ese día</span></div>
        <div class="card-stat exito"><span class="card-stat-icono">${icon('stats')}</span><span class="card-stat-valor">${formatMoneda(total)}</span><span class="card-stat-label">Total facturado</span></div>
      </div>
      <div class="tabla-wrap">
        <table class="tabla">
          <thead><tr><th>Hora</th><th>Empleado</th><th>Ítems</th><th class="num">Total</th><th>Pago</th></tr></thead>
          <tbody>
            ${ventas.length ? ventas.map(v => `
              <tr>
                <td>${formatHora(v.fecha)}</td>
                <td>${escapeHtml(v.empleadoNombre || '—')}</td>
                <td>${v.items.map(i => `${i.cantidad}× ${escapeHtml(i.nombre)}`).join(', ')}</td>
                <td class="num">${formatMoneda(v.total)}</td>
                <td><span class="badge">${etiquetaMetodoPago(v.metodoPago)}</span></td>
              </tr>`).join('') : `<tr><td colspan="5"><div class="estado-vacio texto-suave">Sin ventas ese día.</div></td></tr>`}
          </tbody>
        </table>
      </div>`;

    $('#input-fecha-historial').addEventListener('change', (e) => renderVentas(e.target.value));
  }

  RENDERERS.superadmin = renderSuperadmin;
  RENDERERS.turno = renderTurno;
  RENDERERS.productos = () => { $('#view-productos').dataset.cargado = ''; renderProductos(); };
  RENDERERS.empleados = renderEmpleados;
  RENDERERS.ventas = () => renderVentas();

  // =======================================================================
  // AUTENTICACIÓN
  // =======================================================================
  function initAuthUI() {
    $$('.auth-tab').forEach(tab => tab.addEventListener('click', () => {
      $$('.auth-tab').forEach(t => t.classList.remove('auth-tab-activo'));
      tab.classList.add('auth-tab-activo');
      $('#form-login').hidden = tab.dataset.tab !== 'login';
      $('#form-registro').hidden = tab.dataset.tab !== 'registro';
    }));

    $('#form-registro').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#registro-error'); err.hidden = true;
      try {
        const usuario = await FirebaseService.registrarDueño({
          nombreNegocio: $('#registro-negocio').value.trim(),
          email: $('#registro-email').value.trim(),
          password: $('#registro-password').value,
          clave: $('#registro-clave').value
        });
        await entrarConUsuario(usuario);
      } catch (ex) {
        err.textContent = traducirErrorFirebase(ex); err.hidden = false;
      }
    });

    $('#form-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#login-error'); err.hidden = true;
      const email = $('#login-email').value.trim();
      const password = $('#login-password').value;
      try {
        const usuario = await FirebaseService.iniciarSesion(email, password);
        await entrarConUsuario(usuario);
      } catch (ex) {
        err.textContent = traducirErrorFirebase(ex); err.hidden = false;
      }
    });

    $('#btn-olvide-password').addEventListener('click', async () => {
      const email = $('#login-email').value.trim();
      if (!email) { toast('Escribí tu email arriba primero.', 'error'); return; }
      try { await FirebaseService.recuperarContrasena(email); toast('Te mandamos un email para restablecer tu contraseña.', 'exito'); }
      catch (ex) { toast(traducirErrorFirebase(ex), 'error'); }
    });

    $('#btn-cerrar-sesion').addEventListener('click', () => FirebaseService.cerrarSesion());
    $('#btn-cerrar-sesion-suspendido')?.addEventListener('click', () => FirebaseService.cerrarSesion());
    $('#btn-menu-movil')?.addEventListener('click', () => $('#sidebar').classList.toggle('sidebar-abierto'));
  }

  function abrirModalCompletarNegocio() {
    abrirModal(`
      <div class="modal-header"><h3>${icon('home')} ¡Bienvenido!</h3></div>
      <div class="modal-body">
        <p class="texto-suave" style="margin-bottom:1rem">Es la primera vez que entrás. ¿Cómo se llama tu kiosco?</p>
        <label class="campo"><span>Nombre del negocio</span><input type="text" id="input-nombre-negocio" autofocus></label>
        <p class="auth-error" id="negocio-error" hidden></p>
      </div>
      <div class="modal-footer"><button class="btn btn-primario btn-full" id="btn-confirmar-negocio">${icon('check')} Empezar</button></div>`,
      { id: 'modal-completar-negocio' });

    $('#btn-confirmar-negocio').addEventListener('click', async () => {
      const nombreNegocio = $('#input-nombre-negocio').value.trim();
      if (!nombreNegocio) { $('#negocio-error').textContent = 'Poné un nombre.'; $('#negocio-error').hidden = false; return; }
      try {
        const usuario = await FirebaseService.completarAltaDueño(nombreNegocio);
        cerrarModal();
        await entrarConUsuario(usuario);
      } catch (ex) { $('#negocio-error').textContent = traducirErrorFirebase(ex); $('#negocio-error').hidden = false; }
    });
  }

  async function mostrarPantallaSuspendido() {
    $('#pantalla-auth').hidden = true;
    $('#app').hidden = true;
    $('#pantalla-suspendido').hidden = false;
  }

  let ultimoUidRenderizado = null;

  async function entrarConUsuario(usuario) {
    if (!usuario) { $('#pantalla-auth').hidden = false; $('#app').hidden = true; return; }

    if (usuario.sinPerfil) {
      $('#pantalla-auth').hidden = false;
      $('#app').hidden = true;
      abrirModalCompletarNegocio();
      return;
    }

    if (usuario.activo === false) { mostrarPantallaSuspendido(); return; }

    if (ultimoUidRenderizado === usuario.uid && !$('#app').hidden) return;
    ultimoUidRenderizado = usuario.uid;
    state.usuario = usuario;

    $('#pantalla-suspendido').hidden = true;
    $('#pantalla-auth').hidden = true;
    $('#app').hidden = false;
    construirSidebar(usuario);
    cambiarVista(usuario.rol === 'superadmin' ? 'superadmin' : 'turno');
  }

  // ---------------------------------------------------------------------
  // Inicialización
  // ---------------------------------------------------------------------
  function ocultarSplash() {
    const splash = $('#splash-screen');
    if (!splash) return;
    setTimeout(() => { splash.classList.add('splash-oculto'); setTimeout(() => splash.remove(), 600); }, 700);
  }

  function aplicarMarcaEnDOM() {
    $$('[data-marca="nombre"]').forEach(el => { el.textContent = MARCA.nombre; });
    $$('[data-marca="sufijo"]').forEach(el => { el.textContent = MARCA.sufijo; });
  }

  function init() {
    aplicarMarcaEnDOM();
    initAuthUI();

    if (!FirebaseService.configurado()) {
      ocultarSplash();
      $('#pantalla-auth').hidden = false;
      abrirModal(`
        <div class="modal-header"><h3>${icon('warning')} Falta conectar Firebase</h3></div>
        <div class="modal-body"><p>Esta app todavía no tiene un proyecto de Firebase conectado. Completá <code>js/firebase-config.js</code> con los datos de tu proyecto para poder usarla.</p></div>`, { id: 'modal-sin-firebase' });
      return;
    }

    FirebaseService.init();
    FirebaseService.onCambioSesion((usuario) => {
      ocultarSplash();
      entrarConUsuario(usuario);
    });
  }

  return { init, $, $$ };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
