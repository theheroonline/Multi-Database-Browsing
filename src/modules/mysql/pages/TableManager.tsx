import { type MouseEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { useMysqlContext } from "../../../state/MysqlContext";
import { mysqlDescribeTable, mysqlListDatabases, mysqlListTables, mysqlQuery } from "../services/client";
import type { ColumnMeta } from "../types";

interface TableInfo {
  database: string;
  table: string;
  columns?: ColumnMeta[];
  rowCount?: number;
  loading: boolean;
}

interface DataState {
  columns: string[];
  rows: Array<Array<unknown>>;
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  error: string;
}

const defaultDataState: DataState = {
  columns: [],
  rows: [],
  total: 0,
  page: 1,
  pageSize: 100,
  loading: false,
  error: ""
};

type RightPanelTab = "structure" | "data";

interface TreeContextMenu {
  type: "database" | "table";
  db: string;
  table?: string;
  x: number;
  y: number;
}

type ColumnEditMode = "add" | "edit";

interface ColumnEditForm {
  field: string;
  type: string;
  nullable: boolean;
  defaultValue: string;
  extra: string;
}

export default function MysqlTableManager() {
  const { t } = useTranslation();
  const location = useLocation();
  const {
    activeMysqlConnection,
    selectedDatabase,
    selectedTable,
    setSelectedDatabase,
    setSelectedTable,
    setDatabases: setContextDatabases,
    setTablesByDb: setContextTablesByDb
  } = useMysqlContext();

  const [databases, setDatabases] = useState<string[]>([]);
  const [tablesMap, setTablesMap] = useState<Record<string, string[]>>({});
  const [expandedDb, setExpandedDb] = useState<string | null>(null);
  const [selectedTableInfo, setSelectedTableInfo] = useState<TableInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Right panel tab
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("structure");

  // Tree context menu
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenu | null>(null);

  // Data browsing state
  const [dataState, setDataState] = useState<DataState>(defaultDataState);
  const [dataColumnMeta, setDataColumnMeta] = useState<ColumnMeta[]>([]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [editingRow, setEditingRow] = useState<{ index: number; json: string } | null>(null);
  const [editError, setEditError] = useState("");

  // SQL execution modal state
  const [sqlModalOpen, setSqlModalOpen] = useState(false);
  const [sqlModalValue, setSqlModalValue] = useState("");
  const [sqlModalResult, setSqlModalResult] = useState("");
  const [sqlModalLoading, setSqlModalLoading] = useState(false);

  const [columnEditOpen, setColumnEditOpen] = useState(false);
  const [columnEditMode, setColumnEditMode] = useState<ColumnEditMode>("add");
  const [columnEditOriginalField, setColumnEditOriginalField] = useState<string>("");
  const [columnEditForm, setColumnEditForm] = useState<ColumnEditForm>({
    field: "",
    type: "varchar(255)",
    nullable: true,
    defaultValue: "",
    extra: ""
  });
  const [columnEditLoading, setColumnEditLoading] = useState(false);
  const [columnEditError, setColumnEditError] = useState("");

  const connectionId = activeMysqlConnection?.id;

  // ─── Database / Table tree logic ───

  const refreshDatabases = useCallback(async () => {
    if (!connectionId) return;
    setLoading(true);
    try {
      const dbs = await mysqlListDatabases(connectionId);
      setDatabases(dbs);
      setContextDatabases(dbs);
      setContextTablesByDb((prev) => {
        const next: Record<string, string[]> = {};
        dbs.forEach((db) => {
          if (prev[db]) {
            next[db] = prev[db];
          }
        });
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connectionId, setContextDatabases, setContextTablesByDb]);

  useEffect(() => {
    refreshDatabases();
  }, [refreshDatabases]);

  const handleExpandDb = async (db: string) => {
    if (expandedDb === db) {
      setExpandedDb(null);
      return;
    }
    setExpandedDb(db);

    if (tablesMap[db]) return;
    if (!connectionId) return;

    try {
      const tbls = await mysqlListTables(connectionId, db);
      setTablesMap((prev) => ({ ...prev, [db]: tbls }));
    } catch {
      setTablesMap((prev) => ({ ...prev, [db]: [] }));
    }
  };

  const refreshTablesForDb = async (db: string) => {
    if (!connectionId) return;
    try {
      const tbls = await mysqlListTables(connectionId, db);
      setTablesMap((prev) => ({ ...prev, [db]: tbls }));
    } catch {
      setTablesMap((prev) => ({ ...prev, [db]: [] }));
    }
  };

  // ─── Select table (show structure) ───

  const handleSelectTable = async (db: string, table: string) => {
    if (!connectionId) return;

    setSelectedDatabase(db);
    setSelectedTable(table);

    setSelectedTableInfo({ database: db, table, loading: true });
    setRightPanelTab("structure");

    try {
      const [columns, countResult] = await Promise.all([
        mysqlDescribeTable(connectionId, db, table),
        mysqlQuery(connectionId, `SELECT COUNT(*) as cnt FROM \`${db}\`.\`${table}\``)
      ]);

      const rowCount = countResult.isResultSet && countResult.rows.length > 0
        ? Number(countResult.rows[0][0]) || 0
        : 0;

      setSelectedTableInfo({ database: db, table, columns, rowCount, loading: false });
    } catch (err) {
      setSelectedTableInfo({ database: db, table, loading: false });
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // ─── Browse data (show data tab) ───

  const handleBrowseData = async (db: string, table: string) => {
    if (!connectionId) return;

    setSelectedDatabase(db);
    setSelectedTable(table);

    // Select the table info first if not already selected
    if (selectedTableInfo?.database !== db || selectedTableInfo?.table !== table) {
      setSelectedTableInfo({ database: db, table, loading: true });
      try {
        const [columns, countResult] = await Promise.all([
          mysqlDescribeTable(connectionId, db, table),
          mysqlQuery(connectionId, `SELECT COUNT(*) as cnt FROM \`${db}\`.\`${table}\``)
        ]);
        const rowCount = countResult.isResultSet && countResult.rows.length > 0
          ? Number(countResult.rows[0][0]) || 0
          : 0;
        setSelectedTableInfo({ database: db, table, columns, rowCount, loading: false });
      } catch (err) {
        setSelectedTableInfo({ database: db, table, loading: false });
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    setRightPanelTab("data");

    // Fetch column meta for data editing
    try {
      const meta = await mysqlDescribeTable(connectionId, db, table);
      setDataColumnMeta(meta);
    } catch {
      setDataColumnMeta([]);
    }

    // Fetch first page of data
    fetchData(db, table, 1, defaultDataState.pageSize);
  };

  useEffect(() => {
    if (!connectionId) return;

    if (!selectedDatabase || !selectedTable) {
      setSelectedTableInfo(null);
      setDataState(defaultDataState);
      return;
    }

    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    if (tab === "data") {
      handleBrowseData(selectedDatabase, selectedTable);
      return;
    }

    handleSelectTable(selectedDatabase, selectedTable);
  }, [connectionId, selectedDatabase, selectedTable, location.search]);

  const fetchData = useCallback(async (
    db?: string,
    table?: string,
    page?: number,
    pageSize?: number
  ) => {
    const targetDb = db ?? selectedTableInfo?.database;
    const targetTable = table ?? selectedTableInfo?.table;
    if (!connectionId || !targetDb || !targetTable) return;

    const currentPage = page ?? dataState.page;
    const currentSize = pageSize ?? dataState.pageSize;
    const offset = (currentPage - 1) * currentSize;

    setDataState((prev) => ({ ...prev, loading: true, error: "" }));

    try {
      const countResult = await mysqlQuery(
        connectionId,
        `SELECT COUNT(*) as cnt FROM \`${targetDb}\`.\`${targetTable}\``
      );
      const total = countResult.isResultSet && countResult.rows.length > 0
        ? Number(countResult.rows[0][0]) || 0
        : 0;

      const dataResult = await mysqlQuery(
        connectionId,
        `SELECT * FROM \`${targetDb}\`.\`${targetTable}\` LIMIT ${offset}, ${currentSize}`
      );

      setDataState({
        columns: dataResult.columns,
        rows: dataResult.rows,
        total,
        page: currentPage,
        pageSize: currentSize,
        loading: false,
        error: ""
      });
    } catch (err) {
      setDataState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  }, [connectionId, selectedTableInfo?.database, selectedTableInfo?.table, dataState.page, dataState.pageSize]);

  // ─── Data pagination ───

  const totalPages = Math.max(1, Math.ceil(dataState.total / dataState.pageSize));

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    fetchData(undefined, undefined, newPage);
  };

  const handlePageSizeChange = (newSize: number) => {
    fetchData(undefined, undefined, 1, newSize);
  };

  // ─── Data editing ───

  const handleEditRow = (index: number) => {
    const row = dataState.rows[index];
    const obj: Record<string, unknown> = {};
    dataState.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    setEditingRow({ index, json: JSON.stringify(obj, null, 2) });
    setEditError("");
  };

  const handleSaveEdit = async () => {
    if (!editingRow || !connectionId || !selectedTableInfo) return;
    const { database: db, table } = selectedTableInfo;

    try {
      const data = JSON.parse(editingRow.json) as Record<string, unknown>;
      const setParts: string[] = [];
      const originalRow = dataState.rows[editingRow.index];

      for (const [col, val] of Object.entries(data)) {
        if (val === null) {
          setParts.push(`\`${col}\` = NULL`);
        } else if (typeof val === "number") {
          setParts.push(`\`${col}\` = ${val}`);
        } else {
          setParts.push(`\`${col}\` = '${String(val).replace(/'/g, "''")}'`);
        }
      }

      const whereParts: string[] = [];
      const pkCol = dataColumnMeta.find((c) => c.key === "PRI");
      if (pkCol) {
        const colIndex = dataState.columns.indexOf(pkCol.field);
        if (colIndex >= 0) {
          const val = originalRow[colIndex];
          if (val === null) {
            whereParts.push(`\`${pkCol.field}\` IS NULL`);
          } else {
            whereParts.push(`\`${pkCol.field}\` = '${String(val).replace(/'/g, "''")}'`);
          }
        }
      } else {
        dataState.columns.forEach((col, i) => {
          const val = originalRow[i];
          if (val === null) {
            whereParts.push(`\`${col}\` IS NULL`);
          } else {
            whereParts.push(`\`${col}\` = '${String(val).replace(/'/g, "''")}'`);
          }
        });
      }

      if (setParts.length === 0 || whereParts.length === 0) return;

      const sql = `UPDATE \`${db}\`.\`${table}\` SET ${setParts.join(", ")} WHERE ${whereParts.join(" AND ")} LIMIT 1`;
      await mysqlQuery(connectionId, sql);
      setEditingRow(null);
      fetchData();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteRow = async (index: number) => {
    if (!connectionId || !selectedTableInfo) return;
    const { database: db, table } = selectedTableInfo;

    const row = dataState.rows[index];
    const whereParts: string[] = [];
    const pkCol = dataColumnMeta.find((c) => c.key === "PRI");

    if (pkCol) {
      const colIndex = dataState.columns.indexOf(pkCol.field);
      if (colIndex >= 0) {
        const val = row[colIndex];
        if (val === null) {
          whereParts.push(`\`${pkCol.field}\` IS NULL`);
        } else {
          whereParts.push(`\`${pkCol.field}\` = '${String(val).replace(/'/g, "''")}'`);
        }
      }
    } else {
      dataState.columns.forEach((col, i) => {
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
      const sql = `DELETE FROM \`${db}\`.\`${table}\` WHERE ${whereParts.join(" AND ")} LIMIT 1`;
      await mysqlQuery(connectionId, sql);
      fetchData();
    } catch (err) {
      setDataState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  };

  // ─── Table operations ───

  const handleDropTable = async (db: string, table: string) => {
    if (!connectionId) return;
    if (!confirm(`Drop table \`${db}\`.\`${table}\`? This cannot be undone.`)) return;

    try {
      await mysqlQuery(connectionId, `DROP TABLE \`${db}\`.\`${table}\``);
      setTablesMap((prev) => ({
        ...prev,
        [db]: (prev[db] ?? []).filter((t) => t !== table)
      }));
      if (selectedTableInfo?.database === db && selectedTableInfo?.table === table) {
        setSelectedTableInfo(null);
        setDataState(defaultDataState);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTruncateTable = async (db: string, table: string) => {
    if (!connectionId) return;
    if (!confirm(`Truncate table \`${db}\`.\`${table}\`? All data will be deleted.`)) return;

    try {
      await mysqlQuery(connectionId, `TRUNCATE TABLE \`${db}\`.\`${table}\``);
      if (selectedTableInfo?.database === db && selectedTableInfo?.table === table) {
        handleSelectTable(db, table);
        if (rightPanelTab === "data") {
          fetchData(db, table, 1);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDropDatabase = async (db: string) => {
    if (!connectionId) return;
    if (!confirm(`Drop database \`${db}\`? This cannot be undone!`)) return;

    try {
      await mysqlQuery(connectionId, `DROP DATABASE \`${db}\``);
      setDatabases((prev) => prev.filter((d) => d !== db));
      setTablesMap((prev) => {
        const next = { ...prev };
        delete next[db];
        return next;
      });
      if (expandedDb === db) setExpandedDb(null);
      if (selectedTableInfo?.database === db) {
        setSelectedTableInfo(null);
        setDataState(defaultDataState);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // ─── Context menu ───

  const handleDbContextMenu = (e: MouseEvent, db: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTreeContextMenu({ type: "database", db, x: e.clientX, y: e.clientY });
  };

  const handleTableContextMenu = (e: MouseEvent, db: string, table: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTreeContextMenu({ type: "table", db, table, x: e.clientX, y: e.clientY });
  };

  // Close context menu on outside click / scroll / resize
  useEffect(() => {
    if (!treeContextMenu) return;
    const close = () => setTreeContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [treeContextMenu]);

  // ─── SQL modal ───

  const openSqlModal = (prefill?: string) => {
    setSqlModalValue(prefill ?? "");
    setSqlModalResult("");
    setSqlModalOpen(true);
  };

  const executeSqlModal = async () => {
    if (!connectionId || !sqlModalValue.trim()) return;
    setSqlModalLoading(true);
    setSqlModalResult("");

    try {
      const res = await mysqlQuery(connectionId, sqlModalValue.trim());
      if (res.isResultSet) {
        setSqlModalResult(`Result: ${res.rows.length} rows returned`);
      } else {
        setSqlModalResult(`Done. Affected rows: ${res.affectedRows}`);
      }
      refreshDatabases();
      if (selectedDatabase) {
        refreshTablesForDb(selectedDatabase);
      }
    } catch (err) {
      setSqlModalResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSqlModalLoading(false);
    }
  };

  const openAddColumnModal = () => {
    setColumnEditMode("add");
    setColumnEditOriginalField("");
    setColumnEditForm({
      field: "",
      type: "varchar(255)",
      nullable: true,
      defaultValue: "",
      extra: ""
    });
    setColumnEditError("");
    setColumnEditOpen(true);
  };

  const openEditColumnModal = (column: ColumnMeta) => {
    setColumnEditMode("edit");
    setColumnEditOriginalField(column.field);
    setColumnEditForm({
      field: column.field,
      type: column.type,
      nullable: column.null === "YES",
      defaultValue: column.default ?? "",
      extra: column.extra ?? ""
    });
    setColumnEditError("");
    setColumnEditOpen(true);
  };

  const buildDefaultClause = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/^null$/i.test(trimmed)) return " DEFAULT NULL";
    if (/^(current_timestamp(?:\(\))?|now\(\))$/i.test(trimmed)) {
      return ` DEFAULT ${trimmed}`;
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return ` DEFAULT ${trimmed}`;
    }
    return ` DEFAULT '${trimmed.replace(/'/g, "''")}'`;
  };

  const refreshSelectedTableInfo = async () => {
    if (!selectedTableInfo) return;
    await handleSelectTable(selectedTableInfo.database, selectedTableInfo.table);
    if (rightPanelTab === "data") {
      await fetchData(selectedTableInfo.database, selectedTableInfo.table, 1, dataState.pageSize);
    }
  };

  const handleSaveColumnEdit = async () => {
    if (!connectionId || !selectedTableInfo) return;

    const field = columnEditForm.field.trim();
    const type = columnEditForm.type.trim();
    const extra = columnEditForm.extra.trim();
    if (!field || !type) {
      setColumnEditError(t("connections.nameAndAddressRequired"));
      return;
    }

    const nullClause = columnEditForm.nullable ? " NULL" : " NOT NULL";
    const defaultClause = buildDefaultClause(columnEditForm.defaultValue);
    const extraClause = extra ? ` ${extra}` : "";

    const definition = `\`${field}\` ${type}${nullClause}${defaultClause}${extraClause}`;
    const sql = columnEditMode === "add"
      ? `ALTER TABLE \`${selectedTableInfo.database}\`.\`${selectedTableInfo.table}\` ADD COLUMN ${definition}`
      : `ALTER TABLE \`${selectedTableInfo.database}\`.\`${selectedTableInfo.table}\` MODIFY COLUMN ${definition}`;

    try {
      setColumnEditLoading(true);
      setColumnEditError("");
      await mysqlQuery(connectionId, sql);
      setColumnEditOpen(false);
      await refreshSelectedTableInfo();
    } catch (err) {
      setColumnEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setColumnEditLoading(false);
    }
  };

  const handleDropColumn = async (column: ColumnMeta) => {
    if (!connectionId || !selectedTableInfo) return;
    if (!confirm(`Drop column \`${column.field}\` from \`${selectedTableInfo.database}\`.\`${selectedTableInfo.table}\`?`)) return;

    try {
      await mysqlQuery(
        connectionId,
        `ALTER TABLE \`${selectedTableInfo.database}\`.\`${selectedTableInfo.table}\` DROP COLUMN \`${column.field}\``
      );
      await refreshSelectedTableInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // ─── Render ───

  if (!activeMysqlConnection) {
    return (
      <div className="page">
        <div className="card" style={{ padding: "32px", textAlign: "center" }}>
          <span className="muted">{t("mysql.query.noMysqlConnection")}</span>
        </div>
      </div>
    );
  }

  const renderStructureTab = () => {
    if (!selectedTableInfo) return null;

    if (selectedTableInfo.loading) {
      return (
        <div style={{ padding: "32px", textAlign: "center" }}>
          <span className="muted">{t("common.loading")}</span>
        </div>
      );
    }

    if (!selectedTableInfo.columns) {
      return (
        <div style={{ padding: "32px", textAlign: "center" }}>
          <span className="muted">{t("common.noData")}</span>
        </div>
      );
    }

    return (
      <div className="table-wrapper">
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px" }}>
          <button className="btn btn-sm btn-primary" onClick={openAddColumnModal}>
            {t("mysql.tableManager.addColumn")}
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Type</th>
              <th>Null</th>
              <th>Key</th>
              <th>Default</th>
              <th>Extra</th>
              <th style={{ textAlign: "right", width: "180px" }}>{t("dataBrowser.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {selectedTableInfo.columns.map((col) => (
              <tr key={col.field}>
                <td style={{ fontWeight: col.key === "PRI" ? 600 : 400 }}>{col.field}</td>
                <td><span className="pill">{col.type}</span></td>
                <td>{col.null}</td>
                <td>{col.key && <span className="pill">{col.key}</span>}</td>
                <td className="muted">{col.default ?? "NULL"}</td>
                <td className="muted">{col.extra}</td>
                <td style={{ textAlign: "right" }}>
                  <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => openEditColumnModal(col)}>
                      {t("mysql.tableManager.editStructure")}
                    </button>
                    <button className="btn btn-sm btn-ghost text-danger" onClick={() => handleDropColumn(col)}>
                      {t("mysql.tableManager.dropColumn")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderDataTab = () => {
    if (!selectedTableInfo) return null;

    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {/* Data error */}
        {dataState.error && (
          <div className="text-danger" style={{ margin: "8px 12px", padding: "8px 12px", background: "#fef2f2", borderRadius: "8px" }}>
            {dataState.error}
          </div>
        )}

        {/* Data table */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: "50px" }}>#</th>
                {dataState.columns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
                <th style={{ width: "100px", textAlign: "right" }}>{t("dataBrowser.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {dataState.rows.map((row, rowIndex) => (
                <>
                  <tr key={rowIndex}>
                    <td className="muted">{(dataState.page - 1) * dataState.pageSize + rowIndex + 1}</td>
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
                      <td colSpan={dataState.columns.length + 2}>
                        <pre style={{ background: "#f5f7fb", padding: "12px", borderRadius: "8px", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>
                          {JSON.stringify(
                            Object.fromEntries(dataState.columns.map((col, i) => [col, row[i]])),
                            null,
                            2
                          )}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {dataState.rows.length === 0 && !dataState.loading && (
                <tr>
                  <td colSpan={dataState.columns.length + 2} className="muted" style={{ textAlign: "center", padding: "32px" }}>
                    {t("common.noData")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderTop: "1px solid #e5e5ea", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" }}>
            <span>{t("dataBrowser.pageSize")}:</span>
            <select className="form-control" style={{ width: "80px" }} value={dataState.pageSize} onChange={(e) => handlePageSizeChange(Number(e.target.value))}>
              {[50, 100, 200, 500].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" }}>
            <button className="btn btn-sm btn-ghost" disabled={dataState.page <= 1} onClick={() => handlePageChange(dataState.page - 1)}>
              {t("dataBrowser.previousPage")}
            </button>
            <span>{dataState.page} / {totalPages}</span>
            <button className="btn btn-sm btn-ghost" disabled={dataState.page >= totalPages} onClick={() => handlePageChange(dataState.page + 1)}>
              {t("dataBrowser.nextPage")}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      <div style={{ display: "flex", gap: "12px", height: "calc(100vh - 160px)" }}>
        {/* Left panel - Database/Table tree */}
        <div className="card" style={{ display: "none" }}>
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="card-title">{t("mysql.tableManager.databases")}</h3>
            <div style={{ display: "flex", gap: "4px" }}>
              <button className="btn btn-sm btn-ghost" onClick={() => refreshDatabases()} disabled={loading}>
                {t("common.refresh")}
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => openSqlModal("CREATE DATABASE `new_db`;")}>
                +
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
            {databases.map((db) => (
              <div key={db}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 12px",
                    cursor: "pointer",
                    fontSize: "13px",
                    background: expandedDb === db ? "#f0f0f5" : "transparent",
                    borderRadius: "6px",
                    margin: "1px 4px"
                  }}
                  onClick={() => handleExpandDb(db)}
                  onContextMenu={(e) => handleDbContextMenu(e, db)}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>{expandedDb === db ? "▾" : "▸"}</span>
                    <span style={{ fontWeight: expandedDb === db ? 500 : 400 }}>{db}</span>
                  </span>
                  {tablesMap[db] && (
                    <span className="muted" style={{ fontSize: "11px" }}>{tablesMap[db].length}</span>
                  )}
                </div>

                {expandedDb === db && tablesMap[db] && (
                  <div style={{ paddingLeft: "24px" }}>
                    {tablesMap[db].map((table) => (
                      <div
                        key={table}
                        style={{
                          padding: "4px 12px",
                          cursor: "pointer",
                          fontSize: "13px",
                          borderRadius: "4px",
                          margin: "1px 0",
                          background: selectedTableInfo?.database === db && selectedTableInfo?.table === table ? "#e8e8ed" : "transparent"
                        }}
                        onClick={() => handleSelectTable(db, table)}
                        onDoubleClick={() => handleBrowseData(db, table)}
                        onContextMenu={(e) => handleTableContextMenu(e, db, table)}
                      >
                        {table}
                      </div>
                    ))}
                    {tablesMap[db].length === 0 && (
                      <div className="muted" style={{ padding: "4px 12px", fontSize: "12px" }}>{t("mysql.data.noTables")}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {databases.length === 0 && !loading && (
              <div className="muted" style={{ padding: "16px", textAlign: "center", fontSize: "13px" }}>
                {t("common.noData")}
              </div>
            )}
          </div>
        </div>

        {/* Right panel - Structure / Data */}
        <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {selectedTableInfo ? (
            <>
              {/* Header with table name and action buttons */}
              <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3 className="card-title">
                  {selectedTableInfo.database}.{selectedTableInfo.table}
                  {selectedTableInfo.rowCount !== undefined && (
                    <span className="muted" style={{ fontWeight: 400, fontSize: "13px", marginLeft: "8px" }}>
                      ({selectedTableInfo.rowCount} {t("mysql.data.rowCount")})
                    </span>
                  )}
                </h3>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => openSqlModal(`CREATE TABLE \`${selectedTableInfo.database}\`.\`new_table\` (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  name VARCHAR(255)\n);`)}>
                    {t("mysql.tableManager.createTable")}
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => handleTruncateTable(selectedTableInfo.database, selectedTableInfo.table)}>
                    {t("mysql.tableManager.truncate")}
                  </button>
                  <button className="btn btn-sm btn-ghost text-danger" onClick={() => handleDropTable(selectedTableInfo.database, selectedTableInfo.table)}>
                    {t("mysql.tableManager.dropTable")}
                  </button>
                </div>
              </div>

              {/* Tab switcher */}
              <div style={{ display: "flex", gap: "0", borderBottom: "1px solid #e5e5ea", padding: "0 16px", flexShrink: 0 }}>
                <button
                  className={`btn btn-sm ${rightPanelTab === "structure" ? "btn-primary" : "btn-ghost"}`}
                  style={{ borderRadius: "6px 6px 0 0", borderBottom: rightPanelTab === "structure" ? "2px solid #007aff" : "2px solid transparent" }}
                  onClick={() => setRightPanelTab("structure")}
                >
                  {t("mysql.tableManager.structure")}
                </button>
                <button
                  className={`btn btn-sm ${rightPanelTab === "data" ? "btn-primary" : "btn-ghost"}`}
                  style={{ borderRadius: "6px 6px 0 0", borderBottom: rightPanelTab === "data" ? "2px solid #007aff" : "2px solid transparent" }}
                  onClick={() => {
                    if (rightPanelTab !== "data") {
                      handleBrowseData(selectedTableInfo.database, selectedTableInfo.table);
                    }
                  }}
                >
                  {t("mysql.tableManager.data")}
                </button>
                {rightPanelTab === "data" && (
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ marginLeft: "auto" }}
                    onClick={() => fetchData()}
                    disabled={dataState.loading}
                  >
                    {dataState.loading ? t("common.loading") : t("common.refresh")}
                  </button>
                )}
              </div>

              {/* Tab content */}
              <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
                {rightPanelTab === "structure" ? renderStructureTab() : renderDataTab()}
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span className="muted">{t("mysql.tableManager.selectTableDataHint")}</span>
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-danger" style={{ marginTop: "12px", padding: "8px 12px", background: "#fef2f2", borderRadius: "8px" }}>
          {error}
          <button className="btn btn-sm btn-ghost" style={{ marginLeft: "8px" }} onClick={() => setError("")}>{t("common.close")}</button>
        </div>
      )}

      {/* Tree context menu */}
      {treeContextMenu && (
        <div
          style={{
            position: "fixed",
            left: `${treeContextMenu.x}px`,
            top: `${treeContextMenu.y}px`,
            zIndex: 1200,
            minWidth: "140px",
            background: "#fff",
            border: "1px solid #d1d1d6",
            borderRadius: "8px",
            boxShadow: "0 8px 20px rgba(0, 0, 0, 0.12)",
            padding: "4px"
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {treeContextMenu.type === "database" ? (
            <>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ width: "100%", justifyContent: "flex-start" }}
                onClick={() => {
                  const db = treeContextMenu.db;
                  setTreeContextMenu(null);
                  refreshTablesForDb(db);
                  if (expandedDb !== db) setExpandedDb(db);
                }}
              >
                {t("mysql.tableManager.refreshTables")}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ width: "100%", justifyContent: "flex-start" }}
                onClick={() => {
                  const db = treeContextMenu.db;
                  setTreeContextMenu(null);
                  openSqlModal(`CREATE TABLE \`${db}\`.\`new_table\` (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  name VARCHAR(255)\n);`);
                }}
              >
                {t("mysql.tableManager.createTable")}
              </button>
              <div style={{ height: "1px", background: "#e5e5ea", margin: "4px 0" }} />
              <button
                type="button"
                className="btn btn-sm btn-ghost text-danger"
                style={{ width: "100%", justifyContent: "flex-start" }}
                onClick={() => {
                  const db = treeContextMenu.db;
                  setTreeContextMenu(null);
                  handleDropDatabase(db);
                }}
              >
                {t("mysql.tableManager.dropDatabase")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ width: "100%", justifyContent: "flex-start" }}
                onClick={() => {
                  const { db, table } = treeContextMenu;
                  setTreeContextMenu(null);
                  handleBrowseData(db, table!);
                }}
              >
                {t("mysql.tableManager.browseData")}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ width: "100%", justifyContent: "flex-start" }}
                onClick={() => {
                  const { db, table } = treeContextMenu;
                  setTreeContextMenu(null);
                  handleSelectTable(db, table!);
                }}
              >
                {t("mysql.tableManager.viewStructure")}
              </button>
              <div style={{ height: "1px", background: "#e5e5ea", margin: "4px 0" }} />
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ width: "100%", justifyContent: "flex-start" }}
                onClick={() => {
                  const { db, table } = treeContextMenu;
                  setTreeContextMenu(null);
                  handleTruncateTable(db, table!);
                }}
              >
                {t("mysql.tableManager.truncate")}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost text-danger"
                style={{ width: "100%", justifyContent: "flex-start" }}
                onClick={() => {
                  const { db, table } = treeContextMenu;
                  setTreeContextMenu(null);
                  handleDropTable(db, table!);
                }}
              >
                {t("mysql.tableManager.dropTable")}
              </button>
            </>
          )}
        </div>
      )}

      {/* Edit row modal */}
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

      {/* Column edit modal */}
      {columnEditOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: "560px", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 className="card-title">
                {columnEditMode === "add" ? t("mysql.tableManager.addColumn") : t("mysql.tableManager.editStructure")}
              </h3>
              <button className="btn btn-sm btn-ghost" onClick={() => setColumnEditOpen(false)}>{t("common.close")}</button>
            </div>
            <div style={{ padding: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div>
                <label>{t("mysql.tableManager.columnName")}</label>
                <input
                  className="form-control"
                  value={columnEditForm.field}
                  disabled={columnEditMode === "edit" && Boolean(columnEditOriginalField)}
                  onChange={(event) => setColumnEditForm((prev) => ({ ...prev, field: event.target.value }))}
                />
              </div>
              <div>
                <label>{t("mysql.tableManager.columnType")}</label>
                <input
                  className="form-control"
                  value={columnEditForm.type}
                  onChange={(event) => setColumnEditForm((prev) => ({ ...prev, type: event.target.value }))}
                />
              </div>
              <div>
                <label>{t("mysql.tableManager.defaultValue")}</label>
                <input
                  className="form-control"
                  value={columnEditForm.defaultValue}
                  onChange={(event) => setColumnEditForm((prev) => ({ ...prev, defaultValue: event.target.value }))}
                  placeholder="NULL / CURRENT_TIMESTAMP / text"
                />
              </div>
              <div>
                <label>{t("mysql.tableManager.extra")}</label>
                <input
                  className="form-control"
                  value={columnEditForm.extra}
                  onChange={(event) => setColumnEditForm((prev) => ({ ...prev, extra: event.target.value }))}
                  placeholder="AUTO_INCREMENT"
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  id="column-nullable"
                  type="checkbox"
                  checked={columnEditForm.nullable}
                  onChange={(event) => setColumnEditForm((prev) => ({ ...prev, nullable: event.target.checked }))}
                />
                <label htmlFor="column-nullable" style={{ margin: 0 }}>{t("mysql.tableManager.nullable")}</label>
              </div>
            </div>
            {columnEditError && (
              <div className="text-danger" style={{ padding: "0 16px 12px" }}>{columnEditError}</div>
            )}
            <div style={{ padding: "12px 16px", borderTop: "1px solid #e5e5ea", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setColumnEditOpen(false)}>{t("common.cancel")}</button>
              <button className="btn btn-sm btn-primary" onClick={handleSaveColumnEdit} disabled={columnEditLoading}>
                {columnEditLoading ? t("common.loading") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SQL execution modal */}
      {sqlModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: "600px", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 className="card-title">{t("mysql.tableManager.executeSql")}</h3>
              <button className="btn btn-sm btn-ghost" onClick={() => setSqlModalOpen(false)}>{t("common.close")}</button>
            </div>
            <div style={{ flex: 1, padding: "16px", overflow: "auto" }}>
              <textarea
                className="json-editor"
                style={{
                  width: "100%",
                  minHeight: "150px",
                  fontFamily: "monospace",
                  fontSize: "13px",
                  padding: "12px",
                  border: "1px solid #d1d1d6",
                  borderRadius: "8px",
                  resize: "vertical"
                }}
                value={sqlModalValue}
                onChange={(e) => setSqlModalValue(e.target.value)}
                spellCheck={false}
              />
              {sqlModalResult && (
                <div style={{ marginTop: "8px", padding: "8px 12px", background: "#f5f7fb", borderRadius: "8px", fontSize: "13px" }}>
                  {sqlModalResult}
                </div>
              )}
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid #e5e5ea", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setSqlModalOpen(false)}>{t("common.cancel")}</button>
              <button className="btn btn-sm btn-primary" onClick={executeSqlModal} disabled={sqlModalLoading}>
                {sqlModalLoading ? t("common.loading") : t("mysql.query.execute")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
