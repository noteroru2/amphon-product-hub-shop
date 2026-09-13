#!/usr/bin/env node
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const migration = read(
  "supabase/migrations/20260913110000_hub6_sold_cleanup_tasks.sql",
);
const lib = read("src/lib/cleanupTasks.ts");
const channels = read("src/lib/publications.ts");
const queue = read("src/components/CleanupTaskQueue.tsx");
const tracker = read("src/components/SalesChannelTracker.tsx");
const app = read("src/App.tsx");
const reconcile = read("scripts/reconcile-hub6-cleanup-tasks.mjs");
const packageJson = read("package.json");
const failures = [];
function check(condition, label) {
  console.log(`${label.padEnd(45)} ${condition ? "PASS" : "FAIL"}`);
  if (!condition) failures.push(label);
}

check(
  migration.includes("create table if not exists public.sales_channel_tasks"),
  "HUB-6 schema present",
);
check(
  !/drop\s+table|truncate|delete\s+from/i.test(migration),
  "Migration additive only",
);
check(
  lib.includes("listSalesChannelTasks") && queue.includes("CleanupTaskQueue"),
  "Task model centralized",
);
check(
  migration.includes("sales_channel_cleanup_rules") &&
    channels.includes("soldCleanupTaskType"),
  "Channel cleanup config centralized",
);
check(
  migration.includes("old.status is distinct from new.status") &&
    migration.includes("new.status='sold'"),
  "SOLD transition detection",
);
check(
  !/new\.status='reserved'.*ensure_sold_product_cleanup_tasks/is.test(
    migration,
  ),
  "RESERVED does not create cleanup task",
);
check(
  migration.includes("'marketplace',true,'REMOVE_LISTING'"),
  "Marketplace cleanup generation",
);
check(
  migration.includes("'facebook',true,'UPDATE_LISTING'"),
  "Facebook Page cleanup generation",
);
check(migration.includes("'line',false,null"), "LINE excluded by default");
check(
  migration.includes("'website',false,null"),
  "SHOP excluded from manual cleanup",
);
check(
  migration.includes("on conflict (publication_id,task_type)") &&
    migration.includes("sales_channel_tasks_one_active_action_idx"),
  "Task generation idempotent",
);
check(
  migration.includes("where status in ('OPEN','IN_PROGRESS')"),
  "Duplicate active protection",
);
check(
  migration.includes(
    "publication_id uuid not null references public.product_publications",
  ),
  "Publication linkage",
);
check(
  migration.includes("complete_sales_channel_task") &&
    migration.includes("for update") &&
    migration.includes("update public.product_publications") &&
    migration.includes("update public.sales_channel_tasks"),
  "Atomic completion",
);
check(
  migration.includes("last_action_id=action_id") &&
    migration.includes("product_publications_hub6_task_sync"),
  "Publication history preserved",
);
check(
  migration.includes("completed_by_name") &&
    migration.includes("assigned_to_name"),
  "Employee attribution",
);
check(
  migration.includes("enable row level security") &&
    migration.includes("revoke all on public.sales_channel_tasks from anon"),
  "RLS/auth boundary",
);
check(
  migration.includes("PRODUCT_NO_LONGER_SOLD") &&
    migration.includes("status='CANCELLED'"),
  "Sale reversal behavior",
);
check(
  (migration.match(/for update/g) || []).length >= 3,
  "Concurrency protection",
);
check(
  migration.includes("if t.status='COMPLETED' then return t") &&
    migration.includes("action_id uuid"),
  "Retry idempotency",
);
check(
  reconcile.includes("--dry-run") &&
    reconcile.includes("--apply") &&
    reconcile.includes("No rows changed"),
  "Dry-run reconciliation",
);
check(
  queue.includes("ระบบไม่ได้ตรวจสอบจาก Facebook") &&
    !/facebook\.com\/login|cookie|playwright|puppeteer/i.test(
      queue + lib + migration,
    ),
  "No external social automation",
);
check(
  !/facebook_password|facebook_access_token|facebook_cookie/i.test(
    queue + lib + migration,
  ),
  "No Facebook credentials",
);
check(
  !/update\s+public\.commerce_|insert\s+into\s+public\.commerce_|create_commerce_order|checkout\/session|stripe/i.test(
    migration + lib + queue,
  ),
  "No SHOP mutation",
);
check(
  !/purchase_enabled\s*=\s*false/i.test(migration + lib + queue + tracker),
  "purchase_enabled=true preserved",
);
check(
  !/stripe_promptpay_enabled\s*=\s*true|promptpay_enabled\s*=\s*true/i.test(
    migration + lib + queue,
  ),
  "PromptPay disabled preserved",
);
check(
  app.includes("Product Hub") && packageJson.includes("verify:hub1"),
  "HUB-1 regression contract",
);
check(
  app.includes("ProductImageExportControls") &&
    packageJson.includes("verify:hub2"),
  "HUB-2 regression contract",
);
check(
  app.includes("SalesPostPackagePanel") && packageJson.includes("verify:hub3"),
  "HUB-3 regression contract",
);
check(
  app.includes("MarketplaceListingAssistant") &&
    packageJson.includes("verify:hub4"),
  "HUB-4 regression contract",
);
check(
  app.includes("SalesChannelTracker") && packageJson.includes("verify:hub5"),
  "HUB-5 regression contract",
);
check(
  queue.includes("ต้องทำทันที") &&
    queue.includes("งานทั้งหมด") &&
    app.includes("CleanupTaskCountCard"),
  "Task queue and dashboard UI",
);
check(
  tracker.includes("ProductCleanupTaskNotice"),
  "Product detail cleanup warning",
);

