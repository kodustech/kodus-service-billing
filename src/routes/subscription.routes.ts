import { Router } from "express";
import { requireServiceToken } from "../config/utils/serviceToken";
import express from "express";
import { SubscriptionController } from "../controllers/SubscriptionController";
import { cacheMiddleware } from "../middlewares/cacheMiddleware";

const router: Router = Router();

/**
 * @openapi
 * /api/billing/trial:
 *   post:
 *     tags: [Billing]
 *     summary: Create trial license
 *     description: Creates a trial license for an organization and team.
 *     operationId: createTrial
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/CreateTrialRequestDto"
 *           example:
 *             organizationId: org_123
 *             teamId: team_456
 *             byok: false
 *     responses:
 *       "201":
 *         description: Trial license created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/OrganizationLicenseDto"
 *       "400":
 *         description: Invalid request payload.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.post("/trial", async (req, res) => {
  await SubscriptionController.createTrial(req, res);
});

/**
 * @openapi
 * /api/billing/create-checkout-session:
 *   post:
 *     tags: [Billing]
 *     summary: Create checkout session
 *     description: Creates a Stripe checkout session for subscriptions.
 *     operationId: createCheckoutSession
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/CreateCheckoutSessionRequestDto"
 *           example:
 *             organizationId: org_123
 *             teamId: team_456
 *             quantity: 5
 *             planType: teams_managed_legacy
 *     responses:
 *       "200":
 *         description: Checkout session created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/CheckoutSessionResponseDto"
 *       "400":
 *         description: Invalid request payload.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.post("/create-checkout-session", async (req, res) => {
  await SubscriptionController.createCheckoutSession(req, res);
});

/**
 * @openapi
 * /api/billing/webhook:
 *   post:
 *     tags: [Billing]
 *     summary: Handle Stripe webhook
 *     description: Receives Stripe webhook events.
 *     operationId: handleWebhook
 *     security: []
 *     parameters:
 *       - in: header
 *         name: stripe-signature
 *         required: true
 *         schema:
 *           type: string
 *         example: t=1710000000,v1=signature
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *           example:
 *             type: checkout.session.completed
 *             data:
 *               object:
 *                 id: cs_test_123
 *     responses:
 *       "200":
 *         description: Webhook processed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/WebhookResponseDto"
 *       "400":
 *         description: Invalid webhook.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.post("/webhook", async (req, res) => {
  await SubscriptionController.handleWebhook(req, res);
});

/**
 * @openapi
 * /api/billing/plans:
 *   get:
 *     tags: [Billing]
 *     summary: List plans
 *     description: Returns the current plan catalog with pricing.
 *     operationId: listPlans
 *     responses:
 *       "200":
 *         description: Plan catalog response.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/PlanCatalogDto"
 *       "400":
 *         description: Bad request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.get("/plans", async (req, res) => {
  await SubscriptionController.getPlans(req, res);
});

/**
 * @openapi
 * /api/billing/validate-org-license:
 *   get:
 *     tags: [Billing]
 *     summary: Validate organization license
 *     description: Validates the license for an organization and team.
 *     operationId: validateOrgLicense
 *     parameters:
 *       - in: query
 *         name: organizationId
 *         required: true
 *         schema:
 *           type: string
 *         example: org_123
 *       - in: query
 *         name: teamId
 *         required: false
 *         schema:
 *           type: string
 *         example: team_456
 *     responses:
 *       "200":
 *         description: License validation response.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ValidateLicenseResponseDto"
 *       "400":
 *         description: Invalid request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.get(
  "/validate-org-license",
  cacheMiddleware({ ttl: 15 * 60, keyPrefix: "org-license" }),
  async (req, res) => {
    // Intercepta o res.json para logar o resultado antes de enviar
    const originalJson = res.json;
    res.json = function (data) {
      console.log(
        `[License Check] Params: ${JSON.stringify(req.query)} | Result: ${JSON.stringify(data)}`,
      );
      return originalJson.call(this, data);
    };
    await SubscriptionController.validateLicense(req, res);
  },
);

/**
 * @openapi
 * /api/billing/trial-review-credit/consume:
 *   post:
 *     tags: [Billing]
 *     summary: Consume trial review credit
 *     description: Atomically consumes one Kodus-funded trial PR review credit. Supplying usageKey makes repeated calls for the same PR idempotent.
 *     operationId: consumeTrialReviewCredit
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/ConsumeTrialReviewCreditRequestDto"
 *           example:
 *             organizationId: org_123
 *             teamId: team_456
 *             usageKey: github:repo_123:42
 *     responses:
 *       "200":
 *         description: Credit consumed or previously consumed for this usage key.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ConsumeTrialReviewCreditResponseDto"
 *       "400":
 *         description: Invalid request payload.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "402":
 *         description: No trial credits remain or trial is not valid.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ConsumeTrialReviewCreditResponseDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.post("/trial-review-credit/consume", async (req, res) => {
  await SubscriptionController.consumeTrialReviewCredit(req, res);
});

/**
 * @openapi
 * /api/billing/trial-unlocks/recalculate:
 *   post:
 *     tags: [Billing]
 *     summary: Recalculate trial unlocks
 *     description: Applies automatic trial unlock signals once and returns the updated trial credit state.
 *     operationId: recalculateTrialUnlocks
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/RecalculateTrialUnlocksRequestDto"
 *           example:
 *             organizationId: org_123
 *             teamId: team_456
 *             signals:
 *               companyEmailVerified: true
 *               workspaceMembersCount: 3
 *               codeHostMembersCount: 12
 *     responses:
 *       "200":
 *         description: Trial unlocks recalculated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/RecalculateTrialUnlocksResponseDto"
 *       "400":
 *         description: Invalid request payload.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.post("/trial-unlocks/recalculate", async (req, res) => {
  await SubscriptionController.recalculateTrialUnlocks(req, res);
});

/**
 * @openapi
 * /api/billing/assign-license:
 *   post:
 *     tags: [Billing]
 *     summary: Assign licenses to users
 *     description: Assigns or updates license status for users in a team.
 *     operationId: assignLicense
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/AssignLicenseRequestDto"
 *           example:
 *             organizationId: org_123
 *             teamId: team_456
 *             users:
 *               - gitId: "123456"
 *                 gitTool: github
 *                 licenseStatus: active
 *     responses:
 *       "201":
 *         description: License assignment processed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/AssignLicenseResponseDto"
 *       "400":
 *         description: Invalid request payload.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.post("/assign-license", async (req, res) => {
  await SubscriptionController.assignLicense(req, res);
});

/**
 * @openapi
 * /api/billing/check-user-license:
 *   get:
 *     tags: [Billing]
 *     summary: Check user license
 *     description: Checks if a user has an active license.
 *     operationId: checkUserLicense
 *     parameters:
 *       - in: query
 *         name: organizationId
 *         required: true
 *         schema:
 *           type: string
 *         example: org_123
 *       - in: query
 *         name: gitId
 *         required: true
 *         schema:
 *           type: string
 *         example: "123456"
 *       - in: query
 *         name: teamId
 *         required: true
 *         schema:
 *           type: string
 *         example: team_456
 *     responses:
 *       "200":
 *         description: License check response.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/CheckUserLicenseResponseDto"
 *       "400":
 *         description: Invalid request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.get(
  "/check-user-license",
  cacheMiddleware({ ttl: 15 * 60, keyPrefix: "user-license" }),
  async (req, res) => {
    await SubscriptionController.checkUserLicense(req, res);
  },
);

/**
 * @openapi
 * /api/billing/users-with-license:
 *   get:
 *     tags: [Billing]
 *     summary: List users with licenses
 *     description: Returns users with active licenses for an organization.
 *     operationId: listUsersWithLicense
 *     parameters:
 *       - in: query
 *         name: organizationId
 *         required: true
 *         schema:
 *           type: string
 *         example: org_123
 *       - in: query
 *         name: teamId
 *         required: true
 *         schema:
 *           type: string
 *         example: team_456
 *     responses:
 *       "200":
 *         description: Users with licenses.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: "#/components/schemas/UserLicenseSummaryDto"
 *       "400":
 *         description: Invalid request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.get(
  "/users-with-license",
  cacheMiddleware({ ttl: 15 * 60, keyPrefix: "users-license" }),
  async (req, res) => {
    await SubscriptionController.getAllUsersWithLicense(req, res);
  },
);

/**
 * @openapi
 * /api/billing/portal/{organizationId}/{teamId}:
 *   get:
 *     tags: [Billing]
 *     summary: Get customer portal URL
 *     description: Returns Stripe customer portal URL for an organization.
 *     operationId: getCustomerPortalUrl
 *     parameters:
 *       - in: path
 *         name: organizationId
 *         required: true
 *         schema:
 *           type: string
 *         example: org_123
 *       - in: path
 *         name: teamId
 *         required: true
 *         schema:
 *           type: string
 *         example: team_456
 *     responses:
 *       "200":
 *         description: Customer portal URL.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/CustomerPortalResponseDto"
 *       "400":
 *         description: Invalid request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.get("/portal/:organizationId/:teamId", async (req, res) => {
  await SubscriptionController.getCustomerPortalUrl(req, res);
});

/**
 * @openapi
 * /api/billing/update-trial:
 *   post:
 *     tags: [Billing]
 *     summary: Update trial end date
 *     description: Updates the trial end date for an organization.
 *     operationId: updateTrial
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/UpdateTrialRequestDto"
 *           example:
 *             organizationId: org_123
 *             teamId: team_456
 *             trialEnd: 2024-12-31T23:59:59.000Z
 *             adminToken: admin-token
 *     responses:
 *       "200":
 *         description: Trial updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/OrganizationLicenseDto"
 *       "400":
 *         description: Invalid request payload.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.post("/update-trial", async (req, res) => {
  await SubscriptionController.updateTrial(req, res);
});

/**
 * @openapi
 * /api/billing/migrate-to-free:
 *   post:
 *     tags: [Billing]
 *     summary: Migrate to free plan
 *     description: Migrates an organization to the free plan.
 *     operationId: migrateToFreePlan
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/MigrateToFreeRequestDto"
 *           example:
 *             organizationId: org_123
 *             teamId: team_456
 *     responses:
 *       "200":
 *         description: Migration result.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/MigrateToFreeResponseDto"
 *       "400":
 *         description: Invalid request payload.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.post("/migrate-to-free", async (req, res) => {
  await SubscriptionController.migrateToFreePlan(req, res);
});

// ── Prepaid credits ("Kodus as the provider") ─────────────────────────────
//
// Every route below moves or reveals MONEY and takes the organizationId from
// the request, so they all sit behind the shared service token: the API's
// metering sweep and the web's server-side fetches send it, a browser never
// reaches them (the web proxy denies /credits/*). Fails closed when the
// secret is unset — see config/utils/serviceToken.ts.
router.use("/credits", requireServiceToken);

/**
 * @openapi
 * /api/billing/credits/balance:
 *   get:
 *     tags: [Billing]
 *     summary: Get prepaid credit balance
 *     description: Current prepaid-credit balance for an organization, plus the commercial parameters the UI needs (packs, markup, low threshold) and lifetime totals.
 *     operationId: getCreditBalance
 *     parameters:
 *       - in: query
 *         name: organizationId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: teamId
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Balance and parameters.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/CreditBalanceDto"
 *       "400":
 *         description: Missing organizationId.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "404":
 *         description: License not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.get("/credits/balance", async (req, res) => {
  await SubscriptionController.getCreditBalance(req, res);
});

/**
 * @openapi
 * /api/billing/credits/ledger:
 *   get:
 *     tags: [Billing]
 *     summary: List prepaid credit ledger entries
 *     description: Append-only ledger for an organization, newest first. Paginate with `before` (ISO timestamp of the last entry seen).
 *     operationId: listCreditLedger
 *     parameters:
 *       - in: query
 *         name: organizationId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *       - in: query
 *         name: before
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: types
 *         required: false
 *         description: Comma-separated entry types to keep (purchase, debit, adjustment, refund).
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: Ledger page.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/CreditLedgerPageDto"
 *       "400":
 *         description: Invalid request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.get("/credits/ledger", async (req, res) => {
  await SubscriptionController.listCreditLedger(req, res);
});

/**
 * @openapi
 * /api/billing/credits/checkout:
 *   post:
 *     tags: [Billing]
 *     summary: Create a Stripe checkout for a credit pack
 *     description: One-time Stripe Checkout (mode payment). The customer pays `creditUsd` plus the platform markup; the ledger is credited with `creditUsd` once Stripe reports the session paid.
 *     operationId: createCreditCheckout
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/CreditCheckoutRequestDto"
 *           example:
 *             organizationId: org_123
 *             teamId: team_456
 *             creditUsd: 100
 *     responses:
 *       "200":
 *         description: Checkout URL and the quoted charge.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/CreditCheckoutResponseDto"
 *       "400":
 *         description: Invalid amount or missing ids.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.post("/credits/checkout", async (req, res) => {
  await SubscriptionController.createCreditCheckout(req, res);
});

/**
 * @openapi
 * /api/billing/credits/auto-topup:
 *   post:
 *     tags: [Billing]
 *     summary: Configure automatic top-up of prepaid credits
 *     description: When enabled, a debit that leaves the balance at or below `thresholdUsd` charges the saved card for `amountUsd` of credit (plus the platform fee). Enabling requires a saved card (409 otherwise).
 *     operationId: updateCreditAutoTopUp
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/CreditAutoTopUpRequestDto"
 *     responses:
 *       "200":
 *         description: The saved settings.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/CreditAutoTopUpDto"
 *       "400":
 *         description: Invalid amount or threshold.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "404":
 *         description: License not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "409":
 *         description: No saved card (NO_PAYMENT_METHOD).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.post("/credits/auto-topup", async (req, res) => {
  await SubscriptionController.updateAutoTopUp(req, res);
});

/**
 * @openapi
 * /api/billing/credits/payment-method/checkout:
 *   post:
 *     tags: [Billing]
 *     summary: Start a Stripe Checkout (setup mode) to save a card for auto top-up
 *     operationId: createCreditPaymentMethodCheckout
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [organizationId, teamId]
 *             properties:
 *               organizationId: { type: string }
 *               teamId: { type: string }
 *     responses:
 *       "200":
 *         description: Hosted Checkout URL.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string }
 *       "400":
 *         description: Missing ids.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.post("/credits/payment-method/checkout", async (req, res) => {
  await SubscriptionController.createCreditPaymentMethodCheckout(req, res);
});

/**
 * @openapi
 * /api/billing/credits/payment-method:
 *   delete:
 *     tags: [Billing]
 *     summary: Forget the saved card (turns auto top-up off)
 *     operationId: removeCreditPaymentMethod
 *     parameters:
 *       - in: query
 *         name: organizationId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: teamId
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       "200":
 *         description: The resulting auto top-up state.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/CreditAutoTopUpDto"
 *       "404":
 *         description: License not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.delete("/credits/payment-method", async (req, res) => {
  await SubscriptionController.removeCreditPaymentMethod(req, res);
});

/**
 * @openapi
 * /api/billing/credits/debit:
 *   post:
 *     tags: [Billing]
 *     summary: Debit metered usage from prepaid credits
 *     description: Applies a batch of usage debits atomically. Each entry is idempotent on `usageKey` (a duplicate is skipped, never charged twice). The balance may go negative; the caller gates the NEXT review on it.
 *     operationId: debitCredits
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/CreditDebitRequestDto"
 *           example:
 *             organizationId: org_123
 *             teamId: team_456
 *             entries:
 *               - usageKey: span:66f1c0a2e4b0f3d1a2b3c4d5
 *                 amountUsd: 0.0421
 *                 metadata:
 *                   model: anthropic/claude-sonnet-5
 *                   correlationId: run_abc
 *                   prNumber: 42
 *     responses:
 *       "200":
 *         description: Batch outcome and the resulting balance.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/CreditDebitResponseDto"
 *       "400":
 *         description: Invalid request payload.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Forbidden.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "404":
 *         description: License not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.post("/credits/debit", async (req, res) => {
  await SubscriptionController.debitCredits(req, res);
});

/**
 * @openapi
 * /api/billing/credits/adjust:
 *   post:
 *     tags: [Billing]
 *     summary: Manually adjust prepaid credits (admin)
 *     description: Signed adjustment by Kodus (goodwill, correction). Requires the admin token in the body. Idempotent on `usageKey`.
 *     operationId: adjustCredits
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/CreditAdjustRequestDto"
 *           example:
 *             organizationId: org_123
 *             teamId: team_456
 *             amountUsd: 25
 *             usageKey: adjust:goodwill-2026-09
 *             reason: Goodwill after outage
 *             adminToken: "***"
 *     responses:
 *       "200":
 *         description: Adjustment outcome and the resulting balance.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/CreditAdjustResponseDto"
 *       "400":
 *         description: Invalid request payload.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "401":
 *         description: Unauthorized.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "403":
 *         description: Invalid admin token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "404":
 *         description: License not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 *       "500":
 *         description: Internal server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ApiErrorDto"
 */
router.post("/credits/adjust", async (req, res) => {
  await SubscriptionController.adjustCredits(req, res);
});

export default router;
