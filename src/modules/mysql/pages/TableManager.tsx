import { type MouseEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { logError } from "../../../lib/errorLog";
import { getMysqlOpenedTableKey, type MysqlOpenedTable, useMysqlContext } from "../../../state/MysqlContext";
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
  db: string;
  table: string;
  x: number;
  y: number;
}

interface RowContextMenu {
  x: number;
  y: number;
  rowIndex: number;
  column: string;
  value: unknown;
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
  const navigate = useNavigate();
  const {
    activeMysqlConnection,
    setDatabases,
    tablesByDb,
    setTablesByDb,
    expandedDatabase,
    setExpandedDatabase,
    selectedDatabase,
    selectedTable,
    setSelectedDatabase,
    setSelectedTable,
    openedTables,
    setOpenedTables,
    activeOpenedTableKey,
    setActiveOpenedTableKey
  } = useMysqlContext();
  const [selectedTableInfo, setSelectedTableInfo] = useState<TableInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Right panel tab
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("structure");

  // Tree context menu
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenu | null>(null);
  const [rowContextMenu, setRowContextMenu] = useState<RowContextMenu | null>(null);

  // Data browsing state
  const [dataState, setDataState] = useState<DataState>(defaultDataState);
  const [dataColumnMeta, setDataColumnMeta] = useState<ColumnMeta[]>([]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [editingRow, setEditingRow] = useState<{ index: number; json: string } | null>(null);
  const [editError, setEditError] = useState("");
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [sortModalOpen, setSortModalOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState({ column: "", value: "" });
  const [sortDraft, setSortDraft] = useState<{ column: string; direction: "asc" | "desc" }>({
    column: "",
    direction: "asc"
  });

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
  const isTableWorkspace = location.pathname === "/mysql/table";
  const activeOpenedTable = activeOpenedTableKey
    ? openedTables.find((item) => getMysqlOpenedTableKey(item.database, item.table) === activeOpenedTableKey) ?? null
    : null;

  const escapeSqlIdentifier = (value: string) => `\`${value.replace(/`/g, "``")}\``;

  const escapeSqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

  // ─── Database / Table tree logic ───

