/**
 * 主进程与界面共用的类型定义（单一事实来源）。
 *
 * ⚠ 这个目录里的代码**不能** import electron 或任何 Node 内置模块，
 *   因为它同时被打进渲染进程（浏览器环境），那边没有 Node。
 */

/** 环境自检信息。主进程采集，界面展示。 */
export interface SystemInfo {
  /** 应用版本，来自 package.json */
  appVersion: string
  /** 运行时版本，用于排查兼容性问题 */
  electron: string
  chrome: string
  node: string
  v8: string
  platform: string
  /** ★ 我们将用于调用 VRChat API 的 User-Agent（结构由 WAF 实测约束，见 docs/DECISIONS.md 2.5） */
  userAgent: string
  /** ★ 数据存放目录（%AppData%\VRCBW） */
  userDataDir: string
  /** ★ 能否用系统级加密保存会话凭据（Windows 上是 DPAPI）。为 false 时必须降级处理 */
  safeStorageAvailable: boolean
  isDev: boolean
}

/** 渲染进程向主进程报告"界面已成功挂载"，用于启动自检 */
export interface RendererReadyDetail {
  renderedAt: string
  /**
   * 界面从 IPC 拿到的 User-Agent，原样回传。
   *
   * 用途：证明「主进程 → preload → 界面」这条链路**双向**都是通的。
   * 注意不要拿界面的 navigator.userAgent 来比 —— 那是 Electron 的默认 UA，
   * 而我们调用 VRChat API 用的是自定义 UA，两者本来就不同。
   */
  userAgentEcho: string
}

/**
 * preload 在页面加载后回传的 DOM 真实状态，专用于诊断「界面挂载失败」。
 *
 * 为什么需要它：界面挂载失败时窗口只是一片空白，「React 到底有没有渲染」
 * 从外部完全看不出来（渲染进程的控制台用户看不到）。
 * preload 与页面共享同一个 document，所以它能替我们看一眼。
 * 有了这份数据，「黑屏」就变成可读的诊断结论：
 *   rootChildCount === 0  → 界面脚本从未挂载（模块被 CSP 拦掉 / 脚本抛错）
 *   rootChildCount >  0  → React 渲染过，问题在别处（IPC、样式等）
 */
export interface DomProbeDetail {
  at: string
  readyState: string
  rootExists: boolean
  rootChildCount: number
  /** 页面上实际可见的文字（截断），用于判断卡在哪一步 */
  bodyTextPreview: string
  scriptCount: number
}

// ---------------------------------------------------------------------------
// 认证（第 3 步）
// ---------------------------------------------------------------------------

export type AuthStatus = 'logged-out' | 'needs-2fa' | 'logged-in'

/** 登录成功后的公开信息。注意：**不含任何凭据**。 */
export interface AuthSelf {
  id: string
  displayName: string
}

/**
 * 认证状态。界面完全靠这个对象决定显示什么。
 *
 * ⚠ 这个对象会被通过 IPC 送到渲染进程，所以**绝不能**包含密码、cookie、token。
 */
export interface AuthState {
  status: AuthStatus
  self?: AuthSelf
  /** status === 'needs-2fa' 时，服务器给出的可用方式，例如 ['totp'] 或 ['emailOtp'] */
  twoFactorMethods?: string[]
  /** 给用户看的结果说明（成功或失败的文本） */
  message?: string
}

export interface LoginRequest {
  username: string
  password: string
}

export interface TwoFactorRequest {
  code: string
}

// ---------------------------------------------------------------------------
// 扫描与变化（第 4 步）
// ---------------------------------------------------------------------------

/**
 * 我们跟踪的字段。
 *
 * 除了资料字段，还包括**好友关系的变化**：
 *   friendAdded   —— 新成为好友（或重新加回）
 *   friendRemoved —— 已解除好友（或账号注销）
 * 这两类没有 before/after 内容，before 和 after 都是空字符串，
 * 由界面按类型渲染成对应的文案。
 */
export type ChangeField =
  | 'displayName'
  | 'bio'
  | 'bioLinks'
  | 'friendAdded'
  | 'friendRemoved'

