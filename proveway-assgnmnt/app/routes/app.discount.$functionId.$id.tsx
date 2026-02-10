/**
 * Discount edit route for app-based discounts.
 * Loads products and the matching discount rule, then saves updates to shop metafields.
 */
import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, data, useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type ProductSummary = {
  id: string;
  title: string;
};

type DiscountConfig = {
  percentOff: number;
  products: string[];
  minQty: number;
};

type DiscountRule = DiscountConfig & {
  discountId?: string;
};

type ActionData = {
  errors?: { message: string }[];
  success?: boolean;
  fields?: {
    title?: string;
    percentOff?: string;
    products?: string[];
  };
};

const PRODUCTS_QUERY = `#graphql
  query Products($first: Int!) {
    products(first: $first) {
      nodes {
        id
        title
      }
    }
  }`;

const SHOP_QUERY = `#graphql
  query ShopConfig {
    shop {
      id
      metafield(namespace: "custom", key: "volume_discount_rules") {
        jsonValue
      }
    }
  }`;

const DISCOUNT_QUERY = `#graphql
  query DiscountNode($id: ID!) {
    discountNode(id: $id) {
      id
      discount {
        ... on DiscountAutomaticApp {
          title
        }
      }
    }
  }`;

const UPDATE_DISCOUNT_MUTATION = `#graphql
  mutation UpdateDiscount(
    $id: ID!
    $automaticAppDiscount: DiscountAutomaticAppInput!
  ) {
    discountAutomaticAppUpdate(
      id: $id
      automaticAppDiscount: $automaticAppDiscount
    ) {
      userErrors {
        field
        message
      }
      automaticAppDiscount {
        discountId
        title
      }
    }
  }`;

const METAFIELDS_SET_MUTATION = `#graphql
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors {
        field
        message
      }
      metafields {
        id
      }
    }
  }`;

function parseRule(raw: unknown): DiscountRule | null {
  if (!raw || typeof raw !== "object") return null;

  const rawPercent = (raw as { percentOff?: unknown }).percentOff;
  const percentOff =
    typeof rawPercent === "number"
      ? rawPercent
      : typeof rawPercent === "string"
        ? Number(rawPercent)
        : NaN;

  if (!Number.isFinite(percentOff)) return null;

  const rawProducts = (raw as { products?: unknown }).products;
  if (!Array.isArray(rawProducts)) return null;

  const products = rawProducts.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  const rawMinQty = (raw as { minQty?: unknown }).minQty;
  const minQty =
    typeof rawMinQty === "number"
      ? rawMinQty
      : typeof rawMinQty === "string"
        ? Number(rawMinQty)
        : NaN;

  if (!Number.isFinite(minQty) || minQty < 2) return null;

  const discountId =
    typeof (raw as { discountId?: unknown }).discountId === "string"
      ? ((raw as { discountId?: unknown }).discountId as string)
      : undefined;

  return { discountId, percentOff, products, minQty };
}

function parseRules(raw: unknown): DiscountRule[] {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }

  if (!raw || typeof raw !== "object") return [];

  const rulesValue = (raw as { rules?: unknown }).rules;
  if (Array.isArray(rulesValue)) {
    return rulesValue
      .map(parseRule)
      .filter((rule): rule is DiscountRule => Boolean(rule));
  }

  const legacyRule = parseRule(raw);
  return legacyRule ? [legacyRule] : [];
}

