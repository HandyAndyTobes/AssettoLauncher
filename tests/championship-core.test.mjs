import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRound, gt3Cars, raceLaps, buildGrid, NAMES } from '../resources/js/championship-core.js';

const layout = (id, aiLine = true, length = '5800 m', pitboxes = '40') => ({ id, name: id || 'Main', length, pitboxes, aiLine });
const tracks = [
  { id: 'jt_paul_ricard', title: 'Circuit Paul Ricard', playable: true, layouts: [layout('f1'), layout('gt')] },
  { id: 'monza', title: 'Monza', playable: true, layouts: [layout('')] },
  { id: 'ks_monza66', title: 'Monza 1966', playable: true, layouts: [layout('full'), layout('junior', false)] },
  { id: 'spa', title: 'Spa', playable: false, layouts: [layout('')] },
];

test('matchRound prefers the named layout of a known id', () => {
  const r = matchRound({ tracks: [{ id: 'jt_paul_ricard', layout: 'gt' }] }, tracks);
  assert.equal(r.best.track, 'jt_paul_ricard');
  assert.equal(r.best.layout, 'gt');
  assert.deepEqual(r.options.map(o => o.layout), ['gt', 'f1']);
});

test('matchRound falls back to a pattern and skips layouts without AI', () => {
  const r = matchRound({ tracks: [{ id: 'nope' }, { match: 'monza' }] }, tracks);
  assert.deepEqual(r.options.map(o => `${o.track}/${o.layout}`), ['monza/', 'ks_monza66/full']);
});

test('matchRound ignores tracks AC cannot load and reports nothing found', () => {
  assert.equal(matchRound({ tracks: [{ id: 'spa' }] }, tracks).best, null);
  assert.equal(matchRound({ tracks: [{ match: 'portimao|algarve' }] }, tracks).best, null);
});

const car = (id, extra = {}) => ({ id, title: id, year: 2020, tags: [], carClass: '', ai: true, skins: [{ id: 'a' }, { id: 'b' }], ...extra });

test('gt3Cars finds GT3 by id, class or tag, keeps AI cars for the grid', () => {
  const r = gt3Cars([car('bmw_z4_gt3'), car('x_racer', { carClass: 'GT3' }), car('y', { tags: ['#GT3'] }), car('z_gt3', { ai: false }), car('road_car')]);
  assert.deepEqual(r.player.map(c => c.id).sort(), ['bmw_z4_gt3', 'x_racer', 'y', 'z_gt3']);
  assert.deepEqual(r.models.map(c => c.id).sort(), ['bmw_z4_gt3', 'x_racer', 'y']);
});

test('gt3Cars leaves out cup and road cars named gt3', () => {
  const r = gt3Cars([
    car('ks_porsche_911_gt3_rs', { carClass: 'street' }),
    car('ks_porsche_911_gt3_cup_2017', { carClass: 'race' }),
    car('gue_porsche_911_gt3_cup_992', { carClass: 'race' }),
    car('lrs_porsche_911_992_gt3_cup', { carClass: 'race' }),
    car('ks_ferrari_488_gt3_2020'),
    car('bmw_z4_gt3'),
  ]);
  assert.deepEqual(r.player.map(c => c.id).sort(), ['bmw_z4_gt3', 'ks_ferrari_488_gt3_2020']);
});

test('gt3Cars keeps one of x / x_acc / x_evo: newest year, then the plain id', () => {
  const r = gt3Cars([car('bentley_gt3', { year: 2018 }), car('bentley_gt3_acc', { year: 2018 }), car('audi_gt3', { year: 2015 }), car('audi_gt3_evo', { year: 2019 })]);
  assert.deepEqual(r.models.map(c => c.id).sort(), ['audi_gt3_evo', 'bentley_gt3']);
});

