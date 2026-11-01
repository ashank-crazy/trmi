export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 6;
export const MAX_NAME_LENGTH = 20;
export const MAX_COMMENT_LENGTH = 160;
/** The agent's queue for one game: this many clean changes, plus this many that hide a bug. */
export const CLEAN_CHANGES = 6;
export const BUGGED_CHANGES = 3;
/** Reviewers win the release by merging this many clean changes. */
export const SHIP_TO_WIN = 4;
/** The saboteur wins once this many bugs are merged. */
export const BUGS_TO_WIN = 2;
/** A retro (vote someone off the team) follows every this many changes. */
export const RETRO_EVERY = 2;
/** how long reviewing a change and a retro last */
export const REVIEW_MS = 90_000;
export const RETRO_MS = 60_000;
//# sourceMappingURL=rules.js.map