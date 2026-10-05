import { useEffect, useState, type JSX } from 'react'
import type {
  AuthState,
  DataDirInfo,
  LanguagePreference,
  MoveDataResult,
  ScanSummary,
  SystemInfo,
  ThemePreference,
} from '@shared/types'
import { fontExists, formatTime } from '../lib'
import { LANGS, rich, useI18n, type TKey } from '../i18n'

/** 顺序是用户指定的：系统 → 浅色 → 深色 */
const THEME_OPTIONS: { value: ThemePreference; labelKey: TKey }[] = [
  { value: 'system', labelKey: 'themeSystem' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
]

/** 设置页 */
export function SettingsPage({
  theme,
  onThemeChange,
  lang,
  onLangChange,
  pageSize,
  onPageSizeChange,
  autoPageSizeFriends,
  onAutoPageSizeFriendsChange,
  autoPageSizeChanges,
  onAutoPageSizeChangesChange,
  showRemovedFriends,
  onShowRemovedFriendsChange,
  fontScale,
  onFontScaleChange,
  fontFamily,
  onFontFamilyChange,
  encryptData,
  onEncryptDataChange,
  autoLaunch,
  onAutoLaunchChange,
  startMinimized,
  onStartMinimizedChange,
  minimizeToTray,
  onMinimizeToTrayChange,
  summary,
  info,
  openResult,
  onOpenDataDir,
  onDataMoved,
  auth,
  busy,
  onLogout,
  isDev,
  testCount,
  onClearTest,
  onInject,
}: {
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  lang: LanguagePreference
  onLangChange: (lang: LanguagePreference) => void
  pageSize: number
  onPageSizeChange: (size: number) => void
  autoPageSizeFriends: boolean
  onAutoPageSizeFriendsChange: (value: boolean) => void
  autoPageSizeChanges: boolean
  onAutoPageSizeChangesChange: (value: boolean) => void
  showRemovedFriends: boolean
  onShowRemovedFriendsChange: (value: boolean) => void
  fontScale: number
  onFontScaleChange: (scale: number) => void
  fontFamily: string
  onFontFamilyChange: (family: string) => void
  encryptData: boolean
  onEncryptDataChange: (value: boolean) => void
  autoLaunch: boolean
  onAutoLaunchChange: (value: boolean) => void
  startMinimized: boolean
  onStartMinimizedChange: (value: boolean) => void
  minimizeToTray: boolean
  onMinimizeToTrayChange: (value: boolean) => void
  summary: ScanSummary | null
  info: SystemInfo | null
  openResult: string | null
  onOpenDataDir: () => void
  /** 数据目录迁移成功后通知 App 刷新（账号数据目录那几行会变） */
  onDataMoved: () => void
  auth: AuthState | null
  busy: boolean
  onLogout: () => void
  isDev: boolean
  testCount: number
  onClearTest: () => void
  onInject: (kind: 'bio' | 'friendAdded' | 'friendRemoved') => void
}): JSX.Element {
  const { t, locale } = useI18n()
  const loggedIn = auth?.status === 'logged-in'
  const cooldown = summary?.cooldownMinutesLeft ?? 0
  const intervalSec = summary?.requestIntervalSeconds ?? 3
  const friendCount = summary?.friendCount ?? 0
  const estimateMinutes = Math.max(1, Math.ceil((friendCount * (intervalSec + 0.3)) / 60))
  const encryptionAvailable = info?.safeStorageAvailable ?? false

  /* --- 数据位置（自包含在这里，不必让 App 知道）--- */
  const [dataDir, setDataDir] = useState<DataDirInfo | null>(null)
  const [moving, setMoving] = useState(false)
  const [moveResult, setMoveResult] = useState<MoveDataResult | null>(null)

  const refreshDataDir = (): void => {
    void window.vrcbw
      .getDataDirInfo()
      .then(setDataDir)
      .catch(() => {
        /* 忽略 */
      })
  }

  useEffect(() => {
    refreshDataDir()
  }, [])

  const runMove = async (target: string): Promise<void> => {
    setMoving(true)
    setMoveResult(null)
    try {
      const result = await window.vrcbw.moveDataDir(target)
      setMoveResult(result)
      if (result.ok) {
        refreshDataDir()
        onDataMoved()
      }
    } catch (err) {
      setMoveResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        files: 0,
        bytes: 0,
      })
    } finally {
      setMoving(false)
    }
  }

  const onChangeDataDir = (): void => {
    void window.vrcbw
      .chooseDataDir()
      .then((picked) => {
        if (picked) return runMove(picked)
        return undefined
      })
      .catch(() => {
        /* 用户取消或对话框失败都不需要报错 */
      })
  }

  const onResetDataDir = (): void => {
    void runMove('default')
  }

  return (
    <>
      <section className="card risk-note">
        <h2>{t('pacingTitle')}</h2>

        {friendCount > 0 ? (
          <p>
            {rich(
              t('scanEstimate', {
                count: friendCount,
                seconds: intervalSec,
                minutes: estimateMinutes,
              }),
            )}
          </p>
        ) : null}
        <p>{rich(t('scanLongWarning'))}</p>
        <p className="preline">
          {rich(
            t('scanScheduleNote', {
              hours: summary?.autoScanIntervalHours ?? 10,
              manualHours: summary?.manualScanMinIntervalHours ?? 2,
            }),
          )}
        </p>
        <p>
          {rich(t('scanRateLimitNote', { cooldownHours: summary?.rateLimitCooldownHours ?? 10 }))}
        </p>

        <p className="muted">
          {summary?.nextAutoScanAt
            ? t('nextAutoScanNote', { time: formatTime(summary.nextAutoScanAt, locale) })
            : t('nextAutoScanNone')}
        </p>
        {cooldown > 0 ? (
          <p className="status-line error">
            {t('scanCooldown', {
              minutes: cooldown,
              hours: summary?.rateLimitCooldownHours ?? 10,
            })}
            {summary?.lastRateLimitAt ? `（${formatTime(summary.lastRateLimitAt, locale)}）` : ''}
          </p>
        ) : summary?.lastRateLimitAt ? (
          <p className="status-line">
            {t('riskLastLimited', { time: formatTime(summary.lastRateLimitAt, locale) })}
          </p>
        ) : (
          <p className="status-line">{t('riskNeverLimited')}</p>
        )}

        {/* 429 时的行动指引：去 GitHub 反馈 + 建议停用 */}
        <p>{rich(t('riskReportNote'))}</p>
        <p className="muted">{rich(t('logNote'))}</p>

        {/* 数据来源说明：所有变化都来自扫描，与 VRCX 不同 */}
        <p className="muted preline">{rich(t('dataSourceNote'))}</p>
      </section>

      <section className="card">
        <h2>{t('appearanceTitle')}</h2>

        <div className="row">
          <div className="row-label">{t('themeLabel')}</div>
          <div className="row-value">
            <div className="theme-switch theme-switch-inline">
              {THEME_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  className={theme === opt.value ? 'active' : ''}
                  onClick={() => onThemeChange(opt.value)}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="row">
          <div className="row-label">{t('languageLabel')}</div>
          <div className="row-value">
            <div className="theme-switch theme-switch-inline">
              {LANGS.map((l) => (
                <button
                  type="button"
                  key={l.value}
                  className={lang === l.value ? 'active' : ''}
                  onClick={() => onLangChange(l.value)}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="row">
          <div className="row-label">{t('fontLabel')}</div>
          <div className="row-value">
            <input
              type="text"
              className="font-name-input"
              defaultValue={fontFamily}
              placeholder={t('fontPlaceholder')}
              onBlur={(e) => onFontFamilyChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
            />
            {fontFamily ? (
              fontExists(fontFamily) ? (
                <span className="font-status ok">{t('fontApplied')}</span>
              ) : (
                <span className="font-status missing">{t('fontMissing', { name: fontFamily })}</span>
              )
            ) : (
              <span className="muted font-hint-inline">{t('fontHint')}</span>
            )}
          </div>
        </div>

        <div className="row">
          <div className="row-label">{t('fontScaleLabel')}</div>
          <div className="row-value">
            <input
              type="number"
              min={80}
              max={180}
              step={5}
              value={Math.round(fontScale * 100)}
              onChange={(e) => {
                const next = Number(e.target.value)
                if (Number.isFinite(next) && next > 0) onFontScaleChange(next / 100)
              }}
              className="page-size-input"
            />
            <span className="muted"> %</span>
            <button
              type="button"
              className="ghost"
              onClick={() => onFontScaleChange(1)}
              disabled={Math.round(fontScale * 100) === 100}
            >
              {t('reset')}
            </button>
          </div>
        </div>

        {/* 分组：两个列表的条目高度差别很大，所以「自动」是**两个独立开关**，
            但它们和下面的说明属于同一组（组内不再分割）。 */}
        <div className="setting-group">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={autoPageSizeFriends}
              onChange={(e) => onAutoPageSizeFriendsChange(e.target.checked)}
            />
            {t('pageSizeAutoLabel')}
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={autoPageSizeChanges}
              onChange={(e) => onAutoPageSizeChangesChange(e.target.checked)}
            />
            {t('pageSizeAutoChangesLabel')}
          </label>
          <p className="muted">{t('pageSizeAutoNote')}</p>
          {/* 只要有一个列表是手动模式，就需要这个条数输入框 */}
          {!autoPageSizeFriends || !autoPageSizeChanges ? (
            <div className="row">
              <div className="row-label">{t('pageSizeLabel')}</div>
              <div className="row-value">
                <input
                  type="number"
                  min={10}
                  max={500}
                  step={10}
                  value={pageSize}
                  onChange={(e) => {
                    const next = Number(e.target.value)
                    if (Number.isFinite(next) && next > 0) onPageSizeChange(next)
                  }}
                  className="page-size-input"
                />
                <span className="muted"> {t('pageSizeNote')}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="setting-group">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={showRemovedFriends}
              onChange={(e) => onShowRemovedFriendsChange(e.target.checked)}
            />
            {t('showRemovedLabel')}
          </label>
          <p className="muted">{t('showRemovedNote')}</p>
        </div>
      </section>

      {/* --- 首选项（启动与关闭的行为） --- */}
      <section className="card">
        <h2>{t('startupTitle')}</h2>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={autoLaunch}
            onChange={(e) => onAutoLaunchChange(e.target.checked)}
          />
          {t('autoLaunchLabel')}
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={startMinimized}
            onChange={(e) => onStartMinimizedChange(e.target.checked)}
          />
          {t('startMinimizedLabel')}
        </label>

        <label className="checkbox checkbox-with-hint">
          <input
            type="checkbox"
            checked={minimizeToTray}
            onChange={(e) => onMinimizeToTrayChange(e.target.checked)}
          />
          <span className="checkbox-text">{t('minimizeToTrayLabel')}</span>
          {/* 括号提示跟在文字右边（用户要求放在同一行） */}
          <span className="muted checkbox-hint">{t('minimizeToTrayHint')}</span>
        </label>
      </section>

      <section className="card">
        <h2>{t('accountTitle')}</h2>
        {loggedIn && auth?.self ? (
          <>
            <div className="login-ok">
              <span className="dot-ok" />
              {t('signedInAs', { name: auth.self.displayName })}
            </div>
            <p className="muted mono">
              {t('userIdLabel')}: {auth.self.id}
            </p>
            <p className="muted">{rich(t('accountNote'))}</p>
            <div className="actions">
              <button type="button" className="danger" onClick={onLogout} disabled={busy}>
                {t('logoutButton')}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">{t('accountNotLoggedIn')}</p>
        )}
      </section>

      <section className="card">
        <h2>{t('dataTitle')}</h2>
        <p className="muted">{t('accountScopedNote')}</p>

        {/* --- 数据位置（可更改，带校验过的迁移）--- */}
        <div className="row">
          <div className="row-label">{t('dataDirLabel')}</div>
          <div className="row-value mono">{dataDir?.current ?? '…'}</div>
        </div>
        {dataDir?.isCustom ? (
          <div className="row">
            <div className="row-label">{t('dataDirDefaultLabel')}</div>
            <div className="row-value mono">{dataDir.defaultPath}</div>
          </div>
        ) : null}
        <div className="actions">
          <button type="button" onClick={onChangeDataDir} disabled={moving}>
            {moving ? t('dataDirMoving') : t('changeDataDirButton')}
          </button>
          {dataDir?.isCustom ? (
            <button type="button" className="ghost" onClick={onResetDataDir} disabled={moving}>
              {t('resetDataDirButton')}
            </button>
          ) : null}        </div>
        {moveResult ? (
          <p className={moveResult.ok ? 'status-line' : 'status-line error'}>
            {moveResult.ok
              ? t('dataDirMoved', {
                  files: moveResult.files,
                  bytes: `${Math.round(moveResult.bytes / 1024)} KB`,
                })
              : moveResult.message}
          </p>
        ) : null}

        <div className="row">
          <div className="row-label">{t('dataDirAccountLabel')}</div>
          <div className="row-value mono">{summary?.accountDataDir ?? '—'}</div>
        </div>
        <div className="row">
          <div className="row-label">{t('dataDirSettingsLabel')}</div>
          <div className="row-value mono">{info?.userDataDir ?? '…'}</div>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={encryptData}
            disabled={!encryptionAvailable}
            onChange={(e) => onEncryptDataChange(e.target.checked)}
          />
          {t('encryptLabel')} —— {encryptData ? t('encryptOn') : t('encryptOff')}
        </label>
        {!encryptionAvailable ? <p className="status-line error">{t('encryptUnavailable')}</p> : null}
        <p className="muted preline">{rich(t('encryptNote'))}</p>

        <p className="muted">{rich(t('dataNote'))}</p>
        <div className="actions">
          <button type="button" className="ghost" onClick={onOpenDataDir}>
            {t('openDataDirButton')}
          </button>
          {openResult ? <span className="muted mono">{openResult}</span> : null}
        </div>
      </section>

      {isDev ? (
        <section className="card">
          <h2>{t('devToolsTitle')}</h2>
          <p className="muted">{t('devToolsNote')}</p>
          <div className="actions">
            <button type="button" className="ghost" onClick={() => onInject('bio')}>
              {t('injectBio')}
            </button>
            <button type="button" className="ghost" onClick={() => onInject('friendAdded')}>
              {t('injectAdd')}
            </button>
            <button type="button" className="ghost" onClick={() => onInject('friendRemoved')}>
              {t('injectRemove')}
            </button>
            <button type="button" className="danger" onClick={onClearTest} disabled={testCount === 0}>
              {t('clearTestButton', { n: testCount })}
            </button>
          </div>
        </section>
      ) : null}

      {info ? (
        <section className="card">
          <h2>{t('envTitle')}</h2>
          <div className="row">
            <div className="row-label">{t('envElectron')}</div>
            <div className="row-value">{info.electron}</div>
          </div>
          <div className="row">
            <div className="row-label">{t('envChromium')}</div>
            <div className="row-value">{info.chrome}</div>
          </div>
          <div className="row">
            <div className="row-label">{t('envMode')}</div>
            <div className="row-value">{info.isDev ? t('envModeDev') : t('envModeProd')}</div>
          </div>
          <div className="row">
            <div className="row-label">{t('envCredential')}</div>
            <div className="row-value">
              {info.safeStorageAvailable ? t('envCredentialOk') : t('envCredentialBad')}
            </div>
          </div>
        </section>
      ) : null}
    </>
  )
}