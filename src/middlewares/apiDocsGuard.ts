import { Request, Response, NextFunction } from "express";
import { getDocsEnv } from "../config/docs/env";
import {
  isIpAllowed,
  parseAllowlist,
  parseBasicAuth,
} from "../config/docs/access";

function getRequestIp(req: Request): string {
  if (req.ip) return req.ip;
  if (req.socket?.remoteAddress) return req.socket.remoteAddress;
  const legacyConnection = (
    req as Request & { connection?: { remoteAddress?: string } }
  ).connection;
  if (legacyConnection?.remoteAddress) return legacyConnection.remoteAddress;
  return "";
}

function getAuthHeader(req: Request): string | undefined {
  const value = req.headers.authorization;
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export function buildDocsGuard() {
  const { allowlist, basicUser, basicPass } = getDocsEnv();
  const parsedAllowlist = parseAllowlist(allowlist);

  return (req: Request, res: Response, next: NextFunction) => {
    if (!parsedAllowlist.length) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (!basicUser || !basicPass) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const requestIp = getRequestIp(req);
    if (!requestIp || !isIpAllowed(requestIp, parsedAllowlist)) {
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