/** 一条变更事件。before/after 都是可直接展示的字符串（bioLinks 按行拼接）。 */
export interface ChangeEvent {
  id: string
  at: string
  userId: string
  /** 变化发生时的昵称，用于列表展示 */
  displayName: string
  field: ChangeField
  before: string
  after: string
  /**
   * 仅开发模式：这条是「注入模拟变化」按钮造出来的假数据。
   * 标记它是为了能被一键清除（真实数据里永远不会有这个字段）。
   */
  test?: boolean
}

/**
 * 好友的本地记录。
 *
 * ## 关于两种「序号」
 *
 * `friendNumber` —— **真正的「好友序号」**，1 起算。
 *   来源：`GET /auth/user` 返回的 `friends` **数组顺序**。VRCX 用的就是这个
 *   （`src/stores/friend.js` 的 `tryApplyFriendOrder()`：遍历 `currentUser.friends`
 *   逐个累加），而且它**只在首次看到时拍一次快照并固化**，之后不再重排 ——
 *   因为 API 不保证数组顺序永远不变。实测该顺序与「加好友顺序」一致。
 *
 * `seq` —— **本地兜底编号**，首次记录到时的单调递增序号。
 *   只有在某条记录从未拿到过 `apiIndex`（例如早期版本写入的数据、或那次请求失败）
 *   时才会被界面使用。正常情况下界面显示的是 `friendNumber`。
 */
export interface FriendRecord {
  id: string
  /** 本地兜底编号（见上方说明；正常情况下界面不用它） */
  seq: number
  /** 真正的好友序号，取自 friends 数组下标 + 1；首次看到时固化，之后不变 */
  friendNumber: number | null
  displayName: string
  /** 简介正文；缺失时统一为空字符串（这样"第一次填上简介"也能被识别为变化） */
  bio: string
  /** 简介里的链接，已按行拼成一个字符串（便于逐行差异对比与展示） */
  bioLinks: string
  firstSeenAt: string
  lastCheckedAt: string
  /** 上次内容的指纹，用于快速判断是否变化 */
  fingerprint: string
  changeCount: number
  lastChangedAt: string | null
  /** 已不再是好友（保留历史，标记而不是删除） */
  removed: boolean
  removedAt: string | null
  /**
   * 上次扫描时，这个 id 在 VRChat 返回的 friends 数组里的下标。
   *
   * 采集它的目的是推导 `friendNumber`（= apiIndex + 1）。保留它是为了能看到
   * 「顺序有没有变化」——如果多次扫描后下标一直一致，说明这个顺序是稳定的。
   */
  apiIndex: number | null
}

export type ScanPhase = 'idle' | 'listing' | 'scanning' | 'done' | 'stopped' | 'error'

/**
 * 扫描状态的文案代码。
 *
 * ⚠ 为什么主进程不直接给一句中文：
 *   扫描进度是**主进程**产生的，但界面要支持多语言。如果主进程直接发中文，
 *   英文/日文界面里就会突然冒出一句中文。所以主进程只给**代码 + 参数**，
 *   由界面翻译（见 renderer 的 i18n.tsx）。
 *
 * 无法翻译的原始细节（例如服务端返回的报错文本）走 detail 字段原样展示。
 */
