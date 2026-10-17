// Platform detection used for shortcut labels and touch-specific UI.
const ua = navigator.userAgent;
export const isIPadOS = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
export const isIOS = /iPhone|iPod/.test(ua) || isIPadOS;
export const isMac = /Mac/.test(navigator.platform || ua) && !isIOS;
export const isApple = isMac || isIOS;
export const isTouch = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
export const isStandalone = matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Convert a CodeMirror-style key ("Mod-Shift-k") into a label for this platform. */
export function shortcutLabel(key?: string) {
  if (!key) return "";
  const parts = key.split("-").map((part, index, all) => (part === "" && index === all.length - 1 ? "-" : part)).filter(Boolean);
  const map: Record<string, string> = isApple
    ? { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Enter: "↩", Backspace: "⌫", Delete: "⌦", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "⎋" }
    : { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift", Enter: "Enter", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc" };
  const labels = parts.map(part => map[part] ?? (part.length === 1 ? part.toUpperCase() : part));
  return isApple ? labels.join("") : labels.join("+");
}
