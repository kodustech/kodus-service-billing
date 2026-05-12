import axios from "axios";
import { createHmac } from "crypto";

import { buildKodusApiUrl } from "../config/utils/urlBuilder";

/**
 * Outbound client for triggering customer-facing notifications on the
 * kodus-ai side (e.g. billing.payment_failed, billing.trial_expiring).
 *
 * Design constraints (load-bearing):
 *   - Strictly additive. Every public method swallows all errors so the
 *     calling Stripe webhook / cron path is unaffected when the kodus-ai
 *     API is down, slow, or the env vars aren't configured.
 *   - Each request is signed with HMAC-SHA256 over the **raw JSON body**
 *     and a `x-kodus-signature` header; the receiver verifies with the
 *     same shared secret (env: API_BILLING_WEBHOOK_SECRET on kodus-ai,
 *     KODUS_NOTIFICATION_WEBHOOK_SECRET here).
 *   - Bounded timeout (3s) so a hung kodus-ai never holds up the
 *     billing service.
 */
export class KodusNotificationClient {
  private static readonly TIMEOUT_MS = 3_000;

  static async notifyPaymentFailed(input: {
    organizationId: string;
    teamId?: string;
    amount: number;
    currency: string;
    failureReason: string;
    nextRetryAt?: string;
    updatePaymentUrl?: string;
  }): Promise<void> {
    await this.post("/billing/webhook/payment-failed", input);
  }

  static async notifyTrialExpiring(input: {
    organizationId: string;
    teamId?: string;
    trialEndsAt: string;
    daysRemaining: number;
    upgradeUrl?: string;
  }): Promise<void> {
    await this.post("/billing/webhook/trial-expiring", input);
  }

  private static async post(
    path: string,
    body: Record<string, unknown>
  ): Promise<void> {
    try {
      const url = buildKodusApiUrl(path);
      if (!url) return; // Integration not configured for this env.

      const secret = process.env.KODUS_NOTIFICATION_WEBHOOK_SECRET;
      if (!secret) return; // No secret — silently skip rather than 401.

      const rawBody = JSON.stringify(body);
      const signature = createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

      await axios.post(url, rawBody, {
        headers: {
          "Content-Type": "application/json",
          "x-kodus-signature": signature,
        },
        timeout: this.TIMEOUT_MS,
        // Don't transform — body is already a string and signature is
        // computed over exactly that string.
        transformRequest: [(data) => data],
      });
    } catch (error) {
      // Hard rule: never let an outbound notification failure bubble
      // back into Stripe webhook handlers or trial-expiring cron runs.
      console.error(
        `KodusNotificationClient: failed to deliver ${path}`,
        error instanceof Error ? error.message : error
      );
    }
  }
}
