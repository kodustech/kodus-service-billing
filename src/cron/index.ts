import cron from "node-cron";
import { OrganizationLicenseService } from "../services/OrganizationLicenseService";

// Rodar todos os dias à meia-noite
cron.schedule("0 0 * * *", async () => {
  console.log("Executando cron job para atualizar trials expirados");
  try {
    const updated = await OrganizationLicenseService.updateExpiredTrials();
    console.log(`${updated} trials expirados atualizados para 'expired'`);
  } catch (error) {
    console.error("Erro ao atualizar trials expirados:", error);
  }
});

export default cron;
