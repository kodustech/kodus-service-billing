/**
 * Utilitário para construção de URLs de APIs externas
 * Considera diferentes ambientes e configurações de deployment
 */
export interface UrlBuilderOptions {
  hostname?: string;
  port?: string;
  path?: string;
  protocol?: 'http' | 'https';
}

/**
 * Detecta se estamos em ambiente de produção
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Detecta se estamos rodando em container Docker
 */
export function isDockerEnvironment(): boolean {
  return !!process.env.GLOBAL_API_CONTAINER_NAME;
}

/**
 * Constrói URL completa considerando protocolo e porta
 */
export function createApiUrl(options: UrlBuilderOptions): string {
  let { hostname, port, path = '', protocol } = options;
  
  // Auto-detectar protocolo se não fornecido
  if (!protocol) {
    protocol = isProduction() ? 'https' : 'http';
  }
  
  // Se estamos em Docker e hostname é localhost, usar nome do container
  if (isDockerEnvironment() && hostname === 'localhost') {
    hostname = process.env.GLOBAL_API_CONTAINER_NAME;
    
    // Em ambiente Docker, geralmente não precisamos de porta explícita
    if (protocol === 'http' && port === '80') port = '';
    if (protocol === 'https' && port === '443') port = '';
  }
  
  // Construir parte da porta
  const portPart = port ? `:${port}` : '';
  
  // Garantir que path comece com /
  const pathPart = path.startsWith('/') ? path : `/${path}`;
  
  return `${protocol}://${hostname}${portPart}${pathPart}`;
}

/**
 * Constrói URL para chamadas para a API de logs
 */
export function buildLogApiUrl(path: string = ''): string {
  const hostname = process.env.API_BILLING_HOSTNAME_API_ORCHESTRATOR;
  const port = process.env.API_BILLING_PORT_API_ORCHESTRATOR;
  
  if (!hostname || !port) {
    throw new Error(
      'Variáveis de ambiente API_BILLING_HOSTNAME_API_ORCHESTRATOR e API_BILLING_PORT_API_ORCHESTRATOR são obrigatórias'
    );
  }
  
  return createApiUrl({
    hostname,
    port,
    path,
  });
}

/**
 * Constrói URL parametrizada substituindo placeholders
 */
export function buildParametrizedUrl(
  urlTemplate: string,
  params: Record<string, string | number | boolean>
): string {
  let finalUrl = urlTemplate;
  
  Object.entries(params).forEach(([key, value]) => {
    finalUrl = finalUrl.replace(`:${key}`, String(value));
  });
  
  return finalUrl;
}