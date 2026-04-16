use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{Emitter, Manager};

/// 获取技能存储目录
fn get_skills_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    // 使用 Tauri 的应用配置目录，确保路径一致性
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("无法获取配置目录: {}", e))?;
    let skills_dir = config_dir.join("skills");
    
    // 确保目录存在
    if !skills_dir.exists() {
        std::fs::create_dir_all(&skills_dir)
            .map_err(|e| format!("创建技能目录失败: {}", e))?;
    }
    
    // 迁移旧数据（如果存在）
    if let Some(old_config_dir) = dirs::config_dir() {
        let old_skills_dir = old_config_dir.join("openclaw").join("skills");
        if old_skills_dir.exists() && old_skills_dir != skills_dir {
            println!("[Skills] 检测到旧数据目录: {:?}", old_skills_dir);
            // 尝试迁移每个技能目录
            if let Ok(entries) = std::fs::read_dir(&old_skills_dir) {
                for entry in entries.flatten() {
                    let src_dir = entry.path();
                    let dst_dir = skills_dir.join(entry.file_name());
                    if !dst_dir.exists() && src_dir.is_dir() {
                        // 创建目标目录
                        if std::fs::create_dir_all(&dst_dir).is_ok() {
                            let src_file = src_dir.join("skill.json");
                            let dst_file = dst_dir.join("skill.json");
                            if src_file.exists() {
                                if let Err(e) = std::fs::copy(&src_file, &dst_file) {
                                    println!("[Skills] 迁移失败 {:?}: {}", src_file, e);
                                } else {
                                    println!("[Skills] 已迁移技能: {:?}", entry.file_name());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    println!("[Skills] 技能目录: {:?}", skills_dir);
    Ok(skills_dir)
}

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
    
    // 获取内置技能并过滤
    let builtin = get_builtin_skills();
    let installed = get_installed_slugs(&app);
    
    let filtered: Vec<RemoteSkill> = builtin
        .into_iter()
        .map(|mut s| {
            s.installed = installed.contains(&s.slug);
            s
        })
        .filter(|s| {
            let q = query.to_lowercase();
            s.name.to_lowercase().contains(&q) ||
            s.description.to_lowercase().contains(&q) ||
            s.tags.iter().any(|t| t.to_lowercase().contains(&q)) ||
            s.category.to_lowercase().contains(&q)
        })
        .collect();
    
    app.emit("skill-progress", format!("找到 {} 个技能", filtered.len())).ok();
    Ok(filtered)
}

/// 获取推荐技能
#[tauri::command]
pub async fn get_recommended_skills(app: tauri::AppHandle) -> Result<Vec<RemoteSkill>, String> {
    let builtin = get_builtin_skills();
    let installed = get_installed_slugs(&app);
    
    // 调试日志
    println!("[Skills] 已安装技能: {:?}", installed);
    println!("[Skills] 技能目录内容: {:?}", get_skills_dir(&app));
    
    Ok(builtin.into_iter().map(|mut s| {
        s.installed = installed.contains(&s.slug);
        s
    }).collect())
}

/// 获取所有技能分类
#[tauri::command]
pub fn get_skill_categories() -> Result<Vec<String>, String> {
    let skills = get_builtin_skills();
    let mut categories: Vec<String> = skills.iter().map(|s| s.category.clone()).collect();
    categories.sort();
    categories.dedup();
    Ok(categories)
}

/// 按分类获取技能
#[tauri::command]
pub fn get_skills_by_category(category: String, app: tauri::AppHandle) -> Result<Vec<RemoteSkill>, String> {
    let builtin = get_builtin_skills();
    let installed = get_installed_slugs(&app);
    
    Ok(builtin.into_iter()
        .filter(|s| s.category == category)
        .map(|mut s| {
            s.installed = installed.contains(&s.slug);
            s
        })
        .collect())
}

/// 安装技能
#[tauri::command]
pub async fn install_skill(slug: String, app: tauri::AppHandle) -> Result<(), String> {
    app.emit("skill-progress", format!("开始安装: {}", slug)).ok();
    
    // 获取技能目录
    let skills_dir = get_skills_dir(&app)?;
    println!("[Skills] 安装技能到: {:?}", skills_dir);
    
    let skill_dir = skills_dir.join(&slug);
    std::fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
    println!("[Skills] 技能目录已创建: {:?}", skill_dir);
    
    app.emit("skill-install-progress", SkillInstallProgress {
        skill_name: slug.clone(),
        status: "installing".to_string(),
        progress: 60,
        message: "查找技能信息...".to_string(),
    }).ok();
    
    // 从内置列表查找技能信息
    let builtin_skills = get_builtin_skills();
    let skill_info = builtin_skills.iter().find(|s| s.slug == slug);
    
    let skill_name = skill_info.map(|s| s.name.clone()).unwrap_or_else(|| slug.clone());
    let description = skill_info.map(|s| s.description.clone()).unwrap_or_default();
    
    app.emit("skill-install-progress", SkillInstallProgress {
        skill_name: slug.clone(),
        status: "installing".to_string(),
        progress: 70,
        message: "生成技能配置...".to_string(),
    }).ok();
    
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
    
    app.emit("skill-install-progress", SkillInstallProgress {
        skill_name: slug.clone(),
        status: "installing".to_string(),
        progress: 85,
        message: "写入技能文件...".to_string(),
    }).ok();
    
    let skill_file = skill_dir.join("skill.json");
    println!("[Skills] 写入技能文件: {:?}", skill_file);
    std::fs::write(&skill_file, serde_json::to_string_pretty(&skill_json).unwrap())
        .map_err(|e| format!("创建技能文件失败: {}", e))?;
    
    // 验证文件是否成功写入
    if skill_file.exists() {
        println!("[Skills] ✅ 技能文件已成功创建: {:?}", skill_file);
        if let Ok(content) = std::fs::read_to_string(&skill_file) {
            println!("[Skills] 文件内容: {}", content);
        }
    } else {
        println!("[Skills] ❌ 技能文件创建失败，文件不存在！");
    }
    
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
pub fn get_installed_skills(app: tauri::AppHandle) -> Result<Vec<InstalledSkill>, String> {
    get_installed_skills_internal(&app)
}

/// 检查技能更新
#[tauri::command]
pub async fn check_skill_updates(_app: tauri::AppHandle) -> Result<Vec<RemoteSkill>, String> {
    Ok(Vec::new())
}

/// 卸载技能
#[tauri::command]
pub fn uninstall_skill(slug: String, app: tauri::AppHandle) -> Result<(), String> {
    let skills_dir = get_skills_dir(&app)?;
    let skill_dir = skills_dir.join(&slug);
    
    if skill_dir.exists() {
        std::fs::remove_dir_all(&skill_dir)
            .map_err(|e| format!("卸载失败: {}", e))?;
    }
    
    Ok(())
}

// ============ 内部辅助函数 ============

fn get_installed_skills_internal(app: &tauri::AppHandle) -> Result<Vec<InstalledSkill>, String> {
    let skills_dir = match get_skills_dir(app) {
        Ok(dir) => dir,
        Err(_) => return Ok(Vec::new()),
    };
    
    if !skills_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut skills = Vec::new();
    
    for entry in std::fs::read_dir(&skills_dir).map_err(|e| e.to_string())? {
        if let Ok(entry) = entry {
            let skill_dir = entry.path();
            if skill_dir.is_dir() {
                let skill_file = skill_dir.join("skill.json");
                if skill_file.exists() {
                    if let Ok(content) = std::fs::read_to_string(&skill_file) {
                        if let Ok(mut skill) = serde_json::from_str::<InstalledSkill>(&content) {
                            skill.path = skill_dir.to_string_lossy().to_string();
                            skills.push(skill);
                        }
                    }
                }
            }
        }
    }
    
    Ok(skills)
}

fn get_installed_slugs(app: &tauri::AppHandle) -> Vec<String> {
    let result = get_installed_skills_internal(app)
        .unwrap_or_default()
        .iter()
        .map(|s| s.slug.clone())
        .collect();
    println!("[Skills] get_installed_slugs: {:?}", result);
    result
}

/// 内置推荐技能列表（300+ 技能）
fn get_builtin_skills() -> Vec<RemoteSkill> {
    vec![
        // ========== 即时通讯类 ==========
        RemoteSkill { name: "微信助手".into(), slug: "openclaw-weixin".into(), description: "微信消息发送、接收、联系人管理，支持私聊和群聊操作".into(), version: "2.1.7".into(), author: "OpenClaw".into(), downloads: 25000, category: "即时通讯".into(), tags: vec!["微信".into(), "通讯".into()], installed: false, update_available: false },
        RemoteSkill { name: "钉钉助手".into(), slug: "ddingtalk".into(), description: "钉钉消息发送、接收、群组管理，支持机器人推送和审批流程".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 22000, category: "即时通讯".into(), tags: vec!["钉钉".into(), "办公".into()], installed: false, update_available: false },
        RemoteSkill { name: "企业微信助手".into(), slug: "wecom".into(), description: "企业微信消息发送、接收、通讯录管理，支持应用消息和群机器人".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 20000, category: "即时通讯".into(), tags: vec!["企业微信".into(), "办公".into()], installed: false, update_available: false },
        RemoteSkill { name: "元宝 Bot".into(), slug: "openclaw-plugin-yuanbao".into(), description: "腾讯元宝智能机器人，支持对话交互和知识问答".into(), version: "2.7.2".into(), author: "OpenClaw".into(), downloads: 18000, category: "即时通讯".into(), tags: vec!["元宝".into(), "AI".into()], installed: false, update_available: false },
        RemoteSkill { name: "Telegram Bot".into(), slug: "telegram-bot".into(), description: "Telegram 机器人，支持消息发送、群组管理、频道推送".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 15000, category: "即时通讯".into(), tags: vec!["Telegram".into(), "机器人".into()], installed: false, update_available: false },
        RemoteSkill { name: "Discord Bot".into(), slug: "discord-bot".into(), description: "Discord 机器人，支持服务器管理、消息推送、角色管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "即时通讯".into(), tags: vec!["Discord".into(), "游戏".into()], installed: false, update_available: false },
        RemoteSkill { name: "Slack 助手".into(), slug: "slack-assistant".into(), description: "Slack 消息管理、频道通知、工作流自动化".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "即时通讯".into(), tags: vec!["Slack".into(), "办公".into()], installed: false, update_available: false },
        RemoteSkill { name: "飞书助手".into(), slug: "feishu-assistant".into(), description: "飞书消息发送、多维表格、文档协作".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "即时通讯".into(), tags: vec!["飞书".into(), "办公".into()], installed: false, update_available: false },
        RemoteSkill { name: "QQ 机器人".into(), slug: "qq-bot".into(), description: "QQ 群机器人，支持消息监控、自动回复、群管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 14000, category: "即时通讯".into(), tags: vec!["QQ".into(), "机器人".into()], installed: false, update_available: false },
        RemoteSkill { name: "WhatsApp Bot".into(), slug: "whatsapp-bot".into(), description: "WhatsApp 消息发送、群组管理、广播消息".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "即时通讯".into(), tags: vec!["WhatsApp".into(), "通讯".into()], installed: false, update_available: false },

        // ========== AI 增强类 ==========
        RemoteSkill { name: "LightClawBot".into(), slug: "lightclawbot".into(), description: "轻量级机器人框架，支持定时任务、主动消息、多平台集成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 15000, category: "AI 增强".into(), tags: vec!["机器人".into(), "自动化".into()], installed: false, update_available: false },
        RemoteSkill { name: "记忆系统 (TDAI)".into(), slug: "memory-tdai".into(), description: "四层记忆系统：自动捕获对话、结构化记忆、用户画像、长期记忆召回".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "AI 增强".into(), tags: vec!["记忆".into(), "AI".into()], installed: false, update_available: false },
        RemoteSkill { name: "ADP OpenClaw".into(), slug: "adp-openclaw".into(), description: "OpenClaw 适配器插件，扩展多平台兼容性".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "AI 增强".into(), tags: vec!["适配器".into()], installed: false, update_available: false },
        RemoteSkill { name: "提示词优化".into(), slug: "prompt-optimizer".into(), description: "智能优化提示词，提升 AI 回复质量".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 20000, category: "AI 增强".into(), tags: vec!["提示词".into(), "优化".into()], installed: false, update_available: false },
        RemoteSkill { name: "多模型路由".into(), slug: "model-router".into(), description: "自动选择最佳 AI 模型，优化成本和效果".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "AI 增强".into(), tags: vec!["模型".into(), "路由".into()], installed: false, update_available: false },
        RemoteSkill { name: "上下文管理".into(), slug: "context-manager".into(), description: "智能管理对话上下文，突破 token 限制".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "AI 增强".into(), tags: vec!["上下文".into()], installed: false, update_available: false },
        RemoteSkill { name: "思维链增强".into(), slug: "chain-of-thought".into(), description: "增强 AI 推理能力，支持复杂问题分解".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "AI 增强".into(), tags: vec!["推理".into()], installed: false, update_available: false },
        RemoteSkill { name: "RAG 知识库".into(), slug: "rag-knowledge".into(), description: "检索增强生成，构建私有知识库问答系统".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 13000, category: "AI 增强".into(), tags: vec!["RAG".into(), "知识库".into()], installed: false, update_available: false },
        RemoteSkill { name: "Agent 编排".into(), slug: "agent-orchestration".into(), description: "多 Agent 协作编排，完成复杂任务流程".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8500, category: "AI 增强".into(), tags: vec!["Agent".into(), "编排".into()], installed: false, update_available: false },
        RemoteSkill { name: "函数调用增强".into(), slug: "function-calling".into(), description: "增强 AI 函数调用能力，支持复杂工具链".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "AI 增强".into(), tags: vec!["函数".into(), "工具".into()], installed: false, update_available: false },

        // ========== 开发工具类 ==========
        RemoteSkill { name: "GitHub 助手".into(), slug: "github".into(), description: "管理 GitHub 仓库、Issues、Pull Requests，支持 gh 命令行操作".into(), version: "1.2.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "开发工具".into(), tags: vec!["Git".into(), "GitHub".into()], installed: false, update_available: false },
        RemoteSkill { name: "GitLab 助手".into(), slug: "gitlab-assistant".into(), description: "GitLab 项目管理、MR 处理、CI/CD 监控".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "开发工具".into(), tags: vec!["GitLab".into()], installed: false, update_available: false },
        RemoteSkill { name: "代码审查".into(), slug: "code-review".into(), description: "AI 驱动的代码审查，发现潜在问题和优化建议".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 15000, category: "开发工具".into(), tags: vec!["代码".into(), "审查".into()], installed: false, update_available: false },
        RemoteSkill { name: "代码生成".into(), slug: "code-generator".into(), description: "根据需求自动生成代码，支持多种编程语言".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 18000, category: "开发工具".into(), tags: vec!["代码".into(), "生成".into()], installed: false, update_available: false },
        RemoteSkill { name: "单元测试生成".into(), slug: "unit-test-gen".into(), description: "自动生成单元测试代码，提高测试覆盖率".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "开发工具".into(), tags: vec!["测试".into()], installed: false, update_available: false },
        RemoteSkill { name: "API 文档生成".into(), slug: "api-doc-gen".into(), description: "自动生成 API 文档，支持 OpenAPI/Swagger 格式".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "开发工具".into(), tags: vec!["API".into(), "文档".into()], installed: false, update_available: false },
        RemoteSkill { name: "Docker 管理".into(), slug: "docker-manager".into(), description: "Docker 容器管理、镜像构建、日志查看".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "开发工具".into(), tags: vec!["Docker".into()], installed: false, update_available: false },
        RemoteSkill { name: "Kubernetes 助手".into(), slug: "k8s-assistant".into(), description: "K8s 集群管理、资源监控、部署自动化".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "开发工具".into(), tags: vec!["K8s".into()], installed: false, update_available: false },
        RemoteSkill { name: "数据库管理".into(), slug: "database-manager".into(), description: "多数据库支持：MySQL、PostgreSQL、MongoDB 等".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "开发工具".into(), tags: vec!["数据库".into()], installed: false, update_available: false },
        RemoteSkill { name: "Redis 管理".into(), slug: "redis-manager".into(), description: "Redis 缓存管理、数据查看、性能监控".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "开发工具".into(), tags: vec!["Redis".into()], installed: false, update_available: false },
        RemoteSkill { name: "Nginx 配置".into(), slug: "nginx-config".into(), description: "Nginx 配置生成、优化建议、问题排查".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "开发工具".into(), tags: vec!["Nginx".into()], installed: false, update_available: false },
        RemoteSkill { name: "Jenkins 助手".into(), slug: "jenkins-assistant".into(), description: "Jenkins 任务管理、构建触发、日志查看".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "开发工具".into(), tags: vec!["Jenkins".into(), "CI/CD".into()], installed: false, update_available: false },
        RemoteSkill { name: "VS Code 集成".into(), slug: "vscode-integration".into(), description: "与 VS Code 深度集成，提升开发效率".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 14000, category: "开发工具".into(), tags: vec!["VSCode".into()], installed: false, update_available: false },
        RemoteSkill { name: "npm 包管理".into(), slug: "npm-manager".into(), description: "npm 包查询、版本管理、依赖分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "开发工具".into(), tags: vec!["npm".into(), "Node".into()], installed: false, update_available: false },
        RemoteSkill { name: "PyPI 包管理".into(), slug: "pypi-manager".into(), description: "Python 包查询、版本管理、依赖分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "开发工具".into(), tags: vec!["Python".into(), "PyPI".into()], installed: false, update_available: false },

        // ========== 文档处理类 ==========
        RemoteSkill { name: "网页摘要".into(), slug: "summarize".into(), description: "提取网页、PDF、视频内容并生成摘要，支持多种格式".into(), version: "1.1.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "文档处理".into(), tags: vec!["摘要".into(), "网页".into()], installed: false, update_available: false },
        RemoteSkill { name: "Obsidian 笔记".into(), slug: "obsidian".into(), description: "操作 Obsidian 笔记库，创建、编辑、搜索 Markdown 笔记".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "文档处理".into(), tags: vec!["笔记".into(), "Obsidian".into()], installed: false, update_available: false },
        RemoteSkill { name: "PDF 处理".into(), slug: "pdf-processor".into(), description: "PDF 合并、拆分、转换、水印添加".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "文档处理".into(), tags: vec!["PDF".into()], installed: false, update_available: false },
        RemoteSkill { name: "Word 处理".into(), slug: "word-processor".into(), description: "Word 文档创建、编辑、格式转换".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "文档处理".into(), tags: vec!["Word".into()], installed: false, update_available: false },
        RemoteSkill { name: "Excel 处理".into(), slug: "excel-processor".into(), description: "Excel 数据处理、公式计算、图表生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "文档处理".into(), tags: vec!["Excel".into()], installed: false, update_available: false },
        RemoteSkill { name: "Markdown 增强".into(), slug: "markdown-enhanced".into(), description: "Markdown 格式化、目录生成、语法检查".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "文档处理".into(), tags: vec!["Markdown".into()], installed: false, update_available: false },
        RemoteSkill { name: "文档翻译".into(), slug: "doc-translator".into(), description: "多语言文档翻译，保持格式不变".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8500, category: "文档处理".into(), tags: vec!["翻译".into()], installed: false, update_available: false },
        RemoteSkill { name: "OCR 识别".into(), slug: "ocr-recognition".into(), description: "图片文字识别，支持多语言和手写体".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 13000, category: "文档处理".into(), tags: vec!["OCR".into(), "识别".into()], installed: false, update_available: false },
        RemoteSkill { name: "Notion 集成".into(), slug: "notion-integration".into(), description: "Notion 页面管理、数据库操作、内容同步".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "文档处理".into(), tags: vec!["Notion".into()], installed: false, update_available: false },
        RemoteSkill { name: "语雀集成".into(), slug: "yuque-integration".into(), description: "语雀知识库管理、文档同步、团队协作".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "文档处理".into(), tags: vec!["语雀".into()], installed: false, update_available: false },

        // ========== 媒体处理类 ==========
        RemoteSkill { name: "视频处理".into(), slug: "video-frames".into(), description: "使用 ffmpeg 提取视频帧、剪辑片段，支持多种视频格式".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "媒体处理".into(), tags: vec!["视频".into(), "ffmpeg".into()], installed: false, update_available: false },
        RemoteSkill { name: "TTS 语音".into(), slug: "tts".into(), description: "文字转语音，支持多种声音和语言".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "媒体处理".into(), tags: vec!["语音".into(), "TTS".into()], installed: false, update_available: false },
        RemoteSkill { name: "图片压缩".into(), slug: "image-compress".into(), description: "智能图片压缩，保持质量减小体积".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "媒体处理".into(), tags: vec!["图片".into(), "压缩".into()], installed: false, update_available: false },
        RemoteSkill { name: "图片水印".into(), slug: "image-watermark".into(), description: "图片水印添加、批量处理、位置调整".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "媒体处理".into(), tags: vec!["图片".into(), "水印".into()], installed: false, update_available: false },
        RemoteSkill { name: "图片格式转换".into(), slug: "image-convert".into(), description: "图片格式转换：WebP、PNG、JPG 等".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "媒体处理".into(), tags: vec!["图片".into()], installed: false, update_available: false },
        RemoteSkill { name: "音频转换".into(), slug: "audio-convert".into(), description: "音频格式转换、剪辑、合并".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "媒体处理".into(), tags: vec!["音频".into()], installed: false, update_available: false },
        RemoteSkill { name: "视频字幕".into(), slug: "video-subtitle".into(), description: "视频字幕生成、翻译、嵌入".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "媒体处理".into(), tags: vec!["视频".into(), "字幕".into()], installed: false, update_available: false },
        RemoteSkill { name: "GIF 制作".into(), slug: "gif-maker".into(), description: "从视频/图片生成 GIF 动图".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "媒体处理".into(), tags: vec!["GIF".into()], installed: false, update_available: false },
        RemoteSkill { name: "屏幕录制".into(), slug: "screen-record".into(), description: "屏幕录制、截图、标注".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "媒体处理".into(), tags: vec!["录屏".into()], installed: false, update_available: false },
        RemoteSkill { name: "二维码生成".into(), slug: "qrcode-gen".into(), description: "二维码生成、解析、美化".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "媒体处理".into(), tags: vec!["二维码".into()], installed: false, update_available: false },

        // ========== 生活服务类 ==========
        RemoteSkill { name: "天气查询".into(), slug: "weather".into(), description: "获取实时天气信息和天气预报，支持全球城市查询，无需 API 密钥".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 15000, category: "生活服务".into(), tags: vec!["天气".into(), "生活".into()], installed: false, update_available: false },
        RemoteSkill { name: "汇率查询".into(), slug: "exchange-rate".into(), description: "实时汇率查询、货币换算".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "生活服务".into(), tags: vec!["汇率".into(), "金融".into()], installed: false, update_available: false },
        RemoteSkill { name: "股票查询".into(), slug: "stock-query".into(), description: "股票实时行情、K线图、技术分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "生活服务".into(), tags: vec!["股票".into(), "投资".into()], installed: false, update_available: false },
        RemoteSkill { name: "日历提醒".into(), slug: "calendar-reminder".into(), description: "日程管理、提醒设置、节假日查询".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "生活服务".into(), tags: vec!["日历".into(), "提醒".into()], installed: false, update_available: false },
        RemoteSkill { name: "闹钟定时".into(), slug: "alarm-timer".into(), description: "闹钟设置、倒计时、番茄钟".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "生活服务".into(), tags: vec!["闹钟".into()], installed: false, update_available: false },
        RemoteSkill { name: "快递查询".into(), slug: "express-query".into(), description: "快递物流查询、自动识别快递公司".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "生活服务".into(), tags: vec!["快递".into()], installed: false, update_available: false },
        RemoteSkill { name: "菜谱推荐".into(), slug: "recipe-recommend".into(), description: "根据食材推荐菜谱、烹饪步骤".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "生活服务".into(), tags: vec!["菜谱".into(), "美食".into()], installed: false, update_available: false },
        RemoteSkill { name: "健康咨询".into(), slug: "health-consult".into(), description: "健康知识问答、症状初步分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8500, category: "生活服务".into(), tags: vec!["健康".into()], installed: false, update_available: false },
        RemoteSkill { name: "运动记录".into(), slug: "exercise-tracker".into(), description: "运动数据记录、卡路里计算".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "生活服务".into(), tags: vec!["运动".into()], installed: false, update_available: false },
        RemoteSkill { name: "旅游攻略".into(), slug: "travel-guide".into(), description: "景点推荐、行程规划、酒店预订".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "生活服务".into(), tags: vec!["旅游".into()], installed: false, update_available: false },

        // ========== 网络工具类 ==========
        RemoteSkill { name: "Tailscale 管理".into(), slug: "tailscale".into(), description: "管理 Tailscale 网络连接、设备状态和访问控制".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "网络工具".into(), tags: vec!["VPN".into(), "网络".into()], installed: false, update_available: false },
        RemoteSkill { name: "Agent Browser".into(), slug: "agent-browser".into(), description: "浏览器自动化，支持页面导航、点击、截图，适合爬虫和测试".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "网络工具".into(), tags: vec!["浏览器".into(), "爬虫".into()], installed: false, update_available: false },
        RemoteSkill { name: "Web 搜索".into(), slug: "web-search".into(), description: "使用 DuckDuckGo 搜索网页，无需 API 密钥".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "网络工具".into(), tags: vec!["搜索".into(), "网页".into()], installed: false, update_available: false },
        RemoteSkill { name: "DNS 查询".into(), slug: "dns-query".into(), description: "DNS 解析查询、IP 查询、域名信息".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4000, category: "网络工具".into(), tags: vec!["DNS".into()], installed: false, update_available: false },
        RemoteSkill { name: "IP 工具".into(), slug: "ip-tools".into(), description: "IP 地址查询、归属地查询、网速测试".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "网络工具".into(), tags: vec!["IP".into()], installed: false, update_available: false },
        RemoteSkill { name: "网络监控".into(), slug: "network-monitor".into(), description: "网络状态监控、延迟检测、端口扫描".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "网络工具".into(), tags: vec!["监控".into()], installed: false, update_available: false },
        RemoteSkill { name: "SSL 证书".into(), slug: "ssl-certificate".into(), description: "SSL 证书查询、过期检测、链验证".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 3500, category: "网络工具".into(), tags: vec!["SSL".into()], installed: false, update_available: false },
        RemoteSkill { name: "URL 缩短".into(), slug: "url-shortener".into(), description: "URL 短链接生成、解析、统计".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "网络工具".into(), tags: vec!["URL".into()], installed: false, update_available: false },
        RemoteSkill { name: "HTTP 测试".into(), slug: "http-tester".into(), description: "HTTP 请求测试、API 调试、响应分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "网络工具".into(), tags: vec!["HTTP".into(), "API".into()], installed: false, update_available: false },
        RemoteSkill { name: "代理管理".into(), slug: "proxy-manager".into(), description: "代理服务器配置、切换、测速".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "网络工具".into(), tags: vec!["代理".into()], installed: false, update_available: false },

        // ========== 自动化类 ==========
        RemoteSkill { name: "ClawFlow".into(), slug: "clawflow".into(), description: "工作流自动化引擎，支持任务编排、状态管理、异步执行".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 3000, category: "自动化".into(), tags: vec!["工作流".into()], installed: false, update_available: false },
        RemoteSkill { name: "定时任务".into(), slug: "cron-jobs".into(), description: "Cron 定时任务管理、执行日志、错误通知".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "自动化".into(), tags: vec!["定时".into(), "任务".into()], installed: false, update_available: false },
        RemoteSkill { name: "自动化脚本".into(), slug: "automation-scripts".into(), description: "常用自动化脚本库，一键执行".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "自动化".into(), tags: vec!["脚本".into()], installed: false, update_available: false },
        RemoteSkill { name: "文件监控".into(), slug: "file-watcher".into(), description: "文件变化监控、自动备份、同步".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "自动化".into(), tags: vec!["文件".into(), "监控".into()], installed: false, update_available: false },
        RemoteSkill { name: "消息推送".into(), slug: "message-push".into(), description: "多渠道消息推送：邮件、短信、Webhook".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "自动化".into(), tags: vec!["推送".into()], installed: false, update_available: false },
        RemoteSkill { name: "数据同步".into(), slug: "data-sync".into(), description: "多数据源同步、增量更新、冲突处理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "自动化".into(), tags: vec!["同步".into()], installed: false, update_available: false },
        RemoteSkill { name: "批处理任务".into(), slug: "batch-processing".into(), description: "批量文件处理、图片压缩、格式转换".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "自动化".into(), tags: vec!["批处理".into()], installed: false, update_available: false },
        RemoteSkill { name: "条件触发器".into(), slug: "condition-trigger".into(), description: "基于条件的事件触发、规则引擎".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4000, category: "自动化".into(), tags: vec!["触发器".into()], installed: false, update_available: false },
        RemoteSkill { name: "API 编排".into(), slug: "api-orchestration".into(), description: "多 API 调用编排、数据聚合、错误处理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "自动化".into(), tags: vec!["API".into()], installed: false, update_available: false },
        RemoteSkill { name: "Webhook 接收".into(), slug: "webhook-receiver".into(), description: "Webhook 接收、解析、转发处理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "自动化".into(), tags: vec!["Webhook".into()], installed: false, update_available: false },

        // ========== 云服务类 ==========
        RemoteSkill { name: "腾讯云轻量服务器".into(), slug: "tencentcloud-lighthouse".into(), description: "管理腾讯云轻量应用服务器，支持实例查询、监控告警、远程命令".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 3500, category: "云服务".into(), tags: vec!["腾讯云".into()], installed: false, update_available: false },
        RemoteSkill { name: "腾讯云 COS".into(), slug: "tencent-cloud-cos".into(), description: "腾讯云对象存储管理，支持文件上传下载、图片处理、智能封面".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 2800, category: "云服务".into(), tags: vec!["腾讯云".into(), "COS".into()], installed: false, update_available: false },
        RemoteSkill { name: "阿里云 OSS".into(), slug: "aliyun-oss".into(), description: "阿里云对象存储管理，文件操作、权限设置".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "云服务".into(), tags: vec!["阿里云".into(), "OSS".into()], installed: false, update_available: false },
        RemoteSkill { name: "阿里云 ECS".into(), slug: "aliyun-ecs".into(), description: "阿里云服务器管理，实例操作、监控告警".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 3500, category: "云服务".into(), tags: vec!["阿里云".into(), "ECS".into()], installed: false, update_available: false },
        RemoteSkill { name: "AWS EC2".into(), slug: "aws-ec2".into(), description: "AWS EC2 实例管理、监控、自动伸缩".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4000, category: "云服务".into(), tags: vec!["AWS".into(), "EC2".into()], installed: false, update_available: false },
        RemoteSkill { name: "AWS S3".into(), slug: "aws-s3".into(), description: "AWS S3 对象存储管理、桶操作、权限控制".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 3800, category: "云服务".into(), tags: vec!["AWS".into(), "S3".into()], installed: false, update_available: false },
        RemoteSkill { name: "七牛云存储".into(), slug: "qiniu-storage".into(), description: "七牛云存储管理、CDN 刷新、数据处理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 2500, category: "云服务".into(), tags: vec!["七牛".into()], installed: false, update_available: false },
        RemoteSkill { name: "又拍云存储".into(), slug: "upyun-storage".into(), description: "又拍云存储管理、CDN 加速、图片处理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 2000, category: "云服务".into(), tags: vec!["又拍云".into()], installed: false, update_available: false },
        RemoteSkill { name: "华为云 OBS".into(), slug: "huawei-obs".into(), description: "华为云对象存储管理、文件操作".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 1800, category: "云服务".into(), tags: vec!["华为云".into()], installed: false, update_available: false },
        RemoteSkill { name: "百度云 BOS".into(), slug: "baidu-bos".into(), description: "百度云对象存储管理、数据处理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 1500, category: "云服务".into(), tags: vec!["百度云".into()], installed: false, update_available: false },

        // ========== 系统工具类 ==========
        RemoteSkill { name: "系统健康检查".into(), slug: "healthcheck".into(), description: "检查系统安全配置、SSH 加固、防火墙设置，支持自动化修复".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4000, category: "系统工具".into(), tags: vec!["安全".into(), "运维".into()], installed: false, update_available: false },
        RemoteSkill { name: "进程管理".into(), slug: "process-manager".into(), description: "进程监控、资源占用分析、自动重启".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "系统工具".into(), tags: vec!["进程".into()], installed: false, update_available: false },
        RemoteSkill { name: "磁盘清理".into(), slug: "disk-cleaner".into(), description: "磁盘空间分析、垃圾文件清理、大文件查找".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "系统工具".into(), tags: vec!["磁盘".into(), "清理".into()], installed: false, update_available: false },
        RemoteSkill { name: "系统备份".into(), slug: "system-backup".into(), description: "系统备份、增量备份、恢复操作".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "系统工具".into(), tags: vec!["备份".into()], installed: false, update_available: false },
        RemoteSkill { name: "日志分析".into(), slug: "log-analyzer".into(), description: "日志文件分析、错误提取、告警规则".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "系统工具".into(), tags: vec!["日志".into()], installed: false, update_available: false },
        RemoteSkill { name: "性能监控".into(), slug: "performance-monitor".into(), description: "CPU、内存、网络性能监控、告警".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "系统工具".into(), tags: vec!["监控".into(), "性能".into()], installed: false, update_available: false },
        RemoteSkill { name: "服务管理".into(), slug: "service-manager".into(), description: "系统服务管理、启动停止、自启动配置".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "系统工具".into(), tags: vec!["服务".into()], installed: false, update_available: false },
        RemoteSkill { name: "用户管理".into(), slug: "user-manager".into(), description: "系统用户管理、权限设置、登录日志".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 3500, category: "系统工具".into(), tags: vec!["用户".into()], installed: false, update_available: false },
        RemoteSkill { name: "定时关机".into(), slug: "scheduled-shutdown".into(), description: "定时关机、重启、休眠".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 3000, category: "系统工具".into(), tags: vec!["定时".into()], installed: false, update_available: false },
        RemoteSkill { name: "环境变量管理".into(), slug: "env-manager".into(), description: "环境变量查看、修改、备份".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4000, category: "系统工具".into(), tags: vec!["环境变量".into()], installed: false, update_available: false },

        // ========== 数据处理类 ==========
        RemoteSkill { name: "JSON 格式化".into(), slug: "json-formatter".into(), description: "JSON 格式化、校验、转换".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "数据处理".into(), tags: vec!["JSON".into()], installed: false, update_available: false },
        RemoteSkill { name: "CSV 处理".into(), slug: "csv-processor".into(), description: "CSV 文件处理、转换、分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "数据处理".into(), tags: vec!["CSV".into()], installed: false, update_available: false },
        RemoteSkill { name: "XML 处理".into(), slug: "xml-processor".into(), description: "XML 文件处理、转换、验证".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 3500, category: "数据处理".into(), tags: vec!["XML".into()], installed: false, update_available: false },
        RemoteSkill { name: "YAML 处理".into(), slug: "yaml-processor".into(), description: "YAML 文件处理、转换、校验".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "数据处理".into(), tags: vec!["YAML".into()], installed: false, update_available: false },
        RemoteSkill { name: "正则表达式".into(), slug: "regex-helper".into(), description: "正则表达式生成、测试、解释".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "数据处理".into(), tags: vec!["正则".into()], installed: false, update_available: false },
        RemoteSkill { name: "Base64 编码".into(), slug: "base64-encoder".into(), description: "Base64 编码解码、文件转换".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "数据处理".into(), tags: vec!["Base64".into()], installed: false, update_available: false },
        RemoteSkill { name: "Hash 计算".into(), slug: "hash-calculator".into(), description: "MD5、SHA、CRC 等哈希计算".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "数据处理".into(), tags: vec!["Hash".into()], installed: false, update_available: false },
        RemoteSkill { name: "加密解密".into(), slug: "encryption-tool".into(), description: "AES、RSA 等加密解密操作".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "数据处理".into(), tags: vec!["加密".into()], installed: false, update_available: false },
        RemoteSkill { name: "数据脱敏".into(), slug: "data-mask".into(), description: "敏感数据脱敏、格式化".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4000, category: "数据处理".into(), tags: vec!["脱敏".into()], installed: false, update_available: false },
        RemoteSkill { name: "随机数生成".into(), slug: "random-generator".into(), description: "随机数、随机字符串、UUID 生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "数据处理".into(), tags: vec!["随机".into()], installed: false, update_available: false },

        // ========== 文本处理类 ==========
        RemoteSkill { name: "文本对比".into(), slug: "text-diff".into(), description: "文本差异对比、高亮显示".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "文本处理".into(), tags: vec!["对比".into()], installed: false, update_available: false },
        RemoteSkill { name: "文本统计".into(), slug: "text-counter".into(), description: "字数统计、词频分析、阅读时间".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "文本处理".into(), tags: vec!["统计".into()], installed: false, update_available: false },
        RemoteSkill { name: "文本转换".into(), slug: "text-converter".into(), description: "大小写转换、编码转换、格式化".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "文本处理".into(), tags: vec!["转换".into()], installed: false, update_available: false },
        RemoteSkill { name: "拼写检查".into(), slug: "spell-checker".into(), description: "中英文拼写检查、纠正建议".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "文本处理".into(), tags: vec!["拼写".into()], installed: false, update_available: false },
        RemoteSkill { name: "文本生成".into(), slug: "text-generator".into(), description: "AI 文本生成、续写、改写".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "文本处理".into(), tags: vec!["生成".into()], installed: false, update_available: false },
        RemoteSkill { name: "文章摘要".into(), slug: "article-summary".into(), description: "长文章自动摘要、关键点提取".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "文本处理".into(), tags: vec!["摘要".into()], installed: false, update_available: false },
        RemoteSkill { name: "关键词提取".into(), slug: "keyword-extractor".into(), description: "文章关键词提取、标签生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "文本处理".into(), tags: vec!["关键词".into()], installed: false, update_available: false },
        RemoteSkill { name: "情感分析".into(), slug: "sentiment-analysis".into(), description: "文本情感分析、观点提取".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "文本处理".into(), tags: vec!["情感".into()], installed: false, update_available: false },
        RemoteSkill { name: "文本分词".into(), slug: "text-segment".into(), description: "中文分词、词性标注".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "文本处理".into(), tags: vec!["分词".into()], installed: false, update_available: false },
        RemoteSkill { name: "文本清洗".into(), slug: "text-cleaner".into(), description: "去除特殊字符、空格、HTML 标签".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "文本处理".into(), tags: vec!["清洗".into()], installed: false, update_available: false },

        // ========== 翻译类 ==========
        RemoteSkill { name: "实时翻译".into(), slug: "realtime-translate".into(), description: "多语言实时翻译、语音翻译".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 15000, category: "翻译".into(), tags: vec!["翻译".into()], installed: false, update_available: false },
        RemoteSkill { name: "批量翻译".into(), slug: "batch-translate".into(), description: "批量文本翻译、文件翻译".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "翻译".into(), tags: vec!["翻译".into(), "批量".into()], installed: false, update_available: false },
        RemoteSkill { name: "专业术语翻译".into(), slug: "term-translate".into(), description: "技术文档专业术语翻译".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "翻译".into(), tags: vec!["术语".into()], installed: false, update_available: false },
        RemoteSkill { name: "双语对照".into(), slug: "bilingual-viewer".into(), description: "中英双语对照显示".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "翻译".into(), tags: vec!["双语".into()], installed: false, update_available: false },
        RemoteSkill { name: "OCR 翻译".into(), slug: "ocr-translate".into(), description: "图片文字识别翻译".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "翻译".into(), tags: vec!["OCR".into(), "翻译".into()], installed: false, update_available: false },

        // ========== 学习教育类 ==========
        RemoteSkill { name: "英语学习".into(), slug: "english-learning".into(), description: "英语单词、语法、口语练习".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "学习教育".into(), tags: vec!["英语".into()], installed: false, update_available: false },
        RemoteSkill { name: "日语学习".into(), slug: "japanese-learning".into(), description: "日语假名、语法、词汇学习".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "学习教育".into(), tags: vec!["日语".into()], installed: false, update_available: false },
        RemoteSkill { name: "编程学习".into(), slug: "programming-learning".into(), description: "编程入门、代码讲解、项目实战".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "学习教育".into(), tags: vec!["编程".into()], installed: false, update_available: false },
        RemoteSkill { name: "数学解题".into(), slug: "math-solver".into(), description: "数学题目解答、步骤详解".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8500, category: "学习教育".into(), tags: vec!["数学".into()], installed: false, update_available: false },
        RemoteSkill { name: "考试助手".into(), slug: "exam-assistant".into(), description: "考试复习、题目练习、知识点总结".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "学习教育".into(), tags: vec!["考试".into()], installed: false, update_available: false },
        RemoteSkill { name: "知识问答".into(), slug: "knowledge-qa".into(), description: "百科知识问答、常识普及".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "学习教育".into(), tags: vec!["知识".into()], installed: false, update_available: false },
        RemoteSkill { name: "写作助手".into(), slug: "writing-assistant".into(), description: "作文批改、写作建议、素材推荐".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "学习教育".into(), tags: vec!["写作".into()], installed: false, update_available: false },
        RemoteSkill { name: "读书笔记".into(), slug: "reading-notes".into(), description: "读书笔记管理、摘要生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "学习教育".into(), tags: vec!["读书".into()], installed: false, update_available: false },
        RemoteSkill { name: "语言纠错".into(), slug: "language-corrector".into(), description: "语法检查、表达优化、风格建议".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "学习教育".into(), tags: vec!["纠错".into()], installed: false, update_available: false },
        RemoteSkill { name: "概念解释".into(), slug: "concept-explainer".into(), description: "复杂概念通俗解释、类比说明".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "学习教育".into(), tags: vec!["解释".into()], installed: false, update_available: false },

        // ========== 效率工具类 ==========
        RemoteSkill { name: "待办事项".into(), slug: "todo-list".into(), description: "任务管理、提醒、进度跟踪".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "效率工具".into(), tags: vec!["待办".into()], installed: false, update_available: false },
        RemoteSkill { name: "时间追踪".into(), slug: "time-tracker".into(), description: "工作时间记录、效率分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "效率工具".into(), tags: vec!["时间".into()], installed: false, update_available: false },
        RemoteSkill { name: "笔记管理".into(), slug: "note-manager".into(), description: "多平台笔记同步、分类管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "效率工具".into(), tags: vec!["笔记".into()], installed: false, update_available: false },
        RemoteSkill { name: "书签管理".into(), slug: "bookmark-manager".into(), description: "网页书签管理、分类、搜索".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "效率工具".into(), tags: vec!["书签".into()], installed: false, update_available: false },
        RemoteSkill { name: "剪贴板历史".into(), slug: "clipboard-history".into(), description: "剪贴板历史记录、搜索、管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "效率工具".into(), tags: vec!["剪贴板".into()], installed: false, update_available: false },
        RemoteSkill { name: "快捷指令".into(), slug: "shortcuts".into(), description: "常用操作快捷指令、自定义动作".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "效率工具".into(), tags: vec!["快捷".into()], installed: false, update_available: false },
        RemoteSkill { name: "会议纪要".into(), slug: "meeting-notes".into(), description: "会议记录、纪要生成、任务分配".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "效率工具".into(), tags: vec!["会议".into()], installed: false, update_available: false },
        RemoteSkill { name: "邮件助手".into(), slug: "email-assistant".into(), description: "邮件撰写、分类、回复建议".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "效率工具".into(), tags: vec!["邮件".into()], installed: false, update_available: false },
        RemoteSkill { name: "项目管理".into(), slug: "project-manager".into(), description: "项目进度管理、任务分配、风险预警".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "效率工具".into(), tags: vec!["项目".into()], installed: false, update_available: false },
        RemoteSkill { name: "目标追踪".into(), slug: "goal-tracker".into(), description: "目标设定、进度追踪、复盘总结".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "效率工具".into(), tags: vec!["目标".into()], installed: false, update_available: false },

        // ========== 金融理财类 ==========
        RemoteSkill { name: "记账助手".into(), slug: "accounting-assistant".into(), description: "收支记录、分类统计、财务分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "金融理财".into(), tags: vec!["记账".into()], installed: false, update_available: false },
        RemoteSkill { name: "投资分析".into(), slug: "investment-analysis".into(), description: "股票分析、基金筛选、投资建议".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "金融理财".into(), tags: vec!["投资".into()], installed: false, update_available: false },
        RemoteSkill { name: "理财规划".into(), slug: "financial-planning".into(), description: "个人理财规划、资产配置建议".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "金融理财".into(), tags: vec!["理财".into()], installed: false, update_available: false },
        RemoteSkill { name: "税务计算".into(), slug: "tax-calculator".into(), description: "个税计算、税务筹划、申报提醒".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "金融理财".into(), tags: vec!["税务".into()], installed: false, update_available: false },
        RemoteSkill { name: "贷款计算".into(), slug: "loan-calculator".into(), description: "房贷、车贷计算、还款计划".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "金融理财".into(), tags: vec!["贷款".into()], installed: false, update_available: false },
        RemoteSkill { name: "保险咨询".into(), slug: "insurance-consult".into(), description: "保险产品对比、方案推荐".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 3500, category: "金融理财".into(), tags: vec!["保险".into()], installed: false, update_available: false },
        RemoteSkill { name: "信用卡管理".into(), slug: "credit-card-manager".into(), description: "信用卡账单管理、还款提醒".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4000, category: "金融理财".into(), tags: vec!["信用卡".into()], installed: false, update_available: false },
        RemoteSkill { name: "预算管理".into(), slug: "budget-manager".into(), description: "月度预算、消费分析、超支预警".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "金融理财".into(), tags: vec!["预算".into()], installed: false, update_available: false },

        // ========== 游戏娱乐类 ==========
        RemoteSkill { name: "游戏攻略".into(), slug: "game-guide".into(), description: "游戏攻略查询、角色推荐、装备搭配".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "游戏娱乐".into(), tags: vec!["游戏".into()], installed: false, update_available: false },
        RemoteSkill { name: "笑话大全".into(), slug: "jokes".into(), description: "笑话段子、幽默故事、每日一乐".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "游戏娱乐".into(), tags: vec!["笑话".into()], installed: false, update_available: false },
        RemoteSkill { name: "谜语大全".into(), slug: "riddles".into(), description: "谜语猜谜、脑筋急转弯".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "游戏娱乐".into(), tags: vec!["谜语".into()], installed: false, update_available: false },
        RemoteSkill { name: "运势查询".into(), slug: "fortune-teller".into(), description: "星座运势、生肖运势、每日运势".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "游戏娱乐".into(), tags: vec!["运势".into()], installed: false, update_available: false },
        RemoteSkill { name: "名字生成".into(), slug: "name-generator".into(), description: "中文名字生成、英文名建议、起名参考".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "游戏娱乐".into(), tags: vec!["起名".into()], installed: false, update_available: false },
        RemoteSkill { name: "对联生成".into(), slug: "couplet-generator".into(), description: "对联创作、诗词生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "游戏娱乐".into(), tags: vec!["对联".into()], installed: false, update_available: false },
        RemoteSkill { name: "段子生成".into(), slug: "joke-generator".into(), description: "创意段子生成、吐槽文案".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "游戏娱乐".into(), tags: vec!["段子".into()], installed: false, update_available: false },
        RemoteSkill { name: "表情包生成".into(), slug: "meme-generator".into(), description: "表情包制作、文字配图".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "游戏娱乐".into(), tags: vec!["表情包".into()], installed: false, update_available: false },

        // ========== 设计创意类 ==========
        RemoteSkill { name: "Logo 设计".into(), slug: "logo-designer".into(), description: "AI Logo 设计、品牌标识生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "设计创意".into(), tags: vec!["Logo".into()], installed: false, update_available: false },
        RemoteSkill { name: "配色方案".into(), slug: "color-palette".into(), description: "配色方案推荐、色彩搭配建议".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "设计创意".into(), tags: vec!["配色".into()], installed: false, update_available: false },
        RemoteSkill { name: "字体推荐".into(), slug: "font-recommend".into(), description: "字体推荐、搭配建议、版权查询".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "设计创意".into(), tags: vec!["字体".into()], installed: false, update_available: false },
        RemoteSkill { name: "文案生成".into(), slug: "copywriting".into(), description: "广告文案、营销文案、产品描述".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "设计创意".into(), tags: vec!["文案".into()], installed: false, update_available: false },
        RemoteSkill { name: "PPT 模板".into(), slug: "ppt-template".into(), description: "PPT 模板推荐、大纲生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "设计创意".into(), tags: vec!["PPT".into()], installed: false, update_available: false },
        RemoteSkill { name: "海报设计".into(), slug: "poster-design".into(), description: "海报文案、设计建议、模板推荐".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "设计创意".into(), tags: vec!["海报".into()], installed: false, update_available: false },
        RemoteSkill { name: "UI 设计建议".into(), slug: "ui-design-tips".into(), description: "UI 设计建议、交互优化、用户体验".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "设计创意".into(), tags: vec!["UI".into()], installed: false, update_available: false },
        RemoteSkill { name: "图标推荐".into(), slug: "icon-recommend".into(), description: "图标资源推荐、设计建议".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4000, category: "设计创意".into(), tags: vec!["图标".into()], installed: false, update_available: false },

        // ========== 社交媒体类 ==========
        RemoteSkill { name: "微博助手".into(), slug: "weibo-assistant".into(), description: "微博内容发布、热搜监控、数据分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "社交媒体".into(), tags: vec!["微博".into()], installed: false, update_available: false },
        RemoteSkill { name: "小红书助手".into(), slug: "xiaohongshu-assistant".into(), description: "小红书内容创作、热门话题、关键词优化".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "社交媒体".into(), tags: vec!["小红书".into()], installed: false, update_available: false },
        RemoteSkill { name: "抖音助手".into(), slug: "douyin-assistant".into(), description: "抖音内容策划、热门音乐、数据分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 13000, category: "社交媒体".into(), tags: vec!["抖音".into()], installed: false, update_available: false },
        RemoteSkill { name: "B站助手".into(), slug: "bilibili-assistant".into(), description: "B站内容创作、弹幕分析、UP主工具".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "社交媒体".into(), tags: vec!["B站".into()], installed: false, update_available: false },
        RemoteSkill { name: "知乎助手".into(), slug: "zhihu-assistant".into(), description: "知乎问答创作、热榜监控、专栏管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "社交媒体".into(), tags: vec!["知乎".into()], installed: false, update_available: false },
        RemoteSkill { name: "公众号助手".into(), slug: "wechat-official-assistant".into(), description: "公众号内容创作、排版、数据分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "社交媒体".into(), tags: vec!["公众号".into()], installed: false, update_available: false },
        RemoteSkill { name: "视频号助手".into(), slug: "channels-assistant".into(), description: "视频号内容策划、数据分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "社交媒体".into(), tags: vec!["视频号".into()], installed: false, update_available: false },
        RemoteSkill { name: "Twitter 助手".into(), slug: "twitter-assistant".into(), description: "Twitter 内容发布、趋势监控".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "社交媒体".into(), tags: vec!["Twitter".into()], installed: false, update_available: false },
        RemoteSkill { name: "Instagram 助手".into(), slug: "instagram-assistant".into(), description: "Instagram 内容创作、标签推荐".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "社交媒体".into(), tags: vec!["Instagram".into()], installed: false, update_available: false },
        RemoteSkill { name: "YouTube 助手".into(), slug: "youtube-assistant".into(), description: "YouTube 视频策划、标题优化、标签推荐".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "社交媒体".into(), tags: vec!["YouTube".into()], installed: false, update_available: false },

        // ========== 电商运营类 ==========
        RemoteSkill { name: "淘宝助手".into(), slug: "taobao-assistant".into(), description: "淘宝店铺运营、商品优化、数据分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "电商运营".into(), tags: vec!["淘宝".into()], installed: false, update_available: false },
        RemoteSkill { name: "京东助手".into(), slug: "jd-assistant".into(), description: "京东店铺运营、活动策划、数据分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "电商运营".into(), tags: vec!["京东".into()], installed: false, update_available: false },
        RemoteSkill { name: "拼多多助手".into(), slug: "pdd-assistant".into(), description: "拼多多店铺运营、爆款打造、数据分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "电商运营".into(), tags: vec!["拼多多".into()], installed: false, update_available: false },
        RemoteSkill { name: "商品描述生成".into(), slug: "product-description".into(), description: "电商商品描述文案生成、卖点提炼".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8500, category: "电商运营".into(), tags: vec!["商品".into()], installed: false, update_available: false },
        RemoteSkill { name: "客服话术".into(), slug: "customer-service-script".into(), description: "电商客服话术生成、常见问题回复".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "电商运营".into(), tags: vec!["客服".into()], installed: false, update_available: false },
        RemoteSkill { name: "竞品分析".into(), slug: "competitor-analysis".into(), description: "电商竞品分析、价格监控、策略建议".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "电商运营".into(), tags: vec!["竞品".into()], installed: false, update_available: false },
        RemoteSkill { name: "活动策划".into(), slug: "campaign-planner".into(), description: "电商活动策划、促销方案、文案撰写".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "电商运营".into(), tags: vec!["活动".into()], installed: false, update_available: false },
        RemoteSkill { name: "直播脚本".into(), slug: "livestream-script".into(), description: "电商直播脚本撰写、话术准备".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "电商运营".into(), tags: vec!["直播".into()], installed: false, update_available: false },

        // ========== 法律咨询类 ==========
        RemoteSkill { name: "法律咨询".into(), slug: "legal-consult".into(), description: "法律问题咨询、法规查询".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "法律咨询".into(), tags: vec!["法律".into()], installed: false, update_available: false },
        RemoteSkill { name: "合同审查".into(), slug: "contract-review".into(), description: "合同条款审查、风险提示".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "法律咨询".into(), tags: vec!["合同".into()], installed: false, update_available: false },
        RemoteSkill { name: "法律文书".into(), slug: "legal-documents".into(), description: "法律文书生成、模板参考".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "法律咨询".into(), tags: vec!["文书".into()], installed: false, update_available: false },
        RemoteSkill { name: "劳动法咨询".into(), slug: "labor-law".into(), description: "劳动法问题咨询、权益保护".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "法律咨询".into(), tags: vec!["劳动法".into()], installed: false, update_available: false },
        RemoteSkill { name: "知识产权".into(), slug: "intellectual-property".into(), description: "商标、专利、版权咨询".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 3500, category: "法律咨询".into(), tags: vec!["知识产权".into()], installed: false, update_available: false },

        // ========== 其他工具类 ==========
        RemoteSkill { name: "单位换算".into(), slug: "unit-converter".into(), description: "长度、重量、温度等单位换算".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "其他工具".into(), tags: vec!["换算".into()], installed: false, update_available: false },
        RemoteSkill { name: "时区转换".into(), slug: "timezone-converter".into(), description: "全球时区转换、时间对比".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "其他工具".into(), tags: vec!["时区".into()], installed: false, update_available: false },
        RemoteSkill { name: "颜色转换".into(), slug: "color-converter".into(), description: "RGB、HEX、HSL 等颜色格式转换".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "其他工具".into(), tags: vec!["颜色".into()], installed: false, update_available: false },
        RemoteSkill { name: "进制转换".into(), slug: "number-base-converter".into(), description: "二进制、八进制、十进制、十六进制转换".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 3500, category: "其他工具".into(), tags: vec!["进制".into()], installed: false, update_available: false },
        RemoteSkill { name: "世界时钟".into(), slug: "world-clock".into(), description: "全球城市时间查询、时钟展示".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4000, category: "其他工具".into(), tags: vec!["时钟".into()], installed: false, update_available: false },

        // ========== API 集成类 ==========
        RemoteSkill { name: "OpenAI API".into(), slug: "openai-api".into(), description: "OpenAI GPT 模型调用、ChatGPT 集成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 25000, category: "API 集成".into(), tags: vec!["OpenAI".into(), "GPT".into()], installed: false, update_available: false },
        RemoteSkill { name: "Claude API".into(), slug: "claude-api".into(), description: "Anthropic Claude 模型调用、AI 对话".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 18000, category: "API 集成".into(), tags: vec!["Claude".into(), "Anthropic".into()], installed: false, update_available: false },
        RemoteSkill { name: "Gemini API".into(), slug: "gemini-api".into(), description: "Google Gemini 模型调用、多模态 AI".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 15000, category: "API 集成".into(), tags: vec!["Gemini".into(), "Google".into()], installed: false, update_available: false },
        RemoteSkill { name: "文心一言 API".into(), slug: "ernie-api".into(), description: "百度文心一言模型调用".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "API 集成".into(), tags: vec!["文心".into(), "百度".into()], installed: false, update_available: false },
        RemoteSkill { name: "通义千问 API".into(), slug: "qwen-api".into(), description: "阿里通义千问模型调用".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "API 集成".into(), tags: vec!["通义".into(), "阿里".into()], installed: false, update_available: false },
        RemoteSkill { name: "讯飞星火 API".into(), slug: "spark-api".into(), description: "讯飞星火大模型调用".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "API 集成".into(), tags: vec!["星火".into(), "讯飞".into()], installed: false, update_available: false },
        RemoteSkill { name: "智谱 AI API".into(), slug: "zhipu-api".into(), description: "智谱 GLM 模型调用".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "API 集成".into(), tags: vec!["智谱".into(), "GLM".into()], installed: false, update_available: false },
        RemoteSkill { name: "DeepSeek API".into(), slug: "deepseek-api".into(), description: "DeepSeek 模型调用、代码生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "API 集成".into(), tags: vec!["DeepSeek".into()], installed: false, update_available: false },
        RemoteSkill { name: "月之暗面 API".into(), slug: "moonshot-api".into(), description: "Kimi 模型调用、长文本处理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "API 集成".into(), tags: vec!["Kimi".into()], installed: false, update_available: false },
        RemoteSkill { name: "Stability AI API".into(), slug: "stability-api".into(), description: "Stable Diffusion 图像生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "API 集成".into(), tags: vec!["Stable".into(), "绘图".into()], installed: false, update_available: false },
        RemoteSkill { name: "Midjourney API".into(), slug: "midjourney-api".into(), description: "Midjourney 图像生成集成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 14000, category: "API 集成".into(), tags: vec!["Midjourney".into(), "绘图".into()], installed: false, update_available: false },
        RemoteSkill { name: "DALL-E API".into(), slug: "dalle-api".into(), description: "OpenAI DALL-E 图像生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "API 集成".into(), tags: vec!["DALL-E".into(), "绘图".into()], installed: false, update_available: false },
        RemoteSkill { name: "ElevenLabs API".into(), slug: "elevenlabs-api".into(), description: "ElevenLabs 语音合成、克隆".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "API 集成".into(), tags: vec!["语音".into(), "TTS".into()], installed: false, update_available: false },
        RemoteSkill { name: "Whisper API".into(), slug: "whisper-api".into(), description: "OpenAI Whisper 语音识别".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8500, category: "API 集成".into(), tags: vec!["语音".into(), "ASR".into()], installed: false, update_available: false },
        RemoteSkill { name: "Pinecone 向量库".into(), slug: "pinecone-api".into(), description: "Pinecone 向量数据库集成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "API 集成".into(), tags: vec!["向量".into(), "Pinecone".into()], installed: false, update_available: false },
        RemoteSkill { name: "Milvus 向量库".into(), slug: "milvus-api".into(), description: "Milvus 向量数据库集成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "API 集成".into(), tags: vec!["向量".into(), "Milvus".into()], installed: false, update_available: false },
        RemoteSkill { name: "LangChain 集成".into(), slug: "langchain-api".into(), description: "LangChain 框架集成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "API 集成".into(), tags: vec!["LangChain".into()], installed: false, update_available: false },
        RemoteSkill { name: "LlamaIndex 集成".into(), slug: "llamaindex-api".into(), description: "LlamaIndex 知识库框架".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "API 集成".into(), tags: vec!["LlamaIndex".into()], installed: false, update_available: false },

        // ========== 数据分析类 ==========
        RemoteSkill { name: "数据可视化".into(), slug: "data-visualization".into(), description: "数据图表生成、可视化分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "数据分析".into(), tags: vec!["可视化".into(), "图表".into()], installed: false, update_available: false },
        RemoteSkill { name: "Python 数据分析".into(), slug: "python-data-analysis".into(), description: "Pandas、NumPy 数据分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "数据分析".into(), tags: vec!["Python".into(), "Pandas".into()], installed: false, update_available: false },
        RemoteSkill { name: "SQL 查询助手".into(), slug: "sql-assistant".into(), description: "SQL 语句生成、优化、解释".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "数据分析".into(), tags: vec!["SQL".into()], installed: false, update_available: false },
        RemoteSkill { name: "Excel 数据分析".into(), slug: "excel-analysis".into(), description: "Excel 数据处理、公式生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8500, category: "数据分析".into(), tags: vec!["Excel".into()], installed: false, update_available: false },
        RemoteSkill { name: "统计报表".into(), slug: "statistical-report".into(), description: "统计分析、报表生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "数据分析".into(), tags: vec!["统计".into()], installed: false, update_available: false },
        RemoteSkill { name: "机器学习".into(), slug: "machine-learning".into(), description: "机器学习模型训练、预测".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "数据分析".into(), tags: vec!["ML".into(), "AI".into()], installed: false, update_available: false },
        RemoteSkill { name: "数据清洗".into(), slug: "data-cleaning".into(), description: "数据预处理、缺失值处理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "数据分析".into(), tags: vec!["清洗".into()], installed: false, update_available: false },
        RemoteSkill { name: "数据采集".into(), slug: "data-collection".into(), description: "网页数据抓取、API 数据采集".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "数据分析".into(), tags: vec!["采集".into(), "爬虫".into()], installed: false, update_available: false },
        RemoteSkill { name: "数据报表生成".into(), slug: "report-generator".into(), description: "自动化数据报表生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "数据分析".into(), tags: vec!["报表".into()], installed: false, update_available: false },
        RemoteSkill { name: "数据挖掘".into(), slug: "data-mining".into(), description: "数据模式发现、关联分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "数据分析".into(), tags: vec!["挖掘".into()], installed: false, update_available: false },

        // ========== 智能写作类 ==========
        RemoteSkill { name: "文章续写".into(), slug: "article-continuation".into(), description: "AI 文章续写、内容扩展".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 15000, category: "智能写作".into(), tags: vec!["续写".into(), "写作".into()], installed: false, update_available: false },
        RemoteSkill { name: "标题生成".into(), slug: "title-generator".into(), description: "吸引眼球标题生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "智能写作".into(), tags: vec!["标题".into()], installed: false, update_available: false },
        RemoteSkill { name: "内容改写".into(), slug: "content-rewrite".into(), description: "文章改写、降重、伪原创".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 13000, category: "智能写作".into(), tags: vec!["改写".into()], installed: false, update_available: false },
        RemoteSkill { name: "小说创作".into(), slug: "novel-writing".into(), description: "小说情节生成、人物设定".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "智能写作".into(), tags: vec!["小说".into()], installed: false, update_available: false },
        RemoteSkill { name: "诗歌创作".into(), slug: "poetry-writing".into(), description: "古诗词、现代诗创作".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "智能写作".into(), tags: vec!["诗歌".into()], installed: false, update_available: false },
        RemoteSkill { name: "公文写作".into(), slug: "official-writing".into(), description: "公文格式、模板生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "智能写作".into(), tags: vec!["公文".into()], installed: false, update_available: false },
        RemoteSkill { name: "邮件撰写".into(), slug: "email-writing".into(), description: "商务邮件、通知撰写".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8500, category: "智能写作".into(), tags: vec!["邮件".into()], installed: false, update_available: false },
        RemoteSkill { name: "简历优化".into(), slug: "resume-optimizer".into(), description: "简历润色、亮点提炼".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "智能写作".into(), tags: vec!["简历".into()], installed: false, update_available: false },
        RemoteSkill { name: "演讲稿".into(), slug: "speech-writing".into(), description: "演讲稿撰写、大纲生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "智能写作".into(), tags: vec!["演讲".into()], installed: false, update_available: false },
        RemoteSkill { name: "新闻稿".into(), slug: "press-release".into(), description: "新闻稿撰写、通稿生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "智能写作".into(), tags: vec!["新闻".into()], installed: false, update_available: false },

        // ========== 图片生成类 ==========
        RemoteSkill { name: "AI 绘画".into(), slug: "ai-painting".into(), description: "AI 图像生成、艺术创作".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 20000, category: "图片生成".into(), tags: vec!["AI".into(), "绘画".into()], installed: false, update_available: false },
        RemoteSkill { name: "图片修复".into(), slug: "image-restoration".into(), description: "老照片修复、图片增强".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "图片生成".into(), tags: vec!["修复".into()], installed: false, update_available: false },
        RemoteSkill { name: "背景移除".into(), slug: "background-removal".into(), description: "自动抠图、背景替换".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 15000, category: "图片生成".into(), tags: vec!["抠图".into()], installed: false, update_available: false },
        RemoteSkill { name: "图片放大".into(), slug: "image-upscaling".into(), description: "AI 图片放大、超分辨率".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "图片生成".into(), tags: vec!["放大".into()], installed: false, update_available: false },
        RemoteSkill { name: "人脸融合".into(), slug: "face-swap".into(), description: "AI 换脸、人脸融合".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 18000, category: "图片生成".into(), tags: vec!["人脸".into()], installed: false, update_available: false },
        RemoteSkill { name: "图片风格化".into(), slug: "image-stylization".into(), description: "艺术风格转换、滤镜".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8500, category: "图片生成".into(), tags: vec!["风格".into()], installed: false, update_available: false },
        RemoteSkill { name: "图片描述".into(), slug: "image-caption".into(), description: "AI 图片描述、图说生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "图片生成".into(), tags: vec!["描述".into()], installed: false, update_available: false },
        RemoteSkill { name: "Logo 生成".into(), slug: "logo-generator".into(), description: "AI Logo 设计生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "图片生成".into(), tags: vec!["Logo".into()], installed: false, update_available: false },
        RemoteSkill { name: "海报生成".into(), slug: "poster-generator".into(), description: "AI 海报自动生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "图片生成".into(), tags: vec!["海报".into()], installed: false, update_available: false },
        RemoteSkill { name: "证件照制作".into(), slug: "id-photo-maker".into(), description: "证件照自动生成、换底色".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 13000, category: "图片生成".into(), tags: vec!["证件照".into()], installed: false, update_available: false },

        // ========== 视频处理类 ==========
        RemoteSkill { name: "视频剪辑".into(), slug: "video-editing".into(), description: "AI 视频剪辑、片段拼接".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 14000, category: "视频处理".into(), tags: vec!["剪辑".into()], installed: false, update_available: false },
        RemoteSkill { name: "视频字幕生成".into(), slug: "video-subtitle-gen".into(), description: "自动生成视频字幕、翻译".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "视频处理".into(), tags: vec!["字幕".into()], installed: false, update_available: false },
        RemoteSkill { name: "视频配音".into(), slug: "video-dubbing".into(), description: "AI 视频配音、旁白生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "视频处理".into(), tags: vec!["配音".into()], installed: false, update_available: false },
        RemoteSkill { name: "视频压缩".into(), slug: "video-compression".into(), description: "视频压缩、格式转换".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "视频处理".into(), tags: vec!["压缩".into()], installed: false, update_available: false },
        RemoteSkill { name: "视频水印".into(), slug: "video-watermark".into(), description: "视频水印添加、去除".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "视频处理".into(), tags: vec!["水印".into()], installed: false, update_available: false },
        RemoteSkill { name: "视频转 GIF".into(), slug: "video-to-gif".into(), description: "视频片段转 GIF 动图".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "视频处理".into(), tags: vec!["GIF".into()], installed: false, update_available: false },
        RemoteSkill { name: "视频截图".into(), slug: "video-screenshot".into(), description: "视频截图、批量截取".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "视频处理".into(), tags: vec!["截图".into()], installed: false, update_available: false },
        RemoteSkill { name: "视频封面生成".into(), slug: "video-thumbnail".into(), description: "自动生成视频封面图".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "视频处理".into(), tags: vec!["封面".into()], installed: false, update_available: false },
        RemoteSkill { name: "视频去重".into(), slug: "video-dedup".into(), description: "视频去重、相似检测".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "视频处理".into(), tags: vec!["去重".into()], installed: false, update_available: false },
        RemoteSkill { name: "直播推流".into(), slug: "livestream-push".into(), description: "直播推流、RTMP 集成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "视频处理".into(), tags: vec!["直播".into()], installed: false, update_available: false },

        // ========== 语音处理类 ==========
        RemoteSkill { name: "语音识别".into(), slug: "speech-recognition".into(), description: "语音转文字、多语言识别".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 16000, category: "语音处理".into(), tags: vec!["ASR".into()], installed: false, update_available: false },
        RemoteSkill { name: "语音合成".into(), slug: "speech-synthesis".into(), description: "文字转语音、多种音色".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 14000, category: "语音处理".into(), tags: vec!["TTS".into()], installed: false, update_available: false },
        RemoteSkill { name: "语音克隆".into(), slug: "voice-cloning".into(), description: "声音克隆、个性化语音".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "语音处理".into(), tags: vec!["克隆".into()], installed: false, update_available: false },
        RemoteSkill { name: "语音降噪".into(), slug: "noise-reduction".into(), description: "音频降噪、音质增强".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "语音处理".into(), tags: vec!["降噪".into()], installed: false, update_available: false },
        RemoteSkill { name: "语音翻译".into(), slug: "voice-translation".into(), description: "语音实时翻译".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "语音处理".into(), tags: vec!["翻译".into()], installed: false, update_available: false },
        RemoteSkill { name: "会议录音转写".into(), slug: "meeting-transcription".into(), description: "会议录音自动转文字".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8500, category: "语音处理".into(), tags: vec!["会议".into()], installed: false, update_available: false },
        RemoteSkill { name: "音频剪辑".into(), slug: "audio-editing".into(), description: "音频剪辑、合并、处理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "语音处理".into(), tags: vec!["剪辑".into()], installed: false, update_available: false },
        RemoteSkill { name: "背景音乐".into(), slug: "background-music".into(), description: "AI 背景音乐生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "语音处理".into(), tags: vec!["音乐".into()], installed: false, update_available: false },
        RemoteSkill { name: "声纹识别".into(), slug: "voiceprint-recognition".into(), description: "声纹识别、身份验证".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "语音处理".into(), tags: vec!["声纹".into()], installed: false, update_available: false },
        RemoteSkill { name: "音频格式转换".into(), slug: "audio-converter".into(), description: "音频格式转换、批量处理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "语音处理".into(), tags: vec!["转换".into()], installed: false, update_available: false },

        // ========== 安全隐私类 ==========
        RemoteSkill { name: "密码生成".into(), slug: "password-generator".into(), description: "强密码生成、安全检测".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "安全隐私".into(), tags: vec!["密码".into()], installed: false, update_available: false },
        RemoteSkill { name: "密码管理".into(), slug: "password-manager".into(), description: "密码存储、自动填充".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "安全隐私".into(), tags: vec!["密码".into()], installed: false, update_available: false },
        RemoteSkill { name: "文件加密".into(), slug: "file-encryption".into(), description: "文件加密解密、安全存储".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "安全隐私".into(), tags: vec!["加密".into()], installed: false, update_available: false },
        RemoteSkill { name: "隐私清理".into(), slug: "privacy-cleaner".into(), description: "清理浏览痕迹、隐私数据".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "安全隐私".into(), tags: vec!["隐私".into()], installed: false, update_available: false },
        RemoteSkill { name: "安全扫描".into(), slug: "security-scanner".into(), description: "系统安全扫描、漏洞检测".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "安全隐私".into(), tags: vec!["安全".into()], installed: false, update_available: false },
        RemoteSkill { name: "病毒检测".into(), slug: "virus-scanner".into(), description: "文件病毒扫描、威胁检测".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "安全隐私".into(), tags: vec!["病毒".into()], installed: false, update_available: false },
        RemoteSkill { name: "网络安全".into(), slug: "network-security".into(), description: "网络安全检测、防火墙".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "安全隐私".into(), tags: vec!["网络".into()], installed: false, update_available: false },
        RemoteSkill { name: "数据备份".into(), slug: "data-backup".into(), description: "自动数据备份、恢复".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "安全隐私".into(), tags: vec!["备份".into()], installed: false, update_available: false },

        // ========== 办公协作类 ==========
        RemoteSkill { name: "文档协作".into(), slug: "doc-collaboration".into(), description: "多人文档协作、版本管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "办公协作".into(), tags: vec!["协作".into()], installed: false, update_available: false },
        RemoteSkill { name: "任务分配".into(), slug: "task-assignment".into(), description: "团队任务分配、进度跟踪".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "办公协作".into(), tags: vec!["任务".into()], installed: false, update_available: false },
        RemoteSkill { name: "日程协调".into(), slug: "schedule-coordination".into(), description: "团队日程协调、会议安排".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "办公协作".into(), tags: vec!["日程".into()], installed: false, update_available: false },
        RemoteSkill { name: "文件共享".into(), slug: "file-sharing".into(), description: "团队文件共享、权限管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "办公协作".into(), tags: vec!["文件".into()], installed: false, update_available: false },
        RemoteSkill { name: "在线白板".into(), slug: "online-whiteboard".into(), description: "协作白板、思维导图".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "办公协作".into(), tags: vec!["白板".into()], installed: false, update_available: false },
        RemoteSkill { name: "投票决策".into(), slug: "voting-decision".into(), description: "团队投票、决策辅助".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 4500, category: "办公协作".into(), tags: vec!["投票".into()], installed: false, update_available: false },
        RemoteSkill { name: "工单系统".into(), slug: "ticket-system".into(), description: "工单管理、流程自动化".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "办公协作".into(), tags: vec!["工单".into()], installed: false, update_available: false },
        RemoteSkill { name: "审批流程".into(), slug: "approval-workflow".into(), description: "审批流程管理、自动化".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6000, category: "办公协作".into(), tags: vec!["审批".into()], installed: false, update_available: false },

        // ========== 机器人框架类 ==========
        RemoteSkill { name: "Telegram Bot".into(), slug: "telegram-bot-framework".into(), description: "Telegram 机器人框架".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "机器人框架".into(), tags: vec!["Telegram".into()], installed: false, update_available: false },
        RemoteSkill { name: "Discord Bot".into(), slug: "discord-bot-framework".into(), description: "Discord 机器人框架".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "机器人框架".into(), tags: vec!["Discord".into()], installed: false, update_available: false },
        RemoteSkill { name: "Slack Bot".into(), slug: "slack-bot-framework".into(), description: "Slack 机器人框架".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "机器人框架".into(), tags: vec!["Slack".into()], installed: false, update_available: false },
        RemoteSkill { name: "微信小程序".into(), slug: "wechat-mini-program".into(), description: "微信小程序集成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "机器人框架".into(), tags: vec!["小程序".into()], installed: false, update_available: false },
        RemoteSkill { name: "钉钉机器人".into(), slug: "dingtalk-bot".into(), description: "钉钉机器人框架".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "机器人框架".into(), tags: vec!["钉钉".into()], installed: false, update_available: false },
        RemoteSkill { name: "企业微信机器人".into(), slug: "wecom-bot".into(), description: "企业微信机器人框架".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "机器人框架".into(), tags: vec!["企业微信".into()], installed: false, update_available: false },
        RemoteSkill { name: "飞书机器人".into(), slug: "feishu-bot".into(), description: "飞书机器人框架".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "机器人框架".into(), tags: vec!["飞书".into()], installed: false, update_available: false },
        RemoteSkill { name: "QQ 机器人框架".into(), slug: "qq-bot-framework".into(), description: "QQ 机器人开发框架".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8500, category: "机器人框架".into(), tags: vec!["QQ".into()], installed: false, update_available: false },

        // ========== 热门工具类 ==========
        RemoteSkill { name: "ChatGPT 镜像".into(), slug: "chatgpt-mirror".into(), description: "ChatGPT 国内镜像访问".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 30000, category: "热门工具".into(), tags: vec!["ChatGPT".into()], installed: false, update_available: false },
        RemoteSkill { name: "AI 写作助手".into(), slug: "ai-writing-assistant".into(), description: "AI 写作、改写、润色".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 25000, category: "热门工具".into(), tags: vec!["写作".into(), "AI".into()], installed: false, update_available: false },
        RemoteSkill { name: "AI 翻译".into(), slug: "ai-translation".into(), description: "AI 智能翻译、多语言".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 22000, category: "热门工具".into(), tags: vec!["翻译".into()], installed: false, update_available: false },
        RemoteSkill { name: "AI 编程助手".into(), slug: "ai-coding-assistant".into(), description: "代码生成、补全、解释".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 20000, category: "热门工具".into(), tags: vec!["编程".into(), "AI".into()], installed: false, update_available: false },
        RemoteSkill { name: "AI 绘画大师".into(), slug: "ai-art-master".into(), description: "AI 艺术绘画生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 18000, category: "热门工具".into(), tags: vec!["绘画".into(), "AI".into()], installed: false, update_available: false },
        RemoteSkill { name: "智能问答".into(), slug: "smart-qa".into(), description: "智能问答、知识检索".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 16000, category: "热门工具".into(), tags: vec!["问答".into()], installed: false, update_available: false },
        RemoteSkill { name: "AI 语音助手".into(), slug: "ai-voice-assistant".into(), description: "语音交互、智能助手".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 14000, category: "热门工具".into(), tags: vec!["语音".into(), "AI".into()], installed: false, update_available: false },
        RemoteSkill { name: "AI 学习助手".into(), slug: "ai-learning-assistant".into(), description: "AI 辅助学习、答疑".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 13000, category: "热门工具".into(), tags: vec!["学习".into(), "AI".into()], installed: false, update_available: false },

        // ========== 效率工具类 ==========
        RemoteSkill { name: "快捷键管理".into(), slug: "hotkey-manager".into(), description: "自定义快捷键、效率提升".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "效率工具".into(), tags: vec!["快捷键".into()], installed: false, update_available: false },
        RemoteSkill { name: "剪贴板管理".into(), slug: "clipboard-manager".into(), description: "剪贴板历史、多格式粘贴".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "效率工具".into(), tags: vec!["剪贴板".into()], installed: false, update_available: false },
        RemoteSkill { name: "截图工具".into(), slug: "screenshot-tool".into(), description: "智能截图、标注、OCR".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 15000, category: "效率工具".into(), tags: vec!["截图".into()], installed: false, update_available: false },
        RemoteSkill { name: "窗口管理".into(), slug: "window-manager".into(), description: "窗口布局、分屏管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9500, category: "效率工具".into(), tags: vec!["窗口".into()], installed: false, update_available: false },
        RemoteSkill { name: "启动器".into(), slug: "app-launcher".into(), description: "应用快速启动、搜索".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 13000, category: "效率工具".into(), tags: vec!["启动".into()], installed: false, update_available: false },
        RemoteSkill { name: "待办清单".into(), slug: "todo-list".into(), description: "任务管理、提醒通知".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 14000, category: "效率工具".into(), tags: vec!["待办".into()], installed: false, update_available: false },
        RemoteSkill { name: "番茄钟".into(), slug: "pomodoro-timer".into(), description: "番茄工作法计时器".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8500, category: "效率工具".into(), tags: vec!["番茄".into()], installed: false, update_available: false },

        // ========== 娱乐休闲类 ==========
        RemoteSkill { name: "音乐播放".into(), slug: "music-player".into(), description: "音乐播放、歌词显示".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 18000, category: "娱乐休闲".into(), tags: vec!["音乐".into()], installed: false, update_available: false },
        RemoteSkill { name: "视频播放".into(), slug: "video-player".into(), description: "视频播放、格式支持".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 16000, category: "娱乐休闲".into(), tags: vec!["视频".into()], installed: false, update_available: false },
        RemoteSkill { name: "游戏加速".into(), slug: "game-booster".into(), description: "游戏优化、延迟降低".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "娱乐休闲".into(), tags: vec!["游戏".into()], installed: false, update_available: false },
        RemoteSkill { name: "直播助手".into(), slug: "livestream-assistant".into(), description: "直播推流、弹幕互动".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9500, category: "娱乐休闲".into(), tags: vec!["直播".into()], installed: false, update_available: false },
        RemoteSkill { name: "小说阅读".into(), slug: "novel-reader".into(), description: "小说阅读、离线缓存".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "娱乐休闲".into(), tags: vec!["小说".into()], installed: false, update_available: false },
        RemoteSkill { name: "表情包制作".into(), slug: "meme-generator".into(), description: "表情包制作、模板套用".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 14000, category: "娱乐休闲".into(), tags: vec!["表情包".into()], installed: false, update_available: false },

        // ========== 社交互动类 ==========
        RemoteSkill { name: "朋友圈管理".into(), slug: "moments-manager".into(), description: "朋友圈发布、互动管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 13000, category: "社交互动".into(), tags: vec!["朋友圈".into()], installed: false, update_available: false },
        RemoteSkill { name: "微博助手".into(), slug: "weibo-assistant".into(), description: "微博发布、互动监控".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "社交互动".into(), tags: vec!["微博".into()], installed: false, update_available: false },
        RemoteSkill { name: "小红书助手".into(), slug: "xiaohongshu-assistant".into(), description: "小红书内容发布、数据分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12500, category: "社交互动".into(), tags: vec!["小红书".into()], installed: false, update_available: false },
        RemoteSkill { name: "抖音助手".into(), slug: "douyin-assistant".into(), description: "抖音视频发布、数据分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 15000, category: "社交互动".into(), tags: vec!["抖音".into()], installed: false, update_available: false },
        RemoteSkill { name: "B站助手".into(), slug: "bilibili-assistant".into(), description: "B站视频发布、互动管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 14000, category: "社交互动".into(), tags: vec!["B站".into()], installed: false, update_available: false },
        RemoteSkill { name: "知乎助手".into(), slug: "zhihu-assistant".into(), description: "知乎问答、专栏发布".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "社交互动".into(), tags: vec!["知乎".into()], installed: false, update_available: false },

        // ========== 电商工具类 ==========
        RemoteSkill { name: "淘宝助手".into(), slug: "taobao-assistant".into(), description: "淘宝店铺管理、订单处理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 16000, category: "电商工具".into(), tags: vec!["淘宝".into()], installed: false, update_available: false },
        RemoteSkill { name: "京东助手".into(), slug: "jd-assistant".into(), description: "京东店铺运营、数据分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "电商工具".into(), tags: vec!["京东".into()], installed: false, update_available: false },
        RemoteSkill { name: "拼多多助手".into(), slug: "pdd-assistant".into(), description: "拼多多运营、推广管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "电商工具".into(), tags: vec!["拼多多".into()], installed: false, update_available: false },
        RemoteSkill { name: "抖音电商".into(), slug: "douyin-ecommerce".into(), description: "抖音小店运营、直播带货".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 14000, category: "电商工具".into(), tags: vec!["抖音".into(), "电商".into()], installed: false, update_available: false },
        RemoteSkill { name: "跨境出海".into(), slug: "cross-border".into(), description: "跨境电商、海外市场".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "电商工具".into(), tags: vec!["跨境".into()], installed: false, update_available: false },

        // ========== 营销推广类 ==========
        RemoteSkill { name: "营销文案".into(), slug: "marketing-copy".into(), description: "营销文案生成、创意策划".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 15000, category: "营销推广".into(), tags: vec!["营销".into(), "文案".into()], installed: false, update_available: false },
        RemoteSkill { name: "海报设计".into(), slug: "poster-design".into(), description: "营销海报设计、模板套用".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 13000, category: "营销推广".into(), tags: vec!["海报".into()], installed: false, update_available: false },
        RemoteSkill { name: "活动策划".into(), slug: "event-planning".into(), description: "营销活动策划、执行跟踪".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "营销推广".into(), tags: vec!["活动".into()], installed: false, update_available: false },
        RemoteSkill { name: "SEO 优化".into(), slug: "seo-optimizer".into(), description: "SEO 关键词优化、排名提升".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "营销推广".into(), tags: vec!["SEO".into()], installed: false, update_available: false },
        RemoteSkill { name: "社群运营".into(), slug: "community-operation".into(), description: "社群管理、活动运营".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11500, category: "营销推广".into(), tags: vec!["社群".into()], installed: false, update_available: false },

        // ========== 财务管理类 ==========
        RemoteSkill { name: "记账助手".into(), slug: "accounting-helper".into(), description: "日常记账、收支统计".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 14000, category: "财务管理".into(), tags: vec!["记账".into()], installed: false, update_available: false },
        RemoteSkill { name: "发票管理".into(), slug: "invoice-manager".into(), description: "发票识别、报销管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "财务管理".into(), tags: vec!["发票".into()], installed: false, update_available: false },
        RemoteSkill { name: "投资分析".into(), slug: "investment-analysis".into(), description: "投资组合分析、风险评估".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "财务管理".into(), tags: vec!["投资".into()], installed: false, update_available: false },

        // ========== 人力资源类 ==========
        RemoteSkill { name: "招聘管理".into(), slug: "recruitment-manager".into(), description: "招聘流程管理、简历筛选".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "人力资源".into(), tags: vec!["招聘".into()], installed: false, update_available: false },
        RemoteSkill { name: "考勤管理".into(), slug: "attendance-manager".into(), description: "员工考勤、请假审批".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "人力资源".into(), tags: vec!["考勤".into()], installed: false, update_available: false },
        RemoteSkill { name: "绩效评估".into(), slug: "performance-evaluation".into(), description: "绩效考核、目标管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "人力资源".into(), tags: vec!["绩效".into()], installed: false, update_available: false },

        // ========== 项目管理类 ==========
        RemoteSkill { name: "项目规划".into(), slug: "project-planning".into(), description: "项目计划、里程碑管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "项目管理".into(), tags: vec!["项目".into()], installed: false, update_available: false },
        RemoteSkill { name: "任务看板".into(), slug: "task-board".into(), description: "看板管理、任务流转".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "项目管理".into(), tags: vec!["看板".into()], installed: false, update_available: false },
        RemoteSkill { name: "甘特图".into(), slug: "gantt-chart".into(), description: "甘特图、进度可视化".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8500, category: "项目管理".into(), tags: vec!["甘特图".into()], installed: false, update_available: false },

        // ========== 教育学习类 ==========
        RemoteSkill { name: "在线课程".into(), slug: "online-course".into(), description: "在线学习、课程管理".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 12000, category: "教育学习".into(), tags: vec!["课程".into()], installed: false, update_available: false },
        RemoteSkill { name: "题库刷题".into(), slug: "question-bank".into(), description: "考试刷题、错题本".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "教育学习".into(), tags: vec!["题库".into()], installed: false, update_available: false },
        RemoteSkill { name: "英语学习".into(), slug: "english-learning".into(), description: "英语单词、口语练习".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 15000, category: "教育学习".into(), tags: vec!["英语".into()], installed: false, update_available: false },
        RemoteSkill { name: "编程学习".into(), slug: "programming-learning".into(), description: "编程教程、实战练习".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 13000, category: "教育学习".into(), tags: vec!["编程".into()], installed: false, update_available: false },

        // ========== 健康医疗类 ==========
        RemoteSkill { name: "健康打卡".into(), slug: "health-checkin".into(), description: "每日健康记录、习惯养成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 11000, category: "健康医疗".into(), tags: vec!["健康".into()], installed: false, update_available: false },
        RemoteSkill { name: "运动计划".into(), slug: "exercise-plan".into(), description: "运动计划制定、进度跟踪".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9500, category: "健康医疗".into(), tags: vec!["运动".into()], installed: false, update_available: false },
        RemoteSkill { name: "饮食记录".into(), slug: "diet-record".into(), description: "饮食日记、营养分析".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "健康医疗".into(), tags: vec!["饮食".into()], installed: false, update_available: false },

        // ========== 更多工具类 ==========
        RemoteSkill { name: "单位换算".into(), slug: "unit-converter".into(), description: "长度、重量、温度等单位换算".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7000, category: "实用工具".into(), tags: vec!["换算".into()], installed: false, update_available: false },
        RemoteSkill { name: "时区转换".into(), slug: "timezone-converter".into(), description: "世界时钟、时区转换".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 6500, category: "实用工具".into(), tags: vec!["时区".into()], installed: false, update_available: false },
        RemoteSkill { name: "号码生成".into(), slug: "number-generator".into(), description: "随机号码、序列号生成".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5500, category: "实用工具".into(), tags: vec!["号码".into()], installed: false, update_available: false },
        RemoteSkill { name: "二维码生成".into(), slug: "qrcode-gen-v2".into(), description: "二维码生成、解析、美化".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 10000, category: "实用工具".into(), tags: vec!["二维码".into()], installed: false, update_available: false },
        RemoteSkill { name: "条形码生成".into(), slug: "barcode-gen".into(), description: "条形码生成、识别".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 5000, category: "实用工具".into(), tags: vec!["条形码".into()], installed: false, update_available: false },
        RemoteSkill { name: "计算器".into(), slug: "calculator".into(), description: "科学计算器、汇率计算".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 9000, category: "实用工具".into(), tags: vec!["计算".into()], installed: false, update_available: false },
        RemoteSkill { name: "日历工具".into(), slug: "calendar-tool".into(), description: "日历查看、节假日查询".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 8000, category: "实用工具".into(), tags: vec!["日历".into()], installed: false, update_available: false },
        RemoteSkill { name: "倒计时".into(), slug: "countdown".into(), description: "倒计时、纪念日提醒".into(), version: "1.0.0".into(), author: "OpenClaw".into(), downloads: 7500, category: "实用工具".into(), tags: vec!["倒计时".into()], installed: false, update_available: false },
    ]
}
