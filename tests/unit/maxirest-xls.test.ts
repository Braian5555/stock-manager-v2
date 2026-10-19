import { describe, expect, it } from 'vitest';
import * as XLSX from '@e965/xlsx';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeBiff2, toCp1252, type Biff2Cell } from '../../src/exports/biff2';
import { MAXIREST_COLUMNS, buildMaxirestXls, codeKey, completeMaxirestXls, quantitiesByCode, xlsSummary } from '../../src/integrations/maxirest/maxirestXls';
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

/** Encabezado de un Excel 2.1 de hoja de cálculo, igual al que genera Maxirest. */
const BIFF2_BOF = [0x09, 0x00, 0x04, 0x00, 0x02, 0x00, 0x10, 0x00];

/** Como lo exporta Maxirest (Visual FoxPro): Excel 2.1 con los nombres de campo. */
function realMaxirestFile(rows: Biff2Cell[][]): ArrayBuffer {
  return writeBiff2([MAXIREST_COLUMNS, ...rows]).slice().buffer as ArrayBuffer;
}

/** El Excel que exportó Maxirest de verdad (Inventario sin preparar: sólo títulos). */
const REAL_EMPTY_EXPORT = () => { const b = readFileSync(join(__dirname, '../fixtures/maxirest-inventario-vacio.xls')); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

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

  it('arma un .xls nuevo en Excel 2.1 (el que lee Maxirest) con sus columnas', async () => {
    const r = await buildMaxirestXls(lines, 'stock actual');
    expect(r.filename).toMatch(/^maxirest_stock_actual_.*\.xls$/);
    expect(r.blob.type).toBe('application/vnd.ms-excel');
    const bytes = new Uint8Array(await r.blob.arrayBuffer());
    expect([...bytes.slice(0, 8)]).toEqual(BIFF2_BOF);
    const rows = await readBack(r.blob);
    expect(rows[0]).toEqual(MAXIREST_COLUMNS);
    expect(rows).toContainEqual([3, 'Pepsi lata 354 ml', 'u', undefined, undefined, 24]);
    expect(rows).toContainEqual([20, 'Queso', 'kg', undefined, undefined, 0]); // negativo → 0
    expect(rows.some((row) => row[1] === 'Sin código' || row[1] === 'Sin contar')).toBe(false);
    expect(r).toMatchObject({ filled: 5, withoutCode: 1 });
  });

  it('completa el Conteo (y lo que se calcula con él) y deja el resto igual', async () => {
    const r = await completeMaxirestXls(maxirestFile(), 'Inventario Central.xls', lines);
    expect(r.filename).toMatch(/^Inventario_Central_conteo_.*\.xls$/);
    const rows = await readBack(r.blob);
    expect(rows[0]).toEqual(['Inventario - Depósito Central']);
    expect(rows[2]).toEqual(['PEPSI LATA', 3, 'UN', 900, 10, 24, 21600, 14, 12600]);
    expect(rows[3]).toEqual(['HARINA 000', '015', 'KG', 500, 7, 15, 7500, 8, 4000]);
    expect(rows[4][5]).toBe(0);
    expect(rows[5]).toEqual(['ACEITE', 40, 'LT', 3000, 5, 1, 0, 0, 0]); // no está en Stock Manager: queda como venía
    expect(r).toMatchObject({ filled: 3, notInStockManager: 1, missingInFile: 1, withoutCode: 1 });
    expect(xlsSummary(r)).toContain('3 insumos con conteo');
  });

  it('completa el Excel real de Maxirest (Excel 2.1) y recalcula valorización y diferencias', async () => {
    const file = realMaxirestFile([
      [3, 'PEPSI LATA', 'UN', 900, 10, 0, 0, -10, -9000, 2, 'N'],
      ['     15', 'HARINA 000', 'KG', 500, 7, 0, 0, -7, -3500, 5, 'N'],
      [40, 'ACEITE', 'LT', 3000, 5, 5, 15000, 0, 0, 5, 'N'],
    ]);
    const r = await completeMaxirestXls(file, '.XLS', lines);
    expect([...new Uint8Array(await r.blob.arrayBuffer()).slice(0, 8)]).toEqual(BIFF2_BOF);
    const rows = await readBack(r.blob);
    expect(rows[0]).toEqual(MAXIREST_COLUMNS);
    expect(rows[1]).toEqual([3, 'PEPSI LATA', 'UN', 900, 10, 24, 21600, 14, 12600, 2, 'N']);
    expect(rows[2]).toEqual(['     15', 'HARINA 000', 'KG', 500, 7, 15, 7500, 8, 4000, 5, 'N']);
    expect(rows[3]).toEqual([40, 'ACEITE', 'LT', 3000, 5, 5, 15000, 0, 0, 5, 'N']);
    expect(r.filled).toBe(2);
  });

  it('el Excel real de Maxirest sin insumos (sólo títulos) pide preparar el inventario', async () => {
    const t = await parseXls(REAL_EMPTY_EXPORT());
    expect(t.headers).toEqual(MAXIREST_COLUMNS);
    await expect(completeMaxirestXls(REAL_EMPTY_EXPORT(), '.XLS', lines)).rejects.toThrow(/Preparar inventario/);
  });

  it('escribe los títulos igual que Maxirest, byte por byte', () => {
    const ours = writeBiff2([MAXIREST_COLUMNS], [4, 100, 10, 19, 9, 11, 9, 14, 14, 4, 1]);
    const real = new Uint8Array(REAL_EMPTY_EXPORT());
    expect([...ours]).toEqual([...real.slice(0, ours.length)]);
  });

  it('las tildes y la ñ salen en Windows-1252 y se leen bien', async () => {
    expect(toCp1252('Ñandú €')).toEqual([0xd1, 0x61, 0x6e, 0x64, 0xfa, 0x20, 0x80]);
    const file = realMaxirestFile([[7, 'Azúcar Ñuñoa', 'KG', 100, 1, 0, 0, 0, 0, 1, 'N']]);
    const r = await completeMaxirestXls(file, 'inv.xls', [{ code: '7', name: 'Azúcar', unit: 'kg', counted: 3 }]);
    const rows = await readBack(r.blob);
    expect(rows[1].slice(0, 6)).toEqual([7, 'Azúcar Ñuñoa', 'KG', 100, 1, 3]);
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
