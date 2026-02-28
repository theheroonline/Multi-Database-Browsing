use std::collections::HashMap;
use std::sync::Mutex;

use mysql_async::prelude::*;
use mysql_async::{Opts, OptsBuilder, Pool, Row, Value as MyValue};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tauri::{command, State};

pub struct MysqlPoolManager {
    pub pools: Mutex<HashMap<String, Pool>>,
}

impl MysqlPoolManager {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MysqlConnectRequest {
    connection_id: String,
    host: String,
    port: u16,
    username: String,
    password: String,
    database: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MysqlQueryResult {
    columns: Vec<String>,
    rows: Vec<Vec<JsonValue>>,
    affected_rows: u64,
    is_result_set: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MysqlColumnMeta {
    field: String,
    #[serde(rename = "type")]
    col_type: String,
    null: String,
    key: String,
    default: Option<String>,
    extra: String,
}

fn mysql_value_to_json(val: MyValue) -> JsonValue {
    match val {
        MyValue::NULL => JsonValue::Null,
        MyValue::Int(i) => JsonValue::Number(i.into()),
        MyValue::UInt(u) => JsonValue::Number(u.into()),
        MyValue::Float(f) => {
            serde_json::Number::from_f64(f as f64)
                .map(JsonValue::Number)
                .unwrap_or(JsonValue::Null)
        }
        MyValue::Double(f) => {
            serde_json::Number::from_f64(f)
                .map(JsonValue::Number)
                .unwrap_or(JsonValue::Null)
        }
        MyValue::Bytes(b) => {
            match String::from_utf8(b) {
                Ok(s) => JsonValue::String(s),
                Err(e) => {
                    // Fall back to lossy UTF-8 conversion
                    JsonValue::String(String::from_utf8_lossy(e.as_bytes()).into_owned())
                }
            }
        }
        MyValue::Date(year, month, day, hour, min, sec, _micro) => {
            JsonValue::String(format!(
                "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
                year, month, day, hour, min, sec
            ))
        }
        MyValue::Time(negative, days, hours, minutes, seconds, _micro) => {
            let sign = if negative { "-" } else { "" };
            let total_hours = days * 24 + hours as u32;
            JsonValue::String(format!(
                "{}{:02}:{:02}:{:02}",
                sign, total_hours, minutes, seconds
            ))
        }
    }
}

fn row_to_json_vec(row: Row) -> Vec<JsonValue> {
    let mut values = Vec::new();
    let raw_values = row.unwrap_raw();

    for raw_value in raw_values {
        match raw_value {
            Some(value) => values.push(mysql_value_to_json(value)),
            None => values.push(JsonValue::Null),
        }
    }

    values
}

fn get_pool(manager: &MysqlPoolManager, connection_id: &str) -> Result<Pool, String> {
    let pools = manager
        .pools
        .lock()
        .map_err(|e| format!("Failed to lock pool manager: {}", e))?;
    pools
        .get(connection_id)
        .cloned()
        .ok_or_else(|| format!("No connection pool found for ID: {}", connection_id))
}

#[command]
pub async fn mysql_connect(
    request: MysqlConnectRequest,
    manager: State<'_, MysqlPoolManager>,
) -> Result<(), String> {
    let mut builder = OptsBuilder::default()
        .ip_or_hostname(&request.host)
        .tcp_port(request.port)
        .user(Some(&request.username))
        .pass(Some(&request.password));

    if let Some(ref db) = request.database {
        if !db.is_empty() {
            builder = builder.db_name(Some(db));
        }
    }

    let opts: Opts = builder.into();
    let pool = Pool::new(opts);

    // Test the connection
    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    let _: Vec<Row> = conn
        .query("SELECT 1")
        .await
        .map_err(|e| format!("Connection test failed: {}", e))?;

    drop(conn);

    let mut pools = manager
        .pools
        .lock()
        .map_err(|e| format!("Failed to lock pool manager: {}", e))?;

    // Disconnect any existing pool for this ID
    if let Some(old_pool) = pools.remove(&request.connection_id) {
        tokio::spawn(async move {
            let _ = old_pool.disconnect().await;
        });
    }

    pools.insert(request.connection_id, pool);
    Ok(())
}

#[command]
pub async fn mysql_disconnect(
    connection_id: String,
    manager: State<'_, MysqlPoolManager>,
) -> Result<(), String> {
    let mut pools = manager
        .pools
        .lock()
        .map_err(|e| format!("Failed to lock pool manager: {}", e))?;

    if let Some(pool) = pools.remove(&connection_id) {
        tokio::spawn(async move {
            let _ = pool.disconnect().await;
        });
    }

    Ok(())
}

#[command]
pub async fn mysql_ping(
    connection_id: String,
    manager: State<'_, MysqlPoolManager>,
) -> Result<(), String> {
    let pool = get_pool(&manager, &connection_id)?;

    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| format!("Failed to get connection: {}", e))?;

    let _: Vec<Row> = conn
        .query("SELECT 1")
        .await
        .map_err(|e| format!("Ping failed: {}", e))?;

    Ok(())
}

#[command]
pub async fn mysql_query(
    connection_id: String,
    sql: String,
    manager: State<'_, MysqlPoolManager>,
) -> Result<MysqlQueryResult, String> {
    let pool = get_pool(&manager, &connection_id)?;

    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| format!("Failed to get connection: {}", e))?;

