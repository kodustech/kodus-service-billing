import "reflect-metadata";

jest.mock("../services/OrganizationLicenseService", () => ({
  OrganizationLicenseService: {
    validateLicense: jest.fn(async () => ({ valid: true })),
    assignLicensesToUsers: jest.fn(async () => ({ successful: [], failed: [] })),
    checkUserLicense: jest.fn(async () => ({ isValid: true })),
    getAllUsersWithLicense: jest.fn(async () => []),
  },
}));
jest.mock("../services/StripeService", () => ({
  StripeService: { createCheckoutSession: jest.fn(async () => "https://stripe") },
}));
jest.mock("../services/ConnectionLicenseService", () => ({
  ConnectionLicenseService: {
    bindPrimary: jest.fn(async () => ({ found: true, primaryConnectionId: "gh-a" })),
    release: jest.fn(async () => ({ released: true })),
    resolve: jest.fn(),
    describe: jest.fn(() => ({ valid: true, connectionId: "gl-b" })),
    listForWorkspace: jest.fn(async () => [{ connectionId: "gl-b" }]),
  },
}));
jest.mock("../services/PlanCatalogService", () => ({ PlanCatalogService: {} }));
jest.mock("../services/AutoTopUpService", () => ({ AutoTopUpService: {} }));
jest.mock("../services/CreditService", () => ({ CreditService: {} }));

import { SubscriptionController } from "./SubscriptionController";
import { OrganizationLicenseService } from "../services/OrganizationLicenseService";
import { StripeService } from "../services/StripeService";
import { ConnectionLicenseService } from "../services/ConnectionLicenseService";

const response = () => {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe("connection-aware billing routes", () => {
  it("validates the named connection's licence", async () => {
    await SubscriptionController.validateLicense(
      { query: { organizationId: "org-1", teamId: "team-1", connectionId: "gl-b" } } as any,
      response(),
    );

    expect(OrganizationLicenseService.validateLicense).toHaveBeenCalledWith(
      "org-1",
      "team-1",
      "gl-b",
    );
  });

  it("assigns seats on the named connection", async () => {
    await SubscriptionController.assignLicense(
      {
        body: {
          organizationId: "org-1",
          teamId: "team-1",
          connectionId: "gl-b",
          users: [{ gitId: "1", gitTool: "gitlab", gitHost: "gitlab.com", licenseStatus: "active" }],
        },
      } as any,
      response(),
    );

    expect(OrganizationLicenseService.assignLicensesToUsers).toHaveBeenCalledWith(
      "org-1",
      "team-1",
      [expect.objectContaining({ gitHost: "gitlab.com" })],
      "gl-b",
    );
  });

  it("checks and lists seats of the named connection", async () => {
    await SubscriptionController.checkUserLicense(
      { query: { organizationId: "org-1", teamId: "team-1", gitId: "1", connectionId: "gl-b" } } as any,
      response(),
    );
    await SubscriptionController.getAllUsersWithLicense(
      { query: { organizationId: "org-1", teamId: "team-1", connectionId: "gl-b" } } as any,
      response(),
    );

    expect(OrganizationLicenseService.checkUserLicense).toHaveBeenCalledWith(
      "org-1",
      "1",
      "team-1",
      "gl-b",
    );
    expect(OrganizationLicenseService.getAllUsersWithLicense).toHaveBeenCalledWith(
      "org-1",
      "team-1",
      "gl-b",
    );
  });

  it("opens checkout for the named connection", async () => {
    await SubscriptionController.createCheckoutSession(
      {
        body: {
          organizationId: "org-1",
          teamId: "team-1",
          quantity: 2,
          planType: "teams_byok",
          connectionId: "gl-b",
        },
      } as any,
      response(),
    );

    expect(StripeService.createCheckoutSession).toHaveBeenCalledWith(
      "org-1",
      2,
      "team-1",
      "teams_byok",
      "gl-b",
    );
  });

  it("binds a workspace's primary connection", async () => {
    const res = response();
    await SubscriptionController.bindPrimaryConnection(
      { body: { organizationId: "org-1", teamId: "team-1", connectionId: "gh-a" } } as any,
      res,
    );

    expect(ConnectionLicenseService.bindPrimary).toHaveBeenCalledWith(
      "org-1",
      "team-1",
      "gh-a",
    );
    expect(res.json).toHaveBeenCalledWith({ found: true, primaryConnectionId: "gh-a" });
  });

  it("refuses to bind or release without a connection", async () => {
    const bind = response();
    const release = response();
    await SubscriptionController.bindPrimaryConnection(
      { body: { organizationId: "org-1", teamId: "team-1" } } as any,
      bind,
    );
    await SubscriptionController.releaseConnection(
      { body: { organizationId: "org-1", connectionId: "gh-a" } } as any,
      release,
    );

    expect(bind.status).toHaveBeenCalledWith(400);
    expect(release.status).toHaveBeenCalledWith(400);
  });

  it("releases a removed connection", async () => {
    await SubscriptionController.releaseConnection(
      { body: { organizationId: "org-1", teamId: "team-1", connectionId: "gh-a" } } as any,
      response(),
    );

    expect(ConnectionLicenseService.release).toHaveBeenCalledWith(
      "org-1",
      "team-1",
      "gh-a",
    );
  });

  it("lists the workspace's connection licences with their effective plan", async () => {
    (ConnectionLicenseService.resolve as jest.Mock).mockResolvedValue({
      workspace: { id: "lic-1", primaryConnectionId: "gh-a" },
      connection: null,
    });
    const res = response();

    await SubscriptionController.listConnectionLicenses(
      { query: { organizationId: "org-1", teamId: "team-1" } } as any,
      res,
    );

    expect(res.json).toHaveBeenCalledWith({
      primaryConnectionId: "gh-a",
      connections: [{ valid: true, connectionId: "gl-b" }],
    });
  });
});
