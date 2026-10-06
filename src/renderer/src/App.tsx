import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
  AppSettings,
  AuthState,
  ChangeEvent,
  FriendRecord,
  ScanProgress,
  ScanSummary,
  SystemInfo,
  UpdateCheckResult,
} from '@shared/types'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { FriendDrawer } from './components/FriendDrawer'
import { LoginPage } from './components/LoginPage'
import { Overview } from './pages/Overview'
import { FriendsPage } from './pages/FriendsPage'
import { TimelinePage } from './pages/TimelinePage'
import { SettingsPage } from './pages/SettingsPage'
import { AboutPage } from './pages/AboutPage'
import { applyFontFamily, applyFontScale, isTestEvent, type PageKey } from './lib'
import { APP_NAME_BODY, APP_NAME_PREFIX } from '@shared/project'
import { I18nContext, LOCALES, translate, type Lang } from './i18n'

/**
 * 定期刷新「扫描状态摘要」的间隔：**1 分钟**。
 *
 * 为什么是 1 分钟：界面上展示的等待时间本来就是**分钟**精度
 * （"还要等 N 分钟才能手动扫描"，用 Math.ceil 取整）。
 * 刷新比显示精度更密没有意义 —— 只会白白多跑 IPC。
 *
 * 代价：等待时间到了之后，按钮最多迟 1 分钟才变成可点。
 * 相比"必须重启软件"（修之前的状况）完全可以接受。
 */
const SUMMARY_REFRESH_MS = 60_000

/**
 * 应用外壳。
 *
 * ★ 两层门禁（修复「退出登录后仍能看到好友数据」的严重 bug）：
 *   1. 主进程侧：`setActiveAccount(null)` 后，存储层读不到也写不了任何数据，
 *      所有查询返回空 —— 数据层面的隔离
 *   2. 界面侧：未登录时**只渲染 LoginPage**，侧栏、顶部状态条、好友列表、
 *      变化记录全都不存在于 DOM 里 —— 连入口都没有
 *   两层都要有：只做第 1 层，界面上会出现"一片空白但布局还在"的怪状态；
 *   只做第 2 层，数据仍然可能被别的方式读到。
 */
