// Championships: the parts that don't touch the game, the files or the page
// (championships.js does those), so they can be tested on their own
// (tests/championship-core.test.mjs, `node --test tests/*.test.mjs`).
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
// Left out: Cup cars (id has a `_cup` part: one-make racers) and road cars (id
// ends `_rs`, or class "street"). They have "gt3" in their names but aren't
// GT3 race cars, so they'd fill the grid with the wrong machines.
const isCup = c => /_cup(_|$)/i.test(c.id);
const isRoad = c => /_rs$/i.test(c.id) || low(c.carClass) === 'street';
const isGt3 = c => !isCup(c) && !isRoad(c) && (/gt3/i.test(c.id) || /gt3/i.test(c.carClass || '') || (c.tags || []).some(t => /gt3/i.test(t)));
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
