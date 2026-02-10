/**
 * File: Creates a new "Buy 2 Get % Off" discount configuration.
 * Uses a form to collect discount details and submits them to Shopify's Admin API.
 * Displays any validation or API errors to the user.
 */

import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, data, redirect, useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type ProductSummary = {
  id: string;
  title: string;
};

type ActionData = {
  errors?: { message: string }[];
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

const CREATE_DISCOUNT_MUTATION = `#graphql
  mutation CreateDiscount($automaticAppDiscount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
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

type DiscountRule = {
  discountId?: string;
  percentOff: number;
  products: string[];
  minQty: number;
};

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

//page loader
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const productsResponse = await admin.graphql(PRODUCTS_QUERY, {
    variables: { first: 50 },
  });
  const productsJson = await productsResponse.json();

  const products: ProductSummary[] = productsJson.data?.products?.nodes ?? [];

  return data({
    products,
    functionId: params.functionId ?? "",
    defaults: {
      title: "Buy 2 Get % Off",
      percentOff: "10",
      products: [] as string[],
    },
  });
};

//Create discount action(submit)
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

  const functionId = params.functionId ?? "";
  if (!functionId) {
    errors.push({ message: "Missing function ID in route parameters." });
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

  const createResponse = await admin.graphql(CREATE_DISCOUNT_MUTATION, {
    variables: {
      automaticAppDiscount: {
        title,
        functionId,
        startsAt: new Date().toISOString(),
        discountClasses: ["PRODUCT"],
        combinesWith: {
          orderDiscounts: false,
          productDiscounts: false,
          shippingDiscounts: false,
        },
      },
    },
  });
  const createJson = await createResponse.json();
  const payload = createJson.data?.discountAutomaticAppCreate;

  if (payload?.userErrors?.length) {
    return data<ActionData>(
      {
        errors: payload.userErrors.map((error: { message: string }) => ({
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

  const discountId = payload?.automaticAppDiscount?.discountId as
    | string
    | undefined;

  if (!discountId) {
    return data<ActionData>(
      { errors: [{ message: "Discount created, but no ID was returned." }] },
      { status: 500 },
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

  const updatedRules = [
    ...existingRules.filter(
      (rule) => !rule.discountId || rule.discountId !== discountId,
    ),
    {
      discountId,
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

  return redirect(`/app/discount/${functionId}/${encodeURIComponent(discountId)}`);
};

export default function DiscountCreate() {
  const { products, defaults } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const shopify = useAppBridge();

  const initialSelected =
    actionData?.fields?.products ?? defaults.products ?? [];
  const [selectedProducts, setSelectedProducts] =
    useState<string[]>(initialSelected);

  useEffect(() => {
    setSelectedProducts(initialSelected);
  }, [initialSelected]);

  useEffect(() => {
    if (actionData?.errors?.length) {
      shopify.toast.show(actionData.errors[0].message);
    }
  }, [actionData?.errors, shopify]);

  return (
    <s-page heading="Create Buy 2 Get % Off">
      <Form method="post">
        <s-section heading="Discount details">
          <div style={{ display: "grid", gap: "12px", maxWidth: "520px" }}>
            <label>
              Title
              <input
                type="text"
                name="title"
                defaultValue={actionData?.fields?.title ?? defaults.title}
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
                  actionData?.fields?.percentOff ?? defaults.percentOff
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
            Create discount
          </s-button>
        </s-section>
      </Form>
    </s-page>
  );
}
