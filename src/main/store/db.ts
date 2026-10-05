import { app, safeStorage } from 'electron'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { loadSettings, saveSettings } from '../settings'
import type {
  ChangeEvent,
  ChangeField,
  FriendRecord,
  ScanWarning,
} from '../../shared/types'

/**
 * 本地数据存储（**按账号隔离**）。
 *
 * ## 为什么必须按账号隔离
 *
 * 早期版本把所有好友数据写在同一份文件里，结果退出登录、换账号登录后，
 * 界面上显示的仍然是**上一个账号**的好友 —— 这是严重 bug：数据串号。
 *
 * 现在的结构是每个账号一个目录：
 *
 *   `%APPDATA%/vrcbw/data/<userId>/store.json`   （明文，默认）
 *   `%APPDATA%/vrcbw/data/<userId>/store.bin`    （开启加密时，DPAPI 密文）
 *
 * 当前账号由 `setActiveAccount()` 指定；未登录时**不读也不写任何数据**，
 * 所有查询返回空 —— 界面上也就看不到任何好友。
 *
 * ## 为什么把事件也从 JSONL 改成同一个文档
 *
 * 早先用的是「friends.json + events.jsonl（只追加）」。改成单一文档有两个原因：
 *   1. **加密**：加密一个只追加文件要么每次重写整体、要么另存索引，
 *      不如整体作为一个文档来得干净（加密、原子写、迁移都只有一条路径）
 *   2. **性能**：事件数统计以前每次都要把整个文件读一遍解析；
 *      现在有内存缓存，同一次会话内不再重复读盘
 *
 * 断电安全没有变差：写入仍然是「先写临时文件再改名」的原子替换，
 * 要么是旧的完整文件、要么是新的完整文件，不会出现半个文件。
 *
 * ## 注意
 * - 首次扫描只建立基线，**不写事件**（包括不写"新好友"事件），否则第一轮会塞进几百条噪音
 * - 加密开启后，数据**与当前 Windows 账户绑定**：换机器/换用户都解不开，
 *   也不要把 data 目录当备份到处拷（这是加密的必然代价，设置页里有说明）
 */

export type { FriendRecord }

export interface ScanStats {
  total: number
  scanned: number
  skipped: number
  changes: number
}

export interface Store {
  version: number
  friends: Record<string, FriendRecord>
  /** 变更事件，按时间**从旧到新**存放 */
  events: ChangeEvent[]
  lastScanAt: string | null
  lastScanStats: ScanStats | null
  /**
   * 上次**尝试**扫描的时间（不管是成功、失败还是被中断）。
   *
   * 为什么除了 lastScanAt 还要有这个：`lastScanAt` 只在扫描真正**跑完**时才更新。
   * 如果拉好友名单持续失败（例如 cookie 过期），`lastScanAt` 一直不变，
   * 调度器就会认为"已到期"→ 立刻重试 → 再失败 → 再重试……
   * **那就成了无限重试的请求风暴**，正是本项目最需要避免的行为。
   * 所以自动扫描的计时取 `max(lastScanAt, lastScanAttemptAt)`。
   *
   * 而「手动最小间隔」仍然只看 `lastScanAt`（完成时间），
   * 这样一次失败不会被罚站 10 小时，用户手动重试依然可行。
   */
  lastScanAttemptAt: string | null
  /**
   * 上次触发限流（429）的时间。非空即进入冷却期，期间拒绝开始新的扫描。
   * 放在数据文件里而不是内存里：冷却期必须**跨重启有效**。
   */
  lastRateLimitAt: string | null
  /**
   * 上一轮扫描的异常记录（限流 / 会话失效 / 大面积失败 / 跳过了解除判定）。
   * 正常完成时清空。
   *
   * 为什么要持久化：扫描跑在后台、窗口常常是关着的，
   * 只弹一次通知的话用户没看到就永远不知道"那轮其实全失败了"。
   */
  lastScanWarning: ScanWarning | null
}

