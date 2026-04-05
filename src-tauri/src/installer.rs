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
            name: "qwen2.5-coder:7b".to_string(),
            display_name: "Qwen 2.5 Coder 7B".to_string(),
            size_gb: 4.7,
            description: "代码专用模型，适合编程".to_string(),
            min_vram: 6.0,
            min_ram: 16.0,
            recommended: false,
            tags: vec!["代码".to_string()],
        },
        ModelRecommendation {
            name: "qwen2.5-coder:14b".to_string(),
            display_name: "Qwen 2.5 Coder 14B".to_string(),
            size_gb: 9.0,
            description: "代码增强版，复杂编程任务".to_string(),
            min_vram: 12.0,
            min_ram: 32.0,
            recommended: vram_gb >= 12.0 && vram_gb < 24.0,
            tags: vec!["代码".to_string(), "高级".to_string()],
        },
        ModelRecommendation {
            name: "deepseek-r1:8b".to_string(),
            display_name: "DeepSeek R1 8B".to_string(),
            size_gb: 4.9,
            description: "推理增强，逻辑分析强".to_string(),
            min_vram: 6.0,
            min_ram: 16.0,
            recommended: false,
            tags: vec!["推理".to_string()],
        },
        ModelRecommendation {
            name: "deepseek-r1:14b".to_string(),
            display_name: "DeepSeek R1 14B".to_string(),
            size_gb: 9.0,
            description: "深度推理，复杂任务首选".to_string(),
            min_vram: 12.0,
            min_ram: 32.0,
            recommended: vram_gb >= 12.0 && vram_gb < 24.0,
            tags: vec!["推理".to_string(), "高级".to_string()],
        },
        ModelRecommendation {
            name: "glm-4.7-flash".to_string(),
            display_name: "GLM 4.7 Flash".to_string(),
            size_gb: 9.0,
            description: "智谱最新模型，中文首选".to_string(),
            min_vram: 8.0,
            min_ram: 16.0,
            recommended: vram_gb >= 8.0 && vram_gb < 16.0,
            tags: vec!["中文".to_string(), "推荐".to_string()],
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
    
    // 根据硬件过滤
    models.retain(|m| {
        (vram_gb >= m.min_vram || m.min_vram == 0.0) && ram_gb >= m.min_ram
    });
    
    // 确保至少有一个推荐
    if !models.iter().any(|m| m.recommended) && !models.is_empty() {
        models[0].recommended = true;
    }
    
    models
}

