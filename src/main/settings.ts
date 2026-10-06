import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppSettings, LanguagePreference } from '../shared/types'

/**
 * 应用设置（很小的一份 JSON，放在 userData 下）。
 *
 * 为什么设置由主进程持有而不是界面自己存 localStorage：
 *   主题需要在**首次绘制之前**生效，否则深色模式下会先闪一下白底。
 *   主进程设置 `nativeTheme.themeSource` 后，界面的 prefers-color-scheme
 *   媒体查询在加载前就已确定，不存在闪烁。详见 styles.css 顶部注释。
 *
 * ⚠ `AppSettings` 的定义**只有一份**，在 shared/types.ts —— 主进程和界面共用它。
 *   这里以前重复写了一份一模一样的接口，加字段时两边容易漏一处，
 *   于是合并掉了。子类型（ThemePreference / FriendSortKey…）也一并从那里引入。
 */
/** 默认**跟随系统**；每页 50 条（对齐 VRCX 的习惯） */
const DEFAULTS: AppSettings = {
  theme: 'system',
  lang: 'zh',
  pageSize: 50,
  autoPageSizeFriends: true,
  autoPageSizeChanges: true,
  showRemovedFriends: false,
  friendsSortKey: 'friendNumber',
  friendsSortAsc: true,
  friendsQuery: '',
  changesFilter: 'all',
  changesQuery: '',
  fontScale: 1,
  fontFamily: '',
  dataDir: '',
  autoLaunch: false,
  startMinimized: false,
  minimizeToTray: true,
  hardwareAcceleration: true,
  windowBounds: null,
  windowMaximized: false,
  encryptData: false,
}

const SORT_KEYS: AppSettings['friendsSortKey'][] = ['friendNumber', 'displayName', 'lastChangedAt']
const FILTER_KEYS: AppSettings['changesFilter'][] = ['all', 'displayName', 'bio', 'relation']

/**
 * 校验并修正窗口位置。
 *
 * 只做**结构**校验（四个数都得是有限数）；"是否还在屏幕上"必须等 app ready
 * 之后用 screen 模块判断，那部分在 main/index.ts 里做。
 */
function normalizeWindowBounds(value: unknown): AppSettings['windowBounds'] {
  if (value === null || typeof value !== 'object') return null
  const b = value as Partial<Record<'x' | 'y' | 'width' | 'height', unknown>>
  const nums = [b.x, b.y, b.width, b.height]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  return {
    x: Math.round(b.x as number),
    y: Math.round(b.y as number),
    width: Math.max(600, Math.round(b.width as number)),
    height: Math.max(400, Math.round(b.height as number)),
  }
}

/** 每页条数的允许范围：太小没意义，太大又回到"一屏几百条"的卡顿问题 */
export const PAGE_SIZE_MIN = 10
export const PAGE_SIZE_MAX = 500

/** 字号缩放范围：太小看不清，太大布局会散 */
export const FONT_SCALE_MIN = 0.8
export const FONT_SCALE_MAX = 1.8

/**
 * 从「可能是完整字体栈」的字符串里取出第一个字体名。
 *
 * 设置里只存字体名（如 `MiSans`）。做这个归一化是因为早期版本存过完整字体栈，
 * 用户如果手工改过 settings.json 也可能留下带逗号的值 —— 那时取第一个即可。
 */
function normalizeFontFamily(value: unknown): string {
  if (typeof value !== 'string') return ''
  const first = value.split(',')[0]?.trim() ?? ''
  return first.replace(/^["']|["']$/g, '').replace(/["';{}<>\\]/g, '').trim()
}

/**
 * 首次运行时按**系统语言**决定界面语言。
 *
 * 规则（用户指定）：
 *   zh* → 中文、ja* → 日语、en* → 英语，**其他语言一律英语**
 *   （宁可给英文也不要给一个用户完全看不懂的语言）
 *
 * ⚠ 只在**第一次运行**（settings.json 还不存在）时生效。
 *   用户以后在设置里改过之后，就永远以他的选择为准。
 */
function detectDefaultLang(): LanguagePreference {
  let locale = ''
  try {
    // 例如 'zh-CN' / 'ja' / 'en-US' / 'de'
    locale = app.getLocale()
  } catch {
    locale = ''
  }
  const lower = locale.toLowerCase()
  if (lower.startsWith('zh')) return 'zh'
  if (lower.startsWith('ja')) return 'ja'
  if (lower.startsWith('en')) return 'en'
  return 'en'
}

