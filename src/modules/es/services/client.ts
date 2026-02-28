import { invoke, isTauri } from "@tauri-apps/api/core";
import type { EsConnection } from "../types";

const isTauriEnv = isTauri();

interface HttpResponse {
  status: number;
  ok: boolean;
  body: string;
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
  body?: string,
  verifyTls = true,
  auth?: { authType: string; username?: string; password?: string; apiKey?: string }
): Promise<{ status: number; ok: boolean; body: string }> {
  return await invoke<HttpResponse>("http_request", {
    request: { url, method, headers, body, verifyTls, auth }
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
  const normalized = normalizeConnection(connection);
  const normalizedBase = normalizeBaseUrl(normalized.baseUrl);
  if (!normalizedBase) {
    throw new Error("CONNECTION_FAILED");
  }
  const requestPath = `/${path.replace(/^\//, "")}`;

  const url = isTauriEnv
    ? `${normalizedBase}${requestPath}`
    : `/es${requestPath}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (!isTauriEnv) {
    headers["x-es-target"] = normalizedBase;
  }

  const auth = buildAuthHeader(normalized);
  if (auth && !isTauriEnv) {
    headers["Authorization"] = auth;
  }

  const tauriAuth = isTauriEnv ? {
    authType: normalized.authType,
    username: normalized.username,
    password: normalized.password,
    apiKey: normalized.apiKey
  } : undefined;

  const bodyStr = options.body ? JSON.stringify(options.body) : undefined;

  const res = isTauriEnv
    ? await tauriHttpRequest(url, options.method ?? "GET", headers, bodyStr, normalized.verifyTls ?? true, tauriAuth)
    : await browserHttpRequest(url, options.method ?? "GET", headers, bodyStr);

  if (!res.ok) {
    throw new Error(res.body || `请求失败: ${res.status}`);
  }

  return JSON.parse(res.body) as T;
}

export async function esRequestRaw(
  connection: EsConnection,
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<{ status: number; ok: boolean; body: string }> {
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
  if (auth && !isTauriEnv) {
    headers["Authorization"] = auth;
  }

  // Build native auth for Tauri
  const tauriAuth = isTauriEnv ? {
    authType: normalized.authType,
    username: normalized.username,
    password: normalized.password,
    apiKey: normalized.apiKey
  } : undefined;

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

  return isTauriEnv
    ? await tauriHttpRequest(url, options.method ?? "GET", headers, bodyStr, normalized.verifyTls ?? true, tauriAuth)
    : await browserHttpRequest(url, options.method ?? "GET", headers, bodyStr);
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