// 检查 Ollama 是否已安装
#[tauri::command]
pub async fn check_ollama_installed() -> Result<bool, String> {
    log::info!("开始检测 Ollama 安装状态...");
    
    // 方法1: 检测 Ollama API 是否响应（最可靠）
    log::info!("方法1: 检测 API 端口 http://127.0.0.1:11434/api/version");
    
    // 创建带超时的HTTP客户端
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .danger_accept_invalid_certs(true)
        .build().map_err(|e| e.to_string())?;
    
    match client.get("http://127.0.0.1:11434/api/version").send().await {
        Ok(resp) => {
            if resp.status().is_success() {
                log::info!("✅ API 检测成功: Ollama 服务正在运行");
                return Ok(true);
            } else {
                log::warn!("API 响应状态码: {}", resp.status());
            }
        }
        Err(e) => {
            log::warn!("API 检测失败: {}", e);
        }
    }
    
    // 方法2: 尝试运行 ollama --version
    log::info!("方法2: 尝试运行 ollama --version");
    let output = Command::new("ollama")
        .arg("--version")
        .output();
    
    if let Ok(o) = &output {
        if o.status.success() {
            log::info!("✅ ollama 命令检测成功");
            return Ok(true);
        } else {
            log::warn!("ollama 命令执行失败: {}", String::from_utf8_lossy(&o.stderr));
        }
    }
    
    // Windows 上检查默认安装路径
    #[cfg(target_os = "windows")]
    {
        log::info!("方法3: 检查 Windows 安装路径");
        // 检查常见安装路径（Ollama 实际安装位置）
        let paths = vec![
            std::env::var("LOCALAPPDATA").unwrap_or_default() + "\\Programs\\Ollama\\ollama.exe",
            std::env::var("USERPROFILE").unwrap_or_default() + "\\AppData\\Local\\Programs\\Ollama\\ollama.exe",
            std::env::var("PROGRAMFILES").unwrap_or_default() + "\\Ollama\\ollama.exe",
            std::env::var("PROGRAMFILES(X86)").unwrap_or_default() + "\\Ollama\\ollama.exe",
            "C:\\Program Files\\Ollama\\ollama.exe".to_string(),
            "C:\\Program Files (x86)\\Ollama\\ollama.exe".to_string(),
            "C:\\Users\\Default\\AppData\\Local\\Programs\\Ollama\\ollama.exe".to_string(),
        ];
        
        for path in paths {
            log::debug!("检查路径: {}", path);
            if std::path::Path::new(&path).exists() {
                log::info!("找到 Ollama 文件: {}", path);
                // 尝试运行
                if let Ok(o) = Command::new(&path).arg("--version").output() {
                    if o.status.success() {
                        log::info!("✅ 路径检测成功: {}", path);
                        return Ok(true);
                    }
                }
            }
        }
        
        // 方法4: 尝试通过 where 命令查找
        log::info!("方法4: 使用 where 命令查找");
        if let Ok(where_output) = Command::new("where").arg("ollama").output() {
            if where_output.status.success() {
                let stdout = String::from_utf8_lossy(&where_output.stdout);
                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && std::path::Path::new(trimmed).exists() {
                        log::info!("where 找到: {}", trimmed);
                        if let Ok(o) = Command::new(trimmed).arg("--version").output() {
                            if o.status.success() {
                                log::info!("✅ where 检测成功");
                                return Ok(true);
                            }
                        }
                    }
                }
            }
        }
        
        // 方法5: 检查 Ollama 服务进程是否运行
        log::info!("方法5: 检查进程");
        if let Ok(tasklist) = Command::new("tasklist")
            .args(&["/FI", "IMAGENAME eq ollama.exe", "/NH"])
            .output() 
        {
            let output_str = String::from_utf8_lossy(&tasklist.stdout);
            log::debug!("tasklist 输出: {}", output_str);
            if output_str.contains("ollama.exe") {
                log::info!("✅ 进程检测成功: Ollama 正在运行");
                return Ok(true);
            }
        }
    }
    
    log::warn!("❌ 所有检测方法都失败了，Ollama 未检测到");
    Ok(false)
}

// 安装 Ollama
#[tauri::command]
pub async fn install_ollama(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::path::PathBuf;
        
        // 下载 Ollama 安装程序
        let download_url = "https://ollama.com/download/OllamaSetup.exe";
        let temp_dir = std::env::temp_dir();
        let installer_path = temp_dir.join("OllamaSetup.exe");
        
        // 发送进度事件
        let _ = app.emit("install-progress", "正在下载 Ollama...");
        
        // 使用 PowerShell 下载
        let ps_output = Command::new("powershell")
            .args(&[
                "-Command",
                &format!("Invoke-WebRequest -Uri '{}' -OutFile '{}'", download_url, installer_path.display()),
            ])
            .output().map_err(|e| e.to_string())?;
        
        if !ps_output.status.success() {
            return Err("下载 Ollama 失败".to_string());
        }
        
        let _ = app.emit("install-progress", "正在安装 Ollama...");
        
        // 运行安装程序
        let install_output = Command::new(&installer_path)
            .args(&["/S"])  // 静默安装
            .output().map_err(|e| e.to_string())?;
        
        if !install_output.status.success() {
            return Err("安装 Ollama 失败".to_string());
        }
        
        // 清理安装程序
        let _ = std::fs::remove_file(&installer_path);
        
        let _ = app.emit("install-progress", "Ollama 安装完成");
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        // Linux/macOS 使用官方脚本
        let _ = app.emit("install-progress", "正在安装 Ollama...");
        
        let output = Command::new("sh")
            .arg("-c")
            .arg("curl -fsSL https://ollama.com/install.sh | sh")
            .output().map_err(|e| e.to_string())?;
        
        if !output.status.success() {
            return Err("安装 Ollama 失败".to_string());
        }
    }
    
    Ok(())
}

