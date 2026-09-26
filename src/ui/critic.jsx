import { useCallback, useEffect, useRef, useState } from 'react'
import s from './app.module.css'

// The Review feature: a one-shot, read-only `claude -p` critique of the open
// artifact. It is the ONE place claudesight makes a cloud LLM call, so it is
// off by default, and every review click is confirmed — the standing opt-in
// (this toggle) plus a per-action confirm (the consent dialog), matching how
// the app already gates every shell write.
const ENABLED_KEY = 'claudesight.critic.enabled'
const REVIEWABLE = ['free', 'exec']

export function useCritic() {
  const [enabled, setEnabled] = useState(() => {
    try { return window.localStorage.getItem(ENABLED_KEY) === 'yes' } catch { return false }
  })
  // null = not yet checked; otherwise { state, reason }.
  const [preflight, setPreflight] = useState(null)

  const check = useCallback((recheck) => {
    setPreflight(null)
    fetch(`/api/critic/preflight${recheck ? '?recheck=1' : ''}`)
      .then((r) => r.json())
      .then(setPreflight)
      .catch(() => setPreflight({ state: 'error', reason: 'Could not reach the claudesight server.' }))
  }, [])

  useEffect(() => { if (enabled) check(false) }, [enabled, check])

  const enable = () => {
    try { window.localStorage.setItem(ENABLED_KEY, 'yes') } catch { /* storage blocked */ }
    setEnabled(true)
  }
  const disable = () => {
    try { window.localStorage.setItem(ENABLED_KEY, 'no') } catch { /* storage blocked */ }
    setEnabled(false)
  }

  return { enabled, preflight, enable, disable, recheck: () => check(true) }
}

