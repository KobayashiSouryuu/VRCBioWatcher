import { APP_NAME } from '@shared/project'
import { createContext, useContext, type ReactNode } from 'react'
import type { ChangeField, ScanMessageCode, ScanProgress } from '@shared/types'

/**
 * 极简国际化。
 *
 * 为什么不装 i18next / react-intl：
 *   这个界面只有几百条文案、三种语言、没有复数规则和日期格式化需求
 *   （日期交给 toLocaleString）。一个 Record + 一个 t() 就够，
 *   省掉一个依赖和一堆配置。真需要复数规则时再换也不迟。
 *
 * ★ 类型安全：`ja` 和 `en` 都声明成 `Record<TKey, string>`，
 *   所以**漏翻一条就是编译错误**，不会出现界面上突然冒出一句中文的情况。
 */

export type Lang = 'zh' | 'ja' | 'en'

/**
 * 法律声明等长文案里要反复出现应用名。
 * 用 {app} 占位 + 这个函数替换，避免把名字硬编码在文案里（改名时只改 project.ts）。
 */
const legal = (body: string): string => body.replace(/\{app\}/g, APP_NAME)

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'ENG' },
]

/** 日期时间格式化用的 locale */
export const LOCALES: Record<Lang, string> = { zh: 'zh-CN', ja: 'ja-JP', en: 'en-US' }

/**
 * 中文是「基准语言」：TKey 由它推导出现，其余语言必须覆盖全部键。
 *
 * 文案里可以写两种轻量标记，由 rich() 渲染成 React 节点（**不用 innerHTML**）：
 *   **粗体**       → <b>
 *   `等宽`         → <span className="mono">
 * 这样各语言的语序可以自由调整，不必把句子拆成好几段去拼。
 */
