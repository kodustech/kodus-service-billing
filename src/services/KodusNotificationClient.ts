import axios from "axios";
import { createHmac } from "crypto";

import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  sign,
  signaturePayload,
} from "../config/utils/serviceToken";
import { buildKodusApiUrl } from "../config/utils/urlBuilder";

/**
 * Outbound client for triggering customer-facing notifications on the
 * kodus-ai side (e.g. billing.payment_failed, billing.trial_expiring).
 *
 * Design constraints (load-bearing):
 *   - Strictly additive. Every public method swallows all errors so the
 *     calling Stripe webhook / cron path is unaffected when the kodus-ai
 *     API is down, slow, or the env vars aren't configured.
 *   - Signed with the same scheme as the calls this service receives
 *     (`serviceToken.ts`): HMAC-SHA256 over
 *     `METHOD\n/path\n<query>\n<timestamp>\n<raw body>`, in
 *     `x-kodus-signature` + `x-kodus-timestamp`, so a captured signature can
 *     neither be replayed on another route nor after 5 minutes. The secret
 *     is shared (API_BILLING_WEBHOOK_SECRET on kodus-ai,
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
    await this.post("payment-failed", input);
  }

  static async notifyTrialExpiring(input: {
    organizationId: string;
    teamId?: string;
    trialEndsAt: string;
    daysRemaining: number;
    upgradeUrl?: string;
  }): Promise<void> {
    await this.post("trial-expiring", input);
  }

  static async notifyPlanChanged(input: {
    organizationId: string;
    teamId?: string;
    planType?: string;
    subscriptionStatus?: string;
  }): Promise<void> {
    await this.post("plan-changed", input);
  }

  /** A credit pack was paid for and applied to the ledger. */
  static async notifyCreditsPurchased(input: {
    organizationId: string;
    teamId?: string;
    creditUsd: number;
    balanceUsd: number;
  }): Promise<void> {
    await this.post("credits-purchased", input);
  }

  /** Balance crossed the low threshold (or hit zero: `exhausted`). One shot
   *  per crossing — the ledger re-arms it on the next top-up. */
  static async notifyCreditsLow(input: {
    organizationId: string;
    teamId?: string;
    balanceUsd: number;
    thresholdUsd: number;
    exhausted: boolean;
    /** Set when an automatic top-up was attempted and the card failed. */
    autoTopUpError?: string;
  }): Promise<void> {
    await this.post("credits-low", input);
  }

  /** Served by the kodus-ai API. Never put "webhook" in it: the kodus-ai ALB
   *  routes every `*\/webhook*` path to its webhooks ingestion service. */
  private static readonly PATH_PREFIX = "/billing/events";

  /** Pre-kodus-ai#2007 receiver on the webhooks service. Tried once when
   *  the API rejects the call before its handler runs, so the two deploys
   *  can land in any order or be rolled back independently. Drop it (and
   *  FALLBACK_STATUSES) once kodus-ai removes the legacy controller. */
  private static readonly LEGACY_PATH_PREFIX = "/billing/webhook";

  /** API answers that mean the handler never ran, so nothing was emitted
   *  and the legacy receiver can take the same bytes: 404 (route not
   *  deployed yet), 401 (signature/timestamp rejected, e.g. clock skew on
   *  this side — the legacy receiver does not read the timestamp) and 500
   *  (the API's billing secret or raw-body capture is missing). */
  private static readonly FALLBACK_STATUSES = new Set([404, 401, 500]);

  private static async post(
    event: string,
    body: Record<string, unknown>
  ): Promise<void> {
    try {
      const path = `${this.PATH_PREFIX}/${event}`;
      const url = buildKodusApiUrl(path);
      if (!url) return; // Integration not configured for this env.

      const secret = process.env.KODUS_NOTIFICATION_WEBHOOK_SECRET;
      if (!secret) return; // No secret — silently skip rather than 401.

      const rawBody = JSON.stringify(body);
      const timestamp = String(Date.now());

      const send = (target: string, headers: Record<string, string>) =>
        axios.post(target, rawBody, {
          headers: { "Content-Type": "application/json", ...headers },
          timeout: this.TIMEOUT_MS,
          // Don't transform — body is already a string and signature is
          // computed over exactly that string.
          transformRequest: [(data) => data],
        });

      try {
        await send(url, {
          [SIGNATURE_HEADER]: sign(
            secret,
            signaturePayload("POST", path, "", timestamp, rawBody)
          ),
          [TIMESTAMP_HEADER]: timestamp,
        });
      } catch (error) {
        const legacyUrl = buildKodusApiUrl(
          `${this.LEGACY_PATH_PREFIX}/${event}`
        );
        const status = axios.isAxiosError(error)
          ? error.response?.status
          : undefined;
        if (
          !legacyUrl ||
          status === undefined ||
          !this.FALLBACK_STATUSES.has(status)
        ) {
          throw error;
        }
        // Keep the primary rejection visible even when the fallback lands.
        console.warn(
          `KodusNotificationClient: ${event} rejected by ${url} (${status}), retrying the legacy receiver`
        );
        // The legacy receiver verifies an HMAC over the body alone.
        await send(legacyUrl, {
          [SIGNATURE_HEADER]: createHmac("sha256", secret)
            .update(rawBody)
            .digest("hex"),
        });
      }
    } catch (error) {
      // Hard rule: never let an outbound notification failure bubble
      // back into Stripe webhook handlers or trial-expiring cron runs.
      // Log the target and status so a drop is diagnosable.
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      const target = axios.isAxiosError(error) ? error.config?.url : undefined;
      console.error(
        `KodusNotificationClient: failed to deliver ${event} to ${
          target ?? "kodus-ai"
        } (${status ?? "no response"})`,
        error instanceof Error ? error.message : error
      );
    }
  }
}
