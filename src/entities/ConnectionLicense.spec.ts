import "reflect-metadata";
import { getMetadataArgsStorage, QueryRunner } from "typeorm";

import { ConnectionLicense } from "./ConnectionLicense";
import { AddConnectionLicenses1795600000000 } from "../migrations/1795600000000-AddConnectionLicenses";

const PLAN_TYPE_ENUM = "organization_licenses_plantype_enum";
const SUBSCRIPTION_STATUS_ENUM = "organization_licenses_subscriptionstatus_enum";

const columnOptions = (propertyName: string) =>
  getMetadataArgsStorage().columns.find(
    (column) =>
      column.target === ConnectionLicense && column.propertyName === propertyName,
  )?.options;

const queriesOf = async (direction: "up" | "down"): Promise<string[]> => {
  const queries: string[] = [];
  const runner = {
    query: async (sql: string) => {
      queries.push(sql.replace(/\s+/g, " ").trim());
    },
  } as unknown as QueryRunner;
  await new AddConnectionLicenses1795600000000()[direction](runner);
  return queries;
};

describe("connection licences share the workspace licence's enum types", () => {
  it("maps plan type and subscription status onto the organization_licenses enum types", () => {
    expect(columnOptions("planType")?.enumName).toBe(PLAN_TYPE_ENUM);
    expect(columnOptions("subscriptionStatus")?.enumName).toBe(
      SUBSCRIPTION_STATUS_ENUM,
    );
  });

  it("creates the table on the existing enum types, adding none of its own", async () => {
    const queries = await queriesOf("up");
    const table = queries.find((sql) =>
      sql.startsWith('CREATE TABLE "billing"."connection_licenses"'),
    );

    expect(queries.filter((sql) => sql.startsWith("CREATE TYPE"))).toEqual([]);
    expect(table).toContain(
      `"subscriptionStatus" "billing"."${SUBSCRIPTION_STATUS_ENUM}" NOT NULL DEFAULT 'active'`,
    );
    expect(table).toContain(
      `"planType" "billing"."${PLAN_TYPE_ENUM}" NOT NULL DEFAULT 'free_byok'`,
    );
  });

  it("drops the table on down and leaves the shared enum types to organization_licenses", async () => {
    const queries = await queriesOf("down");

    expect(queries).toContain('DROP TABLE "billing"."connection_licenses"');
    expect(queries.filter((sql) => sql.startsWith("DROP TYPE"))).toEqual([]);
  });
});
