import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import type { FriendRecord, FriendSortKey } from '@shared/types'
import { contentContainer, formatDate, scrollToBottom, scrollToTop, summarize } from '../lib'
import { useI18n, type I18n, type TKey } from '../i18n'
import { Pagination } from './Pagination'
import { SearchInput } from './SearchInput'

type SortKey = FriendSortKey

/**
 * 显示用的序号。
 *
 * 优先用 `friendNumber`（= VRChat 的 friends 数组下标 + 1，也就是加好友顺序，
 * 与 VRCX 的 `No.` 列同源）；只有当某条记录从未拿到过 API 顺序时，
 * 才回退到早期的本地编号 `seq`。
 */
function orderOf(f: FriendRecord): number {
  return f.friendNumber ?? f.seq
}

/**
 * ⚠ 列定义**同时驱动表头和单元格**，这是有意的。
 *
 * 之前的写法是：表头用 COLUMNS.slice() 拼、单元格用另一个独立的 <td> 序列。
 * 两者顺序一旦不一致，就会出现「表头写着变化次数、底下显示的是日期」这种错位，
 * 而且肉眼很难发现。现在只有这一份定义，错位在结构上不可能发生。
 */
interface Column {
  key: string
  labelKey: TKey
  /** 鼠标悬停提示；不填就没有提示（用户要求删掉多余的说明） */
  hintKey?: TKey
  sortKey?: SortKey
  className: string
  cell: (f: FriendRecord, i18n: I18n) => ReactNode
}

/**
 * 列：序号 / 昵称 / 简介 / 最近变化。
 *
 * 「首次记录」「上次检查」已按用户要求删除 —— 实际用不上，只占宽度。
 * 「变化次数」更早就删了（改成段落级对比后没有意义）。
 */
const COLUMNS: Column[] = [
  {
    key: 'friendNumber',
    labelKey: 'colFriendNumber',
    sortKey: 'friendNumber',
    className: 'col-seq',
    cell: (f) => orderOf(f),
  },
  {
    key: 'displayName',
    labelKey: 'colDisplayName',
    sortKey: 'displayName',
    className: 'col-name',
    cell: (f, i18n) => (
      <>
        {f.displayName}
        {f.removed ? <span className="tag-removed">{i18n.t('badgeRemoved')}</span> : null}
      </>
    ),
  },
  {
    key: 'bio',
    labelKey: 'colBio',
    hintKey: 'colBioHint',
    className: 'col-bio',
    cell: (f, i18n) =>
      f.bio ? summarize(f.bio, 400) : <span className="muted">{i18n.t('noneText')}</span>,
  },
  {
    key: 'lastChangedAt',
    labelKey: 'colLastChanged',
    hintKey: 'colLastChangedHint',
    sortKey: 'lastChangedAt',
    className: 'col-date',
    cell: (f, i18n) => (f.lastChangedAt ? formatDate(f.lastChangedAt, i18n.locale) : ''),
  },
]

