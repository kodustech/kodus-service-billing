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
 * remains an OPTIONAL second accepted secret for anyone who wants to rotate
 * or separate keys — BOTH are accepted, so a deployment that set the
 * dedicated variable in the previous release cannot silently reject callers
 * that (correctly) sign with the shared one.
 *
 * WHAT IS SIGNED — `METHOD\n/path\n<canonical query>\n<timestamp>\n<body>`:
 *   · the METHOD and PATH, so a signature captured from a balance read cannot
 *     be replayed against the debit route;
 *   · the CANONICAL QUERY (params sorted, re-encoded), because the GET/DELETE
 *     credit routes read `organizationId`/`teamId` from the query string —
 *     without it, one leaked signature would read or mutate ANY org, which is
 *     exactly the cross-tenant access this middleware exists to stop;
 *   · a TIMESTAMP, checked against a 5-minute window, so a signature that
 *     leaks into an access log or a trace stops working instead of being
 *     valid forever;
 *   · the RAW BODY BYTES as received (captured by the parsers' `verify`
 *     hook), for every method, never a re-serialization of the parsed object —
 *     those differ on pretty-printed JSON, `\uXXXX` escapes or `1e2`-style
 *     numbers, and the result would be a 401 no log explains. No body signs
 *     the empty string.
 *
 * The secret itself never crosses the wire, so reusing the webhook secret
 * cannot leak it into a proxy trace. Same header as the outbound direction
 * (`x-kodus-signature`, HMAC-SHA256).
 *
 * Callers that must sign: the API's metering sweep (`/credits/debit` via
 * AxiosLicenseService) and the web's SERVER-side billing fetches. No browser
 * ever needs this — the web proxy denies `/credits/*` outright.
 */
export const SIGNATURE_HEADER = "x-kodus-signature";
export const TIMESTAMP_HEADER = "x-kodus-timestamp";
export const SERVICE_TOKEN_ENV = "CREDITS_SERVICE_TOKEN";
export const WEBHOOK_SECRET_ENV = "KODUS_NOTIFICATION_WEBHOOK_SECRET";

/** How far a request's timestamp may be from our clock, in either direction. */
export const SIGNATURE_MAX_SKEW_MS = 5 * 60 * 1000;

/** An express body parser with the `verify` hook below stores the bytes here. */
export type RequestWithRawBody = Request & { rawBody?: string };

/**
 * `verify` hook for `express.json()` / `express.urlencoded()`: keep the exact
 * bytes so the signature is checked over the message that was received.
 */
export function captureRawBody(
  req: Request,
  _res: Response,
  buf: Buffer,
): void {
  if (buf?.length) (req as RequestWithRawBody).rawBody = buf.toString("utf8");
}

/**
 * Every secret a caller may legitimately sign with: the shared webhook secret
 * and, when configured, the dedicated one. Both are accepted — see the header
 * comment. Returns them de-duplicated, in a stable order.
 */
export function acceptedSecrets(): string[] {
  const dedicated = (process.env[SERVICE_TOKEN_ENV] ?? "").trim();
  const webhook = (process.env[WEBHOOK_SECRET_ENV] ?? "").trim();
  return [...new Set([dedicated, webhook].filter(Boolean))];
}

/** The secret THIS service signs with when it calls someone else. */
export function serviceSecret(): string {
  return acceptedSecrets()[0] ?? "";
}

let secretSourceLogged = false;

/** Say once, at the first credit request, which secrets are in play. */
function logSecretSource(): void {
  if (secretSourceLogged) return;
  secretSourceLogged = true;
  const dedicated = (process.env[SERVICE_TOKEN_ENV] ?? "").trim();
  const webhook = (process.env[WEBHOOK_SECRET_ENV] ?? "").trim();
  if (dedicated && webhook) {
    console.warn(
      `Credit routes accept BOTH ${SERVICE_TOKEN_ENV} and ${WEBHOOK_SECRET_ENV}. ` +
        `The shared webhook secret is the contract; unset ${SERVICE_TOKEN_ENV} ` +
        `once no caller signs with it.`,
    );
  } else {
    console.log(
      `Credit routes authenticated with ${
        dedicated ? SERVICE_TOKEN_ENV : WEBHOOK_SECRET_ENV
      }.`,
    );
  }
}

/**
 * The query string as both sides agree to see it: params sorted by name and
 * re-encoded, so a proxy that reorders or re-escapes them cannot cause a 401,
 * while changing a VALUE (another org's id) invalidates the signature.
 */
export function canonicalQuery(queryString: string): string {
  const params = new URLSearchParams(queryString ?? "");
  params.sort();
  return params.toString();
}

/** What a caller signs: method, path, query, timestamp and the body bytes. */
export function signaturePayload(
  method: string,
  path: string,
  queryString: string,
  timestamp: string,
  rawBody: string,
): string {
  return [
    method.toUpperCase(),
    path,
    canonicalQuery(queryString),
    timestamp,
    rawBody,
  ].join("\n");
}

export function sign(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function matches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
  const secrets = acceptedSecrets();
  if (secrets.length === 0) {
    console.error(
      `Neither ${SERVICE_TOKEN_ENV} nor ${WEBHOOK_SECRET_ENV} is configured — ` +
        `refusing credit routes. Set the webhook secret (already required for ` +
        `outbound notifications) to enable prepaid credits.`,
    );
    res.status(500).json({ error: "Service secret not configured" });
    return;
  }
  logSecretSource();

  const provided = req.header(SIGNATURE_HEADER);
  if (!provided) {
    console.warn(
      `Rejected a credit request with no ${SIGNATURE_HEADER}: ${req.method} ${req.path}`,
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Freshness first: a signature that leaked into a log or a trace must stop
  // working, and the check is cheap.
  const timestamp = (req.header(TIMESTAMP_HEADER) ?? "").trim();
  const timestampMs = Number(timestamp);
  if (
    !timestamp ||
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > SIGNATURE_MAX_SKEW_MS
  ) {
    console.warn(
      `Rejected a credit request with a missing or stale ${TIMESTAMP_HEADER} ` +
        `(${timestamp || "absent"}): ${req.method} ${req.path}`,
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // `req.path` here is relative to the router mount (/api/billing), so sign
  // the full originalUrl path — the caller knows only the full URL. The query
  // is signed too (canonicalized): these routes read the tenant from it.
  // Split on the FIRST "?" only: a query value may contain a literal "?" (an
  // unencoded return URL, say), and a plain `split("?")` would verify a
  // truncated query while the caller signed the whole one.
  const target = req.originalUrl || req.url;
  const mark = target.indexOf("?");
  const fullPath = mark === -1 ? target : target.slice(0, mark);
  const queryString = mark === -1 ? "" : target.slice(mark + 1);
  // Whatever bytes arrived, for EVERY method. Skipping the body on DELETE
  // left a DELETE payload outside the signature, so a captured signature
  // would validate a swapped body — and a caller that followed the documented
  // rule and signed its DELETE body got a 401. A request with no body signs
  // the empty string, which is what GET always does anyway.
  const rawBody = (req as RequestWithRawBody).rawBody ?? "";
  const payload = signaturePayload(
    req.method,
    fullPath,
    queryString,
    timestamp,
    rawBody,
  );

  if (!secrets.some((secret) => matches(provided, sign(secret, payload)))) {
    console.warn(
      `Rejected a credit request with an invalid ${SIGNATURE_HEADER}: ` +
        `${req.method} ${fullPath}`,
    );
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
