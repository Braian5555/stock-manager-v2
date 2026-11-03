import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../database/db';
import type { Invoice, Product } from '../models';
import { buildCosts } from '../services/costService';
import { useSession } from '../store/session';
import { EMPTY, useProducts } from './useData';

/** Costos en vivo (facturas + costos cargados a mano). `visible`: sólo quien ve facturas o administra el catálogo. */
export function useCosts(override?: Product) {
  const { can } = useSession();
  const visible = can('catalog.manage') || can('invoices') || can('admin');
  const products = useProducts();
  const invoices = (useLiveQuery(async (): Promise<Invoice[]> => (visible ? db.invoices.toArray() : []), [visible]) ?? EMPTY) as Invoice[];
  const list = useMemo(() => (override ? products.map((p) => (p.id === override.id ? override : p)) : products), [products, override]);
  const costs = useMemo(() => buildCosts(list, invoices), [list, invoices]);
  return { visible, ...costs };
}
