# Championships, step 1: a GT3 endurance season (Assetto Corsa)

Date: 2026-10-31
Status: design approved in conversation, awaiting spec review

## Goal

A new **Championships** page where the player runs a season of single races
against an AI grid in Assetto Corsa, following a real GT3 series calendar, with
points and standings carried across rounds. Step 1 is one single-class series,
built so later series (formula, then multi-class endurance) are new data files
rather than new code.

## Decisions

| Topic | Decision |
|---|---|
| Series | GT World Challenge Europe **Endurance Cup 2026**, shipped under a generic name ("GT Endurance Cup 2026") with the real circuits |
| Calendar | Paul Ricard, Monza, Spa-Francorchamps, Nürburgring, Portimão (5 rounds) |
| Round format | Optional 10 min practice, 10 min qualifying, timed race. Race length is chosen once per season: 20, 30, 45 or 60 min (default 30) |
| Player car | One GT3 car and skin for the whole season |
| AI grid | 15, 20 or 25 AI cars (default 20), mixed across installed GT3 models, at most 2 per model, fixed for the season |
| Missing track | Before the season starts: pick a substitute installed track (with AI) or drop the round |
| What counts | A finished race saves a result. Quitting before the flag saves nothing, and the round can be run again |
| Points | 25-18-15-12-10-8-6-4-2-1 for places 1–10, +1 for pole (fastest in qualifying). Same table every round |
| Seasons | One active season. Abandon (with confirmation) is allowed. Finished seasons go to a history list |
| Approach | A separate module that reuses Academy's race.ini writer, AC start and result reading |
| Page layout | "Season dashboard": calendar and standings side by side, Start on the next round |

Real driver names are not used: AI drivers come from a built-in pool of
invented names. Series trademarks ("GT World Challenge", "Fanatec", "SRO") are
not used in the UI.

## Data: the season file

`resources/data/championships/gtwc-endurance-2026.json`

```json
{
  "id": "gt-endurance-2026",
  "name": "GT Endurance Cup 2026",
  "category": "gt3",
  "points": [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
  "pole": 1,
  "rounds": [
    { "name": "Paul Ricard", "country": "FR", "tracks": [{ "id": "jt_paul_ricard", "layout": "gt" }, { "match": "ricard|castellet" }] },
    { "name": "Monza", "country": "IT", "tracks": [{ "id": "monza" }, { "id": "ks_monza66", "layout": "full" }, { "match": "monza" }] },
    { "name": "Spa-Francorchamps", "country": "BE", "tracks": [{ "id": "spa" }, { "match": "spa|francorchamps" }] },
    { "name": "Nürburgring", "country": "DE", "tracks": [{ "id": "ks_nurburgring", "layout": "layout_gp_a" }, { "match": "nurburgring|nuerburgring" }] },
    { "name": "Portimão", "country": "PT", "tracks": [{ "id": "algarve" }, { "match": "portimao|algarve" }] }
  ]
}
```

A `tracks` entry is either a known track folder `id` (optionally with the
preferred `layout`) or a `match` regular expression tried against folder names
and track titles. Entries are tried in order.

## Module: `resources/js/championships.js` (no DOM)

### `loadSeasons()`
Reads every file in `data/championships/`. Returns the season objects.

### `matchRound(round, tracks)`
`tracks` is the AC track list the launcher already scans (folder id, title,
layouts). Returns `{ best: { track, layout } | null, options: [{ track, layout }] }`.

1. Known ids in order; the named layout when installed, else the track's
   default layout.
2. Then `match` against folder ids and titles.
3. A candidate counts only if that layout has `ai/fast_lane.ai`.

`options` holds every counting candidate, so setup can offer a dropdown.

### `gt3Cars(cars)`
From the scanned AC car list: cars whose id, `ui_car.json` class or tags
mention GT3, and that have AI data (`data.acd` or `data/ai.ini`). Duplicates of
one model (`x` and `x_acc`, `x` and `x_evo`) keep the one with the newest year
in `ui_car.json` (ties: the plain id). Returns the de-duplicated list, plus the
full list for the player's car picker.

### `buildGrid(models, { size, playerModel, level, names })`
Spreads `size` AI cars across `models`: every model once before any model gets
a second car, at most 2 per model. Each car gets a different installed skin of
its model where there are enough, a driver name and nationality from the name
pool (no repeats), and a fixed AI level of `level ± 3` (capped at 100).

