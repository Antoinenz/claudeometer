import { useEffect, useState } from "react";
import { UsageData } from "../lib/types";
import UsageBar from "../components/UsageBar";
import WindowControls from "../components/WindowControls";

interface Props {
  usage: UsageData | null;
  error: string | null;
  isRefreshing: boolean;
  cooldownEndsAt: number | null;
  preciseTimestamp: boolean;
  onSettings: () => void;
  onRefresh: () => void;
}

function classifyError(err: string): string {
  const lower = err.toLowerCase();
  if (lower.includes("network") || lower.includes("dns") || lower.includes("offline") || lower.includes("internet")) {
    return "Not connected to internet";
  }
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("session") || lower.includes("expired") || lower.includes("forbidden")) {
    return "Expired session";
  }
  if (lower.includes("claude") || lower.includes("502") || lower.includes("503") || lower.includes("500") || lower.includes("timeout")) {
    return "Unable to contact Claude.ai";
  }
  return "Unknown error";
}

function formatTimestamp(ts: string, precise: boolean): string {
  try {
    const d = new Date(ts);
    if (precise) {
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      return `Updated at ${time}`;
    }

    const diffMs = Date.now() - d.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffMs / 60_000);

    if (diffSecs < 15) return "Updated just now";
    if (diffSecs < 60) return "Updated less than a minute ago";
    if (diffMins < 2) return "Updated 1 minute ago";
    if (diffMins < 60) return `Updated ${diffMins} minutes ago`;

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    if (d.toDateString() === now.toDateString()) return `Updated at ${timeStr}`;
    if (d.toDateString() === yesterday.toDateString()) return `Last updated yesterday at ${timeStr}`;
    return `Last updated ${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${timeStr}`;
  } catch {
    return "Updated";
  }
}

export default function Dashboard({ usage, error, isRefreshing, cooldownEndsAt, preciseTimestamp, onSettings, onRefresh }: Props) {
  // Ticker so relative timestamps update automatically
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 20_000);
    return () => clearInterval(id);
  }, []);

  // 1-second ticker for the cooldown countdown badge
  const [, setCooldownTick] = useState(0);
  useEffect(() => {
    if (!cooldownEndsAt) return;
    const id = setInterval(() => setCooldownTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [cooldownEndsAt]);

  // Cooldown only blocks the button when there's no error (errors bypass rate limiting)
  const secsLeft = cooldownEndsAt && !error
    ? Math.max(0, Math.ceil((cooldownEndsAt - Date.now()) / 1000))
    : 0;
  const inCooldown = secsLeft > 0;
  const isRefreshDisabled = isRefreshing || inCooldown;

  return (
    <div className="flex flex-col h-full">
      {/* Topbar — drag region */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60 select-none shrink-0"
      >
        <div className="flex items-center gap-2 pointer-events-none">
          <span className="text-amber-500 text-sm leading-none">⊙</span>
          <span className="text-sm font-medium text-zinc-200">Claudeometer</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onRefresh}
            title="Refresh"
            disabled={isRefreshDisabled}
            className={`relative p-1.5 rounded-md text-zinc-500 transition-colors disabled:opacity-40 ${
              inCooldown ? "cursor-default" : "hover:text-zinc-300 hover:bg-zinc-800"
            }`}
          >
            <div className="relative">
              <svg
                className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                style={isRefreshing ? { animationDirection: "reverse" } : undefined}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {inCooldown && (
                <span className="absolute -bottom-1 -right-1.5 text-[7px] font-mono leading-none text-zinc-500 bg-[#111111] px-[1px]">
                  {secsLeft}
                </span>
              )}
            </div>
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

      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="flex h-full items-center justify-center px-6">
            <p className="text-sm text-red-400 text-center">{classifyError(error)}</p>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-3">
            {/* Loading */}
            {!usage && (
              <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-10 text-center">
                <p className="text-sm text-zinc-500">Fetching usage…</p>
              </div>
            )}

            {/* Usage windows */}
            {usage && (
              <>
                {usage.source === "api_key" ? (
                  <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-6 text-center space-y-1">
                    <p className="text-sm text-zinc-400">Usage limits unavailable via API key.</p>
                    <p className="text-xs text-zinc-600">Use a session key for limit tracking.</p>
                  </div>
                ) : (
                  <>
                    {!usage.five_hour && !usage.seven_day && !usage.seven_day_sonnet && (
                      <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-6 text-center">
                        <p className="text-sm text-zinc-500">No usage data returned by Claude.ai.</p>
                      </div>
                    )}
                    {usage.five_hour && (
                      <UsageBar
                        label="5-hour"
                        utilization={usage.five_hour.utilization}
                        resetsAt={usage.five_hour.resets_at}
                      />
                    )}
                    {usage.seven_day && (
                      <UsageBar
                        label="7-day"
                        utilization={usage.seven_day.utilization}
                        resetsAt={usage.seven_day.resets_at}
                      />
                    )}
                    {usage.seven_day_sonnet && (
                      <UsageBar
                        label="7-day · Sonnet"
                        utilization={usage.seven_day_sonnet.utilization}
                        resetsAt={usage.seven_day_sonnet.resets_at}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer — hidden when there is an error */}
      {usage && !error && (
        <div className="shrink-0 px-4 py-2.5 border-t border-zinc-800/60">
          <p className="text-xs text-zinc-600 text-center">
            {formatTimestamp(usage.fetched_at, preciseTimestamp)}
          </p>
        </div>
      )}
    </div>
  );
}
