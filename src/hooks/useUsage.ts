import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../database/db';
import type { StockMovement as Movement } from '../models';
import { usageByProduct, type Usage } from '../services/consumptionService';
import { EMPTY, useProducts } from './useData';

/** Consumo real por producto de los últimos `days` días (se recalcula con cada movimiento). */
export function useUsage(days = 30): Map<string, Usage> {
  const products = useProducts();
  const since = useMemo(() => new Date(Date.now() - days * 864e5).toISOString().slice(0, 13), [days]);
  const movements = (useLiveQuery(() => db.movements.where('createdAt').aboveOrEqual(since).toArray(), [since]) ?? EMPTY) as Movement[];
  return useMemo(() => usageByProduct(products, movements, days), [products, movements, days]);
}
