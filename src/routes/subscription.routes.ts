import { Router } from "express";
import express from "express";
import { SubscriptionController } from "../controllers/SubscriptionController";

const router = Router();

router.post("/trial", async (req, res) => {
  await SubscriptionController.createTrial(req, res);
});

router.post("/create-checkout-session", async (req, res) => {
  await SubscriptionController.createCheckoutSession(req, res);
});

// Rota de webhook do Stripe
router.post("/webhook", async (req, res) => {
  await SubscriptionController.handleWebhook(req, res);
});

router.post("/validate-token", async (req, res) => {
  await SubscriptionController.validateCloudToken(req, res);
});

export default router;