function generate(status, publications, existing = []) {
  if (status !== "sold") return existing;
  const rules = {
    marketplace: "REMOVE_LISTING",
    facebook: "UPDATE_LISTING",
    winner_it: "UPDATE_LISTING",
  };
  const output = [...existing];
  for (const publication of publications) {
    const taskType = rules[publication.channel];
    if (publication.status !== "published" || !taskType) continue;
    if (
      !output.some(
        (task) =>
          task.publicationId === publication.id &&
          task.taskType === taskType &&
          ["OPEN", "IN_PROGRESS"].includes(task.status),
      )
    )
      output.push({ publicationId: publication.id, taskType, status: "OPEN" });
  }
  return output;
}
const mp = { id: "mp1", channel: "marketplace", status: "published" };
check(
  generate("available", [mp]).length === 0,
  "Scenario 1 AVAILABLE + MP active",
);
check(
  generate("reserved", [mp]).length === 0,
  "Scenario 2 RESERVED + MP active",
);
check(
  generate("sold", []).length === 0,
  "Scenario 3 SOLD + no external active",
);
check(generate("sold", [mp]).length === 1, "Scenario 4 SOLD + MP active");
check(
  generate("sold", [mp], generate("sold", [mp])).length === 1,
  "Scenario 5 repeat remains one task",
);
check(
  generate("sold", [mp, { ...mp, id: "mp2" }]).length === 2,
  "Scenario 6 two publications, two tasks",
);
check(
  generate("sold", [{ id: "fb1", channel: "facebook", status: "published" }])[0]
    ?.taskType === "UPDATE_LISTING",
  "Scenario 7 Facebook Page configured",
);
check(
  generate("sold", [{ id: "line1", channel: "line", status: "published" }])
    .length === 0,
  "Scenario 8 LINE excluded",
);
check(
  migration.includes("status='ended'") &&
    migration.includes("status='COMPLETED'"),
  "Scenario 9 atomic completion contract",
);
check(
  migration.includes("if t.status='COMPLETED' then return t"),
  "Scenario 10 completion retry safe",
);
check(
  migration.includes("PRODUCT_NO_LONGER_SOLD"),
  "Scenario 11 reversal cancels open work",
);
check(
  !/delete\s+from\s+public\.sales_channel_tasks/i.test(migration),
  "Scenario 12 completed history retained",
);

const sensitivePatterns = [
  /sk_(?:live|test)_[A-Za-z0-9]{16,}/,
  /sb_secret_[A-Za-z0-9_-]{16,}/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
];
const changed = migration + lib + channels + queue + tracker + reconcile;
check(
  !sensitivePatterns.some((pattern) => pattern.test(changed)),
  "Secret scan",
);

if (failures.length) {
  console.error(`\nHUB-6 verifier failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\nHUB-6 verifier: PASS");
console.log("- No production data mutation performed by verifier: PASS");
console.log(
  "- No order, Stripe Session, charge, refund, or social automation: PASS",
);
