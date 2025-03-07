import Stripe from "stripe";
import "dotenv/config";
export declare class StripeService {
    static createCheckoutSession(organizationId: string, quantity: number): Promise<string>;
    static handleWebhookEvent(event: Stripe.Event): Promise<void>;
    private static handleCheckoutSessionCompleted;
    private static handlePaymentFailed;
    private static handleSubscriptionCanceled;
}
