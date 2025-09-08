import Stripe from "stripe";
import "dotenv/config";
import { OrganizationLicenseRepository } from "../repositories/OrganizationLicenseRepository";
import { SubscriptionStatus, PlanType } from "../entities/OrganizationLicense";
import { clearCacheByPrefix } from "../config/utils/cache";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

export class StripeService {
  private static getPriceIdForPlan(planType: PlanType): string {
    const priceMap = {
      [PlanType.TEAMS_BYOK]: process.env.STRIPE_PRICE_ID_TEAMS_BYOK,
      [PlanType.TEAMS_BYOK_ANNUAL]: process.env.STRIPE_PRICE_ID_TEAMS_BYOK_ANNUAL,
      [PlanType.TEAMS_MANAGED]: process.env.STRIPE_PRICE_ID_TEAMS_MANAGED,
      [PlanType.TEAMS_MANAGED_ANNUAL]: process.env.STRIPE_PRICE_ID_TEAMS_MANAGED_ANNUAL,
      [PlanType.TEAMS_MANAGED_LEGACY]: process.env.STRIPE_PRICE_ID_TEAMS_MANAGED_LEGACY || process.env.STRIPE_PRICE_ID,
      [PlanType.ENTERPRISE_BYOK]: process.env.STRIPE_PRICE_ID_ENTERPRISE_BYOK,
      [PlanType.ENTERPRISE_BYOK_ANNUAL]: process.env.STRIPE_PRICE_ID_ENTERPRISE_BYOK_ANNUAL,
      [PlanType.ENTERPRISE_MANAGED]: process.env.STRIPE_PRICE_ID_ENTERPRISE_MANAGED,
      [PlanType.ENTERPRISE_MANAGED_ANNUAL]: process.env.STRIPE_PRICE_ID_ENTERPRISE_MANAGED_ANNUAL,
    };
    
    return priceMap[planType] || process.env.STRIPE_PRICE_ID || process.env.STRIPE_PRICE_ID_TEAMS_MANAGED_LEGACY;
  }

  private static getPlanTypeByPriceId(priceId?: string): PlanType {
    if (!priceId) return PlanType.TEAMS_MANAGED_LEGACY;
    
    if (priceId === process.env.STRIPE_PRICE_ID_TEAMS_BYOK) return PlanType.TEAMS_BYOK;
    if (priceId === process.env.STRIPE_PRICE_ID_TEAMS_BYOK_ANNUAL) return PlanType.TEAMS_BYOK_ANNUAL;
    if (priceId === process.env.STRIPE_PRICE_ID_TEAMS_MANAGED) return PlanType.TEAMS_MANAGED;
    if (priceId === process.env.STRIPE_PRICE_ID_TEAMS_MANAGED_ANNUAL) return PlanType.TEAMS_MANAGED_ANNUAL;
    if (priceId === process.env.STRIPE_PRICE_ID_TEAMS_MANAGED_LEGACY) return PlanType.TEAMS_MANAGED_LEGACY;
    if (priceId === process.env.STRIPE_PRICE_ID_ENTERPRISE_BYOK) return PlanType.ENTERPRISE_BYOK;
    if (priceId === process.env.STRIPE_PRICE_ID_ENTERPRISE_BYOK_ANNUAL) return PlanType.ENTERPRISE_BYOK_ANNUAL;
    if (priceId === process.env.STRIPE_PRICE_ID_ENTERPRISE_MANAGED) return PlanType.ENTERPRISE_MANAGED;
    if (priceId === process.env.STRIPE_PRICE_ID_ENTERPRISE_MANAGED_ANNUAL) return PlanType.ENTERPRISE_MANAGED_ANNUAL;
    
    // Fallback para o STRIPE_PRICE_ID original (assumindo que é teams_managed_legacy)
    if (priceId === process.env.STRIPE_PRICE_ID) return PlanType.TEAMS_MANAGED_LEGACY;
    
    return PlanType.TEAMS_MANAGED_LEGACY;
  }

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
          price: this.getPriceIdForPlan(planType),
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
      license.planType = this.getPlanTypeByPriceId(priceId);
    }

    await OrganizationLicenseRepository.save(license);

    // Limpar cache para garantir que as consultas futuras obtenham dados atualizados
    clearCacheByPrefix("org-license");
    clearCacheByPrefix("user-license");
    clearCacheByPrefix("users-license");
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

    // TODO: Enviar notificação ao cliente
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
