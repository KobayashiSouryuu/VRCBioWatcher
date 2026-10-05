import { useEffect, useRef, type JSX } from 'react'

/**
 * 列表搜索框：**按回车才提交**，输入过程中不触发搜索。
 *
 * ## 为什么不做成"每输入一个字符就搜索"
 *
 * 之前是受控输入框（`value` + `onChange` → 立刻写进设置 → 异步回传新值）。
 * 这条链路在**中文/日文输入法组字过程中**会打断输入法：React 拿着"上一个值"
 * 重渲染输入框，输入法组好的拼音就被搅乱了。用户实测：
 *
 *   想输入「小林」（xiaolin）→ 敲到 "xi" 变成 **"xxi"**，敲到 "xia" 变成 **"xxixia"**
 *
 * 因为每敲一个字母都要走一趟「设置 → 写盘 → 回传」，回来时输入法已经把
 * 下一个字母组合进去了，两边一叠加就成了重复字符。
 *
 * ## 做法
 *
 * 值交给**浏览器自己管**（`defaultValue`，非受控）：React 在输入过程中
 * 一次都不会去碰这个 DOM 节点，输入法怎么工作都不受干扰。
 * 按回车才提交（和设置页「自定义字体」那个输入框完全一致的做法，
 * 用户也确认那个没有这个问题）。
 *
 * ## 提交时机（两条路）
 *
 *   1. **按回车** —— 提交输入框里的内容（和设置页「自定义字体」一样）
 *   2. **清空后点别处** —— 不用回车就自动退回到"不搜索"
 *
 * ### 为什么非空内容不在失焦时提交
 *
 * 试过"失焦也提交"，但那会引入一个更烦人的问题：`blur` 在 `click` **之前**触发，
 * 一旦此时重排列表，用户点的那一行可能已经换成了别的行 —— 想点 A 结果开了 B。
 *
 * 而**空值**没有这个问题：清空只会让列表**多出**行，原本可见的行不会消失、
 * 也不会换位置，所以"清空 + 失焦"可以放心自动提交。
 * 这正好覆盖了最容易踩到的场景：清空搜索框后不想还按一次回车。
 *
 * ## 外部值同步（一个小坑）
 *
 * `defaultValue` 只在挂载时取一次值，而设置是**异步**从主进程读来的。
 * 万一「已保存的搜索词」比组件挂载来得晚，输入框会是空的、列表却已被筛选。
 * 所以加了个小效果：**只在输入框没有焦点时**才把外部值写回 DOM。
 * 有焦点就绝不触碰 —— 那正是组字阶段。
 */
export function SearchInput({
  value,
  onCommit,
  placeholder,
}: {
  /** 已提交（生效中）的搜索词 */
  value: string
  /** 提交回调（回车，或清空后失焦） */
  onCommit: (value: string) => void
  placeholder: string
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && el.value !== value) el.value = value
  }, [value])

  return (
    <input
      ref={ref}
      type="text"
      defaultValue={value}
      placeholder={placeholder}
      className="search-input"
      onBlur={(e) => {
        // 只在"清空"时自动提交：空值只会让列表多出行，不会让原本可见的行移动，
        // 所以不存在"点错行"的风险（非空值必须按回车，见上面的说明）。
        if (e.target.value === '' && value !== '') onCommit('')
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          onCommit(e.currentTarget.value)
          // 提交后收起焦点：让用户看到结果，也避免"还在输入中"的错觉
          e.currentTarget.blur()
        }
      }}
    />
  )
}