// 查找 Ollama 可执行文件路径并确保服务运行
#[cfg(target_os = "windows")]
fn find_and_start_ollama() -> Option<String> {
    use std::os::windows::process::CommandExt;
    
    log::info!("开始查找 Ollama 路径...");
    
    // 方法1: 先检查 API 是否响应
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .ok()?;
    
    if client.get("http://127.0.0.1:11434/api/version").send().ok().map(|r| r.status().is_success()).unwrap_or(false) {
        log::info!("✅ API 响应正常，Ollama 服务正在运行");
        return Some("ollama".to_string());
    }
    
    // API 没响应，尝试找到 ollama.exe 并启动服务
    log::info!("API 未响应，尝试找到并启动 Ollama 服务...");
    
    // 检查默认安装路径
    let paths = vec![
        std::env::var("LOCALAPPDATA").unwrap_or_default() + "\\Programs\\Ollama\\ollama.exe",
        std::env::var("USERPROFILE").unwrap_or_default() + "\\AppData\\Local\\Programs\\Ollama\\ollama.exe",
        "C:\\Users\\Default\\AppData\\Local\\Programs\\Ollama\\ollama.exe".to_string(),
        "C:\\Program Files\\Ollama\\ollama.exe".to_string(),
    ];
    
    let mut ollama_path: Option<String> = None;
    
    for path in &paths {
        if std::path::Path::new(path).exists() {
            ollama_path = Some(path.clone());
            break;
        }
    }
    
    // 尝试 where 命令
    if ollama_path.is_none() {
        if let Ok(output) = Command::new("where").arg("ollama").output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(line) = stdout.lines().next() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() && std::path::Path::new(trimmed).exists() {
                        ollama_path = Some(trimmed.to_string());
                    }
                }
            }
        }
    }
    
    // 如果找到了路径，尝试启动 Ollama 服务
    if let Some(ref path) = ollama_path {
        log::info!("找到 Ollama: {}, 尝试启动服务...", path);
        
        // 启动 ollama serve（后台运行，不显示窗口）
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        if let Ok(_child) = Command::new(path)
            .arg("serve")
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            log::info!("已启动 Ollama 服务，等待启动...");
            
            // 等待服务启动
            for i in 1..=10 {
                std::thread::sleep(std::time::Duration::from_millis(500));
                if client.get("http://127.0.0.1:11434/api/version").send().ok().map(|r| r.status().is_success()).unwrap_or(false) {
                    log::info!("✅ Ollama 服务启动成功 (尝试 {} 次)", i);
                    return Some(path.clone());
                }
            }
            
            log::warn!("Ollama 服务启动超时");
        }
    }
    
    // 最后检查进程
    if let Ok(tasklist) = Command::new("tasklist")
        .args(&["/FI", "IMAGENAME eq ollama.exe", "/NH"])
        .output() 
    {
        let output_str = String::from_utf8_lossy(&tasklist.stdout);
        if output_str.contains("ollama.exe") {
            log::info!("进程检测到 ollama.exe 正在运行");
            return Some("ollama".to_string());
        }
    }
    
    log::warn!("❌ 所有方法都无法找到或启动 Ollama");
    None
}

#[cfg(not(target_os = "windows"))]
fn find_and_start_ollama() -> Option<String> {
    // 非 Windows：检查 API，然后尝试启动服务
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .ok()?;
    
    if client.get("http://127.0.0.1:11434/api/version").send().ok().map(|r| r.status().is_success()).unwrap_or(false) {
        return Some("ollama".to_string());
    }
    
    // 尝试启动服务
    if Command::new("ollama").arg("serve").spawn().is_ok() {
        for _ in 1..=10 {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if client.get("http://127.0.0.1:11434/api/version").send().ok().map(|r| r.status().is_success()).unwrap_or(false) {
                return Some("ollama".to_string());
            }
        }
    }
    
    None
}

