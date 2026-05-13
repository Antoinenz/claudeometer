import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import TrayMenu from "./views/TrayMenu";
import "./index.css";

// The same JS bundle is loaded into every window. The URL fragment tells us
// which surface this instance should render (e.g. #tray-menu-down, #tray-menu-up).
const isTrayMenu = window.location.hash.startsWith("#tray-menu");

if (isTrayMenu) {
  // The tray-menu window is OS-transparent; clear the body's dark fill so the
  // tooltip can have its own rounded shape with shadow.
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
}

// ── Strip webview tells ──────────────────────────────────────────────────────

// No right-click context menu
document.addEventListener("contextmenu", (e) => e.preventDefault());


// Mutable flags — updated at runtime by App when settings load/change.
const debugFlags = { devtools: false, webviewReload: false };
export function applyDebugFlags(flags: { devtools: boolean; webviewReload: boolean }) {
  debugFlags.devtools = flags.devtools;
  debugFlags.webviewReload = flags.webviewReload;
}

// Block browser-default keyboard shortcuts that don't belong in a native app.
document.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;

  const blocked =
    (!debugFlags.devtools    && e.key === "F12") ||
    (!debugFlags.devtools    && ctrl && e.shiftKey && (e.key === "I" || e.key === "J")) ||
    e.key === "F5"                                ||  // hard reload — always blocked
    (ctrl && e.key === "r" && !e.shiftKey)        ||  // Ctrl+R → handled by App as refresh
    (!debugFlags.webviewReload && ctrl && e.shiftKey && e.key === "R") ||
    (ctrl && e.key === "p")  ||
    (ctrl && e.key === "s")  ||
    (ctrl && e.key === "u")  ||
    (ctrl && e.key === "f")  ||
    (ctrl && e.key === "g")  ||
    (ctrl && e.key === "j")  ||
    (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight"));

  if (blocked) e.preventDefault();
}, { capture: true });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isTrayMenu ? <TrayMenu /> : <App />}
  </React.StrictMode>
);
