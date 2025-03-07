import { Request, Response } from "express";
export declare class SubscriptionController {
    static createTrial(req: Request, res: Response): Promise<Response>;
    static createCheckoutSession(req: Request, res: Response): Promise<Response>;
    static handleWebhook(req: Request, res: Response): Promise<Response>;
    static validateCloudToken(req: Request, res: Response): Promise<Response>;
}
