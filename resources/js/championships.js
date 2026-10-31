// Championships: seasons of single races against a fixed AI grid in Assetto
// Corsa (docs/superpowers/specs/2026-10-31-championships-gt3-design.md). The
// rules are in championship-core.js; this file loads the seasons, keeps the
// player's progress (launcher storage "championships") and starts a round
// through Quick Drive's race.ini writer: a practice/qualifying/race weekend
// with the season's grid.
import { storageGet, storageSet, log } from './util.js';
import { buildGrid, raceLaps } from './championship-core.js';
import { quickDrive, readAcSession, defaultAcSession } from './quickdrive.js';
import { readCsp } from './csp.js';

export const SEASON_FILES = ['gtwc-endurance-2026.json'];

export async function loadSeasons() {
  const list = [];
  for (const f of SEASON_FILES) {
    try { list.push(await (await fetch(`/data/championships/${f}`)).json()); } catch (err) { log(`championships: ${f}: ${err?.message || err}`); }
  }
  return list;
}

// { active: the running season or null, history: [{ seasonId, name, car, rank, points, at }] }
export async function champProgress() {
  const p = await storageGet('championships', null);
  return { active: p?.active || null, history: p?.history || [] };
}
export const saveChampProgress = p => storageSet('championships', p);

// A new season's saved state, its grid built now and kept all season.
export function newSeason(season, { car, skin, settings, rounds, models }) {
  return {
    seasonId: season.id, startedAt: Date.now(), car, skin, settings, rounds,
    grid: buildGrid(models, { size: settings.gridSize, level: settings.level }),
    results: [],
  };
}

// The next round to drive (rounds are driven in order; dropped ones skipped), or -1.
export function nextRoundIndex(active) {
  const done = new Set(active.results.map(r => r.round));
  return active.rounds.findIndex((r, i) => !r.dropped && !done.has(i));
}

// race.ini for round `index` and AC started. The race is set in laps for about
// the season's minutes; the grid is cut to the track's pit boxes (AC can't
// place more cars than it has).
export async function startRound(paths, active, index, tracks) {
  const round = active.rounds[index];
  const track = tracks.find(t => t.id === round.track);
  const layout = track?.layouts.find(l => l.id === round.layout);
  if (!layout) throw new Error(`${round.name}: the track ${round.track} isn't installed any more. Pick another in the season's rounds.`);
  const s = active.settings;
  const csp = await readCsp(paths).catch(() => null);
  const base = await readAcSession(paths, csp).catch(() => defaultAcSession());
  const boxes = Number(layout.pitboxes) || 20;
  const grid = active.grid.slice(0, Math.max(1, Math.min(boxes, 64) - 1));
  const laps = raceLaps(s.raceMinutes, layout.length);
  const session = {
    ...base, mode: 'weekend',
    weekend: { practice: s.practice ? 10 : 0, qualifying: 10, laps },
    ai: { ...base.ai, count: grid.length, strength: s.level, variation: 0, aggression: s.aggression },
  };
  log(`championship round ${index + 1} ${round.track}/${round.layout}: ${laps} laps, grid ${grid.length}`);
  await quickDrive(paths, {
    car: active.car, skin: active.skin, track: round.track, layout: round.layout, session,
    maxOpponents: grid.length, csp, grid: grid.map(g => ({ car: g.model, skin: g.skin, name: g.name, nation: g.nation, level: g.level })),
  });
}
