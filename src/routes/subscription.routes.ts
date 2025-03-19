import { Router } from "express";
import express from "express";
import { SubscriptionController } from "../controllers/SubscriptionController";
import { cacheMiddleware } from "../middlewares/cacheMiddleware";

const router = Router();

router.post("/trial", async (req, res) => {
  await SubscriptionController.createTrial(req, res);
});

router.post("/create-checkout-session", async (req, res) => {
  await SubscriptionController.createCheckoutSession(req, res);
});

router.post("/webhook", async (req, res) => {
  await SubscriptionController.handleWebhook(req, res);
});

router.get(
  "/validate-org-license",
  cacheMiddleware({ ttl: 15 * 60, keyPrefix: "org-license" }),
  async (req, res) => {
    await SubscriptionController.validateLicense(req, res);
  }
);

router.post("/assign-license", async (req, res) => {
  await SubscriptionController.assignLicense(req, res);
});

router.get(
  "/check-user-license",
  cacheMiddleware({ ttl: 15 * 60, keyPrefix: "user-license" }),
  async (req, res) => {
    await SubscriptionController.checkUserLicense(req, res);
  }
);

export default router;
