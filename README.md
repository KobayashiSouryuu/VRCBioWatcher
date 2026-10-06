# VRCBioWatcher

> 定期抓取 VRChat 好友的**简介 / 昵称 / 简介链接**，记录每一次变化，并展示**段落级**的新旧差异。

一个 Windows 桌面小工具。用 Electron + React + TypeScript 写的，数据全部保存在本地。

<p align="center">
  <a href="#-风险提示请先读这一段">风险提示</a> ·
  <a href="#为什么做这个">为什么做这个</a> ·
  <a href="#功能">功能</a> ·
  <a href="#工作原理">工作原理</a> ·
  <a href="#安装与使用">安装与使用</a> ·
  <a href="#常见问题">常见问题</a>
</p>

---

## ⚠ 风险提示（请先读这一段）

**VRChat 从未公布 API 的限流（429）阈值**，社区也没有可靠的实测数据。
官方 FAQ 的原文意思是：429 无法预测；**不要发送重复的、不计量的请求**；
**无视 429 可能导致更长的限流，甚至账号封停**。

本工具是按「尽量温和」设计的：

- 每个好友之间**固定间隔 3 秒**，匀速、不分批（突发请求正是限流器最容易打爆的形态）
- **一见 429 立刻中断整轮扫描**，不重试、不跳过，并进入 **10 小时**强制冷却
- 自动扫描每 **10 小时**一次；手动扫描最快每 **2 小时**一次

**但即便如此，如果触发了限流，则存在账号被临时限制甚至封停的风险。但作者本人用作者自己的账号测试目前没有出现过限流问题。** 请自行判断是否使用。

