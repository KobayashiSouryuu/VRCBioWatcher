import { basicAuthHeader, VrchatClient } from './client'
import { clearSession, isSecureStorageAvailable, loadSession, saveSession } from './session-store'
import type { AuthState, LoginRequest, TwoFactorRequest } from '../../shared/types'

/**
 * 认证管理器：登录、两步验证、会话恢复、退出。
 *
 * 流程（与探针实测的一致，依据 docs/DECISIONS.md 第 2 节）：
 *
 *   1. `GET /auth/user` + Basic 认证头  → 换回 `auth` cookie
 *      - 若响应含 `requiresTwoFactorAuth`（数组）→ 需要 2FA，进入 needs-2fa 状态
 *      - 若响应含 `id` → 直接登录成功（账号未开 2FA）
 *   2. `POST /auth/twofactorauth/{totp|emailotp|otp}/verify` + { code }
 *   3. 再 `GET /auth/user` 拿完整的 CurrentUser（2FA 通过后会下发新的 auth cookie）
 *   4. 把 cookie 用系统加密保存，下次启动直接复用，不必重新登录
 *
 * 注意：**密码只在内存里存在一次**，不保存、不写日志、不进状态对象。
 */

/** VRChat 返回的 CurrentUser 里我们关心的字段 */
interface CurrentUserLike {
  id?: unknown
  displayName?: unknown
  requiresTwoFactorAuth?: unknown
  friends?: unknown
}

/** 2FA 方式 → 验证端点的路径片段 */
const TWO_FACTOR_ENDPOINTS: Record<string, string> = {
  totp: 'totp',
  emailOtp: 'emailotp',
  otp: 'otp',
}

const TWO_FACTOR_LABELS: Record<string, string> = {
  totp: '认证器 App 的 6 位验证码',
  emailOtp: '邮箱收到的验证码',
  otp: '恢复码 / 备用码',
}

export class AuthManager {
  private client = new VrchatClient()
  private state: AuthState = { status: 'logged-out' }
  /** 记住服务器给出的 2FA 方式，供后续 verify 选择端点 */
  private twoFactorMethod: string | null = null
  /** 会话恢复只做一次 */
  private restorePromise: Promise<AuthState> | null = null

  getState(): AuthState {
    return this.state
  }

  getClient(): VrchatClient {
    return this.client
  }

  /**
   * 启动时尝试用已保存的 cookie 恢复会话。
   * 这也是「重启软件不用重新登录」的实现方式。
   */
  restore(): Promise<AuthState> {
    if (this.restorePromise) return this.restorePromise
    this.restorePromise = this.doRestore()
    return this.restorePromise
  }

  private async doRestore(): Promise<AuthState> {
    const saved = loadSession()
    if (!saved) {
      this.state = { status: 'logged-out' }
      return this.state
    }

    this.client.restoreCookies(saved.cookies)
    try {
      const result = await this.client.request('GET', '/auth/user')
      const user = result.json as CurrentUserLike | null
      if (result.status === 200 && typeof user?.id === 'string') {
        this.state = {
          status: 'logged-in',
          self: { id: user.id, displayName: String(user.displayName ?? '') },
          message: '已用保存的会话自动登录',
        }
        return this.state
      }
      // 会话已失效（过期 / 在别处登出）
      this.client.clearCookies()
      clearSession()
      this.state = { status: 'logged-out', message: '保存的会话已失效，请重新登录' }
      return this.state
    } catch (err) {
      // 网络不通时不要清掉会话，否则一断网就要重新登录
      this.state = {
        status: 'logged-out',
        message: `无法验证已保存的会话（${err instanceof Error ? err.message : String(err)}）`,
      }
      return this.state
    }
  }

