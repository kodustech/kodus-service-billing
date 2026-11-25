import "reflect-metadata";

const seats: Array<Record<string, any>> = [];

const matches = (row: Record<string, any>, where: Record<string, any>) =>
  Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && "_type" in value) {
      if (value._type === "isNull") return row[key] == null;
      if (value._type === "in") return value._value.includes(row[key]);
    }
    if (key === "organizationLicense") return true;
    return row[key] === value;
  });

jest.mock("../config/database", () => ({ AppDataSource: {} }));
jest.mock("../repositories/OrganizationLicenseRepository", () => ({
  OrganizationLicenseRepository: {
    findOne: jest.fn(),
    save: jest.fn(async (x: unknown) => x),
  },
}));
jest.mock("../repositories/ConnectionLicenseRepository", () => ({
  ConnectionLicenseRepository: { save: jest.fn(async (x: unknown) => x) },
}));
jest.mock("../repositories/UserLicenseRepository", () => ({
  UserLicenseRepository: {
    find: jest.fn(async ({ where }: any) => seats.filter((s) => matches(s, where))),
    findOne: jest.fn(
      async ({ where }: any) => seats.find((s) => matches(s, where)) ?? null,
    ),
    count: jest.fn(
      async ({ where }: any) => seats.filter((s) => matches(s, where)).length,
    ),
    create: jest.fn((x: unknown) => x),
    save: jest.fn(async (x: Record<string, any>) => {
      if (!seats.includes(x)) seats.push(x);
      return x;
    }),
  },
}));
jest.mock("./ConnectionLicenseService", () => {
  const actual = jest.requireActual("./ConnectionLicenseService");
  return {
    ConnectionLicenseService: {
      resolve: jest.fn(),
      describe: actual.ConnectionLicenseService.describe,
    },
  };
});
jest.mock("../config/utils/cache", () => ({ clearCacheByPrefix: jest.fn() }));
jest.mock("../config/utils/urlBuilder", () => ({ buildLogApiUrl: jest.fn() }));
jest.mock("axios", () => ({ post: jest.fn() }));
jest.mock("./KodusNotificationClient", () => ({
  KodusNotificationClient: { notifyPlanChanged: jest.fn(async () => undefined) },
}));

import { OrganizationLicenseService } from "./OrganizationLicenseService";
import { ConnectionLicenseService } from "./ConnectionLicenseService";
import { OrganizationLicenseRepository } from "../repositories/OrganizationLicenseRepository";
import { ConnectionLicenseRepository } from "../repositories/ConnectionLicenseRepository";
import { PlanType, SubscriptionStatus } from "../entities/OrganizationLicense";
import { GitTool, LicenseStatus } from "../entities/UserLicense";

const resolve = ConnectionLicenseService.resolve as jest.Mock;

const workspace = {
  id: "lic-1",
  organizationId: "org-1",
  teamId: "team-1",
  subscriptionStatus: SubscriptionStatus.ACTIVE,
  planType: PlanType.TEAMS_MANAGED,
  totalLicenses: 2,
  assignedLicenses: 0,
  creditBalanceUsd: 7,
  stripeCustomerId: "cus_1",
  primaryConnectionId: "gh-a",
};

const gitlabConnection = () => ({
  id: "cl-b",
  organizationLicenseId: "lic-1",
  connectionId: "gl-b",
  planType: PlanType.TEAMS_BYOK,
  subscriptionStatus: SubscriptionStatus.ACTIVE,
  stripeSubscriptionId: "sub_b",
  totalLicenses: 1,
  assignedLicenses: 0,
});

beforeEach(() => {
  seats.length = 0;
  resolve.mockReset();
});

