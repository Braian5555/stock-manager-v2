import { IntegrationError } from './types';

/**
 * Traduce cualquier error a un mensaje comprensible. El detalle técnico se conserva
 * aparte (SyncJob.technicalError) y nunca contiene credenciales.
 */
export function friendlyError(err: unknown, action = 'completar la operación'): { message: string; technical: string } {
  const technical = err instanceof Error ? `${err.name}: ${err.message}${err instanceof IntegrationError && err.technical ? ` (${err.technical})` : ''}` : String(err);
  if (err instanceof IntegrationError) {
    switch (err.code) {
      case 'NOT_SUPPORTED':
        return { message: `${err.message} Esta operación requiere habilitación por parte del proveedor.`, technical };
      case 'NOT_CONFIGURED':
        return { message: 'La integración no está configurada todavía.', technical };
      case 'OFFLINE':
        return { message: `Sin conexión a Internet: no fue posible ${action}. Quedó pendiente y podrá reintentarse.`, technical };
      case 'AUTH':
        return { message: 'El servicio de integración rechazó el acceso. Revisá la configuración del gateway.', technical };
      case 'VALIDATION':
        return { message: err.message, technical };
      case 'NETWORK':
      case 'SERVER':
      default:
        return { message: `No fue posible ${action}. Quedó pendiente y podrá reintentarse.`, technical };
    }
  }
  return { message: `No fue posible ${action}. Quedó pendiente y podrá reintentarse.`, technical };
}

export const isOnline = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
