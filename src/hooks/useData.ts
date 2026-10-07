import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../database/db';
import type { Category, Location, Supplier, Unit } from '../models';
import { getIntegration } from '../integrations/integrationService';

/** Arreglo vacío estable (evita re-renders/efectos infinitos con `?? []`). */
export const EMPTY: never[] = [];

export const useProducts = () => useLiveQuery(() => db.products.toArray(), []) ?? EMPTY;
export const useSuppliers = () => useLiveQuery(() => db.suppliers.orderBy('name').toArray(), []) ?? EMPTY;
export const useCategories = () => useLiveQuery(() => db.categories.orderBy('name').toArray(), []) ?? EMPTY;
export const useUnits = () => useLiveQuery(() => db.units.orderBy('name').toArray(), []) ?? EMPTY;
export const useLocations = () => useLiveQuery(() => db.locations.orderBy('name').toArray(), []) ?? EMPTY;
export const useIntegration = () => useLiveQuery(() => getIntegration(), []);
export const usePendingJobs = () => useLiveQuery(() => db.syncJobs.where('status').anyOf('pendiente', 'error').count(), []) ?? 0;

export interface Lookups {
  categories: Category[];
  units: Unit[];
  locations: Location[];
  suppliers: Supplier[];
  category: (id?: string) => string;
  unit: (id?: string) => string;
  location: (id?: string) => string;
  supplier: (id?: string) => string;
}

/** Catálogos + funciones id → nombre, para mostrar sin repetir búsquedas. */
export function useLookups(): Lookups {
  const categories = useCategories();
  const units = useUnits();
  const locations = useLocations();
  const suppliers = useSuppliers();
  return useMemo(() => {
    const m = <T extends { id: string }>(list: T[], f: (x: T) => string) => {
      const map = new Map(list.map((x) => [x.id, f(x)]));
      return (id?: string) => (id ? (map.get(id) ?? '') : '');
    };
    return {
      categories, units, locations, suppliers,
      category: m(categories, (c) => c.name),
      unit: m(units, (u) => u.abbreviation),
      location: m(locations, (l) => l.name),
      supplier: m(suppliers, (s) => s.name),
    };
  }, [categories, units, locations, suppliers]);
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