/** 好友列表：排序、搜索、分页。 */
export function FriendsTable({
  friends,
  onSelect,
  pageSize,
  onPageSizeChange,
  autoPageSize,
  onAutoPageSizeChange,
  showRemoved,
  sortKey,
  sortAsc,
  onSortChange,
  query,
  onQueryChange,
}: {
  friends: FriendRecord[]
  onSelect: (id: string) => void
  pageSize: number
  onPageSizeChange: (size: number) => void
  autoPageSize: boolean
  onAutoPageSizeChange: (value: boolean) => void
  /** 是否显示已解除的好友。开关挪到设置页了，见 SettingsPage */
  showRemoved: boolean
  /*
   * 排序与搜索由**上层持有并持久化**（存进 settings.json）。
   * 以前放在组件内部的 useState 里，而切页面会卸载组件 →
   * "我按最近变化排序，切到设置再回来就变回序号正序了"。见 docs/DECISIONS.md 3.11。
   */
  sortKey: FriendSortKey
  sortAsc: boolean
  onSortChange: (key: FriendSortKey, asc: boolean) => void
  query: string
  onQueryChange: (query: string) => void
}): JSX.Element {
  const i18n = useI18n()
  const { t, locale } = i18n
  const [page, setPage] = useState(1)
  const tableScrollRef = useRef<HTMLDivElement>(null)
  /** 待执行的滚动方向；必须等新一页渲染完才能滚（见 lib.ts 的 scrollToBottom 注释） */
  const [pendingScroll, setPendingScroll] = useState<'top' | 'end' | null>(null)
  /** 「自动」模式下算出来的每页条数 */
  const [autoRows, setAutoRows] = useState(20)

  const goToPage = (next: number, scrollToEnd = false): void => {
    setPage(next)
    setPendingScroll(scrollToEnd ? 'end' : 'top')
  }

  // 页面切换**提交之后**再滚动，否则滚的是旧内容的高度
  useEffect(() => {
    if (pendingScroll === null) return
    if (pendingScroll === 'end') {
      scrollToBottom(tableScrollRef.current, contentContainer())
    } else {
      scrollToTop(tableScrollRef.current, contentContainer())
    }
    setPendingScroll(null)
  }, [pendingScroll, page])

  /**
   * 按窗口高度算「刚好不出现滚动条」的条数。
   *
   * 实现要点：
   *   1. 容器高度是 flex 撑满的（不随内容变化），所以量一次就稳定 ——
   *      不会出现"算条数 → 内容变高 → 再算"这种来回抖动的循环
   *   2. 行高用**表格总高减去表头再除以行数**算，而不是量第一行 ——
   *      某一行可能带标记而偏高，量单行会得出偏大的值，进而少算一行
   *   3. 用 ResizeObserver 监听容器尺寸，窗口缩放时自动重算
   */
  useEffect(() => {
    const el = tableScrollRef.current
    if (!el) return
    const measure = (): void => {
      const table = el.querySelector('table')
      const header = el.querySelector('thead')
      const rows = el.querySelectorAll('tbody tr')
      const headerH = header?.getBoundingClientRect().height ?? 32
      let rowH = 33
      if (table && header && rows.length > 0) {
        const bodyH = table.getBoundingClientRect().height - headerH
        rowH = bodyH / rows.length
      }
      // 减 1px 容差：边框和亚像素会让"刚好放下"变成"差一点"，于是蹦出滚动条。
      // （用户实测 -2px 时底部会空出一块，所以收窄到 1px。）
      const available = el.clientHeight - headerH - 1
      setAutoRows(Math.max(3, Math.floor(available / Math.max(1, rowH))))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const effectivePageSize = autoPageSize ? autoRows : pageSize

  useEffect(() => {
    setPage(1)
  }, [query, showRemoved, sortKey, sortAsc, effectivePageSize, friends.length])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = friends
    if (!showRemoved) list = list.filter((f) => !f.removed)
    if (q !== '') {
      list = list.filter(
        (f) => f.displayName.toLowerCase().includes(q) || f.bio.toLowerCase().includes(q),
      )
    }
    const dir = sortAsc ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case 'displayName':
          return a.displayName.localeCompare(b.displayName, locale) * dir
        case 'lastChangedAt':
          return String(a.lastChangedAt ?? '').localeCompare(String(b.lastChangedAt ?? '')) * dir
        default:
          return (orderOf(a) - orderOf(b)) * dir
      }
    })
  }, [friends, sortKey, sortAsc, query, showRemoved, locale])

  const pages = Math.max(1, Math.ceil(rows.length / effectivePageSize))
  const current = Math.min(page, pages)
  const visible = rows.slice((current - 1) * effectivePageSize, current * effectivePageSize)

  const toggleSort = (key: SortKey | undefined): void => {
    if (!key) return
    if (key === sortKey) onSortChange(key, !sortAsc)
    else onSortChange(key, true)
  }

  return (
    <section className="card fill-height">
      {/* 搜索框和标题同一行、靠右（宽度不够时自动换行）—— 省下一整行高度给列表 */}
      <div className="card-head-row">
        <h2>{t('friendsTitle')}</h2>
        <div className="card-head-tools">
          <SearchInput value={query} onCommit={onQueryChange} placeholder={t('searchPlaceholder')} />
        </div>
      </div>

      {friends.length === 0 ? (
        <div className="empty-hint">{t('noFriendData')}</div>
      ) : (
        <>
          <div className="table-scroll" ref={tableScrollRef}>
            <table className="friends-table">
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      title={col.hintKey ? t(col.hintKey) : undefined}
                      /*
                       * ⚠ 宽度类必须同时加在 th 上！
                       *   表格用的是 table-layout: fixed，而**固定布局的列宽由第一行
                       *   单元格（也就是这些 th）决定**。之前只给 td 加了宽度类，
                       *   结果 th 没有任何宽度信息 → 四列平分整页宽度。
                       */
                      className={col.sortKey ? `${col.className} sortable` : col.className}
                      onClick={() => toggleSort(col.sortKey)}
                    >
                      {t(col.labelKey)}
                      {col.sortKey && sortKey === col.sortKey ? (
                        <span className="sort-mark">{sortAsc ? '▲' : '▼'}</span>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((f) => (
                  <tr
                    key={f.id}
                    className={f.removed ? 'row-removed clickable' : 'clickable'}
                    onClick={() => onSelect(f.id)}
                  >
                    {COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={col.className}
                        title={col.key === 'bio' ? f.bio || t('noBio') : undefined}
                      >
                        {col.cell(f, i18n)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            total={rows.length}
            page={current}
            pages={pages}
            pageSize={effectivePageSize}
            onPageChange={goToPage}
            onPageSizeChange={onPageSizeChange}
            autoToggle={{
              enabled: autoPageSize,
              computed: autoRows,
              onChange: onAutoPageSizeChange,
            }}
          />
        </>
      )}
    </section>
  )
}
