/** 界面里共用的小工具。文案不在这里 —— 一切面向用户的文字都在 i18n.tsx。 */

import type { ChangeField } from '@shared/types'
import type { TKey } from './i18n'

/** 页面标识。不引入路由库：4 个页面用 useState 切换足够，省一个依赖也更简单。 */
export type PageKey = 'overview' | 'friends' | 'timeline' | 'settings' | 'about'

/**
 * 页面列表。`labelKey` / `hintKey` 存的是**文案键**而不是文案本身，
 * 由界面用当前的 i18n 去取 —— 这样切换语言时导航也跟着变。
 */
export const PAGES: { key: PageKey; labelKey: TKey; hintKey: TKey }[] = [
  { key: 'overview', labelKey: 'navOverview', hintKey: 'hintOverview' },
  { key: 'friends', labelKey: 'navFriends', hintKey: 'hintFriends' },
  { key: 'timeline', labelKey: 'navTimeline', hintKey: 'hintTimeline' },
  { key: 'settings', labelKey: 'navSettings', hintKey: 'hintSettings' },
  { key: 'about', labelKey: 'navAbout', hintKey: 'hintAbout' },
]

/** 好友关系类事件没有 before/after 内容，界面要单独渲染成一句话 */
export function isRelationChange(field: ChangeField): boolean {
  return field === 'friendAdded' || field === 'friendRemoved'
}

/** 日期时间。locale 由当前语言决定，传 'zh-CN' / 'ja-JP' / 'en-US'。 */
export function formatTime(iso: string | null | undefined, locale = 'zh-CN'): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString(locale)
}

export function formatDate(iso: string | null | undefined, locale = 'zh-CN'): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString(locale)
}

/** 把长文本压成一行摘要，用于表格里的简介列 */
export function summarize(text: string, max = 90): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine === '') return ''
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

/**
 * 这条事件是不是「注入模拟变化」造出来的假数据。
 *
 * 与主进程 db.ts 里的判断保持一致：新事件带 test 标记，
 * 早期注入的事件没有标记，只能靠内容特征识别。
 */
export function isTestEvent(ev: { test?: boolean; before: string; after: string }): boolean {
  if (ev.test === true) return true
  return ev.after.includes('（模拟变化 ') || ev.before.includes('（模拟）这是旧的一段')
}

/**
 * 翻页后把滚动位置归零。
 *
 * 不这么做的话，用户在第 1 页滚到中间点「下一页」，会直接停在第 2 页的中间，
 * 看不到第一条 —— 翻页变成"内容换了但视野没换"，很别扭。
 *
 * 要归零的可能有两处：外层内容区（页面滚动）和列表自己的滚动容器（卡片内部滚动），
 * 所以两个都传进来。
 */
export function scrollToTop(...containers: (HTMLElement | null)[]): void {
  for (const el of containers) {
    if (el) el.scrollTo({ top: 0 })
  }
}

/**
 * 把滚动位置拉到底（点「末页」时用，用户明确要求）。
 *
 * ⚠ 必须在**新一页渲染完成之后**调用：如果在 setState 的同一个 tick 里就调用，
 *   容器的 scrollHeight 还是旧内容的，拉不到真正的最底下。
 *   所以调用方用 useEffect 在提交后再滚（见 FriendsTable 的 pendingScroll）。
 */
export function scrollToBottom(...containers: (HTMLElement | null)[]): void {
  for (const el of containers) {
    if (el) el.scrollTo({ top: el.scrollHeight })
  }
}

/** 外层内容区元素（在 App.tsx 上挂了 id） */
export function contentContainer(): HTMLElement | null {
  return document.getElementById('app-content')
}

/**
 * 默认字体栈。用户填的字体名会拼在它**前面**：
 * 字体存在就用它，不存在浏览器自动落到这里 —— 这正是 CSS 字体栈的原生行为，
 * 不需要我们自己去判断"有没有这个字体"。
 */const DEFAULT_FONT_STACK =
  '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, -apple-system, sans-serif'

/**
 * 把界面字体写进 CSS 变量。
 *
 * 参数是**字体名称**（如 `MiSans`），不是完整字体栈 —— 用户手填什么就是什么。
 * 做了一层清洗：名称来自设置文件，理论上能被手工改成带引号或分号的字符串去注入
 * 别的 CSS 声明。剔除这些字符后，再整体加引号，它就只能是一个字体名。
 */
export function applyFontFamily(name: string): void {
  const root = document.documentElement
  const cleaned = name.replace(/["';{}<>\\]/g, '').trim()
  if (cleaned === '') {
    root.style.removeProperty('--font-ui')
    return
  }
  root.style.setProperty('--font-ui', `"${cleaned}", ${DEFAULT_FONT_STACK}`)
}

/**
 * 检测系统里有没有这个字体。
 *
 * 原理：用 canvas 量同一段文字的宽度两次 —— 一次只用兜底字体，一次把待测字体
 * 放在兜底字体前面。如果字体不存在，两次宽度完全相同（都走兜底）；
 * 存在则宽度会变。对三种兜底族各测一次，任一不同即认为存在。
 */
export function fontExists(name: string): boolean {
  const cleaned = name.replace(/["';{}<>\\]/g, '').trim()
  if (cleaned === '') return true
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return true // 量不了就当它存在，别误报
  const probe = 'mmmmmmmmmmlliWWWMiSans测试字号'
  for (const base of ['monospace', 'sans-serif', 'serif']) {
    ctx.font = `72px ${base}`
    const baseWidth = ctx.measureText(probe).width
    ctx.font = `72px "${cleaned}", ${base}`
    if (ctx.measureText(probe).width !== baseWidth) return true
  }
  return false
}

/** 把字号缩放写进 CSS 变量（所有 font-size 都是 calc(Npx * var(--fs-scale))） */
export function applyFontScale(scale: number): void {
  document.documentElement.style.setProperty('--fs-scale', String(scale))
}
