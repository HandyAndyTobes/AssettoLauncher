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
