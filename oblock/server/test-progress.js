'use strict';
/* Permanent-progression tests: earn rewards, crash / restart the server, reconnect, and check nothing is lost or paid twice.
   Runs against the file store, and against Postgres too when TEST_DATABASE_URL is set.
   Run:  node test-progress.js        (TEST_DATABASE_URL=postgres://... node test-progress.js) */
const { spawn } = require('child_process'), path = require('path'), fs = require('fs'), os = require('os');
const WebSocket = require('ws');
const S = JSON.parse(fs.readFileSync(path.join(__dirname, 'shared.json'), 'utf8'));
let pass = 0, fail = 0, PORT = 8931;
const ok = (c, name, x) => { if (c){ pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lvl = xp => 1 + Math.floor(xp / S.prog.xpPerLevel);

function startServer(env){
  const p = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env:Object.assign({}, process.env, { PORT, ALLOW_TELEPORT:'1' }, env), stdio:['ignore','pipe','pipe'] });
  p.out = ''; p.stdout.on('data', d => p.out += d); p.stderr.on('data', d => p.out += d);
  return new Promise(res => { const t = setInterval(() => { if (/on :\d+/.test(p.out)){ clearInterval(t); res(p); } }, 50); setTimeout(() => { clearInterval(t); res(p); }, 6000); });
}
function client(token, extra){
  return new Promise(res => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT), c = { ws, inbox:[], waiters:[] };
    c.send = m => ws.send(JSON.stringify(m));
    c.next = (t, pred = () => true, ms = 4000) => new Promise(resolve => {
      const i = c.inbox.findIndex(m => m.t === t && pred(m)); if (i >= 0) return resolve(c.inbox.splice(i, 1)[0]);
      const w = { t, pred, resolve }; c.waiters.push(w); setTimeout(() => { const k = c.waiters.indexOf(w); if (k >= 0){ c.waiters.splice(k, 1); resolve(null); } }, ms); });
    c.drain = t => { c.inbox = c.inbox.filter(m => m.t !== t); };
    ws.on('message', raw => { const m = JSON.parse(raw); const w = c.waiters.find(w => w.t === m.t && w.pred(m)); if (w){ c.waiters.splice(c.waiters.indexOf(w), 1); w.resolve(m); } else c.inbox.push(m); });
    ws.on('open', () => { c.send(Object.assign({ t:'hello', token, name:token.slice(0, 6) }, extra || {})); res(c); });
    ws.on('error', () => res(c));
  });
}
const put = (c, p) => c.send({ t:'st', p, yaw:0, pitch:0 });
// A kills B with Glock headshots (server-validated); returns A's profile message for the kill
async function kill(A, B, bid){
  put(A, [0, 0, 0]); put(B, [0, 0, 6]); await sleep(250); A.drain('profile');
  for (let i = 0; i < 8; i++){ A.send({ t:'shot', w:'glock', o:[0,0,0], hits:[{ id:bid, head:true, d:6 }] }); const k = await A.next('profile', m => m.why && /KILL|LEVEL/.test(m.why), 170); if (k) return k; }
  return null;
}
async function room(A, B, settings){
  A.send({ t:'create', settings }); const r = await A.next('room'); B.send({ t:'join', code:r.code }); await B.next('room', m => m.players.length === 2);
  A.send({ t:'start' }); await A.next('start'); await B.next('start'); await sleep(200);
}

