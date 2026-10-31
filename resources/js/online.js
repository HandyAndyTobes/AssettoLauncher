// Assetto Corsa online: the public server list from Kunos's lobby, each server's
// own details, and joining one, the way AC's launcher does it
// (launcher\themes\default\modules\online\online.js and AssettoCorsa.exe).
// The lobby answers only AC's launcher: it wants its User-Agent and the player's
// Steam id. Hosts in AC's order: the main lobby, the fallback, assettocorsa.net.
// A lobby server: { ip, port (UDP), tport (TCP), cport (HTTP), name, clients,
//   maxclients, track, cars[], session (0 booking, 1 practice, 2 qualify, 3 race),
//   sessiontypes[], durations[] (minutes, laps for an untimed race), timed,
//   timeleft (s), country [name, code], pass, pickup (false: booking only) }.
// Its details (http://ip:cport/JSON|guid): { Cars: [{ Model, Skin, DriverName,
//   DriverNation, IsConnected, IsEntryList }] }, a slot per car.
// Favourites and recent servers are the launcher's own, the first time seeded
// from Content Manager's (%LOCALAPPDATA%\AcTools Content Manager\Online Servers).
import { join, readText, readTextAnyEncoding, writeText, exists, run, log, storageGet, storageSet, mapLimit, ensureDir, safeUrl, CURL, NULL_DEV, IS_LINUX } from './util.js';
import { appCacheDir } from './games.js';
import { setIni, removeSections, parseIni } from './ini.js';
import { startAcs } from './quickdrive.js';

const USER_AGENT = 'Assetto Corsa Launcher';
// File hosts (MediaFire) send other agents a page without the file's link.
const BROWSER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const LOBBIES = ['http://93.57.10.21', 'http://aclobby2.grecian.net:10080', 'http://lobby.assettocorsa.net'];
const LIST_EVERY = 60 * 1000; // the lobby turns away clients that ask too often

export const SESSION_NAMES = { 0: 'Booking', 1: 'Practice', 2: 'Qualifying', 3: 'Race' };

// The player's Steam id (64-bit, as text): the most recent login in Steam's
// config\loginusers.vdf. '' when Steam has none.
let steamIdCache = null;
export async function steamId(steamPath) {
  if (steamIdCache != null) return steamIdCache;
  const vdf = (steamPath && (await readText(join(steamPath, 'config/loginusers.vdf')))) || '';
  const users = [...vdf.matchAll(/"(7656\d{13})"\s*\{([^}]*)\}/g)].map(m => ({ id: m[1], recent: /"MostRecent"\s*"1"/i.test(m[2]) }));
  steamIdCache = (users.find(u => u.recent) || users[0])?.id || '';
  return steamIdCache;
}

// The answer goes to a file and is read back as UTF-8: through the console,
// player names with emoji or accents can come back mangled, and then the call
// never returns. A request that hangs anyway gives up after `timeout` + 5 s.
// curl runs as a spawned process: execCommand holds up every other native call
// until it returns, so the saved servers being checked (4 s each when offline)
// would keep a server's dialog waiting for minutes.
// onStart(process): its { id, pid }, to stop it (stopTree); onOut(text): its
// output as it comes.
function spawn(cmd, onStart, onOut) {
  return new Promise(resolve => {
    // Events can come in before spawnProcess answers with the id: kept till then.
    let id = null, out = '';
    const early = [];
    const take = d => {
      if (d.id !== id) return;
      if (d.action === 'stdOut') { out += d.data; onOut?.(d.data); }
      if (d.action === 'exit') { Neutralino.events.off('spawnedProcess', on); resolve({ stdOut: out }); }
    };
    const on = e => (id == null ? early.push(e.detail) : take(e.detail));
    Neutralino.events.on('spawnedProcess', on);
    Neutralino.os.spawnProcess(cmd).then(p => { id = p.id; onStart?.(p); early.splice(0).forEach(take); }).catch(e => {
      Neutralino.events.off('spawnedProcess', on);
      log(`spawn failed: ${cmd} ${JSON.stringify(e)}`);
      resolve({ stdOut: '' });
    });
  });
}

