import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import type { Invoice, Permission, Product } from '../../src/models';
import { AssistantEngine, buildAssistantRequest, type GContent, type Transport } from '../../src/services/assistant/engine';
import { toolsFor } from '../../src/services/assistant/tools';
import { startCount } from '../../src/services/countService';
import { changeForItem, priceHistory, priceIncreases } from '../../src/services/priceService';
import { emptyProduct, saveProduct } from '../../src/services/productService';
import { normalizeSettings } from '../../src/services/settingsService';
import { ROLE_PERMISSIONS } from '../../src/services/userService';
import { setCurrentActor } from '../../src/services/userService';

const t = '2026-10-17T10:00:00.000Z';
async function seed() {
  await db.units.bulkAdd([
    { id: 'u', name: 'Unidad', abbreviation: 'u', createdAt: t, updatedAt: t },
    { id: 'kg', name: 'Kilo', abbreviation: 'kg', createdAt: t, updatedAt: t },
    { id: 'caja', name: 'Caja', abbreviation: 'caja', createdAt: t, updatedAt: t },
  ] as never);
  await db.categories.add({ id: 'beb', name: 'Bebidas', createdAt: t, updatedAt: t } as never);
  const aceite = await saveProduct({ ...emptyProduct(), name: 'Aceite de girasol 900 ml', unitId: 'u', purchaseFactor: 12, purchaseUnitId: 'caja', minStock: 10 });
  const coca = await saveProduct({ ...emptyProduct(), name: 'Coca-Cola 2,25 L', unitId: 'u', categoryId: 'beb', minStock: 6 }, 2);
  const harina = await saveProduct({ ...emptyProduct(), name: 'Harina 000', unitId: 'kg' }, 50);
  const pan = await saveProduct({ ...emptyProduct(), name: 'Pan francés', unitId: 'kg' });
  return { aceite, coca, harina, pan };
}

/** Respuesta de Gemini con texto o con pedidos de herramientas. */
const say = (text: string) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] });
const call = (...calls: { name: string; args: Record<string, unknown> }[]) => ({ candidates: [{ content: { role: 'model', parts: calls.map((c) => ({ functionCall: c, thoughtSignature: 'firma' })) }, finishReason: 'STOP' }] });

function scripted(responses: unknown[]) {
  const requests: { systemInstruction: { parts: { text: string }[] }; contents: GContent[]; tools: { functionDeclarations: { name: string }[] }[] }[] = [];
  const transport: Transport = async (body) => {
    requests.push(JSON.parse(JSON.stringify(body)));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error('sin más respuestas');
    return next;
  };
  return { transport, requests };
}

function engine(perms: Permission[], transport: Transport) {
  const set = new Set(perms);
  return new AssistantEngine({
    user: { name: 'Nico', role: 'custom' }, can: (p) => set.has(p), permissions: perms,
    settings: normalizeSettings(undefined), transport, today: () => '2026-10-17',
  });
}
const lastResponse = (req: { contents: GContent[] }) => req.contents[req.contents.length - 1].parts.find((p) => p.functionResponse)?.functionResponse?.response as Record<string, unknown>;
const refOf = (req: { systemInstruction: { parts: { text: string }[] } }, name: string) => new RegExp(`^(p\\d+)\\|${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|`, 'm').exec(req.systemInstruction.parts[0].text)?.[1];

