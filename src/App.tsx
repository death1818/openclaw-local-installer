import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-shell'
// 支付页面 URL
const PAYMENT_URL = 'https://www.ku1818.cn/buy'

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

// 技能相关接口
interface RemoteSkill {
  name: string
  slug: string
  description: string
  version: string
  author: string
  downloads: number
  category: string
  tags: string[]
  installed: boolean
  update_available: boolean
}

interface InstalledSkill {
  name: string
  slug: string
  version: string
  path: string
  installed_at: string
}

interface SkillInstallProgress {
  skill_name: string
  status: string
  progress: number
  message: string
}

type InstallStep = 'welcome' | 'license' | 'detecting' | 'select-model' | 'installing' | 'complete' | 'model-management' | 'skill-management'
type Theme = 'light' | 'dark'

// 授权码格式验证
function validateLicenseCode(code: string): boolean {
  // 授权码格式: OPENCLAW-XXXX-XXXX-XXXX
  const pattern = /^OPENCLAW-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
  return pattern.test(code)
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
  
  // 打开支付页面
  const openPaymentPage = async () => {
    try {
      await open(PAYMENT_URL)
    } catch (err) {
      // 如果 Tauri shell 失败，尝试使用浏览器
      window.open(PAYMENT_URL, '_blank')
    }
  }
  
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
  
  // 技能管理状态
  const [searchQuery, setSearchQuery] = useState('')
  const [remoteSkills, setRemoteSkills] = useState<RemoteSkill[]>([])
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([])
  const [skillUpdates, setSkillUpdates] = useState<RemoteSkill[]>([])
  const [skillSearchLoading, setSkillSearchLoading] = useState(false)
  const [installingSkill, setInstallingSkill] = useState<string | null>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem('theme', theme)
  }, [theme])

  useEffect(() => {
    const listeners = [
      // v0.6.0+ 使用 model-progress 事件
      listen<string>('model-progress', (event) => {
        setInstallLog(prev => [...prev, event.payload])
        // 检测下载状态
        if (event.payload.includes('✅') || event.payload.includes('下载完成')) {
          setDownloadStatus('completed')
        } else if (event.payload.includes('❌') || event.payload.includes('错误')) {
          setDownloadStatus('failed')
        } else if (event.payload.includes('下载') || event.payload.includes('pulling')) {
          setDownloadStatus('downloading')
        }
      }),
      // 兼容旧版事件
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
      // 技能相关事件
      listen<string>('skill-progress', (event) => {
        console.log('Skill progress:', event.payload)
      }),
      listen<SkillInstallProgress>('skill-install-progress', (event) => {
        if (event.payload.status === 'completed') {
          setInstallingSkill(null)
          loadInstalledSkills()
        } else if (event.payload.status === 'failed') {
          setInstallingSkill(null)
        }
      }),
    ]

    return () => {
      listeners.forEach(promise => {
        promise.then(unlisten => unlisten())
      })
    }
  }, [])

  // 授权码验证
  const handleLicenseSubmit = async () => {
    const code = licenseCode.toUpperCase()
    
    if (!validateLicenseCode(code)) {
      setLicenseError('授权码格式无效')
      return
    }
    
    try {
      // 调用线上API验证授权码
      const response = await fetch('https://www.ku1818.cn/api/license/validate-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      })
      
      const data = await response.json()
      
      if (data.valid) {
        setIsLicensed(true)
        localStorage.setItem('openclaw_licensed', 'true')
        localStorage.setItem('openclaw_license_code', code)
        setLicenseError('')
        setStep('detecting')
      } else {
        setLicenseError(data.message || '授权码无效或已被使用')
      }
    } catch (err) {
      // 离线验证（备用）
      if (validateLicenseCode(code)) {
        setIsLicensed(true)
        localStorage.setItem('openclaw_licensed', 'true')
        setLicenseError('')
        setStep('detecting')
      } else {
        setLicenseError('网络错误，无法验证授权码')
      }
    }
  }

  // 验证成功后自动开始硬件检测
  useEffect(() => {
    if (step === 'detecting') {
      detectHardware()
    }
  }, [step])

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
    setError(null)
    
    try {
      await invoke('pull_model', { modelName: selectedModel })
      await invoke('configure_openclaw', { modelName: selectedModel })
      setStep('complete')
    } catch (err) {
      const errorMsg = String(err)
      setError(errorMsg)
      setDownloadStatus('failed')
      setInstallLog(prev => [...prev, `❌ 错误: ${errorMsg}`])
    }
  }
  
  // 重新检测 Ollama
  const recheckOllama = async () => {
    setInstallLog(prev => [...prev, '正在重新检测 Ollama...'])
    try {
      const installed = await invoke<boolean>('check_ollama_installed')
      if (installed) {
        setInstallLog(prev => [...prev, '✅ Ollama 已安装，继续下载模型...'])
        setDownloadStatus('downloading')
        setError(null)
        await installModel()
      } else {
        setInstallLog(prev => [...prev, '❌ Ollama 未检测到，请先完成安装'])
      }
    } catch (err) {
      setInstallLog(prev => [...prev, `❌ 检测失败: ${err}`])
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
  
  // ============ 技能管理功能 ============
  
  // 搜索技能
  const searchSkills = async () => {
    if (!searchQuery.trim()) return
    setSkillSearchLoading(true)
    setRemoteSkills([]) // 清空之前的结果
    try {
      const skills = await invoke<RemoteSkill[]>('search_skills', { query: searchQuery })
      setRemoteSkills(skills)
      if (skills.length === 0) {
        setError('未找到匹配的技能，请尝试其他关键词')
      }
    } catch (err) {
      console.error('搜索失败:', err)
      setError(`搜索失败: ${err}`)
    } finally {
      setSkillSearchLoading(false)
    }
  }
  
  // 加载已安装技能
  const loadInstalledSkills = async () => {
    try {
      const skills = await invoke<InstalledSkill[]>('get_installed_skills')
      setInstalledSkills(skills)
    } catch (err) {
      console.error('加载技能列表失败:', err)
      // 不显示错误，静默失败
    }
  }
  
  // 检查技能更新
  const checkForUpdates = async () => {
    try {
      const updates = await invoke<RemoteSkill[]>('check_skill_updates')
      setSkillUpdates(updates)
    } catch (err) {
      console.error('检查更新失败:', err)
      // 静默失败
    }
  }
  
  // 安装技能
  const installSkill = async (slug: string) => {
    setInstallingSkill(slug)
    try {
      await invoke('install_skill', { slug })
      // 刷新列表
      await Promise.all([loadInstalledSkills()])
      setInstallingSkill(null)
    } catch (err) {
      setError(`安装失败: ${err}`)
      setInstallingSkill(null)
    }
  }
  
  // 更新技能
  const updateSkill = async (slug: string) => {
    setInstallingSkill(slug)
    try {
      await invoke('update_skill', { slug })
      await Promise.all([loadInstalledSkills(), checkForUpdates()])
      setInstallingSkill(null)
    } catch (err) {
      setError(`更新失败: ${err}`)
      setInstallingSkill(null)
    }
  }
  
  // 卸载技能
  const uninstallSkill = async (slug: string) => {
    try {
      await invoke('uninstall_skill', { slug })
      await loadInstalledSkills()
    } catch (err) {
      setError(`卸载失败: ${err}`)
    }
  }
  
  // 加载推荐技能
  const loadRecommendedSkills = async () => {
    setSkillSearchLoading(true)
    try {
      const skills = await invoke<RemoteSkill[]>('get_recommended_skills')
      setRemoteSkills(skills)
    } catch (err) {
      console.error('加载推荐技能失败:', err)
      // 显示友好的错误提示
      setError('加载推荐技能失败，请检查网络连接或稍后重试')
    } finally {
      setSkillSearchLoading(false)
    }
  }
  
  // 进入技能管理时自动加载
  useEffect(() => {
    if (step === 'skill-management') {
      loadInstalledSkills()
      loadRecommendedSkills()
      checkForUpdates()
    }
  }, [step])

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
            onClick={openPaymentPage}
            className="w-full px-6 py-3 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            微信支付（打开网页）
          </button>
          
          <p className="text-xs text-gray-500 dark:text-gray-400">
            点击按钮将在浏览器中打开支付页面
          </p>
          
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
          <div key={i} className="text-green-400 text-sm font-mono whitespace-pre-wrap">{log}</div>
        ))}
      </div>
      
      {downloadStatus === 'failed' && (
        <div className="mt-4 space-y-3">
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
          <div className="flex gap-3">
            <button
              onClick={recheckOllama}
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              重新检测 Ollama
            </button>
            <button
              onClick={() => open('https://ollama.com/download')}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              打开 Ollama 官网
            </button>
          </div>
          <button
            onClick={installModel}
            className="w-full px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
          >
            重试安装
          </button>
        </div>
      )}
    </div>
  )

  // 渲染完成界面
  const renderComplete = () => (
    <div>
      <div className="text-center mb-6">
        <div className="w-20 h-20 mx-auto mb-4 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
          <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold mb-2">安装完成！</h2>
        <p className="text-gray-600 dark:text-gray-400">OpenClaw 本地版已成功安装并配置</p>
      </div>
      
      {/* 快速入门指引 */}
      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mb-6">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          快速入门
        </h3>
        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">1</div>
            <div>
              <p className="font-medium">启动 OpenClaw</p>
              <p className="text-gray-500 dark:text-gray-400">在终端运行 <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">openclaw gateway start</code></p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">2</div>
            <div>
              <p className="font-medium">配置 Ollama 环境变量（已完成）</p>
              <p className="text-gray-500 dark:text-gray-400">上下文窗口已设置为 24K，重启 Ollama 生效</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">3</div>
            <div>
              <p className="font-medium">开始对话</p>
              <p className="text-gray-500 dark:text-gray-400">打开 <a href="http://localhost:3000" target="_blank" className="text-blue-500 hover:underline">http://localhost:3000</a> 即可使用</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* 启动按钮 */}
      <button
        onClick={async () => {
          try {
            const msg = await invoke<string>('start_openclaw')
            alert(msg)
          } catch (err) {
            alert(`启动失败: ${err}`)
          }
        }}
        className="w-full px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg font-medium hover:opacity-90 mb-3 flex items-center justify-center gap-2"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        立即启动 OpenClaw
      </button>
      
      {/* 创建桌面快捷方式 */}
      <button
        onClick={async () => {
          try {
            const msg = await invoke<string>('create_desktop_shortcut')
            alert(msg)
          } catch (err) {
            alert(`创建失败: ${err}`)
          }
        }}
        className="w-full px-6 py-2 bg-purple-500 text-white rounded-lg font-medium hover:bg-purple-600 mb-3 flex items-center justify-center gap-2"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        创建桌面快捷方式
      </button>
      
      <div className="grid grid-cols-2 gap-3 mb-3">
        <button
          onClick={async () => {
            await loadInstalledModels()
            setStep('model-management')
          }}
          className="px-4 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600"
        >
          模型管理
        </button>
        <button
          onClick={() => setStep('skill-management')}
          className="px-4 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg font-medium hover:opacity-90"
        >
          技能管理
        </button>
      </div>
      
      <button
        onClick={() => window.close()}
        className="w-full px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
      >
        关闭安装器
      </button>
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
      
      <div className="mt-6 flex gap-3">
        <button
          onClick={() => setStep('select-model')}
          className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          返回
        </button>
        <button
          onClick={() => setStep('skill-management')}
          className="px-6 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:opacity-90"
        >
          技能管理
        </button>
      </div>
    </div>
  )
  
  // 渲染技能管理界面
  const renderSkillManagement = () => (
    <div>
      <h2 className="text-xl font-semibold mb-4">技能管理</h2>
      
      {/* 更新提示 */}
      {skillUpdates.length > 0 && (
        <div className="mb-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="font-medium text-yellow-800 dark:text-yellow-200">
              有 {skillUpdates.length} 个技能可更新
            </span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {skillUpdates.slice(0, 3).map(skill => (
              <button
                key={skill.slug}
                onClick={() => updateSkill(skill.slug)}
                disabled={installingSkill === skill.slug}
                className="px-3 py-1 bg-yellow-500 text-white rounded text-sm hover:bg-yellow-600 disabled:opacity-50"
              >
                {installingSkill === skill.slug ? '更新中...' : `更新 ${skill.name}`}
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* 搜索框 */}
      <div className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="搜索技能..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && searchSkills()}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700"
          />
          <button
            onClick={searchSkills}
            disabled={skillSearchLoading}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            {skillSearchLoading ? '搜索中...' : '搜索'}
          </button>
        </div>
      </div>
      
      {/* 已安装技能 */}
      {installedSkills.length > 0 && (
        <div className="mb-6">
          <h3 className="font-medium mb-3">已安装技能</h3>
          <div className="space-y-2">
            {installedSkills.map(skill => (
              <div key={skill.slug} className="p-3 border border-gray-200 dark:border-gray-600 rounded-lg flex justify-between items-center">
                <div>
                  <div className="font-medium">{skill.name}</div>
                  <div className="text-sm text-gray-500">v{skill.version}</div>
                </div>
                <button
                  onClick={() => uninstallSkill(skill.slug)}
                  className="px-3 py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                >
                  卸载
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* 技能列表 */}
      <div>
        <h3 className="font-medium mb-3">
          {searchQuery ? '搜索结果' : '推荐技能'}
        </h3>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {remoteSkills.map(skill => (
            <div key={skill.slug} className="p-3 border border-gray-200 dark:border-gray-600 rounded-lg">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-medium">{skill.name}</div>
                  <div className="text-sm text-gray-500">{skill.author} · v{skill.version}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-400">{skill.downloads.toLocaleString()} 次下载</div>
                  {skill.tags.length > 0 && (
                    <div className="flex gap-1 mt-1 justify-end">
                      {skill.tags.slice(0, 2).map(tag => (
                        <span key={tag} className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{skill.description}</p>
              <div className="flex gap-2">
                {skill.installed ? (
                  skill.update_available ? (
                    <button
                      onClick={() => updateSkill(skill.slug)}
                      disabled={installingSkill === skill.slug}
                      className="px-3 py-1 bg-yellow-500 text-white rounded text-sm hover:bg-yellow-600 disabled:opacity-50"
                    >
                      {installingSkill === skill.slug ? '更新中...' : '更新'}
                    </button>
                  ) : (
                    <span className="px-3 py-1 bg-green-100 text-green-700 rounded text-sm">已安装</span>
                  )
                ) : (
                  <button
                    onClick={() => installSkill(skill.slug)}
                    disabled={installingSkill === skill.slug}
                    className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50"
                  >
                    {installingSkill === skill.slug ? '安装中...' : '安装'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="mt-6 flex gap-3">
        <button
          onClick={() => setStep('model-management')}
          className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          返回
        </button>
        <button
          onClick={() => {
            setRemoteSkills([])
            setSearchQuery('')
            loadRecommendedSkills()
          }}
          className="px-6 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          刷新推荐
        </button>
      </div>
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
          {step === 'detecting' && renderDetecting()}
          {step === 'select-model' && renderSelectModel()}
          {step === 'installing' && renderInstalling()}
          {step === 'complete' && renderComplete()}
          {step === 'model-management' && renderModelManagement()}
          {step === 'skill-management' && renderSkillManagement()}
        </div>
      </div>
    </div>
  )
}

export default App
