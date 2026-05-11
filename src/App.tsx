import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AuthState, UsageData } from "./lib/types";
import Login from "./views/Login";
import Dashboard from "./views/Dashboard";
import Settings from "./views/Settings";

type View = "login" | "dashboard" | "settings";

export default function App() {
  const [view, setView] = useState<View>("login");
  const [auth, setAuth] = useState<AuthState>({ mode: "none", email: null });
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<AuthState>("get_auth_state").then((state) => {
      setAuth(state);
      setView(state.mode === "none" ? "login" : "dashboard");
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const unlistenUsage = listen<UsageData>("usage-updated", (e) => {
      setUsage(e.payload);
      setError(null);
    });
    const unlistenError = listen<string>("usage-error", (e) => {
      setError(e.payload);
    });
    return () => {
      unlistenUsage.then((f) => f());
      unlistenError.then((f) => f());
    };
  }, []);

  const handleLogin = (state: AuthState) => {
    setAuth(state);
    setView("dashboard");
    // Trigger an immediate fetch
    invoke<UsageData>("fetch_usage")
      .then(setUsage)
      .catch((e) => setError(String(e)));
  };

  const handleLogout = async () => {
    await invoke("logout");
    setAuth({ mode: "none", email: null });
    setUsage(null);
    setError(null);
    setView("login");
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#111111]">
        <div className="h-4 w-4 rounded-full bg-amber-600 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#111111] flex flex-col border border-zinc-800/80 overflow-hidden">
      {view === "login" && <Login onLogin={handleLogin} />}
      {view === "dashboard" && (
        <Dashboard
          auth={auth}
          usage={usage}
          error={error}
          onSettings={() => setView("settings")}
          onRefresh={() =>
            invoke<UsageData>("fetch_usage")
              .then((d) => { setUsage(d); setError(null); })
              .catch((e) => setError(String(e)))
          }
        />
      )}
      {view === "settings" && (
        <Settings
          auth={auth}
          onBack={() => setView("dashboard")}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
