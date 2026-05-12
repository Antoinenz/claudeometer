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
  hideCooldownBadge: boolean;
  isFocused: boolean;
  onSettings: () => void;
  onRefresh: () => void;
}

type ErrorKind = "offline" | "auth" | "claude" | "unknown";

function classifyError(err: string): { kind: ErrorKind; title: string; hint: string } {
  const lower = err.toLowerCase();
  if (lower.includes("network") || lower.includes("dns") || lower.includes("offline") || lower.includes("internet")) {
    return { kind: "offline", title: "No internet connection",   hint: "Check your network and try again" };
  }
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("session") || lower.includes("expired") || lower.includes("forbidden")) {
    return { kind: "auth",    title: "Session expired",          hint: "Sign in again from Settings" };
  }
  if (lower.includes("claude") || lower.includes("502") || lower.includes("503") || lower.includes("500") || lower.includes("timeout")) {
    return { kind: "claude",  title: "Can't reach Claude.ai",    hint: "The service may be unavailable" };
  }
  return       { kind: "unknown", title: "Something went wrong",     hint: "Try refreshing in a moment" };
}

function ErrorIcon({ kind }: { kind: ErrorKind }) {
  const paths: Record<ErrorKind, string> = {
    offline: "M18.364 5.636a9 9 0 010 12.728m-3.536-3.536a4 4 0 010-5.656M3 3l18 18",
    auth:    "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
    claude:  "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z",
    unknown: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  };
  return (
    <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={paths[kind]} />
    </svg>
  );
}

function SkeletonBar() {
  return (
    <div className="rounded-xl bg-zinc-900/70 border border-zinc-800/80 px-4 py-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full skeleton" />
          <span className="h-3 w-14 rounded skeleton" />
        </div>
        <span className="h-6 w-12 rounded skeleton" />
      </div>
      <div className="h-[7px] w-full rounded-full skeleton" />
    </div>
  );
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

export default function Dashboard({ usage, error, isRefreshing, cooldownEndsAt, preciseTimestamp, hideCooldownBadge, isFocused, onSettings, onRefresh }: Props) {
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

  const secsLeft = cooldownEndsAt && !error
    ? Math.max(0, Math.ceil((cooldownEndsAt - Date.now()) / 1000))
    : 0;
  const inCooldown = secsLeft > 0;
  const isRefreshDisabled = isRefreshing || inCooldown;

  const err = error ? classifyError(error) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Topbar */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-3.5 py-2.5 border-b border-zinc-800/60 select-none shrink-0 bg-gradient-to-b from-[#141414] to-[#101010]"
      >
        <div className="flex items-center gap-2 pointer-events-none">
          <img src="/icon.png" alt="" className="w-[18px] h-[18px] rounded" draggable={false} />
          <span className={`text-[13px] font-semibold tracking-tight transition-colors duration-200 ${isFocused ? "text-zinc-200" : "text-zinc-500"}`}>Claudeometer</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onRefresh}
            title={inCooldown ? `Refresh available in ${secsLeft}s` : "Refresh"}
            disabled={isRefreshDisabled}
            className={`relative p-1.5 rounded-md text-zinc-500 transition-colors disabled:opacity-40 ${
              inCooldown ? "cursor-default" : "hover:text-zinc-200 hover:bg-zinc-800/80"
            }`}
          >
            <div className="relative">
              <svg
                className={`w-[15px] h-[15px] ${isRefreshing ? "animate-spin" : ""}`}
                style={isRefreshing ? { animationDirection: "reverse" } : undefined}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {inCooldown && !hideCooldownBadge && (
                <span className="absolute -bottom-1.5 -right-2 text-[9px] font-mono leading-none text-zinc-500 bg-[#101010] px-[1px] tabular-nums">
                  {secsLeft}
                </span>
              )}
            </div>
          </button>
          <button
            onClick={onSettings}
            title="Settings"
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors"
          >
            <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <div className="w-px h-3.5 bg-zinc-800 mx-1" />
          <WindowControls />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-y-none">
        {err ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="text-center space-y-3 max-w-[220px]">
              <div className={`inline-flex items-center justify-center w-11 h-11 rounded-full ${
                err.kind === "auth" ? "bg-amber-500/10 text-amber-500" : "bg-zinc-800/80 text-zinc-500"
              }`}>
                <ErrorIcon kind={err.kind} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-200">{err.title}</p>
                <p className="text-xs text-zinc-500 leading-relaxed">{err.hint}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-3.5 py-3.5 space-y-2.5">
            {!usage && (
              <>
                <SkeletonBar />
                <SkeletonBar />
              </>
            )}

            {usage && (
              <>
                <>
                  {!usage.five_hour && !usage.seven_day && !usage.seven_day_sonnet && (
                    <div className="rounded-xl bg-zinc-900/70 border border-zinc-800/80 px-4 py-7 text-center">
                      <p className="text-sm text-zinc-500">No usage data returned.</p>
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
                      label="7-day Sonnet"
                      utilization={usage.seven_day_sonnet.utilization}
                      resetsAt={usage.seven_day_sonnet.resets_at}
                    />
                  )}
                </>
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      {usage && !error && (
        <div className="shrink-0 px-4 py-2 border-t border-zinc-800/60 bg-[#0d0d0d]">
          <p className="text-[10.5px] text-zinc-600 text-center tracking-tight">
            {formatTimestamp(usage.fetched_at, preciseTimestamp)}
          </p>
        </div>
      )}
    </div>
  );
}
