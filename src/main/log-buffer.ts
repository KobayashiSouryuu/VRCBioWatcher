/**
 * 日志环形缓冲。
 *
 * ## 为什么需要
 *
 * 用户反馈"出问题了"时，只说一句"出错了"是没法定位的。但如果让用户自己去翻终端、
 * 复制几百行日志，他又不知道该复制哪一段。
 *
 * 所以这里把主进程的 console 输出**同时**留一份在内存里（只留最近若干行），
 * 反馈界面上直接把它展示出来、一键复制。
 *
 * ## 实现方式
 *
 * 直接给 console 打补丁（tee）：**终端照常输出**，同时进缓冲。
 * 这样所有既有代码都不用改 —— 包括第三方/未来新增的日志都自动被收集。
 *
 * ⚠ 两个必须注意的点：
 *   1. 缓冲里**绝不能再调用 console**，否则无限递归
 *   2. 格式化必须容错：日志里可能出现循环引用的对象，
 *      JSON.stringify 会抛错 —— 那绝不能把程序搞崩
 */

/** 最多保留的行数。太大占内存，太小又看不出上下文 */
const MAX_LINES = 400

const lines: string[] = []

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  if (arg === null || arg === undefined) return String(arg)
  try {
    return JSON.stringify(arg)
  } catch {
    // 循环引用等情况下 JSON.stringify 会抛错
    return Object.prototype.toString.call(arg)
  }
}

/** 给 console 打补丁，把输出同时收进环形缓冲。**
 * 重复调用是安全的（只会打一次补丁）。 */
let installed = false

export function installLogBuffer(): void {
  if (installed) return
  installed = true

  const levels = ['log', 'warn', 'error'] as const
  for (const level of levels) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]): void => {
      // 先照常输出到终端（用户/开发者看得到）
      original(...args)
      // 再收进缓冲 —— 这里只能用 push，绝不能调 console
      const stamp = new Date().toISOString().slice(11, 19)
      lines.push(`${stamp} [${level}] ${args.map(formatArg).join(' ')}`)
      if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES)
    }
  }
}

/** 最近若干行日志（从旧到新） */
export function recentLogs(count = 300): string[] {
  return lines.slice(-count)
}

export function logLineCount(): number {
  return lines.length
}
