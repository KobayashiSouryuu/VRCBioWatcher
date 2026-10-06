# VRCBW 设计决定记录（DECISIONS）

> 本文档记录**已经实测确认的事实**和**已拍板的设计决定**。
> 每条结论都标注了依据。凡是「未确证」的，不要当成事实使用。
>
> 最后更新：探针 v2 报告之后

---

## 1. 项目定位

**VRChat Bio Watcher（VRCBW）** —— 本地 Windows 桌面工具。定期抓取自己好友的资料，
保存快照，检测变化，按时间线展示并支持新旧差异对比。

- 当前阶段：个人自用
- 未来可能：开源给全球用户使用
- 技术形态：Electron（Chromium 套壳）+ TypeScript

### v1 做

登录（含 2FA）→ 拉完整好友名单 → 定时分批扫描 → 存快照 → 检测变化 → 时间线 → 差异对比 → 打包 exe

### v1 不做（留给 v2+）

桌面通知、在线状态/所在地追踪、头像图片本地化、多账号、WebSocket 实时推送、云同步、
多语言、自动更新、`statusDescription`（状态签名）跟踪

---

## 2. 已实测确认的 API 事实

数据来源：两次真实账号探针（`scripts/probe.mjs`），下文数字均为实测值。

### 2.1 好友名单：三个数据源，用途不同

| 来源 | 实测返回 | 用途 |
|---|---|---|
| `GET /auth/user` → `friends` | **246 个 userId 字符串** | ★ **权威完整名单**，扫描以此为准 |
| `GET /auth/user` → `onlineFriends` / `activeFriends` / `offlineFriends` | **38 / 17 / 191**，互不重叠，三者之和 = 246 | ★ **免费的好友分类**，用于决定扫描优先级 |
| `GET /auth/user/friends?offline=true` | **191 条完整好友对象** | 提供离线好友的 `last_activity`（排序键） |

### 2.2 ⚠ 陷阱一：`offline` 参数是「只要离线」而非「包含离线」

- **不带** `offline` 参数 → 实测 **55 条** = `onlineFriends(38)` + `activeFriends(17)`
- **带** `offline=true` → 实测 **191 条** = `offlineFriends(191)`

规范文档写的是 "if the returned friends should **include** offline friends"，
但实测行为是「**过滤为只要离线好友**」。**没有任何一次调用能返回全部 246 人**。

**踩坑记录**：探针第一版漏了这个参数，246 个好友只拿到 63 个。
63 恰好等于「在线 + 活跃」，这个数字**看起来像个合理的好友总数**，
所以这个 bug 极其隐蔽 —— 如果开发者自己不知道好友真实数量，它会一直潜伏到上线。

**另一个隐蔽点**：在线好友**是有** `last_activity` 值的（第一版报告里，
「在线+活跃」列表中的好友对象带有完整时间戳）。他们不出现在 `offline=true` 的结果里，
是因为**被参数过滤掉了**，不是因为时间字段为空。

### 2.3 ⚠ 陷阱二：bio 不在任何好友列表里

| 端点 | 是否有 bio | 实测 |
|---|---|---|
| `GET /users/{id}` | ❌ 没有 | 0/3 |
| `GET /auth/user/friends` | ❌ 没有 | 无 bio 类字段 |
| `GET /auth/user` | ❌ 没有 | 无 bio 类字段 |
| **`GET /profile/{id}`** | ✅ **有** | 20/20 |

结论：**每轮扫描每个好友必须单独发一次请求**，246 个好友 = 246 次请求，无法绕过。

### 2.4 `GET /profile/{id}` 的确认字段（20 个抽样全部 200）

- `bio`: **string**，存在率 20/20。缺失时应按**空字符串**处理，
  这样「第一次填上简介」也能被识别为一次变化
- `bioLinks`: **纯字符串数组**（不是 `{title, url}` 对象），
  「元素全是字符串」的比例 20/20 → 比对逻辑可直接 JSON 比较
- `displayName`: **string**，存在率 20/20 → **跟踪昵称变化不需要额外请求**
- `pronouns`、`badges`、`trustTags`、`languages`、`representedGroup`（可为 null）、
  `hasVrcPlus`、`isEconomyCreator`、`ageVerified` 等也在同一次响应里
- **`statusDescription` 不在此端点**（实测 0/20）。它只在好友列表端点里，
  所以以后若要跟踪状态签名，从好友列表免费拿，不需要额外请求

共 25 个字段。**每轮每个好友只需 1 次请求**即可同时更新昵称和简介。

### 2.5 ⚠ 陷阱三：User-Agent 被 WAF 校验（受控对照实测）

VRChat 的 WAF 会对不认可的 UA 返回：

```
HTTP 403  "please identify yourself with a properly formatted user-agent
           containing application name, version and contact information."
```

**这条报错是误导性的。** 实测结论（同一 IP、同一时段、逐项对照）：

| User-Agent 形态 | 结果 |
|---|---|
| `VRCBW/0.1.0 (contact: me@example.com)` ← **规范文档说的正是这种** | ❌ 403 |
| `VRCBW/0.1.0 (personal use; contact: me@example.com)` | ❌ 403 |
| `VRCBW/0.1.0 test@example.com` | ❌ 403 |
| `VRCX/2025.01.01 (contact: me@example.com)` ← 已知工具同款也不行 | ❌ 403 |
| 纯 Chrome UA | ✅ 通过 4/4 |
| `… (KHTML, like Gecko) VRCBW/0.1.0 Chrome/131.0.0.0 Safari/537.36` | ✅ 通过 3/3 |
| `… VRCBW/0.1.0 (+https://github.com/xxx/yyy) Chrome/… Safari/…` | ✅ 通过 |

**规则**：UA 必须以 `Mozilla/5.0` 开头，且包含完整的
`AppleWebKit/537.36 (KHTML, like Gecko)` … `Chrome/<版本>` … `Safari/537.36` 浏览器签名。
带圆括号邮箱的写法会触发拦截。

**正确做法**：把「应用名/版本 + 联系方式」插进浏览器签名的注释槽位，
联系方式用 **URL**（`+https://...`，爬虫界通行惯例）—— 既过 WAF，也满足「表明身份」要求。

```js
// ⚠ 大小写必须与下面完全一致 —— 这个字符串是实测通过 WAF 的版本。
//   「改成小写」「简化一下」都属于未验证改动，很可能直接 403。
//   Chrome 版本号在生产环境应取自 Electron 实际的 process.versions.chrome
'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  `VRCBW/${version} (+${projectUrl}) ` +
  `Chrome/${chromeVersion} Safari/537.36`
```

**额外风险**：这个 403 与「请求过频被限流」返回的是**同一条误导性报错**。
调试时必须先用纯 Chrome UA 做对照，才能分清是 UA 问题还是被限流了。

### 2.6 限流：完全黑盒

- 所有响应里**都没有** `X-RateLimit-*` / `Retry-After` 响应头
- 实测 **0 次 429**（1 秒间隔，累计约 40 次请求）
- 官方 FAQ 明确：无视 429 可能导致更长限流甚至**账号封停**

**红线未知，且不能主动试探**（那是拿用户账号做压力测试）。
所以策略只能是「保守 + 429 退避 + 熔断」，绝不能「贴着上限跑」。

### 2.7 ★「好友序号」的来源：`friends` 数组顺序（已确证）

**结论**：`GET /auth/user` 返回的 `friends` 数组**顺序本身就是好友序号**，
且实测与「加好友顺序」一致。做法是**首次抓拍后固化，之后不再重排**。

依据（VRCX master 源码，2026-10 核对）：

- `src/stores/friend.js:967-992` `tryApplyFriendOrder()`：
  `const friendOrder = userStore.currentUser.friends` → 逐个 `state.friendNumber++`
  → `setFriendNumber()`，日志 `"Applied friend order from API"`
- `src/stores/friend.js:952-962` `setFriendNumber()` 写 `friendRef.$friendNumber`（UI 读它）
- `src/stores/friend.js:914` 日常启动直接读回本地持久化的 `VRCX_friendNumber_<uid>`，**不重排**
  （哨兵 `VRCX_lastStoreTime_<uid>='-5'` 保证一次性迁移只跑一次）
- 回退路径 `:1106-1127`：本地好友日志按 `created_at` 升序 —— 那正是「成为好友的时间」
- UI：`src/views/FriendList/columns.jsx` 的 `No.` 列，`accessorFn: row => row?.$friendNumber`

**本项目的实现**：记录 `apiIndex`（在数组里的下标），首次看到时取 `apiIndex + 1`
作为 `friendNumber` 并固化；`seq` 仅作为从未拿到过 API 顺序时的兜底。
**关键点是「不重排」** —— API 不保证数组顺序永远不变，而用户期望这个数字稳定。

> 为什么之前以为「不可得」：VRChat 的**好友对象**里确实没有任何「成为好友的时间」
> 字段（探针列出的 23 个字段可查）。序号不在字段里，而在**数组顺序**里。
> 这是一个方法上的教训：**字段列表查不到的东西，可能在数据的排列里。**

### 2.8 ★ WebSocket 不含 bio —— 只能逐个轮询（已确证）

**结论**：`friend-update` 等 WebSocket 事件**不包含 `bio` / `bioLinks` / `badges`**。
因此要拿 246 个好友的简介，**只能逐个请求 `GET /profile/{userId}`**。
本项目的扫描架构（248 次请求/轮）是被这一事实决定的，不是设计偷懒。

依据：

- VRCX 代码：`src/services/websocket.js` 的 `handlePipeline()` 中
  `case 'friend-update': applyUser(content.user); break;` —— 整条 ws 管线**没有任何 bio 处理**
