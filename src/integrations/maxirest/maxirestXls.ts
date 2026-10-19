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
 */
import { round3 } from '../../utils/format';
import { downloadBlob, safeFilename, stamp } from '../../exports/download';
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

export const XLS_HEADERS = ['Cód.', 'Insumo', 'Unid.Med.', 'Conteo'];

/** .xls nuevo: Cód. · Insumo · Unid.Med. · Conteo (un renglón por insumo con código). */
export async function buildMaxirestXls(lines: BridgeExportLine[], name: string): Promise<XlsResult> {
  const XLSX = await import('@e965/xlsx');
  const withCode = lines.filter((l) => l.code && l.counted !== undefined);
  const rows = withCode.map((l) => [/^\d+$/.test(l.code) ? Number(l.code) : l.code, l.name, l.unit, countValue(l.counted!)]);
  const ws = XLSX.utils.aoa_to_sheet([XLS_HEADERS, ...rows]);
  ws['!cols'] = [{ wch: 8 }, { wch: 40 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  const data = XLSX.write(wb, { bookType: 'xls', type: 'array' }) as ArrayBuffer;
  return {
    blob: new Blob([data], { type: XLS_MIME }),
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
        ws[XLSX.utils.encode_cell({ r: rr, c: countCol })] = { t: 'n', v: countValue(q) };
        filled++;
      }
      if (range.e.c < countCol) range.e.c = countCol;
      ws['!ref'] = XLSX.utils.encode_range(range);
      const xls = !fileName.toLowerCase().endsWith('.xlsx');
      const data = XLSX.write(wb, { bookType: xls ? 'xls' : 'xlsx', type: 'array' }) as ArrayBuffer;
      const base = fileName.replace(/\.(xlsx?|csv)$/i, '');
      return {
        blob: new Blob([data], { type: xls ? XLS_MIME : XLSX_MIME }),
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
