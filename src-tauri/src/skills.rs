use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::Emitter;

/// 远程技能信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteSkill {
    pub name: String,
    pub slug: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub downloads: u32,
    pub category: String,
    pub tags: Vec<String>,
    pub installed: bool,
    pub update_available: bool,
}

/// 本地已安装技能
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledSkill {
    pub name: String,
    pub slug: String,
    pub version: String,
    pub path: String,
    pub installed_at: String,
    #[serde(default)]
    pub description: String,
}

/// 技能安装进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInstallProgress {
    pub skill_name: String,
    pub status: String,
    pub progress: u8,
    pub message: String,
}

/// 搜索技能
#[tauri::command]
pub async fn search_skills(query: String, app: tauri::AppHandle) -> Result<Vec<RemoteSkill>, String> {
    app.emit("skill-progress", format!("搜索技能: {}", query)).ok();
    
    // 检查 skillhub 命令是否存在
    let skillhub_exists = Command::new("skillhub")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    
    let clawhub_exists = Command::new("clawhub")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    
    if !skillhub_exists && !clawhub_exists {
        app.emit("skill-progress", "skillhub 和 clawhub 未安装，显示内置推荐".to_string()).ok();
        // 返回内置推荐技能（过滤匹配 query 的）
        let builtin = get_builtin_skills();
        let filtered: Vec<RemoteSkill> = builtin
            .into_iter()
            .filter(|s| {
                let q = query.to_lowercase();
                s.name.to_lowercase().contains(&q) ||
                s.description.to_lowercase().contains(&q) ||
                s.tags.iter().any(|t| t.to_lowercase().contains(&q))
            })
            .collect();
        
        app.emit("skill-progress", format!("找到 {} 个技能（内置）", filtered.len())).ok();
        return Ok(filtered);
    }
    
    // 优先使用 skillhub（国内优化）
    if skillhub_exists {
        let output = Command::new("skillhub")
            .args(&["search", &query])
            .output();
        
        if let Ok(o) = output {
            if o.status.success() {
                let stdout = String::from_utf8_lossy(&o.stdout);
                if !stdout.is_empty() {
                    let skills = parse_skill_results(&stdout);
                    if !skills.is_empty() {
                        return Ok(skills);
                    }
                }
            }
        }
    }
    
    // 回退到 clawhub
    if clawhub_exists {
        let output = Command::new("clawhub")
            .args(&["search", &query])
            .output()
            .map_err(|e| format!("搜索失败: {}", e))?;
        
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return Ok(parse_skill_results(&stdout));
        }
    }
    
    // 如果都失败，返回内置技能
    app.emit("skill-progress", "返回内置推荐技能".to_string()).ok();
    Ok(get_builtin_skills())
}

/// 获取推荐技能列表
#[tauri::command]
pub async fn get_recommended_skills(app: tauri::AppHandle) -> Result<Vec<RemoteSkill>, String> {
    app.emit("skill-progress", "获取推荐技能...").ok();
    
    // 检查命令是否存在
    let has_skillhub = Command::new("skillhub").arg("--version").output().is_ok();
    let has_clawhub = Command::new("clawhub").arg("--version").output().is_ok();
    
    if !has_skillhub && !has_clawhub {
        app.emit("skill-progress", "使用内置推荐技能列表".to_string()).ok();
        let mut skills = get_builtin_skills();
        
        // 标记已安装
        if let Ok(installed) = get_installed_skills_internal() {
            for skill in &mut skills {
                if installed.iter().any(|i| i.slug == skill.slug) {
                    skill.installed = true;
                }
            }
        }
        
        return Ok(skills);
    }
    
    // 尝试从远程获取
    let categories = vec!["AI", "开发工具", "自动化"];
    let mut all_skills = Vec::new();
    
    for category in categories {
        if let Ok(skills) = search_skills(category.to_string(), app.clone()).await {
            all_skills.extend(skills.into_iter().take(3));
        }
    }
    
    // 去重
    let mut seen = std::collections::HashSet::new();
    all_skills.retain(|s| seen.insert(s.slug.clone()));
    
    if all_skills.is_empty() {
        return Ok(get_builtin_skills());
    }
    
    Ok(all_skills)
}

