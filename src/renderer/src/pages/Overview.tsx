import { useState, type JSX } from 'react'
import type { AuthState, ChangeEvent, ScanProgress, ScanSummary } from '@shared/types'
import { LoginCard } from '../components/LoginCard'
import { ChangeList } from '../components/ChangeList'
import { formatTime, isTestEvent } from '../lib'
import { rich, scanMessage, useI18n } from '../i18n'

/**
 * 概览页：登录 + 扫描 + 总体数字 + 最近变化。
 *
 * 扫描按钮放在这里而不是设置页，是因为它是这个工具唯一的"主动作"——
 * 打开软件最可能想做的事就是「看一眼有没有新变化，没有就扫一次」。
 */
export function Overview({
  auth,
  busy,
  onLogin,
  onSubmitTwoFactor,
  onCancelTwoFactor,
  onLogout,
  summary,
  progress,
  onStart,
  onStop,
  changes,
  onSeeAllChanges,
  onSelectFriend,
  onClearTest,
  isDev,
  onRefreshSummary,
}: {
  auth: AuthState | null
  busy: boolean
  onLogin: (username: string, password: string) => void
  onSubmitTwoFactor: (code: string) => void
  onCancelTwoFactor: () => void
  onLogout: () => void
  summary: ScanSummary | null
  progress: ScanProgress | null
  onStart: () => void
  onStop: () => void
  changes: ChangeEvent[]
  onSeeAllChanges: () => void
  /** 点最近的某条变化 → 打开该好友详情（纯本地数据） */
  onSelectFriend: (userId: string) => void
  onClearTest: () => void
  isDev: boolean
  /**
   * 重新拉一次扫描摘要（只有摘要，不含好友/变化记录，很便宜）。
   *
   * 用途：点「知道了」清除提示之后，立刻把 summary 更新掉 ——
   * 否则侧栏那个「!」标记要等到下一次定时刷新（最多 1 分钟）才消失。
   */
  onRefreshSummary: () => void
}): JSX.Element {
  const i18n = useI18n()
  const { t, locale } = i18n
  const loggedIn = auth?.status === 'logged-in'
  const running = summary?.running ?? false
  const total = progress?.total ?? 0
  const done = progress?.done ?? 0
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  const recent = changes.slice(0, 10)
  const testCount = changes.filter(isTestEvent).length

  // 耗时估算：好友数 × （间隔 + 一点网络延迟）。让用户点之前就知道要等多久。
  const intervalSec = summary?.requestIntervalSeconds ?? 3
  const friendCount = summary?.friendCount ?? 0
  const estimateMinutes = Math.max(1, Math.ceil((friendCount * (intervalSec + 0.3)) / 60))
  const manualWaitMinutes = summary?.manualScanWaitMinutes ?? 0

  /**
   * 全新账号（从未完成过扫描）。
   *
   * 此时**不会有自动扫描** —— 调度计时从"扫描完成时刻"起算，没有完成过就没有下一次。
   * 这是有意设计的：让用户先读完风险说明，再自己决定什么时候开始。
   */
  const neverScanned = loggedIn && !summary?.lastScanAt

  /**
   * 上一轮扫描的异常横幅。
   *
   * ## 为什么要记住"关掉的是哪一条"，而不是一个 bool
   *
   * 以前这里是 `useState(false)`：点了「知道了」就藏起来 —— 但那个 state 活在组件里，
   * **切到别的页面再切回来**（Overview 会卸载重挂）、或者重新登录，它就没了，
   * 横幅原样回来 ✗ 用户反馈的现象就是"按了没用 / 关不掉"。
   *
   * 现在做两件事：
   *   1. 记下被关掉的那条警告的时间戳（`at`）—— 只有**同一条**被隐藏，
   *      之后真的又出了一条新警告（at 不同）照样会显示 ✓
   *   2. 通知主进程把它从数据里清掉（`onAcknowledgeWarning`）—— 彻彻底底不再回来 ✓
   */
  const warning = summary?.lastScanWarning ?? null
  const [dismissedWarningAt, setDismissedWarningAt] = useState<string | null>(null)
  const showWarning = loggedIn && warning !== null && warning.at !== dismissedWarningAt

  /*
   * ★ 本地数据文件读取失败的横幅（fatal 级别，比扫描异常严重得多）。
   *
   * 场景：store.json 损坏 → 主进程把它改名备份、以空数据继续跑。
   * 如果不显眼地告诉用户，他只会看到"好友和变化记录全没了"，
   * 然后以为是我们把数据弄丢了 —— 实际上原文件就在备份路径里。
   * 关闭逻辑与上面同理，按"内容"记住被关掉的是哪一条。
   */
  const dataError = summary?.dataLoadError ?? null
  const [dismissedDataError, setDismissedDataError] = useState<string | null>(null)
  const showDataError = loggedIn && dataError !== null && dataError !== dismissedDataError

  /** 关闭"上一轮扫描异常"横幅：本地先藏起来（立刻有反馈），再通知主进程清掉 */
  const dismissWarning = (): void => {
    if (warning) setDismissedWarningAt(warning.at)
    void window.vrcbw
      .acknowledgeNotice('scanWarning')
      .then(() => onRefreshSummary()) // 让侧栏的「!」标记也立刻消失
      .catch(() => {
        /* 忽略：清不掉也只是下次再显示一次横幅 */
      })
  }

  /** 关闭"数据读取失败"横幅，同上 */
  const dismissDataError = (): void => {
    if (dataError) setDismissedDataError(dataError)
    void window.vrcbw
      .acknowledgeNotice('dataError')
      .then(() => onRefreshSummary())
      .catch(() => {
        /* 忽略 */
      })
  }

  return (
    <>
      {!loggedIn ? (
        <LoginCard
          auth={auth}
          busy={busy}
          onLogin={onLogin}
          onSubmitTwoFactor={onSubmitTwoFactor}
          onCancelTwoFactor={onCancelTwoFactor}
          onLogout={onLogout}
        />
      ) : null}

      {/*
        ★★ 数据文件损坏横幅。放在扫描异常横幅**之前** —— 数据读不出来是更严重的事。
      */}
      {showDataError && dataError ? (
        <section className="card warning-card">
          <div className="card-head-row">
            <h2>⚠ {t('dataErrorTitle')}</h2>
            <button type="button" className="ghost" onClick={dismissDataError}>
              {t('warningDismiss')}
            </button>
          </div>
          <p>{t('dataErrorBody')}</p>
          {/* 原样显示主进程给的原因和备份路径（这是最关键的定位信息） */}
          <p className="muted mono">{dataError}</p>
          <p className="muted">{t('dataErrorHint')}</p>
        </section>
      ) : null}

      {/*
        ★ 异常横幅。扫描跑在后台、窗口常常关着，所以"上一轮其实全失败了"这件事
          必须显眼地留在界面上，而不是只在扫描结束时闪一下。

        ## 为什么 429 这一条**没有**「知道了」
        限流是唯一"用户应该立刻改变行为"的情况（停止使用、或把好友间隔调回 3 秒）。
        给它一个可以随手点掉的按钮，就等于允许用户把它从眼前抹掉然后继续用 ——
        所以这里不给关闭按钮；只有等下一次手动/自动扫描正常跑完、没有再次触发问题，
        这条横幅才会随 lastScanWarning 一起被清掉（扫描开始时会清空上一轮警告）。
      */}
      {showWarning && warning ? (
        <section className="card warning-card">
          <div className="card-head-row">
            <h2>⚠ {warning.code === 'rateLimited' ? t('rateLimitedTitle') : t('warningTitle')}</h2>
            {warning.code === 'rateLimited' ? null : (
              <button type="button" className="ghost" onClick={dismissWarning}>
                {t('warningDismiss')}
              </button>
            )}
          </div>
          <p>{rich(scanMessage({ messageCode: warning.code, messageParams: warning.params }, i18n))}</p>
          <p className="muted">{t('warningAt', { time: formatTime(warning.at, locale) })}</p>
        </section>
      ) : null}

      {/* 全新账号的首次引导：把节奏与风险一次讲清，再让用户自己点开始 */}
      {neverScanned ? (
        <section className="card">
          <h2>{t('firstRunTitle')}</h2>
          <p className="preline">{rich(t('firstRunIntro'))}</p>
          <p className="preline muted">
            {rich(
              t('firstRunPacing', {
                seconds: intervalSec,
                autoHours: summary?.autoScanIntervalHours ?? 12,
                manualHours: summary?.manualScanMinIntervalHours ?? 2,
                cooldownHours: summary?.rateLimitCooldownHours ?? 10,
              }),
            )}
          </p>
          <p className="preline">{rich(t('firstRunRisk'))}</p>
          <p className="muted">{t('firstRunNote')}</p>
          <div className="actions">
            <button
              type="button"
              className="primary-big"
              onClick={onStart}
              disabled={running || manualWaitMinutes > 0}
            >
              {running ? t('scanningButton') : t('firstRunStart')}
            </button>
          </div>
        </section>
      ) : null}

      <section className="card">
        <h2>{t('scanTitle')}</h2>

        <div className="actions scan-actions">
          {/*
            ★ 手动扫描有 2 小时最小间隔：不满足时按钮**置灰**，而不是点了才报错。
              用户明确要求「不允许手动扫描的时候，立即扫描按钮应该灰色，不允许点击」。
          */}
          <button
            type="button"
            className="primary-big"
            onClick={onStart}
            disabled={!loggedIn || running || manualWaitMinutes > 0}
            title={
              manualWaitMinutes > 0
                ? t('manualWaitNote', {
                    hours: summary?.manualScanMinIntervalHours ?? 2,
                    minutes: manualWaitMinutes,
                  })
                : undefined
            }
          >
            {running
              ? t('scanningButton')
              : summary?.lastScanAt
                ? t('scanNow')
                : t('startFirstScan')}
          </button>
          {running ? (
            <button type="button" className="danger" onClick={onStop}>
              {t('stopButton')}
            </button>
          ) : null}
          {!loggedIn ? <span className="muted">{t('loginFirstHint')}</span> : null}
        </div>

        {running ? (
          <>
            <div className="progress-outer">
              <div className="progress-inner" style={{ width: `${percent}%` }} />
            </div>
            <p className="muted">
              {progress ? scanMessage(progress, i18n) : t('scanListing')}
              {total > 0 ? ` (${done}/${total})` : ''}
            </p>
          </>
        ) : progress ? (
          <p className="status-line">{scanMessage(progress, i18n)}</p>
        ) : null}

        {/* ★ 所有数字都标注为「上次扫描」得到的数据，不是实时状态 */}
        <div className="scan-stats">
          <div className="scan-stat">
            <span className="n">{summary?.friendCount ?? '—'}</span>
            <span className="k">{t('statScannedFriends')}</span>
          </div>
          <div className="scan-stat">
            <span className="n">{summary?.lastScanStats?.changes ?? '—'}</span>
            <span className="k">{t('statScannedChanges')}</span>
          </div>
          <div className="scan-stat">
            <span className="n">{summary?.eventCount ?? '—'}</span>
            <span className="k">{t('statTotalChanges')}</span>
          </div>
          <div className="scan-stat">
            <span className="n">
              {summary?.lastScanAt ? formatTime(summary.lastScanAt, locale) : t('statNoData')}
            </span>
            <span className="k">{t('statLastScan')}</span>
          </div>
          <div className="scan-stat">
            <span className="n">
              {/*
                自动扫描被用户在设置里关掉时显示「已关闭」，
                而不是显示 "—" 或一个永远不变的时间（那会让人以为坏了）。
              */}
              {summary && !summary.autoScanEnabled
                ? t('autoScanOffStat')
                : summary?.nextAutoScanAt
                  ? formatTime(summary.nextAutoScanAt, locale)
                  : /* 从未扫描过 → 不会有自动扫描，不要显示"—"让人以为是坏了 */
                    neverScanned
                    ? t('statNoData')
                    : '—'}
            </span>
            <span className="k">{t('statNextAutoScan')}</span>
          </div>
        </div>

        {/* ★ 耗时预估（用户要求在好友多的时候给出说明）。 */}
        {friendCount > 0 ? (
          <p className="muted">
            {rich(
              t('scanEstimate', {
                count: friendCount,
                seconds: intervalSec,
                minutes: estimateMinutes,
              }),
            )}
          </p>
        ) : null}
        {!running && manualWaitMinutes > 0 ? (
          <p className="muted">
            {t('manualWaitNote', {
              hours: summary?.manualScanMinIntervalHours ?? 2,
              minutes: manualWaitMinutes,
            })}
          </p>
        ) : null}
      </section>

      <section className="card">
        <div className="card-head-row">
          <h2>{t('recentChangesTitle')}</h2>
          <button type="button" className="ghost" onClick={onSeeAllChanges}>
            {t('viewAll', { n: changes.length })}
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="empty-hint">
            {t('emptyChangesLine1')}
            <br />
            <span className="muted">{rich(t('emptyChangesLine2'))}</span>
          </div>
        ) : (
          <ChangeList
            changes={recent}
            isDev={false}
            onClearTest={onClearTest}
            compact
            onSelectFriend={onSelectFriend}
          />
        )}
        {isDev && testCount > 0 ? <p className="muted">{t('simNote', { n: testCount })}</p> : null}
      </section>
    </>
  )
}
