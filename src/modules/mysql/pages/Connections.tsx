import { Modal } from "antd";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { logError } from "../../../lib/errorLog";
import type { ConnectionProfile } from "../../../lib/types";
import { useAppContext } from "../../../state/AppContext";
import { mysqlConnect, mysqlDisconnect } from "../services/client";
import type { MysqlConnection } from "../types";

const emptyForm = {
  id: "",
  name: "",
  host: "127.0.0.1",
  port: 3306,
  database: "",
  username: "root",
  password: ""
};

export default function MysqlConnectionsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { state, activeConnectionId, saveConnection, deleteConnection } = useAppContext();
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [messageType, setMessageType] = useState<"error" | "success">("error");
  const [testingId, setTestingId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const action = searchParams.get("action");
  const selectedId = searchParams.get("id") ?? "";
  const isConfigVisible = action === "add" || action === "edit" || action === "copy";

  const mysqlProfiles = state.profiles.filter((item) => item.engine === "mysql");

  const resetForm = () => {
    setForm(emptyForm);
    setError("");
  };

  const handleAdd = () => {
    setSearchParams({ action: "add" });
  };

  const closeConfig = () => {
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from && from !== "/mysql/connections" ? from : "/mysql/data", { replace: true });
  };

  const handleSave = async () => {
    setError("");
    if (!form.name || !form.host) {
      setMessageType("error");
      setError(t("connections.nameAndAddressRequired"));
      return;
    }

    const id = form.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const profile: ConnectionProfile = {
      id,
      name: form.name,
      engine: "mysql",
      baseUrl: "",
      mysqlHost: form.host,
      mysqlPort: form.port,
      mysqlDatabase: form.database || undefined,
      authType: "basic",
      verifyTls: false
    };

    await saveConnection(profile, {
      username: form.username,
      password: form.password
    });
    resetForm();
    closeConfig();
  };

  const handleEdit = (id: string) => {
    setSearchParams({ action: "edit", id });
  };

  const handleCopy = (id: string) => {
    setSearchParams({ action: "copy", id });
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    setError("");

    try {
      const profile = state.profiles.find((p) => p.id === id);
      if (!profile) {
        throw new Error(t("connections.connectionNotFound"));
      }
      const secret = state.secrets[id] ?? {};
      const conn: MysqlConnection = {
        id: profile.id,
        name: profile.name,
        engine: profile.engine,
        host: profile.mysqlHost ?? "127.0.0.1",
        port: profile.mysqlPort ?? 3306,
        database: profile.mysqlDatabase,
        username: secret.username,
        password: secret.password
      };
      await mysqlConnect(conn);
      await mysqlDisconnect(id);
      setMessageType("success");
      setError(t("connections.connectionSuccess", { name: profile.name }));
    } catch (err) {
      logError(err, {
        source: "mysqlConnections.testConnection",
        message: `Failed to test MySQL connection ${id}`
      });
      setMessageType("error");
      setError(t("connections.connectionFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setTestingId(null);
    }
  };

  useEffect(() => {
    if (!isConfigVisible) return;

    setError("");
    setShowPassword(false);

    if (action === "add") {
      setForm(emptyForm);
      return;
    }

    if ((action === "edit" || action === "copy") && selectedId) {
      const profile = state.profiles.find((item) => item.id === selectedId);
      if (!profile) {
        closeConfig();
        return;
      }
      const secret = state.secrets[selectedId] ?? {};
      const nextName = action === "copy" ? `${profile.name} - ${t("common.copy")}` : profile.name;
      setForm({
        id: action === "copy" ? "" : selectedId,
        name: nextName,
        host: profile.mysqlHost ?? "127.0.0.1",
        port: profile.mysqlPort ?? 3306,
        database: profile.mysqlDatabase ?? "",
        username: secret.username ?? "",
        password: secret.password ?? ""
      });
      return;
    }

    closeConfig();
  }, [isConfigVisible, action, selectedId, state.profiles, state.secrets]);

  return (
    <div className="page">
      <div className="card">
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="card-title">{t("connections.savedConnections")}</h3>
          <button className="btn btn-primary" onClick={handleAdd}>
            + {t("connections.createConnection")}
          </button>
        </div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: "25%" }}>{t("connections.connectionName")}</th>
                <th style={{ width: "15%" }}>{t("connections.engine")}</th>
                <th style={{ width: "30%" }}>{t("connections.address")}</th>
                <th style={{ width: "15%" }}>{t("connections.mysqlDatabase")}</th>
                <th style={{ width: "25%", textAlign: "right" }}>{t("connections.operations")}</th>
              </tr>
            </thead>
            <tbody>
              {mysqlProfiles.map((profile) => (
                <tr key={profile.id}>
                  <td style={{ fontWeight: 500 }}>
                    {profile.name}
                    {profile.id === activeConnectionId && <span style={{ marginLeft: "8px", fontSize: "11px", background: "#dcfce7", color: "#166534", padding: "2px 6px", borderRadius: "4px" }}>{t("connections.currentInUse")}</span>}
                  </td>
                  <td><span className="pill">MySQL</span></td>
                  <td className="muted">{profile.mysqlHost ?? "127.0.0.1"}:{profile.mysqlPort ?? 3306}</td>
                  <td className="muted">{profile.mysqlDatabase ?? "-"}</td>
                  <td className="table-actions" style={{ textAlign: "right" }}>
                    <div className="flex-gap justify-end" style={{ gap: "4px" }}>
                      <button className="btn btn-sm btn-ghost" title={t("connections.testConnection")} onClick={() => handleTest(profile.id)} disabled={testingId === profile.id}>
                        {testingId === profile.id ? "..." : t("connections.test")}
                      </button>
                      <button className="btn btn-sm btn-ghost" title={t("common.edit")} onClick={() => handleEdit(profile.id)}>{t("common.edit")}</button>
                      <button className="btn btn-sm btn-ghost" title={t("common.copy")} onClick={() => handleCopy(profile.id)}>{t("common.copy")}</button>
                      <button className="btn btn-sm btn-ghost text-danger" title={t("common.delete")} onClick={() => deleteConnection(profile.id)}>{t("common.delete")}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {mysqlProfiles.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: "center", padding: "32px" }}>{t("connections.noConnections")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {error && <div className={messageType === "success" ? "text-success" : "text-danger"} style={{ marginTop: "12px", padding: "0 4px" }}>{error}</div>}

      <Modal
        title={action === "edit" ? t("common.edit") : action === "copy" ? t("common.copy") : t("connections.createConnection")}
        open={isConfigVisible}
        onOk={handleSave}
        onCancel={closeConfig}
        width={600}
        okText={t("connections.saveConnection")}
        cancelText={t("common.cancel")}
      >
        <div className="form-grid" style={{ marginTop: "16px" }}>
          <div>
            <label>{t("connections.name")}</label>
            <input className="form-control" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="e.g. Production MySQL" />
          </div>
          <div>
            <label>{t("connections.engine")}</label>
            <input className="form-control" value="MySQL" disabled />
          </div>
          <div>
            <label>{t("connections.mysqlHost")}</label>
            <input className="form-control" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} placeholder="127.0.0.1" />
          </div>
          <div>
            <label>{t("connections.mysqlPort")}</label>
            <input className="form-control" type="number" value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) || 3306 })} placeholder="3306" />
          </div>
          <div>
            <label>{t("connections.mysqlDatabase")}</label>
            <input className="form-control" value={form.database} onChange={(event) => setForm({ ...form, database: event.target.value })} placeholder="(optional)" />
          </div>
          <div />
          <div>
            <label>{t("connections.username")}</label>
            <input className="form-control" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="root" />
          </div>
          <div>
            <label>{t("connections.password")}</label>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                className="form-control"
                type={showPassword ? "text" : "password"}
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
                style={{ paddingRight: "36px" }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: "absolute",
                  right: "4px",
                  padding: "4px 8px",
                  fontSize: "16px",
                  cursor: "pointer",
                  border: "none",
                  background: "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}
                title={showPassword ? t("connections.hidePassword") : t("connections.showPassword")}
              >
                {showPassword ? "🙈" : "👁️"}
              </button>
            </div>
          </div>
        </div>
        {error && <div className={messageType === "success" ? "text-success" : "text-danger"} style={{ marginTop: "12px" }}>{error}</div>}
      </Modal>
    </div>
  );
}
