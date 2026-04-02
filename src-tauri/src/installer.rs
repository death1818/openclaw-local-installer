use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::Manager;
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
pub fn get_recommended_models(vram_gb: f64, ram_gb: f64) -> Vec<ModelRecommendation> {
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
pub async fn check_ollama_installed() -> Result<bool, Box<dyn std::error::Error>> {
    let output = Command::new("ollama")
        .arg("--version")
        .output();
    
    Ok(output.map(|o| o.status.success()).unwrap_or(false))
}

// 安装 Ollama
pub async fn install_ollama(app: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "windows")]
    {
        use std::path::PathBuf;
        
        // 下载 Ollama 安装程序
        let download_url = "https://ollama.com/download/OllamaSetup.exe";
        let temp_dir = std::env::temp_dir();
        let installer_path = temp_dir.join("OllamaSetup.exe");
        
        // 发送进度事件
        app.emit("install-progress", "正在下载 Ollama...")?;
        
        // 使用 PowerShell 下载
        let ps_output = Command::new("powershell")
            .args(&[
                "-Command",
                &format!("Invoke-WebRequest -Uri '{}' -OutFile '{}'", download_url, installer_path.display()),
            ])
            .output()?;
        
        if !ps_output.status.success() {
            return Err("下载 Ollama 失败".into());
        }
        
        app.emit("install-progress", "正在安装 Ollama...")?;
        
        // 运行安装程序
        let install_output = Command::new(&installer_path)
            .args(&["/S"])  // 静默安装
            .output()?;
        
        if !install_output.status.success() {
            return Err("安装 Ollama 失败".into());
        }
        
        // 清理安装程序
        let _ = std::fs::remove_file(&installer_path);
        
        app.emit("install-progress", "Ollama 安装完成")?;
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        // Linux/macOS 使用官方脚本
        let output = Command::new("sh")
            .arg("-c")
            .arg("curl -fsSL https://ollama.com/install.sh | sh")
            .output()?;
        
        if !output.status.success() {
            return Err("安装 Ollama 失败".into());
        }
    }
    
    Ok(())
}

// 下载模型
pub async fn pull_model(
    model_name: String,
    app: tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    
    app.emit("model-progress", format!("正在下载模型: {}", model_name))?;
    
    let mut child = Command::new("ollama")
        .args(&["pull", &model_name])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    
    let stdout = child.stdout.take().ok_or("无法读取输出")?;
    let reader = BufReader::new(stdout);
    
    for line in reader.lines() {
        if let Ok(line) = line {
            app.emit("model-progress", line)?;
        }
    }
    
    let status = child.wait()?;
    
    if !status.success() {
        return Err("下载模型失败".into());
    }
    
    app.emit("model-progress", "模型下载完成".to_string())?;
    
    Ok(())
}

// 检查 OpenClaw 是否已安装
pub async fn check_openclaw_installed() -> Result<bool, Box<dyn std::error::Error>> {
    let output = Command::new("openclaw")
        .arg("--version")
        .output();
    
    Ok(output.map(|o| o.status.success()).unwrap_or(false))
}

// 安装 OpenClaw
pub async fn install_openclaw(app: tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    app.emit("install-progress", "正在安装 OpenClaw...")?;
    
    #[cfg(target_os = "windows")]
    {
        // 检查 Node.js
        let node_check = Command::new("node").arg("--version").output();
        
        if node_check.map(|o| !o.status.success()).unwrap_or(true) {
            // 需要先安装 Node.js
            app.emit("install-progress", "正在安装 Node.js...")?;
            
            let node_url = "https://nodejs.org/dist/v22.11.0/node-v22.11.0-x64.msi";
            let temp_dir = std::env::temp_dir();
            let installer_path = temp_dir.join("node-installer.msi");
            
            let ps_output = Command::new("powershell")
                .args(&[
                    "-Command",
                    &format!("Invoke-WebRequest -Uri '{}' -OutFile '{}'", node_url, installer_path.display()),
                ])
                .output()?;
            
            if !ps_output.status.success() {
                return Err("下载 Node.js 失败".into());
            }
            
            let install_output = Command::new("msiexec")
                .args(&["/i", &installer_path.display().to_string(), "/quiet", "/norestart"])
                .output()?;
            
            if !install_output.status.success() {
                return Err("安装 Node.js 失败".into());
            }
            
            let _ = std::fs::remove_file(&installer_path);
        }
        
        // 安装 OpenClaw
        app.emit("install-progress", "正在通过 npm 安装 OpenClaw...")?;
        
        let npm_output = Command::new("npm")
            .args(&["install", "-g", "openclaw@latest"])
            .output()?;
        
        if !npm_output.status.success() {
            return Err("安装 OpenClaw 失败".into());
        }
    }
    
    #[cfg(not(target_os = "windows"))]
    {
        // Linux/macOS
        let output = Command::new("sh")
            .arg("-c")
            .arg("curl -fsSL https://openclaw.ai/install.sh | sh")
            .output()?;
        
        if !output.status.success() {
            return Err("安装 OpenClaw 失败".into());
        }
    }
    
    app.emit("install-progress", "OpenClaw 安装完成".to_string())?;
    
    Ok(())
}

// 配置 OpenClaw 使用本地模型
pub async fn configure_openclaw(model_name: String) -> Result<String, Box<dyn std::error::Error>> {
    let config_dir = dirs::config_dir()
        .ok_or("无法找到配置目录")?
        .join("openclaw");
    
    fs::create_dir_all(&config_dir).await?;
    
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
    
    let config_str = serde_json::to_string_pretty(&config)?;
    let mut file = fs::File::create(&config_path).await?;
    file.write_all(config_str.as_bytes()).await?;
    
    Ok(config_path.display().to_string())
}
