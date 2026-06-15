import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

export function LandingPage() {
  const navigate = useNavigate()
  const pageRef = useRef<HTMLDivElement>(null)

  // Enable scrolling for the landing page — override app-level overflow:hidden
  useEffect(() => {
    const root = document.getElementById('root')
    const origBodyOv = document.body.style.overflow
    const origBodyH = document.body.style.height
    const origRootOv = root?.style.overflow ?? ''
    const origRootH = root?.style.height ?? ''
    document.body.style.overflow = 'auto'
    document.body.style.height = 'auto'
    if (root) {
      root.style.overflow = 'auto'
      root.style.height = 'auto'
    }
    return () => {
      document.body.style.overflow = origBodyOv
      document.body.style.height = origBodyH
      if (root) {
        root.style.overflow = origRootOv
        root.style.height = origRootH
      }
    }
  }, [])

  // IntersectionObserver reveal animation
  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const sibs = [
              ...(e.target.parentElement?.querySelectorAll('.reveal') ?? []),
            ]
            const delay = Math.min(sibs.indexOf(e.target as Element) * 70, 300)
            ;(e.target as HTMLElement).style.transitionDelay = `${delay}ms`
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    el.querySelectorAll('.reveal').forEach((r) => io.observe(r))
    return () => io.disconnect()
  }, [])

  const goToApp = () => navigate('/queues/default/worklist')

  return (
    <div className="lp-page" ref={pageRef}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="lp-header">
        <div className="lp-wrap">
          <nav className="lp-nav">
            <a className="lp-brand" href="/">
              <svg
                className="mark"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="2"
                  y="2"
                  width="20"
                  height="20"
                  rx="6"
                  stroke="#0F564C"
                  strokeWidth="1.6"
                />
                <circle cx="12" cy="12" r="3.4" fill="#0F564C" />
              </svg>
              Enstellar
            </a>
            <div className="lp-nav-links">
              <a href="#product">Product</a>
              <a href="#integrity">Integrity</a>
              <a href="#outcomes">Outcomes</a>
              <a href="#adoption">Adoption</a>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="lp-btn ghost" onClick={() => navigate('/ehr-sim')}>
                EHR Simulator
              </button>
              <button className="lp-btn ghost" onClick={goToApp}>
                Sign in
              </button>
              <button className="lp-btn" onClick={goToApp}>
                Request demo
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M3 8h10M9 4l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </nav>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-wrap">
          <div className="lp-hero-grid">
            {/* Left copy */}
            <div>
              <div className="lp-badge reveal">
                <span className="tag">New · 2026</span>
                <span className="txt">Full UM lifecycle, incl. appeals</span>
              </div>
              <h1 className="reveal">
                Prior authorization{' '}
                <em>without the audit anxiety.</em>
              </h1>
              <p className="sub reveal">
                Enstellar is the interoperability and workflow-execution layer
                for payer organizations — deterministic state machines, governed
                AI advisory, and full provenance from receipt to determination.
              </p>
              <p className="lp-ribbon reveal">
                <b>Criteria met · human signed · immutable</b>
                <br />
                Every decision is traceable end-to-end. No AI-only
                determinations. No black boxes. Every adverse action has a
                recorded clinician sign-off.
              </p>
              <div className="lp-cta-row reveal">
                <button className="lp-btn" onClick={goToApp}>
                  See it live
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M3 8h10M9 4l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <a className="lp-btn ghost" href="#integrity">
                  How it works
                </a>
              </div>
              <div className="lp-hero-stats reveal">
                <div className="lp-hstat">
                  <div className="v pine">72 h</div>
                  <div className="l">expedited clock, never missed</div>
                </div>
                <div className="lp-hstat">
                  <div className="v">100%</div>
                  <div className="l">adverse decisions with human sign-off</div>
                </div>
                <div className="lp-hstat">
                  <div className="v">0</div>
                  <div className="l">AI-only determinations, ever</div>
                </div>
              </div>
            </div>

            {/* Right bento panel */}
            <div className="lp-panel reveal">
              <div className="lp-bento">
                {/* AI summary card — full width */}
                <div className="lp-c lp-c-ai">
                  <div className="lp-c-head">
                    <span className="lp-c-title">
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <circle
                          cx="8"
                          cy="8"
                          r="6.4"
                          stroke="#0F564C"
                          strokeWidth="1.6"
                        />
                        <path
                          d="M8 5v3l2 1.2"
                          stroke="#0F564C"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                        />
                      </svg>
                      Governed AI · Advisory
                    </span>
                    <span className="lp-chip solid">Advisory only</span>
                  </div>
                  <p className="lp-ai-sum">
                    Patient meets 2 of 3 imaging criteria per plan policy
                    (InterQual 2025). Documentation gap: no ordering physician
                    attestation for medical necessity. Recommend requesting
                    attestation before advancing to determination.
                  </p>
                  <div className="lp-ai-cites">
                    <span className="lp-cite">Policy §4.2.1</span>
                    <span className="lp-cite">InterQual 2025</span>
                    <span className="lp-cite">Claim 2024-11-03</span>
                  </div>
                  <div className="lp-ai-foot">
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="lp-mini">Reject</button>
                      <button className="lp-mini go">Accept →</button>
                    </div>
                    <span className="lp-lock">
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <rect
                          x="3"
                          y="7"
                          width="10"
                          height="6.5"
                          rx="1.4"
                          stroke="currentColor"
                          strokeWidth="1.3"
                        />
                        <path
                          d="M5.5 7V5a2.5 2.5 0 015 0v2"
                          stroke="currentColor"
                          strokeWidth="1.3"
                        />
                      </svg>
                      Cannot issue determination
                    </span>
                  </div>
                </div>

                {/* Timeline card */}
                <div className="lp-c">
                  <div className="lp-c-head">
                    <span className="lp-c-title">Case timeline</span>
                    <span className="lp-chip">Live</span>
                  </div>
                  {[
                    { done: true, label: 'PA received via FHIR', ts: '08:14' },
                    {
                      done: true,
                      label: 'Completeness check passed',
                      ts: '08:15',
                    },
                    {
                      done: true,
                      label: 'Clinical review started',
                      ts: '09:03',
                    },
                    {
                      done: false,
                      label: 'Awaiting physician attestation',
                      ts: 'Pending',
                    },
                  ].map((ev, i) => (
                    <div key={i} className="lp-evt">
                      <span
                        className={`lp-node${ev.done ? ' done' : ''}`}
                      />
                      <span className="lab">{ev.label}</span>
                      <span className="ts">{ev.ts}</span>
                    </div>
                  ))}
                </div>

                {/* Gauge card */}
                <div className="lp-c">
                  <div className="lp-gauge">
                    <svg viewBox="0 0 140 84" fill="none" aria-hidden="true">
                      <path
                        d="M14 76 A56 56 0 0 1 126 76"
                        stroke="rgba(15,86,76,.15)"
                        strokeWidth="10"
                        strokeLinecap="round"
                      />
                      <path
                        d="M14 76 A56 56 0 0 1 126 76"
                        stroke="#0F564C"
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray="96 100"
                        pathLength="100"
                      />
                    </svg>
                    <div className="val">96%</div>
                    <div className="cap">
                      Clock compliance · expedited, this period
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Governed AI section ────────────────────────────────────────────── */}
      <section className="lp-sec" id="product">
        <div className="lp-wrap">
          <div className="lp-sec-head reveal">
            <span className="lp-eyebrow">Governed AI</span>
            <h2>
              AI that advises. Clinicians who decide.
            </h2>
            <p className="sub">
              Enstellar's agent layer is wired to the guardrail engine.
              Every AI output is advisory, cited, and passed through policy
              validation before a human ever sees it. The system of record
              is the deterministic state machine — not the model.
            </p>
          </div>

          <div className="lp-ai-split reveal">
            <div className="lp-ai-col does">
              <h3>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle
                    cx="8"
                    cy="8"
                    r="6.4"
                    stroke="#0F564C"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M5 8.5l2 2 4-4"
                    stroke="#0F564C"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                What governed AI does
              </h3>
              <ul>
                <li>
                  <span style={{ color: '#0F564C', fontWeight: 700 }}>✓</span>
                  <span>
                    Summarizes clinical evidence from the submitted record
                  </span>
                </li>
                <li>
                  <span style={{ color: '#0F564C', fontWeight: 700 }}>✓</span>
                  <span>
                    Flags documentation gaps and criteria mismatches with
                    citations
                  </span>
                </li>
                <li>
                  <span style={{ color: '#0F564C', fontWeight: 700 }}>✓</span>
                  <span>
                    Surfaces precedent cases and applicable policy references
                  </span>
                </li>
                <li>
                  <span style={{ color: '#0F564C', fontWeight: 700 }}>✓</span>
                  <span>
                    Drafts structured rationale for the clinician to review and
                    sign
                  </span>
                </li>
              </ul>
            </div>
            <div className="lp-ai-col">
              <h3
                style={{
                  color: '#B23A48',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 20,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle
                    cx="8"
                    cy="8"
                    r="6.4"
                    stroke="#B23A48"
                    strokeWidth="1.6"
                  />
                  <path
                    d="M5.5 5.5l5 5M10.5 5.5l-5 5"
                    stroke="#B23A48"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
                What governed AI never does
              </h3>
              <ul>
                <li>
                  <span style={{ color: '#B23A48', fontWeight: 700 }}>✗</span>
                  <span>Issues or commits a determination of any kind</span>
                </li>
                <li>
                  <span style={{ color: '#B23A48', fontWeight: 700 }}>✗</span>
                  <span>Signs off on an adverse decision</span>
                </li>
                <li>
                  <span style={{ color: '#B23A48', fontWeight: 700 }}>✗</span>
                  <span>
                    Accesses PHI beyond the minimum necessary for the case
                  </span>
                </li>
                <li>
                  <span style={{ color: '#B23A48', fontWeight: 700 }}>✗</span>
                  <span>
                    Operates outside tenant or deployment boundaries
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div className="lp-pullquote reveal">
            The guardrail engine sits between every AI output and any case
            mutation.{' '}
            <b>
              No advisory output commits directly — human action is always
              required for a determination.
            </b>
          </div>
        </div>
      </section>

      {/* ── Moments section ────────────────────────────────────────────────── */}
      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-sec-head reveal">
            <span className="lp-eyebrow">How it works</span>
            <h2>Five moments. One audit trail.</h2>
            <p className="sub">
              From the first byte of the FHIR request to the final notice
              letter, every state transition is deterministic, tenant-scoped,
              and immutably recorded.
            </p>
          </div>

          <div className="lp-moments">
            {[
              {
                n: '01',
                title: 'Receipt & completeness',
                text: 'PA request arrives via FHIR PAS or X12 278. The completeness engine validates required fields in seconds — no manual triage, no phone queues.',
                tag: 'FHIR PAS · X12 278 · CRD',
              },
              {
                n: '02',
                title: 'Clinical review',
                text: 'Nurse reviewer gets a pre-staged workspace: AI summary, criteria checklist, documentation gaps highlighted. Human reads, human decides.',
                tag: 'InterQual · DTR · AI advisory',
              },
              {
                n: '03',
                title: 'MD determination',
                text: 'Adverse cases escalate to the medical director with the full case record, AI-drafted rationale, and a sign-off gate. Clinician reviews and attests.',
                tag: 'Human sign-off required',
              },
              {
                n: '04',
                title: 'Notice & appeal',
                text: 'Determinations generate compliant member and provider notices automatically. Appeals reopen the full workflow with a fresh audit trail.',
                tag: 'EOB · IRE · NCQA',
              },
              {
                n: '05',
                title: 'Full provenance',
                text: 'Every event, every AI advisory call, every decision — timestamped, tenant-scoped, immutable. Designed to survive any external audit.',
                tag: 'Immutable event log',
              },
            ].map((m) => (
              <div key={m.n} className="lp-moment reveal">
                <div className="num">{m.n}</div>
                <div>
                  <h3>{m.title}</h3>
                  <p>{m.text}</p>
                  <span className="tag">{m.tag}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Integrity & provenance ─────────────────────────────────────────── */}
      <section className="lp-sec lp-integrity" id="integrity">
        <div className="lp-wrap">
          <div className="lp-sec-head reveal">
            <span className="lp-eyebrow">Integrity by design</span>
            <h2>Three guarantees, wired into the architecture.</h2>
            <p className="sub">
              Not a policy. Not a checkbox. Provenance, guardrails, and PHI
              boundary integrity are invariants enforced at the code level with
              test coverage that cannot be weakened.
            </p>
          </div>

          <div className="lp-proofs">
            <div className="lp-proof reveal">
              <div className="n">PROOF 01 · PROVENANCE</div>
              <p>
                Every state transition carries <b>tenant_id</b>, actor,
                timestamp, and prior state. Every AI advisory call is appended
                to the case timeline with its full input/output record.
              </p>
            </div>
            <div className="lp-proof reveal">
              <div className="n">PROOF 02 · GUARDRAILS</div>
              <p>
                The guardrail engine gates every AI output before any case
                mutation.{' '}
                <b>No advisory output commits directly.</b> Human action is
                always required for determination.
              </p>
            </div>
            <div className="lp-proof reveal">
              <div className="n">PROOF 03 · PHI BOUNDARY</div>
              <p>
                PHI is minimized before any inference call per configuration.{' '}
                <b>No cross-tenant, no cross-boundary</b> inference. Deployment
                tiers are isolated at network, data, and model levels.
              </p>
            </div>
          </div>

          {/* Outcomes / metrics */}
          <div
            className="lp-sec-head reveal"
            id="outcomes"
            style={{ marginTop: 72, maxWidth: 780 }}
          >
            <span className="lp-eyebrow">Outcomes</span>
            <h2>Numbers that hold up in an audit.</h2>
          </div>
          <div className="lp-metrics">
            <div className="lp-metric reveal">
              <div className="v">
                0<small> auto</small>
              </div>
              <div className="l">
                determinations issued by AI — ever. Every determination has a
                human sign-off.
              </div>
            </div>
            <div className="lp-metric reveal">
              <div className="v">100%</div>
              <div className="l">
                of adverse decisions with recorded clinician attestation, tied
                to NPI.
              </div>
            </div>
            <div className="lp-metric reveal">
              <div className="v">96%</div>
              <div className="l">
                expedited clock compliance this period — tracked live on the
                dashboard.
              </div>
            </div>
            <div className="lp-metric reveal">
              <div className="v">
                &lt;2<small> s</small>
              </div>
              <div className="l">
                completeness check. PA requests triaged instantly on receipt.
              </div>
            </div>
          </div>

          <div className="lp-integrity-stmt reveal">
            <span className="lp-eyebrow">Our commitment</span>
            <p>
              We will never ship a code path that allows AI to issue, sign, or
              be the sole basis for an adverse determination.{' '}
              <b>
                The guardrail invariant and its tests are non-negotiable — they
                cannot be weakened by a PR, ever.
              </b>
            </p>
          </div>
        </div>
      </section>

      {/* ── Adoption phases ────────────────────────────────────────────────── */}
      <section className="lp-sec" id="adoption">
        <div className="lp-wrap">
          <div className="lp-sec-head reveal">
            <span className="lp-eyebrow">Adoption</span>
            <h2>Go live in phases, not years.</h2>
            <p className="sub">
              Each phase is independently deployable and production-ready.
              Start with inbound FHIR and layer in the rest on your schedule.
            </p>
          </div>

          <div className="lp-phases">
            {[
              { pn: 'PHASE 01', pt: 'Inbound & completeness' },
              { pn: 'PHASE 02', pt: 'Clinical review & triage' },
              { pn: 'PHASE 03', pt: 'MD determination' },
              { pn: 'PHASE 04', pt: 'Notice & appeal' },
              { pn: 'PHASE 05', pt: 'Audit & reporting' },
            ].map((p) => (
              <div key={p.pn} className="lp-phase reveal">
                <div className="pn">{p.pn}</div>
                <div className="pt">{p.pt}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Standards strip ────────────────────────────────────────────────── */}
      <section className="lp-strip lp-sec">
        <div className="lp-wrap">
          <div className="lp-duo">
            <div className="reveal">
              <span className="lp-eyebrow">Standards &amp; compliance</span>
              <h3>Built on open standards, end-to-end.</h3>
              <p>
                FHIR R4, Da Vinci PAS, CRD, DTR. X12 278/279. US Core. NCQA.
                CMS Interoperability Rule. No proprietary formats. No lock-in.
              </p>
              <div className="lp-stds">
                {[
                  'FHIR R4',
                  'Da Vinci PAS',
                  'CRD',
                  'DTR',
                  'US Core',
                  'X12 278/279',
                  'NCQA',
                  'CMS Interop',
                ].map((s) => (
                  <span key={s} className="lp-pill">
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div className="reveal">
              <span className="lp-eyebrow">Interoperability</span>
              <h3>Connects to everything your plan already uses.</h3>
              <p>
                Native connectors for Digicore, Revital, and core-admin
                systems. Plug-in adapters for EHRs, clearinghouses, and state
                HIEs. OpenAPI + AsyncAPI contracts — not proprietary webhooks.
              </p>
              <p style={{ marginTop: 16 }}>
                <button
                  className="lp-btn"
                  style={{ fontSize: 14, padding: '10px 18px' }}
                  onClick={goToApp}
                >
                  Explore the live demo →
                </button>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────────── */}
      <section className="lp-final">
        <div className="lp-wrap">
          <span className="lp-eyebrow reveal">Ready when you are</span>
          <h2 className="reveal">
            Prior authorization done right — the first time.
          </h2>
          <p className="reveal">
            See Enstellar in action: live worklist, governed AI advisory,
            full determination workflow, and immutable provenance — all in a
            single demo environment.
          </p>
          <div className="lp-cta-row reveal" style={{ marginTop: 40 }}>
            <button className="lp-btn" onClick={goToApp}>
              Open live demo
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8h10M9 4l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button className="lp-btn ghost" onClick={goToApp}>
              Schedule a call
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-wrap">
          <a className="lp-brand" href="/">
            <svg
              className="mark"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="2"
                y="2"
                width="20"
                height="20"
                rx="6"
                stroke="#9FD3C8"
                strokeWidth="1.6"
              />
              <circle cx="12" cy="12" r="3.4" fill="#9FD3C8" />
            </svg>
            Enstellar
          </a>
          <span className="fnote">
            © 2026 Simintero · Enstellar · All determinations require human
            sign-off
          </span>
        </div>
      </footer>
    </div>
  )
}
