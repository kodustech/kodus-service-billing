import cron from "node-cron";
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
