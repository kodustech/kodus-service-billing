const schedule = jest.fn();
const resume = jest.fn();
jest.mock("node-cron", () => ({ __esModule: true, default: { schedule } }));
jest.mock("../services/AutoTopUpService", () => ({
  AutoTopUpService: {
    resumeCappedWallets: (...args: unknown[]) => resume(...args),
  },
}));
jest.mock("../services/OrganizationLicenseService", () => ({
  OrganizationLicenseService: {},
}));
jest.mock("../services/KodusNotificationClient", () => ({
  KodusNotificationClient: {},
}));

describe("monthly auto top-up resumption schedule", () => {
  let tick: () => Promise<void>;
  beforeAll(() => {
    require("./index");
    const registration = schedule.mock.calls.find(
      ([expression]) => expression === "*/5 * * * *",
    );
    expect(registration?.[2]).toEqual({ timezone: "UTC", noOverlap: true });
    tick = registration![1];
  });
  beforeEach(() => resume.mockReset());

  it("checks capped wallets without waiting for another review", async () => {
    resume.mockResolvedValue(undefined);
    await tick();
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("contains failures so the next scheduled attempt can run", async () => {
    const log = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      resume.mockRejectedValueOnce(new Error("database unavailable"));
      await expect(tick()).resolves.toBeUndefined();
      resume.mockResolvedValueOnce(undefined);
      await tick();
      expect(resume).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
