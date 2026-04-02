#!/bin/bash
# OpenClaw 本地版安装器 - 构建脚本

set -e

echo "🦀 安装 Rust 依赖..."
cd src-tauri
cargo fetch

echo ""
echo "📦 安装 Node.js 依赖..."
cd ..
npm install

echo ""
echo "🔨 构建前端..."
npm run build

echo ""
echo "🚀 构建 Tauri 应用..."
npm run tauri build

echo ""
echo "✅ 构建完成！"
echo "安装包位置: src-tauri/target/release/bundle/"
