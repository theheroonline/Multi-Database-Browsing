import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import EsConnectionsPage from "./modules/es/pages/Connections";
import DataBrowser from "./modules/es/pages/DataBrowser";
import IndexManager from "./modules/es/pages/IndexManager";
import RestConsole from "./modules/es/pages/RestConsole";
import SqlQuery from "./modules/es/pages/SqlQuery";
import { pingCluster } from "./modules/es/services/client";
import MysqlConnectionsPage from "./modules/mysql/pages/Connections";
import MysqlSqlQuery from "./modules/mysql/pages/SqlQuery";
import MysqlTableManager from "./modules/mysql/pages/TableManager";
import { mysqlConnect, mysqlDisconnect, mysqlListDatabases, mysqlListTables } from "./modules/mysql/services/client";
import { AppProvider, useAppContext } from "./state/AppContext";
import { MysqlProvider, useMysqlContext } from "./state/MysqlContext";

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
  const [isConnectionActionPending, setIsConnectionActionPending] = useState(false);
  const [connectionActionError, setConnectionActionError] = useState("");
  const [connectionStatusById, setConnectionStatusById] = useState<Record<string, ConnectionStatus>>({});
  const [isWorkspaceSuspended, setIsWorkspaceSuspended] = useState(false);

  const markConnectionSuccess = (connectionId: string) => {
    setConnectionStatusById((prev) => ({
      ...prev,
      [connectionId]: "success"
    }));
  };

  const openConnectionConfig = (engine: "elasticsearch" | "mysql", action: "add" | "edit" | "copy", connectionId?: string) => {
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
      return;
    }

    setIsConnectionActionPending(true);
    setConnectionActionError("");
    setContextMenu(null);

    const profile = state.profiles.find((p) => p.id === value);
    if (!profile) {
      setIsConnectionActionPending(false);
      setConnectionActionError(t("connections.connectionFailedSimple"));
      return;
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
        } catch {
          setDatabases([]);
        }
        setTablesByDb({});
        setExpandedDatabase(null);
        setSelectedDatabase(undefined);
        setSelectedTable(undefined);

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
    } catch {
      setConnectionStatusById((prev) => ({
        ...prev,
        [value]: "failed"
      }));
      setIsWorkspaceSuspended(true);
      await navigate("/", { replace: true });
      setConnectionActionError(t("connections.connectionFailedSimple"));
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
        } catch {
          // ignore disconnect errors
        }
      }

      await disconnectActiveConnection();
      setIsWorkspaceSuspended(false);
      setTablesByDb({});
      setExpandedDatabase(null);
      setSelectedDatabase(undefined);
      setSelectedTable(undefined);
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
    } catch {
      setTablesByDb((prev) => ({
        ...prev,
        [database]: []
      }));
    }
  };

  const handleMysqlExpandDatabase = async (database: string) => {
    if (expandedDatabase === database) {
      setExpandedDatabase(null);
      return;
    }

    setExpandedDatabase(database);
    setSelectedDatabase(database);
    if (!tablesByDb[database]) {
      await loadMysqlTables(database);
    }
  };

  const handleMysqlSelectTable = async (database: string, table: string, openData?: boolean) => {
    setSelectedDatabase(database);
    setSelectedTable(table);
    if (openData) {
      await navigate("/mysql/tables?tab=data");
      return;
    }
    await navigate("/mysql/tables");
  };

  useEffect(() => {
    if (!contextMenu) return;

    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);

    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

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
                onClick={() => openConnectionConfig("elasticsearch", "add")}
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
                onClick={() => openConnectionConfig("mysql", "add")}
                title={t("connections.createConnection")}
                style={{ padding: "2px 8px", minWidth: "28px" }}
              >
                +
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  if (!activeConnectionId) return;
                  const profile = state.profiles.find((p) => p.id === activeConnectionId);
                  if (profile?.engine !== "mysql") return;
                  try {
                    const dbs = await mysqlListDatabases(activeConnectionId);
                    setDatabases(dbs);
                  } catch {
                    setDatabases([]);
                  }
                }}
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
                            const expanded = expandedDatabase === database;
                            const tables = tablesByDb[database] ?? [];

                            return (
                              <div key={`${profile.id}-${database}`}>
                                <div
                                  className="mdb-tree-item"
                                  style={{
                                    marginTop: "2px",
                                    padding: "4px 8px",
                                    fontSize: "12px",
                                    background: selectedDatabase === database && !selectedTable ? "#d6e3f9" : undefined
                                  }}
                                  onClick={() => handleMysqlExpandDatabase(database)}
                                >
                                  <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                                    <span>{expanded ? "▾" : "▸"}</span>
                                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{database}</span>
                                  </span>
                                  {tablesByDb[database] && <span className="muted" style={{ fontSize: "11px" }}>{tables.length}</span>}
                                </div>

                                {expanded && (
                                  <div style={{ paddingLeft: "18px" }}>
                                    {tables.map((table) => (
                                      <div
                                        key={`${profile.id}-${database}-${table}`}
                                        className={`mdb-tree-item ${selectedDatabase === database && selectedTable === table ? "active" : ""}`}
                                        style={{ marginTop: "2px", padding: "4px 8px", fontSize: "12px" }}
                                        onClick={() => handleMysqlSelectTable(database, table)}
                                        onDoubleClick={() => handleMysqlSelectTable(database, table, true)}
                                      >
                                        {table}
                                      </div>
                                    ))}

                                    {tablesByDb[database] && tables.length === 0 && (
                                      <div className="mdb-tree-empty" style={{ padding: "4px 8px" }}>{t("mysql.data.noTables")}</div>
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
              <div style={{ display: location.pathname === "/mysql/tables" ? undefined : "none" }}>
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

          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              const profile = state.profiles.find((p) => p.id === contextMenu.connectionId);
              const engine = profile?.engine ?? "elasticsearch";
              setContextMenu(null);
              openConnectionConfig(engine, "edit", contextMenu.connectionId);
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
              openConnectionConfig(engine, "copy", contextMenu.connectionId);
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
    </div>
  );
}

export default App;