- 维护者 Provini 在 [issue #1885](https://github.com/vrcx-team/VRCX/issues/1885) 原话：
  *"Bio was removed from the websocket, and thus, are no longer able to detect bio changes."*
- 评论区补充：bio 现在属于 **profile payload**，不再是 user payload

**WebSocket 的事件类型**（供将来参考）：
`friend-add`、`friend-delete`、`friend-online`、`friend-active`、`friend-offline`、
`friend-update`、`friend-location`、`user-update`、`notification*`、`group-*`、
`instance-*`、`content-refresh`、`economy-update`。

> **将来可考虑的优化**：用 WebSocket 的 `friend-add` / `friend-delete` 实现
> 「加/删好友」的**近实时**发现（不必等下一轮扫描）。但注意：
> 它**解决不了 bio**，bio 永远只能轮询。连接方式（VRCX）：
> `initWebsocket()` 先 `request('auth')` 取 token，再
> `new WebSocket(\`${domain}/?auth=${token}\`)`。

### 2.9 API v1.21.0 的变更内容（issue #1885）

VRChat 把用户资料拆成了 **user payload** 和 **profile payload** 两份：

| 变更 | 内容 |
|---|---|
| **迁到 `/profile/`** | `bio`、`bioLinks`、`badges` |
| **彻底移除** | `profilePicOverride`、`profilePicOverrideThumbnail`、`currentAvatarImageUrl`、`currentAvatarTags`、`currentAvatarThumbnailUrl`、`userIcon` |
| **新增** | `iconUrl`（有自定义图标就用图标，否则回落当前头像缩略图） |
| **不再随 WebSocket 下发** | 以上全部字段 |

**VRCX 的应对**：User Icons、Bios、Bio Links、Badges、Remote Avatar Info、
Feed Avatar Changes 均已修复；但 **Feed Bio Changes 与 User Search by Bio
被判定为「不可修复」** —— 因为 bio 既不在 ws 里，也不能再按 bio 搜人。

> **这正是本项目存在的理由**：VRCX 做不了的事（持续观察好友简介变化），
> 我们用「定期轮询 `/profile/` + 本地留档 + 差异对比」来做。
> 这个定位可以直接写进 README。

### 2.10 ★ WebSocket（Pipeline）协议细节（已查证）

> ## ⚠ 结论：**已实现过，但已移除**（2026-10）
>
> 实机测试连不上：**close code 1006，握手阶段就被拒**，连服务端的 `err` 消息都收不到。
>
> **最可能的原因**：官方文档明说广播「需要正确的 User-Agent」，而 **Node 的全局
> `WebSocket` 是浏览器语义的 API，无法设置自定义请求头**。我们早就实测过 VRChat 的
> WAF 会拒绝非浏览器形态的请求（见 2.5）—— 这几乎肯定是同一个原因。
> 要修就得引入 `ws` 依赖。
>
> **移除的理由**：
> 1. **本工具的核心是简介变化，而简介不在广播内容里** —— 广播解决不了主要问题
> 2. 广播与扫描混在一条时间线上，**时间语义不一致**：广播实时、扫描延迟最多 10 小时。
>    同一个列表里两种时间会让人困惑
> 3. 为一个次要功能引入依赖 + 重连 + 看门狗 + 协议怪癖，不划算
>
> **现在的模型**：**所有变化都来自定期扫描，时间一律是「扫描时间」**，
> 界面上也明确写明了这一点（i18n 的 `dataSourceNote`）。
>
> 下面的协议查证结果**保留**，万一将来要重做（尤其是如果愿意引入 `ws` 依赖），
> 这些细节能省掉一整轮查证。

用于「加/删好友、改昵称」的实时推送。

| 项目 | 结论 |
|---|---|
| 地址 | `wss://pipeline.vrchat.cloud/?<参数>=<token>` |
| **参数名** | 官方文档与官方 SDK 用 **`authToken`**；VRCX 实际用 **`auth`**。**两者都有可用实现 → 未确证哪个唯一正确**，所以实现里按 `authToken` → `auth` 顺序试，记住成功过的那个 |
| token | **`auth` cookie 的值**。官方 JS SDK 就是直接取 cookie 喂给 pipeline，这样可以**省掉一次 `GET /auth` 请求** |
| 消息信封 | `{"type": ..., "content": ...}` |
| **⚠ `content` 是字符串化的 JSON** | **必须再 `JSON.parse` 一次**。而 `see-notification` 这类事件的 content 是普通字符串，二次 parse 会**抛错** —— 必须 try/catch，否则一条消息就能打断整个连接 |
| 错误信封 | `{"err": "..."}`，服务端随后主动关闭连接（认证失败就是这种形态） |

**好友事件的 content 字段**（这张表决定了实现怎么写）：

| 事件 | 顶层字段 | 含 `user` | 含 `displayName` |
|---|---|---|---|
| `friend-add` | `userId`, `user` | 是 | **是** |
| `friend-update` | `userId`, `user` | 是 | **是** |
| `friend-delete` | `userId` | 否 | **否** ← 只能从本地记录反查昵称 |
| `friend-online` / `active` / `location` | `userId`, `user`, … | 是 | 是（本项目忽略） |
| `friend-offline` | `userId`, `platform` | 否 | 否（忽略） |

**保活与重连**：
- VRCX **完全不发心跳**，只固定 5 秒重连（无退避）
- 但有实测报告连接会「**静默死**」：socket 仍 open、close/error 都不触发、却不再推事件（最长连续 66 小时）
- Node 的全局 `WebSocket` **不暴露协议级 `ping()`**（那是 `ws` 库的能力），所以做不到 30 秒 ping
- 本项目的选择：**静默看门狗**（2 小时无任何消息 → 主动重连）+ 带抖动的指数退避（1 秒→5 分钟）+ 认证失败 30 分钟冷却
- ⚠ 看门狗阈值必须**远大于**正常的静默间隔：实测好友事件之间的正常间隔最长可达 **65 分钟**，
  用 10 分钟阈值会频繁误判重连（有项目踩过这个坑）

> **广播是增强，不是依赖**：它连不上时一切照旧（全靠扫描），简介无论如何都只能靠扫描。
> 这一点让整个功能的失败模式变得温和 —— 最坏情况只是"关系变化慢一点"。

---

## 3. 已拍板的设计参数

### 3.1 扫描间隔：默认 10 小时

- 语义：**距上次扫描「完成」≥ 10 小时**才允许开始下一轮
- 可配置范围：1 小时 ~ 7 天，**硬下限 1 小时**（防止手滑把账号搞进限流）
- 程序启动时若已到期 → 立即开始

**为什么是 10 小时而不是 20 小时**：阈值只在「两次软件运行之间的间隔 < 阈值」时才起作用。

| 使用方式 | 10 小时 | 20 小时 |
|---|---|---|
| 每天开一次机（间隔 24h） | 1 次/天 | **完全相同**，1 次/天 |
| 早晚各开一次（间隔 12h） | 2 次/天 | 只扫早上那次 |
| 电脑 24 小时常开 | 约 2.4 次/天 | 约 1.2 次/天 |

10 小时的覆盖能力**永远 ≥ 20 小时**。请求量：248 × 2.4 ≈ **600 次/天 ≈ 平均每 147 秒一次**，非常温和。

**代价（已知并接受）**：两次扫描之间的中间变化会丢失。若某人一天内改 3 次简介，
只能看到「昨天 → 今天」的净差异。这是轮询的固有代价。

**附带好处**：10 小时不是 24 小时，扫描时刻每天**往前漂移**，
样本会均匀覆盖一天中的不同时段，而不是永远固定在同一时刻。

### 3.2 扫描顺序：两级优先

```
第 1 级：onlineFriends ∪ activeFriends（38 + 17 = 55 人）  ← 正在线的人最可能刚改过资料
第 2 级：offlineFriends（191 人），按 last_activity 倒序     ← 最近活跃的优先
兜底：  friends 里有、但两级都没覆盖到的 id → 排最后（防御性，正常应为 0）
```

分类信息全部来自 `/auth/user`（免费），`last_activity` 来自 `offline=true` 的 2 页请求。

> 注：如果用「全部 246 人按 last_activity 平铺排序」也能近似达到同样效果
> （在线好友的时间戳 ≈ 现在，自然排在最前），但两级方案更确定、更容易在界面上解释。

### 3.3 扫描节奏：3 秒匀速，不分批（2026-10 重新定稿）

> **本节已改。** 早先的方案是「每批 50 人 / 批间暂停 3 分钟 / 请求间隔 1.2 秒」，
> 用户评估后要求改为「**每 100 个好友 5 分钟，即每个好友间隔 3 秒，不分批次**」。

**现方案**：`REQUEST_INTERVAL_MS = 3000`，好友之间**匀速** 3 秒一个，没有批次、没有批间暂停。

| 好友数 | 整轮预计（3 秒 + 约 0.3 秒延迟） |
|---|---|
| 246（本项目实际规模） | 约 **13 分钟** |
| 500 | 约 27 分钟 |
| 1000 | 约 55 分钟 |

**为什么这样反而更安全**：原方案是**爆发式**的 —— 1 秒一个连着发 50 个，
然后空转 3 分钟。新方案是**匀速**的。限流器（令牌桶/滑动窗口）就是被突发打爆的，
所以同样的总请求数，匀速分布的峰值负载低得多。

**设置页必须显示**「当前 N 个好友，一轮约需 M 分钟」，并说明
**好友越多耗时越久是刻意的**（为避免 429）。这一条是用户明确要求的。

请求间隔 **3 秒是硬编码的安全下限**，不提供设置项（避免用户在不知情下调小它）。

### 3.3b 调度参数（用户定稿）

| 项目 | 值 | 计时基准 |
|---|---|---|
| 自动扫描间隔 | **10 小时** | 从**扫描完成**时刻起算 |
| 启动补扫 | 启动时若已超过 10 小时 → 立即自动扫描 | 同上 |
| 手动扫描最小间隔 | **2 小时** | 同上 |
| 触发 429 后的强制冷却 | **10 小时** | 从触发时刻起算 |

自动扫描**不受**「手动最小间隔」限制（它本来就是按 10 小时排的）。
冷却期间不排定自动扫描，改为稍后重新评估。

### 3.4 跟踪字段

`bio`（string）、`bioLinks`（string[]）、`displayName`（string）——三者同一次响应取回。

昵称变化与简介变化**同等对待**：都产生时间线条目 + 差异对比。
时间线里昵称变化显示为「旧名 → 新名」；好友列表用当前名字，但保留全部历史。

### 3.5 安全机制

#### ★ 限流策略：一见 429 立刻停（已按用户要求收紧，2026-10 定稿）

**策略**：任何一次请求收到 **429** →
1. **不重试**（`RETRY_ON_429 = 0`，见 `src/main/vrchat/client.ts`）
2. **立刻中断整轮扫描** —— 不跳过、不继续扫剩下的好友
3. 已完成的进度先落盘
4. 进入 **10 小时冷却期**（`RATE_LIMIT_COOLDOWN_MS`），期间拒绝开始新扫描
5. 冷却时间记录在当前账号的数据文件里（`lastRateLimitAt`），
   **所以重启软件也绕不过去**（放内存里就等于可以重启绕过）

登录流程同理：429 会如实告诉用户「暂时被限流」，而不是退避几秒后重试。

#### ★ 差异比对：段落级，不是字符级（2026-10 修正）

**问题**：最初的实现是**字符级** LCS。用户实测到荒唐的输出：旧简介
「从来没有觉得……」→ 新简介「我是来自……」，程序把中间那个「来」
判定为**没有变化**，其余全标成改动 —— 因为那个字符确实两边都有。
字符层面没错，**语义层面毫无意义**。

**现方案**：按**段落（行）**做 LCS，某段变了就**整段**标红/标绿，不做段内细化，
并且**段落顺序也算差异**（这正是 LCS 的自然结果）：

| 变化 | 期望输出 |
|---|---|
| ABCD → ACD | 只标 B 为删除，A/C/D 不变 |
| ABCD → AB C'D | 标 C 删除 + C' 新增，A/B/D 不变 |

两条归一化规则（否则会产生"看不见的差异"）：
1. **空文本 = 零个段落**，不是一个空段落（否则"原本没简介→现在有了"会先显示一条红色空行）
2. **尾随换行不算一个空段落**

自检 19 项全过（含上面两个例子、并排视图可还原原文、段落换位、空段落增删）。
实现见 `src/renderer/src/diff.ts`。

> 教训：**diff 的粒度要和用户的判断单位一致**。代码适合字符级，
> 散文适合段落级。选错粒度不会报错，只会产生"看起来是对的、实际没法看"的结果。

**为什么这么保守**：
- VRChat **从未公布限流阈值**；社区也没有可靠实测数据
  （已查：官方 FAQ、Canny bug 报告、多个 SDK 文档，都没有数字）
- 官方 FAQ 明确：**不要发送重复的、不计量的请求**；
  **无视 429 可能导致更长限流甚至账号封停**
- VRChat **自己的网页端**在批量清通知时都会触发 429（Canny bug 报告），
  说明阈值相当紧
- 既然**算不出安全速率**，唯一正确的做法就是「见到信号就退」

> 早期版本写的是「累计 3 次 429 才中断」。用户指出这不够保守（因为他打算
> 开源并给朋友用），已改为一次即停。**任何放宽这个策略的改动都必须先重读本节。**

#### 合规与风险（开源前必须写进 README 并显著标注）

- 本工具使用 VRChat 的**非官方 API**，可能因官方变更而失效
- ToS 要求「符合个人正常使用方式」，自动化工具在此表述下**始终存在解释空间**
- 本工具按「尽量温和」设计（每个好友间隔 3 秒、匀速不分批、遇限流即停并冷却 10 小时），
  但**无法承诺零风险**，使用后果由使用者自负
- **不要**把会话凭据（`session.bin`）、`data/` 目录分享给任何人 ——
  里面等于账号的登录态

**凭据存储**：
- 会话 cookie 用 Electron `safeStorage` 加密（Windows 上是 DPAPI，绑定当前用户账户）
- **绝不存储密码**
- `%AppData%` 下的数据目录、`.probe-cookies.json`、`.probe-credentials.json` 全部进 `.gitignore`
- 开源前必须复查：仓库里不能有任何真实 id、昵称、bio 内容

#### 与 VRCX 的对比（2026-10 查证其 master 分支源码）
作为同类开源工具的参考，查清了 VRCX 的做法（依据可查其仓库源码）：

| | VRCX | 本项目 |
|---|---|---|
| 登录界面 | **原生自绘表单**（非内嵌浏览器），`Login.vue` 收账号密码 + HTTP Basic | 同为自绘表单（结论一致） |
| 2FA | TOTP + 邮箱验证码（第三种 `otp` 疑为恢复码） | 同样支持三种 |
| **密码是否落盘** | ⚠️ **存明文**，勾选「Save Credentials」后写入 SQLite 的 `configs` 表 | ❌ **永不存储** |
| 会话 cookie | ⚠️ 另存 SQLite `cookies` 表，base64(JSON)，**无加密** | `safeStorage`（DPAPI）加密 |
| 可选加密 | 有 AES-GCM，但**默认密钥硬编码在源码里**（未设主密码时等同混淆） | 无此问题（依赖系统级加密） |
| 数据位置 | `%APPDATA%\VRCX\VRCX.sqlite3` | `%APPDATA%\vrcbw\session.bin`（密文） |

来源：VRCX `src/stores/auth.js`、`src/views/Login/Login.vue`、`src/services/config.js`、
`src/services/security.js`、`Dotnet/WebApi.cs`、`Dotnet/Program.cs`。

**结论**：本项目在凭据安全上比 VRCX 更严格，这是可以写进 README 的差异点。
但**不要在文档里点名批评 VRCX** —— 只陈述我们自己的做法即可。

---

### 3.11 界面状态持久化（排序 / 搜索 / 筛选 / 窗口位置）

**问题**：用户反馈「我按最近变化排序，切到设置页再回来就变回序号正序了」。
根因是状态放在组件内部的 `useState` 里，而**切页面会卸载组件**（App 里是条件渲染），
状态自然清空。

**做法**：把这些状态提升到 `AppSettings`（由主进程持久化到 settings.json）。
这样切换页面不丢，**重启程序也不丢**。

| 状态 | 是否持久化 | 理由 |
|---|---|---|
| 好友列表排序（列 + 升降序） | ✅ | 用户明确要求 |
| 好友列表搜索关键词 | ✅ | 用户明确要求 |
| 变化记录筛选（全部/昵称/简介/好友） | ✅ | 同上 |
| 变化记录搜索关键词 | ✅ | 同上 |
| 当前页码 | ❌ | 页码跟着数据走才合理；数据变化时本来就要回到第 1 页 |
| 窗口位置 / 大小 / 最大化 | ✅ | 桌面软件的常规期待 |

**⚠ 窗口位置必须做"可见性校验"**。坐标是相对整个虚拟桌面（所有显示器拼起来）的，
换显示器 / 改分辨率 / 拔掉外接屏之后，保存的矩形可能落在任何显示器之外 ——
那时窗口**确实被创建了也在运行，但用户在屏幕上永远看不到它**。
所以恢复前要把保存的矩形与每个显示器的 `workArea` 求交集，
**交集至少 100×40 像素**才算可见（只判断"有交集"不够：露出 1 像素同样找不回来）。
不通过就用默认尺寸并居中。

另外保存时要区分最大化状态：最大化时 `getBounds()` 返回的是最大化后的尺寸，
存下来会导致"取消最大化后窗口没法还原成原来的大小"，所以用 `getNormalBounds()`。

### 3.12 服务器故障时的行为（健壮性加固）

用户问「VRC 服务器崩溃、什么数据都获取不到时会怎样」，由此补了几个坑：

| 场景 | 原行为 | 现行为 |
|---|---|---|
| 拉好友名单失败 | 报错退出（本来就没问题） | 额外记录 `lastScanWarning`，界面显眼提示 |
| `/profile` 全部失败 | **静默"成功"**：检查 246、跳过 246、变化 0 → 用户以为一切正常 | 跳过率 > 50% 时标记 `doneMostlyFailed`，界面明确说明**结果不可信** |
| 服务器挂掉、每个请求都等到超时 | 一路跑完 246 个（可能两小时），持续敲一个已经挂掉的服务 | **连续 10 次失败就主动中断** |
| 会话失效（401） | 挨个试完剩下的好友，全部失败 | 立即中断并提示重新登录 |
| 名单被截断（残缺） | 缺失的好友**全部被误判成"已解除"**，一次造出几百条假记录 | 两项独立校验（子列表交叉校验 + 数量骤减 >30% 且 >3 个）任一不过就**跳过本轮解除判定** |

**"不会覆盖已有资料"是本来就成立的**：只有当 `/profile/{id}` 返回 200 时才会写
`store.friends[id]`，所以"没抓到的"保持上一次的资料，绝不会被清空或写坏。

**子列表交叉校验为什么有效**：`offlineFriends` 来自**另一个 HTTP 请求**
（`/auth/user/friends?offline=true`），所以"子列表里出现了不在 friends 里的 id"
是真正独立的矛盾证据，不是同一个响应自证。

**"连续失败"为什么取 10 次**：正常扫描里零星出现 403/404（私密资料、已注销账号）
很常见，不能因为几次失败就中断；而真正服务不可用时失败是**连续**的，10 次足以区分。

**首次扫描不自动执行的现状**：`nextAutoScanAt()` 在 `lastScanAt` 与 `lastScanAttemptAt`
**都为空**时返回 null → `shouldAutoScan()` 为 false → 全新账号本来就不会自动扫描。
所以这一条**不需要改逻辑**，只需把界面上的「—」换成明确的「无数据，第一次请手动扫描」
和一张首次引导卡片。

### 3.10 打包成安装程序（踩过的坑）

#### 为什么 `perMachine: true`

需求是「装到 `C:\Program Files\VRCBioWatcher`，并且不要那个安装模式选择页」。
查 electron-builder 的 NSIS 模板 `assistedInstaller.nsh` 得到：

```nsis
!ifndef INSTALL_MODE_PER_ALL_USERS
  !insertmacro PAGE_INSTALL_MODE      ; ← 只有这个宏未定义时才插入模式选择页
!endif
```

而 `NsisTarget.js` 里 `perMachine === true` 会定义 `INSTALL_MODE_PER_ALL_USERS`，
于是**模式选择页自动跳过**，默认目录就是 `$PROGRAMFILES64\<productName>`。
所以这两个需求是同一个开关满足的，代价是弹一次 UAC。

#### ⚠ 「关闭到托盘」会让安装程序以为应用关不掉

安装程序（`include/allowOnlyOneInstallerInstance.nsh`）关应用的过程是：

1. `taskkill /IM <exe>`（**友好关闭**：给窗口发关闭请求）
2. 等 1 秒后 `taskkill /F`（强制）
3. 还杀不掉 → 弹「应用无法关闭，请重试」

而我们的「关窗口 = 收进托盘」会**吞掉第 1 步**。如果安装程序**不是管理员**，
第 2 步的强杀也会失败 → 用户被反复要求重试 → 接着因为文件被占用而
**写 `Uninstall <产品名>.exe` 失败**（用户实测就是这个报错）。

两条应对：
- `perMachine: true` 让安装程序以管理员身份运行，强杀一定能成功
- 主进程支持第二实例 `--quit`：`VRCBioWatcher.exe --quit` 会优雅退出正在运行的实例，
  任何脚本都能用它（见 `app.on('second-instance')`）

#### productName 不能带空格

带空格的路径在命令行与脚本里容易被引号问题坑到。
所以 `productName: VRCBioWatcher`，但**界面上的显示名仍是 "VRChat Bio Watcher"** ——
exe 名/目录名/快捷方式名用无空格版本，给人看的名字保持可读。

#### userData 必须显式固定

`productName` 一改，Electron 默认的 `userData`（`%APPDATA%\<应用名>`）就跟着变，
打包版会读不到开发版的数据（表现为"装完之后好友列表全空"）。
所以主进程最开头就显式 `app.setPath('userData', %APPDATA%\vrcbw)`，
与 productName 彻底解耦。**这一步必须在任何 getPath 调用之前。**

#### 不建议把 react/react-dom 放在 dependencies

它们只用于构建（Vite 已经把 React 打进界面 bundle），放在 `dependencies` 会被
electron-builder 原样再拷一份进 asar（实测多出 8.8MB 无用文件）。
放 `devDependencies`，asar 里就只剩 `out/` 和 `package.json`。

#### 图标

- `build/icon.ico`（16/24/32/48/64/128/256 七档）→ exe 与安装程序的图标
- `src/main/app-icon.ts` 里内嵌两档 base64 PNG → 托盘（32）与窗口（64）

为什么托盘图标内嵌而不是读文件：打包后资源路径要额外配置，一旦配错，
`nativeImage` 会拿到空图 —— 托盘上什么都没有，用户以为程序没启动。
内嵌成常量则 dev 与打包后行为完全一致。

---

### 3.9 反馈功能：为什么**不做**自动发邮件

需求原话是「点击手动反馈，输入问题后，自动发送日志和输入的问题到我的邮件」。
**技术上可行，但做法是错的**：

- 客户端自动发邮件需要 **SMTP 服务器 + 账号密码**，而这些东西必须打包进程序。
  这是一个**开源项目** —— 密码等于公开，任何人都能拿它发垃圾邮件，
  而且邮件服务商看到的是**作者的账号**在发。
- 就算改用第三方表单服务（Formspree 之类），端点 URL 同样是公开的，只是滥用成本高一点。

**采用的方案**（都不需要任何凭据，而且**发送动作永远由用户完成**）：

| 方式 | 做法 | 代价 |
|---|---|---|
| **GitHub issue**（推荐） | 打开预填好的新 issue；完整日志复制到剪贴板，用户粘贴 | 用户要多按一次粘贴 |
| **mailto:** | 打开用户**自己的**邮件客户端，标题正文预填，他确认后点发送 | 依赖用户装了邮件客户端 |

另外**隐私上必须做对的一件事**：诊断信息里包含**账号名和好友数量**。
所以反馈界面上把要发送的文字**原样展示、可编辑**，用户能删掉任何不想给的行。
**悄悄发送用户数据是不可接受的 —— 即使用户主动点了"反馈"。**

日志来源：主进程给 `console` 打补丁做 tee（终端照常输出 + 一份进内存环形缓冲，
最多 400 行）。这样所有既有代码都不用改，未来新增的日志也自动被收集。
见 `src/main/log-buffer.ts`。

### 3.8 数据目录可更改（带校验过的迁移）

很多人不愿意把数据放在 C 盘，所以设置页可以改数据存放位置。

**分工**：
- **可以改的**：好友资料与变更事件（`dataDir` 设置）
- **不可以改的**：`settings.json` 与 `session.bin`（仍在 `%APPDATA%\vrcbw`）
  —— 有意的：设置本身是"用来找到数据"的东西，它必须待在固定位置，
  否则就是先有鸡还是先有蛋

**迁移顺序是「复制 → 校验 → 才删旧」**，不是直接改名：

1. **不能直接 `rename`**：用户可能选到**不同分区**，跨分区 rename 会直接 `EXDEV` 失败
2. **复制有中间态**：复制完成并校验通过之前，旧数据一直是完整可用的
3. **校验方式是递归比对文件数 + 总字节数**；不一致就保留两边并报错
   —— 宁可留两份，也绝不能删掉唯一一份
4. 三个守卫：目标不能等于源、不能位于源内部、不能是源的上级
   （后两种会让复制递归失控）
5. 删旧失败不算致命错误（数据已经在新位置了，旧的只是占点空间）

### 3.6 ★ 账号数据隔离（修复严重 bug）

**问题（用户发现）**：退出登录后仍然能看到好友列表；换一个账号登录，
看到的还是**上一个账号**的数据。原因是所有数据都写在同一份文件里，
既没有按账号分目录，也没有在退出登录后切断读取。

**修复（两层，缺一不可）**：

1. **数据层**：`setActiveAccount(userId | null)`
   - 每个账号一个目录：`data/<userId>/store.json`（或开启加密时的 `store.bin`）
   - 未登录时 `loadStore()` **不碰磁盘**，直接返回空数据；`saveStore()` 拒绝写入
   - `userId` 会做字符过滤（只留 `[A-Za-z0-9_-]`），异常 id 退化成哈希，避免路径穿越
   - **每个 auth 动作之后都必须调用它**（登录 / 2FA / 恢复会话 / 退出）。
     忘了调用就会退回成原来的 bug，所以它被封装在 `syncActiveAccount()` 里，
     并且是唯一入口。

2. **界面层**：未登录时**只渲染独立的登录页**，侧栏、顶部状态条、好友列表、
   变化记录、设置页全都不在 DOM 里（`App.tsx` 的三分支渲染）。
   只做第 1 层会出现"空白但布局还在"的怪状态；只做第 2 层则数据仍可能被别的方式读到。

**参考**：用户要求「参考 VRCX」——VRCX 也是先登录再进主界面。

### 3.7 本地数据加密（可选，默认关闭）

`safeStorage`（Windows DPAPI）可用时，设置页提供「加密本地数据」开关，
开启后数据以 `store.bin` 密文保存、明文 `store.json` 会被删除（不留明文副本）。

**默认关闭**，理由：
- 真正需要保密的是**会话凭据**，它本来就**单独**用 DPAPI 加密（`session.bin`）
- 好友简介属于半公开数据（对方的好友都能看到）
- 保持明文便于用户自己检查、备份和排查 —— 这是这个工具的可信度来源之一

**开启的代价**（设置页里写明了）：数据与当前 Windows 账户绑定，
换机器/换用户都解不开，也不能再用记事本查看。

> 切换开关时会**立刻重写当前账号的数据**，而不是等下次扫描 ——
> 否则用户点了开关会以为「已经加密了」，那是错觉。

---

## 4. 数据模型

> ⚠ 本节是**早期草案**，部分内容已被 §3.6 / §3.7 取代：
> 存储已从「单一 `friends.json` + `events.jsonl`」改为
> **按账号隔离的单一文档** `data/<userId>/store.json`（加密时为 `store.bin`），
> 事件也放进同一个文档里（原因见 `src/main/store/db.ts` 顶部注释）。

存放位置：`%AppData%\VRCBW\`

```
data/<userId>/store.json   该账号的全部数据（好友档案 + 变更事件 + 游标），明文
data/<userId>/store.bin    同上，开启加密时（DPAPI 密文）
session.bin                会话凭据（DPAPI 密文，与账号无关，一次只有一个登录态）
settings.json              界面设置（主题、语言、字号、每页条数、加密开关）
```

一条变更事件：

```json
{ "id": "…", "at": "2026-10-03T20:44:30.523Z", "userId": "usr_…",
  "field": "bio", "before": "旧内容", "after": "新内容" }
```

**设计要点**：
- 只有内容**真的变了**才写事件（用哈希比对），否则时间线会被「每天一条但内容相同」的噪音淹没
- 用 JSONL 只追加格式，便于以后加「导出 CSV」「全文搜索」而不改存储层
- 存储层封装成独立模块，将来若需换 SQLite，只改那一个文件
- **403/404 处理**：记录状态并跳过，**不删除历史**（20 个抽样全 200，但概率未知，必须防）
- **被解除好友的人**：名单里消失的 id 不删除其历史，标记为「已不再是好友」并保留时间线

### 4.1 为什么 v1 不用 SQLite

`better-sqlite3` 是原生模块，Electron 换版本就要重新编译（新手最常卡住的坑）；
Node 内置 `node:sqlite` 在 Electron 里可能仍需实验标志。
而数据量是几百好友 × 几 KB × 若干年 ≈ **几 MB**，JSON 完全够用、可直接用记事本查看、
零编译依赖。

---

## 5. 开发过程中踩过的工具链坑

### 5.1 ⚠ 不要碰 readline 私有 API 做「密码不回显」

**症状**：输入用户名正常，一到「密码」就完全卡住、无任何反应。

**原因**：覆盖 readline 私有方法 `rl._writeToOutput` 会破坏其内部状态机，
导致 `line` 事件永不触发 → 永久卡死。另外 `terminal: true` 硬编码也是隐患：
若 stdout 是终端而 stdin 是管道，readline 会进入原始按键模式，同样收不到 line 事件。

**正确做法**：
1. 绝不碰私有 API；密码用自己接管 `stdin` 原始模式实现
2. 终端模式由 `stdin.isTTY && stdout.isTTY` 共同决定，不硬编码
3. stdin 被关闭时立即报错，不静默卡住
4. 非 TTY 环境下给出可操作的三选一方案（环境变量 / 凭据文件 / 换真终端）

### 5.2 ⚠ Windows 凭据文件必须容忍 UTF-8 BOM

Windows 记事本、以及 **Windows PowerShell 5.1 的 `Set-Content -Encoding utf8`**，
都会在文件开头写 `U+FEFF`，而 `JSON.parse` 遇到 BOM 会直接抛
`Unexpected token`。读取凭据文件前必须 `replace(/^\uFEFF/, '')`。

### 5.3 探针的 `--mock` 模式是必备的

改成模拟模式后**立刻抓到两个运行时 bug**（重复函数导致大括号不闭合、空数据显示成 `-ms`），
而这些 bug 原本要用真实账号、消耗真实请求才能发现。

**规矩：改完探针代码先用 `--mock` 验证，不要拿用户账号试错。**

### 5.4 ⚠ 在 DSH 沙箱下安装依赖的工具链陷阱

搭骨架安装依赖时集中踩到 **6 个坑**。它们的报错**全都长成 `EPERM`**，看起来像杀毒软件
拦截或文件被占用，实际上没有一个是那个原因。全部记录如下。

#### (1) npm 缓存必须放在项目内

默认缓存目录 `%LOCALAPPDATA%\npm-cache` 在工作区之外 → 沙箱拒绝 →
`EPERM ... open '...\_cacache\tmp\xxx'`。

解法：`.npmrc` 里写 `cache=.npm-cache`（已在 `.gitignore` 排除）。

#### (2) Electron 缓存的环境变量名是 `electron_config_cache`（小写）

**不是** `ELECTRON_CACHE`。依据：`node_modules/electron/install.js` 里写的是

```js
cacheRoot: process.env.electron_config_cache,
```

名字写错时它**静默回退**到 `%LOCALAPPDATA%\electron`，然后被沙箱拒绝，报
`EPERM mkdir 'C:\Users\<你>\AppData\Local\electron'` —— 报错信息里**完全不会提到
环境变量名**，所以极难从报错本身推断出原因。

#### (3) npm 的 postinstall 需要 `--foreground-scripts`

npm 默认用**管道**捕获生命周期脚本的输出，而沙箱禁止管道 stdio（见下条），
于是 `spawn EPERM`。加 `--foreground-scripts` 让它继承 stdio 即可。

#### (4) esbuild 在沙箱内必然失败（需要更宽权限）

esbuild 的 JS 库通过**管道**与它自己的原生二进制通信 —— 这是它的固有工作方式，
不是可以绕过的实现细节。而 Vite / electron-vite 都依赖 esbuild，所以
`electron-vite dev` / `build` 在沙箱内一定失败。

**这只影响 Agent 侧的验证**：用户在自己的终端里运行 `npm run dev` 不受任何影响。

#### (5) ★ Agent 的沙箱内无法运行 Electron（GUI 必须用户自己验证）

**观察到的现象**（两条独立证据）：

- `net.createServer().listen('\\.\pipe\test')` → **`ENOENT`**（命名管道创建失败）
- 一个**不含任何项目代码**的最小 Electron 应用 → 以 `-2147483645`
  （`0x80000003`，STATUS_BREAKPOINT）崩溃，且 Chromium 的 crashpad 报 `not connected`；
  **连主进程自己代码的第一行 console.log 都没打印出来**（浏览器进程在极早期就死了）

**关于归因的两次更正**（这条结论被推翻过两次，保留过程以免后人重复踩）：

1. 最初写成「Chromium 的多进程 IPC 依赖命名管道，被禁即 abort」——**推测，未证实**。
2. 然后归因于 5.8 的目录权限问题（AppContainer/LPAC）。
3. **最终结论（有实测证据）**：Agent 的进程被降到 **`Low Mandatory Level`**，
   而 Chromium 要求「Medium 完整性 + 已过滤令牌」才能创建子进程 ——
   **与 5.11 是同一个机制**。实测 `whoami /groups` 在沙箱内返回
   `Mandatory Label\Low Mandatory Level`，在用户的提权终端里返回 `High`，
   两者都会让子进程创建失败（`error_code=18` / `0x80000003`）。
   详细机制与解法见 **5.11**。
关键判据是崩溃位置：

| 环境 | 崩溃位置 | 指向 |
|---|---|---|
| Agent 沙箱 | 浏览器进程启动前就死，无任何日志 | 沙箱层的进程/管道限制（或权限叠加） |
| 用户终端 | 主进程正常，**只有 GPU 子进程**反复失败 | 5.8 的目录权限问题 |

**结论不变且更明确：GUI 启动验证永远必须由用户在自己的终端里完成，Agent 无法代劳。**
Agent 侧能验证的是：类型检查、构建产物、以及 5.7 的启动自检报告机制是否就位。

#### (6) `ELECTRON_RUN_AS_NODE=1` 会让 `electron.exe` 退化成普通 Node

**症状**：`electron --version` 输出的是 **Node 的版本号**（如 `v24.21.0`）而不是 Electron
版本；应用启动后不开窗口、立刻退出。

**判断方法**：`node_modules/electron/dist/version` 文件里的才是权威 Electron 版本号。

**注意**：这个变量是 Agent 运行环境自带的。如果你在自己终端里看到「Electron 不开窗」，
先检查 `$env:ELECTRON_RUN_AS_NODE` 是否被设置。

### 5.5 ⚠ `.ps1` 脚本必须只用 ASCII

Windows PowerShell 5.1 在**没有 BOM** 时按 GBK（ANSI）解码 `.ps1` 文件。
中文注释被解成乱码后，**一个乱码引号会静默吞掉后面的语句** —— 没有语法错误、
没有警告、没有任何提示。

实际后果：`$env:ELECTRON_CACHE = ...` 这一整行凭空消失，导致 Electron 二进制下载到
错误位置。这条坑和 5.2 的 JSON BOM 问题正好是**同一个编码问题的两个方向**：

| 方向 | 现象 | 解法 |
|---|---|---|
| 读 UTF-8 **带** BOM 的 JSON | `JSON.parse` 抛 `Unexpected token` | 读之前 `replace(/^\uFEFF/, '')` |
| 读 UTF-8 **无** BOM 的 `.ps1`（PS 5.1） | 中文变乱码，可能吞掉代码 | `.ps1` 只用 ASCII |

所以 `scripts/install-deps.ps1` 的注释和输出**全英文**，这是刻意的，不要「为了好看」改回中文。

### 5.6 依赖安装脚本自带验证与自愈

**踩坑记录**：一次失败的 `npm install` 之后，npm 会认为 Electron 包「已安装」，
于是**跳过它的 postinstall**。结果是：所有 JS 包版本都正确、`npm ls` 一切正常，
但 `node_modules/electron/dist/electron.exe` **根本不存在**，一运行就报一个很难懂的错。

所以 `scripts/install-deps.ps1` 在安装后**必定检查** `electron.exe` 是否存在，
缺失时直接运行 `node_modules/electron/install.js` 补齐，最后打印一份版本清单。

### 5.7 GUI 验证机制（`_dev/startup-report.json`）

Agent 看不到窗口，所以启动验证不能靠「看一眼」。做法是让链路自己留证据：

1. 主进程启动后创建窗口
2. 界面挂载完成 → 通过 preload 调用 `notifyRendererReady()`，并把从 IPC 拿到的 UA 原样回传
3. 主进程收到后，把「环境信息 + 界面就绪时间 + IPC 往返校验结果」写入
   `_dev/startup-report.json`（该目录已 gitignore）

这样「主进程起来了 + preload 桥接成功 + 界面渲染完成 + IPC 双向通」这条链路就有了
可机读的证据。界面里的「环境自检」卡片也会把这些信息直接显示出来。

> 注意：**不要**拿界面的 `navigator.userAgent` 去和我们的 UA 比较 —— 那是 Electron 的
> 默认 UA，而我们调用 VRChat API 用的是自定义 UA，两者本来就不同。要校验的是
> 「界面回传的值 === 主进程持有的值」，这才证明 IPC 往返是通的。

### 5.8 ★★ Windows 上「应用启动即退出、报错指向显卡」的真正原因：目录权限

**这是本项目踩过的最具误导性的一个坑**，值得单独成节。

#### 症状

`npm run dev` 时主进程、preload、开发服务器全部正常，然后终端被这样的日志刷屏，
最后应用直接退出：

```
[ERROR:gpu_process_host.cc:1029] GPU process launch failed: error_code=18
[ERROR:...persistent_cache_sandboxed_file_factory.cc:153] Failed to open persistent cache
       files in directory "...\GPUPersistentCache\DawnGraphiteCache\...", error: 0:
       另一个程序正在使用此文件，进程无法访问。(0x20)
[FATAL:gpu_data_manager_impl_private.cc:417] GPU process isn't usable. Goodbye.
```

**报错信息从头到尾都在指向显卡**，而且那个 `0x20`（文件被占用）看起来像杀毒软件或残留进程。

#### 真正的原因

Chromium 的 GPU 子进程运行在 **AppContainer / LPAC 沙箱**里。要启动这个子进程，
**程序所在目录的 DACL 必须给 `S-1-15-2-2`（ALL RESTRICTED APPLICATION PACKAGES，
「所有受限制的应用程序包」）读取+执行权限**。缺失时，子进程的早期初始化就会失败
（实测塌在 `base::i18n::InitializeICUFromDataFile` 的 `CHECK` 上，**GPU 代码根本没跑到**），
子进程以 `0x80000003`（STATUS_BREAKPOINT = `-2147483645`）退出，Chromium 重试几次后放弃。

那个 `0x20` 缓存文件占用是**果不是因** —— GPU 进程反复启动时在抢同一个缓存目录。

**上游记录**：[electron/electron#51761](https://github.com/electron/electron/issues/51761)
（open，34 条讨论，多次独立复现）。同类报告：
[usebruno/bruno#4683](https://github.com/usebruno/bruno/issues/4683)、
[cypress-io/cypress#31659](https://github.com/cypress-io/cypress/issues/31659)。

#### 最有说服力的一份证据

有位报告者做了**同机 A/B 对照**：同一台机器、同一显卡、同一次开机，
Signal（崩溃）装在 `%LOCALAPPDATA%\Programs`（继承到了孤儿能力 SID），
Discord（正常）装在 `%LOCALAPPDATA%\Discord`（没有）。
**唯一差别就是安装目录的 DACL** —— 彻底排除了显卡/驱动假设。

#### 修复（已在 2026-10 对 `node_modules\electron\dist` 应用）

```powershell
icacls "<目录>" /grant "*S-1-15-2-2:(OI)(CI)(RX)"
```

要点：
- **只添加**一条权限，不删除任何现有权限、不 `/reset`、不改所有者、不需要管理员
- `(OI)(CI)` 让它递归继承；实测在项目根目录执行后，`node_modules\electron\dist`
  正确出现了 `(I)(OI)(CI)(RX)`
- 不需要去掉孤儿 SID 就能生效（有报告者交叉验证过：孤儿 SID 与 `S-1-15-2-2` 并存时应用可正常启动）

验证是否生效：

```powershell
icacls "node_modules\electron\dist" | Select-String "S-1-15-2-2"
```

#### ⚠ 两个必须记住的误区

1. **`--disable-gpu` 治不了这个病**。报告者实测：加了它 GPU 子进程**仍会启动并崩溃**
   （因为崩溃发生在沙箱 token 构造阶段，而不是「用不用 GPU 渲染」）。
   所以本项目里的 `app.disableHardwareAcceleration()` 是出于**省资源、避免驱动渲染差异**
   的考虑，**不是这个问题的解药** —— 代码注释里已明确标注，别把因果搞反。
2. **`--disable-gpu-sandbox` 才是有效的绕过**（上游报告里 ACL 这一类均可用它启动），
   但它降低了 GPU 子进程的隔离。本项目把它保留为**故障排查开关**
   （环境变量 `VRCBW_DISABLE_GPU_SANDBOX=1`），不作为默认行为。

#### 对第 6 步（打包）的直接影响

应用打包后同样会遇到这个坑，而且**用户的机器上我们无法预先修复**。
上游讨论里给出的建议是：**安装程序在解包完成后主动补上这条权限**。

```powershell
icacls $InstallDir /grant "*S-1-15-2-2:(OI)(CI)(RX)" | Out-Null
```

第 6 步做 electron-builder 打包时要把这条加进安装脚本（NSIS 的 `customInstall` 宏），
并在 README 里写明「如果应用启动即退出、终端报 GPU 错误，用上面这条命令修复」。
这对开源项目尤其重要 —— 否则会收到一批「装了打不开，还说是显卡问题」的反馈。

### 5.9 ★★ CSP 写死导致「界面永远挂载不上」（自己造的坑）

**症状**：`npm run dev` 的输出一切正常（主进程构建成功、preload 构建成功、
开发服务器已在 5173 监听），但**窗口不出现、界面不渲染，而且终端里一行报错都没有**。

**定位过程**（这一步完全靠 5.7 那套机制）：

`_dev/startup-report.json` 里有 `mainStarted: true`，但**没有** `rendererReady`。
一步就把故障范围从「整个应用」缩小到「界面从未挂载」——
如果没有这份报告，面对「什么都没发生、也没有报错」几乎无从下手。

**根因**：`src/renderer/index.html` 里写死了一份严格 CSP：`script-src 'self'`。
而开发模式下 `@vitejs/plugin-react` 会往 HTML 注入一段**内联** module 脚本
（React Refresh 的前导代码）。内联脚本被 CSP 拦掉 → React 初始化失败 → 界面空白。

证据（`node_modules/@vitejs/plugin-react/dist/index.js` 第 293–295 行）：

```js
transformIndexHtml: {
  tag: "script",
  children: getPreambleCode(base)   // ← 内联脚本，没有 src
}
```

**为什么终端里什么都看不到**：CSP 违规只报给**渲染进程的控制台**，
而运行 `npm run dev` 的人盯的是终端 —— 于是变成完全的黑盒。
所以本次同时加上了「渲染进程日志与错误转发到终端」（`console-message` /
`did-fail-load` / `preload-error` / `render-process-gone`）。

**修法**：CSP 不能写死，必须按模式注入。

| | 开发版 | 生产版 |
|---|---|---|
| `script-src` | `'self' 'unsafe-inline'`（React Refresh 需要） | `'self'`（禁止内联） |
| `connect-src` | `'self' ws: wss:`（HMR websocket） | `'self'`（界面完全不需要联网） |
| 其余 | `style-src 'self' 'unsafe-inline'`、`object-src 'none'`、`base-uri 'none'`、`form-action 'none'` | 同左 |

由 `electron.vite.config.ts` 里的 `cspPlugin()` 通过 `transformIndexHtml` 注入；
`index.html` 里只留一行标记 `<!-- VRCBW-CSP -->`。
**标记找不到时直接抛错让构建失败**，绝不静默发布一份没有 CSP 的产物。

**两条路径都已实测**：

- 生产：`electron-vite build` 日志出现 `[vrcbw-csp] 注入生产环境 CSP`，
  构建产物 HTML 内为严格版
- 开发：用 Vite 的 `createServer` + `transformIndexHtml` 单独探测，确认
  `ctx.server` 为真 → 走开发分支（`script-src 'self' 'unsafe-inline'`）

**可推广的三条教训**：

1. **「安全默认值」必须按环境区分** —— 写死一份，必然在其中一边出错。
2. **渲染进程的错误必须转发到主进程终端**，否则 Electron 调试是黑盒。
3. `show: false` + `ready-to-show` 必须有**超时兜底**，否则窗口可能永远不出现
   （软件渲染、无可用视频设备等情况下 `ready-to-show` 可能不触发）。

### 5.10 环境自检实测结果

来自用户机器上的 `_dev/startup-report.json`：

| 项 | 实测值 |
|---|---|
| Electron / Chromium / Node | 44.5.1 / 152.0.7977.130 / 24.21.0 |
| 数据目录 | `%APPDATA%\vrcbw` |
| **`safeStorage` 可用** | ✅ **true** —— 会话凭据可以用 DPAPI 加密保存，第 3 步无需降级方案 |
| 实际下发的 User-Agent | `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) VRCBW/0.1.0 (+…) Chrome/152.0.7977.130 Safari/537.36` |

注意 UA 里的 Chrome 版本是 **152**（取自 Electron 真实的 Chromium 版本），
而不是探针脚本里写死的 131 —— 说明「用 `process.versions.chrome` 动态生成」这个设计是对的，
正式代码不会因为 Electron 升级而出现版本号说谎的问题。

### 5.11 ★★ 「窗口不出现 / 一片黑」的第二个真凶：进程令牌的完整性级别

**这是本项目最耗时的一个坑**，而且它和 5.8（目录权限）**症状高度相似**，极易混淆。

#### 症状

- 窗口完全不出现，或出现后只有一片空背景色
- 终端刷屏 `GPU process launch failed: error_code=18`，最后
  `FATAL: gpu_data_manager_impl_private.cc GPU process isn't usable. Goodbye.`
