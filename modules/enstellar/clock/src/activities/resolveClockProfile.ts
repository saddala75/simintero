/**
 * resolveClockProfile — fetches the clock profile from VKAS.
 *
 * If VKAS returns 501 (Not Implemented) or is unreachable, falls back to the
 * embedded ma-cms-0057.yaml stub.
 */

export interface ClockProfileEntry {
  id: string;
  trigger_event: string;
  urgency_filter?: string;
  deadline_business_days?: number;
  deadline_hours?: number;
  deadline_calendar_days?: number;
  calendar: string;
  warning_threshold_pct?: number;
  suspends_clocks?: string[];
}

export interface ClockProfile {
  clocks: ClockProfileEntry[];
}

/** Embedded YAML stub (ma-cms-0057) */
const STUB_PROFILE: ClockProfile = {
  clocks: [
    {
      id: 'standard_determination',
      trigger_event: 'case.created',
      deadline_business_days: 14,
      calendar: 'business_days',
      warning_threshold_pct: 0.75,
    },
    {
      id: 'expedited_determination',
      trigger_event: 'case.created',
      urgency_filter: 'expedited',
      deadline_hours: 72,
      calendar: 'calendar_hours',
      warning_threshold_pct: 0.8,
    },
    {
      id: 'rfi_hold',
      trigger_event: 'rfi.issued',
      deadline_business_days: 14,
      calendar: 'business_days',
      suspends_clocks: ['standard_determination', 'expedited_determination'],
    },
    {
      id: 'appeal_standard',
      trigger_event: 'appeal.filed',
      deadline_calendar_days: 60,
      calendar: 'calendar_days',
      warning_threshold_pct: 0.75,
    },
  ],
};

const VKAS_BASE_URL = process.env['VKAS_BASE_URL'] ?? 'http://localhost:4000';

export async function resolveClockProfile(artifactRef: string): Promise<ClockProfile> {
  try {
    const resp = await fetch(
      `${VKAS_BASE_URL}/v1/artifacts:resolve?ref=${encodeURIComponent(artifactRef)}`,
      { signal: AbortSignal.timeout(3000) },
    );

    if (resp.status === 501 || resp.status === 404) {
      // Phase 1: VKAS not yet implemented — use stub
      return STUB_PROFILE;
    }

    if (!resp.ok) {
      throw new Error(`resolveClockProfile: VKAS returned ${resp.status}`);
    }

    return (await resp.json()) as ClockProfile;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('resolveClockProfile:')) {
      throw err;
    }
    // Network / timeout → stub
    console.warn(
      `resolveClockProfile: VKAS unreachable (${err instanceof Error ? err.message : String(err)}); using stub`,
    );
    return STUB_PROFILE;
  }
}