// 下载模型
#[tauri::command]
pub async fn pull_model(
    model_name: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    
    let _ = app.emit("model-progress", format!("正在下载模型: {}", model_name));
    
    // 查找并启动 Ollama
    let ollama_path = find_and_start_ollama()
        .ok_or("找不到 Ollama，请确保已安装 Ollama。下载地址: https://ollama.com/download".to_string())?;
    
    log::info!("使用 Ollama 路径: {}", ollama_path);
    
    let mut child = Command::new(&ollama_path)
        .args(&["pull", &model_name])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn().map_err(|e| format!("启动下载失败: {}。Ollama 路径: {}", e, ollama_path))?;
    
    let stdout = child.stdout.take().ok_or("无法读取输出".to_string())?;
    let reader = BufReader::new(stdout);
    
    for line in reader.lines() {
        if let Ok(line) = line {
            let _ = app.emit("model-progress", line.clone());
            log::info!("下载进度: {}", line);
        }
    }
    
    let status = child.wait().map_err(|e| format!("等待进程失败: {}", e))?;
    
    if !status.success() {
        return Err("下载模型失败。请检查网络连接，确保 Ollama 服务正在运行。".to_string());
    }
    
    let _ = app.emit("model-progress", "模型下载完成".to_string());
    
    Ok(())
}

// 检查 OpenClaw 是否已安装
#[tauri::command]
pub async fn check_openclaw_installed() -> Result<bool, String> {
    let output = Command::new("openclaw")
        .arg("--version")
        .output();
    
    Ok(output.map(|o| o.status.success()).unwrap_or(false))
}

// 安装 OpenClaw
#[tauri::command]
pub async fn install_openclaw(app: tauri::AppHandle) -> Result<(), String> {
    let _ = app.emit("install-progress", "正在安装 OpenClaw...");
    
    #[cfg(target_os = "windows")]
    {
        // 检查 Node.js
        let node_check = Command::new("node").arg("--version").output();
        
        if node_check.map(|o| !o.status.success()).unwrap_or(true) {
            // 需要先安装 Node.js
            let _ = app.emit("install-progress", "正在安装 Node.js...");
            
            let node_url = "https://nodejs.org/dist/v22.11.0/node-v22.11.0-x64.msi";
            let temp_dir = std::env::temp_dir();
            let installer_path = temp_dir.join("node-installer.msi");
            
            let ps_output = Command::new("powershell")
                .args(&[
                    "-Command",
                    &format!("Invoke-WebRequest -Uri '{}' -OutFile '{}'", node_url, installer_path.display()),
                ])
                .output().map_err(|e| e.to_string())?;
            
            if !ps_output.status.success() {
                return Err("下载 Node.js 失败".to_string());
            }
            
            let install_output = Command::new("msiexec")
                .args(&["/i", &installer_path.display().to_string(), "/quiet", "/norestart"])
                .output().map_err(|e| e.to_string())?;
            
            if !install_output.status.success() {
                return Err("安装 Node.js 失败".to_string());
            }
            
            let _ = std::fs::remove_file(&installer_path);
        }
        
        // 安装 OpenClaw
        let _ = app.emit("install-progress", "正在通过 npm 安装 OpenClaw...");
        
        let npm_output = Command::new("npm")
            .args(&["install", "-g", "openclaw@latest"])
            .output().map_err(|e| e.to_string())?;
        
        if !npm_output.status.success() {
            return Err("安装 OpenClaw 失败".to_string());
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        // Linux/macOS
        let output = Command::new("sh")
            .arg("-c")
            .arg("curl -fsSL https://openclaw.ai/install.sh | sh")
            .output().map_err(|e| e.to_string())?;
        
        if !output.status.success() {
            return Err("安装 OpenClaw 失败".to_string());
        }
    }
    
    let _ = app.emit("install-progress", "OpenClaw 安装完成".to_string());
    
    Ok(())
}

// 配置 OpenClaw 使用本地模型
#[tauri::command]
pub async fn configure_openclaw(model_name: String) -> Result<String, String> {
    let config_dir = dirs::config_dir()
        .ok_or("无法找到配置目录".to_string())?
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