- 加上 `--disable-gpu-sandbox` 后 GPU 那条消失，但日志里出现：

```
[renderer] ❌ 渲染进程终止：reason=launch-failed exitCode=18
```

> 这条日志是 5.9 里加的「渲染进程日志转发」抓到的。
> 没有它，黑屏的原因完全看不见 —— 那一处投入在这里回本了。

#### 根因

Chromium 要求浏览器进程运行在「**普通 Medium 完整性 + 已过滤的用户令牌**」下，
它才能用受限令牌创建子进程。令牌不对时，**GPU 进程和渲染进程都创建不出来**，
统一报 `error_code=18` / `launch-failed`：

| 进程令牌 | 子进程能否创建 |
|---|---|
| **Medium**（普通双击 / 开始菜单启动） | ✅ 正常 |
| **High**（以管理员身份运行） | ❌ 失败 |
| **Low**（受限令牌，例如被沙箱降权） | ❌ 失败 |

⚠ **这与显卡毫无关系**，但全部报错信息都指向 GPU，误导性极强。

#### 实测证据

| 检查 | 结果 |
|---|---|
| 用户运行 `npm run dev` 的终端 | `whoami /groups` → **`Mandatory Label\High Mandatory Level`**（已提权） |
| Agent 沙箱内的进程 | `whoami /groups` → **`Low Mandatory Level`**（受限令牌，同样失败） |
| 同一台机器上的 VRCX（也是 Electron） | ✅ 正常 —— 因为它由资源管理器以 **Medium** 启动 |