function normalizeDiscountIds(rawId?: string) {
  if (!rawId) {
    return { discountNodeId: undefined, updateId: undefined };
  }

  const decoded = decodeURIComponent(rawId);

  if (decoded.startsWith("gid://")) {
    if (decoded.includes("/DiscountNode/")) {
      return { discountNodeId: decoded, updateId: decoded };
    }
    if (decoded.includes("/DiscountAutomaticApp/")) {
      const numeric = decoded.split("/").pop();
      return {
        discountNodeId: numeric
          ? `gid://shopify/DiscountNode/${numeric}`
          : decoded,
        updateId: decoded,
      };
    }
    return { discountNodeId: decoded, updateId: decoded };
  }

  if (/^\d+$/.test(decoded)) {
    return {
      discountNodeId: `gid://shopify/DiscountNode/${decoded}`,
      updateId: `gid://shopify/DiscountAutomaticApp/${decoded}`,
    };
  }

  return { discountNodeId: decoded, updateId: decoded };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  if (!params.id) {
    return data(
      {
        products: [],
        title: "Buy 2 Get % Off",
        config: { percentOff: 10, products: [], minQty: 2 },
      },
      { status: 400 },
    );
  }

  const { discountNodeId } = normalizeDiscountIds(params.id);

  if (!discountNodeId) {
    return data(
      {
        products: [],
        title: "Buy 2 Get % Off",
        config: { percentOff: 10, products: [], minQty: 2 },
      },
      { status: 400 },
    );
  }

  const [productsResponse, discountResponse, shopResponse] = await Promise.all([
    admin.graphql(PRODUCTS_QUERY, { variables: { first: 50 } }),
    admin.graphql(DISCOUNT_QUERY, { variables: { id: discountNodeId } }),
    admin.graphql(SHOP_QUERY),
  ]);

  const productsJson = await productsResponse.json();
  const discountJson = await discountResponse.json();
  const shopJson = await shopResponse.json();

  const products: ProductSummary[] = productsJson.data?.products?.nodes ?? [];
  const discountNode = discountJson.data?.discountNode;
  const title = discountNode?.discount?.title ?? "Buy 2 Get % Off";
  const rules = parseRules(shopJson.data?.shop?.metafield?.jsonValue);
  const matchedRule =
    rules.find(
      (rule) =>
        rule.discountId === params.id ||
        rule.discountId === discountNodeId,
    ) ?? (rules.length === 1 && !rules[0]?.discountId ? rules[0] : undefined);
  const config = matchedRule
    ? {
        percentOff: matchedRule.percentOff,
        products: matchedRule.products,
        minQty: matchedRule.minQty,
      }
    : ({
        percentOff: 10,
        products: [],
        minQty: 2,
      } satisfies DiscountConfig);

  return data({
    products,
    title,
    config,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const title = String(formData.get("title") ?? "").trim();
  const percentOffRaw = String(formData.get("percentOff") ?? "").trim();
  const products = formData
    .getAll("products")
    .filter((id): id is string => typeof id === "string");

  const errors: { message: string }[] = [];

  if (!title) errors.push({ message: "Title is required." });

  const percentOff = Number(percentOffRaw);
  if (!Number.isFinite(percentOff) || percentOff < 1 || percentOff > 80) {
    errors.push({ message: "Percent off must be between 1 and 80." });
  }

  if (products.length === 0) {
    errors.push({ message: "Select at least one product." });
  }

  const { discountNodeId, updateId } = normalizeDiscountIds(params.id);
  if (!updateId) {
    errors.push({ message: "Missing discount ID in route parameters." });
  }

  if (errors.length > 0) {
    return data<ActionData>(
      {
        errors,
        fields: {
          title,
          percentOff: percentOffRaw,
          products,
        },
      },
      { status: 400 },
    );
  }

  const shopResponse = await admin.graphql(SHOP_QUERY);
  const shopJson = await shopResponse.json();
  const shopId = shopJson.data?.shop?.id as string | undefined;
  const existingRules = parseRules(
    shopJson.data?.shop?.metafield?.jsonValue,
  );

  if (!shopId) {
    return data<ActionData>(
      { errors: [{ message: "Unable to resolve shop ID." }] },
      { status: 500 },
    );
  }

  const updateResponse = await admin.graphql(UPDATE_DISCOUNT_MUTATION, {
    variables: {
      id: updateId,
      automaticAppDiscount: {
        title,
        discountClasses: ["PRODUCT"],
      },
    },
  });
  const updateJson = await updateResponse.json();
  const updatePayload = updateJson.data?.discountAutomaticAppUpdate;

  if (updatePayload?.userErrors?.length) {
    return data<ActionData>(
      {
        errors: updatePayload.userErrors.map((error: { message: string }) => ({
          message: error.message,
        })),
        fields: {
          title,
          percentOff: percentOffRaw,
          products,
        },
      },
      { status: 400 },
    );
  }

  const updatedRules = [
    ...existingRules.filter(
      (rule) =>
        !rule.discountId ||
        (discountNodeId
          ? rule.discountId !== discountNodeId
          : rule.discountId !== updateId),
    ),
    {
      discountId: discountNodeId ?? updateId,
      products,
      minQty: 2,
      percentOff,
    },
  ];

  const metafieldValue = JSON.stringify({ rules: updatedRules });
  const metafieldsResponse = await admin.graphql(METAFIELDS_SET_MUTATION, {
    variables: {
      metafields: [
        {
          ownerId: shopId,
          namespace: "custom",
          key: "volume_discount_rules",
          type: "json",
          value: metafieldValue,
        },
      ],
    },
  });
  const metafieldsJson = await metafieldsResponse.json();
  const metafieldsErrors = metafieldsJson.data?.metafieldsSet?.userErrors ?? [];

  if (metafieldsErrors.length > 0) {
    return data<ActionData>(
      {
        errors: metafieldsErrors.map((error: { message: string }) => ({
          message: error.message,
        })),
        fields: {
          title,
          percentOff: percentOffRaw,
          products,
        },
      },
      { status: 400 },
    );
  }

  return data<ActionData>({ success: true });
};

export default function DiscountEdit() {
  const { products, title, config } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show("Discount updated");
    } else if (actionData?.errors?.length) {
      shopify.toast.show(actionData.errors[0].message);
    }
  }, [actionData, shopify]);

  const initialSelected = actionData?.fields?.products ?? config.products;
  const [selectedProducts, setSelectedProducts] =
    useState<string[]>(initialSelected);

  useEffect(() => {
    setSelectedProducts(initialSelected);
  }, [initialSelected]);

  return (
    <s-page heading="Edit Buy 2 Get % Off">
      <Form method="post">
        <s-section heading="Discount details">
          <div style={{ display: "grid", gap: "12px", maxWidth: "520px" }}>
            <label>
              Title
              <input
                type="text"
                name="title"
                defaultValue={actionData?.fields?.title ?? title}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              Percent off (1–80)
              <input
                type="number"
                name="percentOff"
                min={1}
                max={80}
                step={1}
                defaultValue={
                  actionData?.fields?.percentOff ?? String(config.percentOff)
                }
                style={{ width: "100%" }}
              />
            </label>
          </div>
        </s-section>

        <s-section heading="Eligible products">
          <s-paragraph>Select products that qualify for the discount.</s-paragraph>
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <s-button
              type="button"
              variant="tertiary"
              onClick={() => setSelectedProducts(products.map(product => product.id))}
            >
              Select all
            </s-button>
            <s-button
              type="button"
              variant="tertiary"
              onClick={() => setSelectedProducts([])}
            >
              Clear all
            </s-button>
          </div>
          <div
            style={{
              display: "grid",
              gap: "8px",
              marginTop: "12px",
              maxHeight: "320px",
              overflow: "auto",
              border: "1px solid #e1e3e5",
              borderRadius: "8px",
              padding: "12px",
            }}
          >
            {products.map((product) => (
              <label key={product.id}>
                <input
                  type="checkbox"
                  name="products"
                  value={product.id}
                  checked={selectedProducts.includes(product.id)}
                  onChange={(event) => {
                    setSelectedProducts((current) =>
                      event.target.checked
                        ? [...current, product.id]
                        : current.filter((id) => id !== product.id),
                    );
                  }}
                />{" "}
                {product.title}
              </label>
            ))}
          </div>
          <s-paragraph>Minimum quantity is fixed at 2 for this discount.</s-paragraph>
        </s-section>

        <s-section>
          <s-button type="submit" variant="primary">
            Save changes
          </s-button>
        </s-section>
      </Form>
    </s-page>
  );
}
