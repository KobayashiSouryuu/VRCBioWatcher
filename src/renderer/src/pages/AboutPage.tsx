import { useState, type JSX } from 'react'
import type { SystemInfo, UpdateCheckResult } from '@shared/types'
import { PROJECT_URL } from '@shared/project'
import { rich, useI18n } from '../i18n'
import { FeedbackDialog } from '../components/FeedbackDialog'

/**
 * 关于页。
 *
 * 把「版本 / 更新 / 反馈 / 法律声明 / 开源许可」从设置里挪出来单独一页：
 * 这些东西用户平时不看，但需要的时候要找得到 —— 塞在设置里会淹没真正的设置项。
 */
export function AboutPage({ info }: { info: SystemInfo | null }): JSX.Element {
  const { t } = useI18n()
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<UpdateCheckResult | null>(null)

  /** Release 页面（「查看更新日志」用） */
  const releasesUrl = `${PROJECT_URL}/releases`

  const doCheck = (): void => {
    setChecking(true)
    setCheckResult(null)
    void window.vrcbw
      .checkUpdate()
      .then(setCheckResult)
      .catch((err: unknown) => {
        setCheckResult({
          ok: false,
          current: info?.appVersion ?? '?',
          error: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => setChecking(false))
  }

  return (
    <>
      <section className="card">
        <h2>{t('aboutVersionTitle')}</h2>
        <div className="row">
          <div className="row-label">{t('aboutAppVersion')}</div>
          <div className="row-value">{info?.appVersion ?? '…'}</div>
        </div>
        <div className="row">
          <div className="row-label">Electron</div>
          <div className="row-value">
            {info?.electron ?? '…'} / Chromium {info?.chrome ?? '…'} / Node {info?.node ?? '…'}
          </div>
        </div>
        {/* 不再显示「运行模式」：正式版里这行永远是"打包后"，对用户没有信息量。
            排查问题需要时，诊断信息里仍然带着它（见 main/index.ts 的 buildDiagnosticsText）。 */}
      </section>

      <section className="card">
        <h2>{t('aboutGithubTitle')}</h2>

        <div className="row">
          <div className="row-label">{t('githubLabel')}</div>
          {/* 仓库地址写死在 src/shared/project.ts —— 不做成可编辑输入框 */}
          <div className="row-value mono">{PROJECT_URL}</div>
        </div>

        <div className="actions">
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void window.vrcbw.openExternal(PROJECT_URL)
            }}
          >
            {t('openGithubButton')}
          </button>
          <button type="button" className="ghost" onClick={doCheck}>
            {checking ? t('aboutChecking') : t('aboutCheckUpdate')}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              void window.vrcbw.openExternal(releasesUrl)
            }}
          >
            {t('aboutChangelogButton')}
          </button>
          <button type="button" onClick={() => setFeedbackOpen(true)}>
            {t('feedbackButton')}
          </button>
        </div>

        {checkResult ? (
          <p className={checkResult.ok && !checkResult.hasUpdate ? 'status-line' : 'status-line error'}>
            {!checkResult.ok
              ? t('aboutUpdateFailed', { error: checkResult.error ?? '' })
              : checkResult.hasUpdate
                ? rich(
                    t('aboutUpdateAvailable', {
                      latest: checkResult.latest ?? '',
                      current: checkResult.current,
                    }),
                  )
                : t('aboutUpToDate', { version: checkResult.current })}
            {checkResult.ok && checkResult.hasUpdate && checkResult.releaseUrl ? (
              <>
                {' '}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    if (checkResult.releaseUrl) void window.vrcbw.openExternal(checkResult.releaseUrl)
                  }}
                >
                  {t('aboutChangelogButton')}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        {/* 这里原先有一段「检查更新的实现原理」（GitHub Releases API），
            属于开发说明，正式版里删掉了 —— 想了解的人可以看 README。 */}
      </section>

      <section className="card">
        <h2>{t('aboutLegalTitle')}</h2>
        <p className="preline">{rich(t('aboutLegalText'))}</p>
      </section>

      <section className="card">
        <h2>{t('aboutLicenseTitle')}</h2>
        <p className="muted">{t('aboutLicenseNote')}</p>
        {/* 用加宽的标签列：默认 96px 放不下「React / React DOM」这种较长的名字 */}
        <div className="row">
          <div className="row-label wide">Electron</div>
          <div className="row-value">MIT License</div>
        </div>
        <div className="row">
          <div className="row-label wide">React / React DOM</div>
          <div className="row-value">MIT License</div>
        </div>
        <div className="row">
          <div className="row-label wide">electron-vite / Vite</div>
          <div className="row-value">MIT License</div>
        </div>
        <div className="row">
          <div className="row-label wide">TypeScript</div>
          <div className="row-value">Apache License 2.0</div>
        </div>
        <div className="row">
          <div className="row-label wide">Chromium / Node.js</div>
          <div className="row-value">
            {t('aboutLicenseChromium')}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>{t('aboutAiTitle')}</h2>
        <p className="preline">{rich(t('aboutAiText'))}</p>
      </section>

      {feedbackOpen ? <FeedbackDialog githubUrl={PROJECT_URL} onClose={() => setFeedbackOpen(false)} /> : null}
    </>
  )
}
