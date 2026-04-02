# OpenClaw 本地版安装器

🐾 **一键安装 OpenClaw 本地版** - 零 API 费用，完全本地化，自动硬件检测与模型推荐

## ✨ 特性

- 🖥️ **自动硬件检测** - 检测 GPU VRAM、内存、CPU，智能推荐最适合的模型
- 🎯 **一键安装** - 自动安装 Ollama、下载模型、配置 OpenClaw
- 🔒 **完全本地化** - 无需任何 API Key，数据不出本地
- 💰 **零费用** - 使用本地算力，无 API 调用费用
- 🇨🇳 **中文优先** - 优先推荐中文能力强的模型（Qwen、GLM、DeepSeek）

## 📸 截图

![硬件检测](docs/screenshots/hardware-detection.png)
![模型选择](docs/screenshots/model-selection.png)

## 🚀 快速开始

### 下载安装包

前往 [Releases](https://github.com/your-repo/releases) 页面下载最新版本：

- **Windows**: `OpenClaw-Local-Installer-Setup.exe`（推荐）
- **macOS**: `OpenClaw-Local-Installer.dmg`
- **Linux**: `OpenClaw-Local-Installer.AppImage`

### 安装步骤

1. **运行安装器** - 双击下载的安装程序
2. **硬件检测** - 自动检测你的电脑配置
3. **选择模型** - 根据推荐选择要安装的模型
4. **等待安装** - 自动下载并配置所有组件
5. **开始使用** - 运行 `openclaw` 命令启动！

## 🛠️ 从源码构建

### 前置要求

- **Rust** 1.70+ - [安装 Rust](https://rustup.rs/)
- **Node.js** 22+ - [安装 Node.js](https://nodejs.org/)
- **pnpm/npm** - Node 包管理器

### 构建步骤

```bash
# 克隆仓库
git clone https://github.com/your-repo/openclaw-local-installer.git
cd openclaw-local-installer

# 安装依赖
npm install

# 开发模式
npm run tauri:dev

# 构建生产版本
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/bundle/` 目录。

## 📋 支持的模型

安装器会根据你的硬件自动推荐模型：

| 硬件配置 | 推荐模型 | 说明 |
|---------|---------|------|
| VRAM < 6GB | Phi-3.5 3.8B | 轻量级，适合低配电脑 |
| VRAM 6-8GB | Llama 3.1 8B / Qwen 2.5 7B | 主流选择 |
| VRAM 8-12GB | GLM 4.7 Flash | 智谱最新，中文强 |
| VRAM 12-24GB | Qwen 2.5 Coder 14B / DeepSeek R1 14B | 代码/推理增强 |
| VRAM > 24GB | Qwen 2.5 32B | 旗舰模型，最佳质量 |

## 🔧 工作原理

1. **硬件检测** - 使用 `sysinfo` + `nvidia-smi`/WMI 检测硬件
2. **模型推荐** - 根据 VRAM 和 RAM 计算推荐模型
3. **安装 Ollama** - 自动下载并安装 Ollama 运行时
4. **下载模型** - 通过 `ollama pull` 下载选定的模型
5. **配置 OpenClaw** - 生成 `~/.openclaw/openclaw.json` 配置文件

生成的配置示例：

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
        "primary": "ollama/qwen2.5-coder:14b"
      }
    }
  }
}
```

## 📦 技术栈

- **前端**: React 18 + TypeScript + Tailwind CSS
- **后端**: Rust + Tauri 2.0
- **打包**: Tauri Builder (生成 MSI/NSIS/DMG/AppImage)
- **硬件检测**: sysinfo + nvidia-smi + WMI

## 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- [OpenClaw](https://openclaw.ai) - AI Agent 框架
- [Ollama](https://ollama.com) - 本地 LLM 运行时
- [Tauri](https://tauri.app) - 跨平台桌面应用框架

---

**Made with ❤️ by OpenClaw Community**
