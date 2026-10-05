/// <reference lib="dom" />
/**
 * preload 脚本：界面与主进程之间唯一的通道。
 *
 * 它运行在**独立于界面的上下文**里，通过 contextBridge 只暴露下面这几个
 * 白名单函数。界面拿不到 ipcRenderer 本体，因此无法调用未授权的 IPC 通道 ——
 * 这是 Electron 应用最重要的安全边界，不要为了方便把它拆掉。
 *
 * 注意文件顶部的 `/// <reference lib="dom" />`：preload 需要访问 document，
 * 但 tsconfig.node.json 里没有 DOM 类型（主进程不该有 DOM）。用这种逐文件的
 * 方式引入，既拿到了 document 的类型，又不会让主进程代码误以为存在 DOM。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  AuthState,
  ChangeEvent,
  DataDirInfo,
  DomProbeDetail,
  FriendRecord,
  LoginRequest,
  MoveDataResult,
  RendererReadyDetail,
  ScanOptions,
  ScanProgress,
  ScanSummary,
  SystemInfo,
  TwoFactorRequest,
  UpdateCheckResult,
  VrcbwApi,
} from '../shared/types'

const api: VrcbwApi = {
  getSystemInfo: (): Promise<SystemInfo> => ipcRenderer.invoke('app:getSystemInfo'),
  notifyRendererReady: (detail: RendererReadyDetail): void =>
    ipcRenderer.send('app:rendererReady', detail),
  openUserDataDir: (): Promise<string> => ipcRenderer.invoke('app:openUserDataDir'),

  getAuthState: (): Promise<AuthState> => ipcRenderer.invoke('auth:getState'),
  login: (req: LoginRequest): Promise<AuthState> => ipcRenderer.invoke('auth:login', req),
  submitTwoFactor: (req: TwoFactorRequest): Promise<AuthState> =>
    ipcRenderer.invoke('auth:submitTwoFactor', req),
  logout: (): Promise<AuthState> => ipcRenderer.invoke('auth:logout'),

  startScan: (options?: ScanOptions): Promise<void> => ipcRenderer.invoke('scan:start', options),
  stopScan: (): Promise<void> => ipcRenderer.invoke('scan:stop'),
  getScanSummary: (): Promise<ScanSummary> => ipcRenderer.invoke('scan:getSummary'),
  getChanges: (limit?: number): Promise<ChangeEvent[]> => ipcRenderer.invoke('scan:getChanges', limit),
  getFriends: (): Promise<FriendRecord[]> => ipcRenderer.invoke('friends:list'),
  injectTestChange: (kind?: 'bio' | 'friendAdded' | 'friendRemoved'): Promise<ChangeEvent | null> =>
    ipcRenderer.invoke('scan:injectTestChange', kind),
  clearTestChanges: (): Promise<number> => ipcRenderer.invoke('scan:clearTestChanges'),

  // 订阅扫描进度。返回一个取消订阅的函数 —— 必须返回它，因为 React 的
  // StrictMode 在开发模式下会把 effect 跑两遍，不清理就会重复计数。
  onScanProgress: (handler: (progress: ScanProgress) => void): (() => void) => {
    const listener = (_event: unknown, progress: ScanProgress): void => handler(progress)
    ipcRenderer.on('scan:progress', listener)
    return () => {
      ipcRenderer.removeListener('scan:progress', listener)
    }
  },

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', patch),

  getDataDirInfo: (): Promise<DataDirInfo> => ipcRenderer.invoke('data:getDirInfo'),
  chooseDataDir: (): Promise<string | null> => ipcRenderer.invoke('data:chooseDir'),
  moveDataDir: (target: string): Promise<MoveDataResult> =>
    ipcRenderer.invoke('data:moveDir', target),

  getDiagnostics: (): Promise<string> => ipcRenderer.invoke('app:getDiagnostics'),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('app:copyText', text),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('app:openExternal', url),
  checkUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('app:checkUpdate'),
}

contextBridge.exposeInMainWorld('vrcbw', api)

// ---------------------------------------------------------------------------
// 诊断探针：页面加载完成后，把 DOM 的真实状态回传给主进程
// ---------------------------------------------------------------------------
// 为什么需要它：界面挂载失败时窗口只是一片空白，而「React 到底有没有渲染」
// 从外面完全看不出来（渲染进程的控制台你也看不到）。preload 与页面共享同一个
// document，所以它能替我们看一眼，把结论写进 _dev/startup-report.json。
//
// 关键点：preload **不受页面 CSP 限制**，所以即使页面的脚本全被拦掉，
// 这个探针照样能运行并上报 —— 这正是它能区分「CSP 拦了脚本」和
// 「React 渲染了但出错」的原因。
window.addEventListener('DOMContentLoaded', () => {
  window.setTimeout(() => {
    const root = document.getElementById('root')
    const detail: DomProbeDetail = {
      at: new Date().toISOString(),
      readyState: document.readyState,
      rootExists: root !== null,
      rootChildCount: root ? root.childElementCount : -1,
      bodyTextPreview: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      scriptCount: document.scripts.length,
    }
    ipcRenderer.send('app:domProbe', detail)
  }, 1500)
})
