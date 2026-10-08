# Sincronización con Google (Firebase)

Stock Manager puede guardar los datos en la nube de Google para usarlos en varios dispositivos (PC, Android, iPhone) y compartirlos con empleados. Sin configurar nada, la app sigue funcionando 100% en cada dispositivo.

**Cómo funciona**

- Cada persona inicia sesión con su **email y contraseña** (o, si prefiere, con su cuenta de Google). En un dispositivo nuevo, lo primero que muestra la app es "Iniciar sesión": con un solo espacio de trabajo, los datos se descargan solos.
- Los datos viven en un **espacio de trabajo** (tu negocio). El dueño invita a otras personas por email.
- La app siempre trabaja sobre la copia del dispositivo: funciona **sin Internet** y sincroniza sola al volver la conexión.
- Si dos personas mueven el stock del mismo producto al mismo tiempo, no se pierde ningún movimiento: el stock se recalcula a partir del historial.
- Para otros datos (nombre de un producto, un proveedor…), si dos personas editan lo mismo a la vez, queda el cambio más reciente.

Se usa **Firebase** (Google): *Authentication* para el inicio de sesión y *Cloud Firestore* para los datos. El plan gratuito (Spark) alcanza para un negocio chico; los límites vigentes se ven en la consola de Firebase (sección *Usage and billing*).

---

## Paso 1 — Crear el proyecto

1. Entrá a <https://console.firebase.google.com> con tu cuenta de Google.
2. **Crear un proyecto** (o *Add project*). Nombre: por ejemplo `stock-manager`.
3. Cuando pregunte por Google Analytics, podés desactivarlo. Tocá **Crear proyecto**.

## Paso 2 — Activar el inicio de sesión

1. En el menú de la izquierda: **Compilación → Authentication** (*Build → Authentication*) → **Comenzar**.
2. Pestaña **Sign-in method** → **Agregar proveedor nuevo** → **Correo electrónico/contraseña** → activá el primer interruptor (*Correo electrónico/contraseña*) → **Guardar**.
3. (Opcional) Para ofrecer también "Entrar con Google": **Agregar proveedor nuevo** → **Google** → **Habilitar** → elegí tu email de asistencia → **Guardar**.
4. Pestaña **Settings → Authorized domains** → **Add domain** → escribí `braian5555.github.io` → **Add**.

## Paso 3 — Crear la base de datos

1. Menú: **Compilación → Firestore Database** → **Crear base de datos**.
2. Ubicación: `southamerica-east1 (São Paulo)` (la más cercana a Argentina). No se puede cambiar después.
3. Modo: **producción** (*production mode*) → **Crear**.
4. Pestaña **Reglas** (*Rules*): borrá todo, pegá el contenido completo del archivo [`firestore.rules`](../firestore.rules) de este repositorio y tocá **Publicar**.

## Paso 4 — Registrar la app web y copiar la configuración

1. Arriba a la izquierda, el engranaje ⚙ → **Configuración del proyecto** (*Project settings*).
2. Abajo, en **Tus apps**, tocá el ícono web **`</>`**.
3. Nombre: `Stock Manager`. **No** marques Firebase Hosting. **Registrar app**.
4. Vas a ver un bloque `const firebaseConfig = { ... }`. Copiá estos cuatro valores: `apiKey`, `authDomain`, `projectId`, `appId`.

> Estos valores **no son secretos**: Firebase los diseña para estar en páginas públicas. Lo que protege los datos son las reglas del paso 3 y el inicio de sesión con Google.

## Paso 5 — Cargar la configuración en el repositorio

1. En GitHub, abrí el archivo `public/firebase-config.json` del repositorio y tocá el lápiz (**Edit**).
2. Completá los valores entre comillas:

```json
{
  "apiKey": "AIza...",
  "authDomain": "stock-manager-xxxx.firebaseapp.com",
  "projectId": "stock-manager-xxxx",
  "appId": "1:1234567890:web:abcdef123456"
}
```

3. **Commit changes**. Esperá el tilde verde en **Actions** (1–2 minutos).

## Paso 6 — Empezar a sincronizar

**En el dispositivo que tiene tus datos actuales:**

1. Abrí la app → **Más → Cuenta y nube** → **Iniciar sesión con Google**.
2. **Crear y subir mis datos**. Se crea tu espacio de trabajo y se suben los datos.

**En cada uno de los otros dispositivos:**

1. **Más → Cuenta y nube** → **Iniciar sesión con Google** (con la misma cuenta).
2. En *Tus espacios* → **Usar en este dispositivo**. Los datos de ese dispositivo se reemplazan por los de la nube.