test('gt3Cars leaves out GT2/GTE cars carrying the #GTE-GT3 category tag', () => {
  const r = gt3Cars([
    car('ferrari_458_gt2', { tags: ['#GTE-GT3', 'gt', 'gt2'] }),
    car('ks_corvette_c7r', { tags: ['#GTE-GT3', 'gt2'] }),
    car('ks_audi_r8_lms', { tags: ['gt3'] }),
    car('ks_ferrari_488_gt3_2020', { tags: [] }),
  ]);
  assert.deepEqual(r.player.map(c => c.id).sort(), ['ks_audi_r8_lms', 'ks_ferrari_488_gt3_2020']);
});

test('gt3Cars counts the same mod under two folder names as one model', () => {
  const r = gt3Cars([car('bm_amg_evo_2020_gt3', { title: 'AMG GT3 EVO 2020' }), car('bm_amg_evo_gt3_2020', { title: 'AMG GT3 Evo 2020' })]);
  assert.equal(r.player.length, 2);
  assert.equal(r.models.length, 1);
});

test('gt3Cars counts folder names with the same words in another order as one model', () => {
  const r = gt3Cars([car('bm_amg_evo_2020_gt3', { title: 'ACF GT3 - Mercedes-AMG GT3 EVO 2020' }), car('bm_amg_evo_gt3_2020', { title: 'ACF GT3 - AMG GT3 EVO 2020' }), car('ng_lexus_rcf_gt3')]);
  assert.equal(r.models.length, 2);
});

test('gt3Cars keeps cars whose ids only share the same letters as separate models', () => {
  const r = gt3Cars([
    car('mclaren_720s_gt3', { title: 'McLaren 720S GT3', tags: ['gt3'] }),
    car('mclaren_270s_gt3', { title: 'McLaren 270S GT3 Other', tags: ['gt3'] }),
  ]);
  assert.equal(r.models.length, 2);
});

test('raceLaps turns minutes into laps from the track length', () => {
  assert.equal(raceLaps(30, '5793 m'), 15);  // 30 min at 175 km/h = 87.5 km / 5.793 = 15.1
  assert.equal(raceLaps(30, '7.0 km'), 13);  // 12.5 rounds up
  assert.equal(raceLaps(20, '5,8km'), 10);   // 58.3 km / 5.8
  assert.equal(raceLaps(30, ''), 18);        // unknown length: 5 km, 17.5 rounds up
  assert.equal(raceLaps(1, '20 km'), 3);     // never fewer than 3
});

test('buildGrid spreads models, max 2 each, distinct names and skins', () => {
  let seed = 1;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const models = ['a', 'b', 'c'].map(id => car(id));
  const grid = buildGrid(models, { size: 20, level: 90, rand });
  assert.equal(grid.length, 6);              // capped at 2 per model
  for (const id of ['a', 'b', 'c']) {
    const mine = grid.filter(g => g.model === id);
    assert.equal(mine.length, 2);
    assert.notEqual(mine[0].skin, mine[1].skin);
  }
  assert.equal(new Set(grid.map(g => g.name)).size, 6);
  for (const g of grid) assert.ok(g.level >= 87 && g.level <= 93, g.level);
  assert.ok(NAMES.length >= 60);
});

test('buildGrid gives every model one car before any gets a second', () => {
  const grid = buildGrid(['a', 'b', 'c', 'd'].map(id => car(id)), { size: 5, level: 90, rand: Math.random });
  assert.equal(new Set(grid.map(g => g.model)).size, 4);
});

import { scoreRound, standings, PLAYER } from '../resources/js/championship-core.js';

const season = { points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], pole: 1 };
const active = { car: 'my_gt3', grid: [{ name: 'A', model: 'a' }, { name: 'B', model: 'b' }, { name: 'C', model: 'c' }], results: [] };
// race_out.json as AC writes it: car 0 is the player, 1..n the grid in order.
const out = ({ order = [1, 0, 2, 3], lapstotal = [10, 10, 10, 9], lapsCount = 10, quali = [{ car: 2, time: 99000 }, { car: 0, time: 99500 }] } = {}) => ({
  sessions: [
    { type: 2, name: 'Qualifying', lapsCount: 0, laps: [], lapstotal: [], bestLaps: quali, raceResult: [] },
    { type: 3, name: 'Race', lapsCount, laps: [], lapstotal, bestLaps: [], raceResult: order },
  ],
});

