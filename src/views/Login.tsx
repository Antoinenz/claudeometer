import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { AuthState } from "../lib/types";
import WindowControls from "../components/WindowControls";

type Mode = "session" | "api";

interface Props {
  onLogin: (auth: AuthState) => void;
}

export default function Login({ onLogin }: Props) {
  const [mode, setMode] = useState<Mode>("session");
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const auth = await invoke<AuthState>(
        mode === "session" ? "save_session_key" : "save_api_key",
        { key: trimmed }
      );
      onLogin(auth);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Drag region */}
      <div
        data-tauri-drag-region
        className="flex items-center justify-end px-3 py-2 select-none"
      >
        <WindowControls />
      </div>

      <div className="flex-1 flex flex-col px-6 pb-8 overflow-y-auto">
        {/* Header */}
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-amber-600/10 border border-amber-600/20 mb-4">
            <span className="text-2xl text-amber-500">⊙</span>
          </div>
          <h1 className="text-xl font-semibold text-zinc-100">Claudeometer</h1>
          <p className="text-sm text-zinc-500 mt-1">Monitor your Claude usage limits</p>
        </div>

        {/* Mode tabs */}
        <div className="flex rounded-lg bg-zinc-900 border border-zinc-800 p-1 mb-5 gap-1">
          {(["session", "api"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); setKey(""); }}
              className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${
                mode === m
                  ? "bg-zinc-700 text-zinc-100 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {m === "session" ? "Claude.ai" : "API Key"}
            </button>
          ))}
        </div>

        {/* Instructions */}
        {mode === "session" ? (
          <div className="space-y-3 mb-5">
            <p className="text-xs text-zinc-500 leading-relaxed">
              Paste your <code className="text-amber-500 bg-zinc-900 px-1 rounded">sessionKey</code> cookie
              from Claude.ai. It stays local and is only used to query your usage.
            </p>
            <div className="rounded-lg bg-zinc-900 border border-zinc-800 divide-y divide-zinc-800/60">
              {[
                <>Open <button onClick={() => openUrl("https://claude.ai")} className="text-amber-500 hover:underline">claude.ai</button> and sign in</>,
                "Open DevTools → Application → Cookies",
                <>Copy the value of <code className="text-amber-500">sessionKey</code></>,
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-3 px-3 py-2.5">
                  <span className="text-xs text-zinc-600 font-mono mt-px tabular-nums">{i + 1}</span>
                  <span className="text-xs text-zinc-400">{step}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-5">
            <p className="text-xs text-zinc-500 leading-relaxed">
              Enter your Anthropic API key. Usage limits aren't available via API — use a
              Claude.ai session key for full limit tracking.
            </p>
          </div>
        )}

        {/* Key input + connect */}
        <div className="space-y-3">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            placeholder={mode === "session" ? "sk-ant-sid01-..." : "sk-ant-api03-..."}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-600/50 font-mono"
            autoFocus
          />

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleConnect}
            disabled={loading || !key.trim()}
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
          >
            {loading ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
