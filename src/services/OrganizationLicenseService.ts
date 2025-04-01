import { OrganizationLicenseRepository } from "../repositories/OrganizationLicenseRepository";
import { UserLicenseRepository } from "../repositories/UserLicenseRepository";
import {
  OrganizationLicense,
  SubscriptionStatus,
} from "../entities/OrganizationLicense";
import { UserLicense, GitTool, LicenseStatus } from "../entities/UserLicense";
import { In, LessThan } from "typeorm";
import crypto from "crypto";
import { clearCacheByPrefix } from "../config/utils/cache";

export class OrganizationLicenseService {
  static async createTrialLicense(
    organizationId: string,
    teamId: string
  ): Promise<OrganizationLicense> {
    // Verifica se já existe uma licença para essa organização e time
    const existingLicense = await OrganizationLicenseRepository.findOne({
      where: { organizationId, teamId },
    });

    if (existingLicense) {
      throw new Error("Já existe uma licença para esta organização e time");
    }

    const trialDays = parseInt(process.env.TRIAL_DAYS || "14");
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + trialDays);

    const license = OrganizationLicenseRepository.create({
      organizationId,
      teamId,
      subscriptionStatus: SubscriptionStatus.TRIAL,
      trialEnd,
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
    }>
  ): Promise<{
    successful: UserLicense[];
    failed: Array<{
      user: { gitId: string; gitTool: GitTool; licenseStatus: LicenseStatus };
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
      if (now > orgLicense.trialEnd) {
        orgLicense.subscriptionStatus = SubscriptionStatus.EXPIRED;
        await OrganizationLicenseRepository.save(orgLicense);
        throw new Error("A licença trial desta organização expirou");
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
      existingLicenses.map((license) => [license.git_id, license])
    );

    // Contar quantas novas licenças precisaremos (apenas para ativações)
    const novosUsuarios = users.filter(
      (user) =>
        !existingLicenseMap.has(user.gitId) &&
        user.licenseStatus === LicenseStatus.ACTIVE
    );

    // Verificar licenças disponíveis
    const activeUserLicenses = await UserLicenseRepository.count({
      where: {
        organizationLicenseId: orgLicense.id,
        licenseStatus: LicenseStatus.ACTIVE,
      },
    });

    let licencasDisponiveis = orgLicense.totalLicenses - activeUserLicenses;

    const results = {
      successful: [] as UserLicense[],
      failed: [] as Array<{
        user: { gitId: string; gitTool: GitTool; licenseStatus: LicenseStatus };
        error: string;
      }>,
    };

    // Processar usuários existentes primeiro (atualizações)
    for (const user of users) {
      const existingLicense = existingLicenseMap.get(user.gitId);
      if (existingLicense) {
        try {
          // Atualizar a licença existente com os novos dados
          existingLicense.git_tool = user.gitTool;
          existingLicense.licenseStatus = user.licenseStatus;

          // Se estamos desativando uma licença, liberar uma vaga
          if (
            existingLicense.licenseStatus === LicenseStatus.ACTIVE &&
            user.licenseStatus === LicenseStatus.INACTIVE
          ) {
            orgLicense.assignedLicenses--;
            licencasDisponiveis++;
          }
          // Se estamos reativando uma licença, verificar disponibilidade
          else if (
            existingLicense.licenseStatus === LicenseStatus.INACTIVE &&
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
          }

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

          const savedLicense = await UserLicenseRepository.save(userLicense);
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

          const savedLicense = await UserLicenseRepository.save(userLicense);
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

  // Mantemos o método original para compatibilidade e uso interno
  static async assignLicenseToUser(
    organizationId: string,
    teamId: string,
    userId: string,
    gitId: string,
    gitTool: GitTool
  ): Promise<UserLicense> {
    const result = await this.assignLicensesToUsers(organizationId, teamId, [
      {
        gitId,
        gitTool,
        licenseStatus: LicenseStatus.ACTIVE,
      },
    ]);

    if (result.failed.length > 0) {
      throw new Error(result.failed[0].error);
    }

    return result.successful[0];
  }

  static async checkUserLicense(
    organizationId: string,
    userId: string,
    teamId: string
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
    teamId: string
  ): Promise<{
    valid: boolean;
    subscriptionStatus?: SubscriptionStatus;
    trialEnd?: Date;
    numberOfLicenses?: number;
  }> {
    const license = await OrganizationLicenseRepository.findOne({
      where: { organizationId, teamId },
    });

    if (!license) return { valid: false };

    // Se estiver em trial, verificar se expirou
    if (license.subscriptionStatus === SubscriptionStatus.TRIAL) {
      const now = new Date();
      if (now > license.trialEnd) {
        license.subscriptionStatus = SubscriptionStatus.EXPIRED;
        await OrganizationLicenseRepository.save(license);
        return {
          valid: false,
          subscriptionStatus: SubscriptionStatus.EXPIRED,
        };
      }

      // Se está em trial e não expirou, retorna com a data
      return {
        valid: true,
        subscriptionStatus: SubscriptionStatus.TRIAL,
        trialEnd: license.trialEnd,
      };
    }

    // Para outros status, retorna apenas o status e validade
    return {
      valid: [SubscriptionStatus.TRIAL, SubscriptionStatus.ACTIVE].includes(
        license.subscriptionStatus
      ),
      subscriptionStatus: license.subscriptionStatus,
      numberOfLicenses: license.totalLicenses,
    };
  }

  static async getAllUsersWithLicense(
    organizationId: string,
    teamId: string
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
        trialEnd: LessThan(now)
      }
    });

    for (const trial of expiredTrials) {
      trial.subscriptionStatus = SubscriptionStatus.EXPIRED;
    }

    await OrganizationLicenseRepository.save(expiredTrials);
    return expiredTrials.length;
  }
}
