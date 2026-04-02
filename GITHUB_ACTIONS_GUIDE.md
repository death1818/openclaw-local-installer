# 快速开始 - GitHub Actions 自动构建

## 🎯 目标

使用 GitHub Actions 自动构建三平台安装包，无需任何服务器！

---

## 📋 步骤 1: 创建 GitHub 仓库

### 方式 A: 在 GitHub 网站创建

1. 访问 https://github.com/new
2. 填写信息：
   - Repository name: `openclaw-local-installer`
   - Description: `OpenClaw 本地版安装器 - 零 API 费用，完全本地化`
   - Public 或 Private（任选）
   - ❌ **不要**勾选 "Add a README file"
   - ❌ **不要**勾选 "Add .gitignore"
   - ❌ **不要**勾选 "Choose a license"
3. 点击 "Create repository"

### 方式 B: 使用 GitHub CLI（如果已安装）

```bash
gh repo create openclaw-local-installer --public --description "OpenClaw 本地版安装器"
```

---

## 📋 步骤 2: 推送代码

创建仓库后，GitHub 会显示推送命令。你需要：

### 如果你用 HTTPS（推荐）

```bash
cd /root/.openclaw/workspace/openclaw-local-installer

# 添加远程仓库（替换 YOUR_USERNAME）
git remote add origin https://github.com/YOUR_USERNAME/openclaw-local-installer.git

# 推送代码
git push -u origin main
```

### 如果你用 SSH

```bash
git remote add origin git@github.com:YOUR_USERNAME/openclaw-local-installer.git
git push -u origin main
```

---

## 📋 步骤 3: 触发构建

### 方式 A: 手动触发（推荐）

1. 推送完成后，访问你的仓库
2. 点击 "Actions" 标签
3. 选择 "Build and Release" 工作流
4. 点击 "Run workflow"
5. 输入版本号（如 `v0.2.0`）
6. 点击绿色按钮 "Run workflow"
7. 等待 15-20 分钟

### 方式 B: 通过标签触发

```bash
# 创建标签
git tag v0.2.0

# 推送标签
git push origin v0.2.0

# GitHub Actions 会自动构建
```

---

## 📋 步骤 4: 下载安装包

构建完成后：

1. 访问你的仓库
2. 点击右侧 "Releases"
3. 找到对应的版本
4. 下载安装包：

### Windows
- `OpenClaw-Local-Installer_x64-setup.exe` ✅ 推荐

### macOS
- `OpenClaw-Local-Installer_universal.dmg`

### Linux
- `OpenClaw-Local-Installer_amd64.AppImage`

---

## 🎁 已准备好的文件

我已经为你准备好了：

✅ `.github/workflows/release.yml` - GitHub Actions 配置
✅ `RELEASE_GUIDE.md` - 发布指南
✅ 完整的项目代码
✅ Git 仓库已初始化
✅ 首次提交已完成

---

## 🔑 需要你做的

### 选项 1: 你自己推送（推荐）

如果你有 GitHub 账号：

1. 创建仓库: https://github.com/new
2. 告诉我你的 GitHub 用户名
3. 我帮你推送代码

### 选项 2: 给我你的 GitHub Token

如果你想让我完全代劳：

1. 创建 Personal Access Token: https://github.com/settings/tokens/new
   - 选择 "repo" 权限
   - 生成 token
2. 告诉我 token
3. 我帮你创建仓库并推送

---

## 💡 优势

使用 GitHub Actions：

✅ **完全自动化** - 无需服务器
✅ **三平台支持** - Windows/macOS/Linux 同时构建
✅ **免费** - GitHub 提供免费的构建时间
✅ **可靠** - GitHub 服务器稳定快速
✅ **版本管理** - 自动创建 Release
✅ **可追溯** - 构建日志永久保存

---

## 📞 下一步

**请告诉我**：

1. **"我有 GitHub 账号，用户名是 XXX"**
   → 我帮你推送代码

2. **"帮我创建仓库，这是我的 token: ghp_xxx"**
   → 我帮你完全搞定

3. **"我想自己操作"**
   → 按照上面的步骤操作即可

---

**等待你的回复！** 🚀
