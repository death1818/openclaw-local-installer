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

// Ollama 综合状态
interface OllamaStatus {
  api_running: boolean
  installed: boolean
  models: InstalledModel[]
  error: string | null
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

type InstallStep = 'welcome' | 'license' | 'preparing' | 'detecting' | 'select-model' | 'installing' | 'complete' | 'model-management' | 'skill-management' | 'launcher' | 'ollama-setup' | 'chat'
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
  const [progressMessage, setProgressMessage] = useState('')
  
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
  const [installedModelList, setInstalledModelList] = useState<InstalledModel[]>([])
  const [ollamaInstalled, setOllamaInstalled] = useState<boolean>(false)
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [installLog, setInstallLog] = useState<string[]>([])
    const [_openclawInstalled, setOpenclawInstalled] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null)
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'completed' | 'failed'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([])
  const [selectedInstalledModel, setSelectedInstalledModel] = useState<string | null>(null)
  const [modelDetails, setModelDetails] = useState<ModelDetails | null>(null)
  const [dockerTokenUrl, setDockerTokenUrl] = useState<string>('')
  
  // 技能管理状态
  const [searchQuery, setSearchQuery] = useState('')
  const [remoteSkills, setRemoteSkills] = useState<RemoteSkill[]>([])
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([])
  const [skillUpdates, setSkillUpdates] = useState<RemoteSkill[]>([])
  const [skillSearchLoading, setSkillSearchLoading] = useState(false)
  const [installingSkill, setInstallingSkill] = useState<string | null>(null)
  
  // 启动器状态
  const [gatewayStatus, setGatewayStatus] = useState<'stopped' | 'starting' | 'running' | 'error'>('stopped')
  const [startupProgress, setStartupProgress] = useState(0) // 0-100
  const [dockerMode, setDockerMode] = useState(false) // Docker 部署模式
  
  // 聊天界面状态
  const [chatMessages, setChatMessages] = useState<Array<{id: string, role: 'user' | 'assistant', content: string, timestamp: Date}>>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatModels, setChatModels] = useState<Array<{name: string, size?: number}>>([])
  const [chatSelectedModel, setChatSelectedModel] = useState('')
  const [chatConnected, setChatConnected] = useState(false)

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
      // Docker Token URL 事件
      listen<string>('docker-token-url', (event) => {
        setDockerTokenUrl(event.payload)
        console.log('Docker token URL:', event.payload)
      }),
    ]

    return () => {
      listeners.forEach(promise => {
        promise.then(unlisten => unlisten())
      })
    }
  }, [])

  // 启动时检测是否已安装
  useEffect(() => {
    const checkInstalled = async () => {
      try {
        // 先清除旧的部署标记（如果容器没运行）
        const dockerDeployed = localStorage.getItem('openclaw_docker_deployed') === 'true'
        if (dockerDeployed) {
          // 检测容器是否真的在运行
          try {
            interface DockerStatus {
              container_running: boolean
              gateway_ready: boolean
              ollama_connected: boolean
              logs: string | null
              error: string | null
            }
            const status = await invoke<DockerStatus>('check_docker_container_status')
            if (!status.container_running) {
              console.log('容器未运行，清除旧的部署标记')
              localStorage.removeItem('openclaw_docker_deployed')
            } else {
              console.log('检测到 Docker 容器正在运行')
              setDockerMode(true)
            }
          } catch (e) {
            console.log('检测容器状态失败，清除部署标记:', e)
            localStorage.removeItem('openclaw_docker_deployed')
          }
        }
        
        const openclawInstalled = await invoke<boolean>('check_openclaw_installed')
        const licensed = localStorage.getItem('openclaw_licensed') === 'true'
        const installCompleted = localStorage.getItem('openclaw_install_completed') === 'true'
        
        // 检查配置文件是否存在
        let configExists = false
        try {
          configExists = await invoke<boolean>('check_openclaw_config_exists')
        } catch {
          configExists = false
        }
        
        // 重新获取 Docker 部署状态（可能已被清除）
        const dockerDeployedNow = localStorage.getItem('openclaw_docker_deployed') === 'true'
        
        console.log('检测状态:', { openclawInstalled, licensed, installCompleted, configExists, dockerDeployedNow })
        
        // Docker 部署模式直接进入启动器
        if (dockerDeployedNow) {
          console.log('Docker 部署模式，进入启动器')
          setStep('launcher')
          return
        }
        
        // 关键修复：如果 OpenClaw 已安装但配置不存在，必须清理
        if (openclawInstalled && !configExists) {
          console.log('检测到旧版本（缺少配置），清理中...')
          // 清理旧版本
          try {
            await invoke('clean_old_version')
          } catch (err) {
            console.error('清理旧版本失败:', err)
          }
          // 清理 localStorage
          localStorage.removeItem('openclaw_install_completed')
          localStorage.removeItem('openclaw_licensed')
          localStorage.removeItem('openclaw_license_code')
          setStep('welcome')
          return
        }
        
        // 正常检测：已安装且已授权且配置存在
        if (openclawInstalled && licensed && installCompleted && configExists) {
          console.log('已安装完成，进入启动器')
          setStep('launcher')
        } else {
          // 未安装或未授权
          console.log('未完成安装，显示欢迎页')
          setStep('welcome')
        }
      } catch (err) {
        console.error('检测安装状态失败:', err)
        // 检测失败，显示欢迎页
        setStep('welcome')
      }
    }
    
    checkInstalled()
  }, [])

  // 如果已安装完成，自动启动 Gateway
  useEffect(() => {
    // 只在进入启动器时才处理
    if (step !== 'launcher') return
    
    // 默认显示已停止状态
    setGatewayStatus('stopped')
    setStartupProgress(0)
    
    // 检查是否有 Docker 部署标记
    const dockerDeployed = localStorage.getItem('openclaw_docker_deployed') === 'true'
    
    if (dockerDeployed) {
      // Docker 模式：检测容器状态
      console.log('Docker 模式，检测容器状态...')
      setDockerMode(true)
      
      const checkStatus = async () => {
        try {
          interface DockerStatus {
            container_running: boolean
            gateway_ready: boolean
            ollama_connected: boolean
            logs: string | null
            error: string | null
          }
          
          const status = await invoke<DockerStatus>('check_docker_container_status')
          console.log('Docker 容器状态:', status)
          
          if (status.gateway_ready) {
            setGatewayStatus('running')
            setStartupProgress(100)
            return 'ready'
          } else if (!status.container_running) {
            // 容器未运行，清除部署标记
            console.log('容器未运行，清除部署标记')
            localStorage.removeItem('openclaw_docker_deployed')
            setDockerMode(false)
            return 'stopped'
          } else {
            // 容器运行但 Gateway 未就绪，显示启动中
            console.log('容器运行但 Gateway 未就绪')
            setGatewayStatus('starting')
            setStartupProgress(5)
            return 'starting'
          }
        } catch (e) {
          console.error('检测 Docker 容器状态失败:', e)
          // 检测失败，清除部署标记
          localStorage.removeItem('openclaw_docker_deployed')
          setDockerMode(false)
          return 'error'
        }
      }
      
      // 检测一次
      checkStatus()
    } else {
      // 非 Docker 模式，默认显示已停止
      console.log('非 Docker 模式，等待用户操作')
    }
  }, [step])

  // 监听 launch-mode 事件（从命令行参数 --launch 触发）
  useEffect(() => {
    const unlisten = listen<boolean>('launch-mode', (event) => {
      if (event.payload) {
        console.log('启动器模式激活')
        setStep('launcher')
        setGatewayStatus('starting')
        // 自动启动 Gateway
        invoke('start_openclaw').catch(err => {
          console.error('自动启动 Gateway 失败:', err)
          setGatewayStatus('error')
          setError(String(err))
        })
      }
    })
    
    return () => {
      unlisten.then(fn => fn())
    }
  }, [])

  // 监听 gateway-started 事件（后端通知 Gateway 已启动）
  useEffect(() => {
    const unlisten = listen<boolean>('gateway-started', (event) => {
      if (event.payload) {
        console.log('Gateway 已启动')
        setGatewayStatus('running')
        setStartupProgress(100)
        // Docker 模式自动进入聊天界面
        if (dockerMode) {
          setStep('chat')
        }
      }
    })
    
    return () => {
      unlisten.then(fn => fn())
    }
  }, [])

  // 监听启动进度事件
  useEffect(() => {
    const unlisten = listen<number>('startup-progress', (event) => {
      setStartupProgress(event.payload)
    })
    
    return () => {
      unlisten.then(fn => fn())
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
        // 授权成功后先准备 Ollama 环境
        setStep('preparing')
        localStorage.setItem('openclaw_docker_deployed', 'true')
      } else {
        setLicenseError(data.message || '授权码无效或已被使用')
      }
    } catch (err) {
      // 离线验证（备用）
      if (validateLicenseCode(code)) {
        setIsLicensed(true)
        localStorage.setItem('openclaw_licensed', 'true')
        setLicenseError('')
        // 授权成功后先进入 Ollama 设置界面
        setStep('preparing')
        localStorage.setItem('openclaw_docker_deployed', 'true')
      } else {
        setLicenseError('网络错误，无法验证授权码')
      }
    }
  }

  // 验证成功后先准备 Ollama 环境
  useEffect(() => {
    if (step === 'preparing') {
      prepareOllamaEnvironment()
    }
  }, [step])

  // 准备 Ollama 环境（检测/安装/下载模型）
  const prepareOllamaEnvironment = async () => {
    setProgressMessage('🚀 开始准备本地AI环境...')
    
    try {
      // 调用后端命令准备 Ollama
      // 注意：不再自动跳转，由用户手动点击检测按钮
      setProgressMessage('✅ 请点击下方检测按钮验证 Ollama 和模型')
    } catch (err) {
      // 如果失败，停留在界面让用户手动处理
      setProgressMessage(`⚠️ ${err}，请手动完成 Ollama 安装后点击检测`)
    }
  }

  // 监听 Ollama 准备进度
  useEffect(() => {
    let unlisten: (() => void) | undefined
    
    const setupListener = async () => {
      unlisten = await listen<string>('model-progress', (event) => {
        setProgressMessage(event.payload)
      })
    }
    
    setupListener()
    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  // 进入聊天界面时检查连接
  useEffect(() => {
    if (step === 'chat') {
      checkChatConnection()
    }
  }, [step])

  // 验证成功后自动开始硬件检测
  useEffect(() => {
    if (step === 'detecting') {
      detectHardware()
    }
  }, [step])

  // 硬件检测
  const detectHardware = async () => {
    setDockerMode(true); localStorage.setItem('openclaw_docker_deployed', 'true'); setStep('launcher')
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
      // 步骤0: 清理旧版本（如果存在）
      setInstallLog(prev => [...prev, '检查旧版本...'])
      
      // 检查是否需要清理
      const needClean = localStorage.getItem('openclaw_install_completed') === 'true'
      if (needClean) {
        setInstallLog(prev => [...prev, '检测到旧版本，正在清理...'])
        localStorage.removeItem('openclaw_install_completed')
        localStorage.removeItem('openclaw_licensed')
        setInstallLog(prev => [...prev, '✅ 已清理旧版本数据'])
      }
      
      // 步骤1: 检查并安装 OpenClaw
      setInstallLog(prev => [...prev, '检查 OpenClaw...'])
      const openclawInstalled = await invoke<boolean>('check_openclaw_installed')
      
      if (!openclawInstalled) {
        setInstallLog(prev => [...prev, '正在安装 OpenClaw...'])
        await invoke('install_openclaw')
        // 重新验证安装是否成功
        const installedAfter = await invoke<boolean>('check_openclaw_installed')
        if (!installedAfter) {
          throw new Error('OpenClaw 安装失败，请查看日志或手动安装')
        }
        setInstallLog(prev => [...prev, '✅ OpenClaw 安装完成'])
      } else {
        setInstallLog(prev => [...prev, '✅ OpenClaw 已安装'])
      }
      
      // 步骤2: 下载模型
      setInstallLog(prev => [...prev, '正在下载模型...'])
      await invoke('pull_model', { modelName: selectedModel })
      setInstallLog(prev => [...prev, '✅ 模型下载完成'])
      
      // 步骤3: 配置 OpenClaw（根据模式选择 Ollama URL）
      setInstallLog(prev => [...prev, '正在配置 OpenClaw...'])
      await invoke('configure_openclaw', { modelName: selectedModel, isDocker: dockerMode })
      setInstallLog(prev => [...prev, '✅ OpenClaw 配置完成'])
      
      // 保存安装完成状态
      localStorage.setItem('openclaw_install_completed', 'true')
      
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

  // 渲染环境准备界面（Ollama设置教程）
  const renderPreparing = () => (
    <div className="max-w-lg mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">🛠️ 本地AI环境设置</h2>
        <p className="text-gray-600 dark:text-gray-400">
          使用本地模型需要先安装 Ollama 和下载模型
        </p>
      </div>
      
      {/* 步骤1: 安装Ollama */}
      <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4 mb-4">
        <h3 className="font-semibold mb-2">📦 步骤1: 安装 Ollama</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          下载并安装 Ollama（Windows 安装包约 200MB）
        </p>
        <a
          href="https://ollama.com/download"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm"
        >
          🔗 下载 Ollama
        </a>
      </div>
      
      {/* 步骤2: 下载模型 */}
      <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-4 mb-4">
        <h3 className="font-semibold mb-2">📥 步骤2: 下载 phi3.5 模型</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          安装 Ollama 后，在 PowerShell 中运行以下命令下载模型（约2GB）：
        </p>
        <div className="bg-gray-800 text-green-400 rounded p-3 text-sm font-mono mb-3">
          ollama pull phi3.5
        </div>
        <p className="text-xs text-gray-500">
          💡 此过程可能需要几分钟，请耐心等待下载完成
        </p>
      </div>
      
      {/* 状态检测 */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-6">
        <h3 className="font-semibold mb-3">🔍 检测状态</h3>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm">Ollama 已安装:</span>
          <span className={ollamaInstalled ? "text-green-600 font-medium" : "text-red-500"}>
            {ollamaInstalled ? '✅ 已安装' : '❌ 未安装'}
          </span>
        </div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm">模型状态:</span>
          <span className={installedModelList && installedModelList.length > 0 ? 'text-green-600 font-medium' : 'text-red-500'}>
            {installedModelList && installedModelList.length > 0 ? `✅ 已下载 (${installedModelList.length}个)` : '❌ 未检测到模型'}
          </span>
        </div>
        <button
          onClick={async () => {
            setProgressMessage('🔍 检测中...')
            try {
              // 使用新的综合检测命令
              const status = await invoke<OllamaStatus>('check_ollama_status')
              
              setOllamaInstalled(status.installed)
              setInstalledModelList(status.models || [])
              
              if (status.error) {
                setProgressMessage('⚠️ ' + status.error)
                return
              }
              
              if (status.installed && status.models && status.models.length > 0) {
                setProgressMessage('✅ 检测通过！即将进入启动器...')
                setTimeout(() => {
                  setDockerMode(true)
                  setStep('launcher')
                }, 1500)
              } else if (status.installed && (!status.models || status.models.length === 0)) {
                setProgressMessage('⚠️ Ollama 已安装但未下载模型，请先运行: ollama pull phi3.5')
              } else if (!status.api_running) {
                setProgressMessage('⚠️ Ollama 服务未启动，请运行: ollama serve')
              } else {
                setProgressMessage('⚠️ 请先安装 Ollama')
              }
            } catch (e) {
              setProgressMessage('❌ 检测失败: ' + e)
            }
          }}
          className="w-full px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
        >
          🔄 检测
        </button>
        {progressMessage && (
          <p className="mt-3 text-sm text-center text-blue-600 dark:text-blue-400">
            {progressMessage}
          </p>
        )}
      </div>
      
      {/* 跳过按钮 */}
      <button
        onClick={() => {
          setDockerMode(true)
          setStep('launcher')
        }}
        className="w-full text-gray-500 hover:text-gray-700 text-sm"
      >
        跳过，直接进入启动器 →
      </button>
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
              <p className="text-gray-500 dark:text-gray-400">打开 <a href="http://localhost:18789" target="_blank" className="text-blue-500 hover:underline">http://localhost:18789</a> 即可使用</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* 启动按钮 */}
      {/* 错误提示 */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm whitespace-pre-wrap">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-red-800 dark:text-red-200">{error}</div>
          </div>
        </div>
      )}
      
      <button
        onClick={async () => {
          try {
            setError('')
            // 保存安装完成状态
            localStorage.setItem('openclaw_install_completed', 'true')
            // 直接进入启动器界面
            setStep('launcher')
            setGatewayStatus('starting')
            setStartupProgress(5)
            // 启动 OpenClaw
            await invoke('start_openclaw')
          } catch (err) {
            setGatewayStatus('error')
            setError(String(err))
          }
        }}
        className="w-full px-6 py-4 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg font-medium hover:opacity-90 mb-4 flex items-center justify-center gap-2 text-lg"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        🚀 启动 OpenClaw
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
                onClick={async () => {
                  try {
                    setInstallingSkill(skill.slug);
                    await invoke('update_skill', { slug: skill.slug });
                    await Promise.all([loadInstalledSkills(), checkForUpdates()]);
                    setInstallingSkill(null);
                    alert('技能更新成功！');
                  } catch (err) {
                    console.error('Update failed:', err);
                    setError(`更新失败: ${err}`);
                    setInstallingSkill(null);
                  }
                }}
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
                      onClick={async () => {
                        console.log('Update button clicked:', skill.slug);
                        try {
                          setInstallingSkill(skill.slug);
                          setError('');
                          await invoke('update_skill', { slug: skill.slug });
                          await Promise.all([loadInstalledSkills(), checkForUpdates()]);
                          setInstallingSkill(null);
                          alert('技能更新成功！');
                        } catch (err) {
                          console.error('Update failed:', err);
                          setError(`更新失败: ${err}`);
                          setInstallingSkill(null);
                        }
                      }}
                      disabled={installingSkill === skill.slug}
                      className="px-3 py-1 bg-yellow-500 text-white rounded text-sm hover:bg-yellow-600 disabled:opacity-50 cursor-pointer"
                    >
                      {installingSkill === skill.slug ? '更新中...' : '更新'}
                    </button>
                  ) : (
                    <span className="px-3 py-1 bg-green-100 text-green-700 rounded text-sm">已安装</span>
                  )
                ) : (
                  <button
                    onClick={async () => {
                      console.log('Install button clicked:', skill.slug);
                      try {
                        setInstallingSkill(skill.slug);
                        setError('');
                        console.log('Calling install_skill with slug:', skill.slug);
                        await invoke('install_skill', { slug: skill.slug });
                        console.log('install_skill completed');
                        await loadInstalledSkills();
                        setInstallingSkill(null);
                        alert(`技能 ${skill.name} 安装成功！`);
                      } catch (err) {
                        console.error('Install failed:', err);
                        setError(`安装失败: ${err}`);
                        setInstallingSkill(null);
                        alert(`安装失败: ${err}`);
                      }
                    }}
                    disabled={installingSkill === skill.slug}
                    className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50 cursor-pointer"
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

  // 启动器界面
  const renderLauncher = () => (
    <div className="h-[calc(100vh-73px)] flex flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-4 px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        {/* Docker 模式标识 */}
        {dockerMode && (
          <div className="flex items-center gap-2 px-3 py-1 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded-full text-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
            Docker 模式
          </div>
        )}
        
        <button
          onClick={async () => {
            try {
              setGatewayStatus('starting')
              setError('')
              if (dockerMode) {
                // Docker 模式：先检测 Gateway 是否真的运行，再打开浏览器
                try {
                  const ready = await invoke<boolean>('check_gateway_status')
                  if (ready) {
                    // Gateway 已运行，打开浏览器
                    window.open(dockerTokenUrl || 'http://localhost:18789', '_blank')
                    setGatewayStatus('running')
                  } else {
                    // Gateway 未运行，提示用户先部署
                    setGatewayStatus('stopped')
                    setError('Gateway 未运行，请先点击「Docker 一键部署」按钮')
                  }
                } catch (e) {
                  setGatewayStatus('stopped')
                  setError('检测 Gateway 状态失败: ' + String(e))
                }
              } else {
                await invoke('start_openclaw')
              }
            } catch (err) {
              setGatewayStatus('error')
              setError(String(err))
            }
          }}
          disabled={gatewayStatus === 'starting'}
          className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {gatewayStatus === 'starting' ? '检测中...' : dockerMode ? '打开 Web 界面' : '启动 Gateway'}
        </button>
        
        {/* Docker 部署按钮 */}
        <button
          onClick={async () => {
            try {
              setGatewayStatus('starting')
              setError('')
              const result = await invoke<string>('deploy_docker')
              setDockerMode(true)
              localStorage.setItem('openclaw_docker_deployed', 'true')
              setGatewayStatus('running')
              console.log('Docker部署结果:', result)
              // 等待 Gateway 服务可用
              let gatewayReady = false
              for (let i = 0; i < 10; i++) {
                try {
                  const ready = await invoke<boolean>('check_gateway_status')
                  if (ready) {
                    gatewayReady = true
                    break
                  }
                } catch (e) {}
                await new Promise(resolve => setTimeout(resolve, 2000))
              }
              if (gatewayReady) {
                setStep('chat')
              }
            } catch (err) {
              setGatewayStatus('error')
              setError(String(err) + '\n\n如 Docker 未安装，请下载：https://shiping.ku1818.com.cn/openclaw/Docker%20Desktop%20Installer.exe')
            }
          }}
          className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
          </svg>
          Docker 一键部署
        </button>
        
        {/* Docker 下载链接 */}
        {true && (
          <a
            href="https://shiping.ku1818.com.cn/openclaw/Docker%20Desktop%20Installer.exe"
            target="_blank"
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            title="下载 Docker Desktop"
          >
            Docker 下载
          </a>
        )}
        
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${
            gatewayStatus === 'running' ? 'bg-green-500' : 
            gatewayStatus === 'starting' ? 'bg-yellow-500 animate-pulse' : 
            gatewayStatus === 'error' ? 'bg-red-500' : 'bg-gray-400'
          }`} />
          <span className="text-sm text-gray-600 dark:text-gray-400">
            {gatewayStatus === 'running' ? '运行中' : 
             gatewayStatus === 'starting' ? '启动中' : 
             gatewayStatus === 'error' ? '错误' : '已停止'}
          </span>
        </div>
        
        {dockerTokenUrl ? (
          <a 
            href={dockerTokenUrl} 
            target="_blank" 
            className="text-sm text-green-500 font-medium hover:underline flex items-center gap-1"
          >
            ✅ 打开 Gateway (已获取令牌)
          </a>
        ) : (
          <button
            onClick={async () => {
              try {
                const tokenUrl = await invoke<string>('get_docker_token_url')
                setDockerTokenUrl(tokenUrl)
              } catch (e) {
                setError('获取令牌失败: ' + String(e))
              }
            }}
            className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
          >
            🔑 获取令牌
          </button>
        )}
        
        <div className="flex-1" />
        
        <button
          onClick={() => setStep('model-management')}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          模型管理
        </button>
        <button
          onClick={() => setStep('skill-management')}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          技能管理
        </button>
        <button
          onClick={() => setStep('chat')}
          className="px-3 py-1.5 text-sm bg-primary-500 text-white rounded-lg hover:bg-primary-600 flex items-center gap-1"
          title="打开本地聊天界面"
        >
          💬 聊天
        </button>
        <button
          onClick={() => {
            // 打开 Docker 方案说明页面
            window.open('https://github.com/flottokarotto/openclaw-ollama-setup', '_blank')
          }}
          className="px-3 py-1.5 text-sm border border-purple-300 dark:border-purple-600 text-purple-600 dark:text-purple-400 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20"
          title="使用 Docker 方案，更稳定"
        >
          Docker 方案
        </button>
      </div>
      
      {/* 主内容区 */}
      <div className="flex-1 bg-white dark:bg-gray-900">
        {gatewayStatus === 'running' ? (
          // Docker 模式会自动跳转到聊天界面，这里显示过渡状态
          <div className="h-full flex flex-col items-center justify-center">
            <div className="w-20 h-20 mb-6 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
              <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-2 text-green-600 dark:text-green-400">Gateway 已启动</h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">正在进入聊天界面...</p>
            <button
              onClick={() => setStep('chat')}
              className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              💬 进入聊天
            </button>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            {gatewayStatus === 'starting' ? (
              <>
                <div className="w-16 h-16 mb-4 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <h2 className="text-xl font-semibold mb-2">正在启动 OpenClaw Gateway...</h2>
                <p className="text-gray-500 dark:text-gray-400 mb-6">首次启动可能需要下载依赖，请耐心等待</p>
                
                {/* 进度条动画 */}
                <div className="w-64 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
                    style={{ width: `${startupProgress}%` }}
                  />
                </div>
                <p className="text-sm text-gray-400 mb-4">{startupProgress}%</p>
                
                {/* 启动步骤提示 */}
                <div className="text-left bg-gray-50 dark:bg-gray-800 rounded-lg p-4 max-w-sm">
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center ${startupProgress >= 10 ? 'bg-green-500' : 'bg-blue-500'}`}>
                        {startupProgress >= 10 ? (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-3 h-3 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        )}
                      </div>
                      <span className={startupProgress >= 10 ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}>检查运行环境</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center ${startupProgress >= 30 ? 'bg-green-500' : startupProgress >= 10 ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                        {startupProgress >= 30 ? (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : startupProgress >= 10 ? (
                          <svg className="w-3 h-3 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <span className="text-gray-500 text-xs">2</span>
                        )}
                      </div>
                      <span className={startupProgress >= 30 ? 'text-green-600 dark:text-green-400' : startupProgress >= 10 ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400'}>启动服务</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center ${startupProgress >= 70 ? 'bg-green-500' : startupProgress >= 30 ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                        {startupProgress >= 70 ? (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : startupProgress >= 30 ? (
                          <svg className="w-3 h-3 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : (
                          <span className="text-gray-500 text-xs">3</span>
                        )}
                      </div>
                      <span className={startupProgress >= 70 ? 'text-green-600 dark:text-green-400' : startupProgress >= 30 ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400'}>等待响应</span>
                    </div>
                  </div>
                </div>
              </>
            ) : gatewayStatus === 'error' ? (
              <>
                <div className="w-16 h-16 mb-4 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center">
                  <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold mb-2 text-red-600 dark:text-red-400">启动失败</h2>
                <p className="text-gray-500 dark:text-gray-400 mb-4">{error || '未知错误'}</p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setGatewayStatus('stopped')}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                  >
                    重试
                  </button>
                  <button
                    onClick={() => window.open('https://github.com/flottokarotto/openclaw-ollama-setup', '_blank')}
                    className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600"
                  >
                    使用 Docker 方案（更稳定）
                  </button>
                </div>
                <p className="text-sm text-gray-400 mt-4">Docker 方案更稳定，推荐在 Windows 上使用</p>
              </>
            ) : (
              <>
                <div className="w-20 h-20 mb-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center">
                  <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold mb-2">OpenClaw 本地 AI 助手</h2>
                <p className="text-gray-500 dark:text-gray-400 mb-8">点击上方「启动 Gateway」按钮开始使用</p>
                <div className="text-left bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 max-w-md">
                  <h3 className="font-semibold mb-2 text-blue-700 dark:text-blue-300">使用说明</h3>
                  <ol className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                    <li>1. Docker 一键部署完成</li>
                    <li>2. 点击「启动 Gateway」按钮</li>
                    <li>3. 等待服务启动完成</li>
                    <li>4. 自动打开 Web 界面</li>
                    <li>5. 开始与 AI 对话</li>
                  </ol>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )

  // 检查 Gateway 连接并获取模型（通过 Rust 后端）
  const checkChatConnection = async (retries = 3) => {
    for (let i = 0; i < retries; i++) {
      try {
        const connected = await invoke<boolean>('check_gateway_status')
        if (connected) {
          setChatConnected(true)
          const models = await invoke<Array<{name: string, size?: number}>>('get_gateway_models')
          setChatModels(models)
          if (models.length > 0 && !chatSelectedModel) {
            setChatSelectedModel(models[0].name)
          }
          return // 成功则退出
        }
      } catch (err) {
        console.error(`检查Gateway连接失败 (尝试 ${i+1}/${retries}):`, err)
        if (i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000)) // 等待2秒重试
        }
      }
    }
    setChatConnected(false)
  }

  // 发送聊天消息（通过 Rust 后端）
  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return
    
    const userMessage = {
      id: Date.now().toString(),
      role: 'user' as const,
      content: chatInput.trim(),
      timestamp: new Date()
    }
    
    setChatMessages(prev => [...prev, userMessage])
    setChatInput('')
    setChatLoading(true)
    
    const assistantId = (Date.now() + 1).toString()
    
    try {
      const result = await invoke<string>('send_chat_message', {
        messages: [...chatMessages, userMessage].map(m => ({ role: m.role, content: m.content })),
        model: chatSelectedModel
      })
      
      setChatMessages(prev => [...prev, {
        id: assistantId,
        role: 'assistant',
        content: result,
        timestamp: new Date()
      }])
    } catch (err) {
      setChatMessages(prev => [...prev, {
        id: assistantId,
        role: 'assistant',
        content: `❌ 发送失败: ${err}\n\n请确保:\n1. Gateway 正在运行\n2. 本地模型已加载`,
        timestamp: new Date()
      }])
    }
    setChatLoading(false)
  }

  // 聊天界面
  const renderChat = () => (
    <div className="h-[calc(100vh-73px)] flex flex-col bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 py-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStep('launcher')}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="返回启动器"
          >
            ← 返回
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-white text-sm">🤖</span>
            </div>
            <div>
              <div className="font-medium text-sm">OpenClaw 本地聊天</div>
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <span className={`w-1.5 h-1.5 rounded-full ${chatConnected ? 'bg-green-500' : 'bg-red-500'}`}></span>
                {chatConnected ? '已连接' : '未连接'}
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {/* 模型选择 */}
          <select
            value={chatSelectedModel}
            onChange={(e) => setChatSelectedModel(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {chatModels.length === 0 ? (
              <option value="">加载模型中...</option>
            ) : (
              chatModels.map(m => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))
            )}
          </select>
          
          {/* 刷新连接 */}
          <button
            onClick={() => checkChatConnection()}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="刷新连接"
          >
            🔄
          </button>
          
          {/* 清空对话 */}
          <button
            onClick={() => setChatMessages([])}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-gray-500"
            title="清空对话"
          >
            🗑️
          </button>
        </div>
      </div>
      
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {chatMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 flex items-center justify-center mb-4">
              <span className="text-4xl">🤖</span>
            </div>
            <h2 className="text-xl font-medium mb-2 text-gray-700 dark:text-gray-200">开始对话</h2>
            <p className="text-gray-500 dark:text-gray-400 max-w-md">
              使用本地模型 <span className="font-medium text-blue-600 dark:text-blue-400">{chatSelectedModel || 'phi3.5'}</span> 进行对话<br/>
              完全本地运行，数据安全可靠
            </p>
            {!chatConnected && (
              <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400 text-sm">
                <div className="flex items-center justify-between">
                  <span>⚠️ 无法连接到 Gateway，请先启动服务</span>
                  <button
                    onClick={() => { checkChatConnection(5) }}
                    className="px-3 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600"
                  >
                    🔄 重试
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          chatMessages.map(msg => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <span className="text-white text-sm">🤖</span>
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm'
                }`}
              >
                <div className="whitespace-pre-wrap break-words text-sm">{msg.content}</div>
                <div className={`text-xs mt-1 ${msg.role === 'user' ? 'text-blue-100' : 'text-gray-400'}`}>
                  {msg.timestamp.toLocaleTimeString()}
                </div>
              </div>
              {msg.role === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                  <span className="text-sm">👤</span>
                </div>
              )}
            </div>
          ))
        )}
        {chatLoading && (
          <div className="flex gap-3 justify-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <span className="text-white text-sm">🤖</span>
            </div>
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl px-4 py-2.5">
              <div className="flex items-center gap-2 text-gray-400 text-sm">
                <span className="animate-spin">⏳</span>
                <span>思考中...</span>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* 输入区域 */}
      <div className="flex-shrink-0 p-4 bg-white/80 dark:bg-gray-800/80 backdrop-blur border-t border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto flex gap-2">
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendChatMessage()
              }
            }}
            placeholder="输入消息... (Enter发送, Shift+Enter换行)"
            className="flex-1 px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            rows={1}
            style={{ minHeight: '48px', maxHeight: '150px' }}
            disabled={!chatConnected}
          />
          <button
            onClick={sendChatMessage}
            disabled={!chatInput.trim() || chatLoading || !chatConnected}
            className="px-5 py-3 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white transition-colors flex items-center gap-2"
          >
            {chatLoading ? <span className="animate-spin">⏳</span> : <span>发送</span>}
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-400 text-center">
          纯本地运行 · 数据安全 · 模型: {chatSelectedModel || 'phi3.5'}
        </div>
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
        {step === 'launcher' ? (
          renderLauncher()
        ) : step === 'chat' ? (
          renderChat()
        ) : (
          <div className="max-w-2xl mx-auto px-6 py-12">
            {error && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">
                {error}
                <button onClick={() => setError(null)} className="ml-4 text-sm underline">关闭</button>
              </div>
            )}

            {step === 'welcome' && renderWelcome()}
            {step === 'license' && renderLicense()}
            {step === 'preparing' && renderPreparing()}
            {step === 'detecting' && renderDetecting()}
            {step === 'select-model' && renderSelectModel()}
            {step === 'installing' && renderInstalling()}
            {step === 'complete' && renderComplete()}
            {step === 'model-management' && renderModelManagement()}
            {step === 'skill-management' && renderSkillManagement()}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
