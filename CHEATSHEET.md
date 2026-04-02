# 开发者快速参考

## 🚀 常用命令

### 开发
```bash
npm run tauri:dev        # 启动开发服务器（热重载）
npm run dev              # 只启动前端开发服务器
```

### 构建
```bash
npm run tauri:build      # 构建生产版本
npm run build            # 只构建前端
```

### 测试
```bash
cd src-tauri
cargo test               # 运行 Rust 测试
```

## 📁 项目结构速查

```
openclaw-local-installer/
├── src-tauri/           # Rust 后端
│   └── src/
│       ├── main.rs      # 入口 + 命令注册
│       ├── hardware.rs  # 硬件检测
│       ├── installer.rs # 安装逻辑
│       ├── download.rs  # 下载进度
│       ├── models.rs    # 模型管理
│       └── updater.rs   # 自动更新
├── src/                 # React 前端
│   ├── App.tsx          # 主组件
│   └── main.tsx         # 入口
└── docs/                # 文档
```

## 🎨 主题系统

```typescript
// 切换主题
setTheme('dark')  // 'light' | 'dark'

// 检测当前主题
const isDark = theme === 'dark'

// Tailwind 类名
className={`${isDark ? 'bg-gray-900 text-white' : 'bg-white'}`}
```

## 📡 Tauri 命令速查

### 硬件检测
```typescript
const hardware = await invoke<HardwareInfo>('detect_hardware')
```

### 模型管理
```typescript
// 列出已安装模型
const models = await invoke<InstalledModel[]>('list_models')

// 获取模型详情
const details = await invoke<ModelDetails>('get_model_info', { modelName: 'llama3.1:8b' })

// 删除模型
await invoke('delete_model', { modelName: 'llama3.1:8b' })
```

### 下载模型（带进度）
```typescript
await invoke('pull_model', { modelName: 'qwen2.5:7b' })

// 监听进度
listen<DownloadProgress>('model-download-progress', (event) => {
  console.log(event.payload.percent) // 0-100
})
```

### 更新
```typescript
// 检查更新
const update = await invoke<UpdateInfo | null>('check_for_updates')

// 下载更新
await invoke('download_update')

// 安装更新
await invoke('install_update')
```

## 🔧 常见问题

### Q: 如何添加新模型？
编辑 `src-tauri/src/installer.rs` 中的 `get_recommended_models()` 函数。

### Q: 如何修改 UI 样式？
修改 `src/App.tsx`，使用 Tailwind CSS 类名。

### Q: 如何调试 Rust 代码？
在 Rust 代码中使用 `println!()` 或 `log::info!()`，终端会显示输出。

### Q: 如何打包？
```bash
npm run tauri:build
```
产物在 `src-tauri/target/release/bundle/`

## 📦 发布流程

1. 更新版本号
   - `package.json`: `"version": "0.2.0"`
   - `src-tauri/Cargo.toml`: `version = "0.2.0"`
   - `src-tauri/tauri.conf.json`: `"version": "0.2.0"`

2. 更新 `CHANGELOG.md`

3. 提交代码
   ```bash
   git commit -am "Release v0.2.0"
   git tag v0.2.0
   git push origin main --tags
   ```

4. GitHub Actions 自动构建

5. 编辑 Release，发布

## 🎯 性能优化

### 减小安装包体积
```toml
# Cargo.toml
[profile.release]
opt-level = "z"      # 优化体积
lto = true           # 链接时优化
strip = true         # 移除符号
```

### 加快启动速度
- 使用 React.lazy 懒加载组件
- 延迟非关键操作
- 减少初始依赖

## 🐛 调试技巧

### 前端调试
```typescript
console.log('调试信息', data)
debugger  // 断点
```

### 后端调试
```rust
println!("[DEBUG] 数据: {:?}", data);
log::debug!("调试信息");
```

### 查看日志
```bash
# 开发模式日志在终端显示
npm run tauri:dev

# 生产模式日志（Windows）
%APPDATA%\com.openclaw.local-installer\logs\
```

## 📚 相关链接

- [Tauri 文档](https://tauri.app/v2/guides/)
- [React 文档](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/)
- [OpenClaw 文档](https://docs.openclaw.ai)
