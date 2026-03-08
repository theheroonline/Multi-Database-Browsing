import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import ErrorLogModal from "./components/ErrorLogModal";
import { logError, useErrorLog } from "./lib/errorLog";
import EsConnectionsPage from "./modules/es/pages/Connections";
import DataBrowser from "./modules/es/pages/DataBrowser";
import IndexManager from "./modules/es/pages/IndexManager";
import RestConsole from "./modules/es/pages/RestConsole";
import SqlQuery from "./modules/es/pages/SqlQuery";
import { pingCluster } from "./modules/es/services/client";
import MysqlConnectionsPage from "./modules/mysql/pages/Connections";
import MysqlSqlQuery from "./modules/mysql/pages/SqlQuery";
import MysqlTableManager from "./modules/mysql/pages/TableManager";
import { mysqlConnect, mysqlDisconnect, mysqlListDatabases, mysqlListTables, mysqlQuery } from "./modules/mysql/services/client";
import { AppProvider, useAppContext } from "./state/AppContext";
import { getMysqlOpenedTableKey, MysqlProvider, useMysqlContext } from "./state/MysqlContext";

type ConnectionStatus = "success" | "idle" | "failed";

function App() {
  return (
    <AppProvider>
      <MysqlProvider>
        <AppLayout />
      </MysqlProvider>
    </AppProvider>
  );
}

