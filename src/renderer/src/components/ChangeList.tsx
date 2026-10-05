import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { ChangeEvent, ChangeFilterKey } from '@shared/types'
import { contentContainer, isRelationChange, isTestEvent, scrollToBottom, scrollToTop } from '../lib'
import { fieldLabelKey, rich, useI18n } from '../i18n'
import { DiffView } from './DiffView'
import { Pagination } from './Pagination'
import { SearchInput } from './SearchInput'
import { formatTime } from '../lib'

type FilterKey = ChangeFilterKey

/**
 * 筛选类别。
 *
 * 顺序是用户指定的：全部 → 昵称变更 → 简介变更 → 好友变更。
 * 「简介」包含 bio 与 bioLinks 两类事件（对用户来说都是「简介那块的改动」）。
 */
const FILTERS: {
  key: FilterKey
  labelKey: 'filterAll' | 'filterDisplayName' | 'filterBio' | 'filterRelation'
  match: (f: ChangeEvent['field']) => boolean
}[] = [
  { key: 'all', labelKey: 'filterAll', match: () => true },
  { key: 'displayName', labelKey: 'filterDisplayName', match: (f) => f === 'displayName' },
  { key: 'bio', labelKey: 'filterBio', match: (f) => f === 'bio' || f === 'bioLinks' },
  { key: 'relation', labelKey: 'filterRelation', match: (f) => isRelationChange(f) },
]

