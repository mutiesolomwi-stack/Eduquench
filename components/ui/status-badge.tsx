const MAP: Record<string, { label: string; cls: string; icon: string }> = {
  verified_present: { label: "Verified", cls: "ok", icon: "M5 13l4 4L19 7" },
  late: { label: "Late", cls: "warn", icon: "M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z" },
  left_early: { label: "Left early", cls: "warn", icon: "M15 6l-6 6 6 6" },
  partial: { label: "Partial", cls: "warn", icon: "M5 12h14" },
  pending_review: { label: "Pending", cls: "neutral", icon: "M12 8v4m0 4h.01M12 3a9 9 0 100 18 9 9 0 000-18z" },
  excused: { label: "Excused", cls: "neutral", icon: "M5 13l4 4L19 7" },
  absent: { label: "Absent", cls: "bad", icon: "M6 6l12 12M18 6L6 18" },
  overridden: { label: "Overridden", cls: "neutral", icon: "M4 20h4L19 9l-4-4L4 16z" },
};

/** Colour is never alone: every status carries an icon and a word. */
export function StatusBadge({ status }: { status: string }) {
  const m = MAP[status] ?? MAP.pending_review;
  return (
    <span className={`badge ${m.cls}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={m.icon} /></svg>
      {m.label}
    </span>
  );
}