let cache: AppSettings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): AppSettings {
  if (cache) return cache
  let firstRun = false
  try {
    const parsed = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<AppSettings>
    cache = { ...DEFAULTS, ...parsed }
  } catch (err) {
    // 文件不存在 = 首次运行；文件损坏则当作默认值（不打扰用户）
    firstRun = (err as NodeJS.ErrnoException | null)?.code === 'ENOENT'
    cache = { ...DEFAULTS }
  }
  if (firstRun) {
    // 只有第一次运行才按系统语言自动选；之后永远以用户的选择为准
    cache.lang = detectDefaultLang()
    console.log(`[settings] 首次运行：按系统语言自动选择界面语言 → ${cache.lang}`)
  }
  // 防御：文件被手工改坏时（例如 pageSize 写成字符串）也要能用
  if (typeof cache.pageSize !== 'number' || !Number.isFinite(cache.pageSize)) {
    cache.pageSize = DEFAULTS.pageSize
  }
  cache.pageSize = Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, Math.round(cache.pageSize)))
  if (typeof cache.fontScale !== 'number' || !Number.isFinite(cache.fontScale)) {
    cache.fontScale = DEFAULTS.fontScale
  }
  cache.fontScale = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, cache.fontScale))
  cache.fontFamily = normalizeFontFamily(cache.fontFamily)
  if (cache.lang !== 'zh' && cache.lang !== 'ja' && cache.lang !== 'en') {
    cache.lang = DEFAULTS.lang
  }
  if (typeof cache.encryptData !== 'boolean') cache.encryptData = DEFAULTS.encryptData
  /*
   * 兼容旧版的单一 `autoPageSize`：把它当作「好友列表」的选择沿用下来，
   * 变化记录用默认值。这样升级后用户原来的勾选状态不会丢。
   */
  const legacyCache = cache as { autoPageSize?: unknown }
  if (typeof cache.autoPageSizeFriends !== 'boolean') {
    cache.autoPageSizeFriends =
      typeof legacyCache.autoPageSize === 'boolean'
        ? legacyCache.autoPageSize
        : DEFAULTS.autoPageSizeFriends
  }
  if (typeof cache.autoPageSizeChanges !== 'boolean') {
    cache.autoPageSizeChanges = DEFAULTS.autoPageSizeChanges
  }
  delete legacyCache.autoPageSize
  if (typeof cache.showRemovedFriends !== 'boolean') {
    cache.showRemovedFriends = DEFAULTS.showRemovedFriends
  }
  if (typeof cache.dataDir !== 'string') cache.dataDir = DEFAULTS.dataDir
  if (typeof cache.autoLaunch !== 'boolean') cache.autoLaunch = DEFAULTS.autoLaunch
  if (typeof cache.startMinimized !== 'boolean') cache.startMinimized = DEFAULTS.startMinimized
  if (typeof cache.minimizeToTray !== 'boolean') cache.minimizeToTray = DEFAULTS.minimizeToTray
  if (typeof cache.hardwareAcceleration !== 'boolean') {
    cache.hardwareAcceleration = DEFAULTS.hardwareAcceleration
  }

  /* 界面状态（排序 / 搜索 / 筛选）与窗口位置：值非法就回退默认，
     免得界面拿到意外值（例如手工改坏 settings.json）。 */
  if (!SORT_KEYS.includes(cache.friendsSortKey)) cache.friendsSortKey = DEFAULTS.friendsSortKey
  if (typeof cache.friendsSortAsc !== 'boolean') cache.friendsSortAsc = DEFAULTS.friendsSortAsc
  if (typeof cache.friendsQuery !== 'string') cache.friendsQuery = DEFAULTS.friendsQuery
  if (!FILTER_KEYS.includes(cache.changesFilter)) cache.changesFilter = DEFAULTS.changesFilter
  if (typeof cache.changesQuery !== 'string') cache.changesQuery = DEFAULTS.changesQuery
  cache.windowBounds = normalizeWindowBounds(cache.windowBounds)
  if (typeof cache.windowMaximized !== 'boolean') cache.windowMaximized = DEFAULTS.windowMaximized
  return cache
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = { ...loadSettings(), ...patch }
  if (typeof next.pageSize === 'number' && Number.isFinite(next.pageSize)) {
    next.pageSize = Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, Math.round(next.pageSize)))
  } else {
    next.pageSize = DEFAULTS.pageSize
  }
  if (typeof next.fontScale === 'number' && Number.isFinite(next.fontScale)) {
    next.fontScale = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, next.fontScale))
  } else {
    next.fontScale = DEFAULTS.fontScale
  }
  if (typeof next.fontFamily !== 'string') next.fontFamily = DEFAULTS.fontFamily
  next.fontFamily = normalizeFontFamily(next.fontFamily)
  if (next.lang !== 'zh' && next.lang !== 'ja' && next.lang !== 'en') {
    next.lang = DEFAULTS.lang
  }
  if (typeof next.encryptData !== 'boolean') next.encryptData = DEFAULTS.encryptData
  const legacyNext = next as { autoPageSize?: unknown }
  if (typeof next.autoPageSizeFriends !== 'boolean') {
    next.autoPageSizeFriends = DEFAULTS.autoPageSizeFriends
  }
  if (typeof next.autoPageSizeChanges !== 'boolean') {
    next.autoPageSizeChanges = DEFAULTS.autoPageSizeChanges
  }
  delete legacyNext.autoPageSize
  if (typeof next.showRemovedFriends !== 'boolean') {
    next.showRemovedFriends = DEFAULTS.showRemovedFriends
  }
  if (typeof next.dataDir !== 'string') next.dataDir = DEFAULTS.dataDir
  if (typeof next.autoLaunch !== 'boolean') next.autoLaunch = DEFAULTS.autoLaunch
  if (typeof next.startMinimized !== 'boolean') next.startMinimized = DEFAULTS.startMinimized
  if (typeof next.minimizeToTray !== 'boolean') next.minimizeToTray = DEFAULTS.minimizeToTray
  if (typeof next.hardwareAcceleration !== 'boolean') {
    next.hardwareAcceleration = DEFAULTS.hardwareAcceleration
  }
  if (!SORT_KEYS.includes(next.friendsSortKey)) next.friendsSortKey = DEFAULTS.friendsSortKey
  if (typeof next.friendsSortAsc !== 'boolean') next.friendsSortAsc = DEFAULTS.friendsSortAsc
  if (typeof next.friendsQuery !== 'string') next.friendsQuery = DEFAULTS.friendsQuery
  if (!FILTER_KEYS.includes(next.changesFilter)) next.changesFilter = DEFAULTS.changesFilter
  if (typeof next.changesQuery !== 'string') next.changesQuery = DEFAULTS.changesQuery
  next.windowBounds = normalizeWindowBounds(next.windowBounds)
  if (typeof next.windowMaximized !== 'boolean') next.windowMaximized = DEFAULTS.windowMaximized
  cache = next
  const file = settingsFile()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(next, null, 2), 'utf8')
  return next
}
