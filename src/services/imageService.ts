/**
 * Compresión de fotos en el navegador (sin librerías ni servidores).
 * Las fotos de facturas se achican a JPEG para que:
 *  - entren en un documento de Firestore (límite 1 MiB, el base64 suma ~33%),
 *  - se suban rápido desde el celular y no gasten la cuota gratuita.
 */

export interface CompressedImage {
  /** JPEG en base64, sin el prefijo "data:image/jpeg;base64,". */
  data: string;
  type: 'image/jpeg';
  width: number;
  height: number;
  bytes: number;
  /** Miniatura chica para listados (data URL completa). */
  thumb: string;
}

/** Tamaño máximo de una foto ya comprimida (en bytes, antes de base64). */
export const MAX_IMAGE_BYTES = 650_000;
const MAX_SIDE = 2000;
const THUMB_SIDE = 220;

export const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

async function loadBitmap(file: Blob): Promise<{ img: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      // imageOrientation: respeta la rotación EXIF de las fotos del celular.
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { img: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // Formatos que createImageBitmap no soporta (p. ej. HEIC en algunos navegadores): se prueba con <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const el = new Image();
    el.decoding = 'async';
    el.src = url;
    await el.decode();
    return { img: el, width: el.naturalWidth, height: el.naturalHeight, close: () => undefined };
  } catch {
    throw new Error('No se pudo leer la imagen. Probá con una foto en JPG o PNG.');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function draw(src: CanvasImageSource, w: number, h: number, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; // PNG con transparencia → fondo blanco
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

const toB64 = (c: HTMLCanvasElement, q: number) => c.toDataURL('image/jpeg', q).split(',')[1] ?? '';

/** Achica y comprime una foto. Baja calidad y tamaño hasta que entre en MAX_IMAGE_BYTES. */
export async function compressImage(file: Blob): Promise<CompressedImage> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
  const { img, width, height, close } = await loadBitmap(file);
  try {
    let side = MAX_SIDE;
    let canvas = draw(img, width, height, side);
    let quality = 0.78;
    let data = toB64(canvas, quality);
    while (base64Bytes(data) > MAX_IMAGE_BYTES) {
      if (quality > 0.5) quality -= 0.1;
      else {
        side = Math.round(side * 0.8);
        if (side < 600) throw new Error('La foto es demasiado pesada.');
        canvas = draw(img, width, height, side);
      }
      data = toB64(canvas, quality);
    }
    const thumb = draw(img, width, height, THUMB_SIDE).toDataURL('image/jpeg', 0.6);
    return { data, type: 'image/jpeg', width: canvas.width, height: canvas.height, bytes: base64Bytes(data), thumb };
  } finally {
    close();
  }
}

/** base64 → Blob (para descargar o mostrar). */
export function base64ToBlob(data: string, type = 'image/jpeg'): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
