// OLLAMA_HOST 补丁脚本
// 让 resolveOllamaApiBase() 优先读取 OLLAMA_HOST 环境变量

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 获取全局 node_modules 目录
const globalNodeModules = execSync('npm root -g', { encoding: 'utf8' }).trim();
const openclawDir = path.join(globalNodeModules, 'openclaw');
const distDir = path.join(openclawDir, 'dist');

console.log('Global node_modules:', globalNodeModules);
console.log('OpenClaw dist directory:', distDir);

if (!fs.existsSync(distDir)) {
  console.error('ERROR: dist directory not found:', distDir);
  process.exit(1);
}

// 要插入的 resolveOllamaHostEnv 函数
const hostEnvFunc = `
function resolveOllamaHostEnv() {
  if (typeof process !== "undefined" && process.env?.OLLAMA_HOST?.trim()) {
    let h = process.env.OLLAMA_HOST.trim();
    if (!h.startsWith("http://") && !h.startsWith("https://")) {
      h = "http://" + h;
    }
    return h.replace(/\\/\\/+$/, "").replace(/\\/v1$/i, "");
  }
  return undefined;
}
`;

// 遍历 provider-models-*.js 文件
const files = fs.readdirSync(distDir).filter(f => f.startsWith('provider-models-') && f.endsWith('.js'));

let patched = 0;
for (const file of files) {
  const filePath = path.join(distDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes('function resolveOllamaApiBase') && content.includes('return OLLAMA_DEFAULT_BASE_URL')) {
    console.log('Patching:', file);

    // 在 resolveOllamaApiBase 前插入 resolveOllamaHostEnv
    content = content.replace(
      /function resolveOllamaApiBase/,
      hostEnvFunc + 'function resolveOllamaApiBase'
    );

    // 修改返回逻辑
    content = content.replace(
      /return OLLAMA_DEFAULT_BASE_URL/g,
      'return resolveOllamaHostEnv() ?? OLLAMA_DEFAULT_BASE_URL'
    );

    fs.writeFileSync(filePath, content);
    console.log('OK:', file, 'patched');
    patched++;
  }
}

// 更新 provider-discovery.js
const discoveryPath = path.join(distDir, 'extensions', 'ollama', 'provider-discovery.js');
if (fs.existsSync(discoveryPath)) {
  console.log('Patching: extensions/ollama/provider-discovery.js');
  let content = fs.readFileSync(discoveryPath, 'utf8');
  content = content.replace(
    /envVars:\["OLLAMA_API_KEY"\]/g,
    'envVars:["OLLAMA_API_KEY","OLLAMA_HOST"]'
  );
  fs.writeFileSync(discoveryPath, content);
  console.log('OK: provider-discovery.js patched');
  patched++;
}

if (patched === 0) {
  console.error('ERROR: No files were patched!');
  process.exit(1);
}

console.log('===== OLLAMA_HOST patch applied successfully! =====');
