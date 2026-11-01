import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRound, gt3Cars, formulaCars, teamsFor, buildTeamGrid, prettySkin, touringCars, touringGroup, touringModels, raceLaps, buildGrid, NAMES } from '../resources/js/championship-core.js';

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

// The shipped season's fallback patterns must find the circuit, and not others
// whose names merely contain its letters (Valencia is "Circuit Ricardo Tormo").
test('season patterns match their own circuit only', async () => {
  const { readFileSync } = await import('node:fs');
  const season = JSON.parse(readFileSync(new URL('../resources/data/championships/gtwc-endurance-2026.json', import.meta.url), 'utf8'));
  const t = (id, title) => ({ id, title, playable: true, layouts: [{ id: '', name: title, aiLine: true }] });
  const installed = [t('fn_valencia', 'Circuit Ricardo Tormo'), t('ks_spain_test', 'Spanish Test Track'), t('my_paul_ricard', 'Paul Ricard'), t('spa_2022', 'Spa')];
  const only = round => matchRound({ tracks: round.tracks.filter(x => x.match) }, installed).options.map(o => o.track);
  assert.deepEqual(only(season.rounds[0]), ['my_paul_ricard']);
  assert.deepEqual(only(season.rounds[2]), ['spa_2022']);
});

const f1 = (id, extra = {}) => car(id, { tags: ['rwd', 'race', 'gp', 'singleseater'], ...extra });

test('formulaCars: Grand Prix / F1 / Formula single-seaters only', () => {
  const r = formulaCars([
    f1('ks_ferrari_sf70h'),
    f1('rss_formula_hybrid_2024', { tags: ['Formula', 'singleseater'] }),
    f1('brabham_bt46b', { tags: ['singleseater'], carClass: "F1 '78" }),
    f1('ks_praga_r1', { tags: ['#lmp3', 'singleseater'] }),
    f1('formula_e_gen1', { tags: ['openwheel', 'formula e'] }),
    f1('tatuusfa1', { tags: ['#Fabarth', 'singleseater'] }),
    f1('bmw_z4_gt3', { tags: ['gt3'] }),
    f1('no_ai_f1', { ai: false }),
  ]);
  assert.deepEqual(r.player.map(c => c.id), ['ks_ferrari_sf70h', 'rss_formula_hybrid_2024', 'brabham_bt46b']);
  assert.equal(r.models.length, 3);
});

test('teamsFor: one car, a team per skin; a pack, a team per car', () => {
  const hybrid = f1('rss_formula_hybrid_2024', { year: 2024, title: 'Hybrid', skins: [{ id: 'red_racing_01' }, { id: 'blue_team' }, { id: 'green' }] });
  const pack = ['ferrari_643', 'williams_fw14', 'mclaren_mp4-6'].map(n => f1(`asr_1991_${n}`, { year: 1991, title: n, skins: [{ id: '27' }, { id: '28' }, { id: 'test' }] }));
  const other = f1('rss_formula_hybrid_2023', { year: 2023 });
  const models = [hybrid, other, ...pack];
  assert.deepEqual(teamsFor(hybrid, models).map(t => t.name), ['Red Racing', 'Blue Team', 'Green']);
  const t = teamsFor(pack[0], models);
  assert.deepEqual(t.map(x => x.model), pack.map(c => c.id));
  assert.deepEqual(t[0].skins, ['27', '28']);
  assert.equal(teamsFor(f1('ks_lotus_72d', { year: 1972 }), models).length, 0); // no AI of its own: no grid
});

test('buildTeamGrid: pairs, the player with one teammate, teams come round again', () => {
  let seed = 3;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const teams = ['a', 'b', 'c'].map(s => ({ model: 'x', skins: [s], name: prettySkin(s) }));
  const grid = buildTeamGrid(teams, { car: 'x', skin: 'b', size: 9, level: 90, rand });
  assert.equal(grid.length, 9);
  assert.equal(grid[0].team, 'B');                           // the player's teammate
  assert.equal(grid.filter(g => g.team === 'B').length, 1);  // only the teammate: other teams fill the rest
  assert.equal(new Set(grid.map(g => g.name)).size, 9);
  const counts = ['A', 'C'].map(n => grid.filter(g => g.team === n).length);
  assert.deepEqual(counts, [4, 4]);                           // two rounds of the other teams
  assert.deepEqual(buildTeamGrid([], { car: 'x', skin: 'b', size: 5, level: 90 }), []);
});

test('raceLaps at a season speed', () => {
  assert.equal(raceLaps(30, '5793 m', 215), 19); // 107.5 km / 5.793 = 18.6
});

test('formula season patterns skip rallycross, dirt and historic layouts', async () => {
  const { readFileSync } = await import('node:fs');
  const season = JSON.parse(readFileSync(new URL('../resources/data/championships/formula-world-2026.json', import.meta.url), 'utf8'));
  const t = (id, title) => ({ id, title, playable: true, layouts: [{ id: '', name: title, aiLine: true }] });
  const installed = [t('Monaco_Rallycross_DiRT3', 'Monaco Rallycross DiRT3'), t('monaco_2019', 'Monaco GP Circuit'), t('rmi_dirtsdn_miami', 'DiRT Showdown - Miami'),
    t('ks_silverstone1967', 'Silverstone 1967'), t('my_silverstone', 'Silverstone'), t('acu_barcelona-city', 'Barcelona Memorial Run'), t('canadian_tire', 'Canadian Tire Motorsport Park'), t('ks_monza66', 'Monza 1966')];
  const only = name => matchRound({ tracks: season.rounds.find(r => r.name === name).tracks.filter(x => x.match) }, installed).options.map(o => o.track);
  assert.deepEqual(only('Monaco'), ['monaco_2019']);
  assert.deepEqual(only('Miami'), []);
  assert.deepEqual(only('Silverstone'), ['my_silverstone']);
  assert.deepEqual(only('Barcelona-Catalunya'), []);
  assert.deepEqual(only('Montréal'), []);
  assert.deepEqual(only('Monza'), []);
  assert.equal(season.rounds.length, 22);
});

