import { describe, expect, it } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { buildMaxirestXls, codeKey, completeMaxirestXls, quantitiesByCode, xlsSummary } from '../../src/integrations/maxirest/maxirestXls';
import { parseXls } from '../../src/importers/tabular';
import { detectMapping } from '../../src/integrations/maxirest/excelBridge';
import type { BridgeExportLine } from '../../src/integrations/maxirest/excelBridge';

const lines: BridgeExportLine[] = [
  { code: '3', name: 'Pepsi lata 354 ml', unit: 'u', counted: 24 },
  { code: '15', name: 'Harina 000', unit: 'kg', counted: 12.5 },
  { code: '15', name: 'Harina 000 (otra)', unit: 'kg', counted: 2.5 },
  { code: '20', name: 'Queso', unit: 'kg', counted: -1.2 },
  { code: '99', name: 'No está en Maxirest', unit: 'u', counted: 4 },
  { code: '', name: 'Sin código', unit: 'u', counted: 3 },
  { code: '30', name: 'Sin contar', unit: 'u', counted: undefined },
];

/** Un .xls como el de la grilla de Inventario de Maxirest. */
function maxirestFile(): ArrayBuffer {
  const aoa = [
    ['Inventario - Depósito Central'],
    ['Insumo', 'Cód.', 'Unid.Med.', 'Costo', 'St.Actual', 'Conteo', 'Valorizac.', 'Dif.Unid.', 'Dif.Valor'],
    ['PEPSI LATA', 3, 'UN', 900, 10, 0, 0, 0, 0],
    ['HARINA 000', '015', 'KG', 500, 7, 0, 0, 0, 0],
    ['QUESO', 20, 'KG', 8000, 2, 0, 0, 0, 0],
    ['ACEITE', 40, 'LT', 3000, 5, 1, 0, 0, 0],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Hoja1');
  return XLSX.write(wb, { bookType: 'xls', type: 'array' }) as ArrayBuffer;
}

const readBack = async (blob: Blob) => {
  const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true });
};

describe('Excel .xls para Maxirest', () => {
  it('reconoce el mismo código como número o texto', () => {
    expect(codeKey(3)).toBe('3');
    expect(codeKey('003')).toBe('3');
    expect(codeKey('3.0')).toBe('3');
    expect(codeKey(' HIE-10 ')).toBe('hie-10');
    expect(quantitiesByCode(lines).get('15')).toBe(15);
  });

  it('detecta las columnas de la grilla de Maxirest', () => {
    const m = detectMapping(['Insumo', 'Cód.', 'Unid.Med.', 'Costo', 'St.Actual', 'Conteo', 'Valorizac.', 'Dif.Unid.', 'Dif.Valor']);
    expect(m).toMatchObject({ name: 0, code: 1, unit: 2, stock: 4, counted: 5 });
  });

  it('arma un .xls nuevo (Excel 97-2003) con Cód., Insumo, Unid.Med. y Conteo', async () => {
    const r = await buildMaxirestXls(lines, 'stock actual');
    expect(r.filename).toMatch(/^maxirest_stock_actual_.*\.xls$/);
    expect(r.blob.type).toBe('application/vnd.ms-excel');
    const bytes = new Uint8Array(await r.blob.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0xd0, 0xcf, 0x11, 0xe0]); // contenedor OLE de los .xls
    const rows = await readBack(r.blob);
    expect(rows[0]).toEqual(['Cód.', 'Insumo', 'Unid.Med.', 'Conteo']);
    expect(rows).toContainEqual([3, 'Pepsi lata 354 ml', 'u', 24]);
    expect(rows).toContainEqual([20, 'Queso', 'kg', 0]); // negativo → 0
    expect(rows.some((row) => row[1] === 'Sin código' || row[1] === 'Sin contar')).toBe(false);
    expect(r).toMatchObject({ filled: 5, withoutCode: 1 });
  });

  it('completa sólo la columna Conteo del Excel de Maxirest y deja el resto igual', async () => {
    const r = await completeMaxirestXls(maxirestFile(), 'Inventario Central.xls', lines);
    expect(r.filename).toMatch(/^Inventario_Central_conteo_.*\.xls$/);
    const rows = await readBack(r.blob);
    expect(rows[0]).toEqual(['Inventario - Depósito Central']);
    expect(rows[2]).toEqual(['PEPSI LATA', 3, 'UN', 900, 10, 24, 0, 0, 0]);
    expect(rows[3]).toEqual(['HARINA 000', '015', 'KG', 500, 7, 15, 0, 0, 0]);
    expect(rows[4][5]).toBe(0);
    expect(rows[5]).toEqual(['ACEITE', 40, 'LT', 3000, 5, 1, 0, 0, 0]); // no está en Stock Manager: queda como venía
    expect(r).toMatchObject({ filled: 3, notInStockManager: 1, missingInFile: 1, withoutCode: 1 });
    expect(xlsSummary(r)).toContain('3 insumos con conteo');
  });

  it('avisa si el Excel no tiene columnas de código y conteo', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Nombre', 'Precio'], ['x', 1]]), 'A');
    await expect(completeMaxirestXls(XLSX.write(wb, { bookType: 'xls', type: 'array' }), 'x.xls', lines)).rejects.toThrow(/Cód\." y "Conteo/);
  });

  it('lee .xls al importar desde Maxirest', async () => {
    const t = await parseXls(maxirestFile());
    expect(t.headers.slice(0, 6)).toEqual(['Insumo', 'Cód.', 'Unid.Med.', 'Costo', 'St.Actual', 'Conteo']);
    expect(t.rows).toHaveLength(4);
    expect(t.rows[1].slice(0, 2)).toEqual(['HARINA 000', '015']);
  });
});
