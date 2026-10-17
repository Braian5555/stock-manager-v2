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
    expect(msg.proposals?.[0].notes[0]).toBe("No encontré “Fernet” en el catálogo.");
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

describe('asistente: revisión a fondo', () => {
  it('no adivina productos ambiguos y acepta nombre exacto o código', async () => {
    await seed();
    await saveProduct({ ...emptyProduct(), name: 'Coca-Cola 1,5 L', unitId: 'u', sku: 'COC15' });
    const { resolveProduct, RefMap } = await import('../../src/services/assistant/tools');
    const ctx = { can: () => true, settings: normalizeSettings(undefined), today: '2026-10-17', refs: new RefMap(await db.products.toArray()) };
    await expect(resolveProduct('coca cola', ctx)).rejects.toThrow(/No sé cuál es “coca cola”: puede ser .*Coca-Cola 2,25 L.*Coca-Cola 1,5 L|No sé cuál es “coca cola”: puede ser .*Coca-Cola 1,5 L.*Coca-Cola 2,25 L/);
    expect((await resolveProduct('coca-cola 1,5 l', ctx)).name).toBe('Coca-Cola 1,5 L');
    expect((await resolveProduct('COC15', ctx)).name).toBe('Coca-Cola 1,5 L');
    expect((await resolveProduct('harina 000 kg', ctx)).name).toBe('Harina 000');
    await expect(resolveProduct('Fernet', ctx)).rejects.toThrow('No encontré “Fernet” en el catálogo.');
  });

  it('deshacer: el stock vuelve, y la IA se entera en el próximo mensaje', async () => {
    const { aceite } = await seed();
    const { transport, requests } = scripted([
      call({ name: 'registrar_movimientos', args: { movimientos: [{ producto: 'Aceite de girasol 900 ml', tipo: 'ingreso', cantidad: 2, unidad: 'compra' }, { producto: 'Fernet', tipo: 'ingreso', cantidad: 1 }] } }),
      say('Listo, cargué el aceite. No encontré el Fernet.'),
      say('Ok.'),
    ]);
    const e = engine(ROLE_PERMISSIONS.manager, transport);
    await e.send('Llegaron 2 cajas de aceite y un fernet');
    const msg = e.getState().messages.at(-1)!;
    await e.confirm(msg.id);
    // Lo que no se encontró se le informa a la IA junto con el resultado.
    expect(lastResponse(requests[1]).avisos).toEqual(['No encontré “Fernet” en el catálogo.']);
    expect((await db.products.get(aceite.id))?.stock).toBe(24);
    expect(e.getState().messages.find((m) => m.id === msg.id)?.proposals?.[0].canUndo).toBe(true);
    await e.undo(msg.id, 0);
    expect((await db.products.get(aceite.id))?.stock).toBe(0);
    const prop = e.getState().messages.find((m) => m.id === msg.id)?.proposals?.[0];
    expect(prop).toMatchObject({ status: 'undone', canUndo: false });
    await e.undo(msg.id, 0); // dos veces: no hace nada
    expect((await db.products.get(aceite.id))?.stock).toBe(0);
    await e.send('gracias');
    const last = requests[2].contents.at(-1)!;
    expect(last.parts[0].text).toMatch(/^\[Aviso de la app.*deshizo “Registrar 1 movimiento”/);
    expect(last.parts.at(-1)).toEqual({ text: 'gracias' });
  });

  it('conteo dictado sin conteo abierto: crea uno con esos productos (y se puede deshacer)', async () => {
    const { coca } = await seed();
    const { transport } = scripted([
      call({ name: 'cargar_conteo', args: { cantidades: [{ producto: 'Coca-Cola 2,25 L', cantidad: 10 }, { producto: 'Coca-Cola 2,25 L', cantidad: 12 }] } }),
      say('Listo.'),
    ]);
    const e = engine(ROLE_PERMISSIONS.staff, transport);
    await e.send('conté 10 cocas, no, 12');
    const msg = e.getState().messages.at(-1)!;
    expect(msg.proposals?.[0].title).toBe('Empezar un conteo nuevo con 1 producto');
    expect(msg.proposals?.[0].lines).toEqual(['Coca-Cola 2,25 L: 12 u']);
    expect(msg.proposals?.[0].notes.join(' ')).toMatch(/se dijo dos veces.*No había ningún conteo abierto/);
    await e.confirm(msg.id);
    const [count] = (await db.counts.toArray()).filter((c) => c.status === 'abierto');
    expect(count.name).toMatch(/^Conteo dictado/);
    const items = await db.countItems.where('countId').equals(count.id).toArray();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ productId: coca.id, counted: 12 });
    await e.undo(msg.id, 0);
    expect((await db.counts.get(count.id))?.status).toBe('descartado');
  });

  it('respuesta vacía o mal armada: reintenta una vez y si se repite avisa', async () => {
    await seed();
    const empty = { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }] };
    const malformed = { candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }] };
    const a = scripted([empty, say('Hola!')]);
    const e1 = engine(ROLE_PERMISSIONS.manager, a.transport);
    await e1.send('hola');
    expect(e1.getState().messages.at(-1)?.text).toBe('Hola!');
    expect(a.requests).toHaveLength(2);
    const b = scripted([malformed, malformed]);
    const e2 = engine(ROLE_PERMISSIONS.manager, b.transport);
    await e2.send('hola');
    expect(e2.getState().messages.at(-1)).toMatchObject({ error: true, text: 'La IA armó mal el pedido.' });
    expect(e2.getState().messages[0].retry?.text).toBe('hola');
  });

  it('si le sacan el permiso mientras espera confirmación, no aplica nada', async () => {
    const { harina } = await seed();
    const { transport } = scripted([call({ name: 'registrar_movimientos', args: { movimientos: [{ producto: 'Harina 000', tipo: 'salida', cantidad: 5 }] } }), say('No se pudo.')]);
    let perms = new Set<Permission>(ROLE_PERMISSIONS.manager);
    const e = new AssistantEngine({ user: { name: 'Nico', role: 'custom' }, can: (p) => perms.has(p), permissions: [...perms], settings: normalizeSettings(undefined), transport, today: () => '2026-10-17' });
    await e.send('Sacá 5 kilos de harina');
    perms = new Set<Permission>(ROLE_PERMISSIONS.staff);
    e.setDeps({ user: { name: 'Nico', role: 'custom' }, can: (p) => perms.has(p), permissions: [...perms], settings: normalizeSettings(undefined), transport, today: () => '2026-10-17' });
    const msg = e.getState().messages.at(-1)!;
    await e.confirm(msg.id);
    expect(e.getState().messages.find((m) => m.id === msg.id)?.proposals?.[0].status).toBe('error');
    expect((await db.products.get(harina.id))?.stock).toBe(50);
  });

  it('el catálogo no se rompe con nombres raros', async () => {
    await seed();
    await saveProduct({ ...emptyProduct(), name: 'Vino | tinto\nmalbec', unitId: 'u' });
    const { transport, requests } = scripted([say('ok')]);
    await engine(ROLE_PERMISSIONS.manager, transport).send('hola');
    expect(requests[0].systemInstruction.parts[0].text).toMatch(/^p\d+\|Vino tinto malbec\|u\|\|$/m);
  });
});

