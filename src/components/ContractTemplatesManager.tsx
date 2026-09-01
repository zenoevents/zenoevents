"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createContractTypeAction,
  deleteContractTypeAction,
  createContractTemplateAction,
  updateContractTemplateAction,
  deleteContractTemplateAction,
} from "@/lib/contract-templates";
import { CONTRACT_MERGE_FIELDS } from "@/lib/contract-merge-fields";

const inputCls =
  "w-full rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-100)] mt-1";
const labelCls = "text-[12px] font-medium text-[var(--color-ink-600)]";

export interface ContractType {
  id: number;
  name: string;
}

export interface ContractTemplate {
  id: number;
  contractTypeId: number;
  name: string;
  content: string | null;
  paymentTerms: string | null;
}

/** Click-to-insert chips so staff never have to hand-type {{merge_field}}
 *  syntax — inserts the tag at the textarea's cursor position and refocuses. */
function MergeFieldChips({ targetRef, onInsert }: {
  targetRef: React.RefObject<HTMLTextAreaElement | null>;
  onInsert: (updater: (prev: string) => string) => void;
}) {
  function insert(key: string) {
    const el = targetRef.current;
    const token = `{{${key}}}`;
    if (!el) { onInsert((prev) => prev + token); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    onInsert((prev) => prev.slice(0, start) + token + prev.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="flex flex-wrap gap-1.5 mb-1.5">
      {CONTRACT_MERGE_FIELDS.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={() => insert(f.key)}
          className="rounded-full bg-white border border-[var(--color-ink-200)] px-2.5 py-1 text-[11px] text-[var(--color-ink-600)] hover:border-[var(--color-accent-500)] hover:text-[var(--color-accent-600)] transition-colors"
        >
          + {f.label}
        </button>
      ))}
    </div>
  );
}

function CreateContractTypeForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await createContractTypeAction(name);
          if ("error" in res) { setError(res.error); return; }
          setName("");
          router.refresh();
        });
      }}
      className="flex items-center gap-2"
    >
      {error && <span className="text-[12px] text-[var(--color-bad)] mr-2">{error}</span>}
      <input
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-lg border border-[var(--color-ink-200)] bg-white px-3 py-1.5 text-[12.5px] outline-none focus:border-[var(--color-accent-500)] focus:ring-2 focus:ring-[var(--color-accent-100)] w-48"
        placeholder="e.g. Wedding, Corporate"
      />
      <button disabled={pending} className="rounded-lg bg-[var(--color-ink-900)] hover:bg-black disabled:opacity-50 text-white text-[12.5px] font-medium px-3 py-1.5">
        {pending ? "Adding…" : "Add Type"}
      </button>
    </form>
  );
}

export function ContractTypesPanel({ types }: { types: ContractType[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="card px-6 py-5 max-w-2xl">
      <div className="font-semibold text-[var(--color-ink-900)] mb-1">Contract Types</div>
      <p className="text-[12.5px] text-[var(--color-ink-600)] mb-3">
        Your own list — e.g. Wedding, Corporate, Photography. Templates below are tagged to one of these.
      </p>
      {error && <div className="text-[12px] text-[var(--color-bad)] mb-2">{error}</div>}
      <div className="flex flex-wrap gap-2 mb-4">
        {types.length === 0 && <span className="text-[12.5px] text-[var(--color-ink-400)]">No contract types yet.</span>}
        {types.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-ink-50)] border border-[var(--color-ink-200)] pl-3 pr-1.5 py-1 text-[12.5px] text-[var(--color-ink-700)]">
            {t.name}
            <button
              disabled={pending}
              onClick={() => {
                setError(null);
                start(async () => {
                  const res = await deleteContractTypeAction(t.id);
                  if ("error" in res) { setError(res.error); return; }
                  router.refresh();
                });
              }}
              className="w-4 h-4 rounded-full flex items-center justify-center text-[var(--color-ink-400)] hover:bg-[var(--color-ink-200)] hover:text-[var(--color-ink-700)] disabled:opacity-50"
              title="Delete type"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <CreateContractTypeForm />
    </div>
  );
}