const zh = {
  // --- 导航 ---
  navOverview: '概览',
  navFriends: '好友列表',
  navTimeline: '变化记录',
  navSettings: '设置',
  hintOverview: '登录、扫描、最近变化',
  hintFriends: '完整好友列表，可排序搜索',
  hintTimeline: '所有资料变化的时间线',
  hintSettings: '扫描节奏、外观、数据与账号',
  // --- 侧栏统计（都标注清楚是"扫描得到的数据"）---
  sideSessionChanges: '本次变化',
  sideTotalChanges: '累计变化',
  notLoggedIn: '未登录',
  loggedIn: '已登录',

  // --- 顶部状态条 ---
  scanning: '扫描中',
  /** 启动加载屏：说明当前在做什么（这一步是网络请求，可能要等几秒） */
  loadingSession: '正在恢复登录状态…',
  lastScanAt: '上次扫描：{time}',
  themeSystem: '系统',
  themeLight: '浅色',
  themeDark: '深色',

  // --- 新增的统计卡（其余统计文案在「概览」一节里已有，别重复定义）---
  statNextAutoScan: '下次自动扫描',

  // --- 通用 ---
  emptyText: '（空）',
  noneText: '（无）',
  close: '关闭',
  reset: '重置',
  labelOld: '旧',
  labelNew: '新',

  // --- 登录 ---
  loginStatusTitle: '登录状态',
  signedInAs: '当前登录用户 {name}',
  userIdLabel: '用户 ID',
  logoutButton: '退出登录',
  twoFactorTitle: '两步验证',
  twoFactorHint: '这个账号启用了两步验证。可用方式：{methods}',
  twoFactorUnknown: '未告知',
  twoFactorTotp: '认证器 App 上的 6 位验证码',
  twoFactorEmailOtp: '发送到你邮箱的验证码',
  twoFactorOtp: '恢复码 / 备用码',
  codeLabel: '验证码',
  codePlaceholder: '6 位数字，或恢复码',
  submitCodeButton: '提交验证码',
  verifyingButton: '验证中…',
  backButton: '返回',
  loginTitle: '登录 VRChat',
  usernameLabel: '用户名 / 邮箱',
  usernamePlaceholder: '你的 VRChat 用户名或邮箱',
  passwordLabel: '密码',
  passwordPlaceholder: '不会保存到磁盘',
  loginButton: '登录',
  loggingInButton: '登录中…',
  passwordNote:
    '**密码不会被保存**，只在本次登录时使用一次。登录成功后保存的是**会话凭据**，并用 Windows 系统加密（DPAPI，与你当前账户绑定）存放，这样下次启动不必重新登录。',

  // --- 概览 ---
  scanTitle: '扫描',
  startFirstScan: '开始首次扫描',
  scanNow: '立即扫描',
  scanningButton: '扫描进行中…',
  stopButton: '停止',
  loginFirstHint: '请先登录，再开始扫描。',
  /*
   * ⚠ 这些数字都是**上一次扫描**得到的，不是实时状态。
   *   所以标签里都写明「上次扫描」—— 用户明确要求把所有统计都标注数据来源。
   */
  statScannedFriends: '上次扫描好友数',
  statScannedChanges: '上次扫描变化数',
  statTotalChanges: '累计变化',
  statLastScan: '上次扫描',
  recentChangesTitle: '最近 10 条变化',
  viewAll: '查看全部（{n}）',
  emptyChangesLine1: '还没有任何变化记录。',
  emptyChangesLine2:
    '首次扫描只建立基线、不产生记录；之后只有好友真的改了资料、或好友关系发生变化才会出现在这里。**「没有变化」是常态**。',
  simNote: '提示：当前有 {n} 条模拟记录，可以在「变化记录」页一键清除。',

  // --- 好友列表 ---
  friendsTitle: '好友列表',
  searchPlaceholder: '搜索昵称或简介…',
  noFriendData: '还没有好友数据。先到「概览」页点「开始首次扫描」建立基线。',
  colFriendNumber: '序号',
  colDisplayName: '昵称',
  colBio: '简介',
  colBioHint: '鼠标悬停可看全文；这一列会跟随窗口宽度自动变宽',
  colLastChanged: '最近变化',
  colLastChangedHint: '最后一次检测到资料变化的时间',
  badgeRemoved: '已解除',

  // --- 变化记录 ---
  changesTitle: '变化记录',
  filterAll: '全部',
  filterDisplayName: '昵称变更',
  filterBio: '简介变更',
  filterRelation: '好友变更',
  clearTestChip: '清除 {n} 条模拟记录',
  clearTestButton: '清除模拟记录（{n}）',
  filterEmpty: '当前筛选下没有记录，点上面的「全部」看看。',
  tagTest: '模拟',
  /** 点变化记录里的**名字**打开该好友详情（用的都是本地数据，不请求接口） */
  clickForDetail: '点击查看这个好友的详情（本地数据，不请求接口）',
  /** 简介变更的展开/收起（点整条记录） */
  expandHint: '展开',
  collapseHint: '收起',
  relationAdded: '🟢 成为了好友（或重新加回）',
  relationRemoved: '🔴 已解除好友（也可能是账号注销 / 改名后无法匹配）',
  relationRemovedShort: '🔴 已解除好友（也可能是账号注销）',

  // --- 分页 ---
  pageSummary: '共 {total} 条 · 第 {page}/{pages} 页',
  firstPage: '首页',
  prevPage: '上一页',
  nextPage: '下一页',
  lastPage: '末页',
  perPage: '每页',
  perPageUnit: '条',
  perPageAuto: '自动',
  pageJump: '跳至',
  pageJumpUnit: '页',
  autoPageHint: '自动 = 按窗口高度计算，刚好不出现滚动条（当前 {n} 条）',

  /**
   * 变化时间的后缀。
   *
   * ⚠ 这个后缀不是装饰：我们**是通过扫描发现变化的**（没有接 WebSocket 广播），
   *   所以那个时间戳是「发现它的那一次扫描的时间」，**不是对方改简介的时间**。
   *   不写清楚，用户会以为是对方的操作时间（最多可能相差 10 小时）。
   */
  scanTimeSuffix: '（扫描时间）',
  /**
   * 数据来源说明。用户明确要求在界面上讲清楚"和 VRCX 不一样"这件事。
   */
  dataSourceNote:
    '**所有变化都来自定期扫描，不是实时推送** —— 这一点与 VRCX 不同。原因是 VRChat 在 v1.21.0 把简介从 WebSocket 推送里移除了（VRCX 也因此放弃了「简介变化」这个功能），所以简介只能靠轮询对比。\n因此界面上显示的时间是**发现变化的那次扫描的时间**，最多可能比对方实际修改的时间晚一个扫描周期（默认 10 小时）。本工具是**为查看简介变化而设计**的，不是好友动态监控。',

  // --- 好友详情抽屉 ---
  drawerCurrentBio: '当前简介',
  noBio: '（没有简介）',
  drawerBioLinks: '简介链接',
  drawerInfo: '资料信息',
  labelFirstSeen: '首次记录',
  labelLastChecked: '上次检查',
  labelLastChanged: '最近变化',
  labelChangeCount: '变化次数',
  drawerHistory: '最近 5 次变化记录（共 {n} 条）',
  drawerNoHistory: '还没有检测到这个人的任何变化。',

  // --- 字段名 ---
  fieldDisplayName: '昵称',
  fieldBio: '简介',
  fieldBioLinks: '简介链接',
  fieldFriendAdded: '成为好友',
  fieldFriendRemoved: '解除好友',

  // --- 设置：限流与账号安全 ---
  riskLastLimited: '上次触发限流的时间：{time}（冷却已结束）',
  riskNeverLimited: '目前没有触发过限流。',
  riskReportNote:
    '⚠ **如果你在使用中触发了 429（限流）**，请到项目的 GitHub 仓库反馈这个情况，并**建议暂时停止使用本工具**：那说明当前的请求节奏对你的账号来说偏快，需要重新评估参数后再继续。',
  logNote:
    '程序会记录每次扫描的完整过程：账号、好友总数、请求节奏、跳过数、变化数、每一次 429。反馈问题时请一并提供这些日志。',

  // --- 独立登录页 ---
  loginPageTitle: APP_NAME,
  loginPageSubtitle: '登录后才能查看好友资料与变化记录',
  loginPageFeature1: '定时抓取好友的简介、昵称与简介链接',
  loginPageFeature2: '记录每一次变化，并显示逐字符的差异',
  loginPageFeature3: '每个账号的数据分开保存，互不可见',
  loginPagePrivacy:
    '**密码不会被保存**，只在登录时用一次。保存的是会话凭据，用 Windows 系统加密（DPAPI）保护。',

  // --- 设置：扫描节奏与账号安全 ---
  pacingTitle: '扫描节奏与账号安全',
  scanEstimate:
    '当前有 **{count}** 个好友。每个好友之间间隔 **{seconds} 秒**，一轮约需 **{minutes} 分钟**。',
  scanLongWarning:
    '好友越多，一轮扫描就越久 —— 这是**刻意的**。VRChat 从未公布限流（429）阈值，把请求摊开、拉长间隔，是为了尽量避免触发限流（触发后可能导致账号被临时限制甚至封停）。',
  scanScheduleNote:
    '**自动扫描**：每 **{hours} 小时**一次（从**扫描完成**时刻开始计时）。打开软件时如果已经超过这个间隔，会自动补一次扫描。\n**手动扫描**：最快每 **{manualHours} 小时**一次，同样从扫描完成开始计时。',
  scanRateLimitNote:
    '一旦触发限流（429），会**立刻中断本轮扫描**并强制冷却 **{cooldownHours} 小时**。冷却记录写在数据文件里，重启软件也绕不过去。',
  manualWaitNote: '距下次可以手动扫描还有约 {minutes} 分钟。',
  nextAutoScanNote: '下次自动扫描：{time}',
  nextAutoScanNone: '下次自动扫描：完成一次扫描后开始计时',

  // --- 设置：启动行为 ---
  startupTitle: '首选项',
  autoLaunchLabel: '随 Windows 启动自动运行',
  startMinimizedLabel: '随 Windows 启动时最小化到系统托盘',
  minimizeToTrayLabel: '关闭窗口时最小化到系统托盘',
  /** 括号提示，跟在上面那行文字的右边（用户指定文案） */
  minimizeToTrayHint: '（默认开启；关闭此选项后，点关闭窗口会终止程序，同时也会停止扫描）',
  gpuAccelLabel: '启用 GPU 加速',
  gpuAccelHint: '（默认开启；如果 UI 显示有问题可以尝试关闭此选项，更改后重启软件生效）',

  // --- 关于页 ---
  navAbout: '关于',
  hintAbout: '版本、更新、反馈、法律声明与开源许可',
  aboutVersionTitle: '版本信息',
  aboutAppVersion: '程序版本',
  aboutGithubTitle: '项目主页与反馈',
  aboutCheckUpdate: '检查更新',
  aboutChecking: '正在检查…',
  aboutUpToDate: '已是最新版本（{version}）',
  aboutUpdateAvailable: '发现新版本：**{latest}**（当前 {current}）',
  aboutUpdateFailed: '检查更新失败：{error}',
  aboutChangelogButton: '查看更新日志',
  aboutLicenseTitle: '开源许可',
  aboutLicenseNote:
    '本项目使用了以下开源软件，在此致谢。各项目的完整许可文本可在其仓库查看；Electron 打包的 Chromium / Node.js 完整许可文件随安装包一并分发。',
  aboutLegalTitle: '法律声明',
  aboutLegalText:
    legal('{app} 是一个用于查看 VRChat 好友资料（简介、昵称、简介链接）变化的辅助应用。本程序使用了非官方的 VRChat API (VRCSDK)。\n\n{app} 不受 VRChat 的认可，也不反映 VRChat 或者任何正式参与制作或管理 VRChat 的人员/团体的观点或意见。VRChat 是 VRChat Inc. 的商标。VRChat © VRChat Inc.\n\nVRChat 从未公布 API 的限流（429）阈值。触发限流有概率导致账号被临时限制甚至封停，本程序按保守节奏设计，作者自测期间没有出现过限流（429）的情况，但并不能保证一定不会出现，请自行判断是否使用本工具。\n\nKobayashiSouryuu 及本项目的全体贡献者，均不对使用 {app} 引起的任何问题负责。使用时请自负风险！'),
  aboutLicenseChromium: '**本项目**以 MIT 许可发布，**Chromium** 为 BSD-3-Clause，**Node.js** 为 MIT；后两者还内含数百个第三方组件、各有其许可。**完整许可文本随安装包一并分发**，都在安装目录下：`LICENSE`（本项目）、`LICENSE.electron.txt`（Electron 与 Node.js）、`LICENSES.chromium.html`（Chromium 全部第三方许可，约 20MB）。',
  aboutAiTitle: 'AI 协助声明',
  aboutAiText:
    '本项目的代码在 AI 助手（DeepSeek）的协助下开发，设计决策与测试由作者本人把关。**署名与版权归人类作者所有。**',
  githubLabel: 'GitHub 仓库',
  openGithubButton: '打开项目主页',
  feedbackButton: '提交反馈…',

  feedbackDialogTitle: '提交反馈',
  feedbackProblemLabel: '请描述你遇到的问题',
  feedbackProblemPlaceholder: '例如：扫描到第 100 个好友时停止 / 差异显示不对 / 界面卡住…',
  feedbackDiagnosticsLabel: '将一并发送的诊断信息（请过目，可直接编辑）',
  feedbackPrivacyNote:
    '上面这段会**原样**发送出去，包含账号名和好友数量。发送前你可以随意删改任何内容。',
  feedbackProblemHeading: '--- 问题描述 ---',
  feedbackNoProblem: '（用户没有填写问题描述）',
  feedbackPasteHint: '完整日志已复制到剪贴板，请粘贴到此处（链接长度有限，放不下整段日志）。',
  copyDiagnosticsButton: '复制诊断信息',
  copiedHint: '已复制到剪贴板',
  sendViaGithub: '在 GitHub 提交',
  feedbackGithubHint:
    '会在浏览器里打开一个预填好的新 issue；**完整日志已复制到剪贴板**，请粘贴进去。',

  // --- 设置：加密与托盘 ---
  encryptLabel: '加密本地数据',
  encryptNote:
    '默认**关闭**。真正需要保密的是会话凭据，它本来就单独用 Windows DPAPI 加密保存；好友简介属于半公开数据，保持明文便于你自己检查、备份和排查问题。\n开启后会立即把数据重写成密文：与**当前 Windows 账户绑定**，换机器或换用户都解不开，也不能再用记事本查看。',
  encryptUnavailable: '⚠ 当前系统不支持 DPAPI 加密，这一项无法开启',
  encryptOn: '已开启（密文）',
  encryptOff: '未开启（明文 JSON）',
  accountScopedNote:
    '每个账号的数据分开保存在各自的目录里，退出登录后界面上不再显示任何数据，切换账号也不会看到别人的记录。',

  // --- 设置：外观与列表 ---
  appearanceTitle: '外观',
  themeLabel: '主题',
  languageLabel: '语言',
  fontLabel: '自定义字体',
  fontPlaceholder: '留空 = 默认字体',
  /** 输入框后面的短提示（用户要求：不要在下行写一长串解释） */
  fontHint: '（输入有效的 CSS 字体名称；没有该字体则自动回落默认）',
  fontApplied: '已应用',
  fontMissing: '⚠ 系统里没找到「{name}」，正在使用默认字体',
  fontScaleLabel: '字号缩放',
  pageSizeLabel: '每页条数',
  pageSizeNote: '条（10–500，好友列表与变化记录共用）',
  pageSizeAutoLabel: '好友列表每页条数自动',
  pageSizeAutoChangesLabel: '变化记录每页条数自动',
  pageSizeAutoNote: '自动 = 按窗口高度算到刚好不出现滚动条。取消勾选后用手动条数。',
  showRemovedLabel: '在好友列表中显示已解除的好友',
  showRemovedNote:
    '默认关闭：已经不是好友了就不显示。历史记录仍然保留（在变化记录里还能看到）。',

  // --- 设置：数据 ---
  dataTitle: '数据',
  dataDirLabel: '数据位置',
  dataDirDefaultLabel: '默认位置',
  dataDirAccountLabel: '本账号数据目录',
  dataDirSettingsLabel: '设置与凭据位置',
  changeDataDirButton: '更改数据位置…',
  resetDataDirButton: '恢复默认位置',
  dataDirMoving: '正在迁移…',
  dataDirMoved: '迁移完成：{files} 个文件（{bytes}）。',
  dataNote:
    '每个账号一个子目录，里面的 `store.json` 存该账号的全部数据（好友资料 + 变更事件 + 扫描游标）；开启加密后变成 `store.bin` 密文。',

  // --- 设置：账号 ---
  accountTitle: '账号',
  accountNotLoggedIn: '当前未登录。请到「概览」页登录。',
  accountNote:
    '保存的是**会话凭据**（Windows DPAPI 加密，与当前账户绑定），**密码从不落盘**。退出登录会同时清除本地会话。',
  openDataDirButton: '打开数据目录',

  // --- 设置：开发工具 ---
  devToolsTitle: '开发工具（仅开发模式可见，打包后自动消失）',
  devToolsNote:
    '因为「好友真的改简介」可能等很久，这里可以注入模拟数据来验证界面与数据链路。注入的记录带标记，可以一键清除并回滚副作用。',
  injectBio: '注入模拟简介变化',
  injectAdd: '注入模拟「成为好友」',
  injectRemove: '注入模拟「解除好友」',

  // --- 设置：环境自检 ---
  envTitle: '环境自检',
  envElectron: 'Electron',
  envChromium: 'Chromium',
  envMode: '运行模式',
  envModeDev: '开发（热更新已启用）',
  envModeProd: '打包后',
  envCredential: '凭据加密',
  envCredentialOk: '可用（Windows DPAPI）',
  envCredentialBad: '⚠ 不可用，会话无法保存',

  // --- 启动自检 ---
  startupErrorTitle: '启动自检失败',
  bridgeMissingError:
    '没有检测到 Electron 的 preload 桥接（window.vrcbw 不存在）。请通过 scripts\\dev.ps1 启动应用，而不是用浏览器直接打开页面。',

  // --- 扫描进度（由主进程给出代码，界面翻译）---
  scanListing: '正在获取好友名单…',
  scanListingCount: '共 {total} 个好友，正在获取活跃时间用于排序…',
  scanScanning: '正在检查第 {index}/{total} 个好友…',
  scanStopped: '已按你的要求停止（已检查 {done}/{total}）。已完成的进度已保存。',
  scanDoneNoChange: '扫描完成：检查 {done} 个好友，没有发现变化（这是常态）',
  scanDoneChanges: '扫描完成：检查 {done} 个好友，发现 {found} 处变化',
  scanRateLimited:
    '遇到限流（429），已立刻中断本轮扫描 —— 这是刻意的保守策略，不是故障。已完成的 {done} 个好友进度已保存。为保护账号，接下来 {hours} 小时内不会开始新扫描。',
  scanManualTooSoon:
    '距上次扫描不足 {hours} 小时，还需等待约 {minutes} 分钟才能手动扫描。（自动扫描不受此限制）',
  scanAutoStarted: '已到自动扫描时间，正在自动开始扫描…',
  scanAbnormalEnd: '扫描失败：{message}',
  scanNotLoggedIn: '请先登录，再开始扫描',
  scanCooldown:
    '上次触发了 VRChat 的限流，为保护账号，还需等待约 {minutes} 分钟（{hours} 小时冷却期）才能再次扫描。',
  scanAlreadyRunning: '已有扫描在进行中',
  scanFriendsFailed: '获取好友名单失败：{error}',
  scanEmptyFriends: '好友名单为空，没有需要扫描的对象',
  scanSessionExpired: '登录状态已失效，扫描中断。请重新登录后再试。',
  scanTooManyFailures: '连续 {limit} 次请求失败（已检查 {done}/{total}），已主动中断扫描，避免继续请求。',
  scanDoneMostlyFailed:
    '⚠ 本轮只成功检查了 {done}/{total} 个好友（跳过 {skipped} 个）—— **结果不可信**，不能当作"没有变化"。可能是 VRChat 服务或网络有问题。',
  scanRelationSkipped:
    '拿到的好友名单自相矛盾，已跳过本轮的「解除好友」判定，避免产生假记录。',
  scanInterrupted:
    '上一次扫描**没跑完就被中断了**（进度 {done}/{total} 个好友）。好友简介是**边扫边存**的，所以那部分数据已经写进列表了；但「上次扫描时间」和「变化数」只在整轮跑完时才更新 —— **界面显示的仍是上一次完整扫描的数字**。建议现在重新扫描一次把它补齐。',

  // --- 概览页：上一轮扫描异常横幅 ---
  warningTitle: '上一轮扫描出现了问题',
  warningDismiss: '知道了',
  warningAt: '发生时间：{time}',

  // --- 侧栏：有新版本入口 ---
  updateAvailable: '有新版本 {version}',
  updateAvailableTitle: '发现新版本 {version} —— 点击在浏览器中打开 GitHub 发布页',

  // --- 概览页：全新账号的首次引导 ---
  firstRunTitle: '还没有任何数据',
  firstRunIntro:
    '这个工具会定期抓取你好友的简介与昵称，记录每一次变化。\n**第一次必须手动扫描**来建立基线 —— 之后才会开始自动扫描。',
  firstRunPacing:
    '扫描节奏（按保守估计设计，请不要想办法让它更快）：\n· 每个好友之间固定间隔 **{seconds} 秒**，扫描过程中不能加速\n· 自动扫描每 **{autoHours} 小时**一次（从上次扫描**完成**时刻开始计时）\n· 手动扫描最快每 **{manualHours} 小时**一次\n· 一旦触发限流（429），立即中断并**冷却 {cooldownHours} 小时**',
  firstRunRisk:
    '⚠ **风险提示**：VRChat 从未公布频率限制的阈值。本工具已按最保守的方式设计，但仍然**存在账号被临时限制甚至封停的风险**。请自行判断是否使用。',
  firstRunNote: '数据只保存在你自己的电脑上，密码不会写入磁盘。',
  firstRunStart: '开始第一次扫描',
  statNoData: '无数据，第一次请手动扫描',
} as const

