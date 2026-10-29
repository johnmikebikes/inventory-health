// Usage: node scripts/set-app-url.mjs https://inventory-health-xxxx.onrender.com
// Points the Shopify app config at the hosted app, then run `npm run deploy`.
import { readFileSync, writeFileSync } from "node:fs";

const url = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https:\/\/[^/]+$/.test(url)) {
  console.error("Give the full https address, e.g. https://inventory-health-xxxx.onrender.com");
  process.exit(1);
}
const file = "shopify.app.inventory-health.toml";
let s = readFileSync(file, "utf8");
s = s.replace(/^application_url = .*$/m, `application_url = "${url}"`);
s = s.replace(/^redirect_urls = .*$/m, `redirect_urls = [ "${url}/auth/callback" ]`);
// Keep `shopify app dev` from overwriting the live address.
s = s.replace(/^automatically_update_urls_on_dev = .*$/m, "automatically_update_urls_on_dev = false");
writeFileSync(file, s);
console.log(`Updated ${file} to ${url}. Next: npm run deploy`);
