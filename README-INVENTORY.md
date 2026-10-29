# Inventory Health (CORPORATE)

A read-only inventory health dashboard, embedded in the Shopify admin.
Spec: [Inventory Health Dashboard: Module 1 Spec](https://claude.ai/artifact/HwoQo2D485BnEwHL1VeeAr)

## Screens

| Screen | What it answers |
| --- | --- |
| Overview | Value at cost and retail, sell-through, aged %, dead stock, stockouts, broken runs, value by age, top brands. Every tile, bar and brand links to the styles behind it. |
| Aging & dead stock | Aged 90+ / dead / everything in stock, with checkboxes ready for Module 2 markdowns. |
| Size runs | Broken runs with a size grid per style (filled = in stock, outlined = sold out). |
| Stockouts | The "Always in stock" watchlist (search to add) plus out-of-stock and low-stock sizes. |
| All styles | Every style with sorting and CSV export; also where drill-downs land. |
| Settings | Thresholds, the hide tag, and which locations count as sellable. |

Filters (location, brand, type, archived) and saved views work on every screen. Each Shopify location gets an automatic view.

## How the numbers are made

- **Stock and catalog**: bulk operations each night (products, then variants with inventory levels), plus webhooks in between.
- **Movements**: ShopifyQL `inventory_adjustment_history` by day, variant and location. Initial adjustments and corrections that add units count as stock in; `order_fulfilled` is sold; `restock` is returned. Transfers between our locations are ignored, so they never reset age. Checked against Shopify: 12,797 fulfilled vs 12,827 net items sold over 90 days.
- **Age**: a style's age is the age of its oldest units on hand. History starts in 2024, so older stock uses the variant's created date and shows "~" (estimated). Drafts start aging at publish.
- **Size runs**: expected sizes = variants with a SKU/UPC or any stock history.

## Local development (dev store)

```
cd ~/Documents/Corporate/apps/inventory-health
npm run dev
```
Uses SQLite (`prisma/dev.sqlite`) and the inventory-health-test dev store. **After the app is live on Render, don't run `npm run dev` against it.** A separate dev app comes later.

## Deploy to Render (free tier)

1. **GitHub**: commit this folder and push it to a private repo named `inventory-health`.
2. **Render**: New > Blueprint, then pick the repo. Render reads `render.yaml` (a free web service plus free Postgres). It asks for:
   - `SHOPIFY_API_KEY`: the `client_id` in `shopify.app.inventory-health.toml`
   - `SHOPIFY_API_SECRET`: Dev Dashboard > Apps > Inventory Health > Settings > Secret
   - `SHOPIFY_APP_URL`: `https://inventory-health.onrender.com` (fix it after the first deploy if Render picks a different address)
3. **Shopify**: `node scripts/set-app-url.mjs https://<your-app>.onrender.com`, then `npm run deploy`. Install from Dev Dashboard > Inventory Health > Installs > Install app > Corporate.
4. **Nightly sync**: in the GitHub repo, go to Settings > Secrets and variables > Actions and add `APP_URL` and `JOB_TOKEN` (copy `JOB_TOKEN` from the Render service's Environment tab).

### Free-tier notes

- The app sleeps after 15 minutes without visits. The first open after that takes about a minute.
- The free Postgres database expires after 30 days. Upgrade it to Basic in Render before then (about $6/month) to keep the data. Upgrading the web service to Starter (about $7/month) removes the sleep.
- The first sync on the free tier takes about 20–30 minutes. Keep the app tab open while it runs; the page polling keeps the server awake.