async function suite(label, env, reset){
  console.log('\n== ' + label);
  if (reset) await reset();
  let srv = await startServer(env);
  ok(new RegExp('storage: ' + (env.DATABASE_URL ? 'postgres' : 'file')).test(srv.out), 'server reports its storage (' + (env.DATABASE_URL ? 'postgres' : 'file') + ')', srv.out.trim().split('\n').pop());
  const TA = 'progress-a-' + label.replace(/\W/g, '') + '-0123456', TB = 'progress-b-' + label.replace(/\W/g, '') + '-0123456';
  let A = await client(TA), B = await client(TB); const wa = await A.next('welcome'), wb = await B.next('welcome');
  ok(wa && wa.profile.cash === 0 && wa.profile.level === 1, 'new player starts at $0, level 1');

  console.log('-- a kill pays at once, and "saved" only arrives once storage has written it');
  await room(A, B, { mode:'dm', botsOn:false, kills:0, time:0, respawnDelay:1 });
  const k1 = await kill(A, B, wb.id); const sv = await A.next('saved', () => true, 4000);
  ok(k1 && k1.profile.cash === S.prog.cash.kill && k1.profile.xp === S.prog.xp.kill, 'kill reward: +$' + S.prog.cash.kill + ' / +' + S.prog.xp.kill + ' XP (no bots = ×1)', k1 && k1.profile);
  ok(sv && sv.rev >= 1, 'server confirms the save (rev ' + (sv && sv.rev) + ')');
  const before = k1.profile;

  console.log('-- the server crashes (SIGKILL, no clean shutdown) right after the confirmed save');
  srv.kill('SIGKILL'); await sleep(300); srv = await startServer(env);
  A = await client(TA); const wa2 = await A.next('welcome');
  ok(wa2 && wa2.profile.cash === before.cash && wa2.profile.xp === before.xp, 'after the crash: same cash and XP ($' + (wa2 && wa2.profile.cash) + ')', wa2 && wa2.profile);
  A.ws.close(); await sleep(150);
  A = await client(TA); const wa3 = await A.next('welcome');
  ok(wa3 && wa3.profile.cash === before.cash, 'reconnecting again does not pay anything twice');

  console.log('-- leaving mid-match keeps what was earned and records it');
  B = await client(TB); const wb2 = await B.next('welcome');
  await room(A, B, { mode:'dm', botsOn:false, kills:0, time:0, respawnDelay:1 });
  const k2 = await kill(A, B, wb2.id); await A.next('saved', () => true, 3000);
  A.send({ t:'leave' }); await sleep(600); A.ws.close(); await sleep(400);
  A = await client(TA); const wa4 = await A.next('welcome');
  ok(k2 && wa4 && wa4.profile.cash === k2.profile.cash && wa4.profile.cash === before.cash + S.prog.cash.kill, 'cash earned before leaving is kept ($' + (wa4 && wa4.profile.cash) + ')');
  const h = wa4 && wa4.profile.history && wa4.profile.history[0];
  ok(h && h.result === 'Left early' && h.kills === 1 && h.cash === S.prog.cash.kill, 'match history: "Left early", 1 kill, +$' + S.prog.cash.kill, h);

  console.log('-- a finished match: rewards once, levels kept, history entry');
  B.ws.close(); B = await client(TB); const wb3 = await B.next('welcome');
  await room(A, B, { mode:'dm', botsOn:false, kills:1, time:0 });
  await kill(A, B, wb3.id); const end = await A.next('end', () => true, 5000); await A.next('saved', () => true, 3000);
  const p = end && end.profile; srv.kill('SIGKILL'); await sleep(300); srv = await startServer(env);
  A = await client(TA); const wa5 = await A.next('welcome');
  ok(end && wa5 && wa5.profile.cash === p.cash && wa5.profile.xp === p.xp && wa5.profile.level === lvl(p.xp), 'end-of-match rewards survive a crash ($' + (wa5 && wa5.profile.cash) + ', level ' + (wa5 && wa5.profile.level) + ')');
  ok(wa5 && wa5.profile.history[0].result === 'Won' && wa5.profile.history.length === 2, 'history: Won, then Left early', wa5 && wa5.profile.history.map(x => x.result));

  console.log('-- purchases stay owned after a restart; a failed purchase costs nothing');
  A.send({ t:'buy', item:'taser' }); const nb = await A.next('reject', m => m.what === 'buy');
  ok(nb && /not enough cash/.test(nb.why), 'Taser ($5,000) refused without enough cash', nb);
  A.ws.close(); await sleep(200); A = await client(TA); const wa6 = await A.next('welcome');
  ok(wa6 && wa6.profile.cash === p.cash, 'the refused purchase took no cash');
  srv.kill('SIGKILL'); await sleep(300); srv = await startServer(Object.assign({ DEV_TOKENS:TA }, env));
  A = await client(TA); await A.next('welcome'); A.send({ t:'dev', cmd:'addCash', arg:6000 }); await A.next('profile');
  A.send({ t:'buy', item:'taser' }); const bt = await A.next('profile', m => m.bought === 'taser'); await A.next('saved', () => true, 3000);
  ok(bt && bt.profile.owned.taser === true && bt.profile.cash === p.cash + 6000 - 5000, 'Taser bought: $5,000 taken once', bt && bt.profile.cash);
  srv.kill('SIGKILL'); await sleep(300); srv = await startServer(env);
  A = await client(TA); const wa7 = await A.next('welcome');
  ok(wa7 && wa7.profile.owned.taser === true && wa7.profile.cash === bt.profile.cash, 'after another crash the Taser is still owned and cash is unchanged');

  console.log('-- bot difficulty multipliers (Easy 0.5x · Normal 1x · Hard 1.5x · Expert 2x)');
  for (const [d, mul] of [['easy',0.5],['normal',1],['hard',1.5],['expert',2]]){
    A.ws.close(); B.ws.close(); await sleep(150); A = await client(TA); B = await client(TB); await A.next('welcome'); const w = await B.next('welcome');
    await room(A, B, { mode:'dm', botsOn:true, bots:1, difficulty:d, kills:0, time:0, respawnDelay:1 });
    const k = await kill(A, B, w.id);
    const lv = k && k.why === 'LEVEL UP' ? S.prog.cash.level : 0;   // a kill that also levels you up adds the $25 level bonus
    ok(k && k.cash - lv === Math.round(S.prog.cash.kill * mul) && k.xp === Math.round(S.prog.xp.kill * mul), d + ' bots: kill pays ×' + mul + ' ($' + (k && k.cash - lv) + (lv ? ' + $' + lv + ' level-up' : '') + ', ' + (k && k.xp) + ' XP)', k && [k.cash, k.xp, k.why]);
  }
  A.send({ t:'settings', settings:{ mode:'dm', botsOn:true, bots:1, difficulty:'expert' } }); const lk = await A.next('reject', m => m.what === 'settings');
  ok(lk && /locked/.test(lk.why), 'difficulty cannot be changed while the match runs');

  console.log('-- farming the same player pays nothing after 3 kills in a minute');
  A.ws.close(); B.ws.close(); await sleep(150); A = await client(TA); B = await client(TB); await A.next('welcome'); const wf = await B.next('welcome');
  await room(A, B, { mode:'dm', botsOn:false, kills:0, time:0, respawnDelay:1 });
  const pays = []; for (let i = 0; i < 4; i++){ const k = await kill(A, B, wf.id); pays.push(k && k.cash); await sleep(1300); }
  ok(pays.slice(0, 3).every(c => c === S.prog.cash.kill) && pays[3] === 0, 'kills 1-3 pay, the 4th on the same player pays $0', pays);
  A.ws.close(); B.ws.close(); srv.kill('SIGTERM'); await sleep(400);
}

