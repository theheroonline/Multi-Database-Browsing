import type { EngineType } from "../../lib/types";

export type RedisKeyType = "string" | "hash" | "list" | "set" | "zset" | "unknown";

export interface RedisConnection {
  id: string;
  name: string;
  engine: EngineType;
  host: string;
  port: number;
  database: number;
  username?: string;
  password?: string;
}

export interface RedisDatabaseInfo {
  index: number;
  label: string;
  keyCount?: number;
  isDefault: boolean;
}

export interface RedisKeySummary {
  name: string;
  keyType: RedisKeyType | string;
  ttlMs: number | null;
}

export interface RedisScanResult {
  nextCursor: string;
  items: RedisKeySummary[];
  hasMore: boolean;
}

export interface RedisSortedSetMember {
  member: string;
  score: number;
}

export interface RedisHashEditorRow {
  id: string;
  field: string;
  value: string;
}

export interface RedisListEditorRow {
  id: string;
  value: string;
}

export interface RedisZsetEditorRow {
  id: string;
  member: string;
  score: string;
}

export type RedisKeyValue = string | string[] | Record<string, string> | RedisSortedSetMember[] | null;

export interface RedisKeyDetail {
  name: string;
  keyType: RedisKeyType | string;
  ttlMs: number | null;
  encoding?: string;
  size?: number | null;
  value: RedisKeyValue;
  truncated: boolean;
  unsupported: boolean;
}

export interface RedisCommandResult {
  command: string;
  output: string;
}

export interface RedisSetKeyRequest {
  key: string;
  originalKey?: string;
  keyType: RedisKeyType | string;
  ttlMs: number | null;
  value: RedisKeyValue | Record<string, unknown> | Array<{ member: string; score: number }>;
  overwrite: boolean;
}

export interface RedisUpdateTtlRequest {
  key: string;
  ttlMs: number | null;
}