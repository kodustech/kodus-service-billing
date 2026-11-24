import "reflect-metadata";

const workspaces: Array<Record<string, any>> = [];
const connections: Array<Record<string, any>> = [];

jest.mock("../repositories/OrganizationLicenseRepository", () => ({
  OrganizationLicenseRepository: {
    findOne: jest.fn(async ({ where }: any) =>
      workspaces.find(
        (w) =>
          (!where.id || w.id === where.id) &&
          (!where.organizationId || w.organizationId === where.organizationId) &&
          (!where.teamId || w.teamId === where.teamId),
      ) ?? null,
    ),
    update: jest.fn(async (criteria: any, values: any) => {
      const w = workspaces.find((x) => x.id === criteria.id);
      const expected = criteria.primaryConnectionId;
      const matches =
        w &&
        (expected?._type === "isNull"
          ? w.primaryConnectionId == null
          : w.primaryConnectionId === expected);
      if (!matches) return { affected: 0 };
      Object.assign(w, values);
      return { affected: 1 };
    }),
  },
}));
jest.mock("../repositories/ConnectionLicenseRepository", () => ({
  ConnectionLicenseRepository: {
    findOne: jest.fn(async ({ where }: any) =>
      connections.find(
        (c) =>
          c.organizationLicenseId === where.organizationLicenseId &&
          c.connectionId === where.connectionId,
      ) ?? null,
    ),
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: Record<string, any>) => {
      const row = { id: `cl-${connections.length + 1}`, ...x };
      connections.push(row);
      return row;
    }),
  },
}));
jest.mock("../config/utils/cache", () => ({ clearCacheByPrefix: jest.fn() }));

import { ConnectionLicenseService } from "./ConnectionLicenseService";
import { PlanType, SubscriptionStatus } from "../entities/OrganizationLicense";

const workspace = (over: Record<string, any> = {}) => {
  const w = {
    id: "lic-1",
    organizationId: "org-1",
    teamId: "team-1",
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    planType: PlanType.TEAMS_MANAGED,
    totalLicenses: 10,
    creditBalanceUsd: 42,
    stripeCustomerId: "cus_1",
    primaryConnectionId: null,
    ...over,
  };
  workspaces.push(w);
  return w;
};

beforeEach(() => {
  workspaces.length = 0;
  connections.length = 0;
});

describe("ConnectionLicenseService.resolve", () => {
  it("bills a call that names no connection on the workspace row, as before", async () => {
    workspace({ primaryConnectionId: "gh-a" });

    const pool = await ConnectionLicenseService.resolve("org-1", "team-1");

    expect(pool?.workspace.id).toBe("lic-1");
    expect(pool?.connection).toBeNull();
  });

  it("binds the first connection named on a legacy workspace as its primary", async () => {
    const w = workspace();

    const pool = await ConnectionLicenseService.resolve("org-1", "team-1", "gh-a");

    expect(pool?.connection).toBeNull();
    expect(w.primaryConnectionId).toBe("gh-a");
    expect(connections).toHaveLength(0);
  });

  it("gives a connection other than the primary its own free licence, with no Stripe call", async () => {
    workspace({ primaryConnectionId: "gh-a" });

    const pool = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b");

    expect(pool?.connection).toMatchObject({
      organizationLicenseId: "lic-1",
      connectionId: "gl-b",
      planType: PlanType.FREE_BYOK,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      totalLicenses: 0,
    });
  });

  it("reuses the connection's licence on later calls", async () => {
    workspace({ primaryConnectionId: "gh-a" });

    const first = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b");
    const second = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b");

    expect(second?.connection?.id).toBe(first?.connection?.id);
    expect(connections).toHaveLength(1);
  });

  it("answers null for a workspace billing has never seen", async () => {
    await expect(
      ConnectionLicenseService.resolve("org-1", "team-1", "gh-a"),
    ).resolves.toBeNull();
  });
});

