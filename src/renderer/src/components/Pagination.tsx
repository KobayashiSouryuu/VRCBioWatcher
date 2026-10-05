import type { JSX } from 'react'
import { useI18n } from '../i18n'

/**
 * 分页条。
 *
 * 为什么所有列表都要分页（而不是无限滚动）：
 *   1. 几百上千条 DOM 节点会让滚动明显卡顿 —— 分页天然解决了这个问题
 *   2. 用户能知道自己"在第几页"，也能直接跳页，比滚到底部更可控
 *   3. 每页条数可以自己设（对齐 VRCX 的习惯）
 *
 * 「自动」每页条数由调用方按窗口高度算出来（见 FriendsTable 的 autoRows），
 * 这里只负责显示与切换。
 */
export function Pagination({
  total,
  page,
  pages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  autoToggle,
  minPageSize = 10,
  maxPageSize = 500,
}: {
  total: number
  page: number
  /** 总页数由调用方算好传进来 —— 因为「自动」模式下每页条数是调用方算的 */
  pages: number
  pageSize: number
  /**
   * `scrollToEnd` 为 true 表示这是「末页」—— 调用方应把视野拉到底部而不是顶部。
   * 用户明确要求点末页要直接到底。
   */
  onPageChange: (page: number, scrollToEnd?: boolean) => void
  onPageSizeChange: (size: number) => void
  /** 提供「自动」开关；不传就没有这一项（例如变化记录页） */
  autoToggle?: { enabled: boolean; computed: number; onChange: (enabled: boolean) => void }
  minPageSize?: number
  maxPageSize?: number
}): JSX.Element | null {
  const { t } = useI18n()
  if (total === 0) return null

  const current = Math.min(Math.max(1, page), pages)
  const autoEnabled = autoToggle?.enabled ?? false

  return (
    <div className="pagination">
      <span className="muted">{t('pageSummary', { total, page: current, pages })}</span>

      <div className="pagination-controls">
        <button type="button" className="ghost" disabled={current <= 1} onClick={() => onPageChange(1)}>
          {t('firstPage')}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
        >
          {t('prevPage')}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={current >= pages}
          onClick={() => onPageChange(current + 1)}
        >
          {t('nextPage')}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={current >= pages}
          onClick={() => onPageChange(pages, true)}
        >
          {t('lastPage')}
        </button>
      </div>

      {/* 直接跳到第几页（用户要求） */}
      <label className="page-jump">
        {t('pageJump')}
        <input
          type="number"
          min={1}
          max={pages}
          value={current}
          onChange={(e) => {
            const next = Number(e.target.value)
            if (Number.isFinite(next) && next >= 1) onPageChange(Math.min(pages, Math.round(next)))
          }}
        />
        {t('pageJumpUnit')}
      </label>

      {/*
        每页条数：顺序是「□自动  每页 N 条」（用户指定的顺序）。
        ⚠ 外层不能用 <label> 再套 <label>（HTML 不允许嵌套），所以外层是 div。
      */}
      <div className="page-size">
        {autoToggle ? (
          <label
            className="checkbox inline-checkbox"
            title={t('autoPageHint', { n: autoToggle.computed })}
          >
            <input
              type="checkbox"
              checked={autoToggle.enabled}
              onChange={(e) => autoToggle.onChange(e.target.checked)}
            />
            {t('perPageAuto')}
          </label>
        ) : null}

        <label className="page-size-value">
          {t('perPage')}
          {autoEnabled ? (
            <span className="auto-count">{autoToggle?.computed ?? pageSize}</span>
          ) : (
            <input
              type="number"
              min={minPageSize}
              max={maxPageSize}
              step={10}
              value={pageSize}
              onChange={(e) => {
                const next = Number(e.target.value)
                if (Number.isFinite(next) && next > 0) {
                  onPageSizeChange(Math.min(maxPageSize, Math.max(minPageSize, Math.round(next))))
                }
              }}
            />
          )}
          {t('perPageUnit')}
        </label>
      </div>
    </div>
  )
}
