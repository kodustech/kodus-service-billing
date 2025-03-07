"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionController = void 0;
const OrganizationLicenseService_1 = require("../services/OrganizationLicenseService");
const StripeService_1 = require("../services/StripeService");
const stripe_1 = __importDefault(require("stripe"));
class SubscriptionController {
    static async createTrial(req, res) {
        try {
            const { organizationId } = req.body;
            if (!organizationId) {
                return res
                    .status(400)
                    .json({ error: "ID da organização é obrigatório" });
            }
            const license = await OrganizationLicenseService_1.OrganizationLicenseService.createTrialLicense(organizationId);
            return res.status(201).json(license);
        }
        catch (error) {
            console.error("Erro ao criar trial:", error);
            return res.status(500).json({ error: "Erro ao criar licença trial" });
        }
    }
    static async createCheckoutSession(req, res) {
        try {
            const { organizationId, quantity } = req.body;
            if (!organizationId || !quantity) {
                return res
                    .status(400)
                    .json({ error: "ID da organização e quantidade são obrigatórios" });
            }
            const checkoutUrl = await StripeService_1.StripeService.createCheckoutSession(organizationId, quantity);
            return res.json({ url: checkoutUrl });
        }
        catch (error) {
            console.error("Erro ao criar sessão de checkout:", error);
            return res
                .status(500)
                .json({ error: "Erro ao criar sessão de checkout" });
        }
    }
    static async handleWebhook(req, res) {
        const sig = req.headers["stripe-signature"];
        if (!sig) {
            return res.status(400).json({ error: "Stripe signature missing" });
        }
        try {
            const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY || "");
            const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || "");
            await StripeService_1.StripeService.handleWebhookEvent(event);
            return res.json({ received: true });
        }
        catch (error) {
            console.error("Webhook error:", error);
            return res.status(400).json({ error: "Webhook error" });
        }
    }
    static async validateCloudToken(req, res) {
        try {
            const { organizationId, cloudToken } = req.body;
            if (!organizationId || !cloudToken) {
                return res
                    .status(400)
                    .json({ error: "ID da organização e cloudToken são obrigatórios" });
            }
            const isValid = await OrganizationLicenseService_1.OrganizationLicenseService.validateCloudToken(organizationId, cloudToken);
            return res.json({ valid: isValid });
        }
        catch (error) {
            console.error("Erro ao validar token:", error);
            return res.status(500).json({ error: "Erro ao validar token" });
        }
    }
}
exports.SubscriptionController = SubscriptionController;
//# sourceMappingURL=SubscriptionController.js.map