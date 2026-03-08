import { useState } from "react";
import { useTranslation } from "react-i18next";
import { logError } from "../../../lib/errorLog";
import { useAppContext } from "../../../state/AppContext";
import { esRequestRaw } from "../services/client";

const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"] as const;

type HttpMethod = typeof METHODS[number];

type ResponseState = {
  status: number | null;
  ok: boolean | null;
  timeMs: number | null;
  body: string;
  finishedAt: number | null;
};

type BatchResult = {
  index: number;
  method: HttpMethod;
  path: string;
  status: number | null;
  ok: boolean | null;
  timeMs: number;
  body: string;
  error?: string;
};

type ScriptTemplate = {
  id: string;
  name: string;
  content: string;
  updatedAt: number;
};

export default function RestConsole() {
  const { t } = useTranslation();
  const { activeConnection } = useAppContext();

  const [method, setMethod] = useState<HttpMethod>("GET");
  const [path, setPath] = useState("/_cluster/health");
  const [requestBody, setRequestBody] = useState("");
  const [batchMode, setBatchMode] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [batchExpanded, setBatchExpanded] = useState<Set<number>>(new Set());
  const [concurrency, setConcurrency] = useState(3);
  const [stopOnError, setStopOnError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [retryDelayMs, setRetryDelayMs] = useState(500);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchCompleted, setBatchCompleted] = useState(0);
  const [templates, setTemplates] = useState<ScriptTemplate[]>(() => {
    try {
      const raw = localStorage.getItem("restConsoleTemplates");
      if (!raw) return [];
      const parsed = JSON.parse(raw) as ScriptTemplate[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      logError(error, {
        source: "restConsole.loadTemplates",
        message: "Failed to parse REST console templates from local storage"
      });
      return [];
    }
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateName, setTemplateName] = useState("");
  const [response, setResponse] = useState<ResponseState>({ status: null, ok: null, timeMs: null, body: "", finishedAt: null });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pretty, setPretty] = useState(true);

  const normalizePath = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return "";
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  };

  const formatJson = (text: string) => {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  };

  const formatFinishedAt = (timestamp: number) => new Date(timestamp).toLocaleString("zh-CN");

  const parseBatchCommands = (text: string) => {
    const lines = text.split(/\r?\n/);
    const methodSet = new Set(METHODS);
    const commands: Array<{ method: HttpMethod; path: string; bodyText: string }> = [];
    let current: { method: HttpMethod; path: string; bodyLines: string[] } | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) {
        if (current) {
          current.bodyLines.push(line);
        }
        continue;
      }

      const match = trimmed.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD)\s+(\S+)/i);
      if (match) {
        const methodCandidate = match[1].toUpperCase() as HttpMethod;
        if (!methodSet.has(methodCandidate)) {
          continue;
        }
        if (current) {
          commands.push({
            method: current.method,
            path: current.path,
            bodyText: current.bodyLines.join("\n").trim()
          });
        }
        current = {
          method: methodCandidate,
          path: normalizePath(match[2]),
          bodyLines: []
        };
        continue;
      }

      if (current) {
        current.bodyLines.push(line);
      }
    }

    if (current) {
      commands.push({
        method: current.method,
        path: current.path,
        bodyText: current.bodyLines.join("\n").trim()
      });
    }

    return commands;
  };

  const formatBatchText = (text: string) => {
    const commands = parseBatchCommands(text);
    if (commands.length === 0) {
      throw new Error(t('restConsole.noCommandDetected'));
    }
    return commands
      .map((cmd) => {
        let bodyBlock = "";
        if (cmd.bodyText) {
          const formatted = formatJson(cmd.bodyText);
          bodyBlock = `\n${formatted}`;
        }
        return `${cmd.method} ${cmd.path}${bodyBlock}`;
      })
      .join("\n\n")
      .trim();
  };

  const handleFormatRequest = () => {
    setError("");
    try {
      if (batchMode) {
        const formattedBatch = formatBatchText(batchText);
        setBatchText(formattedBatch);
        return;
      }
      const formatted = formatJson(requestBody.trim() || "{}");
      setRequestBody(formatted);
    } catch (err) {
      logError(err, {
        source: "restConsole.formatRequest",
        message: "Failed to format REST request payload"
      });
      setError(`${t("restConsole.invalidJsonFormat")}${err instanceof Error ? err.message : t("restConsole.parseFailed")}`);
    }
  };

  const handleFormatResponse = () => {
    setError("");
    try {
      if (!response.body) return;
      const formatted = formatJson(response.body);
      setResponse((prev) => ({ ...prev, body: formatted }));
    } catch (err) {
      logError(err, {
        source: "restConsole.formatResponse",
        message: "Failed to format REST response payload"
      });
      setError(`${t("restConsole.invalidResponseJson")}${err instanceof Error ? err.message : t("restConsole.parseFailed")}`);
    }
  };

  const persistTemplates = (next: ScriptTemplate[]) => {
    setTemplates(next);
    localStorage.setItem("restConsoleTemplates", JSON.stringify(next));
  };

  const handleSaveTemplate = () => {
    const content = batchMode ? batchText.trim() : "";
    if (!batchMode) {
      setError(t("restConsole.onlyBatchMode"));
      return;
    }
    if (!content) {
      setError(t("restConsole.emptyTemplate"));
      return;
    }
    const name = templateName.trim();
    if (!name) {
      setError(t("restConsole.templateNameRequired"));
      return;
    }
    const now = Date.now();
    const existing = templates.find((t) => t.name === name);
    if (existing) {
      const updated = templates.map((t) => (t.id === existing.id ? { ...t, content, updatedAt: now } : t));
      persistTemplates(updated);
      setSelectedTemplateId(existing.id);
      return;
    }
    const next: ScriptTemplate = {
      id: `${now}-${Math.random().toString(16).slice(2)}`,
      name,
      content,
      updatedAt: now
    };
    persistTemplates([next, ...templates]);
    setSelectedTemplateId(next.id);
  };

  const handleLoadTemplate = (id: string) => {
    setSelectedTemplateId(id);
    const target = templates.find((t) => t.id === id);
    if (!target) return;
    setBatchMode(true);
    setBatchText(target.content);
    setTemplateName(target.name);
  };

  const handleDeleteTemplate = () => {
    if (!selectedTemplateId) return;
    const target = templates.find((t) => t.id === selectedTemplateId);
    if (!target) return;
    if (!window.confirm(t("restConsole.deleteTemplateConfirm", { name: target.name }))) return;
    const next = templates.filter((t) => t.id !== selectedTemplateId);
    persistTemplates(next);
    setSelectedTemplateId("");
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      logError(error, {
        source: "restConsole.copyText",
        message: "Failed to copy REST console text to clipboard"
      });
    }
  };

  const downloadText = (filename: string, text: string) => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExecute = async () => {
    setError("");
    setLoading(true);
    setResponse({ status: null, ok: null, timeMs: null, body: "", finishedAt: null });
    setBatchResults([]);
    setBatchExpanded(new Set());
    setBatchCompleted(0);
    setBatchTotal(0);

    if (!activeConnection) {
      setError(t("restConsole.noConnectionSelected"));
      setLoading(false);
      return;
    }

    if (batchMode) {
      const commands = parseBatchCommands(batchText);
      if (commands.length === 0) {
        setError(t("restConsole.noCommandDetected"));
        setLoading(false);
        return;
      }

      setBatchTotal(commands.length);

      const start = performance.now();
      const results: BatchResult[] = new Array(commands.length);
      let cursor = 0;
      let stopped = false;

      const worker = async () => {
        while (true) {
          if (stopped) return;
          const current = cursor;
          cursor += 1;
          if (current >= commands.length) return;
          const cmd = commands[current];
          const headerPath = cmd.path || "";

          if (!headerPath) {
            results[current] = {
              index: current,
              method: cmd.method,
              path: cmd.path,
              status: null,
              ok: false,
              timeMs: 0,
              body: "",
              error: t("restConsole.missingPath")
            };
            if (stopOnError) {
              stopped = true;
              return;
            }
            continue;
          }

          let body: unknown = undefined;
          if (cmd.bodyText) {
            try {
              body = JSON.parse(cmd.bodyText);
            } catch (err) {
              logError(err, {
                source: "restConsole.parseBatchBody",
                message: `Failed to parse batch command JSON for ${cmd.method} ${cmd.path}`
              });
              results[current] = {
                index: current,
                method: cmd.method,
                path: cmd.path,
                status: null,
                ok: false,
                timeMs: 0,
                body: "",
                error: `${t("restConsole.invalidJsonFormat")}${err instanceof Error ? err.message : t("restConsole.parseFailed")}`
              };
              if (stopOnError) {
                stopped = true;
                return;
              }
              continue;
            }
          }

          const reqStart = performance.now();
          let attempt = 0;
          let lastError: string | null = null;
          while (attempt <= retryCount) {
            try {
              const res = await esRequestRaw(activeConnection, cmd.path, {
                method: cmd.method,
                body
              });

              let nextBody = res.body;
              if (pretty) {
                try {
                  nextBody = JSON.stringify(JSON.parse(res.body), null, 2);
                } catch (error) {
                  logError(error, {
                    source: "restConsole.prettyBatchResponse",
                    message: `Failed to pretty print batch response for ${cmd.method} ${cmd.path}`
                  });
                }
              }

              results[current] = {
                index: current,
                method: cmd.method,
                path: cmd.path,
                status: res.status,
                ok: res.ok,
                timeMs: Math.round(performance.now() - reqStart),
                body: nextBody
              };
              lastError = null;
              break;
            } catch (err) {
              lastError = err instanceof Error ? err.message : String(err);
              if (attempt >= retryCount) {
                results[current] = {
                  index: current,
                  method: cmd.method,
                  path: cmd.path,
                  status: null,
                  ok: false,
                  timeMs: Math.round(performance.now() - reqStart),
                  body: "",
                  error: lastError
                };
                if (stopOnError) {
                  stopped = true;
                  break;
                }
              } else {
                await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
              }
            }
            attempt += 1;
          }
          if (stopOnError && stopped) {
            setBatchCompleted((prev) => prev + 1);
            return;
          }
          setBatchCompleted((prev) => prev + 1);
        }
      };

      const workerCount = Math.max(1, Math.min(10, Math.floor(concurrency)));
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      const timeMs = Math.round(performance.now() - start);
      const filled = results.filter(Boolean) as BatchResult[];
      setBatchResults(filled);
      setResponse({ status: null, ok: null, timeMs, body: "", finishedAt: null });
      if (filled.length > 0) {
        setBatchExpanded(new Set([filled[0].index]));
      }
      setLoading(false);
      return;
    }

    const normalizedPath = normalizePath(path);
    if (!normalizedPath) {
      setError(t("restConsole.enterPath"));
      setLoading(false);
      return;
    }

    let body: unknown = undefined;
    const bodyTrim = requestBody.trim();
    if (bodyTrim) {
      try {
        body = JSON.parse(bodyTrim);
      } catch (err) {
        setError(`${t("restConsole.invalidJsonFormat")}${err instanceof Error ? err.message : t("restConsole.parseFailed")}`);
        setLoading(false);
        return;
      }
    }

    const start = performance.now();
    try {
      const res = await esRequestRaw(activeConnection, normalizedPath, {
        method,
        body
      });
      const timeMs = Math.round(performance.now() - start);

      let nextBody = res.body;
      if (pretty) {
        try {
          nextBody = JSON.stringify(JSON.parse(res.body), null, 2);
        } catch (error) {
          logError(error, {
            source: "restConsole.prettyResponse",
            message: `Failed to pretty print response for ${method} ${normalizedPath}`
          });
        }
      }

      setResponse({
        status: res.status,
        ok: res.ok,
        timeMs,
        body: nextBody,
        finishedAt: Date.now()
      });
    } catch (err) {
      logError(err, {
        source: "restConsole.execute",
        message: `REST console execution failed for ${method} ${normalizedPath}`
      });
      setError(`${t("restConsole.requestFailed")}${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setResponse((prev) => (prev.finishedAt ? prev : { ...prev, finishedAt: Date.now() }));
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">{t("restConsole.title")}</h3>
            <p className="muted" style={{ margin: 0 }}>{t("restConsole.description")}</p>
          </div>
          <div className="button-group">
            <button className="btn btn-primary" onClick={handleExecute} disabled={loading}>
              {loading ? t("restConsole.executing") : t("restConsole.execute")}
            </button>
          </div>
        </div>
        <div className="card-body">
          <div className="rest-toolbar">
            {!batchMode && (
              <>
                <select className="form-control rest-method" value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <input
                  className="form-control rest-path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={t("restConsole.pathPlaceholder")}
                />
              </>
            )}
            <label className="rest-pretty-toggle">
              <input type="checkbox" checked={pretty} onChange={(e) => setPretty(e.target.checked)} />
              {t("restConsole.formatResponse")}
            </label>
            <label className="rest-pretty-toggle">
              <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)} />
              {t("restConsole.batchMode")}
            </label>
            {batchMode && (
              <>
                <label className="rest-pretty-toggle">
                  {t("restConsole.concurrency")}
                  <input
                    type="number"
                    min={1}
                    max={10}
                    className="form-control rest-concurrency"
                    value={concurrency}
                    onChange={(e) => setConcurrency(Number(e.target.value) || 1)}
                  />
                </label>
                <label className="rest-pretty-toggle">
                  <input type="checkbox" checked={stopOnError} onChange={(e) => setStopOnError(e.target.checked)} />
                  {t("restConsole.stopOnFailure")}
                </label>
                <label className="rest-pretty-toggle">
                  {t("restConsole.retry")}
                  <input
                    type="number"
                    min={0}
                    max={5}
                    className="form-control rest-concurrency"
                    value={retryCount}
                    onChange={(e) => setRetryCount(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <label className="rest-pretty-toggle">
                  {t("restConsole.retryInterval")}
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    className="form-control rest-concurrency"
                    value={retryDelayMs}
                    onChange={(e) => setRetryDelayMs(Math.max(0, Number(e.target.value) || 0))}
                  />
                </label>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    if (batchResults.length === 0) return;
                    const allExpanded = batchResults.every((r) => batchExpanded.has(r.index));
                    if (allExpanded) {
                      setBatchExpanded(new Set());
                    } else {
                      setBatchExpanded(new Set(batchResults.map((r) => r.index)));
                    }
                  }}
                >
                  {batchResults.length > 0 && batchResults.every((r) => batchExpanded.has(r.index))
                    ? t("restConsole.collapseAll")
                    : t("restConsole.expandAll")}
                </button>
              </>
            )}
            <div className="rest-toolbar-actions">
              <button className="btn btn-sm btn-secondary" onClick={handleFormatRequest}>{t("restConsole.formatRequest")}</button>
              <button className="btn btn-sm btn-ghost" onClick={handleFormatResponse}>{t("restConsole.formatResult")}</button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  if (batchMode) {
                    setBatchText("");
                  } else {
                    setRequestBody("");
                  }
                }}
              >
                {t("restConsole.clearRequest")}
              </button>
            </div>
          </div>

          {batchMode && (
            <div className="rest-template-bar">
              <div className="rest-template-left">
                <select
                  className="form-control rest-template-select"
                  value={selectedTemplateId}
                  onChange={(e) => handleLoadTemplate(e.target.value)}
                >
                  <option value="">{t("restConsole.selectTemplate")}</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <input
                  className="form-control rest-template-input"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder={t("restConsole.templateName")}
                />
              </div>
              <div className="rest-template-actions">
                <button className="btn btn-sm btn-secondary" onClick={handleSaveTemplate}>{t("restConsole.saveTemplate")}</button>
                <button className="btn btn-sm btn-ghost text-danger" onClick={handleDeleteTemplate} disabled={!selectedTemplateId}>{t("restConsole.deleteTemplate")}</button>
              </div>
            </div>
          )}

          {error && <div className="text-danger" style={{ marginBottom: "12px" }}>{error}</div>}

          <div className="rest-console">
            <div className="rest-panel">
              <div className="rest-panel-header">
                {batchMode ? t("restConsole.batchRequest") : t("restConsole.requestBody")}
              </div>
              {batchMode ? (
                <textarea
                  className="json-editor rest-editor"
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  placeholder={t("restConsole.batchPlaceholder")}
                />
              ) : (
                <textarea
                  className="json-editor rest-editor"
                  value={requestBody}
                  onChange={(e) => setRequestBody(e.target.value)}
                  placeholder={t("restConsole.requestPlaceholder")}
                />
              )}
            </div>
            <div className="rest-panel">
              <div className="rest-panel-header">
                <span>{t("restConsole.responseResult")}</span>
                <div className="rest-panel-actions">
                  {!batchMode && response.finishedAt !== null && (
                    <span className="rest-finish-time">{t("restConsole.completedTime")}{formatFinishedAt(response.finishedAt)}</span>
                  )}
                  {!batchMode && (
                    <>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => copyText(response.body || "")}
                        disabled={!response.body}
                      >
                        {t("restConsole.copy")}
                      </button>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() =>
                          downloadText(
                            `rest-response-${response.finishedAt ? new Date(response.finishedAt).toISOString().replace(/[:.]/g, "-") : "latest"}.txt`,
                            response.body || ""
                          )
                        }
                        disabled={!response.body}
                      >
                        {t("restConsole.download")}
                      </button>
                    </>
                  )}
                  {response.status !== null && (
                    <span className={`rest-status ${response.ok ? "ok" : "fail"}`}>
                      {response.status} · {response.timeMs ?? 0}ms
                    </span>
                  )}
                  {response.status === null && !response.body && response.timeMs !== null && batchResults.length > 0 && (
                    <span className="rest-status ok">
                      {t("restConsole.batchCompleted")}{response.timeMs ?? 0}ms
                    </span>
                  )}
                </div>
              </div>
              {batchMode && batchTotal > 0 && (
                <div className="rest-progress">
                  <div className="rest-progress-track">
                    <div
                      className="rest-progress-bar"
                      style={{ width: `${Math.round((batchCompleted / batchTotal) * 100)}%` }}
                    />
                  </div>
                  <div className="rest-progress-text">
                    {batchCompleted}/{batchTotal}
                  </div>
                </div>
              )}
              {batchMode ? (
                <div className="rest-batch-list">
                  {batchResults.length === 0 && <div className="muted">{t("restConsole.noResponse")}</div>}
                  {batchResults.map((item) => {
                    const expanded = batchExpanded.has(item.index);
                    const title = `#${item.index + 1} ${item.method} ${item.path}`;
                    const statusText = item.status !== null ? `${item.status}` : t("common.error");
                    const content = item.error ? `${t("common.error")}: ${item.error}` : item.body || t("restConsole.noResponse");
                    return (
                      <div key={`${item.index}-${item.method}-${item.path}`} className="rest-batch-item">
                        <button
                          className="rest-batch-header"
                          onClick={() => {
                            setBatchExpanded((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.index)) {
                                next.delete(item.index);
                              } else {
                                next.add(item.index);
                              }
                              return next;
                            });
                          }}
                        >
                          <span className="rest-batch-title">{title}</span>
                          <div className="rest-batch-actions">
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={(event) => {
                                event.stopPropagation();
                                copyText(content);
                              }}
                            >
                              {t("restConsole.copy")}
                            </button>
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={(event) => {
                                event.stopPropagation();
                                downloadText(`rest-result-${item.index + 1}.txt`, content);
                              }}
                            >
                              {t("restConsole.download")}
                            </button>
                            <span className={`rest-status ${item.ok ? "ok" : "fail"}`}>
                              {statusText} · {item.timeMs}ms
                            </span>
                          </div>
                        </button>
                        {expanded && (
                          <pre className="rest-response">
                            {content}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <pre className="rest-response">{response.body || t("restConsole.noResponse")}</pre>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
