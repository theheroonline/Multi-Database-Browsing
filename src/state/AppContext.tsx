import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { loadState, saveState } from "../lib/storage";
import type { ConnectionProfile, LocalState, SecretConfig } from "../lib/types";
import { listIndices } from "../modules/es/services/client";
import type { EsConnection, IndexMeta } from "../modules/es/types";

const normalizeProfile = (profile: ConnectionProfile): ConnectionProfile => ({
  ...profile,
  engine: profile.engine ?? "elasticsearch",
  ssh: {
    enabled: profile.ssh?.enabled ?? false,
    host: profile.ssh?.host ?? "",
    port: profile.ssh?.port ?? 22,
    username: profile.ssh?.username ?? ""
  }
});

interface AppContextValue {
  state: LocalState;
  activeConnectionId?: string;
  saveConnection: (profile: ConnectionProfile, secret: SecretConfig) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  setActiveConnection: (id: string) => Promise<void>;
  disconnectActiveConnection: () => Promise<void>;
  addHistory: (title: string, sql: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  activeConnection: EsConnection | null;
  getActiveConnection: () => EsConnection | null;
  getConnectionById: (id: string) => EsConnection | null;
  indices: string[];
  indicesMeta: IndexMeta[];
  refreshIndices: (connection?: EsConnection | null) => Promise<void>;
  selectedIndex: string | undefined;
  setSelectedIndex: (index: string | undefined) => void;
}

const defaultState: LocalState = {
  profiles: [],
  secrets: {},
  history: []
};

const isSystemIndex = (name: string) => name.startsWith(".");

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LocalState>(defaultState);
  const [connectedConnectionId, setConnectedConnectionId] = useState<string | undefined>(undefined);
  const [selectedIndex, setSelectedIndexState] = useState<string | undefined>(undefined);
  const [indices, setIndices] = useState<string[]>([]);
  const [indicesMeta, setIndicesMeta] = useState<IndexMeta[]>([]);
  const [indicesCacheByConnection, setIndicesCacheByConnection] = useState<Record<string, { indices: string[]; indicesMeta: IndexMeta[] }>>({});
  const [stateLoaded, setStateLoaded] = useState(false);

  useEffect(() => {
    loadState().then((loaded) => {
      const normalizedProfiles = (loaded.profiles ?? [])
        .map((item) => normalizeProfile(item))
        .filter((item) => (item.engine ?? "elasticsearch") === "elasticsearch");
      const lastConnectionId = normalizedProfiles.some((item) => item.id === loaded.lastConnectionId)
        ? loaded.lastConnectionId
        : normalizedProfiles[0]?.id;

      setState({
        ...loaded,
        profiles: normalizedProfiles,
        lastConnectionId
      });
      setStateLoaded(true);
    });
  }, []);

  const persist = useCallback(async (nextState: LocalState) => {
    await saveState(nextState);
    setState(nextState);
  }, []);

  const saveConnection = useCallback(async (profile: ConnectionProfile, secret: SecretConfig) => {
    const profiles = [...state.profiles];
    const index = profiles.findIndex((item) => item.id === profile.id);
    const normalizedProfile = normalizeProfile(profile);
    if (index >= 0) {
      profiles[index] = normalizedProfile;
    } else {
      profiles.push(normalizedProfile);
    }
    const nextState: LocalState = {
      ...state,
      profiles,
      secrets: {
        ...state.secrets,
        [profile.id]: secret
      },
      lastConnectionId: normalizedProfile.id
    };
    await persist(nextState);
  }, [state, persist]);

