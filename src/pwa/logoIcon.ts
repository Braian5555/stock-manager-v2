import type { Settings } from '../models';

/** Dibuja el logo (emoji o imagen) en un PNG 180×180 para favicon / apple-touch-icon. */
export async function renderLogoPng(logo: Settings['logo'], bg: string): Promise<string> {
  const size = 180;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  if (logo.kind === 'emoji' && logo.value) {
    ctx.font = `${size * 0.62}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(logo.value, size / 2, size / 2 + size * 0.04);
  } else if (logo.kind === 'image' && logo.value) {
    const img = new Image();
    img.src = logo.value;
    await img.decode();
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  }
  return canvas.toDataURL('image/png');
}

/** Reduce una imagen subida a un PNG cuadrado chico (para guardar en IndexedDB). */
export async function imageFileToLogo(file: File, size = 256): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) throw new Error('Formato de imagen no compatible.');
  if (file.size > 5 * 1024 * 1024) throw new Error('La imagen supera los 5 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
