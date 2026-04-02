# 发布指南

## 方式 1: 手动触发构建

1. 进入 GitHub Actions 页面
2. 选择 "Build and Release" 工作流
3. 点击 "Run workflow"
4. 输入版本号（如 `v0.2.0`）
5. 等待构建完成（约 15-20 分钟）
6. 前往 Releases 页面下载安装包

## 方式 2: 通过标签自动构建

```bash
# 创建并推送标签
git tag v0.2.0
git push origin v0.2.0

# GitHub Actions 会自动构建并创建 Release
```

## 构建产物

构建完成后，会在 Releases 页面生成：

### Windows
- `OpenClaw-Local-Installer_x64-setup.exe` (NSIS 安装包，推荐)
- `OpenClaw-Local-Installer_x64.msi` (MSI 安装包)

### macOS
- `OpenClaw-Local-Installer_universal.dmg` (通用二进制，支持 Intel 和 Apple Silicon)

### Linux
- `OpenClaw-Local-Installer_amd64.AppImage` (便携版)
- `openclaw-local-installer_xxx_amd64.deb` (Debian/Ubuntu)

## 版本号规范

遵循语义化版本：
- `v1.0.0` - 重大版本更新
- `v0.1.0` - 功能更新
- `v0.0.1` - Bug 修复

## 发布前检查清单

- [ ] 更新 `package.json` 中的版本号
- [ ] 更新 `src-tauri/Cargo.toml` 中的版本号
- [ ] 更新 `src-tauri/tauri.conf.json` 中的版本号
- [ ] 更新 `CHANGELOG.md`
- [ ] 测试所有功能
- [ ] 提交所有更改
- [ ] 创建标签并推送

## 发布后操作

1. 编辑 GitHub Release
2. 添加发布说明
3. 上传额外的资源文件（如有）
4. 发布到社区/官网

## 回滚

如果发现严重问题：

```bash
# 删除标签
git tag -d v0.2.0
git push origin :refs/tags/v0.2.0

# 删除 GitHub Release
# 在 GitHub 网页上手动删除
```
