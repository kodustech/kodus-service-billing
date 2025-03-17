import { Request, Response, NextFunction } from 'express';
import { cache } from '../config/utils/cache';

interface CacheOptions {
  ttl?: number; // tempo em segundos
  keyPrefix?: string;
}

export const cacheMiddleware = (options: CacheOptions = {}) => {
  const { ttl, keyPrefix = '' } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Gera uma chave única baseada no método, url e parâmetros
    const key = `${keyPrefix}:${req.method}:${req.originalUrl}`;
    
    // Tenta obter do cache
    const cachedData = cache.get(key);
    if (cachedData) {
      res.json(cachedData);
      return;
    }

    // Intercepta o método json original
    const originalJson = res.json;
    res.json = function (data) {
      // Armazena no cache antes de enviar a resposta
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(key, data, ttl);
      }
      return originalJson.call(this, data);
    };

    next();
  };
}; 