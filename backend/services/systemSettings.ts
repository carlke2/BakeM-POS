import fs from 'fs';
import path from 'path';

export type SystemSettings = {
  /** When true, no Advanta SMS is sent system-wide. */
  smsDisabled: boolean;
};

const DEFAULTS: SystemSettings = {
  smsDisabled: false,
};

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'system-settings.json');

let cache: SystemSettings | null = null;

function readFromDisk(): SystemSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SystemSettings>;
    return {
      smsDisabled: Boolean(parsed.smsDisabled),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getSystemSettings(): SystemSettings {
  if (!cache) cache = readFromDisk();
  return { ...cache };
}

export function setSystemSettings(patch: Partial<SystemSettings>): SystemSettings {
  const next: SystemSettings = {
    ...getSystemSettings(),
    ...patch,
  };
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
  cache = next;
  return { ...next };
}

export function isSmsGloballyDisabled(): boolean {
  return getSystemSettings().smsDisabled === true;
}