export type ScanMessageCode =
  | 'listing'
  | 'listingCount'
  | 'scanning'
  | 'stopped'
  | 'doneNoChange'
  | 'doneChanges'
  | 'rateLimited'
  | 'abnormalEnd'
  | 'notLoggedIn'
  | 'cooldown'
  | 'alreadyRunning'
  | 'friendsFailed'
  | 'emptyFriends'
  | 'manualTooSoon'
  | 'autoScanStarted'
  /*
   * 以下是"服务器/网络出问题"这一类异常（用户要求：后台出事必须显眼提示）。
   * 它们都会同时写进 store.lastScanWarning，所以重启程序后仍然看得到。
   */
  /** 会话失效（401）—— 需要重新登录 */
  | 'sessionExpired'
  /** 连续失败太多次，主动中断（避免对着挂掉的服务器空转几小时） */
  | 'tooManyFailures'
  /** 本轮大部分好友都没抓到 —— 结果不可信，不能当成"没有变化" */
  | 'doneMostlyFailed'
  /** 拿到的名单自相矛盾，跳过了"解除好友"判定，避免造出几百条假记录 */
  | 'relationCheckSkipped'
  /**
   * 扫描途中账号被切换（退出登录 / 换了另一个账号）—— 立即中止本轮。
   *
   * 为什么必须中止：扫描手里的数据属于**开始时那个账号**，而存盘写的是
   * "此刻登录的账号"的目录；换号后继续跑就会把 A 的数据写进 B 的目录
   * （B 的数据被覆盖、界面显示 A 的好友）。见 watcher.ts 的 saveScanStore。
   */
  | 'accountSwitched'
  /**
   * 上一次扫描**没跑完**就被中断了（进程被杀 / 断电 / 在扫描中途退出）。
   *
   * 为什么需要：好友资料是边扫边存的，所以中断会留下一份**部分更新**的数据，
   * 而「上次扫描时间 / 变化数」这些统计只在跑完时才写 —— 界面上就是
   * 「数据变了，时间戳和变化数却还是上一次的」。用户会以为统计坏了。
   * 启动时检测到这种状态就把它标出来，让用户知道数据不完整、需要重扫。
   */
  | 'scanInterrupted'

/**
 * 上一次扫描留下的异常记录。
 *
 * 为什么需要持久化：扫描是在后台跑的，窗口常常关着（收在托盘）。
 * 如果只是弹一次提示，用户没看到就永远不知道"那次扫描其实全失败了"。
 * 存在数据文件里，界面每次打开都能照常显示。
 */
export interface ScanWarning {
  code: ScanMessageCode
  params: Record<string, string | number>
  at: string
}

/** 扫描进度。主进程会在扫描过程中持续推送给界面。 */
export interface ScanProgress {
  phase: ScanPhase
  /** 本轮需要检查的好友总数 */
  total: number
  /** 已检查数 */
  done: number
  /** 当前正在检查第几个（1 起算），用于显示"第 N 个" */
  index: number
  /** 本轮已发现的变化条数 */
  changes: number
  /** 因 403/404 等原因跳过的数量 */
  skipped: number
  /** 状态文案代码，界面负责翻译 */
  messageCode?: ScanMessageCode
  /** 文案里的占位符参数，例如 { total: 246 } */
  messageParams?: Record<string, string | number>
  /** 无法翻译的原始细节（服务端报错原文等） */
  detail?: string
}

export interface ScanStats {
  total: number
  scanned: number
  skipped: number
  changes: number
}

export interface ScanSummary {
  running: boolean
  lastScanAt: string | null
  lastScanStats: ScanStats | null
  /** 已建立基线的好友数（不含已解除好友） */
  friendCount: number
  /** 已解除好友的数量（保留历史，可以在这里看到） */
  removedCount: number
  /** 时间线上累计的事件数 */
  eventCount: number
  /** 上次触发限流的时间（用于冷却期提示） */
  lastRateLimitAt: string | null
  /**
   * 上一次扫描的异常记录；正常完成时为 null。
   * 界面用它显示"上一轮扫描出问题了"的醒目提示（概览横幅 + 侧栏标记）。
   */
  lastScanWarning: ScanWarning | null
  /**
   * 本地数据文件读取失败的原因（null = 正常）。
   *
   * 触发场景：store.json / store.bin 损坏或解不开。此时程序会把它改名备份、
   * 再以空数据继续运行 —— 界面必须把这件事**明确告诉用户**，
   * 否则用户只会觉得"我的记录莫名其妙全没了"。
   */
  dataLoadError: string | null
  /** 冷却期还剩多少分钟（0 表示不在冷却期） */
  cooldownMinutesLeft: number

  // --- 账号隔离（未登录时全部为 null）---
  /** 当前账号的 VRChat 用户 id */
  accountId: string | null
  /** 当前账号的数据目录 */
  accountDataDir: string | null

