import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { db } from '../database/db';
import type { Settings } from '../models';
import { DEFAULT_PRIMARY, defaultSettings, normalizeSettings, SETTINGS_ID } from '../services/settingsService';
import { isHexColor, readableInk } from '../utils/color';
import { renderLogoPng } from '../pwa/logoIcon';

const Ctx = createContext<Settings>(defaultSettings());

export function SettingsProvider({ children }: { children: ReactNode }) {
  const stored = useLiveQuery(() => db.settings.get(SETTINGS_ID), []);
  const settings = normalizeSettings(stored);

  // Tema y colores
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
      // La barra del sistema acompaña al encabezado grafito.
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101416' : '#22282b');
    };
    apply();
    const primary = isHexColor(settings.primaryColor) ? settings.primaryColor : DEFAULT_PRIMARY;
    root.style.setProperty('--primary', primary);
    root.style.setProperty('--primary-ink', readableInk(primary));
    if (isHexColor(settings.secondaryColor)) root.style.setProperty('--secondary', settings.secondaryColor);
    document.title = settings.businessName || 'Stock Manager';
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme, settings.primaryColor, settings.secondaryColor, settings.businessName]);

  // Favicon e icono de inicio (iOS usa apple-touch-icon al "Agregar a inicio")
  useEffect(() => {
    let cancelled = false;
    const setIcons = (href: string | null) => {
      const fav = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      const apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
      if (!fav || !apple) return;
      fav.dataset.default ??= fav.href;
      apple.dataset.default ??= apple.href;
      fav.href = href ?? fav.dataset.default;
      apple.href = href ?? apple.dataset.default;
    };
    if (settings.logo.kind === 'default' || !settings.logo.value) setIcons(null);
    else
      renderLogoPng(settings.logo, settings.primaryColor)
        .then((png) => !cancelled && setIcons(png))
        .catch(() => setIcons(null));
    return () => {
      cancelled = true;
    };
  }, [settings.logo, settings.primaryColor]);

  return <Ctx.Provider value={settings}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);