function AppLayout() {
  const { t, i18n } = useTranslation();
  const { count: errorLogCount } = useErrorLog();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    state,
    activeConnectionId,
    setActiveConnection,
    refreshIndices,
    disconnectActiveConnection,
    deleteConnection,
    getConnectionById
  } = useAppContext();

  const {
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
    getMysqlConnectionById
  } = useMysqlContext();

  const esProfiles = useMemo(
    () => state.profiles.filter((item) => (item.engine ?? "elasticsearch") === "elasticsearch"),
    [state.profiles]
  );
  const mysqlProfiles = useMemo(
    () => state.profiles.filter((item) => item.engine === "mysql"),
    [state.profiles]
  );
  const allProfiles = useMemo(() => [...esProfiles, ...mysqlProfiles], [esProfiles, mysqlProfiles]);

  const activeProfile = activeConnectionId
    ? state.profiles.find((p) => p.id === activeConnectionId)
    : null;
  const activeEngine = activeProfile?.engine ?? "elasticsearch";

  const [esExpanded, setEsExpanded] = useState(true);
  const [mysqlExpanded, setMysqlExpanded] = useState(true);
  const [focusedConnectionId, setFocusedConnectionId] = useState<string | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<{ connectionId: string; x: number; y: number } | null>(null);
  const [mysqlDatabaseContextMenu, setMysqlDatabaseContextMenu] = useState<{ database: string; x: number; y: number } | null>(null);
  const [mysqlTabContextMenu, setMysqlTabContextMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [sidebarExpandedTablesDatabase, setSidebarExpandedTablesDatabase] = useState<string | null>(null);
  const [isConnectionActionPending, setIsConnectionActionPending] = useState(false);
  const [connectionActionError, setConnectionActionError] = useState("");
  const [connectionStatusById, setConnectionStatusById] = useState<Record<string, ConnectionStatus>>({});
  const [isWorkspaceSuspended, setIsWorkspaceSuspended] = useState(false);
  const [isErrorLogOpen, setIsErrorLogOpen] = useState(false);

  const markConnectionSuccess = (connectionId: string) => {
    setConnectionStatusById((prev) => ({
      ...prev,
      [connectionId]: "success"
    }));
  };

  const resetMysqlWorkspace = () => {
    setTablesByDb({});
    setExpandedDatabase(null);
    setSidebarExpandedTablesDatabase(null);
    setSelectedDatabase(undefined);
    setSelectedTable(undefined);
    setOpenedTables([]);
    setActiveOpenedTableKey(null);
  };

  const disconnectConnectionForEdit = async (connectionId?: string) => {
    if (!connectionId || activeConnectionId !== connectionId) {
      return;
    }

    const currentProfile = state.profiles.find((item) => item.id === connectionId);
    if (currentProfile?.engine === "mysql") {
      try {
        await mysqlDisconnect(connectionId);
      } catch (error) {
        logError(error, {
          source: "app.connection.mysql.disconnectBeforeEdit",
          message: `Failed to disconnect MySQL connection ${connectionId} before editing config`
        });
      }
    }

    await disconnectActiveConnection();
    setIsWorkspaceSuspended(false);
    resetMysqlWorkspace();
    setConnectionStatusById((prev) => ({
      ...prev,
      [connectionId]: "idle"
    }));
  };

  const openConnectionConfig = async (engine: "elasticsearch" | "mysql", action: "add" | "edit" | "copy", connectionId?: string) => {
    if (action === "edit") {
      await disconnectConnectionForEdit(connectionId);
    }

    const params = new URLSearchParams({ action });
    if (connectionId) {
      params.set("id", connectionId);
    }
    const basePath = engine === "mysql" ? "/mysql/connections" : "/connections";
    navigate(`${basePath}?${params.toString()}`, {
      state: { from: location.pathname }
    });
  };

  const handleConnectionChange = async (value: string, options?: { forceValidate?: boolean }) => {
    if (isConnectionActionPending) return;
    if (activeConnectionId === value) {
      if (isWorkspaceSuspended) {
        setConnectionActionError("");
        setIsWorkspaceSuspended(false);
        const profile = state.profiles.find((p) => p.id === value);
        const targetRoute = profile?.engine === "mysql" ? "/mysql/tables" : "/data";
        await navigate(targetRoute);
      }
      return true;
    }

    setIsConnectionActionPending(true);
    setConnectionActionError("");
    setContextMenu(null);

    const profile = state.profiles.find((p) => p.id === value);
    if (!profile) {
      setIsConnectionActionPending(false);
      setConnectionActionError(t("connections.connectionFailedSimple"));
      return false;
    }

    try {
      const currentStatus = connectionStatusById[value] ?? "idle";
      const shouldValidate = options?.forceValidate ?? currentStatus !== "success";

      if (profile.engine === "mysql") {
        // MySQL connection flow
        const mysqlConn = getMysqlConnectionById(value);
        if (!mysqlConn) throw new Error("CONNECTION_FAILED");

        if (shouldValidate) {
          await mysqlConnect(mysqlConn);
        }

        await setActiveConnection(value);

        // Load databases
        try {
          const dbs = await mysqlListDatabases(value);
          setDatabases(dbs);
        } catch (error) {
          logError(error, {
            source: "app.connection.mysql.listDatabases",
            message: "Failed to load MySQL databases after switching connection"
          });
          setDatabases([]);
        }
        setTablesByDb({});
        setExpandedDatabase(null);
        setSidebarExpandedTablesDatabase(null);
        setSelectedDatabase(undefined);
        setSelectedTable(undefined);
        setOpenedTables([]);
        setActiveOpenedTableKey(null);

        markConnectionSuccess(value);
        setIsWorkspaceSuspended(false);
        await navigate("/mysql/tables");
      } else {
        // ES connection flow
        const connection = getConnectionById(value);
        if (!connection) throw new Error("CONNECTION_FAILED");

        if (shouldValidate) {
          await pingCluster(connection);
        }

        await setActiveConnection(value);
        if (shouldValidate) {
          await refreshIndices(connection);
        }
        markConnectionSuccess(value);
        setIsWorkspaceSuspended(false);
        await navigate("/data");
      }
      return true;
    } catch (error) {
      logError(error, {
        source: "app.connection.change",
        message: `Failed to activate connection ${value}`
      });
      setConnectionStatusById((prev) => ({
        ...prev,
        [value]: "failed"
      }));
      setIsWorkspaceSuspended(true);
      await navigate("/", { replace: true });
      setConnectionActionError(t("connections.connectionFailedSimple"));
      return false;
    } finally {
      setIsConnectionActionPending(false);
    }
  };

  const handleDisconnect = async () => {
    if (isConnectionActionPending) return;
    if (!activeConnectionId) return;

    setIsConnectionActionPending(true);
    setContextMenu(null);
    const currentId = activeConnectionId;
    const currentProfile = state.profiles.find((p) => p.id === currentId);

    try {
      // Disconnect MySQL pool if applicable
      if (currentProfile?.engine === "mysql") {
        try {
          await mysqlDisconnect(currentId);
        } catch (error) {
          logError(error, {
            source: "app.connection.mysql.disconnect",
            message: `Failed to disconnect MySQL connection ${currentId}`
          });
        }
      }

      await disconnectActiveConnection();
      setIsWorkspaceSuspended(false);
      resetMysqlWorkspace();
      setConnectionStatusById((prev) => ({
        ...prev,
        [currentId]: "idle"
      }));
      await navigate("/", { replace: true });
    } finally {
      setIsConnectionActionPending(false);
    }
  };

  const toggleLanguage = () => {
    const newLang = i18n.language === "zh" ? "en" : "zh";
    i18n.changeLanguage(newLang);
  };

  const handleConnectionContextMenu = (event: MouseEvent<HTMLElement>, connectionId: string) => {
    event.preventDefault();
    setFocusedConnectionId(connectionId);
    setContextMenu({ connectionId, x: event.clientX, y: event.clientY });
  };

  const handleDeleteConnection = async (connectionId: string) => {
    setContextMenu(null);
    setConnectionStatusById((prev) => {
      const next = { ...prev };
      delete next[connectionId];
      return next;
    });
    await deleteConnection(connectionId);
  };

  const ensureMysqlConnectionReady = async (connectionId: string) => {
    const profile = state.profiles.find((item) => item.id === connectionId);
    if (profile?.engine !== "mysql") {
      return false;
    }

    const status = connectionStatusById[connectionId] ?? "idle";
    if (activeConnectionId === connectionId && status === "success" && !isWorkspaceSuspended) {
      return true;
    }

    return await handleConnectionChange(connectionId, { forceValidate: true });
  };

  const refreshMysqlDatabases = async () => {
    if (!activeConnectionId) return;
    const profile = state.profiles.find((p) => p.id === activeConnectionId);
    if (profile?.engine !== "mysql") return;

    try {
      const dbs = await mysqlListDatabases(activeConnectionId);
      setDatabases(dbs);
    } catch (error) {
      logError(error, {
        source: "app.mysql.refreshDatabases",
        message: "Failed to refresh MySQL databases from sidebar"
      });
      setDatabases([]);
    }
  };

  const loadMysqlTables = async (database: string) => {
    if (!activeConnectionId) return;
    const profile = state.profiles.find((p) => p.id === activeConnectionId);
    if (profile?.engine !== "mysql") return;

    try {
      const tables = await mysqlListTables(activeConnectionId, database);
      setTablesByDb((prev) => ({
        ...prev,
        [database]: tables
      }));
    } catch (error) {
      logError(error, {
        source: "app.mysql.listTables",
        message: `Failed to load tables for database ${database}`
      });
      setTablesByDb((prev) => ({
        ...prev,
        [database]: []
      }));
    }
  };

  const handleMysqlSelectDatabase = (database: string) => {
    setSelectedDatabase(database);
    setSelectedTable(undefined);
  };

  const handleMysqlOpenDatabase = async (database: string) => {
    setExpandedDatabase(database);
    setSelectedDatabase(database);
    setSelectedTable(undefined);
    if (!tablesByDb[database]) {
      await loadMysqlTables(database);
    }
    await navigate("/mysql/tables");
  };

  const handleMysqlCloseDatabase = async (database: string) => {
    if (expandedDatabase === database) {
      setExpandedDatabase(null);
      setSelectedTable(undefined);
      setSidebarExpandedTablesDatabase((prev) => (prev === database ? null : prev));
      const remainingTables = openedTables.filter((item) => item.database !== database);
      setOpenedTables(remainingTables);
      const nextActive = activeOpenedTableKey
        ? remainingTables.find((item) => getMysqlOpenedTableKey(item.database, item.table) === activeOpenedTableKey)
          ?? remainingTables[remainingTables.length - 1]
          ?? null
        : null;
      setActiveOpenedTableKey(nextActive ? getMysqlOpenedTableKey(nextActive.database, nextActive.table) : null);
      await navigate("/mysql/tables");
    }
  };

  const handleMysqlToggleSidebarTables = async (database: string) => {
    setSelectedDatabase(database);

    if (expandedDatabase !== database) {
      await handleMysqlOpenDatabase(database);
    } else if (!tablesByDb[database]) {
      await loadMysqlTables(database);
    }

    setSidebarExpandedTablesDatabase((prev) => (prev === database ? null : database));
  };

  const handleMysqlSelectSidebarTable = async (database: string, table: string) => {
    setSelectedDatabase(database);
    setSelectedTable(table);
    if (location.pathname === "/mysql/table") {
      return;
    }
    if (location.pathname !== "/mysql/tables") {
      await navigate("/mysql/tables");
    }
  };

  const handleMysqlOpenSidebarTable = async (database: string, table: string) => {
    const nextKey = getMysqlOpenedTableKey(database, table);
    setSelectedDatabase(database);
    setSelectedTable(table);
    setOpenedTables((prev) => {
      const existing = prev.find((item) => getMysqlOpenedTableKey(item.database, item.table) === nextKey);
      if (existing) {
        return prev.map((item) => getMysqlOpenedTableKey(item.database, item.table) === nextKey ? { ...item, view: "data" } : item);
      }
      return [...prev, { database, table, view: "data" }];
    });
    setActiveOpenedTableKey(nextKey);
    await navigate("/mysql/table");
  };

  const handleActivateMysqlOpenedTable = async (database: string, table: string) => {
    const nextKey = getMysqlOpenedTableKey(database, table);
    setSelectedDatabase(database);
    setSelectedTable(table);
    setActiveOpenedTableKey(nextKey);
    await navigate("/mysql/table");
  };

  const handleCloseMysqlOpenedTable = async (database: string, table: string) => {
    const targetKey = getMysqlOpenedTableKey(database, table);
    const remainingTables = openedTables.filter((item) => getMysqlOpenedTableKey(item.database, item.table) !== targetKey);
    setOpenedTables(remainingTables);

    if (selectedDatabase === database && selectedTable === table) {
      setSelectedTable(undefined);
    }

    if (activeOpenedTableKey === targetKey) {
      const nextActive = remainingTables[remainingTables.length - 1] ?? null;
      if (!nextActive) {
        setActiveOpenedTableKey(null);
        await navigate("/mysql/tables");
        return;
      }

      setActiveOpenedTableKey(getMysqlOpenedTableKey(nextActive.database, nextActive.table));
      setSelectedDatabase(nextActive.database);
      setSelectedTable(nextActive.table);
      await navigate(`/mysql/table${location.search || "?tab=data"}`);
      return;
    }

    const nextActiveKey = activeOpenedTableKey && remainingTables.some((item) => getMysqlOpenedTableKey(item.database, item.table) === activeOpenedTableKey)
      ? activeOpenedTableKey
      : null;
    setActiveOpenedTableKey(nextActiveKey);
  };

  const handleMysqlTabContextMenu = (event: MouseEvent<HTMLButtonElement>, key: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMysqlTabContextMenu({ key, x: event.clientX, y: event.clientY });
  };

  const closeCurrentMysqlTab = async (key: string) => {
    const target = openedTables.find((item) => getMysqlOpenedTableKey(item.database, item.table) === key);
    setMysqlTabContextMenu(null);
    if (!target) return;
    await handleCloseMysqlOpenedTable(target.database, target.table);
  };

  const closeOtherMysqlTabs = async (key: string) => {
    const keep = openedTables.find((item) => getMysqlOpenedTableKey(item.database, item.table) === key) ?? null;
    setMysqlTabContextMenu(null);
    if (!keep) return;

    setOpenedTables([keep]);
    setActiveOpenedTableKey(key);
    setSelectedDatabase(keep.database);
    setSelectedTable(keep.table);
    if (location.pathname === "/mysql/table") {
      await navigate("/mysql/table");
    }
  };

  const closeAllMysqlTabs = async () => {
    setMysqlTabContextMenu(null);
    setOpenedTables([]);
    setActiveOpenedTableKey(null);
    if (location.pathname === "/mysql/table") {
      await navigate("/mysql/tables");
    }
  };

  const handleMysqlDatabaseContextMenu = (event: MouseEvent<HTMLDivElement>, database: string) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedDatabase(database);
    setMysqlDatabaseContextMenu({ database, x: event.clientX, y: event.clientY });
  };

  const handleCreateMysqlDatabase = async (connectionId: string) => {
    const ready = await ensureMysqlConnectionReady(connectionId);
    if (!ready) {
      setContextMenu(null);
      return;
    }

    const nextName = window.prompt(t("mysql.tableManager.createDatabasePrompt"), "new_database")?.trim();
    if (!nextName) {
      setContextMenu(null);
      return;
    }

    try {
      await mysqlQuery(connectionId, `CREATE DATABASE \`${nextName}\``);
      await refreshMysqlDatabases();
      setSelectedDatabase(nextName);
    } catch (error) {
      logError(error, {
        source: "app.mysql.createDatabase",
        message: `Failed to create database ${nextName}`
      });
      setConnectionActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setContextMenu(null);
    }
  };

  const handleDropMysqlDatabase = async (database: string) => {
    if (!activeConnectionId) return;
    if (!window.confirm(t("mysql.tableManager.dropDatabaseConfirm", { name: database }))) return;

    try {
      await mysqlQuery(activeConnectionId, `DROP DATABASE \`${database}\``);
      if (expandedDatabase === database) {
        setExpandedDatabase(null);
      }
      setSidebarExpandedTablesDatabase((prev) => (prev === database ? null : prev));
      if (selectedDatabase === database) {
        setSelectedDatabase(undefined);
        setSelectedTable(undefined);
      }
      const remainingTables = openedTables.filter((item) => item.database !== database);
      const didRemoveActiveTable = Boolean(activeOpenedTableKey && openedTables.some((item) => item.database === database && getMysqlOpenedTableKey(item.database, item.table) === activeOpenedTableKey));
      setOpenedTables(remainingTables);
      if (didRemoveActiveTable) {
        const nextActive = remainingTables[remainingTables.length - 1] ?? null;
        setActiveOpenedTableKey(nextActive ? getMysqlOpenedTableKey(nextActive.database, nextActive.table) : null);
        if (!nextActive && location.pathname === "/mysql/table") {
          await navigate("/mysql/tables");
        }
      }
      setTablesByDb((prev) => {
        const next = { ...prev };
        delete next[database];
        return next;
      });
      await refreshMysqlDatabases();
    } catch (error) {
      logError(error, {
        source: "app.mysql.dropDatabase",
        message: `Failed to drop database ${database}`
      });
      setConnectionActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setMysqlDatabaseContextMenu(null);
    }
  };

  useEffect(() => {
    if (!contextMenu && !mysqlDatabaseContextMenu && !mysqlTabContextMenu) return;

    const close = () => {
      setContextMenu(null);
      setMysqlDatabaseContextMenu(null);
      setMysqlTabContextMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);

    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu, mysqlDatabaseContextMenu, mysqlTabContextMenu]);

  useEffect(() => {
    if (!focusedConnectionId && allProfiles.length > 0) {
      setFocusedConnectionId(allProfiles[0]?.id);
      return;
    }
    if (focusedConnectionId && !allProfiles.some((item) => item.id === focusedConnectionId)) {
      setFocusedConnectionId(allProfiles[0]?.id);
    }
  }, [focusedConnectionId, allProfiles]);

  useEffect(() => {
    setConnectionStatusById((prev) => {
      const next: Record<string, ConnectionStatus> = {};
      allProfiles.forEach((item) => {
        next[item.id] = prev[item.id] ?? "idle";
      });

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) {
        return next;
      }

      for (const key of nextKeys) {
        if (prev[key] !== next[key]) {
          return next;
        }
      }

      return prev;
    });
  }, [allProfiles]);

  useEffect(() => {
    if (!activeConnectionId) return;
    markConnectionSuccess(activeConnectionId);
  }, [activeConnectionId]);

  useEffect(() => {
    if (activeConnectionId) return;
    if (!isWorkspaceSuspended) return;
    setIsWorkspaceSuspended(false);
  }, [activeConnectionId, isWorkspaceSuspended]);

  const showEsConnectionsTab = location.pathname.startsWith("/connections");
  const showMysqlConnectionsTab = location.pathname.startsWith("/mysql/connections");
  const showConnectionsTab = showEsConnectionsTab || showMysqlConnectionsTab;
  const canShowWorkspace = (Boolean(activeConnectionId) && !isWorkspaceSuspended) || showConnectionsTab;

  const isEsWorkspace = activeEngine === "elasticsearch" || showEsConnectionsTab;
  const isMysqlWorkspace = activeEngine === "mysql" || showMysqlConnectionsTab;

  // Shared connection tree item renderer
  const renderConnectionItem = (profile: typeof esProfiles[0]) => {
    const status = connectionStatusById[profile.id] ?? "idle";
    return (
      <div
        key={profile.id}
        className={`mdb-tree-item ${focusedConnectionId === profile.id ? "active" : ""}`}
        onClick={() => {
          setFocusedConnectionId(profile.id);
          if (activeConnectionId === profile.id) {
            if (isWorkspaceSuspended) {
              handleConnectionChange(profile.id, { forceValidate: false });
            }
            return;
          }
          if (status === "success") {
            handleConnectionChange(profile.id, { forceValidate: false });
          }
        }}
        onDoubleClick={() => {
          if (activeConnectionId === profile.id) {
            if (isWorkspaceSuspended) {
              handleConnectionChange(profile.id, { forceValidate: false });
            }
            return;
          }
          if (status !== "success") {
            handleConnectionChange(profile.id, { forceValidate: true });
          }
        }}
        onContextMenu={(event) => handleConnectionContextMenu(event, profile.id)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (activeConnectionId === profile.id) {
              if (isWorkspaceSuspended) {
                handleConnectionChange(profile.id, { forceValidate: false });
              }
              return;
            }
            if (status === "success") {
              handleConnectionChange(profile.id, { forceValidate: false });
            }
          }
        }}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              flexShrink: 0,
              background: status === "success" ? "#22c55e" : status === "failed" ? "#ef4444" : "#9ca3af"
            }}
          />
          <span className="name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {profile.name}
          </span>
        </span>
        {activeConnectionId === profile.id && (
          <span style={{ fontSize: "11px", background: "#dcfce7", color: "#166534", padding: "2px 6px", borderRadius: "4px", flexShrink: 0 }}>
            {t("connections.currentInUse")}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="mdb-layout">
      <header className="mdb-topbar">
        <div className="mdb-topbar-left">
          <div className="mdb-brand">{t("sidebar.brand")}</div>
        </div>
        <div className="mdb-topbar-right">
          <span className="mdb-conn-tip">
            {activeConnectionId ? state.profiles.find((item) => item.id === activeConnectionId)?.name : t("sidebar.connectionPlaceholder")}
          </span>
          <button
            className="btn btn-sm"
            onClick={toggleLanguage}
            title={t("app.switchLanguageTitle", {
              language: i18n.language === "zh" ? t("common.english") : t("common.chinese")
            })}
          >
            {t("app.switchLanguage", {
              language: i18n.language === "zh" ? t("common.english") : t("common.chinese")
            })}
          </button>
        </div>
      </header>

      <div className="mdb-main">
        <aside className="mdb-sidebar">
          <div className="mdb-sidebar-body">
            <div className="mdb-sidebar-title">{t("sidebar.connection")}</div>

          {/* Elasticsearch connections */}
          <div className="mdb-tree-group">
            <div className="mdb-tree-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setEsExpanded((prev) => !prev)}
                style={{ padding: "2px 6px", display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: 500 }}
              >
                <span>{esExpanded ? "▾" : "▸"}</span>
                <span>Elasticsearch</span>
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => void openConnectionConfig("elasticsearch", "add")}
                title={t("connections.createConnection")}
                style={{ padding: "2px 8px", minWidth: "28px" }}
              >
                +
              </button>
            </div>

            {esExpanded && (
              <div className="mdb-tree-items" style={{ paddingLeft: "18px", marginTop: "4px" }}>
                {esProfiles.map(renderConnectionItem)}
                {esProfiles.length === 0 && <div className="mdb-tree-empty">{t("connections.noConnections")}</div>}
              </div>
            )}
          </div>

          {/* MySQL connections */}
          <div className="mdb-tree-group" style={{ marginTop: "8px" }}>
            <div className="mdb-tree-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setMysqlExpanded((prev) => !prev)}
                style={{ padding: "2px 6px", display: "flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: 500 }}
              >
                <span>{mysqlExpanded ? "▾" : "▸"}</span>
                <span>MySQL</span>
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => void openConnectionConfig("mysql", "add")}
                title={t("connections.createConnection")}
                style={{ padding: "2px 8px", minWidth: "28px" }}
              >
                +
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={refreshMysqlDatabases}
                title={t("common.refresh")}
                style={{ padding: "2px 8px", minWidth: "28px" }}
              >
                ↻
              </button>
            </div>

            {mysqlExpanded && (
              <div className="mdb-tree-items" style={{ paddingLeft: "18px", marginTop: "4px" }}>
                {mysqlProfiles.map((profile) => {
                  const isActiveMysql = activeConnectionId === profile.id && profile.engine === "mysql";

                  return (
                    <div key={profile.id}>
                      {renderConnectionItem(profile)}
                      {isActiveMysql && databases.length > 0 && (
                        <div style={{ paddingLeft: "12px", marginTop: "2px", marginBottom: "4px" }}>
                          {databases.map((database) => {
                            const isOpened = expandedDatabase === database;
                            const isSelected = selectedDatabase === database;
                            const showChildren = isOpened || isSelected;
                            const tablesVisible = sidebarExpandedTablesDatabase === database;
                            const tables = tablesByDb[database] ?? [];
                            const tableCount = tablesByDb[database]?.length;

                            return (
                              <div key={`${profile.id}-${database}`}>
                                <div
                                  className="mdb-tree-item"
                                  style={{
                                    marginTop: "2px",
                                    padding: "4px 8px",
                                    fontSize: "12px",
                                    background: isSelected ? "#d6e3f9" : undefined,
                                    justifyContent: "space-between"
                                  }}
                                  onClick={() => handleMysqlSelectDatabase(database)}
                                  onDoubleClick={() => handleMysqlOpenDatabase(database)}
                                  onContextMenu={(event) => handleMysqlDatabaseContextMenu(event, database)}
                                >
                                  <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                                    <span>{showChildren ? "▾" : "▸"}</span>
                                    <span
                                      style={{
                                        width: "8px",
                                        height: "8px",
                                        borderRadius: "50%",
                                        background: isOpened ? "#22c55e" : "#9ca3af",
                                        flexShrink: 0
                                      }}
                                    />
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{database}</span>
                                  </span>
                                  <span className="muted" style={{ fontSize: "11px", flexShrink: 0 }}>
                                    {typeof tableCount === "number" ? tableCount : ""}
                                  </span>
                                </div>

                                {showChildren && (
                                  <div style={{ paddingLeft: "18px" }}>
                                    <div
                                      className="mdb-tree-item"
                                      style={{
                                        marginTop: "2px",
                                        padding: "4px 8px",
                                        fontSize: "12px",
                                        background: tablesVisible ? "#eef4ff" : undefined,
                                        justifyContent: "space-between"
                                      }}
                                      onClick={() => {
                                        void handleMysqlToggleSidebarTables(database);
                                      }}
                                    >
                                      <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                                        <span>{tablesVisible ? "▾" : "▸"}</span>
                                        <span>🗂</span>
                                        <span>{t("mysql.tableManager.tables")}</span>
                                      </span>
                                      <span className="muted" style={{ fontSize: "11px", flexShrink: 0 }}>
                                        {typeof tableCount === "number" ? tableCount : ""}
                                      </span>
                                    </div>

                                    {tablesVisible && (
                                      <div style={{ paddingLeft: "18px" }}>
                                        {tables.map((table) => (
                                          <div
                                            key={`${profile.id}-${database}-${table}`}
                                            className="mdb-tree-item"
                                            style={{
                                              marginTop: "2px",
                                              padding: "4px 8px",
                                              fontSize: "12px",
                                              background: selectedDatabase === database && selectedTable === table ? "#d6e3f9" : undefined
                                            }}
                                            onClick={() => {
                                              void handleMysqlSelectSidebarTable(database, table);
                                            }}
                                            onDoubleClick={() => {
                                              void handleMysqlOpenSidebarTable(database, table);
                                            }}
                                            title={table}
                                          >
                                            <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                                              <span style={{ color: "#2563eb", flexShrink: 0 }}>▤</span>
                                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{table}</span>
                                            </span>
                                          </div>
                                        ))}
                                        {tables.length === 0 && <div className="mdb-tree-empty">{t("mysql.data.noTables")}</div>}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {mysqlProfiles.length === 0 && <div className="mdb-tree-empty">{t("connections.noConnections")}</div>}
              </div>
            )}
          </div>

          {/* Connection action error */}
          {connectionActionError && (
            <div className="text-danger" style={{ fontSize: "12px", marginTop: "6px", padding: "0 12px" }}>
              {connectionActionError}
            </div>
          )}

          </div>

          <div className="mdb-sidebar-footer">
            <button
              type="button"
              className="mdb-sidebar-footer-button"
              onClick={() => setIsErrorLogOpen(true)}
              title={t("errorLog.open")}
            >
              <span>{t("errorLog.button")}</span>
              <span className={`mdb-sidebar-footer-badge ${errorLogCount > 0 ? "has-errors" : ""}`}>{errorLogCount}</span>
            </button>
          </div>
        </aside>

        <main className="mdb-workspace">
          <div style={{ display: canShowWorkspace ? "block" : "none" }}>
            {/* ES tabs */}
            <div className="mdb-tabs" style={{ display: isEsWorkspace ? "flex" : "none" }}>
              <NavLink to="/data" className={({ isActive }) => `mdb-tab ${isActive ? "active" : ""}`}>
                {t("sidebar.dataBrowser")}
              </NavLink>
              <NavLink to="/sql" className={({ isActive }) => `mdb-tab ${isActive ? "active" : ""}`}>
                {t("sidebar.sqlQuery")}
              </NavLink>
              <NavLink to="/rest" className={({ isActive }) => `mdb-tab ${isActive ? "active" : ""}`}>
                {t("sidebar.restConsole")}
              </NavLink>
              <NavLink to="/indices" className={({ isActive }) => `mdb-tab ${isActive ? "active" : ""}`}>
                {t("sidebar.indexManager")}
              </NavLink>
              {showEsConnectionsTab && (
                <NavLink to="/connections" className={({ isActive }) => `mdb-tab ${isActive ? "active" : ""}`}>
                  {t("sidebar.connections")}
                </NavLink>
              )}
            </div>

            {/* MySQL tabs */}
            <div className="mdb-tabs" style={{ display: isMysqlWorkspace ? "flex" : "none" }}>
              <NavLink to="/mysql/tables" className={({ isActive }) => `mdb-tab ${isActive ? "active" : ""}`}>
                {t("mysql.sidebar.tableManager")}
              </NavLink>
              {openedTables.map((item) => {
                const tabKey = getMysqlOpenedTableKey(item.database, item.table);
                const isActiveTab = location.pathname === "/mysql/table" && activeOpenedTableKey === tabKey;

                return (
                  <button
                    key={tabKey}
                    type="button"
                    className={`mdb-tab mdb-tab-button ${isActiveTab ? "active" : ""}`}
                    onClick={() => {
                      void handleActivateMysqlOpenedTable(item.database, item.table);
                    }}
                    onContextMenu={(event) => handleMysqlTabContextMenu(event, tabKey)}
                  >
                    <span className="mdb-tab-label">{item.database}.{item.table}</span>
                    <span
                      className="mdb-tab-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleCloseMysqlOpenedTable(item.database, item.table);
                      }}
                    >
                      ×
                    </span>
                  </button>
                );
              })}
              <NavLink to="/mysql/sql" className={({ isActive }) => `mdb-tab ${isActive ? "active" : ""}`}>
                {t("mysql.sidebar.sqlQuery")}
              </NavLink>
              {showMysqlConnectionsTab && (
                <NavLink to="/mysql/connections" className={({ isActive }) => `mdb-tab ${isActive ? "active" : ""}`}>
                  {t("sidebar.connections")}
                </NavLink>
              )}
            </div>

            <section className="mdb-content">
              {/* Routes for redirects and connection pages */}
              <Routes>
                <Route path="/" element={<Navigate to="/data" replace />} />
                <Route path="/connections" element={<EsConnectionsPage />} />
                <Route path="/connections/es" element={<Navigate to="/connections?action=add" replace />} />
                <Route path="/mysql" element={<Navigate to="/mysql/tables" replace />} />
                <Route path="/mysql/connections" element={<MysqlConnectionsPage />} />
                <Route path="/mysql/table" element={null} />
                <Route path="*" element={null} />
              </Routes>

              {/* ES pages - always mounted, display toggled */}
              <div style={{ display: location.pathname === "/data" ? undefined : "none" }}>
                <DataBrowser />
              </div>
              <div style={{ display: location.pathname === "/sql" ? undefined : "none" }}>
                <SqlQuery />
              </div>
              <div style={{ display: location.pathname === "/rest" ? undefined : "none" }}>
                <RestConsole />
              </div>
              <div style={{ display: location.pathname === "/indices" ? undefined : "none" }}>
                <IndexManager />
              </div>

              {/* MySQL pages - always mounted, display toggled */}
              <div style={{ display: location.pathname === "/mysql/sql" ? undefined : "none" }}>
                <MysqlSqlQuery />
              </div>
              <div style={{ display: location.pathname === "/mysql/tables" || location.pathname === "/mysql/table" ? undefined : "none" }}>
                <MysqlTableManager />
              </div>
            </section>
          </div>

          {!canShowWorkspace && (
            <section className="mdb-content" style={{ background: "transparent", border: "none", boxShadow: "none" }}>
              <div className="card" style={{ minHeight: "120px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="muted">{t("sidebar.notConnected")}</span>
              </div>
            </section>
          )}
        </main>
      </div>

      {contextMenu && (
        <div
          style={{
            position: "fixed",
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            zIndex: 1200,
            minWidth: "128px",
            background: "#fff",
            border: "1px solid #d1d1d6",
            borderRadius: "8px",
            boxShadow: "0 8px 20px rgba(0, 0, 0, 0.12)",
            padding: "4px"
          }}
          onClick={(event) => event.stopPropagation()}
        >
          {activeConnectionId === contextMenu.connectionId ? (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ width: "100%", justifyContent: "flex-start" }}
              disabled={isConnectionActionPending}
              onClick={() => {
                setContextMenu(null);
                handleDisconnect();
              }}
            >
              {t("connections.disconnect")}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ width: "100%", justifyContent: "flex-start" }}
              disabled={isConnectionActionPending}
              onClick={() => {
                setContextMenu(null);
                const status = connectionStatusById[contextMenu.connectionId] ?? "idle";
                handleConnectionChange(contextMenu.connectionId, { forceValidate: status !== "success" });
              }}
            >
              {t("connections.connect")}
            </button>
          )}

          <div style={{ height: "1px", background: "#e5e5ea", margin: "4px 0" }} />

          {state.profiles.find((p) => p.id === contextMenu.connectionId)?.engine === "mysql" && (
            <>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ width: "100%", justifyContent: "flex-start" }}
                onClick={() => {
                  void handleCreateMysqlDatabase(contextMenu.connectionId);
                }}
              >
                {t("mysql.tableManager.createDatabase")}
              </button>
              <div style={{ height: "1px", background: "#e5e5ea", margin: "4px 0" }} />
            </>
          )}

          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              const profile = state.profiles.find((p) => p.id === contextMenu.connectionId);
              const engine = profile?.engine ?? "elasticsearch";
              setContextMenu(null);
              void openConnectionConfig(engine, "edit", contextMenu.connectionId);
            }}
          >
            {t("common.edit")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              const profile = state.profiles.find((p) => p.id === contextMenu.connectionId);
              const engine = profile?.engine ?? "elasticsearch";
              setContextMenu(null);
              void openConnectionConfig(engine, "copy", contextMenu.connectionId);
            }}
          >
            {t("common.copy")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost text-danger"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => handleDeleteConnection(contextMenu.connectionId)}
          >
            {t("common.delete")}
          </button>
        </div>
      )}

      {mysqlDatabaseContextMenu && (
        <div
          style={{
            position: "fixed",
            left: `${mysqlDatabaseContextMenu.x}px`,
            top: `${mysqlDatabaseContextMenu.y}px`,
            zIndex: 1200,
            minWidth: "148px",
            background: "#fff",
            border: "1px solid #d1d1d6",
            borderRadius: "8px",
            boxShadow: "0 8px 20px rgba(0, 0, 0, 0.12)",
            padding: "4px"
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={async () => {
              const database = mysqlDatabaseContextMenu.database;
              setMysqlDatabaseContextMenu(null);
              await handleMysqlOpenDatabase(database);
            }}
          >
            {t("mysql.tableManager.openDatabase")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            disabled={expandedDatabase !== mysqlDatabaseContextMenu.database}
            onClick={async () => {
              const database = mysqlDatabaseContextMenu.database;
              setMysqlDatabaseContextMenu(null);
              await handleMysqlCloseDatabase(database);
            }}
          >
            {t("mysql.tableManager.closeDatabase")}
          </button>
          <div style={{ height: "1px", background: "#e5e5ea", margin: "4px 0" }} />
          <button
            type="button"
            className="btn btn-sm btn-ghost text-danger"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => handleDropMysqlDatabase(mysqlDatabaseContextMenu.database)}
          >
            {t("mysql.tableManager.dropDatabase")}
          </button>
        </div>
      )}

      {mysqlTabContextMenu && (
        <div
          style={{
            position: "fixed",
            left: `${mysqlTabContextMenu.x}px`,
            top: `${mysqlTabContextMenu.y}px`,
            zIndex: 1200,
            minWidth: "148px",
            background: "#fff",
            border: "1px solid #d1d1d6",
            borderRadius: "8px",
            boxShadow: "0 8px 20px rgba(0, 0, 0, 0.12)",
            padding: "4px"
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              void closeCurrentMysqlTab(mysqlTabContextMenu.key);
            }}
          >
            {t("mysql.tableManager.closeCurrentTab")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              void closeOtherMysqlTabs(mysqlTabContextMenu.key);
            }}
          >
            {t("mysql.tableManager.closeOtherTabs")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              void closeAllMysqlTabs();
            }}
          >
            {t("mysql.tableManager.closeAllTabs")}
          </button>
        </div>
      )}

      <ErrorLogModal open={isErrorLogOpen} onClose={() => setIsErrorLogOpen(false)} />
    </div>
  );
}

export default App;
