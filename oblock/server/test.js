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

function client(token, extra){
  return new Promise(res => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT), c = { ws, inbox:[], waiters:[] };
    c.send = m => ws.send(JSON.stringify(m));
    c.next = (t, pred = () => true, ms = 3000) => new Promise((resolve) => {
      const i = c.inbox.findIndex(m => m.t === t && pred(m)); if (i >= 0) return resolve(c.inbox.splice(i, 1)[0]);
      const w = { t, pred, resolve }; c.waiters.push(w); setTimeout(() => { const k = c.waiters.indexOf(w); if (k >= 0){ c.waiters.splice(k, 1); resolve(null); } }, ms); });
    c.drain = t => { const out = c.inbox.filter(m => m.t === t); c.inbox = c.inbox.filter(m => m.t !== t); return out; };
    ws.on('message', raw => { const m = JSON.parse(raw); const w = c.waiters.find(w => w.t === m.t && w.pred(m)); if (w){ c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(m); } else c.inbox.push(m); if (c.inbox.length > 400) c.inbox.splice(0, 200); });
    ws.on('open', () => { c.send(Object.assign({ t:'hello', token, name:token.slice(0,6) }, extra)); res(c); });
  });
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env:Object.assign({}, process.env, { PORT, PROFILE_FILE:PROFILES, DEV_TOKENS:'devtoken-0123456789', DEV_PASSWORD:'test-dev-pass-123', ALLOW_TELEPORT:'1' }), stdio:'ignore' });
  await sleep(700);
  try {
    console.log('connections and developer accounts');
    const A = await client('devtoken-0123456789'); let B = await client('playertoken-abcdefgh');
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
    B.send({ t:'buy', item:'conur' }); const nc = await B.next('reject', m => m.what === 'buy');
    ok(S.prog.price.conur === 10000 && S.characters.conur.price === 10000 && nc && /not enough cash/.test(nc.why), 'Conur McNugget costs $10,000');
    ok(S.abilities.conur && S.abilities.conur.speedMul === 1.3 && S.abilities.conur.at === 10, 'Conur ability: +30% speed after a 10-kill streak');
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
    { // honest fire that arrives bunched up (network jitter) is accepted; a sustained rate above the gun's RPM is not
      const iv = 60 / S.weapons.glock.rpm; await sleep(iv * 4000); B.drain('reject');
      for (let k = 0; k < 4; k++){ B.send({ t:'shot', w:'glock', o:[-7,0,-12], hits:[] }); B.send({ t:'shot', w:'glock', o:[-7,0,-12], hits:[] }); await sleep(iv * 2000 + 15); }
      await sleep(200); ok(!B.drain('reject').some(m => /too fast/.test(m.why)), 'shots at the real fire rate that arrive two at a time are all accepted');
      await sleep(iv * 4000); B.drain('reject');
      for (let k = 0; k < 8; k++) B.send({ t:'shot', w:'glock', o:[-7,0,-12], hits:[] });
      const tf = await B.next('reject', m => m.what === 'shot' && /too fast/.test(m.why));
      ok(tf, 'firing faster than the weapon allows is rejected (8 shots at once)'); await sleep(300); B.drain('reject'); }
    B.send({ t:'reload' }); await sleep(S.weapons.glock.reloadTime * 1000 + 400 + (60 / S.weapons.glock.rpm) * 4000);
    B.send({ t:'shot', w:'glock', o:[-7,0,-12], hits:[{ id:wa.id, head:true, d:55 }] }); const lie = await B.next('reject', m => m.what === 'hits');
    ok(!!lie, 'a hit claimed at the wrong distance is rejected');
    await sleep(250);
    put(B, [-35, 0, -2]); await sleep(150);
    B.send({ t:'shot', w:'glock', o:[-35,0,-2], hits:[{ id:wa.id, head:true, d:28 }] }); const wall = await B.next('reject', m => m.what === 'hits');
    ok(!!wall, 'a hit through Building C is rejected (line of sight against the map colliders)');
    await sleep(250);
    B.send({ t:'shot', w:'glock', o:[-7,0,-12], hits:[{ id:wa.id, head:false, d:10 }] }); const om = await B.next('reject', m => m.what === 'shot');
    ok(om && /origin/.test(om.why), 'a shot from somewhere the player is not is rejected', om);
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

    console.log('MP7 ($3,000) and its 40-round extended magazine');
    A.send({ t:'buy', item:'mp7' }); const nm7 = await A.next('reject', m => m.what === 'buy'); ok(nm7 && /not enough cash/.test(nm7.why), 'the MP7 costs $3,000 (not enough cash)');
    A.send({ t:'dev', cmd:'addCash', arg:3150 }); await A.next('profile');
    A.send({ t:'buy', item:'mp7' }); const bm7 = await A.next('profile', m => m.bought === 'mp7'); ok(bm7 && bm7.profile.owned.mp7, 'MP7 bought and saved to the profile', bm7 && bm7.profile.owned);
    put(A, [-7, 0, -2]); await sleep(300); A.send({ t:'equip', w:'mp7' }); await sleep(250); B.drain('shotfx'); A.drain('reject');
    const burst = async n => { for (let i = 0; i < n; i++){ A.send({ t:'shot', w:'mp7', o:[-7, 0, -2], hits:[] }); await sleep(75); } };
    await burst(31); const e30 = await A.next('reject', m => m.why === 'empty', 600); ok(e30, 'MP7 factory magazine: 30 rounds (the 31st shot is refused)');
    A.send({ t:'loadout', weapon:'mp7', mags:{ mp7:'mag_ext' } }); A.send({ t:'reload' }); await sleep(2300);
    A.drain('reject'); await burst(30); const e40a = await A.next('reject', m => m.why === 'empty', 400); ok(!e40a, 'extended mag not owned: the server keeps the 30-round size', e40a);
    A.send({ t:'buy', item:'att:mag_ext' }); await A.next('profile', m => m.bought === 'att:mag_ext'); A.send({ t:'reload' }); await sleep(2300); A.drain('reject');
    await burst(41); const e40 = await A.next('reject', m => m.why === 'empty', 600); const fx = B.drain('shotfx').filter(m => m.by === wa.id && m.w === 'mp7').length;
    ok(e40 && fx >= 40, 'owned extended mag: the MP7 holds 40 rounds online (41st refused)', { fx, e40 });
    A.send({ t:'loadout', weapon:'sniper', mags:{} }); A.send({ t:'equip', w:'glock' }); await sleep(250);

    console.log('equipment online (landmines + flashbangs, server-validated)');
    put(B, [-7, 0, -5]); await sleep(200); A.drain('mine'); A.drain('mineoff'); A.drain('hit');
    B.send({ t:'mine', p:[-7, 0, -15] }); const mf = await B.next('reject', m => m.what === 'mine'); ok(mf && /too far/.test(mf.why), 'a mine placed out of reach is refused');
    B.send({ t:'mine', p:[-7, 0, -5.5] }); const mp = await A.next('mine'); ok(mp && mp.by === wb.id && mp.id > 0, 'a placed mine is shown to every player', mp);
    B.send({ t:'mine', p:[-6, 0, -5] }); const m2 = await B.next('reject', m => m.what === 'mine'); ok(m2 && /no mines/.test(m2.why), 'the per-player mine count is enforced (room setting)');
    await sleep(1800); put(A, [-7, 0, -4.4]); await sleep(150); put(A, [-7, 0, -6.5]);
    const mb = await A.next('mineoff', m => mp && m.id === mp.id, 1500), mh = await A.next('hit', m => m.target === wa.id, 600);
    ok(mb && mb.boom, 'an armed mine explodes when an enemy steps on it');
    ok(mh && mh.by === wb.id && mh.dmg > 0 && mh.dmg < 130, 'mine damage falls off with distance and is credited to its owner', mh);
    const mb2 = await A.next('mineoff', m => mp && m.id === mp.id, 500); ok(!mb2, 'a mine can only explode once');
    B.send({ t:'nade', o:[-7, 1.5, -5], v:[0, 3, -15] }); const nd = await A.next('nade'); ok(nd && nd.by === wb.id && nd.left === 1, 'a flashbang throw is shared with every player', nd);
    await sleep(900); B.send({ t:'nade', o:[20, 1.5, -5], v:[0, 3, -15] }); const no = await B.next('reject', m => m.what === 'nade'); ok(no && /origin/.test(no.why), 'a throw from somewhere else is refused');
    B.send({ t:'nade', o:[-7, 1.5, -5], v:[0, 3, -15] }); await A.next('nade'); await sleep(900);
    B.send({ t:'nade', o:[-7, 1.5, -5], v:[0, 3, -15] }); const n3 = await B.next('reject', m => m.what === 'nade'); ok(n3 && /no flashbangs/.test(n3.why), 'the flashbang count is enforced');
    put(A, [-7, 0, -2]); await sleep(200);

    console.log('reconnect after a dropped connection (30 s to rejoin the same match)');
    put(A, [-7, 0, -2]); put(B, [-7, 0, -6]); await sleep(300); A.drain('hit'); A.drain('away'); A.drain('left');
    const kB = (await A.next('snap', m => m.ents.some(x => x[0] === wb.id), 1500)).ents.find(x => x[0] === wb.id);
    B.ws.terminate(); const aw = await A.next('away', m => m.id === wb.id && m.on); ok(aw && aw.secs === 30, 'a dropped player is announced as away, with 30 s to return', aw);
    ok(!(await A.next('left', m => m.id === wb.id, 400)), 'their place in the match is kept (not removed)');
    await sleep(250); A.drain('snap'); const sB = (await A.next('snap', m => true, 1500)).ents.find(x => x[0] === wb.id); ok(sB && sB[7] === 0, 'while away they are off the field (cannot be shot)', sB);
    A.send({ t:'shot', w:'glock', o:[-7, 0, -2], hits:[{ id:wb.id, head:false, d:4 }] }); ok(!(await A.next('hit', m => m.target === wb.id, 500)), 'shooting an away player does nothing');
    const X = await client('someone-else-entirely-xyz'); const wx = await X.next('welcome'); ok(wx && !wx.resumed, 'another account cannot take the seat');
    X.ws.close();
    const B2 = await client('playertoken-abcdefgh', { rejoin:true });
    const w2 = await B2.next('welcome'), st2 = await B2.next('start');
    ok(w2 && w2.resumed && w2.id === wb.id, 'the same account gets its seat back (same player id)', w2 && [w2.resumed, w2.id]);
    const me2 = st2 && st2.ents.find(x => x.id === wb.id);
    ok(st2 && st2.resume && st2.matchId && me2 && Math.abs(me2.pos[2] + 6) < 0.5, 'they rejoin the running match where they stood', me2);
    const bk = await A.next('away', m => m.id === wb.id && !m.on); ok(bk, 'everyone is told they are back');
    A.drain('snap'); const rB = (await A.next('snap', m => true, 1500)).ents.find(x => x[0] === wb.id); ok(rB && rB[7] === 1 && rB[9] === kB[9] && rB[10] === kB[10], 'alive again with the same kills and deaths', [kB, rB]);
    put(B2, [-7, 0, -6]); await sleep(150);
    A.send({ t:'shot', w:'glock', o:[-7, 0, -2], hits:[{ id:wb.id, head:false, d:4 }] }); ok(await A.next('hit', m => m.target === wb.id, 800), 'and they are back in the fight (can be hit)');
    B = B2;

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
    console.log('Gang Wars custom teams (host-made, server-validated)');
    const F2 = await client('gangplayer-three-ccccccc'), G2 = await client('gangplayer-four-ddddddd'); const fw2 = await F2.next('welcome'), gw2 = await G2.next('welcome');
    F2.send({ t:'create', settings:{ mode:'gang', kills:0, time:0, friendlyFire:true, teams:[{ name:'east side', col:'#3fd46a', emblem:'♠', bots:1 }, { name:'west', col:'#bad', bots:1 }, { name:'<b>x</b>', emblem:'⚡', bots:0, max:2, start:'shotgun' }, {}, {}] } });
    const cr = await F2.next('room'), T3 = cr && cr.settings.teams;
    ok(T3 && T3.length === 4 && T3[0].name === 'EAST SIDE' && T3[0].col === '#3fd46a' && T3[1].col === '#4aa8ff' && T3[2].name === 'BXB' && T3[2].start === 'shotgun', 'team names / colours / emblems / gear are cleaned by the server (max 4 teams)', T3);
    ok(cr && cr.settings.bots === 2 && cr.settings.friendlyFire === true && cr.settings.teamSwitch === false, 'bots come from each team\'s bot count; switching is locked by default', cr && cr.settings);
    G2.send({ t:'join', code:cr.code }); await G2.next('room', m => m.players.length === 2);
    F2.send({ t:'settings', settings:Object.assign({}, cr.settings, { teams:T3.slice(0, 3), assign:{ [fw2.id]:2, [gw2.id]:2 } }) }); await F2.next('room', m => m.settings.assign && m.settings.assign[gw2.id] === 2);
    F2.send({ t:'start' }); const cs = await G2.next('start'), TT = id => cs.ents.find(e => e.id === id).team;
    ok(cs && TT(fw2.id) === 2 && TT(gw2.id) === 2, 'the host\'s manual assignment is kept (no random teams)', cs && cs.ents.map(e => [e.id, e.team]));
    ok(cs && cs.ents.filter(e => e.kind === 'bot').map(e => e.team).join() === '0,1', 'bots are placed on the teams the host chose', cs && cs.ents.map(e => [e.kind, e.team]));
    ok(cs && cs.ents.find(e => e.id === fw2.id).w === 'shotgun', 'team starting equipment is applied', cs && cs.ents.find(e => e.id === fw2.id).w);
    G2.send({ t:'team', team:0 }); const tl = await G2.next('reject', m => m.what === 'team'); ok(tl && /locked/.test(tl.why), 'teams are locked mid-match unless the host allows switching');
    const p2 = cs.ents.find(e => e.id === fw2.id).pos; put(F2, p2); put(G2, [p2[0], 0, p2[2] + 4]); await sleep(300); F2.drain('hit');
    F2.send({ t:'equip', w:'glock' }); await sleep(250);
    F2.send({ t:'shot', w:'glock', o:p2, hits:[{ id:gw2.id, head:false, d:4 }] }); const fh = await F2.next('hit', m => m.target === gw2.id, 800);
    ok(fh && fh.dmg > 0, 'friendly fire on: teammates can be hurt', fh);
    F2.ws.close(); G2.ws.close();
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
    { // ---- RUN THAT FADE
    console.log('RUN THAT FADE + fists (server-decided punches, blocks, knockdowns, 1v1 fights)');
    const X = await client('fadefighter-one-aaaaaaa'), Y = await client('fadefighter-two-bbbbbbb'), Z = await client('fadewatcher-ccccccccccc');
    const wx = await X.next('welcome'), wy = await Y.next('welcome'), wz = await Z.next('welcome');
    X.send({ t:'create', settings:{ mode:'fade', bots:4, weapons:['glock','ar15'] } }); const fr = await X.next('room');
    ok(fr && fr.settings.mode === 'fade' && fr.settings.bots === 0 && fr.settings.flash === 0 && fr.settings.time === 0, 'Run That Fade room: no bots, no equipment, no time limit', fr && fr.settings);
    Y.send({ t:'join', code:fr.code }); Z.send({ t:'join', code:fr.code }); await X.next('room', m => m.players.length === 3);
    X.send({ t:'start' }); const fs0 = await Z.next('start'); const EN = id => fs0.ents.find(e => e.id === id);
    ok(fs0 && fs0.fade && fs0.fade.state === 'wait' && fs0.ents.every(e => e.w === 'fists' && e.kind === 'player'), 'everyone starts with fists, no bots, waiting for the host', fs0 && fs0.ents.map(e => [e.kind, e.w]));
    const AR = S.arena, ringR = p => Math.hypot(p[0] - AR.o[0], p[2] - AR.o[1]);
    ok(fs0.ents.every(e => ringR(e.pos) > AR.fenceR + 1 && e.pos[1] === 0), 'players wait outside the cage, by the benches', fs0.ents.map(e => e.pos));
    Y.send({ t:'fade', cmd:'start', a:wy.id, b:wz.id }); const nh = await Y.next('reject', m => m.what === 'fade'); ok(nh && /host/.test(nh.why), 'only the host picks fights');
    X.send({ t:'fade', cmd:'start', a:wy.id, b:wz.id }); const cnt = await Z.next('fade', m => m.st.state === 'count');
    ok(cnt && cnt.st.a === wy.id && cnt.st.b === wz.id, 'the host picks the two fighters (countdown)', cnt && cnt.st);
    const ry = await Y.next('respawn', m => m.id === wy.id && m.pos[1] > 0.5), rz = await Z.next('respawn', m => m.id === wz.id && m.pos[1] > 0.5);
    ok(ry && rz && Math.abs(ry.pos[1] - AR.mat) < 0.01 && Math.abs(ry.pos[0] - AR.corners[0][0]) < 0.01 && Math.abs(rz.pos[0] - AR.corners[1][0]) < 0.01, 'fighters are put on opposite sides of the mat', [ry && ry.pos, rz && rz.pos]);
    Y.send({ t:'equip', w:'fists' }); Z.send({ t:'equip', w:'fists' }); X.send({ t:'equip', w:'fists' });
    const yp = ry.pos, zp = [yp[0] + 1.4, yp[1], yp[2]]; put(Y, yp); put(Z, zp); put(X, [AR.spots[0][0], 0, AR.spots[0][1]]); await sleep(300);
    Y.send({ t:'shot', w:'fists', o:yp, hits:[{ id:wz.id, head:false, heavy:false, d:1.4 }] }); const early = await Z.next('hit', m => m.target === wz.id, 500); ok(!early, 'no damage during the countdown');
    await Z.next('fade', m => m.st.state === 'fight', 4000);
    put(X, [AR.o[0] + 0.5, AR.mat, AR.o[1]]); const kicked = await X.next('respawn', m => m.id === wx.id, 1500); ok(kicked && ringR(kicked.pos) > AR.fenceR, 'a spectator inside the cage is moved back out', kicked && kicked.pos);
    X.drain('reject'); X.send({ t:'shot', w:'fists', o:kicked.pos, hits:[{ id:wy.id, head:false, d:1 }] }); const sp = await X.next('reject', m => m.what === 'shot'); ok(sp && /not fighting/.test(sp.why), 'spectators cannot punch the fighters');
    await sleep(400); Z.drain('hit');
    Y.send({ t:'shot', w:'fists', o:yp, hits:[{ id:wz.id, head:false, heavy:false, d:1.4 }, { id:wz.id, head:false, d:1.4 }] }); const j = await Z.next('hit', m => m.target === wz.id);
    ok(j && j.dmg === 12 && j.w === 'fists', 'a jab does 12 (one punch can only land once)', j);
    Y.drain('reject'); Y.send({ t:'shot', w:'fists', o:yp, hits:[{ id:wz.id, head:false, heavy:false, d:1.4 }] }); const fast = await Y.next('reject', m => /too fast/.test(m.why), 500); ok(fast, 'punch cooldown is enforced', Y.drain('reject'));
    await sleep(300); ok(!Z.drain('hit').length, 'the second hit in the same punch is ignored'); await sleep(100); Y.send({ t:'shot', w:'fists', o:yp, c:1, hits:[{ id:wz.id, head:false, heavy:true, d:1.4 }] }); const capH = await Z.next('hit', m => m.target === wz.id);
    ok(capH && capH.dmg < 42, 'a claimed full charge is capped by the real time since the last punch', capH && capH.dmg); await sleep(200); ok(!Z.drain('stun').length, 'a half-charged punch does not knock down');
    Z.send({ t:'block', on:true }); await sleep(200); await sleep(1100);
    Y.send({ t:'shot', w:'fists', o:yp, c:1, hits:[{ id:wz.id, head:false, heavy:true, d:1.4 }] }); const bl = await Z.next('hit', m => m.target === wz.id);
    // Z faces yaw 0 (-z); Y is at -x: not facing, so the block does not count
    ok(bl && !bl.blocked && bl.dmg === 42, 'a block only works facing the punch (full charge lands: 42)', bl);
    const kd = await Z.next('stun', m => m.id === wz.id, 800); ok(kd && kd.knock && kd.dur === 1.8, 'an unblocked full-charge punch knocks the target down', kd);
    await sleep(2000); Z.send({ t:'st', p:zp, yaw:Math.PI/2, pitch:0 }); Z.send({ t:'block', on:true }); await sleep(1000);
    Y.send({ t:'shot', w:'fists', o:yp, c:1, hits:[{ id:wz.id, head:false, heavy:true, d:1.4 }] }); const bf = await Z.next('hit', m => m.target === wz.id);
    ok(bf && bf.blocked && bf.dmg === Math.round(42 * 0.25), 'blocking facing the punch cuts it to a quarter (no knockdown)', bf);
    Z.send({ t:'block', on:false }); let hpz = bf ? bf.hp : 0, n = 0;
    while (hpz > 0 && n++ < 20){ await sleep(400); Y.send({ t:'shot', w:'fists', o:yp, hits:[{ id:wz.id, head:false, heavy:false, d:1.4 }] }); const h = await Z.next('hit', m => m.target === wz.id, 600); if (h) hpz = h.hp; }
    const res = await X.next('fade', m => m.st.state === 'result', 1500); ok(res && res.st.last && res.st.last.w === wy.id && res.st.last.l === wz.id && res.st.last.how === 'ko', 'knockout: the winner and loser are announced', res && res.st);
    const back = await X.next('fade', m => m.st.state === 'wait', 5000); const ry2 = await X.next('respawn', m => m.id === wy.id && m.pos[1] < 0.5 && m.hp === 100, 3000);
    ok(back && ry2 && ringR(ry2.pos) > AR.fenceR + 1 && ry2.hp === 100, 'after the fight both go back to the benches, healed', ry2);
    await sleep(3200); X.send({ t:'fade', cmd:'next' }); const nx = await Z.next('fade', m => m.st.state === 'count');
    ok(nx && [nx.st.a, nx.st.b].includes(wx.id), 'NEXT TWO puts the player who has waited longest in', nx && nx.st);
    const quitter = nx.st.a === wx.id ? X : nx.st.a === wy.id ? Y : Z, qid = nx.st.a, oid = nx.st.b;
    Z.drain('fade'); quitter.send({ t:'fade', cmd:'forfeit' }); const ff = await Z.next('fade', m => m.st.state === 'result'); ok(ff && ff.st.last.l === qid && ff.st.last.w === oid && ff.st.last.how === 'forfeit', 'a fighter can forfeit back to the waiting area', ff && ff.st);
    console.log('mod menu (developer only, server-checked)');
    await sleep(3800); X.drain('reject'); X.send({ t:'dev', cmd:'kill', arg:wy.id }); const nd = await X.next('reject', m => m.what === 'dev'); ok(nd && /not a developer/.test(nd.why), 'a normal player cannot use the kill button');
    X.send({ t:'devauth', pw:'test-dev-pass-123' }); await X.next('devauth');
    Y.drain('respawn'); X.send({ t:'dev', cmd:'kill', arg:wy.id }); const dk = await Z.next('kill', m => m.target === wy.id);
    ok(dk && dk.w === 'mystery' && dk.by === null, 'a developer can kill a chosen player: nobody is told who did it, no reward', dk);
    const rs = await Y.next('respawn', m => m.id === wy.id, 6000); ok(rs, 'the killed player respawns normally');
    Y.drain('profile'); X.send({ t:'dev', cmd:'give', arg:{ id:wy.id, what:'cash', n:500 } }); const gc = await Y.next('gift'), gp = await Y.next('profile');
    ok(gc && gc.what === 'cash' && gc.n === 500 && gp && gp.profile.cash >= 500, 'give: cash goes to their saved profile', [gc, gp && gp.profile.cash]);
    X.send({ t:'dev', cmd:'give', arg:{ id:wy.id, what:'own:conur' } }); const go = await Y.next('profile', m => m.profile.owned.conur); ok(go, 'give: unlock a character for them');
    X.send({ t:'dev', cmd:'give', arg:{ id:wy.id, what:'beer', n:2 } }); const gb = await Y.next('gift', m => m.what === 'beer'); ok(gb && gb.items.beer === 2, 'give: in-match items (2 beers)', gb);
    X.send({ t:'dev', cmd:'give', arg:{ id:wy.id, what:'flash', n:3 } }); const gf = await Y.next('gift', m => m.what === 'flash'); ok(gf && gf.flash === 3, 'give: flashbangs', gf);
    Y.send({ t:'dev', cmd:'give', arg:{ id:wy.id, what:'cash', n:99999 } }); const gn = await Y.next('reject', m => m.what === 'dev'); ok(gn && /not a developer/.test(gn.why), 'a normal player cannot give');
    X.drain('reject'); X.send({ t:'dev', cmd:'give', arg:{ id:'p999', what:'cash', n:5 } }); const gx = await X.next('reject', m => m.what === 'dev'); ok(gx && /not in your match/.test(gx.why), 'only players in your match can be given things');
    X.drain('reject'); X.send({ t:'dev', cmd:'kill', arg:'nobody' }); const nk = await X.next('reject', m => m.what === 'dev'); ok(nk && /no such/.test(nk.why), 'killing someone who is not there is refused');
    X.ws.close(); Y.ws.close(); Z.ws.close();
    }
    A.ws.close(); B.ws.close();
    const log = fs.readFileSync(path.join(__dirname, 'devlog.jsonl'), 'utf8').trim().split('\n').length;
    ok(log >= 2, 'developer actions were written to devlog.jsonl');
  } catch (e) { fail++; console.error(e); }
  srv.kill(); try { fs.unlinkSync(PROFILES); } catch (e) {}
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
