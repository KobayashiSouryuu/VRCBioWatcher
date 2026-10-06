; ---------------------------------------------------------------------------
; VRCBioWatcher 安装程序自定义补丁
;
; 通过 electron-builder 的 nsis.include 引入（见 electron-builder.yml）。
; 里面的 `customInstall` 宏会被 electron-builder 自带的安装脚本在
; "文件解包完成后"调用。
; ---------------------------------------------------------------------------

; ---------------------------------------------------------------------------
; ★ 给安装目录补上 AppContainer 的读取/执行权限
; ---------------------------------------------------------------------------
; 背景（详见 docs/DECISIONS.md 5.8）：
;
;   Windows 上 Chromium 的 GPU 进程和渲染进程跑在 **AppContainer** 沙箱里，
;   而 AppContainer 的访问令牌里有一个众所周知的 SID：
;
;       S-1-15-2-2  (ALL APPLICATION PACKAGES)
;
;   如果安装目录的 ACL 里**没有**这个 SID 的读取/执行权限，Chromium 就
;   创建不出子进程，表现为：
;
;       [ERROR:gpu_process_host.cc] GPU process launch failed: error_code=18
;       [FATAL:gpu_data_manager_impl_private.cc] GPU process isn't usable. Goodbye.
;
;   然后**应用启动即退出**，而报错信息全部指向显卡 —— 极易被误判成
;   "显卡驱动问题"或"软件坏了"。正常安装（Program Files）通常带这条权限，
;   但权限被改动过、或者装到某些自定义目录时会缺失，所以这里主动补一次。
;
; 说明：
;   - `*S-1-15-2-2` 前面的星号表示"这是个 SID，不是账户名"
;   - `(OI)(CI)` = 对象继承 + 容器继承 → **子文件自动继承，不需要 /T 递归**
;     （递归几千个文件会明显拖慢安装，所以故意不加 /T）
;   - `/C` 忽略个别错误，`/Q` 安静模式；整体是**尽力而为**：
;     失败也不该让安装失败（权限已存在时会返回非零，那属于正常情况）
!macro customInstall
  DetailPrint "正在补齐 AppContainer 权限（避免 Chromium 子进程启动失败）..."
  nsExec::ExecToLog 'icacls "$INSTDIR" /grant "*S-1-15-2-2:(OI)(CI)(RX)" /C /Q'
  Pop $0
  ${If} $0 != 0
    DetailPrint "icacls 返回 $0（权限可能已存在，或文件系统不支持；不影响安装）"
  ${EndIf}
!macroend
