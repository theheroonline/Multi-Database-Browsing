#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    url: String,
    method: String,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
    #[serde(default = "default_verify_tls")]
    verify_tls: bool,
    auth: Option<HttpAuth>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpAuth {
    auth_type: Option<String>,
    username: Option<String>,
    password: Option<String>,
    api_key: Option<String>,
}

fn default_verify_tls() -> bool {
    true
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    status: u16,
    ok: bool,
    body: String,
}

#[command]
async fn http_request(request: HttpRequest) -> Result<HttpResponse, String> {
    let HttpRequest {
        url,
        method,
        headers,
        body,
        verify_tls,
        auth,
    } = request;

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(!verify_tls)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;
    
    let method = match method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "PATCH" => reqwest::Method::PATCH,
        _ => return Err(format!("Unsupported HTTP method: {}", method)),
    };

    let mut req_builder = client.request(method, &url);

    // Add headers first
    if let Some(headers) = headers {
        for (key, value) in headers {
            req_builder = req_builder.header(&key, &value);
        }
    }

    // Apply native auth (overwrites any JS-provided Authorization header)
    if let Some(auth_info) = auth {
        match auth_info.auth_type.as_deref() {
            Some("basic") => {
                if let (Some(username), Some(password)) = (auth_info.username, auth_info.password) {
                    req_builder = req_builder.basic_auth(username, Some(password));
                }
            }
            Some("apiKey") => {
                if let Some(api_key) = auth_info.api_key {
                    req_builder = req_builder.header("Authorization", format!("ApiKey {}", api_key));
                }
            }
            _ => {}
        }
    }

    // Add body
    if let Some(body) = body {
        req_builder = req_builder.body(body);
    }

    // Send request
    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status().as_u16();
    let ok = response.status().is_success();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    Ok(HttpResponse { status, ok, body })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![http_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
