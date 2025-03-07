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

router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    await SubscriptionController.handleWebhook(req, res);
  }
);

router.post("/validate-token", async (req, res) => {
  await SubscriptionController.validateCloudToken(req, res);
});

export default router;
