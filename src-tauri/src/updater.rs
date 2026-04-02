use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub release_date: String,
    pub release_notes: String,
    pub download_url: String,
    pub file_size: u64,
}

/// 检查更新
pub async fn check_update() -> Result<Option<UpdateInfo>, String> {
    // GitHub API 检查最新版本
    let url = "https://api.github.com/repos/your-repo/openclaw-local-installer/releases/latest";
    
    let client = reqwest::Client::builder()
        .user_agent("OpenClaw-Local-Installer")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("请求更新信息失败: {}", e))?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析更新信息失败: {}", e))?;

    let latest_version = json["tag_name"]
        .as_str()
        .unwrap_or("v0.0.0")
        .trim_start_matches('v')
        .to_string();

    // 当前版本
    let current_version = env!("CARGO_PKG_VERSION").to_string();

    // 比较版本
    if latest_version == current_version {
        return Ok(None);
    }

    // 查找下载链接
    let assets = json["assets"].as_array().ok_or("解析资源列表失败")?;
    let download_url = assets
        .iter()
        .find(|asset| {
            let name = asset["name"].as_str().unwrap_or("");
            #[cfg(target_os = "windows")]
            {
                name.ends_with(".exe") || name.ends_with(".msi")
            }
            #[cfg(target_os = "macos")]
            {
                name.ends_with(".dmg")
            }
            #[cfg(target_os = "linux")]
            {
                name.ends_with(".AppImage") || name.ends_with(".deb")
            }
        })
        .map(|asset| asset["browser_download_url"].as_str().unwrap_or("").to_string())
        .unwrap_or_default();

    Ok(Some(UpdateInfo {
        version: latest_version,
        release_date: json["published_at"].as_str().unwrap_or("").to_string(),
        release_notes: json["body"].as_str().unwrap_or("").to_string(),
        download_url,
        file_size: assets
            .iter()
            .find(|a| a["browser_download_url"].as_str() == Some(&download_url))
            .map(|a| a["size"].as_u64().unwrap_or(0))
            .unwrap_or(0),
    }))
}

/// 下载更新
pub async fn download_update(app: tauri::AppHandle) -> Result<(), String> {
    use futures_util::StreamExt;
    use std::io::Write;

    let update_info = check_update()
        .await?
        .ok_or("没有可用更新")?;

    if update_info.download_url.is_empty() {
        return Err("未找到下载链接".to_string());
    }

    app.emit("update-download-status", "starting").ok();

    let client = reqwest::Client::builder()
        .user_agent("OpenClaw-Local-Installer")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(&update_info.download_url)
        .send()
        .await
        .map_err(|e| format!("下载更新失败: {}", e))?;

    let total_size = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    let temp_dir = std::env::temp_dir();
    let file_name = update_info.download_url.split('/').last().unwrap_or("update.exe");
    let file_path = temp_dir.join(file_name);
    let mut file = std::fs::File::create(&file_path)
        .map_err(|e| format!("创建文件失败: {}", e))?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取数据失败: {}", e))?;
        file.write_all(&chunk).map_err(|e| format!("写入文件失败: {}", e))?;
        downloaded += chunk.len() as u64;

        let percent = if total_size > 0 {
            (downloaded as f64 / total_size as f64 * 100.0) as u8
        } else {
            0
        };

        app.emit("update-download-progress", percent).ok();
    }

    app.emit("update-download-status", "completed").ok();
    app.emit("update-file-path", file_path.display().to_string()).ok();

    Ok(())
}

/// 安装更新
pub async fn install_update() -> Result<(), String> {
    let temp_dir = std::env::temp_dir();
    
    #[cfg(target_os = "windows")]
    {
        let file_path = temp_dir.join("OpenClaw-Local-Installer-Setup.exe");
        if file_path.exists() {
            std::process::Command::new(&file_path)
                .spawn()
                .map_err(|e| format!("启动安装程序失败: {}", e))?;
            std::process::exit(0);
        }
    }

    #[cfg(target_os = "macos")]
    {
        let file_path = temp_dir.join("OpenClaw-Local-Installer.dmg");
        if file_path.exists() {
            std::process::Command::new("open")
                .arg(&file_path)
                .spawn()
                .map_err(|e| format!("打开 DMG 失败: {}", e))?;
            std::process::exit(0);
        }
    }

    #[cfg(target_os = "linux")]
    {
        let file_path = temp_dir.join("OpenClaw-Local-Installer.AppImage");
        if file_path.exists() {
            std::process::Command::new("chmod")
                .args(&["+x", &file_path.display().to_string()])
                .spawn()
                .ok();
            std::process::Command::new(&file_path)
                .spawn()
                .map_err(|e| format!("启动 AppImage 失败: {}", e))?;
            std::process::exit(0);
        }
    }

    Err("未找到更新文件".to_string())
}