test('scoreRound: finishing places, points and the pole point', () => {
  const { result } = scoreRound(season, active, out(), 0);
  assert.equal(result.pos, 2);
  assert.equal(result.points, 18);
  assert.equal(result.pole, 'B');
  assert.deepEqual(result.order, ['A', PLAYER, 'B', 'C']);
});

test('scoreRound: the player on pole gets the point', () => {
  const { result } = scoreRound(season, active, out({ quali: [{ car: 0, time: 98000 }, { car: 1, time: 99000 }] }), 0);
  assert.equal(result.points, 19);
});

test('scoreRound: a lapped player still finishes; a quit does not', () => {
  // lapstotal[0] is the player; the leader is car 1 with 10 laps.
  assert.ok(scoreRound(season, active, out({ lapstotal: [8, 10, 10, 9] }), 0).result);      // 2 laps down
  assert.equal(scoreRound(season, active, out({ lapstotal: [7, 10, 10, 9] }), 0).result, null); // 3 down
  const quit = scoreRound(season, active, out({ lapstotal: [4, 4, 4, 4] }), 0);              // leader short of 10
  assert.equal(quit.result, null);
  assert.match(quit.reason, /not finished/);
});

test('scoreRound: no race session, or no qualifying', () => {
  assert.equal(scoreRound(season, active, { sessions: [] }, 0).result, null);
  const noQ = out();
  noQ.sessions.shift();
  assert.equal(scoreRound(season, active, noQ, 0).result.pole, '');
});

// AC sometimes writes the race session with lapstotal (and laps) empty.
const lapsOf = counts => counts.flatMap((n, car) => Array.from({ length: n }, () => ({ car, time: 100000, cuts: 0 })));

test('scoreRound: empty lapstotal, laps counted from the laps list', () => {
  const o = out({ lapstotal: [] });
  o.sessions[1].laps = lapsOf([10, 10, 10, 9]);
  const { result } = scoreRound(season, active, o, 0);
  assert.ok(result);
  assert.equal(result.pos, 2);
  assert.equal(result.points, 18);
  const short = out({ lapstotal: [] });
  short.sessions[1].laps = lapsOf([4, 4, 4, 4]);
  assert.equal(scoreRound(season, active, short, 0).result, null);
});

test('scoreRound: empty lapstotal and laps, the player\'s laps.ini count finishes it', () => {
  const { result } = scoreRound(season, active, out({ lapstotal: [] }), 0, 10);
  assert.ok(result);
  assert.equal(result.pos, 2);
});

test('scoreRound: empty everything and 3 of 10 laps in laps.ini is not finished', () => {
  const r = scoreRound(season, active, out({ lapstotal: [] }), 0, 3);
  assert.equal(r.result, null);
  assert.match(r.reason, /not finished/);
  assert.equal(scoreRound(season, active, out({ lapstotal: [] }), 0).result, null);
});

test('standings: points, wins, then best finish', () => {
  const a = { ...active, results: [
    { round: 0, order: ['A', PLAYER, 'B', 'C'], pole: 'B' },
    { round: 1, order: [PLAYER, 'A', 'C', 'B'], pole: PLAYER },
  ] };
  const rows = standings(season, a);
  assert.deepEqual(rows.map(r => [r.name, r.points, r.wins]), [[PLAYER, 44, 1], ['A', 43, 1], ['B', 28, 0], ['C', 27, 0]]);
  assert.equal(rows[0].player, true);
  assert.equal(rows[0].car, 'my_gt3');
  assert.equal(rows[1].car, 'a');
});
