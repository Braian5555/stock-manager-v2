import { Camera, CameraOff, Keyboard } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { validateBarcode } from '../../utils/barcode';
import { Modal } from '../ui/Modal';
import { startCamera, type CameraSession } from './camera';

type CamState = 'idle' | 'starting' | 'on' | 'error';

const finePointer = typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;

/**
 * Lector de códigos: cámara (nativa o alternativa compatible con iPhone) o carga manual.
 * El permiso de cámara se pide recién al tocar "Activar cámara" (o solo, si ya estaba concedido).
 * Un lector USB/Bluetooth funciona como teclado: escribe en el campo y manda Enter.
 */
export function ScannerModal({ open, title = 'Escanear código', onClose, onCode }: { open: boolean; title?: string; onClose: () => void; onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const session = useRef<CameraSession | null>(null);
  const [cam, setCam] = useState<CamState>('idle');
  const [camError, setCamError] = useState('');
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState('');
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const stop = () => {
    session.current?.stop();
    session.current = null;
  };

  const start = async () => {
    if (!videoRef.current || session.current) return;
    setCam('starting');
    setCamError('');
    try {
      session.current = await startCamera(videoRef.current, (code) => {
        stop();
        setCam('idle');
        navigator.vibrate?.(60);
        onCodeRef.current(code);
      });
      setCam('on');
    } catch (e) {
      stop();
      setCam('error');
      setCamError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (!open) return;
    setManual('');
    setManualError('');
    setCam('idle');
    setCamError('');
    let alive = true;
    // Si el permiso ya estaba concedido, la cámara arranca sola; si no, se espera al toque.
    const perms = navigator.permissions as Permissions | undefined;
    perms
      ?.query({ name: 'camera' as PermissionName })
      .then((s) => { if (alive && s.state === 'granted') void start(); })
      .catch(() => undefined);
    return () => {
      alive = false;
      stop();
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- arrancar/parar sólo al abrir/cerrar

  const submitManual = () => {
    const check = validateBarcode(manual);
    if (!check.ok) return setManualError(check.error ?? 'Código no válido.');
    stop();
    onCode(check.code);
  };

  return (
    <Modal open={open} title={title} onClose={() => { stop(); onClose(); }}>
      <div className="stack">
        <div className={`scanner-view ${cam === 'on' ? 'on' : ''}`}>
          <video ref={videoRef} playsInline muted autoPlay aria-label="Vista de la cámara" />
          {cam === 'on' && <div className="scanner-frame" aria-hidden />}
          {cam !== 'on' && (
            <div className="scanner-idle">
              {cam === 'error' ? <CameraOff size={32} aria-hidden /> : <Camera size={32} aria-hidden />}
              {cam === 'error' ? <p className="small">{camError}</p> : <p className="small">Apuntá al código de barras con la cámara.</p>}
              <button type="button" className="btn btn-primary" onClick={start} disabled={cam === 'starting'}>
                {cam === 'starting' ? 'Abriendo cámara…' : cam === 'error' ? 'Reintentar' : 'Activar cámara'}
              </button>
            </div>
          )}
        </div>
        {cam === 'on' && <p className="small muted" role="status">Buscando un código… Acercá o alejá el teléfono hasta que se vea nítido.</p>}

        <form className="scanner-manual" onSubmit={(e) => { e.preventDefault(); submitManual(); }}>
          <label className="small" htmlFor="scan-manual" style={{ fontWeight: 600 }}><Keyboard size={14} aria-hidden /> O escribí el código</label>
          <div className="row">
            <input
              id="scan-manual"
              className="input grow"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              value={manual}
              onChange={(e) => { setManual(e.target.value); setManualError(''); }}
              placeholder="Ej.: 7790001234567"
              aria-label="Código de barras"
              aria-invalid={!!manualError}
              // En compu (lector USB o teclado) el foco va directo al campo; en el teléfono no, para no tapar la cámara con el teclado.
              data-autofocus={finePointer ? '' : undefined}
            />
            <button type="submit" className="btn">Buscar</button>
          </div>
          {manualError && <p className="small" style={{ color: 'var(--out)' }} role="alert">{manualError}</p>}
        </form>
      </div>
    </Modal>
  );
}
