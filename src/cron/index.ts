import cron from "node-cron";
import { OrganizationLicenseService } from "../services/OrganizationLicenseService";

// Rodar a cada 2 horas
cron.schedule("0 */2 * * *", async () => {
  console.log("Executando cron job para atualizar trials expirados");
  try {
    const updated = await OrganizationLicenseService.updateExpiredTrials();
    console.log(`${updated} trials expirados atualizados para 'expired'`);
  } catch (error) {
    console.error("Erro ao atualizar trials expirados:", error);
  }
});

// Não precisa exportar nada, apenas executar o schedule
