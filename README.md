# KioscoBase

Template para armar el panel de un kiosco (control de stock, ventas y turnos) para un cliente
nuevo de la línea de kioscos. Corre sobre el proyecto de Firebase **`becker-kioscos`**, separado
a propósito del proyecto de los gimnasios para no compartir cuota de lecturas/escrituras.

## Fase 1 (esta entrega): lo que ya funciona

- **Productos**: alta/edición/baja, precio de costo y de venta, stock, alerta de stock bajo.
- **Turno**: apertura con empleado + PIN + fondo inicial de caja; cierre con arqueo (compara lo
  que debería haber contra lo que se contó, y muestra la diferencia).
- **Registrar venta**: elegís productos de una lista (con buscador), armás el carrito, elegís
  método de pago (efectivo/QR/tarjeta), confirmás — descuenta stock automático.
- **Historial de ventas** por día.

## Fase 2 (pendiente, no incluida en esta entrega)

- Movimientos de stock por **compra a proveedor**, con foto del comprobante subida a Firebase
  Storage (esto requiere pasar el proyecto a plan **Blaze** — ver más abajo).
- Reporte de margen (venta − costo) por período.

## Los dos roles

### 🔑 Superadmin (Becker)

Identificado por su email (`beckerlastrelaureano@gmail.com`), hardcodeado en
`js/firebase-config.js`. Necesita su propia cuenta de Authentication con ese email exacto (se
crea una sola vez, a mano, en Firebase Console → Authentication → Add user).

Desde su panel puede ver y cambiar la **clave de acceso** (`configuracion/global`,
campo `claveAccesoDueños`) que hace falta para que alguien se registre como dueño nuevo. No hace
falta redeploy ni tocar la consola para cambiarla — es un campo de texto en la app.

Para suspender a un cliente que no pagó: editar a mano su documento en `usuariosKiosco` (consola
de Firestore) y poner `activo: false`.

### 🏪 Dueño

Es cada kiosco cliente. Se da de alta solo, desde la pestaña "Registrarme" de la app: nombre del
negocio, email, contraseña, y la **clave de acceso** vigente (se la pasa Becker o quien venda la
app). Si la clave no coincide, no se crea la cuenta. Administra sus propios productos, empleados,
turnos y ventas — nunca ve los de otro dueño (aislado por `duenioId == su uid` en
`firestore.rules`).

Alternativa manual, sin clave: Becker puede crear la cuenta de Authentication directamente desde
la consola (Add user); esa cuenta, al loguear por primera vez, entra sin pedir clave — es una
puerta de entrada separada para cuando Becker quiere dar de alta a alguien él mismo.

### Empleados (sin cuenta de Authentication)

El personal que rota por turno **no tiene login propio** — lo carga el dueño una vez (nombre +
PIN de 4 dígitos) en la sección "Empleados". Al abrir un turno, el empleado elige su nombre y
pone su PIN; eso queda guardado como dato del turno (`empleadoId`, `empleadoNombre`), pero quien
realmente escribe en Firestore es siempre la sesión autenticada del **dueño**, logueada en el
dispositivo del kiosco. El PIN es una etiqueta de "quién hizo esto" a nivel de la app — **no** es
un permiso de Firestore. Si en algún momento se necesita bloquear acciones específicas a un
empleado (ej. que no pueda borrar una venta), hay que hacerlo ocultando el botón en la interfaz,
no se puede forzar por reglas sin darle una cuenta propia.

## Colecciones en Firestore

```
configuracion/global   -> { claveAccesoDueños }
usuariosKiosco/{uid}   -> { rol, email, nombreNegocio, activo, fechaAlta }
productosKiosco/{id}   -> { duenioId, codigoBarras, nombre, categoria, precioCosto,
                             precioVenta, stock, stockMinimo, activo, actualizado }
empleadosKiosco/{id}   -> { duenioId, nombre, pin, activo }
turnosKiosco/{id}      -> { duenioId, empleadoId, empleadoNombre, horaApertura, horaCierre,
                             fondoInicial, fondoFinalContado, totalEfectivo, totalOtros,
                             diferencia, abierto }
ventasKiosco/{id}      -> { duenioId, turnoId, empleadoId, empleadoNombre, fecha, fechaDia,
                             items, total, metodoPago }
```

Las reglas completas están en `firestore.rules` — publicarlas a mano en Firebase Console
(Firestore Database → pestaña Reglas → Publicar). Subir el código a GitHub Pages **nunca**
actualiza esto.

## Sobre Cloud Storage / Blaze

Desde el 3 de febrero de 2026, Firebase exige el plan **Blaze** (tarjeta vinculada, aunque el uso
real dentro de la cuota gratis siga costando $0) para usar Cloud Storage. Como Fase 1 no necesita
fotos de comprobantes, el proyecto se dejó en **Spark** — no hace falta tarjeta todavía. Cuando se
construya la Fase 2 (fotos de comprobantes de compra), ahí sí va a haber que subir a Blaze.

## Estructura de archivos

```
KioscoBase/
├── index.html
├── manifest.json
├── sw.js
├── firestore.rules
├── README.md
├── css/
│   └── style.css
├── js/
│   ├── firebase-config.js      (config real del proyecto becker-kioscos, compartida por
│   │                             todos los clientes de esta línea — no tocar)
│   ├── marca.js                 (branding de ESTE cliente — completar por cliente)
│   ├── firebase-service.js      (toda la comunicación con Firebase)
│   └── app.js                   (UI: login, turno, productos, empleados, historial)
└── assets/
    └── iconos/                  (sprite de íconos genéricos + logo placeholder)
```

## Cómo armar un cliente nuevo a partir de esto

1. Clonar esta carpeta con el nombre del repo del cliente.
2. Completar `js/marca.js` con nombre y colores del logo (mismo proceso que con los gimnasios).
3. Reemplazar los 7 archivos de ícono en `assets/iconos/` con el logo del cliente.
4. Completar `manifest.json` (nombre y `theme_color`).
5. **No tocar** `js/firebase-config.js` — todos los clientes de esta línea comparten el mismo
   proyecto `becker-kioscos`.
6. Publicar por GitHub Desktop.
7. Dar de alta al dueño en Firebase Console → Authentication (ver sección "Superadmin" arriba).

## Stack técnico

HTML/CSS/JS vanilla, sin frameworks ni build step. Firebase **compat SDK** (namespaced API, vía
`<script>` tags normales). Mismo sistema de diseño (tema oscuro, tipografías Space Grotesk /
Inter / JetBrains Mono) que el resto del ecosistema.
