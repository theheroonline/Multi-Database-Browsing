import type { Dispatch, ReactNode, SetStateAction } from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { RedisConnection, RedisDatabaseInfo, RedisKeyDetail, RedisKeySummary } from "../modules/redis/types";
import { useAppContext } from "./AppContext";

interface RedisContextValue {
  activeRedisConnection: RedisConnection | null;
  databases: RedisDatabaseInfo[];
  setDatabases: (databases: RedisDatabaseInfo[]) => void;
  selectedDatabase: number | null;
  setSelectedDatabase: (database: number | null) => void;
  keyPattern: string;
  setKeyPattern: (pattern: string) => void;
  scannedKeys: RedisKeySummary[];
  setScannedKeys: Dispatch<SetStateAction<RedisKeySummary[]>>;
  nextCursor: string;
  setNextCursor: (cursor: string) => void;
  hasMoreKeys: boolean;
  setHasMoreKeys: (hasMore: boolean) => void;
  selectedKey: string | null;
  setSelectedKey: (key: string | null) => void;
  selectedKeyDetail: RedisKeyDetail | null;
  setSelectedKeyDetail: (detail: RedisKeyDetail | null) => void;
  getRedisConnectionById: (id: string) => RedisConnection | null;
  resetRedisWorkspace: () => void;
}

const RedisContext = createContext<RedisContextValue | null>(null);

export function RedisProvider({ children }: { children: ReactNode }) {
  const { state, activeConnectionId } = useAppContext();
  const [databases, setDatabases] = useState<RedisDatabaseInfo[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<number | null>(null);
  const [keyPattern, setKeyPattern] = useState("*");
  const [scannedKeys, setScannedKeys] = useState<RedisKeySummary[]>([]);
  const [nextCursor, setNextCursor] = useState("0");
  const [hasMoreKeys, setHasMoreKeys] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedKeyDetail, setSelectedKeyDetail] = useState<RedisKeyDetail | null>(null);

  const getRedisConnectionById = useCallback(
    (id: string): RedisConnection | null => {
      const profile = state.profiles.find((item) => item.id === id);
      if (!profile || profile.engine !== "redis") {
        return null;
      }

      const secret = state.secrets[id] ?? {};
      return {
        id: profile.id,
        name: profile.name,
        engine: profile.engine,
        host: profile.redisHost ?? "127.0.0.1",
        port: profile.redisPort ?? 6379,
        database: profile.redisDatabase ?? 0,
        username: secret.username,
        password: secret.password,
      };
    },
    [state]
  );

  const activeRedisConnection = useMemo(() => {
    if (!activeConnectionId) {
      return null;
    }

    return getRedisConnectionById(activeConnectionId);
  }, [activeConnectionId, getRedisConnectionById]);

  const resetRedisWorkspace = useCallback(() => {
    setDatabases([]);
    setSelectedDatabase(null);
    setKeyPattern("*");
    setScannedKeys([]);
    setNextCursor("0");
    setHasMoreKeys(false);
    setSelectedKey(null);
    setSelectedKeyDetail(null);
  }, []);

  const value = useMemo(
    () => ({
      activeRedisConnection,
      databases,
      setDatabases,
      selectedDatabase,
      setSelectedDatabase,
      keyPattern,
      setKeyPattern,
      scannedKeys,
      setScannedKeys,
      nextCursor,
      setNextCursor,
      hasMoreKeys,
      setHasMoreKeys,
      selectedKey,
      setSelectedKey,
      selectedKeyDetail,
      setSelectedKeyDetail,
      getRedisConnectionById,
      resetRedisWorkspace,
    }),
    [
      activeRedisConnection,
      databases,
      selectedDatabase,
      keyPattern,
      scannedKeys,
      nextCursor,
      hasMoreKeys,
      selectedKey,
      selectedKeyDetail,
      getRedisConnectionById,
      resetRedisWorkspace,
    ]
  );

  return <RedisContext.Provider value={value}>{children}</RedisContext.Provider>;
}

export function useRedisContext() {
  const context = useContext(RedisContext);
  if (!context) {
    throw new Error("RedisContext not initialized");
  }

  return context;
}