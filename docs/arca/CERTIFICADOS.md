# Certificados digitales

ARCA autentica al sistema con un **certificado X.509** y su **clave privada**. Hay uno para **homologación** y otro para **producción**: no son intercambiables.

> La clave privada no se comparte con nadie. Se genera en la computadora del titular y se pega **sólo** como secreto en Cloudflare. No se manda por mail ni por chat.

## 1. Generar la clave privada y el pedido (CSR)

En una terminal (reemplazar CUIT y razón social):

```bash
# Clave privada RSA de 2048 bits, SIN contraseña (el servicio no puede usar claves con contraseña)
openssl genrsa -out stockmanager.key 2048

# Pedido de certificado
openssl req -new -key stockmanager.key \
  -subj "/C=AR/O=EPICURAE S.A./CN=stockmanager/serialNumber=CUIT 30712345671" \
  -out stockmanager.csr
```

- `CN` es el nombre del “computador” (alias) en ARCA: sin espacios ni acentos.
- Se puede usar la misma clave para homologación y producción, pero es más prolijo generar una por ambiente (`stockmanager-homo.key`, `stockmanager-prod.key`).

## 2. Certificado de HOMOLOGACIÓN

1. Con clave fiscal: **Administrador de Relaciones de Clave Fiscal** → **Adherir servicio** → ARCA → Servicios interactivos → **WSASS - Autogestión Certificados Homologación**.
2. Entrar a **WSASS** → **Nuevo certificado** → nombre (el mismo `CN`) → pegar el contenido del `.csr` → **Crear DN y obtener certificado**.
3. Copiar el certificado que muestra y guardarlo como `stockmanager-homo.crt`.
4. En WSASS → **Crear autorización a servicio**: elegir el certificado, el CUIT representado y el servicio **wsfe** (Facturación Electrónica).

## 3. Certificado de PRODUCCIÓN

1. **Administrador de Relaciones de Clave Fiscal** → **Adherir servicio** → ARCA → **Administración de Certificados Digitales**.
2. Entrar al servicio → elegir el CUIT → **Agregar alias** → alias = `CN` → subir el `.csr` → descargar el `.crt`.
3. **Administrador de Relaciones de Clave Fiscal** → **Nueva relación** → **Buscar** → ARCA → WebServices → **Facturación Electrónica** → en **Representante**, elegir el computador (alias) → **Confirmar**.

## 4. Instalar en Cloudflare

Worker `stock-manager-arca` → Settings → Variables and Secrets → Add → **Secret**:

- Homologación: `ARCA_HOMO_CERT` = el `.crt` completo; `ARCA_HOMO_KEY` = el `.key` completo.
- Producción: `ARCA_PROD_CERT` y `ARCA_PROD_KEY`.

Se pega el texto entero, con las líneas `-----BEGIN …-----` y `-----END …-----`. Si Cloudflare junta todo en una línea no pasa nada: el servicio lo lee igual.

Después, en Orillas → Configuración fiscal → **Probar conexión con ARCA** se ve el CUIT del certificado y su vencimiento.

## 5. Renovar

- **Probar conexión** avisa cuando faltan 30 días o menos para el vencimiento.
- Para renovar: generar un CSR nuevo (puede ser con la misma clave), pedir el certificado nuevo en el mismo servicio de ARCA, reemplazar el secreto `*_CERT` (y `*_KEY` si cambió) en Cloudflare.
- Después de cambiar el certificado, borrar la entrada del KV `arca-ta` (Cloudflare → KV → `arca-ta` → borrar la clave `ta:wsfe:...`) para que pida un Token nuevo.

## 6. Si la clave privada se filtra

1. Revocar el certificado en ARCA (mismo servicio donde se creó).
2. Generar clave y certificado nuevos y reemplazar los secretos.
3. Revisar en Orillas → Comprobantes → **Registro ARCA** si hubo pedidos que no reconocés.
