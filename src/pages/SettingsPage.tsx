import { lazyPage } from '../utils/lazyPage';
import {
  ArrowDown, ArrowLeft, ArrowUp, Boxes, Building2, ChevronRight, Cloud, Copy, Download, Eye, EyeOff, ImageUp, LayoutGrid, Package, Palette, Plug,
  RefreshCw, RotateCcw, ShieldCheck, ShoppingCart, Smartphone, Stethoscope, UserCog, type LucideIcon,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useParams } from 'react-router';
import { CURRENT_DB_VERSION, db } from '../database/db';
import type { MenuItemSetting, ModuleKey, Settings, ThemeMode } from '../models';
import {
  DEFAULT_NAV_BOTTOM, DEFAULT_NAV_TOP, MAX_NAV_BOTTOM, MODULES, defaultMenu, defaultSettings, updateSettings,
} from '../services/settingsService';
import { imageFileToLogo } from '../pwa/logoIcon';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { Logo } from '../components/Logo';
import { CommitInput, Field, NumberInput, PageHeader, Segmented, StatusBadge } from '../components/ui';
import { readableInk } from '../utils/color';
import { WipeDataSection } from '../components/WipeDataSection';
import { MODULE_ICON, MODULE_PATH, navLabel } from '../layouts/modules';
import { useCloud } from '../cloud/cloudService';
import { useIntegration, useOnline, usePendingJobs } from '../hooks/useData';
import { syncView } from '../components/SyncBadge';
import { fmtDateTime } from '../utils/format';
import { useSession } from '../store/session';

const UsersPage = lazyPage(() => import('./UsersPage'), 'UsersPage');
const CloudPage = lazyPage(() => import('./CloudPage'), 'CloudPage');
const IntegrationsPage = lazyPage(() => import('./IntegrationsPage'), 'IntegrationsPage');
const ExportPage = lazyPage(() => import('./ExportPage'), 'ExportPage');

const EMOJIS = ['📦', '🏪', '🍽️', '🍔', '🍕', '☕', '🍺', '🥩', '🥬', '🐟', '🧊', '🧴', '🛒', '🏨', '🏭', '🔧'];
const COLORS = ['#0e6b67', '#145a7a', '#2e7d57', '#56682c', '#9a610a', '#b84e27', '#9c3346', '#5a4a8a', '#22282b', '#4f46e5'];

interface Section {
  key: string;
  group: GroupKey;
  title: string;
  description: string;
  icon: LucideIcon;
  render: () => ReactNode;
}

type GroupKey = 'negocio' | 'inventario' | 'personas' | 'sistema';
const GROUPS: { key: GroupKey; title: string; description: string }[] = [
  { key: 'negocio', title: 'Tu negocio', description: 'Identidad y cómo se navega la app.' },
  { key: 'inventario', title: 'Inventario', description: 'Reglas de stock, catálogo y compras.' },
  { key: 'personas', title: 'Personas y acceso', description: 'Quién entra, con qué permisos y desde qué cuenta.' },
  { key: 'sistema', title: 'Datos y sistema', description: 'Conexiones, respaldos y estado técnico.' },
];