describe("seats per Git connection", () => {
  it("takes a seat from the named connection's pool, recording its host", async () => {
    const connection = gitlabConnection();
    resolve.mockResolvedValue({ workspace: { ...workspace }, connection });

    const result = await OrganizationLicenseService.assignLicensesToUsers(
      "org-1",
      "team-1",
      [
        {
          gitId: "42",
          gitTool: GitTool.GITLAB,
          gitHost: "gitlab.example.com",
          licenseStatus: LicenseStatus.ACTIVE,
        },
      ],
      "gl-b",
    );

    expect(result.failed).toEqual([]);
    expect(seats).toEqual([
      expect.objectContaining({
        git_id: "42",
        git_tool: GitTool.GITLAB,
        git_host: "gitlab.example.com",
        organizationLicenseId: "lic-1",
        connectionLicenseId: "cl-b",
      }),
    ]);
    expect(ConnectionLicenseRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cl-b", assignedLicenses: 1 }),
    );
    expect(OrganizationLicenseRepository.save).not.toHaveBeenCalled();
  });

  it("refuses a seat beyond the connection's own subscription, whatever the workspace has", async () => {
    resolve.mockResolvedValue({
      workspace: { ...workspace, totalLicenses: 50 },
      connection: gitlabConnection(),
    });
    seats.push({
      git_id: "7",
      licenseStatus: LicenseStatus.ACTIVE,
      organizationLicenseId: "lic-1",
      connectionLicenseId: "cl-b",
    });

    const result = await OrganizationLicenseService.assignLicensesToUsers(
      "org-1",
      "team-1",
      [{ gitId: "42", gitTool: GitTool.GITLAB, licenseStatus: LicenseStatus.ACTIVE }],
      "gl-b",
    );

    expect(result.successful).toEqual([]);
    expect(result.failed).toHaveLength(1);
  });

  it("refuses seats on a free connection, which has none", async () => {
    resolve.mockResolvedValue({
      workspace: { ...workspace },
      connection: {
        ...gitlabConnection(),
        planType: PlanType.FREE_BYOK,
        stripeSubscriptionId: null,
        totalLicenses: 0,
      },
    });

    const result = await OrganizationLicenseService.assignLicensesToUsers(
      "org-1",
      "team-1",
      [{ gitId: "42", gitTool: GitTool.GITLAB, licenseStatus: LicenseStatus.ACTIVE }],
      "gl-b",
    );

    expect(result.successful).toEqual([]);
  });

  it("refuses seats on a connection whose subscription was cancelled, whatever seats it had", async () => {
    resolve.mockResolvedValue({
      workspace: { ...workspace },
      connection: {
        ...gitlabConnection(),
        subscriptionStatus: SubscriptionStatus.CANCELED,
        totalLicenses: 5,
      },
    });

    const result = await OrganizationLicenseService.assignLicensesToUsers(
      "org-1",
      "team-1",
      [{ gitId: "42", gitTool: GitTool.GITLAB, licenseStatus: LicenseStatus.ACTIVE }],
      "gl-b",
    ).catch((error: Error) => ({ successful: [], failed: [], error }));

    expect(result.successful).toEqual([]);
  });

  it("creates the connection's licence when assigning its first seat", async () => {
    resolve.mockResolvedValue({ workspace: { ...workspace }, connection: gitlabConnection() });

    await OrganizationLicenseService.assignLicensesToUsers(
      "org-1",
      "team-1",
      [{ gitId: "42", gitTool: GitTool.GITLAB, licenseStatus: LicenseStatus.ACTIVE }],
      "gl-b",
    );

    expect(resolve).toHaveBeenCalledWith("org-1", "team-1", "gl-b", { create: true });
  });

  it("does not count another connection's seats against the primary's pool", async () => {
    resolve.mockResolvedValue({
      workspace: { ...workspace, totalLicenses: 1 },
      connection: null,
    });
    seats.push({
      git_id: "7",
      licenseStatus: LicenseStatus.ACTIVE,
      organizationLicenseId: "lic-1",
      connectionLicenseId: "cl-b",
    });

    const result = await OrganizationLicenseService.assignLicensesToUsers(
      "org-1",
      "team-1",
      [{ gitId: "42", gitTool: GitTool.GITHUB, licenseStatus: LicenseStatus.ACTIVE }],
      "gh-a",
    );

    expect(result.failed).toEqual([]);
    expect(seats[1]).toMatchObject({ git_id: "42", connectionLicenseId: null });
  });

  it("checks a git id against the named connection's seats only", async () => {
    resolve.mockResolvedValue({ workspace, connection: gitlabConnection() });
    seats.push({
      git_id: "42",
      licenseStatus: LicenseStatus.ACTIVE,
      organizationLicenseId: "lic-1",
      connectionLicenseId: null,
    });

    await expect(
      OrganizationLicenseService.checkUserLicense("org-1", "42", "team-1", "gl-b"),
    ).resolves.toEqual({ git_id: "42", isValid: false });
  });

  it("refuses a seat on a connection whose subscription was cancelled", async () => {
    resolve.mockResolvedValue({
      workspace,
      connection: { ...gitlabConnection(), subscriptionStatus: SubscriptionStatus.CANCELED },
    });
    seats.push({ git_id: "42", licenseStatus: LicenseStatus.ACTIVE, connectionLicenseId: "cl-b" });

    await expect(
      OrganizationLicenseService.checkUserLicense("org-1", "42", "team-1", "gl-b"),
    ).resolves.toEqual({ git_id: "42", isValid: false });
  });

  it("finds no seat on a connection whose licence does not exist yet", async () => {
    const { id: _id, ...unsaved } = gitlabConnection();
    resolve.mockResolvedValue({
      workspace,
      connection: { ...unsaved, planType: PlanType.FREE_BYOK, stripeSubscriptionId: null },
    });
    seats.push({ git_id: "42", licenseStatus: LicenseStatus.ACTIVE, connectionLicenseId: "cl-x" });

    await expect(
      OrganizationLicenseService.checkUserLicense("org-1", "42", "team-1", "gl-b"),
    ).resolves.toEqual({ git_id: "42", isValid: false });
    await expect(
      OrganizationLicenseService.getAllUsersWithLicense("org-1", "team-1", "gl-b"),
    ).resolves.toEqual([]);
  });

  it("checks a git id with no connection against the workspace's own seats only", async () => {
    seats.push({
      git_id: "42",
      licenseStatus: LicenseStatus.ACTIVE,
      organizationLicenseId: "lic-1",
      connectionLicenseId: "cl-b",
    });

    await expect(
      OrganizationLicenseService.checkUserLicense("org-1", "42", "team-1"),
    ).resolves.toEqual({ git_id: "42", isValid: false });
  });

  it("lists the active seats of the named connection", async () => {
    resolve.mockResolvedValue({ workspace, connection: gitlabConnection() });
    seats.push(
      {
        git_id: "1",
        licenseStatus: LicenseStatus.ACTIVE,
        connectionLicenseId: "cl-b",
      },
      {
        git_id: "2",
        licenseStatus: LicenseStatus.ACTIVE,
        connectionLicenseId: null,
        organizationLicenseId: "lic-1",
      },
    );

    await expect(
      OrganizationLicenseService.getAllUsersWithLicense("org-1", "team-1", "gl-b"),
    ).resolves.toEqual([{ git_id: "1" }]);
  });

  it("validates a connection against its own licence and the workspace wallet", async () => {
    resolve.mockResolvedValue({ workspace, connection: gitlabConnection() });

    await expect(
      OrganizationLicenseService.validateLicense("org-1", "team-1", "gl-b"),
    ).resolves.toMatchObject({
      valid: true,
      planType: PlanType.TEAMS_BYOK,
      numberOfLicenses: 1,
      creditBalanceUsd: 7,
    });
  });
});

