import { type MouseEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import EsConnectionsPage from "./modules/es/pages/Connections";
import DataBrowser from "./modules/es/pages/DataBrowser";
import IndexManager from "./modules/es/pages/IndexManager";
import RestConsole from "./modules/es/pages/RestConsole";
import SqlQuery from "./modules/es/pages/SqlQuery";
import { pingCluster } from "./modules/es/services/client";
import { AppProvider, useAppContext } from "./state/AppContext";

type ConnectionStatus = "success" | "idle" | "failed";

function App() {
  return (
    <AppProvider>
      <AppLayout />
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

  const esProfiles = useMemo(
    () => state.profiles.filter((item) => (item.engine ?? "elasticsearch") === "elasticsearch"),
    [state.profiles]
  );
  const [esExpanded, setEsExpanded] = useState(true);
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

  const openConnectionConfig = (action: "add" | "edit" | "copy", connectionId?: string) => {
    const params = new URLSearchParams({ action });
    if (connectionId) {
      params.set("id", connectionId);
    }
    navigate(`/connections?${params.toString()}`, {
      state: { from: location.pathname }
    });
  };

  const handleConnectionChange = async (value: string, options?: { forceValidate?: boolean }) => {
    if (isConnectionActionPending) return;
    if (activeConnectionId === value) {
      if (isWorkspaceSuspended) {
        setConnectionActionError("");
        setIsWorkspaceSuspended(false);
        await navigate("/data");
      }
      return;
    }

    setIsConnectionActionPending(true);
    setConnectionActionError("");
    setContextMenu(null);

    try {
      const connection = getConnectionById(value);
      if (!connection) {
        throw new Error("CONNECTION_FAILED");
      }

      const currentStatus = connectionStatusById[value] ?? "idle";
      const shouldValidate = options?.forceValidate ?? currentStatus !== "success";

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

    try {
      await disconnectActiveConnection();
      setIsWorkspaceSuspended(false);
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
    if (!focusedConnectionId && esProfiles.length > 0) {
      setFocusedConnectionId(esProfiles[0]?.id);
      return;
    }
    if (focusedConnectionId && !esProfiles.some((item) => item.id === focusedConnectionId)) {
      setFocusedConnectionId(esProfiles[0]?.id);
    }
  }, [focusedConnectionId, esProfiles]);

  useEffect(() => {
    setConnectionStatusById((prev) => {
      const next: Record<string, ConnectionStatus> = {};
      esProfiles.forEach((item) => {
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
  }, [esProfiles]);

  useEffect(() => {
    if (!activeConnectionId) return;
    markConnectionSuccess(activeConnectionId);
  }, [activeConnectionId]);

  useEffect(() => {
    if (activeConnectionId) return;
    if (!isWorkspaceSuspended) return;
    setIsWorkspaceSuspended(false);
  }, [activeConnectionId, isWorkspaceSuspended]);

  const showConnectionsTab = location.pathname.startsWith("/connections");
  const canShowWorkspace = (Boolean(activeConnectionId) && !isWorkspaceSuspended) || showConnectionsTab;

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
                onClick={() => openConnectionConfig("add")}
                title={t("connections.createConnection")}
                style={{ padding: "2px 8px", minWidth: "28px" }}
              >
                +
              </button>
            </div>

            {esExpanded && (
              <div className="mdb-tree-items" style={{ paddingLeft: "18px", marginTop: "4px" }}>
                {esProfiles.map((profile) => {
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
                })}

                {esProfiles.length === 0 && <div className="mdb-tree-empty">{t("connections.noConnections")}</div>}
                {connectionActionError && (
                  <div className="text-danger" style={{ fontSize: "12px", marginTop: "6px", paddingLeft: "4px" }}>
                    {connectionActionError}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        <main className="mdb-workspace">
          <div style={{ display: canShowWorkspace ? "block" : "none" }}>
            <div className="mdb-tabs">
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
              {showConnectionsTab && (
                <NavLink to="/connections" className={({ isActive }) => `mdb-tab ${isActive ? "active" : ""}`}>
                  {t("sidebar.connections")}
                </NavLink>
              )}
            </div>

            <section className="mdb-content">
              {/* Routes 仅处理重定向和连接配置页 */}
              <Routes>
                <Route path="/" element={<Navigate to="/data" replace />} />
                <Route path="/connections" element={<EsConnectionsPage />} />
                <Route path="/connections/es" element={<Navigate to="/connections?action=add" replace />} />
                <Route path="*" element={null} />
              </Routes>
              {/* 工作区页面始终挂载，通过 display 控制可见性，避免切换 tab 时状态丢失 */}
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
              setContextMenu(null);
              openConnectionConfig("edit", contextMenu.connectionId);
            }}
          >
            {t("common.edit")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              setContextMenu(null);
              openConnectionConfig("copy", contextMenu.connectionId);
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
