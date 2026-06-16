import { OrganizationLicenseRepository } from "../repositories/OrganizationLicenseRepository";
import { UserLicenseRepository } from "../repositories/UserLicenseRepository";
import {
    OrganizationLicense,
    SubscriptionStatus,
    PlanType,
    TrialCreditTier,
    TrialUnlock,
    TrialUnlockStatus,
} from "../entities/OrganizationLicense";
import { UserLicense, GitTool, LicenseStatus } from "../entities/UserLicense";
import { In, LessThan } from "typeorm";
import { clearCacheByPrefix } from "../config/utils/cache";
import { buildLogApiUrl } from "../config/utils/urlBuilder";
import axios from "axios";
import { AppDataSource } from "../config/database";

const TRIAL_REVIEW_CREDITS_INCLUDED = parseInt(
    process.env.TRIAL_REVIEW_CREDITS_INCLUDED || "5",
);

const isByokPlan = (planType?: PlanType): boolean =>
    Boolean(planType && planType.includes("byok"));

type TrialUnlockSignals = {
    companyEmailVerified?: boolean;
    workspaceMembersCount?: number;
    codeHostMembersCount?: number;
    byok?: boolean;
};

const TRIAL_UNLOCK_REWARDS = {
    company_email: 5,
    team_setup: 5,
    code_org_10_plus: 20,
};

const defaultTrialUnlocks = (planType?: PlanType): TrialUnlock[] => [
    {
        key: "company_email",
        status: TrialUnlockStatus.LOCKED,
        rewardCredits: TRIAL_UNLOCK_REWARDS.company_email,
        title: "Use a company email",
        description:
            "A confirmed work email helps us qualify the trial automatically.",
    },
    {
        key: "team_setup",
        status: TrialUnlockStatus.LOCKED,
        rewardCredits: TRIAL_UNLOCK_REWARDS.team_setup,
        title: "Invite 3 teammates",
        description:
            "Add teammates so the trial reflects a real review workflow.",
    },
    {
        key: "code_org_10_plus",
        status: TrialUnlockStatus.LOCKED,
        rewardCredits: TRIAL_UNLOCK_REWARDS.code_org_10_plus,
        title: "Connect a 10+ developer code org",
        description:
            "Connect the organization, not only a personal account, so we can evaluate team fit.",
    },
    {
        key: "byok",
        status: isByokPlan(planType)
            ? TrialUnlockStatus.COMPLETED
            : TrialUnlockStatus.AVAILABLE,
        title: "Connect BYOK",
        description: "Use your own AI key. Reviews no longer use Kodus-paid PRs.",
    },
    {
        key: "manual_extension",
        status: TrialUnlockStatus.AVAILABLE,
        title: "Request more trial PR reviews",
        description:
            "Ask Kodus to review your trial signals and extend the evaluation manually.",
    },
];

const mergeTrialUnlocks = (
    existingUnlocks: TrialUnlock[] | undefined,
    planType?: PlanType,
): TrialUnlock[] => {
    const existingByKey = new Map(
        (existingUnlocks ?? []).map((unlock) => [unlock.key, unlock]),
    );
    const legacyKeyMap: Record<string, string> = {
        multi_author_review: "code_org_10_plus",
        manual: "manual_extension",
    };

    for (const unlock of existingUnlocks ?? []) {
        const currentKey = legacyKeyMap[unlock.key];

        if (currentKey && !existingByKey.has(currentKey)) {
            existingByKey.set(currentKey, { ...unlock, key: currentKey });
        }
    }

    return defaultTrialUnlocks(planType).map((defaultUnlock) => {
        const existingUnlock = existingByKey.get(defaultUnlock.key);

        if (!existingUnlock) return defaultUnlock;

        return {
            ...defaultUnlock,
            ...existingUnlock,
            title: defaultUnlock.title,
            description: defaultUnlock.description,
            rewardCredits:
                defaultUnlock.rewardCredits ?? existingUnlock.rewardCredits,
        };
    });
};

