// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hardware;
mod installer;
mod models;
mod download;

use tauri::Manager;

fn main() {
    // 初始化日志
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .init();
    
    log::info!("OpenClaw 本地安装器启动");
    
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

