use serde::{Deserialize, Serialize};
use sysinfo::System;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub name: String,
    pub vram_gb: f64,
    pub vendor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareInfo {
    pub cpu_name: String,
    pub cpu_cores: usize,
    pub ram_gb: f64,
    pub gpus: Vec<GpuInfo>,
    pub has_nvidia: bool,
    pub total_vram_gb: f64,
}

// ============== Windows GPU 检测 ==============
#[cfg(target_os = "windows")]
async fn detect_nvidia_gpus() -> Result<Vec<GpuInfo>, Box<dyn std::error::Error>> {
    use std::process::Command;
    
    let mut gpus = Vec::new();
    
    // 使用 nvidia-smi 检测 NVIDIA GPU
    let output = Command::new("nvidia-smi")
        .args(&["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .output();
    
    if let Ok(output) = output {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split(", ").collect();
                if parts.len() >= 2 {
                    let name = parts[0].trim().to_string();
                    let vram_mb: f64 = parts[1].trim().parse().unwrap_or(0.0);
                    gpus.push(GpuInfo {
                        name: name.clone(),
                        vram_gb: vram_mb / 1024.0,
                        vendor: "NVIDIA".to_string(),
                    });
                }
            }
        }
    }
    
    // 如果 nvidia-smi 不可用，尝试 WMI
    if gpus.is_empty() {
        gpus = detect_gpus_wmi()?;
    }
    
    Ok(gpus)
}

#[cfg(target_os = "windows")]
fn detect_gpus_wmi() -> Result<Vec<GpuInfo>, Box<dyn std::error::Error>> {
    use wmi::{COMLibrary, WMIConnection};
    use serde::Deserialize;
    
    #[derive(Deserialize, Debug)]
    struct Win32_VideoController {
        Name: String,
        AdapterRAM: Option<u64>,
    }
    
    let com = COMLibrary::new()?;
    let wmi = WMIConnection::new(com)?;
    let controllers: Vec<Win32_VideoController> = wmi.query()?;
    
    let gpus = controllers.into_iter().map(|c| {
        let vram_gb = c.AdapterRAM.map(|r| r as f64 / 1024.0 / 1024.0 / 1024.0).unwrap_or(0.0);
        let vendor = if c.Name.contains("NVIDIA") { "NVIDIA".to_string() }
                   else if c.Name.contains("AMD") || c.Name.contains("Radeon") { "AMD".to_string() }
                   else if c.Name.contains("Intel") { "Intel".to_string() }
                   else { "Unknown".to_string() };
        
        GpuInfo {
            name: c.Name,
            vram_gb,
            vendor,
        }
    }).collect();
    
    Ok(gpus)
}

// ============== macOS GPU 检测 ==============
#[cfg(target_os = "macos")]
async fn detect_nvidia_gpus() -> Result<Vec<GpuInfo>, Box<dyn std::error::Error>> {
    use std::process::Command;
    
    let mut gpus = Vec::new();
    
    // macOS 使用 system_profiler 检测 GPU
    let output = Command::new("system_profiler")
        .args(&["SPDisplaysDataType"])
        .output()?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    
    // 解析输出
    for line in stdout.lines() {
        if line.contains("Chipset Model:") {
            let name = line.split(':').last().unwrap_or("").trim().to_string();
            let vendor = if name.contains("NVIDIA") { "NVIDIA" }
                        else if name.contains("AMD") || name.contains("Radeon") { "AMD" }
                        else if name.contains("Apple") || name.contains("M1") || name.contains("M2") || name.contains("M3") { "Apple" }
                        else if name.contains("Intel") { "Intel" }
                        else { "Unknown" };
            
            // macOS 通常不直接提供 VRAM 信息，Apple Silicon 使用统一内存
            let vram_gb = if vendor == "Apple" {
                // 对于 Apple Silicon，使用系统内存的 1/2 作为估算
                let sys = System::new_all();
                let ram = sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
                ram / 2.0
            } else {
                0.0
            };
            
            gpus.push(GpuInfo {
                name,
                vram_gb,
                vendor: vendor.to_string(),
            });
        }
        
        // 尝试获取 VRAM 信息
        if line.contains("VRAM (Total):") {
            let vram_str = line.split(':').last().unwrap_or("").trim();
            // 格式: "8 GB" 或 "8192 MB"
            if let Some(gb_idx) = vram_str.find(" GB") {
                if let Ok(vram) = vram_str[..gb_idx].parse::<f64>() {
                    if let Some(last) = gpus.last_mut() {
                        last.vram_gb = vram;
                    }
                }
            } else if let Some(mb_idx) = vram_str.find(" MB") {
                if let Ok(vram_mb) = vram_str[..mb_idx].parse::<f64>() {
                    if let Some(last) = gpus.last_mut() {
                        last.vram_gb = vram_mb / 1024.0;
                    }
                }
            }
        }
    }
    
    Ok(gpus)
}

