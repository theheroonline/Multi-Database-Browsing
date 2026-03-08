import { ConfigProvider, DatePicker } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import dayjs, { Dayjs } from "dayjs";
import "dayjs/locale/zh-cn";
import { Fragment, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import FieldFilterButton, { type FieldFilterState } from "../../../components/FieldFilterButton";
import { logError } from "../../../lib/errorLog";
import { useAppContext } from "../../../state/AppContext";
import { extractFieldsFromMapping, getIndexMapping, sqlQuery } from "../services/client";
import SqlHistory from "./SqlHistory";

const { RangePicker } = DatePicker;

type SqlOperation = "select" | "insert" | "update" | "delete";

type WhereCondition = {
  field: string;
  operator: string;
  value: string;
  enabled: boolean;
  rangeValue?: [Dayjs | null, Dayjs | null] | null;
};

type SqlQueryCacheState = {
  selectedIndex?: string;
  result: { columns: string[]; rows: Array<Array<unknown>> } | null;
  operation: SqlOperation;
  whereConditions: WhereCondition[];
  payload: string;
  limit: number;
  fieldFilter: FieldFilterState;
};

const sqlQueryCacheByConnection = new Map<string, SqlQueryCacheState>();

export default function SqlQuery() {
  const { t, i18n } = useTranslation();
  const { activeConnection, addHistory, indices } = useAppContext();
  const [selectedIndex, setSelectedIndex] = useState<string | undefined>(undefined);
  const [operation, setOperation] = useState<SqlOperation>("select");
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [whereConditions, setWhereConditions] = useState<WhereCondition[]>([
    { field: "", operator: "=", value: "", enabled: true }
  ]);
  const [payload, setPayload] = useState("{}");
  const [sql, setSql] = useState("");
  const [limit, setLimit] = useState(100);
  const [result, setResult] = useState<{ columns: string[]; rows: Array<Array<unknown>> } | null>(null);
  const [error, setError] = useState("");
  const [totalRows, setTotalRows] = useState(0);
  const [expandedSqlRows, setExpandedSqlRows] = useState<Set<number>>(new Set());

  // Field Filter State (shared component)
  const [fieldFilter, setFieldFilter] = useState<FieldFilterState>({ enabled: false, fields: [] });
  
  const presets = [
    { label: t('presets.lastHour'), value: [dayjs().subtract(1, 'hour'), dayjs()] as [Dayjs, Dayjs] },
    { label: t('presets.last24Hours'), value: [dayjs().subtract(24, 'hour'), dayjs()] as [Dayjs, Dayjs] },
    { label: t('presets.last7Days'), value: [dayjs().subtract(7, 'day'), dayjs()] as [Dayjs, Dayjs] },
    { label: t('presets.today'), value: [dayjs().startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs] },
    { label: t('presets.yesterday'), value: [dayjs().subtract(1, 'day').startOf('day'), dayjs().subtract(1, 'day').endOf('day')] as [Dayjs, Dayjs] },
  ];

  useEffect(() => {
    dayjs.locale(i18n.language === "zh" ? "zh-cn" : "en");
  }, [i18n.language]);

  useEffect(() => {
    const connectionId = activeConnection?.id;
    if (!connectionId) {
      setSelectedIndex(undefined);
      setAvailableFields([]);
      setResult(null);
      setOperation("select");
      setWhereConditions([{ field: "", operator: "=", value: "", enabled: true }]);
      setPayload("{}");
      setLimit(100);
      setFieldFilter({ enabled: false, fields: [] });
      return;
    }

    const cached = sqlQueryCacheByConnection.get(connectionId);
    if (!cached) {
      setSelectedIndex(undefined);
      setAvailableFields([]);
      setResult(null);
      setOperation("select");
      setWhereConditions([{ field: "", operator: "=", value: "", enabled: true }]);
      setPayload("{}");
      setLimit(100);
      setFieldFilter({ enabled: false, fields: [] });
      return;
    }

    setSelectedIndex(cached.selectedIndex);
    setResult(cached.result);
    setOperation(cached.operation);
    setWhereConditions(cached.whereConditions.length > 0 ? cached.whereConditions : [{ field: "", operator: "=", value: "", enabled: true }]);
    setPayload(cached.payload);
    setLimit(cached.limit);
    setFieldFilter(cached.fieldFilter);
  }, [activeConnection?.id]);

  useEffect(() => {
    if (selectedIndex && !indices.includes(selectedIndex)) {
      setSelectedIndex(undefined);
      setResult(null);
    }
  }, [indices, selectedIndex]);

  useEffect(() => {
    const connectionId = activeConnection?.id;
    if (!connectionId) return;
    sqlQueryCacheByConnection.set(connectionId, {
      selectedIndex,
      result,
      operation,
      whereConditions,
      payload,
      limit,
      fieldFilter
    });
  }, [activeConnection?.id, selectedIndex, result, operation, whereConditions, payload, limit, fieldFilter]);

  // 获取索引字段
  useEffect(() => {
    if (!activeConnection || !selectedIndex) {
      setAvailableFields([]);
      return;
    }
    let ignore = false;
    getIndexMapping(activeConnection, selectedIndex)
      .then((mapping) => {
        if (ignore) return;
        const extracted = extractFieldsFromMapping(mapping, selectedIndex);
        setAvailableFields(extracted);
      })
      .catch(() => {
        if (ignore) return;
        setAvailableFields([]);
      });
    return () => { ignore = true; };
  }, [activeConnection?.id, selectedIndex]);

  const formatDateTime = (value: Dayjs | null) => (value ? value.format("YYYY-MM-DD HH:mm:ss") : "");

  // 生成 SQL
  useEffect(() => {
    const name = selectedIndex || "your_index";
    let generated = "";
    switch (operation) {
      case "select":
        const fieldsPart = !fieldFilter.enabled ? "*" : fieldFilter.fields.join(", ");
        const enabledConditions = whereConditions.filter((c) => 
          c.enabled && c.field && (c.value || (c.operator === "RANGE" && c.rangeValue && c.rangeValue[0] && c.rangeValue[1]))
        );
        
        // 构建WHERE条件
        let conditions: string[] = [];
        
        // 添加普通条件
        conditions = enabledConditions.map((c) => {
          if (c.operator === "RANGE" && c.rangeValue && c.rangeValue[0] && c.rangeValue[1]) {
            const startStr = formatDateTime(c.rangeValue[0]);
            const endStr = formatDateTime(c.rangeValue[1]);
            return `${c.field} >= '${startStr}' AND ${c.field} <= '${endStr}'`;
          }
          
          switch (c.operator) {
            case "=": return `${c.field} = '${c.value}'`;
            case "!=": return `${c.field} != '${c.value}'`;
            case ">": return `${c.field} > '${c.value}'`;
            case ">=": return `${c.field} >= '${c.value}'`;
            case "<": return `${c.field} < '${c.value}'`;
            case "<=": return `${c.field} <= '${c.value}'`;
            case "LIKE": return `${c.field} LIKE '%${c.value}%'`;
            default: return `${c.field} = '${c.value}'`;
          }
        });
        
        const wherePart = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
        generated = `SELECT ${fieldsPart} FROM ${name}${wherePart} LIMIT ${limit}`;
        break;
      case "insert":
        generated = `INSERT INTO ${name} VALUES ${payload}`;
        break;
      case "update":
        generated = `UPDATE ${name} SET ${payload}`;
        break;
      case "delete":
        generated = `DELETE FROM ${name}`;
        break;
      default:
        generated = "";
    }
    setSql(generated);
  }, [operation, selectedIndex, whereConditions, payload, limit, fieldFilter.enabled, fieldFilter.fields]);

  const execute = async () => {
    setError("");
    setResult(null);
    if (!activeConnection) {
      setError(t('sqlQuery.noConnectionSelected'));
      return;
    }
    if (operation !== "select") {
      setError(t('sqlQuery.sqlOnlySupportsQuery'));
      return;
    }
    try {
      const response = await sqlQuery(activeConnection, sql);
      let columns = response.columns?.map((col: { name: string }) => col.name) ?? [];
      let rows = response.rows ?? [];

      // 只显示选中的字段（启用过滤时）
      if (fieldFilter.enabled) {
        const fieldIndices = fieldFilter.fields.map((field) => columns.indexOf(field));
        const validPairs = fieldIndices
          .map((idx, i) => ({ idx, name: fieldFilter.fields[i] }))
          .filter((p) => p.idx >= 0);

        columns = validPairs.map((p) => p.name);
        rows = rows.map((row) => validPairs.map((p) => row[p.idx]));
      }

      setResult({ columns, rows });
      setTotalRows(rows.length);
      await addHistory(selectedIndex ? `SQL: ${selectedIndex}` : t('sqlQuery.sqlHistory'), sql);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.error');
      logError(err, {
        source: "esSqlQuery.execute",
        message: `Elasticsearch SQL execution failed for index ${selectedIndex ?? "unknown"}`
      });
      setError(`${t('sqlQuery.sqlError')} ${message}`);
    }
  };

  const handleLimitChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newLimit = Math.max(1, Math.min(1000, parseInt(event.target.value) || 100));
    setLimit(newLimit);
  };

  const handleConditionChange = (idx: number, next: Partial<WhereCondition>) => {
    setWhereConditions((prev) => prev.map((item, index) => (index === idx ? { ...item, ...next } : item)));
  };

  const addCondition = () => {
    setWhereConditions((prev) => [...prev, { field: "", operator: "=", value: "", enabled: true }]);
  };

  const removeCondition = (idx: number) => {
    if (whereConditions.length === 1) {
      setWhereConditions([{ field: "", operator: "=", value: "", enabled: true }]);
    } else {
      setWhereConditions((prev) => prev.filter((_, index) => index !== idx));
    }
  };

  const toggleCondition = (idx: number) => {
    setWhereConditions((prev) => prev.map((item, index) => (index === idx ? { ...item, enabled: !item.enabled } : item)));
  };

  const toggleSqlRowExpand = (idx: number) => {
    setExpandedSqlRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  // Format ISO datetime strings to readable local format, otherwise fallback to plain rendering
  const formatDateString = (input: string) => {
    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
    if (!isoPattern.test(input)) return null;
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  };

  const renderSqlCellValue = (val: unknown) => {
    if (val === null || val === undefined) return <span className="muted">-</span>;
    const formatted = typeof val === "string" ? formatDateString(val) : null;
    const str = formatted ?? (typeof val === "object" ? JSON.stringify(val) : String(val));
    const shouldTruncate = str.length > 80;
    const preview = shouldTruncate ? `${str.substring(0, 80)}...` : str;
    return (
      <span className="truncated-cell" title={str} data-truncated={shouldTruncate ? "true" : "false"}>
        <span className="truncated-text">{preview}</span>
      </span>
    );
  };



  return (
    <>
      <div className="page">
        <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">{t('sqlQuery.sqlBuilder')}</h3>
            <p className="muted">{t('sqlQuery.sqlBuilderDesc')}</p>
          </div>
          <div className="button-group">
            <button className="btn btn-primary" onClick={execute}>
              <span>▶</span> {t('sqlQuery.executeQuery')}
            </button>
          </div>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div>
              <label>{t('sqlQuery.operationType')}</label>
              <select className="form-control" value={operation} onChange={(event) => setOperation(event.target.value as SqlOperation)}>
                <option value="select">{t('sqlQuery.select')}</option>
                <option value="insert">{t('sqlQuery.insert')}</option>
                <option value="update">{t('sqlQuery.update')}</option>
                <option value="delete">{t('sqlQuery.delete')}</option>
              </select>
            </div>
            <div>
              <label>{t('sqlQuery.selectIndex')}</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <select 
                  className="form-control" 
                  value={selectedIndex ?? ""} 
                  onChange={(event) => setSelectedIndex(event.target.value || undefined)}
                  style={{ paddingRight: selectedIndex ? '30px' : '12px' }}
                >
                  <option value="">{t('sqlQuery.selectIndexPlaceholder')}</option>
                  {indices
                    .filter((item) => !item.startsWith('.'))
                    .sort()
                    .map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                </select>
                {selectedIndex && (
                  <button
                    onClick={() => setSelectedIndex(undefined)}
                    className="btn-clear"
                    style={{
                      position: 'absolute',
                      right: '24px',
                      background: 'none',
                      border: 'none',
                      color: '#86868b',
                      cursor: 'pointer',
                      fontSize: '12px',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title={t('common.clear')}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>



          {/* WHERE 条件构建器 */}
          {operation === "select" && (
            <div style={{ marginTop: '16px' }}>
              <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ margin: 0 }}>{t('sqlQuery.resultLimit')}</label>
                  <input
                    type="number"
                    className="form-control"
                    value={limit}
                    onChange={handleLimitChange}
                    style={{ width: '120px' }}
                    min="1"
                    max="1000"
                  />
                </div>
                <FieldFilterButton
                  allFields={availableFields}
                  state={fieldFilter}
                  onChange={setFieldFilter}
                  align="left"
                  label={t('sqlQuery.fieldFilter')}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontWeight: 600, margin: 0 }}>{t('sqlQuery.whereCondition')}</label>
                <button className="btn btn-sm btn-secondary" onClick={addCondition}>
                  <span>+</span> {t('sqlQuery.addCondition')}
                </button>
              </div>

              <div style={{ 
                background: '#fbfbfd', 
                borderRadius: '12px',
                border: '1px solid rgba(0,0,0,0.05)',
                padding: '16px'
              }}>
                {whereConditions.map((cond, idx) => (
                  <div key={idx} style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '40px 1fr 120px 1fr 80px', 
                    gap: '8px', 
                    marginBottom: idx < whereConditions.length - 1 ? '8px' : '0',
                    opacity: cond.enabled ? 1 : 0.5
                  }}>
                    <label className="switch" style={{ margin: 'auto' }}>
                      <input 
                        type="checkbox" 
                        checked={cond.enabled} 
                        onChange={() => toggleCondition(idx)} 
                      />
                      <span className="slider"></span>
                    </label>
                    <select
                      className="form-control"
                      value={cond.field}
                      onChange={(event) => handleConditionChange(idx, { field: event.target.value })}
                      disabled={!cond.enabled}
                    >
                      <option value="">{t('sqlQuery.selectField')}</option>
                      {availableFields.map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                    <select
                      className="form-control"
                      value={cond.operator}
                      onChange={(event) => handleConditionChange(idx, { operator: event.target.value })}
                      disabled={!cond.enabled}
                    >
                      <option value="=">=</option>
                      <option value="!=">!=</option>
                      <option value=">">&gt;</option>
                      <option value=">=">&gt;=</option>
                      <option value="<">&lt;</option>
                      <option value="<=">&lt;=</option>
                      <option value="LIKE">LIKE</option>
                      <option value="RANGE">{t('sqlQuery.timeRange')}</option>
                    </select>
                    {cond.operator === 'RANGE' ? (
                      <ConfigProvider locale={i18n.language === "zh" ? zhCN : enUS}>
                        <RangePicker
                          showTime
                          size="small"
                          value={cond.rangeValue}
                          onChange={(dates) => handleConditionChange(idx, { rangeValue: dates })}
                          presets={presets}
                          style={{ width: '100%', height: '32px' }}
                          placeholder={[t('sqlQuery.startTime'), t('sqlQuery.endTime')]}
                          disabled={!cond.enabled}
                        />
                      </ConfigProvider>
                    ) : (
                      <input
                        className="form-control"
                        value={cond.value}
                        onChange={(event) => handleConditionChange(idx, { value: event.target.value })}
                        placeholder={t('sqlQuery.enterValue')}
                        disabled={!cond.enabled}
                      />
                    )}
                    <button
                      className="btn btn-sm btn-ghost text-danger"
                      onClick={() => removeCondition(idx)}
                      title={t('sqlQuery.deleteCondition')}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="form-grid" style={{ marginTop: '16px' }}>
            {operation !== "select" && (
              <div className="span-2">
                <label>{t('sqlQuery.setValues')}</label>
                <textarea className="form-control json-editor" style={{ height: '100px' }} value={payload} onChange={(event) => setPayload(event.target.value)} />
              </div>
            )}
            <div className="span-2">
              <label>{t('sqlQuery.generatedSql')}</label>
              <textarea className="form-control json-editor" style={{ height: '100px', background: '#fbfbfd', color: '#1d1d1f' }} value={sql} onChange={(event) => setSql(event.target.value)} />
            </div>
          </div>
          <div className="toolbar">
             {error && <span className="text-danger">{error}</span>}
             {!error && <span className="muted">{t('sqlQuery.sqlNote')}</span>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">
            {t('sqlQuery.queryResult', { count: result ? totalRows : 0 })}
          </h3>
        </div>

        {!result && (
          <div className="card-body">
            <p className="muted" style={{ textAlign: 'center' }}>{t('sqlQuery.noResults')}</p>
          </div>
        )}

            {result && (
          <div style={{
            height: '600px',
            overflow: 'auto',
            borderTop: '1px solid #e2e8f0'
          }}>
            <table className="table">
              <thead style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 10 }}>
                <tr>
                  <th style={{ width: '48px', textAlign: 'center' }}> </th>
                  {result.columns.map((col) => (
                    <th key={col}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, rowIndex) => {
                  const detailObject = result.columns.reduce<Record<string, unknown>>((acc, col, colIndex) => {
                    acc[col] = row[colIndex];
                    return acc;
                  }, {});
                  return (
                    <Fragment key={`row-${rowIndex}`}>
                      <tr>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-ghost btn-icon"
                            onClick={() => toggleSqlRowExpand(rowIndex)}
                            style={{ fontSize: '10px', padding: '2px 6px' }}
                          >
                            {expandedSqlRows.has(rowIndex) ? '▼' : '▶'}
                          </button>
                        </td>
                        {result.columns.map((col, colIndex) => (
                          <td key={`${rowIndex}-${col}`}>
                            {renderSqlCellValue(row[colIndex])}
                          </td>
                        ))}
                      </tr>
                      {expandedSqlRows.has(rowIndex) && (
                        <tr className="expanded-row">
                          <td colSpan={result.columns.length + 1} style={{ background: '#f8fafc', padding: '12px 16px' }}>
                            <pre style={{ margin: 0, fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                              {JSON.stringify(detailObject, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <SqlHistory />
      </div>
    </>
  );
}
