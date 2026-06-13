import { defineSignal } from '@temporalio/workflow';

export const pauseClockSignal = defineSignal<[{ pausedAt: string }]>('pause_clock');