describe("ConnectionLicenseService.bindPrimary / release", () => {
  it("binds the primary only while none is set", async () => {
    const w = workspace({ primaryConnectionId: "gh-a" });

    await ConnectionLicenseService.bindPrimary("org-1", "team-1", "gl-b");

    expect(w.primaryConnectionId).toBe("gh-a");
  });

  it("frees the primary slot when that connection is removed, so the next one named takes the workspace plan", async () => {
    const w = workspace({ primaryConnectionId: "gh-a" });

    await ConnectionLicenseService.release("org-1", "team-1", "gh-a");
    expect(w.primaryConnectionId).toBeNull();

    const pool = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b");
    expect(pool?.connection).toBeNull();
    expect(w.primaryConnectionId).toBe("gl-b");
  });

  it("leaves the primary alone when another connection is removed", async () => {
    const w = workspace({ primaryConnectionId: "gh-a" });

    await ConnectionLicenseService.release("org-1", "team-1", "gl-b");

    expect(w.primaryConnectionId).toBe("gh-a");
  });
});

describe("ConnectionLicenseService.describe", () => {
  const conn = (over: Record<string, any> = {}) => ({
    id: "cl-1",
    organizationLicenseId: "lic-1",
    connectionId: "gl-b",
    planType: PlanType.FREE_BYOK,
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    stripeSubscriptionId: null,
    totalLicenses: 0,
    ...over,
  });

  it("reports the connection's own paid plan and seats, with the workspace wallet", () => {
    const w = workspace();
    const result = ConnectionLicenseService.describe(
      w as any,
      conn({
        planType: PlanType.TEAMS_BYOK,
        stripeSubscriptionId: "sub_b",
        totalLicenses: 3,
      }) as any,
    );

    expect(result).toMatchObject({
      valid: true,
      planType: PlanType.TEAMS_BYOK,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      numberOfLicenses: 3,
      creditBalanceUsd: 42,
      byok: true,
      connectionId: "gl-b",
    });
  });

  it("does not hand the workspace's paid plan to an unpaid connection", () => {
    const w = workspace({ planType: PlanType.TEAMS_MANAGED });
    const result = ConnectionLicenseService.describe(w as any, conn() as any);

    expect(result).toMatchObject({
      valid: true,
      planType: PlanType.FREE_BYOK,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      numberOfLicenses: 0,
      byok: true,
    });
  });

  it("lets an unpaid connection share the workspace trial while it runs", () => {
    const trialEnd = new Date(Date.now() + 86_400_000);
    const w = workspace({
      subscriptionStatus: SubscriptionStatus.TRIAL,
      planType: PlanType.TEAMS_MANAGED,
      trialEnd,
      trialReviewCreditsTotal: 5,
      trialReviewCreditsUsed: 1,
      trialReviewCreditsRemaining: 4,
    });

    const result = ConnectionLicenseService.describe(w as any, conn() as any);

    expect(result).toMatchObject({
      valid: true,
      subscriptionStatus: SubscriptionStatus.TRIAL,
      planType: PlanType.TEAMS_MANAGED,
      trialEnd,
      trialReviewCreditsRemaining: 4,
    });
  });

  it("falls back to the free plan once the workspace trial has ended", () => {
    const w = workspace({
      subscriptionStatus: SubscriptionStatus.TRIAL,
      trialEnd: new Date(Date.now() - 1000),
    });

    const result = ConnectionLicenseService.describe(w as any, conn() as any);

    expect(result).toMatchObject({
      valid: true,
      planType: PlanType.FREE_BYOK,
    });
  });

  it("reports a failed payment on the connection's subscription as invalid", () => {
    const w = workspace();
    const result = ConnectionLicenseService.describe(
      w as any,
      conn({
        planType: PlanType.TEAMS_MANAGED,
        subscriptionStatus: SubscriptionStatus.PAYMENT_FAILED,
        stripeSubscriptionId: "sub_b",
      }) as any,
    );

    expect(result.valid).toBe(false);
  });
});
