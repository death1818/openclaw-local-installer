use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::{Emitter, Manager};

/// 检查 Ollama 是否已安装
fn check_ollama_installed() -> bool {
    // 尝试运行 ollama --version
    if let Ok(o) = Command::new("ollama").arg("--version").output() {
        if o.status.success() {
            return true;
        }
    }
    
    // Windows 上检查默认安装路径
    #[cfg(target_os = "windows")]
    {
        let paths = vec![
            std::env::var("LOCALAPPDATA").unwrap_or_default() + "\\Programs\\Ollama\\ollama.exe",
            std::env::var("USERPROFILE").unwrap_or_default() + "\\AppData\\Local\\Programs\\Ollama\\ollama.exe",
        ];
        
        for path in paths {
            if std::path::Path::new(&path).exists() {
                if let Ok(o) = Command::new(&path).arg("--version").output() {
                    if o.status.success() {
                        return true;
                    }
                }
            }
        }
        
        // 尝试通过 where 命令查找
        if let Ok(where_output) = Command::new("where").arg("ollama").output() {
            if where_output.status.success() {
                let stdout = String::from_utf8_lossy(&where_output.stdout);
                for line in stdout.lines() {
                    if let Ok(o) = Command::new(line.trim()).arg("--version").output() {
                        if o.status.success() {
                            return true;
                        }
                    }
                }
            }
        }
    }
    
    false
}

/// 安装 Ollama (Windows) - 下载并提示用户手动安装
#[cfg(target_os = "windows")]
fn install_ollama_windows() -> Result<(), String> {
    let download_url = "https://ollama.com/download/OllamaSetup.exe";
    let temp_dir = std::env::temp_dir();
    let installer_path = temp_dir.join("OllamaSetup.exe");
    
    // 使用 PowerShell 下载
    let ps_output = Command::new("powershell")
        .args(&[
            "-Command",
            &format!("Invoke-WebRequest -Uri '{}' -OutFile '{}' -UseBasicParsing", download_url, installer_path.display()),
        ])
        .output()
        .map_err(|e| format!("下载 Ollama 失败: {}", e))?;
    
    if !ps_output.status.success() {
        return Err("下载 Ollama 安装程序失败，请手动下载: https://ollama.com/download".to_string());
    }
    
    // 打开安装程序让用户手动安装（Ollama 安装程序不支持静默安装）
    let open_result = Command::new("explorer")
        .arg(&installer_path)
        .spawn();
    
    if open_result.is_err() {
        // 如果无法自动打开，返回路径让用户手动运行
        return Err(format!(
            "已下载安装程序到: {}\n请手动运行安装程序完成安装，安装完成后重新运行 OpenClaw 安装器",
            installer_path.display()
        ));
    }
    
    // 提示用户手动安装
    return Err("已打开 Ollama 安装程序，请完成安装后重新运行 OpenClaw 安装器。安装完成后点击「重新检测」继续。".to_string());
}

/// 下载模型并报告进度
pub async fn pull_model_with_progress(
    model_name: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    app.emit("model-download-status", "starting").ok();
    app.emit("model-download-log", "检查 Ollama 安装状态...").ok();
    
    // 检查 Ollama 是否已安装
    if !check_ollama_installed() {
        app.emit("model-download-log", "Ollama 未安装，正在自动安装...").ok();
        
        #[cfg(target_os = "windows")]
        {
            install_ollama_windows()?;
        }
        
        #[cfg(not(target_os = "windows"))]
        {
            return Err("请先安装 Ollama: https://ollama.com".to_string());
        }
        
        // 再次检查
        if !check_ollama_installed() {
            return Err("Ollama 安装失败，请手动安装: https://ollama.com".to_string());
        }
        
        app.emit("model-download-log", "Ollama 安装完成").ok();
    }
    
    app.emit("model-download-log", format!("正在下载模型: {}", model_name)).ok();
    
    let mut child = Command::new("ollama")
        .args(&["pull", &model_name])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动下载失败: {}。请确保 Ollama 已安装并运行。", e))?;

    let stdout = child.stdout.take().ok_or("无法读取输出")?;
    let reader = BufReader::new(stdout);

    for line in reader.lines() {
        if let Ok(line) = line {
            // 解析进度信息
            // 格式: "pulling manifest" 或 "downloading 123MB/456MB" 或 "verifying sha256"
            if line.contains("downloading") || line.contains("pulling") {
                let progress = parse_progress(&line);
                app.emit("model-download-progress", progress).ok();
            }
            app.emit("model-download-log", line).ok();
        }
    }

    let status = child.wait().map_err(|e| format!("等待进程失败: {}", e))?;

    if status.success() {
        app.emit("model-download-status", "completed").ok();
        app.emit("model-download-log", "模型下载完成！".to_string()).ok();
        Ok(())
    } else {
        app.emit("model-download-status", "failed").ok();
        Err("下载模型失败。请检查网络连接并确保 Ollama 服务正在运行。".to_string())
    }
}

/// 解析进度信息
fn parse_progress(line: &str) -> DownloadProgress {
    // 示例: "downloading 123.45 MB / 456.78 MB  27%"
    let mut progress = DownloadProgress {
        phase: "unknown".to_string(),
        current: 0.0,
        total: 0.0,
        percent: 0,
    };

    if line.contains("pulling manifest") {
        progress.phase = "pulling".to_string();
        progress.percent = 5;
    } else if line.contains("downloading") {
        progress.phase = "downloading".to_string();
        
        // 提取百分比
        if let Some(percent_str) = line.split_whitespace().last() {
            if let Ok(p) = percent_str.trim_end_matches('%').parse::<u8>() {
                progress.percent = p;
            }
        }
        
        // 提取大小信息
        let parts: Vec<&str> = line.split_whitespace().collect();
        for i in 0..parts.len() {
            if parts[i] == "downloading" && i + 2 < parts.len() {
                if let Ok(current) = parts[i + 1].parse::<f64>() {
                    progress.current = current;
                }
            }
            if parts[i] == "/" && i + 1 < parts.len() {
                if let Ok(total) = parts[i + 1].parse::<f64>() {
                    progress.total = total;
                }
            }
        }
    } else if line.contains("verifying") {
        progress.phase = "verifying".to_string();
        progress.percent = 95;
    }

    progress
}

#[derive(Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub phase: String,
    pub current: f64,
    pub total: f64,
    pub percent: u8,
}

/// 取消模型下载
#[tauri::command]
pub async fn cancel_model_download(model_name: String) -> Result<(), String> {
    // 找到 ollama pull 进程并终止
    #[cfg(target_os = "windows")]
    {
        Command::new("taskkill")
            .args(&["/F", "/IM", "ollama.exe", "/FI", &format!("WINDOWTITLE eq *{}*", model_name)])
            .output()
            .ok();
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new("pkill")
            .args(&["-f", &format!("ollama pull {}", model_name)])
            .output()
            .ok();
    }

    Ok(())
}
