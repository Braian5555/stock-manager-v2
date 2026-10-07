import { downloadBlob, safeFilename, stamp } from '../../exports/download';
import { toXlsx } from '../../exports/writers';
import { BRIDGE_INSTRUCTIONS, buildExportLines } from './excelBridge';

/** Genera y descarga el Excel para carga manual en Maxirest (conteo o stock actual). */
export async function exportBridgeWorkbook(countId?: string, name = 'stock'): Promise<void> {
  const lines = await buildExportLines(countId);
  const blob = await toXlsx('Stock Manager → Maxirest', [
    {
      title: 'Inventario',
      columns: ['Código', 'Insumo', 'Unidad', 'Stock Maxirest', 'Conteo', 'Diferencia'],
      rows: lines.map((l) => [l.code, l.name, l.unit, l.maxirestStock ?? '', l.counted ?? '', l.counted !== undefined && l.maxirestStock !== undefined ? l.counted - l.maxirestStock : '']),
    },
  ], [{ name: 'Instrucciones', lines: BRIDGE_INSTRUCTIONS }]);
  downloadBlob(blob, `maxirest_${safeFilename(name)}_${stamp()}.xlsx`);
}
