#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod es;
mod mysql;
mod redis;

fn main() {
    tauri::Builder::default()
        .manage(mysql::MysqlPoolManager::new())
        .manage(redis::RedisConnectionManager::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            es::http_request,
            mysql::mysql_connect,
            mysql::mysql_disconnect,
            mysql::mysql_ping,
            mysql::mysql_query,
            mysql::mysql_list_databases,
            mysql::mysql_list_tables,
            mysql::mysql_describe_table,
            redis::redis_connect,
            redis::redis_disconnect,
            redis::redis_list_databases,
            redis::redis_scan_keys,
            redis::redis_get_key_detail,
            redis::redis_execute,
            redis::redis_set_key,
            redis::redis_delete_key,
            redis::redis_delete_keys,
            redis::redis_update_key_ttl,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
