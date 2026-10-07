import type { Integration } from '../models';
import type { IntegrationAdapter } from './core/types';
import { MaxirestGatewayAdapter } from './maxirest/MaxirestGatewayAdapter';
import { MockMaxirestAdapter } from './mock/MockMaxirestAdapter';

let mock: MockMaxirestAdapter | undefined;
const gateways = new Map<string, MaxirestGatewayAdapter>();

export function getMockAdapter(): MockMaxirestAdapter {
  mock ??= new MockMaxirestAdapter();
  return mock;
}

/**
 * Devuelve el adaptador activo, o null en modo independiente / Excel / desconectado.
 * La app funciona igual sin adaptador.
 */
export function getAdapter(integration: Integration | undefined): IntegrationAdapter | null {
  if (!integration || integration.status === 'desconectado') return null;
  if (integration.mode === 'mock') return getMockAdapter();
  if (integration.mode === 'gateway') {
    const key = integration.gatewayUrl ?? '';
    if (!gateways.has(key)) gateways.set(key, new MaxirestGatewayAdapter(integration.gatewayUrl));
    return gateways.get(key)!;
  }
  return null;
}
