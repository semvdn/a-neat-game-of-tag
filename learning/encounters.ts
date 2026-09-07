import { CLOSE_ENCOUNTER_ENTER_PX, CLOSE_ENCOUNTER_EXIT_PX } from '../constants';

/** Episode-local interaction accounting. Falls and tags end pressure without an evade. */
export class EncounterTracker {
  private active = false;
  private falls = 0;

  reset(): void {
    this.active = false;
  }

  step(distance: number, totalFalls: number): 'entered' | 'evaded' | null {
    if (totalFalls !== this.falls) {
      this.falls = totalFalls;
      this.reset();
      return null;
    }
    if (!this.active && Number.isFinite(distance) && distance <= CLOSE_ENCOUNTER_ENTER_PX) {
      this.active = true;
      return 'entered';
    }
    // Infinity means no physically accessible Runner (e.g. sibling route commitment).
    if (this.active && distance >= CLOSE_ENCOUNTER_EXIT_PX) {
      this.reset();
      return 'evaded';
    }
    return null;
  }
}
