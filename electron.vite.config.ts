import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * 内容安全策略（CSP）—— 开发与生产必须用两份不同的策略。
 *
 * 为什么不能写死在 index.html 里：
 *   开发模式下 @vitejs/plugin-react 会往 HTML 注入一段**内联** module 脚本
 *   （React Refresh 的前导代码 —— 见它 dist/index.js 里的
 *   `transformIndexHtml: { tag: 'script', children: getPreambleCode(base) }`，
 *   注意没有 src，是内联的）。内联脚本要求 script-src 允许 'unsafe-inline'。
 *   生产构建不需要这段代码，因此不应该放开 —— 否则界面一旦被注入内容，
 *   就失去了最后一道防线。
 *
 * 所以：开发用宽松版，生产用严格版，都由下面的 cspPlugin 注入。
 *
 * ⚠ 实测踩坑记录：早期版本把严格版写死在 index.html 里，症状是
 *   「主进程一切正常、界面永远挂载不上、终端里没有任何报错」——
 *   因为 React 前导脚本被 CSP 静默拦掉了，而 CSP 违规只出现在渲染进程控制台里。
 *   详见 docs/DECISIONS.md 第 5.9 节。
 */
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // ★ Vite / React Refresh 需要内联脚本
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:", // ★ HMR 的 websocket
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'", // ★ 生产环境禁止内联脚本
  "style-src 'self' 'unsafe-inline'", // Vite 会把样式内联进 HTML
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'", // ★ 界面不需要联网：所有 VRChat API 请求都由主进程发出
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

/** index.html 里的 CSP 注入点标记 */
const CSP_MARKER = '<!-- VRCBW-CSP -->'

function cspPlugin(): Plugin {
  return {
    name: 'vrcbw-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!html.includes(CSP_MARKER)) {
          // 宁可让构建直接失败，也不要在「没有 CSP」的情况下悄悄发布
          throw new Error(`index.html 里找不到 CSP 注入标记：${CSP_MARKER}`)
        }
        // ctx.server 存在 = 开发模式（Vite 开发服务器在跑）
        const isDev = Boolean(ctx.server)
        const csp = isDev ? DEV_CSP : PROD_CSP
        console.log(`[vrcbw-csp] 注入${isDev ? '开发' : '生产'}环境 CSP`)
        return html.replace(CSP_MARKER, `<meta http-equiv="Content-Security-Policy" content="${csp}" />`)
      },
    },
  }
}

export default defineConfig({
  main: {
    // externalizeDepsPlugin: 把 dependencies 里的包留作外部 require，不打进 bundle。
    // 对 Electron 主进程是必须的（原生模块尤其不能被 bundle）。
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [cspPlugin(), react()],
  },
})
