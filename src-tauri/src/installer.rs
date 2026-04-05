use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{Emitter, Manager};
use tokio::fs;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRecommendation {
    pub name: String,
    pub display_name: String,
    pub size_gb: f64,
    pub description: String,
    pub min_vram: f64,
    pub min_ram: f64,
    pub recommended: bool,
    pub tags: Vec<String>,
}

// 模型推荐表
#[tauri::command]
pub async fn get_recommended_models(vram_gb: f64, ram_gb: f64) -> Vec<ModelRecommendation> {
    let mut models = vec![
        ModelRecommendation {
            name: "phi-3.5:3.8b".to_string(),
            display_name: "Phi-3.5 3.8B".to_string(),
            size_gb: 2.3,
            description: "轻量级模型，适合低配电脑".to_string(),
            min_vram: 0.0,
            min_ram: 8.0,
            recommended: vram_gb < 6.0 || ram_gb < 16.0,
            tags: vec!["轻量".to_string(), "快速".to_string()],
        },
        ModelRecommendation {
            name: "llama3.2:3b".to_string(),
            display_name: "Llama 3.2 3B".to_string(),
            size_gb: 2.0,
            description: "Meta 最新小模型，性价比高".to_string(),
            min_vram: 0.0,
            min_ram: 8.0,
            recommended: false,
            tags: vec!["轻量".to_string(), "通用".to_string()],
        },
        ModelRecommendation {
            name: "llama3.1:8b".to_string(),
            display_name: "Llama 3.1 8B".to_string(),
            size_gb: 4.7,
            description: "主流模型，平衡性能与质量".to_string(),
            min_vram: 6.0,
            min_ram: 16.0,
            recommended: vram_gb >= 6.0 && vram_gb < 12.0,
            tags: vec!["推荐".to_string(), "通用".to_string()],
        },
        ModelRecommendation {
            name: "qwen2.5:7b".to_string(),
            display_name: "Qwen 2.5 7B".to_string(),
            size_gb: 4.7,
            description: "阿里通义千问，中文能力强".to_string(),
            min_vram: 6.0,
            min_ram: 16.0,
            recommended: vram_gb >= 6.0 && vram_gb < 12.0,
            tags: vec!["中文".to_string(), "通用".to_string()],
        },
        ModelRecommendation {
            name: "qwen2.5:14b".to_string(),
            display_name: "Qwen 2.5 14B".to_string(),
            size_gb: 9.0,
            description: "高质量中文通用模型".to_string(),
            min_vram: 12.0,
            min_ram: 32.0,
            recommended: vram_gb >= 12.0 && vram_gb < 24.0,
            tags: vec!["中文".to_string(), "高级".to_string()],
        },
        ModelRecommendation {
            name: "qwen2.5:32b".to_string(),
            display_name: "Qwen 2.5 32B".to_string(),
            size_gb: 20.0,
            description: "旗舰模型，最佳质量".to_string(),
            min_vram: 24.0,
            min_ram: 64.0,
            recommended: vram_gb >= 24.0,
            tags: vec!["旗舰".to_string(), "中文".to_string()],
        },
    ];
    
    models.retain(|m| (vram_gb >= m.min_vram || m.min_vram == 0.0) && ram_gb >= m.min_ram);
    
    if !models.iter().any(|m| m.recommended) && !models.is_empty() {
        models[0].recommended = true;
    }
    
    models
}

// 检查 Ollama 是否已安装
#[tauri::command]
pub async fn check_ollama_installed() -> Result<bool, String> {
    // 检查 API 是否响应
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build().map_err(|e| e.to_string())?;
    
    if client.get("http://127.0.0.1:11434/api/version").send().await.ok().map(|r| r.status().is_success()).unwrap_or(false) {
        return Ok(true);
    }
    
    Ok(false)
}

