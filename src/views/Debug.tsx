import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { Settings, UsageData } from "../lib/types";
import UsageBar from "../components/UsageBar";
import WindowControls from "../components/WindowControls";

interface Props {
  isFocused: boolean;
  settings: Settings;
  onBack: () => void;
  onSimulate: (usage: UsageData | null, error: string | null) => void;
}

// ── Mock data helpers ────────────────────────────────────────────────────────

function mockUsage(five: number, seven: number, sonnet?: number): UsageData {
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  return {
    five_hour:        { utilization: five,   resets_at: inHours(1.8) },
    seven_day:        { utilization: seven,  resets_at: inHours(54)  },
    seven_day_sonnet: sonnet != null ? { utilization: sonnet, resets_at: inHours(54) } : null,
    org_name: null,
    name:  "Debug User",
    email: "debug@example.com",
    fetched_at: new Date().toISOString(),
    source: "claude_ai",
  };
}

const SIMULATIONS: { label: string; usage: UsageData | null; error: string | null }[] = [
  { label: "All clear",        usage: mockUsage(12, 18, 9),        error: null },
  { label: "Mid usage",        usage: mockUsage(63, 47),           error: null },
  { label: "High usage",       usage: mockUsage(83, 72, 61),       error: null },
  { label: "Maxed out",        usage: mockUsage(97, 91, 88),       error: null },
  { label: "Loading",          usage: null,                         error: null },
  { label: "No internet",      usage: null, error: "network error: offline"     },
  { label: "Session expired",  usage: null, error: "401 unauthorized session"   },
  { label: "Claude down",      usage: null, error: "502 bad gateway claude.ai"  },
  { label: "Unknown error",    usage: null, error: "something unexpected broke" },
];

// ── Notification test state ──────────────────────────────────────────────────

type TestStatus = "idle" | "sending" | "ok" | "error";

function useNotifTest() {
  const [status, setStatus] = useState<TestStatus>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setStatus("sending"); setMsg(null);
    try {
      await fn();
      setStatus("ok");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (e) {
      setStatus("error"); setMsg(String(e));
    }
  };
  return { status, msg, run };
}

// ── Sub-components ───────────────────────────────────────────────────────────

function DebugSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-[0.08em] px-1">{title}</p>
      <div className="rounded-xl bg-zinc-900/70 border border-zinc-800/80 px-3.5 py-3 space-y-3.5">
        {children}
      </div>
    </div>
  );
}

function TestButton({ label, status, msg, onClick, disabled }: {
  label: string; status: TestStatus; msg: string | null;
  onClick: () => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-zinc-300">{label}</p>
        <button
          onClick={onClick}
          disabled={disabled || status === "sending"}
          className={`text-[11.5px] px-2.5 py-1 rounded-md border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
            status === "ok"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700"
          }`}
        >
          {status === "sending" ? "Sending…" : status === "ok" ? "Sent ✓" : "Send"}
        </button>
      </div>
      {status === "error" && msg && (
        <p className="text-[11px] text-red-400 leading-relaxed">{msg}</p>
      )}
    </div>
  );
}

// ── Main Debug view ──────────────────────────────────────────────────────────

export default function Debug({ isFocused, settings, onBack, onSimulate }: Props) {
  const [version, setVersion] = useState<string | null>(null);
  const desktop = useNotifTest();
  const ntfy    = useNotifTest();

  useEffect(() => { getVersion().then(setVersion); }, []);

  const isDev = import.meta.env.DEV;

  return (
    <div className="flex flex-col h-full">
      {/* Topbar */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-3.5 py-2.5 border-b border-zinc-800/60 select-none shrink-0 bg-gradient-to-b from-[#141414] to-[#101010]"
      >
        <div className="flex items-center gap-1.5">
          <button
            onClick={onBack}
            className="-ml-1.5 p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors"
            title="Back"
          >
            <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className={`text-[13px] font-semibold pointer-events-none tracking-tight transition-colors duration-200 ${isFocused ? "text-zinc-200" : "text-zinc-500"}`}>
            Debug
          </span>
          {isDev && (
            <span className="text-[9px] font-mono px-1 py-px rounded bg-amber-600/20 text-amber-500 border border-amber-600/30">
              DEV
            </span>
          )}
        </div>
        <WindowControls isFocused={isFocused} />
      </div>

      <div className="flex-1 overflow-y-auto overscroll-y-none px-3.5 py-3.5 space-y-4">

        {/* Simulate dashboard states */}
        <DebugSection title="Simulate">
          <p className="text-[11.5px] text-zinc-500 -mt-1 leading-relaxed">
            Switches to the dashboard with mock data. Exit via the banner at the bottom.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {SIMULATIONS.map((s) => (
              <button
                key={s.label}
                onClick={() => onSimulate(s.usage, s.error)}
                className="text-left px-2.5 py-2 rounded-md bg-zinc-950/60 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/60 transition-colors"
              >
                <p className="text-[11.5px] text-zinc-300">{s.label}</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">
                  {s.error ? "Error state" : s.usage ? `${s.usage.five_hour?.utilization ?? 0}% / ${s.usage.seven_day?.utilization ?? 0}%` : "Loading"}
                </p>
              </button>
            ))}
          </div>
        </DebugSection>

        {/* Usage bar preview */}
        <DebugSection title="Usage tiers">
          <div className="space-y-2">
            <UsageBar label="Green  · 15%"  utilization={15}  resetsAt={new Date(Date.now() + 3_600_000 * 3).toISOString()} />
            <UsageBar label="Amber  · 65%"  utilization={65}  resetsAt={new Date(Date.now() + 3_600_000 * 1).toISOString()} />
            <UsageBar label="Orange · 80%"  utilization={80}  resetsAt={new Date(Date.now() + 3_600_000 * 0.5).toISOString()} />
            <UsageBar label="Red    · 95%"  utilization={95}  resetsAt={null} />
          </div>
        </DebugSection>

        {/* Notification tests */}
        <DebugSection title="Notifications">
          <TestButton
            label="Desktop notification"
            status={desktop.status}
            msg={desktop.msg}
            onClick={() =>
              desktop.run(() =>
                invoke("show_desktop_notification", {
                  title: "Claudeometer",
                  body: "This is a test desktop notification.",
                })
              )
            }
          />
          <TestButton
            label="ntfy push"
            status={ntfy.status}
            msg={ntfy.msg}
            disabled={!settings.ntfy_enabled || !settings.ntfy_server || !settings.ntfy_topic}
            onClick={() =>
              ntfy.run(() =>
                invoke("send_ntfy", {
                  server: settings.ntfy_server,
                  topic:  settings.ntfy_topic,
                  title:  "Claudeometer",
                  body:   "This is a test ntfy notification.",
                })
              )
            }
          />
          {!settings.ntfy_enabled && (
            <p className="text-[10.5px] text-zinc-600">Enable ntfy in Settings to test push.</p>
          )}
        </DebugSection>

        {/* Build info */}
        <DebugSection title="Build">
          {[
            ["Version",    version ? `v${version}` : "—"],
            ["Build mode", isDev ? "Development" : "Production"],
            ["Platform",   navigator.platform || "—"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <p className="text-[12px] text-zinc-500">{k}</p>
              <p className={`text-[12px] font-mono ${k === "Build mode" && isDev ? "text-amber-400" : "text-zinc-300"}`}>{v}</p>
            </div>
          ))}
        </DebugSection>

      </div>
    </div>
  );
}
