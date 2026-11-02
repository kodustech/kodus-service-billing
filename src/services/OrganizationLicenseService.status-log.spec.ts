import "reflect-metadata";

import { createHmac } from "crypto";

jest.mock("../config/database", () => ({ AppDataSource: {} }));
jest.mock("../repositories/OrganizationLicenseRepository", () => ({
  OrganizationLicenseRepository: {},
}));
jest.mock("../repositories/UserLicenseRepository", () => ({
  UserLicenseRepository: {},
}));
jest.mock("../config/utils/cache", () => ({ clearCacheByPrefix: jest.fn() }));
jest.mock("../config/utils/urlBuilder", () => ({
  buildLogApiUrl: (path: string) => `https://api.kodus.io${path}`,
}));
jest.mock("axios", () => {
  const mock = { post: jest.fn() };
  return { __esModule: true, default: mock, ...mock };
});

import axios from "axios";

import { OrganizationLicenseService } from "./OrganizationLicenseService";
import { UserLicense } from "../entities/UserLicense";

const post = axios.post as jest.Mock;
const SECRET = "test-secret";
const PATH = "/user-log/status-change";

/**
 * The kodus-ai API only accepts /user-log/status-change when it is signed
 * with the shared billing secret, the same scheme as /billing/events:
 * HMAC-SHA256 over `POST\n<path>\n<query>\n<timestamp>\n<raw body>`.
 */
describe("OrganizationLicenseService.notifyUserStatusChanges", () => {
  const license = {
    git_id: "42",
    git_tool: "github",
    licenseStatus: "active",
  } as unknown as UserLicense;

  beforeEach(() => {
    post.mockReset().mockResolvedValue({ status: 201 });
    process.env.KODUS_NOTIFICATION_WEBHOOK_SECRET = SECRET;
  });

  afterAll(() => {
    delete process.env.KODUS_NOTIFICATION_WEBHOOK_SECRET;
  });

  it("signs the request over the exact bytes it sends", async () => {
    await OrganizationLicenseService.notifyUserStatusChanges(
      [license],
      "org-1",
      "team-1",
      { email: "admin@example.com", userId: "u-1" },
      "someone",
    );

    expect(post).toHaveBeenCalledTimes(1);
    const [url, rawBody, config] = post.mock.calls[0];
    expect(url).toBe(`https://api.kodus.io${PATH}`);
    expect(typeof rawBody).toBe("string");
    expect(JSON.parse(rawBody)).toMatchObject({
      organizationId: "org-1",
      gitId: "42",
    });

    const timestamp = config.headers["x-kodus-timestamp"];
    const expected = createHmac("sha256", SECRET)
      .update(["POST", PATH, "", timestamp, rawBody].join("\n"))
      .digest("hex");
    expect(config.headers["x-kodus-signature"]).toBe(expected);
  });

  it("fails loudly instead of sending an unsigned request without a secret", async () => {
    delete process.env.KODUS_NOTIFICATION_WEBHOOK_SECRET;

    await expect(
      OrganizationLicenseService.notifyUserStatusChanges(
        [license],
        "org-1",
        "team-1",
        { email: "admin@example.com", userId: "u-1" },
        "someone",
      ),
    ).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
});
