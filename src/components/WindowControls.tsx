import { getCurrentWindow } from "@tauri-apps/api/window";

export default function WindowControls() {
  const win = getCurrentWindow();
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => win.minimize()}
        className="p-1.5 flex items-center justify-center rounded-md text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800/80 transition-colors"
        title="Minimize"
      >
        <svg className="w-[13px] h-[13px]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 6h8" />
        </svg>
      </button>
      <button
        onClick={() => win.close()}
        className="p-1.5 flex items-center justify-center rounded-md text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        title="Close"
      >
        <svg className="w-[13px] h-[13px]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2.5 2.5l7 7M2.5 9.5l7-7" />
        </svg>
      </button>
    </div>
  );
}