let fileNo = 0;
async function curl(url, { timeout = 5, out = '', agent = USER_AGENT } = {}) {
  const file = out || join(await appCacheDir('online'), `answer-${fileNo++ % 32}.json`);
  const call = spawn(`${CURL} -s -L --compressed --max-time ${timeout} -A "${agent}" -o "${file}" -w "%{http_code}" "${url}"`);
  const giveUp = (value, s) => new Promise(res => setTimeout(() => res(value), s * 1000));
  const r = await Promise.race([call, giveUp({ stdOut: '' }, timeout + 5)]);
  const status = Number(String(r.stdOut).trim().slice(-3)) || 0;
  if (out) return { status, text: '' };
  const text = status === 200 ? (await Promise.race([readTextAnyEncoding(file), giveUp(null, 5)])) || '' : '';
  Neutralino.filesystem.remove(file).catch(() => {});
  return { status, text };
}

// A spawned command runs under a shell (cmd /c, sh -c): ending only that would
// leave curl downloading, so its whole tree is ended.
const stopTree = p => (IS_LINUX
  ? run(`pkill -TERM -P ${p.pid}; kill -TERM ${p.pid}`)
  : run(`taskkill /F /T /PID ${p.pid}`));

// The lobby's server list, or the last one fetched when asked again within a
// minute (or when the lobby can't be reached: then `stale` is set).
// { servers, at (ms), stale }.
let listCache = null;
export async function lobbyList(steamPath, { force = false } = {}) {
  if (listCache && Date.now() - listCache.at < LIST_EVERY && !(force && listCache.stale)) return listCache;
  const guid = await steamId(steamPath);
  if (!guid) throw new Error("Couldn't find your Steam account (Steam\\config\\loginusers.vdf). Sign in to Steam once and try again.");
  const file = join(await appCacheDir('online'), 'lobby.json');
  for (const host of LOBBIES) {
    const { status } = await curl(`${host}/lobby.ashx/list?guid=${guid}`, { timeout: 20, out: file });
    const text = status === 200 ? await readTextAnyEncoding(file) : null;
    let servers = null;
    try { servers = JSON.parse(text || 'null'); } catch { /* an error page */ }
    if (Array.isArray(servers)) {
      listCache = { servers: servers.filter(s => s?.ip && s.cport), at: Date.now(), stale: false };
      log(`online: ${listCache.servers.length} servers from ${host}`);
      return listCache;
    }
    log(`online: lobby ${host} answered ${status} ${String(text || '').slice(0, 80)}`);
  }
  if (listCache) return { ...listCache, stale: true };
  throw new Error("Couldn't reach the Assetto Corsa lobby. Check your connection and try again in a minute.");
}

// A server that isn't in the lobby's list (a favourite, a LAN server), from its
// own /INFO, in the lobby's shape. null when it doesn't answer.
export async function serverInfo(ip, cport) {
  const { status, text } = await curl(`http://${ip}:${cport}/INFO`, { timeout: 4 });
  if (status !== 200) return null;
  try {
    const s = JSON.parse(text);
    return { ...s, ip, cport: Number(cport), country: Array.isArray(s.country) ? s.country : ['', ''] };
  } catch { return null; }
}

