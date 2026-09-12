import path from "path";
import swaggerJSDoc from "swagger-jsdoc";
import { getDocsEnv } from "./env";

type ServerEntry = { url: string; description?: string };

function parseServerUrls(raw: string): ServerEntry[] {
  if (!raw) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, description] = entry.split("|").map((part) => part.trim());
      if (!url) return null;
      return description ? { url, description } : { url };
    })
    .filter(Boolean) as ServerEntry[];
}

export function buildOpenApiSpec() {
  const env = getDocsEnv();

  const servers = parseServerUrls(env.serverUrls);
  if (servers.length === 0) {
    const fallbackUrl = env.baseUrl || "https://qa.api.kodus.io";
    servers.push({ url: fallbackUrl, description: "Default" });
  }

  const definition = {
    openapi: "3.0.3",
    info: {
      title: "Kodus Billing API",
      version: "1.0.0",
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
      description:
        "Billing service API documentation for subscriptions, licenses, and Stripe integration.",
    },
    servers,
    tags: [
      { name: "Billing", description: "Subscription and license endpoints" },
      { name: "Health", description: "Service health endpoints" },
    ],
    security: [],
    components: {
      schemas: {
        ApiErrorDto: {
          type: "object",
          required: ["error"],
          properties: {
            error: { type: "string", example: "Validation error" },
            message: { type: "string", example: "Missing required field" },
            code: { type: "string", example: "VALIDATION_ERROR" },
            details: { type: "object", additionalProperties: true },
            timestamp: {
              type: "string",
              format: "date-time",
              example: "2024-01-01T12:00:00.000Z",
            },
          },
        },
        SubscriptionStatus: {
          type: "string",
          enum: ["trial", "active", "payment_failed", "canceled", "expired"],
        },
        PlanType: {
          type: "string",
          enum: [
            "free_byok",
            "teams_byok",
            "teams_byok_annual",
            "teams_managed",
            "teams_managed_annual",
            "teams_managed_legacy",
            "enterprise_byok",
            "enterprise_byok_annual",
            "enterprise_managed",
            "enterprise_managed_annual",
          ],
        },
        LicenseStatus: {
          type: "string",
          enum: ["active", "inactive"],
        },
        GitTool: {
          type: "string",
          enum: ["github", "gitlab", "bitbucket", "azure_repos"],
        },
        OrganizationLicenseDto: {
          type: "object",
          required: [
            "id",
            "organizationId",
            "teamId",
            "subscriptionStatus",
            "planType",
            "totalLicenses",
            "assignedLicenses",
            "createdAt",
            "updatedAt",
          ],
          properties: {
            id: { type: "string", format: "uuid" },
            organizationId: { type: "string", example: "org_123" },
            teamId: { type: "string", example: "team_456" },
            subscriptionStatus: { $ref: "#/components/schemas/SubscriptionStatus" },
            planType: { $ref: "#/components/schemas/PlanType" },
            trialEnd: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            stripeCustomerId: { type: "string", nullable: true },
            stripeSubscriptionId: { type: "string", nullable: true },
            byok: { type: "boolean", example: false },
            trialReviewCreditsTotal: {
              type: "integer",
              example: 5,
            },
            trialReviewCreditsUsed: { type: "integer", example: 1 },
            trialReviewCreditsRemaining: {
              type: "integer",
              example: 4,
            },
            trialCreditTier: { type: "string", example: "base" },
            trialUnlocks: {
              type: "array",
              items: {
                $ref: "#/components/schemas/TrialUnlockDto",
              },
            },
            totalLicenses: { type: "integer", example: 10 },
            assignedLicenses: { type: "integer", example: 5 },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        TrialUnlockDto: {
          type: "object",
          required: ["key", "status"],
          properties: {
            key: { type: "string", example: "code_org_10_plus" },
            status: {
              type: "string",
              enum: ["locked", "available", "completed", "claimed"],
              example: "locked",
            },
            rewardCredits: { type: "integer", example: 5 },
            title: { type: "string", example: "Connect a 10+ developer code org" },
            description: { type: "string" },
            completedAt: { type: "string", format: "date-time" },
          },
        },
        UserLicenseDto: {
          type: "object",
          required: [
            "id",
            "git_id",
            "licenseStatus",
            "git_tool",
            "assignedAt",
            "organizationLicenseId",
            "createdAt",
          ],
          properties: {
            id: { type: "string", format: "uuid" },
            git_id: { type: "string", example: "123456" },
            licenseStatus: { $ref: "#/components/schemas/LicenseStatus" },
            git_tool: { $ref: "#/components/schemas/GitTool" },
            assignedAt: { type: "string", format: "date-time" },
            organizationLicenseId: { type: "string", format: "uuid" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        AssignLicenseUserDto: {
          type: "object",
          required: ["gitId", "gitTool", "licenseStatus"],
          properties: {
            gitId: { type: "string", example: "123456" },
            gitTool: { $ref: "#/components/schemas/GitTool" },
            licenseStatus: { $ref: "#/components/schemas/LicenseStatus" },
          },
        },
        AssignLicenseRequestDto: {
          type: "object",
          required: ["organizationId", "teamId", "users"],
          properties: {
            organizationId: { type: "string", example: "org_123" },
            teamId: { type: "string", example: "team_456" },
            editedBy: { type: "string", example: "admin@kodus.io" },
            userName: { type: "string", example: "Admin User" },
            users: {
              type: "array",
              items: { $ref: "#/components/schemas/AssignLicenseUserDto" },
            },
          },
        },
        AssignLicenseFailedItemDto: {
          type: "object",
          required: ["user", "error"],
          properties: {
            user: { $ref: "#/components/schemas/AssignLicenseUserDto" },
            error: { type: "string", example: "Não há licenças disponíveis" },
          },
        },
        AssignLicenseResponseDto: {
          type: "object",
          required: ["successful", "failed"],
          properties: {
            successful: {
              type: "array",
              items: { $ref: "#/components/schemas/UserLicenseDto" },
            },
            failed: {
              type: "array",
              items: { $ref: "#/components/schemas/AssignLicenseFailedItemDto" },
            },
          },
        },
        CreateTrialRequestDto: {
          type: "object",
          required: ["organizationId", "teamId"],
          properties: {
            organizationId: { type: "string", example: "org_123" },
            teamId: { type: "string", example: "team_456" },
            byok: { type: "boolean", example: false },
          },
        },
        CreateCheckoutSessionRequestDto: {
          type: "object",
          required: ["organizationId", "quantity", "teamId"],
          properties: {
            organizationId: { type: "string", example: "org_123" },
            quantity: { type: "integer", example: 5 },
            teamId: { type: "string", example: "team_456" },
            planType: { $ref: "#/components/schemas/PlanType" },
          },
        },
        CheckoutSessionResponseDto: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", format: "uri" },
          },
        },
        WebhookResponseDto: {
          type: "object",
          required: ["received"],
          properties: {
            received: { type: "boolean", example: true },
          },
        },
        ValidateLicenseResponseDto: {
          type: "object",
          required: ["valid"],
          properties: {
            valid: { type: "boolean", example: true },
            subscriptionStatus: { $ref: "#/components/schemas/SubscriptionStatus" },
            planType: { $ref: "#/components/schemas/PlanType" },
            trialEnd: { type: "string", format: "date-time" },
            numberOfLicenses: { type: "integer", example: 20 },
            stripeCustomerId: { type: "string" },
            byok: { type: "boolean", example: false },
            trialReviewCreditsTotal: {
              type: "integer",
              example: 5,
            },
            trialReviewCreditsUsed: { type: "integer", example: 1 },
            trialReviewCreditsRemaining: {
              type: "integer",
              example: 4,
            },
            trialCreditTier: { type: "string", example: "base" },
            trialUnlocks: {
              type: "array",
              items: {
                $ref: "#/components/schemas/TrialUnlockDto",
              },
            },
            creditBalanceUsd: {
              type: "number",
              description:
                "Prepaid-credit balance (USD) for models routed by Kodus. May be negative after metered usage.",
              example: 42.517,
            },
          },
        },
        ConsumeTrialReviewCreditRequestDto: {
          type: "object",
          required: ["organizationId", "teamId"],
          properties: {
            organizationId: { type: "string", example: "org_123" },
            teamId: { type: "string", example: "team_456" },
            usageKey: {
              type: "string",
              example: "github:repo_123:42",
            },
          },
        },
        ConsumeTrialReviewCreditResponseDto: {
          type: "object",
          required: ["allowed"],
          properties: {
            allowed: { type: "boolean", example: true },
            reason: {
              type: "string",
              example: "TRIAL_REVIEW_CREDITS_EXHAUSTED",
            },
            alreadyConsumed: { type: "boolean", example: false },
            trialReviewCreditsTotal: {
              type: "integer",
              example: 5,
            },
            trialReviewCreditsUsed: { type: "integer", example: 1 },
            trialReviewCreditsRemaining: {
              type: "integer",
              example: 4,
            },
            trialCreditTier: { type: "string", example: "base" },
            trialUnlocks: {
              type: "array",
              items: {
                $ref: "#/components/schemas/TrialUnlockDto",
              },
            },
          },
        },
        CreditBalanceDto: {
          type: "object",
          required: [
            "balanceUsd",
            "lowThresholdUsd",
            "markupPct",
            "packsUsd",
            "minPurchaseUsd",
            "maxPurchaseUsd",
            "lifetimePurchasedUsd",
            "lifetimeDebitedUsd",
          ],
          properties: {
            balanceUsd: { type: "number", example: 42.517 },
            lowThresholdUsd: { type: "number", example: 5 },
            markupPct: { type: "number", example: 7 },
            packsUsd: {
              type: "array",
              items: { type: "number" },
              example: [20, 50, 100, 500],
            },
            minPurchaseUsd: { type: "number", example: 10 },
            maxPurchaseUsd: { type: "number", example: 5000 },
            lifetimePurchasedUsd: { type: "number", example: 100 },
            lifetimeDebitedUsd: { type: "number", example: 57.483 },
            lastPurchaseAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            autoTopUp: { $ref: "#/components/schemas/CreditAutoTopUpDto" },
          },
        },
        CreditAutoTopUpDto: {
          type: "object",
          required: ["enabled", "thresholdUsd", "amountUsd", "paymentMethod"],
          properties: {
            enabled: { type: "boolean" },
            thresholdUsd: { type: "number", nullable: true, example: 5 },
            amountUsd: { type: "number", nullable: true, example: 50 },
            paymentMethod: {
              type: "string",
              nullable: true,
              example: "Visa •••• 4242",
            },
            lastAt: { type: "string", format: "date-time", nullable: true },
            lastError: { type: "string", nullable: true },
          },
        },
        CreditAutoTopUpRequestDto: {
          type: "object",
          required: ["organizationId", "enabled"],
          properties: {
            organizationId: { type: "string" },
            teamId: { type: "string" },
            enabled: { type: "boolean" },
            thresholdUsd: { type: "number", example: 5 },
            amountUsd: { type: "number", example: 50 },
          },
        },
        CreditLedgerEntryDto: {
          type: "object",
          required: [
            "id",
            "organizationId",
            "type",
            "amountUsd",
            "balanceAfterUsd",
            "usageKey",
            "createdAt",
          ],
          properties: {
            id: { type: "string", format: "uuid" },
            organizationId: { type: "string" },
            teamId: { type: "string", nullable: true },
            type: {
              type: "string",
              enum: ["purchase", "debit", "adjustment", "refund"],
            },
            amountUsd: {
              type: "number",
              description: "Signed: purchases positive, debits negative.",
              example: -0.0421,
            },
            balanceAfterUsd: { type: "number", example: 42.517 },
            usageKey: { type: "string", example: "span:66f1c0a2e4b0f3d1a2b3c4d5" },
            metadata: { type: "object", additionalProperties: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        CreditLedgerPageDto: {
          type: "object",
          required: ["entries"],
          properties: {
            entries: {
              type: "array",
              items: { $ref: "#/components/schemas/CreditLedgerEntryDto" },
            },
          },
        },
        CreditCheckoutRequestDto: {
          type: "object",
          required: ["organizationId", "teamId", "creditUsd"],
          properties: {
            organizationId: { type: "string", example: "org_123" },
            teamId: { type: "string", example: "team_456" },
            creditUsd: {
              type: "number",
              description:
                "Credit amount to load (USD). A listed pack, or any amount within min/max.",
              example: 100,
            },
          },
        },
        CreditCheckoutResponseDto: {
          type: "object",
          required: ["url", "creditUsd", "chargeUsd", "markupPct"],
          properties: {
            url: { type: "string", format: "uri" },
            creditUsd: { type: "number", example: 100 },
            chargeUsd: { type: "number", example: 107 },
            markupPct: { type: "number", example: 7 },
          },
        },
        CreditDebitEntryDto: {
          type: "object",
          required: ["usageKey", "amountUsd"],
          properties: {
            usageKey: { type: "string", example: "span:66f1c0a2e4b0f3d1a2b3c4d5" },
            amountUsd: {
              type: "number",
              description: "List-price cost of the usage (USD, positive).",
              example: 0.0421,
            },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        CreditDebitRequestDto: {
          type: "object",
          required: ["organizationId", "entries"],
          properties: {
            organizationId: { type: "string", example: "org_123" },
            teamId: { type: "string", example: "team_456" },
            entries: {
              type: "array",
              maxItems: 500,
              items: { $ref: "#/components/schemas/CreditDebitEntryDto" },
            },
          },
        },
        CreditAdjustRequestDto: {
          type: "object",
          required: ["organizationId", "amountUsd", "usageKey", "reason", "adminToken"],
          properties: {
            organizationId: { type: "string", example: "org_123" },
            teamId: { type: "string", example: "team_456" },
            amountUsd: {
              type: "number",
              description: "Signed USD; positive credits, negative debits.",
              example: 25,
            },
            usageKey: { type: "string", example: "adjust:goodwill-2026-09" },
            reason: { type: "string", example: "Goodwill after outage" },
            adminToken: { type: "string" },
          },
        },
        CreditAdjustResponseDto: {
          type: "object",
          required: ["applied", "balanceUsd"],
          properties: {
            applied: { type: "boolean", example: true },
            balanceUsd: { type: "number", example: 67.5 },
          },
        },
        CreditDebitResponseDto: {
          type: "object",
          required: [
            "applied",
            "skipped",
            "appliedUsd",
            "balanceUsd",
            "lowBalance",
            "exhausted",
          ],
          properties: {
            applied: { type: "integer", example: 12 },
            skipped: {
              type: "integer",
              description: "Entries whose usageKey was already in the ledger.",
              example: 1,
            },
            appliedUsd: { type: "number", example: 0.5123 },
            balanceUsd: { type: "number", example: 41.9 },
            lowBalance: { type: "boolean", example: false },
            exhausted: { type: "boolean", example: false },
          },
        },
        TrialUnlockSignalsDto: {
          type: "object",
          properties: {
            companyEmailVerified: { type: "boolean", example: true },
            workspaceMembersCount: { type: "integer", example: 3 },
            codeHostMembersCount: { type: "integer", example: 12 },
            byok: { type: "boolean", example: false },
          },
        },
        RecalculateTrialUnlocksRequestDto: {
          type: "object",
          required: ["organizationId", "teamId"],
          properties: {
            organizationId: { type: "string", example: "org_123" },
            teamId: { type: "string", example: "team_456" },
            signals: { $ref: "#/components/schemas/TrialUnlockSignalsDto" },
          },
        },
        RecalculateTrialUnlocksResponseDto: {
          type: "object",
          required: ["valid"],
          properties: {
            valid: { type: "boolean", example: true },
            subscriptionStatus: { $ref: "#/components/schemas/SubscriptionStatus" },
            planType: { $ref: "#/components/schemas/PlanType" },
            trialEnd: { type: "string", format: "date-time" },
            byok: { type: "boolean", example: false },
            trialReviewCreditsTotal: { type: "integer", example: 35 },
            trialReviewCreditsUsed: { type: "integer", example: 1 },
            trialReviewCreditsRemaining: { type: "integer", example: 34 },
            trialCreditTier: { type: "string", example: "qualified" },
            trialUnlocks: {
              type: "array",
              items: {
                $ref: "#/components/schemas/TrialUnlockDto",
              },
            },
            appliedUnlocks: {
              type: "array",
              items: { type: "string" },
              example: ["company_email", "team_setup", "code_org_10_plus"],
            },
          },
        },
        CheckUserLicenseResponseDto: {
          type: "object",
          required: ["git_id", "isValid"],
          properties: {
            git_id: { type: "string", example: "123456" },
            isValid: { type: "boolean", example: true },
          },
        },
        UserLicenseSummaryDto: {
          type: "object",
          required: ["git_id"],
          properties: {
            git_id: { type: "string", example: "123456" },
          },
        },
        CustomerPortalResponseDto: {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string", format: "uri" },
          },
        },
        UpdateTrialRequestDto: {
          type: "object",
          required: ["organizationId", "teamId", "trialEnd", "adminToken"],
          properties: {
            organizationId: { type: "string", example: "org_123" },
            teamId: { type: "string", example: "team_456" },
            trialEnd: {
              type: "string",
              example: "2024-12-31T23:59:59.000Z",
            },
            adminToken: { type: "string", example: "admin-token" },
          },
        },
        MigrateToFreeRequestDto: {
          type: "object",
          required: ["organizationId", "teamId"],
          properties: {
            organizationId: { type: "string", example: "org_123" },
            teamId: { type: "string", example: "team_456" },
          },
        },
        MigrateToFreeResponseDto: {
          type: "object",
          required: ["success", "license"],
          properties: {
            success: { type: "boolean", example: true },
            license: { $ref: "#/components/schemas/OrganizationLicenseDto" },
          },
        },
        PricingOptionDto: {
          type: "object",
          required: [
            "planType",
            "priceId",
            "currency",
            "interval",
            "intervalCount",
            "amount",
            "formattedAmount",
          ],
          properties: {
            planType: { $ref: "#/components/schemas/PlanType" },
            priceId: { type: "string", example: "price_123" },
            currency: { type: "string", example: "usd" },
            interval: { type: "string", example: "month" },
            intervalCount: { type: "integer", example: 1 },
            amount: { type: "number", example: 49.9 },
            formattedAmount: { type: "string", example: "$49.90" },
          },
        },
        CatalogEntryDto: {
          type: "object",
          required: ["id", "label", "type", "features", "pricing"],
          properties: {
            id: { type: "string", example: "teams_managed" },
            aliases: { type: "array", items: { type: "string" } },
            label: { type: "string", example: "Teams Managed" },
            description: { type: "string", example: "Managed plan" },
            type: { type: "string", example: "plan" },
            minimumSeats: { type: "integer", example: 5 },
            features: { type: "array", items: { type: "string" } },
            addonIds: { type: "array", items: { type: "string" } },
            pricing: {
              type: "array",
              items: { $ref: "#/components/schemas/PricingOptionDto" },
            },
          },
        },
        PlanWithAddonsDto: {
          allOf: [
            { $ref: "#/components/schemas/CatalogEntryDto" },
            {
              type: "object",
              required: ["addons"],
              properties: {
                addons: {
                  type: "array",
                  items: { $ref: "#/components/schemas/CatalogEntryDto" },
                },
              },
            },
          ],
        },
        PlanCatalogDto: {
          type: "object",
          required: ["plans", "addons"],
          properties: {
            plans: {
              type: "array",
              items: { $ref: "#/components/schemas/PlanWithAddonsDto" },
            },
            addons: {
              type: "array",
              items: { $ref: "#/components/schemas/CatalogEntryDto" },
            },
          },
        },
        HealthResponseDto: {
          type: "object",
          required: ["status", "timestamp", "uptime"],
          properties: {
            status: { type: "string", example: "ok" },
            timestamp: { type: "string", format: "date-time" },
            uptime: { type: "number", example: 123.45 },
          },
        },
        HealthReadyResponseDto: {
          type: "object",
          required: ["status", "timestamp", "dependencies"],
          properties: {
            status: { type: "string", example: "ready" },
            timestamp: { type: "string", format: "date-time" },
            dependencies: {
              type: "object",
              required: ["database", "stripe"],
              properties: {
                database: { type: "string", example: "connected" },
                stripe: { type: "string", example: "configured" },
              },
            },
          },
        },
      },
    },
  };

  return swaggerJSDoc({
    definition,
    apis: [
      path.join(process.cwd(), "src", "routes", "**", "*.ts"),
      path.join(process.cwd(), "src", "index.ts"),
    ],
  });
}