/** 基准语言的全部键名；其余语言必须一一对应 */
export type TKey = keyof typeof zh

const ja: Record<TKey, string> = {
  navOverview: '概要',
  navFriends: 'フレンド一覧',
  navTimeline: '変更履歴',
  navSettings: '設定',
  hintOverview: 'ログイン・スキャン・最近の変更',
  hintFriends: 'フレンド一覧（並べ替え・検索可）',
  hintTimeline: 'すべてのプロフィール変更のタイムライン',
  hintSettings: 'スキャン間隔・外観・データ・アカウント',
  // --- 侧栏统计 ---
  sideSessionChanges: '今回の変更',
  sideTotalChanges: '累計の変更',
  notLoggedIn: '未ログイン',
  loggedIn: 'ログイン中',

  scanning: 'スキャン中',
  loadingSession: 'ログイン状態を復元しています…',
  lastScanAt: '前回のスキャン：{time}',
  themeSystem: 'システム',
  themeLight: 'ライト',
  themeDark: 'ダーク',

  statNextAutoScan: '次回の自動スキャン',

  emptyText: '（空）',
  noneText: '（なし）',
  close: '閉じる',
  reset: 'リセット',
  labelOld: '旧',
  labelNew: '新',

  loginStatusTitle: 'ログイン状態',
  signedInAs: 'ログイン中のユーザー {name}',
  userIdLabel: 'ユーザー ID',
  logoutButton: 'ログアウト',
  twoFactorTitle: '二段階認証',
  twoFactorHint: 'このアカウントは二段階認証が有効です。利用可能な方法：{methods}',
  twoFactorUnknown: '不明',
  twoFactorTotp: '認証アプリの 6 桁コード',
  twoFactorEmailOtp: 'メールに送信されたコード',
  twoFactorOtp: 'リカバリーコード',
  codeLabel: 'コード',
  codePlaceholder: '6 桁の数字、またはリカバリーコード',
  submitCodeButton: 'コードを送信',
  verifyingButton: '確認中…',
  backButton: '戻る',
  loginTitle: 'VRChat にログイン',
  usernameLabel: 'ユーザー名 / メール',
  usernamePlaceholder: 'VRChat のユーザー名またはメールアドレス',
  passwordLabel: 'パスワード',
  passwordPlaceholder: 'ディスクには保存されません',
  loginButton: 'ログイン',
  loggingInButton: 'ログイン中…',
  passwordNote:
    '**パスワードは保存されません**。今回のログインで一度だけ使用します。ログイン成功後に保存されるのは**セッション情報**で、Windows の暗号化（DPAPI、現在のアカウントに紐付け）で保護されます。次回起動時に再ログインが不要になります。',

  scanTitle: 'スキャン',
  startFirstScan: '初回スキャンを開始',
  scanNow: '今すぐスキャン',
  scanningButton: 'スキャン中…',
  stopButton: '停止',
  loginFirstHint: '先にログインしてください。',
  statScannedFriends: '前回スキャンのフレンド数',
  statScannedChanges: '前回スキャンの変更数',
  statTotalChanges: '累計の変更',
  statLastScan: '前回のスキャン',
  recentChangesTitle: '最近の 10 件の変更',
  viewAll: 'すべて表示（{n}）',
  emptyChangesLine1: 'まだ変更の記録はありません。',
  emptyChangesLine2:
    '初回スキャンは基準を作るだけで記録を残しません。以降、フレンドが実際にプロフィールを変更したか、フレンド関係が変化したときだけここに表示されます。**「変更なし」が通常です**。',
  simNote: '現在 {n} 件のテスト記録があります。「変更履歴」ページで一括削除できます。',

  friendsTitle: 'フレンド一覧',
  searchPlaceholder: '名前または自己紹介で検索…',
  noFriendData: 'フレンドのデータがまだありません。「概要」ページで「初回スキャンを開始」を押してください。',
  colFriendNumber: '番号',
  colDisplayName: '名前',
  colBio: '自己紹介',
  colBioHint: 'マウスを乗せると全文表示。この列はウィンドウ幅に合わせて広がります',
  colLastChanged: '最近の変更',
  colLastChangedHint: '最後に変更を検出した日時',
  badgeRemoved: '解除済み',

  changesTitle: '変更履歴',
  filterAll: 'すべて',
  filterDisplayName: '名前の変更',
  filterBio: '自己紹介の変更',
  filterRelation: 'フレンド変更',
  clearTestChip: 'テスト記録 {n} 件を削除',
  clearTestButton: 'テスト記録を削除（{n}）',
  filterEmpty: 'この絞り込みには記録がありません。「すべて」を押してください。',
  tagTest: 'テスト',
  clickForDetail: 'クリックでこのフレンドの詳細を表示（ローカルデータのみ、通信しません）',
  expandHint: '展開',
  collapseHint: '折りたたむ',
  relationAdded: '🟢 フレンドになりました（再追加を含む）',
  relationRemoved: '🔴 フレンド解除（アカウント削除・名前変更の可能性もあります）',
  relationRemovedShort: '🔴 フレンド解除（アカウント削除の可能性も）',

  pageSummary: '全 {total} 件 · {page}/{pages} ページ',
  firstPage: '先頭',
  prevPage: '前へ',
  nextPage: '次へ',
  lastPage: '末尾',
  perPage: '1ページ',
  perPageUnit: '件',
  perPageAuto: '自動',
  pageJump: 'ページ指定',
  pageJumpUnit: 'ページ',
  autoPageHint: '自動 = ウィンドウの高さに合わせて、スクロールが出ない件数（現在 {n} 件）',
  scanTimeSuffix: '（スキャン時刻）',
  dataSourceNote:
    '**すべての変更は定期スキャンで検出したもので、リアルタイム通知ではありません** —— ここが VRCX と異なります。VRChat が v1.21.0 で自己紹介を WebSocket 通知から削除したため（VRCX も「自己紹介の変更」機能を断念しました）、自己紹介はポーリングでしか取得できません。\nしたがって画面の時刻は**変更を検出したスキャンの時刻**であり、実際に変更された時刻より最大 1 周期（既定 10 時間）遅れる可能性があります。本ツールは**自己紹介の変化を見るためのもの**で、フレンドの動向監視ではありません。',

  drawerCurrentBio: '現在の自己紹介',
  noBio: '（自己紹介なし）',
  drawerBioLinks: 'リンク',
  drawerInfo: 'プロフィール情報',
  labelFirstSeen: '初回記録',
  labelLastChecked: '前回の確認',
  labelLastChanged: '最近の変更',
  labelChangeCount: '変更回数',
  drawerHistory: '直近 5 件の変更履歴（全 {n} 件）',
  drawerNoHistory: 'この人の変更はまだ検出されていません。',

  fieldDisplayName: '名前',
  fieldBio: '自己紹介',
  fieldBioLinks: 'リンク',
  fieldFriendAdded: 'フレンド追加',
  fieldFriendRemoved: 'フレンド解除',

  riskLastLimited: '前回レート制限を受けた日時：{time}（クールダウンは終了しています）',
  riskNeverLimited: 'これまでレート制限は発生していません。',
  riskReportNote:
    '⚠ **使用中に 429（レート制限）が発生した場合**は、GitHub リポジトリで状況をご報告ください。そのうえで**本ツールの使用を一旦中止することをおすすめします** —— 現在のリクエスト間隔があなたのアカウントには速すぎる可能性があり、設定を見直す必要があります。',
  logNote:
    'プログラムは各スキャンの詳細（アカウント、フレンド総数、リクエスト間隔、スキップ数、変更数、429 の発生）を記録します。問題を報告する際はこれらのログも添えてください。',

  // --- 独立登录页 ---
  loginPageTitle: APP_NAME,
  loginPageSubtitle: 'ログインするとフレンドのプロフィールと変更履歴を表示できます',
  loginPageFeature1: '自己紹介・名前・リンクを定期的に取得',
  loginPageFeature2: 'すべての変更を記録し、文字単位の差分を表示',
  loginPageFeature3: 'アカウントごとにデータを分離して保存',
  loginPagePrivacy:
    '**パスワードは保存されません**。ログイン時に一度だけ使用します。保存されるのはセッション情報で、Windows の暗号化（DPAPI）で保護されます。',

  // --- 設定：スキャン間隔 ---
  pacingTitle: 'スキャン間隔とアカウントの安全',
  scanEstimate: '現在 **{count}** 人のフレンドがいます。1 人あたり **{seconds} 秒**間隔なので、1 回に約 **{minutes} 分**かかります。',
  scanLongWarning:
    'フレンドが多いほど 1 回のスキャンは長くなります。これは**意図的**です。VRChat はレート制限（429）のしきい値を公表しておらず、リクエストを分散して間隔を空けることで、制限（最悪の場合はアカウント停止）を避けています。',
  scanScheduleNote:
    '**自動スキャン**：**{hours} 時間**ごと（**スキャン完了**時点から計測）。起動時にこの間隔を過ぎていれば自動で 1 回実行します。\n**手動スキャン**：最短 **{manualHours} 時間**に 1 回（同じく完了時刻から計測）。',
  scanRateLimitNote:
    'レート制限（429）を受けると、**その回のスキャンを即中断**し **{cooldownHours} 時間**の強制クールダウンに入ります。クールダウンはデータファイルに記録され、再起動しても回避できません。',
  manualWaitNote: '次に手動スキャンできるまで約 {minutes} 分です。',
  nextAutoScanNote: '次回の自動スキャン：{time}',
  nextAutoScanNone: '次回の自動スキャン：スキャン完了後に計測が始まります',

  // --- 設定：起動と終了 ---
  startupTitle: '環境設定',
  autoLaunchLabel: 'Windows 起動時に自動で実行する',
  startMinimizedLabel: 'Windows 起動時にトレイへ最小化する',
  minimizeToTrayLabel: 'ウィンドウを閉じたらトレイに最小化する',
  minimizeToTrayHint:
    '（既定でオン。オフにすると、閉じるボタンでプログラムが終了し、スキャンも停止します）',
  gpuAccelLabel: 'GPU アクセラレーションを有効にする',
  gpuAccelHint:
    '（既定でオン。UI の表示に問題がある場合は、この項目をオフにしてみてください。変更後は再起動が必要です）',

  // --- 概要ページ ---
  navAbout: 'このアプリについて',
  hintAbout: 'バージョン・更新・フィードバック・法的表示・ライセンス',
  aboutVersionTitle: 'バージョン情報',
  aboutAppVersion: 'アプリのバージョン',
  aboutGithubTitle: 'プロジェクトページとフィードバック',
  aboutCheckUpdate: '更新を確認',
  aboutChecking: '確認中…',
  aboutUpToDate: '最新版です（{version}）',
  aboutUpdateAvailable: '新しいバージョンがあります：**{latest}**（現在 {current}）',
  aboutUpdateFailed: '更新の確認に失敗しました：{error}',
  aboutChangelogButton: '更新履歴を見る',
  aboutLicenseTitle: 'オープンソースライセンス',
  aboutLicenseNote:
    '本プロジェクトは以下のオープンソースソフトウェアを利用しています。各プロジェクトの完全なライセンス全文は各リポジトリで確認できます。Electron が同梱する Chromium / Node.js のライセンス全文はインストーラーに含まれます。',
  aboutLegalTitle: '法的表示',
  aboutLegalText:
    legal('{app} は、VRChat のフレンドのプロフィール（自己紹介・名前・リンク）の変化を確認するための補助アプリです。本プログラムは非公式の VRChat API (VRCSDK) を使用しています。\n\n{app} は VRChat に承認されておらず、VRChat または VRChat の制作・運営に正式に関わる人物・団体の見解を反映するものでもありません。VRChat は VRChat Inc. の商標です。VRChat © VRChat Inc.\n\nVRChat は API のレート制限（429）のしきい値を公表していません。レート制限に達すると、アカウントが一時制限または停止される可能性があります。本プログラムは保守的な間隔で設計されており、作者の検証中にレート制限が発生したことはありませんが、絶対に発生しないことを保証するものではありません。ご自身の判断でご利用ください。\n\nKobayashiSouryuu および本プロジェクトの全貢献者は、{app} の使用によって生じたいかなる問題についても責任を負いません。自己責任でご使用ください。'),
  aboutLicenseChromium: '**本プロジェクト**は MIT、**Chromium** は BSD-3-Clause、**Node.js** は MIT で、後者 2 つは数百のサードパーティコンポーネントを各々のライセンスで含んでいます。**完全なライセンス全文はインストーラーに同梱されています**（インストール先）：`LICENSE`（本プロジェクト）、`LICENSE.electron.txt`（Electron と Node.js）、`LICENSES.chromium.html`（Chromium の全サードパーティライセンス、約 20MB）。',
  aboutAiTitle: 'AI 利用の開示',
  aboutAiText:
    '本プロジェクトのコードは AI アシスタント（DeepSeek）の支援を受けて開発されました。設計判断とテストは作者本人が行っています。**著作権と著作者表示は人間の作者に帰属します。**',

  // --- 設定：フィードバック ---
  githubLabel: 'GitHub リポジトリ',
  openGithubButton: 'プロジェクトページを開く',
  feedbackButton: 'フィードバックを送る…',

  feedbackDialogTitle: 'フィードバックを送る',
  feedbackProblemLabel: '発生した問題を説明してください',
  feedbackProblemPlaceholder: '例：100 人目あたりでスキャンが止まる / 差分の表示がおかしい / 画面が固まる…',
  feedbackDiagnosticsLabel: '一緒に送信される診断情報（内容をご確認ください。編集もできます）',
  feedbackPrivacyNote:
    '上記は**そのまま**送信されます。アカウント名やフレンド数が含まれます。送信前に自由に削除・編集できます。',
  feedbackProblemHeading: '--- 問題の説明 ---',
  feedbackNoProblem: '（問題の説明は未記入です）',
  feedbackPasteHint:
    '完全なログはクリップボードにコピー済みです。ここに貼り付けてください（URL の長さには限りがあります）。',
  copyDiagnosticsButton: '診断情報をコピー',
  copiedHint: 'クリップボードにコピーしました',
  sendViaGithub: 'GitHub で報告',
  feedbackGithubHint:
    'ブラウザで新規 issue（入力済み）を開きます。**完全なログはクリップボードにコピー済み**なので貼り付けてください。',

  // --- 设置：加密与托盘 ---
  encryptLabel: 'ローカルデータを暗号化',
  encryptNote:
    '既定では**オフ**です。本当に保護すべきなのはセッション情報で、それは元から Windows DPAPI で個別に暗号化されています。フレンドの自己紹介は半公開の情報であり、平文のままにしておけば自分で確認・バックアップ・トラブルシュートができます。\nオンにするとデータは即座に暗号文へ書き換えられます。**現在の Windows アカウントに紐付く**ため、別の PC や別のユーザーでは復号できず、メモ帳で中身を見ることもできなくなります。',
  encryptUnavailable: '⚠ このシステムでは DPAPI 暗号化を利用できないため、オンにできません',
  encryptOn: 'オン（暗号文）',
  encryptOff: 'オフ（平文 JSON）',
  accountScopedNote:
    'アカウントごとにデータは別のフォルダへ保存されます。ログアウト後は何も表示されず、別のアカウントでログインしても他人の記録は見えません。',

  appearanceTitle: '外観',
  themeLabel: 'テーマ',
  languageLabel: '言語',
  fontLabel: 'カスタムフォント',
  fontPlaceholder: '空欄 = 既定フォント',
  fontHint: '（有効な CSS フォント名を入力。無ければ既定に戻ります）',
  fontApplied: '適用済み',
  fontMissing: '⚠ 「{name}」がシステムに見つかりません。既定のフォントを使用します',
  fontScaleLabel: '文字サイズ',
  pageSizeLabel: '1 ページの件数',
  pageSizeNote: '件（10–500、フレンド一覧と変更履歴で共通）',
  pageSizeAutoLabel: 'フレンド一覧の件数を自動にする',
  pageSizeAutoChangesLabel: '変更履歴の件数を自動にする',
  pageSizeAutoNote: '自動 = ウィンドウの高さに合わせて、スクロールが出ない件数にします。オフにすると手動指定になります。',
  showRemovedLabel: 'フレンド一覧に解除済みも表示する',
  showRemovedNote:
    '既定ではオフです。フレンドでなくなった相手は表示しません（履歴は変更履歴に残ります）。',

  dataTitle: 'データ',
  dataDirLabel: 'データの保存先',
  dataDirDefaultLabel: '既定の場所',
  dataDirAccountLabel: 'このアカウントのデータフォルダ',
  dataDirSettingsLabel: '設定と認証情報の場所',
  changeDataDirButton: '保存先を変更…',
  resetDataDirButton: '既定の場所に戻す',
  dataDirMoving: '移動中…',
  dataDirMoved: '移動が完了しました：{files} ファイル（{bytes}）。',
  dataNote:
    'アカウントごとに 1 つのサブフォルダを作り、その中の `store.json` に全データ（プロフィール・変更イベント・スキャン位置）を保存します。暗号化を有効にすると `store.bin` の暗号文になります。',

  accountTitle: 'アカウント',
  accountNotLoggedIn: '未ログインです。「概要」ページからログインしてください。',
  accountNote:
    '保存されるのは**セッション情報**のみ（Windows DPAPI で暗号化、現在のアカウントに紐付け）で、**パスワードは決して保存しません**。ログアウトするとローカルのセッションも削除されます。',
  openDataDirButton: 'データフォルダを開く',

  devToolsTitle: '開発ツール（開発モードのみ表示、パッケージ後は消えます）',
  devToolsNote:
    '「実際に自己紹介が変わる」のを待つのは大変なため、ここでテストデータを注入して画面とデータ経路を確認できます。注入した記録には印が付き、一括削除と副作用の巻き戻しができます。',
  injectBio: '自己紹介の変更を注入',
  injectAdd: '「フレンド追加」を注入',
  injectRemove: '「フレンド解除」を注入',

  envTitle: '環境チェック',
  envElectron: 'Electron',
  envChromium: 'Chromium',
  envMode: '実行モード',
  envModeDev: '開発（ホットリロード有効）',
  envModeProd: 'パッケージ済み',
  envCredential: '認証情報の暗号化',
  envCredentialOk: '利用可（Windows DPAPI）',
  envCredentialBad: '⚠ 利用不可。セッションを保存できません',

  startupErrorTitle: '起動時の自己診断に失敗',
  bridgeMissingError:
    'Electron の preload ブリッジ（window.vrcbw）が見つかりません。ブラウザで直接開くのではなく、scripts\\dev.ps1 から起動してください。',

  scanListing: 'フレンドリストを取得しています…',
  scanListingCount: '全 {total} 人。並べ替え用にアクティブ日時を取得しています…',
  scanScanning: '{index}/{total} 人目を確認中…',
  scanStopped: '停止しました（{done}/{total} 件を確認済み）。進捗は保存されています。',
  scanDoneNoChange: 'スキャン完了：{done} 人を確認、変更はありませんでした（通常どおりです）',
  scanDoneChanges: 'スキャン完了：{done} 人を確認、{found} 件の変更を検出しました',
  scanRateLimited:
    'レート制限（429）を受けたため、即座に今回のスキャンを中断しました。これは意図的な安全策であり、不具合ではありません。確認済みの {done} 人の進捗は保存されています。アカウント保護のため、次の {hours} 時間は新しいスキャンを開始しません。',
  scanManualTooSoon:
    '前回のスキャンから {hours} 時間経過していません。手動スキャンまで約 {minutes} 分お待ちください。（自動スキャンはこの制限を受けません）',
  scanAutoStarted: '自動スキャンの時刻になりました。自動で開始します…',
  scanAbnormalEnd: 'スキャンに失敗しました：{message}',
  scanNotLoggedIn: '先にログインしてください',
  scanCooldown:
    '前回 VRChat のレート制限を受けたため、アカウント保護のためあと約 {minutes} 分（{hours} 時間のクールダウン）お待ちください。',
  scanAlreadyRunning: 'スキャンがすでに実行中です',
  scanFriendsFailed: 'フレンドリストの取得に失敗しました：{error}',
  scanEmptyFriends: 'フレンドが 0 人のため、確認する対象がありません',
  scanSessionExpired: 'ログイン状態が無効になり、スキャンを中断しました。再度ログインしてください。',
  scanTooManyFailures:
    '連続 {limit} 回のリクエストが失敗しました（{done}/{total} 確認済み）。これ以上のリクエストを避けるため、スキャンを中断しました。',
  scanDoneMostlyFailed:
    '⚠ 今回は {total} 人中 {done} 人しか確認できませんでした（スキップ {skipped} 人）—— **結果は信頼できません**。「変更なし」と見なさないでください。VRChat のサービスかネットワークに問題がある可能性があります。',
  scanRelationSkipped:
    '取得したフレンドリストが矛盾していたため、今回の「フレンド解除」判定をスキップしました（誤った記録を防ぐため）。',
  scanInterrupted:
    '前回のスキャンは**最後まで完了せず中断されました**（進捗 {done}/{total} 人）。プロフィールは取得のたびに保存されるため、その分は既に一覧に反映されています。ただし「前回のスキャン時刻」と「変更数」は最後まで完走した時にだけ書き込まれるため、**表示は前回完了したスキャンのまま**です。今すぐ再スキャンして補完することをおすすめします。',

  warningTitle: '前回のスキャンで問題が発生しました',
  warningDismiss: '閉じる',
  warningAt: '発生時刻：{time}',

  updateAvailable: '新しいバージョン {version}',
  updateAvailableTitle: '新しいバージョン {version} があります —— クリックで GitHub のリリースページを開きます',

  firstRunTitle: 'まだデータがありません',
  firstRunIntro:
    'このツールはフレンドの自己紹介と名前を定期的に取得し、変更を記録します。\n**最初の 1 回は手動でスキャン**して基準を作る必要があります —— 自動スキャンはその後から始まります。',
  firstRunPacing:
    'スキャンの間隔（意図的に保守的にしています。短くしないでください）：\n· フレンド 1 人につき **{seconds} 秒**の間隔（スキャン中は速くできません）\n· 自動スキャンは **{autoHours} 時間**ごと（前回のスキャン**完了**時刻から起算）\n· 手動スキャンは最短 **{manualHours} 時間**間隔\n· レート制限（429）を検出したら即中断し、**{cooldownHours} 時間**クールダウン',
  firstRunRisk:
    '⚠ **リスクについて**：VRChat はレート制限のしきい値を公表していません。本ツールは最も保守的な設定にしていますが、**アカウントが一時制限または停止される可能性は残ります**。ご自身の判断でご利用ください。',
  firstRunNote:
    'データはあなたの PC にのみ保存され、パスワードがディスクに書かれることはありません。',
  firstRunStart: '最初のスキャンを開始',
  statNoData: 'データなし。最初は手動でスキャンしてください',
}

