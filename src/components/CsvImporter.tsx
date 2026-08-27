"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseKES } from "@/lib/money";
import {
  importContacts,
  importItems,
  importInvoices,
  importInventory,
  type ContactRow,
  type ItemRow,
  type InvoiceRow,
  type InventoryRow,
} from "@/lib/import-actions";

/**
 * CSV importer for contacts / items / invoices.
 * "Download template" gives a demo CSV whose columns match the DB import
 * schema; user fills it, uploads, previews, imports.
 */

function splitCsv(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  return lines.map((line) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

function indexHeaders(header: string[]) {
  const h = header.map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, "_"));
  return (...names: string[]) => h.findIndex((c) => names.includes(c));
}

const yes = (v: string) => ["yes", "y", "true", "1"].includes((v || "").toLowerCase());

type Entity = "contacts" | "items" | "invoices" | "inventory";

export function CsvImporter({ entity, label }: { entity: Entity; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ count: number; sample: string[]; rows: unknown[] } | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null); setResult(null); setPreview(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const grid = splitCsv(await file.text());
    if (grid.length < 2) return setError("File has no data rows.");
    const idx = indexHeaders(grid[0]);
    const body = grid.slice(1);

    try {
      if (entity === "contacts") {
        const iKind = idx("kind"), iName = idx("name", "display_name"), iCompany = idx("company", "company_name"),
          iEmail = idx("email"), iPhone = idx("phone"), iPin = idx("kra_pin", "pin"), iAddr = idx("address"), iCity = idx("city"),
          iGroups = idx("groups", "group", "customer_group", "customer_groups");
        if (iName < 0) throw new Error('Missing "name" column — download the template.');
        const rows: ContactRow[] = body.map((r) => ({
          kind: r[iKind] ?? "customer",
          displayName: r[iName] ?? "",
          companyName: r[iCompany], email: r[iEmail], phone: r[iPhone],
          kraPin: r[iPin], address: r[iAddr], city: r[iCity],
          groups: r[iGroups],
        })).filter((r) => r.displayName);
        setPreview({ count: rows.length, sample: rows.slice(0, 5).map((r) => `${r.displayName} (${r.kind})`), rows });
      } else if (entity === "items") {
        const iType = idx("type", "kind"), iName = idx("name"), iSku = idx("sku"), iUnit = idx("unit"),
          iGroup = idx("group", "item_group", "item_groups"),
          iSell = idx("selling_price", "sale_price", "price"), iBuy = idx("buying_cost", "purchase_cost", "cost"),
          iVat = idx("vat_class", "tax_class"), iTrack = idx("track_stock", "track_inventory"), iReorder = idx("reorder_level"),
          iOpening = idx("opening_qty", "opening_stock");
        if (iName < 0 || iSell < 0) throw new Error('Missing "name" / "selling_price" columns — download the template.');
        const rows: ItemRow[] = body.map((r) => ({
          kind: r[iType] ?? "service",
          name: r[iName] ?? "",
          group: r[iGroup],
          sku: r[iSku], unit: r[iUnit],
          salePriceCents: parseKES(r[iSell] ?? "") || 0,
          purchaseCostCents: parseKES(r[iBuy] ?? "") || 0,
          taxClass: r[iVat] || "B16",
          trackInventory: yes(r[iTrack] ?? ""),
          reorderLevel: Number(r[iReorder]) || 0,
          openingQty: Number(r[iOpening]) || 0,
        })).filter((r) => r.name);
        setPreview({ count: rows.length, sample: rows.slice(0, 5).map((r) => r.name), rows });
      } else if (entity === "inventory") {
        const iItem = idx("item_name", "item", "catalog_item"), iLabel = idx("label", "batch", "batch_label"),
          iQty = idx("qty", "quantity"), iCond = idx("condition"), iWh = idx("warehouse"),
          iSku = idx("sku"), iUnit = idx("unit"), iSell = idx("selling_price", "sale_price", "price"),
          iBuy = idx("buying_cost", "purchase_cost", "cost"), iVat = idx("vat_class", "tax_class");
        if (iItem < 0 || iLabel < 0) throw new Error('Missing "item_name" / "label" columns — download the template.');
        const rows: InventoryRow[] = body.map((r) => ({
          itemName: r[iItem] ?? "",
          label: r[iLabel] ?? "",
          qty: Number(r[iQty]) || 0,
          condition: r[iCond],
          warehouse: r[iWh],
          sku: r[iSku], unit: r[iUnit],
          salePriceCents: parseKES(r[iSell] ?? "") || 0,
          purchaseCostCents: parseKES(r[iBuy] ?? "") || 0,
          taxClass: r[iVat] || "B16",
        })).filter((r) => r.itemName && r.label && r.qty > 0);
        setPreview({ count: rows.length, sample: rows.slice(0, 5).map((r) => `${r.label} (${r.itemName} × ${r.qty})`), rows });
      } else {
        const iRef = idx("invoice_ref", "ref", "number"), iCust = idx("customer_name", "customer"),
          iDate = idx("date"), iDue = idx("due_date"), iDesc = idx("description", "item"),
          iQty = idx("qty", "quantity"), iPrice = idx("unit_price", "price"), iDisc = idx("discount_pct", "discount"),
          iVat = idx("vat_class", "tax_class");
        if (iCust < 0 || iDesc < 0 || iPrice < 0) throw new Error('Missing "customer_name" / "description" / "unit_price" columns — download the template.');
        const rows: InvoiceRow[] = body.map((r) => ({
          invoiceRef: r[iRef] ?? "",
          customerName: r[iCust] ?? "",
          date: r[iDate], dueDate: r[iDue],
          description: r[iDesc] ?? "",
          qty: Number(r[iQty]) || 1,
          unitPriceCents: parseKES(r[iPrice] ?? "") || 0,
          discountPct: Number(r[iDisc]) || 0,
          taxClass: r[iVat] || "B16",
        })).filter((r) => r.customerName && r.description);
        const invoiceCount = new Set(rows.map((r) => r.invoiceRef || Math.random())).size;
        setPreview({ count: rows.length, sample: [...new Set(rows.map((r) => `${r.invoiceRef || "?"} — ${r.customerName}`))].slice(0, 5), rows });
        setResult(null);
        if (rows.length) setError(null);
        void invoiceCount;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not parse file");
    }
  }

  function runImport() {
    if (!preview) return;
    start(async () => {
      try {
        let res: { created?: number; skipped?: number; error?: string };
        if (entity === "contacts") res = await importContacts(preview.rows as ContactRow[]);
        else if (entity === "items") res = await importItems(preview.rows as ItemRow[]);
        else if (entity === "inventory") res = await importInventory(preview.rows as InventoryRow[]);
        else res = await importInvoices(preview.rows as InvoiceRow[]);
        
        if (res.error) {
          setError(res.error);
          return;
        }
        
        setResult(
          `✓ Imported ${res.created} ${entity === "invoices" ? "draft invoice(s)" : entity === "inventory" ? "inventory batch(es)" : entity}` +
          (res.skipped ? ` · ${res.skipped} skipped (duplicates/empty)` : "")
        );
        setPreview(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed");
      }
    });
  }

  return (
    <div className="no-print relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-[var(--color-ink-200)] bg-white hover:bg-[var(--color-ink-50)] text-[13px] font-medium px-4 py-2 h-9 inline-flex items-center justify-center"
      >
        Import CSV
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-96 card p-4 z-50 shadow-lg">
          <div className="flex items-center gap-3 flex-wrap text-[13px]">
            <span className="font-medium">{label}</span>
            <a
              href={`/api/csv-template?entity=${entity}`}
              className="text-[var(--color-accent-600)] font-medium hover:text-[var(--color-accent-700)]"
            >
              ↓ Download template
            </a>
            <input type="file" accept=".csv,text/csv" onChange={handleFile} className="text-[12.5px] w-full" />
          </div>
          <p className="text-[11.5px] text-[var(--color-ink-400)] mt-2">
            Fill the template, keep the header row, upload. {entity === "invoices" && "Rows sharing an invoice_ref become one multi-line invoice, imported as a draft."}
          </p>

          {error && <div className="mt-3 text-[12.5px] text-[var(--color-bad)]">{error}</div>}
          {result && <div className="mt-3 text-[12.5px] text-[var(--color-good)] font-medium">{result}</div>}

          {preview && (
            <div className="mt-3 border-t border-[var(--color-ink-100)] pt-3">
              <div className="text-[12.5px] text-[var(--color-ink-600)]">
                {preview.count} rows ready · {preview.sample.join(" · ")}{preview.count > 5 ? " …" : ""}
              </div>
              <button
                onClick={runImport}
                disabled={pending}
                className="mt-2 w-full rounded-lg bg-[var(--color-accent-500)] hover:bg-[var(--color-accent-600)] disabled:opacity-50 text-white text-[13px] font-medium px-4 py-2"
              >
                {pending ? "Importing…" : `Import ${preview.count} rows`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
