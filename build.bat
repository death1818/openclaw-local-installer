@echo off
REM OpenClaw 本地版安装器 - Windows 构建脚本

echo 🦀 安装 Rust 依赖...
cd src-tauri
cargo fetch

echo.
echo 📦 安装 Node.js 依赖...
cd ..
call npm install

echo.
echo 🔨 构建前端...
call npm run build

echo.
echo 🚀 构建 Tauri 应用...
call npm run tauri build

echo.
echo ✅ 构建完成！
echo 安装包位置: src-tauri\target\release\bundle\
pause
