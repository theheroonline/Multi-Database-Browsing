import { type ChangeEvent, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { format as formatSql } from "sql-formatter";
import { logError } from "../../../lib/errorLog";
import { useAppContext } from "../../../state/AppContext";
import { useMysqlContext } from "../../../state/MysqlContext";
import { mysqlConnect, mysqlDescribeTable, mysqlListDatabases, mysqlListTables, mysqlQuery, type MysqlQueryResult } from "../services/client";

interface ExecutedStatementResult {
  id: string;
  sql: string;
  effectiveSql: string;
  mode: "execute" | "explain";
  durationMs: number;
  connectionName: string;
  databaseUsed?: string;
  result?: MysqlQueryResult;
  explainResult?: MysqlQueryResult;
  error?: string;
}

interface AutocompleteItem {
  label: string;
  insertText: string;
  type: "keyword" | "table" | "column" | "database";
  detail?: string;
}

type AutocompleteContext = "mixed" | "keyword" | "table" | "column" | "database";

const MYSQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "ORDER BY",
  "GROUP BY",
  "LIMIT",
  "INSERT INTO",
  "UPDATE",
  "DELETE FROM",
  "JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "SHOW TABLES",
  "DESCRIBE",
  "USE"
];

function splitSqlStatements(input: string) {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const nextChar = input[index + 1];

    if (inLineComment) {
      current += char;
      if (char === "\n") inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === "*" && nextChar === "/") {
        current += nextChar;
        index += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (char === "-" && nextChar === "-") {
        current += char + nextChar;
        index += 1;
        inLineComment = true;
        continue;
      }
      if (char === "/" && nextChar === "*") {
        current += char + nextChar;
        index += 1;
        inBlockComment = true;
        continue;
      }
    }

    if (char === "'" && !inDoubleQuote && !inBacktick) {
      const escaped = input[index - 1] === "\\";
      if (!escaped) inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }
    if (char === '"' && !inSingleQuote && !inBacktick) {
      const escaped = input[index - 1] === "\\";
      if (!escaped) inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }
    if (char === "`" && !inSingleQuote && !inDoubleQuote) {
      inBacktick = !inBacktick;
      current += char;
      continue;
    }

    if (char === ";" && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      if (current.trim()) {
        statements.push(current.trim());
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

function getTokenRange(text: string, caretPosition: number) {
  let start = caretPosition;
  let end = caretPosition;
  while (start > 0 && /[\w$.]/.test(text[start - 1])) start -= 1;
  while (end < text.length && /[\w$.]/.test(text[end])) end += 1;
  return { start, end, token: text.slice(start, end) };
}

function detectAutocompleteContext(text: string, caretPosition: number): AutocompleteContext {
  const prefix = text.slice(Math.max(0, caretPosition - 240), caretPosition).replace(/\s+/g, " ").toUpperCase();

  if (/\bUSE\s+[\w$.`]*$/.test(prefix)) {
    return "database";
  }
  if (/\b(FROM|JOIN|UPDATE|INTO|TABLE|DESCRIBE|TRUNCATE|DELETE\s+FROM)\s+[\w$.`]*$/.test(prefix)) {
    return "table";
  }
  if (/\b(SELECT|WHERE|AND|OR|ON|HAVING|SET|ORDER\s+BY|GROUP\s+BY)\s+[\w$.`]*$/.test(prefix)) {
    return "column";
  }
  return "mixed";
}

function getTypePriority(context: AutocompleteContext, type: AutocompleteItem["type"]) {
  switch (context) {
    case "database":
      return type === "database" ? 0 : type === "keyword" ? 2 : 4;
    case "table":
      return type === "table" ? 0 : type === "keyword" ? 2 : type === "column" ? 4 : 5;
    case "column":
      return type === "column" ? 0 : type === "keyword" ? 2 : type === "table" ? 4 : 5;
    case "keyword":
      return type === "keyword" ? 0 : 4;
    default:
      return type === "keyword" ? 0 : type === "table" ? 1 : type === "column" ? 2 : 3;
  }
}

function getVisibleColumns(columns: string[], preferred?: string[]) {
  if (!preferred || preferred.length === 0) {
    return columns;
  }

  const nextColumns = preferred.filter((column) => columns.includes(column));
  return nextColumns.length > 0 ? nextColumns : columns;
}

export default function MysqlSqlQuery() {
  const { t } = useTranslation();
  const { addHistory, activeConnectionId, setActiveConnection, state } = useAppContext();
  const {
    activeMysqlConnection,
    databases,
    setDatabases,
    selectedDatabase,
    setSelectedDatabase,
    tablesByDb,
    setTablesByDb,
    getMysqlConnectionById
  } = useMysqlContext();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autocompleteListRef = useRef<HTMLDivElement | null>(null);
  const autocompleteOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [sql, setSql] = useState("");
  const [results, setResults] = useState<ExecutedStatementResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectionRange, setSelectionRange] = useState({ start: 0, end: 0 });
  const [columnMap, setColumnMap] = useState<Record<string, string[]>>({});
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [autocompleteItems, setAutocompleteItems] = useState<AutocompleteItem[]>([]);
  const [autocompleteRange, setAutocompleteRange] = useState({ start: 0, end: 0 });
  const [loadedConnectionId, setLoadedConnectionId] = useState<string | null>(null);
  const [connectedDatabaseId, setConnectedDatabaseId] = useState<string | null>(null);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [resultVisibleColumns, setResultVisibleColumns] = useState<Record<string, string[]>>({});

  const connectionId = activeMysqlConnection?.id;
  const selectedText = sql.slice(selectionRange.start, selectionRange.end).trim();
  const mysqlProfiles = useMemo(
    () => state.profiles.filter((profile) => profile.engine === "mysql"),
    [state.profiles]
  );

  const selectedDatabaseTables = useMemo(() => {
    if (!selectedDatabase) return [];
    return tablesByDb[selectedDatabase] ?? [];
  }, [selectedDatabase, tablesByDb]);

  const autocompleteSource = useMemo<AutocompleteItem[]>(() => {
    const tableItems = selectedDatabaseTables.map((table) => ({
      label: table,
      insertText: table,
      type: "table" as const,
      detail: selectedDatabase ?? undefined
    }));

    const databaseItems = databases.map((database) => ({
      label: database,
      insertText: database,
      type: "database" as const,
      detail: t("mysql.query.databaseOption")
    }));

    const columnItems = Object.entries(columnMap).flatMap(([table, columns]) =>
      columns.map((column) => ({
        label: column,
        insertText: column,
        type: "column" as const,
        detail: table
      }))
    );

    const keywordItems = MYSQL_KEYWORDS.map((keyword) => ({
      label: keyword,
      insertText: `${keyword} `,
      type: "keyword" as const
    }));

    return [...keywordItems, ...databaseItems, ...tableItems, ...columnItems];
  }, [columnMap, databases, selectedDatabase, selectedDatabaseTables, t]);

  const activeResult = useMemo(
    () => results.find((item) => item.id === activeResultId) ?? results[0] ?? null,
    [activeResultId, results]
  );

  useEffect(() => {
    if (!autocompleteOpen) return;
    const activeOption = autocompleteOptionRefs.current[autocompleteIndex];
    activeOption?.scrollIntoView({ block: "nearest" });
  }, [autocompleteIndex, autocompleteOpen]);

  const ensureDatabasesLoaded = async (targetConnectionId: string, preferredDatabase?: string) => {
    const dbs = await mysqlListDatabases(targetConnectionId);
    setDatabases(dbs);
    const nextDatabase = preferredDatabase && dbs.includes(preferredDatabase)
      ? preferredDatabase
      : dbs[0];
    setSelectedDatabase(nextDatabase);
    return dbs;
  };

  const ensureConnectionDatabase = async (targetConnectionId: string, database?: string) => {
    const targetConnection = getMysqlConnectionById(targetConnectionId);
    if (!targetConnection) {
      throw new Error("CONNECTION_FAILED");
    }

    const nextDatabase = database?.trim() || undefined;
    const cacheKey = `${targetConnectionId}::${nextDatabase ?? ""}`;
    if (connectedDatabaseId === cacheKey) {
      return;
    }

    await mysqlConnect({
      ...targetConnection,
      database: nextDatabase
    });
    setConnectedDatabaseId(cacheKey);
  };

  const escapeSqlIdentifier = (value: string) => `\`${value.replace(/`/g, "``")}\``;

  const detectUseDatabase = (statement: string) => {
    const match = statement.match(/^\s*USE\s+`?([\w$]+)`?\s*$/i);
    return match?.[1];
  };

  const detectQualifiedDatabase = (statement: string) => {
    const match = statement.match(/`?([\w$]+)`?\s*\.\s*`?[\w$]+`?/);
    return match?.[1];
  };

  const buildExplainSql = (statement: string) => (/^\s*EXPLAIN\b/i.test(statement) ? statement : `EXPLAIN ${statement}`);

  const copyToClipboard = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch (err) {
      logError(err, {
        source: "mysqlSqlQuery.copyClipboard",
        message: "Failed to copy MySQL SQL query result to clipboard"
      });
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    async function loadConnectionDatabases() {
      if (!connectionId || loadedConnectionId === connectionId) return;
      try {
        await ensureConnectionDatabase(connectionId, activeMysqlConnection?.database || selectedDatabase);
        await ensureDatabasesLoaded(connectionId, selectedDatabase ?? activeMysqlConnection?.database);
        setLoadedConnectionId(connectionId);
        setColumnMap({});
      } catch (err) {
        logError(err, {
          source: "mysqlSqlQuery.loadDatabases",
          message: `Failed to load databases for MySQL connection ${connectionId}`
        });
      }
    }

    void loadConnectionDatabases();
  }, [activeMysqlConnection?.database, connectionId, loadedConnectionId, selectedDatabase]);

  useEffect(() => {
    async function loadTablesAndColumns() {
      if (!connectionId || !selectedDatabase) return;
      try {
        const tables = tablesByDb[selectedDatabase] ?? await mysqlListTables(connectionId, selectedDatabase);
        if (!tablesByDb[selectedDatabase]) {
          setTablesByDb((prev) => ({ ...prev, [selectedDatabase]: tables }));
        }

        const missingTables = tables.filter((table) => !columnMap[table]);
        if (missingTables.length === 0) return;

        const entries = await Promise.all(
          missingTables.map(async (table) => {
            const columns = await mysqlDescribeTable(connectionId, selectedDatabase, table);
            return [table, columns.map((column) => column.field)] as const;
          })
        );

        setColumnMap((prev) => ({
          ...prev,
          ...Object.fromEntries(entries)
        }));
      } catch (err) {
        logError(err, {
          source: "mysqlSqlQuery.autocompleteMeta",
          message: `Failed to load autocomplete metadata for ${selectedDatabase}`
        });
      }
    }

    void loadTablesAndColumns();
  }, [columnMap, connectionId, selectedDatabase, setTablesByDb, tablesByDb]);

  const updateAutocomplete = (nextSql: string, caretPosition: number) => {
    const { start, end, token } = getTokenRange(nextSql, caretPosition);
    const normalized = token.trim().toLowerCase();
    const lookupToken = normalized.split(".").pop() ?? normalized;
    const context = detectAutocompleteContext(nextSql, caretPosition);
    if (!normalized) {
      setAutocompleteOpen(false);
      setAutocompleteItems([]);
      return;
    }

    const filtered = autocompleteSource
      .filter((item) => item.label.toLowerCase().includes(lookupToken))
      .sort((left, right) => {
        const leftStarts = left.label.toLowerCase().startsWith(lookupToken) ? 0 : 1;
        const rightStarts = right.label.toLowerCase().startsWith(lookupToken) ? 0 : 1;
        const typeDiff = getTypePriority(context, left.type) - getTypePriority(context, right.type);
        if (typeDiff !== 0) return typeDiff;
        if (leftStarts !== rightStarts) return leftStarts - rightStarts;
        return left.label.localeCompare(right.label);
      })
      .slice(0, 12);

    setAutocompleteRange({ start, end });
    setAutocompleteItems(filtered);
    setAutocompleteIndex(0);
    setAutocompleteOpen(filtered.length > 0);
  };

  const applyAutocomplete = (item: AutocompleteItem) => {
    const nextSql = `${sql.slice(0, autocompleteRange.start)}${item.insertText}${sql.slice(autocompleteRange.end)}`;
    const nextCaret = autocompleteRange.start + item.insertText.length;
    setSql(nextSql);
    setAutocompleteOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
      setSelectionRange({ start: nextCaret, end: nextCaret });
    });
  };

  const executeStatements = async (rawSql: string, historyLabel: string, mode: "execute" | "explain" = "execute") => {
    if (!connectionId || !rawSql.trim()) return;

    const statements = splitSqlStatements(rawSql);
    if (statements.length === 0) return;

    setLoading(true);
    setError("");
    setResults([]);

    const nextResults: ExecutedStatementResult[] = [];
    let batchDatabase = selectedDatabase;

    if (batchDatabase) {
      try {
        await ensureConnectionDatabase(connectionId, batchDatabase);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLoading(false);
        setError(message);
        return;
      }
    }

    for (const statement of statements) {
      const explicitUseDatabase = detectUseDatabase(statement);
      const explicitQualifiedDatabase = detectQualifiedDatabase(statement);
      const databaseUsed = explicitUseDatabase ?? explicitQualifiedDatabase ?? batchDatabase;
      let effectiveSql = statement;

      try {
        if (explicitUseDatabase) {
          await ensureConnectionDatabase(connectionId, explicitUseDatabase);
          batchDatabase = explicitUseDatabase;
          setSelectedDatabase(explicitUseDatabase);
          nextResults.push({
            id: `${Date.now()}-${nextResults.length}`,
            sql: statement,
            effectiveSql: `-- switch default database to ${explicitUseDatabase}`,
            mode,
            durationMs: 0,
            connectionName: activeMysqlConnection?.name ?? connectionId,
            databaseUsed: explicitUseDatabase,
            result: {
              columns: [],
              rows: [],
              affectedRows: 0,
              isResultSet: false
            }
          });
          continue;
        }

        if (!explicitQualifiedDatabase && batchDatabase) {
          await ensureConnectionDatabase(connectionId, batchDatabase);
          effectiveSql = `-- default database ${escapeSqlIdentifier(batchDatabase)}\n${mode === "explain" ? buildExplainSql(statement) : statement}`;
        } else if (mode === "explain") {
          effectiveSql = buildExplainSql(statement);
        }

        const startedAt = performance.now();
        const querySql = mode === "explain" ? buildExplainSql(statement) : statement;
        const res = await mysqlQuery(connectionId, querySql);
        const durationMs = performance.now() - startedAt;
        nextResults.push({
          id: `${Date.now()}-${nextResults.length}`,
          sql: statement,
          effectiveSql,
          mode,
          durationMs,
          connectionName: activeMysqlConnection?.name ?? connectionId,
          databaseUsed,
          result: res
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logError(err, {
          source: "mysqlSqlQuery.execute",
          message: `Failed to execute MySQL SQL on connection ${connectionId}`,
          detail: statement
        });
        nextResults.push({
          id: `${Date.now()}-${nextResults.length}`,
          sql: statement,
          effectiveSql,
          mode,
          durationMs: 0,
          connectionName: activeMysqlConnection?.name ?? connectionId,
          databaseUsed,
          error: message
        });
      }
    }

    setResults(nextResults);
    setActiveResultId(nextResults[0]?.id ?? null);
    setResultVisibleColumns(() => Object.fromEntries(
      nextResults
        .filter((item) => item.result?.isResultSet)
        .map((item) => [item.id, item.result?.columns ?? []])
    ));
    if (nextResults.every((item) => item.error)) {
      setError(nextResults[0]?.error ?? "");
    }

    await addHistory(historyLabel, rawSql.trim());
    setLoading(false);
  };

  const handleConnectionSwitch = async (nextConnectionId: string) => {
    if (!nextConnectionId || nextConnectionId === activeConnectionId) return;
    const nextConnection = getMysqlConnectionById(nextConnectionId);
    if (!nextConnection) return;

    setMetaLoading(true);
    setError("");
    try {
      await ensureConnectionDatabase(nextConnectionId, nextConnection.database);
      await setActiveConnection(nextConnectionId);
      setTablesByDb({});
      setColumnMap({});
      await ensureDatabasesLoaded(nextConnectionId, nextConnection.database);
      setLoadedConnectionId(nextConnectionId);
    } catch (err) {
      logError(err, {
        source: "mysqlSqlQuery.switchConnection",
        message: `Failed to switch MySQL connection to ${nextConnectionId}`
      });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMetaLoading(false);
    }
  };

  const handleDatabaseSwitch = async (nextDatabase: string) => {
    setSelectedDatabase(nextDatabase || undefined);
    if (!connectionId || !nextDatabase) return;
    try {
      await ensureConnectionDatabase(connectionId, nextDatabase);
    } catch (err) {
      logError(err, {
        source: "mysqlSqlQuery.switchDatabaseConnect",
        message: `Failed to switch MySQL default database to ${nextDatabase}`
      });
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!tablesByDb[nextDatabase]) {
      try {
        const tables = await mysqlListTables(connectionId, nextDatabase);
        setTablesByDb((prev) => ({ ...prev, [nextDatabase]: tables }));
      } catch (err) {
        logError(err, {
          source: "mysqlSqlQuery.switchDatabase",
          message: `Failed to load tables for database ${nextDatabase}`
        });
      }
    }
  };

  const handleFormatSql = () => {
    if (!sql.trim()) return;
    try {
      const formatted = formatSql(sql, { language: "mysql", tabWidth: 2, keywordCase: "upper" });
      setSql(formatted);
      setAutocompleteOpen(false);
    } catch (err) {
      logError(err, {
        source: "mysqlSqlQuery.formatSql",
        message: "Failed to format SQL in MySQL query editor"
      });
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExecuteAll = async () => {
    await executeStatements(sql, selectedDatabase ? `[${selectedDatabase}] SQL` : "MySQL SQL");
  };

  const handleExecuteSelection = async () => {
    if (!selectedText) return;
    await executeStatements(selectedText, selectedDatabase ? `[${selectedDatabase}] SQL Selection` : "MySQL SQL Selection");
  };

  const handleExplain = async () => {
    const targetSql = selectedText || sql;
    if (!targetSql.trim()) return;
    await executeStatements(
      targetSql,
      selectedDatabase ? `[${selectedDatabase}] SQL Explain` : "MySQL SQL Explain",
      "explain"
    );
  };

  const handleResultColumnToggle = (resultId: string, column: string, checked: boolean, allColumns: string[]) => {
    setResultVisibleColumns((prev) => {
      const currentColumns = getVisibleColumns(allColumns, prev[resultId]);
      const nextColumns = checked
        ? [...currentColumns, column]
        : currentColumns.filter((item) => item !== column);
      return {
        ...prev,
        [resultId]: nextColumns.length > 0 ? nextColumns : allColumns
      };
    });
  };

  const handleSelectAllResultColumns = (resultId: string, allColumns: string[]) => {
    setResultVisibleColumns((prev) => ({
      ...prev,
      [resultId]: allColumns
    }));
  };

  const handleCloseResult = (resultId: string) => {
    setResults((prev) => {
      const nextResults = prev.filter((item) => item.id !== resultId);
      const removedIndex = prev.findIndex((item) => item.id === resultId);
      setActiveResultId((currentActiveId) => {
        if (currentActiveId !== resultId) {
          return currentActiveId;
        }
        if (nextResults.length === 0) {
          return null;
        }
        const nextIndex = Math.min(removedIndex, nextResults.length - 1);
        return nextResults[nextIndex]?.id ?? null;
      });
      setResultVisibleColumns((prevColumns) => {
        const nextColumns = { ...prevColumns };
        delete nextColumns[resultId];
        return nextColumns;
      });
      return nextResults;
    });
  };

  const handleEditorChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    setSql(nextValue);
    setSelectionRange({ start: event.target.selectionStart, end: event.target.selectionEnd });
    updateAutocomplete(nextValue, event.target.selectionStart);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocompleteOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setAutocompleteIndex((prev) => {
        if (e.key === "ArrowDown") {
          return (prev + 1) % Math.max(autocompleteItems.length, 1);
        }
        return (prev - 1 + Math.max(autocompleteItems.length, 1)) % Math.max(autocompleteItems.length, 1);
      });
      return;
    }

    if (autocompleteOpen && (e.key === "Enter" || e.key === "Tab")) {
      e.preventDefault();
      const item = autocompleteItems[autocompleteIndex];
      if (item) {
        applyAutocomplete(item);
      }
      return;
    }

    if (autocompleteOpen && e.key === "Escape") {
      e.preventDefault();
      setAutocompleteOpen(false);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Enter") {
      e.preventDefault();
      void handleExecuteAll();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (selectedText) {
        void handleExecuteSelection();
      } else {
        void handleExecuteAll();
      }
    }
  };

  if (mysqlProfiles.length === 0) {
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
            <button className="btn btn-sm btn-ghost" onClick={() => void handleExplain()} disabled={loading || (!sql.trim() && !selectedText)}>
              {loading ? t("common.loading") : t("mysql.query.explain")}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={handleFormatSql} disabled={!sql.trim() || loading || metaLoading}>
              {t("mysql.query.formatSql")}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setSql("")}>
              {t("common.clear")}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => void handleExecuteSelection()} disabled={loading || !selectedText}>
              {loading ? t("common.loading") : t("mysql.query.executeSelection")}
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void handleExecuteAll()} disabled={loading || !sql.trim()}>
              {loading ? t("common.loading") : t("mysql.query.execute")}
            </button>
          </div>
        </div>
        <div style={{ padding: "12px 16px", position: "relative", display: "grid", gap: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 320px) minmax(200px, 260px) auto", gap: "12px", alignItems: "center" }}>
            <div>
              <label style={{ display: "block", fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>{t("mysql.query.connection")}</label>
              <select
                className="form-control"
                value={activeConnectionId ?? ""}
                disabled={metaLoading || loading}
                onChange={(event) => void handleConnectionSwitch(event.target.value)}
              >
                {mysqlProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: "12px", color: "#6b7280", marginBottom: "4px" }}>{t("mysql.query.database")}</label>
              <select
                className="form-control"
                value={selectedDatabase ?? ""}
                disabled={!activeMysqlConnection || metaLoading || loading || databases.length === 0}
                onChange={(event) => void handleDatabaseSwitch(event.target.value)}
              >
                {databases.length === 0 ? (
                  <option value="">{t("mysql.query.noDatabaseOptions")}</option>
                ) : (
                  databases.map((database) => (
                    <option key={database} value={database}>{database}</option>
                  ))
                )}
              </select>
            </div>
            <div className="muted" style={{ fontSize: "12px", alignSelf: "end", paddingBottom: "8px" }}>
              {metaLoading ? t("common.loading") : t("mysql.query.selectorHint")}
            </div>
          </div>

          <div style={{ position: "relative" }}>
            <textarea
              ref={textareaRef}
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
              disabled={!activeMysqlConnection || metaLoading}
              onChange={handleEditorChange}
              onClick={(e) => {
                const target = e.currentTarget;
                setSelectionRange({ start: target.selectionStart, end: target.selectionEnd });
              }}
              onKeyUp={(e) => {
                if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
                  return;
                }
                const target = e.currentTarget;
                setSelectionRange({ start: target.selectionStart, end: target.selectionEnd });
                updateAutocomplete(target.value, target.selectionStart);
              }}
              onSelect={(e) => {
                const target = e.currentTarget;
                setSelectionRange({ start: target.selectionStart, end: target.selectionEnd });
              }}
              onBlur={() => {
                window.setTimeout(() => setAutocompleteOpen(false), 120);
              }}
              onFocus={(e) => updateAutocomplete(e.currentTarget.value, e.currentTarget.selectionStart)}
              onKeyDown={handleKeyDown}
              placeholder="SELECT * FROM table_name LIMIT 100;\nUPDATE table_name SET status = 'done' WHERE id = 1;\n\n-- Ctrl+Enter 执行选中内容，Ctrl+Shift+Enter 执行全部"
              spellCheck={false}
            />
            {autocompleteOpen && autocompleteItems.length > 0 && (
              <div
                ref={autocompleteListRef}
                style={{
                  position: "absolute",
                  left: "0",
                  top: "calc(100% + 6px)",
                  zIndex: 20,
                  background: "#fff",
                  border: "1px solid #d1d5db",
                  borderRadius: "8px",
                  boxShadow: "0 10px 28px rgba(15,23,42,0.14)",
                  overflow: "auto",
                  width: "max-content",
                  minWidth: "260px",
                  maxWidth: "min(440px, 100%)",
                  maxHeight: "200px"
                }}
              >
              {autocompleteItems.map((item, index) => (
                <button
                  key={`${item.type}-${item.label}-${index}`}
                  type="button"
                  ref={(element) => {
                    autocompleteOptionRefs.current[index] = element;
                  }}
                  style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "10px",
                    padding: "3px 8px",
                    border: 0,
                    background: index === autocompleteIndex ? "#dbeafe" : "#fff",
                    boxShadow: index === autocompleteIndex ? "inset 0 0 0 1px #60a5fa" : "none",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: "11px",
                    lineHeight: 1.3,
                    color: index === autocompleteIndex ? "#0f172a" : "#1f2937",
                    transition: "background-color 120ms ease, box-shadow 120ms ease, color 120ms ease"
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyAutocomplete(item);
                  }}
                  onMouseEnter={() => setAutocompleteIndex(index)}
                >
                  <span style={{ display: "flex", gap: "8px", alignItems: "center", minWidth: 0, paddingRight: "8px" }}>
                    <span
                      style={{
                        fontSize: "9px",
                        lineHeight: 1,
                        padding: "2px 3px",
                        borderRadius: "4px",
                        background: item.type === "keyword" ? "#eff6ff" : item.type === "table" ? "#ecfdf5" : item.type === "column" ? "#fff7ed" : "#f3f4f6",
                        color: item.type === "keyword" ? "#1d4ed8" : item.type === "table" ? "#047857" : item.type === "column" ? "#c2410c" : "#4b5563",
                        textTransform: "uppercase",
                        flexShrink: 0
                      }}
                    >
                      {item.type === "keyword" ? "K" : item.type === "table" ? "T" : item.type === "column" ? "C" : "DB"}
                    </span>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: index === autocompleteIndex ? 600 : 500 }}>{item.label}</span>
                  </span>
                  <span className="muted" style={{ fontSize: "10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "140px", flexShrink: 0, color: index === autocompleteIndex ? "#1d4ed8" : "#6b7280" }}>
                    {item.detail}
                  </span>
                </button>
              ))}
              </div>
            )}
          </div>
          <div className="muted" style={{ fontSize: "12px", marginTop: "4px" }}>
            {t("mysql.query.shortcutHint")}
          </div>
          {selectedText && (
            <div className="muted" style={{ fontSize: "12px", marginTop: "4px" }}>
              {t("mysql.query.selectionReady", { count: splitSqlStatements(selectedText).length })}
            </div>
          )}
          <div className="muted" style={{ fontSize: "12px", marginTop: "4px" }}>
            {t("mysql.query.autocompleteHint")}
          </div>
          <div className="muted" style={{ fontSize: "12px", marginTop: "4px" }}>
            {t("mysql.query.contextAutocompleteHint")}
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
      {results.length > 0 && (
        <div className="card">
          {results.length > 1 && (
            <div style={{ display: "flex", gap: "0", borderBottom: "1px solid #e5e7eb", overflowX: "auto", padding: "0 16px" }}>
              {results.map((item, index) => (
                <div
                  key={item.id}
                  className={`btn btn-sm ${activeResult?.id === item.id ? "btn-primary" : "btn-ghost"}`}
                  style={{ borderRadius: "8px 8px 0 0", marginTop: "12px", marginRight: "8px", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: "6px", paddingRight: "6px" }}
                >
                  <button
                    type="button"
                    style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: 0 }}
                    onClick={() => setActiveResultId(item.id)}
                  >
                    {t("mysql.query.resultStatement", { index: index + 1 })}
                  </button>
                  <button
                    type="button"
                    style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: "0 4px", lineHeight: 1 }}
                    title={t("common.close")}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleCloseResult(item.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {activeResult && (() => {
            const resultSet = activeResult.result;
            const visibleColumns = resultSet?.isResultSet ? getVisibleColumns(resultSet.columns, resultVisibleColumns[activeResult.id]) : [];
            return (
              <>
                <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                  <h3 className="card-title">
                    {t("mysql.query.resultStatement", { index: results.findIndex((item) => item.id === activeResult.id) + 1 })}
                    <span className="muted" style={{ fontWeight: 400, fontSize: "13px", marginLeft: "8px" }}>
                      {activeResult.error
                        ? t("mysql.query.statementFailed")
                        : activeResult.mode === "explain"
                          ? t("mysql.query.explainMode")
                          : resultSet?.isResultSet
                            ? `(${resultSet.rows.length} rows)`
                            : t("mysql.query.affectedRows", { count: resultSet?.affectedRows ?? 0 })}
                    </span>
                  </h3>
                  <div style={{ display: "flex", gap: "8px" }}>
                    {resultSet?.isResultSet && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => void copyToClipboard(JSON.stringify(resultSet.rows.map((row) => Object.fromEntries(visibleColumns.map((column) => [column, row[resultSet.columns.indexOf(column)]]))), null, 2))}
                      >
                        {t("mysql.query.copyResult")}
                      </button>
                    )}
                    <button className="btn btn-sm btn-ghost" onClick={() => void copyToClipboard(activeResult.sql)}>
                      {t("common.copy")}
                    </button>
                  </div>
                </div>
                <div style={{ padding: "0 16px 12px", display: "flex", gap: "8px", flexWrap: "wrap", fontSize: "12px" }}>
                  <span className="pill">{t("mysql.query.executionTime", { ms: activeResult.durationMs.toFixed(1) })}</span>
                  <span className="pill">{t("mysql.query.usedConnection", { name: activeResult.connectionName })}</span>
                  {activeResult.databaseUsed && <span className="pill">{t("mysql.query.usedDatabase", { name: activeResult.databaseUsed })}</span>}
                </div>

                {activeResult.error ? (
                  <div className="text-danger" style={{ margin: "0 16px 16px", padding: "8px 12px", background: "#fef2f2", borderRadius: "8px" }}>
                    {activeResult.error}
                  </div>
                ) : resultSet?.isResultSet ? (
                  <>
                    <div style={{ padding: "0 16px 12px", display: "grid", gap: "8px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                        <strong style={{ fontSize: "13px" }}>{t("mysql.query.displayColumns")}</strong>
                        <button className="btn btn-sm btn-ghost" onClick={() => handleSelectAllResultColumns(activeResult.id, resultSet.columns)}>
                          {t("common.selectAll")}
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {resultSet.columns.map((column) => {
                          const checked = visibleColumns.includes(column);
                          return (
                            <label key={column} style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 10px", border: "1px solid #e5e7eb", borderRadius: "999px", background: checked ? "#eff6ff" : "#fff", fontSize: "12px", cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => handleResultColumnToggle(activeResult.id, column, event.target.checked, resultSet.columns)}
                              />
                              <span>{column}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{ padding: "0 16px 16px" }}>
                      <div style={{ maxHeight: "360px", overflow: "auto", display: "grid", gap: "10px" }}>
                        {resultSet.rows.length > 0 ? resultSet.rows.map((row, rowIndex) => {
                          const rowObject = Object.fromEntries(visibleColumns.map((column) => [column, row[resultSet.columns.indexOf(column)]]));
                          return (
                            <div key={rowIndex} style={{ border: "1px solid #e5e7eb", borderRadius: "10px", background: "#f8fafc", padding: "12px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", gap: "8px" }}>
                                <strong style={{ fontSize: "13px" }}># {rowIndex + 1}</strong>
                                <button className="btn btn-sm btn-ghost" onClick={() => void copyToClipboard(JSON.stringify(rowObject, null, 2))}>
                                  {t("dataBrowser.copyRow")}
                                </button>
                              </div>
                              <div style={{ display: "grid", gap: "8px" }}>
                                {visibleColumns.map((column) => {
                                  const value = row[resultSet.columns.indexOf(column)];
                                  return (
                                    <div key={column} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 220px) 1fr", gap: "12px", alignItems: "start" }}>
                                      <div className="muted" style={{ fontSize: "12px", wordBreak: "break-word" }}>{column}</div>
                                      <div
                                        style={{ fontSize: "13px", whiteSpace: "pre-wrap", wordBreak: "break-word", cursor: "copy" }}
                                        title={t("mysql.query.clickToCopy")}
                                        onClick={() => void copyToClipboard(value === null ? "NULL" : String(value))}
                                      >
                                        {value === null ? <span className="muted">NULL</span> : String(value)}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        }) : (
                          <div className="muted" style={{ textAlign: "center", padding: "32px" }}>
                            {t("mysql.query.noRows")}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ padding: "24px", textAlign: "center" }}>
                    <div style={{ fontSize: "14px", color: "#22c55e" }}>
                      {t("mysql.query.statementDone")} {t("mysql.query.affectedRows", { count: resultSet?.affectedRows ?? 0 })}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {results.length === 0 && !error && (
        <div className="card" style={{ padding: "32px", textAlign: "center" }}>
          <span className="muted">{t("mysql.query.empty")}</span>
        </div>
      )}
    </div>
  );
}
