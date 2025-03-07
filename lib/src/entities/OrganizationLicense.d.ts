export declare enum SubscriptionStatus {
    TRIAL = "trial",
    ACTIVE = "active",
    PAYMENT_FAILED = "payment_failed",
    CANCELED = "canceled",
    EXPIRED = "expired"
}
export declare class OrganizationLicense {
    id: string;
    organizationId: string;
    subscriptionStatus: SubscriptionStatus;
    cloudToken: string;
    trialEnd: Date;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    totalLicenses: number;
    assignedLicenses: number;
    createdAt: Date;
    updatedAt: Date;
}
