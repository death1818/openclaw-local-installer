# Windows 构建准备清单

在给你 Windows SSH 之前，请确认以下事项：

## ✅ 必须完成

### 1. 安装 Visual Studio Build Tools
```
下载: https://visualstudio.microsoft.com/downloads/
选择: "Desktop development with C++"
包含: MSVC v143, Windows 10 SDK
```

### 2. 安装 Rust
```
下载: https://rustup.rs/
运行: rustup-init.exe
选择: 默认安装 (1)
验证: rustc --version
```

### 3. 安装 Node.js
```
下载: https://nodejs.org/
版本: 22.x LTS
验证: node --version && npm --version
```

### 4. 重启终端
安装完成后，关闭所有终端窗口，重新打开。

---

## 📁 项目文件

将以下目录复制到 Windows：
```
openclaw-local-installer/
├── src-tauri/
├── src/
├── public/
├── package.json
├── Cargo.toml (根目录的)
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── ...
```

**注意**: 不需要复制 `node_modules/` 和 `target/`（如果有的话）

---

## 🔧 构建命令

在 PowerShell 中执行：

```powershell
# 1. 进入项目目录
cd openclaw-local-installer

# 2. 安装 Node.js 依赖
npm install

# 3. 构建前端
npm run build

# 4. 构建 Tauri 应用
npm run tauri build

# 或者使用一键脚本
.\build.bat
```

---

## 📦 构建产物

成功后，安装包位于：
```
src-tauri\target\release\bundle\
├── msi\
│   └── OpenClaw本地版_0.2.0_x64.msi
└── nsis\
    └── OpenClaw本地版_0.2.0_x64-setup.exe
```

推荐使用 **NSIS** 安装包（更小、安装更快）

---

## ⚠️ 常见问题

### 问题 1: "link.exe not found"
**解决**: 安装 Visual Studio Build Tools，选择 "Desktop development with C++"

### 问题 2: "cargo not found"
**解决**: 重启终端，或手动添加 Rust 到 PATH:
```
%USERPROFILE%\.cargo\bin
```

### 问题 3: "npm install 失败"
**解决**: 
```powershell
# 清理缓存
npm cache clean --force
# 使用管理员权限
```

### 问题 4: "Rust 编译错误"
**解决**: 更新 Rust 到最新版本
```powershell
rustup update stable
```

---

## 🎯 一键构建脚本

如果一切就绪，直接运行：
```powershell
.\build.bat
```

这会自动：
1. 安装 Rust 依赖
2. 安装 Node.js 依赖
3. 构建前端
4. 构建 Tauri 应用

---

## 📝 确认清单

请确认以下所有项：

- [ ] Visual Studio Build Tools 已安装
- [ ] Rust 已安装 (`rustc --version` 成功)
- [ ] Node.js 22+ 已安装 (`node --version` 成功)
- [ ] 项目文件已复制到 Windows
- [ ] 已重启终端
- [ ] 准备好提供 SSH 访问

确认无误后，请提供 Windows SSH 连接信息。
