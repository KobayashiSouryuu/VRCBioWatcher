/**
 * 给界面侧 TypeScript 用的全局声明：window.vrcbw 的类型。
 *
 * 这个文件只被 tsconfig.web.json 包含（主进程侧没有 DOM 的 Window 类型）。
 */
import type { VrcbwApi } from '../shared/types'

declare global {
  interface Window {
    vrcbw: VrcbwApi
  }
}

export {}
