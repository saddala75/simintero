export interface UmMetric {
  lob: string
  approvalRate: number
  denialRate: number
  overturnRate: number
  avgDecisionHours: number
}

export interface OperationalMetric {
  metric: string
  currentValue: string
  trend: string
  status: 'optimal' | 'warning'
}

export interface ComplianceReport {
  period: string
  slaCompliancePct: number
  breachesCount: number
  noticeTimelinessPct: number
}

const MOCK_METRICS: UmMetric[] = [
  { lob: 'Commercial', approvalRate: 82.4, denialRate: 17.6, overturnRate: 4.2, avgDecisionHours: 14.2 },
  { lob: 'Medicare Advantage', approvalRate: 88.1, denialRate: 11.9, overturnRate: 2.1, avgDecisionHours: 9.8 },
  { lob: 'Medicaid', approvalRate: 76.5, denialRate: 23.5, overturnRate: 6.8, avgDecisionHours: 18.4 },
]

const MOCK_OPS: OperationalMetric[] = [
  { metric: 'Current Queue Depth', currentValue: '1,420 cases', trend: '-12% vs last week', status: 'optimal' },
  { metric: 'Auto-Determination Rate', currentValue: '68.2%', trend: '+4.1% MoM', status: 'optimal' },
  { metric: 'AI Assist Utilization', currentValue: '86.4%', trend: 'Stable', status: 'optimal' },
  { metric: 'RFI Pend Resolution Time', currentValue: '3.4 days', trend: '+0.8 days', status: 'warning' },
]

const MOCK_COMPLIANCE: ComplianceReport[] = [
  { period: '2026 Q2 (Current)', slaCompliancePct: 99.98, breachesCount: 2, noticeTimelinessPct: 100.0 },
  { period: '2026 Q1', slaCompliancePct: 99.95, breachesCount: 5, noticeTimelinessPct: 99.8 },
  { period: '2025 Q4', slaCompliancePct: 99.90, breachesCount: 8, noticeTimelinessPct: 99.6 },
]

export async function getUmMetrics(): Promise<UmMetric[]> {
  try {
    const res = await fetch('/analytics/um-performance')
    if (res.ok) return await res.json()
  } catch {}
  return MOCK_METRICS
}

export async function getOperationalMetrics(): Promise<OperationalMetric[]> {
  try {
    const res = await fetch('/analytics/operational-metrics')
    if (res.ok) return await res.json()
  } catch {}
  return MOCK_OPS
}

export async function getComplianceReports(): Promise<ComplianceReport[]> {
  try {
    const res = await fetch('/analytics/compliance-reports')
    if (res.ok) return await res.json()
  } catch {}
  return MOCK_COMPLIANCE
}