const en: Record<TKey, string> = {
  navOverview: 'Overview',
  navFriends: 'Friends list',
  navTimeline: 'Changes',
  navSettings: 'Settings',
  hintOverview: 'Sign-in, scanning, recent changes',
  hintFriends: 'Full friend list with sorting and search',
  hintTimeline: 'Timeline of every profile change',
  hintSettings: 'Scan pacing, appearance, data, account',
  // --- 侧栏统计 ---
  sideSessionChanges: 'Latest changes',
  sideTotalChanges: 'Total changes',
  notLoggedIn: 'Not signed in',
  loggedIn: 'Signed in',

  scanning: 'Scanning',
  loadingSession: 'Restoring your session…',
  lastScanAt: 'Last scan: {time}',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',

  statNextAutoScan: 'Next auto scan',

  emptyText: '(empty)',
  noneText: '(none)',
  close: 'Close',
  reset: 'Reset',
  labelOld: 'Old',
  labelNew: 'New',

  loginStatusTitle: 'Login status',
  signedInAs: 'Signed in as {name}',
  userIdLabel: 'User ID',
  logoutButton: 'Sign out',
  twoFactorTitle: 'Two-factor authentication',
  twoFactorHint: 'This account has 2FA enabled. Available methods: {methods}',
  twoFactorUnknown: 'not reported',
  twoFactorTotp: '6-digit code from your authenticator app',
  twoFactorEmailOtp: 'Code sent to your email',
  twoFactorOtp: 'Recovery code',
  codeLabel: 'Code',
  codePlaceholder: '6-digit code or recovery code',
  submitCodeButton: 'Submit code',
  verifyingButton: 'Verifying…',
  backButton: 'Back',
  loginTitle: 'Sign in to VRChat',
  usernameLabel: 'Username / email',
  usernamePlaceholder: 'Your VRChat username or email',
  passwordLabel: 'Password',
  passwordPlaceholder: 'Never written to disk',
  loginButton: 'Sign in',
  loggingInButton: 'Signing in…',
  passwordNote:
    '**Your password is never stored** — it is used once for this login. What gets saved afterwards is the **session credential**, protected by Windows encryption (DPAPI, bound to your current account), so you do not have to sign in again next time.',

  scanTitle: 'Scan',
  startFirstScan: 'Start first scan',
  scanNow: 'Scan now',
  scanningButton: 'Scanning…',
  stopButton: 'Stop',
  loginFirstHint: 'Please sign in before scanning.',
  statScannedFriends: 'Friends at last scan',
  statScannedChanges: 'Changes at last scan',
  statTotalChanges: 'Total changes',
  statLastScan: 'Last scan',
  recentChangesTitle: 'Latest 10 changes',
  viewAll: 'View all ({n})',
  emptyChangesLine1: 'No changes recorded yet.',
  emptyChangesLine2:
    'The first scan only builds a baseline and records nothing. After that, entries appear only when a friend actually edits their profile or a friendship changes. **“No changes” is the normal case.**',
  simNote: 'There are {n} simulated records; you can clear them on the Changes page.',

  friendsTitle: 'Friends',
  searchPlaceholder: 'Search name or bio…',
  noFriendData: 'No friend data yet. Go to Overview and click “Start first scan”.',
  colFriendNumber: 'No.',
  colDisplayName: 'Name',
  colBio: 'Bio',
  colBioHint: 'Hover to see the full text; this column grows with the window width',
  colLastChanged: 'Last changed',
  colLastChangedHint: 'When a change was last detected',
  badgeRemoved: 'Removed',

  changesTitle: 'Changes',
  filterAll: 'All',
  filterDisplayName: 'Name changes',
  filterBio: 'Bio changes',
  filterRelation: 'Friendship',
  clearTestChip: 'Clear {n} simulated records',
  clearTestButton: 'Clear simulated records ({n})',
  filterEmpty: 'Nothing matches this filter — click “All”.',
  tagTest: 'sim',
  clickForDetail: 'Click to open this friend’s details (local data only, no API request)',
  expandHint: 'Expand',
  collapseHint: 'Collapse',
  relationAdded: '🟢 Became friends (or was re-added)',
  relationRemoved: '🔴 Friendship ended (or the account was deleted / renamed)',
  relationRemovedShort: '🔴 Friendship ended (possibly account deleted)',

  pageSummary: '{total} total · page {page}/{pages}',
  firstPage: 'First',
  prevPage: 'Prev',
  nextPage: 'Next',
  lastPage: 'Last',
  perPage: 'Per page',
  perPageUnit: '',
  perPageAuto: 'Auto',
  pageJump: 'Go to',
  pageJumpUnit: '',
  autoPageHint: 'Auto = fits the window height without a scrollbar ({n} rows right now)',
  scanTimeSuffix: ' (scan time)',
  dataSourceNote:
    '**Every change here was found by a periodic scan, not pushed in real time** — this differs from VRCX. VRChat removed bios from the WebSocket payload in v1.21.0 (which is why VRCX gave up on its “bio changes” feature), so bios can only be obtained by polling.\nThe timestamps you see are therefore **the time of the scan that discovered the change**, which may lag the actual edit by up to one scan cycle (10 hours by default). This tool is **built for watching bio changes**, not for monitoring friend activity.',

  drawerCurrentBio: 'Current bio',
  noBio: '(no bio)',
  drawerBioLinks: 'Bio links',
  drawerInfo: 'Profile information',
  labelFirstSeen: 'First seen',
  labelLastChecked: 'Last checked',
  labelLastChanged: 'Last changed',
  labelChangeCount: 'Change count',
  drawerHistory: 'Last 5 change records ({n} in total)',
  drawerNoHistory: 'No changes detected for this friend yet.',

  fieldDisplayName: 'Name',
  fieldBio: 'Bio',
  fieldBioLinks: 'Bio links',
  fieldFriendAdded: 'Friend added',
  fieldFriendRemoved: 'Friend removed',

  riskLastLimited: 'Last rate limit: {time} (cooldown has ended)',
  riskNeverLimited: 'No rate limit has been triggered so far.',
  riskReportNote:
    '⚠ **If you ever hit a 429 (rate limit) while using this tool**, please report it on the project’s GitHub repository and **consider stopping use of the tool**: it means the current request pacing is too fast for your account and the parameters need to be re-evaluated before continuing.',
  logNote:
    'The program records the full details of every scan: account, friend count, request pacing, skipped count, change count, and every 429. Please include those logs when reporting an issue.',

  pacingTitle: 'Scan pacing and account safety',
  scanEstimate:
    'You have **{count}** friends. With a **{seconds}-second** gap between each, one full pass takes about **{minutes} minutes**.',
  scanLongWarning:
    'The more friends you have, the longer one pass takes — and that is **deliberate**. VRChat has never published its rate-limit (429) threshold, so spreading requests out and lengthening the gap is how we avoid tripping it (which can lead to a temporary restriction or even a suspension).',
  scanScheduleNote:
    '**Automatic scans**: every **{hours} hours**, timed from the moment a scan *completes*. If that interval has already elapsed when you launch the app, it scans once automatically.\n**Manual scans**: at most once every **{manualHours} hours**, also timed from completion.',
  scanRateLimitNote:
    'A single rate limit (429) **aborts the current scan immediately** and forces a **{cooldownHours}-hour cooldown**. The cooldown is stored in the data file, so restarting the app does not bypass it.',
  manualWaitNote: 'About {minutes} more minutes until you can scan manually.',
  nextAutoScanNote: 'Next automatic scan: {time}',
  nextAutoScanNone: 'Next automatic scan: timed after the first completed scan',

  // --- Startup and shutdown ---
  startupTitle: 'Preferences',
  autoLaunchLabel: 'Start automatically when Windows starts',
  startMinimizedLabel: 'Minimize to the tray when Windows starts',
  minimizeToTrayLabel: 'Minimize to the system tray when the window is closed',
  minimizeToTrayHint:
    '(On by default. If you turn this off, closing the window will quit the program and stop scanning.)',
  gpuAccelLabel: 'Enable GPU acceleration',
  gpuAccelHint:
    '(On by default. If the UI looks wrong, try turning this off. Restart required.)',

  // --- About page ---
  navAbout: 'About',
  hintAbout: 'Version, updates, feedback, legal notice and licenses',
  aboutVersionTitle: 'Version information',
  aboutAppVersion: 'App version',
  aboutGithubTitle: 'Project page and feedback',
  aboutCheckUpdate: 'Check for updates',
  aboutChecking: 'Checking…',
  aboutUpToDate: 'You are up to date ({version})',
  aboutUpdateAvailable: 'New version available: **{latest}** (current {current})',
  aboutUpdateFailed: 'Update check failed: {error}',
  aboutChangelogButton: 'View changelog',
  aboutLicenseTitle: 'Open-source licenses',
  aboutLicenseNote:
    'This project uses the following open-source software, with thanks. The full license text of each project is available in its repository; the complete Chromium / Node.js license files bundled by Electron ship with the installer.',
  aboutLegalTitle: 'Legal notice',
  aboutLegalText:
    legal('{app} is a companion application for viewing changes to VRChat friends’ profiles (bio, display name and bio links). It uses the unofficial VRChat API (VRCSDK).\n\n{app} is not endorsed by VRChat and does not reflect the views or opinions of VRChat or anyone officially involved in producing or managing VRChat. VRChat is a trademark of VRChat Inc. VRChat © VRChat Inc.\n\nVRChat has never published its API rate-limit (429) threshold. Hitting a rate limit can lead to your account being temporarily restricted or even suspended. This program is designed with a conservative pace, and the author never hit a rate limit during testing — but that is not a guarantee that it cannot happen. Please decide for yourself whether to use this tool.\n\nKobayashiSouryuu and all contributors to this project accept no responsibility for any problems caused by using {app}. Use at your own risk!'),
  aboutLicenseChromium:
    '**This project** is released under MIT, **Chromium** is BSD-3-Clause and **Node.js** is MIT; the latter two bundle hundreds of third-party components under their own licenses. **The complete license texts ship with the installer**, all in the install folder: `LICENSE` (this project), `LICENSE.electron.txt` (Electron and Node.js) and `LICENSES.chromium.html` (every Chromium third-party license, ~20 MB).',
  aboutAiTitle: 'AI assistance disclosure',
  aboutAiText:
    'This project’s code was developed with the assistance of an AI assistant (DeepSeek). Design decisions and testing were reviewed by the human author.**Authorship and copyright belong to the human author**',

  // --- Feedback and contact ---
  githubLabel: 'GitHub repository',
  openGithubButton: 'Open project page',
  feedbackButton: 'Send feedback…',

  feedbackDialogTitle: 'Send feedback',
  feedbackProblemLabel: 'Describe the problem you ran into',
  feedbackProblemPlaceholder:
    'e.g. the scan stopped around friend 100 / the diff looks wrong / the window froze…',
  feedbackDiagnosticsLabel: 'Diagnostic information that will be sent (please review; editable)',
  feedbackPrivacyNote:
    'The text above is sent **verbatim**; it includes your account name and friend count. You can delete or edit anything before sending.',
  feedbackProblemHeading: '--- Problem description ---',
  feedbackNoProblem: '(no problem description provided)',
  feedbackPasteHint:
    'The full log has been copied to your clipboard — please paste it here (URL length limits cannot hold the whole log).',
  copyDiagnosticsButton: 'Copy diagnostics',
  copiedHint: 'Copied to clipboard',
  sendViaGithub: 'Report on GitHub',
  feedbackGithubHint:
    'Opens a pre-filled new issue in your browser; **the full log is already on your clipboard**, so paste it in.',

  encryptLabel: 'Encrypt local data',
  encryptNote:
    'Off by **default**. What genuinely needs protecting is the session credential, and that is already encrypted separately with Windows DPAPI; friend bios are semi-public, and keeping them in plain text lets you inspect, back up and troubleshoot them yourself.\nTurning this on rewrites the data as ciphertext immediately. It becomes bound to **your current Windows account**: another machine or user cannot decrypt it, and you can no longer read it in Notepad.',
  encryptUnavailable: '⚠ DPAPI encryption is unavailable on this system, so this cannot be enabled',
  encryptOn: 'On (ciphertext)',
  encryptOff: 'Off (plain JSON)',
  accountScopedNote:
    'Each account’s data is stored in its own folder. After signing out nothing is shown, and signing in with another account never reveals the previous account’s records.',

  appearanceTitle: 'Appearance',
  themeLabel: 'Theme',
  languageLabel: 'Language',
  fontLabel: 'Custom font',
  fontPlaceholder: 'Empty = default font',
  fontHint: '(Enter a valid CSS font name; falls back to the default if missing)',
  fontApplied: 'Applied',
  fontMissing: '⚠ “{name}” was not found on this system; using the default font',
  fontScaleLabel: 'Font scale',
  pageSizeLabel: 'Rows per page',
  pageSizeNote: 'rows (10–500, shared by the friend list and the change log)',
  pageSizeAutoLabel: 'Automatic rows per page in the friend list',
  pageSizeAutoChangesLabel: 'Automatic rows per page in the change log',
  pageSizeAutoNote:
    'Auto = computed from the window height so that no scrollbar appears. Uncheck to enter a fixed number.',
  showRemovedLabel: 'Show removed friends in the friend list',
  showRemovedNote:
    'Off by default: once someone is no longer a friend they are hidden. The history is still kept (visible in the change log).',

  dataTitle: 'Data',
  dataDirLabel: 'Data location',
  dataDirDefaultLabel: 'Default location',
  dataDirAccountLabel: 'Data folder for this account',
  dataDirSettingsLabel: 'Settings and credential location',
  changeDataDirButton: 'Change data location…',
  resetDataDirButton: 'Restore default location',
  dataDirMoving: 'Moving…',
  dataDirMoved: 'Move complete: {files} files ({bytes}).',
  dataNote:
    'Each account gets its own subfolder; `store.json` inside it holds everything for that account (profiles, change events, scan cursor). With encryption enabled it becomes the ciphertext `store.bin`.',

  accountTitle: 'Account',
  accountNotLoggedIn: 'Not signed in. Please sign in from the Overview page.',
  accountNote:
    'Only the **session credential** is stored (encrypted with Windows DPAPI, bound to your current account); **the password is never written to disk**. Signing out also clears the local session.',
  openDataDirButton: 'Open data folder',

  devToolsTitle: 'Developer tools (dev mode only; gone once packaged)',
  devToolsNote:
    'Waiting for a friend to actually edit their bio can take a long time, so you can inject simulated data here to exercise the UI and the data path. Injected records are marked and can be cleared in one click, reverting their side effects.',
  injectBio: 'Inject simulated bio change',
  injectAdd: 'Inject simulated “friend added”',
  injectRemove: 'Inject simulated “friend removed”',

  envTitle: 'Environment check',
  envElectron: 'Electron',
  envChromium: 'Chromium',
  envMode: 'Run mode',
  envModeDev: 'Development (hot reload enabled)',
  envModeProd: 'Packaged',
  envCredential: 'Credential encryption',
  envCredentialOk: 'Available (Windows DPAPI)',
  envCredentialBad: '⚠ Unavailable; the session cannot be saved',

  startupErrorTitle: 'Startup self-check failed',
  bridgeMissingError:
    'The Electron preload bridge (window.vrcbw) was not found. Start the app via scripts\\dev.ps1 instead of opening the page in a browser.',

  loginPageTitle: APP_NAME,
  loginPageSubtitle: 'Sign in to see friend profiles and change history',
  loginPageFeature1: 'Periodically fetches bios, names and bio links',
  loginPageFeature2: 'Records every change and shows a character-level diff',
  loginPageFeature3: 'Keeps each account’s data separate and private',
  loginPagePrivacy:
    '**Your password is never stored** — it is used once at sign-in. What gets saved is the session credential, protected by Windows encryption (DPAPI).',

  scanListing: 'Fetching the friend list…',
  scanListingCount: '{total} friends in total; fetching activity times for ordering…',
  scanScanning: 'Checking friend {index}/{total}…',
  scanStopped: 'Stopped as requested ({done}/{total} checked). Progress has been saved.',
  scanDoneNoChange: 'Scan finished: {done} friends checked, no changes found (this is normal)',
  scanDoneChanges: 'Scan finished: {done} friends checked, {found} changes found',
  scanRateLimited:
    'Received a rate limit (429), so this scan was aborted immediately — that is a deliberate safety measure, not a malfunction. Progress for the {done} friends already checked has been saved. To protect your account, no new scan will start for {hours} hours.',
  scanManualTooSoon:
    'It has been less than {hours} hours since the last scan; about {minutes} more minutes until a manual scan is allowed. (Automatic scans are not affected.)',
  scanAutoStarted: 'The automatic scan is due — starting it now…',
  scanAbnormalEnd: 'Scan failed: {message}',
  scanNotLoggedIn: 'Please sign in before scanning',
  scanCooldown:
    'A VRChat rate limit was triggered earlier. To protect your account, please wait about {minutes} more minutes ({hours}-hour cooldown).',
  scanAlreadyRunning: 'A scan is already running',
  scanFriendsFailed: 'Failed to fetch the friend list: {error}',
  scanEmptyFriends: 'The friend list is empty; nothing to scan',
  scanSessionExpired:
    'Your session has expired, so the scan was interrupted. Please sign in again.',
  scanTooManyFailures:
    '{limit} requests failed in a row ({done}/{total} checked). The scan was stopped on purpose to avoid sending more requests.',
  scanDoneMostlyFailed:
    '⚠ Only {done}/{total} friends could be checked this round ({skipped} skipped) — **the result is not trustworthy** and must not be read as “no changes”. VRChat’s service or your network may be having problems.',
  scanRelationSkipped:
    'The friend list we received was self-contradictory, so the “friendship ended” check was skipped for this round to avoid creating false records.',
  scanInterrupted:
    'The previous scan was **interrupted before it finished** (progress {done}/{total} friends). Profiles are saved as they are fetched, so that partial data is already in the list — but “last scan time” and the change count are only written when a scan runs to completion, so those still show the **last complete scan**. Re-scanning now is recommended to fill the gap.',

  warningTitle: 'The last scan had a problem',
  warningDismiss: 'Dismiss',
  warningAt: 'Happened at: {time}',

  updateAvailable: 'Version {version} available',
  updateAvailableTitle: 'Version {version} is available — click to open the GitHub release page',

  firstRunTitle: 'No data yet',
  firstRunIntro:
    'This tool periodically fetches your friends’ bios and names and records every change.\n**The very first scan has to be started manually** to build the baseline — automatic scanning only begins after that.',
  firstRunPacing:
    'Scan pacing (deliberately conservative — please don’t try to make it faster):\n· A fixed **{seconds}-second** gap between friends; it cannot go faster mid-scan\n· Automatic scanning every **{autoHours} hours** (timed from when the previous scan **finished**)\n· Manual scans at most once every **{manualHours} hours**\n· On a rate limit (429) it stops immediately and cools down for **{cooldownHours} hours**',
  firstRunRisk:
    '⚠ **Risk notice**: VRChat has never published its rate-limit threshold. This tool is built to be as conservative as possible, but **a risk of your account being temporarily restricted or suspended still exists**. Please decide for yourself whether to use it.',
  firstRunNote: 'All data stays on your own computer, and the password is never written to disk.',
  firstRunStart: 'Start the first scan',
  statNoData: 'No data — please run the first scan manually',
}

