use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{Emitter, Manager};
use tokio::fs;
use tokio::io::AsyncWriteExt;

/// 查找 Node.js 可执行文件路径
#[cfg(target_os = "windows")]
fn find_node_exe() -> Option<String> {
    // 检查常见安装路径
    let paths = vec![
        "C:\\Program Files\\nodejs\\node.exe".to_string(),
        "C:\\Program Files (x86)\\nodejs\\node.exe".to_string(),
        format!("{}\\nodejs\\node.exe", std::env::var("LOCALAPPDATA").unwrap_or_default()),
        format!("{}\\.nodejs\\node.exe", std::env::var("USERPROFILE").unwrap_or_default()),
    ];
    
    for path in &paths {
        if std::path::Path::new(path).exists() {
            return Some(path.clone());
        }
    }
    
    // 尝试 where 命令
    if let Ok(output) = Command::new("where").arg("node").output() {
        if output.status.success() {
            if let Some(line) = String::from_utf8_lossy(&output.stdout).lines().next() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && std::path::Path::new(trimmed).exists() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    
    None
}

/// 查找 Node.js 可执行文件路径
#[cfg(not(target_os = "windows"))]
fn find_node_exe() -> Option<String> {
    // 检查常见安装路径
    let paths = vec![
        "/usr/local/bin/node".to_string(),
        "/usr/bin/node".to_string(),
    ];
    
    for path in &paths {
        if std::path::Path::new(path).exists() {
            return Some(path.clone());
        }
    }
    
    // 尝试 which 命令
    if let Ok(output) = Command::new("which").arg("node").output() {
        if output.status.success() {
            if let Some(line) = String::from_utf8_lossy(&output.stdout).lines().next() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && std::path::Path::new(trimmed).exists() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    
    None
}

/// 查找 npm 路径
#[cfg(target_os = "windows")]
fn find_npm_path() -> Option<String> {
    // 直接返回 node 路径
    find_node_exe()
}

#[cfg(not(target_os = "windows"))]
fn find_npm_path() -> Option<String> {
    find_node_exe()
}

/// 检查 Node.js 是否已安装
#[tauri::command]
pub async fn check_nodejs_installed() -> Result<bool, String> {
    // 尝试运行 node --version
    if let Ok(output) = Command::new("node").arg("--version").output() {
        if output.status.success() {
            return Ok(true);
        }
    }
    
    // Windows 上检查默认安装路径
    #[cfg(target_os = "windows")]
    {
        let paths = vec![
            "C:\\Program Files\\nodejs\\node.exe",
        ];
        
        for path in paths {
            if std::path::Path::new(path).exists() {
                if let Ok(output) = Command::new(path).arg("--version").output() {
                    if output.status.success() {
                        return Ok(true);
                    }
                }
            }
        }
    }
    
    Ok(false)
}

/// Windows 平台安装 Node.js
#[cfg(target_os = "windows")]
async fn install_nodejs_windows(app: &tauri::AppHandle) -> Result<String, String> {
    app.emit("model-progress", "正在下载 Node.js LTS...".to_string()).ok();
    
    // 使用多个镜像源
    let node_version = "v22.14.0";
    let mirrors = vec![
        format!("https://npmmirror.com/mirrors/node/{}/node-{}-x64.msi", node_version, node_version),
        format!("https://nodejs.org/dist/{}/node-{}-x64.msi", node_version, node_version),
    ];
    
    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join("nodejs-installer.msi");
    
    // 尝试多个镜像源下载
    let mut download_success = false;
    for (idx, url) in mirrors.iter().enumerate() {
        app.emit("model-progress", format!("尝试镜像源 {}...", idx + 1)).ok();
        
        let ps_output = Command::new("powershell")
            .args(&[
                "-Command",
                &format!(
                    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try {{ Invoke-WebRequest -Uri '{}' -OutFile '{}' -UseBasicParsing -TimeoutSec 60; exit 0 }} catch {{ exit 1 }}",
                    url,
                    installer_path.display()
                ),
            ])
            .output();
        
        if let Ok(output) = ps_output {
            if output.status.success() && installer_path.exists() {
                download_success = true;
                app.emit("model-progress", format!("✅ 镜像源 {} 下载成功", idx + 1)).ok();
                break;
            }
        }
    }
    
    if !download_success {
        return Err(
            "所有镜像源下载失败。\n\n请手动安装 Node.js:\n1. 访问 https://nodejs.org/zh-cn/download/\n2. 或淘宝镜像: https://npmmirror.com/mirrors/node/\n3. 安装后重新运行安装器".to_string()
        );
    }
    
    app.emit("model-progress", format!("已下载: {}", installer_path.display())).ok();
    app.emit("model-progress", "正在安装 Node.js...".to_string()).ok();
    
    // 静默安装 Node.js
    let install_output = Command::new("msiexec")
        .args(&[
            "/i",
            &installer_path.display().to_string(),
            "/qn",
            "/norestart",
        ])
        .output()
        .map_err(|e| format!("安装 Node.js 失败: {}", e))?;
    
    // 清理安装包
    let _ = std::fs::remove_file(&installer_path);
    
    if install_output.status.success() {
        app.emit("model-progress", "✅ Node.js 安装完成".to_string()).ok();
        
        // 验证安装
        std::thread::sleep(std::time::Duration::from_secs(1));
        
        if std::path::Path::new("C:\\Program Files\\nodejs\\node.exe").exists() {
            app.emit("model-progress", "✅ Node.js 已就绪，继续安装 OpenClaw...".to_string()).ok();
            return Ok("C:\\Program Files\\nodejs".to_string());
        }
    }
    
    // 如果静默安装失败，打开安装包让用户手动安装
    if installer_path.exists() {
        let open_result = Command::new("explorer")
            .arg(&installer_path)
            .spawn();
        
        if open_result.is_ok() {
            return Err(
                "已打开 Node.js 安装程序，请完成安装后点击「重新检测」继续。".to_string(),
            );
        }
    }
    
    Err(
        "自动安装失败。请手动安装 Node.js:\n1. 访问 https://nodejs.org/zh-cn/download/\n2. 安装后重新运行安装器".to_string(),
    )
}

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
        // 低配推荐
        ModelRecommendation {
            name: "phi3.5:3.8b".to_string(),
            display_name: "Phi-3.5 3.8B".to_string(),
            size_gb: 2.3,
            description: "轻量级模型，适合低配电脑".to_string(),
            min_vram: 0.0,
            min_ram: 8.0,
            recommended: vram_gb < 6.0 || ram_gb < 16.0,
            tags: vec!["轻量".to_string(), "快速".to_string()],
        },
        ModelRecommendation {
            name: "llama3.2".to_string(),
            display_name: "Llama 3.2 3B".to_string(),
            size_gb: 2.0,
            description: "Meta 最新小模型，性价比高".to_string(),
            min_vram: 0.0,
            min_ram: 8.0,
            recommended: false,
            tags: vec!["轻量".to_string(), "通用".to_string()],
        },
        // 中配推荐
        ModelRecommendation {
            name: "qwen2.5".to_string(),
            display_name: "Qwen 2.5 7B".to_string(),
            size_gb: 4.7,
            description: "阿里通义千问，中文能力强，工具调用稳定".to_string(),
            min_vram: 6.0,
            min_ram: 16.0,
            recommended: vram_gb >= 6.0 && vram_gb < 12.0,
            tags: vec!["中文".to_string(), "工具调用".to_string()],
        },
        ModelRecommendation {
            name: "qwen2.5:14b".to_string(),
            display_name: "Qwen 2.5 14B".to_string(),
            size_gb: 9.0,
            description: "高质量中文模型，代理任务表现优秀".to_string(),
            min_vram: 12.0,
            min_ram: 32.0,
            recommended: vram_gb >= 12.0 && vram_gb < 20.0,
            tags: vec!["中文".to_string(), "代理任务".to_string()],
        },
        // 高配首选 - 文档推荐
        ModelRecommendation {
            name: "qwen3:30b-a3b".to_string(),
            display_name: "Qwen 3 30B (MoE) ⭐".to_string(),
            size_gb: 18.6,
            description: "代理任务首选！MoE 架构，30B 推理能力仅消耗 3B 激活量".to_string(),
            min_vram: 20.0,
            min_ram: 32.0,
            recommended: vram_gb >= 20.0,
            tags: vec!["首选".to_string(), "代理任务".to_string(), "MoE".to_string()],
        },
        ModelRecommendation {
            name: "qwen2.5:32b".to_string(),
            display_name: "Qwen 2.5 32B".to_string(),
            size_gb: 20.0,
            description: "旗舰模型，最佳质量".to_string(),
            min_vram: 24.0,
            min_ram: 64.0,
            recommended: false,
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

// 下载模型 - 使用 Ollama REST API
#[tauri::command]
pub async fn pull_model(model_name: String, app: tauri::AppHandle) -> Result<(), String> {
    app.emit("model-progress", "=== 开始下载模型 ===").ok();
    app.emit("model-progress", format!("目标模型: {}", model_name)).ok();
    
    // 查找并启动 Ollama 服务
    let ollama_path = find_ollama_path(&app);
    
    let ollama_path = match ollama_path {
        Some(path) => {
            app.emit("model-progress", format!("Ollama 路径: {}", path)).ok();
            path
        }
        None => {
            let err = "找不到 Ollama，请确保已安装 Ollama\n下载地址: https://ollama.com/download";
            app.emit("model-progress", err).ok();
            return Err(err.to_string());
        }
    };
    
    // 检查 Ollama 服务是否运行
    app.emit("model-progress", "检查 Ollama 服务...").ok();
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;
    
    let service_running = client
        .get("http://127.0.0.1:11434/api/version")
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);
    
    if !service_running {
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
        for i in 1..=30 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            
            let running = client
                .get("http://127.0.0.1:11434/api/version")
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false);
            
            if running {
                app.emit("model-progress", format!("✅ 服务启动成功 ({}秒)", i / 2)).ok();
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                break;
            }
        }
    } else {
        app.emit("model-progress", "✅ Ollama 服务已运行").ok();
    }
    
    // 使用 Ollama REST API 下载模型
    app.emit("model-progress", "使用 API 下载模型...".to_string()).ok();
    
    let api_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;
    
    let response = api_client
        .post("http://127.0.0.1:11434/api/pull")
        .json(&serde_json::json!({"name": model_name, "stream": true}))
        .send()
        .await
        .map_err(|e| {
            app.emit("model-progress", format!("API 请求失败: {}", e)).ok();
            format!("API 请求失败: {}", e)
        })?;
    
    if !response.status().is_success() {
        let err = format!("API 返回错误: {}", response.status());
        app.emit("model-progress", err.clone()).ok();
        return Err(err);
    }
    
    app.emit("model-progress", "正在下载模型...".to_string()).ok();
    
    // 读取流式响应 - 使用缓冲区处理跨 chunk 的 JSON 行
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut last_percent = 0u64;
    
    while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => {
                app.emit("model-progress", format!("读取数据块失败: {}", e)).ok();
                continue;
            }
        };
        
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        
        // 按行处理缓冲区
        while let Some(newline_pos) = buffer.find('\n') {
            // 先提取行内容，再更新 buffer
            let line = buffer[..newline_pos].trim().to_string(); // 转为 String 避免借用问题
            buffer = buffer[newline_pos + 1..].to_string();
            
            if line.is_empty() { continue; }
            
            match serde_json::from_str::<serde_json::Value>(&line) {
                Ok(json) => {
                    if let Some(status) = json.get("status").and_then(|s| s.as_str()) {
                        let msg = if let Some(completed) = json.get("completed") {
                            let total = json.get("total").and_then(|t| t.as_u64()).unwrap_or(0);
                            let comp = completed.as_u64().unwrap_or(0);
                            if total > 0 {
                                let percent = (comp as f64 / total as f64 * 100.0) as u64;
                                // 每变化 5% 才发送更新，减少日志刷屏
                                if percent >= last_percent + 5 || percent >= 100 {
                                    last_percent = percent;
                                    format!("下载中... {}%", percent)
                                } else {
                                    continue; // 跳过重复状态
                                }
                            } else {
                                status.to_string()
                            }
                        } else {
                            status.to_string()
                        };
                        app.emit("model-progress", msg).ok();
                    }
                    if let Some(error) = json.get("error").and_then(|e| e.as_str()) {
                        app.emit("model-progress", format!("错误: {}", error)).ok();
                        return Err(error.to_string());
                    }
                }
                Err(_) => {
                    // 非 JSON 行，可能是普通文本
                    if line.starts_with('{') {
                        app.emit("model-progress", format!("原始: {}", line)).ok();
                    }
                }
            }
        }
    }
    
    app.emit("model-progress", "=== ✅ 模型下载完成 ===").ok();
    Ok(())
}

