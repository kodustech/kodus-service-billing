import { OrganizationLicense } from "../entities/OrganizationLicense";
export declare class OrganizationLicenseService {
    static createTrialLicense(organizationId: string): Promise<OrganizationLicense>;
    private static generateCloudToken;
    static validateCloudToken(organizationId: string, cloudToken: string): Promise<boolean>;
    static updateExpiredTrials(): Promise<number>;
}