describe('facturas: equivalencias y precios (revisión)', () => {
  it('un texto de factura queda en un solo producto, y no se aprenden textos genéricos', async () => {
    await seed();
    const a = await saveProduct({ ...emptyProduct(), name: 'Agua mineral 500 ml', unitId: 'u' });
    const b = await saveProduct({ ...emptyProduct(), name: 'Agua con gas 500 ml', unitId: 'u' });
    const { learnFromInvoice, learnableAlias } = await import('../../src/services/invoiceStock');
    const item = (productId: string, description: string) => ({ id: description, description, quantity: 1, status: 'ok' as const, productId, stockQty: 1 });
    await learnFromInvoice([item(a.id, 'AGUA VILLAVICENCIO 500')]);
    expect((await db.products.get(a.id))?.invoiceAliases).toEqual(['agua villavicencio 500']);
    // Corrección: ese texto era el agua con gas.
    await learnFromInvoice([item(b.id, 'AGUA VILLAVICENCIO 500')]);
    expect((await db.products.get(a.id))?.invoiceAliases).toEqual([]);
    expect((await db.products.get(b.id))?.invoiceAliases).toEqual(['agua villavicencio 500']);
    await learnFromInvoice([item(a.id, 'VARIOS'), item(a.id, 'FLETE'), item(a.id, 'X 12')]);
    expect((await db.products.get(a.id))?.invoiceAliases).toEqual([]);
    expect(learnableAlias('promo coca')).toBe(true);
    expect(learnableAlias('promo')).toBe(false);
  });

  it('los precios sólo salen de renglones confirmados', () => {
    const inv = (id: string, date: string, status: 'ok' | 'check'): Invoice => ({ id, date, pages: [], createdAt: t, updatedAt: t, items: [{ id: `${id}1`, description: 'x', productId: 'p', quantity: 1, unitPrice: id === 'a' ? 100 : 500, stockQty: 1, status }] } as Invoice);
    expect(priceHistory([inv('a', '2026-10-01', 'ok'), inv('b', '2026-10-02', 'check')]).get('p')).toHaveLength(1);
    expect(priceIncreases([inv('a', '2026-10-01', 'ok'), inv('b', '2026-10-02', 'check')])).toHaveLength(0);
  });
});

