use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledModel {
    pub name: String,
    pub modified_at: String,
    pub size: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelDetails {
    pub format: String,
    pub family: String,
    pub parameter_size: String,
    pub quantization_level: String,
}

/// 获取已安装的模型列表
#[tauri::command]
pub async fn list_models() -> Result<Vec<InstalledModel>, String> {
    let output = Command::new("ollama")
        .args(&["list"])
        .output()
        .map_err(|e| format!("执行 ollama list 失败: {}", e))?;

    if !output.status.success() {
        return Err("Ollama 未运行或未安装".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut models = Vec::new();

    // 解析输出（跳过标题行）
    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            models.push(InstalledModel {
                name: parts[0].to_string(),
                modified_at: parts[1..parts.len()-2].join(" "),
                size: parts[parts.len()-1].to_string(),
            });
        }
    }

    Ok(models)
}

/// 获取模型详细信息
#[tauri::command]
pub async fn get_model_info(model_name: String) -> Result<ModelDetails, String> {
    let output = Command::new("ollama")
        .args(&["show", &model_name, "--modelfile"])
        .output()
        .map_err(|e| format!("获取模型详情失败: {}", e))?;

    if !output.status.success() {
        return Err("模型不存在".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    
    // 解析 modelfile 获取信息
    let mut format = "unknown".to_string();
    let mut family = "unknown".to_string();
    let mut parameter_size = "unknown".to_string();
    let mut quantization_level = "unknown".to_string();

    for line in stdout.lines() {
        if line.starts_with("# format ") {
            format = line.split_whitespace().last().unwrap_or("unknown").to_string();
        }
        if line.starts_with("# family ") {
            family = line.split_whitespace().last().unwrap_or("unknown").to_string();
        }
        if line.starts_with("# parameter size ") {
            parameter_size = line.split_whitespace().last().unwrap_or("unknown").to_string();
        }
        if line.starts_with("# quantization ") {
            quantization_level = line.split_whitespace().last().unwrap_or("unknown").to_string();
        }
    }

    Ok(ModelDetails {
        format,
        family,
        parameter_size,
        quantization_level,
    })
}

/// 删除模型
#[tauri::command]
pub async fn delete_model(model_name: String) -> Result<(), String> {
    let output = Command::new("ollama")
        .args(&["rm", &model_name])
        .output()
        .map_err(|e| format!("删除模型失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("删除失败: {}", stderr));
    }

    Ok(())
}

/// 停止正在运行的模型
#[tauri::command]
pub async fn stop_running_model(model_name: String) -> Result<(), String> {
    let output = Command::new("ollama")
        .args(&["stop", &model_name])
        .output()
        .map_err(|e| format!("停止模型失败: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("停止失败: {}", stderr));
    }

    Ok(())
}

/// 检查模型是否正在运行
#[tauri::command]
pub async fn check_model_running(model_name: String) -> Result<bool, String> {
    let output = Command::new("ollama")
        .args(&["ps"])
        .output()
        .map_err(|e| format!("检查运行状态失败: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    
    Ok(stdout.contains(&model_name))
}
