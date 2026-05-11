import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AuthState, Settings as SettingsType, DEFAULT_SETTINGS } from "../lib/types";
import WindowControls from "../components/WindowControls";

interface Props {
  auth: AuthState;
  onBack: () => void;
  onLogout: () => void;
}

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
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm text-zinc-200">{label}</p>
        {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
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

export default function Settings({ auth, onBack, onLogout }: Props) {
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    invoke<SettingsType>("get_settings").then(setSettings);
  }, []);

  const update = (patch: Partial<SettingsType>) =>
    setSettings((s) => ({ ...s, ...patch }));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await invoke("save_settings", { settings });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const INTERVALS = [
    { label: "30s", value: 30 },
    { label: "1m", value: 60 },
    { label: "5m", value: 300 },
    { label: "15m", value: 900 },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Topbar — drag region */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60 select-none"
      >
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
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

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
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

        <Section title="Notifications">
          <Toggle
            label="Desktop notifications"
            value={settings.desktop_notifications}
            onChange={(v) => update({ desktop_notifications: v })}
          />
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-500">Notify when above</label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={settings.notification_threshold}
                onChange={(e) => update({ notification_threshold: Number(e.target.value) })}
                className="flex-1 accent-amber-600"
              />
              <span className="text-sm text-zinc-300 tabular-nums w-8 text-right">
                {settings.notification_threshold}%
              </span>
            </div>
          </div>
          <Toggle
            label="ntfy notifications"
            description="Push alerts to any device via ntfy.sh or self-hosted"
            value={settings.ntfy_enabled}
            onChange={(v) => update({ ntfy_enabled: v })}
          />
          {settings.ntfy_enabled && (
            <div className="space-y-3 pt-1">
              <Field
                label="ntfy server"
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
            </div>
          )}
        </Section>

        <Section title="Sync">
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-500">Poll interval</p>
            <div className="flex gap-2">
              {INTERVALS.map((i) => (
                <button
                  key={i.value}
                  onClick={() => update({ poll_interval_secs: i.value })}
                  className={`flex-1 text-xs py-1.5 rounded-md border transition-colors ${
                    settings.poll_interval_secs === i.value
                      ? "bg-amber-600/10 border-amber-600/40 text-amber-500"
                      : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {i.label}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Account">
          <div>
            <p className="text-xs text-zinc-500">Signed in as</p>
            <p className="text-sm text-zinc-300 mt-0.5">
              {auth.email ?? (auth.mode === "api_key" ? "API Key" : "—")}
            </p>
          </div>
          <button
            onClick={onLogout}
            className="w-full text-sm text-red-400 hover:text-red-300 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 rounded-lg py-2 transition-colors"
          >
            Sign out
          </button>
        </Section>
      </div>

      {/* Save bar */}
      <div className="px-5 py-4 border-t border-zinc-800/60 space-y-2">
        {saveError && (
          <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {saveError}
          </p>
        )}
        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
        >
          {saved ? "Saved ✓" : saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}
