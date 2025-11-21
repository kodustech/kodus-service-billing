import Stripe from "stripe";
import catalog from "../data/planCatalog.json";
import { PlanType } from "../entities/OrganizationLicense";
import { getPriceIdForPlan } from "../config/planPricing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");

const DEFAULT_LOCALE = "en-US";

const planTypeValues = new Set<string>(Object.values(PlanType));

const planCatalogData = catalog as {
  plans: CatalogEntry[];
};

type CatalogEntryType = "plan" | "addon" | "contact";

type CatalogEntry = {
  id: string;
  aliases?: string[];
  label: string;
  description?: string;
  type: CatalogEntryType;
  minimumSeats?: number;
  features: string[];
  addonIds?: string[];
};

type BillingOption = {
  planType: PlanType;
  priceId: string;
  currency: string;
  interval: Stripe.Price.Recurring.Interval;
  intervalCount: number;
  amount: number;
  formattedAmount: string;
};

type EnrichedEntry = CatalogEntry & {
  pricing: BillingOption[];
};

type PlanEnrichedEntry = EnrichedEntry & {
  addons: EnrichedEntry[];
};

type PlanCatalog = {
  plans: PlanEnrichedEntry[];
  addons: EnrichedEntry[];
};

export class PlanCatalogService {
  static async getCatalog(): Promise<PlanCatalog> {
    const enrichedPlans = await Promise.all(
      planCatalogData.plans.map(async (entry) => this.enrichEntry(entry))
    );

    const planMap = new Map<string, EnrichedEntry>();
    enrichedPlans.forEach((plan) => {
      planMap.set(plan.id, plan);
    });

    const addonsSet = new Set<string>();
    planCatalogData.plans.forEach((plan) => {
      if (plan.addonIds) {
        plan.addonIds.forEach((addonId) => addonsSet.add(addonId));
      }
    });

    const addons = Array.from(addonsSet)
      .map((addonId) => planMap.get(addonId))
      .filter((addon): addon is EnrichedEntry => Boolean(addon));

    const plansWithAddons: PlanEnrichedEntry[] = enrichedPlans.map((plan) => ({
      ...plan,
      addons: (plan.addonIds || [])
        .map((addonId) => planMap.get(addonId))
        .filter((addon): addon is EnrichedEntry => Boolean(addon)),
    }));

    return { plans: plansWithAddons, addons };
  }

  private static async enrichEntry(
    entry: CatalogEntry
  ): Promise<EnrichedEntry> {
    const planTypes = [entry.id, ...(entry.aliases || [])]
      .map((id) => this.toPlanType(id))
      .filter((planType): planType is PlanType => Boolean(planType));

    const pricing = await this.resolvePricing(planTypes);

    return {
      ...entry,
      pricing,
    };
  }

  private static toPlanType(planId: string): PlanType | undefined {
    if (planTypeValues.has(planId)) {
      return planId as PlanType;
    }

    return undefined;
  }

  private static async resolvePricing(
    planTypes: PlanType[]
  ): Promise<BillingOption[]> {
    const uniquePlanTypes = Array.from(new Set(planTypes));
    const pricing: BillingOption[] = [];

    for (const planType of uniquePlanTypes) {
      const priceId = getPriceIdForPlan(planType, { fallbackToLegacy: false });

      if (!priceId) {
        continue;
      }

      try {
        const price = await stripe.prices.retrieve(priceId, {
          expand: ["tiers", "currency_options"],
        });

        if (!price.recurring) {
          continue;
        }

        const pricingData = extractPriceInfo(price);

        if (!pricingData) {
          continue;
        }

        pricing.push({
          planType,
          priceId,
          currency: pricingData.currency,
          interval: price.recurring.interval,
          intervalCount: price.recurring.interval_count || 1,
          amount: pricingData.amount,
          formattedAmount: formatAmount(
            pricingData.amount,
            pricingData.currency
          ),
        });
      } catch (error) {
        console.error(
          `Não foi possível recuperar o preço do plano ${planType}:`,
          error
        );
      }
    }

    return pricing;
  }
}

function extractPriceInfo(price: Stripe.Price):
  | { amount: number; currency: string }
  | undefined {
  const directAmountDecimal = price.unit_amount_decimal;

  if (directAmountDecimal) {
    return { amount: Number(directAmountDecimal) / 100, currency: price.currency };
  }

  if (price.unit_amount !== null) {
    return { amount: price.unit_amount / 100, currency: price.currency };
  }

  const currencyOption = resolveCurrencyOption(price);
  if (currencyOption) {
    return currencyOption;
  }

  const tierAmount = resolveTierAmount(price);
  if (tierAmount) {
    return tierAmount;
  }

  return undefined;
}

function resolveCurrencyOption(price: Stripe.Price):
  | { amount: number; currency: string }
  | undefined {
  if (!price.currency_options) {
    return undefined;
  }

  const currentCurrencyOption = price.currency_options[price.currency];

  if (currentCurrencyOption) {
    const resolved = extractUnitAmount(currentCurrencyOption);

    if (resolved !== undefined) {
      return { amount: resolved, currency: price.currency };
    }
  }

  for (const [currency, option] of Object.entries(price.currency_options)) {
    const resolved = extractUnitAmount(option);

    if (resolved !== undefined) {
      return { amount: resolved, currency };
    }
  }

  return undefined;
}

function resolveTierAmount(price: Stripe.Price):
  | { amount: number; currency: string }
  | undefined {
  if (!price.tiers || !Array.isArray(price.tiers)) {
    return undefined;
  }

  for (const tier of price.tiers) {
    if (tier.unit_amount_decimal) {
      return {
        amount: Number(tier.unit_amount_decimal) / 100,
        currency: price.currency,
      };
    }

    if (tier.unit_amount !== null && tier.unit_amount !== undefined) {
      return {
        amount: tier.unit_amount / 100,
        currency: price.currency,
      };
    }

    if (tier.flat_amount_decimal) {
      return {
        amount: Number(tier.flat_amount_decimal) / 100,
        currency: price.currency,
      };
    }

    if (tier.flat_amount !== null && tier.flat_amount !== undefined) {
      return {
        amount: tier.flat_amount / 100,
        currency: price.currency,
      };
    }
  }

  return undefined;
}

function extractUnitAmount(
  option: Stripe.Price.CurrencyOptions
): number | undefined {
  if (option.unit_amount_decimal) {
    return Number(option.unit_amount_decimal) / 100;
  }

  if (option.unit_amount !== null && option.unit_amount !== undefined) {
    return option.unit_amount / 100;
  }

  return undefined;
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(DEFAULT_LOCALE, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch (error) {
    console.warn(
      `Não foi possível formatar o valor para ${currency}. Utilizando fallback padrão.`,
      error
    );

    return new Intl.NumberFormat(DEFAULT_LOCALE, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  }
}