describe('asistente: permisos', () => {
  it('sólo ofrece las herramientas que el perfil puede usar', () => {
    const names = (perms: Permission[]) => toolsFor((p) => perms.includes(p)).map((x) => x.name);
    const staff = names(ROLE_PERMISSIONS.staff);
    expect(staff).toEqual(expect.arrayContaining(['buscar_productos', 'reponer', 'precios', 'facturas', 'conteos', 'cargar_conteo', 'ir_a']));
    expect(staff).not.toContain('registrar_movimientos');
    expect(staff).not.toContain('crear_producto');
    expect(staff).not.toContain('consultar_movimientos');
    const baker = names(ROLE_PERMISSIONS.production);
    expect(baker).toEqual(expect.arrayContaining(['anotar_produccion', 'guardar_receta', 'buscar_productos']));
    expect(baker).not.toContain('reponer');
    expect(names(ROLE_PERMISSIONS.admin)).toHaveLength(toolsFor(() => true).length);
    // Gemini no acepta objetos vacíos: las herramientas sin datos van sin parámetros.
    const req = buildAssistantRequest('x', [], toolsFor(() => true)) as { tools: { functionDeclarations: { name: string; parameters?: unknown }[] }[] };
    expect(req.tools[0].functionDeclarations.find((d) => d.name === 'conteos')).toEqual({ name: 'conteos', description: expect.any(String) });
    expect(Object.keys(req)[0]).toBe('systemInstruction');
  });

  it('si la IA pide algo que el perfil no permite, no se ejecuta', async () => {
    const { coca } = await seed();
    const { transport, requests } = scripted([
      call({ name: 'registrar_movimientos', args: { movimientos: [{ producto: 'Coca-Cola 2,25 L', tipo: 'ingreso', cantidad: 5 }] } }),
      say('Tu perfil no permite registrar movimientos.'),
    ]);
    const e = engine(ROLE_PERMISSIONS.staff, transport);
    await e.send('Sumá 5 cocas');
    expect(requests[0].tools[0].functionDeclarations.map((d) => d.name)).not.toContain('registrar_movimientos');
    expect(String(lastResponse(requests[1]).error)).toMatch(/permiso/);
    expect(e.getState().messages.at(-1)?.proposals).toBeUndefined();
    expect((await db.products.get(coca.id))?.stock).toBe(2);
  });
});