describe("migrateToFreePlan", () => {
  it("keeps the Stripe customer the prepaid wallet and saved card are on", async () => {
    (OrganizationLicenseRepository.findOne as jest.Mock).mockResolvedValue({
      ...workspace,
      stripeSubscriptionId: "sub_a",
    });

    const license = await OrganizationLicenseService.migrateToFreePlan(
      "org-1",
      "team-1",
    );

    expect(license.stripeCustomerId).toBe("cus_1");
    expect(license.stripeSubscriptionId).toBeNull();
    expect(license.planType).toBe(PlanType.FREE_BYOK);
  });
});

describe("validateLicense for the whole organization", () => {
  const findWorkspaces = jest.fn();
  const findConnections = jest.fn();

  beforeEach(() => {
    (OrganizationLicenseRepository as any).find = findWorkspaces;
    (ConnectionLicenseRepository as any).find = findConnections;
    findWorkspaces.mockReset();
    findConnections.mockReset();
  });

  it("answers with the best valid plan among the organization's workspaces and connections", async () => {
    const free = { ...workspace, planType: PlanType.FREE_BYOK };
    findWorkspaces.mockResolvedValue([free]);
    findConnections.mockResolvedValue([
      { ...gitlabConnection(), planType: PlanType.ENTERPRISE_BYOK },
    ]);
    (OrganizationLicenseRepository.findOne as jest.Mock).mockResolvedValue(free);

    await expect(
      OrganizationLicenseService.validateLicense("org-1", undefined as any),
    ).resolves.toMatchObject({
      valid: true,
      planType: PlanType.ENTERPRISE_BYOK,
    });
  });

  it("ignores a connection whose subscription is not valid", async () => {
    findWorkspaces.mockResolvedValue([workspace]);
    findConnections.mockResolvedValue([
      {
        ...gitlabConnection(),
        planType: PlanType.ENTERPRISE_MANAGED,
        subscriptionStatus: SubscriptionStatus.CANCELED,
      },
    ]);
    (OrganizationLicenseRepository.findOne as jest.Mock).mockResolvedValue(workspace);

    await expect(
      OrganizationLicenseService.validateLicense("org-1", undefined as any),
    ).resolves.toMatchObject({ planType: PlanType.TEAMS_MANAGED });
  });

  it("answers for a single workspace row with no team without looping", async () => {
    findWorkspaces.mockResolvedValue([{ ...workspace, teamId: "" }]);
    findConnections.mockResolvedValue([]);
    (OrganizationLicenseRepository.findOne as jest.Mock).mockResolvedValue({
      ...workspace,
      teamId: "",
    });

    await expect(
      OrganizationLicenseService.validateLicense("org-1", undefined as any),
    ).resolves.toMatchObject({ planType: PlanType.TEAMS_MANAGED, valid: true });
  });

  it("keeps a single-workspace organization on its own row", async () => {
    findWorkspaces.mockResolvedValue([workspace]);
    findConnections.mockResolvedValue([]);
    (OrganizationLicenseRepository.findOne as jest.Mock).mockResolvedValue(workspace);

    await expect(
      OrganizationLicenseService.validateLicense("org-1", undefined as any),
    ).resolves.toMatchObject({ planType: PlanType.TEAMS_MANAGED, valid: true });
  });
});
