import "reflect-metadata";

const workspaces: Array<Record<string, any>> = [];
const connections: Array<Record<string, any>> = [];
const seats: Array<Record<string, any>> = [];
/** Runs when the bind reads the connection's licence under its lock. */
let onLockedRead: (() => void) | null = null;

const matches = (row: Record<string, any>, where: Record<string, any>) =>
  Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "_type" in value) {
      if (value._type === "isNull") return row[key] == null;
      if (value._type === "in") return value._value.includes(row[key]);
    }
    return row[key] === value;
  });

const workspaceRepo = {
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
    const matched =
      w &&
      (expected?._type === "isNull"
        ? w.primaryConnectionId == null
        : w.primaryConnectionId === expected);
    if (!matched) return { affected: 0 };
    Object.assign(w, values);
    return { affected: 1 };
  }),
  increment: jest.fn(async (criteria: any, column: string, by: number) => {
    const w = workspaces.find((x) => x.id === criteria.id);
    if (w) w[column] = (w[column] ?? 0) + by;
    return { affected: w ? 1 : 0 };
  }),
};

const connectionRepo = {
  findOne: jest.fn(async ({ where, lock }: any) => {
    if (lock) onLockedRead?.();
    return connections.find((c) => matches(c, where)) ?? null;
  }),
  create: jest.fn((x: unknown) => x),
  save: jest.fn(async (x: Record<string, any>) => {
    const row = { id: `cl-${connections.length + 1}`, ...x };
    connections.push(row);
    return row;
  }),
  delete: jest.fn(async (criteria: any) => {
    const index = connections.findIndex((c) => matches(c, criteria));
    if (index === -1) return { affected: 0 };
    const [row] = connections.splice(index, 1);
    // ON DELETE CASCADE from user_licenses.
    for (let i = seats.length - 1; i >= 0; i--) {
      if (seats[i].connectionLicenseId === row.id) seats.splice(i, 1);
    }
    return { affected: 1 };
  }),
};

const seatRepo = {
  find: jest.fn(async ({ where }: any) => seats.filter((s) => matches(s, where))),
  update: jest.fn(async (criteria: any, values: any) => {
    const hit = seats.filter((s) => matches(s, criteria));
    hit.forEach((s) => Object.assign(s, values));
    return { affected: hit.length };
  }),
};

jest.mock("../config/database", () => ({
  AppDataSource: {
    transaction: jest.fn(async (work: (manager: unknown) => unknown) =>
      work({
        getRepository: (entity: { name: string }) =>
          ({
            OrganizationLicense: workspaceRepo,
            ConnectionLicense: connectionRepo,
            UserLicense: seatRepo,
          })[entity.name],
      }),
    ),
  },
}));
jest.mock("../repositories/OrganizationLicenseRepository", () => ({
  OrganizationLicenseRepository: workspaceRepo,
}));
jest.mock("../repositories/ConnectionLicenseRepository", () => ({
  ConnectionLicenseRepository: connectionRepo,
}));
jest.mock("../config/utils/cache", () => ({ clearCacheByPrefix: jest.fn() }));

import { ConnectionLicenseService } from "./ConnectionLicenseService";
import { PlanType, SubscriptionStatus } from "../entities/OrganizationLicense";
import { LicenseStatus } from "../entities/UserLicense";

const workspace = (over: Record<string, any> = {}) => {
  const w = {
    id: "lic-1",
    organizationId: "org-1",
    teamId: "team-1",
    subscriptionStatus: SubscriptionStatus.ACTIVE,
    planType: PlanType.TEAMS_MANAGED,
    totalLicenses: 10,
    assignedLicenses: 0,
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
  seats.length = 0;
  onLockedRead = null;
});