export function emptyStore(): Store {
  return {
    version: 1,
    friends: {},
    events: [],
    lastScanAt: null,
    lastScanStats: null,
    lastScanAttemptAt: null,
    lastRateLimitAt: null,
    lastScanWarning: null,
  }
}

// ---------------------------------------------------------------------------
// 当前账号
// ---------------------------------------------------------------------------

let activeAccount: string | null = null
let cache: Store | null = null

/** 切换当前账号；传 null 表示已退出登录。会清空缓存，避免读到上一个账号的数据。 */
export function setActiveAccount(userId: string | null): void {
  if (activeAccount === userId) return
  console.log(`[data] 当前账号切换为 ${userId ?? '（未登录）'}`)
  activeAccount = userId
  cache = null
  if (userId) migrateLegacyData()
}

/**
 * 一次性迁移：把旧版本（**未按账号隔离**）的 `data/friends.json` + `data/events.jsonl`
 * 搬进当前账号的目录。
 *
 * 为什么要做：旧版本把所有数据写在 `data/` 根下、没有账号概念。
 * 不迁移的话，用户升级后 246 个好友的基线会"凭空消失"，只能重新扫一遍（约 13 分钟），
 * 而且 `firstSeenAt` 这类历史也没了。
 *
 * 安全性（三条都要满足才会动手）：
 *   1. 当前**已登录**（知道该迁给谁）
 *   2. 该账号目录里**还没有任何数据文件** —— 绝不覆盖已有的新数据
 *   3. 旧文件确实存在
 *
 * 迁移后把旧文件**改名**为 `*.migrated` 而不是删除：既防止重复迁移，
 * 又保证万一迁错了原始数据还在（只是名字变了）。
 */
function migrateLegacyData(): boolean {
  const dir = accountDir()
  if (!dir) return false
  const targetPlain = join(dir, 'store.json')
  const targetEnc = join(dir, 'store.bin')
  if (existsSync(targetPlain) || existsSync(targetEnc)) return false

  const base = join(app.getPath('userData'), 'data')
  const legacyFriends = join(base, 'friends.json')
  const legacyEvents = join(base, 'events.jsonl')
  if (!existsSync(legacyFriends)) return false

  try {
    const legacy = JSON.parse(readFileSync(legacyFriends, 'utf8')) as {
      friends?: Record<string, FriendRecord>
      lastScanAt?: string | null
      lastScanStats?: ScanStats | null
      lastRateLimitAt?: string | null
    }

    const events: ChangeEvent[] = []
    if (existsSync(legacyEvents)) {
      for (const line of readFileSync(legacyEvents, 'utf8').split('\n')) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        try {
          events.push(JSON.parse(trimmed) as ChangeEvent)
        } catch {
          /* 单行损坏就跳过，不要因为一行坏掉放弃整次迁移 */
        }
      }
    }

    saveStore({
      version: 1,
      friends: legacy.friends && typeof legacy.friends === 'object' ? legacy.friends : {},
      events,
      lastScanAt: legacy.lastScanAt ?? null,
      lastScanStats: legacy.lastScanStats ?? null,
      // 旧格式没有这个字段：把完成时间当作尝试时间，语义上最接近
      lastScanAttemptAt: legacy.lastScanAt ?? null,
      lastRateLimitAt: legacy.lastRateLimitAt ?? null,
      lastScanWarning: null,
    })

    renameSync(legacyFriends, `${legacyFriends}.migrated`)
    if (existsSync(legacyEvents)) renameSync(legacyEvents, `${legacyEvents}.migrated`)
    console.log(
      `[data] 已把旧版本数据迁移到账号 ${activeAccount} 下（${Object.keys(legacy.friends ?? {}).length} 个好友、` +
        `${events.length} 条事件）；旧文件改名为 .migrated 保留`,
    )
    return true
  } catch (err) {
    console.warn(
      '[data] 旧数据迁移失败，将按空数据启动：',
      err instanceof Error ? err.message : err,
    )
    return false
  }
}

export function getActiveAccount(): string | null {
  return activeAccount
}

/**
 * 把 VRChat 用户 id 变成安全的目录名。
 * 正常 id 形如 `usr_1a2b3c4d-...`，只含 `[A-Za-z0-9_-]`；
 * 万一出现别的字符（或将来格式变化），退化成哈希，绝不拼出路径穿越。
 */