describe('misma mercadería cargada dos veces (remito y factura)', () => {
  it('avisa en la factura si ya entró por remito, y en el remito si ya entró por factura', async () => {
    const { aceite } = await seed();
    const { doubleLoadWarning } = await import('../../src/services/invoiceStock');
    const { applyMovement } = await import('../../src/services/stockService');
    const items = [{ id: 'i1', description: 'ACEITE', quantity: 2, unit: 'caja', productId: aceite.id, stockQty: 24, status: 'ok' as const }];
    expect(await doubleLoadWarning('inv1', items)).toBeUndefined();
    await applyMovement({ productId: aceite.id, type: 'ingreso', delta: 24, origin: 'asistente', reason: 'Remito 0001-77', idempotencyKey: 'ia:x:0:0' });
    expect(await doubleLoadWarning('inv1', items)).toMatch(/Aceite de girasol 900 ml \(\+24 el .*Remito 0001-77\)/);

    await applyMovement({ productId: aceite.id, type: 'ingreso', delta: 12, origin: 'factura', reason: 'Factura A-9', refId: 'inv9', idempotencyKey: 'factura:inv9:i1' });
    const { transport } = scripted([call({ name: 'registrar_movimientos', args: { movimientos: [{ producto: 'Aceite de girasol 900 ml', tipo: 'ingreso', cantidad: 1, unidad: 'compra' }] } })]);
    const e = engine(ROLE_PERMISSIONS.manager, transport);
    await e.send('Llegó una caja de aceite');
    expect(e.getState().messages.at(-1)?.proposals?.[0].notes[0]).toMatch(/ya entró por Factura A-9 el .*\(\+12\): fijate que no sea la misma mercadería/);
  });
});

