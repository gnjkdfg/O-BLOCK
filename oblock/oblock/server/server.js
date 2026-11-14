'use strict';
/* O-Block game server — private online matches (create / join by room code), server-authoritative.

   The server is the only one allowed to change: health and damage, kills and deaths, respawns, the ZA bag and every
   player's hold time, match results, rewards (cash / XP, paid once per match), purchases and ownership, weapon unlocks,
   character choice, items (trunk loot, using items), car-hop cash and developer actions. Clients only send requests
   (positions, shots with the hits they think they made, "pick up the bag", "buy", ...). Each request is checked
   against shared.json — the same weapon table, progression, spawn points and map colliders the game uses — and
   rejected if it does not hold up (wrong / locked weapon, firing faster than the weapon can, empty magazine, out of
   range, no line of sight through the map, too far to pick up, not enough cash, ...).

   Bots: when the host turns bots on, the host's browser runs the bot AI (it needs the 3D scene) and streams bot
   positions; every bot shot is validated exactly like a player's, and bot health lives on the server.

   Run:  npm install   then   node server.js   (PORT, default 8787).  Developer accounts: DEV_TOKENS=token1,token2
   (comma-separated player tokens) — only those accounts may use developer commands, and every one is logged to
   devlog.jsonl. No codes exist anywhere in the client. */
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const S = JSON.parse(fs.readFileSync(path.join(__dirname, 'shared.json'), 'utf8'));
const PORT = +process.env.PORT || 8787;
// Developer password: only ever in this process's environment (DEV_PASSWORD), never in the game files. Compared as
// SHA-256 digests with a constant-time check; 3 wrong tries per connection, then an increasing wait.
const DEV_PW_HASH = process.env.DEV_PASSWORD ? crypto.createHash('sha256').update(process.env.DEV_PASSWORD).digest() : null;
// built-in fallback (same as the game): salted PBKDF2 fingerprint of the developer password, never the password itself
const DEV_KEY = { salt:'ba20b3f8355b6ec41e6375b69e0b2c93', iter:150000, dk:'8647ed4f59b77937300e0580ce9da70f8d6eec19e33d87e7ed697112421a50d8' };
function devPwOk(pw){
  if (DEV_PW_HASH) return crypto.timingSafeEqual(crypto.createHash('sha256').update(pw).digest(), DEV_PW_HASH);
  const got = crypto.pbkdf2Sync(pw, Buffer.from(DEV_KEY.salt, 'hex'), DEV_KEY.iter, 32, 'sha256');
  return crypto.timingSafeEqual(got, Buffer.from(DEV_KEY.dk, 'hex'));
}
const DEV_TOKENS = new Set((process.env.DEV_TOKENS || '').split(',').map(s => s.trim()).filter(Boolean));
const PROFILE_FILE = process.env.PROFILE_FILE || path.join(__dirname, 'profiles.json');
const DEVLOG = path.join(__dirname, 'devlog.jsonl');
const ALLOW_TELEPORT = process.env.ALLOW_TELEPORT === '1';   // automated tests only: skips the movement speed check
const TICK = 1 / 20;                      // simulation + snapshot rate
const RESPAWN = 3.5, MAX_SPEED = 13;      // m/s (sprint 7.4 * nic 1.35 ≈ 10, e-bike 9.5) + margin

// ------------------------------------------------------------------ profiles (persistent, server-side)
// Stored by store.js: Postgres when DATABASE_URL is set (survives restarts on free hosting), otherwise an atomic JSON file.
const socketsOf = tok => [...wss.clients].filter(c => c.token === tok && c.readyState === 1);
const store = require('./store').createStore({ file:PROFILE_FILE, url:process.env.DATABASE_URL,
  onSaved:(tok, rev) => { for (const c of socketsOf(tok)) send(c, { t:'saved', rev }); },
  onFail:(tok, n, why) => { console.error('save failed (' + n + '):', why); for (const c of socketsOf(tok)) send(c, { t:'savefail', tries:n }); } });
const saveProfiles = () => store.soon();
const newProfile = () => ({ cash:0, xp:0, owned:{switch:false, jeff:false, cop:false}, paid:[], v6:true, history:[] });
// recent matches (newest first): what was earned, the result, mode and difficulty
function addHistory(p, h){ p.history = [Object.assign({ at:Date.now() }, h)].concat(p.history || []).slice(0, 20); }
const levelOf = xp => 1 + Math.floor(Math.max(0, xp) / S.prog.xpPerLevel);
async function profileOf(token){ const p = await store.load(token, newProfile); migrateV6(p); p.history = p.history || [];
  Object.defineProperty(p, '_tok', { value:token, enumerable:false, configurable:true }); return p; }
/* Profile backup. Free hosting (Render) wipes this server's disk whenever it restarts or wakes up, which used to erase
   everyone's online cash, levels and purchases (Glock Switch, characters, attachments). So every profile update also
   carries a SEAL: the profile signed by the server (HMAC-SHA256, bound to the player's token). The game keeps the latest
   seal and hands it back when it connects; if this server lost the profile (or has an older one) it restores it.
   A seal can't be edited or used by someone else. Set PROFILE_SECRET on the host to keep the signing key private. */
const PROFILE_SECRET = process.env.PROFILE_SECRET || 'oblock-profile-seal-v1';
const tokHash = t => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 32);
function sealOf(p){ if (!p._tok) return null; const d = JSON.stringify({ cash:p.cash, xp:p.xp, owned:p.owned, v:1 });
  return { d, s:crypto.createHmac('sha256', PROFILE_SECRET).update(tokHash(p._tok) + '|' + d).digest('hex') }; }
function restoreSeal(p, token, r){
  try {
    if (!r || typeof r.d !== 'string' || typeof r.s !== 'string' || r.d.length > 4000) return false;
    const want = crypto.createHmac('sha256', PROFILE_SECRET).update(tokHash(token) + '|' + r.d).digest();
    const got = Buffer.from(r.s, 'hex'); if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return false;
    const d = JSON.parse(r.d); if (!Number.isFinite(d.xp) || !Number.isFinite(d.cash) || typeof d.owned !== 'object') return false;
    const pristine = p.xp === 0 && p.cash === 0 && !Object.values(p.owned || {}).some(Boolean);
    if (!(d.xp > p.xp || pristine)) return false;            // XP only goes up, so an old seal can't undo a newer purchase
    p.xp = Math.max(0, d.xp); p.cash = Math.max(0, d.cash); p.owned = Object.assign({ switch:false, jeff:false, cop:false }, d.owned); p.v6 = true;
    saveProfiles(); return true;
  } catch (e){ return false; }
}
function pubProfile(p){ return { cash:p.cash, xp:p.xp, level:levelOf(p.xp), owned:p.owned, seal:sealOf(p), history:(p.history || []).slice(0, 10), prefs:p.prefs || null, rev:p.rev || 0 }; }
// outfit colours: just names from the game's colour lists (checked again by every client)
const cleanLook = l => { l = l && typeof l === 'object' ? l : {}; const ok = v => typeof v === 'string' && /^[A-Za-z ]{1,16}$/.test(v); return { jacket:ok(l.jacket) ? l.jacket : 'Black', pants:ok(l.pants) ? l.pants : 'Black' }; };
function canUse(p, w){ return !!S.weapons[w] && (S.prog.price[w] === undefined || !!(p && p.owned && p.owned[w])); }   // guns are free unless priced (AR-15 $10,000); attachments are bought
// $25 (S.prog.cash.level) for every level gained; returns the cash paid
/* Reward rules for a room (shown to the host before the match, fixed once it starts because settings lock):
   - bot difficulty, when bots play: Easy 0.5x, Normal 1x, Hard 1.5x, Expert 2x
   - easy-farm settings are reduced: low health (under 100) 0.75x
   - the host's own reward setting (Off / Half / Normal) and, in Gang Wars, the team's reward setting
   Kills of the same real player more than 3 times in a minute pay nothing (no farming a friend). */
const DIFF_MUL = { easy:0.5, normal:1, hard:1.5, expert:2 };
function rewardRules(st){ const diff = st.botsOn && st.bots > 0 ? DIFF_MUL[st.difficulty] || 1 : 1, farm = st.hp < 100 ? 0.75 : 1;
  return { diff, farm, xp:diff * farm * st.xpMul, cash:diff * farm * st.cashMul }; }
