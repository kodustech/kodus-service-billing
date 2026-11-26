import "reflect-metadata";

const created: Array<Record<string, any>> = [];
const workspaces: Array<Record<string, any>> = [];
const connections: Array<Record<string, any>> = [];

const find = (rows: Array<Record<string, any>>, where: Record<string, any>) =>
  rows.find((row) =>
    Object.entries(where).every(([key, value]) => row[key] === value),
  ) ?? null;

/** The order calls reached the licence store and Stripe. */
const mockCalls: string[] = [];
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_1";
let mockCheckoutUrl: string | null = CHECKOUT_URL;

jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: jest.fn(async (args: Record<string, any>) => {
          mockCalls.push("stripe.checkout");
          created.push(args);
          return { url: mockCheckoutUrl };
        }),
        listLineItems: jest.fn(async () => ({
          data: [{ quantity: 3, price: { id: "price_teams_byok" } }],
        })),
      },
    },
    subscriptionItems: {
      list: jest.fn(async () => ({ data: [{ quantity: 5 }] })),
    },
  })),
);
jest.mock("../config/planPricing", () => ({
  getPriceIdForPlan: jest.fn(() => "price_teams_byok"),
  getPlanTypeByPriceId: jest.fn(() => "teams_byok"),
}));
jest.mock("../repositories/OrganizationLicenseRepository", () => ({
  OrganizationLicenseRepository: {
    findOne: jest.fn(async ({ where }: any) => find(workspaces, where)),
    save: jest.fn(async (x: unknown) => x),
  },
}));
jest.mock("../repositories/ConnectionLicenseRepository", () => ({
  ConnectionLicenseRepository: {
    findOne: jest.fn(async ({ where }: any) => find(connections, where)),
    save: jest.fn(async (x: unknown) => {
      mockCalls.push("licence.save");
      return x;
    }),
  },
}));
jest.mock("./ConnectionLicenseService", () => ({
  ConnectionLicenseService: {
    resolve: jest.fn(async (organizationId: string, teamId: string, connectionId?: string) => {
      const workspace = find(workspaces, { organizationId, teamId });
      if (!workspace) return null;
      const connection =
        connectionId && connectionId !== workspace.primaryConnectionId
          ? find(connections, { connectionId })
          : null;
      return { workspace, connection };
    }),
  },
}));
jest.mock("../config/utils/cache", () => ({ clearCacheByPrefix: jest.fn() }));
jest.mock("./KodusNotificationClient", () => ({
  KodusNotificationClient: {
    notifyPlanChanged: jest.fn(async () => undefined),
    notifyPaymentFailed: jest.fn(async () => undefined),
  },
}));
jest.mock("./CreditService", () => ({ CreditService: {} }));
jest.mock("./AutoTopUpService", () => ({ AutoTopUpService: {} }));

import { StripeService } from "./StripeService";
import { ConnectionLicenseService } from "./ConnectionLicenseService";
import { PlanType, SubscriptionStatus } from "../entities/OrganizationLicense";
import { KodusNotificationClient } from "./KodusNotificationClient";
import { ConnectionLicenseRepository } from "../repositories/ConnectionLicenseRepository";

beforeEach(() => {
  created.length = 0;
  mockCalls.length = 0;
  (ConnectionLicenseRepository.save as jest.Mock).mockClear();
  workspaces.length = 0;
  connections.length = 0;
  workspaces.push(
    {
      id: "lic-other-team",
      organizationId: "org-1",
      teamId: "team-0",
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      planType: PlanType.TEAMS_MANAGED,
      totalLicenses: 9,
    },
    {
      id: "lic-1",
      organizationId: "org-1",
      teamId: "team-1",
      subscriptionStatus: SubscriptionStatus.TRIAL,
      planType: PlanType.TEAMS_MANAGED,
      totalLicenses: 0,
      stripeCustomerId: "cus_1",
      primaryConnectionId: "gh-a",
    },
  );
  connections.push({
    id: "cl-b",
    organizationLicenseId: "lic-1",
    organizationId: "org-1",
    teamId: "team-1",
    connectionId: "gl-b",
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    planType: PlanType.FREE_BYOK,
    stripeSubscriptionId: null,
    totalLicenses: 0,
  });
});

