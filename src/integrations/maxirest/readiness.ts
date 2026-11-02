import { db } from '../../database/db';
import type { Outlet, Product, Transfer } from '../../models';
import { codeKey } from './maxirestXls';

/**
 * ¿Está todo listo para conectar Maxirest? Lo que hace falta para que, cuando Maxirest
 * habilite su API, la sincronización encuentre cada cosa sin adivinar:
 *  - cada producto con su código de insumo de Maxirest (el SKU), sin repetidos;
 *  - cada punto con el nombre de su depósito en Maxirest;
 *  - los remitos ya marcados como cargados (o pendientes, que serían lo primero en mandarse).
 * Sirve también hoy para el Excel: con códigos completos, Maxirest importa todo.
 */

export type CheckLevel = 'ok' | 'warn' | 'info';

export interface ReadinessCheck {
  id: 'codes' | 'duplicates' | 'notInMaxirest' | 'deposits' | 'transfers';
  level: CheckLevel;
  title: string;
  detail: string;
  /** Productos / puntos / remitos involucrados (para mostrarlos). */
  products?: Product[];
  outlets?: Outlet[];
  groups?: { code: string; products: Product[] }[];
  transfers?: Transfer[];
}

export interface Readiness {
  checks: ReadinessCheck[];
  /** Productos activos y cuántos tienen código. */
  products: number;
  withCode: number;
  /** Insumos de Maxirest conocidos (del último Excel importado o de la conexión). */
  maxirestItems: number;
  ready: boolean;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'es');

export async function maxirestReadiness(): Promise<Readiness> {
  const [products, outlets, transfers, refs] = await Promise.all([
    db.products.toArray(),
    db.outlets.toArray(),
    db.transfers.toArray(),
    db.externalReferences.where({ system: 'maxirest', entityType: 'product' }).filter((r) => r.source !== 'mock').toArray(),
  ]);
  const active = products.filter((p) => p.active).sort(byName);
  const withCode = active.filter((p) => p.sku?.trim());
  const withoutCode = active.filter((p) => !p.sku?.trim());

  const byCode = new Map<string, Product[]>();
  for (const p of withCode) {
    const k = codeKey(p.sku ?? '');
    byCode.set(k, [...(byCode.get(k) ?? []), p]);
  }
  const groups = [...byCode.entries()].filter(([, ps]) => ps.length > 1).map(([, ps]) => ({ code: (ps[0].sku ?? '').trim(), products: ps }));

  const known = new Set(refs.map((r) => codeKey(r.code || r.externalId)));
  const notInMaxirest = known.size ? withCode.filter((p) => !known.has(codeKey(p.sku ?? ''))) : [];

  const activeOutlets = outlets.filter((o) => o.active).sort(byName);
  const noDeposit = activeOutlets.filter((o) => !o.maxirestName?.trim());
  const pendingTransfers = transfers.filter((t) => t.status === 'enviado' && t.maxirest === 'pendiente').sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const checks: ReadinessCheck[] = [
    withoutCode.length
      ? { id: 'codes', level: 'warn', title: `${withoutCode.length} ${withoutCode.length === 1 ? 'producto sin' : 'productos sin'} código de Maxirest`, detail: 'Sin el código de insumo, Maxirest no sabe a qué insumo corresponde. Completalo en cada producto (campo Código) o importá el Excel de Maxirest en “Excel Bridge” para vincularlos.', products: withoutCode }
      : { id: 'codes', level: 'ok', title: 'Todos los productos tienen código de Maxirest', detail: `${withCode.length} productos con código.` },
    groups.length
      ? { id: 'duplicates', level: 'warn', title: `${groups.length} ${groups.length === 1 ? 'código repetido' : 'códigos repetidos'}`, detail: 'Dos productos con el mismo código se mandan sumados a un solo insumo de Maxirest. Dejá un código por producto.', groups }
      : { id: 'duplicates', level: 'ok', title: 'Ningún código repetido', detail: 'Cada código corresponde a un solo producto.' },
    !known.size
      ? { id: 'notInMaxirest', level: 'info', title: 'Falta comparar con los insumos de Maxirest', detail: 'Importá el Excel del inventario de Maxirest en “Excel Bridge” y la app revisa que cada código exista allá.' }
      : notInMaxirest.length
        ? { id: 'notInMaxirest', level: 'warn', title: `${notInMaxirest.length} ${notInMaxirest.length === 1 ? 'código no existe' : 'códigos no existen'} en Maxirest`, detail: 'Tienen código, pero ese código no está en el último Excel de Maxirest. Revisá que esté bien escrito o creá el insumo en Maxirest.', products: notInMaxirest }
        : { id: 'notInMaxirest', level: 'ok', title: 'Todos los códigos existen en Maxirest', detail: `Comparado con ${known.size} insumos de Maxirest.` },
    !activeOutlets.length
      ? { id: 'deposits', level: 'info', title: 'No hay puntos cargados', detail: 'Sólo se usa el Depósito Central.' }
      : noDeposit.length
        ? { id: 'deposits', level: 'warn', title: `${noDeposit.length} ${noDeposit.length === 1 ? 'punto sin' : 'puntos sin'} depósito de Maxirest`, detail: 'Escribí cómo se llama cada punto en Maxirest (el depósito), así los remitos van al depósito correcto.', outlets: activeOutlets }
        : { id: 'deposits', level: 'ok', title: 'Cada punto tiene su depósito de Maxirest', detail: activeOutlets.map((o) => `${o.name} → ${o.maxirestName}`).join(' · '), outlets: activeOutlets },
    pendingTransfers.length
      ? { id: 'transfers', level: 'info', title: `${pendingTransfers.length} ${pendingTransfers.length === 1 ? 'remito sin' : 'remitos sin'} pasar a Maxirest`, detail: 'Hoy se cargan a mano (o con el Excel de remitos). Cuando Maxirest habilite la API, son lo primero que se manda.', transfers: pendingTransfers }
      : { id: 'transfers', level: 'ok', title: 'No hay remitos pendientes de Maxirest', detail: 'Todos los remitos están marcados como cargados.' },
  ];
  return {
    checks,
    products: active.length,
    withCode: withCode.length,
    maxirestItems: known.size,
    ready: checks.every((c) => c.level !== 'warn'),
  };
}