test('teamsFor: driver liveries of one team make one team; a pack drops its shared title', () => {
  const skins = ['00_fh_2024_24', '01_fh_2023_23', 'MCL39_4_Norris', 'MCL39_81_Piastri', 'SF25_44_Hamilton'].map(id => ({ id }));
  const hybrid = f1('rss_formula_hybrid_2024', { year: 2024, skins });
  assert.deepEqual(teamsFor(hybrid, [hybrid]).map(t => `${t.name}:${t.skins.length}`), ['Fh:2', 'MCL39:2', 'SF25:1']);
  const pack = ['Ferrari 643', 'Williams FW14', 'Jordan 191'].map((n, i) => f1(`asr_1991_${i}`, { year: 1991, title: `ASR Formula 1991 - ${n}` })).concat(f1('asr_1991_x', { year: 1991, title: "Dallara 191 '91" }));
  assert.deepEqual(teamsFor(pack[0], pack).map(t => t.name), ['Ferrari 643', 'Williams FW14', 'Jordan 191', "Dallara 191 '91"]);
});

test('touringGroup: TCR, or a BTCC era by year; other cars none', () => {
  assert.equal(touringGroup(car('fw_cupra_tcr_2024', { tags: ['TCR'] })), 'TCR');
  assert.equal(touringGroup(car('x', { carClass: 'TCR' })), 'TCR');
  assert.equal(touringGroup(car('vauxhall_cavalier_btcc_1995', { year: 1995 })), 'BTCC 1990s');
  assert.equal(touringGroup(car('pm3dm_volvo_s40', { year: 1999, tags: ['#BTCC'] })), 'BTCC 1990s');
  assert.equal(touringGroup(car('ngtc_honda_civic', { year: 2023 })), 'BTCC NGTC');
  assert.equal(touringGroup(car('ks_bmw_m4_gt3')), '');
});

test('touringCars and touringModels: a grid of the player car\'s group only', () => {
  const cars = [
    car('fw_audi_rs3_tcr_2024', { tags: ['TCR'] }), car('fw_cupra_tcr_2024', { tags: ['TCR'] }),
    car('vauxhall_cavalier_btcc_1990', { year: 1990 }), car('btcc_1991_toyota_carina', { year: 1991 }),
    car('btcc_lonely_2005', { year: 2005, ai: false }), car('ks_bmw_m4_gt3'),
  ];
  const r = touringCars(cars);
  assert.deepEqual(r.player.map(c => c.id), ['btcc_1991_toyota_carina', 'vauxhall_cavalier_btcc_1990', 'fw_audi_rs3_tcr_2024', 'fw_cupra_tcr_2024']);
  assert.deepEqual(touringModels(cars[0], r.models).map(c => c.id), ['fw_audi_rs3_tcr_2024', 'fw_cupra_tcr_2024']);
});

test('buildGrid with perModel fills past two of a model', () => {
  const grid = buildGrid([car('a'), car('b'), car('c')], { size: 20, level: 90, perModel: 6 });
  assert.equal(grid.length, 18);
  for (const id of ['a', 'b', 'c']) assert.equal(grid.filter(g => g.model === id).length, 6);
});

test('raceLaps reads miles', () => {
  assert.equal(raceLaps(30, '2.176 miles', 145), 21); // 72.5 km / 3.5 km
});

test('scoreRound and standings: a fastest lap point when the season has one', () => {
  const s = { ...season, fastestLap: 1 };
  const o = out();
  o.sessions[1].bestLaps = [{ car: 0, time: 90000 }, { car: 1, time: 90500 }];
  const { result } = scoreRound(s, active, o, 0);
  assert.equal(result.fastest, PLAYER);
  assert.equal(result.points, 18 + 1);
  const me = standings(s, { ...active, results: [result] }).find(r => r.player);
  assert.equal(me.points, 19);
  assert.equal(scoreRound(season, active, o, 0).result.fastest, undefined); // no fastest lap point, none recorded
});

test('touring season patterns: Donington 1938 and other Crofts stay out', async () => {
  const { readFileSync } = await import('node:fs');
  const season = JSON.parse(readFileSync(new URL('../resources/data/championships/btcc-2026.json', import.meta.url), 'utf8'));
  const t = (id, title) => ({ id, title, playable: true, layouts: [{ id: '', name: title, aiLine: true }] });
  const installed = [t('donington1938', 'Donington 1938'), t('my_donington', 'Donington Park'), t('croft_circuit', 'Croft'), t('crofton_hill', 'Crofton Hill')];
  const only = name => matchRound({ tracks: season.rounds.find(r => r.name === name).tracks.filter(x => x.match) }, installed).options.map(o => o.track);
  assert.deepEqual(only('Donington Park GP'), ['my_donington']);
  assert.deepEqual(only('Croft'), ['croft_circuit']);
  assert.equal(season.rounds.length, 10);
});
