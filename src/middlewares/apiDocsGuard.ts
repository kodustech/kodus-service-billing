import { Request, Response, NextFunction } from "express";
import { getDocsEnv } from "../config/docs/env";
import { parseBasicAuth } from "../config/docs/access";

function getAuthHeader(req: Request): string | undefined {
  const value = req.headers.authorization;
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export function buildDocsGuard() {
  const { basicUser, basicPass } = getDocsEnv();

  return (req: Request, res: Response, next: NextFunction) => {
    if (!basicUser || !basicPass) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const authHeader = getAuthHeader(req);
    const creds = parseBasicAuth(authHeader);
    if (!creds || creds.user !== basicUser || creds.pass !== basicPass) {
      res.setHeader("WWW-Authenticate", "Basic");
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    return next();
  };
}
