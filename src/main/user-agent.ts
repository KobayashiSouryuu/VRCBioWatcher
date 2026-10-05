import { app } from 'electron'
import { PROJECT_URL } from '../shared/project'

/**
 * 调用 VRChat API 用的 User-Agent —— **全项目唯一定义处**。
 *
 * ⚠ 这个字符串的结构是被 VRChat 的 WAF 实测约束出来的，不要「简化」：
 *   必须以 Mozilla/5.0 开头，且包含完整的
 *   `AppleWebKit/537.36 (KHTML, like Gecko)` … `Chrome/<版本>` … `Safari/537.36` 签名。
 *   纯 `AppName/版本 (邮箱)` 形式的 UA 会被 403 拒绝，而且返回的报错信息是误导性的
 *   （它会说「请提供格式正确的 UA」，即使格式正是它要求的）。
 *   详见 docs/DECISIONS.md 第 2.5 节。
 *
 * 联系方式用 URL 而不是邮箱：实测带邮箱的写法不稳定。
 * 这里用的是**真实仓库地址**（`src/shared/project.ts`）——
 * 这个字段存在的意义就是让 VRChat 能联系到开发者。填一个假地址等于把这条路堵死，
 * 而对方联系不上你时的替代方案通常只有直接限制账号。
 *
 * Chrome 版本号取自 Electron 实际使用的 Chromium（process.versions.chrome），
 * 这样 UA 始终是诚实的 —— 我们本来就是 Chromium，Electron 升级时版本号会自动跟上。
 */
const CONTACT_URL = PROJECT_URL

export function buildUserAgent(): string {
  return (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    `VRCBW/${app.getVersion()} (+${CONTACT_URL}) ` +
    `Chrome/${process.versions.chrome} Safari/537.36`
  )
}
