import { defineSignal } from '@temporalio/workflow';

export const resumeClockSignal = defineSignal<[{ resumedAt: string }]>('resume_clock');
