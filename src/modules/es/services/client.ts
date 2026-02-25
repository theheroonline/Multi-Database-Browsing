import { invoke, isTauri } from "@tauri-apps/api/core";
import type { EsConnection } from "../../../lib/types";

const isTauriEnv = isTauri();

interface HttpResponse {
  status: number;
  ok: boolean;
  body: string;
}

let logBuffer: string[] = [];

export function getConnectionLogs(): string[] {
  return [...logBuffer];
}

export function clearConnectionLogs() {
  logBuffer = [];
}

function log(message: string, data?: unknown) {
  const timestamp = new Date().toLocaleTimeString();
  const logLine = data
    ? `[${timestamp}] ${message}: ${JSON.stringify(data, null, 2)}`
    : `[${timestamp}] ${message}`;
  logBuffer.push(logLine);
  console.log(logLine);
}

function extractCredentials(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    if (url.username || url.password) {
      const username = decodeURIComponent(url.username);
      const password = decodeURIComponent(url.password);
      url.username = "";
      url.password = "";
      return { baseUrl: url.toString().replace(/\/$/, ""), username, password };
    }
  } catch {
    // ignore invalid URL
  }
  return null;
}

function buildAuthHeader(connection: EsConnection) {
  if (connection.authType === "basic" && connection.username && connection.password) {
    const token = btoa(`${connection.username}:${connection.password}`);
    return `Basic ${token}`;
  }
  if (connection.authType === "apiKey" && connection.apiKey) {
    return `ApiKey ${connection.apiKey}`;
  }
  return null;
}

function normalizeConnection(connection: EsConnection): EsConnection {
  if (connection.authType === "none") {
    const extracted = extractCredentials(connection.baseUrl);
    if (extracted) {
      return {
        ...connection,
        baseUrl: extracted.baseUrl,
        authType: "basic",
        username: extracted.username,
        password: extracted.password
      };
    }
  }
  return connection;
}

function normalizeBaseUrl(baseUrl: string): string | null {
  const trimmed = baseUrl.trim();
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return url.origin;
  } catch {
    return null;
  }
}

async function tauriHttpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; ok: boolean; body: string }> {
  return await invoke<HttpResponse>("http_request", {
    request: { url, method, headers, body }
  });
}

