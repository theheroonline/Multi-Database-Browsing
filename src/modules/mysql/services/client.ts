import { invoke, isTauri } from "@tauri-apps/api/core";
import { logError } from "../../../lib/errorLog";
import type { ColumnMeta, MysqlConnection } from "../types";

const isTauriEnv = isTauri();

function requireTauri() {
  if (!isTauriEnv) {
    const error = new Error("MySQL operations require desktop mode (Tauri)");
    logError(error, {
      source: "mysqlClient.requireTauri",
      message: "MySQL operation requested outside desktop mode"
    });
    throw error;
  }
}

export async function mysqlConnect(connection: MysqlConnection): Promise<void> {
  requireTauri();
  try {
    await invoke("mysql_connect", {
      request: {
        connectionId: connection.id,
        host: connection.host,
        port: connection.port,
        username: connection.username ?? "",
        password: connection.password ?? "",
        database: connection.database || undefined,
      },
    });
  } catch (error) {
    logError(error, {
      source: "mysqlClient.connect",
      message: `Failed to connect to MySQL ${connection.name}`
    });
    throw error;
  }
}

export async function mysqlDisconnect(connectionId: string): Promise<void> {
  requireTauri();
  try {
    await invoke("mysql_disconnect", { connectionId });
  } catch (error) {
    logError(error, {
      source: "mysqlClient.disconnect",
      message: `Failed to disconnect MySQL connection ${connectionId}`
    });
    throw error;
  }
}

export async function mysqlPing(connectionId: string): Promise<void> {
  requireTauri();
  try {
    await invoke("mysql_ping", { connectionId });
  } catch (error) {
    logError(error, {
      source: "mysqlClient.ping",
      message: `Failed to ping MySQL connection ${connectionId}`
    });
    throw error;
  }
}

export interface MysqlQueryResult {
  columns: string[];
  rows: Array<Array<unknown>>;
  affectedRows: number;
  isResultSet: boolean;
}

export async function mysqlQuery(
  connectionId: string,
  sql: string
): Promise<MysqlQueryResult> {
  requireTauri();
  try {
    return await invoke<MysqlQueryResult>("mysql_query", { connectionId, sql });
  } catch (error) {
    logError(error, {
      source: "mysqlClient.query",
      message: `Failed to execute MySQL query on connection ${connectionId}`,
      detail: sql
    });
    throw error;
  }
}

export async function mysqlListDatabases(
  connectionId: string
): Promise<string[]> {
  requireTauri();
  try {
    return await invoke<string[]>("mysql_list_databases", { connectionId });
  } catch (error) {
    logError(error, {
      source: "mysqlClient.listDatabases",
      message: `Failed to list MySQL databases for connection ${connectionId}`
    });
    throw error;
  }
}

export async function mysqlListTables(
  connectionId: string,
  database: string
): Promise<string[]> {
  requireTauri();
  try {
    return await invoke<string[]>("mysql_list_tables", { connectionId, database });
  } catch (error) {
    logError(error, {
      source: "mysqlClient.listTables",
      message: `Failed to list tables for ${database} on connection ${connectionId}`
    });
    throw error;
  }
}

export async function mysqlDescribeTable(
  connectionId: string,
  database: string,
  table: string
): Promise<ColumnMeta[]> {
  requireTauri();
  try {
    return await invoke<ColumnMeta[]>("mysql_describe_table", {
      connectionId,
      database,
      table,
    });
  } catch (error) {
    logError(error, {
      source: "mysqlClient.describeTable",
      message: `Failed to describe table ${database}.${table} on connection ${connectionId}`
    });
    throw error;
  }
}
