/**
 * firebase-service.js
 * -----------------------------------------------------------------------
 * Toda la comunicación con Firebase pasa por acá. El resto de la app no
 * llama a firebase.* directamente, solo a las funciones de este archivo.
 *
 * Modelo de DOS roles: superadmin (Becker) / dueño (cada kiosco cliente).
 * No hay Authentication para "empleados": el personal por turno se
 * identifica con un PIN corto guardado en empleadosKiosco, pero quien
 * escribe en Firestore siempre es la sesión del DUEÑO logueado en el
 * dispositivo. El PIN es una etiqueta de "quién hizo esto", no un
 * permiso — ver README.md.
 *
 * Alta de cuentas: NO hay registro público. Becker crea la cuenta de
 * Authentication a mano (consola) para cada cliente nuevo. La PRIMERA vez
 * que esa cuenta inicia sesión y no tiene ficha en "usuariosKiosco", la
 * app se la crea sola: si el email es el de Becker, se vuelve superadmin;
 * cualquier otro email se vuelve "dueño" (le pedimos el nombre del
 * negocio una sola vez).
 *
 * Colecciones en Firestore:
 *   usuariosKiosco/{uid}   -> { rol, email, nombreNegocio, activo, fechaAlta }
 *   productosKiosco/{id}   -> { duenioId, codigoBarras, nombre, categoria,
 *                                 precioCosto, precioVenta, stock,
 *                                 stockMinimo, activo, actualizado }
 *   empleadosKiosco/{id}   -> { duenioId, nombre, pin, activo }
 *   turnosKiosco/{id}      -> { duenioId, empleadoId, empleadoNombre,
 *                                 horaApertura, horaCierre, fondoInicial,
 *                                 fondoFinalContado, totalEfectivo,
 *                                 totalOtros, diferencia, abierto }
 *   ventasKiosco/{id}      -> { duenioId, turnoId, empleadoId,
 *                                 empleadoNombre, fecha, fechaDia, items,
 *                                 total, metodoPago }
 */

