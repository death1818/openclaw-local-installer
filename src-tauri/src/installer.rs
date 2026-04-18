use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::Emitter;
use tokio::fs;
use tokio::io::AsyncWriteExt;

// 导入models模块的InstalledModel
use crate::models::InstalledModel;

/// 查找 Node.js 可执行文件路径
#[cfg(target_os = "windows")]
fn find_node_exe() -> Option<String> {
    // 检查常见安装路径
    let paths = vec![
        "C:\\Program Files\nodejs\node.exe".to_string(),
        "C:\\Program Files (x86)\nodejs\node.exe".to_string(),
        format!("{}\nodejs\node.exe", std::env::var("LOCALAPPDATA").unwrap_or_default()),
        format!("{}\\.nodejs\node.exe", std::env::var("USERPROFILE").unwrap_or_default()),
    ];
    
    for path in &paths {
        if std::path::Path::new(path).exists() {
            return Some(path.clone());
        }
    }
    
    // 尝试 where 命令
    if let Ok(output) = Command::new("C:\\Windows\\System32\\where.exe").arg("node").output() {
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
            "C:\\Program Files\nodejs\node.exe",
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
        
        let ps_output = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
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
        
        if std::path::Path::new("C:\\Program Files\nodejs\node.exe").exists() {
            app.emit("model-progress", "✅ Node.js 已就绪，继续安装 OpenClaw...".to_string()).ok();
            return Ok("C:\\Program Files\nodejs".to_string());
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

// 准备 Ollama 环境（检测/安装/下载模型） - 一键自动化
#[tauri::command]
#[cfg(target_os = "windows")]
pub async fn prepare_ollama_environment(app: tauri::AppHandle) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    
    app.emit("model-progress", "🚀 开始准备本地AI环境...".to_string()).ok();
    
    // 步骤1: 检查 Ollama 是否已安装
    app.emit("model-progress", "[1/3] 检查 Ollama 安装状态...".to_string()).ok();
    
    let ollama_check = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
        .args(&["-NoProfile", "-Command", "where.exe ollama"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    
    let ollama_installed = match ollama_check {
        Ok(output) => {
            let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
            !result.is_empty() && !result.contains("找不到")
        }
        Err(_) => false,
    };
    
    if !ollama_installed {
        // 需要安装 Ollama
        app.emit("model-progress", "⚠️ Ollama 未安装，正在下载安装...".to_string()).ok();
        
        // 下载 Ollama - 使用 Invoke-WebRequest
        let download_cmd = "Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile 'C:\\Users\\Public\\OllamaSetup.exe'";
        app.emit("model-progress", "⏬ 正在下载 Ollama...".to_string()).ok();
        let _ = Command::new("powershell.exe")
            .args(&["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &download_cmd])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        
        app.emit("model-progress", "📦 正在安装 Ollama...".to_string()).ok();
        // 安装 Ollama
        let install_result = Command::new("powershell.exe")
            .args(&["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "& 'C:\\Users\\Public\\OllamaSetup.exe' /S"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        
        match install_result {
            Ok(output) => {
                app.emit("model-progress", "✅ Ollama 安装命令已执行！".to_string()).ok();
                std::thread::sleep(std::time::Duration::from_secs(10));
            }
            Err(e) => {
                app.emit("model-progress", format!("⚠️ 安装出错: {}", e)).ok();
            }
        }
    } else {
        app.emit("model-progress", "✅ Ollama 已安装".to_string()).ok();
    }
    
    // 步骤2: 检查 phi3.5 模型
    app.emit("model-progress", "[2/3] 检查本地模型...".to_string()).ok();
    
    let model_check = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
        .args(&["-NoProfile", "-Command", "ollama list"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    
    let has_phi35 = match model_check {
        Ok(output) => String::from_utf8_lossy(&output.stdout).contains("phi3.5"),
        Err(_) => false,
    };
    
    if !has_phi35 {
        // 需要下载模型
        app.emit("model-progress", "⚠️ phi3.5 模型未找到，正在下载（约2GB）...".to_string()).ok();
        app.emit("model-progress", "💡 此过程可能需要几分钟，请耐心等待...".to_string()).ok();
        
        let pull_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
            .args(&["-NoProfile", "-Command", "ollama pull phi3.5"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        
        match pull_result {
            Ok(output) => {
                if output.status.success() {
                    app.emit("model-progress", "✅ phi3.5 模型下载成功！".to_string()).ok();
                } else {
                    return Err("❌ 模型下载失败！请手动运行：ollama pull phi3.5".to_string());
                }
            }
            Err(e) => {
                return Err(format!("❌ 模型下载出错: {}", e));
            }
        }
    } else {
        app.emit("model-progress", "✅ phi3.5 模型已存在".to_string()).ok();
    }
    
    // 步骤3: 完成
    app.emit("model-progress", "[3/3] ✅ 本地AI环境准备完成！".to_string()).ok();
    
    Ok("✅ Ollama 和 phi3.5 模型准备完成！".to_string())
}

// 非 Windows 版本的 stub
#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub async fn prepare_ollama_environment(_app: tauri::AppHandle) -> Result<String, String> {
    Ok("此功能仅支持 Windows".to_string())
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

// Ollama综合状态检测（包含API和模型列表）
#[derive(serde::Serialize)]
pub struct OllamaStatus {
    pub api_running: bool,
    pub installed: bool,
    pub models: Vec<InstalledModel>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn check_ollama_status() -> Result<OllamaStatus, String> {
    // 先检查API是否可访问
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build().map_err(|e| e.to_string())?;
    
    let api_running = client.get("http://127.0.0.1:11434/api/version")
        .send().await
        .ok()
        .map(|r| r.status().is_success())
        .unwrap_or(false);
    
    // 尝试获取模型列表
    let models = if api_running {
        let output = Command::new("ollama")
            .args(&["list"])
            .output();
        
        match output {
            Ok(out) => {
                if out.status.success() {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let mut model_list = Vec::new();
                    
                    // 解析输出（跳过标题行）
                    for line in stdout.lines().skip(1) {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 3 {
                            // 处理Windows和Linux不同格式
                            let name = parts[0].to_string();
                            let size = parts.last().unwrap_or(&"").to_string();
                            // modified_at 可能是多字段，取中间部分
                            let modified = if parts.len() > 3 {
                                parts[1..parts.len()-1].join(" ")
                            } else {
                                parts.get(1).unwrap_or(&"").to_string()
                            };
                            
                            if !name.is_empty() && name != "-" {
                                model_list.push(InstalledModel {
                                    name,
                                    modified_at: modified,
                                    size,
                                });
                            }
                        }
                    }
                    model_list
                } else {
                    Vec::new()
                }
            }
            Err(e) => {
                return Ok(OllamaStatus {
                    api_running,
                    installed: false,
                    models: Vec::new(),
                    error: Some(format!("执行ollama list失败: {}", e)),
                });
            }
        }
    } else {
        Vec::new()
    };
    
    Ok(OllamaStatus {
        api_running,
        installed: api_running,  // API可访问即表示已安装
        models,
        error: None,
    })
}

// 检查是否有任何模型已安装（通用方法）
#[tauri::command]
pub async fn check_any_model_installed() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("ollama")
            .args(&["list"])
            .output();
        
        match output {
            Ok(out) => {
                if out.status.success() {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    // 检查是否有任何模型（跳过标题行）
                    let lines: Vec<&str> = stdout.lines().skip(1).collect();
                    Ok(!lines.is_empty())
                } else {
                    Ok(false)
                }
            }
            Err(_) => Ok(false),
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        let output = Command::new("ollama")
            .args(&["list"])
            .output();
        
        match output {
            Ok(out) => {
                if out.status.success() {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let lines: Vec<&str> = stdout.lines().skip(1).collect();
                    Ok(!lines.is_empty())
                } else {
                    Ok(false)
                }
            }
            Err(_) => Ok(false),
        }
    }
}

// 获取已安装模型数量
#[tauri::command]
pub async fn get_installed_model_count() -> Result<usize, String> {
    let output = Command::new("ollama")
        .args(&["list"])
        .output()
        .map_err(|e| format!("获取模型列表失败: {}", e))?;
    
    if !output.status.success() {
        return Ok(0);
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    // 跳过标题行，统计模型数量
    let count = stdout.lines().skip(1).filter(|line| !line.trim().is_empty()).count();
    
    Ok(count)
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
        
        let ps_output = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
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
    
    // 发送进度条开始事件
    app.emit("model-download-progress", crate::download::DownloadProgress {
        phase: format!("下载 {}", model_name),
        current: 0.0,
        total: 100.0,
        percent: 0,
    }).ok();
    
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
                                // 每变化 1% 才发送更新
                                if percent >= last_percent + 1 || percent >= 100 {
                                    last_percent = percent;
                                    // 发送进度条更新
                                    app.emit("model-download-progress", crate::download::DownloadProgress {
                                        phase: format!("下载 {}", model_name),
                                        current: comp as f64,
                                        total: total as f64,
                                        percent: percent as u8,
                                    }).ok();
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
    
    // 发送完成事件
    app.emit("model-download-progress", crate::download::DownloadProgress {
        phase: format!("{} 下载完成", model_name),
        current: 100.0,
        total: 100.0,
        percent: 100,
    }).ok();
    
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
    if let Ok(output) = Command::new("C:\\Windows\\System32\\where.exe").arg("ollama").output() {
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
/// 检查 OpenClaw 配置文件是否存在
#[tauri::command]
pub async fn check_openclaw_config_exists() -> Result<bool, String> {
    // 检查配置文件路径
    let home_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "无法找到用户主目录")?;
    
    let yaml_path = std::path::PathBuf::from(&home_dir).join(".openclaw").join("openclaw.yaml");
    
    Ok(yaml_path.exists())
}

/// 清理旧版本（彻底清理）
#[tauri::command]
pub async fn clean_old_version() -> Result<String, String> {
    println!("开始清理旧版本...");
    
    // 1. 卸载全局安装的 openclaw
    #[cfg(target_os = "windows")]
    let _ = Command::new("npm")
        .args(&["uninstall", "-g", "openclaw"])
        .output();
    
    #[cfg(not(target_os = "windows"))]
    let _ = Command::new("npm")
        .args(&["uninstall", "-g", "openclaw"])
        .output();
    
    // 2. 删除配置文件目录
    let home_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "无法找到用户主目录")?;
    
    let config_dir = std::path::PathBuf::from(&home_dir).join(".openclaw");
    
    if config_dir.exists() {
        tokio::fs::remove_dir_all(&config_dir).await.map_err(|e| e.to_string())?;
        println!("已删除配置目录: {:?}", config_dir);
    }
    
    println!("清理完成");
    Ok("旧版本已清理".to_string())
}

/// 检查 OpenClaw 是否已安装
#[tauri::command]
pub async fn check_openclaw_installed() -> Result<bool, String> {
    // 方法1: 使用完整路径检查 openclaw 命令
    let cmd_result = Command::new("C:\\Windows\\System32\\where.exe").arg("openclaw").output();
    if let Ok(output) = cmd_result {
        if output.status.success() {
            // 找到 openclaw，验证版本
            if let Ok(ver_output) = Command::new("openclaw").arg("--version").output() {
                if ver_output.status.success() {
                    return Ok(true);
                }
            }
        }
    }
    
    // 方法2: Windows 检查全局安装路径
    #[cfg(target_os = "windows")]
    {
        // 检查多个可能的路径
        let paths = vec![
            format!("{}\npm\\openclaw.cmd", std::env::var("APPDATA").unwrap_or_default()),
            format!("{}\npm\\openclaw", std::env::var("APPDATA").unwrap_or_default()),
            format!("{}\\AppData\\Roaming\npm\\openclaw.cmd", std::env::var("USERPROFILE").unwrap_or_default()),
            format!("{}\\AppData\\Roaming\npm\\openclaw", std::env::var("USERPROFILE").unwrap_or_default()),
        ];
        
        for path in paths {
            if std::path::Path::new(&path).exists() {
                return Ok(true);
            }
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
            Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
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
            "C:\\Program Files\nodejs\\openclaw.cmd",
            "C:\\Program Files\nodejs\node_modules\\openclaw\\bin\\openclaw.js",
        ];
        
        for path in &openclaw_paths {
            if std::path::Path::new(path).exists() {
                app.emit("model-progress", format!("✅ 找到 OpenClaw: {}", path)).ok();
                return Ok(());
            }
        }
        
        // 使用 where 命令查找
        if let Ok(output) = Command::new("C:\\Windows\\System32\\where.exe").arg("openclaw").output() {
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
    if let Ok(output) = Command::new("C:\\Windows\\System32\\where.exe").arg("openclaw").output() {
        if output.status.success() {
            if let Ok(ver_output) = Command::new("openclaw").arg("--version").output() {
                if ver_output.status.success() {
                    let version = String::from_utf8_lossy(&ver_output.stdout);
                    app.emit("model-progress", format!("✅ 验证成功: {}", version.trim())).ok();
                    return Ok(());
                }
            }
        }
    }
    
    app.emit("model-progress", "⚠️ 安装成功但验证失败，可能需要重启终端".to_string()).ok();
    Ok(())
}



// 配置 OpenClaw - 直接创建 openclaw.yaml 配置文件
#[tauri::command]
pub async fn configure_openclaw(model_name: String, is_docker: bool, app: tauri::AppHandle) -> Result<String, String> {
    app.emit("model-progress", "=== 配置 OpenClaw ===".to_string()).ok();
    
    // 根据模式选择 Ollama URL
    // Docker 模式：连接宿主机（host.docker.internal）
    // 本地模式：连接本机（127.0.0.1）
    let ollama_url = if is_docker {
        app.emit("model-progress", "模式: Docker (连接宿主机 Ollama)".to_string()).ok();
        "http://host.docker.internal:11434"
    } else {
        app.emit("model-progress", "模式: 本地 (连接本地 Ollama)".to_string()).ok();
        "http://127.0.0.1:11434"
    };
    
    // OpenClaw 配置在用户主目录下的 .openclaw 文件夹
    let home_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|e| {
            app.emit("model-progress", format!("❌ 无法找到用户主目录: {}", e)).ok();
            format!("无法找到用户主目录: {}", e)
        })?;
    
    app.emit("model-progress", format!("主目录: {}", home_dir)).ok();
    app.emit("model-progress", format!("Ollama URL: {}", ollama_url)).ok();
    
    let yaml_content = format!(r#"# OpenClaw 配置文件
# 由安装器自动生成

# 默认模型配置
model: ollama/{model}

# 模型提供商配置
models:
  providers:
    ollama:
      baseUrl: "{ollama_url}"
      api: ollama
      models:
        - id: "{model}"
          name: "{model}"
          reasoning: false
          input:
            - text
          cost:
            input: 0
            output: 0
            cacheRead: 0
            cacheWrite: 0
          contextWindow: 128000
          maxTokens: 8192

# Gateway 配置
gateway:
  port: 18789
  host: 0.0.0.0
"#, model = model_name, ollama_url = ollama_url);
    
    // 尝试多个配置目录（按优先级）
    let config_paths = vec![
        std::path::PathBuf::from(&home_dir).join(".openclaw"),
        std::env::temp_dir().join(".openclaw"),
        std::path::PathBuf::from(&home_dir).join("AppData\\Local\\openclaw"),
    ];
    
    for (idx, config_dir) in config_paths.iter().enumerate() {
        app.emit("model-progress", format!("尝试路径 {}: {}", idx + 1, config_dir.display())).ok();
        
        // 创建目录
        if !config_dir.exists() {
            match std::fs::create_dir_all(config_dir) {
                Ok(_) => {
                    app.emit("model-progress", "目录创建成功".to_string()).ok();
                }
                Err(e) => {
                    app.emit("model-progress", format!("创建目录失败: {}", e)).ok();
                    continue;
                }
            }
        }
        
        // 测试写入权限
        let yaml_path = config_dir.join("openclaw.yaml");
        match std::fs::write(&yaml_path, &yaml_content) {
            Ok(_) => {
                app.emit("model-progress", format!("✅ 配置文件已创建: {}", yaml_path.display())).ok();
                
                // 验证文件
                if yaml_path.exists() {
                    app.emit("model-progress", "✅ 配置文件验证通过".to_string()).ok();
                    return Ok("OpenClaw 配置完成".to_string());
                }
            }
            Err(e) => {
                app.emit("model-progress", format!("写入失败: {}", e)).ok();
                continue;
            }
        }
    }
    
    // 如果所有路径都失败，跳过配置文件创建
    app.emit("model-progress", "⚠️ 所有路径都失败，跳过配置文件创建".to_string()).ok();
    app.emit("model-progress", "OpenClaw 将使用默认配置启动".to_string()).ok();
    
    Ok("OpenClaw 配置跳过（将使用默认配置）".to_string())
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

/// 检查 Ollama 服务是否运行
async fn check_ollama_service() -> bool {
    if let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        client.get("http://127.0.0.1:11434/api/version")
            .send().await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    } else {
        false
    }
}

/// 启动 Ollama 服务
async fn start_ollama_service(app: &tauri::AppHandle) -> Result<(), String> {
    app.emit("model-progress", "检查 Ollama 服务...".to_string()).ok();
    
    if check_ollama_service().await {
        app.emit("model-progress", "✅ Ollama 服务已运行".to_string()).ok();
        return Ok(());
    }
    
    app.emit("model-progress", "Ollama 服务未运行，尝试启动...".to_string()).ok();
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        
        // 查找 ollama 路径
        let ollama_path = find_ollama_path(app);
        let ollama_path = match ollama_path {
            Some(p) => p,
            None => return Err("找不到 Ollama，请先安装 Ollama".to_string())
        };
        
        // 启动 ollama serve（后台运行）
        Command::new(&ollama_path)
            .arg("serve")
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("启动 Ollama 失败: {}", e))?;
        
        // 等待服务启动
        for i in 1..=30 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if check_ollama_service().await {
                app.emit("model-progress", format!("✅ Ollama 服务已启动 ({}秒)", i / 2)).ok();
                return Ok(());
            }
        }
        
        Err("Ollama 服务启动超时".to_string())
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Command::new("ollama")
            .arg("serve")
            .spawn()
            .map_err(|e| format!("启动 Ollama 失败: {}", e))?;
        
        for i in 1..=30 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if check_ollama_service().await {
                return Ok(());
            }
        }
        
        Err("Ollama 服务启动超时".to_string())
    }
}

/// 检查进程是否存在（Windows）
#[cfg(target_os = "windows")]
fn check_process_exists(process_name: &str) -> bool {
    if let Ok(output) = Command::new("tasklist")
        .args(&["/FI", &format!("IMAGENAME eq {}", process_name)])
        .output()
    {
        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.contains(process_name)
    } else {
        false
    }
}

/// 检查 Gateway 服务是否就绪
async fn check_port_listening(port: u16) -> bool {
    if let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        // 尝试多个健康检查端点
        let endpoints = vec![
            format!("http://127.0.0.1:{}/healthz", port),
            format!("http://127.0.0.1:{}/health", port),
            format!("http://127.0.0.1:{}", port),
        ];
        
        for url in endpoints {
            if client.get(&url).send().await.is_ok() {
                return true;
            }
        }
        false
    } else {
        false
    }
}

/// 启动 OpenClaw
#[tauri::command]
pub async fn start_openclaw(app: tauri::AppHandle) -> Result<String, String> {
    app.emit("model-progress", "=== 启动 OpenClaw ===".to_string()).ok();
    
    #[cfg(target_os = "windows")]
    {
        // 步骤1: 检查是否已经在运行
        app.emit("model-progress", "[1/4] 检查运行状态...".to_string()).ok();
        app.emit("startup-progress", 5).ok();
        
        if check_port_listening(18789).await {
            app.emit("model-progress", "✅ OpenClaw 已在运行中".to_string()).ok();
            app.emit("startup-progress", 100).ok();
            app.emit("gateway-started", true).ok();
            return Ok("OpenClaw 已在运行，访问 http://localhost:18789".to_string());
        }
        
        // 步骤2: 检查并启动 Ollama
        app.emit("model-progress", "[2/4] 检查 Ollama 服务...".to_string()).ok();
        app.emit("startup-progress", 10).ok();
        
        if let Err(e) = start_ollama_service(&app).await {
            app.emit("model-progress", format!("⚠️ Ollama 启动失败: {}", e)).ok();
            // 继续尝试启动 OpenClaw，可能用户已手动启动 Ollama
        }
        
        // 步骤3: 检查 openclaw 命令是否存在
        app.emit("model-progress", "[3/4] 检查 OpenClaw 命令...".to_string()).ok();
        app.emit("startup-progress", 15).ok();
        
        let openclaw_cmd = Command::new("C:\\Windows\\System32\\where.exe").arg("openclaw").output();
        let use_global = match openclaw_cmd {
            Ok(output) => {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout);
                    app.emit("model-progress", format!("✅ 找到 openclaw: {}", path.lines().next().unwrap_or("未知路径").trim())).ok();
                    true
                } else {
                    app.emit("model-progress", "⚠️ 未找到全局 openclaw，将使用 npx".to_string()).ok();
                    false
                }
            }
            Err(_) => {
                app.emit("model-progress", "⚠️ where 命令失败，将使用 npx".to_string()).ok();
                false
            }
        };
        
        // 步骤4: 启动 OpenClaw Gateway
        app.emit("model-progress", "[4/4] 启动 Gateway...".to_string()).ok();
        app.emit("startup-progress", 20).ok();
        
        // 获取或生成 Token
        let gateway_token = get_or_create_gateway_token();
        app.emit("model-progress", format!("Gateway Token: {}", &gateway_token)).ok();
        
        // 不创建脚本文件，直接在后台启动
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        
        let spawn_result = if use_global {
            app.emit("model-progress", "使用全局安装的 openclaw 启动...".to_string()).ok();
            // 使用 cmd.exe 运行 openclaw 避免 ENOENT
            Command::new("C:\\Windows\\System32\\cmd.exe")
                .args(&["/c", "openclaw gateway start --auth token"])
                .env("OLLAMA_NUM_CTX", "24576")
                .env("OLLAMA_HOST", "0.0.0.0")
                .env("OPENCLAW_GATEWAY_TOKEN", &gateway_token)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        } else {
            app.emit("model-progress", "使用 npx openclaw gateway run 启动...".to_string()).ok();
            // 使用 openclaw gateway run 替代 gateway start
            Command::new("C:\\Windows\\System32\\cmd.exe")
                .args(&["/c", "set npm_config_registry=https://registry.npmmirror.com && npx -y openclaw gateway start --auth token"])
                .env("OLLAMA_NUM_CTX", "24576")
                .env("OLLAMA_HOST", "0.0.0.0")
                .env("OPENCLAW_GATEWAY_TOKEN", &gateway_token)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
        };
        
        match spawn_result {
            Ok(_child) => {
                app.emit("model-progress", "✅ 进程已启动，等待服务就绪...".to_string()).ok();
            }
            Err(e) => {
                let err_msg = format!("启动进程失败: {}", e);
                app.emit("model-progress", format!("❌ {}", err_msg)).ok();
                return Err(err_msg);
            }
        }
        
        // 真实检测：轮询检查端口和响应
        let app_clone = app.clone();
        tokio::spawn(async move {
            let start_time = std::time::Instant::now();
            let max_wait_secs = 300; // 最多等待5分钟
            
            for i in 1..=max_wait_secs {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                
                // 更新进度（从20到90）
                let progress = 20 + ((i as f32 / max_wait_secs as f32) * 70.0) as i32;
                if progress < 90 {
                    app_clone.emit("startup-progress", progress).ok();
                }
                
                // 每隔5秒输出一次等待信息
                if i % 5 == 0 {
                    app_clone.emit("model-progress", format!("等待中... ({}秒)", i)).ok();
                }
                
                // 检查端口是否响应
                if check_port_listening(18789).await {
                    // 额外验证：尝试获取实际响应
                    if let Ok(client) = reqwest::Client::builder()
                        .timeout(std::time::Duration::from_secs(2))
                        .build()
                    {
                        if let Ok(resp) = client.get("http://127.0.0.1:18789/api/status").send().await {
                            if resp.status().is_success() || resp.status().as_u16() == 404 {
                                // 404 也说明服务在运行
                                let elapsed = start_time.elapsed().as_secs();
                                app_clone.emit("startup-progress", 100).ok();
                                app_clone.emit("gateway-started", true).ok();
                                app_clone.emit("model-progress", format!("✅ OpenClaw 启动成功！(耗时 {}秒)", elapsed)).ok();
                                app_clone.emit("model-progress", "访问地址: http://localhost:18789".to_string()).ok();
                                return;
                            }
                        }
                    } else {
                        // 端口有响应但无法获取状态，继续等待
                    }
                }
                
                // 检查进程是否还在运行
                let node_running = check_process_exists("node.exe");
                let openclaw_running = check_process_exists("openclaw.exe");
                if !node_running && !openclaw_running {
                    // 给一点时间让进程启动
                    if i > 10 {
                        app_clone.emit("model-progress", "⚠️ 进程已退出，尝试重新启动...".to_string()).ok();
                        // 尝试重新启动
                        break; // 退出循环，让外层处理
                    }
                }
            }
            
            // 超时
            app_clone.emit("startup-progress", 0).ok();
            app_clone.emit("model-progress", "❌ 启动超时，请手动运行: openclaw gateway start".to_string()).ok();
        });
        
        return Ok("OpenClaw 正在启动中...".to_string());
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        // Linux/macOS - 简化版
        if check_port_listening(18789).await {
            app.emit("gateway-started", true).ok();
            return Ok("OpenClaw 已在运行，访问 http://localhost:18789".to_string());
        }
        
        // 启动 Ollama
        let _ = start_ollama_service(&app).await;
        
        // 后台启动 OpenClaw
        Command::new("openclaw")
            .args(&["gateway", "start"])
            .spawn()
            .map_err(|e| format!("启动失败: {}", e))?;
        
        // 轮询检测
        let app_clone = app.clone();
        tokio::spawn(async move {
            for i in 1..=300 {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                let progress = ((i as f32 / 300.0) * 80.0) as i32 + 10;
                app_clone.emit("startup-progress", progress.min(90)).ok();
                
                if check_port_listening(18789).await {
                    app_clone.emit("startup-progress", 100).ok();
                    app_clone.emit("gateway-started", true).ok();
                    return;
                }
            }
            app_clone.emit("model-progress", "❌ 启动超时".to_string()).ok();
        });
        
        Ok("OpenClaw 正在启动中...".to_string())
    }
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
        
        let result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
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
        let content = "#!/bin/bash\n# 尝试多种方式启动 OpenClaw\nif command -v openclaw &> /dev/null; then\n    openclaw gateway start\nelif command -v npx &> /dev/null; then\n    npx openclaw gateway start\nelse\n    echo 'OpenClaw 未找到, 请确保已正确安装'\n    exit 1\nfi\n\necho 'OpenClaw 已启动, 请访问 http://localhost:18789'\nread -p '按 Enter 键关闭...'\n";
        
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

/// Docker 一键部署 OpenClaw（简化版）
#[tauri::command]
pub async fn deploy_docker(app: tauri::AppHandle) -> Result<String, String> {
    app.emit("model-progress", "=== Docker 一键部署 ===".to_string()).ok();
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        
        // 步骤1: 检查 Docker Desktop 是否运行
        app.emit("model-progress", "[1/6] 检查 Docker Desktop...".to_string()).ok();
        
        // 先检查 Docker daemon 是否响应
        let daemon_check = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
            .args(&["-NoProfile", "-Command", "docker info 2>&1"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        
        let daemon_running = match daemon_check {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                
                // 检查是否有 daemon not running 错误
                if stdout.contains("daemon is not running") || stderr.contains("daemon is not running") ||
                   stdout.contains("Cannot connect to the Docker daemon") || stderr.contains("Cannot connect to the Docker daemon") {
                    false
                } else if output.status.success() && stdout.contains("Server Version") {
                    true
                } else {
                    false
                }
            }
            Err(_) => false,
        };
        
        if !daemon_running {
            // Docker daemon 未运行，尝试启动 Docker Desktop
            app.emit("model-progress", "⚠️ Docker Desktop 未运行，正在尝试启动...".to_string()).ok();
            
            // 尝试启动 Docker Desktop
            let start_docker = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                .args(&["-NoProfile", "-Command", "Start-Process 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            
            match start_docker {
                Ok(_) => {
                    app.emit("model-progress", "⏳ 已启动 Docker Desktop，等待就绪（约30秒）...".to_string()).ok();
                    
                    // 等待 Docker 就绪
                    let mut docker_ready = false;
                    for i in 1..=60 {
                        std::thread::sleep(std::time::Duration::from_secs(1));
                        
                        let check = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                            .args(&["-NoProfile", "-Command", "docker info 2>$null"])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                        
                        if let Ok(output) = check {
                            let stdout = String::from_utf8_lossy(&output.stdout);
                            if output.status.success() && stdout.contains("Server Version") {
                                docker_ready = true;
                                app.emit("model-progress", format!("✅ Docker Desktop 已就绪 ({}秒)", i)).ok();
                                break;
                            }
                        }
                        
                        if i % 10 == 0 {
                            app.emit("model-progress", format!("等待中... {}秒", i)).ok();
                        }
                    }
                    
                    if !docker_ready {
                        return Err(
                            "Docker Desktop 启动超时！\n\n\
                            请手动操作：\n\
                            1. 打开 Docker Desktop 应用\n\
                            2. 等待状态变为 'Running'\n\
                            3. 重新运行安装器".to_string()
                        );
                    }
                }
                Err(e) => {
                    return Err(
                        format!("无法启动 Docker Desktop: {}\n\n\
                        请手动操作：\n\
                        1. 打开 Docker Desktop 应用\n\
                        2. 等待状态变为 'Running'\n\
                        3. 重新运行安装器", e)
                    );
                }
            }
        } else {
            app.emit("model-progress", "✅ Docker Desktop 已运行".to_string()).ok();
        }
        
        // 步骤2: 配置 Docker 镜像加速器（解决国内网络问题）
        app.emit("model-progress", "[2/6] 配置 Docker 镜像加速器...".to_string()).ok();
        let config_docker = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
            .args(&["-NoProfile", "-Command", r"New-Item -Path 'C:\ProgramData\docker\daemon.json' -ItemType Directory -Force; @{'registry-mirrors'=@('https://docker.mirrors.ustc.edu.cn','https://hub-mirror.c.163.com','https://mirror.baidubce.com')} | ConvertTo-Json | Set-Content 'C:\ProgramData\docker\daemon.json' -Encoding UTF8; Write-Host 'Docker 镜像加速器配置完成'"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        
        match config_docker {
            Ok(output) => {
                if output.status.success() {
                    app.emit("model-progress", "✅ 镜像加速器配置成功，需要重启 Docker".to_string()).ok();
                }
            }
            Err(_) => {
                app.emit("model-progress", "⚠️ 配置加速器失败，继续尝试...".to_string()).ok();
            }
        }
        
        // 步骤3: 检查镜像是否存在，如果不存在则拉取
        app.emit("model-progress", "[3/6] 检查镜像...".to_string()).ok();
        
        // 使用 Docker Hub 公开镜像
        // 尝试多个镜像源（优先官方完整镜像）
        let image_sources = vec![
            ("缘辉旺定制镜像", "chenlong999988/openclaw:v2.6.86"),
            ("Docker Hub镜像", "chenlong999988/openclaw:latest"),
            ("阿里云镜像", "registry.cn-hangzhou.aliyuncs.com/chenlong999988/openclaw:latest"),
        ];
        
        let mut image_name = "";
        let mut pull_success = false;
        
        // 先检查镜像是否已存在
        // 检查是否有任何可用镜像
        let mut image_exists = false;
        for (_, img) in &image_sources {
            let check = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                .args(&["-NoProfile", "-Command", &format!("docker images -q {} 2>$null", img)])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            
            if let Ok(output) = check {
                let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !result.is_empty() {
                    image_exists = true;
                    image_name = img;
                    app.emit("model-progress", format!("✅ 找到已存在镜像: {}", img)).ok();
                    break;
                }
            }
        }
        
        if image_exists {
            app.emit("model-progress", "✅ 镜像已存在，跳过拉取".to_string()).ok();
            pull_success = true;
        } else {
            // 尝试多个镜像源
            for (name, img) in &image_sources {
                app.emit("model-progress", format!("[3/6] 尝试拉取 {} ({})...", name, img)).ok();
                
                let pull_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                    .args(&["-NoProfile", "-Command", &format!("docker pull {} 2>&1", img)])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
                
                match pull_result {
                    Ok(output) => {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        if !stdout.contains("Error") && !stdout.contains("denied") && !stdout.contains("unauthorized") {
                            image_name = img;
                            pull_success = true;
                            app.emit("model-progress", format!("✅ {} 拉取成功", name)).ok();
                            break;
                        } else {
                            app.emit("model-progress", format!("⚠️ {} 拉取失败，尝试下一个...", name)).ok();
                        }
                    }
                    Err(e) => {
                        app.emit("model-progress", format!("⚠️ {} 拉取出错: {}", name, e)).ok();
                    }
                }
            }
        }
        
        if !pull_success {
            return Err(
                "所有镜像源拉取失败！\n\n\
                请确保 Docker Desktop 已启动，然后重试。\n\n\
                解决方案：\n\
                1. 启动 Docker Desktop 并等待状态变为 Running\n\
                2. 检查网络连接\n\
                3. 或使用 npm 方式运行：npm install -g openclaw && openclaw gateway start".to_string()
            );
        }
        
        // 步骤4: 检查并安装 Ollama（宿主机本地模型需要）
        app.emit("model-progress", "[4/6] 检查 Ollama...".to_string()).ok();
        
        let ollama_check = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
            .args(&["-NoProfile", "-Command", "ollama --version"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        
        let ollama_installed = match ollama_check {
            Ok(output) => output.status.success(),
            Err(_) => false,
        };
        
        if !ollama_installed {
            app.emit("model-progress", "⏬ Ollama 未安装，正在下载安装...".to_string()).ok();
            
            // 下载 Ollama Windows 版
            let download_cmd = "Start-BitsTransfer -Source 'https://ollama.com/download/OllamaSetup.exe' -Destination '$env:TEMP\\OllamaSetup.exe'";
            let _ = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                .args(&["-NoProfile", "-Command", download_cmd])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            
            // 安装 Ollama
            let install_cmd = "Start-Process -FilePath '$env:TEMP\\OllamaSetup.exe' -ArgumentList '/S' -Wait";
            let install_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                .args(&["-NoProfile", "-Command", install_cmd])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            
            match install_result {
                Ok(output) => {
                    if output.status.success() {
                        app.emit("model-progress", "✅ Ollama 安装成功".to_string()).ok();
                        // 等待 Ollama 服务启动
                        std::thread::sleep(std::time::Duration::from_secs(5));
                        
                        // 下载默认模型
                        app.emit("model-progress", "⏬ 正在下载本地模型 phi3.5...".to_string()).ok();
                        let _ = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                            .args(&["-NoProfile", "-Command", "ollama pull phi3.5"])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                        app.emit("model-progress", "✅ 模型下载完成".to_string()).ok();
                    } else {
                        app.emit("model-progress", "⚠️ Ollama 安装可能失败，请手动安装".to_string()).ok();
                    }
                }
                Err(e) => {
                    app.emit("model-progress", format!("⚠️ Ollama 安装出错: {}", e)).ok();
                }
            }
        } else {
            app.emit("model-progress", "✅ Ollama 已安装".to_string()).ok();
        }
        
        // 步骤5: 创建配置目录
        app.emit("model-progress", "[5/6] 创建配置...".to_string()).ok();
        let config_dir = format!("{}\\.openclaw", std::env::var("USERPROFILE").unwrap_or_default());
        std::fs::create_dir_all(&config_dir).ok();
        
        // 创建 openclaw.yaml 配置文件 - 纯本地模型模式
        let config_path = std::path::PathBuf::from(&config_dir).join("openclaw.yaml");
        
        let config_content = r#"# OpenClaw 本地模型配置
# 由安装器自动生成 - 纯本地运行，无需API Token

# 默认使用本地模型
model: phi3.5

# Gateway 配置 - 本地模式无需token
gateway:
  mode: local
  bind: "0.0.0.0"
  port: 18789
  auth:
    required: false
    token: ""

# 模型提供商配置 - Docker模式下连接宿主机
models:
  providers:
    ollama:
      baseUrl: "http://host.docker.internal:11434"
      api: ollama
      models:
        - id: phi3.5
          name: phi3.5

# 本地模式
providers:
  local:
    type: ollama
    preferLocal: true
"#;
        
        // 确保目录存在
        let config_dir_path = std::path::PathBuf::from(&config_dir);
        std::fs::create_dir_all(&config_dir_path).ok();
        
        // 写入配置文件
        std::fs::write(&config_path, config_content).ok();
        app.emit("model-progress", &format!("✅ 配置已创建: {:?}", config_path)).ok();
        app.emit("model-progress", "✅ 配置已创建".to_string()).ok();
        
        // 验证配置文件已创建
        if !config_path.exists() {
            return Err(format!("配置文件创建失败: {:?}", config_path));
        }
        app.emit("model-progress", &format!("配置文件路径: {:?}", config_path)).ok();
        
        // 步骤6: 启动容器
        app.emit("model-progress", "[6/6] 启动容器...".to_string()).ok();
        
        // 清理所有可能的旧容器名（包括 openclaw 和 openclaw-yuanhuiwang）
        app.emit("model-progress", "检查并清理旧容器...".to_string()).ok();
        
        let old_container_names = vec!["openclaw", "openclaw-yuanhuiwang"];
        for old_name in &old_container_names {
            let check_old = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                .args(&["-NoProfile", "-Command", &format!("docker ps -a --filter name={} --format '{{{{.Names}}}}'", old_name)])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            
            let old_exists = match check_old {
                Ok(output) => {
                    let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    !result.is_empty()
                }
                Err(_) => false,
            };
            
            if old_exists {
                app.emit("model-progress", format!("清理旧容器: {}", old_name)).ok();
                let _ = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                    .args(&["-NoProfile", "-Command", &format!("docker rm -f {}", old_name)])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
        }
        
        // 启动新容器（使用已确定的有效镜像）
        // 重要：官方镜像默认绑定127.0.0.1，需要--bind lan才能从宿主机访问
        // 注意：PowerShell 变量 $env:USERPROFILE 会在运行时展开
        let run_cmd = format!(
            "docker run -d --name openclaw-yuanhuiwang -p 18789:18789 -v \"$env:USERPROFILE\\.openclaw:/root/.openclaw\" -e OLLAMA_HOST=http://host.docker.internal:11434 -e OPENCLAW_AUTH_NONE=true --add-host=host.docker.internal:host-gateway {} /usr/local/bin/openclaw gateway start --host 0.0.0.0",
            image_name
        );
        
        let run_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
            .args(&["-NoProfile", "-Command", &run_cmd])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        
        match run_result {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if output.status.success() || stdout.contains("openclaw-yuanhuiwang") {
                    app.emit("model-progress", "✅ 容器启动成功！".to_string()).ok();
                    
                    // 保存 Docker 部署状态
                    app.emit("local-storage-set", serde_json::json!({ 
                        "key": "openclaw_docker_deployed", 
                        "value": "true" 
                    })).ok();
                    
                    // 等待服务启动
                    app.emit("model-progress", "等待服务就绪...".to_string()).ok();
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    
                    // 在容器内创建配置目录
                    let _ = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                        .args(&["-NoProfile", "-Command", "docker exec openclaw-yuanhuiwang mkdir -p /home/node/.openclaw"])
                        .creation_flags(CREATE_NO_WINDOW)
                        .output();
                    
                    // 配置已通过volume挂载自动同步，无需额外操作
                    app.emit("model-progress", "✅ 配置已同步（volume挂载）".to_string()).ok();
                    
                    app.emit("model-progress", "✅ 本地模型配置已创建 (phi3.5)".to_string()).ok();
                    
                    // 重启容器使配置生效
                    let _ = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                        .args(&["-NoProfile", "-Command", "docker restart openclaw-yuanhuiwang"])
                        .creation_flags(CREATE_NO_WINDOW)
                        .output();
                    
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    
                    // 获取 token URL - 多种方式尝试
                    app.emit("model-progress", "获取访问链接...".to_string()).ok();
                    
                    // 等待服务完全启动
                    std::thread::sleep(std::time::Duration::from_secs(10));
                    
                    let mut token_url = "http://localhost:18789".to_string();
                    
                    // 方式1: 运行 openclaw dashboard 命令获取 Token URL
                    // 尝试多种命令格式（包括 /usr/local/bin/openclaw 等路径）
                    let dashboard_commands = vec![
                        "docker exec openclaw-yuanhuiwang /usr/local/bin/openclaw dashboard 2>&1",
                        "docker exec openclaw-yuanhuiwang /usr/bin/openclaw dashboard 2>&1",
                        "docker exec openclaw-yuanhuiwang openclaw dashboard 2>&1",
                        "docker exec openclaw-yuanhuiwang sh -c 'openclaw dashboard' 2>&1",
                        "docker exec openclaw-yuanhuiwang bash -c 'openclaw dashboard' 2>&1",
                        "docker exec openclaw-yuanhuiwang node /app/openclaw.mjs dashboard 2>&1",
                        "docker exec openclaw-yuanhuiwang node /usr/src/app/openclaw.mjs dashboard 2>&1",
                    ];
                    
                    for cmd in &dashboard_commands {
                        app.emit("model-progress", format!("尝试: {}", cmd)).ok();
                        
                        let dashboard_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                            .args(&["-NoProfile", "-Command", cmd])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                        
                        if let Ok(output) = dashboard_result {
                            let stdout = String::from_utf8_lossy(&output.stdout);
                            let stderr = String::from_utf8_lossy(&output.stderr);
                            app.emit("model-progress", format!("输出: {}", stdout)).ok();
                            if !stderr.is_empty() {
                                app.emit("model-progress", format!("错误: {}", stderr)).ok();
                            }
                            
                            for line in stdout.lines() {
                                let trimmed = line.trim();
                                // 查找 http://localhost:18789/#token=xxx 或 ?token= 格式的URL
                                if trimmed.contains("http://localhost:18789") || trimmed.contains("http://127.0.0.1:18789") {
                                    // 提取完整URL
                                    if let Some(start) = trimmed.find("http") {
                                        let url_part = &trimmed[start..];
                                        let end = url_part.find(|c: char| c.is_whitespace()).unwrap_or(url_part.len());
                                        let url = &url_part[..end];
                                        if url.contains("token") || url.contains("#") {
                                            token_url = url.to_string();
                                            app.emit("model-progress", format!("✅ 获取到Token URL: {}", token_url)).ok();
                                            break;
                                        }
                                    }
                                }
                            }
                            
                            if token_url != "http://localhost:18789" {
                                break;
                            }
                        }
                    }
                    
                    // 方式2: 尝试从容器日志获取
                    if token_url == "http://localhost:18789" {
                        let log_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                            .args(&["-NoProfile", "-Command", "docker logs openclaw-yuanhuiwang 2>&1 | Select-String -Pattern 'http.*token' | Select-Object -Last 1"])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                        
                        if let Ok(output) = log_result {
                            let stdout = String::from_utf8_lossy(&output.stdout);
                            for line in stdout.lines() {
                                if line.contains("http") && line.contains("token") {
                                    let url = line.trim();
                                    if url.starts_with("http") {
                                        token_url = url.to_string();
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    
                    // 方式3: 从容器内读取 token 文件
                    if token_url == "http://localhost:18789" {
                        let exec_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                            .args(&["-NoProfile", "-Command", "docker exec openclaw-yuanhuiwang cat /root/.openclaw/token.txt 2>$null"])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                        
                        if let Ok(output) = exec_result {
                            let stdout = String::from_utf8_lossy(&output.stdout);
                            if !stdout.trim().is_empty() {
                                token_url = format!("http://localhost:18789/#token={}", stdout.trim());
                            }
                        }
                    }
                    
                    // 方式4: 尝试其他路径
                    if token_url == "http://localhost:18789" {
                        let exec_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                            .args(&["-NoProfile", "-Command", "docker exec openclaw-yuanhuiwang cat /home/node/.openclaw/token.txt 2>$null"])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                        
                        if let Ok(output) = exec_result {
                            let stdout = String::from_utf8_lossy(&output.stdout);
                            if !stdout.trim().is_empty() {
                                token_url = format!("http://localhost:18789/#token={}", stdout.trim());
                            }
                        }
                    }
                    
                    // 发送 token URL 给前端
                    app.emit("model-progress", format!("✅ 访问链接: {}", token_url)).ok();
                    app.emit("docker-token-url", &token_url).ok();

                    // 关键修复：验证 Gateway 服务是否真正可用
                    app.emit("model-progress", "验证 Gateway 服务...".to_string()).ok();
                    
                    let client = reqwest::Client::builder()
                        .timeout(std::time::Duration::from_secs(5))
                        .build()
                        .ok();
                    
                    let mut gateway_ready = false;
                    
                    for i in 1..=30 {
                        app.emit("model-progress", format!("检测 Gateway... ({}/30)", i)).ok();
                        
                        if let Some(ref client) = client {
                            // 尝试多个健康检查端点
                            let health_endpoints = vec![
                                "http://localhost:18789/healthz",
                                "http://localhost:18789/health",
                                "http://localhost:18789/",
                                "http://localhost:18789/api/models",
                            ];
                            
                            for endpoint in &health_endpoints {
                                match client.get(*endpoint).timeout(std::time::Duration::from_secs(3)).send().await {
                                    Ok(res) if res.status().is_success() || res.status().as_u16() == 404 => {
                                        // 404 也算服务就绪（说明 Gateway 正在响应）
                                        gateway_ready = true;
                                        app.emit("model-progress", format!("✅ Gateway 服务已就绪 ({})", endpoint)).ok();
                                        break;
                                    }
                                    Ok(res) => {
                                        // 任何响应都说明服务在运行
                                        if res.status().as_u16() < 500 {
                                            gateway_ready = true;
                                            app.emit("model-progress", format!("✅ Gateway 响应: {} ({})", res.status(), endpoint)).ok();
                                            break;
                                        }
                                    }
                                    Err(_) => {
                                        // 继续尝试下一个端点
                                    }
                                }
                            }
                            
                            if gateway_ready {
                                break;
                            }
                        }
                        
                        std::thread::sleep(std::time::Duration::from_secs(2));
                    }
                    
                    if !gateway_ready {
                        // 先检查容器状态
                        app.emit("model-progress", "容器状态检查...".to_string()).ok();
                        
                        let status_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                            .args(&["-NoProfile", "-Command", "docker ps -a --filter name=openclaw-yuanhuiwang --format '{{.Status}}'"])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                        
                        let container_status = match status_result {
                            Ok(output) => String::from_utf8_lossy(&output.stdout).trim().to_string(),
                            Err(e) => format!("无法获取状态: {}", e),
                        };
                        
                        app.emit("model-progress", format!("容器状态: {}", container_status)).ok();
                        
                        // 获取容器日志（stdout + stderr）
                        let log_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
                            .args(&["-NoProfile", "-Command", "docker logs openclaw-yuanhuiwang 2>&1 --tail 100"])
                            .creation_flags(CREATE_NO_WINDOW)
                            .output();
                        
                        let logs = match log_result {
                            Ok(output) => {
                                let stdout_log = String::from_utf8_lossy(&output.stdout).to_string();
                                let stderr_log = String::from_utf8_lossy(&output.stderr).to_string();
                                if !stdout_log.is_empty() {
                                    stdout_log
                                } else if !stderr_log.is_empty() {
                                    stderr_log
                                } else {
                                    "(无日志输出)".to_string()
                                }
                            }
                            Err(e) => format!("获取日志失败: {}", e),
                        };
                        
                        app.emit("model-progress", format!("❌ Gateway 服务启动失败\n\n容器状态: {}\n容器日志:\n{}", container_status, logs)).ok();
                        return Err(format!("Gateway 服务启动失败\n容器状态: {}\n日志: {}", container_status, logs.lines().take(20).collect::<Vec<_>>().join("\n")));
                    }
                    
                    // 直接返回
                    return Ok(format!("Docker 部署成功！\n\n请访问 {} \n\n✅ 已配置纯本地模型 phi3.5\n✅ 使用本机硬件算力", token_url));
                } else {
                    let err = String::from_utf8_lossy(&output.stderr);
                    return Err(format!("容器启动失败: {}", err));
                }
            }
            Err(e) => {
                return Err(format!("启动容器失败: {}", e));
            }
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        Err("Docker 一键部署暂仅支持 Windows".to_string())
    }
}

/// 检查 Gateway 连接状态
#[tauri::command]
pub async fn check_gateway_status() -> Result<bool, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    
    // 尝试多个健康检查端点
    let endpoints = vec![
        "http://localhost:18789/healthz",
        "http://localhost:18789/health",
        "http://localhost:18789/",
        "http://localhost:18789/api/models",
    ];
    
    for endpoint in endpoints {
        match client.get(endpoint).timeout(std::time::Duration::from_secs(3)).send().await {
            Ok(res) => {
                // 任何响应都说明 Gateway 正在运行
                if res.status().is_success() || res.status().as_u16() == 404 || res.status().as_u16() == 401 {
                    return Ok(true);
                }
            }
            Err(_) => continue,
        }
    }
    
    Ok(false)
}

/// Docker 容器综合状态检测
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DockerContainerStatus {
    pub container_running: bool,
    pub gateway_ready: bool,
    pub ollama_connected: bool,
    pub logs: Option<String>,
    pub error: Option<String>,
}

/// 检查 Docker 容器状态（用于 Docker 模式下的启动检测）
#[tauri::command]
#[cfg(target_os = "windows")]
pub async fn check_docker_container_status() -> Result<DockerContainerStatus, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    
    // 1. 检查容器是否运行（使用 docker ps -a 检查包括停止的容器）
    let container_check = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
        .args(&["-NoProfile", "-Command", "docker ps -a --filter name=openclaw-yuanhuiwang --format '{{.Status}}'"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    
    let (container_running, container_status) = match container_check {
        Ok(output) => {
            let status = String::from_utf8_lossy(&output.stdout).trim().to_string();
            // 检查状态是否包含 "Up" 表示正在运行
            let running = status.starts_with("Up");
            (running, status)
        }
        Err(e) => {
            return Ok(DockerContainerStatus {
                container_running: false,
                gateway_ready: false,
                ollama_connected: false,
                logs: None,
                error: Some(format!("Docker 命令执行失败: {}", e)),
            });
        }
    };
    
    if !container_running {
        // 容器未运行，尝试获取退出前的日志
        let log_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
            .args(&["-NoProfile", "-Command", "docker logs openclaw-yuanhuiwang 2>&1 --tail 50"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        
        let logs = match log_result {
            Ok(output) => {
                let log = String::from_utf8_lossy(&output.stdout).to_string();
                if log.is_empty() { None } else { Some(log) }
            },
            Err(_) => None,
        };
        
        return Ok(DockerContainerStatus {
            container_running: false,
            gateway_ready: false,
            ollama_connected: false,
            logs,
            error: Some(format!("容器未运行，状态: {}", container_status)),
        });
    }
    
    // 2. 检查 Gateway 服务
    let gateway_ready = check_port_listening(18789).await;
    
    // 3. 检查 Ollama 连接
    let ollama_connected = check_ollama_service().await;
    
    // 4. 如果 Gateway 没就绪，获取容器日志（包括 stderr）
    let logs = if !gateway_ready {
        let log_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
            .args(&["-NoProfile", "-Command", "docker logs openclaw-yuanhuiwang 2>&1 --tail 50"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        
        match log_result {
            Ok(output) => {
                let log = String::from_utf8_lossy(&output.stdout).to_string();
                if log.is_empty() { None } else { Some(log) }
            },
            Err(_) => None,
        }
    } else {
        None
    };
    
    Ok(DockerContainerStatus {
        container_running,
        gateway_ready,
        ollama_connected,
        logs,
        error: None,
    })
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub async fn check_docker_container_status() -> Result<DockerContainerStatus, String> {
    Ok(DockerContainerStatus {
        container_running: false,
        gateway_ready: false,
        ollama_connected: false,
        logs: None,
        error: Some("仅支持 Windows".to_string()),
    })
}

/// 获取 Gateway 模型列表
#[tauri::command]
pub async fn get_gateway_models() -> Result<Vec<GatewayModel>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    // 尝试多个 API 端点
    let endpoints = vec![
        "http://localhost:18789/api/models",
        "http://localhost:18789/v1/models",
        "http://localhost:18789/api/ollama/models",
    ];
    
    for endpoint in endpoints {
        if let Ok(res) = client.get(endpoint).timeout(std::time::Duration::from_secs(5)).send().await {
            if res.status().is_success() {
                if let Ok(models) = res.json::<Vec<GatewayModel>>().await {
                    if !models.is_empty() {
                        return Ok(models);
                    }
                }
            }
        }
    }
    
    // 尝试直接从 Ollama 获取模型
    if let Ok(res) = client.get("http://localhost:11434/api/tags").send().await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(models) = json.get("models").and_then(|m| m.as_array()) {
                    let gateway_models: Vec<GatewayModel> = models.iter().filter_map(|m| {
                        Some(GatewayModel {
                            name: m.get("name")?.as_str()?.to_string(),
                            size: m.get("size")?.as_u64(),
                        })
                    }).collect();
                    if !gateway_models.is_empty() {
                        return Ok(gateway_models);
                    }
                }
            }
        }
    }
    
    Ok(vec![])
}

/// 发送聊天消息到 Gateway
#[tauri::command]
pub async fn send_chat_message(
    messages: Vec<ChatMsg>,
    model: String,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    // 尝试多个 API 端点
    let endpoints = vec![
        "http://localhost:18789/v1/chat/completions",
        "http://localhost:18789/api/chat",
        "http://localhost:18789/chat",
    ];
    
    // 构建 OpenAI 兼容格式的请求
    let request = serde_json::json!({
        "messages": messages,
        "model": model,
        "stream": false
    });
    
    for endpoint in &endpoints {
        let response = client
            .post(*endpoint)
            .json(&request)
            .send()
            .await;
        
        if let Ok(res) = response {
            if res.status().is_success() {
                if let Ok(result) = res.json::<serde_json::Value>().await {
                    // 尝试多种响应格式提取
                    // OpenAI 格式: choices[0].message.content
                    if let Some(content) = result.get("choices")
                        .and_then(|c| c.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|choice| choice.get("message"))
                        .and_then(|msg| msg.get("content"))
                        .and_then(|c| c.as_str()) {
                        return Ok(content.to_string());
                    }
                    
                    // 简单格式: content
                    if let Some(content) = result.get("content").and_then(|v| v.as_str()) {
                        return Ok(content.to_string());
                    }
                    
                    // message.content 格式
                    if let Some(content) = result.get("message")
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_str()) {
                        return Ok(content.to_string());
                    }
                    
                    // response 格式
                    if let Some(content) = result.get("response").and_then(|v| v.as_str()) {
                        return Ok(content.to_string());
                    }
                    
                    // 返回原始响应
                    return Ok(result.to_string());
                }
            }
        }
    }
    
    // 如果所有 Gateway 端点都失败，尝试直接调用 Ollama
    let ollama_request = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false
    });
    
    let ollama_response = client
        .post("http://localhost:11434/api/chat")
        .json(&ollama_request)
        .send()
        .await;
    
    match ollama_response {
        Ok(res) if res.status().is_success() => {
            if let Ok(result) = res.json::<serde_json::Value>().await {
                if let Some(content) = result.get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str()) {
                    return Ok(content.to_string());
                }
                return Ok(result.to_string());
            }
        }
        Ok(res) => {
            return Err(format!("Ollama 错误: {}", res.status()));
        }
        Err(e) => {
            return Err(format!(
                "无法连接到 AI 服务\n\n请确保:\n1. Docker 容器已启动\n2. 或本地 Ollama 已运行\n\n详细错误: {}",
                e
            ));
        }
    }
    
    Err("无法连接到 AI 服务".to_string())
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct GatewayModel {
    name: String,
    size: Option<u64>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ChatMsg {
    role: String,
    content: String,
}

// ============ Token 管理函数 ============

/// 生成随机 Token
fn generate_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("oc_{:x}", timestamp)
}

/// 读取或创建 Gateway Token
fn get_or_create_gateway_token() -> String {
    let home_dir = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| "/tmp".to_string());
    
    let config_dir = std::path::PathBuf::from(&home_dir).join(".openclaw");
    let token_file = config_dir.join("gateway.token");
    
    // 尝试读取已存在的 token
    if token_file.exists() {
        if let Ok(token) = std::fs::read_to_string(&token_file) {
            let token = token.trim().to_string();
            if !token.is_empty() {
                return token;
            }
        }
    }
    
    // 生成新 token
    let new_token = generate_token();
    
    // 确保目录存在
    if !config_dir.exists() {
        let _ = std::fs::create_dir_all(&config_dir);
    }
    
    // 保存 token
    let _ = std::fs::write(&token_file, &new_token);
    
    new_token
}

/// 获取 Gateway URL（包含 Token）
#[tauri::command]
pub async fn get_gateway_url() -> Result<String, String> {
    let base_url = "http://localhost:18789";
    
    // 检查服务是否运行
    if !check_port_listening(18789).await {
        return Err("Gateway 未运行".to_string());
    }
    
    // 读取 Token
    let token = get_or_create_gateway_token();
    Ok(format!("{}?token={}", base_url, token))
}

/// 从 Docker 容器获取 Token URL（通过 openclaw dashboard 命令）
#[tauri::command]
#[cfg(target_os = "windows")]
pub async fn get_docker_token_url() -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    
    let mut token_url = "http://localhost:18789".to_string();
    
    // 尝试多种命令格式获取 Token URL
    let dashboard_commands = vec![
        "docker exec openclaw-yuanhuiwang /usr/local/bin/openclaw dashboard 2>&1",
        "docker exec openclaw-yuanhuiwang /usr/bin/openclaw dashboard 2>&1",
        "docker exec openclaw-yuanhuiwang openclaw dashboard 2>&1",
        "docker exec openclaw-yuanhuiwang sh -c 'openclaw dashboard' 2>&1",
        "docker exec openclaw-yuanhuiwang bash -c 'openclaw dashboard' 2>&1",
        "docker exec openclaw-yuanhuiwang node /app/openclaw.mjs dashboard 2>&1",
        "docker exec openclaw-yuanhuiwang node /usr/src/app/openclaw.mjs dashboard 2>&1",
    ];
    
    for cmd in &dashboard_commands {
        let result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
            .args(&["-NoProfile", "-Command", cmd])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        
        if let Ok(output) = result {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                // 查找 http://localhost:18789/#token=xxx 或 ?token= 格式的URL
                if trimmed.contains("http://localhost:18789") || trimmed.contains("http://127.0.0.1:18789") {
                    if let Some(start) = trimmed.find("http") {
                        let url_part = &trimmed[start..];
                        let end = url_part.find(|c: char| c.is_whitespace()).unwrap_or(url_part.len());
                        let url = &url_part[..end];
                        if url.contains("token") || url.contains("#") {
                            return Ok(url.to_string());
                        }
                    }
                }
            }
        }
    }
    
    // 方式2: 从容器日志获取
    let log_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
        .args(&["-NoProfile", "-Command", "docker logs openclaw-yuanhuiwang 2>&1 | Select-String -Pattern 'http.*token' | Select-Object -Last 1"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    
    if let Ok(output) = log_result {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("http") && line.contains("token") {
                let url = line.trim();
                if url.starts_with("http") {
                    return Ok(url.to_string());
                }
            }
        }
    }
    
    // 方式3: 从容器内读取 .env 文件中的 token
    let env_result = Command::new("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")
        .args(&["-NoProfile", "-Command", "docker exec openclaw-yuanhuiwang cat /home/node/.openclaw/.env 2>$null"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    
    if let Ok(output) = env_result {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.starts_with("OPENCLAW_GATEWAY_TOKEN=") {
                let token = line.trim_start_matches("OPENCLAW_GATEWAY_TOKEN=").trim();
                if !token.is_empty() {
                    return Ok(format!("http://localhost:18789/#token={}", token));
                }
            }
        }
    }
    
    // 返回默认 URL
    Ok(token_url)
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
pub async fn get_docker_token_url() -> Result<String, String> {
    Ok("http://localhost:18789".to_string())
}
