import { ELO_K_FACTOR } from '../constants';

export interface EloMatchResult {
  newChaserElo: number;
  newEvaderElo: number;
  chaserDelta: number;
  evaderDelta: number;
  outcome: 'chaser_decisive' | 'chaser_win' | 'balanced' | 'evader_win' | 'evader_domination';
}

/**
 * Role-level Elo is retained as an evaluation signal only; it is not used for NEAT selection.
 * The score bands convert tag/survival duration into a bounded head-to-head outcome.
 */
export function updateEloRatings(
  chaserElo: number,
  evaderElo: number,
  survivalDurationMs: number,
  kFactor: number = ELO_K_FACTOR,
  tagged: boolean = true
): EloMatchResult {
  const survivalSec = survivalDurationMs / 1000;
  const exponent = (evaderElo - chaserElo) / 400;
  const expectedChaser = 1 / (1 + Math.pow(10, exponent));
  const expectedEvader = 1 - expectedChaser;

  let chaserScore: number;
  let evaderScore: number;
  let outcome: EloMatchResult['outcome'];

  if (!tagged) {
    chaserScore = 0.0;
    evaderScore = 1.0;
    outcome = 'evader_domination';
  } else if (survivalSec < 5.0) {
    chaserScore = 1.0;
    evaderScore = 0.0;
    outcome = 'chaser_decisive';
  } else if (survivalSec < 12.0) {
    chaserScore = 0.8;
    evaderScore = 0.2;
    outcome = 'chaser_win';
  } else if (survivalSec < 20.0) {
    chaserScore = 0.5;
    evaderScore = 0.5;
    outcome = 'balanced';
  } else if (survivalSec < 30.0) {
    chaserScore = 0.2;
    evaderScore = 0.8;
    outcome = 'evader_win';
  } else {
    chaserScore = 0.0;
    evaderScore = 1.0;
    outcome = 'evader_domination';
  }

  const chaserDelta = Math.round(kFactor * (chaserScore - expectedChaser));
  const evaderDelta = Math.round(kFactor * (evaderScore - expectedEvader));

  return {
    newChaserElo: Math.max(800, chaserElo + chaserDelta),
    newEvaderElo: Math.max(800, evaderElo + evaderDelta),
    chaserDelta,
    evaderDelta,
    outcome,
  };
}

/** Builds the small role-level leaderboard shown in the UI. */
export function createLeaderboardEntries(
  chaserElo: number,
  evaderElo: number,
  totalTags: number,
  totalFalls: number,
  generation: number,
  avgTimeToTagMs: number,
  avgSurvivalTimeMs: number
) {
  const matches = totalTags + totalFalls;
  return [
    {
      id: 'current_chaser',
      role: 'chaser' as const,
      elo: chaserElo,
      matchesPlayed: matches,
      wins: totalTags,
      losses: totalFalls,
      draws: 0,
      winRate: matches > 0 ? (totalTags / matches) * 100 : 50,
      generation,
      avgMetric: (avgTimeToTagMs || 0) / 1000,
      isCurrent: true,
    },
    {
      id: 'current_evader',
      role: 'evader' as const,
      elo: evaderElo,
      matchesPlayed: matches,
      wins: totalFalls,
      losses: totalTags,
      draws: 0,
      winRate: matches > 0 ? (totalFalls / matches) * 100 : 50,
      generation,
      avgMetric: (avgSurvivalTimeMs || 0) / 1000,
      isCurrent: true,
    },
  ].sort((a, b) => b.elo - a.elo);
}
