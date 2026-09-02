/* Captures real, logged-in screenshots of the screens the system guide
   references, using a dedicated documentation-tooling staff account (created
   here if it doesn't exist yet — org 3, "Zeno events", the app's own dev/QA
   org). Screenshots land in public/docs/screenshots/, referenced by both the
   in-app guide and the PDF generator.

   Requires the dev server running on :3000 first (npm run dev).
   Run: npx tsx scripts/capture-screenshots.ts */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

// Plain scripts don't get Next.js's automatic .env.local loading — read it
// ourselves (same reason src/db/index.ts does this for DATABASE_URL).
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const BASE_URL = "http://localhost:3000";
const OUT_DIR = path.join(process.cwd(), "public", "docs", "screenshots");

const DOCS_BOT_EMAIL = "docs-screenshots@zenoevents.internal";
const DOCS_BOT_PASSWORD = "DocsScreenshotBot!2026";

const PORTAL_SLUG = "zeno-events";
const PORTAL_EMAIL = "peter.otieno.test@example.com";
const PORTAL_PASSWORD = "testpass123";

const STAFF_SHOTS: { name: string; path: string; waitFor?: string }[] = [
  { name: "dashboard", path: "/" },
  { name: "leads", path: "/leads" },
  { name: "projects-overview", path: "/projects/11?tab=overview" },
  { name: "quotes-list", path: "/sales/quotes" },
  { name: "invoices-list", path: "/sales/invoices" },
  { name: "event-inventory", path: "/projects/inventory" },
  { name: "items-stock", path: "/items" },
  { name: "manifest", path: "/projects/11/manifest" },
  { name: "contracts", path: "/projects/11?tab=contracts" },
  { name: "analytics", path: "/analytics" },
  { name: "staff-roles", path: "/staff" },
  { name: "settings", path: "/settings" },
];

const PORTAL_SHOTS: { name: string; path: string }[] = [
  { name: "client-portal-project", path: `/portal/${PORTAL_SLUG}/projects/11` },
];

async function ensureDocsBotAccount() {
  // Mirrors createStaff() in src/lib/staff-actions.ts, run standalone since
  // that function requires a live admin session this script doesn't have.
  const { createClient } = await import("@supabase/supabase-js");
  const { db, members } = await import("../src/db");
  const { eq, and } = await import("drizzle-orm");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.");
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const ORG_ID = 3; // "Zeno events" — this project's own dev/QA org
  const [existing] = await db.select().from(members).where(and(eq(members.orgId, ORG_ID), eq(members.email, DOCS_BOT_EMAIL))).limit(1);
  if (existing) {
    console.log("Docs screenshot account already exists — reusing it.");
    return;
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email: DOCS_BOT_EMAIL,
    password: DOCS_BOT_PASSWORD,
    email_confirm: true,
    user_metadata: { name: "Docs Screenshot Bot" },
  });
  if (error) throw new Error(`Could not create docs bot account: ${error.message}`);

  await db.insert(members).values({
    orgId: ORG_ID,
    userId: created.user.id,
    email: DOCS_BOT_EMAIL,
    name: "Docs Screenshot Bot",
    role: "admin",
    createdAt: new Date().toISOString(),
  });
  console.log("Created docs screenshot account (org 3, admin role).");
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await ensureDocsBotAccount();

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.emulateMedia({ media: "print" }); // hides the floating AI assistant pill via the app's own .no-print rule

  // Staff login
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', DOCS_BOT_EMAIL);
  await page.fill('input[type="password"]', DOCS_BOT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(BASE_URL + "/", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);

  for (const shot of STAFF_SHOTS) {
    console.log(`Capturing ${shot.name} (${shot.path})...`);
    await page.goto(BASE_URL + shot.path, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT_DIR, `${shot.name}.png`) });
  }

  // Client portal login — separate session, separate app
  await page.goto(`${BASE_URL}/portal/${PORTAL_SLUG}/login`);
  await page.fill('input[type="email"]', PORTAL_EMAIL);
  await page.fill('input[type="password"]', PORTAL_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);

  for (const shot of PORTAL_SHOTS) {
    console.log(`Capturing ${shot.name} (${shot.path})...`);
    await page.goto(BASE_URL + shot.path, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT_DIR, `${shot.name}.png`) });
  }

  await browser.close();
  console.log(`Done. Screenshots in ${OUT_DIR}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Screenshot capture failed:", e);
  process.exit(1);
});
