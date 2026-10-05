import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 会话凭据的本地保存。
 *
 * 安全设计（这是本项目里最敏感的一块）：
 *
 *  1. **只存会话 cookie，永不存密码。** 密码只在用户点击「登录」时经过内存一次，
 *     用完立刻从引用里消失；任何情况下都不落盘。
 *
 *  2. **用系统级加密。** Windows 上是 DPAPI（`safeStorage`），密文与当前用户账户绑定，
 *     拷到别的机器或别的用户下都解不开。实测本机 `safeStorage.isEncryptionAvailable()`
 *     为 true（见 docs/DECISIONS.md 5.10）。
 *
 *  3. **加密不可用时拒绝保存**，而不是退化成明文 —— 宁可每次重新登录，
 *     也不要留下一个明文凭据文件。
 *
 *  4. 文件里存的是密文二进制，不是 JSON 文本；日志里绝不打印其内容。
 */

export interface StoredSession {
  savedAt: string
  /** VRChat 的会话 cookie（`auth`，可能还有 `twoFactorAuth`） */
  cookies: Record<string, string>
}

function sessionFilePath(): string {
  return join(app.getPath('userData'), 'session.bin')
}

export function isSecureStorageAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function saveSession(session: StoredSession): void {
  if (!isSecureStorageAvailable()) {
    throw new Error('系统加密不可用，拒绝以明文保存会话凭据（请重新登录）')
  }
  const file = sessionFilePath()
  mkdirSync(dirname(file), { recursive: true })
  const encrypted = safeStorage.encryptString(JSON.stringify(session))
  writeFileSync(file, encrypted)
}

export function loadSession(): StoredSession | null {
  const file = sessionFilePath()
  if (!existsSync(file)) return null
  if (!isSecureStorageAvailable()) {
    console.warn('[session] 系统加密不可用，无法读取已保存的会话')
    return null
  }
  try {
    const decrypted = safeStorage.decryptString(readFileSync(file))
    const parsed = JSON.parse(decrypted) as StoredSession
    if (!parsed || typeof parsed !== 'object' || !parsed.cookies) return null
    return parsed
  } catch (err) {
    // 解密失败通常意味着换了 Windows 账户，或文件损坏 —— 当成「没有会话」处理即可
    console.warn('[session] 已保存的会话无法解密，将忽略：', err instanceof Error ? err.message : err)
    return null
  }
}

export function clearSession(): void {
  const file = sessionFilePath()
  if (existsSync(file)) rmSync(file, { force: true })
}
