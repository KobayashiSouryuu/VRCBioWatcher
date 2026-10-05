import { useState, type JSX } from 'react'
import type { AuthState, ScanSummary } from '@shared/types'
import { APP_NAME, APP_NAME_BODY, APP_NAME_PREFIX } from '@shared/project'
import { PAGES, type PageKey } from '../lib'
import { useI18n } from '../i18n'

/** 左侧导航：页面切换 + 底部统计 + 账号（点击可退出登录）。 */
export function Sidebar({
  page,
  onChange,
  auth,
  summary,
  onLogout,
}: {
  page: PageKey
  onChange: (page: PageKey) => void
  auth: AuthState | null
  summary: ScanSummary | null
  onLogout: () => void
}): JSX.Element {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const name = auth?.self?.displayName ?? t('loggedIn')
  /** 上一轮扫描出过问题 → 在「概览」旁边挂一个提醒标记（详情在概览页的横幅里） */
  const hasWarning = Boolean(summary?.lastScanWarning)

  return (
    <nav className="sidebar">
      {/* 名字一行显示：前缀用主题色，其余用正文色（用户要求"用颜色区分"） */}
      <div className="brand">
        <div className="brand-title" title={APP_NAME}>
          <span className="brand-accent">{APP_NAME_PREFIX}</span>
          {APP_NAME_BODY}
        </div>
      </div>

      <ul className="nav-list">
        {PAGES.map((p) => (
          <li key={p.key}>
            <button
              type="button"
              className={page === p.key ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setMenuOpen(false)
                onChange(p.key)
              }}
              title={hasWarning && p.key === 'overview' ? t('warningTitle') : t(p.hintKey)}
            >
              {t(p.labelKey)}
              {/*
                概览旁边的异常标记。侧栏是常驻的，所以用户切到任何页面
                都能看到"后台出过事"，不用等他主动回概览页。
              */}
              {hasWarning && p.key === 'overview' ? <span className="nav-alert">!</span> : null}
            </button>
          </li>
        ))}
      </ul>

      <div className="sidebar-foot">
        {/*
          只放两个数字：本次变化 / 累计变化。
          「已解除」已按用户要求删掉 —— 好友删了就是删了，没必要常驻显示。
        */}
        <div className="sidebar-stat">
          <span className="n">{summary?.lastScanStats?.changes ?? '—'}</span>
          <span className="k">{t('sideSessionChanges')}</span>
        </div>
        <div className="sidebar-stat">
          <span className="n">{summary?.eventCount ?? '—'}</span>
          <span className="k">{t('sideTotalChanges')}</span>
        </div>

        {/*
          账号区：整块居中、字号大一点、可点击。
          点开才是「退出登录」—— 平时不占地方，也不容易误触。
          ⚠ 这里不再显示"在线绿点"：整个侧栏只在登录后才会渲染，
            那个点等于在说"你已经登录了"，纯属多余。
        */}
        <div className="sidebar-account-wrap">
          {menuOpen ? (
            <div className="sidebar-account-menu">
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setMenuOpen(false)
                  onLogout()
                }}
              >
                {t('logoutButton')}
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="sidebar-account"
            onClick={() => setMenuOpen((open) => !open)}
            title={name}
          >
            {/* 绿点没有功能意义，但用户觉得好看，就留着 */}
            <span className="dot-ok" />
            <span className="ellipsis">{name}</span>
          </button>
        </div>
      </div>
    </nav>
  )
}
