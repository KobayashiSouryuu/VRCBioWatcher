import type { AuthManager } from './vrchat/auth'
import { VrchatClient } from './vrchat/client'
import { fingerprintOf, getActiveAccount, loadStore, makeEventId, saveStore, type Store } from './store/db'
import type {
  ChangeField,
  FriendRecord,
  ScanMessageCode,
  ScanOptions,
  ScanProgress,
} from '../shared/types'

/**
 * 扫描器：拉取全部好友资料 → 与上次比较 → 产生变更事件。
 *
 * 比对的四类变化：
 *   1. 简介 bio        2. 简介链接 bioLinks
 *   3. 昵称 displayName   4. 好友关系 friendAdded / friendRemoved
 *
 * ## 扫描顺序（依据 docs/DECISIONS.md 3.2）
 *   第 1 级：在线 + 活跃好友（正在线的人最可能刚改过资料）
 *   第 2 级：离线好友，按 last_activity 倒序
 *   兜底：  两边都没覆盖到的 id（防御性，正常应为 0）
 *
 * ⚠ 顺序在扫描开始前**一次性冻结**：如果中途有人上下线就重排，
 *   进度、去重、断点都会变得不可信。中途变化只影响**下一轮**。
 *
 * ⚠ 中途新加的好友不在冻结列表里 → 本轮不扫，下轮建立基线。
 *   中途解除好友 → /profile 仍可能返回 200（该端点对非好友开放），照常记录。
 *
 * ## 节奏（依据 3.3，2026-10 按用户要求重定）
 *
 * **每个好友之间固定间隔 3 秒，不分批次、没有批间暂停。**
 *
 * 为什么改成这样：原来是「1 秒间隔 + 每 50 人停 3 分钟」——那是**爆发式**的
 * （1 秒一个连着来 50 个，然后长时间空转）。现在是**匀速**的 3 秒一个。
 * 对限流器来说，匀速远比突发安全（令牌桶就是被突发打爆的），
 * 而且总耗时差不多：246 人 × 3 秒 ≈ 13 分钟。
 *
 * ⚠ 3 秒是**硬编码的安全下限**，不是"建议值"。VRChat 从未公布限流阈值，
 *   所以这个值是保守估计。改小它之前请先读 docs/DECISIONS.md 3.5。
 *
 * ## 熔断（依据 3.5）
 * 一见 429 立刻中断整轮（不重试、不跳过），并进入 **10 小时**冷却期。
 */

/** 好友之间的请求间隔。这是安全下限，不要为了"快一点"改小。 */
export const REQUEST_INTERVAL_MS = 3000

/** 自动扫描间隔：10 小时（从**扫描完成**时刻开始计时） */
export const AUTO_SCAN_INTERVAL_MS = 10 * 60 * 60 * 1000

/** 手动扫描的最小间隔：2 小时（同样从扫描完成时刻开始计时） */
export const MANUAL_SCAN_MIN_INTERVAL_MS = 2 * 60 * 60 * 1000

/**
 * 触发一次限流后的强制冷却：**10 小时**。
 *
 * 用户明确要求（他打算开源并给朋友用）：宁可一个月扫不了几次，
 * 也不要冒被限制的风险。**改小这个值之前请先重读 DECISIONS.md 3.5。**
 */
export const RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 60 * 1000

/**
 * 连续失败多少次就**主动中断本轮**。
 *
 * 场景：服务器挂了 / 断网。每个请求都要等到超时才失败，如果一路跑完 246 个好友，
 * 就是对着一个已经挂掉的服务连续敲两个多小时 —— 这恰恰是限流机制最反感的行为，
 * 而且结果毫无价值（全是跳过）。
 *
 * 10 次是权衡：正常扫描里偶尔出现几次 403/404（私密资料、已注销账号）很常见，
 * 不能因为零星失败就中断；而真正"服务器不可用"时失败是**连续**的，10 次足够区分。
 */
const MAX_CONSECUTIVE_FAILURES = 10

/**
 * 跳过率超过这个比例，就认为"这轮基本没扫到东西"，结果不可信。
 *
 * 为什么需要：全部失败时程序仍然会走到"扫描完成"，界面上会显示"0 变化" ——
 * 那是在**把失败伪装成'没有变化'**，比报错更危险（用户会以为一切正常）。
 */