// 安装 Ollama
#[tauri::command]
pub async fn install_ollama(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let download_url = "https://ollama.com/download/OllamaSetup.exe";
        let temp_dir = std::env::temp_dir();
        let installer_path = temp_dir.join("OllamaSetup.exe");
        
        let _ = app.emit("install-progress", "正在下载 Ollama...");
        
        let ps_output = Command::new("powershell")
            .args(&["-Command", &format!("Invoke-WebRequest -Uri '{}' -OutFile '{}'", download_url, installer_path.display())])
            .output().map_err(|e| e.to_string())?;
        
        if !ps_output.status.success() {
            return Err("下载 Ollama 失败".to_string());
        }
        
        let _ = app.emit("install-progress", "正在安装 Ollama...");
        
        let install_output = Command::new(&installer_path)
            .args(&["/S"])
            .output().map_err(|e| e.to_string())?;
        
        if !install_output.status.success() {
            return Err("安装 Ollama 失败".to_string());
        }
        
        let _ = std::fs::remove_file(&installer_path);
        let _ = app.emit("install-progress", "Ollama 安装完成");
    }
    
    Ok(())
}

// 下载模型
#[tauri::command]
pub async fn pull_model(model_name: String, app: tauri::AppHandle) -> Result<(), String> {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    
    app.emit("model-progress", "=== 开始下载模型 ===").ok();
    app.emit("model-progress", format!("目标模型: {}", model_name)).ok();
    
    // 查找 Ollama 路径
    let ollama_path = find_ollama_path(&app);
    
    let ollama_path = match ollama_path {
        Some(path) => {
            app.emit("model-progress", format!("使用 Ollama 路径: {}", path)).ok();
            path
        }
        None => {
            let err = "找不到 Ollama，请确保已安装 Ollama\n下载地址: https://ollama.com/download";
            app.emit("model-progress", err).ok();
            return Err(err.to_string());
        }
    };
    
    // 检查并启动 Ollama 服务
    app.emit("model-progress", "检查 Ollama 服务...").ok();
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build().ok();
    
    let service_running = client.as_ref()
        .map(|c| c.get("http://127.0.0.1:11434/api/version").send().ok().map(|r| r.status().is_success()).unwrap_or(false))
        .unwrap_or(false);
    
    if service_running {
        app.emit("model-progress", "✅ Ollama 服务已运行").ok();
    } else {
        app.emit("model-progress", "Ollama 服务未运行，正在启动...").ok();
        
        // 启动 ollama serve
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            
            let _ = Command::new(&ollama_path)
                .arg("serve")
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            let _ = Command::new(&ollama_path).arg("serve").spawn();
        }
        
        // 等待服务启动
        app.emit("model-progress", "等待服务启动...").ok();
        for i in 1..=20 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            
            if let Some(ref c) = client {
                if c.get("http://127.0.0.1:11434/api/version").send().ok().map(|r| r.status().is_success()).unwrap_or(false) {
                    app.emit("model-progress", format!("✅ 服务启动成功 ({}秒)", i / 2)).ok();
                    break;
                }
            }
            
            if i == 20 {
                app.emit("model-progress", "⚠️ 服务启动超时，继续尝试下载...").ok();
            }
        }
    }
    
    app.emit("model-progress", format!("执行: {} pull {}", ollama_path, model_name)).ok();
    
    let mut child = Command::new(&ollama_path)
        .args(&["pull", &model_name])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            app.emit("model-progress", format!("启动下载失败: {}", e)).ok();
            format!("启动下载失败: {}", e)
        })?;
    
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            app.emit("model-progress", &line).ok();
        }
    }
    
    // 也读取错误输出
    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            app.emit("model-progress", format!("[stderr] {}", line)).ok();
        }
    }
    
    let status = child.wait().map_err(|e| {
        app.emit("model-progress", format!("等待进程失败: {}", e)).ok();
        format!("等待进程失败: {}", e)
    })?;
    
    if !status.success() {
        app.emit("model-progress", "❌ 下载模型失败").ok();
        return Err("下载模型失败".to_string());
    }
    
    app.emit("model-progress", "=== ✅ 模型下载完成 ===").ok();
    Ok(())
}

