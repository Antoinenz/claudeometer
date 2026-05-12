import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AuthState, NotificationRule, Settings as SettingsType, DEFAULT_SETTINGS } from "../lib/types";
import WindowControls from "../components/WindowControls";

interface Props {
  auth: AuthState;
  onBack: () => void;
  onLogout: () => void;
}

// ── Small reusable primitives ────────────────────────────────────────────────

function Toggle({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-200">{label}</p>
        {description && (
          <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative shrink-0 w-9 h-5 rounded-full transition-colors ${
          value ? "bg-amber-600" : "bg-zinc-700"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
            value ? "translate-x-4" : "translate-x-0"
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
      <label className="text-xs text-zinc-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-600/50"
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-zinc-900 border border-zinc-800 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-zinc-800/60">
        <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">{title}</p>
      </div>
      <div className="px-4 py-4 space-y-4">{children}</div>
    </div>
  );
}

// ── Notification rule helpers ────────────────────────────────────────────────

const WINDOWS_ALL = [
  { value: "five_hour", label: "5-hour" },
  { value: "seven_day", label: "7-day" },
  { value: "seven_day_sonnet", label: "Sonnet" },
  { value: "any", label: "Any" },
];

const WINDOWS_SPECIFIC = WINDOWS_ALL.slice(0, 3);

const RESET_OPTIONS = [
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 60, label: "1h" },
  { value: 120, label: "2h" },
];

const RULE_TYPES: { type: NotificationRule["type"]; label: string; description: string }[] = [
  { type: "threshold",  label: "Usage threshold",      description: "Alert when a window reaches a percentage" },
  { type: "spike",      label: "Usage spike",          description: "Alert when usage jumps between polls" },
  { type: "reset_soon", label: "Limit resetting soon", description: "Alert before a window resets" },
  { type: "recovery",   label: "Usage recovery",       description: "Alert when usage drops below a level" },
];

function windowLabel(w: string): string {
  return (
    { five_hour: "5-hour", seven_day: "7-day", seven_day_sonnet: "Sonnet", any: "any" }[w] ?? w
  );
}

function formatRule(rule: NotificationRule): string {
  switch (rule.type) {
    case "threshold":
      return `When ${windowLabel(rule.window)} reaches ${rule.at_pct}%`;
    case "spike":
      return `When ${windowLabel(rule.window)} spikes by ${rule.by_pct}%`;
    case "reset_soon": {
      const m = rule.within_mins;
      return `When ${windowLabel(rule.window)} resets within ${m >= 60 ? `${m / 60}h` : `${m}m`}`;
    }
    case "recovery":
      return `When ${windowLabel(rule.window)} drops below ${rule.below_pct}%`;
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

function WindowPicker({
  windows,
  value,
  onChange,
}: {
  windows: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1.5">
      {windows.map((w) => (
        <button
          key={w.value}
          onClick={() => onChange(w.value)}
          className={`flex-1 text-[11px] py-1 rounded border transition-colors ${
            value === w.value
              ? "bg-amber-600/10 border-amber-600/40 text-amber-500"
              : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

// ── Rule parameter editor ────────────────────────────────────────────────────

function RuleEditor({ rule, onChange }: { rule: NotificationRule; onChange: (r: NotificationRule) => void }) {
  return (
    <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/50 px-3 py-3 space-y-3">
      {/* Window */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">Window</p>
        {rule.type === "threshold" || rule.type === "recovery" ? (
          <WindowPicker
            windows={WINDOWS_ALL}
            value={rule.window}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onChange={(v) => onChange({ ...rule, window: v } as any)}
          />
        ) : (
          <WindowPicker
            windows={WINDOWS_SPECIFIC}
            value={rule.window}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onChange={(v) => onChange({ ...rule, window: v } as any)}
          />
        )}
      </div>

      {/* Per-type params */}
      {rule.type === "threshold" && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">Alert when above</p>
          <div className="flex items-center gap-3">
            <input
              type="range" min={10} max={100} step={5} value={rule.at_pct}
              onChange={(e) => onChange({ ...rule, at_pct: Number(e.target.value) })}
              className="flex-1 accent-amber-600"
            />
            <span className="text-sm text-zinc-300 tabular-nums w-8 text-right">{rule.at_pct}%</span>
          </div>
        </div>
      )}

      {rule.type === "spike" && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">Jump of at least</p>
          <div className="flex items-center gap-3">
            <input
              type="range" min={5} max={50} step={5} value={rule.by_pct}
              onChange={(e) => onChange({ ...rule, by_pct: Number(e.target.value) })}
              className="flex-1 accent-amber-600"
            />
            <span className="text-sm text-zinc-300 tabular-nums w-8 text-right">{rule.by_pct}%</span>
          </div>
          <p className="text-[10px] text-zinc-600">Between consecutive polls</p>
        </div>
      )}

      {rule.type === "reset_soon" && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">Alert within</p>
          <div className="flex gap-1.5">
            {RESET_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => onChange({ ...rule, within_mins: o.value })}
                className={`flex-1 text-xs py-1 rounded border transition-colors ${
                  rule.within_mins === o.value
                    ? "bg-amber-600/10 border-amber-600/40 text-amber-500"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {rule.type === "recovery" && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">Alert when drops below</p>
          <div className="flex items-center gap-3">
            <input
              type="range" min={10} max={90} step={5} value={rule.below_pct}
              onChange={(e) => onChange({ ...rule, below_pct: Number(e.target.value) })}
              className="flex-1 accent-amber-600"
            />
            <span className="text-sm text-zinc-300 tabular-nums w-8 text-right">{rule.below_pct}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mac-style rule list ──────────────────────────────────────────────────────

function RuleList({
  rules,
  onChange,
}: {
  rules: NotificationRule[];
  onChange: (rules: NotificationRule[]) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const selectedRule = rules.find((r) => r.id === selectedId) ?? null;

  // Close dropdown on outside click
  useEffect(() => {
    if (!showAddMenu) return;
    const handler = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowAddMenu(false);
      }
    };
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, [showAddMenu]);

  const addRule = (type: NotificationRule["type"]) => {
    const rule = makeDefaultRule(type);
    onChange([...rules, rule]);
    setSelectedId(rule.id);
    setShowAddMenu(false);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    onChange(rules.filter((r) => r.id !== selectedId));
    setSelectedId(null);
  };

  const updateRule = (updated: NotificationRule) =>
    onChange(rules.map((r) => (r.id === updated.id ? updated : r)));

  return (
    <div className="space-y-1.5">
      {/* List box */}
      <div className="rounded-lg border border-zinc-700 overflow-hidden bg-zinc-950 min-h-[72px]">
        {rules.length === 0 ? (
          <div className="flex items-center justify-center h-[72px] text-xs text-zinc-600">
            No rules — press + to add one
          </div>
        ) : (
          rules.map((rule, i) => (
            <button
              key={rule.id}
              onClick={() => setSelectedId(selectedId === rule.id ? null : rule.id)}
              className={`w-full px-3 py-2 text-left text-xs transition-colors ${
                i < rules.length - 1 ? "border-b border-zinc-800" : ""
              } ${
                selectedId === rule.id
                  ? "bg-amber-600/10 text-amber-400"
                  : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
              }`}
            >
              {formatRule(rule)}
            </button>
          ))
        )}
      </div>

      {/* + / − controls */}
      <div className="relative" ref={menuRef}>
        <div className="inline-flex border border-zinc-700 rounded-md overflow-hidden">
          <button
            onClick={() => setShowAddMenu((v) => !v)}
            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors border-r border-zinc-700 text-base leading-none"
          >
            +
          </button>
          <button
            onClick={removeSelected}
            disabled={!selectedId}
            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors text-base leading-none disabled:opacity-30 disabled:pointer-events-none"
          >
            −
          </button>
        </div>

        {/* Add dropdown */}
        {showAddMenu && (
          <div className="absolute bottom-full left-0 mb-1 bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden w-56 shadow-xl z-20">
            {RULE_TYPES.map((rt, i) => (
              <button
                key={rt.type}
                onClick={() => addRule(rt.type)}
                className={`w-full px-3 py-2.5 text-left transition-colors hover:bg-zinc-800 ${
                  i < RULE_TYPES.length - 1 ? "border-b border-zinc-800" : ""
                }`}
              >
                <p className="text-xs text-zinc-200">{rt.label}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">{rt.description}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Rule editor — shown when a rule is selected */}
      {selectedRule && <RuleEditor rule={selectedRule} onChange={updateRule} />}
    </div>
  );
}

// ── Main Settings view ───────────────────────────────────────────────────────

export default function Settings({ auth, onBack, onLogout }: Props) {
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [showPrompt, setShowPrompt] = useState(false);
  const [ntfyTesting, setNtfyTesting] = useState(false);
  const [ntfyTestOk, setNtfyTestOk] = useState(false);
  const [ntfyTestError, setNtfyTestError] = useState<string | null>(null);

  useEffect(() => {
    invoke<SettingsType>("get_settings").then((s) => {
      setSettings(s);
      setSavedSettings(s);
    });
  }, []);

  const isDirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);

  const update = (patch: Partial<SettingsType>) =>
    setSettings((s) => ({ ...s, ...patch }));

  const save = () => {
    invoke("save_settings", { settings }).catch(() => {});
    setSavedSettings(settings);
    onBack();
  };

  const handleBack = () => {
    if (isDirty) setShowPrompt(true);
    else onBack();
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
    { label: "30s", value: 30 },
    { label: "1m",  value: 60 },
    { label: "5m",  value: 300 },
    { label: "15m", value: 900 },
  ];

  return (
    <div className="relative flex flex-col h-full">
      {/* Topbar */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60 select-none shrink-0"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={handleBack}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm font-medium text-zinc-200 pointer-events-none">Settings</span>
        </div>
        <WindowControls />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-20 space-y-3">
        {/* General */}
        <Section title="General">
          <Toggle
            label="Launch at startup"
            value={settings.launch_at_startup}
            onChange={(v) => update({ launch_at_startup: v })}
          />
          <Toggle
            label="Minimize to tray on close"
            value={settings.minimize_to_tray}
            onChange={(v) => update({ minimize_to_tray: v })}
          />
        </Section>

        {/* Display */}
        <Section title="Display">
          <Toggle
            label="Always show precise timestamp"
            description="Shows exact time (e.g. 'Updated at 11:47:59 pm') instead of relative"
            value={settings.precise_timestamp}
            onChange={(v) => update({ precise_timestamp: v })}
          />
        </Section>

        {/* Notifications */}
        <Section title="Notifications">
          <RuleList
            rules={settings.notification_rules}
            onChange={(rules) => update({ notification_rules: rules })}
          />
        </Section>

        {/* ntfy */}
        <Section title="ntfy">
          <Toggle
            label="Enable ntfy"
            value={settings.ntfy_enabled}
            onChange={(v) => update({ ntfy_enabled: v })}
          />
          {settings.ntfy_enabled && (
            <>
              <Field
                label="Server"
                value={settings.ntfy_server}
                onChange={(v) => update({ ntfy_server: v })}
                placeholder="https://ntfy.sh"
              />
              <Field
                label="Topic"
                value={settings.ntfy_topic}
                onChange={(v) => update({ ntfy_topic: v })}
                placeholder="claudeometer"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500 shrink-0">Test connection</p>
                <button
                  onClick={testNtfy}
                  disabled={ntfyTesting || !settings.ntfy_server || !settings.ntfy_topic}
                  className="text-xs px-3 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  {ntfyTesting ? "Sending…" : ntfyTestOk ? "Sent ✓" : "Send test"}
                </button>
              </div>
              {ntfyTestError && (
                <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {ntfyTestError}
                </p>
              )}
              <div className="space-y-1.5">
                <p className="text-xs text-zinc-500">Rules</p>
                <RuleList
                  rules={settings.ntfy_rules}
                  onChange={(rules) => update({ ntfy_rules: rules })}
                />
              </div>
            </>
          )}
        </Section>

        {/* Sync */}
        <Section title="Sync">
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-500">Automatic poll interval</p>
            <div className="flex gap-2">
              <button
                onClick={() => update({ auto_poll: false })}
                className={`flex-1 text-xs py-1.5 rounded-md border transition-colors ${
                  !settings.auto_poll
                    ? "bg-amber-600/10 border-amber-600/40 text-amber-500"
                    : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                Off
              </button>
              {INTERVALS.map((i) => (
                <button
                  key={i.value}
                  onClick={() => update({ poll_interval_secs: i.value, auto_poll: true })}
                  className={`flex-1 text-xs py-1.5 rounded-md border transition-colors ${
                    settings.auto_poll && settings.poll_interval_secs === i.value
                      ? "bg-amber-600/10 border-amber-600/40 text-amber-500"
                      : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {i.label}
                </button>
              ))}
            </div>
          </div>
          <Toggle
            label="Refresh on focus"
            description="Fetch new data when the app window gains focus"
            value={settings.foreground_poll}
            onChange={(v) => update({ foreground_poll: v })}
          />
        </Section>

        {/* Account */}
        <Section title="Account">
          <div className="space-y-0.5">
            {auth.name && (
              <p className="text-sm font-medium text-zinc-200">{auth.name}</p>
            )}
            {auth.email ? (
              <p className={auth.name ? "text-xs text-zinc-500" : "text-sm text-zinc-300"}>
                {auth.email}
              </p>
            ) : (
              !auth.name && (
                <p className="text-sm text-zinc-400">
                  {auth.mode === "api_key" ? "API Key" : "Session key"}
                </p>
              )
            )}
          </div>
          <button
            onClick={onLogout}
            className="w-full text-sm text-red-400 hover:text-red-300 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 rounded-lg py-2 transition-colors"
          >
            Sign out
          </button>
        </Section>
      </div>

      {/* Floating save */}
      <button
        onClick={save}
        className="absolute bottom-4 left-4 text-sm font-medium text-white bg-amber-600 hover:bg-amber-500 px-6 py-2.5 rounded-full transition-colors"
      >
        Save
      </button>

      {/* Unsaved-changes prompt */}
      {showPrompt && (
        <div className="absolute inset-0 bg-[#111111]/70 backdrop-blur-sm flex items-center justify-center px-6 z-10">
          <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">Unsaved changes</p>
              <p className="text-xs text-zinc-500 mt-1">Leave without saving?</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowPrompt(false)}
                className="flex-1 text-xs py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Keep editing
              </button>
              <button
                onClick={onBack}
                className="flex-1 text-xs py-2 rounded-lg text-red-400 hover:text-red-300 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 transition-colors"
              >
                Discard
              </button>
              <button
                onClick={save}
                className="flex-1 text-xs py-2 rounded-lg text-white bg-amber-600 hover:bg-amber-500 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
