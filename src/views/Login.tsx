import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { AuthState } from "../lib/types";
import WindowControls from "../components/WindowControls";

interface Props {
  onLogin: (auth: AuthState) => void;
}

export default function Login({ onLogin }: Props) {
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const auth = await invoke<AuthState>("save_session_key", { key: trimmed });
      onLogin(auth);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div
        data-tauri-drag-region
        className="flex items-center justify-end px-3 py-2 select-none shrink-0"
      >
        <WindowControls />
      </div>

      <div className="flex-1 flex flex-col px-6 pb-7 overflow-y-auto overscroll-y-none">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 mb-3.5">
            <img src="/icon.png" alt="" className="w-12 h-12 rounded-xl shadow-lg" draggable={false} />
          </div>
          <h1 className="text-[17px] font-semibold text-zinc-100 tracking-tight">Claudeometer</h1>
          <p className="text-[12.5px] text-zinc-500 mt-0.5">Monitor your Claude usage limits</p>
        </div>

        {/* Instructions */}
        <div className="space-y-3 mb-4">
          <p className="text-[12px] text-zinc-500 leading-relaxed">
            Paste your <code className="text-amber-500 bg-amber-500/10 px-1 rounded text-[11px] font-mono">sessionKey</code> cookie
            from Claude.ai. It stays on your device and is only used to fetch your usage.
          </p>
          <ol className="rounded-lg bg-zinc-900/70 border border-zinc-800 divide-y divide-zinc-800/80 overflow-hidden">
            {[
              <>Open <button onClick={() => openUrl("https://claude.ai")} className="text-amber-500 hover:text-amber-400 underline-offset-2 hover:underline">claude.ai</button> and sign in</>,
              <>Open <span className="text-zinc-300">DevTools → Application → Cookies</span></>,
              <>Copy the value of <code className="text-amber-500 text-[11px] font-mono">sessionKey</code></>,
            ].map((step, i) => (
              <li key={i} className="flex items-start gap-2.5 px-3 py-2">
                <span className="text-[10px] text-zinc-600 font-mono mt-[3px] tabular-nums w-3 text-right">{i + 1}</span>
                <span className="text-[12px] text-zinc-400 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* Key input + connect */}
        <div className="space-y-2.5">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            placeholder="sk-ant-sid01-..."
            className="w-full bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2 text-[12.5px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-600/50 focus:bg-zinc-900 font-mono transition-colors"
            autoFocus
          />

          {error && (
            <p className="text-[11.5px] text-red-400 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2 leading-relaxed">
              {error}
            </p>
          )}

          <button
            onClick={handleConnect}
            disabled={loading || !key.trim()}
            className="w-full bg-amber-600 hover:bg-amber-500 active:bg-amber-700 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-[13px] font-medium py-2 rounded-lg transition-colors shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]"
          >
            {loading ? "Connecting…" : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
}
