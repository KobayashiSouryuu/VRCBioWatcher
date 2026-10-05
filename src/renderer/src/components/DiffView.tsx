import { Fragment, type JSX } from 'react'
import { diffParagraphs, toSideBySide, type DiffPart } from '../diff'
import { useI18n } from '../i18n'

/**
 * 并排差异视图（**段落级**）。
 *
 * 每一段渲染成独立一行：
 *   - 变化的段落整段着色（旧 = 红 + 删除线，新 = 绿）
 *   - 未变化的段落完全不着色
 *   - 段落顺序的变化也会被体现（ABCD → ACD 只标出 B 被删除）
 *
 * 比对规则与原因见 diff.ts 的注释：字符级在散文上会产生毫无意义的输出。
 *
 * ## collapsed（折叠态）
 *
 * 简介可能非常长，完整展开时一条记录能占满整屏，列表变得没法看。
 * 折叠态的规则是用户指定的：**换行变空格、只显示一行、超出用省略号**，
 * 于是新旧各占一行，每条记录高度基本固定。
 *
 * 折叠态仍然保留高亮（把各段落用空格连起来），这样一眼能看出变化落在哪一段；
 * 但因为只显示开头，变化太靠后时会被省略号盖住 —— 所以额外挂了 `title`，
 * 鼠标悬停就能看到全文。
 */
export function DiffView({
  before,
  after,
  collapsed = false,
}: {
  before: string
  after: string
  collapsed?: boolean
}): JSX.Element {
  const { t } = useI18n()
  const { before: oldParts, after: newParts } = toSideBySide(diffParagraphs(before, after))

  /**
   * 空段落要占位一个不断行空格，否则它在界面上是零高度（看不见的空行差异）。
   *
   * ⚠ 高亮包在**内层 span** 上，不是整块 div 上：
   *   块级元素的背景会一直铺到容器右边缘，看起来"整行连同后面的空白都标红了"。
   *   inline 的 span 只覆盖到该段最后一个字符。
   */
  const renderPart = (kind: DiffPart['kind'], text: string, index: number): JSX.Element => (
    <div key={index} className="para">
      {kind === 'same' ? (
        text === '' ? '\u00A0' : text
      ) : (
        <span className={kind === 'del' ? 'hl hl-del' : 'hl hl-add'}>
          {text === '' ? '\u00A0' : text}
        </span>
      )}
    </div>
  )

  /** 折叠态：把各段落用**空格**连起来（等价于"换行变空格"），整行显示 */
  const renderInline = (parts: DiffPart[]): JSX.Element[] =>
    parts.map((p, i) => (
      <Fragment key={i}>
        {i > 0 ? ' ' : null}
        {p.kind === 'same' ? (
          p.text
        ) : (
          <span className={p.kind === 'del' ? 'hl hl-del' : 'hl hl-add'}>{p.text}</span>
        )}
      </Fragment>
    ))

  const line = (
    tag: string,
    parts: DiffPart[],
    raw: string,
    extraClass: string,
  ): JSX.Element => (
    <div className="ba-line">
      <span className="ba-tag">{tag}</span>
      {collapsed ? (
        <div className={`ba-text one-line ${extraClass}`} title={raw}>
          {parts.length === 0 ? (
            <span className="muted">{t('emptyText')}</span>
          ) : (
            renderInline(parts)
          )}
        </div>
      ) : (
        <div className={`ba-text ${extraClass}`.trim()}>
          {parts.length === 0 ? (
            <div className="para muted">{t('emptyText')}</div>
          ) : (
            parts.map((p, i) => renderPart(p.kind, p.text, i))
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className="before-after">
      {line(t('labelOld'), oldParts, before, '')}
      {line(t('labelNew'), newParts, after, '')}
    </div>
  )
}