/** Configuración: el centro de administración, organizado por categorías. */
const SECTIONS: Section[] = [
  { key: 'empresa', group: 'negocio', title: 'Empresa y apariencia', description: 'Nombre, subtítulo, logo, colores y tema claro/oscuro.', icon: Building2, render: () => <CompanySection /> },
  { key: 'navegacion', group: 'negocio', title: 'Menú y navegación', description: 'Qué módulos se ven, su orden y nombre, y qué va en cada barra.', icon: LayoutGrid, render: () => <NavigationSection /> },
  { key: 'stock', group: 'inventario', title: 'Stock', description: 'Alertas y stock crítico; familias, unidades, ubicaciones y puntos.', icon: Boxes, render: () => <StockSection /> },
  { key: 'productos', group: 'inventario', title: 'Productos', description: 'Productos, proveedores e importación desde Excel.', icon: Package, render: () => <ProductsSection /> },
  { key: 'pedidos', group: 'inventario', title: 'Pedidos y compras', description: 'Cómo se arma el pedido sugerido y la recepción de mercadería.', icon: ShoppingCart, render: () => <OrdersSection /> },
  { key: 'usuarios', group: 'personas', title: 'Usuarios y permisos', description: 'Usuarios, roles, permisos, PIN y bloqueo automático.', icon: UserCog, render: () => <UsersPage /> },
  { key: 'nube', group: 'personas', title: 'Cuenta y nube', description: 'Sesión, espacios de trabajo, miembros, invitaciones y sincronización.', icon: Cloud, render: () => <CloudPage /> },
  { key: 'integraciones', group: 'sistema', title: 'Integraciones', description: 'Maxirest, Excel Bridge, gateway, cola y estado de conexión.', icon: Plug, render: () => <IntegrationsPage /> },
  { key: 'datos', group: 'sistema', title: 'Importar y exportar', description: 'Excel, CSV, PDF, Word, JSON, backup completo y restauración.', icon: Download, render: () => <ExportPage /> },
  { key: 'aplicacion', group: 'sistema', title: 'Aplicación', description: 'Actualizaciones, datos del dispositivo, restablecer y borrar datos.', icon: Smartphone, render: () => <AppSection /> },
  { key: 'diagnostico', group: 'sistema', title: 'Diagnóstico', description: 'Estado del sistema, de Firebase y de la sincronización; versión.', icon: Stethoscope, render: () => <DiagnosticsSection /> },
];

