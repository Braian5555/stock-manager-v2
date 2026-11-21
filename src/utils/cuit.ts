/** CUIT/CUIL argentino: 11 dígitos con dígito verificador. */
export function validCuit(c: string): boolean {
  const s = String(c ?? '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(s)) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let dv = 11 - (w.reduce((a, x, i) => a + x * Number(s[i]), 0) % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === Number(s[10]);
}
export const fmtCuit = (c: string) => {
  const s = String(c ?? '').replace(/\D/g, '');
  return s.length === 11 ? `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}` : c;
};