(async () => {
  const file = path.join(os.tmpdir(), 'oblock-progress-' + process.pid + '.json');
  await suite('file storage', { PROFILE_FILE:file }, async () => { for (const f of [file, file + '.bak']) try { fs.unlinkSync(f); } catch (e) {} });
  const url = process.env.TEST_DATABASE_URL;
  if (url){
    const { Client } = require('pg'); const db = new Client({ connectionString:url }); await db.connect();
    await suite('postgres storage', { PROFILE_FILE:path.join(os.tmpdir(), 'none-' + process.pid + '.json'), DATABASE_URL:url }, async () => { await db.query('DROP TABLE IF EXISTS oblock_profiles'); });

    console.log('\n== postgres: migration from an existing profiles.json, and no overwriting a newer copy');
    await db.query('DROP TABLE IF EXISTS oblock_profiles');
    const old = path.join(os.tmpdir(), 'oblock-old-' + process.pid + '.json'), T = 'veteran-player-token-99';
    fs.writeFileSync(old, JSON.stringify({ [T]:{ cash:777, xp:12345, owned:{ switch:true, jeff:true, cop:false, 'att:laser':true }, paid:[], v6:true } }));
    let srv = await startServer({ PROFILE_FILE:old, DATABASE_URL:url });
    ok(/imported 1 profiles/.test(srv.out), 'existing profiles.json imported into the database on first start');
    let V = await client(T); const wv = await V.next('welcome');
    ok(wv && wv.profile.cash === 777 && wv.profile.xp === 12345 && wv.profile.owned.switch && wv.profile.owned['att:laser'], 'a veteran keeps $777, level ' + (wv && wv.profile.level) + ', the Switch and the laser', wv && wv.profile);
    // another server instance (or a manual fix) writes a NEWER revision directly; this server must not overwrite it
    const id = require('crypto').createHash('sha256').update(T).digest('hex').slice(0, 40);
    await db.query("UPDATE oblock_profiles SET data = jsonb_set(data, '{cash}', '5000'), rev = 1000 WHERE id = $1", [id]);
    srv.kill('SIGKILL'); await sleep(300); srv = await startServer({ PROFILE_FILE:old, DATABASE_URL:url });
    V = await client(T); const wv2 = await V.next('welcome');
    ok(wv2 && wv2.profile.cash === 5000, 'the newer stored copy wins (never overwritten by an older one)', wv2 && wv2.profile.cash);
    V.ws.close(); srv.kill('SIGTERM'); await sleep(300); await db.end(); try { fs.unlinkSync(old); } catch (e) {}
  } else console.log('\n(skipping Postgres: set TEST_DATABASE_URL to run it)');
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