export function SettingsPage() {
  const { section } = useParams();
  const current = SECTIONS.find((s) => s.key === section);

  if (!current) {
    return (
      <>
        <PageHeader title="Configuración" subtitle="Todo lo que se configura en la app, en un solo lugar." />
        <div className="settings-groups">
          {GROUPS.map((g) => (
            <section key={g.key} className="settings-group" aria-labelledby={`grupo-${g.key}`}>
              <header className="settings-group-head">
                <h2 id={`grupo-${g.key}`}>{g.title}</h2>
                <p>{g.description}</p>
              </header>
              <div className="card settings-group-list">
                {SECTIONS.filter((s) => s.group === g.key).map((s) => (
                  <Link key={s.key} to={`/configuracion/${s.key}`} className="settings-row">
                    <span className="settings-card-icon"><s.icon size={19} aria-hidden /></span>
                    <span className="grow">
                      <span className="settings-card-title">{s.title}</span>
                      <span className="settings-card-desc">{s.description}</span>
                    </span>
                    <ChevronRight size={18} className="muted" aria-hidden />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="settings-layout">
      <nav className="settings-nav card" aria-label="Secciones de configuración">
        {GROUPS.map((g) => (
          <div key={g.key} className="settings-nav-group">
            <div className="settings-nav-title">{g.title}</div>
            {SECTIONS.filter((s) => s.group === g.key).map((s) => (
              <NavLink key={s.key} to={`/configuracion/${s.key}`} className="settings-nav-link">
                <s.icon size={17} aria-hidden /> {s.title}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="settings-content">
        <Link to="/configuracion" className="btn btn-ghost btn-sm settings-back"><ArrowLeft size={16} aria-hidden /> Configuración</Link>
        <Suspense fallback={<p className="muted" aria-busy="true">Cargando…</p>}>{current.render()}</Suspense>
      </div>
    </div>
  );
}

function useSave() {
  const { run } = useFeedback();
  /** Los cambios se guardan al instante (los textos, al salir del campo). */
  return (patch: Partial<Settings>) => void run(() => updateSettings(patch));
}

function LinkCards({ items }: { items: { to: string; title: string; description: string; icon: LucideIcon }[] }) {
  return (
    <div className="settings-links">
      {items.map((i) => (
        <Link key={i.to} to={i.to} className="card settings-card">
          <span className="settings-card-icon"><i.icon size={20} aria-hidden /></span>
          <span className="grow">
            <span className="settings-card-title">{i.title}</span>
            <span className="settings-card-desc">{i.description}</span>
          </span>
          <ChevronRight size={18} className="muted" aria-hidden />
        </Link>
      ))}
    </div>
  );
}

const moduleLink = (settings: Settings, key: ModuleKey, description: string) => ({ to: MODULE_PATH[key], title: navLabel(settings, key), description, icon: MODULE_ICON[key] });

// ───────────────────────── Empresa y apariencia ─────────────────────────

function CompanySection() {
  const form = useSettings();
  const save = useSave();
  const { run } = useFeedback();
  const fileRef = useRef<HTMLInputElement>(null);
  const onLogoFile = async (f: File) => {
    const value = await run(() => imageFileToLogo(f));
    if (value) save({ logo: { kind: 'image', value } });
  };
  const lowContrast = readableInk(form.primaryColor) === '#111111';
  return (
    <>
      <PageHeader title="Empresa y apariencia" />
      <div className="stack">
        <section className="card card-pad stack" aria-labelledby="neg">
          <h2 id="neg">Empresa</h2>
          <div className="form-grid cols-2">
            <Field label="Nombre del negocio">
              <CommitInput value={form.businessName} maxLength={60} onCommit={(v) => save({ businessName: v.trim() || 'Stock Manager' })} />
            </Field>
            <Field label="Subtítulo">
              <CommitInput value={form.subtitle} maxLength={80} onCommit={(v) => save({ subtitle: v.trim() })} />
            </Field>
          </div>
        </section>

        <section className="card card-pad stack" aria-labelledby="logo">
          <h2 id="logo">Logo e ícono</h2>
          <div className="row wrap">
            <Logo size={56} />
            <Segmented label="Tipo de logo" value={form.logo.kind} onChange={(kind) => save({ logo: kind === 'default' ? { kind } : { kind, value: kind === form.logo.kind ? form.logo.value : kind === 'emoji' ? '📦' : form.logo.value } })}
              options={[{ value: 'default', label: 'Predeterminado' }, { value: 'emoji', label: 'Emoji' }, { value: 'image', label: 'Imagen' }]} />
          </div>
          {form.logo.kind === 'emoji' && (
            <div className="emoji-grid" role="group" aria-label="Elegir emoji">
              {EMOJIS.map((e) => <button key={e} type="button" aria-pressed={form.logo.value === e} aria-label={`Emoji ${e}`} onClick={() => save({ logo: { kind: 'emoji', value: e } })}>{e}</button>)}
            </div>
          )}
          {form.logo.kind === 'image' && (
            <div className="row">
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}><ImageUp size={18} aria-hidden /> Subir imagen</button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden aria-label="Imagen del logo" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onLogoFile(f); }} />
              <span className="small muted">Se recorta en cuadrado y se guarda en este dispositivo.</span>
            </div>
          )}
          <p className="small muted">El logo se muestra en el encabezado y como ícono al “Agregar a inicio” en iPhone. En Android y en la computadora, el ícono de instalación es el de la app (la estantería).</p>
        </section>

        <section className="card card-pad stack" aria-labelledby="tema">
          <h2 id="tema" className="row"><Palette size={18} aria-hidden /> Colores y tema</h2>
          <Segmented<ThemeMode> label="Tema" value={form.theme} onChange={(theme) => save({ theme })} options={[{ value: 'light', label: 'Claro' }, { value: 'dark', label: 'Oscuro' }, { value: 'system', label: 'Automático' }]} />
          <div className="form-grid cols-2">
            <Field label="Color principal">
              <div className="row wrap">
                <input type="color" className="color-input" aria-label="Color principal personalizado" value={form.primaryColor} onChange={(e) => save({ primaryColor: e.target.value })} />
                {COLORS.map((c) => <button key={c} type="button" aria-label={`Usar color ${c}`} onClick={() => save({ primaryColor: c })} style={{ width: 30, height: 30, borderRadius: 8, background: c, border: form.primaryColor === c ? '3px solid var(--text)' : '1px solid var(--border)', cursor: 'pointer' }} />)}
              </div>
            </Field>
            <Field label="Color secundario">
              <input type="color" className="color-input" aria-label="Color secundario" value={form.secondaryColor} onChange={(e) => save({ secondaryColor: e.target.value })} />
            </Field>
          </div>
          {lowContrast && <p className="small muted">Color claro: el texto sobre botones se mostrará oscuro para mantener el contraste.</p>}
        </section>
      </div>
    </>
  );
}

// ───────────────────────── Menú y navegación ─────────────────────────

function NavigationSection() {
  const form = useSettings();
  const save = useSave();
  const moveMenu = (idx: number, dir: -1 | 1) => {
    const menu = [...form.menu];
    const j = idx + dir;
    if (j < 0 || j >= menu.length) return;
    [menu[idx], menu[j]] = [menu[j], menu[idx]];
    save({ menu });
  };
  const patchMenu = (idx: number, patch: Partial<MenuItemSetting>) => save({ menu: form.menu.map((m, i) => (i === idx ? { ...m, ...patch } : m)) });
  const bottom = form.navBottom ?? [];
  const toggleBottom = (k: ModuleKey) => {
    if (bottom.includes(k)) return save({ navBottom: bottom.filter((x) => x !== k) });
    if (bottom.length >= MAX_NAV_BOTTOM) return;
    // Se guardan en el orden del menú.
    const order = form.menu.map((m) => m.key);
    save({ navBottom: [...bottom, k].sort((a, b) => order.indexOf(a) - order.indexOf(b)) });
  };

  return (
    <>
      <PageHeader title="Menú y navegación" />
      <div className="stack">
        <section className="card card-pad stack" aria-labelledby="menu">
          <div className="row between wrap">
            <h2 id="menu">Módulos</h2>
            <button type="button" className="btn btn-sm" onClick={() => save({ menu: defaultMenu(), navTop: [...DEFAULT_NAV_TOP], navBottom: [...DEFAULT_NAV_BOTTOM] })}><RotateCcw size={14} aria-hidden /> Restablecer</button>
          </div>
          <p className="small muted">Cambiá nombres (p. ej. “Stock” → “Inventario”, “Pedidos” → “Compras”), el orden y qué módulos se muestran. En la computadora, los módulos se agrupan en secciones en la barra lateral, con pestañas arriba. En el celular, marcá cuáles van fijos en la barra de abajo (hasta {MAX_NAV_BOTTOM}); el resto queda en “Más”.</p>
          <div className="nav-config">
            <div className="nav-config-head" aria-hidden>
              <span>Nombre</span><span>Visible</span><span>Barra celular</span><span>Orden</span>
            </div>
            {form.menu.map((m, i) => {
              const locked = MODULES.find((x) => x.key === m.key)?.locked;
              const isSettings = m.key === 'settings';
              return (
                <div key={m.key} className="nav-config-row">
                  <CommitInput aria-label={`Nombre del menú ${m.key}`} value={m.label} onCommit={(v) => patchMenu(i, { label: v.trim() || MODULES.find((x) => x.key === m.key)!.label })} />
                  <button type="button" className="btn btn-ghost icon-btn" aria-label={m.visible ? `Ocultar ${m.label}` : `Mostrar ${m.label}`} disabled={locked} onClick={() => patchMenu(i, { visible: !m.visible })}>
                    {m.visible ? <Eye size={18} /> : <EyeOff size={18} />}
                  </button>
                  <label className="check nav-config-check">
                    <input type="checkbox" checked={bottom.includes(m.key)} disabled={!m.visible || isSettings || (!bottom.includes(m.key) && bottom.length >= MAX_NAV_BOTTOM)} onChange={() => toggleBottom(m.key)} aria-label={`${m.label} en la barra del celular`} />
                    <span className="nav-config-mobile-label">Celular</span>
                  </label>
                  <span className="row" style={{ gap: 2 }}>
                    <button type="button" className="btn btn-ghost icon-btn" aria-label={`Subir ${m.label}`} disabled={i === 0} onClick={() => moveMenu(i, -1)}><ArrowUp size={18} /></button>
                    <button type="button" className="btn btn-ghost icon-btn" aria-label={`Bajar ${m.label}`} disabled={i === form.menu.length - 1} onClick={() => moveMenu(i, 1)}><ArrowDown size={18} /></button>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="small muted">Configuración siempre está abajo en la barra lateral (computadora) y en “Más” (celular).</p>
        </section>
      </div>
    </>
  );
}

// ───────────────────────── Stock / Productos / Pedidos ─────────────────────────

function StockSection() {
  const form = useSettings();
  const save = useSave();
  return (
    <>
      <PageHeader title="Stock" />
      <div className="stack">
        <section className="card card-pad stack" aria-labelledby="alertas">
          <h2 id="alertas">Alertas y stock crítico</h2>
          <div className="form-grid cols-2">
            <Field label="Umbral crítico" hint="% del stock mínimo">
              <NumberInput value={Math.round(form.criticalRatio * 100)} min={0} max={100} onChange={(v) => v !== undefined && save({ criticalRatio: Math.min(100, Math.max(0, v)) / 100 })} />
            </Field>
          </div>
          <div className="row wrap small muted">
            <StatusBadge status="normal" /> <StatusBadge status="bajo" /> hasta el mínimo <StatusBadge status="critico" /> hasta el {Math.round(form.criticalRatio * 100)}% del mínimo <StatusBadge status="sin_stock" />
          </div>
          <p className="small muted">El stock mínimo y máximo se define en cada producto.</p>
        </section>
        <section className="stack" aria-label="Catálogos de stock">
          <h2 className="settings-subtitle">Catálogos</h2>
          <LinkCards items={[
            moduleLink(form, 'categories', 'Familias o categorías para agrupar productos.'),
            moduleLink(form, 'units', 'Unidades de stock y de compra (kg, litro, caja…).'),
            moduleLink(form, 'locations', 'Ubicaciones y depósitos dentro del negocio.'),
            { to: '/remitos?tab=puntos', title: 'Puntos de venta', description: 'Puntos que reciben remitos del Depósito Central.', icon: MODULE_ICON.transfers },
            moduleLink(form, 'reconciliation', 'Comparar el stock con Maxirest u otro sistema.'),
          ]} />
        </section>
      </div>
    </>
  );
}

function ProductsSection() {
  const form = useSettings();
  return (
    <>
      <PageHeader title="Productos" />
      <div className="stack">
        <LinkCards items={[
          moduleLink(form, 'products', 'Alta y edición: código/SKU, familia, unidad de stock, unidad de compra y equivalencia, proveedor, mínimo y máximo.'),
          moduleLink(form, 'suppliers', 'Proveedores con sus datos de contacto.'),
          { to: '/configuracion/datos', title: 'Importar productos desde Excel', description: 'Crear o actualizar productos en bloque (sin tocar el stock).', icon: Download },
        ]} />
        <p className="small muted">La equivalencia entre unidad de compra y de stock (p. ej. 1 caja = 12 unidades) se define en cada producto.</p>
      </div>
    </>
  );
}

function OrdersSection() {
  const form = useSettings();
  const save = useSave();
  return (
    <>
      <PageHeader title="Pedidos y compras" />
      <div className="stack">
        <section className="card card-pad stack" aria-labelledby="sugerido">
          <h2 id="sugerido">Pedido sugerido</h2>
          <Field label="Pedido sugerido">
            <Segmented label="Pedido sugerido" value={form.suggestionMode} onChange={(suggestionMode) => save({ suggestionMode })} options={[{ value: 'toMax', label: 'Completar hasta el máximo' }, { value: 'toMin', label: 'Hasta el mínimo' }]} />
          </Field>
          <p className="small muted">Define cuánto propone pedir la app para cada producto con stock bajo.</p>
        </section>
        <section className="card card-pad stack">
          <h2>Recepción de mercadería</h2>
          <p className="small muted">Al recibir un pedido, cada cantidad recibida se suma al stock convertida a la unidad de stock del producto, y queda registrada como ingreso a nombre de quien recibe. Se pueden hacer recepciones parciales.</p>
        </section>
        <LinkCards items={[moduleLink(form, 'orders', 'Pedidos a proveedores: crear, enviar y recibir.'), moduleLink(form, 'invoices', 'Facturas de proveedores con sus fotos.')]} />
      </div>
    </>
  );
}

// ───────────────────────── Aplicación ─────────────────────────

function AppSection() {
  const { run, notify, confirm } = useFeedback();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null)), []);

  const checkUpdate = async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return notify('La actualización automática no está activa en este navegador.');
    await reg.update();
    notify(reg.waiting || reg.installing ? 'Hay una versión nueva: tocá “Actualizar” en el aviso.' : 'Ya tenés la última versión.');
  };

  const resetConfig = async () => {
    const ok = await confirm({
      title: 'Restablecer configuración',
      message: <p>Vuelven a los valores de fábrica los colores, el tema, el menú, la navegación, las alertas y el bloqueo automático. <b>No</b> se tocan el nombre, el logo ni los datos.</p>,
      confirmLabel: 'Restablecer',
    });
    if (!ok) return;
    const d = defaultSettings();
    await run(() => updateSettings({
      theme: d.theme, primaryColor: d.primaryColor, secondaryColor: d.secondaryColor, menu: d.menu, navTop: d.navTop, navBottom: d.navBottom,
      criticalRatio: d.criticalRatio, suggestionMode: d.suggestionMode, autoLockMinutes: d.autoLockMinutes,
    }), 'Configuración restablecida');
  };

  return (
    <>
      <PageHeader title="Aplicación" />
      <div className="stack">
        <section className="card card-pad stack" aria-labelledby="act">
          <h2 id="act" className="row"><RefreshCw size={18} aria-hidden /> Actualizaciones</h2>
          <p className="small muted">La app se actualiza sola: cuando hay una versión nueva aparece un aviso para aplicarla. Funciona sin Internet gracias al service worker.</p>
          <div><button type="button" className="btn btn-sm" onClick={() => run(checkUpdate)}>Buscar actualización</button></div>
        </section>

        <section className="card card-pad stack" aria-labelledby="datos">
          <h2 id="datos" className="row"><ShieldCheck size={18} aria-hidden /> Datos en este dispositivo</h2>
          <dl className="kv">
            <dt>Versión</dt><dd>{__APP_VERSION__}</dd>
            <dt>Base de datos</dt><dd>IndexedDB v{CURRENT_DB_VERSION}</dd>
            <dt>Almacenamiento persistente</dt><dd>{persisted === null ? 'No informado por el navegador' : persisted ? 'Sí (el navegador no lo borrará automáticamente)' : 'No garantizado'}</dd>
          </dl>
          {persisted === false && (
            <div><button type="button" className="btn btn-sm" onClick={async () => { const ok = await navigator.storage.persist(); setPersisted(ok); notify(ok ? 'Almacenamiento persistente activado' : 'El navegador no lo concedió. Instalar la app como PWA suele habilitarlo.'); }}>Pedir almacenamiento persistente</button></div>
          )}
          <p className="small muted">Los datos se guardan en este dispositivo y funcionan sin Internet. Si la app está vinculada a la nube, también quedan en la nube. Hacé copias de seguridad periódicas desde “Importar y exportar”.</p>
        </section>

        <section className="card card-pad stack" aria-labelledby="reset">
          <h2 id="reset" className="row"><RotateCcw size={18} aria-hidden /> Restablecer configuración</h2>
          <p className="small muted">Vuelve la apariencia, el menú y las preferencias a los valores de fábrica, sin borrar datos.</p>
          <div><button type="button" className="btn btn-sm" onClick={() => void resetConfig()}>Restablecer configuración</button></div>
        </section>

        <WipeDataSection />
      </div>
    </>
  );
}

// ───────────────────────── Diagnóstico ─────────────────────────

function DiagnosticsSection() {
  const cloud = useCloud();
  const online = useOnline();
  const integration = useIntegration();
  const pendingJobs = usePendingJobs();
  const { user } = useSession();
  const { notify } = useFeedback();
  const counts = useLiveQuery(async () => ({
    products: await db.products.count(),
    movements: await db.movements.count(),
    users: await db.users.count(),
    tombstones: await db.tombstones.where('pushed').equals(0).count(),
  }), []);
  const [storage, setStorage] = useState('—');
  const [sw, setSw] = useState('—');
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => e.usage != null && setStorage(`${(e.usage / 1024 / 1024).toFixed(1)} MB de ${((e.quota ?? 0) / 1024 / 1024 / 1024).toFixed(1)} GB`)).catch(() => undefined);
    void navigator.serviceWorker?.getRegistration().then((r) => setSw(r ? (r.active ? 'Activo' : 'Instalándose') : 'No registrado')).catch(() => setSw('No disponible'));
  }, []);
  const view = syncView(cloud, online);
  const rows: [string, string][] = [
    ['Versión', `Stock Manager v${__APP_VERSION__}`],
    ['Base de datos local', `IndexedDB v${CURRENT_DB_VERSION}`],
    ['Conexión a Internet', online ? 'En línea' : 'Sin conexión'],
    ['Nube (Firebase)', cloud.provider === 'firebase' ? 'Configurada' : cloud.provider === 'fake' ? 'Simulada (pruebas)' : cloud.phase === 'loading' ? 'Cargando…' : 'No configurada'],
    ['Sesión', cloud.user ? `${cloud.user.email}${cloud.user.emailVerified === false ? ' (email sin verificar)' : ''}` : 'Sin sesión'],
    ['Espacio de trabajo', cloud.workspace ? `${cloud.workspace.name} · creado ${fmtDateTime(cloud.workspace.createdAt)}` : '—'],
    ['Sincronización', view.label],
    ['Última sincronización', fmtDateTime(cloud.status.lastSyncAt)],
    ['Cambios por enviar', String(cloud.status.pending)],
    ['Borrados por enviar', String(counts?.tombstones ?? '—')],
    ['Integración Maxirest', integration ? `${integration.mode} · ${integration.status}` : '—'],
    ['Movimientos pendientes con Maxirest', String(pendingJobs)],
    ['Usuario actual', user ? `${user.name} (${user.role})` : '—'],
    ['Productos / movimientos / usuarios', counts ? `${counts.products} / ${counts.movements} / ${counts.users}` : '—'],
    ['Service worker', sw],
    ['Instalada como app', matchMedia('(display-mode: standalone)').matches ? 'Sí' : 'No'],
    ['Espacio usado', storage],
    ['Navegador', navigator.userAgent],
  ];
  if (cloud.status.error) rows.push(['Último error de sincronización', cloud.status.error]);
  if (cloud.error) rows.push(['Último error de la nube', cloud.error]);
  const copy = async () => {
    await navigator.clipboard.writeText(rows.map(([k, v]) => `${k}: ${v}`).join('\n'));
    notify('Diagnóstico copiado');
  };
  return (
    <>
      <PageHeader title="Diagnóstico" subtitle="Estado del sistema para revisar problemas." actions={<button type="button" className="btn" onClick={() => void copy()}><Copy size={18} aria-hidden /> Copiar</button>} />
      <section className="card card-pad">
        <dl className="kv diag">
          {rows.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </section>
    </>
  );
}