// The server's slots and what CSP needs to know to join it, or null when it
// doesn't answer: { slots: [{ model, skin, driver, nation, connected }],
// features (CSP features of servers like AssettoServer: CUSTOM_UPDATE…),
// extended (it reports its weather, as Content Manager's extended servers do) }.
// A name ending in "ℹ<port>" has those details at http://ip:<port>/api/details.
const featureList = f => (Array.isArray(f) ? f : []).map(String).filter(x => /^[A-Z0-9_]+$/.test(x));
export async function serverSlots(server, guid) {
  const t0 = Date.now();
  const port = /ℹ(\d+)\s*$/.exec(String(server.name || ''))?.[1];
  let details = null;
  if (port) {
    const { status, text } = await curl(`http://${server.ip}:${port}/api/details?guid=${guid}`, { timeout: 5 });
    try { details = status === 200 ? JSON.parse(text) : null; } catch { /* not an extended server after all */ }
  }
  let json = details?.players || null;
  if (!json) {
    const { status, text } = await curl(`http://${server.ip}:${server.cport}/JSON|${guid}`, { timeout: 5 });
    try { json = status === 200 ? JSON.parse(text) : null; } catch { /* not JSON */ }
  }
  log(`online slots ${serverKey(server)}: ${json ? `${json.Cars?.length} slots` : 'no answer'}${details ? ', extended' : ''} in ${Date.now() - t0} ms`);
  if (!json) return null;
  return {
    slots: (json.Cars || []).map(c => ({ model: String(c.Model || ''), skin: String(c.Skin || ''), driver: String(c.DriverName || ''), nation: String(c.DriverNation || ''), connected: !!c.IsConnected })),
    features: featureList(details?.features || json.Features),
    extended: !!details?.currentWeatherId,
    downloads: serverDownloads(details?.content),
  };
}

// Where an extended server says its cars and track can be downloaded
// (details.content: { cars: { <id>: { url, version } }, track: { url } }):
// lower-case id => url, the track under its own id too ('track' when the
// server didn't give one). Empty urls and anything that can't go on a command
// line are left out.
function serverDownloads(content) {
  const out = new Map();
  for (const [id, c] of Object.entries(content?.cars || {})) if (safeUrl(c?.url)) out.set(id.toLowerCase(), c.url);
  if (safeUrl(content?.track?.url)) out.set('track', content.track.url);
  return out;
}

// ---------------------------------------------------------------------------
// Downloading a server's missing content, the way Content Manager does: direct
// links as they are; Google Drive, Dropbox, MediaFire and Yandex Disk sharing
// pages turned into their file's address. Mega encrypts its files in the
// browser, so those (and pages that aren't files) can only be opened there.

export const opensInBrowser = url => /^https?:\/\/(www\.)?mega\.(nz|co\.nz|io)\//i.test(url);

async function resolveDownload(url) {
  let m;
  if ((m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]+)/.exec(url))) return `https://drive.usercontent.google.com/download?id=${m[1]}&export=download&confirm=t`;
  if (/^https?:\/\/(www\.)?dropbox\.com\//i.test(url)) return /[?&]dl=0/.test(url) ? url.replace(/([?&])dl=0/, '$1dl=1') : `${url}${url.includes('?') ? '&' : '?'}dl=1`;
  if (/^https?:\/\/(www\.)?mediafire\.com\/file\//i.test(url)) {
    const { text } = await curl(url, { timeout: 20, agent: BROWSER_AGENT });
    return /href="(https:\/\/download\d*\.mediafire\.com\/[^"]+)"/.exec(text)?.[1] || '';
  }
  if (/^https?:\/\/disk\.yandex\.\w+\/[di]\//i.test(url)) {
    const { text } = await curl(`https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(url)}`, { timeout: 20 });
    try { return JSON.parse(text).href || ''; } catch { return ''; }
  }
  return url;
}

// What a downloaded file is, from its first bytes: 'zip', '7z', 'rar', 'html'
// (a web page: a login or "file not found"), or ''.
async function sniff(file) {
  const b = new Uint8Array(await Neutralino.filesystem.readBinaryFile(file, { pos: 0, size: 16 }).catch(() => new ArrayBuffer(0)));
  const ascii = String.fromCharCode(...b);
  if (ascii.startsWith('PK')) return 'zip';
  if (ascii.startsWith('7z\xBC\xAF\x27\x1C')) return '7z';
  if (ascii.startsWith('Rar!')) return 'rar';
  if (/^\s*</.test(ascii)) return 'html';
  return '';
}

