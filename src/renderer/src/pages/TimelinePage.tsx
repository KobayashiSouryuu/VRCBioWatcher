import type { JSX } from 'react'
import type { ChangeEvent, ChangeFilterKey } from '@shared/types'
import { ChangeList } from '../components/ChangeList'

/** 变化记录页：全部历史，可按类别筛选、搜索、分页显示。 */
export function TimelinePage({
  changes,
  isDev,
  onClearTest,
  pageSize,
  onPageSizeChange,
  autoPageSize,
  onAutoPageSizeChange,
  onSelectFriend,
  filter,
  onFilterChange,
  query,
  onQueryChange,
}: {
  changes: ChangeEvent[]
  isDev: boolean
  onClearTest: () => void
  pageSize: number
  onPageSizeChange: (size: number) => void
  /** 按容器高度自动决定每页条数（与好友列表共用同一个设置） */
  autoPageSize: boolean
  onAutoPageSizeChange: (enabled: boolean) => void
  /** 点某条记录里的**名字** → 打开那个好友的详情抽屉（纯本地数据） */
  onSelectFriend: (userId: string) => void
  /** 筛选与搜索由 App 持有并持久化（切页面不丢） */
  filter: ChangeFilterKey
  onFilterChange: (filter: ChangeFilterKey) => void
  query: string
  onQueryChange: (query: string) => void
}): JSX.Element {
  return (
    <ChangeList
      changes={changes}
      isDev={isDev}
      onClearTest={onClearTest}
      pageSize={pageSize}
      onPageSizeChange={onPageSizeChange}
      autoPageSize={autoPageSize}
      onAutoPageSizeChange={onAutoPageSizeChange}
      onSelectFriend={onSelectFriend}
      filter={filter}
      onFilterChange={onFilterChange}
      query={query}
      onQueryChange={onQueryChange}
    />
  )
}
