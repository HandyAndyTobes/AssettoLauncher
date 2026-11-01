// Championships: the parts that don't touch the game, the files or the page
// (championships.js does those), so they can be tested on their own
// (tests/championship-core.test.mjs, `node --test tests/*.test.mjs`).
//
// A season (data/championships/*.json): { id, name, category, points[], pole,
// rounds: [{ name, country, tracks: [{ id, layout? } | { match }] }] }.
// The AI grid is built once per season: [{ name, nation, model, skin, level, team? }]
// (a formula season's drivers are in teams of two; the player's is active.team).
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
// ones with AI data, one per model (x, x_acc and x_evo are one model, and so are
// cars with the same title or the same id words in another order, which is the
// same mod installed under two folder names: the newest year wins, then the
// shorter id).
// Tags are matched exactly, not by substring: Kunos puts a "#GTE-GT3" category
// tag on its GT2/GTE cars (Ferrari 458 GT2, Corvette C7.R...), so "contains gt3"
// would let them in. A real GT3 car has a tag that is just "gt3" / "#gt3", or
// "gt3" in its id (some have only one of the two). Any "gt2" / "gte" tag rules a
// car out.
// Also left out: Cup cars (id has a `_cup` part: one-make racers) and road cars
// (id ends `_rs`, or class "street"). They have "gt3" in their names but aren't
// GT3 race cars, so they'd fill the grid with the wrong machines.
const isCup = c => /_cup(_|$)/i.test(c.id);
const isRoad = c => /_rs$/i.test(c.id) || low(c.carClass) === 'street';
const tagIs = (c, name) => (c.tags || []).some(t => low(String(t).replace(/^#/, '')) === name);
const isGt3 = c => !isCup(c) && !isRoad(c) && !tagIs(c, 'gt2') && !tagIs(c, 'gte')
  && (tagIs(c, 'gt3') || /gt3/i.test(c.id) || low(c.carClass) === 'gt3');
const modelKey = id => low(id).replace(/_(acc|evo\d*)$/, '');
const titleKey = c => low(c.title).replace(/[^a-z0-9]/g, '');
// The id's underscore-separated words, sorted: the same words in another order,
// e.g. bm_amg_evo_2020_gt3 and bm_amg_evo_gt3_2020, when the two copies carry
// differently worded titles.
const idWords = c => modelKey(c.id).split('_').filter(Boolean).sort().join('_');
export function gt3Cars(cars) {
  const player = cars.filter(isGt3);
  const withAi = player.filter(c => c.ai);
  // Cars sharing a modelKey or a title are one model: group them (union-find).
  const parent = withAi.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seen = new Map();
  withAi.forEach((c, i) => {
    for (const k of [`id:${modelKey(c.id)}`, `words:${idWords(c)}`, titleKey(c) && `title:${titleKey(c)}`]) {
      if (!k) continue;
      if (seen.has(k)) parent[find(i)] = find(seen.get(k)); else seen.set(k, i);
    }
  });
  const best = new Map();
  withAi.forEach((c, i) => {
    const g = find(i), had = best.get(g);
    const newer = !had || Number(c.year) > Number(had.year) || (Number(c.year) === Number(had.year) && c.id.length < had.id.length);
    if (newer) best.set(g, c);
  });
  return { player, models: [...best.values()] };
}

// Formula cars: single-seaters tagged as Grand Prix / F1 / Formula cars, or of
// an "F1" class. Plain "singleseater" isn't enough (hillclimb specials, LMP3s,
// a safety car and Formula Mazda-type trainers carry it too), nor is Formula E.
const isSingle = c => ['singleseater', 'single seater', 'openwheel', 'open wheeler'].some(n => tagIs(c, n));
const isFormula = c => isSingle(c) && !tagIs(c, 'formula e')
  && (['gp', 'f1', 'formula 1', 'formula'].some(n => tagIs(c, n)) || /\bf1\b/i.test(c.carClass || ''));
// A pack: cars released as one grid (asr_1991_ferrari_643, asr_1991_williams_fw14...),
// the same first two id words and the same year. Kunos' own (ks_) aren't a pack.
const packKey = c => {
  const w = low(c.id).split('_');
  return w.length > 2 && w[0] !== 'ks' && c.year ? `${w[0]}_${w[1]}|${c.year}` : '';
};
// player: every formula car with a grid to race (a team of its own in
// teamsFor, so it has AI data too). models: the ones with AI data.
export function formulaCars(cars) {
  const all = cars.filter(isFormula);
  const models = all.filter(c => c.ai);
  const player = all.filter(c => teamsFor(c, models).some(t => t.model === c.id));
  return { player: player.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0)), models };
}

// Skins as teams. Driver liveries of one team share a first word
// (MCL39_4_Norris, MCL39_81_Piastri; numbers before it skipped: 00_fh_2024_24):
// when some do, that word is the team. Otherwise each skin is a team.
const teamWord = s => String(s).split(/[_\s-]+/).find(w => /[a-z]/i.test(w)) || '';
function skinTeams(model, skins) {
  const groups = new Map();
  for (const s of skins) {
    const k = low(teamWord(s));
    groups.set(k, [...(groups.get(k) || []), s]);
  }
  if (![...groups.values()].some(g => g.length > 1)) return skins.map(s => ({ model, skins: [s], name: prettySkin(s) }));
  return [...groups.values()].map(g => {
    const w = teamWord(g[0]);
    return { model, skins: g, name: /\d/.test(w) ? w.toUpperCase() : prettySkin(w) };
  });
}

// The teams of a formula season in `car`, two drivers each, as in F1. In a pack
// of 3 or more cars with AI, each car is a team (its first two skins its two
// drivers', named by its title less the pack's shared "ASR Formula 1991 - ");
// otherwise the whole grid is `car` (it needs AI) and its skins make the teams.
export function teamsFor(car, models) {
  const key = packKey(car);
  const pack = key ? models.filter(m => packKey(m) === key) : [];
  const skinsOf = m => (m.skins.length ? m.skins.map(s => s.id) : ['']);
  if (pack.length >= 3) {
    // The "... - " most of the pack's titles start with (one may be titled otherwise).
    const heads = pack.map(m => String(m.title || '')).map(t => (t.includes(' - ') ? t.slice(0, t.lastIndexOf(' - ') + 3) : ''));
    const head = heads.filter(h => h && heads.filter(x => x === h).length > 1)[0] || '';
    const name = m => (head && String(m.title).startsWith(head) ? String(m.title).slice(head.length) : m.title || m.id);
    return pack.map(m => ({ model: m.id, skins: skinsOf(m).slice(0, 2), name: name(m) }));
  }
  const own = models.find(m => m.id === car.id);
  return own ? skinTeams(own.id, skinsOf(own)) : [];
}

// A formula grid: `size` cars in teams of two. The player's team (the car and
// skin chosen) has one AI teammate; the other teams follow, shuffled, every team
// once before any comes back (a car with fewer skins than the grid needs).
// Each driver has a `team` name; names and levels as buildGrid.
export function buildTeamGrid(teams, { car, skin, size, level, rand = Math.random }) {
  const mine = playerTeam(teams, car, skin);
  if (!mine) return [];
  const seats = [{ team: mine, skin: mine.skins.find(s => s !== skin) || skin }];
  const others = shuffle(teams.filter(t => t !== mine), rand);
  const pool = others.length ? others : [mine];
  while (seats.length < size) for (const t of pool) for (let k = 0; k < 2 && seats.length < size; k++) seats.push({ team: t, skin: t.skins[k % t.skins.length] });
  const names = shuffle(NAMES, rand);
  return seats.slice(0, size).map(({ team, skin: s }, i) => {
    const [name, nation] = names[i % names.length].split(',');
    return { name, nation, model: team.model, skin: s, team: team.name, level: Math.min(100, Math.round(level - 3 + rand() * 6)) };
  });
}
// The player's team: the one in their car and skin, else the first in their car.
export const playerTeam = (teams, car, skin) => teams.find(t => t.model === car && t.skins.includes(skin)) || teams.find(t => t.model === car) || null;
// A skin folder as a team name: "red_bull_racing_01" → "Red Bull Racing".
export const prettySkin = id => String(id || '').replace(/[_-]+/g, ' ').replace(/\b\d+\b/g, '').replace(/\s+/g, ' ').trim().replace(/\b\w/g, m => m.toUpperCase()) || 'Team';

// Touring cars: a grid is one rulebook's cars, as a real touring car series is
// (TCR, or a BTCC era: NGTC from 2011, the 2000s, Super Touring and before), so a
// car's group is what it races against. '' for any other car.
export function touringGroup(c) {
  if (tagIs(c, 'tcr') || low(c.carClass) === 'tcr' || /(^|_)tcr(_|$)/i.test(c.id)) return 'TCR';
  if (!['btcc', 'ngtc'].some(n => tagIs(c, n)) && !/btcc|ngtc/i.test(c.id)) return '';
  const y = Number(c.year) || 0;
  return y >= 2011 ? 'BTCC NGTC' : y >= 2001 ? 'BTCC 2000s' : 'BTCC 1990s';
}
// The models a touring season in `car` races: its group's cars with AI data.
export const touringModels = (car, models) => models.filter(m => touringGroup(m) && touringGroup(m) === touringGroup(car));
// player: touring cars with a grid (their group has a car with AI); models: those with AI.
export function touringCars(cars) {
  const all = cars.filter(c => touringGroup(c) && !isRoad(c));
  const models = all.filter(c => c.ai);
  const player = all.filter(c => touringModels(c, models).length);
  return { player: player.sort((a, b) => touringGroup(a).localeCompare(touringGroup(b)) || String(a.title).localeCompare(String(b.title))), models };
}

// A season's cars: { player, models } for its category ("gt3", "formula" or "touring").
export const seasonCars = (season, cars) => (season.category === 'formula' ? formulaCars(cars) : season.category === 'touring' ? touringCars(cars) : gt3Cars(cars));

// Race laps for about `minutes` of racing on a track `length` long
// (ui_track.json: "5793 m", "7.0 km", "5,8km", "2.176 miles"; unknown: 5 km), at `kmh`, the
// season's average speed (a GT3 car's 175 km/h on these circuits by default).
// At least 3.
export function raceLaps(minutes, length, kmh = 175) {
  const m = /([\d.,]+)\s*(km|mi|m)?/i.exec(String(length || ''));
  let km = m ? Number(m[1].replace(',', '.')) : 0;
  if (m && low(m[2]) === 'mi') km *= 1.609;
  else if (m && (low(m[2]) === 'm' || km > 100)) km /= 1000;
  if (!(km > 0.5)) km = 5;
  return Math.max(3, Math.round(minutes * kmh / 60 / km));
}

const shuffle = (list, rand) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// The season's AI grid: `size` cars (at most `perModel` per model, 2 by default),
// every model once before any gets a second; a model's cars wear different skins
// while it has them. Names from NAMES, no repeats; AI level `level` ± 3 (at most 100).
export function buildGrid(models, { size, level, perModel = 2, rand = Math.random }) {
  const order = shuffle(models, rand), picks = [];
  for (let pass = 0; pass < perModel; pass++) for (const m of order) if (picks.length < size) picks.push(m);
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

// Car index (race_out.json: 0 the player, 1..n the grid in race.ini order) to name.
const nameOf = (active, car) => (car === 0 ? PLAYER : active.grid[car - 1]?.name || `#${car}`);

// The fastest in a session (qualifying: pole; the race: fastest lap): its
// bestLaps, else its laps (cut laps don't count). '' when it has neither.
function poleOf(active, quali) {
  const laps = quali?.bestLaps?.length ? quali.bestLaps : (quali?.laps || []).filter(l => !l.cuts);
  const best = laps.filter(l => l.time > 0).sort((a, b) => a.time - b.time)[0];
  return best ? nameOf(active, best.car) : '';
}

// A round's result from race_out.json, or null and why. A race counts when its
// leader covered the race's laps (otherwise the player left early and AC ended
// the session) and the player is in the result within 2 laps of the leader.
// AC sometimes writes the race session with lapstotal empty (and at times its
// laps list too; util.js readLapsIni, academy.js readAcResult): then each car's
// laps are counted from `laps`, and `playerLaps` (the laps in out/laps.ini,
// read by the caller) stands in for the player's. With no count for anyone, the
// race counts only if the player is in the result and did about all its laps.
export function scoreRound(season, active, out, round, playerLaps = 0) {
  const sessions = out?.sessions || [];
  const race = [...sessions].reverse().find(s => Number(s.type) === 3);
  if (!race) return { result: null, reason: 'no race session in race_out.json' };
  const order = race.raceResult || [];
  const total = race.lapsCount || 1;
  let laps = (race.lapstotal || []).map(Number);
  if (!laps.some(n => n > 0)) {
    laps = [];
    for (const l of race.laps || []) { const c = Number(l.car ?? 0); laps[c] = (laps[c] || 0) + 1; }
  }
  if (!(laps[0] > 0) && playerLaps > 0) laps[0] = playerLaps;
  if (!laps.some(n => n > 0)) return { result: null, reason: 'race not finished (no lap counts in race_out.json)' };
  // Only the player's laps known (laps.ini): no leader's count to check against.
  const onlyPlayer = laps.every((n, c) => c === 0 || !(n > 0));
  const leader = onlyPlayer ? total : laps[order[0]] || 0;
  if (!order.length || (!onlyPlayer && leader < total)) return { result: null, reason: `race not finished (leader ${leader} of ${race.lapsCount} laps)` };
  if (!order.includes(0) || (laps[0] || 0) < leader - 2) return { result: null, reason: `race not finished (you did ${laps[0] || 0} of ${leader} laps)` };
  const quali = [...sessions].reverse().find(s => Number(s.type) === 2);
  const pole = poleOf(active, quali);
  const pos = order.indexOf(0) + 1;
  // A fastest lap point (season.fastestLap) when the race session has its laps.
  const fastest = season.fastestLap ? poleOf(active, race) : '';
  const points = (season.points[pos - 1] || 0) + (pole === PLAYER ? season.pole || 0 : 0) + (fastest === PLAYER ? season.fastestLap : 0);
  return { result: { round, pos, pole, ...(fastest ? { fastest } : {}), points, order: order.map(c => nameOf(active, c)), at: Date.now() }, reason: '' };
}

// Everyone's points over the saved rounds, best first: more points, then more
// wins, then the better best finish.
export function standings(season, active) {
  const rows = new Map([[PLAYER, { name: PLAYER, car: active.car, team: active.team || '', points: 0, wins: 0, best: 99, player: true }]]);
  for (const g of active.grid) rows.set(g.name, { name: g.name, car: g.model, team: g.team || '', points: 0, wins: 0, best: 99, player: false });
  for (const r of active.results || []) {
    r.order.forEach((name, i) => {
      const row = rows.get(name);
      if (!row) return;
      row.points += season.points[i] || 0;
      if (i === 0) row.wins++;
      row.best = Math.min(row.best, i + 1);
    });
    if (rows.has(r.pole)) rows.get(r.pole).points += season.pole || 0;
    if (r.fastest && rows.has(r.fastest)) rows.get(r.fastest).points += season.fastestLap || 0;
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.best - b.best);
}
