import { ELO_K_FACTOR } from '../constants';

export interface EloMatchResult {
  newChaserElo: number;
  newEvaderElo: number;
  chaserDelta: number;
  evaderDelta: number;
  outcome: 'chaser_win' | 'draw' | 'evader_win';
}

/**
 * Role-level Elo is a UI diagnostic only; it is not used by NEAT selection.
 * Fixed-horizon matches are scored directly from their net event outcome:
 * positive balance = chaser win, zero = draw, negative = runner win.
 */
export function updateEloRatings(
  chaserElo: number,
  evaderElo: number,
  chaserScore: 0 | 0.5 | 1,
  kFactor: number = ELO_K_FACTOR
): EloMatchResult {
  const exponent = (evaderElo - chaserElo) / 400;
  const expectedChaser = 1 / (1 + Math.pow(10, exponent));
  const expectedEvader = 1 - expectedChaser;
  const evaderScore = 1 - chaserScore;

  const chaserDelta = Math.round(kFactor * (chaserScore - expectedChaser));
  const evaderDelta = Math.round(kFactor * (evaderScore - expectedEvader));

  return {
    newChaserElo: Math.max(800, chaserElo + chaserDelta),
    newEvaderElo: Math.max(800, evaderElo + evaderDelta),
    chaserDelta,
    evaderDelta,
    outcome: chaserScore > 0.5 ? 'chaser_win' : chaserScore < 0.5 ? 'evader_win' : 'draw',
  };
}

/** Builds the role-level leaderboard from completed scored evaluation episodes. */
export function createLeaderboardEntries(
  chaserElo: number,
  evaderElo: number,
  completedMatches: number,
  chaserWins: number,
  evaderWins: number,
  draws: number,
  generation: number,
  avgTimeToTagMs: number,
  avgSurvivalTimeMs: number
) {
  const resolvedMatches = Math.max(completedMatches, chaserWins + evaderWins + draws);
  return [
    {
      id: 'current_chaser',
      role: 'chaser' as const,
      elo: chaserElo,
      matchesPlayed: resolvedMatches,
      wins: chaserWins,
      losses: evaderWins,
      draws,
      winRate: resolvedMatches > 0 ? ((chaserWins + draws * 0.5) / resolvedMatches) * 100 : 50,
      generation,
      avgMetric: (avgTimeToTagMs || 0) / 1000,
      isCurrent: true,
    },
    {
      id: 'current_evader',
      role: 'evader' as const,
      elo: evaderElo,
      matchesPlayed: resolvedMatches,
      wins: evaderWins,
      losses: chaserWins,
      draws,
      winRate: resolvedMatches > 0 ? ((evaderWins + draws * 0.5) / resolvedMatches) * 100 : 50,
      generation,
      avgMetric: (avgSurvivalTimeMs || 0) / 1000,
      isCurrent: true,
    },
  ].sort((a, b) => b.elo - a.elo);
}