// 查找 Ollama 路径
#[cfg(target_os = "windows")]
fn find_ollama_path(app: &tauri::AppHandle) -> Option<String> {
    use std::os::windows::process::CommandExt;
    
    app.emit("model-progress", "开始查找 Ollama...").ok();
    
    // 获取环境变量
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    
    app.emit("model-progress", format!("LOCALAPPDATA: {}", local_app_data)).ok();
    app.emit("model-progress", format!("USERPROFILE: {}", user_profile)).ok();
    
    // 检查默认安装路径
    let paths = vec![
        format!("{}\\Programs\\Ollama\\ollama.exe", local_app_data),
        format!("{}\\AppData\\Local\\Programs\\Ollama\\ollama.exe", user_profile),
        "C:\\Users\\Default\\AppData\\Local\\Programs\\Ollama\\ollama.exe".to_string(),
        "C:\\Program Files\\Ollama\\ollama.exe".to_string(),
    ];
    
    for path in &paths {
        app.emit("model-progress", format!("检查: {}", path)).ok();
        if std::path::Path::new(path).exists() {
            app.emit("model-progress", format!("✅ 找到: {}", path)).ok();
            return Some(path.clone());
        }
    }
    
    // 尝试 where 命令
    app.emit("model-progress", "尝试 where ollama...").ok();
    if let Ok(output) = Command::new("where").arg("ollama").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && std::path::Path::new(trimmed).exists() {
                    app.emit("model-progress", format!("✅ where 找到: {}", trimmed)).ok();
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    
    app.emit("model-progress", "❌ 未找到 Ollama").ok();
    None
}

#[cfg(not(target_os = "windows"))]
fn find_ollama_path(app: &tauri::AppHandle) -> Option<String> {
    app.emit("model-progress", "检查 Ollama...").ok();
    
    if std::path::Path::new("/usr/local/bin/ollama").exists() {
        return Some("/usr/local/bin/ollama".to_string());
    }
    
    if std::path::Path::new("/usr/bin/ollama").exists() {
        return Some("/usr/bin/ollama".to_string());
    }
    
    Some("ollama".to_string())
}

// 检查 OpenClaw 是否已安装
#[tauri::command]
pub async fn check_openclaw_installed() -> Result<bool, String> {
    let output = Command::new("openclaw").arg("--version").output();
    Ok(output.map(|o| o.status.success()).unwrap_or(false))
}

// 安装 OpenClaw
#[tauri::command]
pub async fn install_openclaw(app: tauri::AppHandle) -> Result<(), String> {
    app.emit("install-progress", "正在安装 OpenClaw...").ok();
    
    #[cfg(target_os = "windows")]
    {
        let npm_output = Command::new("npm")
            .args(&["install", "-g", "openclaw@latest"])
            .output()
            .map_err(|e| e.to_string())?;
        
        if !npm_output.status.success() {
            return Err("安装 OpenClaw 失败".to_string());
        }
    }
    
    app.emit("install-progress", "OpenClaw 安装完成").ok();
    Ok(())
}

// 配置 OpenClaw 使用本地模型
#[tauri::command]
pub async fn configure_openclaw(model_name: String) -> Result<String, String> {
    let config_dir = dirs::config_dir()
        .ok_or("无法找到配置目录")?
        .join("openclaw");
    
    fs::create_dir_all(&config_dir).await.map_err(|e| e.to_string())?;
    
    let config_path = config_dir.join("openclaw.json");
    
    let config = serde_json::json!({
        "models": {
            "providers": {
                "ollama": {
                    "baseUrl": "http://127.0.0.1:11434",
                    "apiKey": "local",
                    "api": "ollama"
                }
            }
        },
        "agents": {
            "defaults": {
                "model": {
                    "primary": format!("ollama/{}", model_name),
                    "fallbacks": []
                }
            }
        }
    });
    
    let config_str = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(&config_path).await.map_err(|e| e.to_string())?;
    file.write_all(config_str.as_bytes()).await.map_err(|e| e.to_string())?;
    
    Ok(config_path.display().to_string())
}
