/**
 * 项目级常量（主进程与界面共用）。
 *
 * ⚠ 这个目录里的代码**不能** import electron 或任何 Node 内置模块，
 *   因为它同时被打进渲染进程（浏览器环境）。
 */

/**
 * 应用名。**软件里任何需要显示名字的地方都必须引用它，不要再手写字符串。**
 *
 * 为什么不直接写死在各处：这个名字改过三次了（VRChat Bio Watcher → VRCBioWatcher），
 * 每改一次就要在十几个文件里找。集中成一个常量后，以后改名只改这一行。
 *
 * ⚠ 注意区分三个"名字"，它们**故意不一样**：
 *   APP_NAME      = VRCBioWatcher  → 给人看的显示名（标题栏、托盘、界面、快捷方式）
 *   package.json 的 name = vrcbw   → npm 包名
 *   %APPDATA%\vrcbw                → 数据目录，**与显示名解耦**（见 main/index.ts 的固定逻辑）
 *   数据目录不改名是为了不让已有数据"消失"。
 */
export const APP_NAME_PREFIX = 'VRC'

/** 显示名里前缀之后的部分（界面单独渲染，配色用） */
export const APP_NAME_BODY = 'BioWatcher'

/** 完整显示名。任何要显示软件名的地方都用它，不要手写字符串。 */
export const APP_NAME = `${APP_NAME_PREFIX}${APP_NAME_BODY}`

/**
 * 项目仓库地址 —— **写死在源码里**。
 *
 * 为什么不做成设置项：它既用于「检查更新」（主进程要拼 GitHub Releases API 地址），
 * 也用于 User-Agent 里的联系方式。这两个地方都不该由最终用户改，
 * 改了只会让更新检查失败。要改这个地址的人直接改这一行。
 */
export const PROJECT_URL = 'https://github.com/KobayashiSouryuu/VRCBioWatcher'



/**
 * 应用标识（AppUserModelID）。
 *
 * ⚠ 必须和 `electron-builder.yml` 里的 `appId` **完全一致**。
 *   Windows 靠它把"通知"和"哪个应用"对应起来：安装程序会把开始菜单快捷方式
 *   标记成这个 ID，主进程也要声明同一个，否则 toast 通知会**静默不显示**
 *   （尤其是 zip 免安装版，没有快捷方式时全靠这个声明）。
 */
export const APP_ID = 'com.kobayashisouryuu.vrcbiowatcher'
