import { Request, Response } from "express";
import { OrganizationLicenseService } from "../services/OrganizationLicenseService";
import { StripeService } from "../services/StripeService";
import Stripe from "stripe";

export class SubscriptionController {
  static async createTrial(req: Request, res: Response): Promise<Response> {
    try {
      const { organizationId } = req.body;

      if (!organizationId) {
        return res
          .status(400)
          .json({ error: "ID da organização é obrigatório" });
      }

      const license =
        await OrganizationLicenseService.createTrialLicense(organizationId);

      return res.status(201).json(license);
    } catch (error) {
      console.error("Erro ao criar trial:", error);
      return res.status(500).json({ error: "Erro ao criar licença trial" });
    }
  }

  static async createCheckoutSession(
    req: Request,
    res: Response
  ): Promise<Response> {
    try {
      const { organizationId, quantity } = req.body;

      if (!organizationId || !quantity) {
        return res
          .status(400)
          .json({ error: "ID da organização e quantidade são obrigatórios" });
      }

      const checkoutUrl = await StripeService.createCheckoutSession(
        organizationId,
        quantity
      );

      return res.json({ url: checkoutUrl });
    } catch (error) {
      console.error("Erro ao criar sessão de checkout:", error);
      return res
        .status(500)
        .json({ error: "Erro ao criar sessão de checkout" });
    }
  }

  static async handleWebhook(req: Request, res: Response): Promise<Response> {
    const sig = req.headers["stripe-signature"] as string;

    if (!sig) {
      return res.status(400).json({ error: "Stripe signature missing" });
    }

    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET || ""
      );

      await StripeService.handleWebhookEvent(event);

      return res.json({ received: true });
    } catch (error) {
      console.error("Webhook error:", error);
      return res.status(400).json({ error: "Webhook error" });
    }
  }

  static async validateCloudToken(
    req: Request,
    res: Response
  ): Promise<Response> {
    try {
      const { organizationId, cloudToken } = req.body;

      if (!organizationId || !cloudToken) {
        return res
          .status(400)
          .json({ error: "ID da organização e cloudToken são obrigatórios" });
      }

      const isValid = await OrganizationLicenseService.validateCloudToken(
        organizationId,
        cloudToken
      );

      return res.json({ valid: isValid });
    } catch (error) {
      console.error("Erro ao validar token:", error);
      return res.status(500).json({ error: "Erro ao validar token" });
    }
  }
}