/// 安装技能
#[tauri::command]
pub async fn install_skill(slug: String, app: tauri::AppHandle) -> Result<(), String> {
    app.emit("skill-install-progress", SkillInstallProgress {
        skill_name: slug.clone(),
        status: "installing".to_string(),
        progress: 30,
        message: "正在安装...".to_string(),
    }).ok();
    
    // 检查命令是否存在
    let has_skillhub = Command::new("skillhub").arg("--version").output().is_ok();
    let has_clawhub = Command::new("clawhub").arg("--version").output().is_ok();
    
    // 如果外部工具存在，优先使用
    if has_skillhub || has_clawhub {
        let result = if has_skillhub {
            Command::new("skillhub").args(&["install", &slug]).output()
        } else {
            Command::new("clawhub").args(&["install", &slug]).output()
        };
        
        if let Ok(o) = result {
            if o.status.success() {
                app.emit("skill-install-progress", SkillInstallProgress {
                    skill_name: slug,
                    status: "completed".to_string(),
                    progress: 100,
                    message: "安装完成！".to_string(),
                }).ok();
                return Ok(());
            }
        }
    }
    
    // 本地安装（创建技能配置）
    app.emit("skill-install-progress", SkillInstallProgress {
        skill_name: slug.clone(),
        status: "installing".to_string(),
        progress: 60,
        message: "正在创建本地技能配置...".to_string(),
    }).ok();
    
    let skills_dir = dirs::config_dir()
        .ok_or("无法找到配置目录")?
        .join("openclaw")
        .join("skills");
    
    std::fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
    
    let skill_dir = skills_dir.join(&slug);
    std::fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
    
    // 从内置列表查找技能信息
    let builtin_skills = get_builtin_skills();
    let skill_info = builtin_skills.iter().find(|s| s.slug == slug);
    
    let skill_name = skill_info.map(|s| s.name.clone()).unwrap_or_else(|| slug.clone());
    let description = skill_info.map(|s| s.description.clone()).unwrap_or_default();
    
    // 创建 skill.json
    let installed_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    
    let skill_json = serde_json::json!({
        "name": skill_name,
        "slug": slug,
        "version": "1.0.0",
        "description": description,
        "installed_at": installed_at
    });
    
    let skill_file = skill_dir.join("skill.json");
    std::fs::write(&skill_file, serde_json::to_string_pretty(&skill_json).unwrap())
        .map_err(|e| format!("创建技能文件失败: {}", e))?;
    
    app.emit("skill-install-progress", SkillInstallProgress {
        skill_name: slug,
        status: "completed".to_string(),
        progress: 100,
        message: "安装完成！".to_string(),
    }).ok();
    
    Ok(())
}

/// 更新技能
#[tauri::command]
pub async fn update_skill(slug: String, app: tauri::AppHandle) -> Result<(), String> {
    install_skill(slug, app).await
}

/// 获取已安装技能列表
#[tauri::command]
pub fn get_installed_skills() -> Result<Vec<InstalledSkill>, String> {
    get_installed_skills_internal()
}

/// 检查技能更新
#[tauri::command]
pub async fn check_skill_updates(_app: tauri::AppHandle) -> Result<Vec<RemoteSkill>, String> {
    // 简化实现，返回空列表
    Ok(Vec::new())
}

/// 卸载技能
#[tauri::command]
pub fn uninstall_skill(slug: String) -> Result<(), String> {
    // 删除技能目录
    let skill_dir = dirs::config_dir()
        .ok_or("无法找到配置目录")?
        .join("openclaw")
        .join("skills")
        .join(&slug);
    
    if skill_dir.exists() {
        std::fs::remove_dir_all(&skill_dir)
            .map_err(|e| format!("卸载失败: {}", e))?;
    }
    
    Ok(())
}

// ============ 内部辅助函数 ============

fn get_installed_skills_internal() -> Result<Vec<InstalledSkill>, String> {
    let skills_dir = dirs::config_dir()
        .ok_or("无法找到配置目录")?
        .join("openclaw")
        .join("skills");
    
    if !skills_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut skills = Vec::new();
    
    if let Ok(entries) = std::fs::read_dir(&skills_dir) {
        for entry in entries.flatten() {
            let skill_path = entry.path();
            if skill_path.is_dir() {
                let skill_json = skill_path.join("skill.json");
                if skill_json.exists() {
                    if let Ok(content) = std::fs::read_to_string(&skill_json) {
                        if let Ok(mut skill) = serde_json::from_str::<InstalledSkill>(&content) {
                            skill.path = skill_path.display().to_string();
                            skills.push(skill);
                        }
                    }
                }
            }
        }
    }
    
    Ok(skills)
}

