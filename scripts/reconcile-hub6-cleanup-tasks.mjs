#!/usr/bin/env node
import fs from "node:fs";

function loadEnv(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()])
      process.env[match[1].trim()] = match[2]
        .trim()
        .replace(/^['"]|['"]$/g, "");
  }
}

loadEnv(".env");
const apply = process.argv.includes("--apply");
const explicitDryRun = process.argv.includes("--dry-run");
if (apply && explicitDryRun)
  throw new Error("Choose either --dry-run or --apply");

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "HUB-6 reconciliation requires SUPABASE_SECRET_KEY (server only). No mutation was attempted.",
  );
  process.exit(2);
}

const headers = {
  apikey: key,
  authorization: `Bearer ${key}`,
  "content-type": "application/json",
};
async function rpc(name, body = {}) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      `${name} failed (${response.status}): ${result?.message || "unknown error"}`,
    );
  return result;
}

const report = await rpc("hub6_cleanup_reconciliation_report");
const metrics = Object.fromEntries(
  report.map((item) => [item.metric, Number(item.value)]),
);
console.log("HUB-6 SOLD cleanup reconciliation");
console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"}`);
console.log(`sold products inspected: ${metrics.sold_products ?? 0}`);
console.log(
  `active external publications: ${metrics.actionable_active_publications ?? 0}`,
);
console.log(`existing cleanup tasks: ${metrics.existing_active_tasks ?? 0}`);
console.log(`missing tasks: ${metrics.missing_tasks ?? 0}`);
console.log(`duplicates/conflicts: ${metrics.conflicts ?? 0}`);

if (!apply) {
  console.log(
    "No rows changed. Use --apply only after reviewing truthful candidates.",
  );
  process.exit(0);
}

if ((metrics.conflicts ?? 0) > 0)
  throw new Error("Conflicts found; refusing mutation");
const productsResponse = await fetch(
  `${url}/rest/v1/products?select=id&status=eq.sold`,
  { headers },
);
if (!productsResponse.ok)
  throw new Error(`sold product lookup failed (${productsResponse.status})`);
const products = await productsResponse.json();
let created = 0;
for (const product of products)
  created += Number(
    await rpc("ensure_sold_product_cleanup_tasks", {
      target_product_id: product.id,
      task_source: "RECONCILIATION",
    }),
  );
console.log(`created truthful missing tasks: ${created}`);
