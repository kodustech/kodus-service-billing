import cron from "node-cron";
import { KodusNotificationClient } from "../services/KodusNotificationClient";
import { OrganizationLicenseService } from "../services/OrganizationLicenseService";

// Rodar a cada 2 horas
cron.schedule("0 */2 * * *", async () => {
  console.log("Executando cron job para migrar trials expirados para plano gratuito");
  try {
    const migrated = await OrganizationLicenseService.migrateExpiredTrialsToFree();
    console.log(`${migrated} trials expirados migrados para plano gratuito`);
  } catch (error) {
    console.error("Erro ao migrar trials expirados para plano gratuito:", error);
  }
});

// Daily 12:00 UTC sweep: notify orgs whose trial ends in ~7 days or ~1
// day. Strictly additive — wrapped in try/catch so a failed notify
// never affects the existing 2-hourly cleanup cron above.
cron.schedule("0 12 * * *", async () => {
  console.log("Executando cron job de notificações de trial expirando");
  for (const daysAhead of [7, 1]) {
    try {
      const trials =
        await OrganizationLicenseService.findTrialsExpiringInWindow(
          daysAhead
        );
      for (const trial of trials) {
        try {
          if (!trial.trialEnd) continue;
          await KodusNotificationClient.notifyTrialExpiring({
            organizationId: trial.organizationId,
            teamId: trial.teamId,
            trialEndsAt: trial.trialEnd.toISOString(),
            daysRemaining: daysAhead,
            upgradeUrl: process.env.FRONTEND_URL
              ? `${process.env.FRONTEND_URL}/billing`
              : undefined,
          });
        } catch (perTrialError) {
          // Per-trial failure must not abort the loop; the client itself
          // already swallows errors, this is belt-and-suspenders.
          console.error(
            `Erro ao notificar trial expirando: orgId=${trial.organizationId}, teamId=${trial.teamId}`,
            perTrialError
          );
        }
      }
    } catch (error) {
      console.error(
        `Erro ao buscar trials expirando em ${daysAhead} dias:`,
        error
      );
    }
  }
});