describe("subscription checkout per Git connection", () => {
  it("opens checkout for the workspace that asked, not the organization's first one", async () => {
    await StripeService.createCheckoutSession("org-1", 2, "team-1", PlanType.TEAMS_BYOK);

    expect(created[0].metadata).toMatchObject({
      licenseId: "lic-1",
      teamId: "team-1",
    });
    expect(created[0].metadata.connectionLicenseId).toBeUndefined();
  });

  it("opens no checkout for a workspace billing has never seen", async () => {
    await expect(
      StripeService.createCheckoutSession("org-1", 2, "team-unknown", PlanType.TEAMS_BYOK),
    ).resolves.toBeNull();
    expect(created).toHaveLength(0);
  });

  it("fails rather than answer an empty URL when Stripe returns a session without one", async () => {
    mockCheckoutUrl = null;
    try {
      await expect(
        StripeService.createCheckoutSession("org-1", 2, "team-1", PlanType.TEAMS_BYOK),
      ).rejects.toThrow("without a checkout URL");
    } finally {
      mockCheckoutUrl = CHECKOUT_URL;
    }
  });

  it("creates the connection's licence when opening its checkout", async () => {
    await StripeService.createCheckoutSession("org-1", 2, "team-1", PlanType.TEAMS_BYOK, "gl-b");

    expect(ConnectionLicenseService.resolve).toHaveBeenCalledWith("org-1", "team-1", "gl-b", {
      create: true,
    });
  });

  it("records when a connection's checkout started, before opening it, so a bind waits for it", async () => {
    await StripeService.createCheckoutSession(
      "org-1",
      2,
      "team-1",
      PlanType.TEAMS_BYOK,
      "gl-b",
    );

    const [saved] = (ConnectionLicenseRepository.save as jest.Mock).mock.calls[0];
    expect(saved.id).toBe("cl-b");
    expect(saved.checkoutStartedAt).toBeInstanceOf(Date);
    expect(mockCalls).toEqual(["licence.save", "stripe.checkout"]);
  });

  it("opens checkout for a connection's own licence, on the workspace's Stripe customer", async () => {
    await StripeService.createCheckoutSession(
      "org-1",
      2,
      "team-1",
      PlanType.TEAMS_BYOK,
      "gl-b",
    );

    expect(created[0].metadata).toMatchObject({
      licenseId: "lic-1",
      connectionLicenseId: "cl-b",
      connectionId: "gl-b",
    });
    expect(created[0].customer).toBe("cus_1");
  });

  it("activates the connection's licence when its checkout completes, leaving the workspace trial alone", async () => {
    await StripeService.handleWebhookEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          customer: "cus_1",
          subscription: "sub_b",
          metadata: {
            organizationId: "org-1",
            teamId: "team-1",
            licenseId: "lic-1",
            connectionLicenseId: "cl-b",
          },
        },
      },
    } as any);

    expect(connections[0]).toMatchObject({
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      stripeSubscriptionId: "sub_b",
      totalLicenses: 3,
      planType: "teams_byok",
    });
    expect(workspaces[1]).toMatchObject({
      subscriptionStatus: SubscriptionStatus.TRIAL,
      totalLicenses: 0,
    });
    expect(KodusNotificationClient.notifyPlanChanged).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-1", connectionId: "gl-b" }),
    );
  });

  it("activates the workspace named by the session's licence id, not another workspace of the org", async () => {
    await StripeService.handleWebhookEvent({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_2",
          customer: "cus_1",
          subscription: "sub_a",
          metadata: { organizationId: "org-1", teamId: "team-1", licenseId: "lic-1" },
        },
      },
    } as any);

    expect(workspaces[1]).toMatchObject({
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      stripeSubscriptionId: "sub_a",
      totalLicenses: 3,
    });
    expect(workspaces[0].totalLicenses).toBe(9);
  });

  it("follows a connection's subscription updates and cancellation", async () => {
    connections[0].stripeSubscriptionId = "sub_b";
    connections[0].planType = PlanType.TEAMS_BYOK;

    await StripeService.handleWebhookEvent({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_b", status: "past_due" } },
    } as any);
    expect(connections[0]).toMatchObject({
      subscriptionStatus: SubscriptionStatus.PAYMENT_FAILED,
      totalLicenses: 5,
    });

    await StripeService.handleWebhookEvent({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_b" } },
    } as any);
    expect(connections[0].subscriptionStatus).toBe(SubscriptionStatus.CANCELED);
  });

  it("marks a connection's subscription failed on a failed invoice", async () => {
    connections[0].stripeSubscriptionId = "sub_b";

    await StripeService.handleWebhookEvent({
      type: "invoice.payment_failed",
      data: { object: { subscription: "sub_b", amount_due: 100, currency: "usd" } },
    } as any);

    expect(connections[0].subscriptionStatus).toBe(SubscriptionStatus.PAYMENT_FAILED);
    expect(KodusNotificationClient.notifyPaymentFailed).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-1" }),
    );
  });
});