// 查找 Ollama 路径
#[cfg(target_os = "windows")]
fn find_ollama_path(app: &tauri::AppHandle) -> Option<String> {
    app.emit("model-progress", "查找 Ollama...").ok();
    
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
    
    let paths = vec![
        format!("{}\\Programs\\Ollama\\ollama.exe", local_app_data),
        format!("{}\\AppData\\Local\\Programs\\Ollama\\ollama.exe", user_profile),
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
    if let Ok(output) = Command::new("where").arg("ollama").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && std::path::Path::new(trimmed).exists() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    
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
    // 方法1: 检查 openclaw 命令
    let cmd_result = Command::new("openclaw").arg("--version").output();
    if let Ok(output) = cmd_result {
        if output.status.success() {
            return Ok(true);
        }
    }
    
    // 方法2: Windows 检查全局安装路径
    #[cfg(target_os = "windows")]
    {
        let npm_global = format!("{}\\npm\\openclaw.cmd", std::env::var("APPDATA").unwrap_or_default());
        if std::path::Path::new(&npm_global).exists() {
            return Ok(true);
        }
        
        // 检查 node_modules
        let node_modules = format!("{}\\npm\\node_modules\\openclaw", std::env::var("APPDATA").unwrap_or_default());
        if std::path::Path::new(&node_modules).exists() {
            return Ok(true);
        }
    }
    
    Ok(false)
}

// 安装 OpenClaw
#[tauri::command]
pub async fn install_openclaw(app: tauri::AppHandle) -> Result<(), String> {
    app.emit("model-progress", "正在安装 OpenClaw...".to_string()).ok();
    
    // 步骤1: 检查 Node.js
    app.emit("model-progress", "检查 Node.js...".to_string()).ok();
    
    if find_node_exe().is_none() {
        #[cfg(target_os = "windows")]
        {
            app.emit("model-progress", "未检测到 Node.js，正在自动安装...".to_string()).ok();
            
            if let Err(e) = install_nodejs_windows(&app).await {
                return Err(format!("需要先安装 Node.js 才能继续。\n\n{}", e));
            }
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            return Err(
                "未检测到 Node.js，请先安装：\n\
                - Ubuntu/Debian: sudo apt install nodejs npm\n\
                - macOS: brew install node\n\
                - 或访问: https://nodejs.org/zh-cn/download/"
                    .to_string(),
            );
        }
    }
    
    // 步骤2: 使用 PowerShell 安装 OpenClaw（多个镜像源备选）
    let registries = vec![
        ("淘宝镜像", "https://registry.npmmirror.com"),
        ("腾讯镜像", "https://mirrors.cloud.tencent.com/npm/"),
        ("华为镜像", "https://repo.huaweicloud.com/repository/npm/"),
        ("官方源", "https://registry.npmjs.org"),
    ];
    
    let mut success = false;
    
    for (name, registry) in &registries {
        app.emit("model-progress", format!("尝试使用 {} 安装...", name)).ok();
        
        #[cfg(target_os = "windows")]
        let result = {
            // 使用 PowerShell 执行 npm 安装
            Command::new("powershell")
                .args(&[
                    "-Command",
                    &format!(
                        "npm install -g openclaw@latest --registry {}",
                        registry
                    ),
                ])
                .output()
        };
        
        #[cfg(not(target_os = "windows"))]
        let result = {
            Command::new("npm")
                .args(&[
                    "install",
                    "-g",
                    "openclaw@latest",
                    "--registry",
                    registry,
                ])
                .output()
        };
        
        #[cfg(not(target_os = "windows"))]
        let result = {
            Command::new("npm")
                .args(&[
                    "install",
                    "-g",
                    "openclaw@latest",
                    "--registry",
                    registry,
                ])
                .output()
        };
        
        match result {
            Ok(output) => {
                if output.status.success() {
                    app.emit("model-progress", format!("✅ OpenClaw 安装完成 ({})", name)).ok();
                    success = true;
                    break;
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    app.emit("model-progress", format!("{} 失败: {}", name, stderr.lines().next().unwrap_or("未知错误"))).ok();
                }
            }
            Err(e) => {
                app.emit("model-progress", format!("{} 执行失败: {}", name, e)).ok();
            }
        }
    }
    
    if !success {
        return Err(
            "所有镜像源安装失败。\n\n\
            请手动安装：\n\
            1. 打开命令行（以管理员身份运行）\n\
            2. 运行: npm install -g openclaw --registry https://registry.npmmirror.com\n\
            3. 或使用代理: npm config set proxy http://127.0.0.1:7890 && npm install -g openclaw"
                .to_string(),
        );
    }
    
    // 验证安装
    app.emit("model-progress", "验证安装...".to_string()).ok();
    
    #[cfg(target_os = "windows")]
    {
        // 等待一下让环境变量生效
        std::thread::sleep(std::time::Duration::from_secs(2));
        
        // 尝试多个路径查找 openclaw
        let openclaw_paths = vec![
            "C:\\Program Files\\nodejs\\openclaw.cmd",
            "C:\\Program Files\\nodejs\\node_modules\\openclaw\\bin\\openclaw.js",
        ];
        
        for path in &openclaw_paths {
            if std::path::Path::new(path).exists() {
                app.emit("model-progress", format!("✅ 找到 OpenClaw: {}", path)).ok();
                return Ok(());
            }
        }
        
        // 使用 where 命令查找
        if let Ok(output) = Command::new("where").arg("openclaw").output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(first) = stdout.lines().next() {
                    app.emit("model-progress", format!("✅ OpenClaw 已安装: {}", first.trim())).ok();
                    return Ok(());
                }
            }
        }
    }
    
    // 验证 openclaw 命令
    if let Ok(output) = Command::new("openclaw").arg("--version").output() {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout);
            app.emit("model-progress", format!("✅ 验证成功: {}", version.trim())).ok();
            return Ok(());
        }
    }
    
    app.emit("model-progress", "⚠️ 安装成功但验证失败，可能需要重启终端".to_string()).ok();
    Ok(())
}



