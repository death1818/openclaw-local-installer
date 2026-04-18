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
RUN npm install -g openclaw

# ===== OLLAMA_HOST 补丁 =====
# 让 resolveOllamaApiBase() 优先读取 OLLAMA_HOST 环境变量
# 解决 Docker 容器内 localhost:11434 无法访问宿主机 Ollama 的问题
RUN set -e && \
    OPENCLAW_DIR=$(dirname $(readlink -f $(which openclaw 2>/dev/null || echo /usr/local/bin/openclaw))) && \
    DIST_DIR="${OPENCLAW_DIR}/dist" && \
    echo "OpenClaw dist directory: ${DIST_DIR}" && \
    # 遍历所有 provider-models-*.js 文件 \
    for f in "${DIST_DIR}"/provider-models-*.js; do \
      if [ -f "$f" ]; then \
        echo "Checking: $(basename $f)" && \
        # 检查是否包含需要修改的代码 \
        if grep -q 'function resolveOllamaApiBase' "$f" && grep -q 'return OLLAMA_DEFAULT_BASE_URL' "$f"; then \
          echo "Patching: $(basename $f)" && \
          # 在 resolveOllamaApiBase 函数前插入 resolveOllamaHostEnv 函数 \
          sed -i '/function resolveOllamaApiBase/i\
function resolveOllamaHostEnv(){\
if(typeof process!=="undefined"&&process.env?.OLLAMA_HOST?.trim()){\
let h=process.env.OLLAMA_HOST.trim();\
if(!h.startsWith("http://")&&!h.startsWith("https://"))h="http://"+h;\
return h.replace(/\\/+$|,"").replace(/\\/v1$/i,"")\
}\
return undefined\
}\
' "$f" && \
          # 修改 resolveOllamaApiBase 返回逻辑 \
          sed -i 's/return OLLAMA_DEFAULT_BASE_URL/return resolveOllamaHostEnv()??OLLAMA_DEFAULT_BASE_URL/' "$f" && \
          echo "OK: $(basename $f) patched"; \
        fi; \
      fi; \
    done && \
    # 更新 ollama provider-discovery.js 的 envVars \
    if [ -f "${DIST_DIR}/extensions/ollama/provider-discovery.js" ]; then \
      echo "Patching: extensions/ollama/provider-discovery.js" && \
      sed -i 's/envVars:\["OLLAMA_API_KEY"\]/envVars:["OLLAMA_API_KEY","OLLAMA_HOST"]/' "${DIST_DIR}/extensions/ollama/provider-discovery.js" && \
      echo "OK: provider-discovery.js patched"; \
    fi && \
    echo "===== OLLAMA_HOST patch applied successfully! ====="

RUN mkdir -p /root/.openclaw

EXPOSE 18789

# OLLAMA_HOST: Docker 内通过 host.docker.internal 访问宿主机 Ollama
ENV OLLAMA_HOST=host.docker.internal:11434
ENV OPENCLAW_PORT=18789

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:18789/api/health || exit 1

CMD ["npx", "openclaw", "gateway", "start", "--host", "0.0.0.0"]
