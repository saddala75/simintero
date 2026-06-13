import type { CaseState, CaseEvent } from './types.js';
import { reduce } from './reducers.js';
import type { CaseEventStore } from '../events/CaseEventStore.js';

/**
 * Case aggregate root.
 * Loads state via event replay from CaseEventStore; apply(event) advances state.
 */
export class Case {
  private state: CaseState;

  private constructor(state: CaseState) {
    this.state = state;
  }

  /**
   * Load an existing Case by replaying its event log.
   */
  static async load(caseId: string, store: CaseEventStore): Promise<Case> {
    const { seed, events } = await store.loadForReplay(caseId);
    let state = seed;
    for (const event of events) {
      state = reduce(state, event);
    }
    return new Case(state);
  }

  /**
   * Create a new Case aggregate from a seed state (after initial INSERT).
   */
  static fromSeed(seed: CaseState): Case {
    return new Case(seed);
  }

  /** Apply an event to advance state (pure in-memory, does NOT write to DB). */
  apply(event: CaseEvent): void {
    this.state = reduce(this.state, event);
  }

  getState(): CaseState {
    return this.state;
  }

  get caseId(): string {
    return this.state.caseId;
  }

  get tenantId(): string {
    return this.state.tenantId;
  }
}
