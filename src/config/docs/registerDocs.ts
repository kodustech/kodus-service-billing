import { Express, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import rateLimit from "express-rate-limit";
import { buildOpenApiSpec } from "./openapi";
import { getDocsEnv } from "./env";
import { buildDocsGuard } from "../../middlewares/apiDocsGuard";

const docsRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // max 1000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

export function registerApiDocs(app: Express): boolean {
  const env = getDocsEnv();

  if (!env.enabled) {
    return false;
  }

  const guard = buildDocsGuard();
  const spec = buildOpenApiSpec();

  app.get(env.specPath, docsRateLimiter, guard, (req: Request, res: Response) => {
    res.json(spec);
  });

  app.get("/docs-json", docsRateLimiter, guard, (req: Request, res: Response) => {
    res.json(spec);
  });

  app.use(env.path, docsRateLimiter, guard, swaggerUi.serve, swaggerUi.setup(spec));

  return true;
}
