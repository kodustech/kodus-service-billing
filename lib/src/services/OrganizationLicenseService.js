"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrganizationLicenseService = void 0;
const OrganizationLicenseRepository_1 = require("../repositories/OrganizationLicenseRepository");
const OrganizationLicense_1 = require("../entities/OrganizationLicense");
const crypto_1 = __importDefault(require("crypto"));
class OrganizationLicenseService {
    static async createTrialLicense(organizationId) {
        const trialDays = parseInt(process.env.TRIAL_DAYS || "14");
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + trialDays);
        const cloudToken = this.generateCloudToken(organizationId);
        const license = OrganizationLicenseRepository_1.OrganizationLicenseRepository.create({
            organizationId,
            subscriptionStatus: OrganizationLicense_1.SubscriptionStatus.TRIAL,
            cloudToken,
            trialEnd,
            totalLicenses: 0,
            assignedLicenses: 0,
        });
        return await OrganizationLicenseRepository_1.OrganizationLicenseRepository.save(license);
    }
    static generateCloudToken(organizationId) {
        const secret = process.env.CLOUD_TOKEN_SECRET;
        return crypto_1.default
            .createHmac("sha256", secret)
            .update(`${organizationId}-${Date.now()}`)
            .digest("hex");
    }
    static async validateCloudToken(organizationId, cloudToken) {
        const license = await OrganizationLicenseRepository_1.OrganizationLicenseRepository.findOne({
            where: { organizationId, cloudToken },
        });
        if (!license)
            return false;
        if (license.subscriptionStatus === OrganizationLicense_1.SubscriptionStatus.TRIAL) {
            const now = new Date();
            if (now > license.trialEnd) {
                license.subscriptionStatus = OrganizationLicense_1.SubscriptionStatus.EXPIRED;
                await OrganizationLicenseRepository_1.OrganizationLicenseRepository.save(license);
                return false;
            }
        }
        return [OrganizationLicense_1.SubscriptionStatus.TRIAL, OrganizationLicense_1.SubscriptionStatus.ACTIVE].includes(license.subscriptionStatus);
    }
    static async updateExpiredTrials() {
        const now = new Date();
        const result = await OrganizationLicenseRepository_1.OrganizationLicenseRepository.createQueryBuilder()
            .update(OrganizationLicense_1.OrganizationLicense)
            .set({ subscriptionStatus: OrganizationLicense_1.SubscriptionStatus.EXPIRED })
            .where("subscriptionStatus = :status", {
            status: OrganizationLicense_1.SubscriptionStatus.TRIAL,
        })
            .andWhere("trialEnd < :now", { now })
            .execute();
        return result.affected || 0;
    }
}
exports.OrganizationLicenseService = OrganizationLicenseService;
//# sourceMappingURL=OrganizationLicenseService.js.map