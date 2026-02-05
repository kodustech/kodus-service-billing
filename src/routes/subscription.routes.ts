import { Router } from "express";
import express from "express";
import { SubscriptionController } from "../controllers/SubscriptionController";
import { cacheMiddleware } from "../middlewares/cacheMiddleware";

const router = Router();

/**
 * @openapi
 * /api/billing/trial:
 *   post:
 *     tags: [Billing]
 *     summary: Create trial license
 *     description: Creates a trial license for an organization and team.
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
 *     security: []
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
 * /api/billing/assign-license:
 *   post:
 *     tags: [Billing]
 *     summary: Assign licenses to users
 *     description: Assigns or updates license status for users in a team.
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

export default router;