// 配置 OpenClaw 使用本地模型
#[tauri::command]
pub async fn configure_openclaw(model_name: String, app: tauri::AppHandle) -> Result<String, String> {
    app.emit("model-progress", "配置 OpenClaw...").ok();
    
    let config_dir = dirs::config_dir()
        .ok_or("无法找到配置目录")?
        .join("openclaw");
    
    fs::create_dir_all(&config_dir).await.map_err(|e| e.to_string())?;
    
    let config_path = config_dir.join("openclaw.json");
    
    // 配置 OpenClaw - 关键：contextTokens 必须匹配 OLLAMA_NUM_CTX
    let config = serde_json::json!({
        "models": {
            "providers": {
                "ollama": {
                    "baseUrl": "http://127.0.0.1:11434",
                    "apiKey": "dummy-key",  // Ollama 不需要真实 key，但不能为空
                    "authHeader": false,
                    "api": "ollama"
                }
            },
            "contextTokens": 24576  // 匹配 OLLAMA_NUM_CTX
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
    
    app.emit("model-progress", format!("OpenClaw 配置已保存: {}", config_path.display())).ok();
    
    // 配置 Ollama 环境变量
    configure_ollama_env(&app).await?;
    
    Ok(config_path.display().to_string())
}

/// 配置 Ollama 环境变量 - 关键优化
async fn configure_ollama_env(app: &tauri::AppHandle) -> Result<(), String> {
    app.emit("model-progress", "配置 Ollama 环境变量...").ok();
    
    #[cfg(target_os = "windows")]
    {
        // Windows: 设置用户环境变量
        let env_vars = vec![
            ("OLLAMA_NUM_CTX", "24576"),        // 上下文窗口 - 最关键！
            ("OLLAMA_FLASH_ATTENTION", "1"),   // 启用 Flash Attention
            ("OLLAMA_KV_CACHE_TYPE", "q8_0"),  // KV 缓存量化，省显存
            ("OLLAMA_KEEP_ALIVE", "1h"),       // 模型保留显存时间
            ("OLLAMA_NUM_PARALLEL", "2"),      // 并发请求数
        ];
        
        for (key, value) in env_vars {
            let output = Command::new("setx")
                .args(&[key, value])
                .output()
                .map_err(|e| format!("设置 {} 失败: {}", key, e))?;
            
            if output.status.success() {
                app.emit("model-progress", format!("✅ {}={}", key, value)).ok();
            } else {
                app.emit("model-progress", format!("⚠️ 设置 {} 失败", key)).ok();
            }
        }
        
        app.emit("model-progress", "环境变量已设置，重启 Ollama 后生效".to_string()).ok();
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        // Linux/macOS: 写入 ~/.bashrc 或 ~/.zshrc
        let home = std::env::var("HOME").unwrap_or_default();
        let bashrc = format!("{}/.bashrc", home);
        let zshrc = format!("{}/.zshrc", home);
        
        let env_content = r#"
# Ollama 优化配置 (由 OpenClaw 安装器添加)
export OLLAMA_NUM_CTX=24576        # 上下文窗口
export OLLAMA_FLASH_ATTENTION=1    # Flash Attention
export OLLAMA_KV_CACHE_TYPE=q8_0   # KV 缓存量化
export OLLAMA_KEEP_ALIVE=1h        # 模型保留时间
export OLLAMA_NUM_PARALLEL=2       # 并发请求数
"#;
        
        // 追加到 bashrc
        if std::path::Path::new(&bashrc).exists() {
            let mut file = std::fs::OpenOptions::new()
                .append(true)
                .open(&bashrc)
                .map_err(|e| e.to_string())?;
            use std::io::Write;
            file.write_all(env_content.as_bytes()).map_err(|e| e.to_string())?;
            app.emit("model-progress", format!("✅ 已写入 {}", bashrc)).ok();
        }
        
        // 追加到 zshrc
        if std::path::Path::new(&zshrc).exists() {
            let mut file = std::fs::OpenOptions::new()
                .append(true)
                .open(&zshrc)
                .map_err(|e| e.to_string())?;
            use std::io::Write;
            file.write_all(env_content.as_bytes()).map_err(|e| e.to_string())?;
            app.emit("model-progress", format!("✅ 已写入 {}", zshrc)).ok();
        }
        
        app.emit("model-progress", "环境变量已写入，请重新打开终端或 source ~/.bashrc 生效".to_string()).ok();
    }
    
    Ok(())
}

/// 启动 OpenClaw
#[tauri::command]
pub async fn start_openclaw(app: tauri::AppHandle) -> Result<String, String> {
    app.emit("model-progress", "正在启动 OpenClaw...".to_string()).ok();
    
    #[cfg(target_os = "windows")]
    {
        // 先使用 reqwest 检查是否已经在运行
        if let Ok(client) = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
        {
            if let Ok(resp) = client.get("http://localhost:3000").send().await {
                if resp.status().is_success() {
                    app.emit("gateway-started", true).ok();
                    app.emit("model-progress", "✅ OpenClaw 已在运行中".to_string()).ok();
                    return Ok("OpenClaw 已在运行，访问 http://localhost:3000".to_string());
                }
            }
        }
        
        app.emit("model-progress", "正在后台启动 OpenClaw Gateway...".to_string()).ok();
        
        // 创建启动脚本
        let ps_script = r#"
$Host.UI.RawUI.WindowTitle = "OpenClaw Gateway"
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   OpenClaw Gateway 启动中..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 设置环境变量
$env:OLLAMA_NUM_CTX = "24576"
$env:OLLAMA_HOST = "0.0.0.0"

# 检查 openclaw 命令（全局安装）
$openclawCmd = Get-Command openclaw -ErrorAction SilentlyContinue

if ($openclawCmd) {
    Write-Host "[OK] openclaw: $($openclawCmd.Source)" -ForegroundColor Green
    Write-Host ""
    Write-Host "正在启动 OpenClaw Gateway..." -ForegroundColor Yellow
    Write-Host ""
    
    # 直接使用全局安装的 openclaw
    & openclaw gateway start
} else {
    Write-Host "[警告] 未找到 openclaw 命令" -ForegroundColor Yellow
    Write-Host "尝试使用 npx 启动（需要下载依赖）..." -ForegroundColor Yellow
    Write-Host ""
    
    # 设置 npm 镜像加速
    $env:npm_config_registry = "https://registry.npmmirror.com"
    
    $npxCmd = Get-Command npx -ErrorAction SilentlyContinue
    if (-not $npxCmd) {
        Write-Host "[错误] 找不到 npx 命令" -ForegroundColor Red
        Write-Host "请确保 Node.js 已安装" -ForegroundColor Yellow
        Read-Host "按 Enter 键关闭"
        exit 1
    }
    
    Write-Host "[OK] npx: $($npxCmd.Source)" -ForegroundColor Green
    Write-Host "[OK] 使用淘宝镜像加速" -ForegroundColor Green
    Write-Host ""
    Write-Host "首次启动需要下载依赖（约300MB），请耐心等待..." -ForegroundColor Yellow
    Write-Host ""
    
    # 使用 npx 启动
    & npx openclaw gateway start
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "" 
    Write-Host "[错误] 启动失败 (退出码: $LASTEXITCODE)" -ForegroundColor Red
    Read-Host "按 Enter 键关闭"
}
"#;
        
        let temp_dir = std::env::temp_dir();
        let ps1_path = temp_dir.join("start_openclaw.ps1");
        
        if let Err(e) = std::fs::write(&ps1_path, ps_script) {
            return Err(format!("创建启动脚本失败: {}", e));
        }
        
        // 使用 PowerShell 启动
        let result = Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-ExecutionPolicy", "Bypass",
                "-File",
                &ps1_path.to_string_lossy(),
            ])
            .spawn();
        
        if result.is_ok() {
            app.emit("model-progress", "⏳ 等待 OpenClaw 启动...".to_string()).ok();
            
            // 在后台轮询检查服务是否启动，并发送进度事件
            let app_clone = app.clone();
            tokio::spawn(async move {
                let mut progress = 10;
                
                // 最多等待 5 分钟（首次启动需要下载依赖）
                for i in 0..150 {
                    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                    
                    // 更新进度（从10到90，150次循环每次+0.5）
                    if progress < 90 {
                        progress += 1;
                        app_clone.emit("startup-progress", progress).ok();
                    }
                    
                    if let Ok(client) = reqwest::Client::builder()
                        .timeout(std::time::Duration::from_secs(2))
                        .build()
                    {
                        if let Ok(resp) = client.get("http://localhost:3000").send().await {
                            if resp.status().is_success() {
                                app_clone.emit("startup-progress", 100).ok();
                                app_clone.emit("gateway-started", true).ok();
                                app_clone.emit("model-progress", "✅ OpenClaw 已启动成功！".to_string()).ok();
                                return;
                            }
                        }
                    }
                }
                app_clone.emit("model-progress", "⚠️ 启动超时，请查看控制台窗口".to_string()).ok();
            });
            
            return Ok("OpenClaw 正在后台启动，请等待...".to_string());
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        // Linux/macOS
        let result = Command::new("npx")
            .args(&["openclaw", "gateway", "start"])
            .spawn();
        
        if result.is_ok() {
            app.emit("model-progress", "✅ OpenClaw 已启动".to_string()).ok();
            return Ok("OpenClaw 已启动，请访问 http://localhost:3000".to_string());
        }
    }
    
    Err("启动失败。请打开命令行运行: npx openclaw gateway start".to_string())
}

/// 创建桌面快捷方式
#[tauri::command]
pub async fn create_desktop_shortcut(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let desktop = std::env::var("USERPROFILE")
            .map(|p| format!("{}\\Desktop", p))
            .map_err(|_| "无法找到桌面目录".to_string())?;
        
        // 获取当前 EXE 路径
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("无法获取程序路径: {}", e))?;
        let exe_path_str = exe_path.to_string_lossy().to_string();
        
        // 使用 PowerShell 创建 .lnk 快捷方式
        let ps_script = format!(r#"
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("{}\\OpenClaw.lnk")
$Shortcut.TargetPath = "{}"
$Shortcut.Arguments = "--launch"
$Shortcut.Description = "OpenClaw 本地 AI 助手"
$Shortcut.WorkingDirectory = "{}"
$Shortcut.Save()
Write-Host "快捷方式已创建"
"#, 
            desktop, 
            exe_path_str,
            std::env::var("USERPROFILE").unwrap_or_default()
        );
        
        let result = Command::new("powershell")
            .args(&["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps_script])
            .output();
        
        match result {
            Ok(output) => {
                if output.status.success() {
                    // 删除旧的 bat 和 ps1 文件
                    let _ = std::fs::remove_file(format!("{}\\OpenClaw.bat", desktop));
                    let _ = std::fs::remove_file(format!("{}\\OpenClaw.ps1", desktop));
                    
                    Ok("✅ 桌面快捷方式创建成功！\n双击 OpenClaw.lnk 即可启动".to_string())
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    Err(format!("创建快捷方式失败: {}", stderr))
                }
            }
            Err(e) => Err(format!("创建快捷方式失败: {}", e))
        }
    }
    
    #[cfg(target_os = "macos")]
    {
        let desktop = std::env::var("HOME")
            .map(|p| format!("{}/Desktop", p))
            .map_err(|_| "无法找到桌面目录".to_string())?;
        
        let shortcut = format!("{}/OpenClaw.command", desktop);
        let content = "#!/bin/bash\n# 尝试多种方式启动 OpenClaw\nif command -v openclaw &> /dev/null; then\n    openclaw gateway start\nelif command -v npx &> /dev/null; then\n    npx openclaw gateway start\nelse\n    echo 'OpenClaw 未找到, 请确保已正确安装'\n    exit 1\nfi\n\necho 'OpenClaw 已启动, 请访问 http://localhost:3000'\nread -p '按 Enter 键关闭...'\n";
        
        std::fs::write(&shortcut, content).map_err(|e| e.to_string())?;
        
        // 添加执行权限
        Command::new("chmod")
            .args(&["+x", &shortcut])
            .output()
            .ok();
        
        Ok("桌面快捷方式创建成功！".to_string())
    }
    
    #[cfg(target_os = "linux")]
    {
        let desktop_dir = std::env::var("HOME")
            .map(|p| format!("{}/Desktop", p))
            .map_err(|_| "无法找到桌面目录".to_string())?;
        
        let shortcut = format!("{}/openclaw.desktop", desktop_dir);
        let content = r"[Desktop Entry]
Version=1.0
Type=Application
Name=OpenClaw
Comment=本地 AI 助手
Exec=bash -c 'openclaw gateway start || npx openclaw gateway start'
Icon=openclaw
Terminal=true
Categories=Development;
";
        
        std::fs::write(&shortcut, content).map_err(|e| e.to_string())?;
        
        // 添加执行权限
        Command::new("chmod")
            .args(&["+x", &shortcut])
            .output()
            .ok();
        
        Ok("桌面快捷方式创建成功！".to_string())
    }
}