/** 变化记录（时间线）。compact 模式用于概览页的「最近 10 条变化」摘要。 */
export function ChangeList({
  changes,
  isDev,
  onClearTest,
  compact = false,
  pageSize = 50,
  onPageSizeChange,
  autoPageSize = false,
  onAutoPageSizeChange,
  onSelectFriend,
  filter = 'all',
  onFilterChange,
  query = '',
  onQueryChange,
}: {
  changes: ChangeEvent[]
  isDev: boolean
  onClearTest: () => void
  compact?: boolean
  pageSize?: number
  onPageSizeChange?: (size: number) => void
  /** 按容器高度自动决定每页条数（与好友列表共用同一个设置） */
  autoPageSize?: boolean
  onAutoPageSizeChange?: (enabled: boolean) => void
  /** 点某条记录的**名字** → 打开那个人的详情抽屉（纯本地数据，不发请求） */
  onSelectFriend?: (userId: string) => void
  /*
   * 筛选与搜索由**上层持有并持久化** —— 和好友列表同样的理由：
   * 切页面会卸载组件，放在组件内部的状态会丢。见 docs/DECISIONS.md 3.11。
   * 可选：compact 模式（概览页的最近变化）不用它们。
   */
  filter?: FilterKey
  onFilterChange?: (filter: FilterKey) => void
  query?: string
  onQueryChange?: (query: string) => void
}): JSX.Element {
  const { t } = useI18n()
  const [page, setPage] = useState(1)
  /** 待执行的滚动方向；必须等新一页渲染完才能滚 */
  const [pendingScroll, setPendingScroll] = useState<'top' | 'end' | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [autoRows, setAutoRows] = useState(6)
  /**
   * 最近一次量到的「折叠态单条高度」。
   *
   * 为什么要缓存：如果用户把当前页**全部展开**，就再也找不到折叠态的样本了。
   * 那时若按兜底值算，一旦窗口缩放就会得出不同的条数 ——
   * 所以宁可沿用上一次量到的值。
   */
  const collapsedHeightRef = useRef(96)

  const goToPage = (next: number, scrollToEnd = false): void => {
    setPage(next)
    setPendingScroll(scrollToEnd ? 'end' : 'top')
  }

  useEffect(() => {
    if (pendingScroll === null) return
    if (pendingScroll === 'end') scrollToBottom(contentContainer())
    else scrollToTop(contentContainer())
    setPendingScroll(null)
  }, [pendingScroll, page])

  const filtered = useMemo(() => {
    if (compact) return changes
    const matcher = FILTERS.find((f) => f.key === filter)?.match ?? (() => true)
    const q = query.trim().toLowerCase()
    return changes.filter((ev) => {
      if (!matcher(ev.field)) return false
      if (q === '') return true
      // 搜索范围：好友昵称 + 变化前后两段文本（"简介里提到过某个词"也能搜到）
      return (
        ev.displayName.toLowerCase().includes(q) ||
        ev.before.toLowerCase().includes(q) ||
        ev.after.toLowerCase().includes(q)
      )
    })
  }, [changes, filter, compact, query])

  /**
   * 按容器高度算「刚好不出现滚动条」的条数。
   *
   * ⚠ 关键点：**展开一条记录不能让条数变化**（用户明确要求）。
   *   做法是：
   *   1. 只观察**滚动容器**（高度由 flex 撑出，不随内容变化），
   *      并且只在**高度**真正变化时才重算（滚动条出现会改变宽度并触发 observer）
   *   2. 量高度时专门挑**未展开**的那一条（`.change-item:not(.expanded)`）
   *   3. 量到的值缓存起来，全部展开时也不会退化
   *   展开后内容超出容器是允许的 —— 那时出现滚动条，正是用户想要的行为。
   */
  useEffect(() => {
    if (!autoPageSize || compact) return
    const el = scrollRef.current
    if (!el) return

    /**
     * 只记住**容器高度**，高度没变就不重算。
     *
     * 为什么需要这个守卫：内容变高出现滚动条时，滚动条会占掉内部宽度，
     * 于是这个元素的 content-box 尺寸发生变化、**ResizeObserver 会被触发**。
     * 那时若重算，就可能因为换了采样条目而算出不同的条数 ——
     * 表现出来就是"展开一条记录，每页条数跟着变了"，而这正是用户不要的行为。
     *
     * 语义上本来也只该跟**高度**走：每页几条是"能放下几行"。
     */
    let lastHeight = -1

    const measure = (): void => {
      const height = el.clientHeight
      if (height === lastHeight) return
      lastHeight = height

      // ⚠ 采样必须挑**未展开**的那一条：展开态明显更高，拿它当基准会少算好几条。
      //   （这个选择器曾经是失效的 —— 元素上根本没有 expanded 类，
      //     于是 querySelector 永远返回第一条，展开第一条就会把自动条数改掉。）
      const list = listRef.current
      const sample = list?.querySelector<HTMLElement>('.change-item:not(.expanded)')
      if (list && sample) {
        const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 0
        collapsedHeightRef.current = sample.getBoundingClientRect().height + gap
      }

      const style = getComputedStyle(el)
      const padY =
        (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0)
      // 减 1px 容差：边框与亚像素会让"刚好放下"变成"差一点"，于是蹦出滚动条
      const available = height - padY - 1
      setAutoRows(Math.max(2, Math.floor(available / Math.max(1, collapsedHeightRef.current))))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [autoPageSize, compact, filtered.length])

  const effectivePageSize = autoPageSize && !compact ? autoRows : pageSize

  useEffect(() => {
    setPage(1)
  }, [filter, query, effectivePageSize, changes.length])

  const pages = Math.max(1, Math.ceil(filtered.length / effectivePageSize))
  const current = Math.min(page, pages)
  const rows = compact
    ? filtered
    : filtered.slice((current - 1) * effectivePageSize, current * effectivePageSize)

  const testCount = changes.filter(isTestEvent).length

  // --- 列表本体（只有条目，不含分页条）---
  const listBody = (
    <div className="change-list" ref={listRef}>
      {rows.map((ev) => (
        <ChangeItem key={ev.id} ev={ev} onSelectFriend={onSelectFriend} />
      ))}
    </div>
  )

  /**
   * 分页条。**必须放在滚动容器之外**（和好友列表保持一致）。
   *
   * 之前它被包在 `.changes-scroll` 里，于是：
   *   1. 它会跟着列表一起滚 —— 滚到最上面时底部的翻页按钮就看不见了
   *   2. 「自动每页条数」算的是滚动容器的高度，而那个高度里还含分页条，
   *      等于**高估了能放下的条目数** → 内容超出 → 凭空多出滚动条
   * 放到外面后两个问题一起消失（滚动容器只装条目，量出来的高度就是条目的可用高度）。
   */
  const pager =
    !compact && onPageSizeChange ? (
      <Pagination
        total={filtered.length}
        page={current}
        pages={pages}
        pageSize={effectivePageSize}
        onPageChange={goToPage}
        onPageSizeChange={onPageSizeChange}
        autoToggle={
          onAutoPageSizeChange
            ? {
                enabled: autoPageSize,
                computed: autoRows,
                onChange: onAutoPageSizeChange,
              }
            : undefined
        }
      />
    ) : null

  const empty = (
    <div className="empty-hint">
      {changes.length === 0 ? (
        <>
          {t('emptyChangesLine1')}
          <br />
          <span className="muted">{rich(t('emptyChangesLine2'))}</span>
        </>
      ) : (
        t('filterEmpty')
      )}
    </div>
  )

  // 紧凑模式：只输出列表本体，套在调用方的卡片里
  if (compact) return rows.length === 0 ? empty : listBody

  return (
    /*
     * fill-height：让这张卡片撑满内容区剩余高度，内部的 .changes-scroll 才是
     * 唯一滚动区 —— 这样「自动每页条数」才有稳定的参照高度，
     * 筛选条和分页条也始终留在视野里。
     */
    <section className="card fill-height changes-card">
      {/* 标题 + 筛选按钮 + 搜索框都在同一行（宽度不够自动换行），省下一整行给列表 */}
      <div className="card-head-row">
        <h2>{t('changesTitle')}</h2>
        <div className="card-head-tools">
          <div className="filter-row">
            {FILTERS.map((f) => {
              const count = changes.filter((ev) => f.match(ev.field)).length
              return (
                <button
                  type="button"
                  key={f.key}
                  className={filter === f.key ? 'filter-chip active' : 'filter-chip'}
                  onClick={() => onFilterChange?.(f.key)}
                >
                  {t(f.labelKey)}
                  <span className="chip-count">{count}</span>
                </button>
              )
            })}

            {isDev && testCount > 0 ? (
              <button type="button" className="filter-chip danger-chip" onClick={onClearTest}>
                {t('clearTestChip', { n: testCount })}
              </button>
            ) : null}
          </div>

          <SearchInput
            value={query}
            onCommit={(next) => onQueryChange?.(next)}
            placeholder={t('searchPlaceholder')}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        empty
      ) : (
        <>
          <div className="changes-scroll" ref={scrollRef}>
            {listBody}
          </div>
          {pager}
        </>
      )}
    </section>
  )
}

