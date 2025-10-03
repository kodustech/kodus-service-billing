import { PlanType } from "../entities/OrganizationLicense";

type PlanPriceMap = Partial<Record<PlanType, string | undefined>>;

type GetPriceIdOptions = {
  fallbackToLegacy?: boolean;
};

const basePriceMap: PlanPriceMap = {
  [PlanType.FREE_BYOK]: undefined,
  [PlanType.TEAMS_BYOK]: process.env.STRIPE_PRICE_ID_TEAMS_BYOK,
  [PlanType.TEAMS_BYOK_ANNUAL]: process.env.STRIPE_PRICE_ID_TEAMS_BYOK_ANNUAL,
  [PlanType.TEAMS_MANAGED]: process.env.STRIPE_PRICE_ID_TEAMS_MANAGED,
  [PlanType.TEAMS_MANAGED_ANNUAL]: process.env.STRIPE_PRICE_ID_TEAMS_MANAGED_ANNUAL,
  [PlanType.TEAMS_MANAGED_LEGACY]:
    process.env.STRIPE_PRICE_ID_TEAMS_MANAGED_LEGACY || process.env.STRIPE_PRICE_ID,
  [PlanType.ENTERPRISE_BYOK]: process.env.STRIPE_PRICE_ID_ENTERPRISE_BYOK,
  [PlanType.ENTERPRISE_BYOK_ANNUAL]: process.env.STRIPE_PRICE_ID_ENTERPRISE_BYOK_ANNUAL,
  [PlanType.ENTERPRISE_MANAGED]: process.env.STRIPE_PRICE_ID_ENTERPRISE_MANAGED,
  [PlanType.ENTERPRISE_MANAGED_ANNUAL]: process.env.STRIPE_PRICE_ID_ENTERPRISE_MANAGED_ANNUAL,
};

const legacyFallbackPrice =
  process.env.STRIPE_PRICE_ID || process.env.STRIPE_PRICE_ID_TEAMS_MANAGED_LEGACY;

const priceIdToPlanType = new Map<string, PlanType>();

Object.entries(basePriceMap).forEach(([planKey, priceId]) => {
  if (priceId) {
    priceIdToPlanType.set(priceId, planKey as PlanType);
  }
});

export function getPriceIdForPlan(
  planType: PlanType,
  options?: GetPriceIdOptions
): string | undefined {
  const fallbackToLegacy = options?.fallbackToLegacy ?? true;
  const priceId = basePriceMap[planType];

  if (priceId) {
    return priceId;
  }

  return fallbackToLegacy ? legacyFallbackPrice : undefined;
}

export function getPlanTypeByPriceId(priceId?: string): PlanType {
  if (!priceId) {
    return PlanType.TEAMS_MANAGED_LEGACY;
  }

  const explicitPlanType = priceIdToPlanType.get(priceId);
  if (explicitPlanType) {
    return explicitPlanType;
  }

  if (priceId === legacyFallbackPrice) {
    return PlanType.TEAMS_MANAGED_LEGACY;
  }

  return PlanType.TEAMS_MANAGED_LEGACY;
}

export function listPlanPriceEntries(): Array<{
  planType: PlanType;
  priceId: string;
}> {
  const entries: Array<{ planType: PlanType; priceId: string }> = [];

  Object.entries(basePriceMap).forEach(([planKey, priceId]) => {
    if (priceId) {
      entries.push({ planType: planKey as PlanType, priceId });
    }
  });

  return entries;
}
