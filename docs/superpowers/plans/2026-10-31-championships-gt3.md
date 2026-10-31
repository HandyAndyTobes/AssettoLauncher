# Championships (GT3 Endurance season) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Championships page in Assetto Launcher where the player runs a 5-round GT3 endurance season against a fixed AI grid in Assetto Corsa, with points and standings.

**Architecture:** Pure logic (track matching, car selection, grid, race laps, scoring, standings) lives in `championship-core.js` with no imports, so Node's test runner can test it. `championships.js` does the I/O: season files, saved progress, and starting a round through the existing `quickDrive` (which writes race.ini for a practice/qualifying/race weekend with a custom grid). `main.js` gets the page, the setup dialog, and a hook in `gameClosed` that scores the round when AC closes.

**Tech Stack:** Neutralino.js desktop app, vanilla ES modules, no build step. Tests: `node --test` (Node 22). App self-tests: `bin\neutralino-win_x64.exe --load-dir-res --path=. --snapshots=snaps --check-…`.

Spec: `docs/superpowers/specs/2026-10-31-championships-gt3-design.md`

## Global Constraints

- Work on branch `championships`. Commit after each task. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Series name in the UI: "GT Endurance Cup 2026". No "GT World Challenge", "SRO" or "Fanatec" anywhere in the UI or data.
- No real driver names: AI names come only from `NAMES` in `championship-core.js`.
- Points: `[25, 18, 15, 12, 10, 8, 6, 4, 2, 1]`, +1 pole, every round.
- Grid sizes offered: 15, 20, 25 (default 20), at most 2 cars per model. Race lengths: 20, 30, 45, 60 min (default 30). Practice 10 min (on/off), qualifying 10 min. AI strength default 90, ±3 per driver.
- **Changed from the spec, agreed with the user:** the race is set in laps estimated from the chosen minutes (`raceLaps`), because `quickDrive` sets races in laps. "Finished" = the leader completed the race's laps and the player is in the result within 2 laps of the leader.
- Code style: match the surrounding code (short functions, comments that explain why, `tr()` around UI strings, `esc()` around anything interpolated into HTML).
- JS syntax check after every edit: from the Bash tool, `node --input-type=module --check < resources/js/<file>.js` (not a PowerShell pipe: it mangles UTF-8).
- Never write JS containing `\\`, `\n` or `\r` escapes through a shell heredoc: use the Write/Edit tools.

## File map

| File | Status | Responsibility |
|---|---|---|
| `resources/js/championship-core.js` | create | pure functions: `NAMES`, `PLAYER`, `matchRound`, `gt3Cars`, `raceLaps`, `buildGrid`, `scoreRound`, `standings` |
| `tests/championship-core.test.mjs` | create | Node tests for the core |
| `resources/data/championships/gtwc-endurance-2026.json` | create | the season |
| `resources/js/championships.js` | create | I/O: `loadSeasons`, `champProgress`, `saveChampProgress`, `newSeason`, `startRound` |
| `resources/js/games.js` | modify `scanAcCars` | add `carClass` and `ai` to each AC car |
| `resources/js/quickdrive.js` | modify `gridEntries` | let a grid entry carry its own name, nation and level |
| `resources/js/main.js` | modify | page, setup dialog, results card, `gameClosed` hook, nav routing, self-test |
| `resources/css/app.css` | modify | `.ch-*` styles |
| `resources/index.html` | modify | nav button |

---

### Task 1: Core: track matching, GT3 cars, race laps, grid

**Files:**
- Create: `resources/js/championship-core.js`
- Test: `tests/championship-core.test.mjs`

**Interfaces:**
- Produces:
  - `matchRound(round, tracks) → { best: Option|null, options: Option[] }`, `Option = { track, layout, title, layoutName, length, pitboxes }`. `tracks` items are `scanAcTracks` items: `{ id, title, playable, layouts: [{ id, name, length, pitboxes, aiLine }] }`.
  - `gt3Cars(cars) → { player: Car[], models: Car[] }`. `cars` items are `scanAcCars` items with `{ id, title, year, tags, carClass, ai, skins: [{ id }] }`.
  - `raceLaps(minutes, length) → number` (≥ 3).
  - `buildGrid(models, { size, level, rand }) → [{ name, nation, model, skin, level }]`.
  - `NAMES: string[]` ("First Last,NAT"), `PLAYER = '@player'`.

- [ ] **Step 1: Write the failing tests**

Create `tests/championship-core.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the tests to see them fail**

Run (Bash, repo root): `node --test tests/`
Expected: FAIL, "Cannot find module … championship-core.js".

- [ ] **Step 3: Write the implementation**

Create `resources/js/championship-core.js`:

```js
// Championships: the parts that don't touch the game, the files or the page
// (championships.js does those), so they can be tested on their own
// (tests/championship-core.test.mjs, `node --test tests/`).
//
// A season (data/championships/*.json): { id, name, category, points[], pole,
// rounds: [{ name, country, tracks: [{ id, layout? } | { match }] }] }.
// The AI grid is built once per season: [{ name, nation, model, skin, level }].
// A round's result: { round, pos, pole (name), points, order: [names], at };
// the player is PLAYER in names.

export const PLAYER = '@player';

