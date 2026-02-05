# Shopify Product Discount App

Shopify app that adds product‑level automatic discounts via a Shopify Function and exposes a Theme App Extension block to show the offer on product/cart pages.

**Features**
1. Automatic discount Function (cart.lines.discounts.generate.run)
2. Admin UI to configure product eligibility + percent off
3. Theme App Extension blocks for Product and Cart pages

**Install & Dev**
1. `npm install`
2. `shopify run dev` (starts Shopify CLI + app dev preview)

Useful commands:
1. `npm run build` (build app)
2. `npm run typecheck` (TS check)
3. Function (from `extensions/buy-2-get-free`):
   1. `npm run typegen`
   2. `npm run build`
   3. `npm run test` or `npm run test:unit`

**Where Config Is Stored**
Config is stored in a **Shop metafield**:
- **Namespace:** `custom`
- **Key:** `volume_discount_rules`
- **Type:** JSON
- **Storefront access:** must be enabled

Current JSON shape (per‑discount rules):
```json
{
  "rules": [
    {
      "discountId": "gid://shopify/DiscountNode/1234567890",
      "products": ["gid://shopify/Product/8104484438095"],
      "minQty": 2,
      "percentOff": 11
    }
  ]
}
```
**How To Add Discount**
1. Go to **Dashboard→ Discount → Create Discount**
2. Select **Buy 2 Get % Free → Configure as per requirement**
3. Click 'Create Discount'
4. The Function applies % off to eligible lines with quantity ≥ 2

**How To Add Widget blocks**
1. Edit the theme
2. Select product information, and click add block.
3. Move to "Apps" tab and select "Buy 2 Get % Off" and click save.
4. The widget will be alinged for the selected product.

Optional cart block:
1. Switch to **Cart** template
2. Add **Buy 2, get % off (Cart)** from Apps assame like the "Discount Widget".

**Live Url**
https://provewayass.myshopify.com/

**Dummy Product/s Url to Check widgets and discount**
https://provewayass.myshopify.com/products/the-collection-snowboard-hydrogen
