import { OrganizationLicenseRepository } from "../repositories/OrganizationLicenseRepository";
import {
  OrganizationLicense,
  SubscriptionStatus,
} from "../entities/OrganizationLicense";
import crypto from "crypto";

export class OrganizationLicenseService {
  static async createTrialLicense(
    organizationId: string
  ): Promise<OrganizationLicense> {
    const trialDays = parseInt(process.env.TRIAL_DAYS || "14");
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + trialDays);

    const cloudToken = this.generateCloudToken(organizationId);

    const license = OrganizationLicenseRepository.create({
      organizationId,
      subscriptionStatus: SubscriptionStatus.TRIAL,
      cloudToken,
      trialEnd,
      totalLicenses: 0,
      assignedLicenses: 0,
    });

    return await OrganizationLicenseRepository.save(license);
  }

  // Gerar um token seguro para a organização
  private static generateCloudToken(organizationId: string): string {
    const secret = process.env.CLOUD_TOKEN_SECRET;

    return crypto
      .createHmac("sha256", secret)
      .update(`${organizationId}-${Date.now()}`)
      .digest("hex");
  }

  static async validateCloudToken(
    organizationId: string,
    cloudToken: string
  ): Promise<boolean> {
    const license = await OrganizationLicenseRepository.findOne({
      where: { organizationId, cloudToken },
    });

    if (!license) return false;

    // Se estiver em trial, verificar se expirou
    if (license.subscriptionStatus === SubscriptionStatus.TRIAL) {
      const now = new Date();
      if (now > license.trialEnd) {
        license.subscriptionStatus = SubscriptionStatus.EXPIRED;
        await OrganizationLicenseRepository.save(license);
        return false;
      }
    }

    // Verificar se o status é válido para uso
    return [SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE].includes(
      license.subscriptionStatus
    );
  }

  static async updateExpiredTrials(): Promise<number> {
    const now = new Date();

    const result = await OrganizationLicenseRepository.createQueryBuilder()
      .update(OrganizationLicense)
      .set({ subscriptionStatus: SubscriptionStatus.EXPIRED })
      .where("subscriptionStatus = :status", {
        status: SubscriptionStatus.TRIAL,
      })
      .andWhere("trialEnd < :now", { now })
      .execute();

    return result.affected || 0;
  }
}
