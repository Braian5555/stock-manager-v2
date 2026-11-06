# Errores frecuentes

El mensaje de ARCA siempre se muestra en el comprobante y queda en Comprobantes → **Registro ARCA** (pedido y respuesta, sin Token ni Sign).

## Estados de un comprobante

| Estado | Qué significa | Qué hacer |
|---|---|---|
| Autorizada | ARCA devolvió CAE | Nada. Imprimir si hace falta |
| Sin confirmar | Se envió pero no llegó la respuesta (corte, ARCA lenta o con error interno) | **Reintentar**: primero se consulta el número en ARCA; si ya estaba, se recupera el CAE sin duplicar |
| Con error | No se pudo enviar (sin internet, sesión vencida, servicio mal configurado) o el comprobante tenía datos inválidos | Leer el mensaje, corregir y **Reintentar** |
| Rechazada | ARCA lo rechazó (no se usó el número) | Corregir los datos (normalmente del cliente) y **Volver a emitir** |

## Autenticación (WSAA)

| Mensaje / código | Causa | Solución |
|---|---|---|
| `coe.alreadyAuthenticated` / “ya hay un acceso vigente” | ARCA ya dio un Token que el servicio perdió (sin KV) | Configurar el KV `ARCA_TA`. Esperar a que venza (hasta 12 h) o generar otro certificado |
| `cms.cert.untrusted`, `cms.bad`, `cms.sign.invalid` | Certificado de otro ambiente, vencido, o que no corresponde a la clave | Revisar que `ARCA_HOMO_*` sean de homologación y `ARCA_PROD_*` de producción; que el `.crt` sea del mismo `.key` |
| `coe.notAuthorized` / “Computador no autorizado” | Falta la relación con el servicio wsfe | Homologación: “Crear autorización a servicio” en WSASS. Producción: Nueva relación → Facturación Electrónica |
| `xml.generationTime.invalid` | Hora del servidor muy distinta | Reintentar (Cloudflare usa hora exacta) |
| “La clave privada tiene contraseña” | `.key` con contraseña | Generarla sin contraseña (`openssl genrsa`) |

## Servicio WSFEv1

| Código | Causa | Solución |
|---|---|---|
| 600 | Token y firma no corresponden | El servicio pide un Token nuevo solo. Si sigue, revisar el certificado |
| 601 | El CUIT no está en el Token | `ARCA_CUIT` distinto del CUIT del certificado / de la relación |
| 602 | Sin resultados (en consultas) | Normal al consultar un número inexistente |
| 500, 501, 502 | Error interno de ARCA | Queda “Sin confirmar”: reintentar más tarde |
| 10013 | Factura A sin CUIT del receptor | Elegir “Con datos” y poner el CUIT |
| 10015 | Consumidor final con documento mal cargado | Sin identificar: documento 0. Desde $ 10.000.000 hay que identificarlo |
| 10016 | El número o la fecha no corresponden al próximo a autorizar | El sistema renumera solo. Si persiste: otro sistema usa el mismo punto de venta (no compartirlo con Maxirest) |
| Condición frente al IVA del receptor (RG 5616) | No informada o inválida | Elegir la condición correcta del cliente (siempre se informa) |

## Servicio de Orillas (Cloudflare)

| Mensaje | Solución |
|---|---|
| “Falta ARCA_WORKSPACE” / “Este espacio de trabajo no está habilitado” | Copiar el Id desde Configuración fiscal al secreto `ARCA_WORKSPACE` |
| “Tu usuario no tiene permiso para facturar” | Darle el rol Encargado o el permiso “Cobrar y facturar” |
| “Producción no está habilitada” | Secreto `ARCA_PROD_ENABLED = si` |
| “Falta cargar el certificado y la clave de …” | Cargar los secretos del ambiente elegido |
| “Para esto la app tiene que estar conectada a la nube” | Conectar el dispositivo en Cuenta y nube (la facturación usa la misma sesión) |