// Header control. Enabling is a deliberate act with its own dialog, because it
// turns on a capability that sends files off the machine — the thing the rest
// of the app promises never to do.
export function ReviewToggle({ critic }) {
  const [asking, setAsking] = useState(false)
  return (
    <>
      <button
        className={s.linkQuiet}
        onClick={() => (critic.enabled ? critic.disable() : setAsking(true))}
        title={critic.enabled
          ? 'Review is on — it sends files to Anthropic. Click to turn off.'
          : 'Turn on Claude-file review (makes cloud LLM calls).'}
      >
        review: {critic.enabled ? 'on' : 'off'}
      </button>
      {asking && (
        <Modal titleId="enable-title" title="Turn on Review?">
          <p className={s.whyText}>
            claudesight makes <b>no outbound requests</b> — except this. Review sends the file you
            are looking at to <b>Anthropic</b>, through your local <code>claude</code> CLI under your
            own login, to get a critique back. Nothing is edited; findings are advice only.
          </p>
          <p className={s.whyText}>
            It stays off until you turn it on, and <b>every review is confirmed before it sends</b>.
            You can turn it back off at any time.
          </p>
          <div className={s.actions}>
            <button className={s.btn} onClick={() => { critic.enable(); setAsking(false) }}>
              Turn it on
            </button>
            <button className={`${s.btn} ${s.btnQuiet}`} onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </>
  )
}

// The per-artifact Review section, rendered inside the Editor. Shows nothing
// unless the feature is on and the artifact is editable/user-authored; shows
// the preflight reason (not a button) when `claude -p` is not usable.
export function ReviewPanel({ item, post, critic }) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState(null)
  const [err, setErr] = useState(null)

  if (!critic.enabled) return null
  if (!REVIEWABLE.includes(item.writability.class)) return null

  const pf = critic.preflight
  const run = async () => {
    setAsking(false); setBusy(true); setErr(null); setReport(null)
    try {
      const r = await post('/api/critic/review', { id: item.id, confirmed: true })
      if (r.state === 'ok') setReport(r.report)
      else setErr(r.reason ?? 'The review failed.')
    } catch {
      setErr('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={s.review}>
      <div className={s.groupHead}>
        <h3 className={s.groupName}>review</h3>
        <span className={s.groupRule} />
      </div>

      {pf == null && <p className={s.hint}>Checking whether <code>claude -p</code> is available…</p>}
      {pf && pf.state !== 'ok' && (
        <p className={s.hint}>
          Review unavailable — {pf.reason}{' '}
          <button className={s.linkQuiet} onClick={critic.recheck}>re-check</button>
        </p>
      )}

      {pf && pf.state === 'ok' && !busy && (
        <>
          <p className={s.hint}>
            A one-shot, read-only critique from a fresh <code>claude -p</code>. It suggests; it never
            edits. Sends this file to Anthropic.
          </p>
          {!report && <button className={s.btn} onClick={() => setAsking(true)}>Review this file</button>}
          {report && (
            <>
              <ReviewReport report={report} />
              <button className={`${s.btn} ${s.btnQuiet}`} onClick={() => setReport(null)}>Review again</button>
            </>
          )}
        </>
      )}

      {busy && <p className={s.loading}>Reviewing… a single <code>claude -p</code> call — often up to a minute while it thinks.</p>}
      {err && <p className={`${s.status} ${s.bad}`}>{err}</p>}

      {asking && (
        <Modal titleId="consent-title" title="Send this file to Anthropic?">
          <p className={s.whyText}>
            This reviews <b>{item.label}</b> by sending its contents to Anthropic via your local{' '}
            <code>claude</code> CLI. One call, read-only — the critic cannot edit anything or read
            other files. It costs a few cents of your usage.
          </p>
          <p className={s.path}>{item.path}</p>
          <div className={s.actions}>
            <button className={s.btn} onClick={run}>Send &amp; review</button>
            <button className={`${s.btn} ${s.btnQuiet}`} onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </section>
  )
}

const SEV = { high: s.sevHigh, medium: s.sevMed, low: s.sevLow }
const VERIFY_LABEL = {
  confirmed: 'confirmed against the repo',
  refuted: 'refuted by the repo — claim looks wrong',
  unverifiable: 'could not verify locally',
  unchecked: null,
}

function ReviewReport({ report }) {
  const { verdict, findings, context_seeded: seeded, cost_usd: cost } = report
  const byAction = findings.reduce((m, f) => { m[f.action] = (m[f.action] ?? 0) + 1; return m }, {})
  return (
    <div className={s.reviewReport}>
      {verdict && (
        <div className={`${s.why} ${s.flat}`}>
          <p className={s.whyTitle}>
            {verdict.verdict?.replace(/_/g, ' ') ?? 'reviewed'} · {findings.length} finding{findings.length === 1 ? '' : 's'}
            {' '}({['cut', 'edit', 'add', 'keep'].filter((a) => byAction[a]).map((a) => `${byAction[a]} ${a}`).join(', ')})
          </p>
          {verdict.summary && <p className={s.whyText}>{verdict.summary}</p>}
        </div>
      )}

      <ol className={s.findings}>
        {findings.map((f) => {
          const verify = f.local_verification && VERIFY_LABEL[f.local_verification.state]
          return (
            <li key={f.id} className={s.finding}>
              <div className={s.findingHead}>
                <span className={`${s.sev} ${SEV[f.severity] ?? ''}`}>{f.severity}</span>
                <span className={s.action}>{f.action}</span>
                {f.confidence && <span className={s.conf}>confidence: {f.confidence}</span>}
              </div>
              {f.quote && <blockquote className={s.quote}>{f.quote}</blockquote>}
              <p className={s.findingProblem}>{f.problem}</p>
              {f.suggested_change && (
                <p className={s.findingChange}><b>Suggested:</b> {f.suggested_change}</p>
              )}
              {f.rationale && <p className={s.findingWhy}><b>Why:</b> {f.rationale}</p>}
              {f.counterargument && <p className={s.findingWhy}><b>Counterpoint:</b> {f.counterargument}</p>}
              {verify && (
                <p className={`${s.verify} ${f.local_verification.state === 'refuted' ? s.bad : ''}`}>
                  {verify}{f.local_verification.checked ? ` — ${f.local_verification.checked}` : ''}
                </p>
              )}
            </li>
          )
        })}
      </ol>

      {verdict?.review_limitations?.length > 0 && (
        <div className={s.limitations}>
          <p className={s.whyTitle}>What the review could not assess</p>
          <ul className={s.hint}>
            {verdict.review_limitations.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}

      <p className={s.seeded}>
        Sent to Anthropic: this file{seeded?.length ? ` + resolved metadata (${seeded.join(', ')})` : ''}.
        {cost != null && ` Cost ≈ $${cost.toFixed(3)}.`}
      </p>
    </div>
  )
}

// A small modal reusing the close-guard backdrop, so consent dialogs look and
// behave like the rest of the app's confirmations.
function Modal({ title, titleId, children }) {
  const box = useRef(null)
  useEffect(() => { box.current?.focus() }, [])
  return (
    <div className={s.guardBackdrop} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className={`${s.confirm} ${s.guardBox}`} ref={box} tabIndex={-1}>
        <p className={s.confirmTitle} id={titleId}>{title}</p>
        {children}
      </div>
    </div>
  )
}
