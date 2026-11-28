import { describe, expect, it } from 'vitest';
import { relatedMovements } from '../../src/components/MovementDetail';
import type { StockMovement } from '../../src/models';

const mv = (p: Partial<StockMovement>): StockMovement => ({
  id: p.id ?? Math.random().toString(36).slice(2), productId: 'p', type: 'ingreso', quantityBefore: 0, quantityAfter: 1, delta: 1,
  origin: 'manual', sourceSystem: 'local', idempotencyKey: p.id ?? 'k', createdAt: '2026-11-25T12:00:00.000Z', updatedAt: '2026-11-25T12:00:00.000Z', ...p,
} as StockMovement);

describe('detalle de un movimiento: lo que vino en la misma operación', () => {
  it('un remito junta todos sus renglones (salida del depósito e ingreso al punto)', () => {
    const a = mv({ id: 'a', refId: 'r1', origin: 'remito', type: 'salida', delta: -2 });
    const b = mv({ id: 'b', refId: 'r1', origin: 'remito', type: 'ingreso', delta: 2, outletId: 'o' });
    const c = mv({ id: 'c', refId: 'r1', origin: 'remito', type: 'salida', delta: -5, productId: 'q' });
    const otro = mv({ id: 'z', refId: 'r2', origin: 'remito' });
    const r = relatedMovements(a, [a, b, c, otro]);
    expect(r.sameRef).toBe(true);
    expect(r.list.map((x) => x.id).sort()).toEqual(['b', 'c']);
  });

  it('una producción muestra los insumos que descontó la receta, y el insumo lleva a su producción', () => {
    const prod = mv({ id: 'prod', type: 'produccion', delta: 10 });
    const harina = mv({ id: 'h', type: 'consumo', delta: -1, refId: 'prod', productId: 'harina' });
    const huevos = mv({ id: 'e', type: 'consumo', delta: -2, refId: 'prod', productId: 'huevos' });
    expect(relatedMovements(prod, [prod, harina, huevos]).list.map((x) => x.id).sort()).toEqual(['e', 'h']);
    expect(relatedMovements(harina, [prod, harina, huevos]).list.map((x) => x.id).sort()).toEqual(['e', 'prod']);
  });

  it('sin referencia: lo cargado por la misma persona con el mismo motivo en esos minutos', () => {
    const who = { id: 'u1', name: 'Braian' };
    const a = mv({ id: 'a', reason: 'Producción 25/11', performedBy: who, createdAt: '2026-11-25T18:56:00.000Z' });
    const b = mv({ id: 'b', reason: 'Producción 25/11', performedBy: who, createdAt: '2026-11-25T18:57:30.000Z', productId: 'q' });
    const otroDia = mv({ id: 'c', reason: 'Producción 25/11', performedBy: who, createdAt: '2026-11-26T18:57:30.000Z' });
    const otroMotivo = mv({ id: 'd', reason: 'Salida 25/11', performedBy: who, createdAt: '2026-11-25T18:57:00.000Z' });
    const r = relatedMovements(a, [a, b, otroDia, otroMotivo]);
    expect(r.sameRef).toBe(false);
    expect(r.list.map((x) => x.id)).toEqual(['b']);
    expect(relatedMovements(mv({ id: 'x' }), [a, b]).list).toEqual([]); // sin motivo, nada que agrupar
  });
});
