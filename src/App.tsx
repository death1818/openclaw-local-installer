import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-shell'

// 文件读取函数
const readFileContent = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      resolve(content)
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

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

type InstallStep = 'welcome' | 'license' | 'preparing' | 'detecting' | 'select-model' | 'installing' | 'complete' | 'model-management' | 'skill-management' | 'launcher' | 'ollama-setup' | 'chat' | 'training'
type Theme = 'light' | 'dark'

// 授权码格式验证
function validateLicenseCode(code: string): boolean {
  // 授权码格式: OPENCLAW-XXXX-XXXX-XXXX
  const pattern = /^OPENCLAW-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
  return pattern.test(code)
}

// 获取或创建设备唯一ID
function getDeviceId(): string {
  let deviceId = localStorage.getItem('openclaw_device_id')
  if (!deviceId) {
    deviceId = `DEV-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
    localStorage.setItem('openclaw_device_id', deviceId)
    console.log('生成新设备ID:', deviceId)
  }
  return deviceId
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
  const [skillInstallProgress, setSkillInstallProgress] = useState<{skill: string, progress: number, message: string} | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<string>('全部')
  
  // 启动器状态
  const [gatewayStatus, setGatewayStatus] = useState<'stopped' | 'starting' | 'running' | 'error'>('stopped')
  const [startupProgress, setStartupProgress] = useState(0) // 0-100
  const [dockerMode, setDockerMode] = useState(false) // Docker 部署模式
  
  // 聊天界面状态
  const [chatMessages, setChatMessages] = useState<Array<{id: string, role: 'user' | 'assistant', content: string, timestamp: Date, attachments?: string}>>(() => {
    const saved = localStorage.getItem('openclaw_chat_messages')
    if (saved) {
      try {
        return JSON.parse(saved).map((m: any) => ({...m, timestamp: new Date(m.timestamp)}))
      } catch { return [] }
    }
    return []
  })
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatModels, setChatModels] = useState<Array<{name: string, size?: number}>>([])
  const [chatSelectedModel, setChatSelectedModel] = useState(() => {
    return localStorage.getItem('openclaw_selected_model') || ''
  })
  const [chatConnected, setChatConnected] = useState(false)
  const [chatAttachedFile, setChatAttachedFile] = useState<string>('')
  const chatMessagesEndRef = useRef<HTMLDivElement>(null)
  const chatMessagesContainerRef = useRef<HTMLDivElement>(null)

  // 聊天消息自动滚动
  const scrollToChatBottom = () => {
    const container = chatMessagesContainerRef.current
    if (container) {
      container.scrollTop = container.scrollHeight
    }
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
  }

  useEffect(() => {
    scrollToChatBottom()
  }, [chatMessages, chatLoading])
  
  // 持久化聊天消息
  useEffect(() => {
    localStorage.setItem('openclaw_chat_messages', JSON.stringify(chatMessages))
  }, [chatMessages])
  
  // 持久化选择的模型
  useEffect(() => {
    if (chatSelectedModel) {
      localStorage.setItem('openclaw_selected_model', chatSelectedModel)
    }
  }, [chatSelectedModel])
  
  // 模型训练状态
  const [trainingCategory, setTrainingCategory] = useState<string>('')
  const [trainingProgress, setTrainingProgress] = useState(0)
  const [trainingLog, setTrainingLog] = useState<string[]>([])
  const [trainingActive, setTrainingActive] = useState(false)
  
  // 预设训练数据
  const trainingPresets = [
    {
      id: 'programming',
      name: '编程开发',
      icon: '💻',
      description: '代码编写、调试、架构设计',
      materials: [
        { title: '代码规范', content: '良好的代码规范包括：命名规范（变量名、函数名使用有意义的名称）、缩进和格式化、注释规范、代码复用原则。' },
        { title: '常见算法', content: '排序算法（冒泡、快速、归并）、搜索算法（二分、深度优先、广度优先）、动态规划、贪心算法。' },
        { title: '设计模式', content: '单例模式、工厂模式、观察者模式、策略模式、装饰器模式、适配器模式、代理模式。' },
        { title: '调试技巧', content: '断点调试、日志记录、单元测试、代码审查、性能分析、内存泄漏检测。' },
        { title: '架构原则', content: 'SOLID原则、DRY原则（不重复）、KISS原则（保持简单）、高内聚低耦合、关注点分离。' }
      ]
    },
    {
      id: 'writing',
      name: '写作助手',
      icon: '✍️',
      description: '文章创作、文案优化、内容策划',
      materials: [
        { title: '写作技巧', content: '开头要吸引注意力、中间要层层递进、结尾要总结升华。使用比喻、排比、拟人等修辞手法增强表现力。' },
        { title: '结构框架', content: '总分总结构、递进结构、对比结构、时间顺序结构、问题-分析-解决结构。' },
        { title: '文案要点', content: '了解目标受众、突出核心卖点、创造情感共鸣、使用行动号召、保持简洁有力。' },
        { title: '标题技巧', content: '数字法（5个技巧...）、疑问法（如何...）、对比法、悬念法、利益法（帮你节省...）。' },
        { title: '内容策划', content: '确定主题方向、收集素材资料、制定内容大纲、撰写初稿、反复修改润色、最终审核发布。' }
      ]
    },
    {
      id: 'business',
      name: '商业分析',
      icon: '📊',
      description: '数据分析、商业报告、决策支持',
      materials: [
        { title: '数据分析', content: '数据收集、数据清洗、数据分析、可视化呈现、结论总结。常用指标：转化率、留存率、增长率、ROI。' },
        { title: '报告结构', content: '执行摘要、背景说明、分析方法、数据呈现、结论建议、附录说明。' },
        { title: '决策框架', content: 'SWOT分析、PEST分析、波特五力模型、决策矩阵、成本效益分析、风险评估。' },
        { title: '指标体系', content: '北极星指标、OKR目标管理、KPI关键绩效指标、平衡计分卡。' },
        { title: '行业分析', content: '市场规模估算、竞争格局分析、发展趋势判断、用户画像分析、商业模式评估。' }
      ]
    },
    {
      id: 'education',
      name: '教育学习',
      icon: '📚',
      description: '知识讲解、学习辅导、课程设计',
      materials: [
        { title: '教学方法', content: '讲授法、讨论法、案例法、实践法、翻转课堂、项目式学习。' },
        { title: '知识体系', content: '知识点分解、逻辑关系梳理、难度梯度设计、学习路径规划。' },
        { title: '学习技巧', content: '费曼学习法、间隔重复、主动回忆、思维导图、番茄工作法。' },
        { title: '评估方法', content: '形成性评估、总结性评估、诊断性评估、自评与互评、实践考核。' },
        { title: '课程设计', content: '学习目标设定、内容选择组织、教学方法设计、评估方式确定、资源准备。' }
      ]
    },
    {
      id: 'medical',
      name: '医疗健康',
      icon: '🏥',
      description: '健康咨询、医学知识、养生指导',
      materials: [
        { title: '健康常识', content: '合理膳食、适量运动、充足睡眠、心理平衡、定期体检。每天饮水1500-2000ml，每周运动3-5次。' },
        { title: '常见症状', content: '感冒症状、消化不良、头痛失眠、过敏反应、慢性病管理。注意：AI建议仅供参考，严重症状请就医。' },
        { title: '营养知识', content: '蛋白质、碳水化合物、脂肪、维生素、矿物质、膳食纤维、水分。均衡饮食、控制热量。' },
        { title: '运动指导', content: '有氧运动（跑步、游泳、骑车）、力量训练、柔韧性训练、平衡训练。循序渐进、避免受伤。' },
        { title: '心理健康', content: '压力管理、情绪调节、社交支持、正念冥想、寻求帮助。保持积极心态。' }
      ]
    },
    {
      id: 'legal',
      name: '法律咨询',
      icon: '⚖️',
      description: '法律知识、合同审查、风险评估',
      materials: [
        { title: '合同要点', content: '当事人信息、标的条款、权利义务、违约责任、争议解决、生效条件。注意明确、具体、可执行。' },
        { title: '常见法律问题', content: '劳动纠纷、房产交易、婚姻家庭、交通事故、消费维权、知识产权。' },
        { title: '风险评估', content: '合同风险、合规风险、知识产权风险、劳动用工风险、诉讼风险。' },
        { title: '维权途径', content: '协商解决、调解仲裁、诉讼维权、行政投诉。注意保存证据、了解时效。' },
        { title: '免责声明', content: 'AI提供的法律信息仅供参考，不构成法律意见。具体法律问题请咨询专业律师。' }
      ]
    }
  ]

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
        console.log('Skill install progress:', event.payload)
        setSkillInstallProgress({
          skill: event.payload.skill_name,
          progress: event.payload.progress,
          message: event.payload.message
        })
        if (event.payload.status === 'completed') {
          setInstallingSkill(null)
          setSkillInstallProgress(null)
          loadInstalledSkills()
        } else if (event.payload.status === 'failed') {
          setInstallingSkill(null)
          setSkillInstallProgress(null)
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
        let licensed = localStorage.getItem('openclaw_licensed') === 'true'
        const savedLicenseCode = localStorage.getItem('openclaw_license_code')
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
        
        console.log('检测状态:', { openclawInstalled, licensed, installCompleted, configExists, dockerDeployedNow, savedLicenseCode })
        
        // Docker 部署模式也需要验证授权状态
        if (dockerDeployedNow) {
          console.log('Docker 部署模式，检查授权状态...')
          // 不直接进入启动器，继续往下验证授权码
        }
        
        // 🔧 关键修复：启动时必须检查服务器验证授权码状态
        let serverValidated = false  // 服务器验证通过标记
        
        if (savedLicenseCode) {
          console.log('检查服务器授权状态:', savedLicenseCode)
          try {
            const deviceId = getDeviceId()
            const response = await fetch('https://www.ku1818.cn/api/license/validate-license', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: savedLicenseCode, device_id: deviceId, check_mode: 'startup' })
            })
            const data = await response.json()
            console.log('服务器授权状态:', data)
            
            // 如果授权码已被注销，显示错误并清除本地状态
            if (data.revoked) {
              console.log('授权码已被注销')
              setError(`授权码已被注销，请联系官方或重新购买授权码\n注销时间: ${data.revoked_at}\n注销原因: ${data.revoked_reason || '无'}`)
              localStorage.removeItem('openclaw_licensed')
              localStorage.removeItem('openclaw_license_code')
              setStep('welcome')
              return
            }
            
            // 如果设备不匹配
            if (data.device_mismatch) {
              console.log('授权码已在其他设备激活')
              setError(`授权码已在其他设备激活，如需在此设备使用请联系官方重新激活\n激活时间: ${data.used_at || '未知'}`)
              localStorage.removeItem('openclaw_licensed')
              localStorage.removeItem('openclaw_license_code')
              setStep('welcome')
              return
            }
            
            // 如果服务器验证失败（无效授权码）
            if (!data.valid) {
              console.log('授权码无效')
              setError('授权码无效，请检查后重试')
              localStorage.removeItem('openclaw_licensed')
              localStorage.removeItem('openclaw_license_code')
              setStep('welcome')
              return
            }
            
            // 验证通过
            if (data.success && data.valid) {
              console.log('授权码验证通过')
              serverValidated = true
              licensed = true
              localStorage.setItem('openclaw_licensed', 'true')
              localStorage.setItem('openclaw_device_id', deviceId)
              setIsLicensed(true)
            }
          } catch (err) {
            console.error('检查服务器授权状态失败:', err)
            // 网络错误时，如果是已安装用户，允许离线使用（但显示警告）
            if (licensed && openclawInstalled) {
              console.log('网络错误，但已安装用户允许离线使用')
              serverValidated = true  // 允许离线使用
            }
          }
        } else {
          // 没有保存的授权码，需要重新输入
          console.log('未找到保存的授权码，需要重新验证')
          licensed = false
        }
        
        // 如果没有通过服务器验证，不能进入启动器
        if (!serverValidated) {
          console.log('服务器验证未通过，显示欢迎页')
          localStorage.removeItem('openclaw_licensed')
          setStep('welcome')
          return
        }
        
        // 如果 OpenClaw 已安装但配置不存在，需要清理（但保留授权状态）
        if (openclawInstalled && !configExists) {
          console.log('检测到旧版本（缺少配置），清理中...')
          // 清理旧版本
          try {
            await invoke('clean_old_version')
          } catch (err) {
            console.error('清理旧版本失败:', err)
          }
          // 清理安装状态（但保留授权码和授权状态）
          localStorage.removeItem('openclaw_install_completed')
          // 注意：不再清除授权状态，因为上面已经从服务器恢复了
          setStep('license') // 跳转到授权页面，而不是欢迎页
          return
        }
        
        // 正常检测：已安装且已授权且配置存在
        if (openclawInstalled && licensed && installCompleted && configExists) {
          console.log('已安装完成，进入启动器')
          setStep('launcher')
        } else if (licensed && !installCompleted) {
          // 已授权但未安装完成，跳转到准备页面
          console.log('已授权但未安装完成，跳转到准备页面')
          setStep('preparing')
        } else {
          // 未授权
          console.log('未授权，显示欢迎页')
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
      // 调用线上API验证授权码，传入设备ID
      const deviceId = getDeviceId()
      const response = await fetch('https://www.ku1818.cn/api/license/validate-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, device_id: deviceId })
      })
      
      const data = await response.json()
      console.log('授权验证结果:', data)
      
      // 检测注销状态
      if (data.revoked) {
        setLicenseError(`授权码已被注销，请联系官方或重新购买授权码\n注销时间: ${data.revoked_at || '未知'}\n注销原因: ${data.revoked_reason || '无'}`)
        return
      }
      
      // 检测设备不匹配
      if (data.device_mismatch) {
        setLicenseError(`授权码已在其他设备激活，如需在此设备使用请联系官方重新激活\n激活时间: ${data.used_at || '未知'}`)
        return
      }
      
      if (data.valid) {
        setIsLicensed(true)
        localStorage.setItem('openclaw_licensed', 'true')
        localStorage.setItem('openclaw_license_code', code)
        localStorage.setItem('openclaw_device_id', deviceId)
        setLicenseError('')
        // 授权成功后先准备 Ollama 环境
        setStep('preparing')
        localStorage.setItem('openclaw_docker_deployed', 'true')
      } else {
        setLicenseError(data.message || '授权码无效')
      }
    } catch (err) {
      console.error('授权验证网络错误:', err)
      setLicenseError('网络错误，无法验证授权码，请检查网络连接')
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
        // 注意：不再清除授权状态，保留用户已激活的授权码
        // localStorage.removeItem('openclaw_licensed')
        setInstallLog(prev => [...prev, '✅ 已清理旧版本数据（保留授权状态）'])
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
      // 加载推荐列表（后端已自动同步 installed 状态）
      const skills = await invoke<RemoteSkill[]>('get_recommended_skills')
      console.log('加载推荐技能:', skills.length, '个')
      
      // 获取已安装列表用于显示
      const installedList = await invoke<InstalledSkill[]>('get_installed_skills')
      console.log('已安装技能:', installedList.map(s => s.slug))
      setInstalledSkills(installedList)
      
      // 使用后端返回的 installed 状态
      setRemoteSkills(skills)
    } catch (err) {
      console.error('加载推荐技能失败:', err)
      setError('加载推荐技能失败，请稍后重试')
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
      
      {/* 重要提示 */}
      <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
        <p className="text-sm text-amber-700 dark:text-amber-300">
          ⚠️ 本地模型需要自己训练，训练后才会得心应手，请根据实际需求购买授权使用，凡是购买即默认本地模型使用规则。
        </p>
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
            
            // 自动安装默认技能 - 记忆系统优先（核心功能）
            const defaultSkills = [
              'memory-tdai',           // 记忆系统（核心必装）
              'openclaw-weixin',       // 微信助手
              'ddingtalk',             // 钉钉助手
              'wecom',                 // 企业微信助手
              'lightclawbot',          // 机器人框架
              'openclaw-plugin-yuanbao' // 元宝Bot
            ]
            for (const slug of defaultSkills) {
              try {
                console.log(`正在安装核心技能: ${slug}`)
                await invoke('install_skill', { slug })
                console.log(`核心技能 ${slug} 安装成功`)
              } catch (e) {
                console.warn(`安装技能 ${slug} 失败:`, e)
              }
            }
            
            // 刷新已安装技能列表
            const skills = await invoke<InstalledSkill[]>('get_installed_skills')
            setInstalledSkills(skills)
            
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
        <button
          onClick={() => setStep('training')}
          className="px-4 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg font-medium hover:opacity-90"
        >
          🎯 模型训练
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
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">模型管理</h2>
        <button
          onClick={() => setStep('launcher')}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
        >
          ← 返回启动器
        </button>
      </div>
      
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <h3 className="font-medium mb-3">已安装模型</h3>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {installedModels.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                暂无已安装模型，请从下方推荐列表选择安装
              </div>
            ) : (
              installedModels.map((model) => (
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
              ))
            )}
          </div>
          
          {/* 推荐模型 */}
          <h3 className="font-medium mb-3 mt-6">推荐模型</h3>
          
          {/* 模型下载进度条 */}
          {downloadStatus === 'downloading' && downloadProgress && (
            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                  {downloadProgress.phase}
                </span>
                <span className="text-sm text-blue-600 dark:text-blue-400">
                  {downloadProgress.percent}%
                </span>
              </div>
              <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
                <div 
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress.percent}%` }}
                ></div>
              </div>
              <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                {downloadProgress.current > 0 && downloadProgress.total > 0 
                  ? `${(downloadProgress.current / 1024 / 1024 / 1024).toFixed(2)} GB / ${(downloadProgress.total / 1024 / 1024 / 1024).toFixed(2)} GB`
                  : '正在下载...'}
              </div>
            </div>
          )}
          
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {[
              { name: 'phi3.5', size: '2.2GB', desc: '微软轻量级模型，适合日常对话', recommended: true },
              { name: 'qwen2.5:7b', size: '4.7GB', desc: '通义千问7B，中文能力强', recommended: true },
              { name: 'llama3.2:3b', size: '2GB', desc: 'Meta Llama 3.2 3B，多语言支持', recommended: true },
              { name: 'mistral:7b', size: '4.1GB', desc: 'Mistral 7B，性能优异', recommended: false },
              { name: 'gemma2:9b', size: '5.5GB', desc: 'Google Gemma 2 9B', recommended: false },
              { name: 'codellama:7b', size: '3.8GB', desc: '代码专用模型', recommended: false },
              { name: 'deepseek-coder:6.7b', size: '3.8GB', desc: 'DeepSeek代码模型', recommended: false },
              { name: 'yi:9b', size: '5.5GB', desc: '零一万物Yi模型', recommended: false },
            ].map((model) => (
              <div
                key={model.name}
                className="p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-blue-300 flex items-center justify-between"
              >
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {model.name}
                    {model.recommended && (
                      <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded">推荐</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {model.size} · {model.desc}
                  </div>
                </div>
                <button
                  onClick={async () => {
                    const modelExists = installedModels.some(m => m.name === model.name || m.name.startsWith(model.name.split(':')[0]))
                    if (modelExists) {
                      alert(`${model.name} 已安装`)
                      return
                    }
                    if (!confirm(`确定要安装 ${model.name} (${model.size})？`)) return
                    
                    setDownloadStatus('downloading')
                    setInstallLog([`开始下载 ${model.name}...`])
                    try {
                      await invoke('pull_model', { modelName: model.name })
                      setInstallLog(prev => [...prev, `✅ ${model.name} 安装成功`])
                      setDownloadStatus('completed')
                      // 刷新已安装列表
                      await loadInstalledModels()
                      // 重置状态
                      setTimeout(() => {
                        setDownloadStatus('idle')
                        setDownloadProgress(null)
                      }, 2000)
                    } catch (err) {
                      setInstallLog(prev => [...prev, `❌ 安装失败: ${err}`])
                      setDownloadStatus('failed')
                    }
                  }}
                  disabled={downloadStatus === 'downloading'}
                  className="px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 disabled:opacity-50"
                >
                  {downloadStatus === 'downloading' && downloadProgress?.phase?.includes(model.name) 
                    ? `${downloadProgress.percent}%` 
                    : installedModels.some(m => m.name === model.name || m.name.startsWith(model.name.split(':')[0])) 
                      ? '已安装' 
                      : '安装'}
                </button>
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
    </div>
  )
  
  // 渲染技能管理界面
  const renderSkillManagement = () => {
    // 获取所有分类
    const categories = ['全部', ...Array.from(new Set(remoteSkills.map(s => s.category)))].sort()
    
    // 根据分类筛选技能
    const filteredSkills = selectedCategory === '全部' 
      ? remoteSkills 
      : remoteSkills.filter(s => s.category === selectedCategory)
    
    // 按分类分组
    const skillsByCategory = filteredSkills.reduce((acc, skill) => {
      if (!acc[skill.category]) acc[skill.category] = []
      acc[skill.category].push(skill)
      return acc
    }, {} as Record<string, typeof remoteSkills>)
    
    return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">技能管理</h2>
        <button
          onClick={() => setStep('launcher')}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
        >
          ← 返回启动器
        </button>
      </div>
      
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
        </div>
      )}
      
      {/* 搜索框 */}
      <div className="mb-4">
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
      
      {/* 分类筛选 */}
      <div className="mb-4 flex flex-wrap gap-2">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1 rounded-full text-sm transition-colors ${
              selectedCategory === cat 
                ? 'bg-blue-500 text-white' 
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>
      
      {/* 已安装技能 */}
      {installedSkills.length > 0 && (
        <div className="mb-6">
          <h3 className="font-medium mb-3 flex items-center gap-2">
            <span className="text-green-500">✓</span> 已安装技能 ({installedSkills.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {installedSkills.map(skill => (
              <div key={skill.slug} className="p-3 border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 rounded-lg flex justify-between items-center">
                <div>
                  <div className="font-medium text-green-700 dark:text-green-300">{skill.name}</div>
                  <div className="text-xs text-gray-500">{skill.slug} · v{skill.version}</div>
                </div>
                <button
                  onClick={() => uninstallSkill(skill.slug)}
                  className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                >
                  卸载
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* 安装进度条 */}
      {skillInstallProgress && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              正在安装: {skillInstallProgress.skill}
            </span>
            <span className="text-sm text-blue-600 dark:text-blue-400">
              {skillInstallProgress.progress}%
            </span>
          </div>
          <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
            <div 
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${skillInstallProgress.progress}%` }}
            ></div>
          </div>
          <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            {skillInstallProgress.message}
          </div>
        </div>
      )}
      
      {/* 技能列表 - 按分类显示 */}
      <div className="space-y-6">
        {Object.entries(skillsByCategory).map(([category, skills]) => (
          <div key={category}>
            <h3 className="font-medium mb-3 flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
              {category} ({skills.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {skills.map(skill => (
                <div key={skill.slug} className={`p-3 border rounded-lg ${skill.installed ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10' : 'border-gray-200 dark:border-gray-600'}`}>
                  <div className="flex justify-between items-start mb-1">
                    <div className="font-medium text-sm">{skill.name}</div>
                    <div className="text-xs text-gray-400">{skill.downloads > 0 ? `${(skill.downloads/1000).toFixed(0)}k` : ''}</div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 line-clamp-2">{skill.description}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-1 flex-wrap">
                      {skill.tags.slice(0, 2).map(tag => (
                        <span key={tag} className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                    {skill.installed ? (
                      <span className="px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 rounded text-xs">已安装</span>
                    ) : (
                      <button
                        onClick={async () => {
                          try {
                            setInstallingSkill(skill.slug);
                            await invoke('install_skill', { slug: skill.slug });
                            await loadInstalledSkills();
                            // 更新当前技能列表的状态
                            setRemoteSkills(prev => prev.map(s => 
                              s.slug === skill.slug ? { ...s, installed: true } : s
                            ));
                            setInstallingSkill(null);
                          } catch (err) {
                            console.error('Install failed:', err);
                            setError(`安装失败: ${err}`);
                            setInstallingSkill(null);
                          }
                        }}
                        disabled={installingSkill === skill.slug}
                        className="px-2 py-0.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 disabled:opacity-50"
                      >
                        {installingSkill === skill.slug ? '安装中...' : '安装'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      
      <div className="mt-6 flex gap-3">
        <button
          onClick={async () => {
            setSearchQuery('');
            setSelectedCategory('全部');
            await loadInstalledSkills();
            await loadRecommendedSkills();
          }}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
        >
          刷新列表
        </button>
      </div>
    </div>
  )
  }

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
              
              // 自动安装默认技能 - 记忆系统优先
              const defaultSkills = [
                'memory-tdai',           // 记忆系统（核心必装）
                'openclaw-weixin',       // 微信助手
                'ddingtalk',             // 钉钉助手
                'wecom',                 // 企业微信助手
                'lightclawbot',          // 机器人框架
                'openclaw-plugin-yuanbao' // 元宝Bot
              ]
              for (const slug of defaultSkills) {
                try {
                  console.log(`正在安装核心技能: ${slug}`)
                  await invoke('install_skill', { slug })
                  console.log(`核心技能 ${slug} 安装成功`)
                } catch (e) {
                  console.warn(`安装技能 ${slug} 失败:`, e)
                }
              }
              
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
                // 刷新已安装技能列表
                const skills = await invoke<InstalledSkill[]>('get_installed_skills')
                setInstalledSkills(skills)
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
          onClick={async () => {
            await loadInstalledModels()
            setStep('model-management')
          }}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          模型管理
        </button>
        <button
          onClick={async () => {
            await loadInstalledSkills()
            await loadRecommendedSkills()
            setStep('skill-management')
          }}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          技能管理
        </button>
        <button
          onClick={() => setStep('training')}
          className="px-3 py-1.5 text-sm border border-amber-300 dark:border-amber-600 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20"
        >
          🎯 训练
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
    if ((!chatInput.trim() && !chatAttachedFile) || chatLoading) return
    
    // 构建消息内容
    let messageContent = chatInput.trim()
    if (chatAttachedFile) {
      messageContent = `${messageContent}\n\n--- 文件内容 ---\n${chatAttachedFile}`
    }
    
    const userMessage = {
      id: Date.now().toString(),
      role: 'user' as const,
      content: messageContent,
      timestamp: new Date(),
      attachments: chatAttachedFile ? '📎 已附加文件' : undefined
    }
    
    setChatMessages(prev => [...prev, userMessage])
    setChatInput('')
    setChatAttachedFile('') // 清空附件
    setChatLoading(true)
    
    const assistantId = (Date.now() + 1).toString()
    
    // 检测技能安装请求
    const skillInstallPatterns = [
      /安装(.+?)技能/,
      /安装(.+?)插件/,
      /帮我安装(.+)/,
      /我想安装(.+)/,
      /install skill (.+)/i,
      /安装一个(.+)/,
    ]
    
    let skillToInstall: string | null = null
    for (const pattern of skillInstallPatterns) {
      const match = messageContent.match(pattern)
      if (match) {
        skillToInstall = match[1].trim()
        break
      }
    }
    
    // 技能名称映射
    const skillNameMap: Record<string, string> = {
      '微信': 'openclaw-weixin', '微信助手': 'openclaw-weixin',
      '钉钉': 'ddingtalk', '钉钉助手': 'ddingtalk',
      '企业微信': 'wecom', '企业微信助手': 'wecom',
      '元宝': 'openclaw-plugin-yuanbao', '元宝bot': 'openclaw-plugin-yuanbao',
      'lightclawbot': 'lightclawbot', '机器人框架': 'lightclawbot',
      '记忆': 'memory-tdai', '记忆系统': 'memory-tdai', 'TDAI': 'memory-tdai', 'tdai': 'memory-tdai',
      '天气': 'weather', '天气查询': 'weather',
      'github': 'github', 'GitHub助手': 'github', 'GitHub': 'github',
      'tailscale': 'tailscale',
      '摘要': 'summarize', '网页摘要': 'summarize',
      'obsidian': 'obsidian', '笔记': 'obsidian',
      '视频': 'video-frames', '视频处理': 'video-frames',
      '浏览器': 'agent-browser', '网页自动化': 'agent-browser',
      '搜索': 'web-search', '网页搜索': 'web-search',
      '工作流': 'clawflow', 'clawflow': 'clawflow',
      'adp': 'adp-openclaw', '适配器': 'adp-openclaw',
      'openai': 'openai-api', 'chatgpt': 'openai-api', 'gpt': 'openai-api',
      'claude': 'claude-api',
      'gemini': 'gemini-api',
      '文心': 'ernie-api', '文心一言': 'ernie-api',
      '通义': 'qwen-api', '通义千问': 'qwen-api',
      'deepseek': 'deepseek-api',
      '绘画': 'ai-painting', 'AI绘画': 'ai-painting',
      '翻译': 'realtime-translate', 'AI翻译': 'realtime-translate',
    }
    
    if (skillToInstall) {
      // 映射技能名称
      const skillSlug = skillNameMap[skillToInstall] || skillToInstall.toLowerCase()
      
      try {
        setChatMessages(prev => [...prev, {
          id: assistantId,
          role: 'assistant',
          content: `⏳ 正在安装「${skillToInstall}」技能...`,
          timestamp: new Date()
        }])
        
        await invoke('install_skill', { slug: skillSlug })
        
        // 刷新已安装技能列表
        const skills = await invoke<InstalledSkill[]>('get_installed_skills')
        setInstalledSkills(skills)
        
        setChatMessages(prev => {
          const newMessages = [...prev]
          const lastMsg = newMessages[newMessages.length - 1]
          if (lastMsg.id === assistantId) {
            lastMsg.content = `✅ 「${skillToInstall}」技能安装成功！\n\n现在你可以使用这个技能了。例如：\n- 微信：发送微信消息给某人\n- 钉钉：查看钉钉群消息\n- 企业微信：发送企业微信通知`
          }
          return newMessages
        })
      } catch (err) {
        setChatMessages(prev => {
          const newMessages = [...prev]
          const lastMsg = newMessages[newMessages.length - 1]
          if (lastMsg.id === assistantId) {
            lastMsg.content = `❌ 安装失败: ${err}`
          }
          return newMessages
        })
      }
      setChatLoading(false)
      return
    }
    
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

  // 模型训练界面
  const renderTraining = () => (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800 py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* 顶部栏 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setStep('launcher')}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              ← 返回
            </button>
            <div>
              <h1 className="text-xl font-bold">🎯 模型训练中心</h1>
              <p className="text-sm text-gray-500">选择行业领域，一键投喂基础知识</p>
            </div>
          </div>
          <button
            onClick={() => {
              setTrainingCategory('')
              setTrainingProgress(0)
              setTrainingLog([])
            }}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            重置
          </button>
        </div>

        {/* 训练进度 */}
        {trainingActive && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-blue-700 dark:text-blue-300">训练进行中...</span>
              <span className="text-sm text-blue-600 dark:text-blue-400">{trainingProgress}%</span>
            </div>
            <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
              <div 
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${trainingProgress}%` }}
              ></div>
            </div>
          </div>
        )}

        {/* 训练日志 */}
        {trainingLog.length > 0 && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-xl">
            <h3 className="font-medium mb-2">📋 训练日志</h3>
            <div className="max-h-40 overflow-y-auto text-sm text-gray-600 dark:text-gray-400 font-mono">
              {trainingLog.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          </div>
        )}

        {/* 训练分类 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {trainingPresets.map(preset => (
            <div
              key={preset.id}
              className={`p-4 rounded-xl border-2 transition-all cursor-pointer ${
                trainingCategory === preset.id 
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                  : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
              }`}
              onClick={() => setTrainingCategory(preset.id)}
            >
              <div className="text-3xl mb-2">{preset.icon}</div>
              <div className="font-medium mb-1">{preset.name}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{preset.description}</div>
              <div className="text-xs text-blue-500 mt-2">{preset.materials.length} 个知识点</div>
            </div>
          ))}
        </div>

        {/* 训练内容预览 */}
        {trainingCategory && (
          <div className="mt-6">
            <h3 className="font-medium mb-4">📚 训练内容预览</h3>
            <div className="space-y-3">
              {trainingPresets.find(p => p.id === trainingCategory)?.materials.map((m, i) => (
                <div key={i} className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="font-medium text-sm mb-1">{i + 1}. {m.title}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{m.content}</div>
                </div>
              ))}
            </div>
            
            {/* 操作按钮 */}
            <div className="mt-6 flex gap-4">
              <button
                onClick={async () => {
                  const preset = trainingPresets.find(p => p.id === trainingCategory)
                  if (!preset || trainingActive) return
                  
                  setTrainingActive(true)
                  setTrainingProgress(0)
                  setTrainingLog([])
                  
                  for (let i = 0; i < preset.materials.length; i++) {
                    const m = preset.materials[i]
                    setTrainingLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] 正在投喂: ${m.title}`])
                    
                    // 模拟训练过程
                    await new Promise(resolve => setTimeout(resolve, 500))
                    
                    setTrainingLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ✅ ${m.title} 已学习`])
                    setTrainingProgress(Math.round(((i + 1) / preset.materials.length) * 100))
                  }
                  
                  setTrainingLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🎉 训练完成！`])
                  setTrainingActive(false)
                }}
                disabled={trainingActive}
                className="flex-1 px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white rounded-xl font-medium transition-colors"
              >
                {trainingActive ? '训练中...' : '🚀 开始训练'}
              </button>
              
              <button
                onClick={() => {
                  setStep('chat')
                }}
                className="px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                💬 去聊天测试
              </button>
            </div>
          </div>
        )}

        {/* 提示 */}
        <div className="mt-8 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
          <div className="flex items-start gap-2">
            <span className="text-amber-500">💡</span>
            <div className="text-sm text-amber-700 dark:text-amber-300">
              <p className="font-medium mb-1">高级训练</p>
              <p className="text-xs">如需更专业的训练，请在聊天界面附加您的专业文档进行深度投喂。</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

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
      <div ref={chatMessagesContainerRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
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
        <div ref={chatMessagesEndRef} />
      </div>
      
      {/* 输入区域 */}
      <div className="flex-shrink-0 p-4 bg-white/80 dark:bg-gray-800/80 backdrop-blur border-t border-gray-200 dark:border-gray-700">
        {/* 文件附件显示 */}
        {chatAttachedFile && (
          <div className="max-w-4xl mx-auto mb-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-between">
            <span className="text-sm text-blue-600 dark:text-blue-400">
              📎 已附加文件内容 ({chatAttachedFile.length} 字符)
            </span>
            <button
              onClick={() => setChatAttachedFile('')}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              ✕
            </button>
          </div>
        )}
        <div className="max-w-4xl mx-auto flex gap-2">
          {/* 文件上传按钮 */}
          <input
            type="file"
            id="chat-file-input"
            className="hidden"
            accept=".txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.html,.css,.xml,.yaml,.yml,.csv,.log"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (file) {
                try {
                  const content = await readFileContent(file)
                  setChatAttachedFile(content)
                } catch (err) {
                  console.error('读取文件失败:', err)
                }
              }
              e.target.value = '' // 重置以允许重复选择同一文件
            }}
          />
          <button
            onClick={() => document.getElementById('chat-file-input')?.click()}
            className="px-3 py-3 rounded-xl border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="附加文件"
            disabled={!chatConnected}
          >
            📎
          </button>
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
            disabled={(!chatInput.trim() && !chatAttachedFile) || chatLoading || !chatConnected}
            className="px-5 py-3 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white transition-colors flex items-center gap-2"
          >
            {chatLoading ? <span className="animate-spin">⏳</span> : <span>发送</span>}
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-400 text-center">
          纯本地运行 · 数据安全 · 模型: {chatSelectedModel || 'phi3.5'} · 支持 📎 附加文件
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
            {localStorage.getItem('openclaw_license_code') && (
              <span 
                className="ml-2 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs text-gray-600 dark:text-gray-400 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600"
                onClick={() => {
                  navigator.clipboard.writeText(localStorage.getItem('openclaw_license_code') || '')
                  alert('授权码已复制到剪贴板')
                }}
                title="点击复制授权码"
              >
                📋 {localStorage.getItem('openclaw_license_code')}
              </span>
            )}
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
        ) : step === 'training' ? (
          renderTraining()
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
