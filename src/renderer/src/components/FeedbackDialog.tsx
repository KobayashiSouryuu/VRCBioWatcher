import { useEffect, useState, type JSX } from 'react'
import { useI18n } from '../i18n'

/**
 * 反馈对话框。
 *
 * ## 设计原则：用户必须看到"究竟发送了什么"
 *
 * 诊断信息里**包含账号名和好友数量**，属于个人信息。所以这里把要发送的
 * 文字**原样可编辑地展示出来**，用户能删掉任何不想给的行。
 * 悄悄发送用户数据是不可接受的 —— 即使用户主动点了"反馈"。
 *
 * ## 为什么只有 GitHub，没有邮件
 *
 * 见 docs/DECISIONS.md 3.9：客户端自动发邮件需要把 SMTP 密码打包进程序，
 * 而开源等于公开 —— 任何人都能用作者邮箱发垃圾邮件。所以只保留
 * 「打开预填好的新 issue」这条路，**发送动作由用户在浏览器里完成**。
 */
export function FeedbackDialog({
  githubUrl,
  onClose,
}: {
  githubUrl: string
  onClose: () => void
}): JSX.Element {
  const { t } = useI18n()
  const [problem, setProblem] = useState('')
  const [diagnostics, setDiagnostics] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.vrcbw
      .getDiagnostics()
      .then(setDiagnostics)
      .catch(() => setDiagnostics('（无法生成诊断信息）'))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const fullText = `${t('feedbackProblemHeading')}\n${problem.trim() || t('feedbackNoProblem')}\n\n${diagnostics}`

  const copyAll = (): void => {
    void window.vrcbw.copyText(fullText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  const hasGithub = githubUrl.startsWith('https://')

  const sendViaGithub = (): void => {
    // GitHub 的 URL 长度有限，所以正文只放问题描述 + 一小段环境信息，
    // **完整日志复制到剪贴板**让用户粘贴 —— 界面上有明确提示。
    const shortInfo = diagnostics.split('\n').slice(0, 20).join('\n')
    const body = `${problem.trim() || t('feedbackNoProblem')}\n\n${shortInfo}\n\n---\n${t('feedbackPasteHint')}`
    const url = `${githubUrl.replace(/\/+$/, '')}/issues/new?title=${encodeURIComponent(
      `[反馈] ${problem.trim().slice(0, 40) || '使用问题'}`,
    )}&body=${encodeURIComponent(body)}`
    void window.vrcbw.copyText(fullText)
    void window.vrcbw.openExternal(url)
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{t('feedbackDialogTitle')}</h2>
          <button type="button" className="ghost" onClick={onClose}>
            {t('close')}
          </button>
        </div>

        <label className="field">
          <span>{t('feedbackProblemLabel')}</span>
          <textarea
            rows={4}
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            placeholder={t('feedbackProblemPlaceholder')}
          />
        </label>

        <label className="field">
          <span>{t('feedbackDiagnosticsLabel')}</span>
          <textarea
            rows={12}
            className="diag-textarea"
            value={diagnostics}
            onChange={(e) => setDiagnostics(e.target.value)}
          />
        </label>
        <p className="muted">{t('feedbackPrivacyNote')}</p>

        <div className="actions modal-actions">
          <button type="button" className="ghost" onClick={copyAll}>
            {copied ? t('copiedHint') : t('copyDiagnosticsButton')}
          </button>
          <button type="button" onClick={sendViaGithub} disabled={!hasGithub}>
            {t('sendViaGithub')}
          </button>
        </div>

        <p className="muted">{t('feedbackGithubHint')}</p>
      </div>
    </>
  )
}
