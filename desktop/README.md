# Orillas para Windows

Programa de Windows que abre Orillas en su propia ventana y **imprime directo** (sin el cuadro de
impresión) en la impresora que corresponde a cada cosa:

- **Tickets y facturas** (pre-cuenta, factura, arqueo, cierre) → la impresora de la caja.
- **Comandas de cocina** → la impresora de cocina.
- **Comandas de barra** → la impresora de barra.

Las impresoras se eligen en Orillas: *Configuración del salón → Impresión de tickets → Impresoras de
este equipo*. Quedan guardadas en esa compu.

## Instalar

1. Bajar `Orillas-Setup-x.y.z.exe` de https://github.com/Braian5555/stock-manager-v2/releases/latest
2. Abrirlo. Si Windows avisa "Windows protegió su PC": *Más información → Ejecutar de todas formas*
   (el instalador no está firmado con un certificado pago).
3. Abrir Orillas desde el ícono del Escritorio, entrar con la cuenta y elegir el local de esa compu.

El programa se actualiza solo. Lo de Orillas (pantallas, funciones) se actualiza como siempre.

## Publicar una versión nueva del programa

Subir el número de `version` en `desktop/package.json` y hacer push a `main`: el workflow
*Orillas para Windows* arma el instalador en GitHub Actions (Windows) y lo publica en Releases.
También se puede correr a mano desde Actions.
