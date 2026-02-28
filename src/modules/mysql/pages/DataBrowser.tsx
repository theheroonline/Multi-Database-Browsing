import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMysqlContext } from "../../../state/MysqlContext";
import { mysqlDescribeTable, mysqlListDatabases, mysqlListTables, mysqlQuery } from "../services/client";
import type { ColumnMeta } from "../types";

interface QueryState {
  columns: string[];
  rows: Array<Array<unknown>>;
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string;
}

const defaultQueryState: QueryState = {
  columns: [],
  rows: [],
  total: 0,
  page: 1,
  pageSize: 100,
  loading: false,
  error: ""
};

export default function MysqlDataBrowser() {
  const { t } = useTranslation();
  const {
    activeMysqlConnection,
    databases,
    setDatabases,
    tablesByDb,
    setTablesByDb,
    selectedDatabase,
    setSelectedDatabase,
    selectedTable,
    setSelectedTable
  } = useMysqlContext();

  const [queryState, setQueryState] = useState<QueryState>(defaultQueryState);
  const [columnMeta, setColumnMeta] = useState<ColumnMeta[]>([]);
  const [showStructure, setShowStructure] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [editingRow, setEditingRow] = useState<{ index: number; json: string } | null>(null);
  const [editError, setEditError] = useState("");
  const prevConnectionIdRef = useRef<string | undefined>(undefined);

  const connectionId = activeMysqlConnection?.id;
  const tables = selectedDatabase ? (tablesByDb[selectedDatabase] ?? []) : [];

  // Load databases when connection changes
  useEffect(() => {
    if (!connectionId) {
      setDatabases([]);
      setTablesByDb({});
      setSelectedDatabase(undefined);
      setSelectedTable(undefined);
      setQueryState(defaultQueryState);
      return;
    }
    if (prevConnectionIdRef.current === connectionId) return;
    prevConnectionIdRef.current = connectionId;

    mysqlListDatabases(connectionId)
      .then((dbs) => {
        setDatabases(dbs);
        // Auto-select default database if available
        if (activeMysqlConnection?.database && dbs.includes(activeMysqlConnection.database)) {
          setSelectedDatabase(activeMysqlConnection.database);
        }
      })
      .catch(() => setDatabases([]));
  }, [connectionId, activeMysqlConnection?.database]);

  // Load tables when database changes
  useEffect(() => {
    if (!connectionId || !selectedDatabase) {
      setSelectedTable(undefined);
      setQueryState(defaultQueryState);
      return;
    }

    mysqlListTables(connectionId, selectedDatabase)
      .then((tbls) => {
        setTablesByDb((prev) => ({
          ...prev,
          [selectedDatabase]: tbls
        }));
        setSelectedTable(undefined);
        setQueryState(defaultQueryState);
      })
      .catch(() => {
        setTablesByDb((prev) => ({
          ...prev,
          [selectedDatabase]: []
        }));
      });
  }, [connectionId, selectedDatabase]);

  // Query data when table or page changes
  const fetchData = useCallback(async (page?: number, pageSize?: number) => {
    if (!connectionId || !selectedDatabase || !selectedTable) return;

    const currentPage = page ?? queryState.page;
    const currentSize = pageSize ?? queryState.pageSize;
    const offset = (currentPage - 1) * currentSize;

    setQueryState((prev) => ({ ...prev, loading: true, error: "" }));

    try {
      // Get count
      const countResult = await mysqlQuery(
        connectionId,
        `SELECT COUNT(*) as cnt FROM \`${selectedDatabase}\`.\`${selectedTable}\``
      );
      const total = countResult.isResultSet && countResult.rows.length > 0
        ? Number(countResult.rows[0][0]) || 0
        : 0;

      // Get data
      const dataResult = await mysqlQuery(
        connectionId,
        `SELECT * FROM \`${selectedDatabase}\`.\`${selectedTable}\` LIMIT ${offset}, ${currentSize}`
      );

      setQueryState({
        columns: dataResult.columns,
        rows: dataResult.rows,
        total,
        page: currentPage,
        pageSize: currentSize,
        loading: false,
        error: ""
      });
    } catch (err) {
      setQueryState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  }, [connectionId, selectedDatabase, selectedTable, queryState.page, queryState.pageSize]);

  // Auto-query when table selected
  useEffect(() => {
    if (!selectedTable) return;
    fetchData(1);
  }, [connectionId, selectedDatabase, selectedTable]);

  // Load column meta when table changes
  useEffect(() => {
    if (!connectionId || !selectedDatabase || !selectedTable) {
      setColumnMeta([]);
      return;
    }
    mysqlDescribeTable(connectionId, selectedDatabase, selectedTable)
      .then(setColumnMeta)
      .catch(() => setColumnMeta([]));
  }, [connectionId, selectedDatabase, selectedTable]);

  const totalPages = Math.max(1, Math.ceil(queryState.total / queryState.pageSize));

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    fetchData(newPage);
  };

  const handlePageSizeChange = (newSize: number) => {
    fetchData(1, newSize);
  };

  const handleEditRow = (index: number) => {
    const row = queryState.rows[index];
    const obj: Record<string, unknown> = {};
    queryState.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    setEditingRow({ index, json: JSON.stringify(obj, null, 2) });
    setEditError("");
  };

  const handleSaveEdit = async () => {
    if (!editingRow || !connectionId || !selectedDatabase || !selectedTable) return;

    try {
      const data = JSON.parse(editingRow.json) as Record<string, unknown>;
      const setParts: string[] = [];
      const originalRow = queryState.rows[editingRow.index];

      // Build SET clause from changes
      for (const [col, val] of Object.entries(data)) {
        if (val === null) {
          setParts.push(`\`${col}\` = NULL`);
        } else if (typeof val === "number") {
          setParts.push(`\`${col}\` = ${val}`);
        } else {
          setParts.push(`\`${col}\` = '${String(val).replace(/'/g, "''")}'`);
        }
      }

      // Build WHERE clause using original values (first column as primary key if possible)
      const whereParts: string[] = [];
      const pkCol = columnMeta.find((c) => c.key === "PRI");
      if (pkCol) {
        const colIndex = queryState.columns.indexOf(pkCol.field);
        if (colIndex >= 0) {
          const val = originalRow[colIndex];
          if (val === null) {
            whereParts.push(`\`${pkCol.field}\` IS NULL`);
          } else {
            whereParts.push(`\`${pkCol.field}\` = '${String(val).replace(/'/g, "''")}'`);
          }
        }
      } else {
        // Fallback: use all original columns for WHERE
        queryState.columns.forEach((col, i) => {
          const val = originalRow[i];
          if (val === null) {
            whereParts.push(`\`${col}\` IS NULL`);
          } else {
            whereParts.push(`\`${col}\` = '${String(val).replace(/'/g, "''")}'`);
          }
        });
      }

      if (setParts.length === 0 || whereParts.length === 0) return;

      const sql = `UPDATE \`${selectedDatabase}\`.\`${selectedTable}\` SET ${setParts.join(", ")} WHERE ${whereParts.join(" AND ")} LIMIT 1`;
      await mysqlQuery(connectionId, sql);
      setEditingRow(null);
      fetchData();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteRow = async (index: number) => {
    if (!connectionId || !selectedDatabase || !selectedTable) return;

    const row = queryState.rows[index];
    const whereParts: string[] = [];
    const pkCol = columnMeta.find((c) => c.key === "PRI");

    if (pkCol) {
      const colIndex = queryState.columns.indexOf(pkCol.field);
      if (colIndex >= 0) {
        const val = row[colIndex];
        if (val === null) {
          whereParts.push(`\`${pkCol.field}\` IS NULL`);
        } else {
          whereParts.push(`\`${pkCol.field}\` = '${String(val).replace(/'/g, "''")}'`);
        }
      }
    } else {
      queryState.columns.forEach((col, i) => {
        const val = row[i];
        if (val === null) {
          whereParts.push(`\`${col}\` IS NULL`);
        } else {
          whereParts.push(`\`${col}\` = '${String(val).replace(/'/g, "''")}'`);
        }
      });
    }

    if (whereParts.length === 0) return;

    if (!confirm(t("dataBrowser.deleteConfirm", { docId: String(row[0] ?? index) }))) return;

    try {
      const sql = `DELETE FROM \`${selectedDatabase}\`.\`${selectedTable}\` WHERE ${whereParts.join(" AND ")} LIMIT 1`;
      await mysqlQuery(connectionId, sql);
      fetchData();
    } catch (err) {
      setQueryState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err)
      }));
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
      {/* Controls bar */}
      <div className="card" style={{ padding: "12px 16px", marginBottom: "12px" }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label style={{ fontWeight: 500, fontSize: "13px", whiteSpace: "nowrap" }}>{t("mysql.data.selectDatabase")}:</label>
            <select
              className="form-control"
              style={{ minWidth: "160px" }}
              value={selectedDatabase ?? ""}
              onChange={(e) => setSelectedDatabase(e.target.value || undefined)}
            >
              <option value="">--</option>
              {databases.map((db) => (
                <option key={db} value={db}>{db}</option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <label style={{ fontWeight: 500, fontSize: "13px", whiteSpace: "nowrap" }}>{t("mysql.data.selectTable")}:</label>
            <select
              className="form-control"
              style={{ minWidth: "160px" }}
              value={selectedTable ?? ""}
              onChange={(e) => setSelectedTable(e.target.value || undefined)}
            >
              <option value="">--</option>
              {tables.map((tbl) => (
                <option key={tbl} value={tbl}>{tbl}</option>
              ))}
            </select>
          </div>

          <button className="btn btn-sm btn-secondary" onClick={() => fetchData()} disabled={!selectedTable || queryState.loading}>
            {queryState.loading ? t("common.loading") : t("common.refresh")}
          </button>

          {selectedTable && columnMeta.length > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={() => setShowStructure(!showStructure)}>
              {showStructure ? t("mysql.data.hideStructure") : t("mysql.data.showStructure")}
            </button>
          )}
        </div>
      </div>

      {/* Table structure */}
      {showStructure && columnMeta.length > 0 && (
        <div className="card" style={{ marginBottom: "12px" }}>
          <div className="card-header">
            <h3 className="card-title">{t("mysql.data.columns")}</h3>
          </div>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Type</th>
                  <th>Null</th>
                  <th>Key</th>
                  <th>Default</th>
                  <th>Extra</th>
                </tr>
              </thead>
              <tbody>
                {columnMeta.map((col) => (
                  <tr key={col.field}>
                    <td style={{ fontWeight: col.key === "PRI" ? 600 : 400 }}>{col.field}</td>
                    <td><span className="pill">{col.type}</span></td>
                    <td>{col.null}</td>
                    <td>{col.key && <span className="pill">{col.key}</span>}</td>
                    <td className="muted">{col.default ?? "NULL"}</td>
                    <td className="muted">{col.extra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Query error */}
      {queryState.error && (
        <div className="text-danger" style={{ marginBottom: "12px", padding: "8px 12px", background: "#fef2f2", borderRadius: "8px" }}>
          {queryState.error}
        </div>
      )}

      {/* Data table */}
      {selectedTable && (
        <div className="card">
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="card-title">
              {selectedDatabase}.{selectedTable}
              <span className="muted" style={{ fontWeight: 400, fontSize: "13px", marginLeft: "8px" }}>
                ({queryState.total} {t("mysql.data.rowCount")})
              </span>
            </h3>
          </div>

          <div className="table-wrapper" style={{ maxHeight: "calc(100vh - 340px)", overflow: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: "50px" }}>#</th>
                  {queryState.columns.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                  <th style={{ width: "100px", textAlign: "right" }}>{t("dataBrowser.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {queryState.rows.map((row, rowIndex) => (
                  <>
                    <tr key={rowIndex}>
                      <td className="muted">{(queryState.page - 1) * queryState.pageSize + rowIndex + 1}</td>
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          style={{ maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={cell === null ? "NULL" : String(cell)}
                        >
                          {cell === null ? <span className="muted">NULL</span> : String(cell)}
                        </td>
                      ))}
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "flex", gap: "4px", justifyContent: "flex-end" }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => setExpandedRow(expandedRow === rowIndex ? null : rowIndex)}>
                            {expandedRow === rowIndex ? "▲" : "▼"}
                          </button>
                          <button className="btn btn-sm btn-ghost" onClick={() => handleEditRow(rowIndex)}>{t("common.edit")}</button>
                          <button className="btn btn-sm btn-ghost text-danger" onClick={() => handleDeleteRow(rowIndex)}>{t("common.delete")}</button>
                        </div>
                      </td>
                    </tr>
                    {expandedRow === rowIndex && (
                      <tr key={`${rowIndex}-expanded`}>
                        <td colSpan={queryState.columns.length + 2}>
                          <pre style={{ background: "#f5f7fb", padding: "12px", borderRadius: "8px", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>
                            {JSON.stringify(
                              Object.fromEntries(queryState.columns.map((col, i) => [col, row[i]])),
                              null,
                              2
                            )}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {queryState.rows.length === 0 && !queryState.loading && (
                  <tr>
                    <td colSpan={queryState.columns.length + 2} className="muted" style={{ textAlign: "center", padding: "32px" }}>
                      {t("common.noData")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid #e5e5ea" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" }}>
              <span>{t("dataBrowser.pageSize")}:</span>
              <select className="form-control" style={{ width: "80px" }} value={queryState.pageSize} onChange={(e) => handlePageSizeChange(Number(e.target.value))}>
                {[50, 100, 200, 500].map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" }}>
              <button className="btn btn-sm btn-ghost" disabled={queryState.page <= 1} onClick={() => handlePageChange(queryState.page - 1)}>
                {t("dataBrowser.previousPage")}
              </button>
              <span>{queryState.page} / {totalPages}</span>
              <button className="btn btn-sm btn-ghost" disabled={queryState.page >= totalPages} onClick={() => handlePageChange(queryState.page + 1)}>
                {t("dataBrowser.nextPage")}
              </button>
            </div>
          </div>
        </div>
      )}

      {!selectedTable && (
        <div className="card" style={{ padding: "32px", textAlign: "center" }}>
          <span className="muted">{t("mysql.data.selectTableHint")}</span>
        </div>
      )}

      {/* Edit modal */}
      {editingRow && (
        <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: "600px", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 className="card-title">{t("dataBrowser.editDocument")}</h3>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditingRow(null)}>{t("common.close")}</button>
            </div>
            <div style={{ flex: 1, padding: "16px", overflow: "auto" }}>
              <textarea
                className="json-editor"
                style={{ width: "100%", minHeight: "300px", fontFamily: "monospace", fontSize: "13px", padding: "12px", border: "1px solid #d1d1d6", borderRadius: "8px", resize: "vertical" }}
                value={editingRow.json}
                onChange={(e) => setEditingRow({ ...editingRow, json: e.target.value })}
              />
              {editError && <div className="text-danger" style={{ marginTop: "8px" }}>{editError}</div>}
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid #e5e5ea", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditingRow(null)}>{t("common.cancel")}</button>
              <button className="btn btn-sm btn-primary" onClick={handleSaveEdit}>{t("common.save")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
