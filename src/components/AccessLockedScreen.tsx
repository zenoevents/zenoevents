export function AccessLockedScreen({ orgName }: { orgName?: string | null }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-ink-50)] px-4">
      <div className="max-w-sm w-full text-center">
        <div className="text-[40px] mb-3">🔒</div>
        <h1 className="text-[18px] font-semibold">Access paused{orgName ? ` for ${orgName}` : ""}</h1>
        <p className="text-[13.5px] text-[var(--color-ink-500)] mt-2">
          Your trial or subscription has ended. Reach out to reactivate your account — your data is safe and waiting for you.
        </p>
        <div className="mt-5 rounded-lg border border-[var(--color-ink-200)] bg-white px-4 py-3 text-[13px]">
          <a href="mailto:support@zeno.com" className="text-[var(--color-accent-600)] font-medium hover:underline">support@zeno.com</a>
        </div>
      </div>
    </div>
  );
}
