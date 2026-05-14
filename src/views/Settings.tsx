import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { AuthState, NotificationRule, Settings as SettingsType, DEFAULT_SETTINGS } from "../lib/types";
import WindowControls from "../components/WindowControls";

interface Props {
  auth: AuthState;
  isFocused: boolean;
  onBack: () => void;
  onLogout: () => void;
  onOpenDebug: () => void;
}

// ── Primitives ───────────────────────────────────────────────────────────────

function Toggle({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 transition-opacity ${disabled ? "opacity-40" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-zinc-200">{label}</p>
        {description && (
          <p className="text-[11.5px] text-zinc-500 mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <button
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        className={`relative shrink-0 w-[34px] h-[19px] rounded-full transition-colors disabled:cursor-not-allowed ${
          value && !disabled ? "bg-amber-600" : "bg-zinc-700/80"
        }`}
      >
        <span
          className={`absolute top-[2px] left-[2px] w-[15px] h-[15px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.4)] transition-transform duration-150 ${
            value && !disabled ? "translate-x-[15px]" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] text-zinc-500 font-medium">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-950/60 border border-zinc-800 rounded-md px-2.5 py-1.5 text-[12.5px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-600/50 focus:bg-zinc-950 transition-colors font-mono"
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[10.5px] font-semibold text-zinc-500 uppercase tracking-[0.08em] px-1">{title}</p>
      <div className="rounded-xl bg-zinc-900/70 border border-zinc-800/80 px-3.5 py-3 space-y-3.5">
        {children}
      </div>
    </div>
  );
}

function Slider({ value, min, max, step, onChange }: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ ["--range-progress" as string]: `${pct}%` }}
      className="flex-1"
    />
  );
}

// ── Rule helpers ─────────────────────────────────────────────────────────────

const WINDOWS_ALL = [
  { value: "five_hour",        label: "5-hour" },
  { value: "seven_day",        label: "7-day"  },
  { value: "seven_day_sonnet", label: "Sonnet" },
  { value: "any",              label: "Any"    },
];
const WINDOWS_SPECIFIC = WINDOWS_ALL.slice(0, 3);

const RESET_OPTIONS = [
  { value: 5,   label: "5m"  },
  { value: 15,  label: "15m" },
  { value: 30,  label: "30m" },
  { value: 60,  label: "1h"  },
  { value: 120, label: "2h"  },
];

const RULE_TYPES: { type: NotificationRule["type"]; label: string; description: string }[] = [
  { type: "threshold",  label: "Usage threshold",      description: "Alert when a window reaches a percentage" },
  { type: "spike",      label: "Usage spike",          description: "Alert when usage jumps between polls"     },
  { type: "reset_soon", label: "Limit resetting soon", description: "Alert before a window resets"             },
  { type: "recovery",   label: "Usage recovery",       description: "Alert when usage drops below a level"     },
];

function ruleTypeLabel(type: NotificationRule["type"]): string {
  return RULE_TYPES.find((r) => r.type === type)?.label ?? type;
}

function windowLabel(w: string): string {
  return { five_hour: "5-hour", seven_day: "7-day", seven_day_sonnet: "Sonnet", any: "any" }[w] ?? w;
}

function formatRule(rule: NotificationRule): string {
  switch (rule.type) {
    case "threshold":  return `When ${windowLabel(rule.window)} reaches ${rule.at_pct}%`;
    case "spike":      return `When ${windowLabel(rule.window)} spikes by ${rule.by_pct}%`;
    case "reset_soon": {
      const m = rule.within_mins;
      return `When ${windowLabel(rule.window)} resets within ${m >= 60 ? `${m / 60}h` : `${m}m`}`;
    }
    case "recovery":   return `When ${windowLabel(rule.window)} drops below ${rule.below_pct}%`;
  }
}

function makeDefaultRule(type: NotificationRule["type"]): NotificationRule {
  const id = Math.random().toString(36).slice(2, 10);
  switch (type) {
    case "threshold":  return { type, id, window: "five_hour", at_pct: 80 };
    case "spike":      return { type, id, window: "five_hour", by_pct: 20 };
    case "reset_soon": return { type, id, window: "five_hour", within_mins: 30 };
    case "recovery":   return { type, id, window: "five_hour", below_pct: 50 };
  }
}

// ── Window pill picker ───────────────────────────────────────────────────────

function WindowPicker({ windows, value, onChange }: {
  windows: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1 p-0.5 rounded-md bg-zinc-950/60 border border-zinc-800">
      {windows.map((w) => (
        <button
          key={w.value}
          onClick={() => onChange(w.value)}
          className={`flex-1 text-[11px] py-1 rounded transition-all ${
            value === w.value
              ? "bg-zinc-800 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

// ── Rule parameter editor (used inside the modal) ────────────────────────────

function RuleEditor({ rule, onChange }: {
  rule: NotificationRule;
  onChange: (r: NotificationRule) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-[10.5px] font-medium text-zinc-500 uppercase tracking-wide">Window</p>
        {rule.type === "threshold" || rule.type === "recovery" ? (
          <WindowPicker windows={WINDOWS_ALL}     value={rule.window}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onChange={(v) => onChange({ ...rule, window: v } as any)} />
        ) : (
          <WindowPicker windows={WINDOWS_SPECIFIC} value={rule.window}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onChange={(v) => onChange({ ...rule, window: v } as any)} />
        )}
      </div>

      {rule.type === "threshold" && (
        <div className="space-y-1.5">
          <p className="text-[10.5px] font-medium text-zinc-500 uppercase tracking-wide">Alert when above</p>
          <div className="flex items-center gap-3">
            <Slider value={rule.at_pct} min={10} max={100} step={5}
              onChange={(v) => onChange({ ...rule, at_pct: v })} />
            <span className="text-[12.5px] text-zinc-200 tabular-nums font-mono w-9 text-right">{rule.at_pct}%</span>
          </div>
        </div>
      )}

      {rule.type === "spike" && (
        <div className="space-y-1.5">
          <p className="text-[10.5px] font-medium text-zinc-500 uppercase tracking-wide">Jump of at least</p>
          <div className="flex items-center gap-3">
            <Slider value={rule.by_pct} min={5} max={50} step={5}
              onChange={(v) => onChange({ ...rule, by_pct: v })} />
            <span className="text-[12.5px] text-zinc-200 tabular-nums font-mono w-9 text-right">{rule.by_pct}%</span>
          </div>
          <p className="text-[10.5px] text-zinc-600 leading-relaxed">Between consecutive polls</p>
        </div>
      )}

      {rule.type === "reset_soon" && (
        <div className="space-y-1.5">
          <p className="text-[10.5px] font-medium text-zinc-500 uppercase tracking-wide">Alert within</p>
          <div className="flex gap-1 p-0.5 rounded-md bg-zinc-950/60 border border-zinc-800">
            {RESET_OPTIONS.map((o) => (
              <button key={o.value} onClick={() => onChange({ ...rule, within_mins: o.value })}
                className={`flex-1 text-[11.5px] py-1 rounded transition-all ${
                  rule.within_mins === o.value
                    ? "bg-zinc-800 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >{o.label}</button>
            ))}
          </div>
        </div>
      )}

      {rule.type === "recovery" && (
        <div className="space-y-1.5">
          <p className="text-[10.5px] font-medium text-zinc-500 uppercase tracking-wide">Alert when drops below</p>
          <div className="flex items-center gap-3">
            <Slider value={rule.below_pct} min={10} max={90} step={5}
              onChange={(v) => onChange({ ...rule, below_pct: v })} />
            <span className="text-[12.5px] text-zinc-200 tabular-nums font-mono w-9 text-right">{rule.below_pct}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mac-style rule list with portal dropdown + portal modal editor ────────────

const TOPBAR_H = 41;

function RuleList({ rules, onChange }: {
  rules: NotificationRule[];
  onChange: (rules: NotificationRule[]) => void;
}) {
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<NotificationRule | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [menuPos, setMenuPos]         = useState<{ top?: number; bottom?: number; left: number }>({ left: 0 });
  const plusRef        = useRef<HTMLButtonElement>(null);
  const listRef        = useRef<HTMLDivElement>(null);
  const editingRuleRef = useRef<NotificationRule | null>(null);

  // Keep ref in sync so the pointerdown handler below can read it without stale closures
  useEffect(() => { editingRuleRef.current = editingRule; }, [editingRule]);

  // Escape key closes modal
  useEffect(() => {
    if (!editingRule) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setEditingRule(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingRule]);

  // Deselect when clicking anywhere outside — but NOT while a modal is open
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      if (editingRuleRef.current) return; // modal open — backdrop click keeps selection
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        setSelectedId(null);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, []);

  // Close the add-type dropdown if the user scrolls
  useEffect(() => {
    if (!showAddMenu) return;
    const handler = () => setShowAddMenu(false);
    window.addEventListener("scroll", handler, true);
    return () => window.removeEventListener("scroll", handler, true);
  }, [showAddMenu]);

  const openAddMenu = () => {
    if (plusRef.current) {
      const r = plusRef.current.getBoundingClientRect();
      const midpoint = window.innerHeight / 2;
      if (r.top > midpoint) {
        // Button is in lower half — open upward
        setMenuPos({ bottom: window.innerHeight - r.top + 4, left: r.left });
      } else {
        // Button is in upper half — open downward
        setMenuPos({ top: r.bottom + 4, left: r.left });
      }
    }
    setShowAddMenu(true);
  };

  const addRule = (type: NotificationRule["type"]) => {
    const rule = makeDefaultRule(type);
    onChange([...rules, rule]);
    setSelectedId(rule.id);
    setEditingRule(rule);
    setShowAddMenu(false);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    onChange(rules.filter((r) => r.id !== selectedId));
    setSelectedId(null);
    setEditingRule(null);
  };

  const updateRule = (updated: NotificationRule) => {
    onChange(rules.map((r) => (r.id === updated.id ? updated : r)));
    setEditingRule(updated);
  };

  const openEditor = (rule: NotificationRule) => {
    setSelectedId(rule.id);
    setEditingRule(rule);
  };

  return (
    <div ref={listRef} className="space-y-1.5">
      <div className="rounded-md border border-zinc-800 bg-zinc-950 h-[135px] overflow-y-auto no-scrollbar">
        {rules.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[11.5px] text-zinc-600">
            No rules — press + to add one
          </div>
        ) : (
          rules.map((rule, i) => (
            <div
              key={rule.id}
              className={`group flex items-center gap-1 px-2.5 py-1.5 text-[12px] cursor-default transition-colors ${
                (i < rules.length - 1 || rules.length <= 4) ? "border-b border-zinc-800/80" : ""
              } ${
                selectedId === rule.id
                  ? "bg-amber-600/15 text-amber-300"
                  : "text-zinc-400 hover:bg-zinc-800/40 hover:text-zinc-200"
              }`}
              onClick={() => setSelectedId(rule.id)}
              onDoubleClick={() => openEditor(rule)}
            >
              <span className="flex-1 pointer-events-none truncate">{formatRule(rule)}</span>
              <button
                className={`shrink-0 p-0.5 rounded transition-opacity opacity-0 group-hover:opacity-100 ${
                  selectedId === rule.id
                    ? "text-amber-400/70 hover:text-amber-300"
                    : "text-zinc-600 hover:text-zinc-300"
                }`}
                onClick={(e) => { e.stopPropagation(); openEditor(rule); }}
                onDoubleClick={(e) => e.stopPropagation()}
                title="Edit"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>

      <div className="inline-flex border border-zinc-800 rounded-md overflow-hidden bg-zinc-950/60">
        <button
          ref={plusRef}
          onClick={openAddMenu}
          className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition-colors border-r border-zinc-800 text-sm leading-none"
        >+</button>
        <button
          onClick={removeSelected}
          disabled={!selectedId}
          className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition-colors text-sm leading-none disabled:opacity-30 disabled:pointer-events-none"
        >−</button>
      </div>

      {showAddMenu && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
          <div
            className="fixed z-50 bg-zinc-900 border border-zinc-700/80 rounded-lg overflow-hidden w-56 shadow-[0_8px_30px_rgba(0,0,0,0.6)]"
            style={{ top: menuPos.top, bottom: menuPos.bottom, left: menuPos.left }}
          >
            {RULE_TYPES.map((rt, i) => (
              <button
                key={rt.type}
                onClick={() => addRule(rt.type)}
                className={`w-full px-3 py-2 text-left transition-colors hover:bg-zinc-800 ${
                  i < RULE_TYPES.length - 1 ? "border-b border-zinc-800/80" : ""
                }`}
              >
                <p className="text-[12px] text-zinc-200 font-medium">{rt.label}</p>
                <p className="text-[10.5px] text-zinc-500 mt-0.5 leading-snug">{rt.description}</p>
              </button>
            ))}
          </div>
        </>,
        document.body
      )}

      {editingRule && createPortal(
        <div
          className="fixed inset-x-0 bottom-0 bg-[#0d0d0d]/80 backdrop-blur-sm flex items-center justify-center z-50 px-4 py-4"
          style={{ top: TOPBAR_H }}
          onClick={() => setEditingRule(null)}
        >
          <div
            className="bg-zinc-900 border border-zinc-700/60 rounded-xl w-full shadow-[0_12px_48px_rgba(0,0,0,0.7)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-zinc-800">
              <p className="text-[12.5px] font-semibold text-zinc-100">{ruleTypeLabel(editingRule.type)}</p>
              <button
                onClick={() => setEditingRule(null)}
                className="p-1 -mr-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-3.5 py-3.5">
              <RuleEditor rule={editingRule} onChange={updateRule} />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ── API helpers ───────────────────────────────────────────────────────────────

function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function ApiKeyField({
  value,
  onRegenerate,
}: {
  value: string;
  onRegenerate: (key: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const display = value.length > 12
    ? `${value.slice(0, 8)}${"●".repeat(8)}${value.slice(-8)}`
    : "●".repeat(value.length || 8);

  const copy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-zinc-500 font-medium">API key</p>
      <div className="flex gap-1.5">
        <div className="flex-1 min-w-0 bg-zinc-950/60 border border-zinc-800 rounded-md px-2.5 py-1.5 font-mono text-[11.5px] text-zinc-300 truncate">
          {value ? display : <span className="text-zinc-600 font-sans">No key — click Regen</span>}
        </div>
        <button
          onClick={copy}
          disabled={!value}
          className="shrink-0 px-2.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors text-[11px] disabled:opacity-40 disabled:pointer-events-none"
        >{copied ? "✓" : "Copy"}</button>
        <button
          onClick={() => onRegenerate(generateApiKey())}
          className="shrink-0 px-2.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors text-[11px]"
        >Regen</button>
      </div>
    </div>
  );
}

function ApiPreview({ port, requireAuth, apiKey, allowReadUsage }: {
  port: number;
  requireAuth: boolean;
  apiKey: string;
  allowReadUsage: boolean;
}) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const endpoint = allowReadUsage ? "/usage" : "/";
  const authLine = requireAuth && apiKey
    ? `  -H "Authorization: Bearer ${apiKey.slice(0, 8)}…"`
    : null;
  const generatedCurl = [`curl ${baseUrl}${endpoint}`, ...(authLine ? [authLine] : [])].join(" \\\n");

  const [curlText, setCurlText] = useState(generatedCurl);
  const [testing, setTesting] = useState(false);
  const [response, setResponse] = useState<{ ok: boolean; status: number; body: string } | null>(null);

  // Keep textarea in sync when settings change
  useEffect(() => { setCurlText(generatedCurl); }, [generatedCurl]);

  const extractUrl = (text: string) => text.match(/https?:\/\/[^\s\\]+/)?.[0] ?? null;

  const test = async () => {
    const url = extractUrl(curlText);
    if (!url) return;
    setTesting(true);
    setResponse(null);
    try {
      const headers: Record<string, string> = {};
      if (requireAuth && apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      const resp = await fetch(url, { headers });
      const text = await resp.text();
      let body: string;
      try { body = JSON.stringify(JSON.parse(text), null, 2); }
      catch { body = text; }
      setResponse({ ok: resp.ok, status: resp.status, body });
    } catch (e) {
      setResponse({ ok: false, status: 0, body: String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-[10.5px] font-semibold text-zinc-600 uppercase tracking-[0.08em] px-0.5">Preview</p>
      <div className="rounded-lg bg-zinc-950 border border-zinc-800/80 px-3 py-2.5 space-y-2.5">
        <div>
          <p className="text-[9.5px] text-zinc-600 font-medium uppercase tracking-wider mb-0.5">Base URL</p>
          <p className="text-[12px] text-amber-400/80 font-mono select-all cursor-text">{baseUrl}</p>
        </div>
        <div>
          <p className="text-[9.5px] text-zinc-600 font-medium uppercase tracking-wider mb-1">Request</p>
          <textarea
            value={curlText}
            onChange={(e) => setCurlText(e.target.value)}
            spellCheck={false}
            rows={curlText.split("\n").length}
            className="w-full resize-none bg-transparent text-[11px] text-zinc-400 font-mono leading-relaxed focus:outline-none"
          />
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <button
          onClick={test}
          disabled={testing || !extractUrl(curlText)}
          className="text-[11.5px] px-2.5 py-1 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          {testing ? "Testing…" : "Send"}
        </button>
        {response && (
          <span className={`text-[11px] font-mono tabular-nums ${response.ok ? "text-emerald-400" : "text-red-400"}`}>
            {response.status > 0 ? `HTTP ${response.status}` : "Error"}
          </span>
        )}
      </div>
      {response && (
        <div className="rounded-lg bg-zinc-950 border border-zinc-800/80 px-3 py-2.5 max-h-[160px] overflow-y-auto no-scrollbar">
          <pre className={`text-[10.5px] font-mono leading-relaxed whitespace-pre-wrap ${response.ok ? "text-zinc-300" : "text-red-400/90"}`}>
            {response.body}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Main Settings view ───────────────────────────────────────────────────────

export default function Settings({ auth, isFocused, onBack, onLogout, onOpenDebug }: Props) {
  const [settings, setSettings]           = useState<SettingsType>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [ntfyTesting, setNtfyTesting]     = useState(false);
  const [ntfyTestOk, setNtfyTestOk]       = useState(false);
  const [ntfyTestError, setNtfyTestError] = useState<string | null>(null);
  const [appVersion, setAppVersion]       = useState<string | null>(null);
  const debugTapCount = useRef(0);
  const debugTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoaded = useRef(false);

  useEffect(() => {
    invoke<SettingsType>("get_settings").then((s) => {
      setSettings(s);
      // Re-enable transitions only after the browser has painted the correct values,
      // otherwise the toggle thumbs animate from their defaults to the saved positions.
      requestAnimationFrame(() => requestAnimationFrame(() => setSettingsLoaded(true)));
    });
    getVersion().then((v) => setAppVersion(v));
  }, []);

  useEffect(() => {
    if (!isLoaded.current) {
      isLoaded.current = true;
      return;
    }
    const timer = setTimeout(() => {
      invoke("save_settings", { settings }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [settings]);

  const update = (patch: Partial<SettingsType>) =>
    setSettings((s) => ({ ...s, ...patch }));

  const updateNtfyField = (patch: Partial<SettingsType>) => {
    update(patch);
    // Clear stale test status whenever the server/topic changes
    setNtfyTestError(null);
    setNtfyTestOk(false);
  };

  const testNtfy = async () => {
    setNtfyTesting(true);
    setNtfyTestError(null);
    setNtfyTestOk(false);
    try {
      await invoke("send_ntfy", {
        server: settings.ntfy_server,
        topic: settings.ntfy_topic,
        title: "Claudeometer",
        body: "ntfy notifications are working.",
      });
      setNtfyTestOk(true);
      setTimeout(() => setNtfyTestOk(false), 3000);
    } catch (e) {
      setNtfyTestError(String(e));
    } finally {
      setNtfyTesting(false);
    }
  };

  const INTERVALS = [
    { label: "30s", value: 30  },
    { label: "1m",  value: 60  },
    { label: "5m",  value: 300 },
    { label: "15m", value: 900 },
  ];

  return (
    <div className="relative flex flex-col h-full">
      {/* Topbar */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between h-[48px] px-3.5 border-b border-zinc-800/60 select-none shrink-0 bg-gradient-to-b from-[#141414] to-[#101010]"
      >
        <div className="flex items-center gap-1.5">
          <button
            onClick={onBack}
            className={`-ml-1.5 p-1.5 rounded-md transition-colors duration-200 hover:text-zinc-200 hover:bg-zinc-800/80 ${isFocused ? "text-zinc-500" : "text-zinc-700"}`}
            title="Back"
          >
            <svg className="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className={`text-[13px] font-semibold pointer-events-none tracking-tight transition-colors duration-200 ${isFocused ? "text-zinc-200" : "text-zinc-500"}`}>Settings</span>
        </div>
        <WindowControls isFocused={isFocused} />
      </div>

      <div className={`flex-1 overflow-y-auto overscroll-y-none px-3.5 py-3.5 space-y-4 transition-opacity duration-150 ${!settingsLoaded ? "opacity-0 [&_*]:!transition-none" : ""}`}>
        <Section title="General">
          <Toggle label="Launch at startup"
            value={settings.launch_at_startup}
            onChange={(v) => update({ launch_at_startup: v })} />
          <Toggle label="Show in system tray"
            value={settings.show_in_tray}
            onChange={(v) => update({ show_in_tray: v, ...(!v ? { minimize_to_tray: false } : {}) })} />
          <Toggle label="Minimize to tray on close"
            value={settings.minimize_to_tray}
            onChange={(v) => update({ minimize_to_tray: v })}
            disabled={!settings.show_in_tray} />
        </Section>

        <Section title="Sync">
          <div className="space-y-1.5">
            <p className="text-[11px] text-zinc-500 font-medium">Poll interval</p>
            <div className="flex gap-1 p-0.5 rounded-md bg-zinc-950/60 border border-zinc-800">
              <button
                onClick={() => update({ auto_poll: false })}
                className={`flex-1 text-[11.5px] py-1 rounded transition-all ${
                  !settings.auto_poll
                    ? "bg-zinc-800 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >Off</button>
              {INTERVALS.map((i) => (
                <button
                  key={i.value}
                  onClick={() => update({ poll_interval_secs: i.value, auto_poll: true })}
                  className={`flex-1 text-[11.5px] py-1 rounded transition-all ${
                    settings.auto_poll && settings.poll_interval_secs === i.value
                      ? "bg-zinc-800 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >{i.label}</button>
              ))}
            </div>
          </div>
          <Toggle
            label="Refresh on focus"
            description="Fetch when the window gains focus"
            value={settings.foreground_poll}
            onChange={(v) => update({ foreground_poll: v })} />
        </Section>

        <Section title="Notifications">
          <Toggle
            label="Desktop notifications"
            value={settings.notifications_enabled}
            onChange={(v) => update({ notifications_enabled: v })} />
          {settings.notifications_enabled && (
            <RuleList
              rules={settings.notification_rules}
              onChange={(rules) => update({ notification_rules: rules })} />
          )}
        </Section>

        <Section title="ntfy">
          <Toggle label="Enable ntfy"
            value={settings.ntfy_enabled}
            onChange={(v) => update({ ntfy_enabled: v })} />
          {settings.ntfy_enabled && (
            <>
              <Field label="Server" value={settings.ntfy_server} placeholder="https://ntfy.sh"
                onChange={(v) => updateNtfyField({ ntfy_server: v })} />
              <Field label="Topic" value={settings.ntfy_topic} placeholder="claudeometer"
                onChange={(v) => updateNtfyField({ ntfy_topic: v })} />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11.5px] text-zinc-500">Test connection</p>
                <button
                  onClick={testNtfy}
                  disabled={ntfyTesting || !settings.ntfy_server || !settings.ntfy_topic}
                  className={`text-[11.5px] px-2.5 py-1 rounded-md border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                    ntfyTestOk
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700"
                  }`}
                >
                  {ntfyTesting ? "Sending…" : ntfyTestOk ? "Sent ✓" : "Send test"}
                </button>
              </div>
              {ntfyTestError && (
                <p className="text-[11.5px] text-red-400 bg-red-500/8 border border-red-500/20 rounded-md px-2.5 py-1.5 leading-relaxed">
                  {ntfyTestError}
                </p>
              )}
              <div className="space-y-1.5">
                <p className="text-[11px] text-zinc-500 font-medium">Rules</p>
                <RuleList
                  rules={settings.ntfy_rules}
                  onChange={(rules) => update({ ntfy_rules: rules })} />
              </div>
            </>
          )}
        </Section>

        <Section title="API">
          <Toggle
            label="Enable API server"
            description="Expose a local HTTP endpoint for querying usage and controlling the app"
            value={settings.api_enabled}
            onChange={(v) => update({ api_enabled: v })}
          />
          {settings.api_enabled && (
            <>
              <div className="h-px bg-zinc-800/60" />

              <div className="space-y-1.5">
                <label className="text-[11px] text-zinc-500 font-medium">Port</label>
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={settings.api_port}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v)) update({ api_port: Math.min(65535, Math.max(1024, v)) });
                  }}
                  className="w-full bg-zinc-950/60 border border-zinc-800 rounded-md px-2.5 py-1.5 text-[12.5px] text-zinc-200 focus:outline-none focus:border-amber-600/50 transition-colors font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-[11px] text-zinc-500 font-medium">Access</p>
                <div className="flex gap-1 p-0.5 rounded-md bg-zinc-950/60 border border-zinc-800">
                  {([["Local only", true], ["Network", false]] as const).map(([label, val]) => (
                    <button
                      key={String(val)}
                      onClick={() => update({ api_local_only: val })}
                      className={`flex-1 text-[11.5px] py-1 rounded transition-all ${
                        settings.api_local_only === val
                          ? "bg-zinc-800 text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >{label}</button>
                  ))}
                </div>
                {!settings.api_local_only && !settings.api_require_auth && (
                  <p className="text-[11px] text-amber-600/90 leading-relaxed">
                    Anyone on your network can reach this API — use credentials.
                  </p>
                )}
              </div>

              <div className="h-px bg-zinc-800/60" />

              <Toggle
                label="Require credentials"
                description="Protect the API with a secret key"
                value={settings.api_require_auth}
                onChange={(v) => {
                  if (v && !settings.api_key) {
                    update({ api_require_auth: v, api_key: generateApiKey() });
                  } else {
                    update({ api_require_auth: v });
                  }
                }}
              />
              {settings.api_require_auth && (
                <ApiKeyField
                  value={settings.api_key}
                  onRegenerate={(key) => update({ api_key: key })}
                />
              )}

              <div className="h-px bg-zinc-800/60" />

              <div className="space-y-2.5">
                <p className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider px-0.5">Permissions</p>
                <Toggle
                  label="Read usage"
                  description="GET /usage"
                  value={settings.api_allow_read_usage}
                  onChange={(v) => update({ api_allow_read_usage: v })}
                />
                <Toggle
                  label="Trigger refresh"
                  description="POST /usage/refresh"
                  value={settings.api_allow_refresh}
                  onChange={(v) => update({ api_allow_refresh: v })}
                />
                <Toggle
                  label="Read settings"
                  description="GET /settings"
                  value={settings.api_allow_read_settings}
                  onChange={(v) => update({ api_allow_read_settings: v })}
                />
                <Toggle
                  label="Modify settings"
                  description="PATCH /settings"
                  value={settings.api_allow_write_settings}
                  onChange={(v) => update({ api_allow_write_settings: v })}
                />
              </div>

              <div className="h-px bg-zinc-800/60" />

              <ApiPreview
                port={settings.api_port}
                requireAuth={settings.api_require_auth}
                apiKey={settings.api_key}
                allowReadUsage={settings.api_allow_read_usage}
              />
            </>
          )}
        </Section>

        <Section title="Display">
          <Toggle
            label="Precise timestamp"
            description="Show exact time instead of relative"
            value={settings.precise_timestamp}
            onChange={(v) => update({ precise_timestamp: v })} />
          <Toggle
            label="Hide refresh cooldown"
            description="Don't show the countdown on the refresh button"
            value={settings.hide_cooldown_badge}
            onChange={(v) => update({ hide_cooldown_badge: v })} />
          <Toggle
            label="Reset time tooltip"
            description="Hover the relative reset time to see the exact date"
            value={settings.show_reset_tooltip ?? true}
            onChange={(v) => update({ show_reset_tooltip: v })} />
        </Section>

        <Section title="Account">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500/30 to-amber-600/10 border border-amber-600/20 flex items-center justify-center shrink-0">
              <span className="text-[12px] font-semibold text-amber-400">
                {(auth.name || auth.email || "?").charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              {auth.name && <p className="text-[13px] text-zinc-200 truncate">{auth.name}</p>}
              {auth.email && (
                <p className={`${auth.name ? "text-[11.5px] text-zinc-500" : "text-[13px] text-zinc-300"} truncate`}>
                  {auth.email}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onLogout}
            className="w-full text-[12.5px] text-red-400 hover:text-red-300 bg-red-500/8 hover:bg-red-500/12 border border-red-500/20 rounded-md py-1.5 transition-colors"
          >
            Sign out
          </button>
        </Section>

        <Section title="About">
          <div className="flex items-center gap-3">
            <img
            src="/icon-large.png" alt="" className="w-9 h-9 rounded-lg shrink-0" draggable={false}
            onClick={() => {
              debugTapCount.current += 1;
              if (debugTapTimer.current) clearTimeout(debugTapTimer.current);
              debugTapTimer.current = setTimeout(() => { debugTapCount.current = 0; }, 1500);
              if (debugTapCount.current >= 5) {
                debugTapCount.current = 0;
                onOpenDebug();
              }
            }}
          />
            <div>
              <p className="text-[13px] font-semibold text-zinc-100 tracking-tight">Claudeometer</p>
              <p className="text-[11.5px] text-zinc-500">
                {appVersion ? `v${appVersion}` : "—"}
              </p>
            </div>
          </div>
          <p className="text-[12px] text-zinc-500 leading-relaxed">
            A lightweight desktop app for monitoring Claude.ai usage limits in real time.
          </p>
          <button
            onClick={() => openUrl("https://github.com/Antoinenz/Claudeometer")}
            className="flex items-center gap-2 text-[12px] text-zinc-400 hover:text-zinc-100 transition-colors group"
          >
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            <span>github.com/Antoinenz/Claudeometer</span>
            <svg className="w-3 h-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity -ml-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </button>
        </Section>

      </div>
    </div>
  );
}
