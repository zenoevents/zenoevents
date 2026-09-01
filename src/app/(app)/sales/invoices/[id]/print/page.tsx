import { getOrg } from "@/lib/org";
import { requirePerm } from "@/lib/guard";
import { db, contacts } from "@/db";
import { eq, and } from "drizzle-orm";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { fmtKES } from "@/lib/money";
import { TAX_CLASSES, type TaxClass } from "@/lib/tax";
import { ETIMS_ENABLED } from "@/lib/features";
import { LineDescription } from "@/components/LineDescription";
import { getInvoiceWithBillableExpenses } from "@/lib/actions";

export const dynamic = "force-dynamic";

export default async function PrintInvoice({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("invoices");
  const o = await getOrg();
  const { id } = await params;
  // Same combined (real lines + virtual billable-expense lines) fetch the
  // downloadable PDF route uses — this print view used to query documents/
  // documentLines directly and silently ignore any billable expense tagged
  // to the invoice, showing the pre-expense total instead of the real one.
  const result = await getInvoiceWithBillableExpenses(Number(id), o.id);
  if (!result || result.doc.type !== "invoice") notFound();
  const { doc, lines } = result;
  const customer = doc.contactId
    ? (await db.select().from(contacts).where(and(eq(contacts.orgId, o.id), eq(contacts.id, doc.contactId))).limit(1))[0]
    : null;

  const qrDataUrl = doc.qrUrl ? await QRCode.toDataURL(doc.qrUrl, { margin: 1, width: 120 }) : null;

  // VAT summary per class (eTIMS-style)
  const byClass = new Map<string, { net: number; tax: number }>();
  for (const l of lines) {
    const b = byClass.get(l.taxClass) ?? { net: 0, tax: 0 };
    b.net += l.netCents;
    b.tax += l.taxCents;
    byClass.set(l.taxClass, b);
  }

  return (
    <div className="fixed inset-0 bg-white overflow-auto z-50">
      <div className="max-w-[720px] mx-auto px-10 py-10 text-[13px] text-black">
        <div className="no-print mb-6 flex gap-3">
          <a href={`/sales/invoices/${doc.id}`} className="text-[13px] underline">← Back</a>
          <span className="text-[13px] text-gray-500">Use your browser&apos;s Print (⌘P) to save as PDF</span>
        </div>

        <div className="flex justify-between items-start mb-8">
          <div>
            {o?.logoUrl && <img src={o.logoUrl} alt={o.name} className="max-w-[220px] max-h-[90px] mb-6 object-contain" />}
            <div className="text-[20px] font-bold">{o?.name}</div>
            <div className="text-gray-600 whitespace-pre-line">{o?.address}</div>
            {o?.phone && <div className="text-gray-600">{o.phone}</div>}
            <div className="mt-1">KRA PIN: <b>{o?.kraPin}</b></div>
          </div>
          <div className="text-right">
            <div className="text-[24px] font-bold tracking-tight">TAX INVOICE</div>
            <div className="mt-1">No: <b>{doc.number}</b></div>
            <div>Date: {doc.date}</div>
            {doc.dueDate && <div>Due: {doc.dueDate}</div>}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-8">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Bill to</div>
            <div className="font-semibold mt-1">{customer?.displayName ?? "Walk-in customer"}</div>
            {customer?.address && <div className="text-gray-600">{customer.address}</div>}
            {customer?.kraPin && <div>Buyer PIN: <b>{customer.kraPin}</b></div>}
          </div>
        </div>

        <table className="w-full mt-8 border-collapse">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-2">Description</th>
              <th className="py-2 px-2 text-right">Qty</th>
              <th className="py-2 px-2 text-right">Unit price</th>
              <th className="py-2 px-2 text-center">VAT</th>
              <th className="py-2 pl-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              let seq = 0;
              return lines.map((l, i) => {
                if (l.isHeading) {
                  return (
                    <tr key={l.id} className="border-b border-gray-200 bg-gray-50">
                      <td colSpan={6} className="py-2 px-2 font-semibold">{l.description}</td>
                    </tr>
                  );
                }
                seq++;
                return (
                  <tr key={l.id} className="border-b border-gray-200">
                    <td className="py-2 pr-2 text-gray-500">{seq}</td>
                    <td className="py-2 pr-2"><LineDescription itemName={l.itemName} description={l.description} /></td>
                    <td className="py-2 px-2 text-right">{l.qty}</td>
                    <td className="py-2 px-2 text-right">{fmtKES(l.unitPriceCents)}</td>
                    <td className="py-2 px-2 text-center">
                      {TAX_CLASSES[l.taxClass as TaxClass]?.etimsCode ?? ""} ({(l.taxRateBp / 100).toFixed(0)}%)
                    </td>
                    <td className="py-2 pl-2 text-right">{fmtKES(l.grossCents)}</td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>

        <div className="flex justify-between mt-6">
          <table className="text-[12px]">
            <thead>
              <tr className="text-gray-500">
                <th className="text-left pr-4 pb-1">VAT class</th>
                <th className="text-right pr-4 pb-1">Taxable</th>
                <th className="text-right pb-1">VAT</th>
              </tr>
            </thead>
            <tbody>
              {[...byClass.entries()].map(([cls, v]) => (
                <tr key={cls}>
                  <td className="pr-4">{TAX_CLASSES[cls as TaxClass]?.label ?? cls}</td>
                  <td className="text-right pr-4">{fmtKES(v.net)}</td>
                  <td className="text-right">{fmtKES(v.tax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="w-60">
            <div className="flex justify-between py-0.5"><span>Subtotal</span><span>{fmtKES(doc.subtotalCents)}</span></div>
            <div className="flex justify-between py-0.5"><span>VAT</span><span>{fmtKES(doc.taxCents)}</span></div>
            <div className="flex justify-between py-1 border-t-2 border-black font-bold text-[15px]">
              <span>Total</span><span>{fmtKES(doc.totalCents)}</span>
            </div>
          </div>
        </div>

        <div className="mt-10 flex justify-between items-end border-t border-gray-300 pt-4">
          <div className="text-[11px] text-gray-600 space-y-0.5">
            {ETIMS_ENABLED && doc.cuSerial && (
              <>
                <div>CU Serial: {doc.cuSerial}</div>
                <div>CU Invoice No: <b>{doc.cuInvoiceNumber ?? "—"}</b></div>
                <div className="text-amber-700 font-medium">
                  DEMO: simulated control unit — not a fiscal document
                </div>
              </>
            )}
            {doc.notes && <div className="pt-2 whitespace-pre-wrap text-gray-700">{doc.notes}</div>}
          </div>
          {ETIMS_ENABLED && qrDataUrl && (
            <div className="text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="KRA verification QR" width={110} height={110} />
              <div className="text-[10px] text-gray-500 mt-1">Scan to verify with KRA</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
