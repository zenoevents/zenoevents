"use server";

import { db, contacts, items, customerGroups, contactGroupMemberships, itemGroups, itemTypes } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath as nextRevalidatePath } from "next/cache";

/** revalidatePath, but safe when called outside a Next request (scripts, tests). */
function revalidatePath(path: string) {
  try {
    nextRevalidatePath(path);
  } catch {
    /* outside request context */
  }
}
import { withOrg, currentOrgId, getOrg } from "./org";
import { nowISO, todayISO } from "./money";
import { saveDocument, type DocLineInput } from "./actions";
import type { TaxClass } from "./tax";
import { addLot } from "./inventory";
import { postEntry, acct } from "./posting";
import { SYS } from "./coa";
import { logAudit } from "./audit";

/**
 * Bulk CSV imports. Row shapes match the template CSVs served by
 * /api/csv-template — parsing/validation happens client-side in CsvImporter,
 * these actions receive typed rows and write them org-scoped.
 */

const VALID_TAX = ["B16", "C0", "A_EXEMPT", "D_NONVAT"];

export interface ContactRow {
  kind: string;
  displayName: string;
  companyName?: string;
  email?: string;
  phone?: string;
  kraPin?: string;
  address?: string;
  city?: string;
  groups?: string;
}

export async function importContacts(rows: ContactRow[]): Promise<{ created?: number; skipped?: number; error?: string }> {
  try {
    return await withOrg(async () => {
    const orgId = currentOrgId();
    const o = await getOrg();
    const existing = await db.select({ name: contacts.displayName }).from(contacts).where(eq(contacts.orgId, orgId));
    const known = new Set(existing.map((e) => e.name.toLowerCase().trim()));

    // Existing customer groups for fast lookup
    const existingGroups = await db.select().from(customerGroups).where(eq(customerGroups.orgId, orgId));
    const groupMap = new Map(existingGroups.map((g) => [g.name.toLowerCase().trim(), g.id]));

    let created = 0, skipped = 0;
    for (const r of rows) {
      const name = (r.displayName || "").trim();
      if (!name || known.has(name.toLowerCase())) { skipped++; continue; }
      const kind = ["customer", "vendor", "both"].includes(r.kind) ? r.kind : "customer";

      // Process group names if provided (e.g. "Wholesale, Key Accounts")
      const groupNames = (r.groups || "")
        .split(/[,;]/)
        .map((g) => g.trim())
        .filter(Boolean);

      // Same requirement _saveContact enforces for the manual form — CSV
      // import must not be a backdoor around "every customer needs a group".
      if (o.customerGroupsEnabled && (kind === "customer" || kind === "both") && groupNames.length === 0) {
        throw new Error(`"${name}" needs at least one customer group — this org requires it`);
      }

      const groupIds: number[] = [];
      for (const gName of groupNames) {
        let gId = groupMap.get(gName.toLowerCase());
        if (!gId) {
          const [inserted] = await db
            .insert(customerGroups)
            .values({ orgId, name: gName, createdAt: nowISO() })
            .returning();
          gId = inserted.id;
          groupMap.set(gName.toLowerCase(), gId);
          await logAudit({ action: "create", module: "contacts", recordId: gId, recordLabel: gName, detail: "Auto-created via CSV import" });
        }
        groupIds.push(gId);
      }

      const [c] = await db.insert(contacts).values({
        orgId,
        kind,
        displayName: name,
        companyName: r.companyName || null,
        email: r.email || null,
        phone: r.phone || null,
        kraPin: r.kraPin || null,
        address: r.address || null,
        city: r.city || null,
        groupId: groupIds[0] ?? null,
        createdAt: nowISO(),
      }).returning();

      if (groupIds.length > 0) {
        await db.insert(contactGroupMemberships).values(
          groupIds.map((gId) => ({ orgId, contactId: c.id, groupId: gId }))
        );
      }

      known.add(name.toLowerCase());
      created++;
    }
    revalidatePath("/contacts");
    return { created, skipped };
  });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to import contacts" };
  }
}

export interface ItemRow {
  kind: string;
  name: string;
  group?: string;
  sku?: string;
  unit?: string;
  salePriceCents: number;
  purchaseCostCents: number;
  taxClass: string;
  trackInventory: boolean;
  reorderLevel: number;
  openingQty?: number;
}

