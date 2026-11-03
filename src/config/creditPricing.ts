/**
 * Prepaid-credit commercial parameters ("Kodus as the provider").
 *
 * The customer loads credits in USD; Kodus charges the amount PLUS a markup
 * at checkout (`$100` of credit costs `$107` at 7%). The ledger itself stays
 * in list-price USD — every debit is the upstream provider's list price for
 * the tokens used, no markup — so what the customer sees on the ledger is
 * exactly what the model cost.
 *
 * What the customer PAYS comes from one multi-currency Stripe Price
 * (`STRIPE_CREDITS_PRICE_ID`): one unit = US$1 of credit, priced in USD with
 * the markup already embedded, plus a BRL currency option. The account is
 * Brazilian, so USD is not a settlement currency and Adaptive Pricing does
 * not apply; a BRL customer pays the BRL option instead. `CREDITS_MARKUP_PCT`
 * must match the markup the Price embeds: it only feeds the quote shown to
 * the UI and the purchase metadata, never the amount charged.
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

/** Credit amounts (USD) offered as one-click packs. Whole dollars only: the
 *  amount is the quantity of a US$1 Price. */
export const CREDIT_PACKS_USD: number[] = (
  process.env.CREDIT_PACKS_USD || "20,50,100,500"
)
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);

/**
 * Bounds for a custom (non-pack) amount, in whole dollars.
 *
 * The minimum is US$15 because below about US$12 a sale loses money: the
 * markup is 7% and an international card on a Brazilian Stripe account costs
 * 5.99% + R$0.39 per charge.
 */
export const CREDITS_MIN_PURCHASE_USD = Math.max(
  1,
  Math.ceil(num(process.env.CREDITS_MIN_PURCHASE_USD, 15)),
);
export const CREDITS_MAX_PURCHASE_USD = Math.max(
  CREDITS_MIN_PURCHASE_USD,
  Math.floor(num(process.env.CREDITS_MAX_PURCHASE_USD, 5000)),
);

/** Raised when a credit purchase is attempted without the Price configured. */
export class CreditsPriceNotConfiguredError extends Error {
  readonly code = "CREDITS_PRICE_NOT_CONFIGURED";
  constructor() {
    super(
      "STRIPE_CREDITS_PRICE_ID is not set: credit purchases need the " +
        "multi-currency Stripe Price for Kodus AI Credits.",
    );
    this.name = "CreditsPriceNotConfiguredError";
  }
}

/**
 * The Stripe Price sold for credits (one unit = US$1 of credit, markup
 * included, USD default with a BRL currency option). Read on every call so a
 * missing value fails the purchase that needs it, with a clear error, instead
 * of building a Checkout that Stripe would reject.
 */
export const getCreditsPriceId = (): string => {
  const id = process.env.STRIPE_CREDITS_PRICE_ID?.trim();
  if (!id) throw new CreditsPriceNotConfiguredError();
  return id;
};

/** What the customer pays (USD, 2 decimals) for `creditUsd` of credit. */
export const chargeForCredit = (creditUsd: number): number =>
  Math.round(creditUsd * (1 + CREDITS_MARKUP_PCT / 100) * 100) / 100;

/** Round a ledger amount to the column's 6-decimal precision. */
export const roundUsd = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;
