import { ArrowDown, ArrowUp, Eye, EyeOff, ImageUp, Palette, RotateCcw, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CURRENT_DB_VERSION } from '../database/db';
import type { MenuItemSetting, Settings, ThemeMode } from '../models';
import { defaultMenu, MODULES, updateSettings } from '../services/settingsService';
import { imageFileToLogo } from '../pwa/logoIcon';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { Logo } from '../components/Logo';
import { CommitInput, Field, NumberInput, PageHeader, Segmented } from '../components/ui';
import { readableInk } from '../utils/color';
import { WipeDataSection } from '../components/WipeDataSection';

const EMOJIS = ['📦', '🏪', '🍽️', '🍔', '🍕', '☕', '🍺', '🥩', '🥬', '🐟', '🧊', '🧴', '🛒', '🏨', '🏭', '🔧'];
const COLORS = ['#4f46e5', '#2563eb', '#0891b2', '#059669', '#65a30d', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#334155'];

export function SettingsPage() {
  const settings = useSettings();
  const { run, notify } = useFeedback();
  const form = settings;
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null)), []);

  /** Los cambios se guardan al instante (los textos, al salir del campo). */
  const save = (patch: Partial<Settings>) => void run(() => updateSettings(patch));

  const moveMenu = (idx: number, dir: -1 | 1) => {
    const menu = [...form.menu];
    const j = idx + dir;
    if (j < 0 || j >= menu.length) return;
    [menu[idx], menu[j]] = [menu[j], menu[idx]];
    save({ menu });
  };
  const patchMenu = (idx: number, patch: Partial<MenuItemSetting>) => save({ menu: form.menu.map((m, i) => (i === idx ? { ...m, ...patch } : m)) });

  const onLogoFile = async (f: File) => {
    const value = await run(() => imageFileToLogo(f));
    if (value) save({ logo: { kind: 'image', value } });
  };

  const lowContrast = readableInk(form.primaryColor) === '#111111';

  return (
    <>
      <PageHeader title="Configuración" />
      <div className="stack">
        <section className="card card-pad stack" aria-labelledby="neg">
          <h2 id="neg">Negocio</h2>
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
          <h2 id="logo">Logo</h2>
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
          <p className="small muted">El logo se muestra en el encabezado, el menú y como icono al “Agregar a inicio” en iPhone. En Android/escritorio el icono de instalación es el predeterminado de la app.</p>
        </section>

        <section className="card card-pad stack" aria-labelledby="tema">
          <h2 id="tema" className="row"><Palette size={18} aria-hidden /> Apariencia</h2>
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

        <section className="card card-pad stack" aria-labelledby="menu">
          <div className="row between"><h2 id="menu">Menú</h2><button type="button" className="btn btn-sm" onClick={() => save({ menu: defaultMenu() })}><RotateCcw size={14} aria-hidden /> Restablecer</button></div>
          <p className="small muted">Cambiá nombres (p. ej. “Stock” → “Inventario”, “Pedidos” → “Compras”), el orden y qué módulos se muestran.</p>
          <div className="list">
            {form.menu.map((m, i) => {
              const locked = MODULES.find((x) => x.key === m.key)?.locked;
              return (
                <div key={m.key} className="list-item" style={{ padding: '8px 0' }}>
                  <CommitInput aria-label={`Nombre del menú ${m.key}`} value={m.label} onCommit={(v) => patchMenu(i, { label: v.trim() || MODULES.find((x) => x.key === m.key)!.label })} />
                  <button type="button" className="btn btn-ghost icon-btn" aria-label={m.visible ? `Ocultar ${m.label}` : `Mostrar ${m.label}`} disabled={locked} onClick={() => patchMenu(i, { visible: !m.visible })}>
                    {m.visible ? <Eye size={18} /> : <EyeOff size={18} />}
                  </button>
                  <button type="button" className="btn btn-ghost icon-btn" aria-label={`Subir ${m.label}`} disabled={i === 0} onClick={() => moveMenu(i, -1)}><ArrowUp size={18} /></button>
                  <button type="button" className="btn btn-ghost icon-btn" aria-label={`Bajar ${m.label}`} disabled={i === form.menu.length - 1} onClick={() => moveMenu(i, 1)}><ArrowDown size={18} /></button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="card card-pad stack" aria-labelledby="alertas">
          <h2 id="alertas">Alertas y pedido sugerido</h2>
          <div className="form-grid cols-2">
            <Field label="Umbral crítico" hint="% del stock mínimo">
              <NumberInput value={Math.round(form.criticalRatio * 100)} min={0} max={100} onChange={(v) => v !== undefined && save({ criticalRatio: Math.min(100, Math.max(0, v)) / 100 })} />
            </Field>
            <Field label="Pedido sugerido">
              <Segmented label="Pedido sugerido" value={form.suggestionMode} onChange={(suggestionMode) => save({ suggestionMode })} options={[{ value: 'toMax', label: 'Completar hasta el máximo' }, { value: 'toMin', label: 'Hasta el mínimo' }]} />
            </Field>
          </div>
          <p className="small muted">🟢 Normal · 🟡 Bajo (≤ mínimo) · 🟠 Crítico (≤ {Math.round(form.criticalRatio * 100)}% del mínimo) · 🔴 Sin stock</p>
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
          <p className="small muted">Los datos se guardan sólo en este dispositivo y funcionan sin Internet. Hacé copias de seguridad periódicas desde “Exportar y backup”.</p>
        </section>

        <WipeDataSection />
      </div>
    </>
  );
}