  const deleteConnection = useCallback(async (id: string) => {
    const profiles = state.profiles.filter((item) => item.id !== id);
    const secrets = { ...state.secrets };
    delete secrets[id];
    const nextState: LocalState = {
      ...state,
      profiles,
      secrets,
      lastConnectionId: state.lastConnectionId === id ? profiles[0]?.id : state.lastConnectionId
    };
    if (connectedConnectionId === id) {
      setConnectedConnectionId(undefined);
    }
    setIndicesCacheByConnection((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await persist(nextState);
  }, [state, persist, connectedConnectionId]);

  const setActiveConnection = useCallback(async (id: string) => {
    setConnectedConnectionId(id);
    const cached = indicesCacheByConnection[id];
    if (cached) {
      setIndices(cached.indices);
      setIndicesMeta(cached.indicesMeta);
    } else {
      setIndices([]);
      setIndicesMeta([]);
    }
    await persist({ ...state, lastConnectionId: id });
  }, [state, persist, indicesCacheByConnection]);

  const disconnectActiveConnection = useCallback(async () => {
    setConnectedConnectionId(undefined);
    setSelectedIndexState(undefined);
  }, []);

  const setSelectedIndex = useCallback((index: string | undefined) => {
    setSelectedIndexState(index);
  }, []);

  const addHistory = useCallback(async (title: string, sql: string) => {
    const trimmedSql = sql.trim();
    if (!trimmedSql) return; // 不记录空 SQL

    // 规范化 SQL：移除末尾分号、压缩空白并转小写，用于去重比较
    const normalize = (s: string) => s.replace(/\s*;+\s*$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    const normalizedNew = normalize(trimmedSql);

    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title,
      sql: trimmedSql,
      createdAt: new Date().toISOString()
    };

    const HISTORY_LIMIT = 10;
    // 去重：移除已有相同（规范化后）SQL 的历史项（保留最近一次）
    const filtered = state.history.filter((h) => normalize(h.sql || '') !== normalizedNew);
    const nextState: LocalState = {
      ...state,
      history: [item, ...filtered].slice(0, HISTORY_LIMIT)
    };
    await persist(nextState);
  }, [state, persist]);

  const clearHistory = useCallback(async () => {
    await persist({ ...state, history: [] });
  }, [state, persist]);

  const getActiveConnection = useCallback((): EsConnection | null => {
    const id = connectedConnectionId;
    if (!id) return null;
    const profile = state.profiles.find((item) => item.id === id);
    if (!profile) return null;
    const secret = state.secrets[id] ?? {};
    return {
      ...normalizeProfile(profile),
      username: secret.username,
      password: secret.password,
      apiKey: secret.apiKey,
      sshPassword: secret.sshPassword
    };
  }, [state, connectedConnectionId]);

  const getConnectionById = useCallback((id: string): EsConnection | null => {
    const profile = state.profiles.find((item) => item.id === id);
    if (!profile) return null;
    const secret = state.secrets[id] ?? {};
    return {
      ...normalizeProfile(profile),
      username: secret.username,
      password: secret.password,
      apiKey: secret.apiKey,
      sshPassword: secret.sshPassword
    };
  }, [state]);



  const refreshIndices = useCallback(async (connection?: EsConnection | null) => {
    const target = connection ?? getActiveConnection();
    if (!target) {
      setIndices([]);
      setIndicesMeta([]);
      return;
    }
    if ((target.engine ?? "elasticsearch") !== "elasticsearch") {
      setIndices([]);
      setIndicesMeta([]);
      return;
    }
    try {
      const data = await listIndices(target);
      const mapped: IndexMeta[] = data
        .map((item) => ({
          index: item.index,
          health: item.health,
          docsCount: item["docs.count"] ?? (item as { docsCount?: string }).docsCount
        }))
        .filter((item) => !isSystemIndex(item.index));
      const nextIndices = mapped.map((item) => item.index);

      setIndices(nextIndices);
      setIndicesMeta(mapped);
      setIndicesCacheByConnection((prev) => ({
        ...prev,
        [target.id]: {
          indices: nextIndices,
          indicesMeta: mapped
        }
      }));

      setSelectedIndexState((prev) => {
        if (prev && !nextIndices.includes(prev)) return undefined;
        return prev;
      });
    } catch {
      setIndices([]);
      setIndicesMeta([]);
    }
  }, [getActiveConnection]);

  const activeConnection = useMemo(() => getActiveConnection(), [getActiveConnection]);

  useEffect(() => {
    if (!connectedConnectionId) return;
    const exists = state.profiles.some((item) => item.id === connectedConnectionId);
    if (!exists) {
      setConnectedConnectionId(undefined);
      setIndices([]);
      setIndicesMeta([]);
    }
  }, [connectedConnectionId, state.profiles]);

  useEffect(() => {
    if (!stateLoaded) return;
    if (!activeConnection) return;
    if ((activeConnection.engine ?? "elasticsearch") !== "elasticsearch") {
      setIndices([]);
      setIndicesMeta([]);
    }
  }, [activeConnection?.id, activeConnection?.engine, stateLoaded]);

  const value = useMemo(() => ({
    state,
    activeConnectionId: connectedConnectionId,
    saveConnection,
    deleteConnection,
    setActiveConnection,
    disconnectActiveConnection,
    addHistory,
    clearHistory,
    activeConnection,
    getActiveConnection,
    getConnectionById,
    indices,
    indicesMeta,
    refreshIndices,
    selectedIndex,
    setSelectedIndex
  }), [state, connectedConnectionId, saveConnection, deleteConnection, setActiveConnection, disconnectActiveConnection, addHistory, clearHistory, activeConnection, getActiveConnection, getConnectionById, indices, indicesMeta, refreshIndices, selectedIndex, setSelectedIndex]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("AppContext 未初始化");
  }
  return ctx;
}