// Downloads `url` into a folder of its own in the launcher's cache, as
// <name>.<zip|7z|rar>: { path, temp: true, session: folder } for the installer
// (prepareImport), which discards the folder when it's done.
// onProgress(done, total): bytes, total 0 while it isn't known; onStatus(line).
// signal (AbortSignal): stops the download, which then throws an AbortError.
export async function downloadContent(url, name, { onProgress, onStatus, signal } = {}) {
  if (opensInBrowser(url)) throw new Error('Mega links only download in the browser: open it there, then install the file.');
  onStatus?.('Finding the file');
  const direct = await resolveDownload(url);
  if (signal?.aborted) throw new DOMException('Download cancelled', 'AbortError');
  if (!safeUrl(direct)) throw new Error("Couldn't find the file behind this link: open it in the browser.");
  const dir = join(await appCacheDir('downloads'), `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`);
  await ensureDir(dir);
  const file = join(dir, 'download.part'), headers = join(dir, 'headers.txt');
  log(`online download ${name}: ${direct}`);
  let finished = false, proc = null;
  const stop = () => { if (proc && !finished) stopTree(proc); };
  signal?.addEventListener('abort', stop);
  const call = spawn(`${CURL} -s -L --retry 2 --connect-timeout 20 --max-time 3600 -A "${BROWSER_AGENT}" -D "${headers}" -o "${file}" -w "%{http_code}" "${direct}"`, p => { proc = p; if (signal?.aborted) stop(); })
    .finally(() => { finished = true; signal?.removeEventListener('abort', stop); });
  let total = 0;
  while (!finished) {
    await new Promise(r => setTimeout(r, 500));
    // The last response's length (after redirects); 0 for chunked answers.
    total = Number([...String(await readText(headers) || '').matchAll(/content-length:\s*(\d+)/gi)].pop()?.[1]) || total;
    onProgress?.((await Neutralino.filesystem.getStats(file).catch(() => null))?.size || 0, total);
  }
  const status = Number(String((await call).stdOut).trim().slice(-3)) || 0;
  if (signal?.aborted) {
    await Neutralino.filesystem.remove(dir).catch(() => {});
    log(`online download ${name}: cancelled`);
    throw new DOMException('Download cancelled', 'AbortError');
  }
  const kind = await sniff(file);
  if (status !== 200 || !['zip', '7z', 'rar'].includes(kind)) {
    await Neutralino.filesystem.remove(dir).catch(() => {});
    log(`online download ${name}: HTTP ${status}, ${kind || 'unknown'} file`);
    throw new Error(status !== 200 ? `The download failed (HTTP ${status || 'no answer'}): try opening the link in the browser.`
      : kind === 'html' ? 'The link opens a web page, not a file: open it in the browser.'
      : "The download isn't a .zip, .7z or .rar archive.");
  }
  const path = join(dir, `${name.replace(/[^\w.-]+/g, '_')}.${kind}`);
  await Neutralino.filesystem.move(file, path);
  return { path, temp: true, session: dir };
}

