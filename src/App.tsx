import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AuthState, Settings, UsageData, DEFAULT_SETTINGS } from "./lib/types";
import Login from "./views/Login";
import Dashboard from "./views/Dashboard";
import Settings_ from "./views/Settings";

type View = "login" | "dashboard" | "settings";

const COOLDOWN_MS = 20_000;

export default function App() {
  const [view, setView] = useState<View>("login");
  const [auth, setAuth] = useState<AuthState>({ mode: "none", email: null, name: null });
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cooldownEndsAt, setCooldownEndsAt] = useState<number | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const refreshingRef = useRef(false);
  const cooldownUntilRef = useRef<number>(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so doRefresh and the focus handler always see the current value without stale closures
  const errorRef = useRef<string | null>(null);
  const foregroundPollRef = useRef<boolean>(true);

  const updateError = (e: string | null) => {
    errorRef.current = e;
    setError(e);
  };

  useEffect(() => {
    invoke<AuthState>("get_auth_state").then((state) => {
      setAuth(state);
      setView(state.mode === "none" ? "login" : "dashboard");
      setLoading(false);
    });
    invoke<Settings>("get_settings").then((s) => {
      setSettings(s);
      foregroundPollRef.current = s.foreground_poll ?? true;
    }).catch(() => {});
  }, []);

  // Keep foregroundPollRef in sync when settings change
  useEffect(() => {
    foregroundPollRef.current = settings.foreground_poll ?? true;
  }, [settings.foreground_poll]);

  // Background-poll events
  useEffect(() => {
    const unlistenUsage = listen<UsageData>("usage-updated", (e) => {
      setUsage(e.payload);
      updateError(null);
      // Keep auth name/email current from API response
      if (e.payload.name || e.payload.email) {
        setAuth((prev) => ({
          ...prev,
          name: e.payload.name ?? prev.name,
          email: e.payload.email ?? prev.email,
        }));
      }
    });
    const unlistenError = listen<string>("usage-error", (e) => {
      updateError(e.payload);
    });
    return () => {
      unlistenUsage.then((f) => f());
      unlistenError.then((f) => f());
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh when the window comes into focus
  useEffect(() => {
    if (auth.mode === "none") return;
    let cleanup: (() => void) | undefined;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused && !refreshingRef.current && foregroundPollRef.current) {
          doRefresh();
        }
      })
      .then((unlisten) => { cleanup = unlisten; });
    return () => cleanup?.();
  }, [auth.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const doRefresh = async () => {
    if (refreshingRef.current) return;
    // Cooldown is bypassed when there is a current error so the user can retry immediately
    if (!errorRef.current && Date.now() < cooldownUntilRef.current) return;

    refreshingRef.current = true;
    setIsRefreshing(true);
    try {
      const d = await invoke<UsageData>("fetch_usage");
      setUsage(d);
      updateError(null);
      // Keep auth name/email current from the API response
      if (d.name || d.email) {
        setAuth((prev) => ({
          ...prev,
          name: d.name ?? prev.name,
          email: d.email ?? prev.email,
        }));
      }
    } catch (e) {
      updateError(String(e));
    } finally {
      setIsRefreshing(false);
      refreshingRef.current = false;
      // Only apply cooldown after a successful fetch (not after errors, so retries are fast)
      if (!errorRef.current) {
        if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
        const endsAt = Date.now() + COOLDOWN_MS;
        cooldownUntilRef.current = endsAt;
        setCooldownEndsAt(endsAt);
        cooldownTimerRef.current = setTimeout(() => {
          cooldownUntilRef.current = 0;
          setCooldownEndsAt(null);
        }, COOLDOWN_MS);
      }
    }
  };

  const handleLogin = (state: AuthState) => {
    setAuth(state);
    setView("dashboard");
    doRefresh();
  };

  const handleLogout = async () => {
    await invoke("logout");
    setAuth({ mode: "none", email: null, name: null });
    setUsage(null);
    updateError(null);
    setView("login");
  };

  const handleBackFromSettings = () => {
    invoke<Settings>("get_settings").then((s) => {
      setSettings(s);
      foregroundPollRef.current = s.foreground_poll ?? true;
    }).catch(() => {});
    setView("dashboard");
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#111111] border border-zinc-800/80">
        <div className="h-4 w-4 rounded-full bg-amber-600 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#111111] flex flex-col border border-zinc-800/80 overflow-hidden">
      {view === "login" && <Login onLogin={handleLogin} />}
      {view === "dashboard" && (
        <Dashboard
          usage={usage}
          error={error}
          isRefreshing={isRefreshing}
          cooldownEndsAt={cooldownEndsAt}
          preciseTimestamp={settings.precise_timestamp}
          onSettings={() => setView("settings")}
          onRefresh={doRefresh}
        />
      )}
      {view === "settings" && (
        <Settings_
          auth={auth}
          onBack={handleBackFromSettings}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
