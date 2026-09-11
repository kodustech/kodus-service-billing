import * as crypto from "crypto";
import { NextFunction, Request, Response } from "express";

/**
 * Service-to-service auth for the prepaid-credit routes.
 *
 * WHY only these routes: this service has never authenticated its callers —
 * every route takes the organizationId from the request and trusts it. The
 * tenant's `Authorization` header is sent by the web but NEVER read here, so
 * it authenticated nothing. That was survivable while the payload was
 * subscription state; `/credits/*` adds MONEY (a balance, a full financial
 * ledger, a Stripe checkout, a debit), so anything able to reach this service
 * could read another org's spend or charge it. Kody flagged it on PR #51.
 *
 * WHY THE SAME SECRET AS THE WEBHOOKS: billing → API webhooks are already
 * signed with a shared secret both sides hold (`KODUS_NOTIFICATION_WEBHOOK_SECRET`
 * here, `API_BILLING_WEBHOOK_SECRET` on kodus-ai — the same value by
 * contract). That secret IS the "these two deployments know each other"
 * material, so the inbound direction reuses it instead of inventing a second
 * one for ops to set, forget, and work around. `CREDITS_SERVICE_TOKEN`
 * remains as an OPTIONAL override for anyone who wants key separation.
 *
 * WHY A SIGNATURE INSTEAD OF THE RAW SECRET: the same primitive and the same
 * header as the outbound direction (`x-kodus-signature`, HMAC-SHA256). The
 * secret never crosses the wire, so reusing it cannot leak it into an access
 * log or a proxy trace. The signed payload is `METHOD\n/path\n<body>`, so a
 * signature captured from a balance read cannot be replayed against a debit.
 *
 * Callers that must sign: the API's metering sweep (`/credits/debit` via
 * AxiosLicenseService) and the web's SERVER-side billing fetches. No browser
 * ever needs this — the web proxy denies `/credits/*` outright.
 */
export const SIGNATURE_HEADER = "x-kodus-signature";
export const SERVICE_TOKEN_ENV = "CREDITS_SERVICE_TOKEN";
export const WEBHOOK_SECRET_ENV = "KODUS_NOTIFICATION_WEBHOOK_SECRET";

/** The shared secret: the dedicated one when set, else the webhook secret. */
export function serviceSecret(): string {
  return (
    (process.env[SERVICE_TOKEN_ENV] ?? "").trim() ||
    (process.env[WEBHOOK_SECRET_ENV] ?? "").trim()
  );
}

/** What a caller signs: method, path and the exact body bytes. */
export function signaturePayload(
  method: string,
  path: string,
  rawBody: string,
): string {
  return `${method.toUpperCase()}\n${path}\n${rawBody}`;
}

export function sign(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Express middleware: require a valid signature on the credit routes. Fails
 * CLOSED — no secret configured answers 500, never "open for everyone".
 */
export function requireServiceToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const secret = serviceSecret();
  if (!secret) {
    console.error(
      `Neither ${SERVICE_TOKEN_ENV} nor ${WEBHOOK_SECRET_ENV} is configured — ` +
        `refusing credit routes. Set the webhook secret (already required for ` +
        `outbound notifications) to enable prepaid credits.`,
    );
    res.status(500).json({ error: "Service secret not configured" });
    return;
  }

  const provided = req.header(SIGNATURE_HEADER);
  if (!provided) {
    console.warn(
      `Rejected a credit request with no ${SIGNATURE_HEADER}: ${req.method} ${req.path}`,
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // `req.path` here is relative to the router mount (/api/billing), so sign
  // the full originalUrl path — the caller knows only the full URL. Query
  // strings are excluded: they carry the ids the body carries, and including
  // them would break on any proxy that reorders params.
  const fullPath = (req.originalUrl || req.url).split("?")[0];
  const rawBody =
    req.method === "GET" || req.method === "DELETE"
      ? ""
      : JSON.stringify(req.body ?? {});
  const expected = sign(secret, signaturePayload(req.method, fullPath, rawBody));

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.warn(
      `Rejected a credit request with an invalid ${SIGNATURE_HEADER}: ` +
        `${req.method} ${fullPath}`,
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