// How far each server is: the milliseconds its HTTP port takes to accept a
// connection (one round trip, as ping measures it). One curl for all of them,
// 64 at a time, from a config file (thousands of addresses don't fit on a
// command line). onPing(key, ms) as each answers, ms 0 when it doesn't.
// Ends when all are measured, or when `signal` aborts. `parallel`: connections
// at a time (many at once can lose a first attempt, which then reads ~1 s more).
export async function pingServers(servers, onPing, { signal, parallel = 64 } = {}) {
  const valid = servers.filter(s => /^[\w.-]+$/.test(String(s.ip)) && Number(s.cport) > 0);
  if (!valid.length || signal?.aborted) return;
  const cfg = join(await appCacheDir('online'), 'ping.cfg');
  await writeText(cfg, [
    'write-out = "%{url} %{time_connect}\\n"',
    ...valid.map(s => `url = "http://${s.ip}:${Number(s.cport)}/INFO"\noutput = "${NULL_DEV}"`),
  ].join('\n') + '\n');
  let rest = '', proc = null;
  const stop = () => proc && stopTree(proc);
  signal?.addEventListener('abort', stop);
  const t0 = Date.now();
  await spawn(`${CURL} -s --parallel --parallel-max ${parallel} --parallel-immediate --connect-timeout 2 --max-time 3 -A "${USER_AGENT}" -K "${cfg}"`, p => { proc = p; }, text => {
    const lines = (rest + text).split('\n');
    rest = lines.pop();
    for (const line of lines) {
      const m = /^https?:\/\/([^/\s]+)\/INFO\s+([\d.]+)/.exec(line.trim());
      if (m) onPing(m[1], Math.round(Number(m[2]) * 1000));
    }
  });
  signal?.removeEventListener('abort', stop);
  log(`online ping: ${valid.length} servers in ${Date.now() - t0} ms${signal?.aborted ? ' (stopped)' : ''}`);
}

// Servers that need Custom Shaders Patch give their track as
// csp/<build>/../<id>, sometimes with more flags (csp/3334/../E/../<id>), so
// AC without CSP can't find it: { id, csp (minimum build, 0 none) }.
export function serverTrack(track) {
  const m = /^csp\/(\d+)\/(?:[^/]*\/)*\.\.\/([^/]+)$/.exec(String(track || ''));
  return m ? { id: m[2], csp: Number(m[1]) } : { id: String(track || ''), csp: 0 };
}

// id => the installed { track, layout } a server's track id names, or null.
// Lobby ids are <track>-<layout>, and track folders can have dashes too.
export function trackFinder(tracks) {
  const byId = new Map(tracks.map(t => [t.id.toLowerCase(), t]));
  const memo = new Map();
  const find = lower => {
    const t = byId.get(lower);
    if (t) return { track: t, layout: t.layouts.find(l => !l.id) || t.layouts[0] };
    for (let i = lower.lastIndexOf('-'); i > 0; i = lower.lastIndexOf('-', i - 1)) {
      const t = byId.get(lower.slice(0, i));
      const layout = t?.layouts.find(l => l.id.toLowerCase() === lower.slice(i + 1));
      if (layout) return { track: t, layout };
    }
    return null;
  };
  return id => {
    const lower = String(id).toLowerCase();
    if (!memo.has(lower)) memo.set(lower, find(lower));
    return memo.get(lower);
  };
}

// Server names can end in " ℹ<port>": Content Manager's mark for a server with
// more details on that port. Not part of the name people read.
export const serverName = name => String(name || '').replace(/\s*ℹ\d+\s*$/, '').trim();
export const serverKey = s => `${s.ip}:${s.cport}`;

// ---------------------------------------------------------------------------
// Favourites and recent servers: [{ ip, cport, name }], newest first.

const cmServersDir = async () => {
  if (IS_LINUX) return '';
  const local = await Neutralino.os.getEnv('LOCALAPPDATA').catch(() => '');
  return local ? join(local, 'AcTools Content Manager/Online Servers') : '';
};

// CM's lists: one "ip:port;name" a line (the port is the server's HTTP port).
async function readCmList(name) {
  const dir = await cmServersDir();
  const text = dir ? await readTextAnyEncoding(join(dir, `${name}.txt`)) : null;
  return (text || '').split(/\r?\n/).map(l => /^\s*([\d.]+|[a-z0-9.-]+):(\d+)\s*;?(.*)$/i.exec(l)).filter(Boolean)
    .map(m => ({ ip: m[1], cport: Number(m[2]), name: m[3].trim() }));
}

