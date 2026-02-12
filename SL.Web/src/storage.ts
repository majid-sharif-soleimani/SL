import { AppSettings, LineConfig } from "./types";

const SETTINGS_KEY = "sl_tracker_settings_v1";

export function loadSettings(): AppSettings | null {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    if (!parsed.apiKey || !parsed.timeWindowMinutes || !Array.isArray(parsed.lines)) {
      return null;
    }

    const lines = parsed.lines
      .map(normalizeLine)
      .filter((line): line is LineConfig => line !== null);

    if (lines.length === 0) return null;

    return {
      apiKey: parsed.apiKey.trim(),
      timeWindowMinutes: Number(parsed.timeWindowMinutes),
      lines
    };
  } catch {
    return null;
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function normalizeLine(raw: unknown): LineConfig | null {
  if (!raw || typeof raw !== "object") return null;

  const obj = raw as Partial<LineConfig>;
  const stopGroupSearchName = obj.stopGroupSearchName?.trim() ?? "";
  const lineNumber = obj.lineNumber?.trim() ?? "";
  const origin = obj.origin?.trim() ?? "";
  const destination = obj.destination?.trim() ?? "";

  if (!stopGroupSearchName || !lineNumber || !origin || !destination) {
    return null;
  }

  return {
    stopGroupSearchName,
    lineNumber,
    origin,
    destination
  };
}