function TemplateForm({
  types,
  existing,
  onDone,
}: {
  types: ContractType[];
  existing?: ContractTemplate;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(existing?.name || "");
  const [contractTypeId, setContractTypeId] = useState(existing?.contractTypeId ? String(existing.contractTypeId) : "");
  const [content, setContent] = useState(existing?.content || "");
  const [paymentTerms, setPaymentTerms] = useState(existing?.paymentTerms || "");
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const paymentTermsRef = useRef<HTMLTextAreaElement>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData();
        fd.set("name", name);
        fd.set("contractTypeId", contractTypeId);
        fd.set("content", content);
        fd.set("paymentTerms", paymentTerms);
        start(async () => {
          const res = existing
            ? await updateContractTemplateAction(existing.id, fd)
            : await createContractTemplateAction(fd);
          if ("error" in res) { setError(res.error); return; }
          onDone();
        });
      }}
      className="space-y-3 rounded-xl border border-[var(--color-ink-200)] p-4 bg-[var(--color-ink-50)]/50"
    >
      {error && <div className="text-[12px] text-[var(--color-bad)]">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={labelCls}>Template Name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Wedding — Standard" />
        </label>
        <label className="block">
          <span className={labelCls}>Contract Type</span>
          <select required value={contractTypeId} onChange={(e) => setContractTypeId(e.target.value)} className={inputCls}>
            <option value="">Pick a type…</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={labelCls}>Content</span>
        <div className="text-[12px] text-[var(--color-ink-400)] mb-1">Paste your contract wording, then click a field below to drop it in — no typing needed.</div>
        <MergeFieldChips targetRef={contentRef} onInsert={setContent} />
        <textarea ref={contentRef} value={content} onChange={(e) => setContent(e.target.value)} className={inputCls + " h-40 resize-none"}
          placeholder={"This agreement is between [Company Name] and [Client Name] for [Event Name] on [Event Date] at [Venue]..."} />
      </label>
      <label className="block">
        <span className={labelCls}>Payment Terms</span>
        <div className="text-[12px] text-[var(--color-ink-400)] mb-1">A separate field from Content — same fields work here too.</div>
        <MergeFieldChips targetRef={paymentTermsRef} onInsert={setPaymentTerms} />
        <textarea ref={paymentTermsRef} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className={inputCls + " h-24 resize-none"}
          placeholder={"50% deposit due on signing, balance due 7 days before [Event Date]..."} />
      </label>
      <div className="flex items-center gap-2">
        <button disabled={pending} className="rounded-lg bg-[var(--color-ink-900)] hover:bg-black disabled:opacity-50 text-white text-[12.5px] font-medium px-4 py-2">
          {pending ? "Saving…" : existing ? "Save Changes" : "Create Template"}
        </button>
        <button type="button" onClick={onDone} className="rounded-lg border border-[var(--color-ink-200)] text-[12.5px] font-medium px-4 py-2 hover:bg-[var(--color-ink-50)]">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ContractTemplatesPanel({ types, templates }: { types: ContractType[]; templates: ContractTemplate[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const typeName = (id: number) => types.find((t) => t.id === id)?.name || "—";

  return (
    <div className="card px-6 py-5 max-w-2xl mt-5">
      <div className="flex items-center justify-between mb-1">
        <div className="font-semibold text-[var(--color-ink-900)]">Contract Templates</div>
        {!creating && (
          <button
            onClick={() => { setCreating(true); setEditingId(null); }}
            disabled={types.length === 0}
            className="rounded-lg bg-[var(--color-ink-900)] hover:bg-black disabled:opacity-50 text-white text-[12.5px] font-medium px-3 py-1.5"
          >
            + New Template
          </button>
        )}
      </div>
      {types.length === 0 && <p className="text-[12.5px] text-[var(--color-ink-500)] mb-2">Add a Contract Type above first.</p>}
      {error && <div className="text-[12px] text-[var(--color-bad)] mb-2">{error}</div>}

      {creating && (
        <div className="mb-4">
          <TemplateForm types={types} onDone={() => { setCreating(false); router.refresh(); }} />
        </div>
      )}

      <div className="space-y-2 mt-3">
        {templates.length === 0 && !creating && (
          <span className="text-[12.5px] text-[var(--color-ink-400)]">No templates yet.</span>
        )}
        {templates.map((t) => (
          <div key={t.id}>
            {editingId === t.id ? (
              <TemplateForm types={types} existing={t} onDone={() => { setEditingId(null); router.refresh(); }} />
            ) : (
              <div className="flex items-center justify-between rounded-lg border border-[var(--color-ink-100)] px-4 py-2.5">
                <div>
                  <span className="font-medium text-[13px] text-[var(--color-ink-900)]">{t.name}</span>
                  <span className="ml-2 inline-block rounded-full bg-[var(--color-ink-50)] border border-[var(--color-ink-200)] px-2 py-0.5 text-[11px] text-[var(--color-ink-600)]">
                    {typeName(t.contractTypeId)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => { setEditingId(t.id); setCreating(false); }} className="text-[12px] text-[var(--color-accent-600)] hover:underline">Edit</button>
                  <button
                    disabled={pending}
                    onClick={() => {
                      setError(null);
                      start(async () => {
                        const res = await deleteContractTemplateAction(t.id);
                        if ("error" in res) { setError(res.error); return; }
                        router.refresh();
                      });
                    }}
                    className="text-[12px] text-[var(--color-bad)] hover:underline disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
