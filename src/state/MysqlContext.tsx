import type { Dispatch, ReactNode, SetStateAction } from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { MysqlConnection } from "../modules/mysql/types";
import { useAppContext } from "./AppContext";

export type MysqlFilterOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "isNull"
  | "isNotNull"
  | "emptyString"
  | "notEmptyString";

export interface MysqlFilterConditionNode {
  id: string;
  kind: "condition";
  column: string;
  operator: MysqlFilterOperator;
  value?: string;
}

export interface MysqlFilterGroupNode {
  id: string;
  kind: "group";
  mode: "and" | "or";
  children: MysqlFilterNode[];
}

export type MysqlFilterNode = MysqlFilterConditionNode | MysqlFilterGroupNode;

export interface MysqlOpenedTable {
  database: string;
  table: string;
  view: "data" | "structure";
  filterTree?: MysqlFilterGroupNode;
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  visibleColumns?: string[];
}

export function getMysqlOpenedTableKey(database: string, table: string) {
  return `${database}::${table}`;
}

interface MysqlContextValue {
  activeMysqlConnection: MysqlConnection | null;
  databases: string[];
  setDatabases: (dbs: string[]) => void;
  tablesByDb: Record<string, string[]>;
  setTablesByDb: Dispatch<SetStateAction<Record<string, string[]>>>;
  expandedDatabase: string | null;
  setExpandedDatabase: (db: string | null) => void;
  selectedDatabase: string | undefined;
  setSelectedDatabase: (db: string | undefined) => void;
  selectedTable: string | undefined;
  setSelectedTable: (table: string | undefined) => void;
  openedTables: MysqlOpenedTable[];
  setOpenedTables: Dispatch<SetStateAction<MysqlOpenedTable[]>>;
  activeOpenedTableKey: string | null;
  setActiveOpenedTableKey: (key: string | null) => void;
  getMysqlConnectionById: (id: string) => MysqlConnection | null;
}

const MysqlContext = createContext<MysqlContextValue | null>(null);

export function MysqlProvider({ children }: { children: ReactNode }) {
  const { state, activeConnectionId } = useAppContext();
  const [databases, setDatabases] = useState<string[]>([]);
  const [tablesByDb, setTablesByDb] = useState<Record<string, string[]>>({});
  const [expandedDatabase, setExpandedDatabase] = useState<string | null>(null);
  const [selectedDatabase, setSelectedDatabase] = useState<string | undefined>();
  const [selectedTable, setSelectedTable] = useState<string | undefined>();
  const [openedTables, setOpenedTables] = useState<MysqlOpenedTable[]>([]);
  const [activeOpenedTableKey, setActiveOpenedTableKey] = useState<string | null>(null);

  const getMysqlConnectionById = useCallback(
    (id: string): MysqlConnection | null => {
      const profile = state.profiles.find((p) => p.id === id);
      if (!profile || profile.engine !== "mysql") return null;
      const secret = state.secrets[id] ?? {};
      return {
        id: profile.id,
        name: profile.name,
        engine: profile.engine,
        host: profile.mysqlHost ?? "127.0.0.1",
        port: profile.mysqlPort ?? 3306,
        database: profile.mysqlDatabase,
        username: secret.username,
        password: secret.password,
        ssh: profile.ssh,
        sshPassword: secret.sshPassword,
      };
    },
    [state]
  );

  const activeMysqlConnection = useMemo(() => {
    if (!activeConnectionId) return null;
    return getMysqlConnectionById(activeConnectionId);
  }, [activeConnectionId, getMysqlConnectionById]);

  const value = useMemo(
    () => ({
      activeMysqlConnection,
      databases,
      setDatabases,
      tablesByDb,
      setTablesByDb,
      expandedDatabase,
      setExpandedDatabase,
      selectedDatabase,
      setSelectedDatabase,
      selectedTable,
      setSelectedTable,
      openedTables,
      setOpenedTables,
      activeOpenedTableKey,
      setActiveOpenedTableKey,
      getMysqlConnectionById,
    }),
    [
      activeMysqlConnection,
      databases,
      tablesByDb,
      expandedDatabase,
      selectedDatabase,
      selectedTable,
      openedTables,
      activeOpenedTableKey,
      getMysqlConnectionById
    ]
  );

  return <MysqlContext.Provider value={value}>{children}</MysqlContext.Provider>;
}

export function useMysqlContext() {
  const ctx = useContext(MysqlContext);
  if (!ctx) throw new Error("MysqlContext not initialized");
  return ctx;
}