  const refreshDatabases = useCallback(async () => {
    if (!connectionId) return;
    setLoading(true);
    try {
      const dbs = await mysqlListDatabases(connectionId);
      setDatabases(dbs);
      setTablesByDb((prev) => {
        const next: Record<string, string[]> = {};
        dbs.forEach((db) => {
          if (prev[db]) {
            next[db] = prev[db];
          }
        });
        return next;
      });
      if (expandedDatabase && !dbs.includes(expandedDatabase)) {
        setExpandedDatabase(null);
        setSelectedDatabase(undefined);
        setSelectedTable(undefined);
        setSelectedTableInfo(null);
        setDataState(defaultDataState);
      }
      const remainingOpenedTables = openedTables.filter((item) => dbs.includes(item.database));
      if (remainingOpenedTables.length !== openedTables.length) {
        setOpenedTables(remainingOpenedTables);
        const nextActiveKey = activeOpenedTableKey && remainingOpenedTables.some((item) => getMysqlOpenedTableKey(item.database, item.table) === activeOpenedTableKey)
          ? activeOpenedTableKey
          : null;
        setActiveOpenedTableKey(nextActiveKey);
        setSelectedTableInfo(null);
        setDataState(defaultDataState);
        if (location.pathname === "/mysql/table") {
          const hasActive = activeOpenedTableKey && remainingOpenedTables.some((item) => getMysqlOpenedTableKey(item.database, item.table) === activeOpenedTableKey);
          if (!hasActive) {
            void navigate("/mysql/tables");
          }
        }
      }
    } catch (err) {
      logError(err, {
        source: "mysqlTableManager.refreshDatabases",
        message: "Failed to refresh MySQL database tree"
      });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [activeOpenedTableKey, connectionId, expandedDatabase, location.pathname, navigate, openedTables, setActiveOpenedTableKey, setDatabases, setExpandedDatabase, setOpenedTables, setSelectedDatabase, setSelectedTable, setTablesByDb]);

  useEffect(() => {
    refreshDatabases();
  }, [refreshDatabases]);

  const refreshTablesForDb = useCallback(async (db: string) => {
    if (!connectionId) return;
    try {
      const tbls = await mysqlListTables(connectionId, db);
      setTablesByDb((prev) => ({ ...prev, [db]: tbls }));
      if (selectedTableInfo?.database === db && selectedTableInfo.table && !tbls.includes(selectedTableInfo.table)) {
        setSelectedTableInfo(null);
        setDataState(defaultDataState);
      }
      if (selectedDatabase === db && selectedTable && !tbls.includes(selectedTable)) {
        setSelectedTable(undefined);
      }
      const remainingOpenedTables = openedTables.filter((item) => item.database !== db || tbls.includes(item.table));
      if (remainingOpenedTables.length !== openedTables.length) {
        setOpenedTables(remainingOpenedTables);
        const nextActiveKey = activeOpenedTableKey && remainingOpenedTables.some((item) => getMysqlOpenedTableKey(item.database, item.table) === activeOpenedTableKey)
          ? activeOpenedTableKey
          : null;
        setActiveOpenedTableKey(nextActiveKey);
        setSelectedTableInfo(null);
        setDataState(defaultDataState);
        if (location.pathname === "/mysql/table") {
          const hasActive = activeOpenedTableKey && remainingOpenedTables.some((item) => getMysqlOpenedTableKey(item.database, item.table) === activeOpenedTableKey);
          if (!hasActive) {
            void navigate("/mysql/tables");
          }
        }
      }
    } catch (error) {
      logError(error, {
        source: "mysqlTableManager.refreshTables",
        message: `Failed to refresh tables for database ${db}`
      });
      setTablesByDb((prev) => ({ ...prev, [db]: [] }));
    }
  }, [activeOpenedTableKey, connectionId, location.pathname, navigate, openedTables, selectedDatabase, selectedTable, selectedTableInfo, setActiveOpenedTableKey, setOpenedTables, setSelectedTable, setTablesByDb]);

  const loadTableInfo = useCallback(async (db: string, table: string) => {
    const [columns, countResult] = await Promise.all([
      mysqlDescribeTable(connectionId!, db, table),
      mysqlQuery(connectionId!, `SELECT COUNT(*) as cnt FROM \`${db}\`.\`${table}\``)
    ]);

    const rowCount = countResult.isResultSet && countResult.rows.length > 0
      ? Number(countResult.rows[0][0]) || 0
      : 0;

    return { columns, rowCount };
  }, [connectionId]);

  const handleSelectTable = (db: string, table: string) => {
    setSelectedDatabase(db);
    setSelectedTable(table);
  };

  const handleOpenTable = async (db: string, table: string, targetTab: RightPanelTab) => {
    if (!connectionId) return;

    setSelectedDatabase(db);
    setSelectedTable(table);
    setSelectedTableInfo({ database: db, table, loading: true });
    setRightPanelTab(targetTab);

    try {
      const { columns, rowCount } = await loadTableInfo(db, table);
      setSelectedTableInfo({ database: db, table, columns, rowCount, loading: false });
      setDataColumnMeta(columns);

      if (targetTab === "data") {
        await fetchData(db, table, 1, defaultDataState.pageSize);
      } else {
        setDataState(defaultDataState);
      }
    } catch (err) {
      logError(err, {
        source: targetTab === "data" ? "mysqlTableManager.openTableData" : "mysqlTableManager.openTableStructure",
        message: `Failed to open table ${db}.${table}`
      });
      setSelectedTableInfo({ database: db, table, loading: false });
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const setOpenedTableView = useCallback((db: string, table: string, view: RightPanelTab) => {
    const nextKey = getMysqlOpenedTableKey(db, table);
    setOpenedTables((prev) => prev.map((item) => (
      getMysqlOpenedTableKey(item.database, item.table) === nextKey ? { ...item, view } : item
    )));
  }, [setOpenedTables]);

  const updateOpenedTableQueryState = useCallback(
    (
      db: string,
      table: string,
      next: Partial<Pick<MysqlOpenedTable, "filterColumn" | "filterValue" | "sortColumn" | "sortDirection">>
    ) => {
      const nextKey = getMysqlOpenedTableKey(db, table);
      setOpenedTables((prev) => prev.map((item) => (
        getMysqlOpenedTableKey(item.database, item.table) === nextKey
          ? { ...item, ...next }
          : item
      )));
    },
    [setOpenedTables]
  );

  const openTableWorkspace = async (db: string, table: string, targetTab: RightPanelTab) => {
    const nextKey = getMysqlOpenedTableKey(db, table);
    setSelectedDatabase(db);
    setSelectedTable(table);
    setOpenedTables((prev) => {
      const existing = prev.find((item) => getMysqlOpenedTableKey(item.database, item.table) === nextKey);
      if (existing) {
        return prev.map((item) => getMysqlOpenedTableKey(item.database, item.table) === nextKey ? { ...item, view: targetTab } : item);
      }
      return [...prev, { database: db, table, view: targetTab }];
    });
    setActiveOpenedTableKey(nextKey);
    await navigate("/mysql/table");
  };

  const handleBrowseData = async (db: string, table: string) => {
    await openTableWorkspace(db, table, "data");
  };

  const handleDesignTable = async (db: string, table: string) => {
    await openTableWorkspace(db, table, "structure");
  };

  useEffect(() => {
    if (!isTableWorkspace || !activeOpenedTable) return;
    void handleOpenTable(activeOpenedTable.database, activeOpenedTable.table, activeOpenedTable.view);
  }, [activeOpenedTable, isTableWorkspace]);

  useEffect(() => {
    if (!connectionId) {
      setSelectedTableInfo(null);
      setDataState(defaultDataState);
      setDataColumnMeta([]);
      return;
    }

    if (!expandedDatabase && !activeOpenedTable) {
      setSelectedTableInfo(null);
      setDataState(defaultDataState);
      setDataColumnMeta([]);
      setSelectedTable(undefined);
      return;
    }

    if (expandedDatabase && !tablesByDb[expandedDatabase]) {
      refreshTablesForDb(expandedDatabase);
    }

    if (selectedTableInfo && location.pathname !== "/mysql/table" && selectedTableInfo.database !== expandedDatabase) {
      setSelectedTableInfo(null);
      setDataState(defaultDataState);
      setDataColumnMeta([]);
      setSelectedTable(undefined);
      setRightPanelTab("structure");
    }
  }, [activeOpenedTable, connectionId, expandedDatabase, location.pathname, refreshTablesForDb, selectedTableInfo, setSelectedTable, tablesByDb]);

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
    const currentFilterColumn = db && table && activeOpenedTable?.database === db && activeOpenedTable?.table === table
      ? activeOpenedTable.filterColumn
      : selectedTableInfo?.database === targetDb && selectedTableInfo?.table === targetTable
        ? activeOpenedTable?.filterColumn
        : undefined;
    const currentFilterValue = db && table && activeOpenedTable?.database === db && activeOpenedTable?.table === table
      ? activeOpenedTable.filterValue
      : selectedTableInfo?.database === targetDb && selectedTableInfo?.table === targetTable
        ? activeOpenedTable?.filterValue
        : undefined;
    const currentSortColumn = db && table && activeOpenedTable?.database === db && activeOpenedTable?.table === table
      ? activeOpenedTable.sortColumn
      : selectedTableInfo?.database === targetDb && selectedTableInfo?.table === targetTable
        ? activeOpenedTable?.sortColumn
        : undefined;
    const currentSortDirection = db && table && activeOpenedTable?.database === db && activeOpenedTable?.table === table
      ? activeOpenedTable.sortDirection
      : selectedTableInfo?.database === targetDb && selectedTableInfo?.table === targetTable
        ? activeOpenedTable?.sortDirection
        : undefined;

    const whereClause = currentFilterColumn && currentFilterValue !== undefined && currentFilterValue !== ""
      ? ` WHERE ${escapeSqlIdentifier(currentFilterColumn)} ${/^null$/i.test(currentFilterValue) ? "IS NULL" : `= ${escapeSqlLiteral(currentFilterValue)}`}`
      : "";
    const orderClause = currentSortColumn
      ? ` ORDER BY ${escapeSqlIdentifier(currentSortColumn)} ${(currentSortDirection ?? "asc").toUpperCase()}`
      : "";

    setDataState((prev) => ({ ...prev, loading: true, error: "" }));

    try {
      const countResult = await mysqlQuery(
        connectionId,
        `SELECT COUNT(*) as cnt FROM \`${targetDb}\`.\`${targetTable}\`${whereClause}`
      );
      const total = countResult.isResultSet && countResult.rows.length > 0
        ? Number(countResult.rows[0][0]) || 0
        : 0;

      const dataResult = await mysqlQuery(
        connectionId,
        `SELECT * FROM \`${targetDb}\`.\`${targetTable}\`${whereClause}${orderClause} LIMIT ${offset}, ${currentSize}`
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
      logError(err, {
        source: "mysqlTableManager.fetchData",
        message: `Failed to fetch table data for ${targetDb}.${targetTable}`
      });
      setDataState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  }, [activeOpenedTable, connectionId, selectedTableInfo?.database, selectedTableInfo?.table, dataState.page, dataState.pageSize]);

  // ─── Data pagination ───

  const totalPages = Math.max(1, Math.ceil(dataState.total / dataState.pageSize));

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    fetchData(undefined, undefined, newPage);
  };

  const handlePageSizeChange = (newSize: number) => {
    fetchData(undefined, undefined, 1, newSize);
  };

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch (err) {
      logError(err, {
        source: "mysqlTableManager.copyClipboard",
        message: "Failed to copy content to clipboard"
      });
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const getRowObject = (rowIndex: number) => {
    const row = dataState.rows[rowIndex] ?? [];
    return Object.fromEntries(dataState.columns.map((col, index) => [col, row[index]]));
  };

  const applyFilter = async (column: string, value: string) => {
    if (!activeOpenedTable) return;
    updateOpenedTableQueryState(activeOpenedTable.database, activeOpenedTable.table, {
      filterColumn: column,
      filterValue: value
    });
    setFilterModalOpen(false);
    await fetchData(activeOpenedTable.database, activeOpenedTable.table, 1, dataState.pageSize);
  };

  const clearFilter = async () => {
    if (!activeOpenedTable) return;
    updateOpenedTableQueryState(activeOpenedTable.database, activeOpenedTable.table, {
      filterColumn: undefined,
      filterValue: undefined
    });
    setFilterModalOpen(false);
    await fetchData(activeOpenedTable.database, activeOpenedTable.table, 1, dataState.pageSize);
  };

  const applySort = async (column: string, direction: "asc" | "desc") => {
    if (!activeOpenedTable) return;
    updateOpenedTableQueryState(activeOpenedTable.database, activeOpenedTable.table, {
      sortColumn: column,
      sortDirection: direction
    });
    setSortModalOpen(false);
    await fetchData(activeOpenedTable.database, activeOpenedTable.table, 1, dataState.pageSize);
  };

  const clearSort = async () => {
    if (!activeOpenedTable) return;
    updateOpenedTableQueryState(activeOpenedTable.database, activeOpenedTable.table, {
      sortColumn: undefined,
      sortDirection: undefined
    });
    setSortModalOpen(false);
    await fetchData(activeOpenedTable.database, activeOpenedTable.table, 1, dataState.pageSize);
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
      logError(err, {
        source: "mysqlTableManager.saveEdit",
        message: `Failed to update row in ${db}.${table}`
      });
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
      logError(err, {
        source: "mysqlTableManager.deleteRow",
        message: `Failed to delete row from ${db}.${table}`
      });
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
      setTablesByDb((prev) => ({
        ...prev,
        [db]: (prev[db] ?? []).filter((t) => t !== table)
      }));
      if (selectedTableInfo?.database === db && selectedTableInfo?.table === table) {
        setSelectedTable(undefined);
        setSelectedTableInfo(null);
        setDataState(defaultDataState);
      }
      const targetKey = getMysqlOpenedTableKey(db, table);
      const remainingOpenedTables = openedTables.filter((item) => getMysqlOpenedTableKey(item.database, item.table) !== targetKey);
      setOpenedTables(remainingOpenedTables);
      if (activeOpenedTableKey === targetKey) {
        const nextActive = remainingOpenedTables[remainingOpenedTables.length - 1] ?? null;
        setActiveOpenedTableKey(nextActive ? getMysqlOpenedTableKey(nextActive.database, nextActive.table) : null);
        if (location.pathname === "/mysql/table") {
          await navigate(nextActive ? "/mysql/table" : "/mysql/tables");
        }
      }
    } catch (err) {
      logError(err, {
        source: "mysqlTableManager.dropTable",
        message: `Failed to drop table ${db}.${table}`
      });
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleTruncateTable = async (db: string, table: string) => {
    if (!connectionId) return;
    if (!confirm(`Truncate table \`${db}\`.\`${table}\`? All data will be deleted.`)) return;

    try {
      await mysqlQuery(connectionId, `TRUNCATE TABLE \`${db}\`.\`${table}\``);
      if (selectedTableInfo?.database === db && selectedTableInfo?.table === table) {
        await handleOpenTable(db, table, rightPanelTab);
      }
    } catch (err) {
      logError(err, {
        source: "mysqlTableManager.truncateTable",
        message: `Failed to truncate table ${db}.${table}`
      });
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopyTable = async (db: string, table: string) => {
    if (!connectionId) return;

    const nextName = window.prompt(t("mysql.tableManager.copyTablePrompt"), `${table}_copy`)?.trim();
    if (!nextName || nextName === table) return;

    try {
      await mysqlQuery(connectionId, `CREATE TABLE \`${db}\`.\`${nextName}\` LIKE \`${db}\`.\`${table}\``);
      await mysqlQuery(connectionId, `INSERT INTO \`${db}\`.\`${nextName}\` SELECT * FROM \`${db}\`.\`${table}\``);
      await refreshTablesForDb(db);
    } catch (err) {
      logError(err, {
        source: "mysqlTableManager.copyTable",
        message: `Failed to copy table ${db}.${table} to ${nextName}`
      });
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // ─── Context menu ───

  const handleTableContextMenu = (e: MouseEvent, db: string, table: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTreeContextMenu({ db, table, x: e.clientX, y: e.clientY });
  };

  const handleRowContextMenu = (e: MouseEvent<HTMLElement>, rowIndex: number, column: string, value: unknown) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedRowIndex(rowIndex);
    setRowContextMenu({ x: e.clientX, y: e.clientY, rowIndex, column, value });
  };

  // Close context menu on outside click / scroll / resize
  useEffect(() => {
    if (!treeContextMenu && !rowContextMenu) return;
    const close = () => {
      setTreeContextMenu(null);
      setRowContextMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [rowContextMenu, treeContextMenu]);

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
      logError(err, {
        source: "mysqlTableManager.sqlModal",
        message: "Failed to execute SQL from MySQL table manager modal"
      });
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
    await handleOpenTable(selectedTableInfo.database, selectedTableInfo.table, rightPanelTab);
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
      logError(err, {
        source: "mysqlTableManager.saveColumnEdit",
        message: `Failed to ${columnEditMode === "add" ? "add" : "modify"} column ${field}`
      });
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
      logError(err, {
        source: "mysqlTableManager.dropColumn",
        message: `Failed to drop column ${column.field}`
      });
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #e5e5ea", gap: "12px", flexShrink: 0 }}>
          <div style={{ fontSize: "12px", color: "#6b7280", display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <span>
              {activeOpenedTable?.filterColumn && activeOpenedTable.filterValue !== undefined && activeOpenedTable.filterValue !== ""
                ? t("mysql.tableManager.filterSummary", { column: activeOpenedTable.filterColumn, value: activeOpenedTable.filterValue })
                : t("mysql.tableManager.noFilterApplied")}
            </span>
            <span>
              {activeOpenedTable?.sortColumn
                ? t("mysql.tableManager.sortSummary", {
                    column: activeOpenedTable.sortColumn,
                    direction: activeOpenedTable.sortDirection === "desc" ? t("dataBrowser.sortDescending") : t("dataBrowser.sortAscending")
                  })
                : t("mysql.tableManager.noSortApplied")}
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setFilterDraft({
                  column: activeOpenedTable?.filterColumn ?? dataState.columns[0] ?? "",
                  value: activeOpenedTable?.filterValue ?? ""
                });
                setFilterModalOpen(true);
              }}
            >
              {t("mysql.tableManager.filterData")}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setSortDraft({
                  column: activeOpenedTable?.sortColumn ?? dataState.columns[0] ?? "",
                  direction: activeOpenedTable?.sortDirection ?? "asc"
                });
                setSortModalOpen(true);
              }}
            >
              {t("mysql.tableManager.sortData")}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => fetchData()}
              disabled={dataState.loading}
            >
              {dataState.loading ? t("common.loading") : t("common.refresh")}
            </button>
          </div>
        </div>

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
                  <tr key={rowIndex} style={{ background: selectedRowIndex === rowIndex ? "#eef4ff" : undefined }} onClick={() => setSelectedRowIndex(rowIndex)}>
                    <td className="muted">{(dataState.page - 1) * dataState.pageSize + rowIndex + 1}</td>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        style={{ maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={cell === null ? "NULL" : String(cell)}
                        onContextMenu={(event) => handleRowContextMenu(event, rowIndex, dataState.columns[cellIndex] ?? "", cell)}
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

  const renderDatabaseOverview = () => {
    if (!expandedDatabase) {
      return (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span className="muted">{t("mysql.tableManager.openDatabaseHint")}</span>
        </div>
      );
    }

    const tables = tablesByDb[expandedDatabase] ?? [];

    return (
      <>
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="card-title">{expandedDatabase}</h3>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {t("mysql.tableManager.tableCount", { count: tables.length })}
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn btn-sm btn-ghost" onClick={() => refreshTablesForDb(expandedDatabase)} disabled={loading}>
              {t("mysql.tableManager.refreshTables")}
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => openSqlModal(`CREATE TABLE \`${expandedDatabase}\`.\`new_table\` (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  name VARCHAR(255)\n);`)}>
              {t("mysql.tableManager.createTable")}
            </button>
          </div>
        </div>

        <div style={{ padding: "12px 16px 0", fontSize: "12px", color: "#6b7280" }}>
          {t("mysql.tableManager.selectTableDataHint")}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
          {tables.length > 0 ? (
            <div className="mysql-table-grid">
              {tables.map((table) => (
                <div
                  key={table}
                  className={`mysql-table-card ${selectedTable === table ? "active" : ""}`}
                  onClick={() => handleSelectTable(expandedDatabase, table)}
                  onDoubleClick={() => {
                    void handleBrowseData(expandedDatabase, table);
                  }}
                  onContextMenu={(event) => handleTableContextMenu(event, expandedDatabase, table)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void handleBrowseData(expandedDatabase, table);
                    }
                  }}
                >
                  <div className="mysql-table-card-icon">▤</div>
                  <div className="mysql-table-card-name" title={table}>{table}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card" style={{ padding: "32px", textAlign: "center" }}>
              <span className="muted">{t("mysql.data.noTables")}</span>
            </div>
          )}
        </div>
      </>
    );
  };

  const renderTableWorkspace = () => {
    if (!activeOpenedTable) {
      return (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span className="muted">{t("mysql.tableManager.selectTableDataHint")}</span>
        </div>
      );
    }

    return (
      <>
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 className="card-title">
              {selectedTableInfo?.database ?? activeOpenedTable.database}.{selectedTableInfo?.table ?? activeOpenedTable.table}
              {selectedTableInfo?.rowCount !== undefined && (
                <span className="muted" style={{ fontWeight: 400, fontSize: "13px", marginLeft: "8px" }}>
                  ({selectedTableInfo.rowCount} {t("mysql.data.rowCount")})
                </span>
              )}
            </h3>
            <p className="muted" style={{ margin: "4px 0 0" }}>{t("mysql.tableManager.tableOpenedHint")}</p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0", borderBottom: "1px solid #e5e5ea", padding: "0 16px", flexShrink: 0 }}>
          <button
            className={`btn btn-sm ${rightPanelTab === "structure" ? "btn-primary" : "btn-ghost"}`}
            style={{ borderRadius: "6px 6px 0 0", borderBottom: rightPanelTab === "structure" ? "2px solid #007aff" : "2px solid transparent" }}
            onClick={() => {
              if (!activeOpenedTable) return;
              setRightPanelTab("structure");
              setOpenedTableView(activeOpenedTable.database, activeOpenedTable.table, "structure");
            }}
          >
            {t("mysql.tableManager.structure")}
          </button>
          <button
            className={`btn btn-sm ${rightPanelTab === "data" ? "btn-primary" : "btn-ghost"}`}
            style={{ borderRadius: "6px 6px 0 0", borderBottom: rightPanelTab === "data" ? "2px solid #007aff" : "2px solid transparent" }}
            onClick={() => {
              if (!activeOpenedTable) return;
              setRightPanelTab("data");
              setOpenedTableView(activeOpenedTable.database, activeOpenedTable.table, "data");
            }}
          >
            {t("mysql.tableManager.data")}
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {rightPanelTab === "structure" ? renderStructureTab() : renderDataTab()}
        </div>
      </>
    );
  };

  return (
    <div className="page">
      <div style={{ display: "flex", gap: "12px", height: "calc(100vh - 160px)" }}>
        <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {isTableWorkspace ? renderTableWorkspace() : renderDatabaseOverview()}
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
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              const { db, table } = treeContextMenu;
              setTreeContextMenu(null);
              void handleBrowseData(db, table);
            }}
          >
            {t("mysql.tableManager.openTable")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              const { db, table } = treeContextMenu;
              setTreeContextMenu(null);
              void handleDesignTable(db, table);
            }}
          >
            {t("mysql.tableManager.designTable")}
          </button>
          <div style={{ height: "1px", background: "#e5e5ea", margin: "4px 0" }} />
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              const { db, table } = treeContextMenu;
              setTreeContextMenu(null);
              void handleCopyTable(db, table);
            }}
          >
            {t("mysql.tableManager.copyTable")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              const { db, table } = treeContextMenu;
              setTreeContextMenu(null);
              void handleTruncateTable(db, table);
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
              void handleDropTable(db, table);
            }}
          >
            {t("mysql.tableManager.dropTable")}
          </button>
        </div>
      )}

      {rowContextMenu && (
        <div
          style={{
            position: "fixed",
            left: `${rowContextMenu.x}px`,
            top: `${rowContextMenu.y}px`,
            zIndex: 1200,
            minWidth: "180px",
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
              void copyToClipboard(rowContextMenu.value === null ? "NULL" : String(rowContextMenu.value));
              setRowContextMenu(null);
            }}
          >
            {t("mysql.tableManager.copyCellValue")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              void copyToClipboard(JSON.stringify(getRowObject(rowContextMenu.rowIndex), null, 2));
              setRowContextMenu(null);
            }}
          >
            {t("dataBrowser.copyRow")}
          </button>
          <div style={{ height: "1px", background: "#e5e5ea", margin: "4px 0" }} />
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              void applyFilter(rowContextMenu.column, rowContextMenu.value === null ? "NULL" : String(rowContextMenu.value));
              setRowContextMenu(null);
            }}
          >
            {t("mysql.tableManager.filterByCurrentValue")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              void applySort(rowContextMenu.column, "asc");
              setRowContextMenu(null);
            }}
          >
            {t("dataBrowser.sortAscending")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              void applySort(rowContextMenu.column, "desc");
              setRowContextMenu(null);
            }}
          >
            {t("dataBrowser.sortDescending")}
          </button>
        </div>
      )}

      {filterModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: "480px", display: "flex", flexDirection: "column" }}>
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 className="card-title">{t("mysql.tableManager.filterData")}</h3>
              <button className="btn btn-sm btn-ghost" onClick={() => setFilterModalOpen(false)}>{t("common.close")}</button>
            </div>
            <div style={{ padding: "16px", display: "grid", gap: "12px" }}>
              <div>
                <label>{t("mysql.tableManager.filterColumn")}</label>
                <select className="form-control" value={filterDraft.column} onChange={(event) => setFilterDraft((prev) => ({ ...prev, column: event.target.value }))}>
                  {dataState.columns.map((column) => (
                    <option key={column} value={column}>{column}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>{t("mysql.tableManager.filterValue")}</label>
                <input className="form-control" value={filterDraft.value} onChange={(event) => setFilterDraft((prev) => ({ ...prev, value: event.target.value }))} />
              </div>
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid #e5e5ea", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="btn btn-sm btn-ghost" onClick={() => void clearFilter()}>{t("mysql.tableManager.clearFilter")}</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setFilterModalOpen(false)}>{t("common.cancel")}</button>
              <button className="btn btn-sm btn-primary" onClick={() => void applyFilter(filterDraft.column, filterDraft.value)}>{t("common.save")}</button>
            </div>
          </div>
        </div>
      )}

      {sortModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: "480px", display: "flex", flexDirection: "column" }}>
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 className="card-title">{t("mysql.tableManager.sortData")}</h3>
              <button className="btn btn-sm btn-ghost" onClick={() => setSortModalOpen(false)}>{t("common.close")}</button>
            </div>
            <div style={{ padding: "16px", display: "grid", gap: "12px" }}>
              <div>
                <label>{t("mysql.tableManager.sortColumn")}</label>
                <select className="form-control" value={sortDraft.column} onChange={(event) => setSortDraft((prev) => ({ ...prev, column: event.target.value }))}>
                  {dataState.columns.map((column) => (
                    <option key={column} value={column}>{column}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>{t("mysql.tableManager.sortDirection")}</label>
                <select className="form-control" value={sortDraft.direction} onChange={(event) => setSortDraft((prev) => ({ ...prev, direction: event.target.value as "asc" | "desc" }))}>
                  <option value="asc">{t("dataBrowser.sortAscending")}</option>
                  <option value="desc">{t("dataBrowser.sortDescending")}</option>
                </select>
              </div>
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid #e5e5ea", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="btn btn-sm btn-ghost" onClick={() => void clearSort()}>{t("mysql.tableManager.clearSort")}</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setSortModalOpen(false)}>{t("common.cancel")}</button>
              <button className="btn btn-sm btn-primary" onClick={() => void applySort(sortDraft.column, sortDraft.direction)}>{t("common.save")}</button>
            </div>
          </div>
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
