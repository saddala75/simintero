import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import './LandingPage.css'

export function LandingPage() {
  const { login, authenticated, ready } = useAuth()
  const navigate = useNavigate()
  const toApp = () => login(`${window.location.origin}/dashboard`)

  // Authenticated users who land on / go straight to the dashboard
  useEffect(() => {
    if (ready && authenticated) navigate('/dashboard', { replace: true })
  }, [ready, authenticated, navigate])
  const rootRef = useRef<HTMLDivElement>(null)

  // allow scrolling on this page
  useEffect(() => {
    const root = document.getElementById('root')
    const prevBodyOv = document.body.style.overflow
    const prevBodyH  = document.body.style.height
    const prevRootOv = root?.style.overflow ?? ''
    const prevRootH  = root?.style.height  ?? ''
    document.body.style.overflow = 'auto'
    document.body.style.height   = 'auto'
    if (root) { root.style.overflow = 'auto'; root.style.height = 'auto' }
    return () => {
      document.body.style.overflow = prevBodyOv
      document.body.style.height   = prevBodyH
      if (root) { root.style.overflow = prevRootOv; root.style.height = prevRootH }
    }
  }, [])

  // scroll-reveal
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return
        const sibs = [...(e.target.parentElement?.querySelectorAll('.reveal') ?? [])]
        const delay = Math.min(sibs.indexOf(e.target as Element) * 70, 300)
        ;(e.target as HTMLElement).style.transitionDelay = `${delay}ms`
        e.target.classList.add('in')
        io.unobserve(e.target)
      }),
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    el.querySelectorAll('.reveal').forEach((r) => io.observe(r))
    return () => io.disconnect()
  }, [])

  return (
    <div className="sim-lp" ref={rootRef}>

      {/* ── Topbar ── */}
      <div className="topbar">
        <div className="wrap topbar-inner">
          <div className="status-pair">
            <span className="status-dot" aria-hidden="true" />
            <span>Evidence synchronized</span>
          </div>
          <span>FHIR R4 · CQL · CDS Hooks · UDAP · X12</span>
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className="nav" aria-label="Primary navigation">
        <div className="wrap nav-inner">
          <a className="brand" href="#top" aria-label="Simintero home">
            <span className="brand-mark">S</span>
            <span className="brand-text">
              <span className="brand-title">Simintero</span>
              <span className="brand-subtitle">Payer Operating System</span>
            </span>
          </a>
          <div className="nav-links">
            <a href="#platform">Platform</a>
            <a href="#workflow">Workflow</a>
            <a href="#trust">Trust</a>
          </div>
          <div className="nav-actions">
            <button className="btn btn-ghost" onClick={toApp}>Login</button>
            <button className="btn btn-primary" onClick={toApp}>Request briefing</button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <main id="top">
        <section className="hero">
          <div className="wrap hero-grid">

            {/* Left copy */}
            <div className="hero-copy">
              <div className="eyebrow reveal">
                <span className="mini-node" />
                Standards-native payer operations
              </div>
              <h1 className="reveal">
                Evidence-driven payer decisions, without the manual chart chase.
              </h1>
              <p className="hero-lede reveal">
                Simintero unifies prior authorization intake, policy-as-code, governed AI review,
                provider documentation, and quality signals into one traceable operating layer.
              </p>
              <div className="hero-actions reveal">
                <a className="btn btn-primary" href="#platform">See how it works</a>
                <a className="btn btn-ai" href="#trust">✦ View evidence model</a>
                <button className="btn btn-ghost" onClick={toApp}>Request briefing</button>
              </div>
              <div className="hero-proof reveal" aria-label="Platform proof points">
                <div className="proof-tile">
                  <div className="proof-label">Decision state</div>
                  <div className="proof-value">Explainable by default</div>
                </div>
                <div className="proof-tile">
                  <div className="proof-label">Clinical logic</div>
                  <div className="proof-value">Versioned and testable</div>
                </div>
                <div className="proof-tile">
                  <div className="proof-label">AI boundary</div>
                  <div className="proof-value">Advisory only</div>
                </div>
              </div>
            </div>

            {/* Right — system frame */}
            <div className="hero-visual reveal" aria-label="Simintero interface preview">
              <div className="system-frame">
                <div className="system-titlebar">
                  <div className="window-controls" aria-hidden="true">
                    <span /><span /><span />
                  </div>
                  <div className="case-id">CASE · PA-24-009184 · LIVE EVIDENCE PACKAGE</div>
                </div>
                <div className="system-body">
                  <div className="case-summary">
                    <div className="panel">
                      <div className="panel-header">
                        <div className="panel-title">Authorization case</div>
                        <span className="rule-badge green">FHIR-PAS</span>
                      </div>
                      <div className="panel-content">
                        <div className="data-row"><span className="data-key">Line of business</span><span className="data-value">Medicare Advantage</span></div>
                        <div className="data-row"><span className="data-key">Intake channel</span><span className="data-value">FHIR Claim.submit</span></div>
                        <div className="data-row"><span className="data-key">Current state</span><span className="data-value">Clinical review</span></div>
                      </div>
                    </div>
                    <div className="clock-card">
                      <div className="clock-label">Regulatory clock</div>
                      <div className="clock-value">38h 12m</div>
                      <div className="progress-track"><span /></div>
                      <p className="clock-note">SLA, RFI pauses, and reviewer routing tracked in one governed workflow.</p>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="panel-header">
                      <div className="panel-title">Universal timeline</div>
                      <span className="rule-badge neutral">IMMUTABLE</span>
                    </div>
                    <div className="visual-timeline">
                      <div className="vt-node done"><span className="vt-dot" /><span>Intake</span></div>
                      <div className="vt-node done"><span className="vt-dot" /><span>Rules</span></div>
                      <div className="vt-node ai"><span className="vt-dot" /><span>AI evidence</span></div>
                      <div className="vt-node"><span className="vt-dot" /><span>Review</span></div>
                      <div className="vt-node waiting"><span className="vt-dot" /><span>Quality</span></div>
                    </div>
                  </div>

                  <div className="stack-grid">
                    <div className="evidence-card">
                      <div className="evidence-head"><div className="evidence-title">Rules trace</div><span className="rule-badge">DIG</span></div>
                      <p className="evidence-copy">Policy version and logic branch resolved for reproducible review.</p>
                    </div>
                    <div className="evidence-card">
                      <div className="evidence-head"><div className="evidence-title">AI advisory</div><span className="rule-badge blue">REV</span></div>
                      <p className="evidence-copy">Summaries cite the original clinical evidence for verification.</p>
                    </div>
                    <div className="evidence-card">
                      <div className="evidence-head"><div className="evidence-title">Human control</div><span className="rule-badge green">SAFE</span></div>
                      <p className="evidence-copy">Adverse determinations require qualified reviewer sign-off.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* ── Platform capabilities ── */}
        <section className="section" id="platform">
          <div className="wrap">
            <div className="section-header">
              <div>
                <div className="section-kicker">What the platform does</div>
                <h2>One operating layer for the work payers and providers keep repeating.</h2>
              </div>
              <p className="section-lede">
                Instead of separate systems for intake, policy, document review, appeals, and quality,
                Simintero creates a shared evidence fabric where every decision is grounded, governed, and auditable.
              </p>
            </div>

            <div className="capability-grid">
              <article className="capability-card primary">
                <div className="capability-top"><div className="capability-glyph">E</div><span className="rule-badge">ENS</span></div>
                <div className="capability-body">
                  <h3>Intake and workflow</h3>
                  <p>Normalize FHIR, X12, portal, and fax submissions into one canonical case with SLA-aware routing.</p>
                </div>
              </article>
              <article className="capability-card primary">
                <div className="capability-top"><div className="capability-glyph">D</div><span className="rule-badge">DIG</span></div>
                <div className="capability-body">
                  <h3>Policy-as-code</h3>
                  <p>Turn payer rules, licensed criteria, and documentation requirements into versioned, testable logic.</p>
                </div>
              </article>
              <article className="capability-card ai">
                <div className="capability-top"><div className="capability-glyph">R</div><span className="rule-badge blue">REV</span></div>
                <div className="capability-body">
                  <h3>Governed AI review</h3>
                  <p>Extract and summarize evidence from clinical documents while keeping coverage decisions human controlled.</p>
                </div>
              </article>
              <article className="capability-card good">
                <div className="capability-top"><div className="capability-glyph">Q</div><span className="rule-badge green">QUAL</span></div>
                <div className="capability-body">
                  <h3>Quality intelligence</h3>
                  <p>Measure care gaps and quality signals directly against the same evidence stream already collected.</p>
                </div>
              </article>
            </div>

            <div className="mini-flow" id="workflow" aria-label="Simintero workflow">
              <div className="flow-step">
                <span className="flow-num">1</span>
                <div className="flow-title">Request enters</div>
                <p className="flow-copy">Provider submits through FHIR, SMART, portal, X12, or document channel.</p>
              </div>
              <div className="flow-step">
                <span className="flow-num">2</span>
                <div className="flow-title">Rules resolve</div>
                <p className="flow-copy">Digicore selects the applicable policy and documentation requirements.</p>
              </div>
              <div className="flow-step">
                <span className="flow-num">3</span>
                <div className="flow-title">Evidence maps</div>
                <p className="flow-copy">Revital summarizes and cites clinical evidence for reviewer verification.</p>
              </div>
              <div className="flow-step" id="trust">
                <span className="flow-num">4</span>
                <div className="flow-title">Human reviews</div>
                <p className="flow-copy">Reviewer sees rule traces, missing evidence, SLA context, and rationale.</p>
              </div>
              <div className="flow-step">
                <span className="flow-num">5</span>
                <div className="flow-title">Decision is defensible</div>
                <p className="flow-copy">The evidence package preserves policy, source data, AI context, and sign-off.</p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="footer">
        <div className="wrap footer-inner">
          <span>Simintero · Payer Operating System</span>
          <span>Evidence grounded · Policy governed · Human accountable</span>
        </div>
      </footer>

    </div>
  )
}
