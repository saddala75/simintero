import { defineSignal } from '@temporalio/workflow';

export const satisfyClockSignal = defineSignal<[]>('satisfy_clock');
