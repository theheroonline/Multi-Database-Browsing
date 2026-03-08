import { invoke, isTauri } from "@tauri-apps/api/core";
import { logError } from "../../../lib/errorLog";
import type {
    RedisCommandResult,
    RedisConnection,
    RedisDatabaseInfo,
    RedisKeyDetail,
    RedisScanResult,
    RedisSetKeyRequest,
    RedisUpdateTtlRequest,
} from "../types";

const isTauriEnv = isTauri();

function requireTauri() {
  if (!isTauriEnv) {
    const error = new Error("Redis operations require desktop mode (Tauri)");
    logError(error, {
      source: "redisClient.requireTauri",
      message: "Redis operation requested outside desktop mode"
    });
    throw error;
  }
}

export async function redisConnect(connection: RedisConnection): Promise<void> {
  requireTauri();
  try {
    await invoke("redis_connect", {
      request: {
        connectionId: connection.id,
        host: connection.host,
        port: connection.port,
        database: connection.database,
        username: connection.username || undefined,
        password: connection.password || undefined,
      },
    });
  } catch (error) {
    logError(error, {
      source: "redisClient.connect",
      message: `Failed to connect to Redis ${connection.name}`
    });
    throw error;
  }
}

export async function redisDisconnect(connectionId: string): Promise<void> {
  requireTauri();
  try {
    await invoke("redis_disconnect", { connectionId });
  } catch (error) {
    logError(error, {
      source: "redisClient.disconnect",
      message: `Failed to disconnect Redis connection ${connectionId}`
    });
    throw error;
  }
}

export async function redisListDatabases(connectionId: string): Promise<RedisDatabaseInfo[]> {
  requireTauri();
  try {
    return await invoke<RedisDatabaseInfo[]>("redis_list_databases", { connectionId });
  } catch (error) {
    logError(error, {
      source: "redisClient.listDatabases",
      message: `Failed to list Redis databases for connection ${connectionId}`
    });
    throw error;
  }
}

export async function redisScanKeys(
  connectionId: string,
  database: number,
  pattern: string,
  cursor = "0",
  count = 50,
): Promise<RedisScanResult> {
  requireTauri();
  try {
    return await invoke<RedisScanResult>("redis_scan_keys", {
      request: {
        connectionId,
        database,
        pattern,
        cursor,
        count,
      },
    });
  } catch (error) {
    logError(error, {
      source: "redisClient.scanKeys",
      message: `Failed to scan Redis keys for connection ${connectionId}`,
      detail: { database, pattern, cursor, count }
    });
    throw error;
  }
}

export async function redisGetKeyDetail(
  connectionId: string,
  database: number,
  key: string,
): Promise<RedisKeyDetail> {
  requireTauri();
  try {
    return await invoke<RedisKeyDetail>("redis_get_key_detail", {
      request: {
        connectionId,
        database,
        key,
      },
    });
  } catch (error) {
    logError(error, {
      source: "redisClient.getKeyDetail",
      message: `Failed to load Redis key detail ${key}`,
      detail: { connectionId, database }
    });
    throw error;
  }
}

export async function redisExecute(
  connectionId: string,
  database: number,
  command: string,
  args: string[],
): Promise<RedisCommandResult> {
  requireTauri();
  try {
    return await invoke<RedisCommandResult>("redis_execute", {
      request: {
        connectionId,
        database,
        command,
        args,
      },
    });
  } catch (error) {
    logError(error, {
      source: "redisClient.execute",
      message: `Failed to execute Redis command ${command}`,
      detail: { connectionId, database, args }
    });
    throw error;
  }
}

export async function redisSetKey(
  connectionId: string,
  database: number,
  request: RedisSetKeyRequest,
): Promise<void> {
  requireTauri();
  try {
    await invoke("redis_set_key", {
      request: {
        connectionId,
        database,
        key: request.key,
        originalKey: request.originalKey,
        keyType: request.keyType,
        ttlMs: request.ttlMs,
        value: request.value,
        overwrite: request.overwrite,
      },
    });
  } catch (error) {
    logError(error, {
      source: "redisClient.setKey",
      message: `Failed to write Redis key ${request.key}`,
      detail: { connectionId, database, keyType: request.keyType }
    });
    throw error;
  }
}

export async function redisDeleteKey(
  connectionId: string,
  database: number,
  key: string,
): Promise<void> {
  requireTauri();
  try {
    await invoke("redis_delete_key", {
      request: {
        connectionId,
        database,
        key,
      },
    });
  } catch (error) {
    logError(error, {
      source: "redisClient.deleteKey",
      message: `Failed to delete Redis key ${key}`,
      detail: { connectionId, database }
    });
    throw error;
  }
}

export async function redisDeleteKeys(
  connectionId: string,
  database: number,
  keys: string[],
): Promise<number> {
  requireTauri();
  try {
    return await invoke<number>("redis_delete_keys", {
      request: {
        connectionId,
        database,
        keys,
      },
    });
  } catch (error) {
    logError(error, {
      source: "redisClient.deleteKeys",
      message: `Failed to delete Redis keys (${keys.length})`,
      detail: { connectionId, database, keys }
    });
    throw error;
  }
}

export async function redisUpdateKeyTtl(
  connectionId: string,
  database: number,
  request: RedisUpdateTtlRequest,
): Promise<void> {
  requireTauri();
  try {
    await invoke("redis_update_key_ttl", {
      request: {
        connectionId,
        database,
        key: request.key,
        ttlMs: request.ttlMs,
      },
    });
  } catch (error) {
    logError(error, {
      source: "redisClient.updateKeyTtl",
      message: `Failed to update Redis TTL ${request.key}`,
      detail: { connectionId, database, ttlMs: request.ttlMs }
    });
    throw error;
  }
}