    let mut result = conn
        .query_iter(&sql)
        .await
        .map_err(|e| format!("Query failed: {}", e))?;

    let columns: Vec<String> = result
        .columns_ref()
        .iter()
        .map(|c| c.name_str().to_string())
        .collect();

    if !columns.is_empty() {
        let mut rows: Vec<Vec<JsonValue>> = Vec::new();
        let raw_rows: Vec<Row> = result
            .collect::<Row>()
            .await
            .map_err(|e| format!("Failed to collect rows: {}", e))?;

        for row in raw_rows {
            rows.push(row_to_json_vec(row));
        }

        while !result.is_empty() {
            let _: Vec<Row> = result
                .collect::<Row>()
                .await
                .map_err(|e| format!("Failed to drain rows: {}", e))?;
        }

        Ok(MysqlQueryResult {
            columns,
            rows,
            affected_rows: 0,
            is_result_set: true,
        })
    } else {
        let affected = result.affected_rows();
        result
            .drop_result()
            .await
            .map_err(|e| format!("Failed to finalize query result: {}", e))?;

        Ok(MysqlQueryResult {
            columns: vec![],
            rows: vec![],
            affected_rows: affected,
            is_result_set: false,
        })
    }
}

#[command]
pub async fn mysql_list_databases(
    connection_id: String,
    manager: State<'_, MysqlPoolManager>,
) -> Result<Vec<String>, String> {
    let pool = get_pool(&manager, &connection_id)?;

    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| format!("Failed to get connection: {}", e))?;

    let rows: Vec<Row> = conn
        .query("SHOW DATABASES")
        .await
        .map_err(|e| format!("Failed to list databases: {}", e))?;

    let databases = rows
        .into_iter()
        .filter_map(|row| row.get_opt::<String, usize>(0).and_then(|value| value.ok()))
        .collect();

    Ok(databases)
}

#[command]
pub async fn mysql_list_tables(
    connection_id: String,
    database: String,
    manager: State<'_, MysqlPoolManager>,
) -> Result<Vec<String>, String> {
    let pool = get_pool(&manager, &connection_id)?;

    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| format!("Failed to get connection: {}", e))?;

    let sql = format!("SHOW TABLES FROM `{}`", database.replace('`', "``"));
    let rows: Vec<Row> = conn
        .query(sql)
        .await
        .map_err(|e| format!("Failed to list tables: {}", e))?;

    let tables = rows
        .into_iter()
        .filter_map(|row| row.get_opt::<String, usize>(0).and_then(|value| value.ok()))
        .collect();

    Ok(tables)
}

#[command]
pub async fn mysql_describe_table(
    connection_id: String,
    database: String,
    table: String,
    manager: State<'_, MysqlPoolManager>,
) -> Result<Vec<MysqlColumnMeta>, String> {
    let pool = get_pool(&manager, &connection_id)?;

    let mut conn = pool
        .get_conn()
        .await
        .map_err(|e| format!("Failed to get connection: {}", e))?;

    let sql = format!(
        "DESCRIBE `{}`.`{}`",
        database.replace('`', "``"),
        table.replace('`', "``")
    );

    let rows: Vec<Row> = conn
        .query(sql)
        .await
        .map_err(|e| format!("Failed to describe table: {}", e))?;

    let mut columns = Vec::new();
    for row in rows {
        let field: String = row
            .get_opt::<String, usize>(0)
            .and_then(|value| value.ok())
            .unwrap_or_default();
        let col_type: String = row
            .get_opt::<String, usize>(1)
            .and_then(|value| value.ok())
            .unwrap_or_default();
        let null: String = row
            .get_opt::<String, usize>(2)
            .and_then(|value| value.ok())
            .unwrap_or_default();
        let key: String = row
            .get_opt::<String, usize>(3)
            .and_then(|value| value.ok())
            .unwrap_or_default();
        let default: Option<String> = row.get_opt::<String, usize>(4).and_then(|value| value.ok());
        let extra: String = row
            .get_opt::<String, usize>(5)
            .and_then(|value| value.ok())
            .unwrap_or_default();

        columns.push(MysqlColumnMeta {
            field,
            col_type,
            null,
            key,
            default,
            extra,
        });
    }

    Ok(columns)
}
