// User preferences (persisted in localStorage, per device).
export interface Preferences {
  theme: string;
  appearance: "auto" | "light" | "dark";
  fontSize: number;
  lineWidth: "narrow" | "normal" | "wide" | "full";
  lineHeight: number;
  autoSave: boolean;
  restoreSession: boolean;
  spellcheck: boolean;
  autoPairBrackets: boolean;
  autoPairMarkdown: boolean;
  tabSize: 2 | 4;
  focusMode: boolean;
  typewriterMode: boolean;
  showStatusBar: boolean;
  showFormatBar: "auto" | "always" | "never";
  sidebarVisible: boolean;
  sidebarTab: "files" | "outline" | "search";
  fileSort: "name" | "modified" | "created";
  imageInsert: "assets" | "filename-assets" | "custom" | "data-uri";
  imageFolder: string;
  readingSpeed: number;
  pdfPageSize: "A4" | "Letter" | "Legal" | "A5";
  pdfMargin: number;
  exportIncludeTheme: boolean;
  customCss: string;
}

export const defaultPreferences: Preferences = {
  theme: "github",
  appearance: "auto",
  fontSize: 16,
  lineWidth: "normal",
  lineHeight: 1.6,
  autoSave: true,
  restoreSession: true,
  spellcheck: true,
  autoPairBrackets: true,
  autoPairMarkdown: true,
  tabSize: 4,
  focusMode: false,
  typewriterMode: false,
  showStatusBar: true,
  showFormatBar: "auto",
  sidebarVisible: true,
  sidebarTab: "files",
  fileSort: "name",
  imageInsert: "assets",
  imageFolder: "./assets",
  readingSpeed: 230,
  pdfPageSize: "A4",
  pdfMargin: 18,
  exportIncludeTheme: true,
  customCss: "",
};

const KEY = "typorium.preferences";

export function loadPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Preferences>;
    const merged = { ...defaultPreferences };
    for (const key of Object.keys(defaultPreferences) as (keyof Preferences)[]) {
      if (saved[key] !== undefined && typeof saved[key] === typeof defaultPreferences[key]) (merged as Record<string, unknown>)[key] = saved[key];
    }
    return merged;
  } catch { return { ...defaultPreferences }; }
}

export function savePreferences(preferences: Preferences) {
  try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* storage unavailable */ }
}
