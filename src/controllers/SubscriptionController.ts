import { Request, Response } from "express";
import { OrganizationLicenseService } from "../services/OrganizationLicenseService";
import { StripeService } from "../services/StripeService";
import { PlanType } from "../entities/OrganizationLicense";
import Stripe from "stripe";
import validateAdminToken from "../config/utils/adminToken";
import { PlanCatalogService } from "../services/PlanCatalogService";

export class SubscriptionController {
    static async createTrial(req: Request, res: Response): Promise<Response> {
        try {
            const { organizationId, teamId, byok } = req.body;

            if (!organizationId || !teamId) {
                return res.status(400).json({
                    error: "ID da organização e teamId são obrigatórios",
                });
            }

            const planType = Boolean(byok)
                ? PlanType.TEAMS_BYOK
                : PlanType.TEAMS_MANAGED;

            const license = await OrganizationLicenseService.createTrialLicense(
                organizationId,
                teamId,
                planType
            );

            return res.status(201).json(license);
        } catch (error) {
            console.error("Erro ao criar trial:", error);

            // Se for erro de licença duplicada, retorna 409 Conflict
            if (
                error instanceof Error &&
                error.message ===
                    "Já existe uma licença para esta organização e time"
            ) {
                return res.status(409).json({
                    error: error.message,
                });
            }

            return res
                .status(500)
                .json({ error: "Erro ao criar licença trial" });
        }
    }

    static async createCheckoutSession(
        req: Request,
        res: Response
    ): Promise<Response> {
        try {
            const { organizationId, quantity, teamId, planType } = req.body;

            if (!organizationId || !quantity || !teamId) {
                return res.status(400).json({
                    error: "ID da organização, quantidade e teamId são obrigatórios",
                });
            }

            const checkoutUrl = await StripeService.createCheckoutSession(
                organizationId,
                quantity,
                teamId,
                planType || PlanType.TEAMS_MANAGED_LEGACY
            );

            return res.json({ url: checkoutUrl });
        } catch (error) {
            console.error("Erro ao criar sessão de checkout:", error);
            return res
                .status(500)
                .json({ error: "Erro ao criar sessão de checkout" });
        }
    }

    static async handleWebhook(req: Request, res: Response): Promise<Response> {
        const sig = req.headers["stripe-signature"] as string;

        if (!sig) {
            return res.status(400).json({ error: "Stripe signature missing" });
        }

        try {
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

            const event = stripe.webhooks.constructEvent(
                req.body,
                sig,
                process.env.STRIPE_WEBHOOK_SECRET || ""
            );

            console.log("Webhook event processado com sucesso:", event.type);

            await StripeService.handleWebhookEvent(event);

            return res.json({ received: true });
        } catch (error) {
            console.error("Webhook error:", error);
            return res.status(400).json({ error: "Webhook error" });
        }
    }

    static async getPlans(req: Request, res: Response): Promise<Response> {
        try {
            const catalog = await PlanCatalogService.getCatalog();

            return res.json(catalog);
        } catch (error) {
            console.error("Erro ao listar planos:", error);
            return res.status(500).json({ error: "Erro ao listar planos" });
        }
    }

    static async validateLicense(
        req: Request,
        res: Response
    ): Promise<Response> {
        try {
            const { organizationId, teamId } = req.query;

            if (!organizationId) {
                return res.status(400).json({
                    error: "ID da organização e cloudToken são obrigatórios",
                });
            }

            const result = await OrganizationLicenseService.validateLicense(
                organizationId as string,
                teamId as string
            );

            return res.json(result);
        } catch (error) {
            console.error("Erro ao validar token:", error);
            return res.status(500).json({ error: "Erro ao validar token" });
        }
    }

    static async assignLicense(req: Request, res: Response): Promise<Response> {
        try {
            const { organizationId, users, teamId, editedBy, userName } =
                req.body;

            if (!organizationId || !teamId) {
                return res.status(400).json({
                    error: "ID da organização e teamId são obrigatórios",
                });
            }

            // Normaliza o input para sempre ser um array
            const usersArray = Array.isArray(users) ? users : [users];

            if (!usersArray.length) {
                return res.status(400).json({
                    error: "É necessário fornecer pelo menos um usuário",
                });
            }

            // Validar estrutura de cada usuário
            for (const user of usersArray) {
                if (
                    !user.gitId ||
                    !user.gitTool ||
                    user.licenseStatus === undefined
                ) {
                    return res.status(400).json({
                        error: "Cada usuário deve ter gitId, gitTool e licenseStatus",
                    });
                }
            }

            const results =
                await OrganizationLicenseService.assignLicensesToUsers(
                    organizationId,
                    teamId,
                    usersArray
                );

            if (results.successful.length > 0) {
                OrganizationLicenseService.notifyUserStatusChanges(
                    results.successful,
                    organizationId,
                    teamId,
                    editedBy,
                    userName
                ).catch((error) => {
                    console.error(
                        "Erro ao tentar registrar log de status:",
                        error
                    );
                });
            }

            return res.status(201).json(results);
        } catch (error) {
            console.error("Erro ao atribuir licença(s):", error);
            return res.status(500).json({
                error:
                    error instanceof Error
                        ? error.message
                        : "Erro ao atribuir licença(s) ao(s) usuário(s)",
            });
        }
    }

