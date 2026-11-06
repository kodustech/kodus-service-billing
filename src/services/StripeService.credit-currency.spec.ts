import "reflect-metadata";

/**
 * Credits are sold as units of ONE multi-currency Stripe Price (one unit =
 * US$1 of credit, markup included): USD by default, with a BRL currency
 * option. The account is Brazilian, so a customer already billed in BRL
 * cannot be charged in USD, and Adaptive Pricing does not apply. These pin:
 *
 *   · which currency a Checkout is pinned to (customer's, or none = localize);
 *   · that the quantity IS the credit amount, with no inline price_data;
 *   · what an auto top-up charges, per currency, read from the Price;
 *   · that a missing currency option or a missing Price id never charges;
 *   · that the webhook credits `creditUsd` whatever currency was presented.
 *
 * Stripe is fully mocked: nothing here reaches the API.
 */
const PRICE_ID = "price_credits_test";

const mockStripe = {
  checkoutCreate: jest.fn(),
  customersRetrieve: jest.fn(),
  customersCreate: jest.fn(),
  customersUpdate: jest.fn(),
  pricesRetrieve: jest.fn(),
  paymentIntentsCreate: jest.fn(),
  paymentIntentsRetrieve: jest.fn(),
  paymentMethodsRetrieve: jest.fn(),
};

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: mockStripe.checkoutCreate } },
    customers: {
      retrieve: mockStripe.customersRetrieve,
      create: mockStripe.customersCreate,
      update: mockStripe.customersUpdate,
    },
    prices: { retrieve: mockStripe.pricesRetrieve },
    paymentIntents: {
      create: mockStripe.paymentIntentsCreate,
      retrieve: mockStripe.paymentIntentsRetrieve,
    },
    paymentMethods: { retrieve: mockStripe.paymentMethodsRetrieve },
  })),
);

const mockLicenseRepo = {
  findOne: jest.fn(),
  save: jest.fn(async (x: unknown) => x),
  update: jest.fn(),
};
jest.mock("../repositories/OrganizationLicenseRepository", () => ({
  OrganizationLicenseRepository: mockLicenseRepo,
}));
jest.mock("../config/utils/cache", () => ({ clearCacheByPrefix: jest.fn() }));
jest.mock("./KodusNotificationClient", () => ({
  KodusNotificationClient: { notifyCreditsLow: jest.fn() },
}));
const mockApplyPurchase = jest.fn();
jest.mock("./CreditService", () => ({
  CreditService: { applyPurchase: mockApplyPurchase },
}));
const mockAttachPaymentMethod = jest.fn();
jest.mock("./AutoTopUpService", () => ({
  AutoTopUpService: { attachPaymentMethod: mockAttachPaymentMethod },
}));

import {
  CreditCurrencyNotSupportedError,
  StripeService,
  creditUnitAmount,
} from "./StripeService";
import { CreditsPriceNotConfiguredError } from "../config/creditPricing";

/** USD 1.07 default (US$1 + 7%), BRL option R$5.82. */
const creditPrice = () => ({
  id: PRICE_ID,
  object: "price",
  currency: "usd",
  unit_amount: 107,
  unit_amount_decimal: "107",
  currency_options: {
    usd: { unit_amount: 107, unit_amount_decimal: "107" },
    brl: { unit_amount: 582, unit_amount_decimal: "582" },
  },
});

const license = (over: Record<string, unknown> = {}) => ({
  id: "lic-1",
  organizationId: "org-1",
  teamId: "team-1",
  stripeCustomerId: "cus_1",
  ...over,
});

const customer = (over: Record<string, unknown> = {}) => ({
  id: "cus_1",
  object: "customer",
  currency: null,
  metadata: {},
  ...over,
});

beforeAll(() => {
  process.env.FRONTEND_URL = "https://app.example.test";
});

beforeEach(() => {
  for (const fn of Object.values(mockStripe)) fn.mockReset();
  mockLicenseRepo.findOne.mockReset();
  mockLicenseRepo.update.mockReset().mockResolvedValue({ affected: 1 });
  mockApplyPurchase.mockReset();
  mockAttachPaymentMethod.mockReset();
  process.env.STRIPE_CREDITS_PRICE_ID = PRICE_ID;
  StripeService.resetCreditsPriceCache();
  mockStripe.checkoutCreate.mockResolvedValue({
    url: "https://checkout.stripe.com/c/pay/cs_test_1",
  });
  mockStripe.pricesRetrieve.mockResolvedValue(creditPrice());
  mockStripe.paymentIntentsCreate.mockResolvedValue({
    id: "pi_1",
    status: "succeeded",
  });
});

