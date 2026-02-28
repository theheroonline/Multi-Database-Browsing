import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ColumnMeta, MysqlConnection } from "../types";

const isTauriEnv = isTauri();

function requireTauri() {
  if (!isTauriEnv) {
    throw new Error("MySQL operations require desktop mode (Tauri)");
  }
}

export async function mysqlConnect(connection: MysqlConnection): Promise<void> {
  requireTauri();
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
}

export async function mysqlDisconnect(connectionId: string): Promise<void> {
  requireTauri();
  await invoke("mysql_disconnect", { connectionId });
}

export async function mysqlPing(connectionId: string): Promise<void> {
  requireTauri();
  await invoke("mysql_ping", { connectionId });
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
  return await invoke<MysqlQueryResult>("mysql_query", { connectionId, sql });
}

export async function mysqlListDatabases(
  connectionId: string
): Promise<string[]> {
  requireTauri();
  return await invoke<string[]>("mysql_list_databases", { connectionId });
}

export async function mysqlListTables(
  connectionId: string,
  database: string
): Promise<string[]> {
  requireTauri();
  return await invoke<string[]>("mysql_list_tables", { connectionId, database });
}

export async function mysqlDescribeTable(
  connectionId: string,
  database: string,
  table: string
): Promise<ColumnMeta[]> {
  requireTauri();
  return await invoke<ColumnMeta[]>("mysql_describe_table", {
    connectionId,
    database,
    table,
  });
}