const normalizeTrialCredits = (license: OrganizationLicense): boolean => {
    // Legacy trials (created before the credit model) have a NULL total. They
    // must keep the old unlimited-reviews behavior, so never bootstrap credits
    // onto them — leave every credit field untouched.
    if (license.trialReviewCreditsTotal == null) {
        return false;
    }

    let changed = false;

    const trialReviewCreditsUsed = Math.max(
        0,
        license.trialReviewCreditsUsed || 0,
    );

    if (license.trialReviewCreditsUsed !== trialReviewCreditsUsed) {
        license.trialReviewCreditsUsed = trialReviewCreditsUsed;
        changed = true;
    }

    const trialReviewCreditsRemaining = Math.max(
        0,
        license.trialReviewCreditsRemaining ??
            license.trialReviewCreditsTotal - trialReviewCreditsUsed,
    );

    if (license.trialReviewCreditsRemaining !== trialReviewCreditsRemaining) {
        license.trialReviewCreditsRemaining = trialReviewCreditsRemaining;
        changed = true;
    }

    if (!license.trialCreditTier) {
        license.trialCreditTier = TrialCreditTier.BASE;
        changed = true;
    }

    const normalizedUnlocks = mergeTrialUnlocks(
        Array.isArray(license.trialUnlocks) ? license.trialUnlocks : [],
        license.planType,
    );

    if (
        JSON.stringify(license.trialUnlocks ?? []) !==
        JSON.stringify(normalizedUnlocks)
    ) {
        license.trialUnlocks = normalizedUnlocks;
        changed = true;
    }

    if (!Array.isArray(license.trialReviewCreditUsageKeys)) {
        license.trialReviewCreditUsageKeys = [];
        changed = true;
    }

    return changed;
};

const buildTrialCreditPayload = (license: OrganizationLicense) => ({
    byok: isByokPlan(license.planType),
    trialReviewCreditsTotal: license.trialReviewCreditsTotal,
    trialReviewCreditsUsed: license.trialReviewCreditsUsed,
    trialReviewCreditsRemaining: license.trialReviewCreditsRemaining,
    trialCreditTier: license.trialCreditTier,
    trialUnlocks: license.trialUnlocks,
});

export class OrganizationLicenseService {
    static async createTrialLicense(
        organizationId: string,
        teamId: string,
        planType: PlanType = PlanType.TEAMS_MANAGED,
    ): Promise<OrganizationLicense> {
        // Verifica se já existe uma licença para essa organização e time
        const existingLicense = await OrganizationLicenseRepository.findOne({
            where: { organizationId, teamId },
        });

        if (existingLicense) {
            throw new Error(
                "Já existe uma licença para esta organização e time",
            );
        }

        const trialDays = parseInt(process.env.TRIAL_DAYS || "14");
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + trialDays);

        const license = OrganizationLicenseRepository.create({
            organizationId,
            teamId,
            subscriptionStatus: SubscriptionStatus.TRIAL,
            planType,
            trialEnd,
            trialReviewCreditsTotal: TRIAL_REVIEW_CREDITS_INCLUDED,
            trialReviewCreditsUsed: 0,
            trialReviewCreditsRemaining: TRIAL_REVIEW_CREDITS_INCLUDED,
            trialCreditTier: TrialCreditTier.BASE,
            trialUnlocks: defaultTrialUnlocks(planType),
            trialReviewCreditUsageKeys: [],
            totalLicenses: 0,
            assignedLicenses: 0,
        });

        const savedLicense = await OrganizationLicenseRepository.save(license);

        // Limpar cache para garantir que as consultas futuras obtenham dados atualizados
        clearCacheByPrefix("org-license");
        clearCacheByPrefix("user-license");
        clearCacheByPrefix("users-license");

