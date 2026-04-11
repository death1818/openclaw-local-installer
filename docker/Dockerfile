# OpenClaw 本地版 Docker 镜像
# 由缘辉旺团队维护，基于 npm 官方包构建

FROM node:20-bookworm-slim

LABEL maintainer="缘辉旺团队"
LABEL description="OpenClaw 本地版 Gateway"
LABEL version="1.0.0"

# 设置时区
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 安装必要工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 创建工作目录
WORKDIR /app

# 安装 openclaw
RUN npm install -g openclaw

# 创建配置目录
RUN mkdir -p /root/.openclaw

# 暴露端口
EXPOSE 18789

# 设置环境变量 - 连接宿主机 Ollama
ENV OLLAMA_HOST=host.docker.internal:11434
ENV OPENCLAW_PORT=18789

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:18789/api/health || exit 1

# 启动命令
CMD ["openclaw", "gateway", "start", "--host", "0.0.0.0"]
