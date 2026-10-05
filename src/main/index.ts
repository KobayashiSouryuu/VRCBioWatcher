/**
 * Electron 主进程入口。
 *
 * 职责：创建窗口、采集环境信息、认证、启动自检。
 * 后续的定时扫描与数据存储也都在这一侧 —— 因为只有主进程能联网和读写文件，
 * 界面被严格限制在浏览器沙箱里。
 *
 * 安全基线（不要放宽）：
 *   contextIsolation: true   —— 界面的 JS 与 preload 的 JS 运行在隔离的上下文里
 *   nodeIntegration:  false  —— 界面里没有 require / process / fs
 *   sandbox:          true   —— preload 也在 Chromium 沙箱内运行
 */
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  safeStorage,
  screen,
  shell,
  Tray,
} from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { buildUserAgent } from './user-agent'
import { AuthManager } from './vrchat/auth'
import {
  AUTO_SCAN_INTERVAL_MS,
  MANUAL_SCAN_MIN_INTERVAL_MS,
  RATE_LIMIT_COOLDOWN_MS,
  REQUEST_INTERVAL_MS,
  Watcher,
} from './watcher'
import { loadSettings, saveSettings } from './settings'
import { installLogBuffer, logLineCount, recentLogs } from './log-buffer'
import { APP_ID, APP_NAME, PROJECT_URL } from '../shared/project'
import {
  accountDirPath,
  dataRoot,
  defaultDataRoot,
  eventCount,
  getActiveAccount,
  loadStore,
  makeEventId,
  moveDataRoot,
  recentEvents,
  removeTestEvents,
  resetDataRoot,
  saveStore,
  setActiveAccount,
} from './store/db'
import { TRAY_ICON_DATA_URL, WINDOW_ICON_DATA_URL } from './app-icon'
import type {
  AppSettings,
  AuthState,
  ChangeEvent,
  DataDirInfo,
  DomProbeDetail,
  FriendRecord,
  LoginRequest,
  MoveDataResult,
  RendererReadyDetail,
  ScanMessageCode,
  ScanOptions,
  ScanProgress,
  ScanSummary,
  SystemInfo,
  TwoFactorRequest,
  UpdateCheckResult,
} from '../shared/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

/*
 * ★★★ 把 userData 固定到 %APPDATA%\vrcbw —— 这一步必须在读取任何路径之前做。
 *
 * 为什么必须显式固定：
 *   Electron 的 userData 默认是「appData + 应用名」，而应用名会取 package.json 的
 *   `productName`（打包时为了让安装程序显示得好看，会设成 "VRCBioWatcher"）。
 *   那样打包版的 userData 就变成 `%APPDATA%\VRCBioWatcher`，
 *   和开发版的 `%APPDATA%\vrcbw` **不是同一个目录** ——
 *   结果是装完之后数据"全没了"，等于逼用户重新扫描一遍。
 *
 * 固定成常量后，开发版 / 打包版 / 将来改 productName 都不会再影响数据位置。
 *
 * ⚠ app.setPath 要求目录已存在，否则会抛错，所以先 mkdir。
 */
try {
  const fixedUserData = join(app.getPath('appData'), 'vrcbw')
  mkdirSync(fixedUserData, { recursive: true })
  app.setPath('userData', fixedUserData)
} catch (err) {
  // 固定失败也不能让程序起不来：退回 Electron 的默认行为即可
  console.warn('[main] 固定 userData 路径失败，将使用默认位置：', err)
}

/*
 * ★ 声明 AppUserModelID。必须在任何通知之前完成。
 *   Windows 的 toast 通知要求"发通知的进程"和"开始菜单快捷方式"有同一个 AUMID，
 *   否则通知会被系统静默丢弃（用户什么也看不到，而且没有任何报错）。
 */
app.setAppUserModelId(APP_ID)

/*
 * ★ 尽早装上日志环形缓冲：反馈功能会把它作为诊断信息展示给用户。
 *   放在这个位置是为了让它尽可能早地开始收集 —— 后面所有模块的日志都会被收进去。
 */
installLogBuffer()

/**
 * 是否真的在退出。
 *
 * ★ 这个标志是「关闭窗口 = 最小化到托盘」的关键：
 *   关窗口时要判断"用户是点 X（隐藏）还是从托盘选了退出（真退）"。
 *   没有它，托盘菜单里的"退出"会因为 close 事件被拦下来而退不掉 ——
 *   表现为点了退出没反应，只能去任务管理器杀进程。
 */
let quitting = false

/** 自动扫描的定时器 */
let schedulerTimer: NodeJS.Timeout | null = null

/** 认证管理器（会话、登录、2FA）。主进程持有，界面只能通过 IPC 触达。 */
const auth = new AuthManager()

/**
 * 扫描器。进度通过 IPC 推送给界面 —— 这是界面上进度条的数据来源。
 * 注意窗口可能被隐藏（扫描还在跑），所以推送前判空、判销毁。
 *
 * 顺便在这里处理**后台异常通知**：扫描是在后台跑的、窗口常常关着（收在托盘），
 * 如果只是把错误写进界面，用户在关着窗口时永远不知道"那轮扫描其实全失败了"。
 */
const watcher = new Watcher(auth, (progress: ScanProgress) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scan:progress', progress)
  }
  maybeNotifyScanProblem(progress)
})

/** 需要发系统通知的异常状态码 */
const NOTIFY_CODES: ScanMessageCode[] = [
  'rateLimited',
  'sessionExpired',
  'tooManyFailures',
  'doneMostlyFailed',
  'friendsFailed',
]

/**
 * 扫描出现异常时弹一条 Windows 通知。
 *
 * 为什么必须发：触发 429 或服务器故障时窗口通常关着，
 * 通知是**唯一**能让用户立刻知道的途径（界面提示要等他主动打开窗口才看得到）。
 *
 * ⚠ 两个已知限制（所以界面内的提示不能省）：
 *   - Windows 的「专注助手/勿扰」会吞掉 toast
 *   - 通知依赖 AppUserModelID 才能可靠投递（见文件末尾的 setAppUserModelId）
 *
 * 点通知的行为按用户要求：**只把主窗口叫到前台**，不自动打开反馈对话框
 * （不是每个人都会去提 issue，强行弹反馈反而烦人）。
 */
