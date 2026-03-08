import { logError } from "./errorLog";
import type { LocalState } from "./types";

const STORAGE_KEY = "multi-database-browsing.state";
const CONFIG_FILE = "multi-database-browsing.state.json";

const defaultState: LocalState = {
  profiles: [],
  secrets: {},
  history: []
};

function isTauri() {
  return Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__);
}

async function getConfigPath() {
  if (!isTauri()) return null;
  const { appConfigDir } = await import("@tauri-apps/api/path");
  const { mkdir, exists } = await import("@tauri-apps/plugin-fs");
  const dir = await appConfigDir();
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  return `${dir}${CONFIG_FILE}`;
}

export async function loadState(): Promise<LocalState> {
  try {
    const path = await getConfigPath();
    let raw: string | null = null;
    if (path) {
      const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
      if (await exists(path)) {
        raw = await readTextFile(path);
      }
    } else {
      raw = localStorage.getItem(STORAGE_KEY);
    }

    if (!raw) {
      return { ...defaultState };
    }

    const data = JSON.parse(raw) as LocalState & { cachedIndicesByConnection?: unknown };
    const { cachedIndicesByConnection: _legacyCache, ...rest } = data;
    return { ...defaultState, ...rest };
  } catch (error) {
    logError(error, {
      source: "storage.loadState",
      message: "Failed to load persisted application state"
    });
    return { ...defaultState };
  }
}

export async function saveState(state: LocalState) {
  try {
    const path = await getConfigPath();
    const payload = JSON.stringify(state, null, 2);
    if (path) {
      const { writeTextFile } = await import("@tauri-apps/plugin-fs");
      await writeTextFile(path, payload);
    } else {
      localStorage.setItem(STORAGE_KEY, payload);
    }
  } catch (error) {
    logError(error, {
      source: "storage.saveState",
      message: "Failed to persist application state"
    });
    throw error;
  }
}