export default function App(): JSX.Element {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openResult, setOpenResult] = useState<string | null>(null)

  /** null = 还不知道认证状态（正在恢复会话） */
  const [auth, setAuth] = useState<AuthState | null>(null)
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState<AppSettings>({
    theme: 'system',
    lang: 'zh',
    pageSize: 50,
    autoPageSizeFriends: true,
    autoPageSizeChanges: true,
    showRemovedFriends: false,
    friendsSortKey: 'friendNumber',
    friendsSortAsc: true,
    friendsQuery: '',
    changesFilter: 'all',
    changesQuery: '',
    fontScale: 1,
    fontFamily: '',
    dataDir: '',
    autoLaunch: false,
    startMinimized: false,
    minimizeToTray: true,
    hardwareAcceleration: true,
    windowBounds: null,
    windowMaximized: false,
    encryptData: false,
  })

  const [summary, setSummary] = useState<ScanSummary | null>(null)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [changes, setChanges] = useState<ChangeEvent[]>([])
  const [friends, setFriends] = useState<FriendRecord[]>([])
  const [dataLoaded, setDataLoaded] = useState(false)
  /** 启动时自动检查更新的结果（null = 没检查完 / 失败 / 已是最新） */
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)

  /**
   * 「当前是否正在扫描」的即时副本，给进度回调用来判断"这是不是新一轮的开始"。
   *
   * 为什么要用 ref 而不是直接读 state：进度回调是在 effect 里注册一次的闭包，
   * 读 state 会永远读到注册那一刻的旧值；而 ref 每次都是最新的。
   */
  const runningRef = useRef(false)

  const [page, setPage] = useState<PageKey>('overview')
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null)

  const refreshScanData = useCallback(async () => {
    const [s, c, f] = await Promise.all([
      window.vrcbw.getScanSummary(),
      window.vrcbw.getChanges(1000),
      window.vrcbw.getFriends(),
    ])
    setSummary(s)
    setChanges(c)
    setFriends(f)
    setDataLoaded(true)
  }, [])

  useEffect(() => {
    let cancelled = false

    if (typeof window.vrcbw === 'undefined') {
      setError('bridge-missing')
      return
    }

    window.vrcbw
      .getSystemInfo()
      .then((data) => {
        if (cancelled) return
        setInfo(data)
        window.vrcbw.notifyRendererReady({
          renderedAt: new Date().toISOString(),
          userAgentEcho: data.userAgent,
        })
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })

    window.vrcbw
      .getAuthState()
      .then((state) => {
        if (!cancelled) setAuth(state)
      })
      .catch(() => {
        if (!cancelled) setAuth({ status: 'logged-out' })
      })

    window.vrcbw
      .getSettings()
      .then((s) => {
        if (!cancelled) setSettings(s)
      })
      .catch(() => {
        /* 设置读取失败就用默认值，不值得打扰用户 */
      })

    // 订阅进度。StrictMode 下 effect 会跑两遍，必须用返回的函数取消订阅。
    const unsubscribe = window.vrcbw.onScanProgress((p) => {
      setProgress(p)
      if (p.phase === 'done' || p.phase === 'stopped' || p.phase === 'error') {
        runningRef.current = false
        void refreshScanData().catch(() => {
          /* 忽略 */
        })
      } else if (!runningRef.current) {
        /*
         * ★ 扫描**刚开始**（第一条进度事件）。
         *
         * 这一步是必须的：界面手里的 summary 是上一次拿到的，里面的 running 还是 false，
         * 于是概览页的按钮不会从「立即扫描」变成「扫描进行中」、也仍然可点、并且不出现
         * 「停止」按钮 —— 用户实测报过这个 bug（手动扫描时按钮没反应）。
         *
         * 为什么自动扫描看起来是正常的：它通常发生在窗口关着的时候（收在托盘），
         * 用户打开窗口时组件刚挂载、正好重新拿了 summary。**不是自动扫描处理得更好，
         * 只是时机碰巧。** 所以这里按"有没有正在跑"来判断，对两种触发方式一视同仁。
         *
         * runningRef 守卫很重要：否则每个好友一条进度事件都会引发 3 次 IPC
         * （summary / changes / friends），一轮扫描几百次，纯属浪费。
         */
        runningRef.current = true
        void refreshScanData().catch(() => {
          /* 忽略 */
        })
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [refreshScanData])

  /**
   * 让 runningRef 跟着真实的 summary 走。
   *
   * 上面那个进度回调只在**刚开始**时刷新一次（靠 runningRef 挡重复），
   * 所以这里必须在每次拿到新 summary 时把 ref 校准回真实值 ——
   * 否则一旦某次扫描的结束事件被漏掉，ref 会永远停在 true，
   * 之后所有扫描都不会再触发那次刷新（按钮就一直显示「立即扫描」）。
   */
  useEffect(() => {
    runningRef.current = summary?.running ?? false
  }, [summary])

  /**
   * ★ 定期刷新「扫描状态摘要」（每 1 分钟，见 SUMMARY_REFRESH_MS 的说明）。
   *
   * 为什么必须要有：`manualScanWaitMinutes`（界面上那句"还要等 N 分钟才能手动扫描"）
   * 是**主进程算出来的**，而界面只在四个时刻去取它：挂载、登录状态变化、
   * 扫描进度事件、点过扫描按钮。**没有定时刷新** —— 后果是倒计时冻住：
   *
   *   1. 「还要等 N 分钟」一直显示挂载时那个数字，永不变化
   *   2. 等到时间真的过去了，也没人去取新值 → 按钮**一直禁用**，
   *      必须重启软件（重启 = 重新挂载 = 重新取值）才能点
   *
   * 这是用户实测报的 bug（"剩余时间提示不变，到时间也按不了按钮，必须重启"）。
   *
   * 只取 summary 一个，不调 refreshScanData —— 后者还会把好友列表（几百条）
   * 和变化记录全拉一遍，每分钟来一次太重。summary 只是主进程内存里的统计值，很便宜。
   */
  useEffect(() => {
    if (auth?.status !== 'logged-in') return
    const timer = window.setInterval(() => {
      void window.vrcbw
        .getScanSummary()
        .then(setSummary)
        .catch(() => {
          /* 取失败就算了，下一次再试 */
        })
    }, SUMMARY_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [auth])

  // 登录状态确定后拉数据。
  // ★ 退出登录时也会走到这里：那时主进程返回的是空数据，界面上的好友列表就被清空了。
  useEffect(() => {
    if (auth === null) return
    void refreshScanData().catch(() => {
      /* 忽略 */
    })
  }, [auth, refreshScanData])

  useEffect(() => {
    /*
     * 取「启动时自动检查更新」的结果。
     *
     * ⚠ 界面挂载和主进程的检查是**两条独立的时间线**，所以两条路都要走：
     *   1. 挂载时查一次（检查已经完成了的情况）
     *   2. 订阅事件（检查还没完成、稍后才出结果的情况）
     * 只做其中一个，都会出现"有时候能看到入口、有时候看不到"的怪现象。
     */
    void window.vrcbw
      .getAutoUpdateStatus()
      .then((r) => setUpdate(r))
      .catch(() => {
        /* 检查更新失败不值得打扰用户 */
      })

    return window.vrcbw.onUpdateAvailable((r) => setUpdate(r))
  }, [])

  useEffect(() => {
    applyFontScale(settings.fontScale)
    applyFontFamily(settings.fontFamily)
  }, [settings.fontScale, settings.fontFamily])

  useEffect(() => {
    if (selectedFriendId === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelectedFriendId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedFriendId])

  const runAuthAction = useCallback(async (action: () => Promise<AuthState>) => {
    setBusy(true)
    try {
      setAuth(await action())
    } catch (err) {
      setAuth({
        status: 'logged-out',
        message: `操作失败：${err instanceof Error ? err.message : String(err)}`,
      })
    } finally {
      setBusy(false)
    }
  }, [])

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    void window.vrcbw.updateSettings(patch).then(setSettings)
  }, [])

  const i18n = useMemo(() => {
    const lang = settings.lang as Lang
    return {
      lang,
      locale: LOCALES[lang],
      t: (key: Parameters<typeof translate>[1], params?: Record<string, string | number>) =>
        translate(lang, key, params),
    }
  }, [settings.lang])

  const selectedFriend = useMemo(
    () => friends.find((f) => f.id === selectedFriendId) ?? null,
    [friends, selectedFriendId],
  )
  const testCount = changes.filter(isTestEvent).length
  const loggedIn = auth?.status === 'logged-in'

  if (error) {
    return (
      <I18nContext.Provider value={i18n}>
        <div className="page">
          <div className="card error-card">
            <h2>{i18n.t('startupErrorTitle')}</h2>
            <p className="mono">
              {error === 'bridge-missing' ? i18n.t('bridgeMissingError') : error}
            </p>
          </div>
        </div>
      </I18nContext.Provider>
    )
  }

  return (
    <I18nContext.Provider value={i18n}>
      {/*
        还在恢复会话：给一个像样的加载屏，不要只显示「…」。

        ⚠ 这里是有真实等待的：启动时要发一次 `GET /auth/user` 向 VRChat
        验证保存的会话（网络请求，慢的时候好几秒）。之前只显示一个「…」，
        其余全白，看起来像卡死。现在至少让人知道程序在工作、在做什么。
      */}
      {auth === null ? (
        <div className="loading-screen">
          <div className="spinner spinner-lg" />
          <div className="loading-name">
            <span className="brand-accent">{APP_NAME_PREFIX}</span>
            {APP_NAME_BODY}
          </div>
          <div className="loading-text">{i18n.t('loadingSession')}</div>
        </div>
      ) : !loggedIn ? (
        <LoginPage
          auth={auth}
          busy={busy}
          theme={settings.theme}
          onThemeChange={(theme) => updateSettings({ theme })}
          lang={i18n.lang}
          onLangChange={(lang) => updateSettings({ lang })}
          onLogin={(username, password) => {
            void runAuthAction(() => window.vrcbw.login({ username, password }))
          }}
          onSubmitTwoFactor={(code) => {
            void runAuthAction(() => window.vrcbw.submitTwoFactor({ code }))
          }}
          onCancelTwoFactor={() => {
            setAuth({ status: 'logged-out' })
          }}
        />
      ) : (
        <div className="app-shell">
          <Sidebar
            page={page}
            onChange={setPage}
            auth={auth}
            summary={summary}
            update={update}
            onOpenRelease={(url) => {
              // 用系统浏览器打开 GitHub 发布页（主进程会校验必须是 https）
              void window.vrcbw.openExternal(url)
            }}
            onLogout={() => {
              void runAuthAction(() => window.vrcbw.logout())
            }}
          />

          <main className="app-main">
            <TopBar
              progress={progress}
              running={summary?.running ?? false}
              lastScanAt={summary?.lastScanAt}
              theme={settings.theme}
              onThemeChange={(theme) => updateSettings({ theme })}
              lang={i18n.lang}
              onLangChange={(lang) => updateSettings({ lang })}
            />

            <div className="app-content" id="app-content">
              {!dataLoaded ? (
                <p className="muted">…</p>
              ) : page === 'overview' ? (
                <Overview
                  auth={auth}
                  busy={busy}
                  onLogin={(username, password) => {
                    void runAuthAction(() => window.vrcbw.login({ username, password }))
                  }}
                  onSubmitTwoFactor={(code) => {
                    void runAuthAction(() => window.vrcbw.submitTwoFactor({ code }))
                  }}
                  onCancelTwoFactor={() => {
                    setAuth({ status: 'logged-out' })
                  }}
                  onLogout={() => {
                    void runAuthAction(() => window.vrcbw.logout())
                  }}
                  summary={summary}
                  progress={progress}
                  onStart={() => {
                    setProgress(null)
                    /*
                     * ★ 点完立刻刷新一次。
                     *
                     * 为什么还要这一下（进度事件不是会触发刷新吗）：
                     * 进度事件是"扫描真的开始跑"之后才来的，而这里的刷新是
                     * **扫描已经被接受**就立刻执行 —— 用户点下去到按钮变化之间的
                     * 延迟更短。而且点得太早被拒绝时（手动间隔不够 / 冷却期），
                     * 这次刷新也能把最新的等待分钟数拿回来，按钮和提示同步更新。
                     */
                    void window.vrcbw
                      .startScan({ auto: false })
                      .then(() => refreshScanData())
                      .catch(() => {
                        /* 忽略 */
                      })
                  }}
                  onStop={() => {
                    void window.vrcbw.stopScan()
                  }}
                  changes={changes}
                  onSeeAllChanges={() => setPage('timeline')}
                  onSelectFriend={setSelectedFriendId}
                  onClearTest={() => {
                    void window.vrcbw.clearTestChanges().then(() => refreshScanData())
                  }}
                  isDev={info?.isDev ?? false}
                />
              ) : null}

              {page === 'friends' ? (
                <FriendsPage
                  friends={friends}
                  onSelect={setSelectedFriendId}
                  pageSize={settings.pageSize}
                  onPageSizeChange={(pageSize) => updateSettings({ pageSize })}
                  autoPageSize={settings.autoPageSizeFriends}
                  onAutoPageSizeChange={(autoPageSizeFriends) =>
                    updateSettings({ autoPageSizeFriends })
                  }
                  showRemoved={settings.showRemovedFriends}
                  sortKey={settings.friendsSortKey}
                  sortAsc={settings.friendsSortAsc}
                  onSortChange={(friendsSortKey, friendsSortAsc) =>
                    updateSettings({ friendsSortKey, friendsSortAsc })
                  }
                  query={settings.friendsQuery}
                  onQueryChange={(friendsQuery) => updateSettings({ friendsQuery })}
                />
              ) : null}

              {page === 'timeline' ? (
                <TimelinePage
                  changes={changes}
                  isDev={info?.isDev ?? false}
                  onClearTest={() => {
                    void window.vrcbw.clearTestChanges().then(() => refreshScanData())
                  }}
                  pageSize={settings.pageSize}
                  onPageSizeChange={(pageSize) => updateSettings({ pageSize })}
                  autoPageSize={settings.autoPageSizeChanges}
                  onAutoPageSizeChange={(autoPageSizeChanges) =>
                    updateSettings({ autoPageSizeChanges })
                  }
                  onSelectFriend={setSelectedFriendId}
                  filter={settings.changesFilter}
                  onFilterChange={(changesFilter) => updateSettings({ changesFilter })}
                  query={settings.changesQuery}
                  onQueryChange={(changesQuery) => updateSettings({ changesQuery })}
                />
              ) : null}

              {page === 'about' ? <AboutPage info={info} /> : null}

              {page === 'settings' ? (
                <SettingsPage
                  theme={settings.theme}
                  onThemeChange={(theme) => updateSettings({ theme })}
                  lang={i18n.lang}
                  onLangChange={(lang) => updateSettings({ lang })}
                  pageSize={settings.pageSize}
                  onPageSizeChange={(pageSize) => updateSettings({ pageSize })}
                  autoPageSizeFriends={settings.autoPageSizeFriends}
                  onAutoPageSizeFriendsChange={(autoPageSizeFriends) =>
                    updateSettings({ autoPageSizeFriends })
                  }
                  autoPageSizeChanges={settings.autoPageSizeChanges}
                  onAutoPageSizeChangesChange={(autoPageSizeChanges) =>
                    updateSettings({ autoPageSizeChanges })
                  }
                  showRemovedFriends={settings.showRemovedFriends}
                  onShowRemovedFriendsChange={(showRemovedFriends) =>
                    updateSettings({ showRemovedFriends })
                  }
                  fontScale={settings.fontScale}
                  onFontScaleChange={(fontScale) => updateSettings({ fontScale })}
                  fontFamily={settings.fontFamily}
                  onFontFamilyChange={(fontFamily) => updateSettings({ fontFamily })}
                  encryptData={settings.encryptData}
                  onEncryptDataChange={(encryptData) => updateSettings({ encryptData })}
                  autoLaunch={settings.autoLaunch}
                  onAutoLaunchChange={(autoLaunch) => updateSettings({ autoLaunch })}
                  startMinimized={settings.startMinimized}
                  onStartMinimizedChange={(startMinimized) => updateSettings({ startMinimized })}
                  minimizeToTray={settings.minimizeToTray}
                  onMinimizeToTrayChange={(minimizeToTray) => updateSettings({ minimizeToTray })}
                  hardwareAcceleration={settings.hardwareAcceleration}
                  onHardwareAccelerationChange={(hardwareAcceleration) =>
                    updateSettings({ hardwareAcceleration })
                  }
                  summary={summary}
                  info={info}
                  openResult={openResult}
                  onOpenDataDir={() => {
                    void window.vrcbw.openUserDataDir().then(setOpenResult)
                  }}
                  onDataMoved={() => {
                    void refreshScanData().catch(() => {
                      /* 忽略 */
                    })
                  }}
                  auth={auth}
                  busy={busy}
                  onLogout={() => {
                    void runAuthAction(() => window.vrcbw.logout())
                  }}
                  isDev={info?.isDev ?? false}
                  testCount={testCount}
                  onClearTest={() => {
                    void window.vrcbw.clearTestChanges().then(() => refreshScanData())
                  }}
                  onInject={(kind) => {
                    void window.vrcbw.injectTestChange(kind).then(() => refreshScanData())
                  }}
                />
              ) : null}
            </div>
          </main>

          {selectedFriend ? (
            <FriendDrawer
              friend={selectedFriend}
              changes={changes}
              onClose={() => setSelectedFriendId(null)}
            />
          ) : null}
        </div>
      )}
    </I18nContext.Provider>
  )
}
