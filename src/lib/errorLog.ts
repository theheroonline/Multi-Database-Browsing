import { useSyncExternalStore } from "react";

export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  source: string;
  message: string;
  detail?: string;
}

interface LogErrorOptions {
  source: string;
  message?: string;
  detail?: unknown;
}

const STORAGE_KEY = "multi-database-browsing.error-log";
const MAX_LOG_ENTRIES = 200;

const listeners = new Set<() => void>();

function serializeUnknown(value: unknown, seen = new WeakSet<object>()): string {
  if (value instanceof Error) {
    return value.stack || value.message || value.name;
  }

  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "undefined";
  }

  try {
    return JSON.stringify(
      value,
      (_key, currentValue) => {
        if (typeof currentValue === "bigint") {
          return currentValue.toString();
        }
        if (typeof currentValue === "object" && currentValue !== null) {
          if (seen.has(currentValue)) {
            return "[Circular]";
          }
          seen.add(currentValue);
        }
        return currentValue;
      },
      2
    );
  } catch {
    return String(value);
  }
}

function loadInitialEntries(): ErrorLogEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as ErrorLogEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (item) =>
        typeof item?.id === "string" &&
        typeof item?.timestamp === "string" &&
        typeof item?.source === "string" &&
        typeof item?.message === "string"
    );
  } catch {
    return [];
  }
}

let entries = loadInitialEntries();

function persistEntries() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore storage errors
  }
}

function emitChange() {
  persistEntries();
  listeners.forEach((listener) => listener());
}

export function getErrorLogEntries() {
  return entries;
}

export function subscribeErrorLog(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearErrorLog() {
  entries = [];
  emitChange();
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message || error.name;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error === undefined) {
    return "Unknown error";
  }

  return String(error);
}

export function logError(error: unknown, options: LogErrorOptions) {
  const message = options.message?.trim() || getErrorMessage(error);
  const detailParts = [error, options.detail]
    .filter((item) => item !== undefined)
    .map((item) => serializeUnknown(item))
    .filter(Boolean);

  const entry: ErrorLogEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    source: options.source,
    message,
    detail: detailParts.length > 0 ? detailParts.join("\n\n") : undefined
  };

  entries = [entry, ...entries].slice(0, MAX_LOG_ENTRIES);
  emitChange();
  return entry;
}

export function registerGlobalErrorLoggers() {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleWindowError = (event: ErrorEvent) => {
    logError(event.error ?? event.message, {
      source: "window.error",
      message: event.message || "Unhandled runtime error",
      detail: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      }
    });
  };

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    logError(event.reason, {
      source: "window.unhandledrejection",
      message: "Unhandled promise rejection"
    });
  };

  window.addEventListener("error", handleWindowError);
  window.addEventListener("unhandledrejection", handleUnhandledRejection);

  return () => {
    window.removeEventListener("error", handleWindowError);
    window.removeEventListener("unhandledrejection", handleUnhandledRejection);
  };
}

export function useErrorLog() {
  const snapshot = useSyncExternalStore(subscribeErrorLog, getErrorLogEntries, getErrorLogEntries);

  return {
    entries: snapshot,
    count: snapshot.length,
    clear: clearErrorLog
  };
}