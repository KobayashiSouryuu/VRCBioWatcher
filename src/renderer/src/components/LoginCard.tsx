import { useState, type JSX } from 'react'
import type { AuthState } from '@shared/types'
import { rich, twoFactorLabelKey, useI18n } from '../i18n'

/**
 * 登录卡片。三种形态：未登录表单 / 两步验证 / 已登录。
 *
 * 关于密码：它只在「登录」被点击时向上传一次，主进程用它换 cookie 之后就不再持有。
 * 这里不写任何 localStorage / sessionStorage —— 密码不落在渲染进程的任何持久位置。
 */
export function LoginCard({
  auth,
  busy,
  onLogin,
  onSubmitTwoFactor,
  onCancelTwoFactor,
  onLogout,
}: {
  auth: AuthState | null
  busy: boolean
  onLogin: (username: string, password: string) => void
  onSubmitTwoFactor: (code: string) => void
  onCancelTwoFactor: () => void
  onLogout: () => void
}): JSX.Element {
  const { t } = useI18n()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')

  const status = auth?.status ?? 'logged-out'

  if (status === 'logged-in' && auth?.self) {
    return (
      <section className="card">
        <h2>{t('loginStatusTitle')}</h2>
        <div className="login-ok">
          <span className="dot-ok" />
          {t('signedInAs', { name: auth.self.displayName })}
        </div>
        <p className="muted mono">
          {t('userIdLabel')}: {auth.self.id}
        </p>
        <p className="muted">{auth.message}</p>
        <div className="actions">
          <button type="button" className="ghost" onClick={onLogout} disabled={busy}>
            {t('logoutButton')}
          </button>
        </div>
      </section>
    )
  }

  if (status === 'needs-2fa') {
    // 方式名由 VRChat 给，可能是我们没见过的值，所以兜底显示原始字符串
    const methods = (auth?.twoFactorMethods ?? [])
      .map((m) => {
        const key = twoFactorLabelKey(m)
        return key ? t(key) : m
      })
      .join(' / ')
    return (
      <section className="card">
        <h2>{t('twoFactorTitle')}</h2>
        <p className="muted">
          {t('twoFactorHint', { methods: methods || t('twoFactorUnknown') })}
        </p>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmitTwoFactor(code)
          }}
        >
          <label className="field">
            <span>{t('codeLabel')}</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t('codePlaceholder')}
            />
          </label>
          <div className="actions">
            <button type="submit" disabled={busy || code.trim() === ''}>
              {busy ? t('verifyingButton') : t('submitCodeButton')}
            </button>
            <button type="button" className="ghost" onClick={onCancelTwoFactor} disabled={busy}>
              {t('backButton')}
            </button>
          </div>
        </form>
        {auth?.message ? <p className="status-line">{auth.message}</p> : null}
      </section>
    )
  }

  return (
    <section className="card">
      <h2>{t('loginTitle')}</h2>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          onLogin(username, password)
          setPassword('')
        }}
      >
        <label className="field">
          <span>{t('usernameLabel')}</span>
          <input
            type="text"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('usernamePlaceholder')}
          />
        </label>
        <label className="field">
          <span>{t('passwordLabel')}</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('passwordPlaceholder')}
          />
        </label>
        <div className="actions">
          <button type="submit" disabled={busy || username.trim() === '' || password === ''}>
            {busy ? t('loggingInButton') : t('loginButton')}
          </button>
        </div>
      </form>
      <p className="muted">{rich(t('passwordNote'))}</p>
      {auth?.message ? <p className="status-line">{auth.message}</p> : null}
    </section>
  )
}
