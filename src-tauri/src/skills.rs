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
}

/// 技能安装进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInstallProgress {
    pub skill_name: String,
    pub status: String,  // downloading, installing, completed, failed
    pub progress: u8,
    pub message: String,
}

/// 搜索技能
#[tauri::command]
pub async fn search_skills(query: String, app: tauri::AppHandle) -> Result<Vec<RemoteSkill>, String> {
    app.emit("skill-progress", format!("搜索技能: {}", query)).ok();
    
    // 优先使用 skillhub（国内优化）
    let output = Command::new("skillhub")
        .args(&["search", &query, "--json"])
        .output();
    
    let skills = match output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            parse_skillhub_results(&stdout)
        }
        _ => {
            // 回退到 clawhub
            app.emit("skill-progress", "skillhub 不可用，尝试 clawhub...").ok();
            let claw_output = Command::new("clawhub")
                .args(&["search", &query, "--json"])
                .output()
                .map_err(|e| format!("搜索失败: {}", e))?;
            
            if claw_output.status.success() {
                let stdout = String::from_utf8_lossy(&claw_output.stdout);
                parse_clawhub_results(&stdout)
            } else {
                return Err("搜索失败，请检查网络连接".to_string());
            }
        }
    };
    
    // 标记已安装的技能
    let installed = get_installed_skills_internal()?;
    let mut result = skills;
    for skill in &mut result {
        if let Some(inst) = installed.iter().find(|i| i.slug == skill.slug) {
            skill.installed = true;
            skill.update_available = inst.version != skill.version;
        }
    }
    
    app.emit("skill-progress", format!("找到 {} 个技能", result.len())).ok();
    Ok(result)
}

/// 获取推荐技能列表
#[tauri::command]
pub async fn get_recommended_skills(app: tauri::AppHandle) -> Result<Vec<RemoteSkill>, String> {
    app.emit("skill-progress", "获取推荐技能...").ok();
    
    // 热门技能分类
    let categories = vec![
        "开发工具", "AI助手", "自动化", "文档处理", "网络工具"
    ];
    
    let mut all_skills = Vec::new();
    
    for category in categories {
        if let Ok(skills) = search_skills(category.to_string(), app.clone()).await {
            all_skills.extend(skills.into_iter().take(3));
        }
    }
    
    // 去重
    let mut seen = std::collections::HashSet::new();
    all_skills.retain(|s| seen.insert(s.slug.clone()));
    
    Ok(all_skills)
}

/// 安装技能
#[tauri::command]
pub async fn install_skill(slug: String, app: tauri::AppHandle) -> Result<(), String> {
    app.emit("skill-install-progress", SkillInstallProgress {
        skill_name: slug.clone(),
        status: "downloading".to_string(),
        progress: 0,
        message: "正在下载...".to_string(),
    }).ok();
    
    // 优先使用 skillhub
    let output = Command::new("skillhub")
        .args(&["install", &slug])
        .output();
    
    let result = match output {
        Ok(o) if o.status.success() => {
            app.emit("skill-install-progress", SkillInstallProgress {
                skill_name: slug.clone(),
                status: "completed".to_string(),
                progress: 100,
                message: "安装完成！".to_string(),
            }).ok();
            Ok(())
        }
        _ => {
            // 回退到 clawhub
            app.emit("skill-install-progress", SkillInstallProgress {
                skill_name: slug.clone(),
                status: "downloading".to_string(),
                progress: 50,
                message: "尝试 clawhub...".to_string(),
            }).ok();
            
            let claw_output = Command::new("clawhub")
                .args(&["install", &slug])
                .output()
                .map_err(|e| format!("安装失败: {}", e))?;
            
            if claw_output.status.success() {
                app.emit("skill-install-progress", SkillInstallProgress {
                    skill_name: slug.clone(),
                    status: "completed".to_string(),
                    progress: 100,
                    message: "安装完成！".to_string(),
                }).ok();
                Ok(())
            } else {
                let err = String::from_utf8_lossy(&claw_output.stderr);
                app.emit("skill-install-progress", SkillInstallProgress {
                    skill_name: slug.clone(),
                    status: "failed".to_string(),
                    progress: 0,
                    message: format!("安装失败: {}", err),
                }).ok();
                Err(format!("安装失败: {}", err))
            }
        }
    };
    
    result
}

/// 更新技能
#[tauri::command]
pub async fn update_skill(slug: String, app: tauri::AppHandle) -> Result<(), String> {
    app.emit("skill-install-progress", SkillInstallProgress {
        skill_name: slug.clone(),
        status: "downloading".to_string(),
        progress: 0,
        message: "正在更新...".to_string(),
    }).ok();
    
    let output = Command::new("skillhub")
        .args(&["update", &slug])
        .output()
        .map_err(|e| format!("更新失败: {}", e))?;
    
    if output.status.success() {
        app.emit("skill-install-progress", SkillInstallProgress {
            skill_name: slug.clone(),
            status: "completed".to_string(),
            progress: 100,
            message: "更新完成！".to_string(),
        }).ok();
        Ok(())
    } else {
        // 尝试重新安装
        install_skill(slug, app).await
    }
}

/// 获取已安装技能列表
#[tauri::command]
pub fn get_installed_skills() -> Result<Vec<InstalledSkill>, String> {
    get_installed_skills_internal()
}

/// 检查技能更新
#[tauri::command]
pub async fn check_skill_updates(app: tauri::AppHandle) -> Result<Vec<RemoteSkill>, String> {
    app.emit("skill-progress", "检查技能更新...").ok();
    
    let installed = get_installed_skills_internal()?;
    let mut updates = Vec::new();
    
    for skill in &installed {
        // 查询远程版本
        if let Ok(remote_skills) = search_skills(skill.name.clone(), app.clone()).await {
            if let Some(remote) = remote_skills.first() {
                if remote.version != skill.version {
                    updates.push(remote.clone());
                }
            }
        }
    }
    
    if updates.is_empty() {
        app.emit("skill-progress", "所有技能都是最新版本").ok();
    } else {
        app.emit("skill-progress", format!("发现 {} 个技能有更新", updates.len())).ok();
    }
    
    Ok(updates)
}

/// 卸载技能
#[tauri::command]
pub fn uninstall_skill(slug: String) -> Result<(), String> {
    let output = Command::new("skillhub")
        .args(&["uninstall", &slug])
        .output()
        .map_err(|e| format!("卸载失败: {}", e))?;
    
    if output.status.success() {
        Ok(())
    } else {
        Err("卸载失败".to_string())
    }
}

// ============ 内部辅助函数 ============

fn get_installed_skills_internal() -> Result<Vec<InstalledSkill>, String> {
    // 读取技能目录
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

fn parse_skillhub_results(json: &str) -> Vec<RemoteSkill> {
    // 解析 skillhub JSON 输出
    // 格式示例：[{"name": "...", "slug": "...", ...}]
    serde_json::from_str(json).unwrap_or_default()
}

fn parse_clawhub_results(json: &str) -> Vec<RemoteSkill> {
    // 解析 clawhub JSON 输出
    serde_json::from_str(json).unwrap_or_default()
}