function maybeNotifyScanProblem(progress: ScanProgress): void {
  const code = progress.messageCode
  if (!code || !NOTIFY_CODES.includes(code)) return
  if (!Notification.isSupported()) return

  const title = `${APP_NAME}：扫描出问题了`
  const body = describeScanProblem(code, progress.messageParams ?? {})

  console.warn(`[notify] ${title} —— ${body}`)
  const notification = new Notification({ title, body, silent: false })
  notification.on('click', () => showMainWindow())
  notification.show()
}

/** 通知正文。故意写得直白，并带上"该做什么"。 */
function describeScanProblem(
  code: ScanMessageCode,
  params: Record<string, string | number>,
): string {
  switch (code) {
    case 'rateLimited':
      return `触发了 VRChat 的频率限制，已中断扫描并冷却 ${params.hours ?? 10} 小时。建议到 GitHub 反馈并考虑暂停使用。`
    case 'sessionExpired':
      return '登录状态已失效，扫描中断。请打开窗口重新登录。'
    case 'tooManyFailures':
      return `连续 ${params.limit ?? 10} 次请求失败，已中断扫描。VRChat 服务或你的网络可能有问题。`
    case 'doneMostlyFailed':
      return `本轮只成功检查了 ${params.done ?? 0} / ${params.total ?? 0} 个好友，结果不可信。请稍后重试。`
    case 'friendsFailed':
      return '拿不到好友名单，扫描没有开始。可能是网络或服务端问题。'
    default:
      return '扫描出现异常，详情请打开窗口查看。'
  }
}

/*
 * ── 关于「好友广播（WebSocket）」：试过，已移除，这里记录原因 ──
 *
 * 曾经实现过 VRChat Pipeline（`wss://pipeline.vrchat.cloud`），用来实时接收
 * 加好友 / 删好友 / 改昵称。实机测试连接被拒（close code 1006，握手阶段就失败，
 * 连服务端的 err 消息都收不到）。
 *
 * 最可能的原因：官方文档明说广播「需要正确的 User-Agent」，而
 * **Node 的全局 WebSocket 是浏览器语义的 API，无法设置自定义请求头** ——
 * 我们早就实测过 VRChat 的 WAF 会拒绝非浏览器形态的请求（见 DECISIONS 2.5）。
 * 要修就得引入 `ws` 依赖。
 *
 * 决定移除，理由（用户拍板 + 我的判断）：
 *   1. **本工具的核心是简介变化，而简介不在广播内容里** —— 广播解决不了主要问题
 *   2. 广播与扫描混在一条时间线上，**时间语义不一致**：广播是实时的、
 *      扫描是延迟最多 10 小时的。同一个列表里两种时间会让人困惑
 *   3. 为了一个次要功能引入依赖 + 重连 + 看门狗 + 协议怪癖，不划算
 *
 * ★ 所以现在的模型很干净：**所有变化都来自定期扫描，时间一律是"扫描时间"**。
 *   界面上也明确写明了这一点（见 i18n 的 dataSourceNote）。
 *   将来若真要重启这个功能，先读 DECISIONS 2.10。
 */

/**
 * 认证状态变化后，把「当前账号」同步给存储层。
 *
 * ★ 这是账号数据隔离的唯一入口。忘了调用它，退出登录后就还能读到上一个账号的数据
 *   （这正是修复前的严重 bug）。所以每个 auth 动作之后都必须走这里。
 */
function syncActiveAccount(state: AuthState): AuthState {
  setActiveAccount(state.status === 'logged-in' ? (state.self?.id ?? null) : null)
  return state
}

function collectSystemInfo(): SystemInfo {
  let safeStorageAvailable = false
  try {
    safeStorageAvailable = safeStorage.isEncryptionAvailable()
  } catch {
    safeStorageAvailable = false
  }

  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: `${process.platform} ${process.arch}`,
    userAgent: buildUserAgent(),
    userDataDir: app.getPath('userData'),
    safeStorageAvailable,
    isDev: !app.isPackaged,
  }
}

/**
 * 开发期启动自检报告会累积写入 `_dev/startup-report.json`。
 * 用累积而不是覆盖：主进程启动和界面挂载是两个时间点，都要留下证据。
 */
let devReport: Record<string, unknown> = {}

/**
 * 把一段信息并入启动自检报告。
 *
 * 存在的意义：Electron 的窗口是否真的画出来了，在无人值守的环境里看不见。
 * 有了这个文件，"主进程起来了 / preload 桥接成功 / 界面挂载完成"这条链路
 * 每一步都有可机读的证据，出问题时也能立刻定位是哪一段断的。
 */
function updateDevReport(patch: Record<string, unknown>): void {
  if (app.isPackaged) return
  devReport = { ...devReport, ...patch, updatedAt: new Date().toISOString() }
  try {
    const dir = join(app.getAppPath(), '_dev')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'startup-report.json'), JSON.stringify(devReport, null, 2), 'utf8')
  } catch (err) {
    console.error('[dev] 写启动自检报告失败:', err)
  }
}

/**
 * 判断保存的窗口位置是否还"看得见"。
 *
 * ## 原理
 *
 * 窗口坐标是**相对整个虚拟桌面**的，而虚拟桌面是所有显示器拼起来的。
 * 换显示器、改分辨率、拔掉外接屏之后，原来那组坐标可能落在**任何显示器之外** ——
 * 那时窗口确实被创建了、也在运行，但用户**在屏幕上永远看不到它**
 * （任务栏图标可能有，但点了也只是让它获得焦点，人眼依然看不到窗口）。
 *
 * 所以恢复位置前必须校验：把保存的矩形和每个显示器的工作区
 * （`workArea`，即去掉任务栏后的可用区域）求交集，
 * **只要与任意一个显示器有足够大的交集**就认为可见。
 *
 * 「足够大」取 100×40 像素：不能只判断"有交集"——
 * 窗口只露出 1 像素也算有交集，那种情况用户同样找不回来。
 */
function isBoundsVisible(bounds: {
  x: number
  y: number
  width: number
  height: number
}): boolean {
  const MIN_VISIBLE_W = 100
  const MIN_VISIBLE_H = 40
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    const overlapW =
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x)
    const overlapH =
      Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y)
    return overlapW >= MIN_VISIBLE_W && overlapH >= MIN_VISIBLE_H
  })
}