三条数据放在一起，根因就没有别的解释空间了。

**上游记录**：[electron/electron#49167](https://github.com/electron/electron/issues/49167)（open）。
其中一条报告报的正是 **DeepSeek Harness 本身**，描述与本项目**逐条一致**：
`error_code=18` → `Renderer process launch-failed` →
「`--disable-gpu-sandbox` 单独只能修好 GPU，渲染进程仍失败；
**只有 `--no-sandbox` 能启动应用**」。

#### 解法（按优先级）

1. **在普通（非提权）上下文里运行**（推荐，不需要任何开关）。
   从开始菜单直接打开终端，**先验证再运行**：

   ```powershell
   whoami /groups | findstr /i Mandatory   # 必须是 Medium Mandatory Level
   npm run dev
   ```

   令牌正常时，GPU 沙箱和渲染进程沙箱**都能正常工作**。

2. **临时自救**：`VRCBW_DISABLE_SANDBOX=1` → 加 `--no-sandbox`。
   ⚠ 这是本项目**唯一一处真正的安全降级**（渲染进程沙箱被关掉）。
   代码里已标注为「仅故障排查/临时自救，不要用于日常使用或发布」。

#### 对第 6 步（打包）的影响

- **安装程序绝不要申请管理员权限**。要求提权的 Electron 应用在这类机器上会直接打不开。
- README 必须写明：「如果窗口不出现、终端报 `error_code=18`，
  请确认不是以管理员身份运行」。这对开源项目尤其重要。
- 与 5.8 的区分方法：先看终端令牌（`whoami /groups`）；
  如果 `--disable-gpu-sandbox` 之后**渲染进程仍然 `launch-failed`**，就是本节的令牌问题。

### 5.12 ★★ 第三个真凶：工作区目录本身（最终定位）

5.11 解决的是「提权终端」。换成非提权终端（令牌已确认是 `Medium`）之后，
**渲染进程依然 `launch-failed / exitCode 18`**。继续排查，最终定位到**目录**。

#### 决定性的 A/B 对照（同一个应用、同一个启动方式，只换目录）

把生产构建产物 `out/` 复制到工作区之外，然后用**同一个** `electron.exe`
以**同样的方式**直接启动（不经过 electron-vite）：

| | 目录 | 结果 |
|---|---|---|
| **A** | `C:\vrcbw-test\app`（工作区之外） | ✅ **完整成功** |
| **B** | DSH 工作区目录 | ❌ 卡死，无窗口 |

A 的启动自检报告（这是最硬的证据）：

```json
{ "mainStarted": true, "domReady": true, "didFinishLoad": true,
  "rendererReady": true, "ipcRoundTripOk": true,
  "domProbe": { "rootChildCount": 1, "bodyTextPreview": "VRChat Bio Watcher 定期抓取好友资料…" } }
```

**结论：应用代码完全正确**（主进程、preload 桥接、IPC 往返、React 挂载、safeStorage 全部正常），
**问题只出在「从 DSH 工作区目录里运行 Electron」这件事上。**

#### 已逐个排除的属性（都做了对照实验）

| 属性 | 实验 | 结论 |
|---|---|---|
| `Everyone:(CI)(DENY)(DC)` | 加到干净目录后照常运行 | ✅ 无辜 |
| `Mandatory Label\Low Mandatory Level` | 给整棵树 74 个文件加低完整性标签后照常运行 | ✅ 无辜 |
| 重解析点 / 符号链接 | 逐级检查路径，全是普通目录 | ✅ 无关 |
| OneDrive 重定向 | Documents 未被重定向 | ✅ 无关 |
| **`S-1-4-659234657-133972590:(OI)(CI)(W,D,DC)`** | `icacls /grant` 报「处理 1 个文件时失败」 | ⚠️ **仍未测到** |

**悬案**：那个 DSH 注入的 `S-1-4-*` 权限项是唯一剩下的 ACL 差异，但还没能验证它是不是元凶
（icacls 无法为不可解析的 SID 授权；也完全可能是 DSH 沙箱某个不体现在 ACL 里的机制）。
**记录在此，供以后收尾。**

#### 采用的绕行方案

electron-vite 支持 `ELECTRON_EXEC_PATH` 环境变量
（依据：`node_modules/electron-vite/dist/chunks/lib-q6ns0vZr.js` 第 142 行
`let electronExecPath = process.env.ELECTRON_EXEC_PATH || ''`）。

因此：**代码留在工作区（可编辑、HMR 正常），只让 Electron 的二进制从工作区之外启动。**
实测有效，热更新也正常。

脚本：`scripts/dev.ps1`
- 自动检测工作区是否带 DSH 沙箱权限项（`icacls` 里是否出现 `S-1-4-`）
- 有 → 用干净运行时副本；没有 → 直接 `npm run dev`（普通机器的正常路径）
- 运行时副本放在 `%LOCALAPPDATA%\vrcbw-runtime\`，**不放 `C:\` 根目录**，首次自动复制

> ⚠ 这是**针对「工作区被 DSH 沙箱加固」这一特定环境**的绕行，不是通用做法。
> 普通用户直接 `npm run dev` 即可，开源版本不带这个前提。

#### 方法论教训（同一个错误犯了两次）

这个坑排查了很久，其中**两次因为「一次改了两个变量」而得出无效结论**：

1. 第一次：把输出接进 `Tee-Object` 管道的**同时**加了 `--no-sandbox` → 结果无法归因
2. 第二次：干净目录测试里**同时**换了目录**和**应用代码（最小程序 vs 我们的应用）
   → 一度误以为「就是目录的问题」，其实当时并未证明

后来改成严格 A/B（同应用、同启动方式、只换目录）才得到确定结论。
**另外发现：Windows 上 Electron 的 stdout 不会被 PowerShell 的重定向/管道捕获**
（GUI 子系统程序），所以「把日志写进文件让我读」这条路对 Electron 无效 ——
必须靠应用自己写文件（如 `_dev/startup-report.json`）或靠肉眼观察窗口。

---

### 5.13 ★ 扫描被中断后「数据是新的、统计是旧的」——用一个落盘标记解决

**症状（用户实测反馈）**：扫描到一半退出程序，再打开时发现——

- 好友的简介**已经是新的了**（半途扫到的那部分写进去了）
- 但界面上的「上次扫描时间」和「本次变化数」**还是上上次的**

用户的原话是"提示的上次扫描时间是上上次的，变化数也是错误的"。

**根因**：这是一个**固有矛盾**，不是 bug 的巧合：

| 数据 | 写入时机 |
|---|---|
| 好友资料（昵称 / 简介 / 简介链接） | **边扫边存**（每 `SAVE_EVERY` 个落一次盘） |
| 变化事件 | 发现就追加 |
| `lastScanAt` / `lastScanStats`（界面上的时间和变化数） | **只在整轮跑完时写** |

所以中断必然留下"部分新数据 + 完整旧统计"的组合。

**为什么不能改成"边扫边更新统计"**：`lastScanAt` 是**调度器的计时基准**
（自动扫描 10 小时、手动扫描 2 小时间隔都从它算起）。让它在中途就更新，
会把"扫描完成"的语义搞乱，甚至可能触发新一轮扫描。

**解法**：加两个字段做**中断判定**，而不是去改统计的语义。

```ts
scanStartedAt: string | null              // 扫描开始时写，结束（任何出口）时清
scanProgress:  { done, total } | null     // 进度快照，和上面同生共死
```

- 开始扫描时写下，`finally` 里清掉 —— **`finally` 覆盖了全部退出路径**
  （正常完成、拉名单失败、好友为空、401、429、连续失败过多、异常抛出）
- 启动时（**只在启动时**）如果 `scanStartedAt` 还有值 → 说明上个进程死在扫描中途
  → 写入 `lastScanWarning = { code: 'scanInterrupted', ... }`
  → 复用已有的「上一轮扫描出现了问题」横幅告诉用户

**两个必须注意的点**：

1. **判定只能在启动时做**。不能放进 `syncActiveAccount()` 里 —— 那个函数在登录等
   流程中也会被调用，而那些时刻可能**正有一轮扫描在跑**，会误报成"被中断"。
2. **顺手清掉 `lastScanAttemptAt`**，放行"立即重扫"。理由：被中断的那轮只扫了一部分，
   重扫**不会比正常一轮更费**（用户本来就要扫这一轮）。不清的话用户得干等 2 小时。
   重扫完成后正常计时，防重复扫描的保护没有削弱。

**"关窗口"不算中断** —— 关窗口只是收进托盘，扫描会继续跑，不会留下标记。
真正会留下标记的是：进程被杀、任务管理器结束任务、断电、装/卸载程序强杀。

### 5.14 「启动时最小化到托盘」只在**开机自启**时生效

**症状**：用户勾了「启动时最小化到系统托盘」，结果自己双击打开软件时窗口也被藏起来，
从命令行跑开发版同样如此 —— 用户原话"刚刚我命令行运行本地发现是自动最小化了"。

**结论**：这个选项的语义搞错了。它真正的用途是**开机时别打扰用户**，
而不是"把用户主动打开软件也藏起来"。所以改名并改语义：

- 界面文案：**「随 Windows 启动时最小化到系统托盘」**
- 实现：开机自启项里带 `--startup` 参数（`app.setLoginItemSettings({ args: ['--startup'] })`）
  - 有 `--startup` → 隐藏启动
  - 没有（手动双击 / 命令行 / 开发模式 / 快捷方式）→ 正常显示窗口
- 另外 `second-instance` 也要判断：开机自启拉起第二个实例时，**不要**把已有实例的窗口叫出来

> ⚠️ 判定不能靠"命令行里有没有 electron.exe"之类的猜测 —— 必须是我们自己写进
> 注册表的显式参数，否则用户手动启动和开机自启无法区分。

### 5.15 硬件加速：从「一律关闭」改为「默认开启 + 可关闭」

**原决定**（见上面 5.8 附近的注释）：`app.disableHardwareAcceleration()` 一律关闭，
理由是"界面只有表单和列表，软件渲染更省资源、避免驱动差异"。

**为什么改**：用户要求默认开启 GPU（"理论上应该默认 gpu 加速是最好的"），
而且原来的理由站不住 —— 关掉它**并不能**防住 5.8 那个崩溃（那条已实测确认：
崩溃发生在沙箱 token 构造阶段，与用不用 GPU 渲染无关）。既然防不了崩溃，
就没有理由让所有用户都退回软件渲染。

**现在的实现**：

- 设置项 `hardwareAcceleration`，**默认 true**
- **必须在 app ready 之前**决定（Chromium 的图形栈一旦初始化就无法运行时切换）
  → 所以是"同步读设置文件 → 立即决定"，**改完必须重启软件**（界面上有明确提示）
- 环境变量 `VRCBW_SOFTWARE_RENDER=1` 可强制软件渲染（排查用，不必改设置文件）
- `VRCBW_DISABLE_GPU_SANDBOX=1` 继续保留 —— 那才是 5.8 那个问题的绕过方式

### 5.16 安装程序主动补 AppContainer 权限（落实 5.8 里"第 6 步要做的事"）

5.8 结论里写着"安装程序在解包完成后主动补上这条权限"，但一直**没有实现**。
现在通过 `nsis.include` + `customInstall` 宏落实（见 `build/installer.nsh`）：

```nsis
!macro customInstall
  nsExec::ExecToLog 'icacls "$INSTDIR" /grant "*S-1-15-2-2:(OI)(CI)(RX)" /C /Q'
!macroend
```

几个细节：

- **不加 `/T`**：`(OI)(CI)` 已经让子文件继承，递归几千个文件只会拖慢安装
- **尽力而为**：权限已存在时 icacls 会返回非零，这属于正常情况，**不能让安装失败**
- 验证方式（破坏性实验）：把宏体里的命令改成无效命令再打包，**打包必须失败** ——
  因为 NSIS 的宏体是 `!insertmacro` 时才展开的，失败即证明宏**确实被调用**了。
  只验证"文件被 include"是不够的（宏定义了但没人调用，一样能编译通过）。

### 5.17 自动检查更新：静默检查 + 侧栏入口，**不弹窗**

用户明确要求不要弹窗。最终形态：

- 启动后**静默**检查一次：最多 3 次、每次超时 6 秒，全失败就放弃，
  **失败不提示也不记警告**（中国大陆网络到 GitHub 经常不通，属于预期情况）
- 发现新版本 → 侧栏统计区上方（那条分割线上面）出现「**有新版本 x.y.z**」入口，
  点击用系统浏览器打开 GitHub Releases 页
- 界面同时走两条路取结果：挂载时 `getAutoUpdateStatus()` 查一次 + 订阅
  `app:updateAvailable` 事件。**两条都必需** —— 主进程的检查和界面挂载是两条独立时间线，
  只做一条会出现"有时候能看到入口、有时候看不到"

> 这个功能请求的是 **GitHub API，完全不碰 VRChat**，所以**不增加任何限流/封号风险**。

---

### 5.18 ★★ 被外部代码审查指出的问题：逐条核实与修复

v1.1.0 之后有人 fork 并写了一份措辞很冲的批评。逐条对着源码核实过，
**其中 5 条属实**（1 条严重），2 条夸大，1 条建议不采纳。记录如下。

#### （1）★★ 账号串号：A 号的数据可能被写进 B 号的目录（最严重）

**成因**（每一环都被代码验证过）：

| 环节 | 位置 |
|---|---|
| 扫描开始时把数据拿在手里 | `watcher.ts` `const store: Store = loadStore()` |
| 但存盘写的是**当前登录账号**的目录 | `db.ts` `saveStore()` → `plainFile()` 由 `activeAccount` 决定 |
| 扫描开始时捕获的账号**只用于打日志**，从不校验 | `watcher.ts` `const activeAccount = getActiveAccount()` |
| 退出登录**不停**正在跑的扫描 | `index.ts` `auth:logout` 只调了 `stopScheduler()` |
| 全程序只有一个网络客户端，换号后旧扫描用的是新号的会话 | `auth.ts` `private client = new VrchatClient()` |

**后果**：A 号扫描途中退出、登 B 号 → 旧扫描继续用 B 的会话查 A 的好友 →
`saveStore(A 的 store)` 写进 **B 的目录** → B 的数据被覆盖、界面显示 A 的好友。

**修法（两道，都要）**：

1. `watcher.ts` 新增 `saveScanStore(store, scanAccount)`：**扫描里所有存盘都必须走它**，
   账号变了就直接跳过存盘（绝不把 A 的数据写进 B 的目录）。扫描里 11 处存盘全部改用它。
2. 循环每轮开头 + 退出登录时都判一次账号：变了就**立刻中止本轮**（连请求都不再发）。
   `auth:logout` 里加了 `watcher.requestStop()`。

> ⚠ 修这个坑时踩了一次自己的脚：第一版在"检测到账号变了"的分支里仍然调了 `saveStore()` ——
> 那等于把 bug 又执行了一遍。**任何在"账号已变"分支里的写操作都是错的。**

#### （2）请求没有超时

`client.ts` 的 `fetch` 原本没传 `signal`，卡住的连接要等到 undici 默认超时（约 300 秒）。
更糟的是"卡住"不算失败，**连续失败熔断形同虚设**。
现在加 `AbortSignal.timeout(15_000)`（`REQUEST_TIMEOUT_MS`）。
它同时缩小了（1）的竞态窗口 —— 从几分钟降到十几秒。

#### （3）临时性失败应该重试；中断不该按"完成一轮"罚站

原来：任何一次失败都跳过好友并计入熔断；连续 10 次就中断，**并且写 `lastScanAt`** →
手动扫描被罚 2 小时、自动扫描 10 小时。切个代理节点 = 两小时不能扫。

现在：
- **单个好友最多试 3 次**（`PROFILE_MAX_ATTEMPTS`）。只有临时性失败才重试
  （网络异常 / 超时 / 5xx）；**429、401、403、404 一律不重试**。
  重试之间**仍走 3 秒匀速间隔**，不形成突发。
- 熔断计数口径改成"连续多少个好友**彻底**失败"（每个已试满 3 次），
  所以单个好友的抖动不会提前触发熔断。
- **中断不写 `lastScanAt`**（那一轮并没有完成），改写到新字段 `lastAbortAt`，
  手动重试冷却只有 **15 分钟**（`ABORT_RETRY_COOLDOWN_MS`）。
  401 会话失效同样按此处理 —— 那也不是用户的错。

> 保留例外：**429 路径仍然写 `lastScanAt`** —— 它本来就有 10 小时强制冷却盖着，
> 写上去能让界面上的时间和变化数反映实际情况。

#### （4）"基线是否建立"不该借 `lastScanAt` 兼职

`isFirstScan` 原本是 `store.lastScanAt === null`，而中断路径也会写 `lastScanAt` →
"首轮扫到一半断了"会让第二轮误以为已有基线 → **每个还没记录过的好友都生成一条假的「新好友」**。
现在用独立字段 `baselineReady`，**只有完整跑完一轮才置位**。

#### （5）损坏的数据文件会被静默覆盖（数据永久丢失且无提示）

`loadStore()` 原来解析失败只打一行 warn 就当空数据，而紧接着任何一次 `saveStore()`
都会**原子覆盖**原文件 → 好友历史全没，用户完全不知道发生了什么。
现在：坏文件先改名成 `store.corrupt-<时间戳>.bak` 保留，并通过 `ScanSummary.dataLoadError`
在概览页弹出**醒目横幅**（含备份路径）。

#### （6）429 处理不统一

只有"逐个抓 profile"的循环里判了 429，**最开始拉好友名单的请求没有** ——
限流若发生在第一步，会被报成笼统的"拉名单失败"，而且**不进冷却期**。
现在抽出 `abortForRateLimit()`，两处共用。

#### （7）骤减阈值和注释互相矛盾

注释举的例子是"10 个好友删 4 个不该判成异常"，而代码是 `dropped > 3 && ratio > 0.3` ——
4 > 3 且 0.4 > 0.3，那个例子**恰好会被判成异常**。已统一成 `dropped >= 5 && ratio > 0.3`。

#### （8）README 关于 `session.bin` 的说法与代码注释矛盾

代码注释（`session-store.ts`）写的是"拷到别的机器或别的用户下都解不开"，
README 却写"那里面等于你的登录态"。**同一件事两种说法**，属于自己打自己。
已改成如实描述：DPAPI 防"文件被别人拿到"，**不防**"你机器上以你的身份运行的程序"。

> 对于"改成用户密码派生密钥 + AES/ChaCha20"的建议：**不采纳**。
> 那样每次启动都要输密码（托盘常驻 + 开机自启的形态直接废掉），
> 而且它主要防的是"文件被离线拿走"，对"正在运行的木马"帮助有限（密钥就在内存里）——
> 与提出者的论证并不自洽。DPAPI 是"不输密码也能开机自启"这类桌面应用的标准选择。

#### 没做的

- **没有补自动化测试**（仓库目前零测试，只有类型检查）。上面这些场景（尤其串号那条）
  用 mock 跑起来只要几秒，是防回归的最好办法 —— 但那需要一个测试脚手架，
  留作后续。**这是本次修复里唯一"说了但没做"的事，如实记录。**

---

## 6. 待确认 / 未确证项

| 项 | 状态 | 影响 |
|---|---|---|
| 限流红线（多少次请求触发 429） | **未确证**，且不主动试探 | **一见 429 即停 + 10 小时冷却**（见 3.5） |
| 403（私密资料）的真实概率 | 20 个抽样里 0 个，**样本太小** | 必须实现优雅跳过 |
| 好友被删除 / 注销账号时返回什么 | **未确证** | 按 403/404 统一处理 |
| `auth` cookie 的长期有效期 | **未确证** | 需要 401 时引导重新登录 |
| VRChat WebSocket `friend-update` 是否含 bio | **未确证** | v2 可调研，可能大幅降低请求量 |

---

## 7. 合规与风险（开源前必读）

- VRChat API 是**非官方支持**的，端点随时可能失效
- VRChat ToS §13.2 禁止「以不符合个人正常使用方式使用平台」；
  官方 FAQ 明确：无视 429 可能导致更长限流甚至**账号封停**
- README 必须写明「非官方工具」，不得暗示官方出品
- **凭据绝不进 git、不进日志、不上传**：开源意味着替全球用户的账号负责
- 反面教材：某些同类工具用明文 `credential.json` 存凭据