describe('asistente: facturas por foto quedan en Facturas', () => {
  const img = { data: 'QUJDRA==', type: 'image/jpeg', thumb: 'data:image/jpeg;base64,AA==', width: 10, height: 20, bytes: 6 };

  it('guarda la factura con la foto, la carga al stock y se puede deshacer todo', async () => {
    setCurrentActor({ id: 'u1', name: 'Braian' });
    const { aceite, coca } = await seed();
    const { transport, requests } = scripted([say('placeholder')]);
    const e = engine(ROLE_PERMISSIONS.manager, transport);
    await e.send('hola');
    const refAceite = refOf(requests[0], 'Aceite de girasol 900 ml')!;
    const refCoca = refOf(requests[0], 'Coca-Cola 2,25 L')!;
    const s2 = scripted([
      call({ name: 'cargar_factura', args: {
        proveedor: 'Distribuidora Santarossa', numero: '0011-00065063', fecha: '2026-10-17', total: 52000, tipo: 'factura',
        renglones: [
          { descripcion: 'ACEITE GIRASOL 900', producto: refAceite, cantidad: 2, unidad: 'caja', precio_unitario: 24000, total_renglon: 48000 },
          { descripcion: 'COCA COLA 2250', producto: refCoca, cantidad: 1, unidad: 'B', unidades_por_caja: 6, precio_unitario: 3500, total_renglon: 3500 },
          { descripcion: 'FLETE', cantidad: 1, precio_unitario: 500, no_va_al_stock: true },
        ],
      } }),
      say('Listo: guardé la factura y cargué el stock.'),
    ]);
    e.setDeps({ user: { name: 'Braian', role: 'custom' }, can: () => true, permissions: ROLE_PERMISSIONS.manager, settings: normalizeSettings(undefined), transport: s2.transport, today: () => '2026-10-17' });
    await e.send('Guardá esta factura', [img]);
    const msg = e.getState().messages.at(-1)!;
    expect(msg.proposals?.[0].title).toBe('Guardar la factura y cargarla al stock');
    expect(msg.proposals?.[0].lines.map((l) => l.replace(/\u00a0/g, ' '))).toEqual([
      'Distribuidora Santarossa (proveedor nuevo) · 0011-00065063 · 17/10/2026 · $ 52.000,00',
      '+24 u · Aceite de girasol 900 ml (2 caja)',
      '+6 u · Coca-Cola 2,25 L (1 B)',
      'No va al stock: FLETE',
      'Se guarda en Facturas con la foto y se carga al stock.',
    ]);
    expect(await db.invoices.count()).toBe(0);
    await e.confirm(msg.id);

    const [inv] = await db.invoices.toArray();
    expect(inv).toMatchObject({ number: '0011-00065063', date: '2026-10-17', total: 52000, stockMovementIds: expect.any(Array) });
    expect(inv.stockAppliedAt).toBeTruthy();
    expect(inv.items?.map((i) => [i.status, i.stockQty])).toEqual([['ok', 24], ['ok', 6], ['ignored', undefined]]);
    expect((await db.suppliers.get(inv.supplierId!))?.name).toBe('Distribuidora Santarossa');
    expect((await db.invoiceImages.where('invoiceId').equals(inv.id).toArray())[0]).toMatchObject({ data: 'QUJDRA==', uploaded: 0 });
    expect((await db.products.get(aceite.id))?.stock).toBe(24);
    expect((await db.products.get(coca.id))?.stock).toBe(8);
    expect((await db.movements.where('refId').equals(inv.id).toArray()).every((m) => m.origin === 'factura')).toBe(true);
    // Aprendió que el bulto de coca trae 6.
    expect((await db.products.get(coca.id))?.purchaseFactor).toBe(6);
    expect(lastResponse(s2.requests[1]).resultado).toMatchObject({ guardada_en_facturas: true, cargada_al_stock: true, productos_cargados: 2 });

    await e.undo(msg.id, 0);
    expect(await db.invoices.count()).toBe(0);
    expect((await db.products.get(aceite.id))?.stock).toBe(0);
    expect((await db.products.get(coca.id))?.stock).toBe(2);
  });

  it('no guarda dos veces la misma factura, pide la foto y deja para revisar lo que no reconoce', async () => {
    await seed();
    const args = { proveedor: 'Lo de Camilo', numero: 'A-1', renglones: [{ descripcion: 'HARINA 000', producto: 'Harina 000', cantidad: 25, unidad: 'kg' }, { descripcion: 'LEVADURA FRESCA', cantidad: 1, unidad: 'kg' }] };
    // Sin foto: no se puede guardar en Facturas.
    const a = scripted([call({ name: 'cargar_factura', args }), say('Mandame la foto.')]);
    const e1 = engine(ROLE_PERMISSIONS.manager, a.transport);
    await e1.send('cargá la factura A-1 de Camilo');
    expect(String(lastResponse(a.requests[1]).error)).toMatch(/hace falta la foto/);

    // Con foto y un renglón desconocido: se guarda para revisar, sin tocar el stock.
    const b = scripted([call({ name: 'cargar_factura', args }), say('Guardada; falta la levadura.')]);
    const e2 = engine(ROLE_PERMISSIONS.manager, b.transport);
    await e2.send('esta', [img]);
    const msg = e2.getState().messages.at(-1)!;
    expect(msg.proposals?.[0].title).toBe('Guardar la factura en Facturas');
    expect(msg.proposals?.[0].lines.at(-1)).toBe('Se guarda en Facturas con la foto. El stock se carga cuando se revisen el renglón pendiente (en Facturas).');
    await e2.confirm(msg.id);
    const [inv] = await db.invoices.toArray();
    expect(inv.stockAppliedAt).toBeUndefined();
    expect(inv.items?.map((i) => i.status)).toEqual(['ok', 'none']);

    // La misma factura otra vez: no se repite.
    const c = scripted([call({ name: 'cargar_factura', args }), say('Ya estaba.')]);
    const e3 = engine(ROLE_PERMISSIONS.manager, c.transport);
    await e3.send('de nuevo', [img]);
    expect(String(lastResponse(c.requests[1]).error)).toMatch(/ya está guardada en Facturas/);
    expect(await db.invoices.count()).toBe(1);
  });

  it('una factura cuya mercadería ya entró se marca sin sumar al stock', async () => {
    const { aceite } = await seed();
    const { saveInvoice, deleteInvoice } = await import('../../src/services/invoiceService');
    const { markAlreadyInStock, undoInvoiceStock } = await import('../../src/services/invoiceStock');
    const inv = await saveInvoice({ date: '2026-10-17', pages: [{ id: 'pgx', image: { ...img, type: 'image/jpeg' as const, width: 1, height: 1, bytes: 6 } }], items: [{ id: 'i1', description: 'ACEITE', quantity: 2, productId: aceite.id, stockQty: 24, status: 'ok' }] });
    await markAlreadyInStock(inv.id);
    const marked = await db.invoices.get(inv.id);
    expect(marked).toMatchObject({ stockElsewhere: true, stockMovementIds: [] });
    expect((await db.products.get(aceite.id))?.stock).toBe(0);
    await undoInvoiceStock(inv.id);
    expect((await db.invoices.get(inv.id))?.stockElsewhere).toBeUndefined();
    await markAlreadyInStock(inv.id);
    await deleteInvoice(inv.id); // marcada (sin stock propio): se puede borrar
    expect(await db.invoices.count()).toBe(0);
  });
});
