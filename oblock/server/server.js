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
let profiles = {}; try { profiles = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8')); } catch (e) {}
let saveT = null; const saveProfiles = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(PROFILE_FILE, JSON.stringify(profiles), () => {}), 300); };
const levelOf = xp => 1 + Math.floor(Math.max(0, xp) / S.prog.xpPerLevel);
function profileOf(token){ const p = profiles[token] || (profiles[token] = { cash:0, xp:0, owned:{switch:false, jeff:false, cop:false}, paid:[], v6:true }); migrateV6(p); return p; }
function pubProfile(p){ return { cash:p.cash, xp:p.xp, level:levelOf(p.xp), owned:p.owned }; }
function canUse(p, w){ return !!S.weapons[w]; }   // every gun is free (no level locks, no price); attachments are bought
// $25 (S.prog.cash.level) for every level gained; returns the cash paid
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
  x = x || {}; const mode = x.mode === 'backpack' ? 'backpack' : 'dm';
  const pick = (v, list, def) => list.includes(v) ? v : def, int = (v, lo, hi, def) => Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : def;
  const bool = (v, def) => typeof v === 'boolean' ? v : def;
  const allowedW = S.modes[mode].firearms;
  let weapons = Array.isArray(x.weapons) ? x.weapons.filter(w => allowedW.includes(w)) : allowedW.slice(); if (!weapons.includes('glock')) weapons.unshift('glock');   // the starter pistol everyone owns is always allowed
  let chars = Array.isArray(x.chars) ? x.chars.filter(c => CHARS_ALL.includes(c)) : CHARS_ALL.slice(); if (!chars.includes('tracksuit')) chars.unshift('tracksuit');
  const botsOn = x.botsOn !== false && int(x.bots, 0, 12, 5) > 0;
  return { mode, name: String(x.name || 'O-Block room').replace(/[^\w .'!-]/g, '').slice(0, 24) || 'O-Block room',
    maxPlayers: int(x.maxPlayers, 2, 8, 8),
    bots: botsOn ? int(x.bots, 0, 12, 5) : 0, botsOn, difficulty: pick(x.difficulty, ['easy','normal','hard'], 'normal'),
    time: int(x.time, 0, 3*3600, mode==='dm' ? 600 : 300), kills: int(x.kills, 0, 500, 20), tie: pick(x.tie, ['tie','deaths'], 'tie'),
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
function canUseIn(room, p, w){ return room.settings.unlocks === 'all' || canUse(p, w); }
function zaHome(st){ return st.zaStart === 'random' ? S.zaSpawns[crypto.randomInt(S.zaSpawns.length)] : S.zaSpawns[st.zaStart]; }

// ------------------------------------------------------------------ rooms
const rooms = new Map();              // code -> room
const newCode = () => { let c; do { c = Array.from({length:5}, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join(''); } while (rooms.has(c)); return c; };
function send(ws, m){ if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function broadcast(room, m, except){ const s = JSON.stringify(m); for (const c of room.clients) if (c !== except && c.readyState === 1) c.send(s); }
function roomInfo(room){ return { t:'room', code:room.code, host:room.host.id, settings:room.settings, state:room.match ? 'playing' : 'lobby',
  players:room.clients.map(c => ({ id:c.id, name:c.name, char:c.char, tag:c.tag||'', level:levelOf(c.profile.xp) })) }; }

// ------------------------------------------------------------------ match simulation (authoritative state)
function ent(id, kind, name, char, w, owner){ return { id, kind, name, char, w, owner, pos:[0,0,0], yaw:0, pitch:0, hp:100, alive:false, deadT:0, kills:0, deaths:0,
  mag:S.weapons[w].mag, res:S.weapons[w].reserve, lastShot:0, reloadUntil:0, auto:false, ab:{active:0, ready:false}, bluntCap:false, beer:0, items:{blunt:0, beer:0, zyn:0}, lastSt:0, lastHurt:-99, streak:0, nic:0 }; }
function maxHp(e){ const A = S.abilities[e.char]; return (e.baseHp || 100) * (e.bluntCap ? S.items.blunt.capMul : 1) * (A && A.hpMul && e.ab.active > 0 ? A.hpMul : 1); }
function dmgMul(e){ const A = S.abilities[e.char]; return A && A.dmgMul && e.ab.active > 0 ? A.dmgMul : 1; }

function startMatch(room){
  const st = room.settings, M = { id: crypto.randomUUID(), clock:0, ents:new Map(), ended:false, za:null, searched:new Set(), glass:new Set(), carHops:{}, kills:{},
    rides:(S.rides || []).map(r => ({ id:r.id, kind:r.kind, x:r.x, y:0, z:r.z, yaw:r.yaw, lean:0, rider:null })) };
  for (const c of room.clients){
    const p = c.profile, char = ownsChar(p, c.char) && st.chars.includes(c.char) ? c.char : 'tracksuit';
    const usable = st.weapons.filter(w => canUseIn(room, p, w));
    let w = st.startWeapon === 'glock' ? 'glock' : st.startWeapon === 'random' && usable.length ? usable[crypto.randomInt(usable.length)] : (usable.includes(c.weapon) ? c.weapon : usable[0]);
    if (!w || !st.weapons.includes(w)) w = 'glock';
    const e = ent(c.id, 'player', c.name, char, w, c); e.baseHp = st.hp; M.ents.set(c.id, e); c.ent = e;
  }
  for (let i = 0; i < st.bots; i++){ const e = ent('b' + i, 'bot', 'BOT ' + (i+1), 'tracksuit', 'glock', room.host); e.baseHp = st.hp; M.ents.set(e.id, e); }
  if (st.mode === 'backpack'){ const h = zaHome(st); M.za = { x:h.x, y:h.y, z:h.z, carrier:null, holdStart:0, hold:{}, groundT:0, atHome:true, home:h }; }
  room.match = M;
  for (const e of M.ents.values()) respawn(room, e);
  broadcast(room, { t:'start', matchId:M.id, settings:st, you:null, ents:[...M.ents.values()].map(e => ({ id:e.id, kind:e.kind, name:e.name, char:e.char, tag:e.kind==='player'?e.owner.tag||'':'', w:e.w, pos:e.pos, yaw:e.yaw, hp:e.hp, owner:e.owner.id })) });
}
function spawnFor(room, e){
  const M = room.match, st = room.settings; let pool = S.spawns;
  if (st.mode === 'backpack' && st.spawns === 'far' && M.za){ const o = M.za.home; pool = S.spawns.slice().sort((a,b) => Math.hypot(b[0]-o.x,b[1]-o.z) - Math.hypot(a[0]-o.x,a[1]-o.z)).slice(0,8); }
  let best = pool[0], bs = -1e9;
  for (const s of pool){ let minD = 80; for (const o of M.ents.values()) if (o !== e && o.alive) minD = Math.min(minD, Math.hypot(o.pos[0]-s[0], o.pos[2]-s[1]));
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
  e.hp = maxHp(e); e.mag = S.weapons[e.w].mag; e.res = S.weapons[e.w].reserve; e.reloadUntil = 0; e.lastSt = Date.now();
  broadcast(room, { t:'respawn', id:e.id, pos:e.pos, yaw:e.yaw, hp:e.hp, w:e.w });
}
function damage(room, by, target, dmg, head, w){
  const M = room.match; if (!target.alive || M.ended) return;
  dmg = Math.round(dmg * (target.beer > 0 ? S.items.beer.dmgTaken : 1));
  target.hp = Math.max(0, target.hp - dmg); target.lastHurt = room.match.clock;
  broadcast(room, { t:'hit', by:by.id, target:target.id, dmg, hp:target.hp, head:!!head, max:maxHp(target) });
  if (target.hp <= 0) kill(room, by, target, w, head);
}
function kill(room, by, target, w, head){
  const M = room.match, st = room.settings; target.alive = false; target.deadT = 0; releaseRide(room, target); target.deaths++; target.ab.active = 0; target.ab.ready = false; target.streak = 0; target.nic = 0;
  if (by && by !== target){ by.kills++; by.streak++; if (st.nic && by.streak % S.perks.nic.at === 0 && by.nic < S.perks.nic.max) by.nic++;
    { const A = st.abilities && S.abilities[by.char]; if (A && !by.ab.active && !by.ab.ready && by.streak >= A.at){ by.ab.ready = true; broadcast(room, { t:'abready', id:by.id, name:A.name, streak:by.streak }); } }
    if (by.kind === 'player'){ const p = by.owner.profile, kx = Math.round(S.prog.xp.kill * st.xpMul), kc = Math.round(S.prog.cash.kill * st.cashMul); const xb = p.xp; p.xp += kx; p.cash += kc; const lc = levelCash(p, xb); M.kills[by.id] = (M.kills[by.id] || 0) + 1; saveProfiles(); send(by.owner, { t:'profile', profile:pubProfile(p), why:lc ? 'LEVEL UP' : 'KILL', xp:kx, cash:kc + lc }); } }
  if (M.za && M.za.carrier === target.id){ M.za.carrier = null; M.za.x = target.pos[0]; M.za.y = Math.max(0, target.pos[1]); M.za.z = target.pos[2]; M.za.groundT = 0; }
  broadcast(room, { t:'kill', by:by ? by.id : null, target:target.id, w, head:!!head });
  if (st.mode === 'dm' && st.kills > 0 && by && by.kills >= st.kills) return endMatch(room, by.id);
  // respawns off: last one standing wins (Deathmatch); in Za the hold-time leader wins once one player is left
  if (!st.respawnOn){ const alive = [...M.ents.values()].filter(x => x.alive); if (alive.length <= 1 && M.ents.size > 1){ const r = rows(room); endMatch(room, st.mode === 'dm' ? (alive[0] ? alive[0].id : 'TIE') : (r[0] ? r[0].id : 'TIE')); } }
}
function rows(room){
  const M = room.match, st = room.settings;
  const r = [...M.ents.values()].map(e => ({ id:e.id, name:e.name, kind:e.kind, kills:e.kills, deaths:e.deaths, hold:M.za ? +(M.za.hold[e.id] || 0).toFixed(1) : 0 }));
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
    const place = r.findIndex(x => x.id === c.id) + 1, won = winnerId === c.id, lines = [];
    const XM = room.settings.xpMul, CM = room.settings.cashMul, X = v => Math.round(v * XM), Cc = v => Math.round(v * CM);
    let xp = X(S.prog.xp.participation), cash = Cc(S.prog.cash.participation); lines.push({ label:'Participation', xp, cash });
    if (won){ const wx = X(room.settings.mode === 'backpack' ? (room.settings.variant === 'classic' ? S.prog.xp.holdWin : S.prog.xp.zaWin) : S.prog.xp.win); xp += wx; cash += Cc(S.prog.cash.win); lines.push({ label:'Victory', xp:wx, cash:Cc(S.prog.cash.win) }); }
    else if (place === 2){ cash += Cc(S.prog.cash.second); lines.push({ label:'2nd place', xp:0, cash:Cc(S.prog.cash.second) }); }
    else if (place === 3){ cash += Cc(S.prog.cash.third); lines.push({ label:'3rd place', xp:0, cash:Cc(S.prog.cash.third) }); }
    const k = M.kills[c.id] || 0, kx = Math.round(S.prog.xp.kill * XM), kc = Math.round(S.prog.cash.kill * CM); if (k) lines.unshift({ label:'Kills ×' + k, xp:k*kx, cash:k*kc, already:true });
    const xb = p.xp; p.xp += xp; p.cash += cash; const lc = levelCash(p, xb); if (lc){ lines.push({ label:'Level up', xp:0, cash:lc }); cash += lc; }
    send(c, { t:'end', winner:winnerId, rows:r, place, rewards:{ lines, xp, cash, totalXP:xp + k*kx, totalCash:cash + k*kc, level:levelOf(p.xp) }, profile:pubProfile(p) });
  }
  saveProfiles();
  setTimeout(() => { if (room.match === M){ room.match = null; broadcast(room, roomInfo(room)); } }, 1500);
}
function tick(room){
  const M = room.match; if (!M || M.ended) return; const st = room.settings, dt = TICK;
  M.clock += dt;
  for (const e of M.ents.values()){
 e.beer = Math.max(0, e.beer - dt);
    if (e.reloadUntil && M.clock >= e.reloadUntil){ const W = S.weapons[e.w], n = Math.min(W.mag - e.mag, e.res); e.mag += n; e.res -= n; e.reloadUntil = 0; }
    if (!e.alive && st.respawnOn){ e.deadT += dt; if (e.deadT >= st.respawnDelay) respawn(room, e); }
    if (e.alive && e.hp > maxHp(e)) e.hp = maxHp(e);
    // health regeneration (same as offline): after 6 s without damage, players 8 hp/s, bots 6 hp/s (scaled by max health)
    if (e.alive && e.hp < maxHp(e) && M.clock - e.lastHurt > 6) e.hp = Math.min(maxHp(e), e.hp + (e.kind==='bot'?6:8)*dt*maxHp(e)/100);
  }
  if (M.za){ const z = M.za;
    if (z.carrier){ const c = M.ents.get(z.carrier); z.hold[z.carrier] = (z.hold[z.carrier] || 0) + dt; if (c){ z.x = c.pos[0]; z.y = c.pos[1]; z.z = c.pos[2]; }
      if (st.variant === 'classic' && M.clock - z.holdStart >= st.classicHold) return endMatch(room, z.carrier); }
    else if (!z.atHome){ z.groundT += dt; if (st.respawn === 'reset' && z.groundT >= st.resetAfter){ const h = zaHome(st); Object.assign(z, { x:h.x, y:h.y, z:h.z, atHome:true, groundT:0, home:h }); } }
    if (st.variant === 'hold' && st.time > 0 && M.clock >= st.time){ const r = rows(room); const tie = r.length > 1 && Math.abs(r[0].hold - r[1].hold) < 0.05; return endMatch(room, !r.length || tie ? 'TIE' : r[0].id); }
  }
  if (st.mode === 'dm' && st.time > 0 && M.clock >= st.time){ const r = rows(room); const tie = r.length > 1 && r[0].kills === r[1].kills && (st.tie !== 'deaths' || r[0].deaths === r[1].deaths); return endMatch(room, tie ? 'TIE' : r[0].id); }
  // snapshot: every entity, the bag, the clock
  broadcast(room, { t:'snap', clock:+M.clock.toFixed(2), ents:[...M.ents.values()].map(e => [e.id, +e.pos[0].toFixed(2), +e.pos[1].toFixed(2), +e.pos[2].toFixed(2), +e.yaw.toFixed(3), +e.pitch.toFixed(3), e.w, e.alive ? 1 : 0, Math.round(e.hp), e.kills, e.deaths, e.ab.active > 0 ? 1 : 0, e.flags || 0]),
    za:M.za ? { carrier:M.za.carrier, x:M.za.x, y:M.za.y, z:M.za.z, hold:M.za.hold, atHome:M.za.atHome } : null,
    rides:M.rides.map(r => [r.id, +r.x.toFixed(2), +r.y.toFixed(2), +r.z.toFixed(2), +r.yaw.toFixed(3), +r.lean.toFixed(3), r.rider]) });
}

// ------------------------------------------------------------------ shot validation (players and host bots)
function validateShot(room, shooter, m){
  const M = room.match, W = S.weapons[m.w], now = M.clock;
  if (!W || m.w !== shooter.w) return 'wrong weapon';
  if (!shooter.alive) return 'dead';
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
    const range = W.kind === 'melee' ? W.range + 0.8 : W.range;
    if (d > range + 1.5 || Math.abs(d - (+h.d || 0)) > 3.5){ rejected++; continue; }                    // claimed distance must match where the server has them
    const eye = [shooter.pos[0], shooter.pos[1] + 1.55, shooter.pos[2]], aim = [t.pos[0], t.pos[1] + (h.head ? 1.62 : 1.1), t.pos[2]];
    if (blocked(eye, aim) && blocked(eye, [t.pos[0], t.pos[1] + 1.62, t.pos[2]])){ rejected++; continue; }   // through a wall
    let dmg = W.kind === 'melee' ? (h.heavy ? W.heavyDmg : W.dmg) : W.dmg * (h.head ? W.headMul : 1) * falloff(W, d);
    const q = per.get(t) || { dmg:0, head:false }; q.dmg += dmg; q.head = q.head || !!h.head; per.set(t, q);
  }
  for (const [t, q] of per) damage(room, shooter, t, q.dmg * dmgMul(shooter), q.head, m.w);
  if (rejected && shooter.kind === 'player') send(shooter.owner, { t:'reject', what:'hits', why:rejected + ' hit(s) failed validation' });
  broadcast(room, { t:'shotfx', by:shooter.id, w:m.w, o:m.o, e:m.e || null, sup:!!m.sup }, shooter.kind === 'player' ? shooter.owner : null);
}

// ------------------------------------------------------------------ connections
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type':'text/plain' }); res.end('O-Block game server ' + S.version + ' · rooms: ' + rooms.size + '\n'); });
const wss = new WebSocketServer({ server });
let nextId = 1;
wss.on('connection', ws => {
  ws.id = 'p' + (nextId++); ws.room = null; ws.profile = null; ws.weapon = 'glock'; ws.char = 'tracksuit';
  ws.on('message', raw => { let m; try { m = JSON.parse(raw); } catch (e) { return; } if (!m || typeof m.t !== 'string') return; try { handle(ws, m); } catch (e) { console.error(e); } });
  ws.on('close', () => leave(ws));
});
function leave(ws){
  const room = ws.room; if (!room) return; ws.room = null;
  room.clients = room.clients.filter(c => c !== ws);
  if (room.match && ws.ent){ releaseRide(room, ws.ent); room.match.ents.delete(ws.id); if (room.match.za && room.match.za.carrier === ws.id) room.match.za.carrier = null; broadcast(room, { t:'left', id:ws.id }); }
  if (!room.clients.length){ clearInterval(room.timer); rooms.delete(room.code); return; }
  if (room.host === ws){ room.host = room.clients[0]; if (room.match) for (const e of room.match.ents.values()) if (e.kind === 'bot'){ e.owner = room.host; } }
  broadcast(room, roomInfo(room));
}
function handle(ws, m){
  const room = ws.room, M = room && room.match, e = ws.ent;
  switch (m.t){
    case 'hello': {
      const token = String(m.token || '').slice(0, 64); if (token.length < 16) return send(ws, { t:'error', why:'bad token' });
      ws.token = token; ws.profile = profileOf(token); ws.dev = DEV_TOKENS.has(token);
      ws.name = String(m.name || 'PLAYER').replace(/[^\w .-]/g, '').slice(0, 16) || 'PLAYER';
      ws.tag = m.tag === 'DEV' ? 'DEV' : '';                // cosmetic name tag only — grants no developer rights
      ws.char = ownsChar(ws.profile, m.char) ? m.char : 'tracksuit'; ws.weapon = typeof m.weapon === 'string' ? m.weapon : 'glock';
      return send(ws, { t:'welcome', id:ws.id, profile:pubProfile(ws.profile), dev:ws.dev, version:S.version });
    }
    case 'loadout': { if (!ws.profile) return; if (ownsChar(ws.profile, m.char)) ws.char = m.char; if (S.weapons[m.weapon] && canUse(ws.profile, m.weapon)) ws.weapon = m.weapon; if (room) broadcast(room, roomInfo(room)); return; }
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
      const W = S.weapons[who.w]; if (W.kind === 'melee' || who.reloadUntil || who.mag >= W.mag || who.res <= 0) return;
      who.reloadUntil = M.clock + W.reloadTime * 0.95; return;
    }
    case 'equip': { if (!M || !e || !S.weapons[m.w]) return; if (m.w !== 'knife' && (!canUseIn(room, ws.profile, m.w) || !room.settings.weapons.includes(m.w) || room.settings.startWeapon === 'glock' && m.w !== 'glock')) return send(ws, { t:'reject', what:'equip', why:'locked or not allowed' }); if (m.w !== e.w){ e.w = m.w; if (m.w !== 'knife'){ e.mag = S.weapons[m.w].mag; e.res = S.weapons[m.w].reserve; } } return; }
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
    case 'search': {                             // trunk loot: rolled here, once per trunk per match
      if (!M || !e || !e.alive) return; if (!room.settings.items) return send(ws, { t:'reject', what:'search', why:'consumables are off in this room' }); const tr = S.trunks[m.id | 0]; if (!tr || M.searched.has(tr.id)) return send(ws, { t:'reject', what:'search', why:'already searched' });
      if (Math.hypot(e.pos[0]-tr.x, e.pos[2]-tr.z) > 2.2) return send(ws, { t:'reject', what:'search', why:'too far' });
      M.searched.add(tr.id); const found = [];
      for (const k of ['beer','blunt','zyn']) if (Math.random() < S.loot[k]){ if (e.items[k] < S.items[k].max){ e.items[k]++; found.push(k); } else found.push(k + '-full'); }
      if (Math.random() < S.loot.ammo){ e.res += Math.ceil(S.weapons[e.w].mag * 0.5); found.push('ammo'); }
      return send(ws, { t:'loot', found, items:e.items, res:e.res });
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
    case 'carhop': {
      if (!M || !e || !e.alive) return; const car = S.cars.find(c => c.name === m.car); if (!car || Math.hypot(e.pos[0]-car.x, e.pos[2]-car.z) > 4) return;
      const key = ws.id + ':' + car.name, last = M.carHops[key]; if (last !== undefined && M.clock - last < S.prog.carHop.cooldown) return send(ws, { t:'carhop', amount:0, wait:Math.ceil(S.prog.carHop.cooldown - (M.clock - last)) });
      M.carHops[key] = M.clock; let amount = 0;
      if (Math.random() < S.prog.carHop.chance){ amount = S.prog.carHop.min + crypto.randomInt(S.prog.carHop.max - S.prog.carHop.min + 1); ws.profile.cash += amount; saveProfiles(); }
      return send(ws, { t:'carhop', amount, profile:pubProfile(ws.profile) });
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
server.listen(PORT, () => console.log('O-Block server ' + S.version + ' on :' + PORT + (DEV_TOKENS.size ? ' · ' + DEV_TOKENS.size + ' developer account(s)' : '')));
module.exports = { blocked, cleanSettings, levelOf };