// Invented drivers ("First Last,NAT"): real ones aren't used.
export const NAMES = [
  'Luca Moretti,ITA', 'Jonas Varga,HUN', 'Tobias Lindqvist,SWE', 'Ade Okafor,GBR', 'Mathis Laurent,FRA', 'Kai Brenner,GER',
  'Rafael Duarte,POR', 'Niels de Groot,NED', 'Arno Peeters,BEL', 'Pablo Serrano,ESP', 'Elias Huber,AUT', 'Marco Ferri,ITA',
  'Oskar Nowak,POL', 'Henrik Dahl,NOR', 'Felix Wagner,GER', 'Theo Marchand,FRA', 'Ruben Costa,POR', 'Dario Conti,ITA',
  'Sam Whitfield,GBR', 'Jack Harrow,GBR', 'Emil Kovac,CZE', 'Viktor Szabo,HUN', 'Lars Eklund,SWE', 'Mikko Rantala,FIN',
  'Andre Lemaire,BEL', 'Jules Fontaine,FRA', 'Nico Albers,GER', 'Tom Verbeek,NED', 'Diego Navarro,ESP', 'Iker Etxeberria,ESP',
  'Bruno Reis,BRA', 'Caio Mendes,BRA', 'Mateo Rossi,ARG', 'Kenji Arata,JPN', 'Ryo Tanabe,JPN', 'Min-jun Park,KOR',
  'Liam O\'Rourke,IRL', 'Callum Reid,SCO', 'Owen Pritchard,WAL', 'Ethan Cole,USA', 'Mason Hart,USA', 'Logan Pierce,CAN',
  'Noah Fischer,SUI', 'Gian Bernasconi,SUI', 'Stefan Ionescu,ROU', 'Petar Ivanov,BUL', 'Andrej Novak,SVK', 'Matej Horvat,CRO',
  'Aleks Petrov,SRB', 'Jakub Zielinski,POL', 'Rasmus Holm,DEN', 'Fredrik Berg,NOR', 'Joel Virtanen,FIN', 'Dominik Bauer,AUT',
  'Hugo Martel,MON', 'Leo Santoro,ITA', 'Adrien Roux,FRA', 'Max Keller,GER', 'Finn Jansen,NED', 'Victor Almeida,POR',
  'Oliver Grant,AUS', 'Jett Walsh,NZL', 'Arjun Mehta,IND', 'Yusuf Demir,TUR',
];

const low = s => String(s ?? '').toLowerCase();

// The installed layouts a round can be driven on, best first: the season's
// known ids in order (a named layout before that track's others), then its
// patterns against folder ids and titles. Only layouts AC can load with an AI
// line count (opponents need one).
export function matchRound(round, tracks) {
  const options = [];
  const add = (t, l) => {
    if (!l?.aiLine || t.playable === false || options.some(o => o.track === t.id && o.layout === l.id)) return;
    options.push({ track: t.id, layout: l.id, title: t.title, layoutName: l.name, length: l.length || '', pitboxes: l.pitboxes || '' });
  };
  const byId = new Map(tracks.map(t => [low(t.id), t]));
  for (const want of round.tracks || []) {
    if (want.id) {
      const t = byId.get(low(want.id));
      if (!t) continue;
      if (want.layout != null) add(t, t.layouts.find(l => low(l.id) === low(want.layout)));
      for (const l of t.layouts) add(t, l);
    } else if (want.match) {
      const re = new RegExp(want.match, 'i');
      for (const t of tracks) if (re.test(t.id) || re.test(t.title)) for (const l of t.layouts) add(t, l);
    }
  }
  return { best: options[0] || null, options };
}

// GT3 cars: by id, ui_car.json class, or tag. player: all of them; models: the
// ones with AI data, one per model (x, x_acc and x_evo are one model: the
// newest year wins, then the plain id).
const isGt3 = c => /gt3/i.test(c.id) || /gt3/i.test(c.carClass || '') || (c.tags || []).some(t => /gt3/i.test(t));
const modelKey = id => low(id).replace(/_(acc|evo\d*)$/, '');
export function gt3Cars(cars) {
  const player = cars.filter(isGt3);
  const best = new Map();
  for (const c of player.filter(c => c.ai)) {
    const k = modelKey(c.id), had = best.get(k);
    const newer = !had || Number(c.year) > Number(had.year) || (Number(c.year) === Number(had.year) && c.id.length < had.id.length);
    if (newer) best.set(k, c);
  }
  return { player, models: [...best.values()] };
}

// Race laps for about `minutes` of GT3 racing on a track `length` long
// (ui_track.json: "5793 m", "7.0 km", "5,8km"; unknown: 5 km), at the 175 km/h
// a GT3 car averages on these circuits. At least 3.
export function raceLaps(minutes, length) {
  const m = /([\d.,]+)\s*(km|m)?/i.exec(String(length || ''));
  let km = m ? Number(m[1].replace(',', '.')) : 0;
  if (m && (low(m[2]) === 'm' || km > 100)) km /= 1000;
  if (!(km > 0.5)) km = 5;
  return Math.max(3, Math.round(minutes * 175 / 60 / km));
}