describe("ConnectionLicenseService.resolve", () => {
  it("bills a call that names no connection on the workspace row, as before", async () => {
    workspace({ primaryConnectionId: "gh-a" });

    const pool = await ConnectionLicenseService.resolve("org-1", "team-1");

    expect(pool?.workspace.id).toBe("lic-1");
    expect(pool?.connection).toBeNull();
  });

  it("bills every connection of a workspace with no bound primary on the workspace row, binding nothing", async () => {
    const w = workspace();

    const first = await ConnectionLicenseService.resolve("org-1", "team-1", "gh-a");
    const other = await ConnectionLicenseService.resolve("org-1", "team-1", "made-up");

    expect(first?.connection).toBeNull();
    expect(other?.connection).toBeNull();
    expect(w.primaryConnectionId).toBeNull();
    expect(connections).toHaveLength(0);
  });

  it("keeps a connection's own subscription while no primary is bound", async () => {
    workspace();
    connections.push({
      id: "cl-b",
      organizationLicenseId: "lic-1",
      connectionId: "gl-b",
      stripeSubscriptionId: "sub_b",
    });

    const pool = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b");

    expect(pool?.connection?.id).toBe("cl-b");
  });

  it("bills a connection whose licence has no subscription of its own on the workspace row while no primary is bound", async () => {
    workspace();
    connections.push({
      id: "cl-b",
      organizationLicenseId: "lic-1",
      connectionId: "gl-b",
      stripeSubscriptionId: null,
    });

    const read = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b");
    const write = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b", {
      create: true,
    });

    expect(read?.connection).toBeNull();
    expect(write?.connection).toBeNull();
    expect(connections).toHaveLength(1);
  });

  it("keeps an unbilled licence once another connection is the primary", async () => {
    workspace({ primaryConnectionId: "gh-a" });
    connections.push({
      id: "cl-b",
      organizationLicenseId: "lic-1",
      connectionId: "gl-b",
      stripeSubscriptionId: null,
    });

    const pool = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b");

    expect(pool?.connection?.id).toBe("cl-b");
  });

  it("gives a connection other than the primary its own free licence, with no Stripe call", async () => {
    workspace({ primaryConnectionId: "gh-a" });

    const pool = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b", {
      create: true,
    });

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

    const first = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b", {
      create: true,
    });
    const second = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b", {
      create: true,
    });

    expect(second?.connection?.id).toBe(first?.connection?.id);
    expect(connections).toHaveLength(1);
  });

  it("describes a connection with no licence yet as free on a read, writing nothing", async () => {
    workspace({ primaryConnectionId: "gh-a" });

    const pool = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b");

    expect(pool?.connection).toMatchObject({
      connectionId: "gl-b",
      planType: PlanType.FREE_BYOK,
      totalLicenses: 0,
    });
    expect(pool?.connection?.id).toBeUndefined();
    expect(connections).toHaveLength(0);
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

  it("binds a workspace's first primary", async () => {
    const w = workspace();

    await expect(
      ConnectionLicenseService.bindPrimary("org-1", "team-1", "gh-a"),
    ).resolves.toEqual({ found: true, primaryConnectionId: "gh-a" });
    expect(w.primaryConnectionId).toBe("gh-a");
  });

  it("never makes a connection with its own subscription the primary", async () => {
    const w = workspace();
    connections.push({
      id: "cl-b",
      organizationLicenseId: "lic-1",
      connectionId: "gl-b",
      stripeSubscriptionId: "sub_b",
    });

    await expect(
      ConnectionLicenseService.bindPrimary("org-1", "team-1", "gl-b"),
    ).resolves.toEqual({ found: true, primaryConnectionId: null });
    expect(w.primaryConnectionId).toBeNull();
    expect(connections).toHaveLength(1);
  });

  it("binds a connection whose licence has no subscription of its own, dropping that empty licence", async () => {
    const w = workspace();
    connections.push({
      id: "cl-b",
      organizationLicenseId: "lic-1",
      connectionId: "gl-b",
      stripeSubscriptionId: null,
    });

    await expect(
      ConnectionLicenseService.bindPrimary("org-1", "team-1", "gl-b"),
    ).resolves.toEqual({ found: true, primaryConnectionId: "gl-b" });
    expect(w.primaryConnectionId).toBe("gl-b");
    expect(connections).toHaveLength(0);
  });

  it("moves the seats of an unbilled licence to the workspace pool when its connection becomes the primary", async () => {
    const w = workspace({ assignedLicenses: 1 });
    connections.push({
      id: "cl-b",
      organizationLicenseId: "lic-1",
      connectionId: "gl-b",
      stripeSubscriptionId: null,
    });
    const seat = (id: string, gitId: string, connectionLicenseId: string | null, licenseStatus: LicenseStatus) => ({
      id,
      git_id: gitId,
      organizationLicenseId: "lic-1",
      connectionLicenseId,
      licenseStatus,
    });
    seats.push(
      seat("s-ws-2", "2", null, LicenseStatus.ACTIVE),
      seat("s-b-1", "1", "cl-b", LicenseStatus.INACTIVE),
      seat("s-b-2", "2", "cl-b", LicenseStatus.INACTIVE),
      seat("s-b-3", "3", "cl-b", LicenseStatus.ACTIVE),
    );

    await ConnectionLicenseService.bindPrimary("org-1", "team-1", "gl-b");

    expect(w.primaryConnectionId).toBe("gl-b");
    expect(connections).toHaveLength(0);
    // A git id already seated on the workspace keeps that seat.
    expect(seats.map((s) => [s.id, s.connectionLicenseId]).sort()).toEqual([
      ["s-b-1", null],
      ["s-b-3", null],
      ["s-ws-2", null],
    ]);
    expect(w.assignedLicenses).toBe(2);
  });

  it("keeps a seat active when the connection's seat is active and the workspace's duplicate is not", async () => {
    const w = workspace({ assignedLicenses: 0 });
    connections.push({
      id: "cl-b",
      organizationLicenseId: "lic-1",
      connectionId: "gl-b",
      stripeSubscriptionId: null,
    });
    seats.push(
      {
        id: "s-ws-2",
        git_id: "2",
        organizationLicenseId: "lic-1",
        connectionLicenseId: null,
        licenseStatus: LicenseStatus.INACTIVE,
      },
      {
        id: "s-b-2",
        git_id: "2",
        organizationLicenseId: "lic-1",
        connectionLicenseId: "cl-b",
        licenseStatus: LicenseStatus.ACTIVE,
      },
    );

    await ConnectionLicenseService.bindPrimary("org-1", "team-1", "gl-b");

    expect(
      seats.map((s) => [s.id, s.connectionLicenseId, s.licenseStatus]),
    ).toEqual([["s-ws-2", null, LicenseStatus.ACTIVE]]);
    expect(w.assignedLicenses).toBe(1);
  });

  it("keeps the licence and binds nothing when its checkout completes before the bind takes it", async () => {
    const w = workspace();
    const row = {
      id: "cl-b",
      organizationLicenseId: "lic-1",
      connectionId: "gl-b",
      stripeSubscriptionId: null as string | null,
    };
    connections.push(row);
    seats.push({
      id: "s-b-1",
      git_id: "1",
      organizationLicenseId: "lic-1",
      connectionLicenseId: "cl-b",
      licenseStatus: LicenseStatus.INACTIVE,
    });
    onLockedRead = () => {
      row.stripeSubscriptionId = "sub_late";
    };

    await expect(
      ConnectionLicenseService.bindPrimary("org-1", "team-1", "gl-b"),
    ).resolves.toEqual({ found: true, primaryConnectionId: null });
    expect(w.primaryConnectionId).toBeNull();
    expect(connections).toEqual([row]);
    expect(seats[0].connectionLicenseId).toBe("cl-b");
  });

  it("keeps an unbilled licence when another connection is bound first", async () => {
    const w = workspace();
    connections.push({
      id: "cl-b",
      organizationLicenseId: "lic-1",
      connectionId: "gl-b",
      stripeSubscriptionId: null,
    });
    onLockedRead = () => {
      w.primaryConnectionId = "gh-c";
    };

    await expect(
      ConnectionLicenseService.bindPrimary("org-1", "team-1", "gl-b"),
    ).resolves.toEqual({ found: true, primaryConnectionId: "gh-c" });
    expect(connections).toHaveLength(1);
  });

  it("hands the workspace plan to a connection left with only an unbilled licence once the primary is removed", async () => {
    const w = workspace({ primaryConnectionId: "gh-a" });
    // The connection's first seat call wrote a free licence, then ran out of seats.
    await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b", { create: true });

    await ConnectionLicenseService.release("org-1", "team-1", "gh-a");
    const beforeBind = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b");
    await ConnectionLicenseService.bindPrimary("org-1", "team-1", "gl-b");
    const afterBind = await ConnectionLicenseService.resolve("org-1", "team-1", "gl-b");

    expect(beforeBind?.connection).toBeNull();
    expect(w.primaryConnectionId).toBe("gl-b");
    expect(afterBind?.connection).toBeNull();
    expect(connections).toHaveLength(0);
  });

  it("frees the primary slot when that connection is removed, until the next one is bound", async () => {
    const w = workspace({ primaryConnectionId: "gh-a" });

    await ConnectionLicenseService.release("org-1", "team-1", "gh-a");
    expect(w.primaryConnectionId).toBeNull();

    await ConnectionLicenseService.bindPrimary("org-1", "team-1", "gl-c");
    expect(w.primaryConnectionId).toBe("gl-c");
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

describe("ConnectionLicenseService.hasOwnSubscription", () => {
  it("counts only a licence that carries its own Stripe subscription", () => {
    expect(ConnectionLicenseService.hasOwnSubscription({ stripeSubscriptionId: "sub_b" })).toBe(true);
    expect(ConnectionLicenseService.hasOwnSubscription({ stripeSubscriptionId: null })).toBe(false);
    expect(ConnectionLicenseService.hasOwnSubscription({ stripeSubscriptionId: "" })).toBe(false);
  });
});