const DICT: Record<Lang, Record<TKey, string>> = { zh, ja, en }

export type TParams = Record<string, string | number>

/** 取一条文案，并把 {name} 这样的占位符替换掉 */
export function translate(lang: Lang, key: TKey, params?: TParams): string {
  const raw = DICT[lang][key] ?? DICT.zh[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  )
}

export interface I18n {
  t: (key: TKey, params?: TParams) => string
  lang: Lang
  /** 传给 toLocaleString 的 locale */
  locale: string
}

export const I18nContext = createContext<I18n>({
  t: (key, params) => translate('zh', key, params),
  lang: 'zh',
  locale: LOCALES.zh,
})

export function useI18n(): I18n {
  return useContext(I18nContext)
}

/**
 * 扫描状态代码 → 文案键。
 *
 * 写成显式的映射表而不是拼字符串，是为了让编译器检查：
 * 少一个代码、或者写错键名，都会在类型检查阶段报错。
 */
const SCAN_MSG_KEYS: Record<ScanMessageCode, TKey> = {
  listing: 'scanListing',
  listingCount: 'scanListingCount',
  scanning: 'scanScanning',
  stopped: 'scanStopped',
  doneNoChange: 'scanDoneNoChange',
  doneChanges: 'scanDoneChanges',
  rateLimited: 'scanRateLimited',
  manualTooSoon: 'scanManualTooSoon',
  autoScanStarted: 'scanAutoStarted',
  abnormalEnd: 'scanAbnormalEnd',
  notLoggedIn: 'scanNotLoggedIn',
  cooldown: 'scanCooldown',
  alreadyRunning: 'scanAlreadyRunning',
  friendsFailed: 'scanFriendsFailed',
  emptyFriends: 'scanEmptyFriends',
  sessionExpired: 'scanSessionExpired',
  tooManyFailures: 'scanTooManyFailures',
  doneMostlyFailed: 'scanDoneMostlyFailed',
  relationCheckSkipped: 'scanRelationSkipped',
  scanInterrupted: 'scanInterrupted',
}

