use std::collections::HashMap;
use std::sync::Mutex;

use redis::aio::MultiplexedConnection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use tauri::{command, State};
use urlencoding::encode;

pub struct RedisConnectionManager {
    connections: Mutex<HashMap<String, RedisConnectRequest>>,
}

impl RedisConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisConnectRequest {
    connection_id: String,
    host: String,
    port: u16,
    database: i64,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisDatabaseInfo {
    index: i64,
    label: String,
    key_count: Option<u64>,
    is_default: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeySummary {
    name: String,
    key_type: String,
    ttl_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisScanResult {
    next_cursor: String,
    items: Vec<RedisKeySummary>,
    has_more: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyDetail {
    name: String,
    key_type: String,
    ttl_ms: Option<i64>,
    encoding: Option<String>,
    size: Option<u64>,
    value: JsonValue,
    truncated: bool,
    unsupported: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisCommandResult {
    command: String,
    output: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisScanRequest {
    connection_id: String,
    database: i64,
    pattern: Option<String>,
    cursor: Option<String>,
    count: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyRequest {
    connection_id: String,
    database: i64,
    key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisExecuteRequest {
    connection_id: String,
    database: i64,
    command: String,
    args: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisSetKeyRequest {
    connection_id: String,
    database: i64,
    key: String,
    original_key: Option<String>,
    key_type: String,
    ttl_ms: Option<i64>,
    value: JsonValue,
    overwrite: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisUpdateTtlRequest {
    connection_id: String,
    database: i64,
    key: String,
    ttl_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedisDeleteKeysRequest {
    connection_id: String,
    database: i64,
    keys: Vec<String>,
}

fn build_redis_url(request: &RedisConnectRequest, database: i64) -> String {
    let username = request.username.as_deref().unwrap_or("");
    let password = request.password.as_deref().unwrap_or("");

    let auth = if !username.is_empty() {
        format!("{}:{}@", encode(username), encode(password))
    } else if !password.is_empty() {
        format!(":{}@", encode(password))
    } else {
        String::new()
    };

    format!(
        "redis://{}{}:{}/{}",
        auth, request.host, request.port, database
    )
}

fn normalize_ttl(ttl_ms: i64) -> Option<i64> {
    if ttl_ms >= 0 {
        Some(ttl_ms)
    } else {
        None
    }
}

fn pair_strings_to_object(values: Vec<String>) -> JsonValue {
    let mut map = serde_json::Map::new();
    let mut iter = values.into_iter();

    while let Some(key) = iter.next() {
        let value = iter.next().unwrap_or_default();
        map.insert(key, JsonValue::String(value));
    }

    JsonValue::Object(map)
}

fn pair_strings_to_zset(values: Vec<String>) -> JsonValue {
    let mut items = Vec::new();
    let mut iter = values.into_iter();

    while let Some(member) = iter.next() {
        let score = iter
            .next()
            .and_then(|item| item.parse::<f64>().ok())
            .unwrap_or(0.0);
        items.push(json!({
            "member": member,
            "score": score,
        }));
    }

    JsonValue::Array(items)
}

fn parse_database_count(config_rows: &[String]) -> i64 {
    config_rows
        .chunks(2)
        .find_map(|chunk| {
            if chunk.first().map(|item| item.as_str()) == Some("databases") {
                chunk.get(1).and_then(|value| value.parse::<i64>().ok())
            } else {
                None
            }
        })
        .unwrap_or(16)
}

fn parse_keyspace_info(info: &str) -> HashMap<i64, u64> {
    let mut counts = HashMap::new();

    for line in info.lines() {
        if !line.starts_with("db") {
            continue;
        }

        let mut parts = line.splitn(2, ':');
        let db_name = parts.next().unwrap_or_default();
        let metadata = parts.next().unwrap_or_default();

        let db_index = db_name.trim_start_matches("db").parse::<i64>().ok();
        let key_count = metadata.split(',').find_map(|item| {
            let mut kv = item.splitn(2, '=');
            let key = kv.next().unwrap_or_default();
            let value = kv.next().unwrap_or_default();
            if key == "keys" {
                value.parse::<u64>().ok()
            } else {
                None
            }
        });

        if let (Some(index), Some(count)) = (db_index, key_count) {
            counts.insert(index, count);
        }
    }

    counts
}

fn get_connection_config(
    manager: &RedisConnectionManager,
    connection_id: &str,
) -> Result<RedisConnectRequest, String> {
    let connections = manager
        .connections
        .lock()
        .map_err(|error| format!("Failed to lock Redis manager: {}", error))?;

    connections
        .get(connection_id)
        .cloned()
        .ok_or_else(|| format!("No Redis connection found for ID: {}", connection_id))
}

async fn open_connection(
    request: &RedisConnectRequest,
    database: i64,
) -> Result<MultiplexedConnection, String> {
    let client = redis::Client::open(build_redis_url(request, database))
        .map_err(|error| format!("Failed to create Redis client: {}", error))?;

    client
        .get_multiplexed_async_connection()
        .await
        .map_err(|error| format!("Failed to connect to Redis: {}", error))
}

async fn get_connection(
    manager: &RedisConnectionManager,
    connection_id: &str,
    database: i64,
) -> Result<MultiplexedConnection, String> {
    let config = get_connection_config(manager, connection_id)?;
    open_connection(&config, database).await
}

async fn detect_key_type(connection: &mut MultiplexedConnection, key: &str) -> String {
    redis::cmd("TYPE")
        .arg(key)
        .query_async(connection)
        .await
        .unwrap_or_else(|_| "unknown".to_string())
}

async fn detect_key_ttl(connection: &mut MultiplexedConnection, key: &str) -> Option<i64> {
    let ttl: Result<i64, _> = redis::cmd("PTTL").arg(key).query_async(connection).await;
    ttl.ok().and_then(normalize_ttl)
}

async fn detect_key_encoding(connection: &mut MultiplexedConnection, key: &str) -> Option<String> {
    redis::cmd("OBJECT")
        .arg("ENCODING")
        .arg(key)
        .query_async(connection)
        .await
        .ok()
}

async fn detect_key_size(
    connection: &mut MultiplexedConnection,
    key: &str,
    key_type: &str,
) -> Option<u64> {
    match key_type {
        "string" => redis::cmd("STRLEN").arg(key).query_async(connection).await.ok(),
        "hash" => redis::cmd("HLEN").arg(key).query_async(connection).await.ok(),
        "list" => redis::cmd("LLEN").arg(key).query_async(connection).await.ok(),
        "set" => redis::cmd("SCARD").arg(key).query_async(connection).await.ok(),
        "zset" => redis::cmd("ZCARD").arg(key).query_async(connection).await.ok(),
        _ => None,
    }
}

fn stringify_json_value(value: &JsonValue) -> String {
    match value {
        JsonValue::String(text) => text.clone(),
        JsonValue::Null => String::new(),
        JsonValue::Bool(flag) => flag.to_string(),
        JsonValue::Number(number) => number.to_string(),
        _ => value.to_string(),
    }
}

fn parse_hash_entries(value: &JsonValue) -> Result<Vec<(String, String)>, String> {
    match value {
        JsonValue::Object(map) if !map.is_empty() => Ok(map
            .iter()
            .map(|(field, item)| (field.clone(), stringify_json_value(item)))
            .collect()),
        JsonValue::Object(_) => Err("Redis hash value cannot be empty".to_string()),
        _ => Err("Redis hash value must be a JSON object".to_string()),
    }
}

fn parse_string_items(value: &JsonValue, key_type: &str) -> Result<Vec<String>, String> {
    match value {
        JsonValue::Array(items) if !items.is_empty() => Ok(items.iter().map(stringify_json_value).collect()),
        JsonValue::Array(_) => Err(format!("Redis {} value cannot be empty", key_type)),
        _ => Err(format!("Redis {} value must be a JSON array", key_type)),
    }
}

fn parse_zset_entries(value: &JsonValue) -> Result<Vec<(f64, String)>, String> {
    let items = value
        .as_array()
        .ok_or_else(|| "Redis zset value must be a JSON array".to_string())?;

    if items.is_empty() {
        return Err("Redis zset value cannot be empty".to_string());
    }

    items
        .iter()
        .map(|item| {
            let member = item
                .get("member")
                .ok_or_else(|| "Each zset item requires member".to_string())?;
            let score = item
                .get("score")
                .ok_or_else(|| "Each zset item requires score".to_string())?;

            let member_text = stringify_json_value(member);
            if member_text.is_empty() {
                return Err("Redis zset member cannot be empty".to_string());
            }

            let score_value = score
                .as_f64()
                .or_else(|| stringify_json_value(score).parse::<f64>().ok())
                .ok_or_else(|| "Redis zset score must be numeric".to_string())?;

            Ok((score_value, member_text))
        })
        .collect()
}

async fn key_exists(connection: &mut MultiplexedConnection, key: &str) -> Result<bool, String> {
    let exists: i64 = redis::cmd("EXISTS")
        .arg(key)
        .query_async(connection)
        .await
        .map_err(|error| format!("Failed to check Redis key existence: {}", error))?;

    Ok(exists > 0)
}

async fn delete_key(connection: &mut MultiplexedConnection, key: &str) -> Result<(), String> {
    let _: i64 = redis::cmd("DEL")
        .arg(key)
        .query_async(connection)
        .await
        .map_err(|error| format!("Failed to delete Redis key {}: {}", key, error))?;

    Ok(())
}

async fn ensure_key_exists(connection: &mut MultiplexedConnection, key: &str) -> Result<(), String> {
    if key_exists(connection, key).await? {
        Ok(())
    } else {
        Err(format!("Redis key does not exist: {}", key))
    }
}

async fn write_key_value(
    connection: &mut MultiplexedConnection,
    key: &str,
    key_type: &str,
    value: &JsonValue,
) -> Result<(), String> {
    match key_type {
        "string" => {
            let payload = stringify_json_value(value);
            let _: String = redis::cmd("SET")
                .arg(key)
                .arg(payload)
                .query_async(connection)
                .await
                .map_err(|error| format!("Failed to write Redis string key: {}", error))?;
        }
        "hash" => {
            let entries = parse_hash_entries(value)?;
            let mut command = redis::cmd("HSET");
            command.arg(key);
            for (field, item) in entries {
                command.arg(field).arg(item);
            }
            let _: i64 = command
                .query_async(connection)
                .await
                .map_err(|error| format!("Failed to write Redis hash key: {}", error))?;
        }
        "list" => {
            let items = parse_string_items(value, "list")?;
            let mut command = redis::cmd("RPUSH");
            command.arg(key);
            for item in items {
                command.arg(item);
            }
            let _: i64 = command
                .query_async(connection)
                .await
                .map_err(|error| format!("Failed to write Redis list key: {}", error))?;
        }
        "set" => {
            let items = parse_string_items(value, "set")?;
            let mut command = redis::cmd("SADD");
            command.arg(key);
            for item in items {
                command.arg(item);
            }
            let _: i64 = command
                .query_async(connection)
                .await
                .map_err(|error| format!("Failed to write Redis set key: {}", error))?;
        }
        "zset" => {
            let entries = parse_zset_entries(value)?;
            let mut command = redis::cmd("ZADD");
            command.arg(key);
            for (score, member) in entries {
                command.arg(score).arg(member);
            }
            let _: i64 = command
                .query_async(connection)
                .await
                .map_err(|error| format!("Failed to write Redis sorted set key: {}", error))?;
        }
        _ => return Err(format!("Unsupported Redis key type for editing: {}", key_type)),
    }

    Ok(())
}

async fn apply_key_ttl(
    connection: &mut MultiplexedConnection,
    key: &str,
    ttl_ms: Option<i64>,
) -> Result<(), String> {
    match ttl_ms {
        Some(ttl) if ttl < 0 => Err("Redis TTL must be greater than or equal to 0".to_string()),
        Some(ttl) => {
            let _: bool = redis::cmd("PEXPIRE")
                .arg(key)
                .arg(ttl)
                .query_async(connection)
                .await
                .map_err(|error| format!("Failed to apply Redis TTL: {}", error))?;
            Ok(())
        }
        None => {
            let _: bool = redis::cmd("PERSIST")
                .arg(key)
                .query_async(connection)
                .await
                .map_err(|error| format!("Failed to clear Redis TTL: {}", error))?;
            Ok(())
        }
    }
}

#[command]
pub async fn redis_connect(
    request: RedisConnectRequest,
    manager: State<'_, RedisConnectionManager>,
) -> Result<(), String> {
    let mut connection = open_connection(&request, request.database).await?;
    let _: String = redis::cmd("PING")
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Redis ping failed: {}", error))?;

    let mut connections = manager
        .connections
        .lock()
        .map_err(|error| format!("Failed to lock Redis manager: {}", error))?;

    connections.insert(request.connection_id.clone(), request);
    Ok(())
}

#[command]
pub async fn redis_disconnect(
    connection_id: String,
    manager: State<'_, RedisConnectionManager>,
) -> Result<(), String> {
    let mut connections = manager
        .connections
        .lock()
        .map_err(|error| format!("Failed to lock Redis manager: {}", error))?;

    connections.remove(&connection_id);
    Ok(())
}

#[command]
pub async fn redis_list_databases(
    connection_id: String,
    manager: State<'_, RedisConnectionManager>,
) -> Result<Vec<RedisDatabaseInfo>, String> {
    let config = get_connection_config(&manager, &connection_id)?;
    let mut connection = open_connection(&config, 0).await?;

    let config_rows: Vec<String> = redis::cmd("CONFIG")
        .arg("GET")
        .arg("databases")
        .query_async(&mut connection)
        .await
        .unwrap_or_default();
    let database_count = parse_database_count(&config_rows);

    let keyspace_info: String = redis::cmd("INFO")
        .arg("keyspace")
        .query_async(&mut connection)
        .await
        .unwrap_or_default();
    let key_counts = parse_keyspace_info(&keyspace_info);

    let databases = (0..database_count)
        .map(|index| RedisDatabaseInfo {
            index,
            label: format!("DB{}", index),
            key_count: key_counts.get(&index).copied(),
            is_default: index == config.database,
        })
        .collect();

    Ok(databases)
}

#[command]
pub async fn redis_scan_keys(
    request: RedisScanRequest,
    manager: State<'_, RedisConnectionManager>,
) -> Result<RedisScanResult, String> {
    let mut connection = get_connection(&manager, &request.connection_id, request.database).await?;
    let pattern = request
        .pattern
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "*".to_string());
    let cursor = request
        .cursor
        .as_deref()
        .unwrap_or("0")
        .parse::<u64>()
        .unwrap_or(0);
    let count = request.count.unwrap_or(50).clamp(1, 200);

    let (next_cursor, keys): (u64, Vec<String>) = redis::cmd("SCAN")
        .arg(cursor)
        .arg("MATCH")
        .arg(&pattern)
        .arg("COUNT")
        .arg(count)
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Redis scan failed: {}", error))?;

    let mut items = Vec::with_capacity(keys.len());
    for key in keys {
        let key_type = detect_key_type(&mut connection, &key).await;
        let ttl_ms = detect_key_ttl(&mut connection, &key).await;

        items.push(RedisKeySummary {
            name: key,
            key_type,
            ttl_ms,
        });
    }

    Ok(RedisScanResult {
        next_cursor: next_cursor.to_string(),
        has_more: next_cursor != 0,
        items,
    })
}

#[command]
pub async fn redis_get_key_detail(
    request: RedisKeyRequest,
    manager: State<'_, RedisConnectionManager>,
) -> Result<RedisKeyDetail, String> {
    let mut connection = get_connection(&manager, &request.connection_id, request.database).await?;
    let key_type = detect_key_type(&mut connection, &request.key).await;
    let ttl_ms = detect_key_ttl(&mut connection, &request.key).await;
    let encoding = detect_key_encoding(&mut connection, &request.key).await;
    let size = detect_key_size(&mut connection, &request.key, &key_type).await;

    let (value, truncated, unsupported) = match key_type.as_str() {
        "string" => {
            let value: Option<String> = redis::cmd("GET")
                .arg(&request.key)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to read Redis string key: {}", error))?;
            (
                value.map(JsonValue::String).unwrap_or(JsonValue::Null),
                false,
                false,
            )
        }
        "hash" => {
            let values: Vec<String> = redis::cmd("HGETALL")
                .arg(&request.key)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to read Redis hash key: {}", error))?;
            (pair_strings_to_object(values), false, false)
        }
        "list" => {
            let values: Vec<String> = redis::cmd("LRANGE")
                .arg(&request.key)
                .arg(0)
                .arg(499)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to read Redis list key: {}", error))?;
            let total = size.unwrap_or(values.len() as u64);
            (
                JsonValue::Array(values.into_iter().map(JsonValue::String).collect()),
                total > 500,
                false,
            )
        }
        "set" => {
            let values: Vec<String> = redis::cmd("SMEMBERS")
                .arg(&request.key)
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to read Redis set key: {}", error))?;
            (JsonValue::Array(values.into_iter().map(JsonValue::String).collect()), false, false)
        }
        "zset" => {
            let values: Vec<String> = redis::cmd("ZRANGE")
                .arg(&request.key)
                .arg(0)
                .arg(499)
                .arg("WITHSCORES")
                .query_async(&mut connection)
                .await
                .map_err(|error| format!("Failed to read Redis sorted set key: {}", error))?;
            let total = size.unwrap_or((values.len() / 2) as u64);
            (pair_strings_to_zset(values), total > 500, false)
        }
        _ => (JsonValue::Null, false, true),
    };

    Ok(RedisKeyDetail {
        name: request.key,
        key_type,
        ttl_ms,
        encoding,
        size,
        value,
        truncated,
        unsupported,
    })
}

#[command]
pub async fn redis_execute(
    request: RedisExecuteRequest,
    manager: State<'_, RedisConnectionManager>,
) -> Result<RedisCommandResult, String> {
    let mut connection = get_connection(&manager, &request.connection_id, request.database).await?;
    let command = request.command.trim().to_uppercase();
    if command.is_empty() {
        return Err("Redis command cannot be empty".to_string());
    }

    let mut redis_command = redis::cmd(&command);
    for arg in &request.args {
        redis_command.arg(arg);
    }

    let value: redis::Value = redis_command
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Redis command failed: {}", error))?;

    let summary = if request.args.is_empty() {
        command.clone()
    } else {
        format!("{} {}", command, request.args.join(" "))
    };

    Ok(RedisCommandResult {
        command: summary,
        output: format!("{:#?}", value),
    })
}

#[command]
pub async fn redis_set_key(
    request: RedisSetKeyRequest,
    manager: State<'_, RedisConnectionManager>,
) -> Result<(), String> {
    let key = request.key.trim();
    if key.is_empty() {
        return Err("Redis key cannot be empty".to_string());
    }

    let key_type = request.key_type.trim().to_lowercase();
    let original_key = request
        .original_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let same_key = original_key.map(|value| value == key).unwrap_or(false);

    let mut connection = get_connection(&manager, &request.connection_id, request.database).await?;
    let target_exists = key_exists(&mut connection, key).await?;

    if target_exists && !request.overwrite && !same_key {
        return Err(format!("Redis key already exists: {}", key));
    }

    if (target_exists && request.overwrite) || same_key {
        delete_key(&mut connection, key).await?;
    }

    write_key_value(&mut connection, key, &key_type, &request.value).await?;
    apply_key_ttl(&mut connection, key, request.ttl_ms).await?;

    if let Some(previous_key) = original_key.filter(|value| *value != key) {
        delete_key(&mut connection, previous_key).await?;
    }

    Ok(())
}

#[command]
pub async fn redis_delete_key(
    request: RedisKeyRequest,
    manager: State<'_, RedisConnectionManager>,
) -> Result<(), String> {
    let mut connection = get_connection(&manager, &request.connection_id, request.database).await?;
    ensure_key_exists(&mut connection, &request.key).await?;
    delete_key(&mut connection, &request.key).await
}

#[command]
pub async fn redis_update_key_ttl(
    request: RedisUpdateTtlRequest,
    manager: State<'_, RedisConnectionManager>,
) -> Result<(), String> {
    let mut connection = get_connection(&manager, &request.connection_id, request.database).await?;
    ensure_key_exists(&mut connection, &request.key).await?;
    apply_key_ttl(&mut connection, &request.key, request.ttl_ms).await
}

#[command]
pub async fn redis_delete_keys(
    request: RedisDeleteKeysRequest,
    manager: State<'_, RedisConnectionManager>,
) -> Result<u64, String> {
    if request.keys.is_empty() {
        return Err("Redis keys cannot be empty".to_string());
    }

    let mut connection = get_connection(&manager, &request.connection_id, request.database).await?;
    let mut command = redis::cmd("DEL");

    for key in request.keys.iter().map(|item| item.trim()).filter(|item| !item.is_empty()) {
        command.arg(key);
    }

    let deleted: u64 = command
        .query_async(&mut connection)
        .await
        .map_err(|error| format!("Failed to delete Redis keys: {}", error))?;

    Ok(deleted)
}