export async function importItems(rows: ItemRow[]): Promise<{ created?: number; skipped?: number; error?: string }> {
  try {
    return await withOrg(async () => {
    const orgId = currentOrgId();
    const o = await getOrg();
    const existing = await db.select({ name: items.name }).from(items).where(eq(items.orgId, orgId));
    const known = new Set(existing.map((e) => e.name.toLowerCase().trim()));
    const existingGroups = await db.select().from(itemGroups).where(eq(itemGroups.orgId, orgId));
    const groupMap = new Map(existingGroups.map((g) => [g.name.toLowerCase().trim(), g.id]));
    const orgTypes = await db.select().from(itemTypes).where(eq(itemTypes.orgId, orgId));
    const typeByName = new Map(orgTypes.map((t) => [t.name.toLowerCase(), t]));
    let created = 0, skipped = 0;
    for (const r of rows) {
      const name = (r.name || "").trim();
      if (!name || known.has(name.toLowerCase())) { skipped++; continue; }
      const purchaseCostCents = Math.max(0, Math.round(r.purchaseCostCents));
      const groupName = (r.group || "").trim();
      // Match the CSV's type name against this org's real item types
      // (goods/service plus any custom ones) rather than collapsing
      // everything non-"goods" to "service" — that silently mislabeled
      // custom-type rows before item types existed as a first-class concept.
      const matchedType = typeByName.get((r.kind || "").toLowerCase().trim());
      const kind = matchedType?.name ?? "service";
      const groupMandatory = matchedType ? matchedType.isGroupMandatory : true;
      let itemGroupId: number | null = null;
      if (groupName) {
        const reused = existingGroups.find((g) => g.name.toLowerCase().trim() === groupName.toLowerCase());
        itemGroupId = groupMap.get(groupName.toLowerCase()) ?? null;
        if (!itemGroupId) {
          const [inserted] = await db
            .insert(itemGroups)
            .values({ orgId, name: groupName, createdAt: nowISO() })
            .returning();
          itemGroupId = inserted.id;
          groupMap.set(groupName.toLowerCase(), itemGroupId);
          await logAudit({ action: "create", module: "items", recordId: itemGroupId, recordLabel: groupName, detail: "Auto-created via CSV import" });
        } else if (reused && reused.appliesTo !== "both" && reused.appliesTo !== kind) {
          // Same restriction validateItemGroup enforces for the manual item
          // form — this insert path writes to `items` directly, so it has to
          // check appliesTo itself rather than inheriting the guard for free.
          throw new Error(`Group "${groupName}" is ${reused.appliesTo}-only and can't be used for "${name}" (a ${kind})`);
        }
      } else if (o.itemGroupsEnabled && groupMandatory) {
        throw new Error(`Item group is required for "${name}"`);
      }
      const [row] = await db.insert(items).values({
        orgId,
        kind,
        itemGroupId,
        name,
        sku: r.sku || null,
        unit: r.unit || "unit",
        salePriceCents: Math.max(0, Math.round(r.salePriceCents)),
        purchaseCostCents,
        taxClass: VALID_TAX.includes(r.taxClass) ? r.taxClass : "B16",
        trackInventory: !!r.trackInventory,
        reorderLevel: Math.max(0, Number(r.reorderLevel) || 0),
      }).returning();

      // Opening stock — without this, bulk-imported tracked items silently start
      // at zero stock/value with no ledger entry, same as manual item creation
      // already does for a single item.
      const openingQty = Math.max(0, Number(r.openingQty) || 0);
      if (r.trackInventory && openingQty > 0) {
        await addLot({ itemId: row.id, date: todayISO(), qty: openingQty, unitCostCents: purchaseCostCents, sourceType: "opening" });
        const value = Math.round(openingQty * purchaseCostCents);
        if (value > 0) {
          await postEntry({
            date: todayISO(),
            memo: `Opening stock — ${name}`,
            sourceType: "opening_stock",
            sourceId: row.id,
            lines: [
              { accountId: await acct(SYS.INVENTORY), debitCents: value },
              { accountId: await acct(SYS.OPENING_BALANCE), creditCents: value },
            ],
          });
        }
      }

      known.add(name.toLowerCase());
      created++;
    }
    revalidatePath("/items");
    return { created, skipped };
  });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to import items" };
  }
}

export interface InvoiceRow {
  invoiceRef: string; // groups lines into one invoice
  customerName: string;
  date?: string;
  dueDate?: string;
  description: string;
  qty: number;
  unitPriceCents: number;
  discountPct: number;
  taxClass: string;
}

/**
 * Imports invoices as DRAFTS (grouped by invoiceRef). Customers matched by
 * name, created if missing. Review + issue each draft to post it (and get
 * its eTIMS signature) — imports never silently hit the ledger.
 */
export async function importInvoices(rows: InvoiceRow[]): Promise<{ created?: number; skipped?: number; error?: string }> {
  try {
    return await withOrg(async () => {
    const orgId = currentOrgId();
    const groups = new Map<string, InvoiceRow[]>();
    for (const r of rows) {
      const key = (r.invoiceRef || "").trim() || `row-${groups.size}`;
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }

    const contactRows = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.orgId, orgId), inArray(contacts.kind, ["customer", "both"])));
    const byName = new Map(contactRows.map((c) => [c.displayName.toLowerCase().trim(), c.id]));

    let created = 0, skipped = 0;
    for (const [, lines] of groups) {
      const head = lines[0];
      const custName = (head.customerName || "").trim();
      if (!custName || lines.every((l) => !l.description)) { skipped++; continue; }

      let contactId = byName.get(custName.toLowerCase());
      if (!contactId) {
        const [c] = await db
          .insert(contacts)
          .values({ orgId, kind: "customer", displayName: custName, createdAt: nowISO() })
          .returning();
        contactId = c.id;
        byName.set(custName.toLowerCase(), c.id);
      }

      const docLines: DocLineInput[] = lines
        .filter((l) => l.description)
        .map((l) => ({
          description: l.description,
          qty: Number(l.qty) || 1,
          unitPriceCents: Math.max(0, Math.round(l.unitPriceCents)),
          discountPct: Number(l.discountPct) || 0,
          taxClass: (VALID_TAX.includes(l.taxClass) ? l.taxClass : "B16") as TaxClass,
        }));
      if (docLines.length === 0) { skipped++; continue; }

      await saveDocument({
        type: "invoice",
        contactId,
        date: head.date || todayISO(),
        dueDate: head.dueDate || null,
        taxInclusive: false,
        notes: undefined,
        lines: docLines,
      });
      created++;
    }
    revalidatePath("/sales/invoices");
    return { created, skipped };
  });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to import invoices" };
  }
}