> En iPhone, si instalaste la app con *Agregar a inicio*, iniciá sesión **dentro de la app instalada** (tiene su propio almacenamiento, separado de Safari).

## Paso 7 — Invitar empleados (opcional)

1. **Cuenta y nube → Miembros → Invitar por email** → escribí el Gmail de la persona → **Invitar**.
2. Esa persona abre la app, inicia sesión con ese Gmail y en **Invitaciones** toca **Unirme**.
3. Roles: **Dueño** (vos), **Administrador** (puede invitar y quitar personas, y cambiar usuarios con PIN y configuración), **Miembro** (usa la app: stock, pedidos, conteos, remitos, facturas; no puede cambiar usuarios ni configuración).

---

## Problemas frecuentes

| Mensaje | Solución |
|---|---|
| “Este sitio no está autorizado en Firebase” | Paso 2.3: agregar `braian5555.github.io` en *Authorized domains*. |
| “El inicio con Google no está activado” | Paso 2.2. |
| “No tenés permiso para esta acción” | Revisá que las reglas del paso 3.4 estén publicadas, o que la invitación sea al mismo email con el que iniciás sesión. |
| La ventana de Google no aparece | Permití ventanas emergentes para el sitio. En iPhone, probá iniciar sesión desde Safari. |
| “La nube todavía no está configurada” | El archivo `public/firebase-config.json` está vacío o mal escrito (paso 5). |

## Detalles técnicos

- Estructura: `workspaces/{id}` (nombre, `memberUids`, `roles`, `memberInfo`, `inviteEmails`) y `workspaces/{id}/{tabla}/{registro}`.
- Tablas sincronizadas: configuración, familias, unidades, ubicaciones, proveedores, productos, pedidos y sus ítems, movimientos, conteos y sus ítems, usuarios y facturas.
- Fotos de facturas: `workspaces/{id}/invoiceImages/{foto}` (JPEG comprimido a menos de 650 KB, en base64). No se sincronizan en bloque: se suben al guardarlas y cada dispositivo baja una foto sólo cuando se abre, para no gastar la cuota gratuita. Con más de unos pocos miles de facturas conviene pasar a Cloud Storage (requiere el plan Blaze). La integración con Maxirest (cola, copias externas) queda por dispositivo.
- Eliminaciones: se guardan como lápidas (`_deleted: true`) en la nube y también en cada dispositivo (tabla local `tombstones`), así una eliminación hecha sin conexión se envía después y una versión vieja que llegue tarde no revive lo borrado.
- Lo que existe sólo en un dispositivo se sube recién cuando el servidor confirmó la lista completa (no con la copia parcial de caché).
- Restaurar un backup está bloqueado mientras el dispositivo está vinculado (pisaría los datos de todos).
- Stock: los movimientos son inmutables; el stock se recalcula con `foldStock()` (los ajustes y conteos fijan el valor, el resto suma o resta).
- Código: `src/cloud/` (backend Firebase, motor de sincronización, servicio de cuenta) y `firestore.rules`.
- Pruebas: `tests/unit/cloud-sync.test.ts` y `tests/e2e/cloud.spec.ts` usan un backend en memoria. Las reglas de seguridad no se pudieron probar con el emulador de Firebase en el entorno de desarrollo; conviene probarlas con dos cuentas reales antes de invitar empleados.

---

## Publicar en Firebase Hosting (dirección sin nombre de usuario)

La app puede publicarse en `https://<projectId>.web.app`. Ventajas: la dirección no muestra el usuario de GitHub, el repositorio puede ser privado y el inicio de sesión ocurre en el mismo dominio que la app (necesario para la app instalada en iPhone).

1. Firebase → ⚙ Configuración del proyecto → **Cuentas de servicio** → **Generar nueva clave privada**. Se descarga un archivo `.json`. **Es secreto**: no se comparte ni se sube al repositorio.
2. GitHub → repositorio → **Settings → Secrets and variables → Actions → New repository secret**. Nombre: `FIREBASE_SERVICE_ACCOUNT`. Valor: el contenido completo del `.json`.
3. El workflow (`.github/workflows/deploy.yml`) construye con `VITE_BASE_PATH=/` y publica con `FirebaseExtended/action-hosting-deploy` usando `firebase.json`.
4. Abrir la app en la nueva dirección, iniciar sesión y elegir **Usar en este dispositivo** (cada dirección tiene su propio almacenamiento local; los datos vienen de la nube).
