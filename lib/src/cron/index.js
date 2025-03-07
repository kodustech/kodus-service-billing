"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_cron_1 = __importDefault(require("node-cron"));
const OrganizationLicenseService_1 = require("../services/OrganizationLicenseService");
node_cron_1.default.schedule("0 0 * * *", async () => {
    console.log("Executando cron job para atualizar trials expirados");
    try {
        const updated = await OrganizationLicenseService_1.OrganizationLicenseService.updateExpiredTrials();
        console.log(`${updated} trials expirados atualizados para 'expired'`);
    }
    catch (error) {
        console.error("Erro ao atualizar trials expirados:", error);
    }
});
exports.default = node_cron_1.default;
//# sourceMappingURL=index.js.map