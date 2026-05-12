import { useEffect, useState } from "react";

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
    const days = Math.floor(h / 24);
    if (days > 0) return `${days}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  } catch {
    return null;
  }
}

const TIERS = {
  red: {
    bar:   "linear-gradient(90deg, #dc2626 0%, #f87171 100%)",
    text:  "text-red-400",
    dot:   "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]",
  },
  orange: {
    bar:   "linear-gradient(90deg, #ea580c 0%, #fb923c 100%)",
    text:  "text-orange-400",
    dot:   "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]",
  },
  amber: {
    bar:   "linear-gradient(90deg, #d97706 0%, #fbbf24 100%)",
    text:  "text-amber-400",
    dot:   "bg-amber-500",
  },
  green: {
    bar:   "linear-gradient(90deg, #059669 0%, #34d399 100%)",
    text:  "text-emerald-400",
    dot:   "bg-emerald-500",
  },
} as const;

type Tier = keyof typeof TIERS;

function tier(pct: number): Tier {
  if (pct >= 90) return "red";
  if (pct >= 75) return "orange";
  if (pct >= 60) return "amber";
  return "green";
}

export default function UsageBar({ label, utilization, resetsAt }: UsageBarProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const pct = Math.min(Math.max(utilization, 0), 100);
  const t = tier(pct);
  const colors = TIERS[t];
  const resets = formatResetsAt(resetsAt);

  return (
    <div className="rounded-xl bg-zinc-900/70 border border-zinc-800/80 px-4 py-3.5 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 pt-[3px]">
          <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
          <span className="text-[13px] font-medium text-zinc-300 truncate">{label}</span>
          {resets && (
            <span className="text-[11px] text-zinc-600 font-mono tabular-nums truncate">
              · {resets}
            </span>
          )}
        </div>
        <span
          className={`text-[28px] font-medium tabular-nums leading-none ${colors.text}`}
          style={{ fontFamily: "'JetBrains Mono', monospace", letterSpacing: "-0.04em" }}
        >
          {Math.round(pct)}<span className="text-base text-zinc-600 ml-0.5">%</span>
        </span>
      </div>
      <div className="relative h-[7px] w-full rounded-full bg-zinc-800/80 overflow-hidden shadow-[inset_0_1px_1px_rgba(0,0,0,0.4)]">
        <div
          className="bar-fill relative h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, background: colors.bar }}
        >
          <span className="bar-shine" />
        </div>
      </div>
    </div>
  );
}
