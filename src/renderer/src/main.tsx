/**
 * 渲染进程入口（浏览器环境）。
 *
 * 这里没有 fs、没有 process、没有 require —— 要联网或读文件必须通过
 * window.vrcbw（由 preload 白名单暴露）请求主进程代劳。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('找不到 #root 容器，index.html 可能被改坏了')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
