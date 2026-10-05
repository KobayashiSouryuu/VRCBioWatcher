import type { JSX } from 'react'
import type { ChangeEvent, FriendRecord } from '@shared/types'
import { formatTime, isRelationChange, isTestEvent } from '../lib'
import { fieldLabelKey, useI18n } from '../i18n'
import { DiffView } from './DiffView'

/**
 * 好友详情抽屉：从右侧滑出，不离开列表。
 *
 * 这样看完一个人能立刻回去看下一个，不用来回跳页 —— 这是选择抽屉而不是
 * 独立详情页的主要理由。
 */
export function FriendDrawer({
  friend,
  changes,
  onClose,
}: {
  friend: FriendRecord
  changes: ChangeEvent[]
  onClose: () => void
}): JSX.Element {
  const { t, locale } = useI18n()
  // 只看这个人的变化，按时间倒序（changes 已经是倒序的）。
  // ★ 抽屉里**最多显示 5 条**：积攒几十条会让抽屉又长又卡，用户也只需要看最近几次。
  const HISTORY_LIMIT = 5
  const all = changes.filter((c) => c.userId === friend.id)
  const mine = all.slice(0, HISTORY_LIMIT)

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <h2 className="drawer-title">{friend.displayName}</h2>
            <div className="drawer-sub">
              {t('colFriendNumber')} {friend.friendNumber ?? friend.seq}
              {friend.removed ? <span className="tag-removed">{t('badgeRemoved')}</span> : null}
            </div>
          </div>
          <button type="button" className="ghost" onClick={onClose} title={t('close')}>
            {t('close')}
          </button>
        </div>

        <section className="drawer-section">
          <h3>{t('drawerCurrentBio')}</h3>
          {friend.bio.trim() === '' ? (
            <p className="muted">{t('noBio')}</p>
          ) : (
            <pre className="bio-block">{friend.bio}</pre>
          )}
          {friend.bioLinks.trim() !== '' ? (
            <>
              <h3>{t('drawerBioLinks')}</h3>
              <pre className="bio-block">{friend.bioLinks}</pre>
            </>
          ) : null}
        </section>

        <section className="drawer-section">
          <h3>{t('drawerInfo')}</h3>
          <div className="row">
            <div className="row-label">{t('labelFirstSeen')}</div>
            <div className="row-value">{formatTime(friend.firstSeenAt, locale)}</div>
          </div>
          <div className="row">
            <div className="row-label">{t('labelLastChecked')}</div>
            <div className="row-value">{formatTime(friend.lastCheckedAt, locale)}</div>
          </div>
          <div className="row">
            <div className="row-label">{t('labelLastChanged')}</div>
            <div className="row-value">{formatTime(friend.lastChangedAt, locale)}</div>
          </div>
          <div className="row">
            <div className="row-label">{t('labelChangeCount')}</div>
            <div className="row-value">{friend.changeCount}</div>
          </div>
          <div className="row">
            <div className="row-label">{t('userIdLabel')}</div>
            {/* 刻意不用 .mono：这里展示的是资料信息，不是代码 */}
            <div className="row-value">{friend.id}</div>
          </div>
        </section>

        <section className="drawer-section">
          <h3>{t('drawerHistory', { n: all.length })}</h3>
          {mine.length === 0 ? (
            <p className="muted">{t('drawerNoHistory')}</p>
          ) : (
            <div className="change-list">
              {mine.map((ev) => (
                <div className="change-item" key={ev.id}>
                  <div className="change-head">
                    <span
                      className={isRelationChange(ev.field) ? 'change-field relation' : 'change-field'}
                    >
                      {t(fieldLabelKey(ev.field))}
                    </span>
                    <span className="change-time">
                      {formatTime(ev.at, locale)}
                      {t('scanTimeSuffix')}
                    </span>
                    {isTestEvent(ev) ? <span className="tag-test">{t('tagTest')}</span> : null}
                  </div>
                  {isRelationChange(ev.field) ? (
                    <p className="relation-line">
                      {ev.field === 'friendAdded' ? t('relationAdded') : t('relationRemovedShort')}
                    </p>
                  ) : (
                    <DiffView before={ev.before} after={ev.after} />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>
    </>
  )
}
