# 架构说明

## 项目结构

```
openclaw-local-installer/
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── main.rs        # Tauri 入口
│   │   ├── hardware.rs    # 硬件检测模块
│   │   └── installer.rs   # 安装逻辑模块
│   ├── Cargo.toml         # Rust 依赖配置
│   └── tauri.conf.json    # Tauri 配置
├── src/                    # React 前端
│   ├── main.tsx           # React 入口
│   ├── App.tsx            # 主组件
│   └── index.css          # 样式
├── public/                 # 静态资源
├── package.json           # Node.js 配置
├── vite.config.ts         # Vite 配置
├── tailwind.config.js     # Tailwind CSS 配置
└── README.md              # 项目文档
```

## 核心模块

### 1. 硬件检测模块 (`hardware.rs`)

**功能**:
- 检测 CPU 信息（型号、核心数）
- 检测内存大小
- 检测 GPU 信息（型号、VRAM）

**实现方式**:
- **跨平台**: 使用 `sysinfo` crate
- **NVIDIA GPU**: 
  - 优先使用 `nvidia-smi` 命令
  - Windows 回退到 WMI (`Win32_VideoController`)
- **AMD/Intel GPU**: 通过 WMI 检测

**核心代码**:
```rust
pub async fn detect_hardware() -> Result<HardwareInfo, Box<dyn std::error::Error>> {
    let mut sys = System::new_all();
    sys.refresh_all();
    
    let cpu_name = sys.cpus().first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "Unknown CPU".to_string());
    
    let ram_gb = sys.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    
    let gpus = detect_nvidia_gpus().await.unwrap_or_default();
    
    Ok(HardwareInfo { cpu_name, ram_gb, gpus, ... })
}
```

### 2. 安装逻辑模块 (`installer.rs`)

**功能**:
- 检查/安装 Ollama
- 下载本地模型
- 检查/安装 OpenClaw
- 生成配置文件

**模型推荐算法**:
```rust
pub fn get_recommended_models(vram_gb: f64, ram_gb: f64) -> Vec<ModelRecommendation> {
    // 根据硬件配置过滤和推荐模型
    models.retain(|m| {
        (vram_gb >= m.min_vram || m.min_vram == 0.0) && ram_gb >= m.min_ram
    });
    
    // 标记推荐模型
    for model in &mut models {
        model.recommended = matches_hardware(model, vram_gb, ram_gb);
    }
}
```

**安装流程**:
```
check_ollama_installed()
  ↓
install_ollama()          # 如果未安装
  ↓
pull_model()              # 下载选定的模型
  ↓
check_openclaw_installed()
  ↓
install_openclaw()        # 如果未安装
  ↓
configure_openclaw()      # 生成配置文件
```

### 3. 前端界面 (`App.tsx`)

**状态管理**:
```typescript
type InstallStep = 'welcome' | 'detecting' | 'select-model' | 'installing' | 'complete'

const [step, setStep] = useState<InstallStep>('welcome')
const [hardware, setHardware] = useState<HardwareInfo | null>(null)
const [models, setModels] = useState<ModelRecommendation[]>([])
const [selectedModel, setSelectedModel] = useState<string>('')
```

**Tauri 命令调用**:
```typescript
// 调用 Rust 后端
const hardware = await invoke<HardwareInfo>('detect_hardware')
const models = await invoke<ModelRecommendation[]>('get_recommended_models', {
  vramGb: hardware.total_vram_gb,
  ramGb: hardware.ram_gb
})
await invoke('install_ollama')
await invoke('pull_model', { modelName: selectedModel })
```

**事件监听**:
```typescript
// 监听安装进度
listen<string>('install-progress', (event) => {
  setInstallLog(prev => [...prev, event.payload])
})
```

## 数据流

```
用户操作
  ↓
前端调用 Tauri 命令
  ↓
Rust 后端执行
  ↓
通过事件推送进度
  ↓
前端更新 UI
```

## 配置文件生成

安装完成后，生成 `~/.openclaw/openclaw.json`:

```json
{
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
        "primary": "ollama/qwen2.5-coder:14b",
        "fallbacks": []
      }
    }
  }
}
```

## 扩展指南

### 添加新模型

编辑 `src-tauri/src/installer.rs`:

```rust
ModelRecommendation {
    name: "new-model:7b".to_string(),
    display_name: "New Model 7B".to_string(),
    size_gb: 4.5,
    description: "模型描述".to_string(),
    min_vram: 6.0,
    min_ram: 16.0,
    recommended: false,
    tags: vec!["标签".to_string()],
},
```

### 添加新硬件检测

编辑 `src-tauri/src/hardware.rs`:

```rust
pub struct HardwareInfo {
    pub cpu_name: String,
    pub ram_gb: f64,
    pub gpus: Vec<GpuInfo>,
    pub new_field: String,  // 添加新字段
}
```

### 修改 UI 样式

编辑 `src/App.tsx` 和 `src/index.css`，使用 Tailwind CSS 类名。

## 性能优化

1. **Rust 编译优化** (Cargo.toml):
   ```toml
   [profile.release]
   opt-level = "z"    # 优化体积
   lto = true         # 链接时优化
   strip = true       # 移除符号信息
   ```

2. **前端打包优化** (vite.config.ts):
   ```typescript
   build: {
     minify: 'esbuild',
     target: ['es2021', 'chrome100'],
   }
   ```

## 测试

```bash
# 单元测试（Rust）
cd src-tauri
cargo test

# 集成测试
npm run tauri:dev
```

## 发布流程

1. 更新版本号
   - `package.json`: `"version": "0.2.0"`
   - `Cargo.toml`: `version = "0.2.0"`
   - `src-tauri/tauri.conf.json`: `"version": "0.2.0"`

2. 构建
   ```bash
   npm run tauri build
   ```

3. 创建 GitHub Release
   - 上传安装包
   - 编写更新日志

## 安全考虑

1. **配置文件权限**: 生成的配置文件设置为用户只读
2. **下载源验证**: 只从官方源下载（Ollama、Node.js、OpenClaw）
3. **无网络监听**: 应用不监听任何网络端口
4. **本地存储**: 所有数据存储在用户目录，不上传

## 已知限制

1. **Windows**: 需要 NVIDIA 驱动才能检测 GPU VRAM
2. **Linux**: 需要 `lshw` 或 `nvidia-smi` 已安装
3. **macOS**: Metal GPU 检测可能不准确

## 未来计划

- [ ] 支持 AMD GPU 检测（ROCm）
- [ ] 支持 Apple Silicon GPU 检测
- [ ] 添加模型卸载功能
- [ ] 支持多模型切换 UI
- [ ] 自动更新功能
