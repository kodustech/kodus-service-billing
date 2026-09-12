import Stripe from "stripe";
import "dotenv/config";
import { OrganizationLicenseRepository } from "../repositories/OrganizationLicenseRepository";
import { SubscriptionStatus, PlanType } from "../entities/OrganizationLicense";
import { clearCacheByPrefix } from "../config/utils/cache";
import { getPlanTypeByPriceId, getPriceIdForPlan } from "../config/planPricing";
import { KodusNotificationClient } from "./KodusNotificationClient";
import { CreditService } from "./CreditService";
import { AutoTopUpService } from "./AutoTopUpService";
import { chargeForCredit, CREDITS_MARKUP_PCT } from "../config/creditPricing";
import { OrganizationLicense } from "../entities/OrganizationLicense";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

export class StripeService {
  // Criar sessão de checkout para assinatura
  static async createCheckoutSession(
    organizationId: string,
    quantity: number,
    teamId: string,
    planType: PlanType = PlanType.TEAMS_MANAGED_LEGACY
  ): Promise<string> {
    // Buscar a licença da organização
    const license = await OrganizationLicenseRepository.findOne({
      where: { organizationId },
    });

    if (!license) {
      throw new Error("Organização não encontrada");
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: getPriceIdForPlan(planType),
          quantity: quantity,
          adjustable_quantity: {
            enabled: true,
            minimum: 1,
          },
        },
      ],
      mode: "subscription",
      allow_promotion_codes: true,
      success_url: `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/subscription/cancel`,
      client_reference_id: organizationId,
      metadata: {
        organizationId: organizationId,
        teamId: teamId,
        licenseId: license.id,
        planType: planType,
      },
    });

    return session.url || "";
  }

  /**
   * One-time Checkout for a prepaid credit pack ("Kodus as the provider").
   * The customer pays `creditUsd` plus the markup; the ledger is credited with
   * `creditUsd` (list-price USD) when `checkout.session.completed` arrives.
   * Ad-hoc `price_data` so packs need no Stripe Price ids in env; the metadata
   * `kind` is what the shared webhook handler branches on.
   */
  static async createCreditCheckoutSession(
    organizationId: string,
    teamId: string,
    creditUsd: number
  ): Promise<string> {
    const license = await OrganizationLicenseRepository.findOne({
      where: { organizationId, teamId },
    });

    if (!license) {
      throw new Error("Organização não encontrada");
    }

    const chargeUsd = chargeForCredit(creditUsd);
    const unitAmount = Math.round(chargeUsd * 100);
    const label = `Kodus credits — $${creditUsd.toFixed(2)}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            product_data: {
              name: label,
              description: `Prepaid credits for AI models routed by Kodus. Includes a ${CREDITS_MARKUP_PCT}% platform fee.`,
            },
          },
        },
      ],
      // Attach to the existing customer so the receipt and the portal line
      // up with the subscription; otherwise let Checkout create one and the
      // webhook stores it.
      ...(license.stripeCustomerId
        ? { customer: license.stripeCustomerId }
        : { customer_creation: "always" as const }),
      success_url: `${process.env.FRONTEND_URL}/byok?credits=success&session_id={CHECKOUT_SESSION_ID}#kodus`,
      cancel_url: `${process.env.FRONTEND_URL}/byok?credits=cancel#kodus`,
      client_reference_id: organizationId,
      metadata: {
        kind: "credit_pack",
        organizationId,
        teamId,
        licenseId: license.id,
        creditUsd: String(creditUsd),
        chargeUsd: String(chargeUsd),
        markupPct: String(CREDITS_MARKUP_PCT),
      },
      // Stripe does NOT copy session metadata onto the PaymentIntent.
      payment_intent_data: {
        // Keep the card so auto top-up can charge it later without the
        // customer in the loop; the webhook records the payment method.
        setup_future_usage: "off_session",
        metadata: {
          kind: "credit_pack",
          organizationId,
          teamId,
          creditUsd: String(creditUsd),
        },
      },
    });

    return session.url || "";
  }

  /**
   * Checkout in `setup` mode: saves a card for auto top-up without charging
   * it. Used when the org wants auto top-up before (or without) a first
   * pack purchase, or to replace the card on file.
   */
  static async createCreditSetupSession(
    organizationId: string,
    teamId: string
  ): Promise<string> {
    const license = await OrganizationLicenseRepository.findOne({
      where: { organizationId, teamId },
    });
    if (!license) {
      throw new Error("Organização não encontrada");
    }
    const customer = await this.ensureCustomer(license);
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      payment_method_types: ["card"],
      customer,
      success_url: `${process.env.FRONTEND_URL}/byok?credits=card_saved#kodus`,
      cancel_url: `${process.env.FRONTEND_URL}/byok?credits=cancel#kodus`,
      client_reference_id: organizationId,
      metadata: {
        kind: "credit_payment_method",
        organizationId,
        teamId,
        licenseId: license.id,
      },
    });
    return session.url || "";
  }

  /** The org's Stripe customer, created on demand for credit-only orgs. */
  private static async ensureCustomer(
    license: OrganizationLicense
  ): Promise<string> {
    if (license.stripeCustomerId) return license.stripeCustomerId;
    const customer = await stripe.customers.create({
      metadata: {
        organizationId: license.organizationId,
        teamId: license.teamId,
      },
    });
    license.stripeCustomerId = customer.id;
    await OrganizationLicenseRepository.save(license);
    clearCacheByPrefix("org-license");
    return customer.id;
  }

  /** "Visa •••• 4242" for the UI; null when Stripe has no card details. */
  static async describePaymentMethod(
    paymentMethodId: string
  ): Promise<string | null> {
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    if (pm.card) {
      const brand =
        pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1);
      return `${brand} •••• ${pm.card.last4}`;
    }
    return pm.type ?? null;
  }

  static async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    await stripe.paymentMethods.detach(paymentMethodId);
  }

  /**
   * Off-session charge of the saved card for an auto top-up. Confirmed in
   * one call; a card that needs authentication or declines throws, and the
   * caller records the error instead of retrying blindly.
   */
  static async chargeSavedPaymentMethod(input: {
    license: OrganizationLicense;
    paymentMethodId: string;
    chargeUsd: number;
    creditUsd: number;
    /** One key per claimed attempt: a retry after a timeout returns the SAME
     *  PaymentIntent instead of charging the card again. */
    idempotencyKey: string;
  }): Promise<Stripe.PaymentIntent> {
    const customer = await this.ensureCustomer(input.license);
    return stripe.paymentIntents.create(
      {
      amount: Math.round(input.chargeUsd * 100),
      currency: "usd",
      customer,
      payment_method: input.paymentMethodId,
      off_session: true,
      confirm: true,
      description: `Kodus credits auto top-up — $${input.creditUsd.toFixed(2)} (includes ${CREDITS_MARKUP_PCT}% platform fee)`,
      metadata: {
        kind: "credit_auto_topup",
        organizationId: input.license.organizationId,
        teamId: input.license.teamId,
        creditUsd: String(input.creditUsd),
        chargeUsd: String(input.chargeUsd),
        markupPct: String(CREDITS_MARKUP_PCT),
      },
      },
      { idempotencyKey: input.idempotencyKey }
    );
  }

  static async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed":
        await this.handleCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session
        );
        break;

      case "invoice.payment_failed":
        await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case "customer.subscription.updated":
        await this.handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription
        );
        break;

      case "customer.subscription.deleted":
        await this.handleSubscriptionCanceled(
          event.data.object as Stripe.Subscription
        );
        break;

      default:
        console.log(`Evento não manipulado: ${event.type}`);
    }
  }

  private static async handleCheckoutSessionCompleted(
    session: Stripe.Checkout.Session
  ): Promise<void> {
    if (!session.metadata?.organizationId) return;

    const organizationId = session.metadata.organizationId;

    // A credit-pack purchase is NOT a subscription: it must never touch
    // planType / totalLicenses / stripeSubscriptionId. Branch before any of
    // that. Idempotent on the session id — Stripe redelivers.
    if (session.metadata.kind === "credit_pack") {
      await this.handleCreditPackPaid(session, organizationId);
      return;
    }
    if (session.metadata.kind === "credit_payment_method") {
      await this.handleCreditCardSaved(session, organizationId);
      return;
    }

    // Atualizar a licença com os dados do Stripe
    const license = await OrganizationLicenseRepository.findOne({
      where: { organizationId },
    });

    if (!license) return;

    license.subscriptionStatus = SubscriptionStatus.ACTIVE;
    license.stripeCustomerId = session.customer as string;
    license.stripeSubscriptionId = session.subscription as string;

    // Se houver quantity nos line_items
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
    if (lineItems.data.length > 0) {
      license.totalLicenses = lineItems.data[0].quantity || 0;
      
      // Identificar plano pelo Price ID
      const priceId = lineItems.data[0]?.price?.id;
      license.planType = getPlanTypeByPriceId(priceId);
    }

    await OrganizationLicenseRepository.save(license);

    // Limpar cache para garantir que as consultas futuras obtenham dados atualizados
    clearCacheByPrefix("org-license");
    clearCacheByPrefix("user-license");
    clearCacheByPrefix("users-license");

    KodusNotificationClient.notifyPlanChanged({
      organizationId: license.organizationId,
      teamId: license.teamId,
      planType: license.planType,
      subscriptionStatus: license.subscriptionStatus,
    });
  }

  private static async handleCreditPackPaid(
    session: Stripe.Checkout.Session,
    organizationId: string
  ): Promise<void> {
    if (session.payment_status !== "paid") {
      console.log(
        `Credit pack session ${session.id} not paid yet (${session.payment_status}); skipping`
      );
      return;
    }

    const creditUsd = Number(session.metadata?.creditUsd);
    if (!Number.isFinite(creditUsd) || creditUsd <= 0) {
      console.error(
        `Credit pack session ${session.id} carries no valid creditUsd metadata`
      );
      return;
    }

    const teamId = session.metadata?.teamId || undefined;

    // Capture the customer for orgs that never had a subscription, so the
    // portal/receipts work for credit-only customers too.
    const license = await OrganizationLicenseRepository.findOne({
      where: teamId ? { organizationId, teamId } : { organizationId },
    });
    if (license && !license.stripeCustomerId && session.customer) {
      license.stripeCustomerId = session.customer as string;
      await OrganizationLicenseRepository.save(license);
    }

    // The pack's card was saved off-session (setup_future_usage): keep it as
    // the auto top-up card so "turn on auto top-up" needs no second form.
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (license && paymentIntentId) {
      await this.rememberCardFromPaymentIntent(license, paymentIntentId).catch(
        (err) => console.error("Could not record the credit-pack card", err)
      );
    }

    await CreditService.applyPurchase({
      organizationId,
      teamId,
      creditUsd,
      usageKey: `stripe:checkout:${session.id}`,
      metadata: {
        stripeSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id,
        chargeUsd: Number(session.metadata?.chargeUsd),
        markupPct: Number(session.metadata?.markupPct),
        amountTotalCents: session.amount_total,
        currency: session.currency,
      },
    });

    clearCacheByPrefix("org-license");
  }

  private static async rememberCardFromPaymentIntent(
    license: OrganizationLicense,
    paymentIntentId: string
  ): Promise<void> {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const pm =
      typeof intent.payment_method === "string"
        ? intent.payment_method
        : intent.payment_method?.id;
    if (!pm) return;
    const label = await this.describePaymentMethod(pm).catch(() => null);
    await AutoTopUpService.attachPaymentMethod(license, pm, label);
  }

  private static async handleCreditCardSaved(
    session: Stripe.Checkout.Session,
    organizationId: string
  ): Promise<void> {
    const teamId = session.metadata?.teamId || undefined;
    const license = await OrganizationLicenseRepository.findOne({
      where: teamId ? { organizationId, teamId } : { organizationId },
    });
    if (!license) return;
    if (!license.stripeCustomerId && session.customer) {
      license.stripeCustomerId = session.customer as string;
      await OrganizationLicenseRepository.save(license);
    }
    const setupIntentId =
      typeof session.setup_intent === "string"
        ? session.setup_intent
        : session.setup_intent?.id;
    if (!setupIntentId) return;
    const intent = await stripe.setupIntents.retrieve(setupIntentId);
    const pm =
      typeof intent.payment_method === "string"
        ? intent.payment_method
        : intent.payment_method?.id;
    if (!pm) return;
    const label = await this.describePaymentMethod(pm).catch(() => null);
    await AutoTopUpService.attachPaymentMethod(license, pm, label);
  }

  private static async handlePaymentFailed(
    invoice: Stripe.Invoice
  ): Promise<void> {
    if (!invoice.subscription) return;

    const license = await OrganizationLicenseRepository.findOne({
      where: { stripeSubscriptionId: invoice.subscription as string },
    });

    if (!license) return;

    license.subscriptionStatus = SubscriptionStatus.PAYMENT_FAILED;
    await OrganizationLicenseRepository.save(license);

    // Limpar cache para garantir que as consultas futuras obtenham dados atualizados
    clearCacheByPrefix("org-license");
    clearCacheByPrefix("user-license");
    clearCacheByPrefix("users-license");

    // Fire-and-forget customer notification. The client never throws,
    // but the explicit catch is a second line of defense to guarantee
    // the rest of the Stripe webhook handler proceeds untouched.
    KodusNotificationClient.notifyPaymentFailed({
      organizationId: license.organizationId,
      teamId: license.teamId,
      amount: invoice.amount_due ?? 0,
      currency: invoice.currency ?? "",
      failureReason:
        (invoice.last_finalization_error as { message?: string } | undefined)
          ?.message ?? "Payment failed",
      nextRetryAt: invoice.next_payment_attempt
        ? new Date(invoice.next_payment_attempt * 1000).toISOString()
        : undefined,
      updatePaymentUrl: process.env.FRONTEND_URL
        ? `${process.env.FRONTEND_URL}/settings/subscription`
        : undefined,
    }).catch(() => {
      /* unreachable — client swallows internally; defense-in-depth only */
    });
  }

  private static async handleSubscriptionUpdated(
    subscription: Stripe.Subscription
  ): Promise<void> {
    const license = await OrganizationLicenseRepository.findOne({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!license) return;

    // Atualizar o status da assinatura
    if (subscription.status === "active") {
      license.subscriptionStatus = SubscriptionStatus.ACTIVE;
    } else if (
      subscription.status === "past_due" ||
      subscription.status === "unpaid"
    ) {
      license.subscriptionStatus = SubscriptionStatus.PAYMENT_FAILED;
    } else if (subscription.status === "canceled") {
      license.subscriptionStatus = SubscriptionStatus.CANCELED;
    }

    // Atualizar o número total de licenças se houver mudança
    const lineItems = await stripe.subscriptionItems.list({
      subscription: subscription.id,
    });

    if (lineItems.data.length > 0) {
      license.totalLicenses = lineItems.data[0].quantity || 0;
    }

    await OrganizationLicenseRepository.save(license);

    // Limpar cache para garantir que as consultas futuras obtenham dados atualizados
    clearCacheByPrefix("org-license");
    clearCacheByPrefix("user-license");
    clearCacheByPrefix("users-license");

    KodusNotificationClient.notifyPlanChanged({
      organizationId: license.organizationId,
      teamId: license.teamId,
      planType: license.planType,
      subscriptionStatus: license.subscriptionStatus,
    });
  }

  private static async handleSubscriptionCanceled(
    subscription: Stripe.Subscription
  ): Promise<void> {
    const license = await OrganizationLicenseRepository.findOne({
      where: { stripeSubscriptionId: subscription.id },
    });

    if (!license) return;

    license.subscriptionStatus = SubscriptionStatus.CANCELED;
    await OrganizationLicenseRepository.save(license);

    // Limpar cache para garantir que as consultas futuras obtenham dados atualizados
    clearCacheByPrefix("org-license");
    clearCacheByPrefix("user-license");
    clearCacheByPrefix("users-license");

    KodusNotificationClient.notifyPlanChanged({
      organizationId: license.organizationId,
      teamId: license.teamId,
      planType: license.planType,
      subscriptionStatus: license.subscriptionStatus,
    });

    // TODO: Expirar licenças de usuários
  }

  static async createCustomerPortalSession(
    organizationId: string,
    teamId: string
  ): Promise<string> {
    // Buscar a licença da organização
    const license = await OrganizationLicenseRepository.findOne({
      where: { organizationId, teamId },
    });

    if (!license || !license.stripeCustomerId) {
      throw new Error("Organização não encontrada ou sem assinatura ativa");
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: license.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/subscription`,
    });

    return session.url;
  }
}