/** 默认窗口尺寸；没有保存过位置、或保存的位置已不可见时用它（并居中） */
const DEFAULT_WINDOW_WIDTH = 1100
const DEFAULT_WINDOW_HEIGHT = 780

/**
 * 算出这次应该用哪个窗口位置。
 *
 * 返回 undefined 表示"交给 Electron 自己居中"。
 */
function resolveWindowBounds(): { x: number; y: number; width: number; height: number } | undefined {
  const saved = loadSettings().windowBounds
  if (!saved) return undefined
  if (!isBoundsVisible(saved)) {
    console.warn('[main] 保存的窗口位置已不在任何显示器上，改用默认尺寸并居中')
    return undefined
  }
  return saved
}

function createWindow(startHidden = false): void {
  const savedBounds = resolveWindowBounds()

  mainWindow = new BrowserWindow({
    width: savedBounds?.width ?? DEFAULT_WINDOW_WIDTH,
    height: savedBounds?.height ?? DEFAULT_WINDOW_HEIGHT,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 900,
    minHeight: 620,
    show: false, // 先隐藏，等 ready-to-show 再显示，避免白屏闪烁
    autoHideMenuBar: true,
    // 与浅色主题的 --bg 一致，避免窗口出现瞬间闪一下别的颜色
    backgroundColor: '#f5f6f8',
    title: APP_NAME,
    // 窗口/任务栏图标。打包后 exe 自带图标，但开发模式下不会 ——
    // 这里显式指定，两种模式看起来一致。
    icon: nativeImage.createFromDataURL(WINDOW_ICON_DATA_URL),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 界面不允许打开新窗口（需要时由主进程用系统浏览器打开）
      webviewTag: false,
    },
  })

  // --- 记住窗口大小 / 位置 / 最大化状态 ---
  //
  // 用 getNormalBounds() 而不是 getBounds()：最大化时 getBounds() 返回的是
  // 最大化之后的尺寸，存下来会导致"取消最大化后窗口没法还原成原来的大小"。
  const saveBounds = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const maximized = mainWindow.isMaximized()
    saveSettings({
      windowMaximized: maximized,
      // 最大化时不要覆盖之前存的普通尺寸
      ...(maximized ? {} : { windowBounds: mainWindow.getNormalBounds() }),
    })
  }

  // 拖动/缩放会连续触发很多次，做一点节流，避免疯狂写 settings.json
  let boundsTimer: NodeJS.Timeout | null = null
  const scheduleSaveBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(saveBounds, 400)
  }

  mainWindow.on('resize', scheduleSaveBounds)
  mainWindow.on('move', scheduleSaveBounds)
  mainWindow.on('maximize', saveBounds)
  mainWindow.on('unmaximize', saveBounds)
  mainWindow.on('closed', () => {
    if (boundsTimer) clearTimeout(boundsTimer)
  })

  // 上次是最大化的话，这次也最大化打开
  if (loadSettings().windowMaximized) mainWindow.maximize()

  // --- 窗口显示：正常路径 + 超时兜底 ---
  let windowShown = false
  const showWindow = (why: string): void => {
    if (windowShown || !mainWindow) return
    // 用户选了「启动时最小化到托盘」：不显示窗口，安安静静待在托盘里
    if (startHidden) return
    windowShown = true
    console.log(`[main] 显示窗口（原因：${why}）`)
    mainWindow.show()
  }

  mainWindow.on('ready-to-show', () => showWindow('ready-to-show 已触发'))

  // ⚠ 兜底：某些机器上（软件渲染、无可用视频设备、驱动异常）ready-to-show 可能永远不触发。
  //   那样窗口会一直保持隐藏，用户看到的现象是「命令跑起来了，但什么都没出现」，
  //   而且终端里一行报错都没有 —— 极难排查。所以加一个超时强制显示。
  //   注意 startHidden 时不启动这个兜底，否则"最小化启动"会被它强行弹出来。
  const showFallbackTimer = startHidden
    ? null
    : setTimeout(() => showWindow('等待 ready-to-show 超时，强制显示'), 3000)

  if (startHidden) console.log('[main] 按设置以最小化（托盘）方式启动，不显示窗口')

  mainWindow.on('closed', () => {
    if (showFallbackTimer) clearTimeout(showFallbackTimer)
    mainWindow = null
  })

  // ★ 关闭窗口 = 收进托盘，而不是退出。
  //   对一个需要长期挂机做定时扫描的工具来说，"关掉窗口就停止监控"是错的。
  //   真正退出只有一条路：托盘图标右键 → 退出（它会先把 quitting 置为 true）。
  //
  // ⚠ 但有一个必须处理的例外：**如果托盘没能创建成功（图标解码失败等），
  //   就不能再拦截关闭** —— 否则窗口关不掉、托盘又没有退出菜单，
  //   用户只能去任务管理器杀进程。宁可让它关掉就退出，也不能把用户困住。
  mainWindow.on('close', (event) => {
    if (quitting || !tray) return
    // 用户可以在设置里关掉「关闭时最小化到托盘」—— 那时点关闭就是彻底退出
    if (!loadSettings().minimizeToTray) {
      console.log('[main] 已关闭「最小化到托盘」，点关闭即退出')
      quitting = true
      app.quit()
      return
    }
    event.preventDefault()
    mainWindow?.hide()
    console.log('[main] 窗口已隐藏到托盘（要真正退出请用托盘菜单）')
  })

  // --- 把界面侧的日志与错误转发到终端 ---
  // 这条机制非常重要：界面里的报错（CSP 拦截、脚本异常、模块加载失败、preload 出错）
  // 默认只出现在开发者工具的控制台里，而运行 npm run dev 的人盯着的是终端。
  // 不转发的话，「界面白屏 / 界面不出现」就是完全无从下手的黑盒 —— 这个坑真的踩过。
  const wc = mainWindow.webContents

  wc.on('console-message', (event) => {
    console.log(`[renderer/${event.level}] ${event.message}`)
  })

  wc.on('dom-ready', () => {
    console.log('[main] DOM 就绪（dom-ready）')
    updateDevReport({ domReady: true })
  })

  wc.on('did-finish-load', () => {
    console.log('[main] 页面框架加载完成（did-finish-load）')
    updateDevReport({ didFinishLoad: true })
  })

  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer] ❌ 页面加载失败：${errorCode} ${errorDescription} → ${validatedURL}`)
    updateDevReport({ didFailLoad: { errorCode, errorDescription, validatedURL } })
  })

  wc.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[renderer] ❌ preload 脚本出错：${preloadPath}`, error)
    updateDevReport({ preloadError: { preloadPath, message: error.message } })
  })

  wc.on('render-process-gone', (_event, details) => {
    console.error(`[renderer] ❌ 渲染进程终止：reason=${details.reason} exitCode=${details.exitCode}`)
    updateDevReport({ renderProcessGone: { reason: details.reason, exitCode: details.exitCode } })
  })

  wc.on('unresponsive', () => {
    console.error('[renderer] ⚠ 渲染进程无响应')
  })

  // 界面里出现的任何外部链接都交给系统浏览器，不在应用内打开
  wc.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 开发期由 electron-vite 提供带热更新的开发服务器；打包后用本地文件
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    console.log(`[main] 加载开发服务器: ${devServerUrl}`)
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:getSystemInfo', () => collectSystemInfo())

  ipcMain.handle('app:openUserDataDir', async () => {
    const dir = app.getPath('userData')
    const error = await shell.openPath(dir)
    return error || dir
  })

  // 界面挂载完成的信号 → 写入启动自检报告
  ipcMain.on('app:rendererReady', (_event, detail: RendererReadyDetail) => {
    const info = collectSystemInfo()
    const ipcRoundTripOk = detail.userAgentEcho === info.userAgent
    console.log('[main] 收到界面就绪信号 ✓')
    console.log(`[main] IPC 往返校验（界面回传的 UA 与主进程一致）: ${ipcRoundTripOk}`)
    updateDevReport({
      rendererReady: true,
      rendererRenderedAt: detail.renderedAt,
      ipcRoundTripOk,
      systemInfo: info,
    })
  })

  // 诊断探针的回传：把「界面里 DOM 的真实状态」写进报告。
  // 这样即使界面挂载失败，报告里也能读出到底卡在哪一步。
  ipcMain.on('app:domProbe', (_event, detail: DomProbeDetail) => {
    console.log(
      `[main] 界面 DOM 探针：root 存在=${detail.rootExists} 子节点数=${detail.rootChildCount} ` +
        `脚本数=${detail.scriptCount} readyState=${detail.readyState}`
    )
    console.log(`[main] 界面上可见的文字：${detail.bodyTextPreview || '（空）'}`)
    if (detail.rootChildCount === 0) {
      console.error(
        '[main] ❌ 诊断结论：界面脚本从未挂载（#root 里一个子节点都没有）。' +
          '最可能的原因是模块脚本被 CSP 拦截或加载失败 —— 请看上面 [renderer/…] 的报错。'
      )
    }
    updateDevReport({ domProbe: detail })
  })

  // --- 认证（第 3 步）---
  // 界面只能通过这几条通道触达认证逻辑；密码只在 login 的入参里出现一次，
  // 不会被写进状态、日志或磁盘。
  ipcMain.handle('auth:getState', async () => {
    // 首次调用时触发一次会话恢复（用系统加密保存的 cookie 自动登录）
    const state = syncActiveAccount(await auth.restore())
    // 恢复出登录态后：调度器才能判断该不该补扫；广播才能连
    if (state.status === 'logged-in') onLoggedIn()
    return state
  })

  ipcMain.handle('auth:login', async (_event, req: LoginRequest) => {
    console.log('[auth] 收到登录请求（不记录用户名与密码）')
    const state = syncActiveAccount(await auth.login(req))
    if (state.status === 'logged-in') onLoggedIn()
    return state
  })

  ipcMain.handle('auth:submitTwoFactor', async (_event, req: TwoFactorRequest) => {
    console.log('[auth] 收到两步验证码提交（不记录验证码内容）')
    const state = syncActiveAccount(await auth.submitTwoFactor(req))
    if (state.status === 'logged-in') onLoggedIn()
    return state
  })

  ipcMain.handle('auth:logout', async () => {
    console.log('[auth] 收到退出登录请求')
    const state = syncActiveAccount(await auth.logout())
    // 退出后取消待执行的自动扫描，否则会用一个已失效的会话去请求
    stopScheduler()
    return state
  })

  // --- 扫描 ---
  ipcMain.handle('scan:start', async (_event, options?: ScanOptions) => {
    return startScan(Boolean(options?.auto))
  })

  ipcMain.handle('scan:stop', async () => {
    watcher.requestStop()
  })

  ipcMain.handle('scan:getSummary', async (): Promise<ScanSummary> => {
    const store = loadStore()
    const friends = Object.values(store.friends)
    return {
      running: watcher.isRunning,
      lastScanAt: store.lastScanAt,
      lastScanStats: store.lastScanStats,
      friendCount: friends.filter((f) => !f.removed).length,
      removedCount: friends.filter((f) => f.removed).length,
      eventCount: eventCount(),
      lastRateLimitAt: store.lastRateLimitAt,
      lastScanWarning: store.lastScanWarning,
      cooldownMinutesLeft: watcher.getCooldown().minutesLeft,
      // ★ 未登录时这两个都是 null，界面据此渲染「请先登录」而不是空列表
      accountId: getActiveAccount(),
      accountDataDir: accountDirPath(),
      nextAutoScanAt: watcher.nextAutoScanAt(),
      manualScanWaitMinutes: watcher.getManualWait().minutesLeft,
      requestIntervalSeconds: REQUEST_INTERVAL_MS / 1000,
      autoScanIntervalHours: AUTO_SCAN_INTERVAL_MS / 3600000,
      manualScanMinIntervalHours: MANUAL_SCAN_MIN_INTERVAL_MS / 3600000,
      rateLimitCooldownHours: RATE_LIMIT_COOLDOWN_MS / 3600000,
    }
  })

  ipcMain.handle('scan:getChanges', async (_event, limit?: number): Promise<ChangeEvent[]> => {
    return recentEvents(typeof limit === 'number' && limit > 0 ? limit : 200)
  })

  // 全部好友记录。排序和筛选都放在界面侧做 —— 246 条数据一次传过去只有几百 KB，
  // 界面本地排序的响应速度比来回 IPC 快得多，也让重排逻辑集中在一个地方。
  //
  // ★ 未登录时 loadStore() 返回空对象，所以这里天然是空数组 —— 不会泄露上一个账号的数据。
  ipcMain.handle('friends:list', async (): Promise<FriendRecord[]> => {
    return Object.values(loadStore().friends)
  })

  // 仅开发模式：注入一条模拟变化，用来验证「时间线 + 差异展示」这条链路。
  // 不这么做的话，只能等某个好友真的改了简介或者真的加/删好友 —— 那可能等很久，而且无法复现。
  ipcMain.handle(
    'scan:injectTestChange',
    async (_event, kind?: string): Promise<ChangeEvent | null> => {
      if (app.isPackaged) return null
      // 未登录时没有"当前账号"，注入到哪里都不对
      if (!getActiveAccount()) {
        console.warn('[scan] 未登录，忽略注入请求')
        return null
      }
      const store = loadStore()
      const ids = Object.keys(store.friends)
      const now = new Date().toISOString()

      // 优先挑一个已经有资料的好友，这样展示的是真实昵称
      const userId = ids.length > 0 ? ids[0] : 'usr_test_placeholder'
      const friend = store.friends[userId]
      const displayName = friend ? friend.displayName : '（模拟好友）'

      if (kind === 'friendAdded' || kind === 'friendRemoved') {
        const event: ChangeEvent = {
          id: makeEventId(userId, kind, now),
          at: now,
          userId,
          displayName,
          field: kind,
          before: '',
          after: '',
          test: true,
        }
        store.events.push(event)
        if (friend) {
          // 同步本地记录，这样好友列表能立刻反映出「已解除」标记。
          // 注意：下一次真实扫描会发现该好友其实还在好友名单里，从而自动纠正这个状态
          // （并产生一条真实的「成为好友」事件）—— 这是预期行为，不是 bug。
          store.friends[userId] =
            kind === 'friendRemoved'
              ? { ...friend, removed: true, removedAt: now }
              : { ...friend, removed: false, removedAt: null }
        }
        saveStore(store)
        console.log(`[scan] 已注入一条模拟好友关系变化：${kind}（仅开发模式）`)
        return event
      }

      const beforeText = friend ? friend.bio : '（模拟）这是旧的一段自我介绍\n第二行内容'
      // 刻意同时包含**删除**和**新增**：只追加一行的话，界面上只能看到绿色高亮，
      // 演示不到删除线（红色）的效果。这里去掉最后一行、再加一行新内容。
      const lines = beforeText.split('\n')
      const trimmed =
        lines.length > 1
          ? lines.slice(0, -1).join('\n')
          : lines[0].slice(0, Math.max(0, lines[0].length - 3))
      const afterText = `${trimmed}\n（模拟变化 ${now.slice(11, 19)}）上面那一行被改成了这一行`
      const event: ChangeEvent = {
        id: makeEventId(userId, 'bio', now),
        at: now,
        userId,
        displayName,
        field: 'bio',
        before: beforeText,
        after: afterText,
        test: true,
      }
      store.events.push(event)
      if (friend) {
        store.friends[userId] = {
          ...friend,
          bio: afterText,
          lastCheckedAt: now,
          changeCount: friend.changeCount + 1,
          lastChangedAt: now,
        }
      }
      saveStore(store)
      console.log('[scan] 已注入一条模拟简介变化（仅开发模式）')
      return event
    },
  )

  // 仅开发模式：清掉所有模拟注入的记录（并回滚它们改过的简介、已解除标记）。
  ipcMain.handle('scan:clearTestChanges', async (): Promise<number> => {
    if (app.isPackaged) return 0
    return removeTestEvents()
  })

  // --- 设置 ---
  // 主题由主进程设置 nativeTheme.themeSource，这样界面的 prefers-color-scheme
  // 在首次绘制之前就已生效，深色模式下不会闪白底。
  ipcMain.handle('settings:get', async () => loadSettings())

  ipcMain.handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
    const next = saveSettings(patch)
    if (patch.theme !== undefined) nativeTheme.themeSource = next.theme
    if (patch.lang !== undefined) refreshTrayMenu()
    if (patch.autoLaunch !== undefined) applyAutoLaunch(next.autoLaunch)
    if (patch.encryptData !== undefined) {
      // 切换加密开关后立刻把当前数据重写一遍：否则要等到下一次扫描才生效，
      // 而用户点了开关就会以为"已经加密了"（或者以为"已经解密了"）—— 不能有这种错觉。
      saveStore(loadStore())
      console.log(`[settings] 本地数据加密已${next.encryptData ? '开启' : '关闭'}，数据已重写`)
    }
    console.log(`[settings] 已更新：${JSON.stringify(patch)}`)
    return next
  })

  // --- 数据目录（可在设置里更改，带校验过的迁移）---
  ipcMain.handle('data:getDirInfo', async (): Promise<DataDirInfo> => {
    const settings = loadSettings()
    return {
      current: dataRoot(),
      defaultPath: defaultDataRoot(),
      isCustom: settings.dataDir.trim() !== '',
    }
  })

  ipcMain.handle('data:chooseDir', async (): Promise<string | null> => {
    const options = {
      title: '选择数据存放目录',
      properties: ['openDirectory', 'createDirectory'] as const,
    }
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, { ...options, properties: [...options.properties] })
        : await dialog.showOpenDialog({ ...options, properties: [...options.properties] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('data:moveDir', async (_event, target: string): Promise<MoveDataResult> => {
    // 'default' 是"恢复默认位置"的哨兵值
    const result = target === 'default' ? resetDataRoot() : moveDataRoot(target)
    console.log(
      `[data] 数据目录迁移${result.ok ? '成功' : '失败'}：${result.message}` +
        (result.ok ? `（${result.files} 个文件 / ${result.bytes} 字节）` : ''),
    )
    return result
  })

  // --- 反馈与诊断 ---
  ipcMain.handle('app:getDiagnostics', async (): Promise<string> => buildDiagnosticsText())

  ipcMain.handle('app:copyText', async (_event, text: string): Promise<void> => {
    clipboard.writeText(String(text ?? ''))
  })

  ipcMain.handle('app:checkUpdate', async (): Promise<UpdateCheckResult> => checkForUpdate())

  ipcMain.handle('app:openExternal', async (_event, url: string): Promise<boolean> => {
    /*
     * ★ 只允许 https。
     *   shell.openExternal 能唤起**任意协议的处理器**，
     *   而这个 URL 是从界面传过来的，不能无条件信任。
     *   （邮件反馈那一版曾需要放行 mailto，现在已经去掉了，所以收紧到只有 https。）
     */
    const raw = String(url ?? '')
    if (!raw.startsWith('https://')) {
      console.warn(`[app] 拒绝打开非 https 链接：${raw.slice(0, 40)}`)
      return false
    }
    await shell.openExternal(raw)
    return true
  })
}

/**
 * 检查更新。
 *
 * ## 做法与理由
 *
 * 直接从 **GitHub Releases API** 取最新版本号，和本地版本比较：
 *   `GET https://api.github.com/repos/<owner>/<repo>/releases/latest`
 *
 * 这是小型开源项目最常见也最省事的做法：**不需要自建服务器、不需要任何凭据、
 * 不上传任何用户信息**。完整的自动更新（下载替换 + 校验签名）要用 electron-updater，
 * 那需要打包配置和发布渠道，等到真正要发布安装包时再考虑。
 *
 * 仓库地址从设置的 `githubUrl` 里解析 —— 所以作者只要填对地址，这个功能就能用。
 */
async function checkForUpdate(): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  // 仓库地址写死在 src/shared/project.ts 里，不做成设置项 —— 见那里的注释
  const match = /github\.com\/([^/]+)\/([^/?#]+)/.exec(PROJECT_URL)
  if (!match) {
    return { ok: false, current, error: 'GitHub 地址无效（请在设置里填写仓库地址）' }
  }

  const api = `https://api.github.com/repos/${match[1]}/${match[2]}/releases/latest`
  try {
    const res = await fetch(api, {
      headers: {
        Accept: 'application/vnd.github+json',
        // GitHub 要求带 UA，并且我们自己也有义务表明身份
        'User-Agent': buildUserAgent(),
      },
    })
    if (!res.ok) {
      return {
        ok: false,
        current,
        error:
          res.status === 404
            ? '仓库或 Release 不存在（可能还没发布过版本）'
            : `HTTP ${res.status}`,
      }
    }
    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    const latest = String(data.tag_name ?? '').replace(/^v/i, '').trim()
    if (latest === '') return { ok: false, current, error: 'Release 里没有版本号' }

    return {
      ok: true,
      current,
      latest,
      hasUpdate: compareVersions(latest, current) > 0,
      releaseUrl: data.html_url,
    }
  } catch (err) {
    return {
      ok: false,
      current,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 比较形如 1.2.3 的版本号：a > b 返回正数 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * 把「随 Windows 启动」的设置同步给系统。
 *
 * ⚠ 开发模式下不设置：那时"可执行文件"其实是 electron.exe +
 *   项目路径参数，注册到 Windows 自启里既启动不起来、又会留下垃圾项。
 */
function applyAutoLaunch(enabled: boolean): void {
  if (!app.isPackaged) {
    console.log('[startup] 开发模式：忽略开机自启设置（仅打包版有效）')
    return
  }
  try {
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath })
    console.log(`[startup] 开机自启已${enabled ? '开启' : '关闭'}`)
  } catch (err) {
    console.warn('[startup] 设置开机自启失败：', err instanceof Error ? err.message : err)
  }
}

/**
 * 生成诊断文本：环境信息 + 最近日志。
 *
 * ⚠ 里面**包含账号名和好友数量**（属于个人信息），所以界面上会把这段文字
 *   原样展示给用户看，让他自己决定要不要发出去、要不要删掉某几行。
 *   悄悄发送用户数据是不可接受的。
 */
function buildDiagnosticsText(): string {
  const settings = loadSettings()
  const store = loadStore()
  const state = auth.getState()
  const friends = Object.values(store.friends)
  const cooldown = watcher.getCooldown()
  const logs = recentLogs(300)

  const rows = [
    '=== ' + APP_NAME + ' 诊断信息 ===',
    `生成时间：${new Date().toISOString()}`,
    `程序版本：${app.getVersion()}`,
    `Electron / Chromium / Node：${process.versions.electron} / ${process.versions.chrome} / ${process.versions.node}`,
    `平台：${process.platform} ${process.arch}`,
    `系统语言：${(() => { try { return app.getLocale() } catch { return '未知' } })()}`,
    `界面语言：${settings.lang}`,
    `运行模式：${app.isPackaged ? '打包后' : '开发'}`,
    `本地数据加密：${settings.encryptData ? '开' : '关'}`,
    `数据目录：${dataRoot()}`,
    `本账号数据目录：${accountDirPath() ?? '(未登录)'}`,
    `账号：${state.self?.displayName ?? '(未登录)'} (${getActiveAccount() ?? '-'})`,
    `好友：${friends.filter((f) => !f.removed).length} 个（已解除保留 ${friends.filter((f) => f.removed).length} 个）`,
    `变化事件：${eventCount()} 条`,
    `上次扫描：${store.lastScanAt ?? '从未'}`,
    `上次扫描统计：${
      store.lastScanStats
        ? `检查 ${store.lastScanStats.scanned} / 跳过 ${store.lastScanStats.skipped} / 变化 ${store.lastScanStats.changes}`
        : '无'
    }`,
    `下次自动扫描：${watcher.nextAutoScanAt() ?? '未排定'}`,
    `限流：${
      cooldown.blocked
        ? `冷却中，剩 ${cooldown.minutesLeft} 分钟`
        : store.lastRateLimitAt
          ? `上次 ${store.lastRateLimitAt}（冷却已结束）`
          : '从未触发'
    }`,
    `扫描节奏：每人间隔 3 秒 / 自动 10 小时 / 手动最小 2 小时 / 429 冷却 10 小时`,
    '',
    `=== 最近日志（最后 ${logs.length} 行，缓冲区共 ${logLineCount()} 行）===`,
    ...logs,
  ]
  return rows.join('\n')
}

// ---------------------------------------------------------------------------
// 扫描调度与启动入口
// ---------------------------------------------------------------------------

/**
 * 启动一次扫描（界面手动点，或调度器自动触发）。
 *
 * 门槛检查的顺序是有讲究的：
 *   1. 未登录 → 直接拒绝
 *   2. 限流冷却中 → 拒绝（这是最高优先级的安全措施）
 *   3. 手动触发时还要看"手动最小间隔"（自动扫描不受它限制，
 *      因为自动扫描本来就是按 10 小时间隔排的）
 */
function startScan(auto: boolean): void {
  if (auth.getState().status !== 'logged-in') {
    console.warn('[scan] 未登录，拒绝开始扫描')
    watcher.reportMessage('notLoggedIn')
    return
  }

  const cooldown = watcher.getCooldown()
  if (cooldown.blocked) {
    console.warn(`[scan] 处于限流冷却期，还剩 ${cooldown.minutesLeft} 分钟`)
    watcher.reportMessage('cooldown', {
      minutes: cooldown.minutesLeft,
      hours: RATE_LIMIT_COOLDOWN_MS / 3600000,
    })
    return
  }

  if (!auto) {
    const wait = watcher.getManualWait()
    if (wait.blocked) {
      console.warn(`[scan] 距上次扫描不足最小间隔，还需 ${wait.minutesLeft} 分钟`)
      watcher.reportMessage('manualTooSoon', {
        minutes: wait.minutesLeft,
        hours: MANUAL_SCAN_MIN_INTERVAL_MS / 3600000,
      })
      return
    }
  }

  console.log(`[scan] 开始扫描（${auto ? '自动触发' : '手动触发'}）`)
  // 不 await：扫描可能持续十几分钟，界面靠进度事件更新。
  // 结束后重排下一次自动扫描 —— 计时从「扫描完成」开始，所以必须在这里排。
  void watcher.scan({ auto }).finally(() => {
    scheduleNextScan()
  })
}

function stopScheduler(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer)
    schedulerTimer = null
  }
}

/**
 * 登录成功后的统一入口：排定下一次自动扫描。
 * （可能已经超过 10 小时，scheduleNextScan 会立即补扫）
 */
function onLoggedIn(): void {
  scheduleNextScan()
}

/**
 * 安排下一次自动扫描。
 *
 * 计时基准是 `lastScanAt`（= **扫描完成**的时刻），不是开始的时刻。
 * 每次扫描结束后、以及每次登录/启动时都会重新调用它。
 */
function scheduleNextScan(): void {
  stopScheduler()

  if (auth.getState().status !== 'logged-in') {
    console.log('[scheduler] 未登录，不排定自动扫描')
    return
  }

  const cooldown = watcher.getCooldown()
  if (cooldown.blocked) {
    // 冷却期内不排扫描，改为稍后重新评估
    const delay = Math.min(cooldown.minutesLeft * 60_000, 3_600_000)
    console.log(`[scheduler] 处于限流冷却期（还剩 ${cooldown.minutesLeft} 分钟），暂不排定`)
    schedulerTimer = setTimeout(() => {
      schedulerTimer = null
      scheduleNextScan()
    }, delay)
    return
  }

  const left = watcher.msUntilAutoScan()
  if (left === null) {
    console.log('[scheduler] 还没有完成过任何扫描，等待用户手动开始首次扫描')
    return
  }
  if (left <= 0) {
    console.log('[scheduler] 距上次扫描已超过设定间隔，立即自动扫描')
    startScan(true)
    return
  }

  // setTimeout 的最大延时约 24.8 天；这里再额外封顶 6 小时，
  // 免得长时间挂机时因为系统休眠/时钟跳变而错过触发点。
  const delay = Math.min(left, 6 * 3_600_000)
  schedulerTimer = setTimeout(() => {
    schedulerTimer = null
    scheduleNextScan()
  }, delay)
  console.log(`[scheduler] 下次自动扫描将在 ${Math.round(left / 60000)} 分钟后`)
}

// ---------------------------------------------------------------------------
// 托盘
// ---------------------------------------------------------------------------

/** 托盘菜单文案。只有两条，所以直接在主进程里带一份最小翻译表。 */
const TRAY_LABELS: Record<string, { tooltip: string; show: string; quit: string }> = {
  zh: { tooltip: APP_NAME, show: '显示主界面', quit: '退出' },
  ja: { tooltip: APP_NAME, show: 'メイン画面を表示', quit: '終了' },
  en: { tooltip: APP_NAME, show: 'Show window', quit: 'Quit' },
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function refreshTrayMenu(): void {
  if (!tray) return
  const labels = TRAY_LABELS[loadSettings().lang] ?? TRAY_LABELS.zh
  tray.setContextMenu(
    Menu.buildFromTemplate([
      // 只保留两项：显示主界面 / 退出。
      // 刻意**不放「立即扫描」** —— 扫描有 2 小时最小间隔，
      // 放在托盘里会绕过界面上"按钮置灰"的限制，也容易误触。
      { label: labels.show, click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: labels.quit,
        click: () => {
          // ★ 必须先置位：否则会被 window 的 close 处理器拦下来（隐藏而不是退出）
          quitting = true
          app.quit()
        },
      },
    ]),
  )
}

function createTray(): void {
  const image = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  if (image.isEmpty()) {
    console.warn('[tray] 托盘图标解码失败，托盘功能不可用（不影响其他功能）')
    return
  }
  tray = new Tray(image)
  tray.setToolTip(TRAY_LABELS[loadSettings().lang]?.tooltip ?? TRAY_LABELS.zh.tooltip)
  refreshTrayMenu()
  // 双击托盘图标 = 显示主界面（Windows 上的习惯操作）
  tray.on('double-click', () => showMainWindow())
  console.log('[tray] 托盘图标已创建；关闭窗口将隐藏到托盘')
}

// ---------------------------------------------------------------------------
// ★ 关闭硬件加速（必须在 app ready 之前调用）
// ---------------------------------------------------------------------------
// 为什么这么做：我们的界面只是表单、列表和文本差异高亮，没有任何需要 GPU 合成的
// 动画或 3D。对一个可能连续挂机数天的监控工具来说，软件渲染更省资源，
// 也免去了各家显卡驱动带来的渲染差异。
//
// ⚠ 但必须说清楚：**这不能防止「GPU 进程启动失败」那类崩溃**。
//   实测与上游报告都表明，即便加了 --disable-gpu，Chromium 仍会启动 GPU 子进程，
//   而该子进程会在极早期初始化阶段失败退出（见下一段与 docs/DECISIONS.md 5.8）。
//   不要误以为这一行能治那个毛病。
app.disableHardwareAcceleration()

// ---------------------------------------------------------------------------
// 故障排查开关：VRCBW_DISABLE_GPU_SANDBOX=1
// ---------------------------------------------------------------------------
// 某些 Windows 机器上，Chromium 的 GPU 子进程沙箱（AppContainer / LPAC）无法启动，
// 表现为应用启动即退出、终端刷屏 `GPU process isn't usable. Goodbye.`，
// 而且报错信息完全指向显卡，极易误判。
//
// 上游仍在处理该问题（electron/electron#51761），目前可用的绕过方式是只关闭
// GPU 子进程的沙箱（渲染进程的沙箱仍然保留）。
//
// 保留这个开关有两个目的：让遇到该问题的用户能立刻用起来；也让我们排查时
// 能一步确认症状是否属于这一类。
if (process.env['VRCBW_DISABLE_GPU_SANDBOX'] === '1') {
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  console.warn('[main] 已按 VRCBW_DISABLE_GPU_SANDBOX=1 关闭 GPU 进程沙箱（故障排查模式）')
}

// ---------------------------------------------------------------------------
// 故障排查开关（二）：VRCBW_DISABLE_SANDBOX=1
// ---------------------------------------------------------------------------
// ⚠⚠ 这是本项目里唯一一处**真正的安全降级**：它会连渲染进程的沙箱一起关掉。
//
// 为什么它存在：Chromium 要求浏览器进程运行在「普通 Medium 完整性 + 已过滤的
// 用户令牌」下，才能用受限令牌创建子进程。如果进程被**提权**（High）或运行在
// **受限令牌**里（Low），那么 GPU 进程和渲染进程**都创建不出来**，报
// `error_code=18` / `launch-failed`，表现就是「窗口不出现 / 一片黑」。
// 上游记录：electron/electron#49167。这种情况下只有 --no-sandbox 能让应用起来。
//
// 正确的解法是**在普通（非提权）上下文里运行**，而不是关掉沙箱。
// 所以这个开关只用于排查和临时自救，**绝不要让它成为默认行为，也不要带着它发布**。
if (process.env['VRCBW_DISABLE_SANDBOX'] === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  console.warn(
    '[main] ⚠⚠ 已按 VRCBW_DISABLE_SANDBOX=1 关闭渲染进程沙箱 —— 这是安全降级，' +
      '仅供故障排查/临时自救，不要用于日常使用或发布。'
  )
}

// --- 单实例锁 ---
// 现在是为了避免重复开窗；将来扫描调度器上线后，这是防止"两个实例同时扫描"
// 把请求量翻倍、把账号推向限流的关键保障。
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  console.log('[main] 已有实例在运行，本次启动退出')
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    /*
     * ★ 支持 `VRCBioWatcher.exe --quit`：让"从外面把正在运行的实例关掉"成为可能。
     *
     * 为什么需要：本程序默认「关窗口 = 收进托盘继续后台运行」，
     * 所以安装程序/卸载程序发来的普通关闭请求会被我们拦下来（它会先
     * taskkill /IM，再 taskkill /F 强杀）。有了这个开关，任何脚本
     * （包括将来可能加进安装包的 NSIS 钩子）都能**优雅地**让它退出，
     * 而不是被强杀。
     */
    if (argv.includes('--quit')) {
      console.log('[main] 收到 --quit：正在退出')
      quitting = true
      app.quit()
      return
    }
    // 否则把已经运行的实例叫到前台
    showMainWindow()
  })

  void app.whenReady().then(() => {
    console.log(`[main] Electron ${process.versions.electron} / Chromium ${process.versions.chrome} / Node ${process.versions.node}`)
    console.log(`[main] 数据目录: ${app.getPath('userData')}`)
    console.log('[main] 硬件加速: 已关闭（软件渲染）')

    // 主题必须在窗口创建之前设好，界面的 prefers-color-scheme 才会在首次绘制时正确
    const settings = loadSettings()
    nativeTheme.themeSource = settings.theme
    console.log(`[main] 主题: ${settings.theme}`)

    // 把「开机自启」的期望状态同步给系统（打包版才会真正生效）
    applyAutoLaunch(settings.autoLaunch)

    registerIpcHandlers()

    // 先留下「主进程已就绪」的证据，再创建窗口。
    // 这样万一窗口创建阶段就崩了，也能从报告里看出断在哪一步。
    updateDevReport({
      mainStarted: true,
      hardwareAcceleration: false,
      systemInfo: collectSystemInfo(),
    })

    // 先建托盘：窗口的"以最小化启动"依赖托盘是否存在
    // （托盘创建失败时不能隐藏窗口，否则用户没有任何办法唤出界面）
    createTray()
    createWindow(settings.startMinimized && Boolean(tray))

    // 主动恢复一次会话（不等界面来问）：
    // 「启动时若距上次扫描已超过 10 小时就自动扫描」不应该依赖界面是否加载成功。
    // auth.restore() 内部是记忆化的，界面稍后再问会拿到同一个结果，不会重复请求。
    void auth.restore().then((state) => {
      syncActiveAccount(state)
      if (state.status === 'logged-in') onLoggedIn()
      else console.log('[main] 未登录，等待用户登录后再排定扫描')
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(false)
    })
  })

  // 托盘常驻：关掉窗口不等于退出应用。
  // 但托盘不可用时必须照常退出，否则用户没有别的办法结束进程（见 close 处理器）。
  app.on('window-all-closed', () => {
    if (tray) {
      console.log('[main] 所有窗口已关闭；应用继续在托盘中运行')
    } else {
      console.log('[main] 所有窗口已关闭，且托盘不可用 → 退出应用')
      app.quit()
    }
  })

  // 兜底：任何路径触发的退出都要放行 close 处理器，否则窗口会拦下退出
  app.on('before-quit', () => {
    quitting = true
  })
}
