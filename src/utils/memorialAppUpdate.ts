/**
 * Digital Memorial: remote updates of the kiosk app. The display page passes on the release the server publishes
 * ({type:'KIOSK_APP_UPDATE', versionCode, url, sha256}); MemorialUpdateModule (native) downloads, checks and installs
 * it silently. The page also asks {type:'KIOSK_HELLO'} and gets back the installed version and the last update
 * result (window.__dmKioskInfo), which it reports in its heartbeat so the panel can show it.
 */
import { NativeModules } from 'react-native';

export interface AppUpdate {
  versionCode: number;
  url: string;
  sha256: string;
}

export interface KioskInfo {
  versionCode: number | null;
  versionName: string | null;
  lastUpdate: { versionCode: number; result: string; at: number } | null;
}

interface NativeUpdater {
  versionCode?: number;
  versionName?: string;
  install(url: string, sha256: string, versionCode: number): Promise<string>;
  getConstants?: () => { versionCode?: number; versionName?: string };
}

/** After a failed attempt, the same version is retried at most this often. */
export const UPDATE_RETRY_MS = 6 * 60 * 60 * 1000;
/** An install that never finished (the app was not replaced) is tried again after this long. */
export const INSTALL_WAIT_MS = 30 * 60 * 1000;

let lastUpdate: KioskInfo['lastUpdate'] = null;

/** Only for tests. */
export function resetAppUpdateState(): void {
  lastUpdate = null;
}

export function parseAppUpdateMessage(data: unknown): AppUpdate | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.type !== 'KIOSK_APP_UPDATE') return null;
  const { versionCode, url, sha256 } = m;
  if (typeof versionCode !== 'number' || !Number.isInteger(versionCode) || versionCode <= 0) return null;
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) return null;
  return { versionCode, url, sha256 };
}

const updater = (): NativeUpdater | undefined => NativeModules.MemorialUpdateModule;

function installed(native: NativeUpdater | undefined) {
  const constants = native?.getConstants?.() ?? native;
  return {
    versionCode: typeof constants?.versionCode === 'number' ? constants.versionCode : null,
    versionName: typeof constants?.versionName === 'string' ? constants.versionName : null,
  };
}

export function kioskInfo(native: NativeUpdater | undefined = updater()): KioskInfo {
  return { ...installed(native), lastUpdate };
}

/** Installs the update if it is newer and was not tried (and failed) recently. */
export async function applyAppUpdate(
  update: AppUpdate,
  native: NativeUpdater | undefined = updater(),
  now: number = Date.now(),
): Promise<void> {
  if (!native) return;
  const current = installed(native).versionCode;
  if (current !== null && update.versionCode <= current) return;
  if (lastUpdate && lastUpdate.versionCode === update.versionCode) {
    const pending = lastUpdate.result === 'downloading' || lastUpdate.result === 'installing';
    if (now - lastUpdate.at < (pending ? INSTALL_WAIT_MS : UPDATE_RETRY_MS)) return;
  }
  lastUpdate = { versionCode: update.versionCode, result: 'downloading', at: now };
  try {
    const result = await native.install(update.url, update.sha256, update.versionCode);
    lastUpdate = { versionCode: update.versionCode, result, at: now };
  } catch (e: any) {
    lastUpdate = { versionCode: update.versionCode, result: `failed: ${e?.message ?? e}`.slice(0, 200), at: now };
  }
}
