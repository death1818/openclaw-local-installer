import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

interface GpuInfo {
  name: string
  vram_gb: number
  vendor: string
}

interface HardwareInfo {
  cpu_name: string
  cpu_cores: number
  ram_gb: number
  gpus: GpuInfo[]
  has_nvidia: boolean
  total_vram_gb: number
}

interface ModelRecommendation {
  name: string
  display_name: string
  size_gb: number
  description: string
  min_vram: number
  min_ram: number
  recommended: boolean
  tags: string[]
}

interface InstalledModel {
  name: string
  modified_at: string
  size: string
}

interface ModelDetails {
  format: string
  family: string
  parameter_size: string
  quantization_level: string
}

interface UpdateInfo {
  version: string
  release_date: string
  release_notes: string
  download_url: string
  file_size: number
}

interface DownloadProgress {
  phase: string
  current: number
  total: number
  percent: number
}

type InstallStep = 'welcome' | 'detecting' | 'select-model' | 'installing' | 'complete' | 'model-management'
type Theme = 'light' | 'dark'

function App() {
  const [step, setStep] = useState<InstallStep>('welcome')
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme')
    return (saved as Theme) || 'light'
  })
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [models, setModels] = useState<ModelRecommendation[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [installLog, setInstallLog] = useState<string[]>([])
  const [ollamaInstalled, setOllamaInstalled] = useState(false)
  const [openclawInstalled, setOpenclawInstalled] = useState(false)
  
  // 新增状态
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'completed' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([])
  const [selectedInstalledModel, setSelectedInstalledModel] = useState<string | null>(null)
  const [modelDetails, setModelDetails] = useState<ModelDetails | null>(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState<number>(0)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)

  useEffect(() => {
    // 应用主题
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    // 监听所有事件
    const listeners = [
      listen<string>('install-progress', (event) => {
        setInstallLog(prev => [...prev, event.payload])
      }),
      listen<string>('model-download-log', (event) => {
        setInstallLog(prev => [...prev, event.payload])
      }),
      listen<DownloadProgress>('model-download-progress', (event) => {
        setDownloadProgress(event.payload)
      }),
      listen<string>('model-download-status', (event) => {
        const status = event.payload
        setDownloadStatus(status as any)
        if (status === 'completed') {
          loadInstalledModels()
        }
      }),
      listen<number>('update-download-progress', (event) => {
        setUpdateDownloadProgress(event.payload)
      }),
      listen<string>('update-download-status', (event) => {
        if (event.payload === 'completed') {
          setShowUpdateDialog(true)
        }
      }),
    ]

    return () => {
      listeners.forEach(l => l.then(f => f()))
    }
  }, [])

  // 检查更新
  useEffect(() => {
    checkForUpdates()
  }, [])

  const checkForUpdates = async () => {
    try {
      const info = await invoke<UpdateInfo | null>('check_for_updates')
      if (info) {
        setUpdateInfo(info)
      }
    } catch (e) {
      console.error('检查更新失败:', e)
    }
  }

  const loadInstalledModels = async () => {
    try {
      const models = await invoke<InstalledModel[]>('list_models')
      setInstalledModels(models)
    } catch (e) {
      console.error('加载模型列表失败:', e)
    }
  }

  const showError = (message: string) => {
    setError(message)
    setTimeout(() => setError(null), 5000)
  }

  const startDetection = async () => {
    setStep('detecting')
    setError(null)
    try {
      const hw = await invoke<HardwareInfo>('detect_hardware')
      setHardware(hw)
      
      const modelList = await invoke<ModelRecommendation[]>('get_recommended_models', {
        vramGb: hw.total_vram_gb,
        ramGb: hw.ram_gb
      })
      setModels(modelList)
      
      const recommended = modelList.find(m => m.recommended)
      if (recommended) {
        setSelectedModel(recommended.name)
      }
      
      const ollamaOk = await invoke<boolean>('check_ollama_installed')
      setOllamaInstalled(ollamaOk)
      
      const openclawOk = await invoke<boolean>('check_openclaw_installed')
      setOpenclawInstalled(openclawOk)
      
      await loadInstalledModels()
      setStep('select-model')
    } catch (error) {
      console.error('硬件检测失败:', error)
      showError(`硬件检测失败: ${error}`)
      setStep('welcome')
    }
  }

  const startInstall = async () => {
    setStep('installing')
    setInstallLog([])
    setError(null)
    setDownloadStatus('idle')
    
    try {
      // 1. 安装 Ollama（如果需要）
      if (!ollamaInstalled) {
        setInstallLog(prev => [...prev, '📦 正在安装 Ollama...'])
        await invoke('install_ollama')
        setOllamaInstalled(true)
      } else {
        setInstallLog(prev => [...prev, '✅ Ollama 已安装'])
      }
      
      // 2. 下载模型（带进度）
      setDownloadStatus('downloading')
      setInstallLog(prev => [...prev, `⬇️ 正在下载模型: ${selectedModel}`])
      await invoke('pull_model', { modelName: selectedModel })
      
      // 3. 安装 OpenClaw（如果需要）
      if (!openclawInstalled) {
        setInstallLog(prev => [...prev, '📦 正在安装 OpenClaw...'])
        await invoke('install_openclaw')
        setOpenclawInstalled(true)
      } else {
        setInstallLog(prev => [...prev, '✅ OpenClaw 已安装'])
      }
      
      // 4. 配置 OpenClaw
      setInstallLog(prev => [...prev, '⚙️ 正在配置 OpenClaw...'])
      const configPath = await invoke<string>('configure_openclaw', { modelName: selectedModel })
      setInstallLog(prev => [...prev, `✅ 配置文件已创建: ${configPath}`])
      
      setStep('complete')
    } catch (error) {
      console.error('安装失败:', error)
      showError(`安装失败: ${error}`)
      setDownloadStatus('failed')
    }
  }

  const handleDeleteModel = async (modelName: string) => {
    if (!confirm(`确定要删除模型 "${modelName}" 吗？`)) return
    
    try {
      await invoke('delete_model', { modelName })
      await loadInstalledModels()
      setInstallLog(prev => [...prev, `✅ 已删除模型: ${modelName}`])
    } catch (e) {
      showError(`删除失败: ${e}`)
    }
  }

  const handleModelSelect = async (modelName: string) => {
    setSelectedInstalledModel(modelName)
    try {
      const details = await invoke<ModelDetails>('get_model_info', { modelName })
      setModelDetails(details)
    } catch (e) {
      console.error('获取模型详情失败:', e)
    }
  }

  const handleDownloadUpdate = async () => {
    try {
      await invoke('download_update')
    } catch (e) {
      showError(`下载更新失败: ${e}`)
    }
  }

  const handleInstallUpdate = async () => {
    try {
      await invoke('install_update')
    } catch (e) {
      showError(`安装更新失败: ${e}`)
    }
  }

  const isDark = theme === 'dark'

  return (
    <div className={`min-h-screen p-6 transition-colors duration-300 ${
      isDark ? 'bg-gray-900 text-gray-100' : 'bg-gradient-to-br from-blue-50 to-indigo-100'
    }`}>
      {/* 错误提示 */}
      {error && (
        <div className="fixed top-4 right-4 max-w-md bg-red-500 text-white p-4 rounded-lg shadow-lg z-50 flex items-start gap-3">
          <span className="text-xl">⚠️</span>
          <div className="flex-1">
            <div className="font-medium">错误</div>
            <div className="text-sm opacity-90">{error}</div>
          </div>
          <button onClick={() => setError(null)} className="text-white/80 hover:text-white">✕</button>
        </div>
      )}

      {/* 更新提示 */}
      {updateInfo && (
        <div className="fixed top-4 left-4 max-w-md bg-blue-500 text-white p-4 rounded-lg shadow-lg z-50">
          <div className="flex items-start gap-3">
            <span className="text-xl">🎉</span>
            <div className="flex-1">
              <div className="font-medium">发现新版本 v{updateInfo.version}</div>
              <div className="text-sm opacity-90 mt-1">{updateInfo.release_notes.split('\n')[0]}</div>
            </div>
            <button
              onClick={handleDownloadUpdate}
              className="px-3 py-1 bg-white text-blue-500 rounded text-sm font-medium hover:bg-blue-50"
            >
              更新
            </button>
          </div>
        </div>
      )}

      {/* 更新对话框 */}
      {showUpdateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`max-w-md w-full mx-4 p-6 rounded-xl shadow-2xl ${isDark ? 'bg-gray-800' : 'bg-white'}`}>
            <h3 className="text-xl font-bold mb-4">更新已下载</h3>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              新版本已下载完成，是否立即安装？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowUpdateDialog(false)}
                className={`flex-1 py-2 rounded-lg ${isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'}`}
              >
                稍后安装
              </button>
              <button
                onClick={handleInstallUpdate}
                className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                立即安装
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-2">
            <h1 className={`text-3xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              🐾 OpenClaw 本地版
            </h1>
            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              className={`p-2 rounded-lg transition-colors ${isDark ? 'bg-gray-800 hover:bg-gray-700' : 'bg-white hover:bg-gray-50'}`}
              title={isDark ? '切换到亮色模式' : '切换到深色模式'}
            >
              {isDark ? '☀️' : '🌙'}
            </button>
          </div>
          <p className={`${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            零 API 费用 · 完全本地化 · 隐私安全
          </p>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center justify-center mb-8">
          {['欢迎', '检测', '选择模型', '安装', '完成'].map((_, idx) => {
            const steps: InstallStep[] = ['welcome', 'detecting', 'select-model', 'installing', 'complete']
            const currentIdx = steps.indexOf(step)
            const isActive = idx === currentIdx
            const isComplete = idx < currentIdx
            
            return (
              <div key={idx} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  isComplete ? 'bg-green-500 text-white' :
                  isActive ? 'bg-blue-500 text-white' :
                  isDark ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-600'
                }`}>
                  {isComplete ? '✓' : idx + 1}
                </div>
                {idx < 4 && (
                  <div className={`w-12 h-1 transition-colors ${idx < currentIdx ? 'bg-green-500' : isDark ? 'bg-gray-700' : 'bg-gray-200'}`} />
                )}
              </div>
            )
          })}
        </div>

        {/* Content */}
        <div className={`rounded-2xl shadow-xl p-8 transition-colors ${isDark ? 'bg-gray-800' : 'bg-white'}`}>
          {step === 'welcome' && (
            <div className="text-center">
              <div className="text-6xl mb-6">🚀</div>
              <h2 className={`text-2xl font-bold mb-4 ${isDark ? 'text-white' : ''}`}>欢迎使用 OpenClaw 本地版</h2>
              <div className="text-left max-w-md mx-auto mb-8 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="text-green-500 text-xl">✓</span>
                  <div>
                    <div className={`font-medium ${isDark ? 'text-white' : ''}`}>无需 API Key</div>
                    <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>使用本地算力，零费用运行</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-green-500 text-xl">✓</span>
                  <div>
                    <div className={`font-medium ${isDark ? 'text-white' : ''}`}>自动硬件检测</div>
                    <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>智能推荐最适合的模型</div>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-green-500 text-xl">✓</span>
                  <div>
                    <div className={`font-medium ${isDark ? 'text-white' : ''}`}>一键安装</div>
                    <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>自动安装 Ollama、下载模型、配置 OpenClaw</div>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={startDetection}
                  className="px-8 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium text-lg transition-colors"
                >
                  开始安装
                </button>
                {installedModels.length > 0 && (
                  <button
                    onClick={() => setStep('model-management')}
                    className={`px-8 py-3 rounded-lg font-medium text-lg transition-colors ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
                  >
                    模型管理
                  </button>
                )}
              </div>
            </div>
          )}

          {step === 'detecting' && (
            <div className="text-center py-12">
              <div className="animate-spin text-6xl mb-4">⚙️</div>
              <p className={`text-lg ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>正在检测硬件配置...</p>
            </div>
          )}

          {step === 'select-model' && hardware && (
            <div>
              <h2 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : ''}`}>硬件检测完成</h2>
              
              {/* Hardware Info */}
              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className={`rounded-lg p-4 ${isDark ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <div className={`text-sm mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>CPU</div>
                  <div className={`font-medium ${isDark ? 'text-white' : ''}`}>{hardware.cpu_name}</div>
                  <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{hardware.cpu_cores} 核心</div>
                </div>
                <div className={`rounded-lg p-4 ${isDark ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <div className={`text-sm mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>内存</div>
                  <div className={`font-medium text-2xl ${isDark ? 'text-white' : ''}`}>{hardware.ram_gb.toFixed(1)} GB</div>
                </div>
                <div className={`rounded-lg p-4 ${isDark ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <div className={`text-sm mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>GPU 显存</div>
                  <div className={`font-medium text-2xl ${isDark ? 'text-white' : ''}`}>{hardware.total_vram_gb.toFixed(1)} GB</div>
                  {hardware.gpus.length > 0 && (
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-400'}`}>{hardware.gpus[0].name}</div>
                  )}
                </div>
              </div>

              {/* Model Selection */}
              <h3 className={`text-lg font-semibold mb-4 ${isDark ? 'text-white' : ''}`}>选择要安装的模型</h3>
              <div className="space-y-3 mb-6 max-h-64 overflow-y-auto">
                {models.map((model) => (
                  <label
                    key={model.name}
                    className={`block border-2 rounded-lg p-4 cursor-pointer transition-all ${
                      selectedModel === model.name
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : isDark ? 'border-gray-700 hover:border-gray-600' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="model"
                        value={model.name}
                        checked={selectedModel === model.name}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-medium ${isDark ? 'text-white' : ''}`}>{model.display_name}</span>
                          {model.recommended && (
                            <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                              推荐
                            </span>
                          )}
                          {model.tags.map((tag) => (
                            <span key={tag} className={`px-2 py-0.5 text-xs rounded-full ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                              {tag}
                            </span>
                          ))}
                        </div>
                        <div className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{model.description}</div>
                        <div className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                          大小: {model.size_gb} GB · 最低要求: {model.min_vram} GB VRAM / {model.min_ram} GB RAM
                        </div>
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Status */}
              <div className={`rounded-lg p-4 mb-6 ${isDark ? 'bg-gray-700' : 'bg-gray-50'}`}>
                <div className="flex items-center gap-4 text-sm">
                  <div className={ollamaInstalled ? 'text-green-600 dark:text-green-400' : 'text-orange-500'}>
                    {ollamaInstalled ? '✅' : '⚠️'} Ollama {ollamaInstalled ? '已安装' : '待安装'}
                  </div>
                  <div className={openclawInstalled ? 'text-green-600 dark:text-green-400' : 'text-orange-500'}>
                    {openclawInstalled ? '✅' : '⚠️'} OpenClaw {openclawInstalled ? '已安装' : '待安装'}
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('welcome')}
                  className={`px-6 py-3 rounded-lg font-medium transition-colors ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
                >
                  返回
                </button>
                <button
                  onClick={startInstall}
                  disabled={!selectedModel}
                  className="flex-1 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white rounded-lg font-medium text-lg transition-colors"
                >
                  开始安装
                </button>
              </div>
            </div>
          )}

          {step === 'installing' && (
            <div>
              <h2 className={`text-2xl font-bold mb-6 ${isDark ? 'text-white' : ''}`}>正在安装...</h2>
              
              {/* 下载进度条 */}
              {downloadStatus === 'downloading' && downloadProgress && (
                <div className={`rounded-lg p-4 mb-4 ${isDark ? 'bg-gray-700' : 'bg-blue-50'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`font-medium ${isDark ? 'text-white' : 'text-blue-900'}`}>
                      {downloadProgress.phase === 'downloading' ? '下载中' : downloadProgress.phase}
                    </span>
                    <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-blue-600'}`}>
                      {downloadProgress.percent}%
                    </span>
                  </div>
                  <div className={`w-full h-3 rounded-full overflow-hidden ${isDark ? 'bg-gray-600' : 'bg-blue-200'}`}>
                    <div
                      className="h-full bg-blue-500 transition-all duration-300 rounded-full"
                      style={{ width: `${downloadProgress.percent}%` }}
                    />
                  </div>
                  {downloadProgress.total > 0 && (
                    <div className={`text-xs mt-2 ${isDark ? 'text-gray-400' : 'text-blue-600'}`}>
                      {downloadProgress.current.toFixed(1)} MB / {downloadProgress.total.toFixed(1)} MB
                    </div>
                  )}
                </div>
              )}

              {/* 更新下载进度 */}
              {updateDownloadProgress > 0 && updateDownloadProgress < 100 && (
                <div className={`rounded-lg p-4 mb-4 ${isDark ? 'bg-gray-700' : 'bg-green-50'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`font-medium ${isDark ? 'text-white' : 'text-green-900'}`}>
                      下载更新中
                    </span>
                    <span className={`text-sm ${isDark ? 'text-gray-400' : 'text-green-600'}`}>
                      {updateDownloadProgress}%
                    </span>
                  </div>
                  <div className={`w-full h-3 rounded-full overflow-hidden ${isDark ? 'bg-gray-600' : 'bg-green-200'}`}>
                    <div
                      className="h-full bg-green-500 transition-all duration-300 rounded-full"
                      style={{ width: `${updateDownloadProgress}%` }}
                    />
                  </div>
                </div>
              )}
              
              <div className={`rounded-lg p-4 h-64 overflow-y-auto font-mono text-sm ${
                isDark ? 'bg-gray-900 text-green-400' : 'bg-gray-900 text-green-400'
              }`}>
                {installLog.map((log, idx) => (
                  <div key={idx} className="mb-1">{log}</div>
                ))}
              </div>
            </div>
          )}

          {step === 'complete' && (
            <div className="text-center">
              <div className="text-6xl mb-6">🎉</div>
              <h2 className={`text-2xl font-bold mb-4 ${isDark ? 'text-white' : ''}`}>安装完成!</h2>
              <div className="text-left max-w-md mx-auto mb-8 space-y-2">
                <div className={`p-3 rounded-lg ${isDark ? 'bg-green-900/30 text-green-400' : 'bg-green-50 text-green-700'}`}>
                  ✅ Ollama 已安装并配置
                </div>
                <div className={`p-3 rounded-lg ${isDark ? 'bg-green-900/30 text-green-400' : 'bg-green-50 text-green-700'}`}>
                  ✅ 模型已下载: {selectedModel}
                </div>
                <div className={`p-3 rounded-lg ${isDark ? 'bg-green-900/30 text-green-400' : 'bg-green-50 text-green-700'}`}>
                  ✅ OpenClaw 已配置为本地模式
                </div>
              </div>
              <div className={`rounded-lg p-4 mb-6 ${isDark ? 'bg-blue-900/30' : 'bg-blue-50'}`}>
                <p className={`text-sm ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
                  💡 现在你可以通过命令 <code className={`px-2 py-1 rounded ${isDark ? 'bg-blue-800' : 'bg-blue-100'}`}>openclaw</code> 启动 OpenClaw，
                  它将使用本地模型运行，无需任何 API Key！
                </p>
              </div>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setStep('model-management')}
                  className={`px-6 py-3 rounded-lg font-medium transition-colors ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
                >
                  模型管理
                </button>
                <button
                  onClick={() => window.close()}
                  className="px-8 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium text-lg transition-colors"
                >
                  完成
                </button>
              </div>
            </div>
          )}

          {/* 模型管理页面 */}
          {step === 'model-management' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className={`text-2xl font-bold ${isDark ? 'text-white' : ''}`}>模型管理</h2>
                <button
                  onClick={() => setStep('welcome')}
                  className={`px-4 py-2 rounded-lg transition-colors ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
                >
                  返回
                </button>
              </div>

              {/* 已安装模型列表 */}
              <div className="space-y-3">
                {installedModels.length === 0 ? (
                  <div className={`text-center py-12 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    暂无已安装的模型
                  </div>
                ) : (
                  installedModels.map((model) => (
                    <div
                      key={model.name}
                      className={`border-2 rounded-lg p-4 transition-all cursor-pointer ${
                        selectedInstalledModel === model.name
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                          : isDark ? 'border-gray-700 hover:border-gray-600' : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => handleModelSelect(model.name)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className={`font-medium ${isDark ? 'text-white' : ''}`}>{model.name}</div>
                          <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            大小: {model.size} · 修改时间: {model.modified_at}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteModel(model.name)
                          }}
                          className="px-3 py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* 模型详情 */}
              {selectedInstalledModel && modelDetails && (
                <div className={`mt-6 p-4 rounded-lg ${isDark ? 'bg-gray-700' : 'bg-gray-50'}`}>
                  <h3 className={`font-semibold mb-3 ${isDark ? 'text-white' : ''}`}>模型详情</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>格式:</span>
                      <span className={`ml-2 ${isDark ? 'text-white' : ''}`}>{modelDetails.format}</span>
                    </div>
                    <div>
                      <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>系列:</span>
                      <span className={`ml-2 ${isDark ? 'text-white' : ''}`}>{modelDetails.family}</span>
                    </div>
                    <div>
                      <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>参数量:</span>
                      <span className={`ml-2 ${isDark ? 'text-white' : ''}`}>{modelDetails.parameter_size}</span>
                    </div>
                    <div>
                      <span className={isDark ? 'text-gray-400' : 'text-gray-500'}>量化:</span>
                      <span className={`ml-2 ${isDark ? 'text-white' : ''}`}>{modelDetails.quantization_level}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* 安装新模型 */}
              <button
                onClick={() => setStep('select-model')}
                className="w-full mt-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
              >
                + 安装新模型
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`text-center mt-6 text-sm ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
          OpenClaw 本地版 · 
          <a href="https://docs.openclaw.ai" className="text-blue-500 hover:underline">文档</a> · 
          <a href="https://github.com/openclaw/openclaw" className="text-blue-500 hover:underline">GitHub</a>
        </div>
      </div>
    </div>
  )
}

export default App
