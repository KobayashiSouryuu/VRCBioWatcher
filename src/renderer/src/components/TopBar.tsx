import type { JSX } from 'react'
import type { ScanProgress, ThemePreference } from '@shared/types'
import { formatTime } from '../lib'
import { LANGS, useI18n, type Lang } from '../i18n'

const THEME_OPTIONS: { value: ThemePreference; labelKey: 'themeSystem' | 'themeLight' | 'themeDark' }[] =
  [
    { value: 'system', labelKey: 'themeSystem' },
    { value: 'light', labelKey: 'themeLight' },
    { value: 'dark', labelKey: 'themeDark' },
  ]

/**
 * 顶部状态条。
 *
 * 它常驻在**每个页面**上方，因为有两件事用户在任何页面都想看到：
 *   1. 扫描进度 —— 扫描要跑好几分钟，用户会切到别的页面去看好友列表
 *   2. 主题与语言切换
 */
export function TopBar({
  progress,
  running,
  lastScanAt,
  theme,
  onThemeChange,
  lang,
  onLangChange,
}: {
  progress: ScanProgress | null
  running: boolean
  lastScanAt: string | null | undefined
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  lang: Lang
  onLangChange: (lang: Lang) => void
}): JSX.Element {
  const i18n = useI18n()
  const { t, locale } = i18n
  const total = progress?.total ?? 0
  const done = progress?.done ?? 0
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0

  return (
    <header className="topbar">
      <div className="topbar-left">
        {running ? (
          <div className="scan-indicator">
            <span className="spinner" />
            <span>
              {t('scanning')} {total > 0 ? `${done}/${total}` : ''}
              {percent > 0 ? `（${percent}%）` : ''}
            </span>
          </div>
        ) : (
          <span className="muted">{t('lastScanAt', { time: formatTime(lastScanAt, locale) })}</span>
        )}
      </div>

      <div className="topbar-right">
        <div className="theme-switch" role="group" aria-label={t('languageLabel')}>
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

        <div className="theme-switch">
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
    </header>
  )
}