  // --- 调度 ---
  /** 下次自动扫描的时间（ISO）；未登录或从未扫描过为 null */
  nextAutoScanAt: string | null  /** 距离可以手动扫描还剩多少分钟（0 = 现在就可以） */
  manualScanWaitMinutes: number
  /** 单个好友之间的请求间隔（秒），界面据此估算耗时 */
  requestIntervalSeconds: number
  /** 自动扫描间隔（小时） */
  autoScanIntervalHours: number
  /** 手动扫描的最小间隔（小时） */
  manualScanMinIntervalHours: number
  /** 触发限流后的强制冷却（小时） */
  rateLimitCooldownHours: number
}

export interface ScanOptions {
  /** 是否为调度器自动触发（自动扫描不受"手动最小间隔"限制） */
  auto?: boolean
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export type ThemePreference = 'light' | 'dark' | 'system'
export type LanguagePreference = 'zh' | 'ja' | 'en'

/**
 * 好友列表可排序的列。
 *
 * 定义在这里而不是组件里，是因为它要被**持久化到设置**里 ——
 * 主进程和界面都要认识这个类型。
 */
export type FriendSortKey = 'friendNumber' | 'displayName' | 'lastChangedAt'

/** 变化记录的筛选类别（同样需要持久化） */
export type ChangeFilterKey = 'all' | 'displayName' | 'bio' | 'relation'

/** 窗口位置与大小（用于下次启动时还原） */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** 应用设置，由主进程持久化在 userData/settings.json */
export interface AppSettings {
  theme: ThemePreference
  /** 界面语言 */
  lang: LanguagePreference
  /** 列表每页显示条数（好友列表、变化记录共用） */
  pageSize: number
  /**
   * 好友列表是否按窗口高度**自动**决定每页条数（默认开）。
   * 「自动」= 算到刚好不出现滚动条的条数，这样每屏都是整齐的整数行。
   */
  autoPageSizeFriends: boolean
  /** 变化记录是否同样自动决定每页条数（默认开，与好友列表分开设置） */
  autoPageSizeChanges: boolean
  /**
   * 好友列表是否显示**已解除**的好友（默认关）。
   *
   * 用户的要求：不是好友了就别显示。所以默认隐藏，开关挪到设置页
   * （原来放在好友列表工具栏里，占地方而且多半没人改）。
   */
  showRemovedFriends: boolean
  /*
   * ↓ 界面状态。这些本来放在组件的 useState 里，但组件在切页面时会被卸载，
   *   导致"我明明按最近变化排序了，切到设置再回来就变回序号正序"。
   *   存进设置后，切换页面与重启程序都能记住。
   */
  friendsSortKey: FriendSortKey
  friendsSortAsc: boolean
  friendsQuery: string
  changesFilter: ChangeFilterKey
  changesQuery: string
  /** 字号缩放系数（1 = 标准） */
  fontScale: number
  /** 界面字体名；空字符串表示用默认字体栈 */
  fontFamily: string
  /** 好友数据目录；空字符串 = 默认位置 */
  dataDir: string
  /** 随 Windows 启动自动运行（仅打包版有效） */
  autoLaunch: boolean
  /**
   * 随 Windows 启动时**最小化到托盘**（只影响开机自启那一次）。
   *
   * 用户手动双击图标打开时**不会**最小化 —— 那不符合直觉，用户要的就是看到窗口。
   * 判定靠开机自启项里的 `--startup` 参数（见 main/index.ts 的 applyAutoLaunch）。
   */
  startMinimized: boolean
  /** 关闭窗口时最小化到托盘；关掉则关闭即退出 */
  minimizeToTray: boolean
  /**
   * 启用 GPU（硬件）加速。**默认开启**。
   *
   * ⚠ 这一项**必须在 app ready 之前**决定，所以改完必须重启软件才生效
   *   （界面上有明确提示）。关掉它只是退回软件渲染，不影响任何功能。
   *
   * 为什么要做成开关：少数机器上显卡驱动会让界面出现花屏/字体发虚，
   * 此时用户需要一个自救手段，而不必去设环境变量。
   */
  hardwareAcceleration: boolean
  /**
   * 上次关闭时的窗口位置与大小；null = 还没记录过（首次启动用默认值并居中）。
   *
   * ⚠ 使用前必须做**屏幕可见性校验**，否则换显示器/改分辨率后窗口可能落在看不见的地方。
   */
  windowBounds: WindowBounds | null
  /** 上次关闭时是否为最大化 */
  windowMaximized: boolean
  /** 是否用系统加密（DPAPI）加密本地好友数据 */
  encryptData: boolean
}

/** 数据目录迁移结果 */
export interface MoveDataResult {
  ok: boolean
  message: string
  files: number
  bytes: number
}

/** 数据目录现状，用于设置页显示 */
export interface DataDirInfo {
  /** 当前实际使用的目录 */
  current: string
  /** 默认位置 */
  defaultPath: string
  /** 是否在使用自定义位置 */
  isCustom: boolean
}

/**
 * 检查更新的结果。
 *
 * 检查方式是**向 GitHub Releases API 查询最新版本号并与本地比较** ——
 * 不需要服务器、不需要任何凭据，也不会上传任何用户信息。
 */
export interface UpdateCheckResult {
  ok: boolean
  current: string
  latest?: string
  hasUpdate?: boolean
  releaseUrl?: string
  error?: string
}

/**
 * preload 通过 contextBridge 暴露给界面的全部能力。
 *
 * ⚠ 这是白名单：界面只能调用这里列出的方法，拿不到 ipcRenderer 本体，
 *   因此无法调用未授权的 IPC 通道。
 */
export interface VrcbwApi {
  getSystemInfo(): Promise<SystemInfo>
  notifyRendererReady(detail: RendererReadyDetail): void
  openUserDataDir(): Promise<string>