// ============== Linux GPU 检测 ==============
#[cfg(target_os = "linux")]
async fn detect_nvidia_gpus() -> Result<Vec<GpuInfo>, Box<dyn std::error::Error>> {
    use std::process::Command;
    
    let mut gpus = Vec::new();
    
    // 尝试 nvidia-smi
    let nvidia_output = Command::new("nvidia-smi")
        .args(&["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .output();
    
    if let Ok(output) = nvidia_output {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split(", ").collect();
                if parts.len() >= 2 {
                    let name = parts[0].trim().to_string();
                    let vram_mb: f64 = parts[1].trim().parse().unwrap_or(0.0);
                    gpus.push(GpuInfo {
                        name: name.clone(),
                        vram_gb: vram_mb / 1024.0,
                        vendor: "NVIDIA".to_string(),
                    });
                }
            }
        }
    }
    
    // 如果没有 NVIDIA GPU，尝试检测 AMD/Intel
    if gpus.is_empty() {
        // 读取 /sys/class/drm/card*/device
        if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                
                if name.starts_with("card") && !name.contains("-") {
                    // 尝试读取设备信息
                    let device_path = path.join("device");
                    if device_path.exists() {
                        // 读取 vendor ID
                        if let Ok(vendor_id) = std::fs::read_to_string(device_path.join("vendor")) {
                            let vendor_id = vendor_id.trim();
                            let vendor = match vendor_id {
                                "0x10de" => "NVIDIA",
                                "0x1002" | "0x1022" => "AMD",
                                "0x8086" => "Intel",
                                _ => "Unknown",
                            };
                            
                            // 尝试获取 GPU 名称
                            let gpu_name = if let Ok(name) = std::fs::read_to_string(device_path.join("device")) {
                                name.trim().to_string()
                            } else {
                                format!("{} GPU", vendor)
                            };
                            
                            // Linux 下获取 VRAM 比较困难，尝试从 sysfs 读取
                            let vram_gb = if let Ok(vram_bytes) = std::fs::read_to_string(device_path.join("mem_info_vram_total")) {
                                vram_bytes.trim().parse::<u64>().unwrap_or(0) as f64 / 1024.0 / 1024.0 / 1024.0
                            } else {
                                0.0
                            };
                            
                            gpus.push(GpuInfo {
                                name: gpu_name,
                                vram_gb,
                                vendor: vendor.to_string(),
                            });
                        }
                    }
                }
            }
        }
        
        // 如果仍然没有，尝试 lspci
        if gpus.is_empty() {
            if let Ok(output) = Command::new("lspci").args(&["-nnk", "|", "grep", "-i", "vga"]).output() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    gpus.push(GpuInfo {
                        name: line.split(':').last().unwrap_or("Unknown GPU").trim().to_string(),
                        vram_gb: 0.0,
                        vendor: "Unknown".to_string(),
                    });
                }
            }
        }
    }
    
    Ok(gpus)
}

// ============== 主检测函数 ==============
#[tauri::command]
pub async fn detect_hardware() -> Result<HardwareInfo, String> {
    // 使用 new() 而非 new_all() 避免栈溢出（特别是在 AppImage 环境下）
    let mut sys = System::new();
    sys.refresh_cpu_all();
    sys.refresh_memory();
    
    // CPU 信息
    let cpu_name = sys.cpus().first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "Unknown CPU".to_string());
    let cpu_cores = sys.cpus().len();
    
    // RAM 信息
    let ram_bytes = sys.total_memory();
    let ram_gb = ram_bytes as f64 / 1024.0 / 1024.0 / 1024.0;
    
    // GPU 信息
    let gpus = detect_nvidia_gpus().await.map_err(|e| e.to_string())?;
    let has_nvidia = gpus.iter().any(|g| g.vendor == "NVIDIA");
    let total_vram_gb = gpus.iter().map(|g| g.vram_gb).sum();
    
    Ok(HardwareInfo {
        cpu_name,
        cpu_cores,
        ram_gb,
        gpus,
        has_nvidia,
        total_vram_gb,
    })
}
