import type {
    RedisHashEditorRow,
    RedisKeyDetail,
    RedisKeyType,
    RedisListEditorRow,
    RedisSetKeyRequest,
    RedisSortedSetMember,
    RedisZsetEditorRow,
} from "./types";

export const editableKeyTypes: RedisKeyType[] = ["string", "hash", "list", "set", "zset"];

export function isEditableKeyType(value: string): value is RedisKeyType {
  return editableKeyTypes.includes(value as RedisKeyType);
}

export function formatTtl(ttlMs: number | null) {
  if (ttlMs === null || ttlMs < 0) {
    return "-";
  }

  if (ttlMs < 1000) {
    return `${ttlMs} ms`;
  }

  const seconds = ttlMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }

  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(1)} min`;
  }

  return `${(minutes / 60).toFixed(1)} h`;
}

export function createEditorRowId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createEmptyHashRow(): RedisHashEditorRow {
  return { id: createEditorRowId(), field: "", value: "" };
}

export function createEmptyListRow(): RedisListEditorRow {
  return { id: createEditorRowId(), value: "" };
}

export function createEmptyZsetRow(): RedisZsetEditorRow {
  return { id: createEditorRowId(), member: "", score: "0" };
}

export function getDefaultEditorValue(keyType: RedisKeyType) {
  switch (keyType) {
    case "string":
      return "";
    case "hash":
      return [createEmptyHashRow()];
    case "list":
    case "set":
      return [createEmptyListRow()];
    case "zset":
      return [createEmptyZsetRow()];
    default:
      return "";
  }
}

export function getEditorStateFromDetail(detail: RedisKeyDetail) {
  if (!isEditableKeyType(detail.keyType)) {
    return getDefaultEditorValue("string");
  }

  if (detail.keyType === "string") {
    return typeof detail.value === "string" ? detail.value : "";
  }

  if (detail.keyType === "hash") {
    const entries = detail.value && typeof detail.value === "object" && !Array.isArray(detail.value)
      ? Object.entries(detail.value)
      : [];
    return entries.length > 0
      ? entries.map(([field, value]) => ({ id: createEditorRowId(), field, value: String(value) }))
      : [createEmptyHashRow()];
  }

  if (detail.keyType === "zset") {
    const rows = Array.isArray(detail.value) ? detail.value as RedisSortedSetMember[] : [];
    return rows.length > 0
      ? rows.map((item) => ({ id: createEditorRowId(), member: item.member, score: String(item.score) }))
      : [createEmptyZsetRow()];
  }

  const rows = Array.isArray(detail.value) ? detail.value : [];
  return rows.length > 0
    ? rows.map((item) => ({ id: createEditorRowId(), value: String(item) }))
    : [createEmptyListRow()];
}

export function getEditorHint(t: (key: string) => string, keyType: RedisKeyType) {
  switch (keyType) {
    case "string":
      return t("redis.browser.editorStringHint");
    case "hash":
      return t("redis.browser.editorHashHint");
    case "list":
      return t("redis.browser.editorListHint");
    case "set":
      return t("redis.browser.editorSetHint");
    case "zset":
      return t("redis.browser.editorZsetHint");
    default:
      return "";
  }
}

export function buildRedisEditorValue(
  keyType: RedisKeyType,
  valueState: string | RedisHashEditorRow[] | RedisListEditorRow[] | RedisZsetEditorRow[],
): RedisSetKeyRequest["value"] {
  if (keyType === "string") {
    return typeof valueState === "string" ? valueState : "";
  }

  if (keyType === "hash") {
    const rows = Array.isArray(valueState) ? valueState as RedisHashEditorRow[] : [];
    const entries = rows.filter((row) => row.field.trim().length > 0);
    if (entries.length === 0) {
      throw new Error("Redis hash value must contain at least one field");
    }

    return Object.fromEntries(entries.map((row) => [row.field.trim(), row.value]));
  }

  if (keyType === "zset") {
    const rows = Array.isArray(valueState) ? valueState as RedisZsetEditorRow[] : [];
    const entries = rows.filter((row) => row.member.trim().length > 0);
    if (entries.length === 0) {
      throw new Error("Redis zset value must contain at least one member");
    }

    return entries.map((row) => {
      const score = Number(row.score);
      if (!Number.isFinite(score)) {
        throw new Error("Redis zset score must be numeric");
      }

      return {
        member: row.member.trim(),
        score,
      };
    });
  }

  const rows = Array.isArray(valueState) ? valueState as RedisListEditorRow[] : [];
  if (rows.length === 0) {
    throw new Error(`Redis ${keyType} value must contain at least one item`);
  }

  return rows.map((row) => row.value);
}