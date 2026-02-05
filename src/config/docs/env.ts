export type DocsEnv = {
  enabled: boolean;
  path: string;
  specPath: string;
  allowlist: string;
  basicUser: string;
  basicPass: string;
  serverUrls: string;
  baseUrl: string;
};

export function getDocsEnv(): DocsEnv {
  return {
    enabled: process.env.API_DOCS_ENABLED === "true",
    path: process.env.API_DOCS_PATH || "/docs",
    specPath: process.env.API_DOCS_SPEC_PATH || "/openapi.json",
    allowlist: process.env.API_DOCS_IP_ALLOWLIST || "",
    basicUser: process.env.API_DOCS_BASIC_USER || "",
    basicPass: process.env.API_DOCS_BASIC_PASS || "",
    serverUrls: process.env.API_DOCS_SERVER_URLS || "",
    baseUrl: process.env.API_DOCS_BASE_URL || "",
  };
}
