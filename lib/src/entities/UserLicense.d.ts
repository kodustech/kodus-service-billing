import { OrganizationLicense } from "./OrganizationLicense";
export declare enum LicenseStatus {
    ACTIVE = "active",
    INACTIVE = "inactive"
}
export declare enum GitTool {
    GITHUB = "github",
    GITLAB = "gitlab",
    BITBUCKET = "bitbucket"
}
export declare class UserLicense {
    id: string;
    userId: string;
    git_id: string;
    licenseStatus: LicenseStatus;
    git_tool: GitTool;
    assignedAt: Date;
    organizationLicenseId: string;
    organizationLicense: OrganizationLicense;
    createdAt: Date;
}
