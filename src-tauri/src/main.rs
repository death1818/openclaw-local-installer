// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hardware;
mod installer;
mod models;
mod download;

use tauri::Manager;

#[tauri::command]
async fn detect_hardware() -> Result<hardware::HardwareInfo, String> {
    hardware::detect_hardware()
        .await
        .map_err(|e| format!("硬件检测失败: {}", e))
}

#[tauri::command]
async fn get_recommended_models(
    vram_gb: f64,
    ram_gb: f64,
) -> Result<Vec<installer::ModelRecommendation>, String> {
    Ok(installer::get_recommended_models(vram_gb, ram_gb))
}

#[tauri::command]
async fn check_ollama_installed() -> Result<bool, String> {
    installer::check_ollama_installed()
        .await
        .map_err(|e| format!("检查 Ollama 失败: {}", e))
}

#[tauri::command]
async fn install_ollama(app: tauri::AppHandle) -> Result<(), String> {
    installer::install_ollama(app)
        .await
        .map_err(|e| format!("安装 Ollama 失败: {}", e))
}

#[tauri::command]
async fn pull_model(model_name: String, app: tauri::AppHandle) -> Result<(), String> {
    download::pull_model_with_progress(model_name, app)
        .await
        .map_err(|e| format!("下载模型失败: {}", e))
}

#[tauri::command]
async fn cancel_model_download(model_name: String) -> Result<(), String> {
    download::cancel_download(model_name).await
}

#[tauri::command]
async fn configure_openclaw(model_name: String) -> Result<String, String> {
    installer::configure_openclaw(model_name)
        .await
        .map_err(|e| format!("配置 OpenClaw 失败: {}", e))
}

#[tauri::command]
async fn check_openclaw_installed() -> Result<bool, String> {
    installer::check_openclaw_installed()
        .await
        .map_err(|e| format!("检查 OpenClaw 失败: {}", e))
}

#[tauri::command]
async fn install_openclaw(app: tauri::AppHandle) -> Result<(), String> {
    installer::install_openclaw(app)
        .await
        .map_err(|e| format!("安装 OpenClaw 失败: {}", e))
}

// 模型管理命令
#[tauri::command]
async fn list_models() -> Result<Vec<models::InstalledModel>, String> {
    models::list_installed_models().await
}

#[tauri::command]
async fn get_model_info(model_name: String) -> Result<models::ModelDetails, String> {
    models::get_model_details(model_name).await
}

#[tauri::command]
async fn delete_model(model_name: String) -> Result<(), String> {
    models::delete_model(model_name).await
}

#[tauri::command]
async fn stop_running_model(model_name: String) -> Result<(), String> {
    models::stop_model(model_name).await
}

#[tauri::command]
async fn check_model_running(model_name: String) -> Result<bool, String> {
    models::is_model_running(model_name).await
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            detect_hardware,
            get_recommended_models,
            check_ollama_installed,
            install_ollama,
            pull_model,
            cancel_model_download,
            configure_openclaw,
            check_openclaw_installed,
            install_openclaw,
            list_models,
            get_model_info,
            delete_model,
            stop_running_model,
            check_model_running,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
