import type { ExternalReference, Product, SyncJob } from '../../models';
import { round3 } from '../../utils/format';

export type ReconState = 'igual' | 'positiva' | 'negativa' | 'no_vinculado' | 'sin_dato' | 'error';
export interface ReconRow {
  key: string;
  product?: Product;
  ref?: ExternalReference;
  local?: number;
  external?: number;
  /** local − externo (positivo: hay más en Stock Manager que en Maxirest). */
  difference?: number;
  state: ReconState;
  error?: string;
}

export const RECON_LABEL: Record<ReconState, string> = {
  igual: 'Igual',
  positiva: 'Diferencia positiva',
  negativa: 'Diferencia negativa',
  no_vinculado: 'No vinculado',
  sin_dato: 'Sin dato externo',
  error: 'Error de sincronización',
};

export function buildReconciliation(products: Product[], refs: ExternalReference[], jobs: SyncJob[] = []): ReconRow[] {
  const rows: ReconRow[] = [];
  const refById = new Map(refs.map((r) => [r.externalId, r]));
  const used = new Set<string>();
  const errorByExt = new Map<string, string>();
  for (const j of jobs) if (j.status === 'error' && typeof j.payload.productExternalId === 'string') errorByExt.set(j.payload.productExternalId, j.error ?? 'Error');

  for (const p of products) {
    const extId = p.externalSystems?.maxirest?.id;
    if (!extId) continue;
    used.add(extId);
    const ref = refById.get(extId);
    if (errorByExt.has(extId)) {
      rows.push({ key: p.id, product: p, ref, local: p.stock, external: ref?.stock, state: 'error', error: errorByExt.get(extId) });
      continue;
    }
    if (ref?.stock === undefined) {
      rows.push({ key: p.id, product: p, ref, local: p.stock, state: 'sin_dato' });
      continue;
    }
    const difference = round3(p.stock - ref.stock);
    rows.push({ key: p.id, product: p, ref, local: p.stock, external: ref.stock, difference, state: difference === 0 ? 'igual' : difference > 0 ? 'positiva' : 'negativa' });
  }
  for (const r of refs) if (!used.has(r.externalId)) rows.push({ key: `ext:${r.externalId}`, ref: r, external: r.stock, state: 'no_vinculado' });
  return rows;
}