> **如果你在使用中触发了 429**，请到 [GitHub Issues](https://github.com/KobayashiSouryuu/VRCBioWatcher/issues)
> 反馈情况，并**建议暂时停止使用** —— 那说明当前的请求节奏对你的账号来说偏快。

**另外：不要把你的数据目录或 `session.bin` 分享给任何人** —— 那里面等于你的登录态。

**安装或解压时，Windows 可能会拦一下，说「Windows 已保护你的电脑」或者「不建议运行」** ——
这不是因为程序有问题，而是因为**作者没有购买代码签名证书**（那要每年向微软认可的证书机构
交一笔钱，个人免费项目不划算），所以 Windows 无法验证"这个文件是谁发布的"，
对一切未签名的下载文件它都这么提示。它提示的是「**未知发布者**」，不是「检测到病毒」。

- **安装包**：点「更多信息 → 仍要运行」即可
- **zip 绿色版**：点「确定」即可

> 这个项目是完全开源的，你可以自行审阅源码、自行构建（见下面的「从源码运行」），
> 不需要相信作者的二进制文件。

---

## 为什么做这个

VRC 在 **API v1.21.0** 里把 `bio` / `bioLinks` 从 **WebSocket 推送**中移除了
（官方维护者原话：*"Bio was removed from the websocket, and thus, are no longer able to
detect bio changes."*）。

**VRCX 因此把「Feed Bio Changes」判定为「不可修复」并放弃了这个功能。**
同时 bio 也从 `/users/` 移到了 `/profile/`，不能再按 bio 搜索用户。

这个工具就是来补这个缺口的：**既然推送里没有简介，那就定期轮询 `/profile/`，把每次结果留档并对比。**

| | VRCX | 本工具 |
|---|---|---|
| 好友管理 / 动态 / 世界信息 | ✅ 功能齐全 | ❌ 不做 |
| 好友简介变化 | ❌ 判定不可修复 | ✅ **专注做这一件事** |
| 加/删好友、改昵称 | ✅ **实时**（WebSocket 广播） | ⚠️ 靠定期扫描发现（见下） |

---

## 功能

- **好友列表**：序号（VRChat 的好友顺序）、昵称、简介、最近变化；可排序、搜索、分页
- **变化记录**：按时间倒序，可按「昵称变更 / 简介变更 / 好友变更」筛选
- **段落级差异**：整段标红（旧）/ 标绿（新），未变化的段落不着色
- **好友详情抽屉**：当前简介全文 + 最近 5 次变化历史
- **定时扫描**：每 10 小时一次（从扫描**完成**时刻计时），首次使用必须先手动扫描一次才会自动开启定时扫描功能，非首次使用打开软件时若已超过 10 小时则会直接自动扫描
- **加/删好友检测**：由扫描比对好友名单得出
- **系统托盘**：关窗口收进托盘继续后台运行；可选「关闭即退出」
- **多语言**：中文 / 日本語 / English，首次运行按系统语言自动选择
- **账号隔离**：每个账号一份独立数据；退出登录后界面上不显示任何数据
- **数据目录可迁移**：不喜欢放 C 盘可以改，迁移带校验（复制 → 校验 → 才删旧）
- **可选加密**：开启后用 Windows DPAPI 加密本地数据
- **诊断与反馈**：一键生成含最近日志的诊断信息，用来提 issue

## 工作原理

```
登录（账号密码 → auth cookie，密码不落盘）
        │
        ▼
每 10 小时一轮扫描（可手动触发，最快 2 小时一次）
        │
        ├─ GET /auth/user            → 好友名单 + 在线/活跃/离线分类
        ├─ GET /auth/user/friends?offline=true → 离线好友的最近活跃时间（用于排序）
        └─ 逐个 GET /profile/{id}     → 昵称 / 简介 / 简介链接
                  ↑ 每个好友之间固定间隔 3 秒
        │
        ▼
与上次结果比对 → 有变化就写一条事件 → 界面上按段落展示差异
```

**扫描顺序**：先扫正在线/活跃的好友（最可能刚改过资料），再扫离线好友（按最近活跃排序）。

**首次扫描只建立基线，不产生任何变化记录** —— 否则第一轮会塞进几百条噪音。

### ⚠ 关于时间：显示的是「扫描时间」

因为简介只能靠**轮询**发现，界面上每条记录的时间是**发现它的那次扫描的时间**，
**不是对方修改简介的时间** —— 最多可能相差一个扫描周期（默认 10 小时）。界面上已明确标注。

---

## 安装与使用

### 环境要求

- Windows 10 / 11
- [Node.js](https://nodejs.org/) 20.19+ 或 22.12+（仅从源码运行需要）

### 从源码运行

```bash
git clone https://github.com/KobayashiSouryuu/VRCBioWatcher.git
cd VRCBioWatcher
npm install
npm run dev
```

> **受限环境（例如工作区目录有特殊 ACL、或 npm 缓存不能写到用户目录）**：
> 仓库里提供了两个 PowerShell 辅助脚本：
> `powershell -ExecutionPolicy Bypass -File scripts\install-deps.ps1`（安装依赖，含缓存与
> Electron 二进制校验/修复）与 `powershell -ExecutionPolicy Bypass -File scripts\dev.ps1`（启动）。
> 这两个脚本只做环境适配，不做别的事。

### 打包成 Windows 程序

```bash
npm run pack   # 只生成免安装目录 → release\win-unpacked\（最快，自测用）
npm run dist   # 安装程序 + 绿色版 zip → release\
```
> 网络访问 GitHub 有困难的话（比如中国大陆）请改用 `scripts\dist.ps1`

产物：

| 文件 | 说明 |
|---|---|
| `VRCBioWatcher-<版本号>-setup.exe` | NSIS 安装程序。装到 `C:\Program Files\VRCBioWatcher`，**安装时会弹一次 UAC**（装到 Program Files 的必要代价）。卸载时**不会删除你的数据** |
| `VRCBioWatcher-<版本号>-win.zip` | 绿色版：**解压到一个空文件夹**，运行里面的 `VRCBioWatcher.exe`。不进注册表、不需要管理员 |

> 想改成「装到用户目录、不要 UAC」：把 `electron-builder.yml` 里的 `perMachine` 改成 `false`。
> 那样会多出一个「安装模式选择页」，且安装程序无法强制结束正在运行的应用（见下面的提示）。

**安装前请先从托盘退出正在运行的实例。** 本程序默认「关窗口 = 收进托盘继续运行」，
所以安装程序发来的关闭请求会被它拦下；之后安装程序会尝试强杀进程，
而**非管理员**的安装程序杀不掉它 —— 表现为反复提示「应用无法关闭」，
接着因为文件被占用而写入失败。用 `perMachine: true`（默认配置）时安装程序是管理员，
可以强杀，这个问题基本不会出现。也可以直接命令行优雅退出：

```powershell
& "C:\Program Files\VRCBioWatcher\VRCBioWatcher.exe" --quit
```

**关于打包环境的三件事**（都写在 `scripts/dist.ps1` 的注释里）：

1. **Electron 本体不会被重新下载** —— `electron-builder.yml` 里的 `electronDist` 直接指向
   `node_modules/electron/dist`（开发时已经装好了），所以打包快且不依赖 GitHub。
2. **NSIS 工具链仍要从 GitHub Releases 下载**。如果 `github.com` 不可达，
   `scripts/dist.ps1` 会自动改用 npmmirror 镜像，并把打包缓存与临时目录固定在项目内：

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\dist.ps1
   ```
3. **NSIS 需要可写的 TEMP**。在某些沙箱终端里 `TEMP` 指向一个 makensis 写不进去的目录，
   会报 `!tempfile: Unable to create temporary file!`。脚本会把 `TMP`/`TEMP` 指到项目内解决。

**图标**：`build/icon.png`（512×512 源图）与 `build/icon.ico`（多尺寸 16–256，electron-builder 使用）。
托盘与窗口图标是内嵌的 base64 PNG（见 `src/main/app-icon.ts`），换图标时两处都要更新。

**没有代码签名**：所以 Windows 会提示「未知发布者 / 不建议安装」（SmartScreen）。
个人项目买签名证书不划算，这是正常情况。处理方式很简单 —— **放行一次就行，之后不会再问**：

- **安装包**：点「更多信息 → 仍要运行」
- **zip 绿色版**：双击或右键打开时 Windows 同样会问一次（提示来自"打开这些文件可能对你的计算机有害"），
  **点「确定」放行即可**，后续解压和运行都不会再有提示
  ⚠ 唯一的坑：zip 里的文件**直接躺在压缩包根目录**（没有外层文件夹），
  所以**先新建一个空文件夹再解压进去**，否则 70 多个文件会散落到下载目录里
- 如果安装反复失败，可能是 **Windows Defender 的实时保护锁住了刚写入的文件**
  （典型现象：提示写 `Uninstall ...exe` 失败）。可以先临时关闭实时保护、或重启后再装

> 想彻底消除警告只能买代码签名证书（或使用微软的 Azure Trusted Signing）。

> ⚠ **打包版和开发版共用同一份数据**（`%APPDATA%\vrcbw`，由主进程显式固定）。
> 所以装完之后不需要迁移数据，打开就是原来那些好友和变化记录。

### 首次使用

1. 启动后是**登录页**：填 VRChat 用户名（或邮箱）+ 密码
2. 如果账号启用了两步验证，会要求输入 6 位验证码（支持认证器 / 邮箱验证码 / 恢复码）
3. 登录后点「**开始第一次扫描**」建立基线 —— 耗时举例：200 个好友约需 **10 分钟**
   > **注意：第一次扫描必须手动点**。程序不会在全新账号上自动扫描 ——
   > 这是有意的：让你先读完限流风险与扫描节奏，再自己决定什么时候开始。
4. 之后每 10 小时自动扫描一次；也可以手动点「立即扫描」（最快 2 小时一次）

---

## 数据与隐私

**所有数据都保存在本机，程序不上传任何东西。**

```
%APPDATA%\vrcbw\
├─ settings.json          界面设置（主题、语言、字号、每页条数…）
├─ session.bin            会话凭据（Windows DPAPI 密文，与当前账户绑定）
└─ data\
   └─ <你的账号 id>\
      └─ store.json       该账号的全部数据（好友资料 + 变化事件）
```

- **密码从不写入磁盘**：只在登录时用一次，之后只保存会话凭据
- **账号隔离**：每个账号一个子目录；退出登录后界面上不显示任何数据
- **数据目录可更改**（设置 → 数据），迁移时先完整复制再校验（文件数 + 字节数一致），
  **校验通过才删除旧目录**
- **可选加密**：设置 → 数据 → 加密本地数据（DPAPI）。默认关闭，因为简介属于半公开数据，
  保持明文便于你自己检查与备份；开启后数据与当前 Windows 账户绑定，换机器就解不开

---

## 常见问题

**Q：会被封号吗？**
A：**无法保证不会。** VRChat 从未公布限流阈值，所以任何人都算不出"安全速率"。
本工具的做法是保守 + 一见限流就停，但风险不可能为零。而且即使遇到限流，也并不代表一定会被封号。
详见上面的风险提示。

**Q：为什么扫一轮要十几分钟？**
A：故意的。每个好友间隔 3 秒，好友越多越久。突发请求是限流器最容易打爆的形态，
所以这里选择匀速。界面上会显示预估耗时。
作者判断即使间隔 1 秒扫描一次，也不会出现限流情况，毕竟不是突发 1 秒内请求几十次，但这只是作者个人猜测，为了防止出现问题，仍然采用最保守的请求方法。

**Q：为什么变化的时间不是对方修改的时间？**
A：因为简介不在 WebSocket 推送里，只能靠定期轮询发现。显示的是**扫描时间**。

**Q：VRCX 上能看到好友实时改名/加好友，这里为什么不行？**
A：VRCX 用 WebSocket 广播，本工具没有接入。
这里的关系变化也是靠扫描比对发现的，所以会延迟最多一个扫描周期。

**Q：能看非好友的简介吗？**
A：不能。只扫描你的好友。

**Q：数据放在 C 盘可以改吗？**
A：可以。设置 → 数据 → 更改数据位置。（设置文件和会话凭据会留在 `%APPDATA%`，
因为它们必须待在固定位置，否则程序无法"找到"你设置的数据目录。）

---

## 项目结构

```
src/
├─ main/                     Electron 主进程（只有它能联网和读写文件）
│  ├─ index.ts               窗口、托盘、IPC、调度器、诊断
│  ├─ watcher.ts             扫描器（节奏、比对、变更事件）
│  ├─ settings.ts            设置持久化
│  ├─ log-buffer.ts          日志环形缓冲（反馈时附上）
│  ├─ store/db.ts            数据存储（按账号隔离、可迁移、可选加密）
│  └─ vrchat/                VRChat API 客户端、认证、会话存储
├─ preload/                  contextBridge 白名单（界面只能调这里列出的方法）
├─ renderer/                 React 界面
│  └─ src/
│     ├─ i18n.tsx            中/日/英三语文案（漏翻一条就是编译错误）
│     ├─ diff.ts             段落级差异算法
│     └─ components/ pages/  界面组件
└─ shared/                   主进程与界面共用的类型与常量
docs/DECISIONS.md            设计决策与实测记录（含所有踩过的坑）
```

### 安全基线（不要放宽）

`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、
按模式注入的 CSP、preload 的 `contextBridge` 白名单、单实例锁。

### 开发命令

```bash
npm run dev         # 开发模式（含热更新）
npm run typecheck   # 主进程 + 界面类型检查
npm run build       # 类型检查 + 构建
```

---

## 法律声明

© 2026 KobayashiSouryuu

VRCBioWatcher 是一个用于查看 VRChat 好友资料（简介、昵称、简介链接）变化的辅助应用。
本程序使用了非官方的 VRChat API (VRCSDK)。

VRCBioWatcher 不受 VRChat 的认可，也不反映 VRChat 或者任何正式参与制作或管理 VRChat
的人员/团体的观点或意见。VRChat 是 VRChat Inc. 的商标。VRChat © VRChat Inc.

VRChat 从未公布 API 的限流（429）阈值。触发限流有概率导致账号被临时限制甚至封停，本程序按保守节奏设计，作者自测期间没有出现过限流（429）的情况，但并不能保证一定不会出现，请自行判断是否使用本工具。

KobayashiSouryuu 及本项目的全体贡献者，均不对使用 VRCBioWatcher 引起的任何问题负责。
使用时请自负风险！

## 开源许可

本项目使用以下开源软件，在此致谢：

| 项目 | 许可 |
|---|---|
| [Electron](https://github.com/electron/electron) | MIT License |
| [React](https://github.com/facebook/react) / React DOM | MIT License |
| [Vite](https://github.com/vitejs/vite) / [electron-vite](https://github.com/alex8088/electron-vite) | MIT License |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache License 2.0 |
| Chromium（随 Electron 一并分发） | BSD-3-Clause |
| Node.js（随 Electron 一并分发） | MIT License |

Chromium 与 Node.js 内部还包含**数百个第三方组件**，各有其自己的许可。
**这些许可的完整文本会随安装包一起分发**，都在安装目录下：

| 文件 | 内容 |
|---|---|
| `LICENSE` | 本项目自身（MIT） |
| `LICENSE.electron.txt` | Electron 与 Node.js |
| `LICENSES.chromium.html` | Chromium 内全部第三方组件（约 20MB） |

本项目自身以 **MIT** 许可发布，完整文本见 [LICENSE](LICENSE)。

## 贡献与反馈

- **Bug / 功能建议**：欢迎提 [Issue](https://github.com/KobayashiSouryuu/VRCBioWatcher/issues)
- **提 issue 时请附上诊断信息**：程序里「关于 → 提交反馈」可以一键生成
  （包含环境信息与最近日志，**发送前你可以看到并编辑全部内容**）
- **设计决策记录**：`docs/DECISIONS.md` 里有所有关键取舍与实测数据 ——
  包括 VRChat API 的各种坑、为什么某些参数是现在这个值。想改参数前建议先读它

## AI 协助声明

本项目的代码在 AI 助手（DeepSeek）的协助下开发，设计决策与测试由作者本人把关。**署名与版权归人类作者所有。**

---

## English Summary

**VRCBioWatcher** is a Windows desktop tool that periodically fetches your VRChat
friends' bios, names and bio links, records every change, and shows a **paragraph-level**
diff between the old and new versions.

It exists because VRChat **removed `bio` from the WebSocket payload** in API v1.21.0 —
which is why VRCX declared its "bio changes" feature unfixable. Since bios are no longer
pushed, they can only be obtained by polling `GET /profile/{userId}`, which is exactly
what this tool does.

**⚠ Risk notice**: VRChat has never published its rate-limit (429) threshold, so no one
can compute a "safe rate". This tool is deliberately conservative — a fixed 3-second gap
between friends, and it aborts the whole scan and enters a 10-hour cooldown on the very
first 429 — **but a risk of account restriction or suspension still exists. Use at your own
risk.** All data stays on your machine; the password is never written to disk.

Built with Electron + React + TypeScript. UI available in 中文 / 日本語 / English.
