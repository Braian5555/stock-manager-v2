import { fmtNumber } from './format';

export interface OrderTextLine { name: string; quantity: number; unit: string }

/** Texto del pedido para mandar por WhatsApp o copiar. */
export function orderText(opts: { number?: number; supplier?: string; business?: string; lines: OrderTextLine[]; notes?: string }): string {
  const head = [`Pedido${opts.number ? ` #${opts.number}` : ''}${opts.supplier ? ` — ${opts.supplier}` : ''}`, opts.business && `De: ${opts.business}`];
  const body = opts.lines.map((l) => `• ${l.name}: ${fmtNumber(l.quantity)} ${l.unit}`.trim());
  const tail = opts.notes ? ['', `Obs.: ${opts.notes}`] : [];
  return [...head.filter((x): x is string => !!x), '', ...body, ...tail].join('\n');
}

/**
 * Link de WhatsApp con el texto ya escrito. Con teléfono abre el chat del proveedor;
 * sin teléfono, WhatsApp deja elegir el contacto.
 */
export function whatsappUrl(text: string, phone?: string): string {
  let digits = (phone ?? '').replace(/\D/g, '');
  // Números argentinos sin código de país: se agrega 54 9.
  if (digits && digits.length <= 11 && !digits.startsWith('54')) digits = `549${digits.replace(/^0/, '').replace(/^15/, '')}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
