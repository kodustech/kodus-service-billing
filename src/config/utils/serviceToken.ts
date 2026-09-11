import * as crypto from "crypto";
import { NextFunction, Request, Response } from "express";

/**
 * Service-to-service auth for the prepaid-credit routes.
 *
 * WHY only these routes: this service has never authenticated its callers —
 * every route takes the organizationId from the request and trusts it. That
 * was survivable while the payload was subscription state; `/credits/*` adds
 * MONEY (a balance, a full financial ledger, a Stripe checkout, a debit), so
 * an unauthenticated caller that can reach the service could read another
 * org's spend or charge it. Kody flagged exactly this on PR #51.
 *
 * The shape mirrors the one that already exists in the other direction:
 * billing → API webhooks carry `x-kodus-signature` and the API REFUSES them
 * when `API_BILLING_WEBHOOK_SECRET` is unset (fails closed, loudly). This is
 * the same contract inbound: a shared secret in a header, compared in
 * constant time, and no secret configured means no credit route answers.
 *
 * Callers that must send it: the API's metering sweep (`/credits/debit`) and
 * the web's SERVER-side billing fetches (the browser proxy denies
 * `/credits/*` outright, so no browser ever needs this header).
 */
export const SERVICE_TOKEN_HEADER = "x-kodus-service-token";
export const SERVICE_TOKEN_ENV = "CREDITS_SERVICE_TOKEN";

/** Constant-time compare of two secrets of any length. */
function matches(provided: string, expected: string): boolean {
  const a = crypto.createHash("sha256").update(provided).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * Express middleware: require the shared service token. Fails CLOSED — an
 * unconfigured secret answers 500, never "open for everyone".
 */
export function requireServiceToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const expected = (process.env[SERVICE_TOKEN_ENV] ?? "").trim();
  if (!expected) {
    console.error(
      `${SERVICE_TOKEN_ENV} is not configured — refusing credit routes. ` +
        `Set it here and on every caller (API + web) to enable prepaid credits.`,
    );
    res.status(500).json({ error: "CREDITS_SERVICE_TOKEN not configured" });
    return;
  }

  const provided = req.header(SERVICE_TOKEN_HEADER);
  if (!provided || !matches(provided, expected)) {
    console.warn(
      `Rejected a credit request without a valid ${SERVICE_TOKEN_HEADER}: ` +
        `${req.method} ${req.path}`,
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
