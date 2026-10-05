import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type {
  AppSettings,
  AuthState,
  ChangeEvent,
  FriendRecord,
  ScanProgress,
  ScanSummary,
  SystemInfo,
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
    windowBounds: null,
    windowMaximized: false,
    encryptData: false,
  })

  const [summary, setSummary] = useState<ScanSummary | null>(null)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [changes, setChanges] = useState<ChangeEvent[]>([])
  const [friends, setFriends] = useState<FriendRecord[]>([])
  const [dataLoaded, setDataLoaded] = useState(false)

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

  // 登录状态确定后拉数据。
  // ★ 退出登录时也会走到这里：那时主进程返回的是空数据，界面上的好友列表就被清空了。
  useEffect(() => {
    if (auth === null) return
    void refreshScanData().catch(() => {
      /* 忽略 */
    })
  }, [auth, refreshScanData])

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
                    void window.vrcbw.startScan({ auto: false })
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