const shuffle = (list, rand) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// The season's AI grid: `size` cars (at most 2 per model), every model once
// before any gets a second; a model's two cars wear different skins. Names
// from NAMES, no repeats; AI level `level` ± 3 (at most 100).
export function buildGrid(models, { size, level, rand = Math.random }) {
  const order = shuffle(models, rand), picks = [];
  for (let pass = 0; pass < 2; pass++) for (const m of order) if (picks.length < size) picks.push(m);
  const names = shuffle(NAMES, rand), firstSkin = new Map(), count = new Map();
  return picks.map((m, i) => {
    const skins = m.skins.length ? m.skins.map(s => s.id) : [''];
    if (!firstSkin.has(m.id)) firstSkin.set(m.id, Math.floor(rand() * skins.length));
    const k = count.get(m.id) || 0;
    count.set(m.id, k + 1);
    const [name, nation] = names[i % names.length].split(',');
    return { name, nation, model: m.id, skin: skins[(firstSkin.get(m.id) + k) % skins.length], level: Math.min(100, Math.round(level - 3 + rand() * 6)) };
  });
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test tests/`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add resources/js/championship-core.js tests/championship-core.test.mjs
git commit -m "Championships core: track matching, GT3 cars, race laps, AI grid" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Core: scoring a round and standings

**Files:**
- Modify: `resources/js/championship-core.js` (append)
- Test: `tests/championship-core.test.mjs` (append)

**Interfaces:**
- Consumes: `PLAYER` (Task 1).
- Produces:
  - `scoreRound(season, active, out, round) → { result, reason }`. `out` is parsed race_out.json; `active.grid` is the season grid; `result` is `{ round, pos, pole, points, order, at }` or `null` with `reason` (text for the log and the toast).
  - `standings(season, active) → [{ name, car, points, wins, best, player }]`, best first.

- [ ] **Step 1: Write the failing tests**

Append to `tests/championship-core.test.mjs`:

```js
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
```

(Points check: you 18 + 25 + 1 pole = 44; A 25 + 18 = 43; B 15 + 1 pole + 12 = 28; C 12 + 15 = 27.)

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/`
Expected: FAIL, "scoreRound is not a function" (or the import error).

- [ ] **Step 3: Write the implementation**

Append to `resources/js/championship-core.js`:

```js
// Car index (race_out.json: 0 the player, 1..n the grid in race.ini order) to name.
const nameOf = (active, car) => (car === 0 ? PLAYER : active.grid[car - 1]?.name || `#${car}`);

// The fastest in a qualifying session: its bestLaps, else its laps (cut laps don't count).
function poleOf(active, quali) {
  const laps = quali?.bestLaps?.length ? quali.bestLaps : (quali?.laps || []).filter(l => !l.cuts);
  const best = laps.filter(l => l.time > 0).sort((a, b) => a.time - b.time)[0];
  return best ? nameOf(active, best.car) : '';
}

// A round's result from race_out.json, or null and why. A race counts when its
// leader covered the race's laps (otherwise the player left early and AC ended
// the session) and the player is in the result within 2 laps of the leader.
export function scoreRound(season, active, out, round) {
  const sessions = out?.sessions || [];
  const race = [...sessions].reverse().find(s => Number(s.type) === 3);
  if (!race) return { result: null, reason: 'no race session in race_out.json' };
  const order = race.raceResult || [];
  const laps = race.lapstotal || [];
  const leader = laps[order[0]] || 0;
  if (!order.length || leader < (race.lapsCount || 1)) return { result: null, reason: `race not finished (leader ${leader} of ${race.lapsCount} laps)` };
  if (!order.includes(0) || (laps[0] || 0) < leader - 2) return { result: null, reason: `race not finished (you did ${laps[0] || 0} of ${leader} laps)` };
  const quali = [...sessions].reverse().find(s => Number(s.type) === 2);
  const pole = poleOf(active, quali);
  const pos = order.indexOf(0) + 1;
  const points = (season.points[pos - 1] || 0) + (pole === PLAYER ? season.pole || 0 : 0);
  return { result: { round, pos, pole, points, order: order.map(c => nameOf(active, c)), at: Date.now() }, reason: '' };
}

// Everyone's points over the saved rounds, best first: more points, then more
// wins, then the better best finish.
export function standings(season, active) {
  const rows = new Map([[PLAYER, { name: PLAYER, car: active.car, points: 0, wins: 0, best: 99, player: true }]]);
  for (const g of active.grid) rows.set(g.name, { name: g.name, car: g.model, points: 0, wins: 0, best: 99, player: false });
  for (const r of active.results || []) {
    r.order.forEach((name, i) => {
      const row = rows.get(name);
      if (!row) return;
      row.points += season.points[i] || 0;
      if (i === 0) row.wins++;
      row.best = Math.min(row.best, i + 1);
    });
    if (rows.has(r.pole)) rows.get(r.pole).points += season.pole || 0;
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.best - b.best);
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test tests/`
Expected: all 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add resources/js/championship-core.js tests/championship-core.test.mjs
git commit -m "Championships core: round scoring and standings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Season file, car fields, saved progress and starting a round

**Files:**
- Create: `resources/data/championships/gtwc-endurance-2026.json`
- Create: `resources/js/championships.js`
- Modify: `resources/js/games.js` (`scanAcCars`, the returned object, around line 139)
- Modify: `resources/js/quickdrive.js` (`gridEntries`, around line 277)

**Interfaces:**
- Consumes: `matchRound`, `gt3Cars`, `raceLaps`, `buildGrid` (Task 1).
- Produces:
  - `loadSeasons() → Promise<Season[]>`
  - `champProgress() → Promise<{ active, history }>`, `saveChampProgress(p) → Promise<void>`
  - `newSeason(season, { car, skin, settings, rounds, models }) → active` (`settings = { gridSize, level, aggression, raceMinutes, practice }`, `rounds = [{ name, track, layout, dropped }]`)
  - `nextRoundIndex(active) → number` (-1 when the season is done)
  - `startRound(paths, active, index, tracks) → Promise<void>` (writes race.ini and starts AC)
  - AC car items gain `carClass: string` and `ai: boolean`.

- [ ] **Step 1: Add the season file**

Create `resources/data/championships/gtwc-endurance-2026.json`:

```json
{
  "id": "gt-endurance-2026",
  "name": "GT Endurance Cup 2026",
  "category": "gt3",
  "points": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
  "pole": 1,
  "rounds": [
    { "name": "Paul Ricard", "country": "France", "tracks": [{ "id": "jt_paul_ricard", "layout": "gt" }, { "match": "ricard|castellet" }] },
    { "name": "Monza", "country": "Italy", "tracks": [{ "id": "monza" }, { "id": "ks_monza66", "layout": "full" }, { "match": "monza" }] },
    { "name": "Spa-Francorchamps", "country": "Belgium", "tracks": [{ "id": "spa" }, { "match": "spa|francorchamps" }] },
    { "name": "Nürburgring", "country": "Germany", "tracks": [{ "id": "ks_nurburgring", "layout": "layout_gp_a" }, { "match": "nurburgring|nuerburgring" }] },
    { "name": "Portimão", "country": "Portugal", "tracks": [{ "id": "algarve" }, { "match": "portimao|algarve" }] }
  ]
}
```

- [ ] **Step 2: Give AC cars their class and AI flag**

In `resources/js/games.js`, `scanAcCars`, after `const isMod = …;` (line 138) add:

```js
    // Opponents need the car's AI data (data.acd packs it; unpacked cars have data/ai.ini).
    const ai = (await exists(join(dir, 'data.acd'))) || (await exists(join(dir, 'data/ai.ini')));
```

and in the returned object, after `country: ui.country || '',` add:

```js
      carClass: cleanText(ui.class) || '', ai,
```

Check `exists` is imported at the top of games.js (`grep -n "^import" resources/js/games.js`); add it to the `./util.js` import if missing.

- [ ] **Step 3: Let a grid entry carry its own driver**

In `resources/js/quickdrive.js`, `gridEntries`, replace the loop body's first lines so a given name wins:

```js
  for (const [i, g] of grid.entries()) {
    // A championship's grid brings its own drivers (championships.js).
    if (g.name) { entries.push({ car: g.car, skin: g.skin, name: g.name, nation: g.nation || '', level: g.level ?? 100, aggression: ai.aggression }); continue; }
    let name = '', nation = '';
```

and update its comment line above to: `// A grid of other cars: [{ car, skin, name?, nation?, level? }], named like opponentEntries names them unless they have a name.`

- [ ] **Step 4: Write championships.js**

Create `resources/js/championships.js`:

```js
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
```

- [ ] **Step 5: Syntax-check and run the core tests**

Run (Bash): `cd resources/js && for f in championships championship-core games quickdrive; do node --input-type=module --check < $f.js && echo "$f ok"; done && cd ../.. && node --test tests/`
Expected: four "ok" lines and all tests pass. Also check the JSON parses: `node -e "JSON.parse(require('fs').readFileSync('resources/data/championships/gtwc-endurance-2026.json','utf8'))" && echo json ok`.

- [ ] **Step 6: Commit**

```bash
git add resources/data/championships resources/js/championships.js resources/js/games.js resources/js/quickdrive.js
git commit -m "Championships: season file, saved progress, starting a round" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scoring a round when AC closes

**Files:**
- Modify: `resources/js/main.js`: imports (top), `gameClosed` (around line 371), new functions next to the page code (Task 5 adds the page in the same area)

**Interfaces:**
- Consumes: `scoreRound`, `standings`, `PLAYER` (Task 2); `champProgress`, `saveChampProgress`, `nextRoundIndex`, `loadSeasons` (Task 3); `readRaceOut` (util.js).
- Produces: `championshipClosed(l)`; `CH` (page state, used by Task 5): `const CH = { seasons: null }`; `chResultCard(season, active, result, before)`.

- [ ] **Step 1: Imports**

In `resources/js/main.js`, after the `./online.js` import line, add:

```js
import { loadSeasons, champProgress, saveChampProgress, newSeason, nextRoundIndex, startRound } from './championships.js';
import { matchRound, gt3Cars, raceLaps, standings as champStandings, scoreRound, PLAYER } from './championship-core.js';
```

Check `readRaceOut` is in the `./util.js` import of main.js; add it if not.

- [ ] **Step 2: The hook**

In `gameClosed`, after the line `if (l.academy) await academyClosed(key, l)…;` add:

```js
  if (key === 'ac' && l.championship) await championshipClosed(l).catch(err => log(`championship result: ${err?.stack || err}`));
```

- [ ] **Step 3: championshipClosed and the results card**

Add above `function renderCommunity()`:

```js
// ---------------------------------------------------------------------------
// Championships (championships.js, championship-core.js)

const CH = { seasons: null };
const chSeasons = async () => (CH.seasons ||= await loadSeasons());
const chName = name => (name === PLAYER ? tr('You') : name);

// AC closed after a round: score it from race_out.json, save it, say how it went.
async function championshipClosed(l) {
  const p = await champProgress();
  const a = p.active;
  if (!a || a.seasonId !== l.championship.seasonId) return;
  const season = (await chSeasons()).find(s => s.id === a.seasonId);
  if (!season) return;
  const index = l.championship.round;
  const out = await readRaceOut(join(state.paths.ac.cfg.replace(/\/[^/]+$/, ''), 'out/race_out.json'), l.at - 5000);
  const { result, reason } = out ? scoreRound(season, a, out, index) : { result: null, reason: 'no race_out.json' };
  log(`championship round ${index + 1}: ${result ? `P${result.pos}, ${result.points} pts` : reason}`);
  if (!result) {
    toast(tr('Race not finished: round {n} can be run again.', { n: index + 1 }), true);
    if (state.view === 'championships') renderChampionships();
    return;
  }
  const before = champStandings(season, a).findIndex(r => r.player) + 1;
  a.results = [...a.results.filter(r => r.round !== index), result];
  const finished = nextRoundIndex(a) < 0;
  if (finished) {
    const rows = champStandings(season, a);
    const me = rows.find(r => r.player);
    p.history = [{ seasonId: a.seasonId, name: season.name, car: a.car, rank: rows.indexOf(me) + 1, points: me.points, at: Date.now() }, ...p.history];
    p.active = null;
  }
  await saveChampProgress(p);
  if (state.view === 'championships') renderChampionships();
  chResultCard(season, a, result, before, finished);
}

function chResultCard(season, a, result, before, finished) {
  const rows = champStandings(season, a);
  const now = rows.findIndex(r => r.player) + 1;
  const change = before && now !== before ? (now < before ? `▲ ${before - now}` : `▼ ${now - before}`) : '';
  modal(`<div class="ch-card">
    <div class="ch-card-sub">${esc(season.name)} · ${esc(tr('Round {n}', { n: result.round + 1 }))} · ${esc(a.rounds[result.round].name)}</div>
    <h2>${esc(tr(finished ? 'Season finished' : 'Round finished'))}</h2>
    <div class="ch-card-big"><b>P${result.pos}</b><span>${esc(trn(result.points, '1 point', '{n} points'))}${result.pole === PLAYER ? ` · ${esc(tr('pole'))}` : ''}</span></div>
    <p>${esc(tr(finished ? 'Final position: P{n} with {pts} points.' : 'Championship: P{n} with {pts} points.', { n: now, pts: rows[now - 1].points }))} ${change ? `<span class="ch-change">${change}</span>` : ''}</p>
    <ol class="ch-mini">${rows.slice(0, 5).map(r => `<li class="${r.player ? 'me' : ''}"><span>${esc(chName(r.name))}</span><b>${r.points}</b></li>`).join('')}</ol>
  </div>`, 'modal ch-modal');
}
```

Note: `modal`, `esc`, `tr`, `trn`, `toast`, `join`, `state`, `log` already exist in main.js. `renderChampionships` comes in Task 5. Until then the check below only verifies syntax.

- [ ] **Step 4: Tag the launch**

Task 5's Start button sets `nextLaunch.ac = { championship: { seasonId, round } }` before calling `startRound`, and calls `markStarting('ac')` after. Nothing to do in this task, but don't rename `l.championship`.

- [ ] **Step 5: Syntax check**

Run (Bash): `node --input-type=module --check < resources/js/main.js && echo ok`
Expected: `ok`. (The app won't run the page until Task 5 defines `renderChampionships`; don't launch it yet.)

- [ ] **Step 6: Commit**

```bash
git add resources/js/main.js
git commit -m "Championships: score a round from race_out.json when AC closes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The Championships page and the setup dialog

**Files:**
- Modify: `resources/index.html` (nav, line ~22)
- Modify: `resources/js/main.js`: `syncChrome` (the `qd-mode` line), `render()` (view switch), new functions after `chResultCard`
- Modify: `resources/css/app.css` (append a `.ch-*` block after the Online block)

**Interfaces:**
- Consumes: everything from Tasks 1–4; `olOtherGameNote()` (AC Online, main.js) for the ACC/EVO/Rally note; `getItems(gameByKey('ac'), 'cars'|'tracks')`; `launchGame`; `markStarting`; `nextLaunch`; `isUp('ac')`.
- Produces: `renderChampionships()`.

- [ ] **Step 1: Nav and routing**

`resources/index.html`, before the AC Online button:

```html
        <button data-view="championships" id="nav-champ">Championships</button>
```

`main.js`, `syncChrome`: add `|| state.view === 'championships'` to the `qd-mode` toggle condition. `render()`: add `else if (state.view === 'championships') renderChampionships();` after the academy line.

- [ ] **Step 2: The page**

Add after `chResultCard` in `main.js`:

```js
// The page: the season running (calendar and standings side by side, the next
// round with Start), or with none the series card with New season and past seasons.
async function renderChampionships() {
  const g = gameByKey('ac');
  if (!isInstalled(g) || !state.paths?.ac?.install) {
    main.innerHTML = `<div class="view scaled"><div class="page">${olOtherGameNote()}<div class="empty"><h3>${tr('Assetto Corsa not found')}</h3>${tr('Championships are raced in Assetto Corsa, installed through Steam.')}</div></div></div>`;
    main.querySelector('[data-ol-start]')?.addEventListener('click', e => launchGame(gameByKey(e.currentTarget.dataset.olStart)));
    return;
  }
  main.innerHTML = `<div class="view scaled mods champ">${olOtherGameNote()}<div id="ch-wrap"><div class="loading">${tr('Loading…')}</div></div></div>`;
  const [seasons, p, tracks, cars] = await Promise.all([chSeasons(), champProgress(), getItems(g, 'tracks'), getItems(g, 'cars')]);
  if (state.view !== 'championships') return;
  const wrap = $('#ch-wrap');
  const season = seasons[0];
  const a = p.active;
  if (!season) { wrap.innerHTML = `<div class="empty">${tr('No championships found.')}</div>`; return; }

  if (!a) {
    const gt3 = gt3Cars(cars);
    const matched = season.rounds.map(r => matchRound(r, tracks).best);
    wrap.innerHTML = `<div class="ch-series">
      <div class="ch-head">${logoHTML(g)}<div><h2>${esc(season.name)}</h2><p>${esc(trn(season.rounds.length, '1 round', '{n} rounds'))} · GT3 · ${esc(tr('practice, qualifying and race each round'))}</p></div>
        <button class="btn primary" id="ch-new" ${gt3.player.length && gt3.models.length ? '' : 'disabled'}>${tr('New season')}</button></div>
      ${gt3.models.length ? '' : `<p class="ch-warn">${tr("No GT3 car with AI data is installed, so there's no grid to race.")}</p>`}
      <div class="ch-rounds">${season.rounds.map((r, i) => `<div class="ch-round ${matched[i] ? '' : 'off'}">
        <b>${i + 1}</b><div><span>${esc(r.name)}</span><small>${matched[i] ? esc(`${matched[i].title}${matched[i].layoutName && matched[i].layoutName !== matched[i].title ? ` · ${matched[i].layoutName}` : ''}`) : esc(tr('Not installed: pick another track or drop it when you start'))}</small></div>
        <span class="ch-badge ${matched[i] ? 'ok' : 'warn'}">${matched[i] ? '✓' : tr('Missing')}</span></div>`).join('')}</div>
      ${p.history.length ? `<div class="section-title">${tr('Past seasons')}</div><div class="ch-history">${p.history.map(h => `<div><span>${esc(h.name)}</span><small>${esc(cars.find(c => c.id === h.car)?.title || h.car)} · ${esc(timeAgo(h.at))}</small><b>P${h.rank} · ${h.points}</b></div>`).join('')}</div>` : ''}
    </div>`;
    $('#ch-new')?.addEventListener('click', () => chSetup(season, tracks, cars));
    return;
  }

  const rows = champStandings(season, a);
  const me = rows.findIndex(r => r.player) + 1;
  const next = nextRoundIndex(a);
  const carTitle = id => cars.find(c => c.id === id)?.title || id;
  wrap.innerHTML = `<div class="ch-head">${logoHTML(g)}<div><h2>${esc(season.name)}</h2>
      <p>${esc(carTitle(a.car))} · ${esc(trn(a.grid.length, '1 AI car', '{n} AI cars'))} · ${esc(tr('{n} min races', { n: a.settings.raceMinutes }))}</p></div>
      <span class="ch-badge">P${me} · ${rows[me - 1].points} ${tr('pts')}</span></div>
    <div class="ch-dash">
      <div class="ch-col"><div class="section-title">${tr('Calendar')}</div>${a.rounds.map((r, i) => {
        const res = a.results.find(x => x.round === i);
        const t = tracks.find(x => x.id === r.track);
        const cls = r.dropped ? 'dropped' : res ? 'done' : i === next ? 'next' : 'later';
        const right = r.dropped ? `<span class="ch-badge">${tr('Dropped')}</span>`
          : res ? `<span class="ch-badge ok">P${res.pos} · ${res.points}${res.pole === PLAYER ? ` · ${tr('pole')}` : ''}</span>`
          : i === next ? `<button class="btn primary" data-launch-game="ac" id="ch-start">▶ ${tr('Start round')}</button>` : '';
        return `<div class="ch-round ${cls}"><b>${i + 1}</b><div><span>${esc(r.name)}</span><small>${esc(t ? t.title : r.track)}${r.layout ? ` · ${esc(r.layout)}` : ''}</small></div>${right}</div>`;
      }).join('')}</div>
      <div class="ch-col"><div class="section-title">${tr('Standings')}</div><table class="ch-table">${rows.map((r, i) => `<tr class="${r.player ? 'me' : ''}"><td>${i + 1}</td><td>${esc(chName(r.name))}</td><td class="muted">${esc(carTitle(r.car))}</td><td class="n">${r.points}</td></tr>`).join('')}</table></div>
    </div>
    <button class="btn small subtle" id="ch-abandon">${tr('Abandon season')}</button>`;
  syncRunning(wrap);
  $('#ch-start')?.addEventListener('click', async e => {
    if (isUp('ac')) return; // the running-game button handles Close
    e.currentTarget.disabled = true;
    try {
      nextLaunch.ac = { championship: { seasonId: a.seasonId, round: next } };
      await startRound(state.paths, a, next, tracks);
      markStarting('ac');
      toast(tr('Starting round {n}: {track}…', { n: next + 1, track: a.rounds[next].name }));
      if (state.settings.minimizeOnLaunch) setTimeout(() => Neutralino.window.minimize(), 1500);
    } catch (err) {
      delete nextLaunch.ac;
      toast(err.message, true);
      e.currentTarget.disabled = false;
    }
  });
  // A second click confirms, as the launcher's other destructive buttons do.
  $('#ch-abandon').addEventListener('click', async e => {
    const b = e.currentTarget;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = tr('Click again to abandon'); setTimeout(() => { delete b.dataset.armed; b.textContent = tr('Abandon season'); }, 4000); return; }
    p.active = null;
    await saveChampProgress(p);
    renderChampionships();
  });
}
```

Before relying on `syncRunning(wrap)` and `data-launch-game`, read `syncRunning` (main.js ~line 410) to confirm the running-game button handles a click when AC is up (shows Close). If it attaches its own click handler globally, keep `if (isUp('ac')) return;` as written so the two don't both act.

- [ ] **Step 3: The setup dialog**

Add after `renderChampionships`:

```js
// New season: car and skin, grid, AI, race length, and each round's track
// (matched, a layout choice, or a substitute / Drop for a missing one).
function chSetup(season, tracks, cars) {
  const gt3 = gt3Cars(cars);
  const withAi = tracks.flatMap(t => t.playable === false ? [] : t.layouts.filter(l => l.aiLine).map(l => ({ track: t.id, layout: l.id, title: t.title, layoutName: l.name })));
  const optLabel = o => `${o.title}${o.layoutName && o.layoutName !== o.title ? ` · ${o.layoutName}` : ''}`;
  const maxGrid = gt3.models.length * 2;
  const sizes = [15, 20, 25].filter(n => n <= maxGrid);
  if (!sizes.length) sizes.push(maxGrid);
  const pick = { car: gt3.player[0].id };
  const matches = season.rounds.map(r => matchRound(r, tracks));
  const { el, close } = modal(`<div class="qd ch-setup">
    <header class="qd-head"><h2>${esc(season.name)}</h2><div class="qd-sub">${tr('Choose once for the whole season.')}</div></header>
    <div class="ch-form">
      <label>${tr('Your car')}<select id="chs-car">${gt3.player.map(c => `<option value="${esc(c.id)}">${esc(c.title)}</option>`).join('')}</select></label>
      <label>${tr('Skin')}<select id="chs-skin"></select></label>
      <label>${tr('AI cars')}<select id="chs-grid">${sizes.map(n => `<option ${n === Math.min(20, sizes[sizes.length - 1]) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>${tr('AI strength')} <span id="chs-level-v">90%</span><input type="range" id="chs-level" min="70" max="100" value="90"></label>
      <label>${tr('AI aggression')} <span id="chs-agg-v">30%</span><input type="range" id="chs-agg" min="0" max="100" value="30"></label>
      <label>${tr('Race length')}<select id="chs-min">${[20, 30, 45, 60].map(n => `<option value="${n}" ${n === 30 ? 'selected' : ''}>${n} min</option>`).join('')}</select></label>
      <label class="ch-check"><input type="checkbox" id="chs-prac" checked> ${tr('10 min practice before qualifying')}</label>
    </div>
    <div class="section-title">${tr('Rounds')}</div>
    <div class="ch-setup-rounds">${season.rounds.map((r, i) => {
      const m = matches[i];
      const opts = m.options.length ? m.options : withAi;
      return `<div class="ch-round ${m.best ? '' : 'off'}"><b>${i + 1}</b><div><span>${esc(r.name)}</span>${m.best ? '' : `<small>${esc(tr('Not installed: pick another track, or drop the round'))}</small>`}</div>
        <select data-chs-round="${i}">${m.best ? '' : `<option value="">${esc(tr('Drop this round'))}</option>`}${opts.map(o => `<option value="${esc(`${o.track}|${o.layout}`)}">${esc(optLabel(o))}</option>`).join('')}</select></div>`;
    }).join('')}</div>
    <div class="ch-actions"><span class="ch-laps" id="chs-laps"></span><button class="btn primary" id="chs-go">${tr('Start season')}</button></div>
  </div>`, 'modal ch-modal wide');

  const skins = () => {
    const c = cars.find(x => x.id === el.querySelector('#chs-car').value);
    el.querySelector('#chs-skin').innerHTML = (c?.skins || []).map(s => `<option value="${esc(s.id)}">${esc(prettifyId(s.id))}</option>`).join('');
  };
  const laps = () => {
    const min = Number(el.querySelector('#chs-min').value);
    const parts = [...el.querySelectorAll('[data-chs-round]')].map(s => {
      const [t, l] = s.value.split('|');
      const layout = tracks.find(x => x.id === t)?.layouts.find(x => x.id === l);
      return layout ? raceLaps(min, layout.length) : null;
    }).filter(Boolean);
    el.querySelector('#chs-laps').textContent = parts.length ? tr('About {a}–{b} laps a race', { a: Math.min(...parts), b: Math.max(...parts) }) : '';
  };
  el.querySelector('#chs-car').addEventListener('change', skins);
  el.querySelector('#chs-min').addEventListener('change', laps);
  el.querySelectorAll('[data-chs-round]').forEach(s => s.addEventListener('change', laps));
  for (const [id, out] of [['#chs-level', '#chs-level-v'], ['#chs-agg', '#chs-agg-v']]) el.querySelector(id).addEventListener('input', e => { el.querySelector(out).textContent = `${e.target.value}%`; });
  skins(); laps();

  el.querySelector('#chs-go').addEventListener('click', async () => {
    const rounds = season.rounds.map((r, i) => {
      const v = el.querySelector(`[data-chs-round="${i}"]`).value;
      const [track, layout] = v.split('|');
      return { name: r.name, track: track || '', layout: layout || '', dropped: !v };
    });
    if (rounds.every(r => r.dropped)) { toast(tr('Keep at least one round.'), true); return; }
    const p = await champProgress();
    p.active = newSeason(season, {
      car: el.querySelector('#chs-car').value, skin: el.querySelector('#chs-skin').value, rounds, models: gt3.models,
      settings: { gridSize: Number(el.querySelector('#chs-grid').value), level: Number(el.querySelector('#chs-level').value), aggression: Number(el.querySelector('#chs-agg').value), raceMinutes: Number(el.querySelector('#chs-min').value), practice: el.querySelector('#chs-prac').checked },
    });
    await saveChampProgress(p);
    log(`championship: new ${season.id} with ${p.active.car}, grid ${p.active.grid.length}`);
    close();
    renderChampionships();
  });
}
```

Check `prettifyId` and `timeAgo` are imported in main.js (`grep -n "prettifyId\|timeAgo" resources/js/main.js | head -3`); add to the `./util.js` import if missing.

- [ ] **Step 4: Styles**

Append to `resources/css/app.css` after the Online block (match the `.ol-*` colours and radii):

```css
/* Championships */
.champ .ch-head { display: flex; align-items: center; gap: 18px; margin-bottom: 18px; }
.ch-head > div { flex: 1; min-width: 0; }
.ch-head h2 { margin: 0; font-size: 20px; }
.ch-head p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
.ch-warn { color: #e0a64a; font-size: 13px; }
.ch-dash { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.ch-col { background: #1b1b1b; border: 1px solid #2a2a2a; border-radius: 8px; padding: 6px 14px 14px; }
.ch-rounds, .ch-setup-rounds { display: flex; flex-direction: column; gap: 4px; }
.ch-round { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-radius: 6px; border: 1px solid transparent; }
.ch-round > b { width: 20px; color: #888; font-variant-numeric: tabular-nums; }
.ch-round > div { flex: 1; min-width: 0; }
.ch-round span, .ch-round small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ch-round small { color: var(--muted); font-size: 12px; margin-top: 2px; }
.ch-round.next { background: #241717; border-color: var(--red); }
.ch-round.later { opacity: .6; }
.ch-round.dropped span { text-decoration: line-through; color: #777; }
.ch-round.off small { color: #e0a64a; }
.ch-round select { max-width: 280px; }
.ch-badge { font-size: 11.5px; padding: 3px 10px; border-radius: 999px; background: #262626; color: #bbb; white-space: nowrap; }
.ch-badge.ok { background: rgba(60, 207, 110, .14); color: var(--green); }
.ch-badge.warn { background: rgba(224, 166, 74, .15); color: #e0a64a; }
.ch-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ch-table td { padding: 6px 6px; border-bottom: 1px solid #242424; }
.ch-table td.n { text-align: right; font-variant-numeric: tabular-nums; }
.ch-table td.muted { color: var(--muted); font-size: 12px; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ch-table tr.me td { background: #2a1717; color: #fff; }
#ch-abandon { margin-top: 16px; }
.ch-history { display: flex; flex-direction: column; gap: 4px; }
.ch-history > div { display: flex; align-items: center; gap: 12px; padding: 8px 10px; background: #1b1b1b; border-radius: 6px; }
.ch-history span { flex: 1; } .ch-history small { color: var(--muted); }
.modal.ch-modal { width: min(520px, 100%); padding: 26px 30px; }
.modal.ch-modal.wide { width: min(760px, 100%); }
.ch-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; margin: 16px 0; }
.ch-form label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #aaa; }
.ch-form .ch-check { flex-direction: row; align-items: center; grid-column: 1 / -1; }
.ch-actions { display: flex; align-items: center; justify-content: flex-end; gap: 14px; margin-top: 18px; }
.ch-laps { color: var(--muted); font-size: 12.5px; flex: 1; }
.ch-card-sub { color: var(--muted); font-size: 12.5px; }
.ch-card-big { display: flex; align-items: baseline; gap: 12px; margin: 10px 0; }
.ch-card-big b { font-size: 40px; }
.ch-change { color: var(--green); margin-left: 6px; }
.ch-mini { margin: 12px 0 0; padding: 0; list-style: none; counter-reset: p; }
.ch-mini li { display: flex; gap: 10px; padding: 5px 8px; border-radius: 4px; counter-increment: p; }
.ch-mini li::before { content: counter(p); width: 18px; color: #888; }
.ch-mini li span { flex: 1; } .ch-mini li.me { background: #2a1717; }
@media (max-width: 900px) { .ch-dash, .ch-form { grid-template-columns: minmax(0, 1fr); } }
```

- [ ] **Step 5: Syntax check and a first look**

Run (Bash): `node --input-type=module --check < resources/js/main.js && echo ok`
Then launch the dev app (PowerShell): `Start-Process D:\Projects\AssettoLauncher\run-dev.bat`, click **Championships**, check that the series card shows 5 rounds with ✓ / Missing, open **New season**, check the laps estimate updates, and close the dialog without starting. Look in `neutralinojs.log` for `ui rejection`.
Expected: page renders, no `ui rejection`.

- [ ] **Step 6: Commit**

```bash
git add resources/index.html resources/js/main.js resources/css/app.css
git commit -m "Championships page: series card, season setup, calendar and standings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Self-test, screenshots and a real round

**Files:**
- Modify: `resources/js/main.js` (`runSnapshots`, next to the `--check-online` block)

**Interfaces:**
- Consumes: everything above. Uses `snap(name)`, `wait(ms)`, `dir` from `runSnapshots` (as `--check-online` does).

- [ ] **Step 1: Add `--check-championships`**

In `runSnapshots`, before the `--check-online` block, add:

```js
  // --check-championships: the season's track matches, the GT3 cars and a grid,
  // race.ini for round 1 written to a sandbox, a scored sample race, and the
  // page with no season, mid-season and finished. The real progress is put back.
  if ((window.NL_ARGS || []).includes('--check-championships')) {
    const g = gameByKey('ac');
    const [season] = await chSeasons();
    const tracks = await getItems(g, 'tracks'), cars = await getItems(g, 'cars');
    season.rounds.forEach((r, i) => { const m = matchRound(r, tracks); log(`check-champ round ${i + 1} ${r.name}: ${m.best ? `${m.best.track}/${m.best.layout}` : 'missing'} (${m.options.length} options)`); });
    const gt3 = gt3Cars(cars);
    log(`check-champ gt3: ${gt3.player.length} cars, ${gt3.models.length} models with AI: ${gt3.models.map(c => c.id).join(', ')}`);
    const saved = await champProgress();
    const rounds = season.rounds.map(r => { const b = matchRound(r, tracks).best; return { name: r.name, track: b?.track || '', layout: b?.layout || '', dropped: !b }; });
    const a = newSeason(season, { car: gt3.player[0].id, skin: gt3.player[0].skins[0]?.id || '', rounds, models: gt3.models, settings: { gridSize: 20, level: 90, aggression: 30, raceMinutes: 30, practice: true } });
    log(`check-champ grid: ${a.grid.map(x => `${x.name}/${x.model}/${x.level}`).join(', ')}`);
    const sb = `${norm(dir)}/champ-sandbox`;
    await ensureDir(`${sb}/cfg`);
    await writeText(`${sb}/cfg/race.ini`, '[RACE]\r\n');
    const first = nextRoundIndex(a);
    await startRound({ ...state.paths, ac: { ...state.paths.ac, cfg: `${sb}/cfg` } }, a, first, tracks).catch(err => log(`check-champ start: ${err.message}`));
    log(`check-champ race.ini: ${String(await readText(`${sb}/cfg/race.ini`)).replace(/\r?\n/g, ' | ').slice(0, 1500)}`);
    // A finished race and a quit one, in race_out.json's shape.
    const n = a.grid.length + 1, order = [...Array(n).keys()].sort(() => Math.random() - 0.5);
    const race = (laps, lead) => ({ sessions: [{ type: 2, bestLaps: [{ car: order[0], time: 100000 }] }, { type: 3, lapsCount: 15, lapstotal: Array(n).fill(laps).map((v, i) => (i === order[0] ? lead : v)), raceResult: order }] });
    log(`check-champ finished: ${JSON.stringify(scoreRound(season, a, race(15, 15), first))}`);
    log(`check-champ quit: ${JSON.stringify(scoreRound(season, a, race(4, 4), first).reason)}`);
    await saveChampProgress({ active: null, history: [] });
    state.view = 'championships'; render(); await wait(2500); await snap('champ-none');
    a.results = [scoreRound(season, a, race(15, 15), first).result];
    await saveChampProgress({ active: a, history: [] });
    render(); await wait(2500); await snap('champ-mid');
    log(`check-champ standings: ${champStandings(season, a).slice(0, 5).map(r => `${chName(r.name)} ${r.points}`).join(', ')}`);
    await saveChampProgress(saved);
    await Neutralino.app.exit();
    return;
  }
```

Check `norm`, `ensureDir`, `writeText`, `readText` are imported in main.js (the `--check-online` block uses them).

- [ ] **Step 2: Run it**

Run (PowerShell):
```powershell
$p = Start-Process -FilePath "D:\Projects\AssettoLauncher\bin\neutralino-win_x64.exe" -ArgumentList '--load-dir-res','--path=.','--snapshots=snaps','--check-championships' -WorkingDirectory D:\Projects\AssettoLauncher -PassThru; $null = $p.WaitForExit(180000); Get-Content D:\Projects\AssettoLauncher\neutralinojs.log -Tail 60 | Select-String 'check-champ|ui rejection|championship'
```
Expected:
- 5 `check-champ round` lines; on the developer's machine all 5 matched (jt_paul_ricard/gt, monza, spa, ks_nurburgring/layout_gp_a, algarve)
- a gt3 line with ≥ 20 models; a grid of 20 with distinct names
- race.ini containing `[SESSION_0]` Practice, `[SESSION_1]` Qualifying, `[SESSION_2]` Race with `LAPS=`, `CARS=21`, `CAR_1` with one of the grid names
- `finished` with a result, `quit` with "race not finished"; no `ui rejection`

Open `snaps/champ-none.png` and `snaps/champ-mid.png` and check: no overflow, the calendar and standings side by side, round 2 highlighted with Start, the standings with your row highlighted.

- [ ] **Step 3: A real round (with the user)**

Ask the user to start a season in the app and race round 1 to the flag, then close AC. Check:
- `neutralinojs.log` has `championship round 1: P<n>, <pts> pts`
- the results card appears and the calendar shows the result
- `Documents/Assetto Corsa/out/race_out.json` has a type 3 session whose `lapsCount` equals the laps logged at start, and `lapstotal[raceResult[0]]` equals it (this confirms the finished rule against real data)

If the rule doesn't hold against the real file, fix `scoreRound` and add the real file's numbers as a new test in `tests/championship-core.test.mjs` before going on.

Then ask them to start round 2 and quit from the pause menu after a lap. Check the toast "Race not finished: round 2 can be run again." and that round 2 still shows Start.

- [ ] **Step 4: Commit**

```bash
git add resources/js/main.js
git commit -m "Championships: --check-championships self-test" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review notes (done while writing)

- Spec coverage: season file (T3), matching with layout preference and AI-line check (T1), substitutes and Drop (T5 setup), GT3 detection and de-duplication (T1, T3 car fields), grid rules (T1), sessions (T3), launch tag and hook (T4, T5), scoring with pole and finished rule (T2), standings tie-breaks (T2), results card and season end with history (T4), page states and Abandon (T5), ACC/EVO/Rally note (T5 via `olOtherGameNote`), errors: no GT3 with AI (T5 disables New season), grid sizes capped at 2 × models (T5), track removed (T3 `startRound` error), race_out unreadable (T4); testing (T1, T2, T6).
- Spec items changed with the user's agreement: race laps instead of a timed race, and the finished rule (see Global Constraints).
- Names used across tasks: `matchRound`, `gt3Cars`, `raceLaps`, `buildGrid`, `scoreRound`, `standings` (imported in main.js as `champStandings`), `PLAYER`, `loadSeasons`, `champProgress`, `saveChampProgress`, `newSeason`, `nextRoundIndex`, `startRound`, `championshipClosed`, `chResultCard`, `renderChampionships`, `chSetup`, `CH`, `chSeasons`, `chName`.
