interface UsageBarProps {
  label: string;
  utilization: number;
  resetsAt: string | null;
}

function formatResetsAt(ts: string | null): string | null {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    const diffMs = d.getTime() - Date.now();
    if (diffMs <= 0) return "soon";
    const h = Math.floor(diffMs / 3_600_000);
    const m = Math.floor((diffMs % 3_600_000) / 60_000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  } catch {
    return null;
  }
}

const GRADIENTS = {
  red:    "linear-gradient(90deg, #dc2626 0%, #f87171 100%)",
  orange: "linear-gradient(90deg, #ea580c 0%, #fb923c 100%)",
  amber:  "linear-gradient(90deg, #d97706 0%, #fbbf24 100%)",
  green:  "linear-gradient(90deg, #059669 0%, #34d399 100%)",
} as const;

const TEXT_COLORS = {
  red:    "text-red-400",
  orange: "text-orange-400",
  amber:  "text-amber-400",
  green:  "text-emerald-400",
} as const;

function tier(pct: number): keyof typeof GRADIENTS {
  if (pct >= 90) return "red";
  if (pct >= 75) return "orange";
  if (pct >= 60) return "amber";
  return "green";
}

export default function UsageBar({ label, utilization, resetsAt }: UsageBarProps) {
  const pct = Math.min(Math.max(utilization, 0), 100);
  const t = tier(pct);
  const resets = formatResetsAt(resetsAt);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-zinc-300">{label}</span>
        <div className="flex items-center gap-2.5">
          {resets && (
            <span className="text-xs text-zinc-500">resets {resets}</span>
          )}
          <span className={`tabular-nums font-mono text-xs font-semibold ${TEXT_COLORS[t]}`}>
            {pct.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct}%`, background: GRADIENTS[t] }}
        />
      </div>
    </div>
  );
}