/**
 * 单条变化记录。
 *
 * ## 交互约定（用户指定）
 *
 * - **点整条**：展开 / 收起这条的完整差异。折叠时新旧各只占一行（换行变空格 + 省略号），
 *   这样长简介不会把页面撑得很难看
 * - **点名字**：打开右侧好友详情（名字会高亮提示）
 *
 * 只有简介类变化才可展开 —— 昵称变更和好友变更本来就只有一行，没有可展开的内容。
 */
function ChangeItem({
  ev,
  onSelectFriend,
}: {
  ev: ChangeEvent
  onSelectFriend?: (userId: string) => void
}): JSX.Element {
  const { t, locale } = useI18n()
  const [expanded, setExpanded] = useState(false)

  const isBio = ev.field === 'bio' || ev.field === 'bioLinks'
  const showFull = isBio && expanded

  return (
    <div
      /* ⚠ expanded 这个类**必须真的加上**：自动条数的测量靠
         `.change-item:not(.expanded)` 挑一条没展开的当基准。 */
      className={`change-item${isBio ? ' expandable' : ''}${showFull ? ' expanded' : ''}`}
      /* 点整条 = 展开/收起（用户指定）。只对简介类生效，其它本来就只有一行。 */
      onClick={isBio ? () => setExpanded((v) => !v) : undefined}
    >
      <div className="change-head">
        {/*
          名字是按钮：只有点它才打开右侧详情。
          ⚠ 必须 stopPropagation，否则会连带触发外层的"展开/收起"。
        */}
        <button
          type="button"
          className="change-name"
          onClick={(e) => {
            e.stopPropagation()
            onSelectFriend?.(ev.userId)
          }}
          disabled={!onSelectFriend}
          title={onSelectFriend ? t('clickForDetail') : ev.displayName}
        >
          {ev.displayName}
        </button>

        <span className={isRelationChange(ev.field) ? 'change-field relation' : 'change-field'}>
          {t(fieldLabelKey(ev.field))}
        </span>
        <span className="change-time">
          {formatTime(ev.at, locale)}
          {t('scanTimeSuffix')}
        </span>
        {isTestEvent(ev) ? <span className="tag-test">{t('tagTest')}</span> : null}

        {isBio ? (
          /* 右侧的展开提示；本身也可点，同样要阻止冒泡以免连点两次等于没点 */
          <button
            type="button"
            className="change-toggle"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
            aria-expanded={expanded}
          >
            {showFull ? `${t('collapseHint')} ▴` : `${t('expandHint')} ▾`}
          </button>
        ) : null}
      </div>

      {isRelationChange(ev.field) ? (
        <p className="relation-line">
          {ev.field === 'friendAdded' ? t('relationAdded') : t('relationRemoved')}
        </p>
      ) : (
        <DiffView before={ev.before} after={ev.after} collapsed={!showFull} />
      )}
    </div>
  )
}
