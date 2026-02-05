/**
 * Shopify Function: applies percentage discounts to eligible cart lines based on
 * shop-level rules stored in the `custom.volume_discount_rules` metafield.
 */
import {
  CartInput,
  CartLinesDiscountsGenerateRunResult,
  CartOperation,
  ProductDiscountSelectionStrategy,
} from '../generated/api';

type DiscountRule = {
  percentOff: number;
  products: string[];
  minQty: number;
};

function parseRule(raw: unknown): DiscountRule | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const percentOffValue = (raw as { percentOff?: unknown }).percentOff;
  const percentOff =
    typeof percentOffValue === 'number'
      ? percentOffValue
      : typeof percentOffValue === 'string'
        ? Number(percentOffValue)
        : NaN;

  if (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > 80) {
    return null;
  }

  const productsValue = (raw as { products?: unknown }).products;
  if (!Array.isArray(productsValue)) {
    return null;
  }

  const products = productsValue.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );

  if (products.length === 0) {
    return null;
  }

  const minQtyValue = (raw as { minQty?: unknown }).minQty;
  const minQty =
    typeof minQtyValue === 'number'
      ? minQtyValue
      : typeof minQtyValue === 'string'
        ? Number(minQtyValue)
        : NaN;

  if (!Number.isFinite(minQty) || minQty < 2) {
    return null;
  }

  return { percentOff, products, minQty };
}

function parseDiscountRules(input: CartInput): DiscountRule[] {
  let raw = (
    input as CartInput & {
      shop?: { metafield?: { jsonValue?: unknown } | null };
    }
  ).shop?.metafield?.jsonValue as unknown;

  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }

  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const rulesValue = (raw as { rules?: unknown }).rules;
  if (Array.isArray(rulesValue)) {
    return rulesValue
      .map(parseRule)
      .filter((rule): rule is DiscountRule => Boolean(rule));
  }

  const legacyRule = parseRule(raw);
  return legacyRule ? [legacyRule] : [];
}

export function cartLinesDiscountsGenerateRun(
  input: CartInput,
): CartLinesDiscountsGenerateRunResult {
  const rules = parseDiscountRules(input);
  if (rules.length === 0) {
    return { operations: [] };
  }

  const linePercentMap = new Map<string, number>();

  const candidates = input.cart.lines
    .filter(line => {
      if (!('product' in line.merchandise)) return false;

      let bestPercent = 0;
      for (const rule of rules) {
        if (line.quantity < rule.minQty) continue;
        if (!rule.products.includes(line.merchandise.product.id)) continue;
        if (rule.percentOff > bestPercent) {
          bestPercent = rule.percentOff;
        }
      }

      if (bestPercent === 0) return false;
      linePercentMap.set(line.id, bestPercent);
      return true;
    })
    .map(line => ({
      targets: [{ cartLine: { id: line.id } }],
      value: {
        percentage: { value: linePercentMap.get(line.id) ?? 0 },
      },
    }));

  const operations: CartOperation[] =
    candidates.length === 0
      ? []
      : [
          {
            productDiscountsAdd: {
              selectionStrategy: ProductDiscountSelectionStrategy.All,
              candidates,
            },
          },
        ];

  return { operations };
}