describe('asistente: consultas y cambios', () => {
  it('consulta datos reales y responde', async () => {
    const { coca } = await seed();
    const { transport, requests } = scripted([call({ name: 'buscar_productos', args: { estado: 'bajo_minimo' } }), say('Tenés que reponer **Coca-Cola** y aceite.')]);
    const e = engine(ROLE_PERMISSIONS.manager, transport);
    await e.send('¿Qué tengo que reponer?');
    expect(requests[0].systemInstruction.parts[0].text).toMatch(/Coca-Cola 2,25 L\|u\|\|Bebidas/);
    expect(requests[0].contents).toEqual([{ role: 'user', parts: [{ text: '¿Qué tengo que reponer?' }] }]);
    const res = lastResponse(requests[1]).resultado as { productos: { nombre: string; stock: number }[] };
    expect(res.productos.map((p) => p.nombre)).toEqual(['Aceite de girasol 900 ml', 'Coca-Cola 2,25 L']);
    expect(res.productos[1].stock).toBe(2);
    // El pedido del modelo vuelve tal cual (con su firma) para que pueda seguir razonando.
    expect(requests[1].contents[1]).toMatchObject({ role: 'model', parts: [{ thoughtSignature: 'firma' }] });
    const last = e.getState().messages.at(-1)!;
    expect(last).toMatchObject({ role: 'assistant', text: 'Tenés que reponer **Coca-Cola** y aceite.', activity: ['Buscó productos'] });
    expect(coca.id).toBeTruthy();
  });

  it('los cambios esperan confirmación, se aplican una sola vez y la IA ve el resultado', async () => {
    setCurrentActor({ id: 'u1', name: 'Nico' });
    const { aceite, coca } = await seed();
    const { transport, requests } = scripted([say('placeholder')]);
    const e = engine(ROLE_PERMISSIONS.manager, transport);
    // Primero se obtiene la referencia que la app le pasa a la IA.
    await e.send('hola');
    const ref = refOf(requests[0], 'Aceite de girasol 900 ml')!;
    expect(ref).toMatch(/^p\d+$/);

    const s2 = scripted([
      call({ name: 'registrar_movimientos', args: { referencia: 'Remito 123', movimientos: [{ producto: ref, tipo: 'ingreso', cantidad: 2, unidad: 'compra' }, { producto: 'coca cola 2,25', tipo: 'ingreso', cantidad: 6 }] } }),
      say('Listo, cargué el remito.'),
    ]);
    e.setDeps({ user: { name: 'Nico', role: 'custom' }, can: () => true, permissions: ROLE_PERMISSIONS.manager, settings: normalizeSettings(undefined), transport: s2.transport, today: () => '2026-10-17' });
    await e.send('Cargá este remito');
    const msg = e.getState().messages.at(-1)!;
    expect(msg.proposals?.[0]).toMatchObject({ title: 'Registrar 2 movimientos', status: 'pending' });
    expect(msg.proposals?.[0].lines[0]).toBe('Ingreso +24 u · Aceite de girasol 900 ml (0 → 24)');
    expect((await db.products.get(aceite.id))?.stock).toBe(0); // todavía nada

    await e.confirm(msg.id);
    await e.confirm(msg.id); // doble toque: no hace nada
    expect((await db.products.get(aceite.id))?.stock).toBe(24);
    expect((await db.products.get(coca.id))?.stock).toBe(8);
    const moves = await db.movements.where('productId').equals(aceite.id).toArray();
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ origin: 'asistente', reason: 'Remito 123', performedBy: { name: 'Nico' } });
    expect(e.getState().messages.find((m) => m.id === msg.id)?.proposals?.[0]).toMatchObject({ status: 'done', result: 'Registrados 2 movimientos' });
    expect(lastResponse(s2.requests[1]).resultado).toMatchObject({ ok: true, registrados: 2 });
    expect(e.getState().messages.at(-1)?.text).toBe('Listo, cargué el remito.');
    expect(s2.requests).toHaveLength(2);
  });

  it('cancelar no cambia nada ni vuelve a consultar a la IA', async () => {
    const { harina } = await seed();
    const { transport, requests } = scripted([call({ name: 'registrar_movimientos', args: { movimientos: [{ producto: 'Harina 000', tipo: 'perdida', cantidad: 3, motivo: 'Se mojó' }] } })]);
    const e = engine(ROLE_PERMISSIONS.manager, transport);
    await e.send('Tirá 3 kilos de harina');
    const msg = e.getState().messages.at(-1)!;
    expect(msg.proposals?.[0].lines[0]).toBe('Pérdida −3 kg · Harina 000 (50 → 47)');
    e.cancel(msg.id);
    expect((await db.products.get(harina.id))?.stock).toBe(50);
    expect(requests).toHaveLength(1);
    expect(e.getState().messages.at(-1)?.text).toBe('Listo, no hice ningún cambio.');
    expect(e.getState().messages.find((m) => m.id === msg.id)?.proposals?.[0].status).toBe('cancelled');
  });

  it('dictado de conteo: anota en el conteo abierto', async () => {
    const { coca, aceite } = await seed();
    const count = await startCount({ name: 'Conteo sábado' });
    const { transport } = scripted([
      call({ name: 'cargar_conteo', args: { cantidades: [{ producto: 'Coca-Cola 2,25 L', cantidad: 12 }, { producto: 'Aceite de girasol 900 ml', cantidad: 3, unidad: 'compra' }, { producto: 'Fernet', cantidad: 1 }] } }),
      say('Anotado.'),
    ]);
    const e = engine(ROLE_PERMISSIONS.staff, transport);
    await e.send('conté 12 cocas, 3 cajas de aceite y un fernet');
    const msg = e.getState().messages.at(-1)!;
    expect(msg.proposals?.[0].title).toBe('Anotar en “Conteo sábado”');
    expect(msg.proposals?.[0].lines).toEqual(['Coca-Cola 2,25 L: 12 u', 'Aceite de girasol 900 ml: 36 u']);
    expect(msg.proposals?.[0].notes[0]).toMatch(/No encontré el producto “Fernet”/);
    await e.confirm(msg.id);
    const items = await db.countItems.where('countId').equals(count.id).toArray();
    expect(items.find((i) => i.productId === coca.id)?.counted).toBe(12);
    expect(items.find((i) => i.productId === aceite.id)?.counted).toBe(36);
  });

  it('receta: exige que existan los insumos y después la guarda', async () => {
    const { pan, harina } = await seed();
    const { transport, requests } = scripted([
      call({ name: 'guardar_receta', args: { producto: 'Pan francés', rinde: 10, insumos: [{ producto: 'Harina 000', cantidad: 6 }, { producto: 'Levadura fresca', cantidad: 0.2 }] } }),
      call({ name: 'crear_producto', args: { nombre: 'Levadura fresca', unidad: 'kg' } }),
      call({ name: 'guardar_receta', args: { producto: 'Pan francés', rinde: 10, insumos: [{ producto: 'Harina 000', cantidad: 6 }, { producto: 'Levadura fresca', cantidad: 0.2 }] } }),
      say('Guardé la receta.'),
    ]);
    const e = engine(ROLE_PERMISSIONS.manager, transport);
    await e.send('Pasá esta receta');
    // 1) falta la levadura: error a la IA; 2) propone crearla.
    expect(String(lastResponse(requests[1]).error)).toMatch(/Levadura fresca/);
    let msg = e.getState().messages.at(-1)!;
    expect(msg.proposals?.[0]).toMatchObject({ title: 'Crear producto', lines: ['Nombre: Levadura fresca', 'Se cuenta en: Kilo (kg)'] });
    await e.confirm(msg.id);
    msg = e.getState().messages.at(-1)!;
    expect(msg.proposals?.[0].title).toBe('Guardar la receta de “Pan francés”');
    await e.confirm(msg.id);
    const saved = await db.products.get(pan.id);
    expect(saved?.recipe?.yield).toBe(10);
    expect(saved?.recipe?.items).toEqual([{ productId: harina.id, quantity: 6 }, { productId: expect.any(String), quantity: 0.2 }]);
    expect(e.getState().messages.at(-1)?.text).toBe('Guardé la receta.');
  });

  it('si falla la conexión se puede reintentar sin romper la conversación', async () => {
    await seed();
    const { transport, requests } = scripted([new Error('Se alcanzó el límite gratis de Gemini por ahora.'), say('Hola!')]);
    const e = engine(ROLE_PERMISSIONS.manager, transport);
    await e.send('hola');
    const failed = e.getState().messages[0];
    expect(failed.retry?.text).toBe('hola');
    expect(e.getState().messages[1]).toMatchObject({ error: true, text: 'Se alcanzó el límite gratis de Gemini por ahora.' });
    await e.retry(failed.id);
    expect(e.getState().messages.map((m) => m.text)).toEqual(['hola', 'Hola!']);
    expect(requests[1].contents).toEqual([{ role: 'user', parts: [{ text: 'hola' }] }]);
  });

  it('las fotos viejas no se vuelven a mandar', async () => {
    await seed();
    const { transport, requests } = scripted([say('Es un remito.'), say('De nada.')]);
    const e = engine(ROLE_PERMISSIONS.manager, transport);
    await e.send('¿Qué es esto?', [{ data: 'QUJD', type: 'image/jpeg', thumb: 'data:x' }]);
    expect(requests[0].contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } });
    await e.send('gracias');
    expect(requests[1].contents[0].parts[0]).toEqual({ text: '[foto enviada antes]' });
  });
});

