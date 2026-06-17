import { MigrationInterface, QueryRunner } from "typeorm";

type TrialUnlock = {
  key: string;
  status?: string;
  rewardCredits?: number;
  title?: string;
  description?: string;
  completedAt?: string;
};

const defaultUnlocks: TrialUnlock[] = [
  {
    key: "company_email",
    status: "locked",
    rewardCredits: 5,
    title: "Use a company email",
    description:
      "A confirmed work email helps us qualify the trial automatically.",
  },
  {
    key: "team_setup",
    status: "locked",
    rewardCredits: 5,
    title: "Invite 3 teammates",
    description: "Add teammates so the trial reflects a real review workflow.",
  },
  {
    key: "code_org_10_plus",
    status: "locked",
    rewardCredits: 20,
    title: "Connect a 10+ developer code org",
    description:
      "Connect the organization, not only a personal account, so we can evaluate team fit.",
  },
  {
    key: "byok",
    status: "available",
    title: "Connect BYOK",
    description: "Use your own AI key. Reviews no longer use Kodus-paid PRs.",
  },
  {
    key: "manual_extension",
    status: "available",
    title: "Request more trial PR reviews",
    description:
      "Ask Kodus to review your trial signals and extend the evaluation manually.",
  },
];

const mergeUnlocks = (rawUnlocks: TrialUnlock[] = []) => {
  const byKey = new Map(rawUnlocks.map((unlock) => [unlock.key, unlock]));
  const multiAuthor = byKey.get("multi_author_review");
  const manual = byKey.get("manual");

  if (multiAuthor && !byKey.has("code_org_10_plus")) {
    byKey.set("code_org_10_plus", {
      ...multiAuthor,
      key: "code_org_10_plus",
    });
  }

  if (manual && !byKey.has("manual_extension")) {
    byKey.set("manual_extension", {
      ...manual,
      key: "manual_extension",
    });
  }

  return defaultUnlocks.map((defaultUnlock) => {
    const existingUnlock = byKey.get(defaultUnlock.key);

    return {
      ...defaultUnlock,
      ...existingUnlock,
      title: defaultUnlock.title,
      description: defaultUnlock.description,
      rewardCredits:
        defaultUnlock.rewardCredits ?? existingUnlock?.rewardCredits,
    };
  });
};

export class UpdateTrialUnlockSignals1781542000000 implements MigrationInterface {
  name = "UpdateTrialUnlockSignals1781542000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const schema =
      (queryRunner.connection.options as { schema?: string }).schema ??
      "billing";
    const tableName = `"${schema}"."organization_licenses"`;
    const rows = await queryRunner.query(
      `SELECT id, "trialUnlocks" FROM ${tableName} WHERE "subscriptionStatus" = 'trial'`,
    );

    for (const row of rows) {
      await queryRunner.query(
        `UPDATE ${tableName} SET "trialUnlocks" = $1::jsonb WHERE id = $2`,
        [JSON.stringify(mergeUnlocks(row.trialUnlocks ?? [])), row.id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const schema =
      (queryRunner.connection.options as { schema?: string }).schema ??
      "billing";
    const tableName = `"${schema}"."organization_licenses"`;
    await queryRunner.query(
      `UPDATE ${tableName} SET "trialUnlocks" = '[]'::jsonb WHERE "subscriptionStatus" = 'trial'`,
    );
  }
}