const MOSTLY_FAILED_RATIO = 0.5

/** 单次列表请求的最大好友数 */
const FRIENDS_PAGE_SIZE = 100
/** 每扫描这么多人就落盘一次，避免中途退出丢掉进度 */
const SAVE_EVERY = 10

interface CurrentUserLike {
  id?: unknown
  friends?: unknown
  onlineFriends?: unknown
  activeFriends?: unknown
  offlineFriends?: unknown
}

interface ProfileLike {
  id?: unknown
  displayName?: unknown
  bio?: unknown
  bioLinks?: unknown
}

interface FriendListEntry {
  id?: unknown
  last_activity?: unknown
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 日志里用的字段中文名（日志是给开发者看的，固定中文即可） */
function fieldLabel(field: ChangeField): string {
  switch (field) {
    case 'bio':
      return '简介'
    case 'bioLinks':
      return '简介链接'
    case 'displayName':
      return '昵称'
    case 'friendAdded':
      return '加好友'
    case 'friendRemoved':
      return '删好友'
    default:
      return String(field)
  }
}

/** 距离某个时间点过了多久（毫秒）；无效时间为 Infinity */
function elapsedSince(iso: string | null): number {
  if (!iso) return Infinity
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return Infinity
  return Date.now() - t
}

export class Watcher {
  private running = false
  private stopRequested = false

  constructor(
    private readonly auth: AuthManager,
    private readonly emit: (progress: ScanProgress) => void,
  ) {}

  get isRunning(): boolean {
    return this.running
  }

  requestStop(): void {
    if (this.running) {
      this.stopRequested = true
      console.log('[scan] 收到停止请求，将在当前好友处理完后停止')
    }
  }

  /**
   * 供主进程推送一条状态到界面（例如「请先登录」）。
   *
   * ⚠ 只传**代码 + 参数**，不传中文句子：界面要支持中/日/英，
   *   主进程直接给中文的话，英文界面里会突然冒出一句中文。
   */
  reportMessage(code: ScanMessageCode, params?: Record<string, string | number>): void {
    this.progress({ phase: 'error', messageCode: code, messageParams: params })
  }

  // -------------------------------------------------------------------------
  // 调度计算（纯函数式查询，不启动定时器；定时器由主进程持有）
  // -------------------------------------------------------------------------

  /**
   * 当前是否处于 429 冷却期。
   * 冷却信息存在数据文件里，所以**重启软件不会绕过它**。
   */
  getCooldown(): { blocked: boolean; minutesLeft: number } {
    const left = RATE_LIMIT_COOLDOWN_MS - elapsedSince(loadStore().lastRateLimitAt)
    if (left <= 0) return { blocked: false, minutesLeft: 0 }
    return { blocked: true, minutesLeft: Math.ceil(left / 60000) }
  }

  /** 手动扫描是否被最小间隔挡住 */
  getManualWait(): { blocked: boolean; minutesLeft: number } {
    const left = MANUAL_SCAN_MIN_INTERVAL_MS - elapsedSince(loadStore().lastScanAt)
    // 从未扫描过（lastScanAt 为 null）时 elapsedSince 返回 Infinity，不算被挡
    if (left <= 0) return { blocked: false, minutesLeft: 0 }
    return { blocked: true, minutesLeft: Math.ceil(left / 60000) }
  }

  /**
   * 下次自动扫描的时间（ISO）；从未扫描过则返回 null（首次要用户手动点）。
   *
   * ⚠ 计时基准取 `max(lastScanAt, lastScanAttemptAt)`：
   *   - `lastScanAt`（完成）—— 用户要求「按最后一次扫描**结束**的时间算，无论怎么扫的」
   *   - `lastScanAttemptAt`（尝试）—— 防止**失败后立刻重试**形成请求风暴，见 db.ts 的说明
   */
  nextAutoScanAt(): string | null {
    const store = loadStore()
    const times = [store.lastScanAt, store.lastScanAttemptAt]
      .filter((x): x is string => typeof x === 'string')
      .map((x) => new Date(x).getTime())
      .filter((t) => Number.isFinite(t))
    if (times.length === 0) return null
    return new Date(Math.max(...times) + AUTO_SCAN_INTERVAL_MS).toISOString()
  }

