import { TableCard, Th, Td, EmptyState } from "@/components/ui";

type AuditRow = {
  id: number;
  createdAt: string;
  actorName: string;
  actorRole: string;
  action: string;
  recordLabel: string | null;
  recordId: number | null;
  detail: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  "project.create": "Project created",
  "project.status": "Status changed",
  "reservation.create": "Item reserved",
  "contract.create": "Contract drafted",
  "contract.status": "Contract status changed",
  "contract.sign": "Contract signed",
  "contract.delete": "Contract deleted",
  "manifest.create": "Manifest created",
  "manifest_line.advance": "Manifest line advanced",
  "manifest.reconcile": "Manifest reconciled",
  "payment_schedule.create": "Milestone added",
  "payment_schedule.invoice": "Milestone invoiced",
  "damage_report.create": "Damage reported",
  "damage_report.resolve": "Damage report resolved",
  "project_file.upload": "File uploaded",
  "project_file.delete": "File deleted",
  "project_task.create": "Task created",
};

export function AuditLogPanel({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="Nothing logged yet" body="Reservations, contracts, manifest activity, and payment milestones for this project show up here as they happen." />;
  }

  return (
    <TableCard>
      <thead>
        <tr className="hairline-b">
          <Th>When</Th>
          <Th>Who</Th>
          <Th>Action</Th>
          <Th>Record</Th>
          <Th>Detail</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="hairline-t">
            <Td className="whitespace-nowrap text-[var(--color-ink-400)]">{r.createdAt.replace("T", " ").slice(0, 19)}</Td>
            <Td>
              <div className="font-medium">{r.actorName}</div>
              <div className="text-[11px] text-[var(--color-ink-400)] capitalize">{r.actorRole}</div>
            </Td>
            <Td>{ACTION_LABELS[r.action] ?? r.action}</Td>
            <Td>{r.recordLabel ?? (r.recordId ? `#${r.recordId}` : "—")}</Td>
            <Td className="text-[var(--color-ink-500)] max-w-xs truncate">{r.detail ?? ""}</Td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}
