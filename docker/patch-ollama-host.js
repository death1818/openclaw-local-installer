// OLLAMA_HOST 补丁脚本
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const globalNodeModules = execSync('npm root -g', { encoding: 'utf8' }).trim();
const openclawDir = path.join(globalNodeModules, 'openclaw');
const distDir = path.join(openclawDir, 'dist');

console.log('OpenClaw dist:', distDir);

if (!fs.existsSync(distDir)) {
  console.error('ERROR: dist not found');
  process.exit(1);
}

// 用字符串操作，不用正则
const hostEnvFunc = 'function resolveOllamaHostEnv(){if(typeof process!=="undefined"&&process.env&&process.env.OLLAMA_HOST&&process.env.OLLAMA_HOST.trim()){let h=process.env.OLLAMA_HOST.trim();if(!h.startsWith("http://")&&!h.startsWith("https://")){h="http://"+h}while(h.endsWith("/")){h=h.slice(0,-1)}if(h.endsWith("/v1")){h=h.slice(0,-3)}return h}return undefined}';

const files = fs.readdirSync(distDir).filter(f => f.startsWith('provider-models-') && f.endsWith('.js'));

let patched = 0;
for (const file of files) {
  const filePath = path.join(distDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes('function resolveOllamaApiBase') && content.includes('OLLAMA_DEFAULT_BASE_URL')) {
    console.log('Patching:', file);
    content = content.replace('function resolveOllamaApiBase', hostEnvFunc + 'function resolveOllamaApiBase');
    content = content.replace(/return OLLAMA_DEFAULT_BASE_URL/g, 'return resolveOllamaHostEnv()??OLLAMA_DEFAULT_BASE_URL');
    fs.writeFileSync(filePath, content);
    console.log('OK:', file);
    patched++;
  }
}

const discoveryPath = path.join(distDir, 'extensions', 'ollama', 'provider-discovery.js');
if (fs.existsSync(discoveryPath)) {
  console.log('Patching: provider-discovery.js');
  let content = fs.readFileSync(discoveryPath, 'utf8');
  content = content.replace('"OLLAMA_API_KEY"', '"OLLAMA_API_KEY","OLLAMA_HOST"');
  fs.writeFileSync(discoveryPath, content);
  console.log('OK: provider-discovery.js');
  patched++;
}

if (patched === 0) {
  console.error('ERROR: No files patched');
  process.exit(1);
}

console.log('===== PATCH SUCCESS =====');