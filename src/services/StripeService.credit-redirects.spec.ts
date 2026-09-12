import "reflect-metadata";

/**
 * The Stripe return URLs are a CROSS-REPO contract: this service builds them,
 * and apps/web in kodus-ai parses them. Nothing pinned them, so dropping a
 * parameter here would land the customer on a page that shows no outcome —
 * exactly what Kody asked about on PR #51. These are the four facts the web
 * depends on:
 *
 *   · `credits=success` / `credits=cancel` / `credits=card_saved` — the toast
 *     the wallet shows (credits-wallet.tsx reads `searchParams.get("credits")`);
 *   · `session_id={CHECKOUT_SESSION_ID}` on the paid flow, so the return can
 *     be traced to the session;
 *   · the `#kodus` fragment, which is how /byok scrolls to the Kodus provider
 *     card (page.client.tsx listens for that hash);
 *   · NO `tab=credits`. /byok has three tabs — providers, routing, budget —
 *     and the credits tab was deliberately removed when the wallet moved onto
 *     the provider card. An unknown `tab` value is ignored, so re-adding it
 *     would be dead weight pointing at a screen that no longer exists.
 */
const created: Array<Record<string, any>> = [];

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: jest.fn(async (args: Record<string, any>) => {
          created.push(args);
          return { url: "https://checkout.stripe.com/c/pay/cs_test_1" };
        }),
      },
    },
    customers: { create: jest.fn(async () => ({ id: "cus_1" })) },
  })),
);
jest.mock("../repositories/OrganizationLicenseRepository", () => ({
  OrganizationLicenseRepository: {
    findOne: jest.fn(async () => ({
      id: "lic-1",
      organizationId: "org-1",
      teamId: "team-1",
      stripeCustomerId: "cus_1",
    })),
    save: jest.fn(),
  },
}));
jest.mock("../config/utils/cache", () => ({ clearCacheByPrefix: jest.fn() }));
jest.mock("./KodusNotificationClient", () => ({
  KodusNotificationClient: { notifyCreditsLow: jest.fn() },
}));
jest.mock("./CreditService", () => ({ CreditService: {} }));
jest.mock("./AutoTopUpService", () => ({ AutoTopUpService: {} }));

describe("credit checkout return URLs", () => {
  const FRONTEND = "https://app.kodus.io";
  let StripeService: typeof import("./StripeService").StripeService;

  beforeAll(async () => {
    process.env.FRONTEND_URL = FRONTEND;
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    ({ StripeService } = await import("./StripeService"));
  });

  beforeEach(() => {
    created.length = 0;
  });

  it("sends a paid credit purchase back to the wallet, with the session id", async () => {
    await StripeService.createCreditCheckoutSession("org-1", "team-1", 20);
    const [args] = created;

    expect(args.success_url).toBe(
      `${FRONTEND}/byok?credits=success&session_id={CHECKOUT_SESSION_ID}#kodus`,
    );
    expect(args.cancel_url).toBe(`${FRONTEND}/byok?credits=cancel#kodus`);
    // The card must be saved for auto top-up to have anything to charge.
    expect(args.payment_intent_data.setup_future_usage).toBe("off_session");
  });

  it("sends a saved card back with card_saved", async () => {
    await StripeService.createCreditSetupSession("org-1", "team-1");
    const [args] = created;

    expect(args.mode).toBe("setup");
    expect(args.success_url).toBe(`${FRONTEND}/byok?credits=card_saved#kodus`);
    expect(args.cancel_url).toBe(`${FRONTEND}/byok?credits=cancel#kodus`);
  });

  it("never points at a tab that no longer exists", async () => {
    await StripeService.createCreditCheckoutSession("org-1", "team-1", 20);
    await StripeService.createCreditSetupSession("org-1", "team-1");
    for (const args of created) {
      for (const url of [args.success_url, args.cancel_url]) {
        expect(url).not.toContain("tab=");
        // Every credit return lands on the provider card.
        expect(url).toContain("#kodus");
        expect(url).toMatch(/[?&]credits=/);
      }
    }
  });
});
