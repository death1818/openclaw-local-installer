# 快速开始指南

## 方案一：直接使用（推荐）

如果你只想安装 OpenClaw 本地版，直接下载编译好的安装包即可：

### Windows 用户

1. 下载 `OpenClaw-Local-Installer-Setup.exe`
2. 双击运行
3. 等待硬件检测完成
4. 选择推荐模型
5. 点击"开始安装"
6. 等待安装完成

安装完成后，打开命令行运行：
```bash
openclaw
```

## 方案二：从源码构建

### 前置要求

确保你的系统已安装：

1. **Rust** (1.70+)
   ```bash
   # 安装 Rust
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Node.js** (22+)
   - Windows: 从 https://nodejs.org 下载安装
   - macOS: `brew install node`
   - Linux: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`

3. **pnpm** (可选，推荐)
   ```bash
   npm install -g pnpm
   ```

### 构建步骤

#### Windows

```cmd
# 方式 1: 使用构建脚本
build.bat

# 方式 2: 手动构建
npm install
npm run tauri build
```

#### macOS / Linux

```bash
# 方式 1: 使用构建脚本
chmod +x build.sh
./build.sh

# 方式 2: 手动构建
npm install
npm run tauri build
```

### 构建产物

构建完成后，安装包位于：

- **Windows**: `src-tauri/target/release/bundle/msi/` 或 `nsis/`
- **macOS**: `src-tauri/target/release/bundle/dmg/`
- **Linux**: `src-tauri/target/release/bundle/appimage/`

## 开发模式

如果你想调试或修改代码：

```bash
# 启动开发服务器
npm run tauri:dev

# 这会同时启动：
# - Vite 开发服务器 (http://localhost:1420)
# - Tauri 窗口 (热重载)
```

## 常见问题

### 1. Rust 编译错误

**问题**: `error: linker 'link.exe' not found`

**解决**: 安装 Visual Studio Build Tools
- 下载: https://visualstudio.microsoft.com/downloads/
- 选择 "Desktop development with C++"

### 2. Node.js 版本不兼容

**问题**: `error: Node.js version 18.x is not supported`

**解决**: 升级到 Node.js 22+
```bash
# 使用 nvm (推荐)
nvm install 22
nvm use 22
```

### 3. Windows 上 WMI 检测失败

**问题**: GPU 信息无法获取

**解决**: 
- 确保安装了 NVIDIA 驱动
- 安装器会自动回退到 nvidia-smi 检测

### 4. 构建体积过大

**解决**: 
- 使用 `--release` 模式构建（默认）
- Tauri 已配置 `strip = true` 和 `opt-level = "z"`

## 下一步

安装完成后：

1. **启动 OpenClaw**
   ```bash
   openclaw
   ```

2. **测试本地模型**
   ```bash
   openclaw chat
   ```
   然后输入: "你好，请介绍一下你自己"

3. **查看已安装模型**
   ```bash
   ollama list
   ```

4. **切换模型**
   编辑 `~/.openclaw/openclaw.json`，修改 `agents.defaults.model.primary`

## 需要帮助？

- 📖 [OpenClaw 官方文档](https://docs.openclaw.ai)
- 💬 [Discord 社区](https://discord.com/invite/clawd)
- 🐛 [问题反馈](https://github.com/your-repo/issues)
