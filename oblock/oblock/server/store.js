/* O-Block player storage: the permanent home of online progression (cash, XP / level, purchases, history, preferences).

   Two back-ends, picked at start-up:
   - Postgres, when DATABASE_URL is set (recommended on free hosting such as Render, whose own disk is wiped on every
     restart). One row per player, keyed by a hash of the player's secret token. Every write is a single atomic upsert
     guarded by a revision number, so an older copy can never overwrite a newer one, even if two writes race.
   - A JSON file otherwise (local play / development). Written atomically: new data goes to a temp file which is then
     renamed over the old one, and the previous good copy is kept as .bak, so a crash mid-write can't corrupt saves.

   Profiles live in memory while players are connected. Changes are flushed within a second (and every few seconds as a
   safety net); each successful write calls onSaved(token, rev) so the game can confirm "saved" only when it really is,
   and failed writes are retried with back-off while the player is warned. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const hashTok = t => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 40);

function createStore(opt){
  const file = opt.file, url = opt.url, onSaved = opt.onSaved || (() => {}), onFail = opt.onFail || (() => {});
  const mem = new Map();            // token -> profile (loaded profiles)
  const last = new Map();           // token -> JSON last confirmed on disk / in the database
  const failing = new Map();        // token -> retry count
  let pool = null, fileData = {}, flushT = null, busy = false, again = false;

  async function init(){
    if (url){
      const { Pool } = require('pg');
      pool = new Pool({ connectionString:url, max:4, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized:false } });
      await pool.query(`CREATE TABLE IF NOT EXISTS oblock_profiles (id text PRIMARY KEY, data jsonb NOT NULL, rev bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now())`);
      // one-time import of an existing profiles.json (keeps everyone's balance when switching to the database)
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM oblock_profiles');
      if (rows[0].n === 0 && fs.existsSync(file)){
        try { const old = JSON.parse(fs.readFileSync(file, 'utf8')); let n = 0;
          for (const [tok, p] of Object.entries(old)){ await pool.query('INSERT INTO oblock_profiles (id, data, rev) VALUES ($1, $2, 1) ON CONFLICT (id) DO NOTHING', [hashTok(tok), p]); n++; }
          console.log('store: imported ' + n + ' profiles from ' + path.basename(file)); } catch (e){ console.error('store: import failed', e.message); }
      }
      console.log('store: Postgres');
    } else {
      for (const f of [file, file + '.bak']){ try { fileData = JSON.parse(fs.readFileSync(f, 'utf8')); if (f !== file) console.warn('store: main file unreadable, recovered from .bak'); break; } catch (e) {} }
      console.log('store: file ' + path.basename(file) + ' (' + Object.keys(fileData).length + ' profiles)');
    }
    setInterval(() => flush(), 5000).unref();
  }

  // load (or create) a player's profile; resolves once it is in memory
  async function load(token, fresh){
    if (mem.has(token)) return mem.get(token);
    let p = null;
    if (pool){ const { rows } = await pool.query('SELECT data, rev FROM oblock_profiles WHERE id = $1', [hashTok(token)]); if (rows[0]){ p = rows[0].data; p.rev = Number(rows[0].rev); } }
    else if (fileData[token]) p = fileData[token];
    if (mem.has(token)) return mem.get(token);         // another connection loaded it meanwhile
    const isNew = !p; p = p || fresh(); p.rev = p.rev || 0;
    mem.set(token, p); last.set(token, isNew ? '' : JSON.stringify(p));
    return p;
  }
  const changed = () => [...mem.entries()].filter(([t, p]) => JSON.stringify(p) !== last.get(t));

  // write every profile that changed since its last confirmed save
  async function flush(){
    if (busy){ again = true; return; } busy = true;
    try {
      const list = changed(); if (!list.length) return;
      if (pool){
        for (const [tok, p] of list){
          p.rev = (p.rev || 0) + 1; const j = JSON.stringify(p);
          try {
            const r = await pool.query(`INSERT INTO oblock_profiles (id, data, rev, updated_at) VALUES ($1, $2, $3, now())
              ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, rev = EXCLUDED.rev, updated_at = now() WHERE oblock_profiles.rev < EXCLUDED.rev`, [hashTok(tok), j, p.rev]);
            if (r.rowCount === 0){ // the database already holds a newer revision: never overwrite it, reload instead
              const { rows } = await pool.query('SELECT data, rev FROM oblock_profiles WHERE id = $1', [hashTok(tok)]);
              if (rows[0] && Number(rows[0].rev) >= p.rev){ const fresh = rows[0].data; fresh.rev = Number(rows[0].rev); for (const k of Object.keys(p)) delete p[k]; Object.assign(p, fresh); }
            }
            last.set(tok, JSON.stringify(p)); failing.delete(tok); onSaved(tok, p.rev);
          } catch (e){ p.rev--; const n = (failing.get(tok) || 0) + 1; failing.set(tok, n); onFail(tok, n, e.message); }
        }
      } else {
        for (const [tok, p] of list){ p.rev = (p.rev || 0) + 1; fileData[tok] = p; }
        const tmp = file + '.tmp', body = JSON.stringify(fileData);
        try {
          fs.writeFileSync(tmp, body); try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch (e) {}
          fs.renameSync(tmp, file);
          for (const [tok, p] of list){ last.set(tok, JSON.stringify(p)); failing.delete(tok); onSaved(tok, p.rev); }
        } catch (e){ for (const [tok, p] of list){ p.rev--; const n = (failing.get(tok) || 0) + 1; failing.set(tok, n); onFail(tok, n, e.message); } }
      }
    } finally { busy = false; if (again){ again = false; setTimeout(flush, 50); } else if (failing.size) setTimeout(flush, Math.min(15000, 1000 * 2 ** Math.min(4, Math.max(...failing.values())))); }
  }
  function soon(){ clearTimeout(flushT); flushT = setTimeout(flush, 250); }
  // drop a disconnected player's profile from memory once it is safely written
  function release(token){ setTimeout(() => { const p = mem.get(token); if (p && JSON.stringify(p) === last.get(token)) { mem.delete(token); last.delete(token); } }, 30000).unref(); }
  return { init, load, flush, soon, release, get mode(){ return pool ? 'postgres' : 'file'; }, hashTok, close: () => pool && pool.end() };
}
module.exports = { createStore };