function teamMul(room, e){ const T = room.settings.teams; return e && e.team !== undefined && T && T[e.team] ? T[e.team].reward : 1; }
function earnOf(M, id){ return M.earn[id] || (M.earn[id] = { xp:0, cash:0, levels:0, kills:0 }); }
function levelCash(p, xpBefore){ const d = levelOf(p.xp) - levelOf(xpBefore); if (d > 0){ p.cash += d * S.prog.cash.level; return d * S.prog.cash.level; } return 0; }
// one-time move of existing profiles to the cash economy: guns already reached by level stay owned, plus $25 per level
function migrateV6(p){ if (p.v6) return; const L = levelOf(p.xp), OLD = { drako:10, sniper:20, shotgun:50, ar15:100 };
  p.owned = p.owned || {}; for (const w in OLD) if (L >= OLD[w]) p.owned[w] = true; p.cash += (L - 1) * S.prog.cash.level; p.v6 = true; }
function ownsChar(p, c){ const price = (S.characters[c] || {}).price || 0; return !!S.characters[c] && (!price || !!p.owned[c]); }

// ------------------------------------------------------------------ geometry: line of sight against the map colliders
const COLS = S.colliders.map(([cx, cz, hx, hz, y0, y1, yaw]) => ({ cx, cz, hx, hz, y0, y1, c:Math.cos(yaw), s:Math.sin(yaw), r:Math.hypot(hx, hz) }));
// segment a->b blocked by any collider? (slab test in each box's local frame)
function blocked(a, b){
  const dx=b[0]-a[0], dy=b[1]-a[1], dz=b[2]-a[2], len=Math.hypot(dx,dy,dz)||1;
  for (const k of COLS){
    // quick reject: distance from the box centre to the segment (XZ) larger than its radius
    const t0 = Math.max(0, Math.min(1, ((k.cx-a[0])*dx + (k.cz-a[2])*dz) / (dx*dx+dz*dz || 1)));
    if (Math.hypot(a[0]+dx*t0-k.cx, a[2]+dz*t0-k.cz) > k.r + 0.01) continue;
    // to box space (same convention as the client's addCol: local x = (wx-cx)*c - (wz-cz)*s, local z = (wx-cx)*s + (wz-cz)*c)
    const lx=(a[0]-k.cx)*k.c-(a[2]-k.cz)*k.s, lz=(a[0]-k.cx)*k.s+(a[2]-k.cz)*k.c;
    const ldx=dx*k.c-dz*k.s, ldz=dx*k.s+dz*k.c;
    // same rules as the client's raycast: a box the segment starts inside does not block; the last 5 cm are ignored
    let tmin=0, tmax=1, ok=true, entered=false;
    for (const [o, d, lo, hi] of [[lx, ldx, -k.hx, k.hx], [a[1], dy, k.y0, k.y1], [lz, ldz, -k.hz, k.hz]]){
      if (Math.abs(d) < 1e-9){ if (o < lo || o > hi){ ok=false; break; } continue; }
      let t1=(lo-o)/d, t2=(hi-o)/d; if (t1>t2) [t1,t2]=[t2,t1]; if (t1>tmin){ tmin=t1; entered=true; } tmax=Math.min(tmax,t2); if (tmin>tmax){ ok=false; break; }
    }
    if (ok && entered && tmin < 1 - 0.05/len) return true;
  }
  return false;
}
function falloff(w, d){ const f=w.falloff; if (!f) return 1; if (d<=f[0]) return 1; if (d>=f[1]) return f[2]; return 1+(f[2]-1)*(d-f[0])/(f[1]-f[0]); }