describe("credit Checkout — currency selection", () => {
  it("pins a BRL customer to BRL, so Stripe uses the Price's BRL option", async () => {
    mockLicenseRepo.findOne.mockResolvedValue(license());
    mockStripe.customersRetrieve.mockResolvedValue(
      customer({ currency: "brl" }),
    );

    await StripeService.createCreditCheckoutSession("org-1", "team-1", 50);

    const [args] = mockStripe.checkoutCreate.mock.calls[0];
    expect(args.currency).toBe("brl");
    expect(args.customer).toBe("cus_1");
    expect(args.metadata.requestedCurrency).toBe("brl");
  });

  it("pins a USD customer to USD", async () => {
    mockLicenseRepo.findOne.mockResolvedValue(license());
    mockStripe.customersRetrieve.mockResolvedValue(
      customer({ currency: "usd" }),
    );

    await StripeService.createCreditCheckoutSession("org-1", "team-1", 50);

    const [args] = mockStripe.checkoutCreate.mock.calls[0];
    expect(args.currency).toBe("usd");
  });

  it("lets Checkout localize for a new customer (no Stripe customer yet)", async () => {
    mockLicenseRepo.findOne.mockResolvedValue(
      license({ stripeCustomerId: null }),
    );

    await StripeService.createCreditCheckoutSession("org-1", "team-1", 50);

    const [args] = mockStripe.checkoutCreate.mock.calls[0];
    expect(args).not.toHaveProperty("currency");
    expect(args.customer_creation).toBe("always");
    expect(args.metadata.requestedCurrency).toBe("auto");
    expect(mockStripe.customersRetrieve).not.toHaveBeenCalled();
  });

  it("lets Checkout localize for an existing customer with no currency yet", async () => {
    mockLicenseRepo.findOne.mockResolvedValue(license());
    mockStripe.customersRetrieve.mockResolvedValue(customer());

    await StripeService.createCreditCheckoutSession("org-1", "team-1", 50);

    const [args] = mockStripe.checkoutCreate.mock.calls[0];
    expect(args).not.toHaveProperty("currency");
    expect(args.customer).toBe("cus_1");
  });

  it("keeps a credit-only customer in the currency of their last purchase", async () => {
    mockLicenseRepo.findOne.mockResolvedValue(
      license({ creditCurrency: "brl" }),
    );
    mockStripe.customersRetrieve.mockResolvedValue(customer());

    await StripeService.createCreditCheckoutSession("org-1", "team-1", 50);

    expect(mockStripe.checkoutCreate.mock.calls[0][0].currency).toBe("brl");
  });

  it("refuses, before creating a session, a currency the Price is not sold in", async () => {
    mockLicenseRepo.findOne.mockResolvedValue(license());
    mockStripe.customersRetrieve.mockResolvedValue(
      customer({ currency: "eur" }),
    );

    await expect(
      StripeService.createCreditCheckoutSession("org-1", "team-1", 50),
    ).rejects.toBeInstanceOf(CreditCurrencyNotSupportedError);
    expect(mockStripe.checkoutCreate).not.toHaveBeenCalled();
  });
});

describe("credit Checkout — line items and metadata", () => {
  it("sells creditUsd units of the credit Price, with no inline price_data", async () => {
    mockLicenseRepo.findOne.mockResolvedValue(license());
    mockStripe.customersRetrieve.mockResolvedValue(customer());

    await StripeService.createCreditCheckoutSession("org-1", "team-1", 15);

    const [args] = mockStripe.checkoutCreate.mock.calls[0];
    expect(args.mode).toBe("payment");
    expect(args.line_items).toEqual([{ price: PRICE_ID, quantity: 15 }]);
    expect(JSON.stringify(args.line_items)).not.toContain("price_data");
    // The webhook credits from this metadata, whatever currency is paid.
    expect(args.metadata).toEqual(
      expect.objectContaining({
        kind: "credit_pack",
        organizationId: "org-1",
        teamId: "team-1",
        creditUsd: "15",
        chargeUsd: "16.05",
        markupPct: "7",
        priceId: PRICE_ID,
      }),
    );
    expect(args.payment_intent_data).toEqual(
      expect.objectContaining({
        setup_future_usage: "off_session",
        metadata: expect.objectContaining({
          kind: "credit_pack",
          creditUsd: "15",
        }),
      }),
    );
  });

  it("fails clearly, without calling Stripe, when STRIPE_CREDITS_PRICE_ID is missing", async () => {
    delete process.env.STRIPE_CREDITS_PRICE_ID;
    mockLicenseRepo.findOne.mockResolvedValue(license());

    await expect(
      StripeService.createCreditCheckoutSession("org-1", "team-1", 50),
    ).rejects.toBeInstanceOf(CreditsPriceNotConfiguredError);
    await expect(
      StripeService.createCreditCheckoutSession("org-1", "team-1", 50),
    ).rejects.toThrow(/STRIPE_CREDITS_PRICE_ID/);
    expect(mockStripe.checkoutCreate).not.toHaveBeenCalled();
  });
});

