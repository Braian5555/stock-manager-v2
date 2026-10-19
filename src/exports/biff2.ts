/**
 * Escritor mínimo de Excel 2.1 (BIFF2), el formato que genera y lee Maxirest (Visual FoxPro:
 * COPY TO / APPEND FROM ... TYPE XLS). Replica los registros del archivo que exporta Maxirest:
 * BOF · CODEPAGE 1252 · DIMENSIONS · COLWIDTH · celdas (LABEL / NUMBER / BOOLERR) · EOF.
 * Los textos van en Windows-1252 para que salgan bien las tildes y la ñ.
 */
export type Biff2Cell = string | number | boolean | null | undefined;

const CP1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Texto → bytes Windows-1252 (lo que no existe en esa página de códigos queda como "?"). */
export function toCp1252(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else out.push(CP1252_EXTRA[c] ?? 0x3f);
  }
  return out;
}

class Bytes {
  private parts: number[] = [];
  u8(v: number) { this.parts.push(v & 0xff); }
  u16(v: number) { this.u8(v); this.u8(v >> 8); }
  raw(b: ArrayLike<number>) { for (let i = 0; i < b.length; i++) this.parts.push(b[i]); }
  f64(v: number) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); this.raw(b); }
  get length() { return this.parts.length; }
  toArray() { return Uint8Array.from(this.parts); }
}

/** Atributos de celda como los escribe Maxirest (celda bloqueada, formato general). */
const CELL_ATTR = [0x40, 0x00, 0x00];

export function writeBiff2(rows: Biff2Cell[][], widths: number[] = []): Uint8Array {
  const out = new Bytes();
  const rec = (type: number, body: Bytes | number[]) => {
    const data = body instanceof Bytes ? Array.from(body.toArray()) : body;
    out.u16(type);
    out.u16(data.length);
    out.raw(data);
  };
  const nRows = Math.min(rows.length, 0x3fff);
  const nCols = Math.min(Math.max(0, ...rows.map((r) => r.length)), 0xff);
  rec(0x0009, [0x02, 0x00, 0x10, 0x00]); // BOF: BIFF2, hoja de cálculo
  rec(0x0042, [0xe4, 0x04]); // CODEPAGE 1252
  const dim = new Bytes();
  dim.u16(0); dim.u16(nRows); dim.u16(0); dim.u16(nCols);
  rec(0x0000, dim); // DIMENSIONS
  widths.slice(0, nCols).forEach((w, c) => {
    const b = new Bytes();
    b.u8(c); b.u8(c); b.u16(Math.max(1, Math.min(255, Math.round(w))) * 256);
    rec(0x0024, b); // COLWIDTH
  });
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const v = rows[r][c];
      if (v === null || v === undefined || v === '') continue;
      const b = new Bytes();
      b.u16(r); b.u16(c); b.raw(CELL_ATTR);
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) continue;
        b.f64(v);
        rec(0x0003, b); // NUMBER
      } else if (typeof v === 'boolean') {
        b.u8(v ? 1 : 0); b.u8(0);
        rec(0x0005, b); // BOOLERR (valor lógico)
      } else {
        const bytes = toCp1252(v).slice(0, 255);
        b.u8(bytes.length); b.raw(bytes);
        rec(0x0004, b); // LABEL
      }
    }
  }
  rec(0x000a, []); // EOF
  return out.toArray();
}