### `startRound(paths, season, active, index)`
Writes `cfg/race.ini` through Academy's `writeAcEvent` with:
- sessions: practice (if enabled, 10 min), qualifying (10 min), race (`TIME` =
  the season's race length, plus 1 extra lap, as AC does timed races)
- the round's chosen track and layout
- the player's car and skin, and the season grid as `CAR_1…n`

Then starts AC with `startAcs`, which waits for Steam to be signed in first.
The caller tags the launch with `nextLaunch.ac = { championship: { seasonId, round } }`.

### `scoreRound(season, active, raceOut)`
From a parsed `race_out.json`:
- the race session (type 3). No race session means **no result**.
- finished: the player is in `raceResult` and completed at least the leader's
  laps minus 2 (a lapped car still finishes). Anything less is a quit: **no
  result**. The rule is checked against the sample race_out.json files below
  before it's relied on.
- finishing order from `raceResult`, mapped to grid names (car 0 is the player)
- pole: fastest lap in the qualifying session (type 2). If there is no
  qualifying session, no pole point.
- points from the season table, plus the pole point

Returns `{ round, pos, pole, points, order: [names], at }`, or `null` with a
reason for the log and the toast.

### `standings(season, active)`
Points per driver (player and AI) over the saved rounds. Ties: more wins, then
the better best finish. Returns rows best first:
`[{ name, car, points, wins, player }]`.

### Progress storage
Launcher storage key `championships`:

```js
{
  active: {
    seasonId, startedAt, car, skin,
    settings: { gridSize, level, aggression, raceMinutes, practice },
    rounds: [{ name, track, layout, dropped }],
    grid: [{ name, nation, model, skin, level }],
    results: [{ round, pos, pole, points, order, at }]
  } | null,
  history: [{ seasonId, car, rank, points, at }]
}
```

## UI (in `resources/js/main.js`, styles in `resources/css/app.css` as `.ch-*`)

- **Nav:** a **Championships** button between Academy and AC Online. The game
  sidebar is hidden, as on Academy and AC Online.
- **AC not installed:** the same empty state as AC Online. With ACC, EVO or
  Rally picked in the sidebar: the same in-game note and Start button.
- **No season:** the series card with its 5 rounds, each "have it" with the
  matched track or "missing". A **New season** button, and past seasons from
  history.
- **Setup dialog:** car and skin, grid size, AI strength (default 90) and
  aggression, race length, practice on/off, and the rounds with matched track,
  layout dropdown, and for missing rounds a substitute picker (any installed
  track with AI) or Drop. **Start season** builds and saves the grid.
- **Season running (dashboard layout):**
  - header: series, car, grid size, race length, position and points
  - calendar: done rounds with position, points and pole; the next round
    highlighted with **▶ Start round**; later rounds dimmed; dropped rounds
    struck out
  - standings: full table, the player's row highlighted, each driver's car
  - **Abandon season** (with confirmation)
- **While AC runs:** Start round turns into Close (the existing running-game
  button). The page refreshes when the result is saved.
- **After a round:** a card with the finishing place, points and the new
  championship position with the change. After the last round: final standings,
  the season moves to history.

## Hook into the launcher

`gameClosed('ac', l)` in `main.js` already handles `l.academy`. It also calls
`championshipClosed(l)` when `l.championship` is set:
1. read `race_out.json` with the existing `readRaceOut` (since the launch time)
2. `scoreRound`; on `null`, toast "Race not finished: round N can be run again."
3. otherwise save the result, show the results card, and finish the season
   after the last round

## Errors

- No GT3 car with AI installed: the series card says so and New season is
  disabled.
- Fewer than 15 distinct GT3 models: the grid sizes offered stop at
  2 × model count.
- A round's track was removed after the season started: Start round shows
  "track not installed" with the substitute picker.
- race_out.json missing or unreadable: no result, logged by `readRaceOut`.

## Testing

- `--check-championships` self-test (run with `--snapshots=<dir>`, like
  `--check-online`):
  - loads the season and logs each round's match and options
  - logs the GT3 car list and a built grid of 20
  - writes race.ini into a sandbox cfg folder and logs it
  - scores sample race_out.json files saved from real test runs (a finished
    race, a race quit early, a race without qualifying) and logs results and
    standings
  - screenshots: no season, mid-season, finished
- Manual: one real round raced end to end in AC.

## Out of scope for step 1

- Other series (formula, WEC, IMSA), multi-class scoring
- Spa's 6 h / 12 h points, double points
- Real driver names, team names, liveries matched to the real entry list
- Downloading missing tracks or cars
- More than one active season
