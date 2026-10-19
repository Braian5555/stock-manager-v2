/**
 * Excel 97-2003 (.xls) para el "Importar Inventario" de Maxirest.
 *
 * Maxirest no publica el formato que acepta su importación, así que hay dos caminos:
 *  - completeMaxirestXls: se toma el Excel que exportó el propio Maxirest (Inventario del depósito)
 *    y sólo se completa la columna "Conteo" con lo de Stock Manager. Todo lo demás queda igual,
 *    así que el archivo vuelve con el formato exacto que Maxirest conoce. Es el camino recomendado.
 *  - buildMaxirestXls: un .xls nuevo con las columnas de la grilla de Inventario de Maxirest.
 *
 * El código de insumo de Maxirest es el SKU del producto en Stock Manager.
 *
 * Formato real (visto en un Excel exportado por Maxirest, que está hecho en Visual FoxPro):
 * Excel 2.1 (BIFF2), hoja "Sheet1", primera fila con los nombres de campo
 * codigo · nombre · unidad_med · precio · stock · conteo · valoriz · dif_unid · dif_val · cod_rui · ensegui.
 * Visual FoxPro no lee Excel 97 (BIFF8), por eso se escribe en BIFF2 igual que Maxirest.
 */
import { round3 } from '../../utils/format';
import { downloadBlob, safeFilename, stamp } from '../../exports/download';
import { writeBiff2, type Biff2Cell } from '../../exports/biff2';
import { buildExportLines, detectMapping, type BridgeExportLine } from './excelBridge';

export const XLS_MIME = 'application/vnd.ms-excel';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Mismo código aunque uno venga como número (3) y otro como texto ("003"). */
export function codeKey(v: unknown): string {
  const s = String(v ?? '').trim();
  if (/^\d+(\.0+)?$/.test(s)) return String(Number(s));
  return s.toLocaleLowerCase('es');
}

/** Lo que va en "Conteo": nunca negativo, con 3 decimales como máximo. */
const countValue = (n: number) => round3(Math.max(0, n));

/** Código → cantidad (si dos productos comparten código, se suman). */
export function quantitiesByCode(lines: BridgeExportLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    if (!l.code || l.counted === undefined) continue;
    const k = codeKey(l.code);
    out.set(k, round3((out.get(k) ?? 0) + l.counted));
  }
  return out;
}

export interface XlsResult {
  blob: Blob;
  filename: string;
  /** Renglones con conteo. */
  filled: number;
  /** Productos de Stock Manager sin código (no se pueden mandar a Maxirest). */
  withoutCode: number;
  /** Renglones del Excel de Maxirest que no están en Stock Manager (quedan como venían). */
  notInStockManager: number;
  /** Productos de Stock Manager que no aparecen en el Excel de Maxirest. */
  missingInFile: number;
}

/** Columnas del Excel de inventario de Maxirest, en su orden. */
export const MAXIREST_COLUMNS = ['codigo', 'nombre', 'unidad_med', 'precio', 'stock', 'conteo', 'valoriz', 'dif_unid', 'dif_val', 'cod_rui', 'ensegui'];
/** Anchos de columna del Excel de Maxirest (los largos de sus campos). */
const MAXIREST_WIDTHS = [4, 100, 10, 19, 9, 11, 9, 14, 14, 4, 1];

/** .xls nuevo con las columnas de Maxirest: código, nombre, unidad y conteo (el resto lo completa Maxirest). */
export async function buildMaxirestXls(lines: BridgeExportLine[], name: string): Promise<XlsResult> {
  const withCode = lines.filter((l) => l.code && l.counted !== undefined);
  const rows: Biff2Cell[][] = withCode.map((l) => [/^\d+$/.test(l.code) ? Number(l.code) : l.code, l.name, l.unit, null, null, countValue(l.counted!)]);
  const data = writeBiff2([MAXIREST_COLUMNS, ...rows], MAXIREST_WIDTHS);
  return {
    blob: new Blob([data as BlobPart], { type: XLS_MIME }),
    filename: `maxirest_${safeFilename(name)}_${stamp()}.xls`,
    filled: rows.length,
    withoutCode: lines.filter((l) => !l.code).length,
    notInStockManager: 0,
    missingInFile: 0,
  };
}

/**
 * Completa la columna "Conteo" del Excel que exportó Maxirest. No toca ninguna otra celda;
 * los insumos que Stock Manager no tiene (o que no se contaron) quedan como venían.
 */
