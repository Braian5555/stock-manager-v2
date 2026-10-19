/**
 * Lectura de archivos tabulares (XLSX / XLS / CSV) a filas de texto/número.
 * Se usa para el Excel Bridge de Maxirest y para importar productos.
 * ExcelJS (xlsx) y SheetJS (xls, Excel 97-2003) se cargan bajo demanda para no pesar en el arranque.
 */
export type Cell = string | number | undefined;
export interface Tabular {
  headers: string[];
  rows: Cell[][];
  sheetName?: string;
}

export async function readTabularFile(file: File): Promise<Tabular> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xls')) return parseXls(await file.arrayBuffer());
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') return parseCsv(await file.text());
  if (name.endsWith('.xlsx')) return parseXlsx(await file.arrayBuffer());
  throw new Error('Formato no reconocido. Usá un archivo .xlsx, .xls o .csv.');
}

function cellValue(v: unknown): Cell {
  if (v == null) return undefined;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.result !== undefined) return cellValue(o.result);
    if (typeof o.text === 'string') return o.text;
    if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join('');
  }
  return String(v);
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<Tabular> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) throw new Error('El archivo no tiene datos.');
  const matrix: Cell[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as unknown[];
    matrix.push(values.slice(1).map(cellValue));
  });
  return fromMatrix(matrix, ws.name);
}

/** Excel 97-2003 (.xls), el formato que exportan programas como Maxirest. */
export async function parseXls(buffer: ArrayBuffer): Promise<Tabular> {
  const XLSX = await import('@e965/xlsx');
  const wb = XLSX.read(buffer, { type: 'array' });
  for (const sheetName of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, raw: true, blankrows: false });
    const cells = matrix.map((r) => Array.from(r, cellValue));
    if (cells.some((r) => r.some((c) => c !== undefined && String(c).trim() !== ''))) return fromMatrix(cells, sheetName);
  }
  throw new Error('El archivo no tiene datos.');
}

/** Detecta la fila de encabezados (la primera con al menos 2 celdas de texto). */
export function fromMatrix(matrix: Cell[][], sheetName?: string): Tabular {
  const headerIdx = matrix.findIndex((r) => r.filter((c) => typeof c === 'string' && c.trim()).length >= 2);
  if (headerIdx < 0) throw new Error('No se encontró una fila de encabezados.');
  const headers = matrix[headerIdx].map((h) => String(h ?? '').trim());
  const rows = matrix.slice(headerIdx + 1).filter((r) => r.some((c) => c !== undefined && String(c).trim() !== ''));
  return { headers, rows, sheetName };
}

export function parseCsv(text: string): Tabular {
  const clean = text.replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const matrix: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field); matrix.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); matrix.push(row); }
  return fromMatrix(matrix.map((r) => r.map((c) => (c === '' ? undefined : c))));
}
