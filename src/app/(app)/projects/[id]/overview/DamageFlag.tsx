import Link from "next/link";
import Image from "next/image";
import type { LiabilityStatus } from "@/lib/liability-status";

const liabilityLabels: Record<LiabilityStatus, string> = {
  pending: "Pending review",
  staff_fault: "Staff fault",
  client_fault: "Client fault",
  wear_and_tear: "Wear & tear",
  unresolved: "Unresolved",
};

export function DamageFlag({
  projectId,
  count,
  itemName,
  damageType,
  liabilityStatus,
  photoSignedUrl,
}: {
  projectId: number;
  count: number;
  itemName: string | null;
  damageType: string;
  liabilityStatus: string;
  photoSignedUrl: string | null;
}) {
  if (count === 0) return null;

  return (
    <Link href={`/projects/${projectId}?tab=damage`} className="card p-5 block border-red-100 hover:border-red-200 transition-colors">
      <div className="flex items-start gap-3">
        {photoSignedUrl && (
          <div className="relative w-14 h-14 rounded-lg overflow-hidden shrink-0 bg-[var(--color-ink-50)]">
            <Image src={photoSignedUrl} alt="Damage evidence" fill className="object-cover" unoptimized />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--color-bad)]">
            <span>⚠️</span>
            {count === 1 ? "1 damage report" : `${count} damage reports`}
          </div>
          <div className="text-[12px] text-[var(--color-ink-600)] mt-1 truncate">{itemName ?? "Item"} — {damageType}</div>
          <span className="inline-block mt-1.5 rounded-full bg-red-50 text-[var(--color-bad)] text-[10.5px] font-medium px-2 py-0.5">
            {liabilityLabels[liabilityStatus as LiabilityStatus] ?? liabilityStatus}
          </span>
        </div>
      </div>
    </Link>
  );
}