  async login(req: LoginRequest): Promise<AuthState> {
    const username = req.username.trim()
    const password = req.password
    if (!username || !password) {
      this.state = { status: 'logged-out', message: '请填写用户名和密码' }
      return this.state
    }

    this.client.clearCookies()
    this.twoFactorMethod = null

    try {
      const result = await this.client.request('GET', '/auth/user', {
        basicAuth: basicAuthHeader(username, password),
      })
      const user = result.json as CurrentUserLike | null

      if (result.status === 401) {
        this.state = {
          status: 'logged-out',
          message:
            '用户名或密码错误。如果你是用 Steam / Google 关联登录的账号，可能没有可用的密码。',
        }
        return this.state
      }

      // 需要两步验证
      const methods = user?.requiresTwoFactorAuth
      if (Array.isArray(methods) && methods.length > 0) {
        const available = methods.filter((m): m is string => typeof m === 'string')
        this.twoFactorMethod = available.includes('totp')
          ? 'totp'
          : available.includes('otp')
            ? 'otp'
            : 'emailOtp'
        this.state = {
          status: 'needs-2fa',
          twoFactorMethods: available,
          message: `需要两步验证：${TWO_FACTOR_LABELS[this.twoFactorMethod] ?? this.twoFactorMethod}`,
        }
        return this.state
      }

      if (result.status === 200 && typeof user?.id === 'string') {
        // 账号没开 2FA，一次就登录成功
        return this.completeLogin(user, result.throttled)
      }

      this.state = {
        status: 'logged-out',
        message: `登录失败：${VrchatClient.describeError(result)}`,
      }
      return this.state
    } catch (err) {
      this.state = {
        status: 'logged-out',
        message: err instanceof Error ? err.message : String(err),
      }
      return this.state
    }
  }

  async submitTwoFactor(req: TwoFactorRequest): Promise<AuthState> {
    const code = req.code.trim()
    if (this.state.status !== 'needs-2fa' || !this.twoFactorMethod) {
      return { status: 'logged-out', message: '当前不在等待两步验证的状态，请重新登录' }
    }
    if (!code) {
      return { ...this.state, message: '请填写验证码' }
    }

    const segment = TWO_FACTOR_ENDPOINTS[this.twoFactorMethod] ?? 'totp'
    try {
      const verify = await this.client.request('POST', `/auth/twofactorauth/${segment}/verify`, {
        body: { code },
      })

      const verifyJson = verify.json as { verified?: unknown } | null
      const accepted = verify.status < 400 && verifyJson?.verified !== false
      if (!accepted) {
        return {
          status: 'needs-2fa',
          twoFactorMethods: this.state.twoFactorMethods,
          message: `验证码未被接受：${VrchatClient.describeError(verify)}`,
        }
      }

      // 2FA 通过后必须重新拉一次，才能拿到完整的用户对象
      const me = await this.client.request('GET', '/auth/user')
      const user = me.json as CurrentUserLike | null
      if (me.status === 200 && typeof user?.id === 'string') {
        return this.completeLogin(user, verify.throttled || me.throttled)
      }
      return {
        status: 'needs-2fa',
        twoFactorMethods: this.state.twoFactorMethods,
        message: `两步验证通过，但获取用户信息失败：${VrchatClient.describeError(me)}`,
      }
    } catch (err) {
      return {
        status: 'needs-2fa',
        twoFactorMethods: this.state.twoFactorMethods,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /** 登录成功的收尾：保存会话、更新状态 */
  private completeLogin(user: CurrentUserLike, throttled: boolean): AuthState {
    const self = { id: String(user.id), displayName: String(user.displayName ?? '') }
    let saved = '会话已用系统加密保存，下次启动不必重新登录'
    try {
      saveSession({
        savedAt: new Date().toISOString(),
        cookies: this.client.getCookieSnapshot(),
      })
    } catch (err) {
      saved = `⚠ 会话未能保存（${err instanceof Error ? err.message : String(err)}），关闭后需要重新登录`
    }

    this.twoFactorMethod = null
    this.state = {
      status: 'logged-in',
      self,
      message: throttled ? `登录成功。注意：期间触发过限流，已自动退避。${saved}` : `登录成功。${saved}`,
    }
    console.log(`[auth] 登录成功：${self.displayName}（cookie: ${this.client.getCookieNames().join(', ')}）`)
    return this.state
  }

  async logout(): Promise<AuthState> {
    try {
      await this.client.request('PUT', '/logout')
    } catch {
      // 登出失败也要清掉本地会话，否则用户会觉得按钮没用
    }
    this.client.clearCookies()
    clearSession()
    this.twoFactorMethod = null
    this.restorePromise = Promise.resolve({ status: 'logged-out' })
    this.state = { status: 'logged-out', message: '已退出登录并清除本地会话' }
    return this.state
  }

  /** 给界面用的一条提示：系统加密是否可用（不可用时不建议保存会话） */
  get secureStorageAvailable(): boolean {
    return isSecureStorageAvailable()
  }
}
