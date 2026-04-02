# OpenClaw 本地版安装器

<div align="center">

🐾 **零 API 费用 · 完全本地化 · 隐私安全**

[![Build](https://github.com/your-repo/openclaw-local-installer/workflows/Build%20and%20Release/badge.svg)](https://github.com/your-repo/openclaw-local-installer/actions)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.2.0-green.svg)](https://github.com/your-repo/openclaw-local-installer/releases)

</div>

---

## 📖 项目简介

OpenClaw 本地版安装器是一个**一键式安装工具**，帮助用户在本地部署 OpenClaw AI 助手，无需任何 API Key，完全使用本地算力运行。

### ✨ 核心特性

| 特性 | 说明 |
|------|------|
| 🖥️ **硬件自动检测** | 检测 CPU、GPU、内存，智能推荐最适合的模型 |
| 🎯 **一键安装** | 自动安装 Ollama、下载模型、配置 OpenClaw |
| 🌓 **深色模式** | 支持亮色/深色主题切换 |
| 📊 **下载进度** | 实时显示模型下载进度、速度 |
| 🔧 **模型管理** | 查看已安装模型、详情、删除模型 |
| 🔄 **自动更新** | 自动检查更新、一键安装新版本 |
| 🌐 **跨平台** | 支持 Windows、macOS、Linux |

---

## 🚀 快速开始

### 下载安装包

前往 [Releases](https://github.com/your-repo/openclaw-local-installer/releases) 页面下载：

- **Windows**: `OpenClaw-Local-Installer-Setup.exe`
- **macOS**: `OpenClaw-Local-Installer.dmg`
- **Linux**: `OpenClaw-Local-Installer.AppImage`

### 安装步骤

1. 运行安装器
2. 自动检测硬件
3. 选择推荐模型
4. 等待安装完成
5. 运行 `openclaw` 开始使用！

---

## 📸 功能预览

### 硬件检测
自动检测 CPU、GPU、内存，并根据硬件配置推荐最佳模型。

### 深色模式
一键切换亮色/深色主题，保护眼睛。

### 下载进度
实时显示模型下载进度，包括速度、剩余时间。

### 模型管理
查看已安装模型、详细信息，支持删除不需要的模型。

---

## 🎯 模型推荐

安装器根据硬件自动推荐：

| 硬件配置 | 推荐模型 | 说明 |
|---------|---------|------|
| VRAM < 6GB | Phi-3.5 3.8B | 轻量级，适合低配电脑 |
| VRAM 6-8GB | Llama 3.1 8B / Qwen 2.5 7B | 主流选择 |
| VRAM 8-12GB | GLM 4.7 Flash | 智谱最新，中文强 |
| VRAM 12-24GB | Qwen 2.5 Coder 14B | 代码增强 |
| VRAM > 24GB | Qwen 2.5 32B | 旗舰模型 |

---

## 📦 从源码构建

### 前置要求

- **Rust** 1.70+
- **Node.js** 22+
- **pnpm/npm**

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

构建产物位于 `src-tauri/target/release/bundle/`

---

## 🛠️ 技术栈

- **前端**: React 18 + TypeScript + Tailwind CSS
- **后端**: Rust + Tauri 2.0
- **打包**: Tauri Builder (MSI/NSIS/DMG/AppImage)
- **硬件检测**: sysinfo + nvidia-smi + WMI + system_profiler
- **自动更新**: tauri-plugin-updater

---

## 📚 文档

- [快速开始](QUICKSTART.md) - 详细的安装和使用指南
- [开发指南](DEVELOPMENT.md) - 贡献代码和调试
- [架构说明](ARCHITECTURE.md) - 技术细节和设计决策
- [更新日志](CHANGELOG.md) - 版本历史
- [快速参考](CHEATSHEET.md) - 常用命令和技巧

---

## 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

- [OpenClaw](https://openclaw.ai) - AI Agent 框架
- [Ollama](https://ollama.com) - 本地 LLM 运行时
- [Tauri](https://tauri.app) - 跨平台桌面应用框架

---

<div align="center">

**Made with ❤️ by OpenClaw Community**

[官网](https://openclaw.ai) · [文档](https://docs.openclaw.ai) · [Discord](https://discord.com/invite/clawd)

</div>
