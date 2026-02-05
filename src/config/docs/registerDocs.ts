import { Express, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import { buildOpenApiSpec } from "./openapi";
import { getDocsEnv } from "./env";
import { buildDocsGuard } from "../../middlewares/apiDocsGuard";

export function registerApiDocs(app: Express): boolean {
  const env = getDocsEnv();

  if (!env.enabled) {
    return false;
  }

  const guard = buildDocsGuard();
  const spec = buildOpenApiSpec();

  app.get(env.specPath, guard, (req: Request, res: Response) => {
    res.json(spec);
  });

  app.get("/docs-json", guard, (req: Request, res: Response) => {
    res.json(spec);
  });

  app.use(env.path, guard, swaggerUi.serve, swaggerUi.setup(spec));

  return true;
}