        return savedLicense;
    }

    static async assignLicensesToUsers(
        organizationId: string,
        teamId: string,
        users: Array<{
            gitId: string;
            gitTool: GitTool;
            licenseStatus: LicenseStatus;
        }>,
    ): Promise<{
        successful: UserLicense[];
        failed: Array<{
            user: {
                gitId: string;
                gitTool: GitTool;
                licenseStatus: LicenseStatus;
            };
            error: string;
        }>;
    }> {
        // Buscar licença ativa da organização
        const orgLicense = await OrganizationLicenseRepository.findOne({
            where: {
                organizationId,
                teamId,
                subscriptionStatus: In([
                    SubscriptionStatus.ACTIVE,
                    SubscriptionStatus.TRIAL,
                ]),
            },
        });

        if (!orgLicense) {
            throw new Error("Organização não possui licença ativa ou trial");
        }

        // Se estiver em trial, verificar se não expirou
        if (orgLicense.subscriptionStatus === SubscriptionStatus.TRIAL) {
            const now = new Date();
            if (orgLicense.trialEnd && now > orgLicense.trialEnd) {
                await this.migrateToFreePlan(organizationId, teamId);
                throw new Error(
                    "A licença trial desta organização expirou e ela foi migrada para o plano gratuito",
                );
            }
        }

        // Verificar licenças existentes para os usuários
        const existingLicenses = await UserLicenseRepository.find({
            where: {
                git_id: In(users.map((u) => u.gitId)),
                organizationLicenseId: orgLicense.id,
            },
        });

        // Mapear usuários que já têm licença
        const existingLicenseMap = new Map(
            existingLicenses.map((license) => [license.git_id, license]),
        );

        // Verificar licenças disponíveis
        const activeUserLicenses = await UserLicenseRepository.count({
            where: {
                organizationLicenseId: orgLicense.id,
                licenseStatus: LicenseStatus.ACTIVE,
            },
        });

        let licencasDisponiveis = orgLicense.totalLicenses - activeUserLicenses;

        console.log("licencasDisponiveis", licencasDisponiveis);
        console.log("activeUserLicenses", activeUserLicenses);
        console.log("orgLicense.totalLicenses", orgLicense.totalLicenses);

        const results = {
            successful: [] as UserLicense[],
            failed: [] as Array<{
                user: {
                    gitId: string;
                    gitTool: GitTool;
                    licenseStatus: LicenseStatus;
                };
                error: string;
            }>,
        };

        // Processar usuários existentes primeiro (atualizações)
        for (const user of users) {
            const existingLicense = existingLicenseMap.get(user.gitId);
            console.log("existingLicense", existingLicense);
            console.log("user", user);
            if (existingLicense) {
                try {
                    // Se estamos desativando uma licença, liberar uma vaga
                    if (
                        existingLicense.licenseStatus ===
                            LicenseStatus.ACTIVE &&
                        user.licenseStatus === LicenseStatus.INACTIVE
                    ) {
                        orgLicense.assignedLicenses--;
                        licencasDisponiveis++;
                    }
                    // Se estamos reativando uma licença, verificar disponibilidade
                    else if (
                        existingLicense.licenseStatus ===
                            LicenseStatus.INACTIVE &&
                        user.licenseStatus === LicenseStatus.ACTIVE
                    ) {
                        if (licencasDisponiveis <= 0) {
                            results.failed.push({
                                user,
                                error: "Não há licenças disponíveis para reativar este usuário",
                            });
                            continue;
                        }
                        orgLicense.assignedLicenses++;
                        licencasDisponiveis--;
                    } else {
                        results.failed.push({
                            user,
                            error: "Não é possível reativar uma licença que não está desativada",
                        });
                        continue;
                    }

                    // Atualizar a licença existente com os novos dados
                    existingLicense.git_tool = user.gitTool;
                    existingLicense.licenseStatus = user.licenseStatus;

                    const updatedLicense =
                        await UserLicenseRepository.save(existingLicense);
                    results.successful.push(updatedLicense);
                } catch (error) {
                    results.failed.push({
                        user,
                        error:
                            error instanceof Error
                                ? error.message
                                : "Erro ao atualizar licença existente",
                    });
                }
            } else if (user.licenseStatus === LicenseStatus.ACTIVE) {
                // Se não há mais licenças disponíveis, falhar os usuários restantes
                if (licencasDisponiveis <= 0) {
                    results.failed.push({
                        user,
                        error: "Não há mais licenças disponíveis",
                    });
                    continue;
                }

                try {
                    // Criar nova licença para o usuário
                    const userLicense = UserLicenseRepository.create({
                        git_id: user.gitId,
                        git_tool: user.gitTool,
                        licenseStatus: user.licenseStatus,
                        assignedAt: new Date(),
                        organizationLicenseId: orgLicense.id,
                    });

                    const savedLicense =
                        await UserLicenseRepository.save(userLicense);
                    results.successful.push(savedLicense);

                    // Atualizar contador de licenças atribuídas e disponíveis
                    orgLicense.assignedLicenses++;
                    licencasDisponiveis--;
                } catch (error) {
                    results.failed.push({
                        user,
                        error:
                            error instanceof Error
                                ? error.message
                                : "Erro ao criar nova licença",
                    });
                }
            } else {
                // Criar licença inativa (não consome quota de licenças disponíveis)
                try {
                    const userLicense = UserLicenseRepository.create({
                        git_id: user.gitId,
                        git_tool: user.gitTool,
                        licenseStatus: LicenseStatus.INACTIVE, // Garantir que é INACTIVE
                        assignedAt: new Date(),
                        organizationLicenseId: orgLicense.id,
                    });

                    const savedLicense =
                        await UserLicenseRepository.save(userLicense);
                    results.successful.push(savedLicense);
                } catch (error) {
                    results.failed.push({
                        user,
                        error:
                            error instanceof Error
                                ? error.message
                                : "Erro ao criar licença inativa",
                    });
                }
            }
        }

        // Salvar o novo contador de licenças atribuídas
        await OrganizationLicenseRepository.save(orgLicense);

        // Limpar cache para garantir que as consultas futuras obtenham dados atualizados
        clearCacheByPrefix("org-license");
        clearCacheByPrefix("user-license");
        clearCacheByPrefix("users-license");

        return results;
    }

    /**
     * Notifica a API de logs sobre mudanças de status dos usuários
     */
    static async notifyUserStatusChanges(
        userLicenses: UserLicense[],
        organizationId: string,
        teamId: string,
        editedBy: {
            email: string;
            userId: string;
        },
        userName: string,
    ): Promise<void> {
        try {
            // Processa cada licença individualmente
            for (const license of userLicenses) {
                const userStatusChange = {
                    gitId: license.git_id,
                    gitTool: license.git_tool,
                    licenseStatus: license.licenseStatus,
                    organizationId,
                    teamId,
                    editedBy,
                    userName,
                };

                const apiUrl = buildLogApiUrl("/user-log/status-change");

                await axios.post(apiUrl, userStatusChange, {
                    headers: {
                        "Content-Type": "application/json",
                    },
                    timeout: 3000,
                });
            }
        } catch (error) {
            throw new Error(
                "Erro ao registrar log de mudanças de status:",
                error,
            );
        }
    }

    // Mantemos o método original para compatibilidade e uso interno
    static async assignLicenseToUser(
        organizationId: string,
        teamId: string,
        userId: string,
        gitId: string,
        gitTool: GitTool,
    ): Promise<UserLicense> {
        const result = await this.assignLicensesToUsers(
            organizationId,
            teamId,
            [
                {
                    gitId,
                    gitTool,
                    licenseStatus: LicenseStatus.ACTIVE,
                },
            ],
        );

        if (result.failed.length > 0) {
            throw new Error(result.failed[0].error);
        }

        return result.successful[0];
    }

    static async checkUserLicense(
        organizationId: string,
        userId: string,
        teamId: string,
    ): Promise<any> {
        const license = await UserLicenseRepository.findOne({
            where: {
                git_id: userId,
                organizationLicense: { organizationId, teamId },
            },
        });

        return { git_id: userId, isValid: !!license };
    }

    static async validateLicense(
        organizationId: string,
        teamId: string,
    ): Promise<{
        valid: boolean;
        subscriptionStatus?: SubscriptionStatus;
        planType?: PlanType;
        trialEnd?: Date;
        numberOfLicenses?: number;
        stripeCustomerId?: string;
        byok?: boolean;
        trialReviewCreditsTotal?: number;
        trialReviewCreditsUsed?: number;
        trialReviewCreditsRemaining?: number;
        trialCreditTier?: string;
        trialUnlocks?: TrialUnlock[];
    }> {
        const license = await OrganizationLicenseRepository.findOne({
            where: { organizationId, teamId },
        });

        if (!license) return { valid: false };

        // Plano gratuito é sempre válido
        if (license.planType === PlanType.FREE_BYOK) {
            return {
                valid: true,
                planType: license.planType,
                subscriptionStatus: license.subscriptionStatus,
                numberOfLicenses: license.totalLicenses,
                stripeCustomerId: license?.stripeCustomerId,
                byok: isByokPlan(license.planType),
            };
        }

        // Se estiver em trial, verificar se expirou
        if (license.subscriptionStatus === SubscriptionStatus.TRIAL) {
            const now = new Date();
            if (license.trialEnd && now > license.trialEnd) {
                const migratedLicense = await this.migrateToFreePlan(
                    license.organizationId,
                    license.teamId,
                );
                return {
                    valid: true,
                    subscriptionStatus: migratedLicense.subscriptionStatus,
                    planType: migratedLicense.planType,
                    numberOfLicenses: migratedLicense.totalLicenses,
                    stripeCustomerId: migratedLicense?.stripeCustomerId,
                    byok: isByokPlan(migratedLicense.planType),
                };
            }

            if (normalizeTrialCredits(license)) {
                await OrganizationLicenseRepository.save(license);
            }

            // Se está em trial e não expirou, retorna com a data
            return {
                valid: true,
                subscriptionStatus: SubscriptionStatus.TRIAL,
                planType: license.planType,
                trialEnd: license.trialEnd,
                stripeCustomerId: license?.stripeCustomerId,
                ...buildTrialCreditPayload(license),
            };
        }

        // Para outros status, retorna apenas o status e validade
        return {
            valid: [
                SubscriptionStatus.TRIAL,
                SubscriptionStatus.ACTIVE,
            ].includes(license.subscriptionStatus),
            subscriptionStatus: license.subscriptionStatus,
            planType: license.planType,
            numberOfLicenses: license.totalLicenses,
            stripeCustomerId: license?.stripeCustomerId,
            byok: isByokPlan(license.planType),
        };
    }

    static async recalculateTrialUnlocks(
        organizationId: string,
        teamId: string,
        signals: TrialUnlockSignals = {},
    ): Promise<{
        valid: boolean;
        subscriptionStatus?: SubscriptionStatus;
        planType?: PlanType;
        trialEnd?: Date;
        byok?: boolean;
        trialReviewCreditsTotal?: number;
        trialReviewCreditsUsed?: number;
        trialReviewCreditsRemaining?: number;
        trialCreditTier?: string;
        trialUnlocks?: TrialUnlock[];
        appliedUnlocks?: string[];
    }> {
        const result = await AppDataSource.transaction(async (manager) => {
            const repository = manager.getRepository(OrganizationLicense);
            const license = await repository.findOne({
                where: { organizationId, teamId },
                lock: { mode: "pessimistic_write" },
            });

            if (!license) return { valid: false };

            if (license.subscriptionStatus !== SubscriptionStatus.TRIAL) {
                return {
                    valid: true,
                    subscriptionStatus: license.subscriptionStatus,
                    planType: license.planType,
                    byok: isByokPlan(license.planType),
                };
            }

            const now = new Date();
            if (license.trialEnd && now > license.trialEnd) {
                return {
                    valid: true,
                    subscriptionStatus: SubscriptionStatus.TRIAL,
                    planType: license.planType,
                    trialEnd: license.trialEnd,
                    ...buildTrialCreditPayload(license),
                };
            }

            normalizeTrialCredits(license);

            const appliedUnlocks: string[] = [];
            const unlocks = mergeTrialUnlocks(
                license.trialUnlocks,
                license.planType,
            );
            const unlocksByKey = new Map(
                unlocks.map((unlock) => [unlock.key, unlock]),
            );

            const completeUnlock = (key: keyof typeof TRIAL_UNLOCK_REWARDS) => {
                const unlock = unlocksByKey.get(key);

                if (!unlock) return;
                if (
                    unlock.status === TrialUnlockStatus.COMPLETED ||
                    unlock.status === TrialUnlockStatus.CLAIMED
                ) {
                    return;
                }

                const rewardCredits = TRIAL_UNLOCK_REWARDS[key];
                unlock.status = TrialUnlockStatus.COMPLETED;
                unlock.completedAt = now.toISOString();
                unlock.rewardCredits = rewardCredits;
                license.trialReviewCreditsTotal += rewardCredits;
                license.trialReviewCreditsRemaining += rewardCredits;
                appliedUnlocks.push(key);
            };

            if (signals.companyEmailVerified) completeUnlock("company_email");
            if ((signals.workspaceMembersCount ?? 0) >= 3) {
                completeUnlock("team_setup");
            }
            if ((signals.codeHostMembersCount ?? 0) >= 10) {
                completeUnlock("code_org_10_plus");
            }

            const byokUnlock = unlocksByKey.get("byok");
            if (byokUnlock) {
                byokUnlock.status =
                    isByokPlan(license.planType) || signals.byok
                        ? TrialUnlockStatus.COMPLETED
                        : TrialUnlockStatus.AVAILABLE;
            }

            const manualUnlock = unlocksByKey.get("manual_extension");
            if (manualUnlock?.status === TrialUnlockStatus.LOCKED) {
                manualUnlock.status = TrialUnlockStatus.AVAILABLE;
            }

            license.trialUnlocks = unlocks;

            const manualStatus = unlocksByKey.get("manual_extension")?.status;
            const codeOrgStatus = unlocksByKey.get("code_org_10_plus")?.status;
            const isManual =
                manualStatus === TrialUnlockStatus.COMPLETED ||
                manualStatus === TrialUnlockStatus.CLAIMED;
            const isQualified =
                codeOrgStatus === TrialUnlockStatus.COMPLETED ||
                codeOrgStatus === TrialUnlockStatus.CLAIMED;
            const hasTeamSignal = ["company_email", "team_setup"].some(
                (key) => {
                    const status = unlocksByKey.get(key)?.status;
                    return (
                        status === TrialUnlockStatus.COMPLETED ||
                        status === TrialUnlockStatus.CLAIMED
                    );
                },
            );

            license.trialCreditTier = isManual
                ? TrialCreditTier.MANUAL
                : isQualified
                  ? TrialCreditTier.QUALIFIED
                  : hasTeamSignal
                    ? TrialCreditTier.TEAM_SIGNAL
                    : TrialCreditTier.BASE;

            await repository.save(license);

            return {
                valid: true,
                subscriptionStatus: SubscriptionStatus.TRIAL,
                planType: license.planType,
                trialEnd: license.trialEnd,
                ...buildTrialCreditPayload(license),
                appliedUnlocks,
            };
        });

        clearCacheByPrefix("org-license");

        return result;
    }

    static async consumeTrialReviewCredit(
        organizationId: string,
        teamId: string,
        usageKey?: string,
    ): Promise<{
        allowed: boolean;
        reason?: string;
        alreadyConsumed?: boolean;
        trialReviewCreditsTotal?: number;
        trialReviewCreditsUsed?: number;
        trialReviewCreditsRemaining?: number;
        trialCreditTier?: string;
        trialUnlocks?: TrialUnlock[];
    }> {
        const result = await AppDataSource.transaction(async (manager) => {
            const repository = manager.getRepository(OrganizationLicense);
            const license = await repository.findOne({
                where: { organizationId, teamId },
                lock: { mode: "pessimistic_write" },
            });

            if (!license) {
                return {
                    allowed: false,
                    reason: "LICENSE_NOT_FOUND",
                };
            }

            if (license.subscriptionStatus !== SubscriptionStatus.TRIAL) {
                return {
                    allowed: true,
                    reason: "NOT_TRIAL",
                };
            }

            const now = new Date();
            if (license.trialEnd && now > license.trialEnd) {
                return {
                    allowed: false,
                    reason: "TRIAL_EXPIRED",
                    ...buildTrialCreditPayload(license),
                };
            }

            const normalized = normalizeTrialCredits(license);

            if (
                usageKey &&
                license.trialReviewCreditUsageKeys.includes(usageKey)
            ) {
                if (normalized) {
                    await repository.save(license);
                }

                return {
                    allowed: true,
                    alreadyConsumed: true,
                    ...buildTrialCreditPayload(license),
                };
            }

            if (license.trialReviewCreditsRemaining <= 0) {
                if (normalized) {
                    await repository.save(license);
                }

                return {
                    allowed: false,
                    reason: "TRIAL_REVIEW_CREDITS_EXHAUSTED",
                    ...buildTrialCreditPayload(license),
                };
            }

            license.trialReviewCreditsUsed += 1;
            license.trialReviewCreditsRemaining -= 1;

            if (usageKey) {
                license.trialReviewCreditUsageKeys = [
                    ...license.trialReviewCreditUsageKeys,
                    usageKey,
                ];
            }

            await repository.save(license);

            return {
                allowed: true,
                ...buildTrialCreditPayload(license),
            };
        });

        clearCacheByPrefix("org-license");

        return result;
    }

    static async getAllUsersWithLicense(
        organizationId: string,
        teamId: string,
    ): Promise<{ git_id: string }[]> {
        const licenses = await UserLicenseRepository.find({
            where: {
                licenseStatus: LicenseStatus.ACTIVE,
                organizationLicense: {
                    organizationId,
                    teamId,
                    subscriptionStatus: In([
                        SubscriptionStatus.ACTIVE,
                        SubscriptionStatus.TRIAL,
                    ]),
                },
            },
            relations: ["organizationLicense"],
            order: {
                createdAt: "DESC",
            },
        });

        return licenses.map((license) => ({
            git_id: license.git_id,
        }));
    }

    static async updateExpiredTrials(): Promise<number> {
        const now = new Date();
        const expiredTrials = await OrganizationLicenseRepository.find({
            where: {
                subscriptionStatus: SubscriptionStatus.TRIAL,
                trialEnd: LessThan(now),
            },
        });

        for (const trial of expiredTrials) {
            await this.migrateToFreePlan(trial.organizationId, trial.teamId);
        }

        return expiredTrials.length;
    }

    static async migrateExpiredTrialsToFree(): Promise<number> {
        const now = new Date();
        const expiredTrials = await OrganizationLicenseRepository.find({
            where: {
                subscriptionStatus: SubscriptionStatus.TRIAL,
                trialEnd: LessThan(now),
            },
        });

        let migratedCount = 0;

        for (const trial of expiredTrials) {
            try {
                await this.migrateToFreePlan(
                    trial.organizationId,
                    trial.teamId,
                );
                migratedCount++;
                console.log(
                    `Trial migrado para plano gratuito: orgId=${trial.organizationId}, teamId=${trial.teamId}`,
                );
            } catch (error) {
                console.error(
                    `Erro ao migrar trial para plano gratuito: orgId=${trial.organizationId}, teamId=${trial.teamId}`,
                    error,
                );
            }
        }

        return migratedCount;
    }

    static async updateTrial(orgId: string, teamId: string, newTrialEnd: Date) {
        const license = await OrganizationLicenseRepository.findOne({
            where: { organizationId: orgId, teamId },
        });

        if (!license) {
            throw new Error("Licença não encontrada");
        }

        license.trialEnd = newTrialEnd;
        await OrganizationLicenseRepository.save(license);

        // Limpar cache para garantir que as consultas futuras obtenham dados atualizados
        clearCacheByPrefix("org-license");
        clearCacheByPrefix("user-license");
        clearCacheByPrefix("users-license");

        return license;
    }

    static async migrateToFreePlan(
        organizationId: string,
        teamId: string,
    ): Promise<OrganizationLicense> {
        const license = await OrganizationLicenseRepository.findOne({
            where: { organizationId, teamId },
        });

        if (!license) {
            throw new Error("Licença não encontrada");
        }

        // Migrar para plano gratuito
        license.planType = PlanType.FREE_BYOK;
        license.subscriptionStatus = SubscriptionStatus.ACTIVE;
        license.stripeCustomerId = null;
        license.stripeSubscriptionId = null;

        await OrganizationLicenseRepository.save(license);

        // Limpar cache para garantir que as consultas futuras obtenham dados atualizados
        clearCacheByPrefix("org-license");
        clearCacheByPrefix("user-license");
        clearCacheByPrefix("users-license");

        return license;
    }
}
