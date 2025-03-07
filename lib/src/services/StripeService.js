"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StripeService = void 0;
const stripe_1 = __importDefault(require("stripe"));
require("dotenv/config");
const OrganizationLicenseRepository_1 = require("../repositories/OrganizationLicenseRepository");
const OrganizationLicense_1 = require("../entities/OrganizationLicense");
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY || "");
class StripeService {
    static async createCheckoutSession(organizationId, quantity) {
        const license = await OrganizationLicenseRepository_1.OrganizationLicenseRepository.findOne({
            where: { organizationId },
        });
        if (!license) {
            throw new Error("Organização não encontrada");
        }
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [
                {
                    price: process.env.STRIPE_PRICE_ID,
                    quantity: quantity,
                },
            ],
            mode: "subscription",
            success_url: `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL}/subscription/cancel`,
            client_reference_id: organizationId,
            metadata: {
                organizationId: organizationId,
                licenseId: license.id,
            },
        });
        return session.url || "";
    }
    static async handleWebhookEvent(event) {
        switch (event.type) {
            case "checkout.session.completed":
                await this.handleCheckoutSessionCompleted(event.data.object);
                break;
            case "invoice.payment_failed":
                await this.handlePaymentFailed(event.data.object);
                break;
            case "customer.subscription.deleted":
                await this.handleSubscriptionCanceled(event.data.object);
                break;
            default:
                console.log(`Evento não manipulado: ${event.type}`);
        }
    }
    static async handleCheckoutSessionCompleted(session) {
        if (!session.metadata?.organizationId)
            return;
        const organizationId = session.metadata.organizationId;
        const license = await OrganizationLicenseRepository_1.OrganizationLicenseRepository.findOne({
            where: { organizationId },
        });
        if (!license)
            return;
        license.subscriptionStatus = OrganizationLicense_1.SubscriptionStatus.ACTIVE;
        license.stripeCustomerId = session.customer;
        license.stripeSubscriptionId = session.subscription;
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
        if (lineItems.data.length > 0) {
            license.totalLicenses = lineItems.data[0].quantity || 0;
        }
        await OrganizationLicenseRepository_1.OrganizationLicenseRepository.save(license);
    }
    static async handlePaymentFailed(invoice) {
        if (!invoice.subscription)
            return;
        const license = await OrganizationLicenseRepository_1.OrganizationLicenseRepository.findOne({
            where: { stripeSubscriptionId: invoice.subscription },
        });
        if (!license)
            return;
        license.subscriptionStatus = OrganizationLicense_1.SubscriptionStatus.PAYMENT_FAILED;
        await OrganizationLicenseRepository_1.OrganizationLicenseRepository.save(license);
    }
    static async handleSubscriptionCanceled(subscription) {
        const license = await OrganizationLicenseRepository_1.OrganizationLicenseRepository.findOne({
            where: { stripeSubscriptionId: subscription.id },
        });
        if (!license)
            return;
        license.subscriptionStatus = OrganizationLicense_1.SubscriptionStatus.CANCELED;
        await OrganizationLicenseRepository_1.OrganizationLicenseRepository.save(license);
    }
}
exports.StripeService = StripeService;
//# sourceMappingURL=StripeService.js.map