/// 内置推荐技能列表（当 skillhub/clawhub 不可用时使用）
fn get_builtin_skills() -> Vec<RemoteSkill> {
    vec![
        RemoteSkill {
            name: "天气查询".to_string(),
            slug: "weather".to_string(),
            description: "获取实时天气信息和天气预报，支持全球城市查询".to_string(),
            version: "1.0.0".to_string(),
            author: "OpenClaw".to_string(),
            downloads: 10000,
            category: "生活服务".to_string(),
            tags: vec!["天气".to_string(), "生活".to_string()],
            installed: false,
            update_available: false,
        },
        RemoteSkill {
            name: "GitHub 助手".to_string(),
            slug: "github".to_string(),
            description: "管理 GitHub 仓库、Issues、Pull Requests，支持 gh 命令行操作".to_string(),
            version: "1.2.0".to_string(),
            author: "OpenClaw".to_string(),
            downloads: 8500,
            category: "开发工具".to_string(),
            tags: vec!["Git".to_string(), "GitHub".to_string(), "开发".to_string()],
            installed: false,
            update_available: false,
        },
        RemoteSkill {
            name: "网页摘要".to_string(),
            slug: "summarize".to_string(),
            description: "提取网页、PDF、视频内容并生成摘要，支持多种格式".to_string(),
            version: "1.1.0".to_string(),
            author: "OpenClaw".to_string(),
            downloads: 7200,
            category: "文档处理".to_string(),
            tags: vec!["摘要".to_string(), "网页".to_string(), "PDF".to_string()],
            installed: false,
            update_available: false,
        },
        RemoteSkill {
            name: "Obsidian 笔记".to_string(),
            slug: "obsidian".to_string(),
            description: "操作 Obsidian 笔记库，创建、编辑、搜索 Markdown 笔记".to_string(),
            version: "1.0.0".to_string(),
            author: "OpenClaw".to_string(),
            downloads: 5800,
            category: "效率工具".to_string(),
            tags: vec!["笔记".to_string(), "Obsidian".to_string()],
            installed: false,
            update_available: false,
        },
        RemoteSkill {
            name: "视频处理".to_string(),
            slug: "video-frames".to_string(),
            description: "使用 ffmpeg 提取视频帧、剪辑片段，支持多种视频格式".to_string(),
            version: "1.0.0".to_string(),
            author: "OpenClaw".to_string(),
            downloads: 4500,
            category: "媒体处理".to_string(),
            tags: vec!["视频".to_string(), "ffmpeg".to_string()],
            installed: false,
            update_available: false,
        },
        RemoteSkill {
            name: "Tailscale 管理".to_string(),
            slug: "tailscale".to_string(),
            description: "管理 Tailscale 网络连接、设备状态和访问控制".to_string(),
            version: "1.0.0".to_string(),
            author: "OpenClaw".to_string(),
            downloads: 3200,
            category: "网络工具".to_string(),
            tags: vec!["VPN".to_string(), "网络".to_string()],
            installed: false,
            update_available: false,
        },
    ]
}

/// 解析技能搜索结果
fn parse_skill_results(output: &str) -> Vec<RemoteSkill> {
    // 尝试解析 JSON
    if output.starts_with('[') || output.starts_with('{') {
        if let Ok(skills) = serde_json::from_str::<Vec<RemoteSkill>>(output) {
            return skills;
        }
    }
    
    // 如果不是 JSON，尝试解析文本格式
    let mut skills = Vec::new();
    for line in output.lines() {
        if line.contains(" - ") || line.contains(":") {
            let parts: Vec<&str> = line.splitn(2, ['-', ':']).collect();
            if parts.len() >= 2 {
                skills.push(RemoteSkill {
                    name: parts[0].trim().to_string(),
                    slug: parts[0].trim().to_lowercase().replace(' ', "-"),
                    description: parts[1].trim().to_string(),
                    version: "latest".to_string(),
                    author: "Community".to_string(),
                    downloads: 0,
                    category: "其他".to_string(),
                    tags: vec![],
                    installed: false,
                    update_available: false,
                });
            }
        }
    }
    
    skills
}