    static async checkUserLicense(
        req: Request,
        res: Response
    ): Promise<Response> {
        try {
            const { organizationId, gitId, teamId } = req.query;

            if (!organizationId || !gitId || !teamId) {
                return res.status(400).json({
                    error: "ID da organização, userId e teamId são obrigatórios",
                });
            }

            const license = await OrganizationLicenseService.checkUserLicense(
                organizationId as string,
                gitId as string,
                teamId as string
            );

            return res.status(200).json(license);
        } catch (error) {
            console.error("Erro ao verificar licença do usuário:", error);
            return res
                .status(500)
                .json({ error: "Erro ao verificar licença do usuário" });
        }
    }

    static async getAllUsersWithLicense(
        req: Request,
        res: Response
    ): Promise<Response> {
        try {
            const { organizationId, teamId } = req.query;

            if (!organizationId || !teamId) {
                return res.status(400).json({
                    error: "ID da organização e teamId são obrigatórios",
                });
            }

            const licenses =
                await OrganizationLicenseService.getAllUsersWithLicense(
                    organizationId as string,
                    teamId as string
                );

            return res.status(200).json(licenses);
        } catch (error) {
            console.error("Erro ao buscar usuários com licença:", error);
            return res.status(500).json({
                error: "Erro ao buscar usuários com licença",
            });
        }
    }

    static async getCustomerPortalUrl(req: Request, res: Response) {
        try {
            const { organizationId, teamId } = req.params;

            if (!organizationId || !teamId) {
                return res.status(400).json({
                    error: "Organization ID and Team ID are required.",
                });
            }

            const url = await StripeService.createCustomerPortalSession(
                organizationId,
                teamId
            );

            return res.json({ url });
        } catch (error) {
            return res.status(400).json({
                error:
                    error instanceof Error
                        ? error.message
                        : "Erro ao gerar URL do portal",
            });
        }
    }

    static async updateTrial(req: Request, res: Response): Promise<Response> {
        try {
            const { organizationId, teamId, trialEnd, adminToken } = req.body;

            if (!organizationId || !teamId || !trialEnd || !adminToken) {
                return res.status(400).json({
                    error: "ID da organização, teamId, trialEnd e token de admin são obrigatórios",
                });
            }

            const isValidAdmin = validateAdminToken(adminToken);

            if (!isValidAdmin) {
                return res.status(401).json({
                    error: "Token de admin inválido",
                });
            }

            const dateRegex =
                /^\d{4}-\d{2}-\d{2}(T\d{2}(:\d{2}){0,1})?\.\d{3}Z$/;
            if (
                !dateRegex.test(trialEnd) &&
                !/^\d{4}-\d{2}-\d{2}$/.test(trialEnd)
            ) {
                return res.status(400).json({
                    error: "A data de fim do trial deve estar no formato ISO 8601 (YYYY-MM-DDTHH:MM:SS.SSSZ) ou YYYY-MM-DD",
                });
            }

            const updatedLicense = await OrganizationLicenseService.updateTrial(
                organizationId,
                teamId,
                new Date(trialEnd)
            );

            return res.status(200).json(updatedLicense);
        } catch (error) {
            console.error("Erro ao atualizar trial:", error);
            return res.status(500).json({
                error: "Erro ao atualizar trial",
            });
        }
    }

    static async migrateToFreePlan(
        req: Request,
        res: Response
    ): Promise<Response> {
        try {
            const { organizationId, teamId } = req.body;

            if (!organizationId || !teamId) {
                return res.status(400).json({
                    error: "ID da organização e teamId são obrigatórios",
                });
            }

            const license = await OrganizationLicenseService.migrateToFreePlan(
                organizationId,
                teamId
            );

            return res.json({ success: true, license });
        } catch (error) {
            console.error("Erro ao migrar para plano gratuito:", error);
            return res.status(500).json({
                error:
                    error instanceof Error
                        ? error.message
                        : "Erro ao migrar para plano gratuito",
            });
        }
    }
}
