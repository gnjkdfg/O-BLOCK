'use strict';
/* Automated protocol tests for the O-Block server. Starts its own server on a spare port with a throw-away profile file.
   Run:  node test.js        (exit code 0 = all passed) */
const { spawn } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os');
const WebSocket = require('ws');
const PORT = 8899, PROFILES = path.join(os.tmpdir(), 'oblock-test-profiles-' + process.pid + '.json');
const S = JSON.parse(fs.readFileSync(path.join(__dirname, 'shared.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond){ pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function client(token){
  return new Promise(res => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT), c = { ws, inbox:[], waiters:[] };
    c.send = m => ws.send(JSON.stringify(m));
    c.next = (t, pred = () => true, ms = 3000) => new Promise((resolve) => {
      const i = c.inbox.findIndex(m => m.t === t && pred(m)); if (i >= 0) return resolve(c.inbox.splice(i, 1)[0]);
      const w = { t, pred, resolve }; c.waiters.push(w); setTimeout(() => { const k = c.waiters.indexOf(w); if (k >= 0){ c.waiters.splice(k, 1); resolve(null); } }, ms); });
    c.drain = t => { c.inbox = c.inbox.filter(m => m.t !== t); };
    ws.on('message', raw => { const m = JSON.parse(raw); const w = c.waiters.find(w => w.t === m.t && w.pred(m)); if (w){ c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(m); } else c.inbox.push(m); if (c.inbox.length > 400) c.inbox.splice(0, 200); });
    ws.on('open', () => { c.send({ t:'hello', token, name:token.slice(0,6) }); res(c); });
  });
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env:Object.assign({}, process.env, { PORT, PROFILE_FILE:PROFILES, DEV_TOKENS:'devtoken-0123456789', DEV_PASSWORD:'test-dev-pass-123', ALLOW_TELEPORT:'1' }), stdio:'ignore' });
  await sleep(700);
  try {
    console.log('connections and developer accounts');
    const A = await client('devtoken-0123456789'), B = await client('playertoken-abcdefgh');
    const wa = await A.next('welcome'), wb = await B.next('welcome');
    ok(wa && wa.dev === true, 'developer account recognised from DEV_TOKENS');
    ok(wb && wb.dev === false && wb.profile.level === 1 && wb.profile.cash === 0, 'new player starts at level 1 with $0', wb && wb.profile);
    B.send({ t:'dev', cmd:'addCash', arg:99999 }); const rj = await B.next('reject', m => m.what === 'dev');
    ok(rj && /not a developer/.test(rj.why), 'non-developer cannot use developer commands');
    A.send({ t:'dev', cmd:'setLevel', arg:20 }); const pa = await A.next('profile');
    ok(pa && pa.profile.level === 20, 'developer setLevel works (and is logged)');

    console.log('purchases (server-validated)');
    B.send({ t:'buy', item:'switch' }); const nb = await B.next('reject', m => m.what === 'buy');
    ok(nb && /not enough cash/.test(nb.why), 'cannot buy the Switch without cash');
    A.send({ t:'dev', cmd:'addCash', arg:6000 }); await A.next('profile');
    A.send({ t:'buy', item:'cop' }); const bc = await A.next('profile', m => m.bought === 'cop');
    ok(bc && bc.profile.owned.cop && bc.profile.cash === 1000, 'buying the Cop costs $5,000 and is saved', bc && bc.profile);
    A.send({ t:'buy', item:'cop' }); const dup = await A.next('reject', m => m.what === 'buy');
    ok(dup && /already owned/.test(dup.why), 'cannot buy the same thing twice');
    A.send({ t:'buy', item:'sniper' }); const bs = await A.next('reject', m => m.what === 'buy'); ok(bs && /unknown item/.test(bs.why), 'most guns are free: there is nothing to buy');
    A.send({ t:'buy', item:'ar15' }); const b15 = await A.next('reject', m => m.what === 'buy'); ok(b15 && /not enough cash/.test(b15.why), 'the AR-15 costs $10,000 (not enough cash)');
    B.send({ t:'buy', item:'att:scope25' }); const ba = await B.next('reject', m => m.what === 'buy'); ok(ba && /not enough cash/.test(ba.why), 'attachments cost cash too');

    console.log('rooms');
    A.send({ t:'loadout', char:'cop', weapon:'sniper' }); B.send({ t:'loadout', char:'cop', look:{ jacket:'Red', pants:'Navy' }, weapon:'ar15' });
    A.send({ t:'create', settings:{ mode:'dm', botsOn:false, bots:0, kills:2, time:0 } }); const room = await A.next('room');
    ok(room && /^[A-Z0-9]{5}$/.test(room.code) && room.host === wa.id, 'create room returns a 5-character code', room);
    B.send({ t:'join', code:'ZZZZZ' }); const bad = await B.next('error'); ok(bad && /no room/.test(bad.why), 'joining a wrong code is refused');
    B.send({ t:'join', code:room.code }); const r2 = await B.next('room', m => m.players.length === 2);
    ok(r2 && r2.players.length === 2, 'second player joins by code');
    ok(r2 && r2.players.find(p => p.id === wb.id).char === 'cop', 'private match: any character the host allows can be used (no purchase needed)');
    ok(r2 && r2.players.find(p => p.id === wb.id).look.jacket === 'Red', 'outfit colours are shared with the room', r2 && r2.players.find(p => p.id === wb.id).look);
    B.send({ t:'settings', settings:{ mode:'backpack' } }); await sleep(200);
    A.send({ t:'settings', settings:{ mode:'dm', botsOn:false, bots:0, kills:2, time:0, difficulty:'nightmare' } }); const r3 = await B.next('room', m => m.settings.kills === 2);
    ok(r3 && r3.settings.mode === 'dm' && r3.settings.difficulty === 'normal', 'only the host changes settings; bad values are cleaned', r3 && r3.settings);
    B.send({ t:'start' }); const ns = await B.next('error'); ok(ns && /only the host/.test(ns.why), 'only the host can start');
    A.send({ t:'start' }); const st = await B.next('start');
    ok(!!st, 'host starts the match');
    const ea = st.ents.find(e => e.id === wa.id), eb = st.ents.find(e => e.id === wb.id);
    ok(ea.w === 'sniper' && eb.w !== 'ar15', 'free guns start as picked; an AR-15 that was not bought is not used', [ea.w, eb.w]);
    ok(st.ents.every(e => S.spawns.some(s => Math.hypot(s[0]-e.pos[0], s[1]-e.pos[2]) < 0.01)), 'everyone spawns on one of the 15 validated points');

    console.log('shots and damage (server-validated)');
    // stand the players 10 m apart in the open courtyard
    const put = (c, p) => c.send({ t:'st', p, yaw:0, pitch:0 });
    put(A, [-7, 0, -2]); put(B, [-7, 0, -12]); await sleep(300);
    B.send({ t:'equip', w:'glock' }); const le = await B.next('reject', m => m.what === 'equip', 400); ok(!le, 'free guns: switching to the Glock at level 1 is accepted'); await sleep(300);
    B.send({ t:'shot', w:'glock', o:[-7,0,-12], hits:[{ id:wa.id, head:false, d:10 }] }); const h1 = await A.next('hit');
    ok(h1 && h1.target === wa.id && h1.dmg === S.weapons.glock.dmg, 'valid Glock body shot: damage is the server table value (' + S.weapons.glock.dmg + ')', h1);
    B.send({ t:'shot', w:'glock', o:[-7,0,-12], hits:[{ id:wa.id, head:false, d:10 }] }); const tf = await B.next('reject', m => m.what === 'shot');
    ok(tf && /too fast/.test(tf.why), 'firing faster than the weapon allows is rejected');
    await sleep(250);
    B.send({ t:'shot', w:'glock', o:[-7,0,-12], hits:[{ id:wa.id, head:true, d:55 }] }); const lie = await B.next('reject', m => m.what === 'hits');
    ok(!!lie, 'a hit claimed at the wrong distance is rejected');
    await sleep(250);
    put(B, [-35, 0, -2]); await sleep(150);
    B.send({ t:'shot', w:'glock', o:[-35,0,-2], hits:[{ id:wa.id, head:true, d:28 }] }); const wall = await B.next('reject', m => m.what === 'hits');
    ok(!!wall, 'a hit through Building C is rejected (line of sight against the map colliders)');
    await sleep(250);
    B.send({ t:'shot', w:'glock', o:[-7,0,-12], hits:[{ id:wa.id, head:false, d:10 }] }); const om = await B.next('reject', m => m.what === 'shot');
    ok(om && /origin/.test(om.why), 'a shot from somewhere the player is not is rejected');
    put(B, [-7, 0, -12]); await sleep(150);
    // empty the magazine: the server counts rounds
    let empty = null; for (let i = 0; i < 20 && !empty; i++){ B.send({ t:'shot', w:'glock', o:[-7,0,-12], hits:[] }); empty = await B.next('reject', m => m.what === 'shot' && /empty/.test(m.why), 140); }
    ok(!!empty, 'the server tracks ammo: an empty magazine cannot fire');
    B.send({ t:'reload' }); await sleep(S.weapons.glock.reloadTime * 1000 + 250);
    // kill A (100 hp): headshots from 10 m
    A.drain('hit'); A.drain('respawn'); let killed = null;
    for (let i = 0; i < 6 && !killed; i++){ B.send({ t:'shot', w:'glock', o:[-7,0,-12], hits:[{ id:wa.id, head:true, d:10 }] }); killed = await B.next('kill', m => m.target === wa.id, 300); }
    ok(killed && killed.by === wb.id, 'kills are decided by the server');
    const prof = await B.next('profile', m => m.why === 'KILL'); ok(prof && prof.profile.cash === S.prog.cash.kill && prof.profile.xp === S.prog.xp.kill, 'kill reward ($10, 100 XP) paid by the server', prof && prof.profile);
    const rs = await A.next('respawn', m => m.id === wa.id, 5000); ok(rs && rs.hp === 100, 'the server respawns the dead player after 3.5 s');

    console.log('items');
    B.send({ t:'use', item:'beer' }); const nu = await B.next('reject', m => m.what === 'use'); ok(!!nu, 'using an item you do not have is refused');
    B.send({ t:'search', id:0 }); const sr = await B.next('reject', m => m.what === 'search'); ok(sr && /too far/.test(sr.why), 'searching a trunk from across the map is refused');
    const tr = S.trunks[0]; put(B, [tr.x, 0, tr.z]); await sleep(150); B.send({ t:'search', id:0 }); const lt = await B.next('loot'); ok(!!lt, 'trunk loot is rolled by the server', lt && lt.found);
    B.send({ t:'search', id:0 }); const again = await B.next('reject', m => m.what === 'search'); ok(again && /already/.test(again.why), 'a trunk can only be searched once per match');

    console.log('match end and rewards');
    put(B, [-7, 0, -12]); put(A, rs.pos); await sleep(300);
    A.send({ t:'st', p:[-7,0,-2], yaw:0, pitch:0 }); await sleep(300);
    if (process.env.DEBUG){ B.drain('snap'); const sn = await B.next('snap'); console.log('    snap', JSON.stringify(sn.ents.map(e => e.slice(0,4).concat([e[7], e[8]])))); }
    let end = null; for (let i = 0; i < 40 && !end; i++){ B.send({ t:'shot', w:'glock', o:[-7,0,-12], hits:[{ id:wa.id, head:true, d:10 }] }); end = await B.next('end', () => true, 350);
      if (!end){ const r = await B.next('reject', m => m.what === 'shot' || m.what === 'hits', 10); if (r && process.env.DEBUG) console.log('    reject', r.what, r.why); if (r && /empty/.test(r.why)){ B.send({ t:'reload' }); await sleep(1800); } } }
    ok(end && end.winner === wb.id, 'kill limit (2) ends the match on the server', end && end.winner);
    const endA = await A.next('end'); ok(endA && endA.rewards.cash === S.prog.cash.participation + S.prog.cash.second, 'loser is paid participation + 2nd place', endA && endA.rewards);
    ok(end && end.rewards.cash === S.prog.cash.participation + S.prog.cash.win, 'winner is paid participation + win', end && end.rewards);
    const saved = JSON.parse(fs.readFileSync(PROFILES, 'utf8') || '{}'); await sleep(400);
    const saved2 = JSON.parse(fs.readFileSync(PROFILES, 'utf8')); const pb = saved2['playertoken-abcdefgh'];
    ok(pb && pb.paid.length === 1, 'the match is recorded as paid exactly once', pb && pb.paid);

    console.log('THE FIGHT FOR ZA');
    await sleep(1700);
    A.send({ t:'settings', settings:{ mode:'backpack', botsOn:false, bots:0, variant:'hold', time:6 } }); await A.next('room', m => m.settings.mode === 'backpack');
    A.send({ t:'start' }); const zs = await A.next('start', m => m.settings.mode === 'backpack');
    ok(!!zs, 'ZA match starts');
    const snap = await A.next('snap', m => !!m.za); const bag = snap.za;
    B.send({ t:'pickup' }); const far = await B.next('reject', m => m.what === 'pickup'); ok(far && /too far/.test(far.why), 'picking up the bag from far away is refused');
    put(A, [bag.x, bag.y, bag.z]); await sleep(200); A.send({ t:'pickup' }); const car = await B.next('carrier'); ok(car && car.id === wa.id, 'the server gives the bag to the player standing on it');
    const zend = await A.next('end', () => true, 9000);
    ok(zend && zend.winner === wa.id && zend.rows[0].hold > 3, 'longest accumulated hold time wins when the clock runs out', zend && zend.rows);
    ok(zend && zend.rewards.lines.some(l => l.label === 'Victory' && l.xp === S.prog.xp.zaWin), 'ZA win pays the ZA win XP', zend && zend.rewards);

    console.log('private match settings (host-configured, server-validated)');
    await sleep(1700); A.drain('end'); B.drain('end'); A.drain('room'); B.drain('start');
    A.send({ t:'settings', settings:{ mode:'dm', botsOn:false, bots:0, kills:0, time:0, maxPlayers:2, xpMul:5, cashMul:0.5, weapons:['sniper','nonsense'], respawnOn:false, hp:150, name:'<b>Test</b> room' } });
    const rs1 = await A.next('room', m => m.settings.hp === 150);
    ok(rs1 && rs1.settings.xpMul === 1 && rs1.settings.cashMul === 0.5, 'rewards can be lowered but never raised (XP ×5 → ×1)', rs1 && rs1.settings);
    ok(rs1 && rs1.settings.weapons.join() === 'glock,sniper' && !/[<>]/.test(rs1.settings.name), 'weapon list cleaned (unknown removed, Glock always allowed); room name sanitised', rs1 && [rs1.settings.weapons, rs1.settings.name]);
    const C = await client('thirdplayer-zzzzzzzz'); await C.next('welcome'); C.send({ t:'join', code:room.code }); const full = await C.next('error');
    ok(full && /full \(2/.test(full.why), 'max players (2) is enforced when joining', full);
    A.send({ t:'start' }); const ps = await B.next('start', m => m.settings.hp === 150);
    const pa2 = ps && ps.ents.find(e => e.id === wa.id), pb2 = ps && ps.ents.find(e => e.id === wb.id);
    ok(pa2 && pa2.hp === 150 && pb2.hp === 150, 'starting health (150) is applied by the server', ps && ps.ents.map(e => e.hp));
    ok(pa2 && pa2.w === 'sniper' && pb2.w === 'glock', 'start weapons respect the allowed list and each player\'s unlocks', ps && ps.ents.map(e => e.w));
    A.send({ t:'settings', settings:{ mode:'dm', hp:50 } }); const lk = await A.next('reject', m => m.what === 'settings');
    ok(lk && /locked/.test(lk.why), 'settings are locked once the match starts');
    B.send({ t:'equip', w:'ar15' }); const ne = await B.next('reject', m => m.what === 'equip'); ok(!!ne, 'a weapon that is off in this room cannot be equipped');
    A.send({ t:'ability' }); const ab = await A.next('reject', m => m.what === 'ability');
    ok(ab && /10 kills in a row \(0\/10\)/.test(ab.why), 'Cop ability is refused before a 10-kill streak (server-counted)', ab);
    put(A, [-7, 0, -2]); put(B, [-7, 0, -12]); await sleep(300);
    let pend = null, pk = null; B.drain('profile'); B.drain('end');
    for (let i = 0; i < 30 && !pend; i++){ B.send({ t:'shot', w:'glock', o:[-7,0,-12], hits:[{ id:wa.id, head:true, d:10 }] }); pend = await B.next('end', () => true, 350);
      if (!pend){ const r = await B.next('reject', m => m.what === 'shot', 10); if (r && /empty/.test(r.why)){ B.send({ t:'reload' }); await sleep(1800); } } }
    ok(pend && pend.winner === wb.id, 'respawns off: the last player standing wins', pend && pend.winner);
    pk = pend && pend.rewards.lines.find(l => /Kills/.test(l.label)); ok(pk && pk.cash === Math.round(S.prog.cash.kill * 0.5) && pk.xp === S.prog.xp.kill, 'cash ×0.5 applied to kill rewards, XP unchanged', pk);
    C.ws.close();

    console.log('character ability: 10-kill streak, manual, until death');
    await sleep(1700); A.drain('end'); B.drain('end');
    A.send({ t:'settings', settings:{ mode:'dm', botsOn:false, bots:0, kills:0, time:0, hp:50, respawnOn:true, respawnDelay:1, weapons:['sniper'] } }); await A.next('room', m => m.settings.hp === 50 && m.settings.respawnOn);
    A.send({ t:'start' }); await A.next('start', m => m.settings.hp === 50); await sleep(200);
    let kills = 0, ready = null;
    for (let i = 0; i < 80 && !ready; i++){
      put(A, [-7, 0, -2]); put(B, [-7, 0, -12]); await sleep(60);
      A.send({ t:'shot', w:'sniper', o:[-7,0,-2], hits:[{ id:wb.id, head:false, d:10 }] });
      const k = await A.next('kill', m => m.by === wa.id, 700); if (k) kills++;
      ready = await A.next('abready', m => m.id === wa.id, 10);
      if (!k){ const r = await A.next('reject', m => m.what === 'shot', 10); if (r && /empty/.test(r.why)){ A.send({ t:'reload' }); await sleep(S.weapons.sniper.reloadTime * 1000 + 200); } }
      await sleep(1150);
    }
    ok(ready && kills === 10, 'the server unlocks Double Damage at exactly 10 kills in a row', { kills, ready });
    A.send({ t:'ability' }); const act = await B.next('ability', m => m.id === wa.id);
    ok(act && act.name === 'DOUBLE DAMAGE', 'manual activation after the streak is accepted and broadcast');
    A.send({ t:'ability' }); const twice = await A.next('reject', m => m.what === 'ability'); ok(twice && /already active/.test(twice.why), 'it cannot be activated twice');

    console.log('developer sign-in (password only on the server) and window sync');
    const D = await client('fourthplayer-yyyyyyyy'); await D.next('welcome');
    D.send({ t:'dev', cmd:'addCash', arg:500 }); const d0 = await D.next('reject', m => m.what === 'dev'); ok(!!d0, 'developer commands are refused before signing in');
    D.send({ t:'devauth', pw:'nope' }); const d1 = await D.next('devauth'); ok(d1 && !d1.ok, 'a wrong password is refused');
    D.send({ t:'devauth', pw:'nope2' }); await D.next('devauth'); D.send({ t:'devauth', pw:'nope3' }); await D.next('devauth');
    D.send({ t:'devauth', pw:'test-dev-pass-123' }); const d2 = await D.next('devauth'); ok(d2 && !d2.ok && /wait/.test(d2.why), 'after 3 wrong tries even the right password has to wait', d2);
    const E2 = await client('fifthplayer-xxxxxxxxx'); const E2w = await E2.next('welcome'), E2id = E2w.id;
    E2.send({ t:'devauth', pw:'test-dev-pass-123' }); const d3 = await E2.next('devauth'); ok(d3 && d3.ok, 'the right password (server DEV_PASSWORD) signs in');
    E2.send({ t:'dev', cmd:'addCash', arg:250 }); const d4 = await E2.next('profile'); ok(d4 && d4.profile.cash === 250, 'signed-in developer commands are accepted and applied by the server', d4 && d4.profile);
    E2.send({ t:'create', settings:{ mode:'dm', botsOn:false, bots:0, kills:0, time:0 } }); const gr = await E2.next('room');
    D.send({ t:'join', code:gr.code }); await D.next('room', m => m.players.length === 2);
    E2.send({ t:'start' }); await D.next('start'); E2.send({ t:'glass', id:7 }); const gm = await D.next('glass');
    ok(gm && gm.id === 7, 'a shot-out window is sent to the other players');
    E2.send({ t:'glass', id:7 }); const gdup = await D.next('glass', () => true, 400); ok(!gdup, 'the same window is only broken once');
    console.log('knife (server knows when you switch to it)');
    put(D, [0, 0, 0]); put(E2, [0, 0, 1.5]); await sleep(250);
    D.send({ t:'equip', w:'knife' }); await sleep(150); E2.drain('hit');
    D.send({ t:'shot', w:'knife', o:[0,0,0], hits:[{ id:E2id, head:false, heavy:false, d:1.5 }] }); const kh = await E2.next('hit');
    ok(kh && kh.dmg === S.weapons.knife.dmg, 'a knife stab deals damage online (' + S.weapons.knife.dmg + ')', kh);
    D.ws.close(); E2.ws.close();

    console.log('Gang Wars (teams)');
    const F = await client('gangplayer-one-aaaaaaa'), G = await client('gangplayer-two-bbbbbbb'); const fw = await F.next('welcome'), gw = await G.next('welcome');
    F.send({ t:'create', settings:{ mode:'gang', botsOn:true, bots:2, kills:1, time:0 } }); const groom = await F.next('room');
    ok(groom && groom.settings.mode === 'gang' && groom.settings.kills === 1, 'the host can pick Gang Wars', groom && groom.settings);
    G.send({ t:'join', code:groom.code }); await G.next('room', m => m.players.length === 2);
    F.send({ t:'start' }); const gs = await G.next('start');
    const T = id => gs.ents.find(e => e.id === id).team;
    ok(T(fw.id) !== T(gw.id) && gs.ents.filter(e => e.team === 0).length === 2 && gs.ents.filter(e => e.team === 1).length === 2, 'players and bots are split evenly into Red and Blue', gs.ents.map(e => [e.id, e.team]));
    const mate = gs.ents.find(e => e.kind === 'bot' && e.team === T(fw.id)), fpos = gs.ents.find(e => e.id === fw.id).pos;
    const dm = Math.hypot(mate.pos[0]-fpos[0], mate.pos[1]-fpos[1], mate.pos[2]-fpos[2]);
    F.drain('hit'); G.drain('hit');
    F.send({ t:'shot', w:'glock', o:fpos, hits:[{ id:mate.id, head:false, d:+dm.toFixed(2) }] }); const ff = await F.next('hit', m => m.target === mate.id, 600);
    ok(!ff, 'no friendly fire: shooting your own gang does nothing');
    put(F, [0, 0, 0]); put(G, [0, 0, 6]); await sleep(300);
    let gend = null; for (let i = 0; i < 8 && !gend; i++){ await sleep(160); F.send({ t:'shot', w:'glock', o:[0,0,0], hits:[{ id:gw.id, head:true, d:6 }] }); gend = await G.next('end', () => true, 120); }
    if (!gend) gend = await G.next('end', () => true, 1500);
    ok(gend && gend.winner === 'team' + T(fw.id), 'the first gang to the kill limit wins', gend && gend.winner);
    F.ws.close(); G.ws.close();

    console.log('profile backup (survives a server restart / wiped disk)');
    const seal = d4 && d4.profile.seal; ok(!!(seal && seal.d && seal.s), 'every profile update carries a signed backup');
    const PORT2 = PORT + 1, PROF2 = PROFILES + '.2';
    const srv2 = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env:Object.assign({}, process.env, { PORT:PORT2, PROFILE_FILE:PROF2 }), stdio:'ignore' }); await sleep(700);
    const raw = (token, restore) => new Promise(res => { const ws = new WebSocket('ws://127.0.0.1:' + PORT2); ws.on('open', () => ws.send(JSON.stringify({ t:'hello', token, name:'x', restore })));
      ws.on('message', r => { const m = JSON.parse(r); if (m.t === 'welcome'){ ws.close(); res(m); } }); });
    const stolen = await raw('somebody-else-zzzzzzzz', seal); ok(stolen && !stolen.restored && stolen.profile.cash === 0, 'someone else cannot use your backup');
    const forged = await raw('fifthplayer-xxxxxxxxx', { d:seal.d.replace('"cash":250', '"cash":99999'), s:seal.s }); ok(forged && !forged.restored, 'an edited backup is refused');
    const back = await raw('fifthplayer-xxxxxxxxx', seal); ok(back && back.restored && back.profile.cash === 250, 'after a wipe your cash and purchases come back', back && back.profile);
    srv2.kill(); try { fs.unlinkSync(PROF2); } catch (e) {}
    A.ws.close(); B.ws.close();
    const log = fs.readFileSync(path.join(__dirname, 'devlog.jsonl'), 'utf8').trim().split('\n').length;
    ok(log >= 2, 'developer actions were written to devlog.jsonl');
  } catch (e) { fail++; console.error(e); }
  srv.kill(); try { fs.unlinkSync(PROFILES); } catch (e) {}
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