async function browserHttpRequest(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<{ status: number; ok: boolean; body: string }> {
  const res = await fetch(url, { method, headers, body });
  const resBody = await res.text();
  return { status: res.status, ok: res.ok, body: resBody };
}

export async function esRequest<T>(
  connection: EsConnection,
  path: string,
  options: { method?: string; body?: unknown } = {}
) {
  log("=== ES 请求开始 ===");
  log("1. 原始连接信息", {
    baseUrl: connection.baseUrl,
    authType: connection.authType,
    hasUsername: !!connection.username,
    hasPassword: !!connection.password,
    hasApiKey: !!connection.apiKey
  });

  const normalized = normalizeConnection(connection);
  log("2. 标准化后的连接", {
    baseUrl: normalized.baseUrl,
    authType: normalized.authType
  });

  const normalizedBase = normalizeBaseUrl(normalized.baseUrl);
  if (!normalizedBase) {
    throw new Error("CONNECTION_FAILED");
  }
  const requestPath = `/${path.replace(/^\//, "")}`;

  let url: string;
  if (isTauriEnv) {
    url = `${normalizedBase}${requestPath}`;
    log("3. 构建请求 URL (Tauri直连)", url);
  } else {
    url = `/es${requestPath}`;
    log("3. 构建请求 URL (浏览器代理)", url);
  }

  log("4. 请求方法", options.method ?? "GET");
  log("4.1 运行环境", isTauriEnv ? "Tauri" : "Browser");

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (!isTauriEnv) {
    headers["x-es-target"] = normalizedBase;
    log("5. 已添加代理目标头", normalizedBase);
  }

  const auth = buildAuthHeader(normalized);
  if (auth) {
    headers["Authorization"] = auth;
    log("5. 已添加认证头");
  } else {
    log("5. 无需认证");
  }

  const bodyStr = options.body ? JSON.stringify(options.body) : undefined;
  if (bodyStr) {
    log("6. 请求体", bodyStr.substring(0, 200));
  }

  log("7. 开始发送请求...");

  try {
    const res = isTauriEnv
      ? await tauriHttpRequest(url, options.method ?? "GET", headers, bodyStr)
      : await browserHttpRequest(url, options.method ?? "GET", headers, bodyStr);

    log("8. 收到响应", {
      status: res.status,
      ok: res.ok
    });

    if (!res.ok) {
      log("9. 响应失败", { status: res.status, body: res.body.substring(0, 500) });
      throw new Error(res.body || `请求失败: ${res.status}`);
    }

    log("9. 解析 JSON 响应...");
    const result = JSON.parse(res.body) as T;
    log("10. 请求成功完成");
    log("=== ES 请求结束 ===");
    return result;
  } catch (error) {
    log("!!! 请求异常 !!!");
    log("错误类型", error instanceof Error ? error.constructor.name : typeof error);
    log("错误信息", error instanceof Error ? error.message : String(error));
    log("完整错误", error);
    log("=== ES 请求异常结束 ===");
    throw error;
  }
}

export async function esRequestRaw(
  connection: EsConnection,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; ok: boolean; body: string }> {
  log("=== ES 原始请求开始 ===");

  const normalized = normalizeConnection(connection);
  const normalizedBase = normalizeBaseUrl(normalized.baseUrl);
  if (!normalizedBase) {
    throw new Error("CONNECTION_FAILED");
  }
  const requestPath = `/${path.replace(/^\//, "")}`;

  let url: string;
  if (isTauriEnv) {
    url = `${normalizedBase}${requestPath}`;
  } else {
    url = `/es${requestPath}`;
  }

  const headers: Record<string, string> = {
    ...(options.headers ?? {})
  };

  if (!isTauriEnv) {
    headers["x-es-target"] = normalizedBase;
  }

  const auth = buildAuthHeader(normalized);
  if (auth) {
    headers["Authorization"] = auth;
  }

  let bodyStr: string | undefined;
  if (options.body !== undefined) {
    if (typeof options.body === "string") {
      bodyStr = options.body;
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "text/plain";
      }
    } else {
      bodyStr = JSON.stringify(options.body);
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  }

  try {
    const res = isTauriEnv
      ? await tauriHttpRequest(url, options.method ?? "GET", headers, bodyStr)
      : await browserHttpRequest(url, options.method ?? "GET", headers, bodyStr);
    return res;
  } catch (error) {
    log("错误信息", error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export async function pingCluster(connection: EsConnection) {
  return esRequest(connection, "/_cluster/health");
}

export interface SqlResponse {
  columns?: Array<{ name: string }>;
  rows?: Array<Array<unknown>>;
}

export async function sqlQuery(connection: EsConnection, query: string) {
  return esRequest<SqlResponse>(connection, "/_sql?format=json", {
    method: "POST",
    body: { query }
  });
}

export interface CatIndexItem {
  index: string;
  health?: string;
  "docs.count"?: string;
}

export async function listIndices(connection: EsConnection) {
  return esRequest<CatIndexItem[]>(connection, "/_cat/indices?format=json");
}

export async function searchIndex(connection: EsConnection, index: string, body: unknown) {
  return esRequest<any>(connection, `/${index}/_search`, { method: "POST", body });
}

export async function getIndexInfo(connection: EsConnection, index: string) {
  return esRequest<any>(connection, `/${index}`);
}

export async function createIndex(connection: EsConnection, index: string, body: unknown) {
  return esRequest<any>(connection, `/${index}`, { method: "PUT", body });
}

export async function deleteIndex(connection: EsConnection, index: string) {
  return esRequest<any>(connection, `/${index}`, { method: "DELETE" });
}

export async function refreshIndex(connection: EsConnection, index: string) {
  return esRequest<any>(connection, `/${index}/_refresh`, { method: "POST" });
}

export async function getIndexMapping(connection: EsConnection, index: string) {
  return esRequest<any>(connection, `/${index}/_mapping`);
}

export function extractFieldsFromMapping(mapping: any, indexName: string): string[] {
  const fields: string[] = [];
  const properties = mapping?.[indexName]?.mappings?.properties;
  if (!properties) return fields;

  function traverse(props: any, prefix = "") {
    for (const key in props) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      fields.push(fullPath);
      if (props[key].properties) {
        traverse(props[key].properties, fullPath);
      }
    }
  }

  traverse(properties);
  return fields;
}

export async function deleteDocument(connection: EsConnection, index: string, id: string) {
  return esRequest<any>(connection, `/${index}/_doc/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function updateDocument(connection: EsConnection, index: string, id: string, doc: unknown) {
  return esRequest<any>(connection, `/${index}/_doc/${encodeURIComponent(id)}`, { method: "PUT", body: doc });
}