export async function savedServers() {
  let saved = await storageGet('onlineServers', null);
  if (!saved) {
    saved = { favourites: await readCmList('Favourites'), recent: (await readCmList('Recent')).slice(0, 30) };
    log(`online: ${saved.favourites.length} favourites and ${saved.recent.length} recent servers from Content Manager`);
    await storageSet('onlineServers', saved);
  }
  return saved;
}

export async function toggleFavourite(server) {
  const saved = await savedServers();
  const key = serverKey(server);
  const had = saved.favourites.some(s => serverKey(s) === key);
  saved.favourites = had ? saved.favourites.filter(s => serverKey(s) !== key) : [{ ip: server.ip, cport: server.cport, name: serverName(server.name) }, ...saved.favourites];
  await storageSet('onlineServers', saved);
  return !had;
}

async function addRecent(server) {
  const saved = await savedServers();
  const key = serverKey(server);
  saved.recent = [{ ip: server.ip, cport: server.cport, name: serverName(server.name) }, ...saved.recent.filter(s => serverKey(s) !== key)].slice(0, 30);
  await storageSet('onlineServers', saved);
}

// ---------------------------------------------------------------------------
// Joining: race.ini's [REMOTE] and the player's car, as AC's launcher writes
// them, then acs.exe (start: false only writes race.ini). `car` and `skin` are installed ones (folder names), so
// nothing from the server goes into race.ini but its address and name.

export async function joinServer(paths, server, { car, skin, track = '', layout = '', password = '', features = [], extended = false, start = true, onStatus }) {
  if (!server.pickup) throw new Error('This server only takes bookings made before the session. Join it from AC or Content Manager.');
  const guid = await steamId(paths.steam);
  if (!guid) throw new Error("Couldn't find your Steam account.");
  if (start && !(await exists(join(paths.ac.install, 'acs.exe')))) throw new Error(`acs.exe not found in ${paths.ac.install}`);
  const iniPath = join(paths.ac.cfg, 'race.ini');
  let ini = await readText(iniPath);
  if (ini == null) ini = '';
  else if (!(await exists(iniPath + '.launcher-backup'))) await writeText(iniPath + '.launcher-backup', ini);
  const me = parseIni(ini).CAR_0 || {};
  const name = me.DRIVER_NAME || 'Player';

  ini = removeSections(ini, /^REMOTE$/i);
  const remote = [
    ['ACTIVE', 1], ['SERVER_IP', server.ip], ['SERVER_PORT', server.tport || server.port],
    ['SERVER_NAME', encodeURIComponent(serverName(server.name).replace(/[[\];]/g, ' '))],
    ['SERVER_HTTP_PORT', server.cport], ['REQUESTED_CAR', car], ['NAME', name], ['TEAM', ''],
    ['PASSWORD', String(password).replace(/[\r\n]/g, '')], ['GUID', guid],
    // Read by CSP, written as Content Manager writes them.
    ['__CM_EXTENDED', extended ? 1 : 0], ...(featureList(features).length ? [['__FEATURES', featureList(features).join(',')]] : []),
  ];
  for (const [k, v] of remote) ini = setIni(ini, 'REMOTE', k, v);
  for (const [k, v] of [['MODEL', car], ['SKIN', skin], ['TRACK', track], ['CONFIG_TRACK', layout]]) ini = setIni(ini, 'RACE', k, v);
  for (const [k, v] of [['SETUP', ''], ['MODEL', '-'], ['SKIN', skin], ['DRIVER_NAME', name]]) ini = setIni(ini, 'CAR_0', k, v);
  ini = setIni(ini, 'REPLAY', 'ACTIVE', '0');
  ini = setIni(ini, 'BENCHMARK', 'ACTIVE', '0');
  await writeText(iniPath, ini);
  log(`online join ${serverKey(server)} ${car}/${skin}${password ? ' with password' : ''}`);
  if (!start) return;
  await addRecent(server);
  await startAcs(paths, onStatus);
}
