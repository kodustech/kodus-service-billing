import NodeCache from 'node-cache';

// Cache com TTL de 15 minutos (em segundos)
export const cache = new NodeCache({
  stdTTL: 15 * 60,
  checkperiod: 60,
}); 