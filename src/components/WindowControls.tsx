import { getCurrentWindow } from "@tauri-apps/api/window";

interface Props {
  isFocused?: boolean;
}

// Inject pointer-events:none so :hover clears before the window hides, then
// remove it the moment the cursor re-enters the window after it's reshown.
// Using mousemove (not a timeout) means pointer-events is only restored once
// the cursor is physically inside, so Chromium evaluates hover from the real
// position instead of its stale cached one.
function clearGhostHover() {
  const s = document.createElement("style");
  s.textContent = "* { pointer-events: none !important; }";
  document.head.appendChild(s);
  window.addEventListener(
    "mousemove",
    () => { if (document.head.contains(s)) document.head.removeChild(s); },
    { once: true, capture: true },
  );
}

export default function WindowControls({ isFocused = true }: Props) {
  const win = getCurrentWindow();
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => { clearGhostHover(); win.minimize(); }}
        className={`p-1.5 flex items-center justify-center rounded-md transition-colors hover:text-zinc-200 hover:bg-zinc-800/80 ${
          isFocused ? "text-zinc-600" : "text-zinc-700"
        }`}
        title="Minimize"
      >
        <svg className="w-[13px] h-[13px]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 6h8" />
        </svg>
      </button>
      <button
        onClick={() => { clearGhostHover(); win.close(); }}
        className={`p-1.5 flex items-center justify-center rounded-md transition-colors hover:text-red-400 hover:bg-red-500/10 ${
          isFocused ? "text-zinc-600" : "text-zinc-700"
        }`}
        title="Close"
      >
        <svg className="w-[13px] h-[13px]" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2.5 2.5l7 7M2.5 9.5l7-7" />
        </svg>
      </button>
    </div>
  );
}