const FirebaseService = (() => {

  let app, auth, db;
  let usuarioActual = null;

  function init() {
    app = firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.firestore();
  }

  function configurado() {
    return !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey);
  }

  // ---------------------------------------------------------------------
  // Autenticación + alta automática de ficha en el primer login
  // ---------------------------------------------------------------------

  // Dado un `user` de Firebase Auth, devuelve la ficha de usuariosKiosco.
  // Si todavía no existe: la crea sola si es el email de Becker
  // (superadmin); si no, devuelve { sinPerfil: true } para que la UI
  // pida el nombre del negocio antes de crear la ficha de "dueño".
  async function resolverUsuario(user) {
    const doc = await db.collection('usuariosKiosco').doc(user.uid).get();
    if (doc.exists) {
      usuarioActual = { uid: user.uid, ...doc.data() };
      return usuarioActual;
    }
    if (user.email.trim().toLowerCase() === EMAIL_SUPERADMIN.toLowerCase()) {
      const datos = { rol: 'superadmin', email: user.email, activo: true, fechaAlta: new Date().toISOString() };
      await db.collection('usuariosKiosco').doc(user.uid).set(datos);
      usuarioActual = { uid: user.uid, ...datos };
      return usuarioActual;
    }
    usuarioActual = null;
    return { uid: user.uid, email: user.email, sinPerfil: true };
  }

  function onCambioSesion(callback) {
    auth.onAuthStateChanged(async (user) => {
      if (!user) { usuarioActual = null; callback(null); return; }
      callback(await resolverUsuario(user));
    });
  }

  async function iniciarSesion(email, password) {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    return resolverUsuario(cred.user);
  }

  // ---------------------------------------------------------------------
  // Clave de acceso para el registro público de dueños (configuracion/global)
  // ---------------------------------------------------------------------
  async function obtenerClaveAcceso() {
    const doc = await db.collection('configuracion').doc('global').get();
    return doc.exists ? (doc.data().claveAccesoDueños || '') : '';
  }

  function actualizarClaveAcceso(nuevaClave) {
    return db.collection('configuracion').doc('global').set({ claveAccesoDueños: nuevaClave.trim() }, { merge: true });
  }

  // Registro público de un dueño nuevo, con clave de acceso (no requiere
  // que Becker cree la cuenta a mano en la consola). Mismo criterio que
  // "codigosInvitacion" en el ecosistema de gimnasios: primero se crea el
  // login de Firebase Auth, y RECIÉN autenticado se puede leer la clave
  // real desde Firestore para compararla. Si no coincide, se borra el
  // login recién creado para no dejar una cuenta fantasma.
  async function registrarDueño({ nombreNegocio, email, password, clave }) {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    try {
      const claveReal = await obtenerClaveAcceso();
      if (!claveReal || (clave || '').trim() !== claveReal) {
        const err = new Error('La clave de acceso no es correcta. Pedísela a quien te compartió el link.');
        err.code = 'app/clave-invalida';
        throw err;
      }
      const datos = {
        rol: 'dueño', email,
        nombreNegocio: (nombreNegocio || '').trim() || 'Mi kiosco',
        activo: true, fechaAlta: new Date().toISOString()
      };
      await db.collection('usuariosKiosco').doc(cred.user.uid).set(datos);
      usuarioActual = { uid: cred.user.uid, ...datos };
      return usuarioActual;
    } catch (err) {
      await cred.user.delete().catch(() => {});
      throw err;
    }
  }

  // Se llama una sola vez, después de que resolverUsuario() devuelve
  // sinPerfil:true — pasa solo con cuentas que Becker creó a mano en la
  // consola de Authentication (sin pasar por el registro público), y por
  // eso no pide clave: esa cuenta ya es de por sí una decisión de Becker.
  async function completarAltaDueño(nombreNegocio) {
    const user = auth.currentUser;
    if (!user) throw new Error('Se perdió la sesión, volvé a intentar.');
    const datos = {
      rol: 'dueño',
      email: user.email,
      nombreNegocio: (nombreNegocio || '').trim() || 'Mi kiosco',
      activo: true,
      fechaAlta: new Date().toISOString()
    };
    await db.collection('usuariosKiosco').doc(user.uid).set(datos);
    usuarioActual = { uid: user.uid, ...datos };
    return usuarioActual;
  }

  function cerrarSesion() {
    return auth.signOut();
  }

  function recuperarContrasena(email) {
    return auth.sendPasswordResetEmail(email);
  }

  function getUsuarioActual() {
    return usuarioActual;
  }

  // ---------------------------------------------------------------------
  // Productos
  // ---------------------------------------------------------------------
  async function listarProductos(duenioId) {
    const snap = await db.collection('productosKiosco').where('duenioId', '==', duenioId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async function crearProducto(duenioId, datos) {
    const ref = await db.collection('productosKiosco').add({
      duenioId,
      codigoBarras: datos.codigoBarras || '',
      nombre: datos.nombre.trim(),
      categoria: datos.categoria || '',
      precioCosto: Number(datos.precioCosto) || 0,
      precioVenta: Number(datos.precioVenta) || 0,
      stock: Number(datos.stock) || 0,
      stockMinimo: Number(datos.stockMinimo) || 0,
      activo: true,
      actualizado: new Date().toISOString()
    });
    return ref.id;
  }

  function actualizarProducto(id, datos) {
    const limpio = { ...datos, actualizado: new Date().toISOString() };
    ['precioCosto', 'precioVenta', 'stock', 'stockMinimo'].forEach(campo => {
      if (campo in limpio) limpio[campo] = Number(limpio[campo]) || 0;
    });
    return db.collection('productosKiosco').doc(id).update(limpio);
  }

  function eliminarProducto(id) {
    return db.collection('productosKiosco').doc(id).delete();
  }

  // ---------------------------------------------------------------------
  // Empleados
  // ---------------------------------------------------------------------
  async function listarEmpleados(duenioId) {
    const snap = await db.collection('empleadosKiosco').where('duenioId', '==', duenioId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async function crearEmpleado(duenioId, { nombre, pin }) {
    const ref = await db.collection('empleadosKiosco').add({
      duenioId, nombre: nombre.trim(), pin: String(pin).trim(), activo: true
    });
    return ref.id;
  }

  function actualizarEmpleado(id, datos) {
    return db.collection('empleadosKiosco').doc(id).update(datos);
  }

  function eliminarEmpleado(id) {
    return db.collection('empleadosKiosco').doc(id).delete();
  }

  // ---------------------------------------------------------------------
  // Turnos
  // ---------------------------------------------------------------------

  // Devuelve el turno abierto de este dueño, o null si no hay ninguno.
  async function getTurnoAbierto(duenioId) {
    const snap = await db.collection('turnosKiosco')
      .where('duenioId', '==', duenioId).where('abierto', '==', true).limit(1).get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  async function abrirTurno({ duenioId, empleadoId, empleadoNombre, fondoInicial }) {
    const ref = await db.collection('turnosKiosco').add({
      duenioId, empleadoId: empleadoId || null, empleadoNombre: empleadoNombre || '',
      horaApertura: new Date().toISOString(), horaCierre: null,
      fondoInicial: Number(fondoInicial) || 0,
      fondoFinalContado: null, totalEfectivo: 0, totalOtros: 0, diferencia: null,
      abierto: true
    });
    return ref.id;
  }

  async function cerrarTurno(turnoId, { fondoFinalContado, totalEfectivo, totalOtros }) {
    const turnoDoc = await db.collection('turnosKiosco').doc(turnoId).get();
    const fondoInicial = turnoDoc.data().fondoInicial || 0;
    const fondoEsperado = fondoInicial + totalEfectivo;
    const diferencia = Number(fondoFinalContado) - fondoEsperado;
    await db.collection('turnosKiosco').doc(turnoId).update({
      horaCierre: new Date().toISOString(),
      fondoFinalContado: Number(fondoFinalContado) || 0,
      totalEfectivo, totalOtros, diferencia,
      abierto: false
    });
    return diferencia;
  }

  async function listarTurnos(duenioId, limite = 30) {
    const snap = await db.collection('turnosKiosco').where('duenioId', '==', duenioId)
      .orderBy('horaApertura', 'desc').limit(limite).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // ---------------------------------------------------------------------
  // Ventas
  // ---------------------------------------------------------------------

  // Crea la venta y descuenta el stock de cada producto vendido en el
  // mismo lote (batch). El descuento usa FieldValue.increment, que es
  // atómico a nivel de campo en el servidor aunque dos ventas se estén
  // guardando casi al mismo tiempo desde dos turnos/dispositivos.
  async function registrarVenta({ duenioId, turnoId, empleadoId, empleadoNombre, items, total, metodoPago }) {
    const ahora = new Date();
    const batch = db.batch();

    const ventaRef = db.collection('ventasKiosco').doc();
    batch.set(ventaRef, {
      duenioId, turnoId: turnoId || null, empleadoId: empleadoId || null, empleadoNombre: empleadoNombre || '',
      fecha: ahora.toISOString(),
      fechaDia: ahora.toISOString().slice(0, 10),
      items, total, metodoPago
    });

    items.forEach(item => {
      const prodRef = db.collection('productosKiosco').doc(item.productoId);
      batch.update(prodRef, { stock: firebase.firestore.FieldValue.increment(-item.cantidad) });
    });

    await batch.commit();
    return ventaRef.id;
  }

  async function listarVentasPorTurno(turnoId) {
    const snap = await db.collection('ventasKiosco').where('turnoId', '==', turnoId).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  async function listarVentasDelDia(duenioId, fechaDia) {
    const snap = await db.collection('ventasKiosco')
      .where('duenioId', '==', duenioId).where('fechaDia', '==', fechaDia).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.fecha.localeCompare(a.fecha));
  }

  return {
    init, configurado,
    onCambioSesion, iniciarSesion, registrarDueño, completarAltaDueño, cerrarSesion, recuperarContrasena, getUsuarioActual,
    obtenerClaveAcceso, actualizarClaveAcceso,
    listarProductos, crearProducto, actualizarProducto, eliminarProducto,
    listarEmpleados, crearEmpleado, actualizarEmpleado, eliminarEmpleado,
    getTurnoAbierto, abrirTurno, cerrarTurno, listarTurnos,
    registrarVenta, listarVentasPorTurno, listarVentasDelDia
  };
})();
