import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import qrCodeImage from './assets/payment-qr.png'
// 提示：请将真实的微信收款码图片替换 src/assets/payment-qr.png

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

interface DownloadProgress {
  phase: string
  current: number
  total: number
  percent: number
}

type InstallStep = 'welcome' | 'license' | 'detecting' | 'select-model' | 'installing' | 'complete' | 'model-management'
type Theme = 'light' | 'dark'

// 授权码验证（简单的哈希校验）
function validateLicenseCode(code: string): boolean {
  // 授权码格式: OPENCLAW-XXXX-XXXX-XXXX
  const pattern = /^OPENCLAW-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
  if (!pattern.test(code)) return false
  
  // 简单校验和验证
  const parts = code.replace('OPENCLAW-', '').split('-')
  const checksum = parts.join('')
  let sum = 0
  for (let i = 0; i < checksum.length; i++) {
    sum += checksum.charCodeAt(i)
  }
  return sum % 97 === 0 || sum % 89 === 0 || sum % 73 === 0
}

function App() {
  const [step, setStep] = useState<InstallStep>('welcome')
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme')
    return (saved as Theme) || 'light'
  })
  
  // 授权相关状态
  const [isLicensed, setIsLicensed] = useState<boolean>(() => {
    return localStorage.getItem('openclaw_licensed') === 'true'
  })
  const [licenseCode, setLicenseCode] = useState('')
  const [licenseError, setLicenseError] = useState('')
  const [showPayment, setShowPayment] = useState(false)
  
  // 如果已授权，自动跳转到检测
  useEffect(() => {
    if (isLicensed && step === 'welcome') {
      // 可选：自动跳过授权步骤
    }
  }, [isLicensed, step])
  
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [models, setModels] = useState<ModelRecommendation[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [installLog, setInstallLog] = useState<string[]>([])
  const [_ollamaInstalled, setOllamaInstalled] = useState(false)
  const [_openclawInstalled, setOpenclawInstalled] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'completed' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([])
  const [selectedInstalledModel, setSelectedInstalledModel] = useState<string | null>(null)
  const [modelDetails, setModelDetails] = useState<ModelDetails | null>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    const listeners = [
      listen<string>('install-progress', (event) => {
        setInstallLog(prev => [...prev, event.payload])
      }),
      listen<string>('model-download-log', (event) => {
        setInstallLog(prev => [...prev, event.payload])
      }),
      listen<string>('model-download-status', (event) => {
        setDownloadStatus(event.payload as 'idle' | 'downloading' | 'completed' | 'failed')
      }),
      listen<DownloadProgress>('model-download-progress', (event) => {
        setDownloadProgress(event.payload)
      }),
    ]

    return () => {
      listeners.forEach(promise => {
        promise.then(unlisten => unlisten())
      })
    }
  }, [])

  // 授权码验证
  const handleLicenseSubmit = () => {
    if (validateLicenseCode(licenseCode.toUpperCase())) {
      setIsLicensed(true)
      localStorage.setItem('openclaw_licensed', 'true')
      setLicenseError('')
      setStep('detecting')
    } else {
      setLicenseError('授权码无效，请检查后重试')
    }
  }

  // 硬件检测
  const detectHardware = async () => {
    setStep('detecting')
    try {
      const info = await invoke<HardwareInfo>('detect_hardware')
      setHardware(info)
      const recommendations = await invoke<ModelRecommendation[]>('get_recommended_models', {
        vramGb: info.total_vram_gb,
        ramGb: info.ram_gb
      })
      setModels(recommendations)
      
      const ollama = await invoke<boolean>('check_ollama_installed')
      setOllamaInstalled(ollama)
      
      const openclaw = await invoke<boolean>('check_openclaw_installed')
      setOpenclawInstalled(openclaw)
      
      setTimeout(() => setStep('select-model'), 1000)
    } catch (err) {
      setError(`硬件检测失败: ${err}`)
    }
  }

  // 安装模型
  const installModel = async () => {
    if (!selectedModel) return
    setStep('installing')
    setInstallLog([])
    setDownloadStatus('downloading')
    
    try {
      await invoke('pull_model', { modelName: selectedModel })
      await invoke('configure_openclaw', { modelName: selectedModel })
      setStep('complete')
    } catch (err) {
      setError(`安装失败: ${err}`)
      setDownloadStatus('failed')
    }
  }

  // 加载已安装模型
  const loadInstalledModels = async () => {
    try {
      const models = await invoke<InstalledModel[]>('list_models')
      setInstalledModels(models)
    } catch (err) {
      console.error('加载模型列表失败:', err)
    }
  }

  // 获取模型详情
  const getModelDetails = async (name: string) => {
    try {
      const details = await invoke<ModelDetails>('get_model_info', { modelName: name })
      setModelDetails(details)
      setSelectedInstalledModel(name)
    } catch (err) {
      console.error('获取模型详情失败:', err)
    }
  }

  // 删除模型
  const deleteModel = async (name: string) => {
    try {
      await invoke('delete_model', { modelName: name })
      await loadInstalledModels()
      setSelectedInstalledModel(null)
    } catch (err) {
      setError(`删除失败: ${err}`)
    }
  }

  // 渲染欢迎界面
  const renderWelcome = () => (
    <div className="text-center">
      <div className="mb-8">
        <div className="w-24 h-24 mx-auto mb-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
          <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
          OpenClaw 本地版安装器
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          零 API 费用 · 完全本地化 · 隐私安全
        </p>
      </div>

      <div className="space-y-4 mb-8">
        <div className="flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          自动检测硬件配置
        </div>
        <div className="flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          智能推荐最佳模型
        </div>
        <div className="flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          一键安装配置
        </div>
      </div>

      <button
        onClick={() => setStep('license')}
        className="px-8 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg font-medium hover:opacity-90 transition-opacity shadow-lg"
      >
        开始安装
      </button>

      {/* 公司署名 */}
      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          © 2026 北京缘辉旺网络科技有限公司
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          Beijing Yuanhuiwang Network Technology Co., Ltd.
        </p>
      </div>
    </div>
  )

  // 渲染授权界面
  const renderLicense = () => (
    <div className="max-w-md mx-auto">
      <h2 className="text-2xl font-bold text-center mb-6">软件授权</h2>
      
      {!showPayment ? (
        <div className="text-center">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6 mb-6">
            <p className="text-gray-700 dark:text-gray-300 mb-4">
              本软件需要授权才能使用
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              安装服务费：<span className="text-2xl font-bold text-blue-600">¥66.66</span>
            </p>
          </div>
          
          <div className="space-y-3">
            <button
              onClick={() => setShowPayment(true)}
              className="w-full px-6 py-3 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 transition-colors"
            >
              微信扫码支付
            </button>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white dark:bg-gray-800 text-gray-500">或者</span>
              </div>
            </div>
            
            <div className="space-y-3">
              <input
                type="text"
                placeholder="输入授权码: OPENCLAW-XXXX-XXXX-XXXX"
                value={licenseCode}
                onChange={(e) => setLicenseCode(e.target.value.toUpperCase())}
                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
              
              {licenseError && (
                <p className="text-red-500 text-sm">{licenseError}</p>
              )}
              
              <button
                onClick={handleLicenseSubmit}
                className="w-full px-6 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
              >
                验证授权码
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center">
          <div className="bg-white dark:bg-gray-700 rounded-lg p-6 mb-6 shadow-lg">
            <h3 className="text-lg font-bold mb-4">微信扫码支付</h3>
            <div className="w-48 h-48 mx-auto bg-white rounded-lg flex items-center justify-center mb-4 border-2 border-gray-200 overflow-hidden">
              {/* 微信收款码 */}
              <img 
                src={qrCodeImage} 
                alt="微信支付二维码" 
                className="w-full h-full object-cover"
              />
            </div>
            <p className="text-lg font-bold text-blue-600 mb-2">¥66.66</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              支付完成后，输入授权码继续
            </p>
          </div>
          
          <div className="space-y-3">
            <input
              type="text"
              placeholder="输入授权码"
              value={licenseCode}
              onChange={(e) => setLicenseCode(e.target.value.toUpperCase())}
              className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
            
            {licenseError && (
              <p className="text-red-500 text-sm">{licenseError}</p>
            )}
            
            <button
              onClick={handleLicenseSubmit}
              className="w-full px-6 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
            >
              验证授权码并继续
            </button>
            
            <button
              onClick={() => setShowPayment(false)}
              className="w-full px-6 py-3 text-gray-600 dark:text-gray-400 hover:text-gray-800"
            >
              返回
            </button>
          </div>
        </div>
      )}
      
      {/* 公司署名 */}
      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          © 2026 北京缘辉旺网络科技有限公司
        </p>
      </div>
    </div>
  )

  // 渲染硬件检测界面
  const renderDetecting = () => (
    <div className="text-center">
      <div className="w-20 h-20 mx-auto mb-6 relative">
        <div className="absolute inset-0 border-4 border-blue-200 dark:border-blue-800 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-blue-500 rounded-full animate-spin border-t-transparent"></div>
      </div>
      <h2 className="text-xl font-semibold mb-2">正在检测硬件配置...</h2>
      <p className="text-gray-600 dark:text-gray-400">请稍候</p>
    </div>
  )

  // 渲染模型选择界面
  const renderSelectModel = () => (
    <div>
      <h2 className="text-xl font-semibold mb-4">硬件检测结果</h2>
      
      {hardware && (
        <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-600 dark:text-gray-400">CPU:</span>
              <span className="ml-2 font-medium">{hardware.cpu_name}</span>
            </div>
            <div>
              <span className="text-gray-600 dark:text-gray-400">核心数:</span>
              <span className="ml-2 font-medium">{hardware.cpu_cores}</span>
            </div>
            <div>
              <span className="text-gray-600 dark:text-gray-400">内存:</span>
              <span className="ml-2 font-medium">{hardware.ram_gb.toFixed(1)} GB</span>
            </div>
            <div>
              <span className="text-gray-600 dark:text-gray-400">显存:</span>
              <span className="ml-2 font-medium">{hardware.total_vram_gb.toFixed(1)} GB</span>
            </div>
          </div>
          {hardware.gpus.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
              <span className="text-gray-600 dark:text-gray-400 text-sm">显卡:</span>
              {hardware.gpus.map((gpu, i) => (
                <div key={i} className="ml-2 text-sm">{gpu.name} ({gpu.vram_gb.toFixed(1)}GB)</div>
              ))}
            </div>
          )}
        </div>
      )}

      <h3 className="font-medium mb-3">推荐模型</h3>
      <div className="space-y-3 mb-6 max-h-60 overflow-y-auto">
        {models.map((model) => (
          <div
            key={model.name}
            onClick={() => setSelectedModel(model.name)}
            className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
              selectedModel === model.name
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-gray-600 hover:border-blue-300'
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <div className="font-medium">{model.display_name}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">{model.description}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium">{model.size_gb} GB</div>
                {model.recommended && (
                  <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">推荐</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={installModel}
        disabled={!selectedModel}
        className={`w-full py-3 rounded-lg font-medium transition-colors ${
          selectedModel
            ? 'bg-blue-500 text-white hover:bg-blue-600'
            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
        }`}
      >
        开始安装
      </button>
    </div>
  )

  // 渲染安装进度界面
  const renderInstalling = () => (
    <div>
      <h2 className="text-xl font-semibold mb-4">正在安装...</h2>
      
      {downloadStatus === 'downloading' && downloadProgress && (
        <div className="mb-6">
          <div className="flex justify-between text-sm mb-2">
            <span>{downloadProgress.phase}</span>
            <span>{downloadProgress.percent}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
            <div
              className="bg-blue-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${downloadProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      <div className="bg-gray-900 rounded-lg p-4 h-48 overflow-y-auto">
        {installLog.map((log, i) => (
          <div key={i} className="text-green-400 text-sm font-mono">{log}</div>
        ))}
      </div>
    </div>
  )

  // 渲染完成界面
  const renderComplete = () => (
    <div className="text-center">
      <div className="w-20 h-20 mx-auto mb-6 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
        <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="text-2xl font-bold mb-2">安装完成！</h2>
      <p className="text-gray-600 dark:text-gray-400 mb-6">OpenClaw 本地版已成功安装</p>
      
      <div className="space-y-3">
        <button
          onClick={async () => {
            await loadInstalledModels()
            setStep('model-management')
          }}
          className="w-full px-6 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600"
        >
          模型管理
        </button>
        <button
          onClick={() => window.close()}
          className="w-full px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          关闭
        </button>
      </div>
    </div>
  )

  // 渲染模型管理界面
  const renderModelManagement = () => (
    <div>
      <h2 className="text-xl font-semibold mb-4">模型管理</h2>
      
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <h3 className="font-medium mb-3">已安装模型</h3>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {installedModels.map((model) => (
              <div
                key={model.name}
                onClick={() => getModelDetails(model.name)}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedInstalledModel === model.name
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-600 hover:border-blue-300'
                }`}
              >
                <div className="font-medium">{model.name}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {model.size} · {model.modified_at}
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div>
          {modelDetails && selectedInstalledModel && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
              <h3 className="font-medium mb-3">模型详情</h3>
              <div className="space-y-2 text-sm">
                <div><span className="text-gray-600 dark:text-gray-400">格式:</span> {modelDetails.format}</div>
                <div><span className="text-gray-600 dark:text-gray-400">系列:</span> {modelDetails.family}</div>
                <div><span className="text-gray-600 dark:text-gray-400">参数:</span> {modelDetails.parameter_size}</div>
                <div><span className="text-gray-600 dark:text-gray-400">量化:</span> {modelDetails.quantization_level}</div>
              </div>
              <button
                onClick={() => deleteModel(selectedInstalledModel)}
                className="w-full mt-4 px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600"
              >
                删除模型
              </button>
            </div>
          )}
        </div>
      </div>
      
      <button
        onClick={() => setStep('select-model')}
        className="mt-6 px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        返回
      </button>
    </div>
  )

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'dark' : ''}`}>
      <div className="min-h-screen bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
        {/* 顶部栏 */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="font-semibold">OpenClaw 本地版</span>
          </div>
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>

        {/* 主内容 */}
        <div className="max-w-2xl mx-auto px-6 py-12">
          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">
              {error}
              <button onClick={() => setError(null)} className="ml-4 text-sm underline">关闭</button>
            </div>
          )}

          {step === 'welcome' && renderWelcome()}
          {step === 'license' && renderLicense()}
          {step === 'detecting' && (detectHardware(), renderDetecting())}
          {step === 'select-model' && renderSelectModel()}
          {step === 'installing' && renderInstalling()}
          {step === 'complete' && renderComplete()}
          {step === 'model-management' && renderModelManagement()}
        </div>
      </div>
    </div>
  )
}

export default App
