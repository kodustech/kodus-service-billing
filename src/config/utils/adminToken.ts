import * as crypto from 'crypto';

export default function validateAdminToken(token: string): boolean {
  const adminToken = process.env.ADMIN_TOKEN;

  if (!adminToken) {
    throw new Error("ADMIN_TOKEN não configurado");
  }

  const hashedToken = crypto.createHmac("sha256", adminToken).digest("hex");

  return crypto.createHmac("sha256", token).digest("hex") === hashedToken;
};
