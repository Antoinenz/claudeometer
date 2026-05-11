import { getCurrentWindow } from "@tauri-apps/api/window";

export default function WindowControls() {
  const win = getCurrentWindow();
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => win.minimize()}
        className="w-7 h-7 flex items-center justify-center rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        title="Minimize"
      >
        <svg className="w-3 h-2" viewBox="0 0 12 2" fill="currentColor">
          <rect width="12" height="1.5" rx="0.75" y="0.25" />
        </svg>
      </button>
      <button
        onClick={() => win.close()}
        className="w-7 h-7 flex items-center justify-center rounded text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        title="Close"
      >
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M1 1l10 10M1 11L11 1" />
        </svg>
      </button>
    </div>
  );
}
