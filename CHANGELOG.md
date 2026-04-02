# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-04-02

### Added
- ✨ **下载进度条** - 实时显示模型下载进度、速度、剩余大小
- 🎨 **深色模式** - 支持亮色/深色主题切换，自动保存偏好
- 🔧 **模型管理 UI** - 查看已安装模型、查看详情、删除模型
- 🔄 **自动更新** - 自动检查更新、下载更新、一键安装
- 🐧 **Linux 支持** - 支持 NVIDIA/AMD/Intel GPU 检测
- 🍎 **macOS 支持** - 支持 Apple Silicon Metal GPU 检测
- 🚨 **改进错误提示** - 友好的错误弹窗、自动消失、详细错误信息
- 📦 **更新下载进度** - 显示更新包下载进度

### Changed
- 重构前端组件结构，支持复杂交互
- 改进硬件检测跨平台兼容性
- 优化模型下载流程，支持取消下载

### Technical
- 新增 `download.rs` 模块处理下载进度
- 新增 `models.rs` 模块管理已安装模型
- 新增 `updater.rs` 模块处理自动更新
- 添加 `tauri-plugin-updater` 依赖
- 支持 Windows/macOS/Linux 三平台

## [0.1.0] - 2026-04-02

### Added
- ✨ 初始版本发布
- 🖥️ 硬件自动检测（CPU、RAM、GPU）
- 🎯 智能模型推荐（11+ 模型）
- 📦 一键安装流程
- 🌐 Windows 支持
- 📝 完整文档体系

### Technical
- Tauri 2.0 + React 架构
- Rust 后端硬件检测
- TypeScript 前端
- Tailwind CSS 样式

---

## Roadmap

### [0.3.0] - Planned
- [ ] 多语言支持（英文/中文）
- [ ] 自定义安装路径
- [ ] 模型切换 UI
- [ ] 系统托盘常驻模式

### [0.4.0] - Planned
- [ ] AMD ROCm GPU 支持
- [ ] Intel Arc GPU 检测优化
- [ ] 云端模型管理
- [ ] 备份/恢复配置

---

## Version Naming Convention

- **Major (X.0.0)**: 重大架构变更、不兼容更新
- **Minor (0.X.0)**: 新功能、功能增强
- **Patch (0.0.X)**: Bug 修复、小改进
