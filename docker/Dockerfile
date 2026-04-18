# OpenClaw 本地版 Docker 镜像
# 由缘辉旺团队维护，基于 npm 官方包 + OLLAMA_HOST 补丁

FROM node:22-bookworm-slim

LABEL maintainer="缘辉旺团队"
LABEL description="OpenClaw 本地版 Gateway - 支持 OLLAMA_HOST 环境变量自动发现宿主机 Ollama"
LABEL version="2.6.84"

ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 安装所有必要工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl git openssh-client ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*

# 验证 git 安装
RUN git --version

# 配置 git 用 https 替代所有 ssh/git 协议
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ && \
    git config --global url."https://github.com/".insteadOf git@github.com: && \
    git config --global url."https://gitlab.com/".insteadOf git@gitlab.com: && \
    git config --global url."https://".insteadOf git://

WORKDIR /app

# 安装 openclaw（使用 --ignore-scripts 跳过可能失败的后置脚本）
RUN npm install -g openclaw@latest --ignore-scripts || npm install -g openclaw@latest

# 验证安装
RUN which openclaw && ls -la /usr/local/lib/node_modules/openclaw/

# ===== OLLAMA_HOST 补丁 =====
COPY patch-ollama-host.js /tmp/patch-ollama-host.js
RUN node /tmp/patch-ollama-host.js && rm /tmp/patch-ollama-host.js

RUN mkdir -p /root/.openclaw

EXPOSE 18789

ENV OLLAMA_HOST=host.docker.internal:11434
ENV OPENCLAW_PORT=18789

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:18789/api/health || exit 1

CMD ["/usr/local/bin/openclaw", "gateway", "start", "--host", "0.0.0.0"]