export async function completeMaxirestXls(file: ArrayBuffer, fileName: string, lines: BridgeExportLine[]): Promise<XlsResult> {
  const XLSX = await import('@e965/xlsx');
  const wb = XLSX.read(file, { type: 'array', cellStyles: true });
  const qty = quantitiesByCode(lines);
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    const at = (r: number, c: number) => ws[XLSX.utils.encode_cell({ r, c })] as { v?: unknown } | undefined;
    const rowText = (r: number) => Array.from({ length: range.e.c + 1 }, (_, c) => (c < range.s.c ? '' : String(at(r, c)?.v ?? '').trim()));
    // Fila de encabezados: la primera que tenga columna de código y de conteo.
    for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 30); r++) {
      const map = detectMapping(rowText(r));
      if (map.code === undefined || map.counted === undefined) continue;
      const codeCol = map.code;
      const countCol = map.counted;
      const headers = rowText(r).map((h) => h.toLocaleLowerCase('es'));
      const col = (...names: string[]) => { const i = headers.findIndex((h) => names.includes(h)); return i < 0 ? undefined : i; };
      const priceCol = col('precio', 'costo');
      const stockCol = map.stock;
      const valueCol = col('valoriz', 'valorizac.', 'valorizacion', 'valorización');
      const diffCol = col('dif_unid', 'dif.unid.', 'dif. unid.');
      const diffValueCol = col('dif_val', 'dif.valor', 'dif. valor');
      const num = (rr: number, c: number | undefined) => { const v = c === undefined ? undefined : Number(at(rr, c)?.v); return v !== undefined && Number.isFinite(v) ? v : undefined; };
      const put = (rr: number, c: number | undefined, v: number | undefined) => { if (c !== undefined && v !== undefined) ws[XLSX.utils.encode_cell({ r: rr, c })] = { t: 'n', v: round3(v) }; };
      const seen = new Set<string>();
      let filled = 0;
      let notInStockManager = 0;
      for (let rr = r + 1; rr <= range.e.r; rr++) {
        const code = at(rr, codeCol)?.v;
        if (code === undefined || String(code).trim() === '') continue;
        const k = codeKey(code);
        const q = qty.get(k);
        if (q === undefined) {
          notInStockManager++;
          continue;
        }
        seen.add(k);
        const counted = countValue(q);
        put(rr, countCol, counted);
        // Las columnas calculadas quedan coherentes con el nuevo conteo (como las muestra Maxirest).
        const price = num(rr, priceCol);
        const stock = num(rr, stockCol);
        if (price !== undefined) put(rr, valueCol, counted * price);
        if (stock !== undefined) {
          put(rr, diffCol, counted - stock);
          if (price !== undefined) put(rr, diffValueCol, (counted - stock) * price);
        }
        filled++;
      }
      if (!filled && !notInStockManager)
        throw new Error('El Excel de Maxirest está vacío (sólo tiene los títulos). En Maxirest: Inventario → Depósito Central → “Preparar inventario”, después exportá a Excel y probá de nuevo.');
      if (range.e.c < countCol) range.e.c = countCol;
      ws['!ref'] = XLSX.utils.encode_range(range);
      const xls = !fileName.toLowerCase().endsWith('.xlsx');
      let data: ArrayBuffer | Uint8Array;
      if (xls) {
        // Se reescribe en Excel 2.1 igual que Maxirest (SheetJS no guarda tildes en ese formato).
        const matrix: Biff2Cell[][] = [];
        for (let rr = 0; rr <= range.e.r; rr++) {
          const row: Biff2Cell[] = [];
          for (let c = 0; c <= range.e.c; c++) {
            const cell = ws[XLSX.utils.encode_cell({ r: rr, c })] as { t?: string; v?: unknown } | undefined;
            const v = cell?.v;
            row.push(v === undefined || v === null ? null : typeof v === 'number' || typeof v === 'boolean' ? v : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
          }
          matrix.push(row);
        }
        const cols = (ws['!cols'] ?? []) as { wch?: number; width?: number }[];
        const widths = Array.from({ length: range.e.c + 1 }, (_, c) => cols[c]?.wch ?? cols[c]?.width ?? MAXIREST_WIDTHS[c] ?? 10);
        data = writeBiff2(matrix, widths);
      } else {
        data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
      }
      const base = fileName.replace(/\.(xlsx?|csv)$/i, '') || 'maxirest_inventario';
      return {
        blob: new Blob([data as BlobPart], { type: xls ? XLS_MIME : XLSX_MIME }),
        filename: `${safeFilename(base)}_conteo_${stamp()}.${xls ? 'xls' : 'xlsx'}`,
        filled,
        withoutCode: lines.filter((l) => !l.code).length,
        notInStockManager,
        missingInFile: [...qty.keys()].filter((k) => !seen.has(k)).length,
      };
    }
  }
  throw new Error('No encontré en el Excel las columnas "Cód." y "Conteo". Exportá el inventario desde Maxirest (Stock → Inventarios) y probá de nuevo.');
}

/** Resumen corto para el aviso después de descargar. */
export function xlsSummary(r: XlsResult): string {
  const parts = [`${r.filled} insumos con conteo`];
  if (r.notInStockManager) parts.push(`${r.notInStockManager} de Maxirest no están en Stock Manager (quedan como estaban)`);
  if (r.missingInFile) parts.push(`${r.missingInFile} de Stock Manager no figuran en el Excel`);
  if (r.withoutCode) parts.push(`${r.withoutCode} sin código no se mandan`);
  return `${parts.join(' · ')}.`;
}

export async function downloadMaxirestXls(countId: string | undefined, name: string): Promise<string> {
  const r = await buildMaxirestXls(await buildExportLines(countId), name);
  if (!r.filled) throw new Error('No hay productos con código de Maxirest para exportar.');
  downloadBlob(r.blob, r.filename);
  return xlsSummary(r);
}

export async function downloadCompletedMaxirestXls(file: File, countId: string | undefined): Promise<string> {
  const r = await completeMaxirestXls(await file.arrayBuffer(), file.name, await buildExportLines(countId));
  downloadBlob(r.blob, r.filename);
  return xlsSummary(r);
}
