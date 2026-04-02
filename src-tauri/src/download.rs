use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use tauri::Manager;

/// 下载模型并报告进度
pub async fn pull_model_with_progress(
    model_name: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    app.emit("model-download-status", "starting").ok();
    
    let mut child = Command::new("ollama")
        .args(&["pull", &model_name])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动下载失败: {}", e))?;

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
        Ok(())
    } else {
        app.emit("model-download-status", "failed").ok();
        Err("下载模型失败".to_string())
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
pub async fn cancel_download(model_name: String) -> Result<(), String> {
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
