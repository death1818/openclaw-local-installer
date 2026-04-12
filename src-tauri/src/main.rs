// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hardware;
mod installer;
mod models;
mod download;
mod skills;

use tauri::{Manager, Emitter};

// 从子模块导入 Tauri 命令
use hardware::detect_hardware;
use installer::{
    get_recommended_models,
    check_ollama_installed,
    check_ollama_status,
    install_ollama,
    pull_model,
    configure_openclaw,
    check_openclaw_installed,
    check_openclaw_config_exists,
    clean_old_version,
    install_openclaw,
    start_openclaw,
    create_desktop_shortcut,
    deploy_docker,
    check_gateway_status,
    check_docker_container_status,
    get_gateway_models,
    send_chat_message,
    get_gateway_url,
    get_docker_token_url,
};
use models::{
    list_models,
    get_model_info,
    delete_model,
    stop_running_model,
    check_model_running,
};
use download::cancel_model_download;
use skills::{
    search_skills,
    get_recommended_skills,
    install_skill,
    update_skill,
    get_installed_skills,
    check_skill_updates,
    uninstall_skill,
};

fn main() {
    // 初始化日志
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .init();
    
    log::info!("OpenClaw 本地安装器启动");
    
    // 检查命令行参数
    let args: Vec<String> = std::env::args().collect();
    let launch_mode = args.iter().any(|arg| arg == "--launch" || arg == "-l");
    
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            detect_hardware,
            get_recommended_models,
            check_ollama_installed,
            check_ollama_status,
            install_ollama,
            pull_model,
            cancel_model_download,
            configure_openclaw,
            check_openclaw_installed,
            check_openclaw_config_exists,
            clean_old_version,
            install_openclaw,
            start_openclaw,
            create_desktop_shortcut,
            deploy_docker,
            list_models,
            get_model_info,
            delete_model,
            stop_running_model,
            check_model_running,
            // 技能管理
            search_skills,
            get_recommended_skills,
            install_skill,
            update_skill,
            get_installed_skills,
            check_skill_updates,
            uninstall_skill,
            // 聊天功能
            check_gateway_status,
            check_docker_container_status,
            get_gateway_models,
            send_chat_message,
            get_gateway_url,
            get_docker_token_url,
        ])
        .setup(move |app| {
            // 如果是启动模式，延迟发送事件给前端（确保前端已准备好）
            if launch_mode {
                use tauri::Emitter;
                let app_handle = app.handle().clone();
                // 延迟 500ms 发送事件，确保前端已加载
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    app_handle.emit("launch-mode", true).ok();
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