function safeDirName(userId: string): string {
  const cleaned = userId.replace(/[^A-Za-z0-9_-]/g, '')
  if (cleaned === userId && cleaned.length > 0 && cleaned.length <= 64) return cleaned
  return `h_${createHash('sha256').update(userId).digest('hex').slice(0, 32)}`
}

function accountDir(): string | null {
  if (!activeAccount) return null
  return join(dataRoot(), safeDirName(activeAccount))
}

/**
 * 数据根目录。用户可以在设置里改（很多人不愿意把数据放在 C 盘）。
 *
 * 默认 `%APPDATA%/vrcbw/data`。
 * ⚠ 注意：**设置文件和会话凭据仍在 userData 下**，只有好友数据/事件会跟着这个设置走。
 *   这是有意的 —— 设置本身是"用来找到数据"的东西，它必须待在一个固定的地方，
 *   否则就成了先有鸡还是先有蛋。
 */
export function dataRoot(): string {
  const custom = loadSettings().dataDir
  return custom && custom.trim() !== '' ? custom : defaultDataRoot()
}

/** 默认数据根目录（用于界面上显示"默认位置"和"恢复默认"） */
export function defaultDataRoot(): string {
  return join(app.getPath('userData'), 'data')
}

function plainFile(): string | null {
  const dir = accountDir()
  return dir ? join(dir, 'store.json') : null
}

function encryptedFile(): string | null {
  const dir = accountDir()
  return dir ? join(dir, 'store.bin') : null
}

/** 系统加密是否可用（Windows 上是 DPAPI） */
export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** 用户是否开启了「加密本地数据」，且系统加密确实可用 */
function encryptionEnabled(): boolean {
  return loadSettings().encryptData && isEncryptionAvailable()
}

/** 数据目录（当前账号），供设置页显示 */
export function accountDirPath(): string | null {
  return accountDir()
}

// ---------------------------------------------------------------------------
// 数据目录迁移
// ---------------------------------------------------------------------------

export interface MoveDataResult {
  ok: boolean
  /** 给用户看的结果说明 */
  message: string
  /** 迁移的文件数与字节数 */
  files: number
  bytes: number
}

/** 递归统计目录里的文件数与总字节数（用于迁移后的校验） */
function measureDir(dir: string): { files: number; bytes: number } {
  let files = 0
  let bytes = 0
  if (!existsSync(dir)) return { files, bytes }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = measureDir(full)
      files += sub.files
      bytes += sub.bytes
    } else if (entry.isFile()) {
      files++
      bytes += statSync(full).size
    }
  }
  return { files, bytes }
}

/**
 * 把数据目录整体搬到新位置。
 *
 * ## 为什么是「复制 → 校验 → 才删旧」而不是直接改名
 *
 * 用户可能在**不同的磁盘/分区**上选目录，那时 `rename` 会直接失败（EXDEV）；
 * 而且就算同一分区，一次大目录的改名如果中途失败，数据就处在说不清的状态。
 * 复制有中间态：**复制完成并校验通过之前，旧数据一直是完整可用的**。
 *
 * 校验方式是递归比对**文件数 + 总字节数**；不一致就保留两边并报错，
 * 让用户自己决定怎么办 —— 宁可留两份，也不能删掉唯一一份。
 */
