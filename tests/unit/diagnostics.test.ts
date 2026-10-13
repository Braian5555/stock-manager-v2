import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { clearErrorLog, fixStockMismatches, logError, readErrorLog, reportToText, runDiagnostics } from '../../src/services/diagnosticsService';
import { emptyProduct, saveProduct } from '../../src/services/productService';
import { applyMovement } from '../../src/services/stockService';

const cloud = { phase: 'unconfigured' };
const byId = (r: Awaited<ReturnType<typeof runDiagnostics>>, id: string) => r.checks.find((c) => c.id === id)!;

describe('diagnóstico', () => {
  it('detecta stock que no coincide con los movimientos y lo corrige sin perder historia', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'Manteca' }, 10);
    await applyMovement({ productId: p.id, type: 'salida', delta: -3, origin: 'manual' });
    expect(byId(await runDiagnostics(cloud), 'stock-mismatch').level).toBe('ok');

    await db.products.update(p.id, { stock: 99 }); // se rompe a propósito
    const bad = byId(await runDiagnostics(cloud), 'stock-mismatch');
    expect(bad.level).toBe('error');
    expect(bad.items?.[0]).toContain('Manteca: guardado 99, según movimientos 7');

    const movs = await db.movements.count();
    expect(await fixStockMismatches()).toBe(1);
    expect((await db.products.get(p.id))!.stock).toBe(7);
    expect(await db.movements.count()).toBe(movs);
    expect(byId(await runDiagnostics(cloud), 'stock-mismatch').level).toBe('ok');
  });

  it('avisa recetas rotas, nombres repetidos y stock negativo', async () => {
    const a = await saveProduct({ ...emptyProduct(), name: 'Pan' });
    await saveProduct({ ...emptyProduct(), name: 'pan' });
    await saveProduct({ ...emptyProduct(), name: 'Torta', recipe: { yield: 1, items: [{ productId: 'no-existe', quantity: 1 }] } });
    await applyMovement({ productId: a.id, type: 'salida', delta: -2, origin: 'manual' });
    const r = await runDiagnostics(cloud);
    expect(byId(r, 'recipes').items?.join()).toContain('Torta: usa un insumo que ya no existe');
    expect(byId(r, 'dup-names').level).toBe('warn');
    expect(byId(r, 'negative-stock').items).toEqual(['Pan: -2 (nunca se cargó stock)']);
  });

  it('registra errores y arma el informe para Claude', async () => {
    clearErrorLog();
    logError(new Error('Explotó algo'));
    logError(new Error('Dato inválido'), 'aviso');
    expect(readErrorLog().map((e) => e.message)).toEqual(['Dato inválido', 'Explotó algo']);
    const r = await runDiagnostics(cloud);
    expect(byId(r, 'app-errors').level).toBe('warn');
    const text = reportToText(r);
    expect(text).toMatch(/^# Diagnóstico de Stock Manager v/);
    expect(text).toContain('Explotó algo');
    expect(text).toContain('Claude: revisá este informe');
    clearErrorLog();
    expect(readErrorLog()).toEqual([]);
  });
});

describe('diagnóstico: stock negativo', () => {
  it('explica que nunca se cargó stock y arma un conteo sólo con esos productos', async () => {
    const harina = await saveProduct({ ...emptyProduct(), name: 'Harina 0000' });
    const ok = await saveProduct({ ...emptyProduct(), name: 'Sal' }, 5);
    await applyMovement({ productId: harina.id, type: 'consumo', delta: -4, origin: 'manual' });
    const c = (await runDiagnostics(cloud)).checks.find((x) => x.id === 'negative-stock')!;
    expect(c.items).toEqual(['Harina 0000: -4 (nunca se cargó stock)']);
    expect(c.summary).toContain('se descontaron por recetas');
    const { countProducts } = await import('../../src/services/diagnosticsService');
    const count = await countProducts(c.productIds!, 'Negativos');
    const items = await db.countItems.where('countId').equals(count.id).toArray();
    expect(items.map((i) => i.productId)).toEqual([harina.id]);
    expect(items[0].productId).not.toBe(ok.id);
  });
});
