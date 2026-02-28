import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppContext } from "../../../state/AppContext";
import { useMysqlContext } from "../../../state/MysqlContext";
import { mysqlQuery, type MysqlQueryResult } from "../services/client";

export default function MysqlSqlQuery() {
  const { t } = useTranslation();
  const { addHistory } = useAppContext();
  const { activeMysqlConnection, selectedDatabase } = useMysqlContext();
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<MysqlQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const connectionId = activeMysqlConnection?.id;

  const handleExecute = async () => {
    if (!connectionId || !sql.trim()) return;

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await mysqlQuery(connectionId, sql.trim());
      setResult(res);
      await addHistory(
        selectedDatabase ? `[${selectedDatabase}] SQL` : "MySQL SQL",
        sql.trim()
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleExecute();
    }
  };

  if (!activeMysqlConnection) {
    return (
      <div className="page">
        <div className="card" style={{ padding: "32px", textAlign: "center" }}>
          <span className="muted">{t("mysql.query.noMysqlConnection")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {/* SQL Editor */}
      <div className="card" style={{ marginBottom: "12px" }}>
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 className="card-title">
            {t("mysql.query.title")}
            {selectedDatabase && <span className="muted" style={{ fontWeight: 400, fontSize: "13px", marginLeft: "8px" }}>[{selectedDatabase}]</span>}
          </h3>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setSql("")}>
              {t("common.clear")}
            </button>
            <button className="btn btn-sm btn-primary" onClick={handleExecute} disabled={loading || !sql.trim()}>
              {loading ? t("common.loading") : t("mysql.query.execute")}
            </button>
          </div>
        </div>
        <div style={{ padding: "12px 16px" }}>
          <textarea
            className="json-editor"
            style={{
              width: "100%",
              minHeight: "160px",
              fontFamily: "monospace",
              fontSize: "13px",
              padding: "12px",
              border: "1px solid #d1d1d6",
              borderRadius: "8px",
              resize: "vertical",
              lineHeight: 1.6
            }}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="SELECT * FROM table_name LIMIT 100;&#10;&#10;-- Ctrl+Enter to execute"
            spellCheck={false}
          />
          <div className="muted" style={{ fontSize: "12px", marginTop: "4px" }}>
            Ctrl+Enter {t("mysql.query.execute")}
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-danger" style={{ marginBottom: "12px", padding: "8px 12px", background: "#fef2f2", borderRadius: "8px" }}>
          {t("mysql.query.executeFailed")} {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">
              {t("mysql.query.result")}
              {result.isResultSet ? (
                <span className="muted" style={{ fontWeight: 400, fontSize: "13px", marginLeft: "8px" }}>
                  ({result.rows.length} rows)
                </span>
              ) : (
                <span className="muted" style={{ fontWeight: 400, fontSize: "13px", marginLeft: "8px" }}>
                  {t("mysql.query.affectedRows", { count: result.affectedRows })}
                </span>
              )}
            </h3>
          </div>

          {result.isResultSet ? (
            <div className="table-wrapper" style={{ maxHeight: "calc(100vh - 440px)", overflow: "auto" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: "50px" }}>#</th>
                    {result.columns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      <td className="muted">{rowIndex + 1}</td>
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          style={{ maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={cell === null ? "NULL" : String(cell)}
                        >
                          {cell === null ? <span className="muted">NULL</span> : String(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {result.rows.length === 0 && (
                    <tr>
                      <td colSpan={result.columns.length + 1} className="muted" style={{ textAlign: "center", padding: "32px" }}>
                        {t("mysql.query.noRows")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: "24px", textAlign: "center" }}>
              <div style={{ fontSize: "14px", color: "#22c55e" }}>
                {t("mysql.query.statementDone")} {t("mysql.query.affectedRows", { count: result.affectedRows })}
              </div>
            </div>
          )}
        </div>
      )}

      {!result && !error && (
        <div className="card" style={{ padding: "32px", textAlign: "center" }}>
          <span className="muted">{t("mysql.query.empty")}</span>
        </div>
      )}
    </div>
  );
}
