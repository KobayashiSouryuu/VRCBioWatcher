import type { JSX } from 'react'
import type { AuthState, LanguagePreference, ThemePreference } from '@shared/types'
import { LoginCard } from './LoginCard'
import { LANGS, rich, useI18n, type TKey } from '../i18n'

const THEME_OPTIONS: { value: ThemePreference; labelKey: TKey }[] = [
  { value: 'system', labelKey: 'themeSystem' },
  { value: 'light', labelKey: 'themeLight' },
  { value: 'dark', labelKey: 'themeDark' },
]

/**
 * 独立登录页。
 *
 * ★ 未登录时**整个界面只有这一页** —— 没有侧栏、没有顶部状态条、没有好友列表。
 *   这是修复「退出登录后还能看到好友数据」那个严重 bug 的界面侧一半：
 *   主进程那边已经保证未登录时读不到任何数据（loadStore 返回空），
 *   这边再保证压根没有入口能看到它。
 *
 * 主题和语言切换仍然保留在这一页上：用户可能就是看不懂当前语言才需要切。
 */
export function LoginPage({
  auth,
  busy,
  theme,
  onThemeChange,
  lang,
  onLangChange,
  onLogin,
  onSubmitTwoFactor,
  onCancelTwoFactor,
}: {
  auth: AuthState | null
  busy: boolean
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  lang: LanguagePreference
  onLangChange: (lang: LanguagePreference) => void
  onLogin: (username: string, password: string) => void
  onSubmitTwoFactor: (code: string) => void
  onCancelTwoFactor: () => void
}): JSX.Element {
  const { t } = useI18n()

  return (
    <div className="login-page">
      <div className="login-topbar">
        <div className="theme-switch">
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

      <div className="login-body">
        <div className="login-hero">
          <h1 className="login-title">{t('loginPageTitle')}</h1>
          <p className="muted login-subtitle">{t('loginPageSubtitle')}</p>
          <ul className="login-features">
            <li>{t('loginPageFeature1')}</li>
            <li>{t('loginPageFeature2')}</li>
            <li>{t('loginPageFeature3')}</li>
          </ul>
        </div>

        <div className="login-form-wrap">
          <LoginCard
            auth={auth}
            busy={busy}
            onLogin={onLogin}
            onSubmitTwoFactor={onSubmitTwoFactor}
            onCancelTwoFactor={onCancelTwoFactor}
            onLogout={() => {
              /* 登录页上没有「退出登录」的场景，留空 */
            }}
          />
          <p className="muted login-privacy">{rich(t('loginPagePrivacy'))}</p>
        </div>
      </div>
    </div>
  )
}
