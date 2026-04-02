# 开发指南

## 环境设置

### 1. 安装 Rust

**Windows**:
```powershell
# 下载并运行 rustup-init.exe
# https://rustup.rs/
```

**macOS/Linux**:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. 安装 Node.js

推荐使用 **nvm** 管理版本：

**Windows**:
```powershell
# 使用 nvm-windows
nvm install 22
nvm use 22
```

**macOS/Linux**:
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 22
nvm use 22
```

### 3. 安装依赖

```bash
# Node.js 依赖
npm install

# Rust 依赖（首次构建时自动安装）
cd src-tauri
cargo fetch
```

## 开发工作流

### 启动开发服务器

```bash
npm run tauri:dev
```

这会：
1. 启动 Vite 开发服务器（端口 1420）
2. 编译 Rust 后端
3. 打开应用窗口（支持热重载）

### 调试

#### 前端调试

1. 打开 DevTools: `F12` 或 `Ctrl+Shift+I`
2. 使用 `console.log()` 调试
3. React DevTools 可用

#### 后端调试

在 `src-tauri/src/main.rs` 中添加日志：

```rust
println!("[DEBUG] 检测到的硬件: {:?}", hardware);
```

或使用 `log` crate：

```rust
use log::{info, debug, error};

info!("开始硬件检测");
debug!("GPU 信息: {:?}", gpus);
error!("检测失败: {}", err);
```

### 构建生产版本

```bash
npm run tauri:build
```

产物位于：
- Windows: `src-tauri/target/release/bundle/msi/` 或 `nsis/`
- macOS: `src-tauri/target/release/bundle/dmg/`
- Linux: `src-tauri/target/release/bundle/appimage/`

## 代码风格

### Rust

遵循 Rust 标准风格：
```bash
# 安装 rustfmt
rustup component add rustfmt

# 格式化代码
cargo fmt
```

### TypeScript/React

遵循 Prettier 标准：
```bash
# 安装 Prettier
npm install -D prettier

# 格式化代码
npx prettier --write "src/**/*.{ts,tsx}"
```

## 测试

### 单元测试

```bash
# Rust 测试
cd src-tauri
cargo test

# 输出详细信息
cargo test -- --nocapture
```

### 集成测试

手动测试流程：
1. 启动应用
2. 点击"开始安装"
3. 验证硬件检测
4. 选择模型
5. 完成安装
6. 运行 `openclaw` 验证

## 常见开发任务

### 添加新的 Tauri 命令

1. 在 `src-tauri/src/main.rs` 中定义命令：

```rust
#[tauri::command]
async fn my_new_command(param: String) -> Result<String, String> {
    Ok(format!("处理: {}", param))
}
```

2. 注册命令：

```rust
.invoke_handler(tauri::generate_handler![
    // ... 其他命令
    my_new_command,
])
```

3. 在前端调用：

```typescript
const result = await invoke<string>('my_new_command', { param: 'test' })
```

### 修改模型推荐逻辑

编辑 `src-tauri/src/installer.rs`:

```rust
pub fn get_recommended_models(vram_gb: f64, ram_gb: f64) -> Vec<ModelRecommendation> {
    let mut models = vec![
        // 添加或修改模型
    ];
    
    // 修改推荐逻辑
    for model in &mut models {
        model.recommended = matches_hardware(model, vram_gb, ram_gb);
    }
    
    models
}
```

### 添加新的 UI 步骤

1. 定义新状态：

```typescript
type InstallStep = 'welcome' | 'detecting' | 'my-new-step' | 'complete'
```

2. 添加 UI 组件：

```tsx
{step === 'my-new-step' && (
  <div>
    {/* 新步骤的 UI */}
  </div>
)}
```

## 性能优化

### 减小打包体积

1. **Rust 优化** (Cargo.toml):
   ```toml
   [profile.release]
   opt-level = "z"      # 优化体积
   lto = true           # 链接时优化
   codegen-units = 1    # 单代码生成单元
   strip = true         # 移除符号
   ```

2. **前端优化**:
   - 使用 React.lazy 懒加载
   - 移除未使用的依赖
   - 压缩图片资源

### 提升启动速度

1. 减少初始加载的资源
2. 使用异步加载
3. 延迟非关键操作

## 发布流程

### 1. 准备发布

```bash
# 更新版本号
# - package.json
# - Cargo.toml
# - src-tauri/tauri.conf.json

# 更新 CHANGELOG
# 添加新功能、修复、变更
```

### 2. 构建发布版本

```bash
# 清理旧构建
rm -rf src-tauri/target/release

# 构建
npm run tauri:build
```

### 3. 测试安装包

在干净的虚拟机上测试：
- 安装流程是否顺畅
- 功能是否正常
- 卸载是否干净

### 4. 发布到 GitHub

```bash
# 创建标签
git tag v0.1.0
git push origin v0.1.0

# 创建 GitHub Release
# 上传安装包
# 编写更新日志
```

## 贡献指南

### 提交代码

1. Fork 仓库
2. 创建分支: `git checkout -b feature/my-feature`
3. 提交更改: `git commit -m 'Add my feature'`
4. 推送分支: `git push origin feature/my-feature`
5. 创建 Pull Request

### 代码审查

Pull Request 需要：
- 通过所有测试
- 代码格式化
- 添加必要的注释
- 更新相关文档

### 问题反馈

提交 Issue 时请包含：
- 操作系统版本
- 应用版本
- 复现步骤
- 预期行为 vs 实际行为
- 日志输出（如果有）

## 有用的资源

- [Tauri 文档](https://tauri.app/v1/guides/)
- [Rust Book](https://doc.rust-lang.org/book/)
- [React 文档](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [OpenClaw 文档](https://docs.openclaw.ai)
