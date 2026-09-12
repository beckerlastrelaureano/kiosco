/**
 * firebase-config.js
 * -----------------------------------------------------------------------
 * Proyecto de Firebase de TODA la línea de kioscos ("becker-kioscos") —
 * separado del proyecto de los gimnasios a propósito, para no compartir
 * cuota de lecturas/escrituras con Tomicoach/Becker App/FTS.
 *
 * Todos los clientes kiosco (KioscoBase clonado y personalizado para cada
 * uno) usan este MISMO archivo, sin tocarlo — igual que pasa con
 * firebase-config.js en el ecosistema de gimnasios. Lo que cambia por
 * cliente es js/marca.js (nombre, colores) y los íconos, no esto.
 *
 * Esto NO es un secreto que haya que esconder: es normal que la config de
 * Firebase quede visible en el código del lado del cliente. La seguridad
 * real la da firestore.rules (ver ese archivo en la raíz del proyecto),
 * no ocultar esta config.
 */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCnPpwLHdYPHqBP4NpSXYNc2Zj4-MPB8Vg",
  authDomain: "becker-kioscos.firebaseapp.com",
  projectId: "becker-kioscos",
  storageBucket: "becker-kioscos.firebasestorage.app",
  messagingSenderId: "654552480441",
  appId: "1:654552480441:web:15b7225c4dfdd4e05e3968"
};

// Email que la app reconoce automáticamente como superadmin (Becker). No
// hace falta código de invitación para él: al loguearse por primera vez
// (la cuenta de Authentication la creás vos a mano en la consola), la app
// le crea su ficha de superadmin sola.
//
// Cualquier OTRA cuenta que loguee por primera vez se convierte en
// "dueño" de un kiosco nuevo (le pide el nombre del negocio una vez). Por
// eso: la única forma de que alguien entre a esta app es que VOS le crees
// la cuenta de Authentication a mano (Firebase Console → Authentication →
// Add user) — no hay registro público. Ver README.md para el paso a paso
// de alta de un cliente nuevo.
const EMAIL_SUPERADMIN = "beckerlastrelaureano@gmail.com";
