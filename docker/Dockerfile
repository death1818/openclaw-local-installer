# OpenClaw 本地版 Docker 镜像
# 由缘辉旺团队维护，基于 npm 官方包 + OLLAMA_HOST 补丁

FROM node:22-bookworm-slim

LABEL maintainer="缘辉旺团队"
LABEL description="OpenClaw 本地版 Gateway - 支持 OLLAMA_HOST 环境变量自动发现宿主机 Ollama"
LABEL version="1.1.0"

ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装 openclaw
RUN npm install -g openclaw@latest

# ===== OLLAMA_HOST 补丁 =====
# 让 resolveOllamaApiBase() 优先读取 OLLAMA_HOST 环境变量
# 解决 Docker 容器内 localhost:11434 无法访问宿主机 Ollama 的问题
COPY patch-ollama-host.js /tmp/patch-ollama-host.js
RUN node /tmp/patch-ollama-host.js && rm /tmp/patch-ollama-host.js

RUN mkdir -p /root/.openclaw

EXPOSE 18789

# OLLAMA_HOST: Docker 内通过 host.docker.internal 访问宿主机 Ollama
ENV OLLAMA_HOST=host.docker.internal:11434
ENV OPENCLAW_PORT=18789

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:18789/api/health || exit 1

CMD ["npx", "openclaw", "gateway", "start", "--host", "0.0.0.0"]
