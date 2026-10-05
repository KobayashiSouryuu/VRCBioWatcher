import type { JSX } from 'react'
import type { FriendRecord, FriendSortKey } from '@shared/types'
import { FriendsTable } from '../components/FriendsTable'

/** 好友页：完整列表，点任意一行打开右侧详情抽屉。 */
export function FriendsPage({
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
  showRemoved: boolean
  /** 排序与搜索由 App 持有并持久化（切页面、重启都不丢） */
  sortKey: FriendSortKey
  sortAsc: boolean
  onSortChange: (key: FriendSortKey, asc: boolean) => void
  query: string
  onQueryChange: (query: string) => void
}): JSX.Element {
  return (
    <FriendsTable
      friends={friends}
      onSelect={onSelect}
      pageSize={pageSize}
      onPageSizeChange={onPageSizeChange}
      autoPageSize={autoPageSize}
      onAutoPageSizeChange={onAutoPageSizeChange}
      showRemoved={showRemoved}
      sortKey={sortKey}
      sortAsc={sortAsc}
      onSortChange={onSortChange}
      query={query}
      onQueryChange={onQueryChange}
    />
  )
}
