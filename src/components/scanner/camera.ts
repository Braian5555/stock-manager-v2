/**
 * Cámara + detección de códigos. Usa el detector nativo del navegador (Chrome/Android) si
 * soporta los formatos; si no (iPhone/Safari, Firefox), carga ZXing recién en ese momento.
 */

export interface CameraSession {
  stop: () => void;
}

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

interface NativeDetector {
  detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}
interface NativeDetectorCtor {
  new (opts: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

async function nativeDetector(): Promise<NativeDetector | null> {
  const Ctor = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? [];
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    if (!formats.includes('ean_13') || !formats.includes('code_128')) return null;
    return new Ctor({ formats });
  } catch {
    return null;
  }
}

/** Mensaje claro según el error de getUserMedia. */
export function cameraErrorMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'No hay permiso para usar la cámara. Habilitalo en los ajustes del navegador para este sitio, o escribí el código abajo.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No se encontró una cámara en este dispositivo. Escribí el código abajo.';
  if (name === 'NotReadableError') return 'La cámara está siendo usada por otra app. Cerrala y reintentá, o escribí el código abajo.';
  return 'No se pudo abrir la cámara. Escribí el código abajo.';
}

export async function startCamera(video: HTMLVideoElement, onCode: (code: string) => void): Promise<CameraSession> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara. Escribí el código abajo.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (e) {
    throw new Error(cameraErrorMessage(e), { cause: e });
  }
  let stopped = false;
  const cleanups: (() => void)[] = [() => stream.getTracks().forEach((t) => t.stop()), () => { video.srcObject = null; }];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cleanups.forEach((fn) => fn());
  };
  const found = (code: string) => {
    if (stopped || !code) return;
    stop();
    onCode(code);
  };

  try {
    video.srcObject = stream;
    video.setAttribute('playsinline', ''); // iOS: sin esto abre el video a pantalla completa
    await video.play().catch(() => undefined);

    const native = await nativeDetector();
    if (native) {
      let busy = false;
      const timer = window.setInterval(async () => {
        if (busy || stopped || video.readyState < 2) return;
        busy = true;
        try {
          const codes = await native.detect(video);
          if (codes[0]?.rawValue) found(codes[0].rawValue);
        } catch {
          /* cuadro ilegible: se sigue intentando */
        } finally {
          busy = false;
        }
      }, 180);
      cleanups.unshift(() => clearInterval(timer));
    } else {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
      if (stopped) return { stop };
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
      const controls = await reader.decodeFromStream(stream, video, (result) => {
        if (result) found(result.getText());
      });
      if (stopped) controls.stop();
      else cleanups.unshift(() => controls.stop());
    }
  } catch (e) {
    stop();
    throw e instanceof Error ? e : new Error(String(e));
  }
  return { stop };
}