describe('precios de compra', () => {
  const inv = (id: string, date: string, items: Invoice['items']): Invoice => ({ id, date, pages: [], createdAt: t, updatedAt: t, items } as Invoice);
  const line = (productId: string, quantity: number, unitPrice: number, stockQty: number) => ({ id: `${productId}-${unitPrice}`, description: 'x', productId, quantity, unitPrice, stockQty, status: 'ok' as const });

  it('calcula el costo por unidad de stock y detecta aumentos', () => {
    const invoices = [
      inv('a', '2026-09-01', [line('aceite', 1, 12000, 12), line('coca', 6, 1500, 6)]),
      inv('b', '2026-10-10', [line('aceite', 2, 14400, 24), line('coca', 6, 1500, 6)]),
    ];
    const h = priceHistory(invoices);
    expect(h.get('aceite')!.map((p) => p.costPerUnit)).toEqual([1000, 1200]);
    const ups = priceIncreases(invoices, { sinceYmd: '2026-10-01' });
    expect(ups).toHaveLength(1);
    expect(ups[0]).toMatchObject({ productId: 'aceite', pct: 20 });
    expect(changeForItem(invoices[1], invoices[1].items![0], h)).toBe(20);
    expect(changeForItem(invoices[0], invoices[0].items![0], h)).toBeUndefined(); // primera compra
    expect(priceIncreases(invoices, { sinceYmd: '2026-10-11' })).toHaveLength(0);
  });

  it('ignora renglones sin precio o que no van al stock', () => {
    const p = { id: 'x' } as Product;
    const h = priceHistory([inv('a', '2026-10-01', [{ id: '1', description: 'flete', quantity: 1, unitPrice: 500, status: 'ignored' }, { id: '2', description: 'y', productId: p.id, quantity: 1, status: 'ok', stockQty: 1 }])]);
    expect(h.size).toBe(0);
  });
});