  /** 距离下次自动扫描还有多少毫秒；到期返回 0，从未扫描过返回 null */
  msUntilAutoScan(): number | null {
    const next = this.nextAutoScanAt()
    if (!next) return null
    return Math.max(0, new Date(next).getTime() - Date.now())
  }

  /** 自动扫描的准入条件：已登录、不在扫描中、不在冷却期、并且确实到期了 */
  shouldAutoScan(loggedIn: boolean): boolean {
    if (!loggedIn || this.running) return false
    if (this.getCooldown().blocked) return false
    const left = this.msUntilAutoScan()
    return left !== null && left <= 0
  }

  // -------------------------------------------------------------------------

  /**
   * 打印一段带分隔线的日志块。
   *
   * 为什么不用一行一句：反馈问题时用户会直接复制终端内容，
   * 成块的日志一眼就能看出"这次扫描发生了什么"，比散落的行好读得多。
   */
  private logBlock(title: string, lines: [string, string][]): void {
    const bar = '─'.repeat(46)
    const out = [`\n${bar}`, `【${title}】`]
    for (const [key, value] of lines) out.push(`  ${key}：${value}`)
    out.push(bar)
    console.log(out.join('\n'))
  }

  /** 把毫秒变成"X 分 Y 秒" */
  private static formatDuration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
  }

  private progress(patch: Partial<ScanProgress>): void {
    this.emit({
      phase: 'idle',
      total: 0,
      done: 0,
      index: 0,
      changes: 0,
      skipped: 0,
      ...patch,
    })
  }

  /** 分页拉取离线好友（`offline=true` 只返回离线好友，这是实测结论，见 2.2） */
  private async fetchOfflineFriends(
    client: VrchatClient,
  ): Promise<{ entries: FriendListEntry[]; error?: string }> {
    const entries: FriendListEntry[] = []
    for (let offset = 0; offset < 5000; offset += FRIENDS_PAGE_SIZE) {
      const res = await client.request(
        'GET',
        `/auth/user/friends?n=${FRIENDS_PAGE_SIZE}&offset=${offset}&offline=true`,
      )
      if (res.status !== 200 || !Array.isArray(res.json)) {
        return { entries, error: VrchatClient.describeError(res) }
      }
      const page = res.json as FriendListEntry[]
      entries.push(...page)
      if (page.length < FRIENDS_PAGE_SIZE) break
    }
    return { entries }
  }

  /**
   * 字段迁移：给早期版本写入的记录补上 seq / removed / apiIndex / friendNumber。
   * 不做这一步的话，用户已经扫过的那一轮数据会缺少字段，界面上的列就是空的。
   */
  private migrate(store: Store): number {
    const records = Object.values(store.friends)
    let maxSeq = 0
    for (const f of records) {
      if (typeof f.seq === 'number' && f.seq > maxSeq) maxSeq = f.seq
    }
    if (maxSeq === 0 && records.length > 0) {
      const byFirstSeen = [...records].sort((a, b) =>
        String(a.firstSeenAt ?? '').localeCompare(String(b.firstSeenAt ?? '')),
      )
      byFirstSeen.forEach((f, i) => {
        f.seq = i + 1
      })
      maxSeq = byFirstSeen.length
      console.log(`[scan] 已为 ${maxSeq} 条历史记录补上本地序号`)
    }
    for (const f of records) {
      if (typeof f.removed !== 'boolean') f.removed = false
      if (f.removedAt === undefined) f.removedAt = null
      if (f.apiIndex === undefined) f.apiIndex = null
      if (f.friendNumber === undefined) f.friendNumber = null
    }
    return maxSeq
  }