export function moveDataRoot(newRoot: string): MoveDataResult {
  const target = newRoot.trim()
  if (target === '') return { ok: false, message: '目标目录为空', files: 0, bytes: 0 }

  const from = resolve(dataRoot())
  const to = resolve(target)

  if (from === to) return { ok: false, message: '目标目录与当前位置相同', files: 0, bytes: 0 }
  // 目标在源里面（或源在目标里面）都会让复制递归失控，必须挡住
  if (to.startsWith(from + sep)) {
    return { ok: false, message: '目标目录不能位于当前数据目录内部', files: 0, bytes: 0 }
  }
  if (from.startsWith(to + sep)) {
    return { ok: false, message: '目标目录不能是当前数据目录的上级目录', files: 0, bytes: 0 }
  }

  try {
    mkdirSync(to, { recursive: true })
  } catch (err) {
    return {
      ok: false,
      message: `无法创建目标目录：${err instanceof Error ? err.message : String(err)}`,
      files: 0,
      bytes: 0,
    }
  }

  const before = measureDir(from)

  // 逐个顶层条目复制（等价于把源目录的内容搬进目标目录）
  if (existsSync(from)) {
    try {
      for (const entry of readdirSync(from, { withFileTypes: true })) {
        cpSync(join(from, entry.name), join(to, entry.name), { recursive: true, force: true })
      }
    } catch (err) {
      return {
        ok: false,
        message: `复制失败：${err instanceof Error ? err.message : String(err)}（旧数据仍完好无损）`,
        files: 0,
        bytes: 0,
      }
    }
  }

  const after = measureDir(to)
  if (after.files !== before.files || after.bytes !== before.bytes) {
    return {
      ok: false,
      message:
        `校验失败：期望 ${before.files} 个文件 / ${before.bytes} 字节，` +
        `实际 ${after.files} 个 / ${after.bytes} 字节。旧数据未删除，请检查后重试。`,
      files: after.files,
      bytes: after.bytes,
    }
  }

  // 校验通过才删旧（目标与默认位置相同时不删，那本来就是同一份）
  try {
    if (from !== defaultDataRoot() && existsSync(from)) {
      rmSync(from, { recursive: true, force: true })
    }
  } catch (err) {
    // 删不掉不是致命错误：数据已经在新位置了，旧的留着占点空间而已
    console.warn('[data] 旧数据目录删除失败（数据已在新位置，不影响使用）：', err)
  }

  saveSettings({ dataDir: to })
  // 路径变了，缓存必须丢掉，否则还在用旧路径读出来的对象
  cache = null

  console.log(
    `[data] 数据目录已迁移：${from} → ${to}（${after.files} 个文件 / ${after.bytes} 字节）`,
  )
  return {
    ok: true,
    message: '迁移完成',
    files: after.files,
    bytes: after.bytes,
  }
}

/** 恢复默认数据目录（把数据搬回 userData/data） */
export function resetDataRoot(): MoveDataResult {
  return moveDataRoot(defaultDataRoot())
}

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------

function normalizeStore(parsed: Partial<Store> | null): Store {
  const base = emptyStore()
  if (!parsed || typeof parsed !== 'object') return base
  return {
    version: 1,
    friends: parsed.friends && typeof parsed.friends === 'object' ? parsed.friends : {},
    events: Array.isArray(parsed.events) ? parsed.events : [],
    lastScanAt: parsed.lastScanAt ?? null,
    lastScanStats: parsed.lastScanStats ?? null,
    lastScanAttemptAt: parsed.lastScanAttemptAt ?? null,
    lastRateLimitAt: parsed.lastRateLimitAt ?? null,
    lastScanWarning: parsed.lastScanWarning ?? null,
  }
}

/**
 * 读取当前账号的数据。未登录时返回空数据（**不碰磁盘**）。
 *
 * 有内存缓存：同一次会话内反复调用不会重复读盘、重复解析。
 */
export function loadStore(): Store {
  if (!activeAccount) return emptyStore()
  if (cache) return cache

  const plain = plainFile()
  const encrypted = encryptedFile()
  if (!plain || !encrypted) return emptyStore()

  // 加密文件优先：用户可能刚切换过加密开关，而旧格式的文件还没清掉
  try {
    if (existsSync(encrypted) && isEncryptionAvailable()) {
      const text = safeStorage.decryptString(readFileSync(encrypted))
      cache = normalizeStore(JSON.parse(text) as Partial<Store>)
      return cache
    }
  } catch (err) {
    console.warn(
      '[data] 加密数据无法解密（换了 Windows 账户，或加密开关与文件不匹配？），将当作空数据：',
      err instanceof Error ? err.message : err,
    )
    cache = emptyStore()
    return cache
  }

  try {
    if (existsSync(plain)) {
      cache = normalizeStore(JSON.parse(readFileSync(plain, 'utf8')) as Partial<Store>)
      return cache
    }
  } catch (err) {
    console.warn('[data] 数据文件损坏，将当作空数据：', err instanceof Error ? err.message : err)
  }

  cache = emptyStore()
  return cache
}

