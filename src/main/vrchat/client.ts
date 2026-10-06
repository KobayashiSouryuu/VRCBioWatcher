import { buildUserAgent } from '../user-agent'

/**
 * VRChat API 的最小 HTTP 客户端。
 *
 * 设计要点（都是踩坑换来的，详见 docs/DECISIONS.md）：
 *
 *  1. **自己管 cookie**：Node 的 fetch 没有 cookie jar，而 VRChat 的认证全靠
 *     `auth` cookie。登录和 2FA 验证都会下发新的 cookie，所以每次响应都要吸收。
 *
 *  2. **强制请求间隔**：VRChat 的限流红线是未知的（响应里没有任何 X-RateLimit 头），
 *     而且官方 FAQ 明确说无视 429 可能导致更长限流甚至封停。所以这里有两层保护：
 *     每次请求之间的最小间隔 + 429 时按 Retry-After 退避重试。
 *
 *  3. **绝不记录凭据**：任何日志都不打印 cookie 值或 Authorization 头。
 */

const API_BASE = 'https://api.vrchat.cloud/api/1'

/**
 * 两次请求之间的最小间隔（毫秒）。
 *
 * ⚠ 这个值来自 docs/DECISIONS.md 3.3 里和你确认过的参数：默认请求间隔 1.2 秒、
 *   **硬下限 1 秒**。探针实测用 1000ms 跑了约 40 次请求、零 429。
 *   不要为了「快一点」把它调小 —— 限流红线是未知的。
 */
const MIN_INTERVAL_MS = 1000

/**
 * 遇到 429 时**不自动重试**。
 *
 * ⚠ 这是刻意的安全选择，不是偷懒：
 *   VRChat 从未公布限流阈值（官方 FAQ 只说「不可预测」，社区也无可靠实测数据），
 *   所以我们无法计算"安全的速率"。唯一正确的做法是**一见到 429 就退**，
 *   而不是退避几秒后继续敲门 —— 后者在阈值很紧时会把自己推向更长的限流。
 *
 *   429 会原样返回给上层：扫描器据此**立刻中断整轮**并进入冷却期，
 *   登录流程则把「暂时被限流」如实告诉用户。
 *   详见 docs/DECISIONS.md 3.5。
 */
const RETRY_ON_429 = 0

/**
 * 单次请求的超时时间（毫秒）。
 *
 * 为什么要有它、为什么是 15 秒：见 request() 里 fetch 那段注释。
 * 概要：没有它，卡住的连接会挂到 Node 的默认超时（约 300 秒），
 * 而且"卡住"不算失败 → 连续失败熔断形同虚设。
 */
export const REQUEST_TIMEOUT_MS = 15_000

export interface ApiResult {
  status: number
  json: unknown
  text: string
  /** 这次请求期间是否触发过 429 退避（用于提示用户「已被限流」） */
  throttled: boolean
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Basic 认证的编码格式：base64(urlencode(用户名):urlencode(密码))
 * 依据：VRChat 非官方 API 规范（authentication.yaml），探针已实测可用。
 */
export function basicAuthHeader(username: string, password: string): string {
  const raw = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`
}

export class VrchatClient {
  private cookies = new Map<string, string>()
  private lastRequestAt = 0

  getCookieNames(): string[] {
    return [...this.cookies.keys()]
  }

  getCookieSnapshot(): Record<string, string> {
    return Object.fromEntries(this.cookies)
  }

  restoreCookies(cookies: Record<string, string>): void {
    this.cookies = new Map(Object.entries(cookies))
  }

  clearCookies(): void {
    this.cookies.clear()
  }

  /** 保证任意两次请求之间有最小间隔 */
  private async pace(): Promise<void> {
    const wait = this.lastRequestAt + MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await sleep(wait)
    this.lastRequestAt = Date.now()
  }

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  /** 吸收 Set-Cookie。登录 / 2FA 验证都会下发新 cookie，必须每次都抓。 */
  private absorbSetCookie(res: Response): void {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    for (const rawCookie of list) {
      const pair = rawCookie.split(';')[0]
      const i = pair.indexOf('=')
      if (i < 0) continue
      const name = pair.slice(0, i).trim()
      const value = pair.slice(i + 1).trim()
      if (value === '') this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    options: { basicAuth?: string; body?: unknown } = {},
  ): Promise<ApiResult> {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`
    let throttled = false

    for (let attempt = 0; ; attempt++) {
      await this.pace()

      const headers: Record<string, string> = {
        'User-Agent': buildUserAgent(),
        Accept: 'application/json',
      }
      if (options.basicAuth) headers.Authorization = options.basicAuth
      if (this.cookies.size > 0) headers.Cookie = this.cookieHeader()
      if (options.body !== undefined) headers['Content-Type'] = 'application/json'

      let res: Response
      try {
        res = await fetch(url, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          /*
           * ★ 单次请求超时。
           *
           * 为什么必须有：不设的话，遇到"连得上但一直不回"的中间层（代理切节点、
           * 防火墙丢包）时，这里会一直挂着 —— 底层 fetch 的默认超时是 undici 的
           * headersTimeout，约 300 秒。后果有两个：
           *   1. 一轮扫描可能卡几十分钟，用户看着进度条不动
           *   2. **更糟**：卡住不算"失败"，所以"连续失败熔断"根本不会触发，
           *      只能干等到超时为止
           *
           * 而且它还有一个安全副作用：超时把"一轮请求卡住"的窗口从几分钟缩到
           * 十几秒，跨账号切换时数据串号的风险窗口也跟着变小（见 watcher.ts 的账号校验）。
           *
           * 15 秒是权衡后的取值：正常 profile 请求在几百毫秒级，15 秒足够宽松，
           * 又不会让用户等太久。超时会被上层当作"可重试的临时失败"处理。
           */
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch (err) {
        /*
         * 网络层失败（断网、DNS、超时）。这里**不重试** —— 重试由上层
         * （扫描器）按"同一个好友最多试几次"的节奏统一决定，这样重试之间的
         * 间隔也走同样的匀速规则，不会在本层形成突发。
         */
        const reason = err instanceof Error ? err.message : String(err)
        throw new Error(`无法连接 VRChat API：${reason}`)
      }

      this.absorbSetCookie(res)

      const text = await res.text()
      let json: unknown = null
      try {
        json = JSON.parse(text)
      } catch {
        /* 不是 JSON，保留原文供上层展示 */
      }

      if (res.status === 429) {
        throttled = true
        // 默认不重试（RETRY_ON_429 = 0）。保留这个分支是为了万一以后要放宽，
        // 放宽时也必须先读 docs/DECISIONS.md 3.5 的风险说明。
        if (attempt < RETRY_ON_429) {
          const retryAfter = Number(res.headers.get('retry-after'))
          const waitMs =
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt
          console.warn(
            `[vrchat] 触发限流（429），等待 ${Math.round(waitMs / 1000)} 秒后重试（第 ${attempt + 1} 次）`,
          )
          await sleep(waitMs)
          continue
        }
        console.warn('[vrchat] 触发限流（429）—— 按策略不再重试，交由上层中断并进入冷却')
      }

      return { status: res.status, json, text, throttled }
    }
  }

  /** 从响应体里取出 VRChat 的错误描述（它的错误信息是嵌套的，读起来很别扭） */
  static describeError(result: ApiResult): string {
    const json = result.json as { error?: { message?: string } } | null
    const nested = json?.error?.message
    if (typeof nested === 'string' && nested.trim() !== '') return nested
    if (result.text.trim() !== '') return result.text.slice(0, 300)
    return `HTTP ${result.status}`
  }
}