// ------------------------------------------------------------------ settings (validated, clamped)
// Every host setting is validated and clamped here and only this cleaned copy is used and broadcast. Rewards can only be
// reduced (Off / Half / Normal), never raised, so a private room can't be used to farm XP or cash.
const FIREARMS_ALL = Object.keys(S.weapons).filter(k => k !== 'knife'), CHARS_ALL = Object.keys(S.characters);
function cleanSettings(x){
  x = x || {}; const mode = ['backpack','gang'].includes(x.mode) ? x.mode : 'dm';   // gang = Gang Wars (two teams)
  const pick = (v, list, def) => list.includes(v) ? v : def, int = (v, lo, hi, def) => Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : def;
  const bool = (v, def) => typeof v === 'boolean' ? v : def;
  const allowedW = S.modes[mode === 'gang' ? 'dm' : mode].firearms;
  let weapons = Array.isArray(x.weapons) ? x.weapons.filter(w => allowedW.includes(w)) : allowedW.slice(); if (!weapons.includes('glock')) weapons.unshift('glock');   // the starter pistol everyone owns is always allowed
  let chars = Array.isArray(x.chars) ? x.chars.filter(c => CHARS_ALL.includes(c)) : CHARS_ALL.slice(); if (!chars.includes('tracksuit')) chars.unshift('tracksuit');
  let botsOn = x.botsOn !== false && int(x.bots, 0, 12, 5) > 0, bots = botsOn ? int(x.bots, 0, 12, 5) : 0, gang = null;
  if (mode === 'gang'){                       // Gang Wars: 2-4 host-made teams; bots come from each team's bot count
    const src = Array.isArray(x.teams) && x.teams.length >= 2 ? x.teams.slice(0, 4) : [{}, {}], n = src.length;
    const teams = src.map((t, i) => { t = t || {}; const d = TEAM_DEFAULTS[i];
      return { name: String(t.name || d.name).toUpperCase().replace(/[^\w .'!-]/g, '').slice(0, 16).trim() || d.name, col: pick(t.col, TEAM_COLS, d.col), emblem: pick(t.emblem, EMBLEMS, d.emblem),
        max: int(t.max, 1, 8, 8), bots: int(t.bots, 0, 6, Array.isArray(x.teams) ? 0 : Math.floor(bots / n) + (i < bots % n ? 1 : 0)), reward: pick(+t.reward, [0, 0.5, 1], 1),
        start: t.start === 'loadout' || !S.weapons[t.start] || S.weapons[t.start].slot === 'melee' ? 'loadout' : t.start }; });
    while (teams.reduce((a, t) => a + t.bots, 0) > 12) teams.find(t => t.bots === Math.max(...teams.map(u => u.bots))).bots--;
    const assign = {}; if (x.assign && typeof x.assign === 'object') for (const [k, v] of Object.entries(x.assign).slice(0, 16)) if (/^[\w-]{1,40}$/.test(k) && Number.isInteger(v) && v >= 0 && v < n) assign[k] = v;
    bots = teams.reduce((a, t) => a + t.bots, 0); botsOn = bots > 0;
    gang = { teams, assign, friendlyFire: bool(x.friendlyFire, false), teamSwitch: bool(x.teamSwitch, false) };
  }
  return { mode, ...gang, name: String(x.name || 'O-Blick room').replace(/[^\w .'!-]/g, '').slice(0, 24) || 'O-Blick room',
    maxPlayers: int(x.maxPlayers, 2, 8, 8),
    bots, botsOn, difficulty: pick(x.difficulty, ['easy','normal','hard','expert'], 'normal'),
    time: int(x.time, 0, 3*3600, mode==='backpack' ? 300 : 600), kills: int(x.kills, 0, 500, mode==='gang' ? 40 : 20), tie: pick(x.tie, ['tie','deaths'], 'tie'),
    respawnOn: bool(x.respawnOn, true), respawnDelay: int(x.respawnDelay, 1, 15, 4),
    hp: int(x.hp, 50, 200, 100), stamina: int(x.stamina, 50, 200, 100),
    weapons, unlocks: pick(x.unlocks, ['levels','all'], 'levels'), startWeapon: pick(x.startWeapon, ['loadout','glock','random'], 'loadout'),
    chars, items: bool(x.items, true), nic: bool(x.nic, true), abilities: bool(x.abilities, true),
    flash: int(x.flash, 0, 3, 2), mines: int(x.mines, 0, 3, 1),
    xpMul: pick(+x.xpMul, [0, 0.5, 1], 1), cashMul: pick(+x.cashMul, [0, 0.5, 1], 1),
    variant: pick(x.variant, ['hold','classic'], 'hold'), classicHold: int(x.classicHold, 10, 120, 30),
    spawns: pick(x.spawns, ['all','far'], 'all'), respawn: pick(x.respawn, ['drop','reset'], 'drop'), resetAfter: int(x.resetAfter, 5, 120, 20),
    zaStart: x.zaStart === 'random' || x.zaStart === undefined ? 'random' : int(x.zaStart, 0, S.zaSpawns.length - 1, 0), botsCarry: bool(x.botsCarry, true) };
}
const TEAM_COLS = ['#ff4a3a','#4aa8ff','#3fd46a','#ffcf3f','#c86bff','#ff8a2a','#f2f4f6','#2ee6d6'], EMBLEMS = ['★','☠','♠','♦','♣','♥','⚡','♛'];
const TEAM_DEFAULTS = [{name:'RED GANG', col:'#ff4a3a', emblem:'★'}, {name:'BLUE GANG', col:'#4aa8ff', emblem:'☠'}, {name:'GREEN GANG', col:'#3fd46a', emblem:'♠'}, {name:'GOLD GANG', col:'#ffcf3f', emblem:'♛'}];
function canUseIn(room, p, w){ return room.settings.unlocks === 'all' || canUse(p, w); }
function zaHome(st){ return st.zaStart === 'random' ? S.zaSpawns[crypto.randomInt(S.zaSpawns.length)] : S.zaSpawns[st.zaStart]; }

// ------------------------------------------------------------------ rooms
const rooms = new Map();              // code -> room
const newCode = () => { let c; do { c = Array.from({length:5}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join(''); } while (rooms.has(c)); return c; };
function send(ws, m){ if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function broadcast(room, m, except){ const s = JSON.stringify(m); for (const c of room.clients) if (c !== except && c.readyState === 1) c.send(s); }
function roomInfo(room){ return { t:'room', code:room.code, host:room.host.id, settings:room.settings, state:room.match ? 'playing' : 'lobby',
  players:room.clients.map(c => ({ id:c.id, name:c.name, char:c.char, look:c.look || cleanLook(), team:c.team, tag:c.tag||'', level:levelOf(c.profile.xp) })) }; }

// ------------------------------------------------------------------ match simulation (authoritative state)
function ent(id, kind, name, char, w, owner){ return { id, kind, name, char, w, gun:w, owner, pos:[0,0,0], yaw:0, pitch:0, hp:100, alive:false, deadT:0, kills:0, deaths:0,
  mag:S.weapons[w].mag, res:S.weapons[w].reserve, lastShot:0, reloadUntil:0, auto:false, ab:{active:0, ready:false}, bluntCap:false, beer:0, items:{blunt:0, beer:0, zyn:0}, lastSt:0, lastHurt:-99, streak:0, nic:0, flash:0, mines:0, lastNade:-9 }; }
function maxHp(e){ const A = S.abilities[e.char]; return (e.baseHp || 100) * (e.bluntCap ? S.items.blunt.capMul : 1) * (A && A.hpMul && e.ab.active > 0 ? A.hpMul : 1); }
function dmgMul(e){ const A = S.abilities[e.char]; return A && A.dmgMul && e.ab.active > 0 ? A.dmgMul : 1; }

function startMatch(room){
  const st = room.settings, M = { id: crypto.randomUUID(), clock:0, ents:new Map(), ended:false, za:null, searched:new Set(), glass:new Set(), mines:[], mineId:0, carHops:{}, kills:{}, earn:{}, killLog:{},
    rides:(S.rides || []).map(r => ({ id:r.id, kind:r.kind, x:r.x, y:0, z:r.z, yaw:r.yaw, lean:0, rider:null })) };
  for (const c of room.clients){
    const p = c.profile, char = st.chars.includes(c.char) ? c.char : 'tracksuit';   // private match: any character the host allows
    const usable = st.weapons.filter(w => S.weapons[w].slot !== 'melee' && canUseIn(room, p, w));   // start with a gun (never the Taser)
    let w = st.startWeapon === 'glock' ? 'glock' : st.startWeapon === 'random' && usable.length ? usable[crypto.randomInt(usable.length)] : (usable.includes(c.weapon) ? c.weapon : usable[0]);
    if (!w || !st.weapons.includes(w)) w = 'glock';
    const e = ent(c.id, 'player', c.name, char, w, c); e.look = c.look || cleanLook(); e.baseHp = st.hp; M.ents.set(c.id, e); c.ent = e;
  }
  const botTeam = st.mode === 'gang' ? st.teams.flatMap((t, i) => Array(t.bots).fill(i)) : [];
  for (let i = 0; i < st.bots; i++){ const e = ent('b' + i, 'bot', 'BOT ' + (i+1), 'tracksuit', 'glock', room.host); e.baseHp = st.hp; e.team = botTeam[i]; M.ents.set(e.id, e); }
  // Gang Wars: the host's assignments are kept exactly; anyone not assigned (or over a team's max) joins the team with the fewest players
  if (st.mode === 'gang'){ const T = st.teams, n = T.map(() => 0); M.teamKills = T.map(() => 0);
    const players = [...M.ents.values()].filter(e => e.kind === 'player'), free = () => T.map((t, i) => i).filter(i => n[i] < T[i].max).sort((a, b) => n[a] - n[b])[0] ?? 0;
    for (const e of players.sort((a, b) => (st.assign[b.id] !== undefined) - (st.assign[a.id] !== undefined))){ const a = st.assign[e.id];
      const t = a !== undefined && n[a] < T[a].max ? a : free(); e.team = t; n[t]++; e.owner.team = t;
      const sw = T[t].start; if (sw !== 'loadout' && st.weapons.includes(sw)){ e.w = e.gun = sw; e.mag = capOf(e, sw); e.res = S.weapons[sw].reserve; } } }
  else for (const c of room.clients) c.team = undefined;
  if (st.mode === 'backpack'){ const h = zaHome(st); M.za = { x:h.x, y:h.y, z:h.z, carrier:null, holdStart:0, hold:{}, groundT:0, atHome:true, home:h }; }
  room.match = M;
  for (const e of M.ents.values()) respawn(room, e);
  broadcast(room, { t:'start', matchId:M.id, settings:st, you:null, ents:[...M.ents.values()].map(e => ({ id:e.id, kind:e.kind, name:e.name, char:e.char, look:e.look, team:e.team, tag:e.kind==='player'?e.owner.tag||'':'', w:e.w, pos:e.pos, yaw:e.yaw, hp:e.hp, owner:e.owner.id })) });
}
function spawnFor(room, e){
  const M = room.match, st = room.settings; let pool = S.spawns;
  if (st.mode === 'backpack' && st.spawns === 'far' && M.za){ const o = M.za.home; pool = S.spawns.slice().sort((a,b) => Math.hypot(b[0]-o.x,b[1]-o.z) - Math.hypot(a[0]-o.x,a[1]-o.z)).slice(0,8); }
  let best = pool[0], bs = -1e9;
  for (const s of pool){ let minD = 80; for (const o of M.ents.values()) if (o !== e && o.alive && (e.team === undefined || o.team !== e.team)) minD = Math.min(minD, Math.hypot(o.pos[0]-s[0], o.pos[2]-s[1]));
    const sc = minD + Math.random()*6; if (sc > bs){ bs = sc; best = s; } }
  return best;
}
// ---- rideable vehicles (scooters, e-bike). The server owns who is riding what, so two players can never take the same
// one; the rider streams the vehicle's position with their own state and every client draws it from the snapshots.
function releaseRide(room, e, at){
  const M = room.match; if (!M || !e.ride) return; const r = M.rides.find(v => v.id === e.ride); e.ride = null; if (!r) return;
  if (at && Math.hypot(at[0]-r.x, at[2]-r.z) < 4){ r.x = +at[0]; r.y = +at[1]; r.z = +at[2]; r.yaw = +at[3] || r.yaw; }
  r.rider = null; r.lean = 0; broadcast(room, { t:'ride', id:r.id, rider:null, x:r.x, y:r.y, z:r.z, yaw:r.yaw });
}
function respawn(room, e){
  const s = spawnFor(room, e); e.pos = [s[0], 0, s[1]]; e.yaw = s[2] || 0; e.alive = true; e.bluntCap = false; e.beer = 0; e.ab.active = 0; e.ab.ready = false;
  if (e.nextTeam !== undefined){ e.team = e.nextTeam; e.nextTeam = undefined; if (e.owner && e.kind === 'player') e.owner.team = e.team; broadcast(room, { t:'teamset', id:e.id, team:e.team }); }
  if (S.weapons[e.w].slot === 'melee' && e.gun) e.w = e.gun; e.saved = {}; e.stunUntil = 0; e.flash = room.settings.flash; e.mines = room.settings.mines; e.hp = maxHp(e); e.mag = capOf(e, e.w); e.res = S.weapons[e.w].reserve; e.reloadUntil = 0; e.lastSt = Date.now();
  broadcast(room, { t:'respawn', id:e.id, pos:e.pos, yaw:e.yaw, hp:e.hp, w:e.w });
}
function damage(room, by, target, dmg, head, w){
  const M = room.match; if (!target.alive || M.ended) return;
  if (by && by !== target && by.team !== undefined && by.team === target.team && !room.settings.friendlyFire) return;    // Gang Wars: friendly fire is a host setting (off by default)
  dmg = Math.round(dmg * (target.beer > 0 ? S.items.beer.dmgTaken : 1));
  target.hp = Math.max(0, target.hp - dmg); target.lastHurt = room.match.clock;
  broadcast(room, { t:'hit', by:by.id, target:target.id, dmg, hp:target.hp, head:!!head, max:maxHp(target) });
  if (target.hp <= 0) kill(room, by, target, w, head);
}
function kill(room, by, target, w, head){
  const M = room.match, st = room.settings; target.alive = false; target.deadT = 0; releaseRide(room, target); target.deaths++; target.ab.active = 0; target.ab.ready = false; target.streak = 0; target.nic = 0;
  const teamKill = by && by !== target && by.team !== undefined && by.team === target.team;
  if (by && by !== target && !teamKill){ by.kills++; by.streak++; if (st.nic && by.streak % S.perks.nic.at === 0 && by.nic < S.perks.nic.max) by.nic++;
    { const A = st.abilities && S.abilities[by.char]; if (A && !by.ab.active && !by.ab.ready && by.streak >= A.at){ by.ab.ready = true; broadcast(room, { t:'abready', id:by.id, name:A.name, streak:by.streak }); } }
    if (by.kind === 'player'){
      // farming guard: the same real player killed more than 3 times in 60 s pays nothing
      const key = by.id + '>' + target.id, log = (M.killLog[key] = (M.killLog[key] || []).filter(t => M.clock - t < 60)); log.push(M.clock);
      const farmed = target.kind === 'player' && log.length > 3, R = rewardRules(st), tm = teamMul(room, by);
      const p = by.owner.profile, kx = farmed ? 0 : Math.round(S.prog.xp.kill * R.xp * tm), kc = farmed ? 0 : Math.round(S.prog.cash.kill * R.cash * tm);
      const xb = p.xp, lb = levelOf(p.xp); p.xp += kx; p.cash += kc; const lc = levelCash(p, xb); M.kills[by.id] = (M.kills[by.id] || 0) + 1;
      const E = earnOf(M, by.id); E.xp += kx; E.cash += kc + lc; E.levels += levelOf(p.xp) - lb; E.kills++;
      saveProfiles(); send(by.owner, { t:'profile', profile:pubProfile(p), why:farmed ? 'REPEAT KILL · NO REWARD' : lc ? 'LEVEL UP' : 'KILL', xp:kx, cash:kc + lc }); } }
  if (M.za && M.za.carrier === target.id){ M.za.carrier = null; M.za.x = target.pos[0]; M.za.y = Math.max(0, target.pos[1]); M.za.z = target.pos[2]; M.za.groundT = 0; }
  if (st.mode === 'gang' && by && by !== target && by.team !== undefined && !teamKill) M.teamKills[by.team]++;
  broadcast(room, { t:'kill', by:by ? by.id : null, target:target.id, w, head:!!head, tk:M.teamKills || null });
  if (st.mode === 'dm' && st.kills > 0 && by && by.kills >= st.kills) return endMatch(room, by.id);
  if (st.mode === 'gang' && st.kills > 0 && by && by.team !== undefined && M.teamKills[by.team] >= st.kills) return endMatch(room, 'team' + by.team);
  // respawns off: last one standing wins (Deathmatch); in Za the hold-time leader wins once one player is left
  if (!st.respawnOn){ const alive = [...M.ents.values()].filter(x => x.alive); if (alive.length <= 1 && M.ents.size > 1){ const r = rows(room); endMatch(room, st.mode === 'dm' ? (alive[0] ? alive[0].id : 'TIE') : (r[0] ? r[0].id : 'TIE')); }
    // Gang Wars without respawns: the last gang with anyone standing wins
    if (st.mode === 'gang'){ const teams = new Set([...M.ents.values()].filter(x => x.alive).map(x => x.team)); if (teams.size <= 1) return endMatch(room, teams.size ? 'team' + [...teams][0] : 'TIE'); } }
}
function rows(room){
  const M = room.match, st = room.settings;
  const r = [...M.ents.values()].map(e => ({ id:e.id, name:e.name, kind:e.kind, team:e.team, kills:e.kills, deaths:e.deaths, hold:M.za ? +(M.za.hold[e.id] || 0).toFixed(1) : 0 }));
  if (st.mode === 'backpack') r.sort((a,b) => b.hold - a.hold); else r.sort((a,b) => b.kills - a.kills || (st.tie === 'deaths' ? a.deaths - b.deaths : 0));
  return r;
}
function endMatch(room, winnerId){
  const M = room.match; if (!M || M.ended) return; M.ended = true;
  const r = rows(room);
  for (const c of room.clients){
    const p = c.profile, e = M.ents.get(c.id); if (!e) continue;
    if (p.paid.includes(M.id)) continue;                                   // rewards: exactly once per match
    p.paid.push(M.id); p.paid = p.paid.slice(-50);
    const place = r.findIndex(x => x.id === c.id) + 1, won = winnerId === c.id || (e.team !== undefined && winnerId === 'team' + e.team), lines = [];
    const R = rewardRules(room.settings), tm = teamMul(room, e), XM = R.xp * tm, CM = R.cash * tm, X = v => Math.round(v * XM), Cc = v => Math.round(v * CM);
    let xp = X(S.prog.xp.participation), cash = Cc(S.prog.cash.participation); lines.push({ label:'Participation', xp, cash });
    if (won){ const wx = X(room.settings.mode === 'backpack' ? (room.settings.variant === 'classic' ? S.prog.xp.holdWin : S.prog.xp.zaWin) : S.prog.xp.win); xp += wx; cash += Cc(S.prog.cash.win); lines.push({ label:'Victory', xp:wx, cash:Cc(S.prog.cash.win) }); }
    else if (place === 2){ cash += Cc(S.prog.cash.second); lines.push({ label:'2nd place', xp:0, cash:Cc(S.prog.cash.second) }); }
    else if (place === 3){ cash += Cc(S.prog.cash.third); lines.push({ label:'3rd place', xp:0, cash:Cc(S.prog.cash.third) }); }
    const E = earnOf(M, c.id), k = M.kills[c.id] || 0; if (k) lines.unshift({ label:'Kills ×' + k, xp:E.xp, cash:E.cash, already:true });
    const xb = p.xp, lb = levelOf(p.xp); p.xp += xp; p.cash += cash; const lc = levelCash(p, xb); if (lc){ lines.push({ label:'Level up', xp:0, cash:lc }); cash += lc; }
    E.xp += xp; E.cash += cash; E.levels += levelOf(p.xp) - lb;
    if (R.diff !== 1 || R.farm !== 1 || tm !== 1) lines.push({ label:'Reward multiplier ×' + +(R.diff * R.farm * tm).toFixed(2) + (R.diff !== 1 ? ' (' + room.settings.difficulty + ' bots)' : ''), xp:0, cash:0, info:true });
    addHistory(p, { mode:room.settings.mode, diff:room.settings.botsOn && room.settings.bots ? room.settings.difficulty : null, result:won ? 'Won' : winnerId === 'TIE' ? 'Draw' : place ? '#' + place : 'Lost', kills:k, xp:E.xp, cash:E.cash, levels:E.levels });
    E.done = true;
    send(c, { t:'end', winner:winnerId, rows:r, place, rewards:{ lines, xp, cash, totalXP:E.xp, totalCash:E.cash, levels:E.levels, level:levelOf(p.xp) }, profile:pubProfile(p) });
  }
  saveProfiles();
  setTimeout(() => { if (room.match === M){ room.match = null; broadcast(room, roomInfo(room)); } }, 1500);
}
function tick(room){
  const M = room.match; if (!M || M.ended) return; const st = room.settings, dt = TICK;
  M.clock += dt;
  for (const e of M.ents.values()){
 e.beer = Math.max(0, e.beer - dt);
    if (e.reloadUntil && M.clock >= e.reloadUntil){ const n = Math.min(capOf(e, e.w) - e.mag, e.res); e.mag += n; e.res -= n; e.reloadUntil = 0; }
    if (!e.alive && st.respawnOn && !e.away){ e.deadT += dt; if (e.deadT >= st.respawnDelay) respawn(room, e); }
    if (e.alive && e.hp > maxHp(e)) e.hp = maxHp(e);
    // health regeneration (same as offline): after 6 s without damage, players 8 hp/s, bots 6 hp/s (scaled by max health)
    if (e.alive && e.hp < maxHp(e) && M.clock - e.lastHurt > 6) e.hp = Math.min(maxHp(e), e.hp + (e.kind==='bot'?6:8)*dt*maxHp(e)/100);
  }
  tickMines(room);
  if (M.za){ const z = M.za;
    if (z.carrier){ const c = M.ents.get(z.carrier); z.hold[z.carrier] = (z.hold[z.carrier] || 0) + dt; if (c){ z.x = c.pos[0]; z.y = c.pos[1]; z.z = c.pos[2]; }
      if (st.variant === 'classic' && M.clock - z.holdStart >= st.classicHold) return endMatch(room, z.carrier); }
    else if (!z.atHome){ z.groundT += dt; if (st.respawn === 'reset' && z.groundT >= st.resetAfter){ const h = zaHome(st); Object.assign(z, { x:h.x, y:h.y, z:h.z, atHome:true, groundT:0, home:h }); } }
    if (st.variant === 'hold' && st.time > 0 && M.clock >= st.time){ const r = rows(room); const tie = r.length > 1 && Math.abs(r[0].hold - r[1].hold) < 0.05; return endMatch(room, !r.length || tie ? 'TIE' : r[0].id); }
  }
  if (st.mode === 'gang' && st.time > 0 && M.clock >= st.time){ const k = M.teamKills, top = Math.max(...k); return endMatch(room, k.filter(v => v === top).length > 1 ? 'TIE' : 'team' + k.indexOf(top)); }
  if (st.mode === 'dm' && st.time > 0 && M.clock >= st.time){ const r = rows(room); const tie = r.length > 1 && r[0].kills === r[1].kills && (st.tie !== 'deaths' || r[0].deaths === r[1].deaths); return endMatch(room, tie ? 'TIE' : r[0].id); }
  // snapshot: every entity, the bag, the clock
  broadcast(room, { t:'snap', clock:+M.clock.toFixed(2), ents:[...M.ents.values()].map(e => [e.id, +e.pos[0].toFixed(2), +e.pos[1].toFixed(2), +e.pos[2].toFixed(2), +e.yaw.toFixed(3), +e.pitch.toFixed(3), e.w, e.alive ? 1 : 0, Math.round(e.hp), e.kills, e.deaths, e.ab.active > 0 ? 1 : 0, e.flags || 0]),
    za:M.za ? { carrier:M.za.carrier, x:M.za.x, y:M.za.y, z:M.za.z, hold:M.za.hold, atHome:M.za.atHome } : null,
    tk:M.teamKills || null,
    rides:M.rides.map(r => [r.id, +r.x.toFixed(2), +r.y.toFixed(2), +r.z.toFixed(2), +r.yaw.toFixed(3), +r.lean.toFixed(3), r.rider]) });
}

// ------------------------------------------------------------------ equipment: landmines (placed, armed, triggered and resolved here)
const MINE = { arm:1.5, trigger:1.3, radius:4.5, dmg:130, life:150, perPlayer:3, reach:2.2 };
function tickMines(room){
  const M = room.match;
  for (const mn of M.mines.slice()){
    const own = M.ents.get(mn.by); if (!own || M.clock - mn.t > MINE.life){ dropMine(room, mn, false); continue; }
    if (M.clock - mn.t < MINE.arm) continue;
    for (const e of M.ents.values()){
      if (!e.alive || e === own || (own.team !== undefined && own.team === e.team && !room.settings.friendlyFire)) continue;
      if (Math.hypot(e.pos[0]-mn.x, e.pos[2]-mn.z) < MINE.trigger && Math.abs(e.pos[1]-mn.y) < 1){ boomMine(room, mn, own); break; }
    }
  }
}
function dropMine(room, mn, boom){ const M = room.match, i = M.mines.indexOf(mn); if (i < 0) return false; M.mines.splice(i, 1); broadcast(room, { t:'mineoff', id:mn.id, boom, p:[mn.x, mn.y, mn.z] }); return true; }
function boomMine(room, mn, own){
  if (!dropMine(room, mn, true)) return;                       // removed once, so it can only explode once
  for (const e of [...room.match.ents.values()]){ if (!e.alive || e === own) continue;
    const d = Math.hypot(e.pos[0]-mn.x, e.pos[1]-mn.y, e.pos[2]-mn.z); if (d < MINE.radius) damage(room, own, e, Math.round(MINE.dmg * (1 - d/MINE.radius)), false, 'mine'); }
}
function placeMine(room, e, m){
  const M = room.match, p = m.p; if (!e.alive || !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) return 'bad position';
  if (e.mines <= 0) return 'no mines left';
  if (Math.hypot(p[0]-e.pos[0], p[2]-e.pos[2]) > MINE.reach || Math.abs(p[1]-e.pos[1]) > 0.8) return 'too far';
  if (M.mines.some(o => Math.hypot(o.x-p[0], o.z-p[2]) < 0.6)) return 'too close to another mine';
  const mine = M.mines.filter(o => o.by === e.id); if (mine.length >= MINE.perPlayer) dropMine(room, mine[0], false);
  e.mines--; const mn = { id:++M.mineId, by:e.id, x:p[0], y:p[1], z:p[2], t:M.clock }; M.mines.push(mn);
  broadcast(room, { t:'mine', id:mn.id, by:e.id, p:[mn.x, mn.y, mn.z], left:e.mines });
  return null;
}
function throwNade(room, e, m){
  const M = room.match, o = m.o, v = m.v; if (!e.alive || !Array.isArray(o) || !Array.isArray(v) || o.length !== 3 || v.length !== 3 || ![...o, ...v].every(Number.isFinite)) return 'bad throw';
  if (e.flash <= 0) return 'no flashbangs left'; if (e.stunUntil > M.clock) return 'stunned';
  if (M.clock - e.lastNade < 0.8) return 'too fast';
  if (Math.hypot(o[0]-e.pos[0], o[1]-e.pos[1]-1.4, o[2]-e.pos[2]) > 2) return 'origin mismatch';
  if (Math.hypot(...v) > 22) return 'too fast';
  e.flash--; e.lastNade = M.clock; broadcast(room, { t:'nade', by:e.id, o, v, left:e.flash });
  return null;
}

// ------------------------------------------------------------------ shot validation (players and host bots)
function validateShot(room, shooter, m){
  const M = room.match, W = S.weapons[m.w], now = M.clock;
  if (!W || m.w !== shooter.w) return 'wrong weapon';
  if (!shooter.alive) return 'dead';
  if (shooter.stunUntil > now) return 'stunned';
  if (shooter.kind === 'player' && !canUseIn(room, shooter.owner.profile, m.w)) return 'weapon locked';
  if (m.w !== 'knife' && !room.settings.weapons.includes(m.w)) return 'weapon not allowed in this room';
  if (W.kind === 'melee'){ if (now - shooter.lastShot < W.rate * 0.75) return 'too fast'; }
  else {
    const auto = m.w === 'glock' && m.auto; if (auto && shooter.kind === 'player' && !shooter.owner.profile.owned.switch) return 'switch not owned';
    if (auto && room.settings.mode === 'backpack') return 'switch disabled in this mode';
    const iv = 60 / (auto ? W.switchRpm : W.rpm); if (now - shooter.lastShot < iv * 0.7) return 'too fast';
    if (shooter.reloadUntil) return 'reloading';
    if (shooter.mag <= 0) return 'empty';
  }
  const o = m.o; if (!Array.isArray(o) || Math.hypot(o[0]-shooter.pos[0], o[2]-shooter.pos[2]) > 2.5) return 'origin mismatch';
  return null;
}
function applyShot(room, shooter, m){
  const M = room.match, W = S.weapons[m.w];
  const why = validateShot(room, shooter, m); if (why){ if (shooter.kind === 'player') send(shooter.owner, { t:'reject', what:'shot', why }); return; }
  shooter.lastShot = M.clock; if (W.kind !== 'melee') shooter.mag--;
  const hits = (Array.isArray(m.hits) ? m.hits : []).slice(0, W.pellets);
  const per = new Map(); let rejected = 0;
  for (const h of hits){
    const t = M.ents.get(h.id); if (!t || t === shooter || !t.alive){ rejected++; continue; }
    const d = Math.hypot(t.pos[0]-shooter.pos[0], t.pos[1]-shooter.pos[1], t.pos[2]-shooter.pos[2]);
    const range = W.kind === 'melee' ? W.range + 0.8 : W.range, slack = W.kind === 'taser' ? 0.6 : 1.5;   // the Taser wire never reaches past 20 m
    if (d > range + slack || Math.abs(d - (+h.d || 0)) > 3.5){ rejected++; continue; }                    // claimed distance must match where the server has them
    const eye = [shooter.pos[0], shooter.pos[1] + 1.55, shooter.pos[2]], aim = [t.pos[0], t.pos[1] + (h.head ? 1.62 : 1.1), t.pos[2]];
    if (blocked(eye, aim) && blocked(eye, [t.pos[0], t.pos[1] + 1.62, t.pos[2]])){ rejected++; continue; }   // through a wall
    let dmg = W.kind === 'melee' ? (h.heavy ? W.heavyDmg : W.dmg) : W.dmg * (h.head ? W.headMul : 1) * falloff(W, d);
    const q = per.get(t) || { dmg:0, head:false }; q.dmg += dmg; q.head = q.head || !!h.head; per.set(t, q);
  }
  for (const [t, q] of per){
    if (W.stun && !(t.team !== undefined && t.team === shooter.team)){   // Taser: the server decides the stun; a hit while stunned does not restart it
      if (!(t.stunUntil > M.clock)){ t.stunUntil = M.clock + W.stun; t.reloadUntil = 0; broadcast(room, { t:'stun', id:t.id, by:shooter.id, dur:W.stun }); } }
    damage(room, shooter, t, q.dmg * dmgMul(shooter), q.head, m.w); }
  if (rejected && shooter.kind === 'player') send(shooter.owner, { t:'reject', what:'hits', why:rejected + ' hit(s) failed validation' });
  broadcast(room, { t:'shotfx', by:shooter.id, w:m.w, o:m.o, e:m.e || null, sup:!!m.sup }, shooter.kind === 'player' ? shooter.owner : null);
}

// ------------------------------------------------------------------ connections
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type':'text/plain' }); res.end('O-Blick game server ' + S.version + ' · rooms: ' + rooms.size + '\n'); });
const wss = new WebSocketServer({ server });
let nextId = 1;
wss.on('connection', ws => {
  ws.id = 'p' + (nextId++); ws.room = null; ws.profile = null; ws.weapon = 'glock'; ws.char = 'tracksuit';
  ws.on('message', raw => { let m; try { m = JSON.parse(raw); } catch (e) { return; } if (!m || typeof m.t !== 'string') return;
    if (ws.loading){ if (ws.queue.length < 50) ws.queue.push(m); return; }               // profile still loading from storage
    if (m.t === 'hello' && !ws.profile) return hello(ws, m);
    try { handle(ws, m); } catch (e) { console.error(e); } });
  ws.on('close', () => { if (!hold(ws)) leave(ws); if (ws.token && !socketsOf(ws.token).length){ store.flush(); store.release(ws.token); } });
});
// ---- reconnect: a dropped connection (not a LEAVE) keeps the player's place in a running match for REJOIN_MS.
// Their character is taken off the field (can't be shot or farmed); the same account can come back with its score,
// team and position. If they don't, the normal leave runs. An empty room stays open while someone can still return.
const REJOIN_MS = +process.env.REJOIN_MS || 30000;
function hold(ws){
  const room = ws.room, M = room && room.match, e = ws.ent; if (!M || M.ended || !e || !M.ents.has(ws.id) || !ws.token) return false;
  e.away = { alive:e.alive, hp:e.hp }; e.alive = false; releaseRide(room, e); if (M.za && M.za.carrier === ws.id) M.za.carrier = null;
  room.clients = room.clients.filter(c => c !== ws); (room.ghosts = room.ghosts || new Map()).set(ws.token, ws);
  ws.ghostTimer = setTimeout(() => { room.ghosts.delete(ws.token); leave(ws); }, REJOIN_MS);
  // a dropped host stays host while they can still return (their game runs the bots); it only moves on if they don't
  broadcast(room, { t:'away', id:ws.id, on:true, name:ws.name, secs:REJOIN_MS / 1000 }); if (room.clients.length) broadcast(room, roomInfo(room));
  return true;
}
function resume(ws){
  let room = null, old = null; for (const r of rooms.values()) if (r.ghosts && r.ghosts.has(ws.token)){ room = r; old = r.ghosts.get(ws.token); break; }
  const M = room && room.match, e = old && old.ent; if (!M || M.ended || !e) return null;
  clearTimeout(old.ghostTimer); room.ghosts.delete(ws.token); old.room = null; old.ent = null;
  for (const k of ['id', 'name', 'tag', 'char', 'look', 'weapon', 'sec', 'melee', 'mags', 'team']) ws[k] = old[k];   // same seat, same match loadout
  ws.room = room; ws.ent = e; e.owner = ws; room.clients.push(ws);
  if (room.host === old || !room.clients.includes(room.host)){ room.host = ws; for (const b of M.ents.values()) if (b.kind === 'bot') b.owner = ws; }
  const was = e.away; e.away = null; e.lastSt = Date.now(); e.saved = {}; e.mag = capOf(e, e.w); e.res = S.weapons[e.w].reserve; e.reloadUntil = 0; e.stunUntil = 0; e.flash = room.settings.flash; e.mines = room.settings.mines;
  if (was.alive){ e.alive = true; e.hp = was.hp; broadcast(room, { t:'respawn', id:e.id, pos:e.pos, yaw:e.yaw, hp:e.hp, w:e.w }, ws); }   // back where they stood, same health
  else if (room.settings.respawnOn) respawn(room, e);
  return () => {
    send(ws, roomInfo(room));
    send(ws, { t:'start', resume:true, matchId:M.id, settings:room.settings, clock:+M.clock.toFixed(2), tk:M.teamKills || null,
      ents:[...M.ents.values()].map(x => ({ id:x.id, kind:x.kind, name:x.name, char:x.char, look:x.look, team:x.team, tag:x.kind==='player'?x.owner.tag||'':'', w:x.w, pos:x.pos, yaw:x.yaw, hp:x.hp, owner:x.owner.id })) });
    for (const mn of M.mines) send(ws, { t:'mine', id:mn.id, by:mn.by, p:[mn.x, mn.y, mn.z], left:e.mines });
    if (!e.alive) send(ws, { t:'kill', by:null, target:e.id, w:'—', head:false, tk:M.teamKills || null });      // no-respawn match and they were already out
    broadcast(room, { t:'away', id:e.id, on:false, name:ws.name }); broadcast(room, roomInfo(room));
  };
}
function leave(ws){
  const room = ws.room; if (!room) return; ws.room = null;
  // rewards earned so far are already in the profile; record the match as left early
  const LM = room.match; if (LM && !LM.ended && ws.profile && LM.ents.has(ws.id)){ const E = earnOf(LM, ws.id); if (!E.done){ E.done = true;
    addHistory(ws.profile, { mode:room.settings.mode, diff:room.settings.botsOn && room.settings.bots ? room.settings.difficulty : null, result:'Left early', kills:E.kills, xp:E.xp, cash:E.cash, levels:E.levels }); saveProfiles(); } }
  room.clients = room.clients.filter(c => c !== ws);
  if (room.match && ws.ent){ releaseRide(room, ws.ent); room.match.ents.delete(ws.id); if (room.match.za && room.match.za.carrier === ws.id) room.match.za.carrier = null; broadcast(room, { t:'left', id:ws.id }); }
  if (!room.clients.length){ if (room.ghosts && room.ghosts.size) return; clearInterval(room.timer); rooms.delete(room.code); return; }   // someone may still reconnect
  if (room.host === ws){ room.host = room.clients[0]; if (room.match) for (const e of room.match.ents.values()) if (e.kind === 'bot'){ e.owner = room.host; } }
  broadcast(room, roomInfo(room));
}
async function hello(ws, m){
  const token = String(m.token || '').slice(0, 64); if (token.length < 16) return send(ws, { t:'error', why:'bad token' });
  ws.loading = true; ws.queue = [];
  try { ws.profile = await profileOf(token); }
  catch (e){ console.error('profile load failed:', e.message); ws.loading = false; return send(ws, { t:'error', why:'could not load your profile · try again shortly' }); }
  ws.token = token; ws.dev = DEV_TOKENS.has(token);
  ws.name = String(m.name || 'PLAYER').replace(/[^\w .-]/g, '').slice(0, 16) || 'PLAYER';
  ws.tag = m.tag === 'DEV' ? 'DEV' : '';                // cosmetic name tag only — grants no developer rights
  ws.char = CHARS_ALL.includes(m.char) ? m.char : 'tracksuit'; ws.look = cleanLook(m.look); ws.weapon = typeof m.weapon === 'string' ? m.weapon : 'glock';
  setLoadout(ws, m);
  const restored = restoreSeal(ws.profile, token, m.restore), back = m.rejoin ? resume(ws) : null;
  send(ws, { t:'welcome', restored, resumed:!!back, id:ws.id, profile:pubProfile(ws.profile), dev:ws.dev, version:S.version, storage:store.mode });
  if (back) back();
  ws.loading = false; for (const q of ws.queue.splice(0)) try { handle(ws, q); } catch (e) { console.error(e); }
}
// the player's three slots (primary / secondary / melee); only owned weapons of the right slot are kept
// magazine size for this player's gun: an extended magazine counts only if they own it (bots: factory size)
function capOf(e, w){
  const W = S.weapons[w], ws = e.kind === 'player' ? e.owner : null, a = ws && ws.mags && ws.mags[w], A = a && S.att && S.att[a];
  if (!A || !A.for.includes(w)) return W.mag;
  if (S.prog.price['att:' + a] !== undefined && !(ws.profile && ws.profile.owned && ws.profile.owned['att:' + a])) return W.mag;
  return typeof A.cap === 'object' ? (A.cap[w] || W.mag) : A.cap;
}
function setLoadout(ws, m){
  if (m.mags && typeof m.mags === 'object'){ ws.mags = {}; for (const [w, a] of Object.entries(m.mags).slice(0, 12)) if (S.weapons[w] && S.att && S.att[a]) ws.mags[w] = a; }
  const ok = (w, slot) => S.weapons[w] && S.weapons[w].slot === slot;   // ownership is checked where it is used (match start / equip), per room unlock rules
  if (ok(m.weapon, 'primary') || ok(m.weapon, 'secondary')) ws.weapon = m.weapon;
  ws.sec = ok(m.secondary, 'secondary') ? m.secondary : 'glock'; ws.melee = ok(m.melee, 'melee') ? m.melee : 'knife';
}
function handle(ws, m){
  const room = ws.room, M = room && room.match, e = ws.ent;
  switch (m.t){
    case 'hello': return;                       // handled by hello() (profile load is asynchronous)
    case 'prefs': {      // selected character, outfit, loadout and weapon customization, kept with the account (newest wins)
      if (!ws.profile || !m.prefs || typeof m.prefs !== 'object') return; const j = JSON.stringify(m.prefs); if (j.length > 8000) return;
      const ts = +m.prefs.ts || 0; if (ws.profile.prefs && ws.profile.prefs.ts >= ts) return; ws.profile.prefs = JSON.parse(j); saveProfiles(); return; }
    case 'loadout': { if (!ws.profile) return; if (CHARS_ALL.includes(m.char)) ws.char = m.char; if (m.look) ws.look = cleanLook(m.look); setLoadout(ws, m); if (room) broadcast(room, roomInfo(room)); return; }
    case 'create': {
      if (!ws.profile) return send(ws, { t:'error', why:'say hello first' }); leave(ws);
      const r = { code:newCode(), host:ws, clients:[ws], settings:cleanSettings(m.settings), match:null };
      rooms.set(r.code, r); ws.room = r; r.timer = setInterval(() => tick(r), TICK * 1000);
      return send(ws, roomInfo(r));
    }
    case 'join': {
      if (!ws.profile) return send(ws, { t:'error', why:'say hello first' });
      const r = rooms.get(String(m.code || '').toUpperCase().trim()); if (!r) return send(ws, { t:'error', why:'no room with that code' });
      if (r.match) return send(ws, { t:'error', why:'that match has already started' });
      if (r.clients.length >= r.settings.maxPlayers) return send(ws, { t:'error', why:'room is full (' + r.settings.maxPlayers + ' players)' });
      leave(ws); r.clients.push(ws); ws.room = r; return broadcast(r, roomInfo(r));
    }
    case 'leave': return leave(ws);
    case 'devauth': {
      if (!ws.profile) return;
      const now = Date.now(); if (now < (ws.devLockUntil || 0)) return send(ws, { t:'devauth', ok:false, why:'too many attempts · wait ' + Math.ceil((ws.devLockUntil - now) / 1000) + ' s' });
      const pw = String(m.pw || '').slice(0, 128);
      const ok = devPwOk(pw);
      fs.appendFile(DEVLOG, JSON.stringify({ t:new Date().toISOString(), token:ws.token.slice(0,6) + '…', cmd:'signin', ok }) + '\n', () => {});
      if (ok){ ws.dev = true; ws.devFails = 0; return send(ws, { t:'devauth', ok:true }); }
      ws.devFails = (ws.devFails || 0) + 1; if (ws.devFails >= 3) ws.devLockUntil = now + Math.min(60000, 5000 * 2 ** (ws.devFails - 3));
      return send(ws, { t:'devauth', ok:false, why:'incorrect password' });
    }
    case 'tag': { ws.tag = m.dev ? 'DEV' : ''; if (room){ broadcast(room, roomInfo(room)); if (M) broadcast(room, { t:'tag', id:ws.id, dev:!!m.dev }, ws); } return; }
    case 'settings': { if (!room || room.host !== ws) return; if (M) return send(ws, { t:'reject', what:'settings', why:'locked while the match is running' });
      room.settings = cleanSettings(m.settings); room.settings.maxPlayers = Math.max(room.settings.maxPlayers, room.clients.length); return broadcast(room, roomInfo(room)); }
    case 'start': { if (!room || room.host !== ws || M) return send(ws, { t:'error', why:'only the host can start' }); return startMatch(room); }
    case 'st': {                                 // own position (players) — speed-checked
      if (!M || !e || !e.alive || !Array.isArray(m.p)) return;
      const now = Date.now(), dt = Math.max(0.05, (now - e.lastSt) / 1000), d = Math.hypot(m.p[0]-e.pos[0], m.p[2]-e.pos[2]);
      if (d > MAX_SPEED * dt + 1.5 && !ALLOW_TELEPORT){ send(ws, { t:'correct', pos:e.pos }); return; }
      e.pos = m.p.map(Number); e.yaw = +m.yaw || 0; e.pitch = +m.pitch || 0; e.flags = m.f | 0; e.lastSt = now;
      // riding: the vehicle travels with its rider (it must stay under them)
      if (e.ride && Array.isArray(m.v)){ const r = M.rides.find(v => v.id === e.ride);
        if (r && Math.hypot(m.v[0]-e.pos[0], m.v[2]-e.pos[2]) < 1.5){ r.x = +m.v[0]; r.y = +m.v[1]; r.z = +m.v[2]; r.yaw = +m.v[3] || 0; r.lean = +m.v[4] || 0; } }
      return;
    }
    case 'ride': {                               // get on / off a scooter or the e-bike
      if (!M || !e || !e.alive) return; const r = M.rides.find(v => v.id === m.id);
      if (!r) return send(ws, { t:'reject', what:'ride', id:m.id, why:'no such vehicle' });
      if (m.on){
        if (e.ride) return send(ws, { t:'reject', what:'ride', id:m.id, why:'already riding' });
        if (r.rider) return send(ws, { t:'reject', what:'ride', id:m.id, why:'someone is already on it' });
        if (Math.hypot(r.x - e.pos[0], r.z - e.pos[2]) > 2.6) return send(ws, { t:'reject', what:'ride', id:m.id, why:'too far away' });
        r.rider = e.id; e.ride = r.id; return broadcast(room, { t:'ride', id:r.id, rider:e.id, x:r.x, y:r.y, z:r.z, yaw:r.yaw });
      }
      if (e.ride === r.id) releaseRide(room, e, Array.isArray(m.v) ? m.v : null); return;
    }
    case 'bots': {                               // host streams bot movement (bots only; never health)
      if (!M || room.host !== ws || !Array.isArray(m.list)) return;
      for (const b of m.list){ const be = M.ents.get(b.id); if (!be || be.kind !== 'bot' || !be.alive) continue;
        if (Math.hypot(b.p[0]-be.pos[0], b.p[2]-be.pos[2]) > 4) continue; be.pos = b.p.map(Number); be.yaw = +b.yaw || 0; be.pitch = +b.pitch || 0; be.flags = b.f | 0;
        if (b.w && b.w !== be.w && room.settings.weapons.includes(b.w)){ be.w = b.w; be.mag = S.weapons[b.w].mag; be.res = S.weapons[b.w].reserve; }
        if (b.char && S.characters[b.char] && room.settings.chars.includes(b.char)) be.char = b.char; }
      return;
    }
    case 'shot': { if (M && e) applyShot(room, e, m); return; }
    case 'botshot': { if (!M || room.host !== ws) return; const be = M.ents.get(m.id); if (be && be.kind === 'bot') applyShot(room, be, m); return; }
    case 'reload': {
      const who = m.id ? (room && room.host === ws ? M && M.ents.get(m.id) : null) : e; if (!who || !who.alive) return;
      const W = S.weapons[who.w]; if (W.kind === 'melee' || who.reloadUntil || who.mag >= capOf(who, who.w) || who.res <= 0) return;
      const miss = capOf(who, who.w) - who.mag; who.reloadUntil = M.clock + ((W.reload1 && miss === 1) ? W.reload1 : W.reloadTime) * 0.95;   // sawed-off: one shell reloads faster
      broadcast(room, { t:'rl', id:who.id, w:who.w, n:miss }); return;            // nearby players hear the reload
    }
    case 'equip': { if (!M || !e || !S.weapons[m.w]) return; if (m.w !== 'knife' && (!canUseIn(room, ws.profile, m.w) || !room.settings.weapons.includes(m.w) || room.settings.startWeapon === 'glock' && m.w !== 'glock')) return send(ws, { t:'reject', what:'equip', why:'locked or not allowed' }); if (m.w !== e.w){
        // each gun keeps its own ammo: switching to the knife and back no longer refills (or empties) the gun
        e.saved = e.saved || {}; if (e.w !== 'knife') e.saved[e.w] = { mag:e.mag, res:e.res };
        e.w = m.w; e.reloadUntil = 0; if (S.weapons[m.w].slot !== 'melee') e.gun = m.w;
        if (m.w !== 'knife'){ const sv = e.saved[m.w]; e.mag = sv ? sv.mag : capOf(e, m.w); e.res = sv ? sv.res : S.weapons[m.w].reserve; }
      } return; }
    case 'ability': {
      const who = m.id ? (room && room.host === ws && M ? M.ents.get(m.id) : null) : e; if (!M || !who || !who.alive) return;
      // unlocked only by a server-counted kill streak (A.at in a row, reset on death); one activation per unlock; lasts until death
      const A = room.settings.abilities && S.abilities[who.char]; if (!A) return send(ws, { t:'reject', what:'ability', why:room.settings.abilities ? 'no ability' : 'abilities are off in this room' });
      if (who.ab.active) return send(ws, { t:'reject', what:'ability', why:'already active' });
      if (!who.ab.ready) return send(ws, { t:'reject', what:'ability', why:'need '+A.at+' kills in a row ('+who.streak+'/'+A.at+')' });
      who.ab.ready = false; who.ab.active = 1; if (A.hpMul) who.hp *= A.hpMul;
      return broadcast(room, { t:'ability', id:who.id, name:A.name, hp:who.hp });
    }
    case 'glass': {                              // a window was shot out: remembered for the match and shown to everyone else
      if (!M || !e) return; const id = m.id | 0; if (id < 0 || id > 999 || M.glass.has(id)) return;
      M.glass.add(id); return broadcast(room, { t:'glass', id }, ws);
    }
    case 'pickup': {                             // ZA: within 1.8 m of where the server has the bag
      if (!M || !M.za || M.za.carrier) return; const who = m.id ? (room.host === ws ? M.ents.get(m.id) : null) : e; if (!who || !who.alive) return;
      if (who.kind === 'bot' && !room.settings.botsCarry) return;
      const z = M.za; if (Math.hypot(who.pos[0]-z.x, who.pos[2]-z.z) > 1.8 || Math.abs(who.pos[1]-z.y) > 1.5) return send(ws, { t:'reject', what:'pickup', why:'too far' });
      z.carrier = who.id; z.holdStart = M.clock; z.atHome = false; z.groundT = 0; return broadcast(room, { t:'carrier', id:who.id });
    }
    case 'team': {                               // Gang Wars: switching mid-match only if the host allowed it; applies at your next respawn
      const st = room && room.settings, t = m.team | 0; if (!M || !e || !st || st.mode !== 'gang') return;
      if (!st.teamSwitch) return send(ws, { t:'reject', what:'team', why:'teams are locked for this match' });
      if (!st.teams[t] || t === e.team) return send(ws, { t:'reject', what:'team', why:'no such team' });
      if ([...M.ents.values()].filter(x => x.kind === 'player' && (x.nextTeam ?? x.team) === t).length >= st.teams[t].max) return send(ws, { t:'reject', what:'team', why:'that team is full' });
      e.nextTeam = t; return send(ws, { t:'teamnext', team:t });
    }
    case 'mine': case 'nade': {                  // equipment: counts, reach and placement checked here
      if (!M || !e) return; const why = m.t === 'mine' ? placeMine(room, e, m) : throwNade(room, e, m);
      if (why) send(ws, { t:'reject', what:m.t, why, left:m.t === 'mine' ? e.mines : e.flash }); return;
    }
    case 'search': {                             // trunk loot: rolled here, once per trunk per match
      if (!M || !e || !e.alive) return; if (!room.settings.items) return send(ws, { t:'reject', what:'search', why:'consumables are off in this room' }); const tr = S.trunks[m.id | 0]; if (!tr || M.searched.has(tr.id)) return send(ws, { t:'reject', what:'search', why:'already searched' });
      if (Math.hypot(e.pos[0]-tr.x, e.pos[2]-tr.z) > 2.2) return send(ws, { t:'reject', what:'search', why:'too far' });
      M.searched.add(tr.id); const found = [];
      for (const k of ['beer','blunt','zyn']) if (Math.random() < S.loot[k]){ if (e.items[k] < S.items[k].max){ e.items[k]++; found.push(k); } else found.push(k + '-full'); }
      const ammo = {};
      if (Math.random() < S.loot.ammo) for (const w of new Set([ws.weapon, ws.sec, ws.melee])){   // each gun gets its own ammo type, capped
        const W = S.weapons[w]; if (!W || w === 'knife') continue;
        const cur = e.w === w ? e : (e.saved = e.saved || {}, e.saved[w] = e.saved[w] || { mag:capOf(e, w), res:W.reserve });
        const n = Math.max(0, Math.min(w === 'taser' ? 2 : W.mag, Math.round(W.reserve * 1.5) - cur.res)); cur.res += n; ammo[w] = cur.res;
        found.push(n > 0 ? 'ammo:' + w + ':' + n : 'ammo:' + w + '-full');
      }
      return send(ws, { t:'loot', found, items:e.items, ammo });
    }
    case 'use': {                                // items that change health go through here
      if (!M || !e || !e.alive) return; const k = m.item;
      if (k === 'nic' && !room.settings.nic) return send(ws, { t:'reject', what:'use', why:'nic is off in this room' });
      if (k !== 'nic' && !room.settings.items) return send(ws, { t:'reject', what:'use', why:'consumables are off in this room' });
      if (k === 'nic'){ if (e.nic <= 0) return send(ws, { t:'reject', what:'use', why:'no nic (5 kills in a row)' }); e.nic--; e.hp = Math.min(maxHp(e), e.hp + maxHp(e)*S.perks.nic.heal); return send(ws, { t:'used', item:k, items:e.items, hp:e.hp, max:maxHp(e) }); }
      if (!S.items[k] || e.items[k] <= 0) return send(ws, { t:'reject', what:'use', why:'none left' });
      e.items[k]--;
      if (k === 'blunt'){ e.bluntCap = true; e.hp = Math.min(maxHp(e), e.hp + S.items.blunt.heal); }
      if (k === 'beer'){ if (e.beer > 0){ e.items[k]++; return send(ws, { t:'reject', what:'use', why:'no stacking' }); } e.beer = S.items.beer.buzz; e.hp = Math.min(maxHp(e), e.hp + S.items.beer.heal); }
      return send(ws, { t:'used', item:k, items:e.items, hp:e.hp, max:maxHp(e) });
    }
    case 'buy': {
      if (!ws.profile) return; const price = S.prog.price[m.item], p = ws.profile;
      if (price === undefined) return send(ws, { t:'reject', what:'buy', why:'unknown item' });
      if (p.owned[m.item]) return send(ws, { t:'reject', what:'buy', why:'already owned' });
      if (p.cash < price) return send(ws, { t:'reject', what:'buy', why:'not enough cash' });
      p.cash -= price; p.owned[m.item] = true; saveProfiles(); return send(ws, { t:'profile', profile:pubProfile(p), bought:m.item });
    }
    case 'dev': {                                // developer accounts only (DEV_TOKENS), every action logged
      if (!ws.dev) return send(ws, { t:'reject', what:'dev', why:'not a developer account' });
      const p = ws.profile, before = { cash:p.cash, xp:p.xp }, a = m.arg;
      if (m.cmd === 'unlockAll'){ for (const k in S.prog.price) p.owned[k] = true; }
      else if (m.cmd === 'setLevel') p.xp = (Math.max(1, a | 0) - 1) * S.prog.xpPerLevel;
      else if (m.cmd === 'setXP') p.xp = Math.max(0, a | 0);
      else if (m.cmd === 'addCash') p.cash += Math.max(0, a | 0);
      else if (m.cmd === 'reset'){ p.cash = 0; p.xp = 0; p.owned = { switch:false, jeff:false, cop:false }; }
      else return send(ws, { t:'reject', what:'dev', why:'unknown command' });
      fs.appendFile(DEVLOG, JSON.stringify({ t:new Date().toISOString(), token:ws.token.slice(0,6) + '…', cmd:m.cmd, arg:a, before, after:{ cash:p.cash, xp:p.xp } }) + '\n', () => {});
      saveProfiles(); return send(ws, { t:'profile', profile:pubProfile(p) });
    }
  }
}
store.init().then(() => server.listen(PORT, () => console.log('O-Blick server ' + S.version + ' on :' + PORT + (DEV_TOKENS.size ? ' · ' + DEV_TOKENS.size + ' developer account(s)' : '') + ' · storage: ' + store.mode))).catch(e => { console.error('storage failed to start:', e); process.exit(1); });
// controlled shutdown (deploys / restarts): write everything first
for (const sig of ['SIGTERM','SIGINT']) process.on(sig, async () => { try { await store.flush(); await store.close(); } catch (e) {} process.exit(0); });
module.exports = { blocked, cleanSettings, levelOf };
