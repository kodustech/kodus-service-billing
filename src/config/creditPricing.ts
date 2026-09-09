/**
 * Prepaid-credit commercial parameters ("Kodus as the provider").
 *
 * The customer loads credits in USD; Kodus charges the amount PLUS a markup
 * at checkout (`$100` of credit costs `$107` at 7%). The ledger itself stays
 * in list-price USD — every debit is the upstream provider's list price for
 * the tokens used, no markup — so what the customer sees on the ledger is
 * exactly what the model cost.
 *
 * Everything here is env-driven so pricing changes are a config change, not
 * a deploy. Parsed once at module load; invalid values fall back to defaults.
 */

const num = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

/** Percentage added on top of the credit amount at checkout. */
export const CREDITS_MARKUP_PCT = Math.max(
  0,
  num(process.env.CREDITS_MARKUP_PCT, 7),
);

/** Balance at or below which the low-balance webhook fires (USD). */
export const CREDITS_LOW_THRESHOLD_USD = Math.max(
  0,
  num(process.env.CREDITS_LOW_THRESHOLD_USD, 5),
);

/** Credit amounts (USD) offered as one-click packs. */
export const CREDIT_PACKS_USD: number[] = (
  process.env.CREDIT_PACKS_USD || "20,50,100,500"
)
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

/** Bounds for a custom (non-pack) amount. */
export const CREDITS_MIN_PURCHASE_USD = Math.max(
  1,
  num(process.env.CREDITS_MIN_PURCHASE_USD, 10),
);
export const CREDITS_MAX_PURCHASE_USD = Math.max(
  CREDITS_MIN_PURCHASE_USD,
  num(process.env.CREDITS_MAX_PURCHASE_USD, 5000),
);

/** What the customer pays (USD, 2 decimals) for `creditUsd` of credit. */
export const chargeForCredit = (creditUsd: number): number =>
  Math.round(creditUsd * (1 + CREDITS_MARKUP_PCT / 100) * 100) / 100;

/** Round a ledger amount to the column's 6-decimal precision. */
export const roundUsd = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;
