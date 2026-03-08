import { type MouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { logError } from "../../../lib/errorLog";
import {
    getMysqlOpenedTableKey,
    type MysqlFilterConditionNode,
    type MysqlFilterGroupNode,
    type MysqlFilterNode,
    type MysqlFilterOperator,
    type MysqlOpenedTable,
    useMysqlContext
} from "../../../state/MysqlContext";
import { mysqlDescribeTable, mysqlListDatabases, mysqlListTables, mysqlQuery } from "../services/client";
import type { ColumnMeta } from "../types";

type FilterConditionDraft = MysqlFilterConditionNode;
type FilterGroupDraft = MysqlFilterGroupNode;

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
  columnIndex: number;
  column: string;
  value: unknown;
}

interface ColumnHeaderContextMenu {
  x: number;
  y: number;
  column: string;
}

interface CellEditorState {
  rowIndex: number;
  column: string;
  value: string;
}

interface SelectedCell {
  key: string;
  rowIndex: number;
  columnIndex: number;
  column: string;
}

type BatchEditMode = "text" | "null" | "empty";

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
  const [columnHeaderContextMenu, setColumnHeaderContextMenu] = useState<ColumnHeaderContextMenu | null>(null);

  // Data browsing state
  const [dataState, setDataState] = useState<DataState>(defaultDataState);
  const [dataColumnMeta, setDataColumnMeta] = useState<ColumnMeta[]>([]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [editingRow, setEditingRow] = useState<{ index: number; json: string } | null>(null);
  const [editingCell, setEditingCell] = useState<CellEditorState | null>(null);
  const [selectedCells, setSelectedCells] = useState<SelectedCell[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState<{ rowIndex: number; columnIndex: number } | null>(null);
  const [editError, setEditError] = useState("");
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [sortModalOpen, setSortModalOpen] = useState(false);
  const [filterDraftTree, setFilterDraftTree] = useState<FilterGroupDraft | null>(null);
  const [sortDraft, setSortDraft] = useState<{ column: string; direction: "asc" | "desc" }>({
    column: "",
    direction: "asc"
  });
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [batchEditDraft, setBatchEditDraft] = useState<{ mode: BatchEditMode; value: string }>({ mode: "text", value: "" });
  const [batchEditError, setBatchEditError] = useState("");

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

  const escapeSqlLikeLiteral = (value: string) => value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/'/g, "''");

  const createFilterCondition = (column = "", operator: MysqlFilterOperator = "eq", value = ""): FilterConditionDraft => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "condition",
    column,
    operator,
    value
  });

  const createFilterGroup = (mode: "and" | "or" = "and", children: MysqlFilterNode[] = []): FilterGroupDraft => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "group",
    mode,
    children
  });

  const createSelectedCell = (rowIndex: number, columnIndex: number): SelectedCell => ({
    key: `${rowIndex}:${columnIndex}`,
    rowIndex,
    columnIndex,
    column: dataState.columns[columnIndex] ?? ""
  });

  const selectedCellKeySet = useMemo(() => new Set(selectedCells.map((cell) => cell.key)), [selectedCells]);

  const filterOperators: Array<{ value: MysqlFilterOperator; label: string }> = [
    { value: "eq", label: t("mysql.tableManager.operatorEq") },
    { value: "ne", label: t("mysql.tableManager.operatorNe") },
    { value: "gt", label: t("mysql.tableManager.operatorGt") },
    { value: "gte", label: t("mysql.tableManager.operatorGte") },
    { value: "lt", label: t("mysql.tableManager.operatorLt") },
    { value: "lte", label: t("mysql.tableManager.operatorLte") },
    { value: "contains", label: t("mysql.tableManager.operatorContains") },
    { value: "startsWith", label: t("mysql.tableManager.operatorStartsWith") },
    { value: "endsWith", label: t("mysql.tableManager.operatorEndsWith") },
    { value: "isNull", label: t("mysql.tableManager.operatorIsNull") },
    { value: "isNotNull", label: t("mysql.tableManager.operatorIsNotNull") },
    { value: "emptyString", label: t("mysql.tableManager.operatorEmptyString") },
    { value: "notEmptyString", label: t("mysql.tableManager.operatorNotEmptyString") }
  ];

  const activeFilterTree = activeOpenedTable?.filterTree ?? null;

  const operatorNeedsValue = (operator: MysqlFilterOperator) => !["isNull", "isNotNull", "emptyString", "notEmptyString"].includes(operator);

  function countFilterStats(node: FilterGroupDraft | null): { groups: number; conditions: number } {
    if (!node) return { groups: 0, conditions: 0 };
    return node.children.reduce(
      (acc, child) => {
        if (child.kind === "group") {
          const nested = countFilterStats(child);
          return {
            groups: acc.groups + 1 + nested.groups,
            conditions: acc.conditions + nested.conditions
          };
        }
        return {
          groups: acc.groups,
          conditions: acc.conditions + 1
        };
      },
      { groups: 0, conditions: 0 }
    );
  }

  function cloneFilterGroup(group: FilterGroupDraft, fallbackColumn: string): FilterGroupDraft {
    return {
      ...group,
      children: (group.children.length > 0 ? group.children : [createFilterCondition(fallbackColumn)]).map((child) => {
        if (child.kind === "group") {
          return cloneFilterGroup(child, fallbackColumn);
        }
        return {
          ...child,
          kind: "condition",
          column: child.column || fallbackColumn,
          value: child.value ?? ""
        };
      })
    };
  }

  function updateFilterTreeNode(group: FilterGroupDraft, nodeId: string, updater: (node: MysqlFilterNode) => MysqlFilterNode): FilterGroupDraft {
    return {
      ...group,
      children: group.children.map((child) => {
        if (child.id === nodeId) {
          return updater(child);
        }
        if (child.kind === "group") {
          return updateFilterTreeNode(child, nodeId, updater);
        }
        return child;
      })
    };
  }

  function removeFilterTreeNode(group: FilterGroupDraft, nodeId: string): FilterGroupDraft {
    return {
      ...group,
      children: group.children
        .filter((child) => child.id !== nodeId)
        .map((child) => (child.kind === "group" ? removeFilterTreeNode(child, nodeId) : child))
    };
  }

  function sanitizeFilterNode(node: MysqlFilterNode): MysqlFilterNode | null {
    if (node.kind === "condition") {
      if (!node.column.trim()) return null;
      if (operatorNeedsValue(node.operator) && (node.value ?? "") === "") return null;
      return {
        ...node,
        kind: "condition",
        value: operatorNeedsValue(node.operator) ? node.value ?? "" : undefined
      };
    }

    const children = node.children
      .map((child) => sanitizeFilterNode(child))
      .filter((child): child is MysqlFilterNode => Boolean(child));

    if (children.length === 0) return null;
    return {
      ...node,
      kind: "group",
      children
    };
  }

  function buildNodeSql(node: MysqlFilterNode): string | null {
    if (node.kind === "condition") {
      return buildConditionSql(node);
    }

    const childSql = node.children
      .map((child) => buildNodeSql(child))
      .filter((part): part is string => Boolean(part));

    if (childSql.length === 0) return null;
    const joiner = node.mode === "or" ? " OR " : " AND ";
    return childSql.length === 1 ? childSql[0] : `(${childSql.join(joiner)})`;
  }

  const buildConditionSql = useCallback((condition: FilterConditionDraft) => {
    const column = condition.column.trim();
    if (!column) return null;

    const identifier = escapeSqlIdentifier(column);
    const conditionValue = condition.value ?? "";
    switch (condition.operator) {
      case "eq":
        return `${identifier} = ${escapeSqlLiteral(conditionValue)}`;
      case "ne":
        return `${identifier} <> ${escapeSqlLiteral(conditionValue)}`;
      case "gt":
        return `${identifier} > ${escapeSqlLiteral(conditionValue)}`;
      case "gte":
        return `${identifier} >= ${escapeSqlLiteral(conditionValue)}`;
      case "lt":
        return `${identifier} < ${escapeSqlLiteral(conditionValue)}`;
      case "lte":
        return `${identifier} <= ${escapeSqlLiteral(conditionValue)}`;
      case "contains":
        return `${identifier} LIKE '%${escapeSqlLikeLiteral(conditionValue)}%' ESCAPE '\\\\'`;
      case "startsWith":
        return `${identifier} LIKE '${escapeSqlLikeLiteral(conditionValue)}%' ESCAPE '\\\\'`;
      case "endsWith":
        return `${identifier} LIKE '%${escapeSqlLikeLiteral(conditionValue)}' ESCAPE '\\\\'`;
      case "isNull":
        return `${identifier} IS NULL`;
      case "isNotNull":
        return `${identifier} IS NOT NULL`;
      case "emptyString":
        return `${identifier} = ''`;
      case "notEmptyString":
        return `${identifier} <> ''`;
      default:
        return null;
    }
  }, []);

  const getWhereClause = useCallback((tree?: FilterGroupDraft | null) => {
    if (!tree) return "";
    const sql = buildNodeSql(tree);
    return sql ? ` WHERE ${sql}` : "";
  }, [buildConditionSql]);

  const syncFilterDraftFromOpenedTable = useCallback((table: MysqlOpenedTable | null, columns: string[]) => {
    const firstColumn = columns[0] ?? "";
    const tree = table?.filterTree
      ? cloneFilterGroup(table.filterTree, firstColumn)
      : createFilterGroup("and", [createFilterCondition(firstColumn)]);
    setFilterDraftTree(tree);
  }, []);

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
      next: Partial<Pick<MysqlOpenedTable, "filterTree" | "sortColumn" | "sortDirection">>
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
    if (!activeOpenedTable) return;
    syncFilterDraftFromOpenedTable(activeOpenedTable, dataState.columns);
  }, [activeOpenedTable, dataState.columns, syncFilterDraftFromOpenedTable]);

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
    pageSize?: number,
    overrides?: Partial<Pick<MysqlOpenedTable, "filterTree" | "sortColumn" | "sortDirection">>
  ) => {
    const targetDb = db ?? selectedTableInfo?.database;
    const targetTable = table ?? selectedTableInfo?.table;
    if (!connectionId || !targetDb || !targetTable) return;

    const currentPage = page ?? dataState.page;
    const currentSize = pageSize ?? dataState.pageSize;
    const offset = (currentPage - 1) * currentSize;
    const currentFilterTree = overrides?.filterTree ?? activeOpenedTable?.filterTree ?? undefined;
    const currentSortColumn = db && table && activeOpenedTable?.database === db && activeOpenedTable?.table === table
      ? overrides?.sortColumn ?? activeOpenedTable.sortColumn
      : selectedTableInfo?.database === targetDb && selectedTableInfo?.table === targetTable
        ? overrides?.sortColumn ?? activeOpenedTable?.sortColumn
        : undefined;
    const currentSortDirection = db && table && activeOpenedTable?.database === db && activeOpenedTable?.table === table
      ? overrides?.sortDirection ?? activeOpenedTable.sortDirection
      : selectedTableInfo?.database === targetDb && selectedTableInfo?.table === targetTable
        ? overrides?.sortDirection ?? activeOpenedTable?.sortDirection
        : undefined;

    const whereClause = getWhereClause(currentFilterTree);
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
  }, [activeOpenedTable, connectionId, dataState.page, dataState.pageSize, getWhereClause, selectedTableInfo?.database, selectedTableInfo?.table]);

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

  const visibleDataColumns = useMemo(
    () => {
      const preferred = activeOpenedTable?.visibleColumns;
      if (!preferred || preferred.length === 0) {
        return dataState.columns;
      }
      const nextColumns = preferred.filter((column) => dataState.columns.includes(column));
      return nextColumns.length > 0 ? nextColumns : dataState.columns;
    },
    [activeOpenedTable?.visibleColumns, dataState.columns]
  );

  const formatSqlValue = (value: unknown) => {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "number" || typeof value === "bigint") return String(value);
    if (typeof value === "boolean") return value ? "1" : "0";
    return escapeSqlLiteral(String(value));
  };

  const buildInsertSql = (rowIndex: number) => {
    if (!selectedTableInfo) return "";
    const row = dataState.rows[rowIndex] ?? [];
    const columns = dataState.columns.map((column) => escapeSqlIdentifier(column)).join(", ");
    const values = row.map((value) => formatSqlValue(value)).join(", ");
    return `INSERT INTO ${escapeSqlIdentifier(selectedTableInfo.database)}.${escapeSqlIdentifier(selectedTableInfo.table)} (${columns}) VALUES (${values});`;
  };

  const buildSelectedCells = (start: { rowIndex: number; columnIndex: number }, end: { rowIndex: number; columnIndex: number }) => {
    const rowStart = Math.min(start.rowIndex, end.rowIndex);
    const rowEnd = Math.max(start.rowIndex, end.rowIndex);
    const colStart = Math.min(start.columnIndex, end.columnIndex);
    const colEnd = Math.max(start.columnIndex, end.columnIndex);
    const cells: SelectedCell[] = [];

    for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
      for (let columnIndex = colStart; columnIndex <= colEnd; columnIndex += 1) {
        const cell = createSelectedCell(rowIndex, columnIndex);
        if (cell.column) {
          cells.push(cell);
        }
      }
    }

    return cells;
  };

  const getContextTargetCells = (context: RowContextMenu): SelectedCell[] => {
    const currentCell = createSelectedCell(context.rowIndex, context.columnIndex);
    return selectedCellKeySet.has(currentCell.key) ? selectedCells : [currentCell];
  };

  const handleCellClick = (event: MouseEvent<HTMLTableCellElement>, rowIndex: number, columnIndex: number) => {
    const currentCell = createSelectedCell(rowIndex, columnIndex);
    if (!currentCell.column) return;

    if (event.shiftKey && selectionAnchor) {
      setSelectedCells(buildSelectedCells(selectionAnchor, { rowIndex, columnIndex }));
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedCells((prev) => prev.some((cell) => cell.key === currentCell.key)
        ? prev.filter((cell) => cell.key !== currentCell.key)
        : [...prev, currentCell]);
      setSelectionAnchor({ rowIndex, columnIndex });
    } else {
      setSelectedCells([currentCell]);
      setSelectionAnchor({ rowIndex, columnIndex });
    }

    setSelectedRowIndex(rowIndex);
  };

  const appendConditionToRootTree = (tree: FilterGroupDraft | null, condition: FilterConditionDraft) => {
    if (!tree) {
      return createFilterGroup("and", [condition]);
    }
    return {
      ...tree,
      children: [...tree.children, condition]
    };
  };

  const updateOpenedTableVisibleColumns = useCallback((db: string, table: string, visibleColumns: string[]) => {
    const nextKey = getMysqlOpenedTableKey(db, table);
    setOpenedTables((prev) => prev.map((item) => (
      getMysqlOpenedTableKey(item.database, item.table) === nextKey
        ? { ...item, visibleColumns: visibleColumns.length > 0 ? visibleColumns : dataState.columns }
        : item
    )));
  }, [dataState.columns, setOpenedTables]);

  const handleVisibleColumnToggle = (column: string, checked: boolean) => {
    if (!activeOpenedTable) return;
    const nextColumns = checked
      ? [...visibleDataColumns, column]
      : visibleDataColumns.filter((item) => item !== column);
    updateOpenedTableVisibleColumns(activeOpenedTable.database, activeOpenedTable.table, nextColumns);
  };

  const handleSelectAllVisibleColumns = () => {
    if (!activeOpenedTable) return;
    updateOpenedTableVisibleColumns(activeOpenedTable.database, activeOpenedTable.table, dataState.columns);
  };

  const applyFilter = async (tree: FilterGroupDraft | null) => {
    if (!activeOpenedTable) return;
    const sanitizedTree = tree ? sanitizeFilterNode(tree) : null;

    updateOpenedTableQueryState(activeOpenedTable.database, activeOpenedTable.table, {
      filterTree: sanitizedTree?.kind === "group" ? sanitizedTree : undefined
    });
    await fetchData(activeOpenedTable.database, activeOpenedTable.table, 1, dataState.pageSize, {
      filterTree: sanitizedTree?.kind === "group" ? sanitizedTree : undefined
    });
  };

  const clearFilter = async () => {
    if (!activeOpenedTable) return;
    updateOpenedTableQueryState(activeOpenedTable.database, activeOpenedTable.table, {
      filterTree: undefined
    });
    syncFilterDraftFromOpenedTable({ ...activeOpenedTable, filterTree: undefined }, dataState.columns);
    await fetchData(activeOpenedTable.database, activeOpenedTable.table, 1, dataState.pageSize, {
      filterTree: undefined
    });
  };

  const applySort = async (column: string, direction: "asc" | "desc") => {
    if (!activeOpenedTable) return;
    updateOpenedTableQueryState(activeOpenedTable.database, activeOpenedTable.table, {
      sortColumn: column,
      sortDirection: direction
    });
    setSortModalOpen(false);
    await fetchData(activeOpenedTable.database, activeOpenedTable.table, 1, dataState.pageSize, {
      sortColumn: column,
      sortDirection: direction
    });
  };

  const clearSort = async () => {
    if (!activeOpenedTable) return;
    updateOpenedTableQueryState(activeOpenedTable.database, activeOpenedTable.table, {
      sortColumn: undefined,
      sortDirection: undefined
    });
    setSortModalOpen(false);
    await fetchData(activeOpenedTable.database, activeOpenedTable.table, 1, dataState.pageSize, {
      sortColumn: undefined,
      sortDirection: undefined
    });
  };

  const updateRowByIndex = useCallback(async (rowIndex: number, updates: Record<string, unknown>, options?: { refresh?: boolean }) => {
    if (!connectionId || !selectedTableInfo) return;
    const { database: db, table } = selectedTableInfo;
    const originalRow = dataState.rows[rowIndex];
    if (!originalRow) return;

    const setParts: string[] = [];
    for (const [col, val] of Object.entries(updates)) {
      if (val === null) {
        setParts.push(`\`${col}\` = NULL`);
      } else if (typeof val === "number") {
        setParts.push(`\`${col}\` = ${val}`);
      } else if (typeof val === "boolean") {
        setParts.push(`\`${col}\` = ${val ? 1 : 0}`);
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
      dataState.columns.forEach((col, index) => {
        const val = originalRow[index];
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
    if (options?.refresh !== false) {
      await fetchData();
    }
  }, [connectionId, dataColumnMeta, dataState.columns, dataState.rows, fetchData, selectedTableInfo]);

  const applyValueToCells = useCallback(async (cells: SelectedCell[], value: unknown) => {
    const updatesByRow = new Map<number, Record<string, unknown>>();
    cells.forEach((cell) => {
      const existing = updatesByRow.get(cell.rowIndex) ?? {};
      existing[cell.column] = value;
      updatesByRow.set(cell.rowIndex, existing);
    });

    for (const [rowIndex, updates] of Array.from(updatesByRow.entries()).sort((left, right) => left[0] - right[0])) {
      await updateRowByIndex(rowIndex, updates, { refresh: false });
    }
    await fetchData();
  }, [fetchData, updateRowByIndex]);

  const openBatchEditModal = (cells: SelectedCell[]) => {
    if (cells.length === 0) return;
    setBatchEditDraft({ mode: "text", value: "" });
    setBatchEditError("");
    setBatchEditOpen(true);
  };

  const handleSaveBatchEdit = async () => {
    try {
      const value = batchEditDraft.mode === "null"
        ? null
        : batchEditDraft.mode === "empty"
          ? ""
          : batchEditDraft.value;
      await applyValueToCells(selectedCells, value);
      setBatchEditOpen(false);
    } catch (err) {
      logError(err, {
        source: "mysqlTableManager.batchEditCells",
        message: "Failed to batch edit selected cells"
      });
      setBatchEditError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleEditCell = (rowIndex: number, column: string, value: unknown) => {
    setEditingCell({
      rowIndex,
      column,
      value: value === null ? "" : String(value)
    });
    setEditError("");
  };

  const handleSaveCellEdit = async () => {
    if (!editingCell) return;
    try {
      await updateRowByIndex(editingCell.rowIndex, { [editingCell.column]: editingCell.value });
      setEditingCell(null);
    } catch (err) {
      logError(err, {
        source: "mysqlTableManager.saveCellEdit",
        message: `Failed to update cell ${editingCell.column}`
      });
      setEditError(err instanceof Error ? err.message : String(err));
    }
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

    try {
      const data = JSON.parse(editingRow.json) as Record<string, unknown>;
      await updateRowByIndex(editingRow.index, data);
      setEditingRow(null);
    } catch (err) {
      logError(err, {
        source: "mysqlTableManager.saveEdit",
        message: `Failed to update row in ${selectedTableInfo.database}.${selectedTableInfo.table}`
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
    const columnIndex = dataState.columns.indexOf(column);
    const selectedCell = createSelectedCell(rowIndex, columnIndex);
    if (selectedCell.column && !selectedCellKeySet.has(selectedCell.key)) {
      setSelectedCells([selectedCell]);
      setSelectionAnchor({ rowIndex, columnIndex });
    }
    setRowContextMenu({ x: e.clientX, y: e.clientY, rowIndex, columnIndex, column, value });
  };

  const handleColumnHeaderContextMenu = (e: MouseEvent<HTMLElement>, column: string) => {
    e.preventDefault();
    e.stopPropagation();
    setColumnHeaderContextMenu({ x: e.clientX, y: e.clientY, column });
  };

  useEffect(() => {
    setSelectedCells([]);
    setSelectionAnchor(null);
  }, [activeOpenedTableKey, dataState.columns, dataState.page, dataState.pageSize, dataState.rows]);

  // Close context menu on outside click / scroll / resize
  useEffect(() => {
    if (!treeContextMenu && !rowContextMenu && !columnHeaderContextMenu) return;
    const close = () => {
      setTreeContextMenu(null);
      setRowContextMenu(null);
      setColumnHeaderContextMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [columnHeaderContextMenu, rowContextMenu, treeContextMenu]);

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

    const filterStats = countFilterStats(activeFilterTree);

    const renderFilterGroup = (group: FilterGroupDraft, isRoot = false, depth = 0) => (
      <div
        key={group.id}
        style={{
          display: "grid",
          gap: "10px",
          border: "1px solid #d8e0ea",
          borderRadius: "10px",
          padding: "12px",
          background: depth === 0 ? "#ffffff" : "#fdfefe",
          marginLeft: depth > 0 ? "16px" : 0
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <strong style={{ fontSize: "13px" }}>{isRoot ? t("mysql.tableManager.rootGroup") : t("mysql.tableManager.nestedGroup")}</strong>
            <select
              className="form-control"
              style={{ width: "180px" }}
              value={group.mode}
              onChange={(event) => setFilterDraftTree((prev) => prev ? updateFilterTreeNode(prev, group.id, (node) => node.kind === "group" ? { ...node, mode: event.target.value as "and" | "or" } : node) as FilterGroupDraft : prev)}
            >
              <option value="and">{t("mysql.tableManager.matchAll")}</option>
              <option value="or">{t("mysql.tableManager.matchAny")}</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setFilterDraftTree((prev) => prev ? updateFilterTreeNode(prev, group.id, (node) => node.kind === "group" ? { ...node, children: [...node.children, createFilterCondition(dataState.columns[0] ?? "")] } : node) as FilterGroupDraft : prev)}
            >
              {t("mysql.tableManager.addCondition")}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setFilterDraftTree((prev) => prev ? updateFilterTreeNode(prev, group.id, (node) => node.kind === "group" ? { ...node, children: [...node.children, createFilterGroup("and", [createFilterCondition(dataState.columns[0] ?? "")])] } : node) as FilterGroupDraft : prev)}
            >
              {t("mysql.tableManager.addGroup")}
            </button>
            {!isRoot && (
              <button className="btn btn-sm btn-ghost text-danger" onClick={() => setFilterDraftTree((prev) => prev ? removeFilterTreeNode(prev, group.id) : prev)}>
                {t("mysql.tableManager.removeGroup")}
              </button>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gap: "10px" }}>
          {group.children.length > 0 ? group.children.map((child) => {
            if (child.kind === "group") {
              return renderFilterGroup(child, false, depth + 1);
            }

            return (
              <div key={child.id} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1fr) minmax(160px, 1fr) minmax(180px, 1.2fr) auto", gap: "8px", alignItems: "center" }}>
                <select className="form-control" value={child.column} onChange={(event) => setFilterDraftTree((prev) => prev ? updateFilterTreeNode(prev, child.id, (node) => node.kind === "condition" ? { ...node, column: event.target.value } : node) as FilterGroupDraft : prev)}>
                  {dataState.columns.map((column) => (
                    <option key={column} value={column}>{column}</option>
                  ))}
                </select>
                <select className="form-control" value={child.operator} onChange={(event) => setFilterDraftTree((prev) => prev ? updateFilterTreeNode(prev, child.id, (node) => node.kind === "condition" ? { ...node, operator: event.target.value as MysqlFilterOperator, value: operatorNeedsValue(event.target.value as MysqlFilterOperator) ? node.value ?? "" : "" } : node) as FilterGroupDraft : prev)}>
                  {filterOperators.map((operator) => (
                    <option key={operator.value} value={operator.value}>{operator.label}</option>
                  ))}
                </select>
                <input
                  className="form-control"
                  value={child.value ?? ""}
                  disabled={!operatorNeedsValue(child.operator)}
                  placeholder={operatorNeedsValue(child.operator) ? t("mysql.tableManager.filterValue") : t("mysql.tableManager.noValueNeeded")}
                  onChange={(event) => setFilterDraftTree((prev) => prev ? updateFilterTreeNode(prev, child.id, (node) => node.kind === "condition" ? { ...node, value: event.target.value } : node) as FilterGroupDraft : prev)}
                />
                <button className="btn btn-sm btn-ghost text-danger" onClick={() => setFilterDraftTree((prev) => prev ? removeFilterTreeNode(prev, child.id) : prev)}>
                  {t("mysql.tableManager.removeCondition")}
                </button>
              </div>
            );
          }) : (
            <div className="muted" style={{ fontSize: "12px" }}>{t("mysql.tableManager.emptyGroup")}</div>
          )}
        </div>
      </div>
    );

    return (
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #e5e5ea", gap: "12px", flexShrink: 0 }}>
          <div style={{ fontSize: "12px", color: "#6b7280", display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
              {filterStats.conditions > 0
                ? t("mysql.tableManager.filterSummary", {
                    count: filterStats.conditions,
                    groups: filterStats.groups,
                    mode: activeFilterTree?.mode === "or" ? t("mysql.tableManager.matchAny") : t("mysql.tableManager.matchAll")
                  })
                : t("mysql.tableManager.noFilterApplied")}
              {filterStats.conditions > 0 && (
                <button className="btn btn-sm btn-ghost" onClick={() => void clearFilter()}>{t("common.close")}</button>
              )}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
              {activeOpenedTable?.sortColumn
                ? t("mysql.tableManager.sortSummary", {
                    column: activeOpenedTable.sortColumn,
                    direction: activeOpenedTable.sortDirection === "desc" ? t("dataBrowser.sortDescending") : t("dataBrowser.sortAscending")
                  })
                : t("mysql.tableManager.noSortApplied")}
              {activeOpenedTable?.sortColumn && (
                <button className="btn btn-sm btn-ghost" onClick={() => void clearSort()}>{t("common.close")}</button>
              )}
            </span>
          </div>
          <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                syncFilterDraftFromOpenedTable(activeOpenedTable, dataState.columns);
                setFilterPanelOpen((prev) => !prev);
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
            {selectedCells.length > 0 && (
              <button className="btn btn-sm btn-ghost" onClick={() => openBatchEditModal(selectedCells)}>
                {t("mysql.tableManager.batchEditSelectedCells")}
              </button>
            )}
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => fetchData()}
              disabled={dataState.loading}
            >
              {dataState.loading ? t("common.loading") : t("common.refresh")}
            </button>
          </div>
        </div>

        {filterPanelOpen && (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e5ea", background: "#f8fafc", display: "grid", gap: "12px", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "13px" }}>{t("mysql.tableManager.filterPanelTitle")}</strong>
                <span className="muted" style={{ fontSize: "12px" }}>{t("mysql.tableManager.filterTreeHint")}</span>
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button className="btn btn-sm btn-ghost" onClick={() => setFilterPanelOpen(false)}>{t("common.close")}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => void clearFilter()}>{t("mysql.tableManager.clearFilter")}</button>
                <button className="btn btn-sm btn-primary" onClick={() => void applyFilter(filterDraftTree)}>{t("common.save")}</button>
              </div>
            </div>
            {filterDraftTree ? renderFilterGroup(filterDraftTree, true, 0) : null}
          </div>
        )}

        {selectedCells.length > 0 && (
          <div style={{ padding: "8px 16px", borderBottom: "1px solid #eef1f4", background: "#f8fbff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap", flexShrink: 0 }}>
            <span style={{ fontSize: "12px", color: "#4b5563" }}>
              {t("mysql.tableManager.selectedCellsSummary", { count: selectedCells.length })}
              {" · "}
              {t("mysql.tableManager.selectionHint")}
            </span>
            <button className="btn btn-sm btn-ghost" onClick={() => setSelectedCells([])}>{t("mysql.tableManager.clearSelection")}</button>
          </div>
        )}

        {/* Data error */}
        {dataState.error && (
          <div className="text-danger" style={{ margin: "8px 12px", padding: "8px 12px", background: "#fef2f2", borderRadius: "8px" }}>
            {dataState.error}
          </div>
        )}

        {dataState.columns.length > 0 && activeOpenedTable && (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #eef1f4", background: "#fbfdff", display: "grid", gap: "8px", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "13px" }}>{t("mysql.tableManager.displayColumns")}</strong>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button className="btn btn-sm btn-ghost" onClick={handleSelectAllVisibleColumns}>{t("common.selectAll")}</button>
                <button className="btn btn-sm btn-ghost" onClick={() => updateOpenedTableVisibleColumns(activeOpenedTable.database, activeOpenedTable.table, dataState.columns)}>{t("common.close")}</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {dataState.columns.map((column) => {
                const checked = visibleDataColumns.includes(column);
                return (
                  <label key={column} style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: "999px", background: checked ? "#eff6ff" : "#fff", fontSize: "12px", cursor: "pointer" }}>
                    <input type="checkbox" checked={checked} onChange={(event) => handleVisibleColumnToggle(column, event.target.checked)} />
                    <span>{column}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Data table */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: "50px" }}>#</th>
                {visibleDataColumns.map((col) => {
                  const isSorted = activeOpenedTable?.sortColumn === col;
                  const sortArrow = isSorted
                    ? activeOpenedTable?.sortDirection === "desc"
                      ? "↓"
                      : "↑"
                    : "";
                  return (
                    <th
                      key={col}
                      onContextMenu={(event) => handleColumnHeaderContextMenu(event, col)}
                      style={{ cursor: "context-menu", userSelect: "none" }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        <span>{col}</span>
                        <span style={{ minWidth: "10px", fontSize: "12px", lineHeight: 1, color: "#2563eb", visibility: isSorted ? "visible" : "hidden" }}>
                          {sortArrow || "↑"}
                        </span>
                      </span>
                    </th>
                  );
                })}
                <th style={{ width: "100px", textAlign: "right" }}>{t("dataBrowser.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {dataState.rows.map((row, rowIndex) => (
                <>
                  <tr key={rowIndex} style={{ background: selectedRowIndex === rowIndex ? "#eef4ff" : undefined }} onClick={() => setSelectedRowIndex(rowIndex)}>
                    <td className="muted">{(dataState.page - 1) * dataState.pageSize + rowIndex + 1}</td>
                    {visibleDataColumns.map((column) => {
                      const cellIndex = dataState.columns.indexOf(column);
                      const cell = row[cellIndex];
                      return (
                        <td
                          key={`${rowIndex}-${column}`}
                          style={{
                            maxWidth: "300px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            background: selectedCellKeySet.has(`${rowIndex}:${cellIndex}`) ? "#dceafe" : undefined,
                            boxShadow: selectedCellKeySet.has(`${rowIndex}:${cellIndex}`) ? "inset 0 0 0 1px #60a5fa" : undefined,
                            cursor: "cell"
                          }}
                          title={cell === null ? "NULL" : String(cell)}
                          onClick={(event) => handleCellClick(event, rowIndex, cellIndex)}
                          onContextMenu={(event) => handleRowContextMenu(event, rowIndex, column, cell)}
                        >
                          {cell === null ? <span className="muted">NULL</span> : String(cell)}
                        </td>
                      );
                    })}
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
                      <td colSpan={visibleDataColumns.length + 2}>
                        <pre style={{ background: "#f5f7fb", padding: "12px", borderRadius: "8px", fontSize: "12px", margin: 0, whiteSpace: "pre-wrap" }}>
                          {JSON.stringify(
                            Object.fromEntries(visibleDataColumns.map((col) => [col, row[dataState.columns.indexOf(col)]])),
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
                  <td colSpan={visibleDataColumns.length + 2} className="muted" style={{ textAlign: "center", padding: "32px" }}>
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
              void copyToClipboard(formatSqlValue(rowContextMenu.value));
              setRowContextMenu(null);
            }}
          >
            {t("mysql.tableManager.copySqlValue")}
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
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              void copyToClipboard(buildInsertSql(rowContextMenu.rowIndex));
              setRowContextMenu(null);
            }}
          >
            {t("mysql.tableManager.copyInsert")}
          </button>
          <div style={{ height: "1px", background: "#e5e5ea", margin: "4px 0" }} />
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              void applyFilter(appendConditionToRootTree(
                activeFilterTree,
                createFilterCondition(
                  rowContextMenu.column,
                  rowContextMenu.value === null ? "isNull" : typeof rowContextMenu.value === "string" && rowContextMenu.value === "" ? "emptyString" : "eq",
                  rowContextMenu.value === null ? "" : String(rowContextMenu.value)
                )
              ));
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
          <div style={{ height: "1px", background: "#e5e5ea", margin: "4px 0" }} />
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              void applyValueToCells(getContextTargetCells(rowContextMenu), "");
              setRowContextMenu(null);
            }}
          >
            {t("mysql.tableManager.setEmptyString")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              void applyValueToCells(getContextTargetCells(rowContextMenu), null);
              setRowContextMenu(null);
            }}
          >
            {t("mysql.tableManager.setNull")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              handleEditCell(rowContextMenu.rowIndex, rowContextMenu.column, rowContextMenu.value);
              setRowContextMenu(null);
            }}
          >
            {t("mysql.tableManager.editCell")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              const targetCells = getContextTargetCells(rowContextMenu);
              setSelectedCells(targetCells);
              openBatchEditModal(targetCells);
              setRowContextMenu(null);
            }}
          >
            {t("mysql.tableManager.batchEditSelectedCells")}
          </button>
        </div>
      )}

      {columnHeaderContextMenu && (
        <div
          style={{
            position: "fixed",
            left: `${columnHeaderContextMenu.x}px`,
            top: `${columnHeaderContextMenu.y}px`,
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
              void applySort(columnHeaderContextMenu.column, "asc");
              setColumnHeaderContextMenu(null);
            }}
          >
            {t("dataBrowser.sortAscending")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              void applySort(columnHeaderContextMenu.column, "desc");
              setColumnHeaderContextMenu(null);
            }}
          >
            {t("dataBrowser.sortDescending")}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            style={{ width: "100%", justifyContent: "flex-start" }}
            onClick={() => {
              void clearSort();
              setColumnHeaderContextMenu(null);
            }}
          >
            {t("mysql.tableManager.clearSort")}
          </button>
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

      {editingCell && (
        <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: "520px", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 className="card-title">{t("mysql.tableManager.cellEditorTitle", { column: editingCell.column })}</h3>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditingCell(null)}>{t("common.close")}</button>
            </div>
            <div style={{ flex: 1, padding: "16px", overflow: "auto", display: "grid", gap: "8px" }}>
              <label>{t("mysql.tableManager.cellValue")}</label>
              <textarea
                className="json-editor"
                style={{ width: "100%", minHeight: "180px", fontFamily: "monospace", fontSize: "13px", padding: "12px", border: "1px solid #d1d1d6", borderRadius: "8px", resize: "vertical" }}
                value={editingCell.value}
                onChange={(event) => setEditingCell((prev) => prev ? { ...prev, value: event.target.value } : prev)}
              />
              {editError && <div className="text-danger">{editError}</div>}
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid #e5e5ea", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setEditingCell(null)}>{t("common.cancel")}</button>
              <button className="btn btn-sm btn-primary" onClick={() => void handleSaveCellEdit()}>{t("common.save")}</button>
            </div>
          </div>
        </div>
      )}

      {batchEditOpen && (
        <div className="modal-overlay" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="card" style={{ width: "520px", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 className="card-title">{t("mysql.tableManager.batchEditTitle", { count: selectedCells.length })}</h3>
              <button className="btn btn-sm btn-ghost" onClick={() => setBatchEditOpen(false)}>{t("common.close")}</button>
            </div>
            <div style={{ padding: "16px", display: "grid", gap: "12px" }}>
              <div>
                <label>{t("mysql.tableManager.batchEditMode")}</label>
                <select className="form-control" value={batchEditDraft.mode} onChange={(event) => setBatchEditDraft((prev) => ({ ...prev, mode: event.target.value as BatchEditMode }))}>
                  <option value="text">{t("mysql.tableManager.batchEditUseText")}</option>
                  <option value="null">{t("mysql.tableManager.batchEditUseNull")}</option>
                  <option value="empty">{t("mysql.tableManager.batchEditUseEmptyString")}</option>
                </select>
              </div>
              <div>
                <label>{t("mysql.tableManager.batchEditValue")}</label>
                <textarea
                  className="json-editor"
                  disabled={batchEditDraft.mode !== "text"}
                  style={{ width: "100%", minHeight: "160px", fontFamily: "monospace", fontSize: "13px", padding: "12px", border: "1px solid #d1d1d6", borderRadius: "8px", resize: "vertical" }}
                  value={batchEditDraft.value}
                  onChange={(event) => setBatchEditDraft((prev) => ({ ...prev, value: event.target.value }))}
                />
              </div>
              {batchEditError && <div className="text-danger">{batchEditError}</div>}
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid #e5e5ea", display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setBatchEditOpen(false)}>{t("common.cancel")}</button>
              <button className="btn btn-sm btn-primary" onClick={() => void handleSaveBatchEdit()}>{t("common.save")}</button>
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
