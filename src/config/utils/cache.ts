import NodeCache from 'node-cache';

// Cache com TTL de 15 minutos (em segundos)
export const cache = new NodeCache({
  stdTTL: 15 * 60,
  checkperiod: 60,
});

// Função para limpar o cache baseado em um prefixo de chave
export const clearCacheByPrefix = (prefix: string): void => {
  const keys = cache.keys();
  keys.forEach(key => {
    if (key.startsWith(`${prefix}:`)) {
      cache.del(key);
    }
  });
}; 