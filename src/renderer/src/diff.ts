/**
 * 差异比对：**按段落（行）比对**，不按字符。
 *
 * ## 为什么从字符级改成段落级
 *
 * 最初的实现是字符级 LCS，结果出现了荒唐的输出：
 *   旧简介「从来没有觉得……」
 *   新简介「我是来自……」
 *   它把中间那个「来」判定为**没有变化**，其余全标成改动 ——
 *   因为那一个字符确实在两边都存在。
 *
 * 这在字符层面没错，但在**语义层面毫无意义**：整句话已经换掉了。
 * 字符级 diff 只适合代码之类"改动局部、其余保持原样"的文本；
 * 简介这种散文，用户的判断单位是**段落**。
 *
 * ## 现在的规则（用户定的）
 *
 *   1. 按段（行）切分，逐段比对
 *   2. 某段变了 → **整段**标红（旧）/ 标绿（新），不做段内细化
 *   3. 某段没变 → 完全不高亮
 *   4. **段落顺序也算差异**：
 *      - ABCD → ACD：只标 B 为删除，A/C/D 不变
 *      - ABCD → AB C' D：标 C 为删除、C' 为新增，A/B/D 不变
 *
 * 第 4 条正是 LCS（最长公共子序列）的自然结果，所以这里的实现就是
 * 「把字符换成段落」的 LCS —— 算法没变，**比对单位变了**。
 */

export type DiffKind = 'same' | 'add' | 'del'

/** 一个差异块。`text` 是**一个段落**（单行，不含换行符）。 */
export interface DiffPart {
  kind: DiffKind
  text: string
}

/**
 * 把文本切成段落。
 *
 * 两条归一化规则，都是为了不产生"看不见的差异"：
 *   1. **空文本 = 零个段落**（而不是一个空段落）。否则「原本没有简介 → 现在有了」
 *      会先显示一条红色的空行，看着像 bug。
 *   2. **尾随换行不算一个空段落**。否则「末尾多一个回车」会显示成一个空行差异。
 */
export function splitParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (normalized === '') return []
  const lines = normalized.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}


/**
 * 计算 before → after 的段落级差异。
 *
 * `same` = 两边都有且位置对应；`del` = 只在旧简介里；`add` = 只在新简介里。
 */
export function diffParagraphs(before: string, after: string): DiffPart[] {
  const a = splitParagraphs(before)
  const b = splitParagraphs(after)
  const n = a.length
  const m = b.length

  if (n === 0 && m === 0) return []
  if (n === 0) return b.map((text) => ({ kind: 'add' as const, text }))
  if (m === 0) return a.map((text) => ({ kind: 'del' as const, text }))

  // LCS 长度表：dp[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度（以**段**为单位）
  const width = m + 1
  const dp = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + (j + 1)] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + (j + 1)])
    }
  }

  const parts: DiffPart[] = []
  // 回溯：优先走删除分支，这样"改写某一段"会呈现为
  // 「先标红旧段、再标绿新段」，比两种情况交错出现好读得多。
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      parts.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      parts.push({ kind: 'del', text: a[i] })
      i++
    } else {
      parts.push({ kind: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) parts.push({ kind: 'del', text: a[i++] })
  while (j < m) parts.push({ kind: 'add', text: b[j++] })

  return parts
}

/**
 * 把差异片段拆成「旧」「新」两行显示用的形式。
 *
 * 旧行保留 same + del（去掉 add），新行保留 same + add（去掉 del）。
 * 这样两行里未变化的段落完全一致，只有变动处被**整段**高亮。
 */
export function toSideBySide(parts: DiffPart[]): { before: DiffPart[]; after: DiffPart[] } {
  const before: DiffPart[] = []
  const after: DiffPart[] = []
  for (const part of parts) {
    if (part.kind === 'same' || part.kind === 'del') {
      before.push({ kind: part.kind, text: part.text })
    }
    if (part.kind === 'same' || part.kind === 'add') {
      after.push({ kind: part.kind, text: part.text })
    }
  }
  return { before, after }
}
