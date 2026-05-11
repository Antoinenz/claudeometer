import { AuthState, UsageData, UsageWindow } from "../lib/types";
import UsageBar from "../components/UsageBar";
import WindowControls from "../components/WindowControls";

interface Props {
  auth: AuthState;
  usage: UsageData | null;
  error: string | null;
  onSettings: () => void;
  onRefresh: () => void;
}

function formatFetchedAt(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

function maxUtil(usage: UsageData): number | null {
  const windows = [usage.five_hour, usage.seven_day, usage.seven_day_sonnet]
    .filter((w): w is UsageWindow => w != null)
    .map((w) => w.utilization);
  return windows.length > 0 ? Math.max(...windows) : null;
}

function StatusDot({ pct }: { pct: number | null }) {
  const isHigh = pct != null && pct >= 75;
  const color =
    pct == null ? "bg-zinc-500"
    : pct >= 90 ? "bg-red-400"
    : pct >= 75 ? "bg-orange-400"
    : pct >= 60 ? "bg-amber-400"
    : "bg-emerald-400";

  return (
    <span className="relative flex shrink-0 w-2.5 h-2.5">
      {isHigh && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${color}`} />
      )}
      <span className={`relative inline-flex rounded-full w-2.5 h-2.5 ${color}`} />
    </span>
  );
}

export default function Dashboard({ auth, usage, error, onSettings, onRefresh }: Props) {
  const pct = usage ? maxUtil(usage) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Topbar — drag region */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60 select-none"
      >
        <div className="flex items-center gap-2 pointer-events-none">
          <span className="text-amber-500 text-sm leading-none">⊙</span>
          <span className="text-sm font-medium text-zinc-200">Claudeometer</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onRefresh}
            title="Refresh"
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={onSettings}
            title="Settings"
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <div className="w-px h-4 bg-zinc-800 mx-0.5" />
          <WindowControls />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        {/* Account row */}
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3.5 flex items-center gap-3">
          <StatusDot pct={pct} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-200 truncate">
              {auth.email ?? usage?.org_name ?? (auth.mode === "api_key" ? "API Key" : "Connected")}
            </p>
            {usage?.org_name && auth.email && (
              <p className="text-xs text-zinc-500 mt-0.5 truncate">{usage.org_name}</p>
            )}
          </div>
          {pct != null && (
            <span
              className={`text-sm font-mono font-semibold tabular-nums ${
                pct >= 90 ? "text-red-400"
                : pct >= 75 ? "text-orange-400"
                : pct >= 60 ? "text-amber-400"
                : "text-emerald-400"
              }`}
            >
              {pct.toFixed(0)}%
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl bg-red-500/5 border border-red-500/20 px-4 py-3">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}

        {/* Loading */}
        {!usage && !error && (
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-10 text-center">
            <p className="text-sm text-zinc-500">Fetching usage…</p>
          </div>
        )}

        {/* Usage windows */}
        {usage && (
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-4 space-y-5">
            <h2 className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Usage limits</h2>

            {usage.source === "api_key" ? (
              <p className="text-sm text-zinc-500 text-center py-2">
                Usage limits aren't available via API key.<br />
                <span className="text-xs text-zinc-600">Use a session key for limit tracking.</span>
              </p>
            ) : (
              <>
                {usage.five_hour && (
                  <UsageBar label="5-hour" utilization={usage.five_hour.utilization} resetsAt={usage.five_hour.resets_at} />
                )}
                {usage.seven_day && (
                  <UsageBar label="7-day" utilization={usage.seven_day.utilization} resetsAt={usage.seven_day.resets_at} />
                )}
                {usage.seven_day_sonnet && (
                  <UsageBar label="7-day (Sonnet)" utilization={usage.seven_day_sonnet.utilization} resetsAt={usage.seven_day_sonnet.resets_at} />
                )}
                {!usage.five_hour && !usage.seven_day && !usage.seven_day_sonnet && (
                  <p className="text-sm text-zinc-500 text-center py-2">
                    No usage data returned by Claude.ai.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {usage && (
        <div className="px-5 py-3 border-t border-zinc-800/60">
          <p className="text-xs text-zinc-600 text-center">Updated {formatFetchedAt(usage.fetched_at)}</p>
        </div>
      )}
    </div>
  );
}
