import { NextRequest } from "next/server";

/**
 * Demo CSV templates matching the import schema exactly.
 * GET /api/csv-template?entity=contacts|items|invoices
 */

const templates: Record<string, string[][]> = {
  contacts: [
    ["kind", "name", "company", "email", "phone", "kra_pin", "address", "city", "groups"],
    ["customer", "Acme Distributors Ltd", "Acme Distributors Ltd", "accounts@acme.co.ke", "+254722000111", "P051111111A", "P.O. Box 100", "Nairobi", "Wholesale, Key Accounts"],
    ["vendor", "Simba Suppliers", "", "sales@simba.co.ke", "+254733222333", "P052222222B", "", "Mombasa", ""],
    ["both", "Jengo Hardware", "", "", "+254711444555", "", "", "Nakuru", "Retail"],
  ],
  items: [
    ["type", "name", "group", "sku", "unit", "selling_price", "buying_cost", "vat_class", "track_stock", "reorder_level", "opening_qty"],
    ["service", "Consulting (hourly)", "Services", "", "hour", "5000.00", "0", "B16", "no", "0", "0"],
    ["goods", "Branded T-Shirt", "Apparel", "TS-001", "pc", "1200.00", "700.00", "B16", "yes", "10", "25"],
    ["goods", "Maize Flour 2kg", "Groceries", "MF-2KG", "pc", "210.00", "180.00", "C0", "yes", "50", "100"],
  ],
  invoices: [
  ["invoice_ref", "customer_name", "date", "due_date", "description", "qty", "unit_price", "discount_pct", "vat_class"],
  ["INV-A", "Acme Distributors Ltd", "2026-07-01", "2026-07-31", "Consulting (hourly)", "8", "5000.00", "0", "B16"],
  ["INV-A", "Acme Distributors Ltd", "2026-07-01", "2026-07-31", "Branded T-Shirt", "20", "1200.00", "5", "B16"],
  ["INV-B", "Jengo Hardware", "2026-07-02", "", "Delivery service", "1", "3500.00", "0", "B16"],
  ],
  inventory: [
    ["item_name", "label", "qty", "condition", "warehouse", "sku", "unit", "selling_price", "buying_cost", "vat_class"],
    ["Chiavari Chair", "Chiavari Chairs — Gold (Batch A)", "100", "good", "Main Warehouse", "CHR-GLD", "pc", "0", "1500.00", "B16"],
    ["Round Table 10-seater", "Round Tables 10ft", "15", "good", "Main Warehouse", "TBL-10", "pc", "0", "8000.00", "B16"],
    ["PA Speaker System", "PA System — Set 1", "2", "fair", "AV Store", "", "set", "0", "45000.00", "B16"],
  ],
};

const notes: Record<string, string> = {
  contacts: "# kind: customer | vendor | both. Name required; duplicates (same name) are skipped. groups: comma-separated customer group names (e.g. Wholesale, Key Accounts).",
  items: "# type: service | goods | unproduced, or any custom type set up under Items > Item types. group: item group name (created automatically if missing; required when the org enforces item groups and the type requires one). vat_class: B16 (16%) | C0 (zero-rated) | A_EXEMPT | D_NONVAT. track_stock: yes | no. Prices in KSh. opening_qty: starting stock on hand, valued at buying_cost (only used when track_stock is yes).",
  invoices: "# Rows with the same invoice_ref become ONE invoice (multi-line). Imported as DRAFTS — review and issue in the app. Dates YYYY-MM-DD. Prices in KSh before VAT.",
  inventory: "# item_name: matched against Items & Stock by name (case-insensitive) — reused if found, created automatically if not (as a non-tracked rental item; selling_price/buying_cost/sku/unit/vat_class are only used when creating a new item). label: this batch's own label (e.g. \"Chiavari Chairs — Gold (Batch A)\"). qty: units in this batch. condition: good | fair | poor | damaged. warehouse: created automatically if missing, leave blank for unassigned.",
};

export async function GET(req: NextRequest) {
  const entity = req.nextUrl.searchParams.get("entity") ?? "";
  const t = templates[entity];
  if (!t) return new Response("Unknown entity", { status: 400 });
  const csv = `${notes[entity]}\n` + t.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c}"` : c)).join(",")).join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="zeno-${entity}-template.csv"`,
    },
  });
}
