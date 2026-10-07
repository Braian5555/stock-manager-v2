import type { Capability } from '../core/types';

/**
 * Estado OFICIAL de cada operación según la documentación pública de Maxirest
 * revisada el 2026-10-06 (ayuda.maxirest.com y maxirest.com/integraciones).
 * Ver docs/maxirest.md para el detalle y las fuentes.
 *
 * Resultado de la investigación:
 *  - No hay API pública, endpoints, autenticación ni portal de desarrolladores documentados.
 *  - Las integraciones oficiales listadas son de delivery, salón, cobros y fidelización.
 *    Ninguna cubre stock, insumos ni inventarios.
 *  - El módulo Inventarios permite "exportar en formato Excel" e "importar inventarios
 *    hechos con anterioridad" (sin plantilla/columnas documentadas).
 *
 * Por eso NINGUNA operación se marca como soportada. Cambiar este archivo SOLAMENTE
 * cuando Maxirest entregue documentación o acceso real y se haya verificado.
 */
export type OfficialStatus = 'no_documentado' | 'manual_excel' | 'pendiente_habilitacion';

export const MAXIREST_OFFICIAL: Record<Capability, { status: OfficialStatus; note: string }> = {
  getProducts: { status: 'pendiente_habilitacion', note: 'No hay API documentada para leer insumos. No existe exportación documentada del listado de insumos.' },
  getCategories: { status: 'pendiente_habilitacion', note: 'Rubros: sin API documentada.' },
  getUnits: { status: 'pendiente_habilitacion', note: 'Unidades de medida: sin API documentada.' },
  getLocations: { status: 'pendiente_habilitacion', note: 'Depósitos: sin API documentada.' },
  getStock: { status: 'manual_excel', note: 'Sin API. Vía manual: Stock → Inventarios → preparar inventario → exportar a Excel (columnas incluyen código, nombre, unidad, costo, stock actual).' },
  getMovements: { status: 'pendiente_habilitacion', note: 'Existe el informe de movimientos en pantalla; no hay exportación ni API documentadas.' },
  getInventory: { status: 'manual_excel', note: 'Inventarios exportables a Excel desde la pantalla Inventarios (formato no documentado oficialmente).' },
  createStockAdjustment: { status: 'pendiente_habilitacion', note: 'El ajuste se hace dentro de Maxirest al guardar un inventario con "Ajuste automático de stock". Sin API documentada.' },
  updateInventory: { status: 'manual_excel', note: 'Carga manual de la columna "conteo" en Maxirest. La importación de inventarios desde Excel no está documentada con plantilla: requiere confirmación de Maxirest.' },
  createOrder: { status: 'no_documentado', note: 'No se encontró documentación de órdenes de compra vía integración.' },
};

export const OFFICIAL_STATUS_LABEL: Record<OfficialStatus, string> = {
  no_documentado: 'No documentado',
  manual_excel: 'Manual (Excel)',
  pendiente_habilitacion: 'Pendiente de habilitación',
};

export const MAXIREST_SOURCES = [
  { label: '¿Qué es una integración? — Ayuda Maxirest', url: 'https://ayuda.maxirest.com/integraciones/%C2%BFque-es-una-integracion-' },
  { label: 'Partners / integraciones — Maxirest', url: 'https://maxirest.com/integraciones' },
  { label: 'Inventarios — Ayuda Maxirest', url: 'https://ayuda.maxirest.com/es_ES/carga-y-control-de-stock-c-/inventarios' },
  { label: 'Inventario (costos) — Ayuda Maxirest', url: 'https://ayuda.maxirest.com/costos/4-inventario' },
  { label: 'Insumos — Ayuda Maxirest', url: 'https://ayuda.maxirest.com/carga-de-insumos/insumos-stock' },
  { label: 'Conceptos de movimientos de stock — Ayuda Maxirest', url: 'https://ayuda.maxirest.com/es_ES/informes-y-configuraciones-varias/conceptos-de-movimientos-de-stock' },
];
