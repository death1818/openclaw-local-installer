#!/bin/bash
# 快速演示脚本 - 展示项目结构

echo "🐾 OpenClaw 本地版安装器 - 项目结构"
echo "=================================="
echo ""

echo "📁 项目文件:"
find . -type f -not -path '*/node_modules/*' -not -path '*/target/*' | sort | sed 's/^/  /'

echo ""
echo "📊 代码统计:"
echo "  Rust 后端:    $(find ./src-tauri/src -name '*.rs' | xargs wc -l | tail -1 | awk '{print $1}') 行"
echo "  React 前端:   $(find ./src -name '*.tsx' -o -name '*.ts' | xargs wc -l | tail -1 | awk '{print $1}') 行"
echo "  文档:         $(find . -name '*.md' | xargs wc -l | tail -1 | awk '{print $1}') 行"

echo ""
echo "🎯 快速开始:"
echo "  1. npm install              # 安装依赖"
echo "  2. npm run tauri:dev        # 开发模式"
echo "  3. npm run tauri:build      # 构建安装包"

echo ""
echo "📖 查看文档:"
echo "  cat README.md               # 项目介绍"
echo "  cat QUICKSTART.md           # 快速开始"
echo "  cat DEVELOPMENT.md          # 开发指南"