describe("auto top-up — charged in the customer's currency", () => {
  const request = (creditUsd = 50, over: Record<string, unknown> = {}) =>
    StripeService.autoTopUpRequest({
      license: license(over) as any,
      paymentMethodId: "pm_1",
      creditUsd,
      chargeUsd: Math.round(creditUsd * 107) / 100,
    });

  it("prices a USD customer at creditUsd × the Price's default unit amount", async () => {
    mockStripe.customersRetrieve.mockResolvedValue(
      customer({ currency: "usd" }),
    );

    const params = await request(50);

    expect(params.currency).toBe("usd");
    expect(params.amount).toBe(5350); // 50 × 107
    expect(params.metadata).toEqual(
      expect.objectContaining({
        kind: "credit_auto_topup",
        creditUsd: "50",
        priceId: PRICE_ID,
      }),
    );
    // Only builds it: the caller stores it under the key, then sends it.
    expect(mockStripe.paymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("prices a BRL customer at creditUsd × the BRL currency option", async () => {
    mockStripe.customersRetrieve.mockResolvedValue(
      customer({ currency: "brl" }),
    );

    const params = await request(50);

    expect(params.currency).toBe("brl");
    expect(params.amount).toBe(29100); // 50 × 582
  });

  it("prices a credit-only customer in the currency of their last purchase", async () => {
    // Stripe has no currency for them; the license recorded BRL when their
    // pack was paid, so their top-up is BRL 29100, not USD 5350.
    mockStripe.customersRetrieve.mockResolvedValue(customer());

    const params = await request(50, { creditCurrency: "brl" });

    expect(params.currency).toBe("brl");
    expect(params.amount).toBe(29100);
  });

  it("falls back to the Price's default currency when the customer has none", async () => {
    mockStripe.customersRetrieve.mockResolvedValue(customer());

    const params = await request(15);

    expect(params.currency).toBe("usd");
    expect(params.amount).toBe(1605);
  });

  it("refuses a currency the Price has no option for", async () => {
    mockStripe.customersRetrieve.mockResolvedValue(
      customer({ currency: "eur" }),
    );

    const err = await request(50).catch((e) => e);

    expect(err).toBeInstanceOf(CreditCurrencyNotSupportedError);
    expect(err.code).toBe("CREDIT_CURRENCY_NOT_SUPPORTED");
    expect(err.message).toContain("EUR");
  });

  it("refuses when STRIPE_CREDITS_PRICE_ID is missing", async () => {
    delete process.env.STRIPE_CREDITS_PRICE_ID;

    await expect(request(50)).rejects.toBeInstanceOf(
      CreditsPriceNotConfiguredError,
    );
  });

  it("reads the Price once, with its currency options, and caches it", async () => {
    mockStripe.customersRetrieve.mockResolvedValue(
      customer({ currency: "brl" }),
    );

    await request(50);
    await request(20);

    expect(mockStripe.pricesRetrieve).toHaveBeenCalledTimes(1);
    expect(mockStripe.pricesRetrieve).toHaveBeenCalledWith(PRICE_ID, {
      expand: ["currency_options"],
    });
  });

  it("sends a request as given, under the attempt's key", async () => {
    const params = { amount: 5350, currency: "usd" } as any;

    await StripeService.createAutoTopUpIntent(params, "auto-topup:v2:lic-1:1");

    expect(mockStripe.paymentIntentsCreate).toHaveBeenCalledWith(params, {
      idempotencyKey: "auto-topup:v2:lic-1:1",
    });
  });

  it("rebuilds a pre-Price attempt exactly as the previous version sent it", async () => {
    // Literal: Stripe compares a reused key's parameters with what it got
    // the first time, so this is the base version's request, field for field.
    const params = await StripeService.legacyAutoTopUpRequest({
      license: license() as any,
      paymentMethodId: "pm_1",
      creditUsd: 10,
      chargeUsd: 10.7,
    });

    expect(params).toEqual({
      amount: 1070,
      currency: "usd",
      customer: "cus_1",
      payment_method: "pm_1",
      off_session: true,
      confirm: true,
      description:
        "Kodus credits auto top-up — $10.00 (includes 7% platform fee)",
      metadata: {
        kind: "credit_auto_topup",
        organizationId: "org-1",
        teamId: "team-1",
        creditUsd: "10",
        chargeUsd: "10.7",
        markupPct: "7",
      },
    });
    expect(mockStripe.pricesRetrieve).not.toHaveBeenCalled();
    expect(mockStripe.customersRetrieve).not.toHaveBeenCalled();
  });
});

describe("creditUnitAmount", () => {
  it("reads the default currency from the Price and others from currency_options", () => {
    const price = creditPrice() as any;
    expect(creditUnitAmount(price, "usd")).toBe(107);
    expect(creditUnitAmount(price, "BRL")).toBe(582);
    expect(creditUnitAmount(price, "eur")).toBeNull();
  });

  it("falls back to unit_amount_decimal when unit_amount is absent", () => {
    const price = {
      currency: "usd",
      unit_amount: null,
      unit_amount_decimal: "107",
      currency_options: { brl: { unit_amount: null, unit_amount_decimal: "582.5" } },
    } as any;
    expect(creditUnitAmount(price, "usd")).toBe(107);
    expect(creditUnitAmount(price, "brl")).toBe(582.5);
  });
});

describe("webhook — a credit pack paid in BRL", () => {
  it("credits creditUsd from the metadata and records what was actually paid", async () => {
    mockLicenseRepo.findOne.mockResolvedValue(license());
    mockStripe.customersUpdate.mockResolvedValue({});
    mockStripe.paymentIntentsRetrieve.mockResolvedValue({
      id: "pi_brl",
      payment_method: "pm_brl",
    });
    mockStripe.paymentMethodsRetrieve.mockResolvedValue({
      type: "card",
      card: { brand: "visa", last4: "4242" },
    });

    await StripeService.handleWebhookEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_brl",
          payment_status: "paid",
          customer: "cus_1",
          payment_intent: "pi_brl",
          currency: "brl",
          amount_total: 29100, // 50 × R$5.82, in centavos
          metadata: {
            kind: "credit_pack",
            organizationId: "org-1",
            teamId: "team-1",
            licenseId: "lic-1",
            creditUsd: "50",
            chargeUsd: "53.5",
            markupPct: "7",
            priceId: PRICE_ID,
            requestedCurrency: "brl",
          },
        },
      },
    } as any);

    expect(mockApplyPurchase).toHaveBeenCalledWith({
      organizationId: "org-1",
      teamId: "team-1",
      creditUsd: 50,
      usageKey: "stripe:checkout:cs_brl",
      metadata: expect.objectContaining({
        stripeSessionId: "cs_brl",
        stripePaymentIntentId: "pi_brl",
        chargeUsd: 53.5,
        priceId: PRICE_ID,
        amountTotalCents: 29100,
        currency: "brl",
      }),
    });
    // Later auto top-ups for this customer stay in BRL: recorded on the
    // license, after the credit.
    expect(mockLicenseRepo.update).toHaveBeenCalledWith(
      { id: "lic-1" },
      { creditCurrency: "brl" },
    );
    expect(mockApplyPurchase.mock.invocationCallOrder[0]).toBeLessThan(
      mockLicenseRepo.update.mock.invocationCallOrder[0],
    );
    expect(mockStripe.customersUpdate).not.toHaveBeenCalled();
    expect(mockAttachPaymentMethod).toHaveBeenCalled();
  });

  it("credits the purchase, then fails the webhook if the currency cannot be recorded, so Stripe redelivers it", async () => {
    // Swallowing this left a BRL credit-only customer with no record of
    // their currency, and their next auto top-up went out in USD.
    mockLicenseRepo.findOne.mockResolvedValue(license());
    mockLicenseRepo.update.mockRejectedValue(new Error("db down"));
    mockStripe.paymentIntentsRetrieve.mockResolvedValue({
      id: "pi_brl",
      payment_method: null,
    });

    const delivered = StripeService.handleWebhookEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_brl_2",
          payment_status: "paid",
          customer: "cus_1",
          payment_intent: "pi_brl",
          currency: "brl",
          amount_total: 8730,
          metadata: {
            kind: "credit_pack",
            organizationId: "org-1",
            teamId: "team-1",
            creditUsd: "15",
          },
        },
      },
    } as any);

    await expect(delivered).rejects.toThrow("db down");
    // Credited first; the redelivery skips it as already applied (same
    // usageKey) and retries the write.
    expect(mockApplyPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ creditUsd: 15, usageKey: "stripe:checkout:cs_brl_2" }),
    );
  });
});