/** 把主进程给的扫描状态渲染成当前语言的文案 */
export function scanMessage(
  progress: Pick<ScanProgress, 'messageCode' | 'messageParams' | 'detail'>,
  i18n: I18n,
): string {
  if (progress.messageCode) {
    return i18n.t(SCAN_MSG_KEYS[progress.messageCode], progress.messageParams)
  }
  return progress.detail ?? ''
}

/** 被跟踪字段 → 文案键（同样是显式映射，漏一个就编译不过） */
const FIELD_KEYS: Record<ChangeField, TKey> = {
  displayName: 'fieldDisplayName',
  bio: 'fieldBio',
  bioLinks: 'fieldBioLinks',
  friendAdded: 'fieldFriendAdded',
  friendRemoved: 'fieldFriendRemoved',
}

export function fieldLabelKey(field: ChangeField): TKey {
  return FIELD_KEYS[field]
}

/**
 * 两步验证方式 → 文案键。
 * VRChat 返回的方式是字符串，可能有我们没见过的值，所以返回可空、由调用方兜底。
 */
const TWO_FACTOR_KEYS: Record<string, TKey> = {
  totp: 'twoFactorTotp',
  emailOtp: 'twoFactorEmailOtp',
  otp: 'twoFactorOtp',
}

export function twoFactorLabelKey(method: string): TKey | null {
  return TWO_FACTOR_KEYS[method] ?? null
}

/**
 * 把 `**粗体**` 和 `` `等宽` `` 渲染成 React 节点。
 *
 * ⚠ 刻意不用 dangerouslySetInnerHTML：文案是数据，一旦用 HTML 解析就多了一类
 *   注入面（而且翻译文件是最不该被当成代码执行的东西）。这里只做两种标记的
 *   纯文本切分，产出的是 React 元素。
 */
export function rich(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) out.push(<b key={i++}>{m[1]}</b>)
    else if (m[2] !== undefined) out.push(<span className="mono" key={i++}>{m[2]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
