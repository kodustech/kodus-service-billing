"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_2 = __importDefault(require("express"));
const SubscriptionController_1 = require("../controllers/SubscriptionController");
const router = (0, express_1.Router)();
router.post("/trial", async (req, res) => {
    await SubscriptionController_1.SubscriptionController.createTrial(req, res);
});
router.post("/create-checkout-session", async (req, res) => {
    await SubscriptionController_1.SubscriptionController.createCheckoutSession(req, res);
});
router.post("/webhook", express_2.default.raw({ type: "application/json" }), async (req, res) => {
    await SubscriptionController_1.SubscriptionController.handleWebhook(req, res);
});
router.post("/validate-token", async (req, res) => {
    await SubscriptionController_1.SubscriptionController.validateCloudToken(req, res);
});
exports.default = router;
//# sourceMappingURL=subscription.routes.js.map