  // --- 认证 ---
  getAuthState(): Promise<AuthState>
  login(req: LoginRequest): Promise<AuthState>
  submitTwoFactor(req: TwoFactorRequest): Promise<AuthState>
  logout(): Promise<AuthState>

  // --- 扫描 ---
  startScan(options?: ScanOptions): Promise<void>
  stopScan(): Promise<void>
  getScanSummary(): Promise<ScanSummary>
  getChanges(limit?: number): Promise<ChangeEvent[]>
  /** 全部好友记录（含已解除好友，界面自己排序与筛选） */
  getFriends(): Promise<FriendRecord[]>
  /** 仅开发模式使用：往时间线注入一条模拟变化，用来验证界面 */
  injectTestChange(kind?: 'bio' | 'friendAdded' | 'friendRemoved'): Promise<ChangeEvent | null>
  /** 仅开发模式使用：删除所有模拟注入的记录并回滚其副作用，返回删除条数 */
  clearTestChanges(): Promise<number>
  /** 订阅扫描进度，返回取消订阅的函数 */
  onScanProgress(handler: (progress: ScanProgress) => void): () => void

  // --- 设置 ---
  getSettings(): Promise<AppSettings>
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>

  // --- 数据目录 ---
  getDataDirInfo(): Promise<DataDirInfo>
  /** 打开文件夹选择对话框；返回选中的路径（取消则为 null） */
  chooseDataDir(): Promise<string | null>
  /** 把数据迁移到新目录；传 'default' 表示恢复默认位置 */
  moveDataDir(target: string): Promise<MoveDataResult>

  // --- 反馈与诊断 ---
  /** 生成诊断文本（环境信息 + 最近日志），用于反馈时附上 */
  getDiagnostics(): Promise<string>
  /** 复制文本到剪贴板 */
  copyText(text: string): Promise<void>
  /** 用系统默认程序打开一个 https 链接（非 https 一律拒绝） */
  openExternal(url: string): Promise<boolean>
  /** 向 GitHub Releases 查询最新版本并与本地比较 */
  checkUpdate(): Promise<UpdateCheckResult>
  /**
   * 取「启动时自动检查更新」的结果（没检查完 / 检查失败时返回 null）。
   *
   * 主进程在启动后**静默**检查一次（最多 3 次重试，失败就算了 —— 中国大陆
   * 网络到 GitHub 经常不通，这属于预期情况，不该打扰用户）。
   * 界面据此在侧栏显示一个「有新版本」入口，不弹任何窗口。
   */
  getAutoUpdateStatus(): Promise<UpdateCheckResult | null>
  /** 订阅「自动检查发现新版本」事件（检查完成时推送一次） */
  onUpdateAvailable(handler: (result: UpdateCheckResult) => void): () => void
}