/** 原子写入当前账号的数据。未登录时**什么也不写**。 */
export function saveStore(store: Store): void {
  const plain = plainFile()
  const encrypted = encryptedFile()
  if (!plain || !encrypted) {
    console.warn('[data] 未登录，拒绝写入数据')
    return
  }

  mkdirSync(dirname(plain), { recursive: true })
  const text = JSON.stringify(store, null, 2)

  if (encryptionEnabled()) {
    // 先写临时文件再改名：断电只会留下旧的完整文件，不会留下半个密文
    const tmp = `${encrypted}.tmp`
    writeFileSync(tmp, safeStorage.encryptString(text))
    renameSync(tmp, encrypted)
    // 清掉可能存在的明文残留 —— 开了加密却还留着明文副本，等于没加密
    if (existsSync(plain)) rmSync(plain, { force: true })
  } else {
    const tmp = `${plain}.tmp`
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, plain)
    if (existsSync(encrypted)) rmSync(encrypted, { force: true })
  }

  cache = store
}

// ---------------------------------------------------------------------------
// 事件与指纹
// ---------------------------------------------------------------------------

/** 内容指纹：只要这三个字段没变，就认为没有变化 */
export function fingerprintOf(displayName: string, bio: string, bioLinks: string): string {
  return createHash('sha256')
    .update(`${displayName}\u0000${bio}\u0000${bioLinks}`)
    .digest('hex')
}

export function makeEventId(userId: string, field: ChangeField, at: string): string {
  return createHash('sha1').update(`${userId}|${field}|${at}`).digest('hex').slice(0, 16)
}

/** 最近的事件，按时间倒序（最新的在前） */
export function recentEvents(limit = 500): ChangeEvent[] {
  const all = loadStore().events
  const out: ChangeEvent[] = []
  for (let i = all.length - 1; i >= 0 && out.length < limit; i--) out.push(all[i])
  return out
}

export function eventCount(): number {
  return loadStore().events.length
}

/**
 * 判断一条事件是不是「注入模拟变化」造出来的假数据。
 * 早期注入的事件没有 test 标记，所以还要靠内容特征识别。
 */
export function isTestEvent(e: ChangeEvent): boolean {
  if (e.test === true) return true
  return e.after.includes('（模拟变化 ') || e.before.includes('（模拟）这是旧的一段')
}

/**
 * 删除所有模拟注入的事件，并把它们造成的副作用一并回滚。
 *
 * 只删事件是不够的：注入的简介变化同时改写了好友记录里的 bio 和变化次数，
 * 不清掉的话好友列表会一直显示那段假简介。
 */
export function removeTestEvents(): number {
  const store = loadStore()
  const removed = store.events.filter(isTestEvent)
  if (removed.length === 0) return 0

  store.events = store.events.filter((e) => !isTestEvent(e))

  // 回滚副作用：**从新到旧**处理，因为多次注入是链式叠加的
  // （第 2 次的 before 就是第 1 次的 after），倒序才能一路还原回去。
  removed.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  for (const ev of removed) {
    const friend = store.friends[ev.userId]
    if (!friend) continue
    if (ev.field === 'bio' && friend.bio === ev.after) {
      store.friends[ev.userId] = {
        ...friend,
        bio: ev.before,
        changeCount: Math.max(0, friend.changeCount - 1),
        lastChangedAt: null,
        fingerprint: fingerprintOf(friend.displayName, ev.before, friend.bioLinks),
      }
    } else if (ev.field === 'friendRemoved') {
      store.friends[ev.userId] = { ...friend, removed: false, removedAt: null }
    }
  }
  saveStore(store)
  console.log(`[data] 已清除 ${removed.length} 条模拟注入的记录并回滚其影响`)
  return removed.length
}