  async scan(options: ScanOptions = {}): Promise<void> {
    if (this.running) {
      this.progress({ phase: 'error', messageCode: 'alreadyRunning' })
      return
    }
    this.running = true
    this.stopRequested = false

    const client = this.auth.getClient()
    /** 日志用：当前账号信息 */
    const authState = this.auth.getState()
    const activeAccount = getActiveAccount()
    const store: Store = loadStore()

    // ★ 先记录"尝试过"，再开始干活。
    //   放在最前面是为了覆盖所有提前返回的失败路径（拉名单失败、好友为空等）：
    //   否则调度器会因为 lastScanAt 没更新而认为"已到期"，立刻再触发一次 —— 无限重试。
    store.lastScanAttemptAt = new Date().toISOString()
    // 新一轮开始，先清掉上一轮的异常标记；这轮再出问题会重新写上。
    store.lastScanWarning = null
    /*
     * ★ 写下"扫描进行中"的标记。
     *
     * 好友资料是边扫边存的，所以中途被杀会留下部分更新的数据；而统计只在跑完时写。
     * 这个标记让**下次启动**能判断出"上一个进程死在扫描中途"（见 main/index.ts 的
     * checkInterruptedScan），从而把矛盾告诉用户，而不是让他以为统计坏了。
     * 正常跑完或异常结束都会在下面的 finally 里清掉。
     */
    store.scanStartedAt = new Date().toISOString()
    store.scanProgress = { done: 0, total: 0 }
    saveStore(store)

    try {
      // --- 第 1 步：取完整好友名单与分类 ---
      this.progress({ phase: 'listing', messageCode: 'listing' })
      const me = await client.request('GET', '/auth/user')
      if (me.status !== 200) {
        const code: ScanMessageCode = me.status === 401 ? 'sessionExpired' : 'friendsFailed'
        const detail = VrchatClient.describeError(me)
        store.lastScanWarning = { code, params: { error: detail }, at: new Date().toISOString() }
        saveStore(store)
        this.progress({
          phase: 'error',
          messageCode: code,
          messageParams: { error: detail },
        })
        return
      }
      const user = me.json as CurrentUserLike
      const allIds = Array.isArray(user.friends)
        ? user.friends.filter((x): x is string => typeof x === 'string')
        : []
      const onlineIds = [
        ...(Array.isArray(user.onlineFriends) ? user.onlineFriends : []),
        ...(Array.isArray(user.activeFriends) ? user.activeFriends : []),
      ].filter((x): x is string => typeof x === 'string')
      const offlineIds = (Array.isArray(user.offlineFriends) ? user.offlineFriends : []).filter(
        (x): x is string => typeof x === 'string',
      )

      if (allIds.length === 0) {
        this.progress({ phase: 'done', messageCode: 'emptyFriends' })
        return
      }

      let maxSeq = this.migrate(store)
      let nextSeq = maxSeq + 1
      const now0 = new Date().toISOString()
      let changesFound = 0
      /*
       * 以下计数只用于**日志**（用户要求日志写全，方便反馈问题时定位原因）：
       *   fieldCounts —— 本轮各类变化各有多少
       *   skipped403/404/failedRequests —— 跳过的原因分类
       */
      const fieldCounts: Record<string, number> = {}
      let skipped403 = 0
      let skipped404 = 0
      let failedRequests = 0
      /** 连续失败计数 —— 达到阈值就熔断，见循环里的说明 */
      let consecutiveFailures = 0
      const scanStartedMs = Date.now()

      // --- 第 2 步：好友关系变化（解除）---
      // 已经完成的扫描才有"上一次"可言；首次扫描（lastScanAt 为空）不做关系比对，
      // 否则第一次就会给几百个好友各发一条"新好友"，纯噪音。
      const isFirstScan = store.lastScanAt === null
      const currentIdSet = new Set(allIds)
      const apiIndexById = new Map(allIds.map((id, idx) => [id, idx]))

      if (!isFirstScan) {
        /*
         * ★ 先判断这份名单**可不可信**，再拿它做"谁不再是好友"的判定。
         *
         * 服务器故障 / 中间层截断时可能返回一份**残缺**名单。而解除判定是
         * "当前名单里没有的就算已解除"，于是一份残缺名单会一次性造出
         * 几百条假的「已解除好友」记录 —— 这比"少发现一次变化"严重得多。
         *
         * 两个**互相独立**的可信度证据（任一不过就跳过本轮解除判定）：
         *
         *   1. 交叉校验：在线的/活跃的/离线的三个子列表，必须是 friends 的子集。
         *      离线列表来自**另一个 HTTP 请求**（/auth/user/friends?offline=true），
         *      所以这是真正独立的证据，不是同一个响应自证。
         *   2. 数量骤减：比上次少了 30% 以上、且绝对数超过 3 个。
         *      十小时里掉三成好友几乎不可能；加一个绝对数门槛是为了
         *      照顾好友本来就少的人（10 个好友删 4 个不该被判成异常）。
         */
        const knownActive = Object.keys(store.friends).filter((id) => !store.friends[id].removed)
        const stray = [...onlineIds, ...offlineIds].filter((id) => !currentIdSet.has(id))
        const dropped = knownActive.length - allIds.length
        const droppedRatio = knownActive.length > 0 ? dropped / knownActive.length : 0
        const suspicious = stray.length > 0 || (dropped > 3 && droppedRatio > 0.3)

        if (suspicious) {
          console.warn(
            `[scan] ⚠ 名单可信度检查未通过（子列表多出 ${stray.length} 个 id，` +
              `数量变化 ${dropped >= 0 ? '-' : '+'}${Math.abs(dropped)}），` +
              '已跳过本轮的「解除好友」判定，避免造出假记录',
          )
          store.lastScanWarning = {
            code: 'relationCheckSkipped',
            params: {
              stray: stray.length,
              before: knownActive.length,
              now: allIds.length,
            },
            at: new Date().toISOString(),
          }
        } else {
          for (const id of Object.keys(store.friends)) {
            const prev = store.friends[id]
            if (currentIdSet.has(id) || prev.removed) continue
            changesFound++
            fieldCounts.friendRemoved = (fieldCounts.friendRemoved ?? 0) + 1
            store.events.push({
              id: makeEventId(id, 'friendRemoved', now0),
              at: now0,
              userId: id,
              displayName: prev.displayName,
              field: 'friendRemoved',
              before: '',
              after: '',
            })
            // 标记而不是删除：好友关系结束不代表我们该忘掉过去
            store.friends[id] = { ...prev, removed: true, removedAt: now0 }
          }
        }
        if (changesFound > 0) {
          console.log(`[scan] 检测到 ${changesFound} 个好友已解除`)
          saveStore(store)
        }
      }

      // --- 第 3 步：取离线好友的活跃时间，作为第二级排序键 ---
      this.progress({
        phase: 'listing',
        total: allIds.length,
        messageCode: 'listingCount',
        messageParams: { total: allIds.length },
      })
      const offline = await this.fetchOfflineFriends(client)
      if (offline.error) {
        console.warn('[scan] 获取离线好友列表失败，将不按活跃时间排序：', offline.error)
      }
      const activity = new Map<string, string>()
      for (const entry of offline.entries) {
        if (typeof entry.id === 'string') {
          activity.set(entry.id, typeof entry.last_activity === 'string' ? entry.last_activity : '')
        }
      }

      // --- 第 4 步：组出扫描顺序（一次性冻结）---
      const onlineSet = new Set(onlineIds)
      const offlineSet = new Set(offlineIds)
      const tier1 = allIds.filter((id) => onlineSet.has(id))
      const tier2 = allIds
        .filter((id) => offlineSet.has(id) && !onlineSet.has(id))
        .sort((a, b) => (activity.get(b) ?? '').localeCompare(activity.get(a) ?? ''))
      const tier3 = allIds.filter((id) => !onlineSet.has(id) && !offlineSet.has(id))
      const ordered = [...tier1, ...tier2, ...tier3]

      /* ─────────────────────────────────────────────────────────────────
       * 完整的扫描日志（用户明确要求）。
       * 目的：出问题时他只要把这一段贴出来，就能判断是限流、权限、
       *       还是别的原因 —— 而不是只有一句"出错了"。
       * ───────────────────────────────────────────────────────────────── */
      const estimatedMinutes = Math.ceil((ordered.length * (REQUEST_INTERVAL_MS + 300)) / 60000)
      this.logBlock('扫描开始', [
        ['账号', `${authState.self?.displayName ?? '(未知)'} (${activeAccount ?? '(未登录)'})`],
        ['好友总数', `${allIds.length}（在线/活跃 ${tier1.length} / 离线 ${tier2.length} / 兜底 ${tier3.length}）`],
        ['请求间隔', `${REQUEST_INTERVAL_MS / 1000} 秒/人`],
        ['预计耗时', `约 ${estimatedMinutes} 分钟`],
        ['触发方式', options.auto ? '自动（定时）' : '手动'],
        ['限流冷却', this.getCooldown().blocked ? `冷却中，剩 ${this.getCooldown().minutesLeft} 分钟` : '正常'],
        ['首次扫描', isFirstScan ? '是（只建立基线，不产生变化记录）' : '否'],
      ])

      let done = 0
      let skipped = 0

      // --- 第 5 步：逐个抓取 profile 并比对（匀速，不分批）---
      for (let i = 0; i < ordered.length; i++) {
        if (this.stopRequested) {
          store.lastScanAt = new Date().toISOString()
          store.lastScanStats = { total: ordered.length, scanned: done, skipped, changes: changesFound }
          saveStore(store)
          this.progress({
            phase: 'stopped',
            total: ordered.length,
            done,
            index: i + 1,
            changes: changesFound,
            skipped,
            messageCode: 'stopped',
            messageParams: { done, total: ordered.length },
          })
          return
        }

        const id = ordered[i]

        // ★ 匀速节奏：每个好友之间固定间隔，而不是"突发 50 个再停 3 分钟"。
        //   第一个不等待（否则点下扫描后要空等 3 秒才看到动静）。
        if (i > 0) await sleep(REQUEST_INTERVAL_MS)

        this.progress({
          phase: 'scanning',
          total: ordered.length,
          done,
          index: i + 1,
          changes: changesFound,
          skipped,
          messageCode: 'scanning',
          messageParams: { index: i + 1, total: ordered.length },
        })

        let profile: ProfileLike | null = null
        try {
          const res = await client.request('GET', `/profile/${id}`)
          if (res.status === 429) {
            // ★ 一见限流就停：不重试、不跳过、不继续扫剩下的好友。
            //   阈值未知，继续下去只会把账号推向更长的限流（官方 FAQ 甚至提到封停）。
            store.lastScanAt = new Date().toISOString()
            store.lastScanStats = { total: ordered.length, scanned: done, skipped, changes: changesFound }
            store.lastRateLimitAt = new Date().toISOString()
            store.lastScanWarning = {
              code: 'rateLimited',
              params: { done, total: ordered.length },
              at: store.lastRateLimitAt,
            }
            saveStore(store)
            console.warn(
              `[scan] 触发限流，已中断本轮并进入 ${Math.round(RATE_LIMIT_COOLDOWN_MS / 3600000)} 小时冷却期`,
            )
            this.logBlock('⚠ 触发限流（429）—— 已中断本轮扫描', [
              ['账号', `${authState.self?.displayName ?? '(未知)'} (${activeAccount ?? '(未登录)'})`],
              ['已检查', `${done} / ${ordered.length}（进度已保存）`],
              ['本轮发现变化', String(changesFound)],
              ['强制冷却', `${Math.round(RATE_LIMIT_COOLDOWN_MS / 3600000)} 小时`],
              ['建议', '到项目 GitHub 仓库反馈这段日志，并暂时停止使用本工具'],
              ['说明', '429 阈值官方从未公布，请求节奏对你的账号可能偏快'],
            ])
            this.progress({
              phase: 'error',
              total: ordered.length,
              done,
              index: i + 1,
              changes: changesFound,
              skipped,
              messageCode: 'rateLimited',
              messageParams: {
                done,
                minutes: Math.round(RATE_LIMIT_COOLDOWN_MS / 60000),
                hours: Math.round(RATE_LIMIT_COOLDOWN_MS / 3600000),
              },
            })
            return
          }

          if (res.status === 401) {
            // 会话失效：剩下的请求注定全部失败，没必要把几百次都试完。
            store.lastScanAt = new Date().toISOString()
            store.lastScanStats = { total: ordered.length, scanned: done, skipped, changes: changesFound }
            store.lastScanWarning = {
              code: 'sessionExpired',
              params: { error: VrchatClient.describeError(res) },
              at: new Date().toISOString(),
            }
            saveStore(store)
            console.warn('[scan] 会话已失效（401），已中断本轮扫描')
            this.progress({
              phase: 'error',
              total: ordered.length,
              done,
              index: i + 1,
              changes: changesFound,
              skipped,
              messageCode: 'sessionExpired',
              messageParams: { error: VrchatClient.describeError(res) },
            })
            return
          }

          if (res.status === 200 && res.json && typeof res.json === 'object') {
            profile = res.json as ProfileLike
            consecutiveFailures = 0
          } else {
            // 403（私密资料）/ 404（账号已注销或已解除好友）都要优雅跳过，
            // 而且**不能删除历史**。分类计数是为了反馈时能区分原因。
            skipped++
            consecutiveFailures++
            if (res.status === 403) skipped403++
            else if (res.status === 404) skipped404++
            if (skipped <= 5) {
              console.warn(`[scan] 跳过 ${id}：HTTP ${res.status}（${VrchatClient.describeError(res)}）`)
            }
          }
        } catch (err) {
          skipped++
          consecutiveFailures++
          failedRequests++
          console.warn(`[scan] 获取 ${id} 的资料失败：`, err instanceof Error ? err.message : err)
        }

        /*
         * ★ 连续失败熔断。
         *
         * 服务器挂掉时每个请求都要等到超时才失败，如果一路跑完 246 个好友，
         * 就等于**对着一个已经挂掉的服务连续敲两个多小时**——这正是限流机制
         * 最反感的行为模式（虽然 5xx 不等于 429）。
         * 所以连续失败到一定次数就主动停下来，明确告诉用户"这次没扫到"。
         */
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          store.lastScanAt = new Date().toISOString()
          store.lastScanStats = { total: ordered.length, scanned: done, skipped, changes: changesFound }
          store.lastScanWarning = {
            code: 'tooManyFailures',
            params: { limit: MAX_CONSECUTIVE_FAILURES, done, total: ordered.length },
            at: new Date().toISOString(),
          }
          saveStore(store)
          console.warn(
            `[scan] 连续 ${MAX_CONSECUTIVE_FAILURES} 次请求失败，主动中断（服务器或网络可能不可用）`,
          )
          this.logBlock('⚠ 连续失败过多，已中断本轮扫描', [
            ['账号', `${authState.self?.displayName ?? '(未知)'} (${activeAccount ?? '(未登录)'})`],
            ['已检查', `${done} / ${ordered.length}（进度已保存，已抓到的资料会保留）`],
            ['连续失败', `${consecutiveFailures} 次（阈值 ${MAX_CONSECUTIVE_FAILURES}）`],
            ['可能原因', 'VRChat 服务不可用 / 网络中断 / 代理或防火墙拦截'],
            ['说明', '已检查过的好友资料不会丢失；没抓到的好友保留上一次的资料'],
          ])
          this.progress({
            phase: 'error',
            total: ordered.length,
            done,
            index: i + 1,
            changes: changesFound,
            skipped,
            messageCode: 'tooManyFailures',
            messageParams: { limit: MAX_CONSECUTIVE_FAILURES, done, total: ordered.length },
          })
          return
        }

        if (profile) {
          const displayName = typeof profile.displayName === 'string' ? profile.displayName : ''
          const bio = typeof profile.bio === 'string' ? profile.bio : ''
          const bioLinks = Array.isArray(profile.bioLinks)
            ? profile.bioLinks.filter((x): x is string => typeof x === 'string').join('\n')
            : ''
          const fingerprint = fingerprintOf(displayName, bio, bioLinks)
          const now = new Date().toISOString()
          const prev = store.friends[id]
          const apiIndex = apiIndexById.get(id) ?? null

          // 好友序号 = 在 friends 数组里的下标 + 1。
          // ⚠ **一旦定下就不再改动**（`prev?.friendNumber ??`）：API 不保证数组顺序
          //   永远不变，而用户期望这个数字是稳定的。VRCX 也是这么做的（见 2.7）。
          const friendNumber = prev?.friendNumber ?? (apiIndex !== null ? apiIndex + 1 : null)

          const push = (field: ChangeField, before: string, after: string): void => {
            changesFound++
            fieldCounts[field] = (fieldCounts[field] ?? 0) + 1
            store.events.push({
              id: makeEventId(id, field, `${now}-${changesFound}`),
              at: now,
              userId: id,
              displayName,
              field,
              before,
              after,
            })
          }

          if (!prev) {
            // 真正的第一次见到这个好友
            if (!isFirstScan) push('friendAdded', '', '')
            const record: FriendRecord = {
              id,
              seq: nextSeq++,
              friendNumber,
              displayName,
              bio,
              bioLinks,
              firstSeenAt: now,
              lastCheckedAt: now,
              fingerprint,
              changeCount: 0,
              lastChangedAt: null,
              removed: false,
              removedAt: null,
              apiIndex,
            }
            store.friends[id] = record
          } else {
            // 之前被标记为已解除，现在又出现了 → 重新加回
            if (prev.removed) push('friendAdded', '', '')

            if (prev.displayName !== displayName) push('displayName', prev.displayName, displayName)
            if (prev.bio !== bio) push('bio', prev.bio, bio)
            if (prev.bioLinks !== bioLinks) push('bioLinks', prev.bioLinks, bioLinks)

            const changed = prev.fingerprint !== fingerprint
            store.friends[id] = {
              ...prev,
              friendNumber,
              displayName,
              bio,
              bioLinks,
              lastCheckedAt: now,
              fingerprint,
              changeCount: prev.changeCount + (changed ? 1 : 0),
              lastChangedAt: changed ? now : prev.lastChangedAt,
              removed: false,
              removedAt: null,
              apiIndex,
            }
          }
        }

        done++

        // 定期落盘，避免中途退出丢掉全部进度
        if (done % SAVE_EVERY === 0) {
          // 顺便把进度快照写进去：中断时能告诉用户"扫到第几个断的"
          store.scanProgress = { done, total: ordered.length }
          saveStore(store)
        }
      }

      // --- 收尾：lastScanAt 是"完成时刻"，调度计时从它开始 ---
      store.lastScanAt = new Date().toISOString()
      store.lastScanStats = { total: ordered.length, scanned: done, skipped, changes: changesFound }

      /*
       * ★ 判断这轮是否"基本没扫到东西"。
       *
       * 否则会给用户一个危险的错觉：全部请求失败时界面依旧显示
       * 「检查 246/246、跳过 246、发现变化 0」—— 看起来像"扫过了，没有变化"。
       * 那比直接报错更糟：用户会以为一切正常，然后错过整整一个扫描周期。
       */
      const mostlyFailed = ordered.length > 0 && skipped / ordered.length > MOSTLY_FAILED_RATIO
      if (mostlyFailed) {
        store.lastScanWarning = {
          code: 'doneMostlyFailed',
          params: { done, total: ordered.length, skipped },
          at: new Date().toISOString(),
        }
      }
      saveStore(store)

      // 完整的结束日志，见 logBlock 的说明
      const durationMs = Date.now() - scanStartedMs
      const changeSummary = Object.entries(fieldCounts)
        .map(([field, count]) => `${fieldLabel(field as ChangeField)} ${count}`)
        .join(' / ')
      this.logBlock('扫描结束', [
        ['结果', mostlyFailed ? '⚠ 大部分好友都没抓到 —— 结果不可信' : '正常完成'],
        ['检查', `${done} / ${ordered.length}`],
        ['跳过', `${skipped}（403 私密资料 ${skipped403} / 404 已注销或已解除 ${skipped404} / 请求失败 ${failedRequests}）`],
        ['发现变化', changesFound > 0 ? `${changesFound}（${changeSummary}）` : '0（这是常态）'],
        ['耗时', Watcher.formatDuration(durationMs)],
        ['下次自动扫描', this.nextAutoScanAt() ?? '（需要一次成功扫描后才开始计时）'],
      ])

      this.progress({
        phase: 'done',
        total: ordered.length,
        done,
        index: ordered.length,
        changes: changesFound,
        skipped,
        messageCode: mostlyFailed
          ? 'doneMostlyFailed'
          : changesFound > 0
            ? 'doneChanges'
            : 'doneNoChange',
        messageParams: { done, found: changesFound, total: ordered.length, skipped },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[scan] 扫描异常终止：', message)
      store.lastScanWarning = {
        code: 'abnormalEnd',
        params: { message },
        at: new Date().toISOString(),
      }
      saveStore(store)
      this.logBlock('扫描异常终止', [
        ['错误', message],
        ['建议', '把上面这段完整贴出来反馈（含错误堆栈）'],
      ])
      this.progress({ phase: 'error', messageCode: 'abnormalEnd', messageParams: { message } })
    } finally {
      this.running = false
      this.stopRequested = false
      /*
       * 清掉"扫描进行中"的标记 —— 这里覆盖**所有**退出路径：
       * 正常跑完、提前 return（拉名单失败 / 好友为空 / 401 / 429 / 连续失败太多）、
       * 以及上面 catch 到的异常。只要走到这里，就说明本进程没有"死在扫描中途"。
       *
       * ⚠ 这个 finally 是中断判定的正确性关键：漏掉任何一条退出路径，
       *   下次启动就会误报「上次扫描意外中断」。
       */
      store.scanStartedAt = null
      store.scanProgress = null
      saveStore(store)
    }
  }
}
