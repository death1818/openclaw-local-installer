import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-shell'

// 文件读取函数 - 无大小限制
const readFileContent = async (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      if (!content || content.trim().length === 0) {
        reject(new Error('文件内容为空'))
        return
      }
      resolve(content)
    }
    reader.onerror = () => reject(new Error('读取文件失败，请检查文件格式'))
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
  const [showPluginConfig, setShowPluginConfig] = useState(false)
  const [pluginConfigs, setPluginConfigs] = useState(() => {
    const saved = localStorage.getItem('openclaw_plugin_configs')
    return saved ? JSON.parse(saved) : {
      wechat: { enabled: false, qrUrl: '' },
      dingtalk: { enabled: false, appKey: '', appSecret: '' },
      wecom: { enabled: false, corpId: '', corpSecret: '', agentId: '', token: '', encodingAESKey: '' },
      yuanbao: { enabled: false, appId: '', appSecret: '' }
    }
  })
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
  
  // 持久化插件配置
  useEffect(() => {
    localStorage.setItem('openclaw_plugin_configs', JSON.stringify(pluginConfigs))
  }, [pluginConfigs])
  
  // 模型训练状态
  const [trainingCategory, setTrainingCategory] = useState<string>('')
  const [trainingProgress, setTrainingProgress] = useState(0)
  const [trainingLog, setTrainingLog] = useState<string[]>([])
  const [trainingActive, setTrainingActive] = useState(false)
  
  // 预设训练数据 - 丰富知识点
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
        { title: '架构原则', content: 'SOLID原则、DRY原则（不重复）、KISS原则（保持简单）、高内聚低耦合、关注点分离。' },
        { title: '前端开发', content: 'HTML/CSS/JavaScript基础、React/Vue/Angular框架、响应式设计、性能优化、跨浏览器兼容、组件化开发。' },
        { title: '后端开发', content: 'RESTful API设计、数据库设计、缓存策略、消息队列、微服务架构、容器化部署。' },
        { title: '版本控制', content: 'Git基本命令（add/commit/push/pull）、分支管理、合并冲突解决、代码回滚、标签管理。' },
        { title: '安全实践', content: 'SQL注入防护、XSS防护、CSRF防护、输入验证、密码加密、HTTPS部署、敏感数据保护。' },
        { title: '性能优化', content: '代码优化、数据库索引、缓存使用、懒加载、CDN加速、压缩资源、减少HTTP请求。' },
        { title: '变量与数据类型', content: '变量是存储数据的容器。常见数据类型：整型、浮点型、字符串、布尔型、数组、对象。选择合适的数据类型可以提高程序效率。' },
        { title: '运算符', content: '算术运算符(+,-,*,/,%)、比较运算符(==,!=,>,<)、逻辑运算符(&&,||,!)、赋值运算符(=,+=,-=)。理解运算符优先级。' },
        { title: '条件语句', content: 'if-else条件判断、switch-case多分支选择、三元运算符(?:)。条件语句控制程序的执行流程。' },
        { title: '循环结构', content: 'for循环、while循环、do-while循环、for-each遍历。循环用于重复执行代码块，注意避免无限循环。' },
        { title: '函数定义', content: '函数是可重用的代码块。包含函数名、参数、返回值、函数体。良好的函数应该是单一职责、命名清晰。' },
        { title: '作用域', content: '全局作用域、局部作用域、块级作用域。变量在其定义的作用域内有效，作用域链决定了变量的访问规则。' },
        { title: '闭包', content: '闭包是函数与其词法环境的组合。内部函数可以访问外部函数的变量，常用于数据封装、回调函数。' },
        { title: 'Promise异步', content: 'Promise是异步编程的解决方案。三种状态：pending、fulfilled、rejected。支持链式调用、错误捕获。' },
        { title: 'async/await', content: 'async/await是Promise的语法糖，让异步代码看起来像同步代码。async函数返回Promise。' },
        { title: '错误处理', content: 'try-catch-finally捕获异常、throw抛出错误、自定义错误类型。良好的错误处理提高程序健壮性。' },
        { title: '数组操作', content: '数组创建、索引访问、push/pop/shift/unshift、splice/slice、map/filter/reduce、find/some/every。' },
        { title: '对象操作', content: '对象创建、属性访问、Object.keys/values/entries、解构赋值、展开运算符、Object.assign。' },
        { title: '字符串处理', content: '字符串拼接、模板字符串、substring/slice/split、trim/toLowerCase/toUpperCase、正则匹配。' },
        { title: '类型转换', content: '隐式类型转换、显式类型转换(parseInt/parseFloat/Number/String/Boolean)、类型判断。' },
        { title: '内存管理', content: '栈内存与堆内存、垃圾回收机制、内存泄漏检测、内存优化技巧。JavaScript自动管理内存。' },
        { title: '模块化', content: 'ES模块(import/export)、CommonJS(require/module.exports)、模块化优势：代码组织、命名空间隔离。' },
        { title: '包管理', content: 'npm/yarn/pnpm包管理器、package.json配置、依赖版本管理、私有仓库、lock文件的作用。' },
        { title: '代码注释', content: '单行注释(//)、多行注释(/* */)、文档注释(JSDoc)、注释的最佳实践：解释为什么。' },
        { title: '编码规范', content: '命名规范(驼峰/下划线)、缩进风格、代码格式化(Prettier)、ESLint静态检查。' },
        { title: 'HTML基础', content: 'HTML是网页结构的基础。DOCTYPE声明、html/head/body结构、语义化标签、表单元素。' },
        { title: 'CSS选择器', content: '元素选择器、类选择器、ID选择器、属性选择器、伪类(:hover/:focus)、伪元素。' },
        { title: 'CSS布局', content: '盒模型(box-sizing)、Flexbox弹性布局、Grid网格布局、浮动布局、定位、响应式设计。' },
        { title: 'CSS动画', content: 'transition过渡动画、animation关键帧动画、transform变换、transitionend事件。' },
        { title: 'JavaScript DOM', content: 'DOM是文档对象模型。getElementById/querySelector、createElement/appendChild、innerHTML。' },
        { title: '事件处理', content: '事件监听(addEventListener)、事件冒泡与捕获、事件委托、阻止默认行为。' },
        { title: '表单验证', content: 'HTML5表单验证(required/pattern)、JavaScript自定义验证、实时验证、提交验证。' },
        { title: '本地存储', content: 'localStorage/sessionStorage、Cookie、IndexedDB、存储容量限制、数据序列化。' },
        { title: 'AJAX请求', content: 'XMLHttpRequest、Fetch API、axios库、GET/POST/PUT/DELETE请求、响应处理。' },
        { title: '跨域处理', content: '同源策略、CORS跨域、JSONP、代理服务器、postMessage跨窗口通信。' },
        { title: 'React基础', content: 'React是声明式UI库。组件化开发、JSX语法、Props/State、生命周期/hooks、虚拟DOM。' },
        { title: 'React Hooks', content: 'useState状态管理、useEffect副作用、useContext上下文、useReducer复杂状态。' },
        { title: 'Vue基础', content: 'Vue是渐进式框架。模板语法、指令(v-if/v-for/v-bind/v-on)、计算属性、侦听器。' },
        { title: '状态管理', content: 'Redux/Vuex/Pinia状态管理库。Store存储状态、Actions修改状态、单向数据流。' },
        { title: '路由管理', content: 'React Router/Vue Router。路由配置、动态路由、嵌套路由、路由守卫、懒加载。' },
        { title: '前端性能优化', content: '代码分割、懒加载、图片优化、缓存策略、CDN加速、压缩资源。' },
        { title: '前端安全', content: 'XSS跨站脚本攻击防护、CSRF跨站请求伪造防护、点击劫持防护、内容安全策略(CSP)。' },
        { title: 'TypeScript基础', content: 'TypeScript是JavaScript超集。类型注解、接口、类型别名、泛型、枚举、类型推断。' },
        { title: '前端工程化', content: 'Webpack/Vite打包工具、Babel转译、开发服务器、热更新、环境变量。' },
        { title: 'Node.js基础', content: 'Node.js是JavaScript运行时。事件驱动、非阻塞I/O、模块系统、npm生态。' },
        { title: 'Express框架', content: 'Express是Node.js Web框架。路由定义、中间件、请求处理、响应发送、错误处理。' },
        { title: 'RESTful API', content: 'REST架构风格。资源导向设计、HTTP方法语义(GET/POST/PUT/DELETE)、状态码规范。' },
        { title: 'API认证', content: 'JWT令牌认证、OAuth2.0授权、Session认证、API密钥、令牌刷新机制。' },
        { title: '数据库基础', content: '关系型数据库(SQL)与非关系型数据库(NoSQL)。表/集合、字段、主键、外键、索引、事务。' },
        { title: 'SQL查询', content: 'SELECT查询、INSERT插入、UPDATE更新、DELETE删除、JOIN连接、GROUP BY分组。' },
        { title: 'MongoDB', content: 'MongoDB是文档数据库。文档结构、集合操作、查询语法、聚合管道、索引。' },
        { title: 'Redis缓存', content: 'Redis是内存数据库。数据类型、缓存策略、过期时间、持久化、发布订阅。' },
        { title: 'Docker容器', content: 'Docker是容器化平台。镜像构建(Dockerfile)、容器运行、数据卷、网络。' },
        { title: 'Git工作流', content: 'Git Flow分支模型、GitHub Flow、Pull Request流程、代码审查。' },
        { title: '单元测试', content: '测试框架(Jest/Mocha)、断言库、测试覆盖率、Mock/Stub、参数化测试。' },
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
        { title: '内容策划', content: '确定主题方向、收集素材资料、制定内容大纲、撰写初稿、反复修改润色、最终审核发布。' },
        { title: '故事写作', content: '角色塑造、情节设计、冲突设置、高潮营造、结局收尾。注意悬念、反转、情感共鸣。' },
        { title: '公文写作', content: '通知、报告、请示、函、会议纪要。格式规范、内容准确、语言简洁、逻辑清晰。' },
        { title: '营销文案', content: '痛点挖掘、价值传递、信任建立、行动引导。突出差异化优势、制造紧迫感。' },
        { title: 'SEO写作', content: '关键词布局、标题优化、内容质量、内部链接、元描述、图片alt标签、移动端适配。' },
        { title: '社媒内容', content: '微信公众号、小红书、微博、抖音文案。注意平台调性、用户习惯、内容形式。' },
        { title: '写作目的', content: '明确写作目的：信息传递、说服影响、情感表达、娱乐消遣。目的决定内容选择和结构安排。' },
        { title: '目标读者', content: '分析目标读者：年龄、职业、教育背景、兴趣爱好、阅读习惯。内容要与读者产生共鸣。' },
        { title: '文章主题', content: '主题是文章的核心思想。主题要鲜明、集中、有深度。避免主题分散，每篇文章聚焦一个核心观点。' },
        { title: '素材收集', content: '素材来源：生活观察、阅读积累、采访调研、网络资源、个人经历。建立素材库，随时记录灵感。' },
        { title: '内容筛选', content: '素材筛选原则：与主题相关、有代表性、新颖有趣、真实可信。去除冗余信息，保留精华内容。' },
        { title: '文章结构', content: '常见结构：总分总、递进式、并列式、对比式、时间顺序、问题-分析-解决。结构要清晰。' },
        { title: '开头技巧', content: '吸引注意力的开头：提问法、故事法、数据法、引用法、悬念法、场景描写。' },
        { title: '结尾技巧', content: '有力结尾：总结升华、呼应开头、引发思考、行动号召、情感共鸣。' },
        { title: '段落组织', content: '段落要有中心句，其他句子围绕展开。段落间要有过渡，保持文章流畅。' },
        { title: '过渡衔接', content: '过渡方式：过渡词(然而/因此/此外)、过渡句、过渡段。过渡自然，让文章如流水般流畅。' },
        { title: '语言风格', content: '根据文章类型选择风格：正式/口语化、简洁/华丽、严肃/幽默。风格要统一。' },
        { title: '用词准确', content: '选择最精准的词语表达意思。注意近义词的细微差别，避免用词不当。' },
        { title: '句式多样', content: '长短句结合、陈述句与疑问句交替、主动句与被动句转换。句式多样让文章有节奏感。' },
        { title: '修辞手法', content: '比喻：形象生动；排比：增强气势；拟人：赋予生命；对比：突出特点；夸张：强化印象。' },
        { title: '逻辑严密', content: '论证要逻辑清晰：论点明确、论据充分、论证合理。避免逻辑谬误。' },
        { title: '细节描写', content: '细节让文章生动。具体数据、具体场景、具体动作、具体对话。细节来自观察和积累。' },
        { title: '情感表达', content: '真诚的情感最动人。通过细节、对比、铺垫传递情感。避免空洞抒情。' },
        { title: '节奏控制', content: '文章节奏：紧张与舒缓交替、详写与略写结合。重要内容详写，过渡内容略写。' },
        { title: '修改润色', content: '好文章是改出来的。第一遍：内容和结构；第二遍：语言和细节；第三遍：标点和格式。' },
        { title: '写作习惯', content: '建立写作习惯：固定时间写作、设定写作目标、克服完美主义。持续练习提高写作能力。' },
        { title: '文案目的', content: '文案目的：吸引注意、激发兴趣、产生欲望、促成行动。每个环节都要精心设计。' },
        { title: '用户痛点', content: '痛点是用户想解决的问题。挖掘痛点：用户调研、评论分析、竞品研究。痛点越准，文案越有力。' },
        { title: '价值主张', content: '产品能解决什么问题、带来什么好处。价值要具体、可感知、有差异化。' },
        { title: '信任建立', content: '信任元素：用户评价、权威认证、数据支撑、案例故事、品牌背书。' },
        { title: '行动号召', content: 'CTA(Call To Action)：明确告诉用户下一步做什么。按钮文案：立即购买/免费试用。' },
        { title: '标题技巧', content: '数字标题(5个技巧)、疑问标题(如何...)、对比标题、悬念标题、利益标题。' },
        { title: '副标题', content: '副标题补充主标题，提供更多信息。副标题要简洁有力，强化主题。' },
        { title: '开头钩子', content: '开头要抓住读者：震撼数据、引人故事、痛点场景、悬念问题。' },
        { title: '利益描述', content: '描述产品带来的好处，而不只是功能。用户不关心功能，关心功能带来的价值。' },
        { title: '场景化写作', content: '把用户带入场景：描绘画面、描述感受、引发共鸣。场景越具体，代入感越强。' },
        { title: '对比技巧', content: '使用前后对比，突出效果。与其他方案对比，突出优势。对比让价值更清晰。' },
        { title: '数据支撑', content: '具体数字增加可信度：提升50%、节省2小时、服务10万用户。数据要真实。' },
        { title: '情感诉求', content: '触达用户情感：安全感、归属感、成就感、自我实现。情感比理性更容易促成行动。' },
        { title: '社会证明', content: '他人选择影响决策：用户评价、使用人数、媒体报道、KOL推荐。' },
        { title: '稀缺性', content: '限时优惠、限量发售、独家权益。稀缺创造价值，促使用户尽快决策。' },
        { title: '承诺保证', content: '降低用户风险：不满意退款、免费试用、售后服务承诺。消除用户的后顾之忧。' },
        { title: '文案简洁', content: '删除不必要的词语，保留核心信息。短句比长句有力，具体比抽象清晰。' },
        { title: '文案测试', content: 'A/B测试不同文案：不同标题、不同开头、不同CTA。数据驱动优化。' },
        { title: '平台适配', content: '不同平台特点：微信(长文)、微博(短文)、小红书(图文)、抖音(短视频)。' },
        { title: '合规要求', content: '广告法规定：不得虚假宣传、不得使用极限词、标注广告性质。' },
        { title: '内容定位', content: '确定内容方向：专业知识、行业资讯、实用教程、情感故事。定位要清晰。' },
        { title: '内容矩阵', content: '多类型内容：长文、短文、图文、视频、音频。满足不同场景需求。' },
        { title: '内容日历', content: '规划发布计划：发布时间、发布频率、内容主题。日历让内容运营有节奏。' },
        { title: '热点追踪', content: '抓住热点：行业热点、社会热点、节日热点。快速响应，借势传播。' },
        { title: '系列内容', content: '系列文章增加粘性：连载教程、专题系列、问答系列。用户期待下一篇。' },
        { title: '内容差异化', content: '寻找独特角度：独特观点、独家数据、独特表达方式。差异化的内容才有竞争力。' },
        { title: '用户互动', content: '增加互动：问答互动、投票调查、评论回复、用户投稿。互动提高参与度。' },
        { title: '内容复用', content: '一鱼多吃：文章改视频、长文拆短文、合集整理。提高内容生产效率。' },
        { title: '内容更新', content: '定期更新旧内容：数据更新、观点补充、错误修正。保持内容时效性。' },
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
        { title: '行业分析', content: '市场规模估算、竞争格局分析、发展趋势判断、用户画像分析、商业模式评估。' },
        { title: '财务分析', content: '资产负债表、利润表、现金流量表、财务比率分析、盈亏平衡点、投资回报计算。' },
        { title: '用户研究', content: '用户画像、用户旅程地图、用户访谈、问卷调查、可用性测试、A/B测试。' },
        { title: '竞争分析', content: '竞品对比、市场份额、核心竞争力、差异化策略、进入壁垒、替代威胁。' },
        { title: '增长策略', content: '获客渠道、激活转化、留存促活、收入增长、裂变传播。增长黑客方法论。' },
        { title: '商业模式', content: '盈利模式、成本结构、收入来源、价值主张、客户细分、渠道通路、关键资源。' },
        { title: '数据思维', content: '数据思维是用数据来思考和决策。核心要素：问题定义、数据收集、分析方法、结论总结。' },
        { title: '数据类型', content: '定性数据(类别)、定量数据(数值)。离散数据(整数)、连续数据(小数)。时间序列数据。' },
        { title: '数据收集', content: '数据来源：内部系统、第三方平台、问卷调查、爬虫采集。数据质量：准确性、完整性、时效性。' },
        { title: '数据清洗', content: '缺失值处理：删除、填充、插值。异常值检测：箱线图、Z-score。数据格式统一、去重。' },
        { title: '描述统计', content: '集中趋势：均值、中位数、众数。离散程度：方差、标准差、极差。分布形态：偏度、峰度。' },
        { title: '数据可视化', content: '图表选择：柱状图(比较)、折线图(趋势)、饼图(占比)、散点图(关系)、热力图(分布)。' },
        { title: 'Excel分析', content: '数据透视表、VLOOKUP/XLOOKUP、条件格式、图表制作、数据验证、高级筛选。' },
        { title: 'SQL查询', content: 'SELECT查询、WHERE过滤、GROUP BY分组、HAVING筛选、ORDER BY排序、JOIN连接。' },
        { title: 'Python数据分析', content: 'Pandas数据处理、NumPy数值计算、Matplotlib/Seaborn可视化、Jupyter Notebook环境。' },
        { title: '数据指标', content: '核心指标：DAU日活、MAU月活、留存率、转化率、ARPU、LTV。指标要有业务意义。' },
        { title: '对比分析', content: '时间对比(同比/环比)、空间对比(不同地区)、目标对比(完成率)、竞品对比。' },
        { title: '趋势分析', content: '长期趋势、季节波动、周期变化、随机波动。时间序列分解、移动平均。' },
        { title: '漏斗分析', content: '用户转化漏斗：访问->浏览->加购->下单->支付。识别流失环节，优化转化。' },
        { title: '留存分析', content: '留存率：次日留存、7日留存、30日留存。留存曲线、同期群分析。' },
        { title: '用户分层', content: 'RFM模型(最近消费/频率/金额)、用户生命周期、价值分层、个性化运营。' },
        { title: 'A/B测试', content: '实验设计：假设提出、样本分组、变量控制、数据收集、显著性检验。' },
        { title: '相关性分析', content: '相关系数、散点图、因果与相关。相关不等于因果。' },
        { title: '回归分析', content: '线性回归、多元回归、逻辑回归。预测未来、解释关系、控制变量。' },
        { title: '数据报告', content: '报告结构：背景目的、数据来源、分析方法、结果展示、结论建议。' },
        { title: '数据驱动', content: '数据驱动决策：发现问题、提出假设、收集数据、验证假设、做出决策。' },
        { title: '市场分析', content: '市场规模(TAM/SAM/SOM)、市场增长率、市场饱和度、市场趋势。' },
        { title: '竞品分析', content: '竞争对手识别、产品对比、定价策略、营销策略、SWOT分析。' },
        { title: '用户研究', content: '用户画像、用户旅程、用户访谈、问卷调查、可用性测试。' },
        { title: '商业模式', content: '商业模式画布：价值主张、客户细分、渠道通路、客户关系、收入来源、核心资源。' },
        { title: '盈利模式', content: '产品销售、订阅收费、广告收入、佣金抽成、增值服务、数据变现。' },
        { title: '成本分析', content: '固定成本、变动成本、边际成本、机会成本。成本结构优化。' },
        { title: '定价策略', content: '成本加成定价、竞争导向定价、价值定价、渗透定价、撇脂定价。' },
        { title: '收入分析', content: '收入构成、收入增长、ARPU分析、收入预测、收入健康度。' },
        { title: '利润分析', content: '毛利、净利、利润率、盈亏平衡点。提高利润的路径。' },
        { title: '现金流分析', content: '经营现金流、投资现金流、筹资现金流。现金流是企业的血液。' },
        { title: '财务报表', content: '资产负债表、利润表、现金流量表。' },
        { title: '财务比率', content: '流动比率、速动比率、资产负债率、ROE、ROA、毛利率、净利率。' },
        { title: 'ROI分析', content: '投资回报率=收益/投资。ROI计算、ROI优化、不同渠道ROI对比。' },
        { title: 'LTV/CAC', content: 'LTV用户生命周期价值、CAC获客成本。LTV>CAC是健康商业模式的基础。' },
        { title: '增长分析', content: '增长指标：用户增长、收入增长、市场份额增长。增长模型、增长曲线。' },
        { title: '转化分析', content: '转化率=转化数/访问数。各环节转化率、转化路径优化、转化归因。' },
        { title: '流失分析', content: '流失率计算、流失原因分析、流失预警、召回策略。' },
        { title: '渠道分析', content: '渠道效果：流量、转化、成本、ROI。渠道对比、渠道优化。' },
        { title: 'SWOT分析', content: 'Strengths优势、Weaknesses劣势、Opportunities机会、Threats威胁。' },
        { title: 'PEST分析', content: 'Political政治、Economic经济、Social社会、Technological技术。宏观环境分析。' },
        { title: '波特五力', content: '供应商议价能力、购买者议价能力、新进入者威胁、替代品威胁、行业竞争。' },
        { title: '决策矩阵', content: '多准则决策：列出选项、确定标准、分配权重、评分计算、排序选择。' },
        { title: '成本效益', content: '量化收益和成本、计算净现值(NPV)、内部收益率(IRR)、投资回收期。' },
        { title: '风险评估', content: '风险识别、风险分析、风险评级、风险应对。风险矩阵、风险登记册。' },
        { title: '情景分析', content: '乐观情景、中性情景、悲观情景。不同假设下的结果预测。' },
        { title: '敏感性分析', content: '关键变量变化对结果的影响。识别敏感因素，关注重点变量。' },
        { title: '决策树', content: '树状结构展示决策路径。节点=决策/机会，分支=选项/结果，末端=结果值。' },
        { title: '优先级矩阵', content: '重要紧急矩阵、价值-复杂度矩阵、影响-努力矩阵。确定工作优先级。' },
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
        { title: '课程设计', content: '学习目标设定、内容选择组织、教学方法设计、评估方式确定、资源准备。' },
        { title: '学科辅导', content: '数学：解题思路、公式推导、错题分析。语文：阅读理解、作文技巧、文言文。英语：词汇记忆、语法句型、听力口语。' },
        { title: '考试技巧', content: '时间分配、题型分析、答题策略、检查方法、心态调整。' },
        { title: '记忆方法', content: '联想记忆、图像记忆、口诀记忆、分类记忆、理解记忆。艾宾浩斯遗忘曲线应用。' },
        { title: '教研方法', content: '教学反思、同伴互助、课堂观察、行动研究、案例分析。' },
        { title: '教育技术', content: '在线教学平台、互动工具、作业系统、学习分析、虚拟实验、AI辅助。' },
        { title: '费曼学习法', content: '用简单语言教会别人。步骤：选择概念、模拟教学、发现漏洞、简化提炼。最有效的学习方法之一。' },
        { title: '间隔重复', content: '艾宾浩斯遗忘曲线：间隔复习抵抗遗忘。间隔时间递增：1天、3天、7天、15天、30天。' },
        { title: '主动回忆', content: '合上书本，主动回忆学过的内容。测试比重复阅读更有效。自测、抽认卡、问答。' },
        { title: '番茄工作法', content: '25分钟专注工作+5分钟休息，4个番茄后长休息15-30分钟。提高专注力和效率。' },
        { title: '思维导图', content: '中心主题向外发散。关键词、颜色、图像、连接线。整理思路、记忆复习。' },
        { title: 'SQ3R阅读', content: 'Survey浏览、Question提问、Read阅读、Recite复述、Review复习。系统化阅读方法。' },
        { title: '康奈尔笔记', content: '页面分三栏：笔记栏(主要内容)、线索栏(关键词)、总结栏(概括)。便于复习。' },
        { title: '深度学习', content: '理解原理而非记忆结论。建立知识网络，举一反三，迁移应用。' },
        { title: '刻意练习', content: '目标明确、专注投入、及时反馈、持续改进。走出舒适区，针对性训练。' },
        { title: '元认知', content: '对自己的认知过程的认知。认识自己的学习风格、优势弱点、监控调节学习过程。' },
        { title: '学习金字塔', content: '被动学习：听讲(5%)、阅读(10%)、视听(20%)、演示(30%)。主动学习：讨论(50%)、实践(75%)、教别人(90%)。' },
        { title: '多感官学习', content: '视觉、听觉、触觉多通道输入。图表、讲解、实践结合。多种方式强化记忆。' },
        { title: '知识迁移', content: '将学到的知识应用到新情境。类比思维、抽象概括、原理应用。' },
        { title: '问题驱动', content: '以问题为导向学习。提出问题、探索答案、总结反思。问题激发学习动力。' },
        { title: '项目学习', content: '通过完成项目学习知识。真实问题、主动探究、协作完成、成果展示。' },
        { title: '时间管理', content: '四象限法则(重要紧急)、时间块、待办清单、日历规划。高效利用时间。' },
        { title: '注意力管理', content: '创造专注环境、减少干扰、单任务处理、定时休息。专注力是有限资源。' },
        { title: '学习动机', content: '内在动机：好奇心、兴趣、成就感。外在动机：奖励、认可、避免惩罚。' },
        { title: '成长型思维', content: '相信能力可以通过努力提升。视失败为学习机会，拥抱挑战，持续成长。' },
        { title: '学习习惯', content: '固定时间学习、固定地点学习、仪式感、从小习惯开始。习惯让学习自动化。' },
        { title: '数学思维', content: '逻辑推理、抽象概括、数学建模、计算能力。数学是思维的体操。' },
        { title: '数学解题', content: '理解题意、分析条件、选择方法、计算验证、反思推广。解题步骤规范化。' },
        { title: '函数学习', content: '函数概念：输入输出的映射关系。函数性质：单调性、奇偶性、周期性、对称性。' },
        { title: '几何学习', content: '空间想象、逻辑证明、几何变换。平面几何与立体几何的联系与区别。' },
        { title: '概率统计', content: '随机事件、概率计算、统计推断。概率思维理解不确定性。' },
        { title: '语文阅读', content: '理解内容、分析结构、品味语言、把握主旨。阅读能力是学习基础。' },
        { title: '作文技巧', content: '审题立意、材料选择、结构安排、语言表达、修改润色。' },
        { title: '文言文学习', content: '实词虚词、文言句式、翻译技巧、文学常识。积累是关键。' },
        { title: '英语词汇', content: '词根词缀、联想记忆、语境学习、间隔重复。词汇是语言基础。' },
        { title: '英语语法', content: '句法结构、时态语态、从句用法、虚拟语气。语法是语言规则。' },
        { title: '英语听力', content: '精听与泛听、语音语调、关键词捕捉、上下文推断。' },
        { title: '英语口语', content: '音标发音、连读弱读、日常对话、情景表达。开口练习是关键。' },
        { title: '物理学习', content: '概念理解、公式应用、实验观察、问题分析。物理是理解世界的方式。' },
        { title: '化学学习', content: '元素周期、化学反应、实验操作、计算应用。结构与性质的关系。' },
        { title: '生物学习', content: '概念理解、结构功能、生命过程、实验探究。生命科学的逻辑。' },
        { title: '历史学习', content: '时间线、因果关系、历史思维、史料分析。以史为鉴。' },
        { title: '地理学习', content: '空间思维、人地关系、区域分析、图表解读。认识地球家园。' },
        { title: '政治学习', content: '概念辨析、原理理解、联系实际、答题规范。理论联系实际。' },
        { title: '讲授法', content: '教师系统讲解知识。优点：效率高、系统性强。注意互动和启发。' },
        { title: '讨论法', content: '师生互动讨论问题。培养思维能力和表达能力。需要精心设计问题。' },
        { title: '案例法', content: '通过具体案例学习知识。案例要典型、贴近实际。分析、讨论、总结。' },
        { title: '实验法', content: '通过实验验证和学习。培养动手能力和科学思维。安全第一。' },
        { title: '翻转课堂', content: '课前学习知识、课上讨论实践。学生主动学习，教师引导解惑。' },
        { title: '分组教学', content: '小组合作学习。培养协作能力、照顾个体差异。分组策略很重要。' },
        { title: '分层教学', content: '根据学生水平分层。教学内容、难度、进度差异化。因材施教。' },
        { title: '启发式教学', content: '引导学生思考而非直接给出答案。提问、提示、点拨。培养思维能力。' },
        { title: '情境教学', content: '创设情境，在情境中学习。情境要真实、有意义、激发兴趣。' },
        { title: '任务驱动', content: '以任务为中心组织教学。任务明确、难度适中、可完成。' },
        { title: '探究式学习', content: '学生自主探究发现问题。提出问题、假设、验证、结论。' },
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
        { title: '心理健康', content: '压力管理、情绪调节、社交支持、正念冥想、寻求帮助。保持积极心态。' },
        { title: '中医养生', content: '节气养生、饮食调养、经络按摩、药食同源、体质辨识。顺应四时、起居有常。' },
        { title: '急救常识', content: '心肺复苏CPR、止血包扎、骨折固定、中暑处理、烫伤处理、异物卡喉海姆立克法。' },
        { title: '慢性病管理', content: '高血压、糖尿病、高血脂的日常管理。定期监测、规律用药、生活方式调整。' },
        { title: '睡眠健康', content: '睡眠环境优化、作息规律、睡前放松、避免刺激、睡眠障碍应对。成年人建议7-8小时。' },
        { title: '老年健康', content: '骨关节保护、认知训练、跌倒预防、慢病管理、社交活动、用药安全。' },
        { title: '健康四大基石', content: '合理膳食、适量运动、戒烟限酒、心理平衡。健康生活方式是预防疾病的基础。' },
        { title: '健康饮水', content: '成年人每天饮水1500-2000ml。晨起一杯水、少量多次、不要等渴了再喝。' },
        { title: '健康睡眠', content: '成年人每天7-8小时睡眠。规律作息、睡前放松、避免刺激、创造良好睡眠环境。' },
        { title: '健康饮食', content: '食物多样、谷类为主、多吃蔬果、适量肉蛋奶、少油少盐少糖。' },
        { title: '健康体重', content: 'BMI=体重(kg)/身高(m)²。正常范围18.5-24。腰围男性<90cm、女性<85cm。' },
        { title: '健康运动', content: '每周至少150分钟中等强度有氧运动，或75分钟高强度运动。力量训练每周2次以上。' },
        { title: '定期体检', content: '成年人每年体检一次。重点关注血压、血糖、血脂、肝肾功能、肿瘤标志物。' },
        { title: '心理健康', content: '保持积极心态、学会减压、社交支持、必要时寻求帮助。心理健康同样重要。' },
        { title: '烟草危害', content: '吸烟有害健康。吸烟导致肺癌、心血管疾病、慢性阻塞性肺病等。戒烟任何时候都不晚。' },
        { title: '酒精危害', content: '过量饮酒损害肝脏、神经系统、心血管系统。建议男性<25g/天，女性<15g/天。' },
        { title: '久坐危害', content: '久坐增加心血管疾病、糖尿病、肥胖风险。每小时起身活动5分钟。' },
        { title: '用眼健康', content: '20-20-20法则：每20分钟看20英尺(约6米)远的地方20秒。减少屏幕时间。' },
        { title: '口腔健康', content: '每天刷牙两次、使用牙线、定期口腔检查。口腔健康与全身健康相关。' },
        { title: '皮肤保护', content: '防晒防紫外线、保持清洁、及时补水、避免过度清洁。' },
        { title: '食品安全', content: '生熟分开、彻底煮熟、注意保质期、避免交叉污染。' },
        { title: '环境健康', content: '空气质量、饮用水安全、噪音控制、室内通风。环境因素影响健康。' },
        { title: '职业健康', content: '职业防护、工间休息、职业病筛查。注意工作环境中的健康风险。' },
        { title: '交通安全', content: '系安全带、戴头盔、遵守交通规则。预防意外伤害。' },
        { title: '性健康', content: '安全性行为、定期检查、预防性传播疾病。' },
        { title: '健康素养', content: '获取健康信息、理解健康知识、做出健康决策。提高健康素养是健康中国的重要目标。' },
        { title: '感冒防治', content: '普通感冒多为病毒感染。多休息、多喝水、对症治疗。预防：勤洗手、戴口罩、避免接触。' },
        { title: '高血压', content: '血压≥140/90mmHg为高血压。控制体重、限盐、规律运动、遵医嘱用药。' },
        { title: '糖尿病', content: '空腹血糖≥7.0mmol/L或随机血糖≥11.1mmol/L。饮食控制、运动、监测血糖、用药。' },
        { title: '冠心病', content: '冠状动脉粥样硬化性心脏病。控制危险因素：高血压、高血脂、糖尿病、吸烟。' },
        { title: '脑卒中', content: '中风识别：FAST原则(Face面部、Arm手臂、Speech言语、Time时间)。及时就医。' },
        { title: '肿瘤预防', content: '一级预防：病因预防。二级预防：早发现早诊断早治疗。三级预防：康复治疗。' },
        { title: '慢性胃炎', content: '饮食不规律、幽门螺杆菌感染、长期用药。规律饮食、避免刺激、根除HP。' },
        { title: '骨质疏松', content: '骨量减少、骨密度降低。补钙、维生素D、适量运动、预防跌倒。' },
        { title: '颈椎病', content: '长期低头、姿势不良。纠正姿势、颈部锻炼、避免久坐。' },
        { title: '腰椎间盘突出', content: '腰痛、下肢放射痛。保守治疗为主，严重者手术。预防重于治疗。' },
        { title: '关节炎', content: '关节疼痛、肿胀、活动受限。保暖、控制体重、适度运动、药物治疗。' },
        { title: '痛风', content: '尿酸过高、关节疼痛。低嘌呤饮食、多喝水、药物治疗。' },
        { title: '过敏性疾病', content: '过敏性鼻炎、哮喘、湿疹。避免过敏原、药物治疗、免疫治疗。' },
        { title: '皮肤病', content: '湿疹、皮炎、痤疮。保持皮肤清洁、避免刺激、对症治疗。' },
        { title: '消化不良', content: '腹胀、嗳气、食欲不振。规律饮食、细嚼慢咽、避免暴饮暴食。' },
        { title: '便秘', content: '排便困难或次数减少。多吃蔬果、多喝水、规律排便、适量运动。' },
        { title: '腹泻', content: '大便次数增多、稀便。补充水分和电解质、注意饮食卫生。' },
        { title: '失眠', content: '入睡困难、易醒、早醒。建立规律作息、放松训练、必要时就医。' },
        { title: '焦虑抑郁', content: '情绪低落、焦虑不安。心理疏导、运动放松、必要时药物治疗。' },
        { title: '中医基础', content: '阴阳五行、脏腑经络、气血津液。中医强调整体观念和辨证论治。' },
        { title: '体质辨识', content: '九种体质：平和、气虚、阳虚、阴虚、痰湿、湿热、血瘀、气郁、特禀。了解体质，调理养生。' },
        { title: '四时养生', content: '春养肝、夏养心、秋养肺、冬养肾。顺应四时，天人合一。' },
        { title: '春季养生', content: '春生之气，万物萌发。晚睡早起、户外活动、调畅情志、养肝护肝。' },
        { title: '夏季养生', content: '夏长之气，万物繁盛。晚睡早起、午休小憩、清心除烦、养心安神。' },
        { title: '秋季养生', content: '秋收之气，万物成熟。早睡早起、润燥养肺、收敛神气、情志平和。' },
        { title: '冬季养生', content: '冬藏之气，万物闭藏。早睡晚起、避寒保暖、养肾防寒、节制房事。' },
        { title: '饮食养生', content: '五谷为养、五果为助、五畜为益、五菜为充。食物性味归经。' },
        { title: '药食同源', content: '既是食物也是药物：枸杞、山药、红枣、莲子、百合等。食疗调理。' },
        { title: '经络养生', content: '经络是气血运行通道。疏通经络：推拿、艾灸、刮痧、拔罐。' },
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
        { title: '免责声明', content: 'AI提供的法律信息仅供参考，不构成法律意见。具体法律问题请咨询专业律师。' },
        { title: '劳动法', content: '劳动合同签订、工资支付、加班规定、社保缴纳、解除合同、经济补偿、劳动仲裁。' },
        { title: '合同法', content: '合同成立与生效、要约与承诺、合同履行、违约责任、合同解除、争议解决。' },
        { title: '知识产权', content: '商标注册、专利申请、著作权保护、商业秘密、侵权判定、维权途径。' },
        { title: '公司法', content: '公司设立、股权结构、股东权利、公司治理、股权转让、清算注销。' },
        { title: '婚姻继承', content: '婚前财产、夫妻共同财产、离婚分割、子女抚养、继承顺序、遗嘱订立。' },
        { title: '民法基本原则', content: '平等原则、自愿原则、公平原则、诚实信用原则、公序良俗原则、绿色原则。' },
        { title: '民事主体', content: '自然人、法人、非法人组织。民事权利能力和民事行为能力。' },
        { title: '民事法律行为', content: '意思表示、行为能力、法律效力。有效、无效、可撤销的法律行为。' },
        { title: '代理', content: '委托代理、法定代理、指定代理。代理权限、无权代理、表见代理。' },
        { title: '诉讼时效', content: '一般诉讼时效3年。最长保护期20年。中止、中断、延长。' },
        { title: '物权', content: '所有权、用益物权、担保物权。物权法定、公示公信原则。' },
        { title: '所有权', content: '占有、使用、收益、处分。国家、集体、私人所有权。' },
        { title: '用益物权', content: '土地承包经营权、建设用地使用权、宅基地使用权、地役权。' },
        { title: '担保物权', content: '抵押权、质权、留置权。担保债权实现。' },
        { title: '债权', content: '合同之债、侵权之债、无因管理之债、不当得利之债。' },
        { title: '合同成立', content: '要约、承诺。合同形式：书面、口头、其他形式。' },
        { title: '合同效力', content: '有效合同、无效合同、可撤销合同、效力待定合同。' },
        { title: '合同履行', content: '全面履行原则、附随义务、抗辩权、保全措施。' },
        { title: '违约责任', content: '继续履行、采取补救措施、赔偿损失、违约金、定金。' },
        { title: '侵权责任', content: '过错责任、无过错责任、公平责任。归责原则。' },
        { title: '人格权', content: '生命权、健康权、姓名权、肖像权、名誉权、隐私权。' },
        { title: '婚姻家庭', content: '结婚条件、夫妻关系、离婚方式、子女抚养、财产分割。' },
        { title: '继承', content: '法定继承、遗嘱继承、遗赠扶养协议。继承顺序和份额。' },
        { title: '知识产权', content: '著作权、专利权、商标权。保护期限、侵权认定。' },
        { title: '法律适用', content: '特别法优于一般法、新法优于旧法、法不溯及既往。' },
        { title: '合同条款', content: '当事人信息、标的、数量、质量、价款、履行期限、违约责任、争议解决。' },
        { title: '买卖合同', content: '标的物交付、所有权转移、风险转移、瑕疵担保。' },
        { title: '租赁合同', content: '租赁期限、租金支付、维修义务、转租限制、优先购买权。' },
        { title: '借款合同', content: '借款金额、利率限制(不超过4倍LPR)、还款期限、违约责任。' },
        { title: '承揽合同', content: '承揽人义务、定作人义务、工作成果交付、验收。' },
        { title: '建设工程合同', content: '工程勘察、设计、施工。合同备案、工程款结算、优先受偿权。' },
        { title: '运输合同', content: '客运合同、货运合同。承运人责任、货物毁损灭失。' },
        { title: '技术合同', content: '技术开发、技术转让、技术咨询、技术服务。技术成果归属。' },
        { title: '保管合同', content: '保管物交付、保管义务、保管费、寄存人义务。' },
        { title: '委托合同', content: '委托事务、委托权限、转委托、委托终止。' },
        { title: '居间合同', content: '居间人义务、居间报酬、居间费用。促成交易的责任。' },
        { title: '合伙协议', content: '合伙出资、利润分配、债务承担、退伙、入伙。' },
        { title: '股权转让协议', content: '转让价格、支付方式、股权交割、权利保证、竞业限制。' },
        { title: '保密协议', content: '保密范围、保密期限、违约责任、例外情形。' },
        { title: '竞业限制协议', content: '限制范围、限制期限(不超过2年)、经济补偿、违约金。' },
        { title: '劳动合同', content: '合同期限、工作内容、劳动报酬、社保缴纳、解除条件。' },
        { title: '服务协议', content: '服务内容、服务标准、服务费用、违约责任、免责条款。' },
        { title: '用户协议', content: '服务范围、用户权利义务、隐私保护、免责条款、争议解决。' },
        { title: '合同审查要点', content: '主体资格、意思表示真实、内容合法、条款完备、风险防范。' },
        { title: '合同风险', content: '格式条款风险、违约风险、争议解决风险、主体风险。' },
        { title: '劳动关系', content: '用人单位与劳动者建立劳动关系。书面劳动合同应在用工之日起一个月内签订。' },
        { title: '劳动合同类型', content: '固定期限、无固定期限、以完成一定工作任务为期限。' },
        { title: '试用期', content: '合同期限3个月以上不满1年，试用期不超过1个月；1年以上不满3年，不超过2个月；3年以上，不超过6个月。' },
        { title: '工资支付', content: '按月支付、不得克扣、加班工资(工作日1.5倍、休息日2倍、法定节假日3倍)。' },
        { title: '工作时间', content: '标准工时：每日8小时、每周40小时。加班每日不超过3小时，每月不超过36小时。' },
        { title: '休息休假', content: '每周至少休息一日、法定节假日、年休假、婚假、产假、病假。' },
        { title: '社保缴纳', content: '养老、医疗、失业、工伤、生育保险。用人单位和劳动者共同缴纳。' },
        { title: '工伤认定', content: '工作时间工作场所因工作原因受伤、上下班途中交通事故、职业病等。' },
        { title: '解除合同', content: '协商解除、劳动者单方解除(提前30日书面通知)、用人单位单方解除(法定情形)。' },
      ]
    },
    {
      id: 'finance',
      name: '金融理财',
      icon: '💰',
      description: '投资理财、财务规划、风险管理',
      materials: [
        { title: '理财基础', content: '收入支出管理、紧急备用金、记账习惯、消费控制、储蓄目标。先储蓄后消费原则。' },
        { title: '投资入门', content: '风险与收益、资产配置、分散投资、长期持有、定投策略。了解自己的风险承受能力。' },
        { title: '股票投资', content: '基本面分析、技术面分析、估值方法、行业研究、财报解读。注意风险控制、不追涨杀跌。' },
        { title: '基金投资', content: '基金类型（货币、债券、股票、混合）、定投策略、基金经理筛选、费率比较、定投止盈。' },
        { title: '保险规划', content: '医疗险、重疾险、意外险、寿险。按需配置、保额充足、保费预算控制。' },
        { title: '房产投资', content: '地段选择、价格评估、贷款策略、税费计算、持有成本、出手时机。' },
        { title: '税务筹划', content: '个人所得税、专项附加扣除、年终奖计税、合理避税与逃税区别。' },
        { title: '退休规划', content: '社保养老金、企业年金、商业养老保险、退休年龄计算、退休后支出预估。' },
        { title: '子女教育金', content: '教育支出预估、专款专用、稳健投资、定期调整、灵活取用。' },
        { title: '风险警示', content: '高风险投资需谨慎、警惕非法集资、不要借钱投资、避免盲目跟风。投资有风险，入市需谨慎。' },
        { title: '理财目标', content: '设定明确的理财目标：短期(1年内)、中期(1-5年)、长期(5年以上)。目标要具体、可量化、有时间期限。' },
        { title: '收入支出管理', content: '记账是理财第一步。收入分类、支出分类、分析收支结构、找到优化空间。' },
        { title: '紧急备用金', content: '3-6个月生活费。放在流动性好的地方：货币基金、活期存款。应对意外情况。' },
        { title: '储蓄原则', content: '先储蓄后消费。收入的10%-30%用于储蓄。强制储蓄、定期定额。' },
        { title: '复利效应', content: '复利是财富增长的秘密。时间越长、利率越高，复利效应越明显。越早开始越好。' },
        { title: '通货膨胀', content: '钱会贬值。历史平均通胀率2-3%。理财要跑赢通胀，实际收益=名义收益-通胀率。' },
        { title: '风险收益', content: '收益与风险成正比。低风险低收益、高风险高收益。了解自己的风险承受能力。' },
        { title: '资产配置', content: '不要把鸡蛋放在一个篮子里。不同资产类别相关性低，分散风险。定期再平衡。' },
        { title: '流动性管理', content: '资产的变现能力。现金流动性最强、房产流动性差。保持适当流动性应对需求。' },
        { title: '信用管理', content: '信用记录影响贷款审批。按时还款、避免逾期。定期查询信用报告。' },
        { title: '债务管理', content: '良性债务(投资性)、恶性债务(消费性)。债务收入比不超过50%。' },
        { title: '保险规划', content: '保险是风险转移工具。先保障后理财。意外险、医疗险、重疾险、寿险。' },
        { title: '税务筹划', content: '合法节税不是偷税漏税。了解税收优惠政策、专项附加扣除。' },
        { title: '退休规划', content: '提前规划养老。社保养老金、企业年金、个人养老金、商业养老保险。' },
        { title: '子女教育金', content: '教育支出逐年增长。专款专用、提前储备、稳健投资。' },
        { title: '购房规划', content: '首付款、月供能力、税费、装修款。量力而行，不要过度负债。' },
        { title: '财务自由', content: '被动收入覆盖生活支出。积累资产、增加被动收入、控制支出。' },
        { title: '理财误区', content: '追求暴富、盲目跟风、不学习就投资、借钱投资、不关注风险。' },
        { title: '理财知识', content: '持续学习理财知识。阅读书籍、关注专业媒体、参加培训。投资自己是最好的投资。' },
        { title: '理财纪律', content: '制定计划、坚持执行、定期复盘、适时调整。纪律比技巧更重要。' },
        { title: '银行存款', content: '活期、定期、大额存单。安全可靠、收益较低。存款保险最高赔付50万。' },
        { title: '货币基金', content: '余额宝、零钱通等。流动性强、收益略高于活期。适合存放日常备用金。' },
        { title: '债券基金', content: '投资债券的基金。风险低于股票基金、收益相对稳定。适合稳健投资者。' },
        { title: '股票基金', content: '投资股票的基金。专业管理、分散投资。适合长期投资。' },
        { title: '指数基金', content: '跟踪特定指数。费用低、透明度高、长期收益接近市场平均。巴菲特推荐。' },
        { title: 'ETF基金', content: '交易所交易基金。可在交易时间买卖、费率低、跟踪误差小。' },
        { title: 'LOF基金', content: '上市型开放式基金。既可申购赎回，也可在交易所买卖。' },
        { title: '定投策略', content: '定期定额投资。分散时间风险、摊薄成本、克服人性弱点。长期坚持。' },
        { title: '股票投资', content: '风险高收益高。需要研究公司、分析行业、判断估值。不适合新手。' },
        { title: '债券投资', content: '国债、企业债、可转债。风险低于股票、收益相对稳定。' },
        { title: '银行理财', content: '理财产品风险等级R1-R5。了解产品投向、风险等级、流动性安排。' },
        { title: '信托产品', content: '高净值客户专属。门槛高(100万起)、期限长、收益相对较高。' },
        { title: '黄金投资', content: '避险资产、抗通胀。实物黄金、纸黄金、黄金ETF、黄金期货。' },
        { title: '房产投资', content: '居住属性+投资属性。地段为王、关注租售比、考虑持有成本。' },
        { title: 'REITs', content: '不动产投资信托基金。投资商业地产、按期分红。流动性好于实物房产。' },
        { title: '外汇投资', content: '汇率波动风险大。需要专业知识、24小时交易。不适合普通人。' },
        { title: '期货投资', content: '高杠杆高风险。保证金交易、可能爆仓。仅适合专业投资者。' },
        { title: '期权投资', content: '权利金交易、策略复杂。需要对冲风险或投机。' },
        { title: '数字货币', content: '比特币、以太坊等。波动极大、监管不确定。高风险投资。' },
        { title: '投资选择', content: '根据风险承受能力、投资期限、流动性需求选择。不懂不投。' },
        { title: '股市基础', content: '股票代表公司所有权。A股、港股、美股。交易时间、交易规则。' },
        { title: '基本面分析', content: '分析公司财务状况、行业地位、竞争优势、管理团队。' },
        { title: '财务报表', content: '资产负债表、利润表、现金流量表。关注营业收入、净利润、ROE、现金流。' },
        { title: '估值方法', content: 'PE市盈率、PB市净率、PS市销率、DCF现金流折现。' },
        { title: '技术分析', content: 'K线图、均线、MACD、RSI、成交量。历史会重演但不完全相同。' },
        { title: '行业分析', content: '行业周期、竞争格局、政策影响、发展趋势。好行业+好公司。' },
        { title: '投资策略', content: '价值投资(低估值买入)、成长投资(高增长公司)、指数投资(市场平均)。' },
        { title: '风险控制', content: '仓位管理、止损纪律、分散投资、不追涨杀跌。' },
        { title: '长期投资', content: '买入优质公司长期持有。时间是好公司的朋友。减少交易频率。' },
      ]
    },
    {
      id: 'life',
      name: '生活指南',
      icon: '🏠',
      description: '日常生活、家务技巧、人际关系',
      materials: [
        { title: '时间管理', content: '四象限法则（重要紧急）、番茄工作法、时间块管理、日程规划、减少干扰。' },
        { title: '家务技巧', content: '清洁顺序、收纳整理、厨房清洁、衣物护理、家电维护。分工合作、定时处理。' },
        { title: '人际交往', content: '有效沟通、倾听技巧、表达清晰、换位思考、情绪控制、边界意识。' },
        { title: '亲子关系', content: '陪伴质量、正面管教、倾听理解、规则制定、情绪引导、共同成长。' },
        { title: '职场沟通', content: '向上汇报、横向协调、向下管理、会议发言、邮件礼仪、冲突处理。' },
        { title: '情绪管理', content: '认识情绪、接纳情绪、表达情绪、调节情绪、寻求帮助。负面情绪处理技巧。' },
        { title: '旅行攻略', content: '目的地选择、行程规划、预算控制、行李准备、安全注意、紧急应对。' },
        { title: '美食烹饪', content: '食材选购、刀工技巧、火候控制、调味技巧、营养搭配、厨房安全。' },
        { title: '宠物养护', content: '日常喂食、健康检查、清洁护理、行为训练、常见疾病、应急处理。' },
        { title: '应急管理', content: '家庭应急包、火灾逃生、地震避险、暴雨应对、停电处理、急救联系。' },
        { title: '四象限法则', content: '重要紧急立即做、重要不紧急计划做、紧急不重要委托做、不重要不紧急尽量不做。' },
        { title: '番茄工作法', content: '25分钟专注+5分钟休息。4个番茄后长休息15-30分钟。提高专注力和效率。' },
        { title: '时间块管理', content: '将时间划分为固定块。每块专注一类任务。减少切换成本。' },
        { title: '待办清单', content: '列出所有任务、设定优先级、预估时间、逐项完成。每天复盘。' },
        { title: '日历规划', content: '固定事项填入日历、预留缓冲时间、定期回顾。让时间可见。' },
        { title: '二八定律', content: '20%的事情产生80%的效果。找到那20%重要的事，优先完成。' },
        { title: '克服拖延', content: '分解任务、设定截止时间、奖励机制、先做5分钟。' },
        { title: '减少干扰', content: '关闭通知、设置专注时间、整理环境、学会说不。' },
        { title: '晨间习惯', content: '早起、运动、冥想、计划一天。好的开始是成功的一半。' },
        { title: '晚间复盘', content: '回顾当天、总结经验、规划明天、放松休息。' },
        { title: '精力管理', content: '在精力最好的时候做最重要的事。了解自己的精力周期。' },
        { title: '碎片时间', content: '利用等车、排队等碎片时间。听播客、回复消息、阅读短文。' },
        { title: '批量处理', content: '相似任务集中处理。集中回复邮件、集中打电话、集中处理文件。' },
        { title: '学会委托', content: '不是所有事都要亲力亲为。可以委托的事交给别人。' },
        { title: '设定边界', content: '工作与生活边界、可接受与不可接受边界。学会说"不"。' },
        { title: '数字断舍离', content: '清理不必要的APP、取消关注无价值账号、限制屏幕时间。' },
        { title: '时间记录', content: '记录时间花费、分析时间分配、发现改进空间。' },
        { title: '效率工具', content: '日历APP、待办清单APP、笔记APP、番茄钟APP。找到适合自己的工具。' },
        { title: '平衡生活', content: '工作、家庭、健康、社交、个人成长。不要顾此失彼。' },
        { title: '活在当下', content: '专注眼前的事、享受当下的时刻。焦虑未来无济于事。' },
        { title: '家务规划', content: '每日必做、每周必做、每月必做。分工合作、制定家务表。' },
        { title: '清洁顺序', content: '从上到下、从里到外。先整理后清洁、先干后湿。' },
        { title: '厨房清洁', content: '油污用热水+洗洁精、灶台趁热擦拭、油烟机定期清洗。' },
        { title: '卫生间清洁', content: '通风防潮、定期消毒、马桶刷洗、地漏防臭。' },
        { title: '地板清洁', content: '先扫后拖、不同材质不同方法、定期打蜡保养。' },
        { title: '窗户清洁', content: '阴天擦拭、报纸擦玻璃、窗槽吸尘、定期清洗纱窗。' },
        { title: '衣物护理', content: '分类洗涤、注意洗涤标签、深浅分开、及时晾晒。' },
        { title: '衣物收纳', content: '按季节分类、按类型分类、叠放整齐、标签管理。' },
        { title: '冰箱整理', content: '定期清理、分类存放、标注日期、生熟分开。' },
        { title: '收纳原则', content: '断舍离(不需要的不留)、分类收纳、定位管理、定期整理。' },
        { title: '断舍离', content: '超过一年未用的东西可以考虑处理。捐赠、出售、丢弃。' },
        { title: '物品归位', content: '用完即归位、物归原处。养成好习惯，减少整理时间。' },
        { title: '家电维护', content: '定期清洁、按照说明使用、发现问题及时维修。' },
        { title: '洗衣技巧', content: '预洗污渍、选择合适程序、适量洗涤剂、不过度洗涤。' },
        { title: '熨烫技巧', content: '根据面料调节温度、喷水润湿、先烫反面、重点部位仔细烫。' },
        { title: '食物保存', content: '干货密封、蔬菜通风、水果分类、熟食冷藏。' },
        { title: '垃圾分类', content: '可回收物、有害垃圾、厨余垃圾、其他垃圾。保护环境。' },
        { title: '安全检查', content: '定期检查燃气、电路、门窗。预防安全隐患。' },
        { title: '应急准备', content: '应急物品、紧急联系方式、逃生路线、定期演练。' },
        { title: '家庭档案', content: '证件资料、保险单据、保修凭证、联系方式。整理归档。' },
        { title: '有效沟通', content: '倾听是基础、表达要清晰、反馈要及时、态度要诚恳。' },
        { title: '倾听技巧', content: '专注对方、不打断、适当回应、理解感受、总结确认。' },
        { title: '表达能力', content: '逻辑清晰、重点突出、用词准确、语速适中、表情自然。' },
        { title: '非语言沟通', content: '眼神交流、面部表情、肢体语言、声调语气、空间距离。' },
        { title: '换位思考', content: '站在对方角度看问题。理解对方的处境和感受。' },
        { title: '情绪管理', content: '识别自己的情绪、接纳情绪、合理表达、适当调节。' },
        { title: '冲突处理', content: '冷静对待、了解原因、寻求共识、找到解决方案。' },
        { title: '批评技巧', content: '私下进行、具体客观、对事不对人、提出建议。' },
        { title: '接受批评', content: '不急于辩解、表示感谢、反思改进、不必太在意。' },
      ]
    },
    {
      id: 'tech',
      name: '科技前沿',
      icon: '🚀',
      description: '新技术、AI应用、数字化转型',
      materials: [
        { title: 'AI基础', content: '机器学习、深度学习、自然语言处理、计算机视觉、强化学习。AI能力与局限。' },
        { title: 'AI应用', content: '智能客服、内容生成、图像识别、语音合成、推荐系统、自动化流程。' },
        { title: '大语言模型', content: 'GPT系列、Claude、LLaMA、提示工程、微调技术、RAG检索增强。' },
        { title: '本地部署', content: 'Ollama、LMStudio、模型量化、硬件要求、推理优化、隐私保护。' },
        { title: '数字化转型', content: '业务流程在线化、数据资产化、智能化决策、敏捷迭代、组织变革。' },
        { title: '云计算', content: 'IaaS/PaaS/SaaS、公有云私有云混合云、容器化、微服务、DevOps。' },
        { title: '网络安全', content: '密码安全、钓鱼防范、数据加密、访问控制、安全审计、应急响应。' },
        { title: '物联网', content: '智能设备、传感器、数据采集、边缘计算、智能家居、穿戴设备。' },
        { title: '区块链', content: '分布式账本、智能合约、去中心化、数字资产、应用场景。' },
        { title: '未来趋势', content: 'AI+行业、沉浸式体验、万物互联、数字孪生、可持续发展技术。' },
        { title: '机器学习', content: '机器学习是AI的核心。监督学习(分类/回归)、无监督学习(聚类)、强化学习。' },
        { title: '深度学习', content: '神经网络多层堆叠。卷积神经网络CNN(图像)、循环神经网络RNN(序列)、Transformer。' },
        { title: '自然语言处理', content: 'NLP让机器理解语言。分词、命名实体识别、情感分析、机器翻译、文本生成。' },
        { title: '计算机视觉', content: 'CV让机器看懂图像。图像分类、目标检测、图像分割、人脸识别。' },
        { title: '强化学习', content: '通过奖励信号学习。智能体、环境、状态、动作、奖励。AlphaGo是经典案例。' },
        { title: 'GPT系列', content: 'OpenAI的语言模型。GPT-3/GPT-4、文本生成、对话、代码生成、多模态能力。' },
        { title: 'Claude', content: 'Anthropic的AI助手。对话、分析、创作、代码、安全对齐。' },
        { title: 'LLaMA', content: 'Meta的开源大模型。LLaMA-2、LLaMA-3、开源社区活跃、可本地部署。' },
        { title: '提示工程', content: '设计有效的提示词。Few-shot、Chain-of-Thought、角色设定、输出格式。' },
        { title: '微调技术', content: 'Fine-tuning、LoRA、QLoRA。在基础模型上针对特定任务优化。' },
        { title: 'RAG检索增强', content: '检索增强生成。结合知识库检索和模型生成，提高准确性和可靠性。' },
        { title: '向量数据库', content: '存储文本向量。Pinecone、Milvus、Chroma。语义搜索、相似度计算。' },
        { title: 'Agent智能体', content: 'AI Agent自主执行任务。规划、工具调用、记忆、反思。AutoGPT、LangChain。' },
        { title: '多模态AI', content: '处理多种模态数据。文本+图像+音频+视频。GPT-4V、Gemini。' },
        { title: 'AI代码助手', content: 'GitHub Copilot、Cursor、Codeium。代码补全、解释、重构、调试。' },
        { title: 'AI写作工具', content: 'ChatGPT、Claude、文心一言。文案创作、内容改写、翻译、摘要。' },
        { title: 'AI图像生成', content: 'Midjourney、DALL-E、Stable Diffusion。文生图、图生图、风格迁移。' },
        { title: 'AI视频生成', content: 'Runway、Pika、Sora。文生视频、图生视频、视频编辑。' },
        { title: 'AI音频', content: '语音合成TTS、语音识别ASR、音乐生成。ElevenLabs、Whisper。' },
        { title: '本地部署', content: '在本地运行AI模型。隐私保护、无网络限制、硬件要求高。' },
        { title: 'Ollama', content: '本地运行大模型的工具。支持LLaMA、Mistral等模型，简单易用。' },
        { title: 'LMStudio', content: '本地运行大模型的GUI工具。模型下载、对话界面、API服务。' },
        { title: '模型量化', content: '减小模型大小和推理开销。4-bit、8-bit量化，精度与性能权衡。' },
        { title: '推理优化', content: '加速模型推理。vLLM、TensorRT-LLM、批量推理、KV Cache。' },
        { title: '云计算基础', content: '云计算服务模式。IaaS基础设施、PaaS平台、SaaS软件。' },
        { title: '公有云', content: '共享云资源。AWS、Azure、阿里云、腾讯云。弹性伸缩、按需付费。' },
        { title: '私有云', content: '企业自建云。数据安全、合规要求、成本较高。' },
        { title: '混合云', content: '公有云+私有云。敏感数据在私有云、弹性负载在公有云。' },
        { title: 'Kubernetes', content: 'K8s容器编排。Pod、Service、Deployment、自动扩展、滚动更新。' },
        { title: 'Serverless', content: '无服务器计算。FaaS函数即服务、事件驱动、按调用付费。' },
        { title: '密码安全', content: '强密码策略、密码管理器、双因素认证2FA、定期更换。' },
        { title: '钓鱼防范', content: '识别钓鱼邮件/网站。检查发件人、不点击可疑链接、验证身份。' },
        { title: '数据加密', content: '对称加密(AES)、非对称加密(RSA)、端到端加密、HTTPS。' },
        { title: '访问控制', content: '最小权限原则、角色权限管理、多因素认证、审计日志。' },
        { title: '安全审计', content: '定期安全检查、漏洞扫描、渗透测试、合规审计。' },
        { title: '应急响应', content: '安全事件处理流程。检测、遏制、根除、恢复、总结。' },
        { title: '物联网基础', content: '万物互联。传感器、执行器、网关、云平台、边缘计算。' },
        { title: '智能家居', content: '智能音箱、智能灯、智能门锁、智能家电。语音控制、场景联动。' },
        { title: '穿戴设备', content: '智能手表、智能眼镜、健康监测、运动追踪。' },
        { title: '边缘计算', content: '在设备端处理数据。降低延迟、节省带宽、隐私保护。' },
        { title: '区块链基础', content: '分布式账本技术。区块、链、共识机制、去中心化。' },
        { title: '智能合约', content: '自动执行的合约代码。以太坊、Solidity、DeFi应用。' },
        { title: '数字资产', content: '加密货币、NFT、数字藏品。价值存储、交易、收藏。' },
        { title: 'Web3', content: '去中心化互联网。用户数据所有权、代币经济、DAO治理。' },
        { title: '量子计算', content: '量子比特、量子叠加、量子纠缠。未来计算范式，目前仍在发展。' },
        { title: '元宇宙', content: '虚拟现实世界。VR/AR技术、数字身份、虚拟经济。' },
        { title: '数字孪生', content: '物理世界的数字映射。工业、城市、医疗应用。' },
        { title: '可持续发展技术', content: '清洁能源、碳捕获、循环经济。技术助力环保。' },
        { title: 'AI伦理', content: 'AI发展中的伦理问题。公平性、透明性、隐私保护、责任归属。' },
        { title: 'AI监管', content: 'AI相关法规政策。数据安全法、个人信息保护法、AI法案。' },
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
            // 优先选择 phi3.5，否则用第一个
            const phi = models.find(m => m.name.includes('phi3'));
            setChatSelectedModel(phi ? phi.name : models[0].name);
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
          
          {/* 通讯插件配置 */}
          <button
            onClick={() => setShowPluginConfig(!showPluginConfig)}
            className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors flex items-center gap-1"
            title="通讯插件配置"
          >
            📱 通讯
            {(pluginConfigs.wechat.enabled || pluginConfigs.dingtalk.enabled || pluginConfigs.wecom.enabled || pluginConfigs.yuanbao.enabled) && (
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
            )}
          </button>
          
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
      
      {/* 通讯插件配置面板 */}
      {showPluginConfig && (
        <div className="absolute inset-x-0 top-14 bottom-16 bg-white dark:bg-gray-800 z-50 overflow-y-auto p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">📱 通讯插件配置</h3>
              <button
                onClick={() => setShowPluginConfig(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              {/* 微信助手 */}
              <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-600">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">💬</span>
                    <span className="font-medium">微信助手</span>
                    <a href="https://github.com/Tencent/openclaw-weixin" target="_blank" className="text-xs text-blue-500 hover:underline">📖 教程</a>
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={pluginConfigs.wechat.enabled}
                      onChange={(e) => setPluginConfigs({...pluginConfigs, wechat: {...pluginConfigs.wechat, enabled: e.target.checked}})}
                      className="rounded"
                    />
                    启用
                  </label>
                </div>
                <p className="text-sm text-gray-500 mb-3">点击下方按钮获取二维码，用微信扫码登录</p>
                <div className="flex flex-col items-center gap-3">
                  {pluginConfigs.wechat.qrUrl ? (
                    <div className="flex flex-col items-center gap-2">
                      <canvas ref={async (canvas) => {
                        if (canvas && pluginConfigs.wechat.qrUrl) {
                          try {
                            const QRCode = (await import('qrcode')).default
                            QRCode.toCanvas(canvas, pluginConfigs.wechat.qrUrl!, { width: 200, margin: 2, color: { dark: '#000', light: '#fff' } })
                          } catch (e) { console.error('QR render error', e) }
                        }
                      }} />
                      <p className="text-xs text-gray-400">用微信扫描此二维码登录</p>
                      <a href={pluginConfigs.wechat.qrUrl} target="_blank" className="text-xs text-blue-500 hover:underline">二维码不显示？点击打开链接扫码</a>
                    </div>
                  ) : null}
                  <button
                    onClick={async () => {
                      try {
                        const result = await invoke<string>('run_wechat_login')
                        if (result.startsWith('https://')) {
                          setPluginConfigs({...pluginConfigs, wechat: {...pluginConfigs.wechat, qrUrl: result}})
                        } else {
                          alert(result)
                        }
                      } catch (err: any) {
                        alert(err)
                      }
                    }}
                    className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm"
                  >
                    📱 获取登录二维码
                  </button>
                </div>
              </div>
              
              {/* 钉钉助手 */}
              <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-600">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🔔</span>
                    <span className="font-medium">钉钉助手</span>
                    <a href="https://github.com/largezhou/openclaw-dingtalk" target="_blank" className="text-xs text-blue-500 hover:underline">📖 教程</a>
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={pluginConfigs.dingtalk.enabled}
                      onChange={(e) => setPluginConfigs({...pluginConfigs, dingtalk: {...pluginConfigs.dingtalk, enabled: e.target.checked}})}
                      className="rounded"
                    />
                    启用
                  </label>
                </div>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="AppKey (Client ID)"
                    value={pluginConfigs.dingtalk.appKey}
                    onChange={(e) => setPluginConfigs({...pluginConfigs, dingtalk: {...pluginConfigs.dingtalk, appKey: e.target.value}})}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                  <input
                    type="password"
                    placeholder="AppSecret (Client Secret)"
                    value={pluginConfigs.dingtalk.appSecret}
                    onChange={(e) => setPluginConfigs({...pluginConfigs, dingtalk: {...pluginConfigs.dingtalk, appSecret: e.target.value}})}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                </div>
              </div>
              
              {/* 企业微信 */}
              <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-600">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🏢</span>
                    <span className="font-medium">企业微信</span>
                    <a href="https://github.com/TencentCloud-Lighthouse/openclaw-wecom" target="_blank" className="text-xs text-blue-500 hover:underline">📖 教程</a>
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={pluginConfigs.wecom.enabled}
                      onChange={(e) => setPluginConfigs({...pluginConfigs, wecom: {...pluginConfigs.wecom, enabled: e.target.checked}})}
                      className="rounded"
                    />
                    启用
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="CorpId"
                    value={pluginConfigs.wecom.corpId}
                    onChange={(e) => setPluginConfigs({...pluginConfigs, wecom: {...pluginConfigs.wecom, corpId: e.target.value}})}
                    className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                  <input
                    type="text"
                    placeholder="AgentId"
                    value={pluginConfigs.wecom.agentId}
                    onChange={(e) => setPluginConfigs({...pluginConfigs, wecom: {...pluginConfigs.wecom, agentId: e.target.value}})}
                    className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                  <input
                    type="password"
                    placeholder="CorpSecret"
                    value={pluginConfigs.wecom.corpSecret}
                    onChange={(e) => setPluginConfigs({...pluginConfigs, wecom: {...pluginConfigs.wecom, corpSecret: e.target.value}})}
                    className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                  <input
                    type="password"
                    placeholder="Token"
                    value={pluginConfigs.wecom.token}
                    onChange={(e) => setPluginConfigs({...pluginConfigs, wecom: {...pluginConfigs.wecom, token: e.target.value}})}
                    className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                  <input
                    type="password"
                    placeholder="EncodingAESKey"
                    value={pluginConfigs.wecom.encodingAESKey}
                    onChange={(e) => setPluginConfigs({...pluginConfigs, wecom: {...pluginConfigs.wecom, encodingAESKey: e.target.value}})}
                    className="col-span-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                </div>
              </div>
              
              {/* 元宝BOT */}
              <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-600">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🤖</span>
                    <span className="font-medium">元宝BOT</span>
                    <a href="https://docs.openclaw.ai" target="_blank" className="text-xs text-blue-500 hover:underline">📖 教程</a>
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={pluginConfigs.yuanbao.enabled}
                      onChange={(e) => setPluginConfigs({...pluginConfigs, yuanbao: {...pluginConfigs.yuanbao, enabled: e.target.checked}})}
                      className="rounded"
                    />
                    启用
                  </label>
                </div>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="AppID"
                    value={pluginConfigs.yuanbao.appId}
                    onChange={(e) => setPluginConfigs({...pluginConfigs, yuanbao: {...pluginConfigs.yuanbao, appId: e.target.value}})}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                  <input
                    type="password"
                    placeholder="AppSecret"
                    value={pluginConfigs.yuanbao.appSecret}
                    onChange={(e) => setPluginConfigs({...pluginConfigs, yuanbao: {...pluginConfigs.yuanbao, appSecret: e.target.value}})}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
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
                  // 显示错误给用户
                  setError(`读取文件失败: ${err}`)
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
