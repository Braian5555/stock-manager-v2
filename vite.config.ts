/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * La app se publica en https://braian5555.github.io/stock-manager/
 * Toda ruta (JS, CSS, manifest, service worker, iconos) se resuelve contra BASE.
 * Se puede sobrescribir con VITE_BASE_PATH (por ejemplo "/" para un dominio propio).
 */
const BASE = process.env.VITE_BASE_PATH ?? '/stock-manager/';

export default defineConfig({
  base: BASE,
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? pkg.version) },
  plugins: [
    react(),
    VitePWA({
      // "prompt": la nueva versión se descarga, pero sólo se activa cuando el usuario
      // acepta "Actualizar". Nunca queda un SW viejo sirviendo archivos para siempre.
      registerType: 'prompt',
      injectRegister: false,
      // En desarrollo no hay service worker: evita cachés que rompan las pruebas.
      devOptions: { enabled: false },
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifestFilename: 'manifest.webmanifest',
      manifest: {
        id: BASE,
        name: 'Stock Manager',
        short_name: 'Stock',
        description: 'Inventario, stock, conteos, proveedores y pedidos. Funciona sin conexión.',
        lang: 'es',
        dir: 'ltr',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'any',
        background_color: '#f6f7f9',
        theme_color: '#4f46e5',
        categories: ['business', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache versionado por hash de contenido: cada build genera nuevas revisiones.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        // Dependencias opcionales de jsPDF (render de HTML/SVG) que la app nunca usa:
        // no se precachean para no descargar ~650 KB innecesarios al instalar.
        globIgnores: ['**/html2canvas-*.js', '**/purify.es-*.js', '**/index.es-*.js'],
        cleanupOutdatedCaches: true,
        // Fallback de navegación SOLO para documentos HTML dentro del scope.
        navigateFallback: 'index.html',
        // /__/ son las rutas reservadas de Firebase Hosting (inicio de sesión con Google: /__/auth/handler
        // y /__/auth/iframe). Si el service worker las contesta con index.html, el login nunca termina.
        navigateFallbackDenylist: [/\/[^/?]+\.[^/]+$/, /^\/__\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        clientsClaim: false,
        skipWaiting: false,
      },
    }),
  ],
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
