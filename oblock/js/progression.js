'use strict';
/* Progression and economy: cash, XP, levels, weapon unlocks, purchases (Glock Switch, characters),
   match rewards (paid once per match), car-hopping cash.

   ProfileAuthority owns the profile and validates every change (purchases, unlocks, rewards, cooldowns).
   Offline it runs in the page and saves to localStorage; online, the same requests go to the game server
   (server/server.js), which keeps its own copy and is the only one allowed to change it. Offline saves can
   be edited by anyone with browser dev tools; that is true of every client-only game, which is why the
   online server never trusts the client's numbers.

   Developer tools: there is no cheat code in this file or anywhere in the published game. The developer
   panel only exists when a local, unpublished config file (js/dev.local.js) is loaded, or, online, when
   the server marks the account as a developer (and logs every action). */

const PROG = {
  xpPerLevel: 1000,                       // flat: every level costs 1,000 XP; levels keep going past 100
  xp:   { kill:100, win:250, participation:50, objective:100, objectiveCap:5, holdWin:250, zaWin:250 },
  cash: { win:100, kill:10, second:50, third:25, participation:10, level:25 },   // level: paid for every level gained
  carHop: { chance:1/3, min:1, max:20, cooldown:120 },          // per vehicle, seconds
  unlock: {},                             // no level locks: every gun is free except the AR-15 ($10,000); attachments are bought with cash
  price:  { ar15:10000, switch:500, jeff:1000, cop:5000,
            'att:dot_open':100, 'att:dot_closed':125, 'att:scope15':200, 'att:scope25':300, 'att:vgrip':100, 'att:brace':125,
            'att:skeleton':150, 'att:folding':175, 'att:suppressor':250, 'att:compensator':125, 'att:laser':75, 'att:flashlight':75,
            'att:mag_ext':150, 'att:mag_drum':300 },                                       // attachments: bought once, fit every gun they're made for
};
const levelOf = xp => 1 + Math.floor(Math.max(0,xp) / PROG.xpPerLevel);
const fmtCash = n => '$' + Math.floor(n).toLocaleString('en-US');

const ProfileAuthority = {
  s:null, match:null, log:[],
  load(){
    const d = Store.get('profile', null) || {};
    this.s = { cash: d.cash|0, xp: d.xp|0, owned: Object.assign({switch:false, jeff:false, cop:false}, d.owned||{}), paid: (d.paid||[]).slice(-50), unlimited: !!d.unlimited, v6: !!d.v6 };
    // one-time move to the cash economy: guns you had already reached by level stay yours, attachments you were using stay
    // yours, and you get the $25-per-level reward for the levels you already have
    if (!this.s.v6){ const L=this.level(), OLD={drako:10, sniper:20, shotgun:50, ar15:100};
      for (const w in OLD) if (L>=OLD[w]) this.s.owned[w]=true;
      for (const id of WEAPON_ORDER) for (const a of Object.values((Store.get('wcustom',{})[id]||{}).att||{})) if (a && PROG.price['att:'+a]!==undefined) this.s.owned['att:'+a]=true;
      this.s.cash += (L-1)*PROG.cash.level; this.s.v6=true; this.save(); }
    // characters that need buying fall back to the free one if they are not owned
    if (!this.ownsChar(CharLook.char)){ CharLook.char='tracksuit'; Object.assign(CharLook, CHARACTERS.tracksuit.defaults, Store.get('look_tracksuit',{})); }
  },
  // online: the server's profile is shown (and purchases go to the server); the offline profile is kept aside and restored
  useRemote(p){
    if (p){ if (!this.local) this.local=this.s; this.s={cash:p.cash, xp:p.xp, owned:Object.assign({switch:false,jeff:false,cop:false},p.owned), paid:[], unlimited:false, remote:true}; }
    else if (this.local){ this.s=this.local; this.local=null; }
    Bus.emit('profile');
  },
  save(){ if (this.s.remote) return; Store.set('profile', {cash:this.s.cash, xp:this.s.xp, owned:this.s.owned, paid:this.s.paid, unlimited:this.s.unlimited, v6:this.s.v6}); },
  // ---- queries
  get cash(){ return this.s.unlimited ? Infinity : this.s.cash; },
  get xp(){ return this.s.xp; },
  level(){ return levelOf(this.s.xp); },
  levelProgress(){ const x=this.s.xp%PROG.xpPerLevel; return {cur:x, need:PROG.xpPerLevel, k:x/PROG.xpPerLevel}; },
  price(item){ return PROG.price[item]; },
  canUse(id){ return !!WEAPON_DEFS[id] && (PROG.price[id]===undefined || this.owns(id)); },   // guns are free unless they have a price (AR-15)
  ownsAtt(a){ return !a || PROG.price['att:'+a]===undefined || this.owns('att:'+a); },
  owns(item){ return !!this.s.owned[item]; },
  ownsChar(id){ return !CHARACTERS[id] || !CHARACTERS[id].price || this.owns(id); },
  // ---- purchases (validated: known item, not owned, enough cash)
  buy(item){
    if (this.s.remote){ Net.send({t:'buy', item}); return {ok:false, why:'sent to the server', pending:true}; }
    const price = PROG.price[item]; if (price===undefined) return {ok:false, why:'unknown item'};
    if (this.s.owned[item]) return {ok:false, why:'already owned'};
    if (!this.s.unlimited && this.s.cash < price) return {ok:false, why:'need '+fmtCash(price-this.s.cash)+' more'};
    if (!this.s.unlimited) this.s.cash -= price;
    this.s.owned[item]=true; this.save(); Bus.emit('profile');
    return {ok:true};
  },
  // ---- XP / cash with notifications
  addXP(n, why){
    const before=this.level(); this.s.xp += n; this.save();
    Bus.emit('xp', {n, why}); const after=this.level();
    if (after>before){ Bus.emit('levelup', after); if (!this.s.remote) this.addCash((after-before)*PROG.cash.level, 'LEVEL '+after); }   // $25 every level (online the server pays it)
    Bus.emit('profile');
  },
  addCash(n, why){ this.s.cash += n; this.save(); Bus.emit('cash', {n, why}); Bus.emit('profile'); },
  // ---- matches: one record per match; end-of-match rewards are paid exactly once per match id
  beginMatch(mode, variant){
    const id = Date.now().toString(36)+Math.random().toString(36).slice(2,8);
    this.match = {id, mode, variant, kills:0, objective:0, ended:false, earned:{xp:0, cash:0}, lines:[]};
    this.carHops = {};
    return id;
  },
  // a kill reported by the match (Match.kill is the in-page authority for kills)
  kill(matchId){
    const m=this.match; if (!m || m.id!==matchId || m.ended || Net.inMatch) return;   // online: the server pays kills
    m.kills++; m.earned.xp+=PROG.xp.kill; m.earned.cash+=PROG.cash.kill;
    this.addXP(PROG.xp.kill, 'KILL'); this.addCash(PROG.cash.kill, 'KILL');
  },
  objective(matchId, why){
    const m=this.match; if (Net.inMatch || !m || m.id!==matchId || m.ended || m.objective>=PROG.xp.objectiveCap) return;
    m.objective++; m.earned.xp+=PROG.xp.objective; this.addXP(PROG.xp.objective, why||'OBJECTIVE');
  },
  // place: 1-based finishing position; won: true for the winner
  finishMatch(matchId, place, won){
    const m=this.match; if (!m || m.id!==matchId || m.ended) return null;
    m.ended=true;
    if (this.s.paid.includes(matchId)) return null;              // never paid twice
    this.s.paid.push(matchId); this.s.paid=this.s.paid.slice(-50);
    const lines=[]; let xp=0, cash=0;
    const add=(label, x, c)=>{ lines.push({label, xp:x, cash:c}); xp+=x; cash+=c; };
    if (m.kills) lines.push({label:'Kills ×'+m.kills, xp:m.kills*PROG.xp.kill, cash:m.kills*PROG.cash.kill, already:true});
    if (m.objective) lines.push({label:'Objective ×'+m.objective, xp:m.objective*PROG.xp.objective, cash:0, already:true});
    add('Participation', PROG.xp.participation, PROG.cash.participation);
    if (won){
      const wx = m.mode==='backpack' ? (m.variant==='classic' ? PROG.xp.holdWin : PROG.xp.zaWin) : PROG.xp.win;
      add('Victory', wx, PROG.cash.win);
    } else if (place===2) add('2nd place', 0, PROG.cash.second);
    else if (place===3) add('3rd place', 0, PROG.cash.third);
    const lvl0=this.level();
    this.s.xp+=xp; this.s.cash+=cash; this.save();
    const lvl1=this.level();
    if (lvl1>lvl0){ const lc=(lvl1-lvl0)*PROG.cash.level; this.s.cash+=lc; cash+=lc; lines.push({label:'Level up ×'+(lvl1-lvl0), xp:0, cash:lc}); this.save(); Bus.emit('levelup', lvl1); }
    Bus.emit('profile');
    return {lines, xp, cash, totalXP:xp+m.earned.xp, totalCash:cash+m.earned.cash, level:lvl1, levelBefore:lvl0};
  },
  // car hopping: 1 in 3 chance of $1-$20, each vehicle only once per cooldown
  carHop(vehId){
    if (Net.inMatch){ Net.send({t:'carhop', car:vehId}); return {ok:true, pending:true}; }
    const now=performance.now()/1000, last=(this.carHops||{})[vehId];
    if (last!==undefined && now-last < PROG.carHop.cooldown) return {ok:false, why:'searched recently', wait:Math.ceil(PROG.carHop.cooldown-(now-last))};
    (this.carHops=this.carHops||{})[vehId]=now;
    if (Math.random() >= PROG.carHop.chance) return {ok:true, amount:0};
    const amount = PROG.carHop.min + Math.floor(Math.random()*(PROG.carHop.max-PROG.carHop.min+1));
    this.addCash(amount, 'CAR HOP'); return {ok:true, amount};
  },
  // ---- developer actions: only reachable when Dev.enabled (local config or server-granted); every call is logged
  dev(cmd, arg){
    if (!Dev.enabled) return {ok:false, why:'developer tools are not enabled'};
    if (this.s.remote && cmd!=='testing'){ Net.send({t:'dev', cmd, arg}); return {ok:true, sent:true}; }    // online: the server decides
    const s=this.s, before={cash:s.cash, xp:s.xp};
    switch(cmd){
      case 'unlockAll': for (const k in PROG.price) s.owned[k]=true; break;
      case 'setLevel': s.xp=(Math.max(1,arg|0)-1)*PROG.xpPerLevel; break;
      case 'setXP': s.xp=Math.max(0,arg|0); break;
      case 'addCash': s.cash+=Math.max(0,arg|0); break;
      case 'unlimitedCash': s.unlimited=!!arg; break;
      case 'testing': break;                      // testing toggles (no damage / infinite ammo): logged, profile unchanged
      case 'reset': s.cash=0; s.xp=0; s.owned={switch:false, jeff:false, cop:false}; s.unlimited=false; break;
      default: return {ok:false, why:'unknown command'};
    }
    this.save(); Bus.emit('profile');
    const entry={t:new Date().toISOString(), cmd, arg, before, after:{cash:s.cash, xp:s.xp}};
    const log=Store.get('devlog',[]); log.push(entry); Store.set('devlog', log.slice(-200));
    return {ok:true};
  },
};

/* Developer menu (Update 5). Nothing in the normal interface points to it: no button, no Settings entry, no hint.
   Opening it: press P 10 times within 10 seconds (key-repeat ignored, another key resets the count, ignored while
   typing) -> a small password dialog. Built into the game: works offline and online, on any site.
   The password itself is never stored: only a salted PBKDF2 fingerprint (150 000 rounds, so guessing is slow), and
   wrong tries are rate-limited. Online, the O-Block server checks the same password before it accepts developer
   commands for your profile. Unlocks last for this page session only. */
const DEV_KEY = { salt:'ba20b3f8355b6ec41e6375b69e0b2c93', iter:150000, dk:'8647ed4f59b77937300e0580ce9da70f8d6eec19e33d87e7ed697112421a50d8' };
async function devCheck(pw){
  try {
    const hexb=h=>new Uint8Array(h.match(/../g).map(x=>parseInt(x,16)));
    const base=await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
    const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:hexb(DEV_KEY.salt), iterations:DEV_KEY.iter}, base, 256));
    const want=hexb(DEV_KEY.dk); let d=0; for (let i=0;i<32;i++) d|=bits[i]^want[i]; return d===0;
  } catch(e){ return false; }
}
const Dev = {
  enabled:false, remote:false, god:false, infAmmo:false, wall:false, aim:'off',
  seq:{n:0, t0:0}, fails:0, lockUntil:0,
  init(){
    addEventListener('keydown', e=>{
      const t=e.target, typing = t && (t.tagName==='INPUT' || t.tagName==='TEXTAREA' || t.isContentEditable);
      if (typing || e.repeat) return;
      if (e.code!=='KeyP'){ this.seq.n=0; return; }
      const now=performance.now();
      if (this.seq.n===0 || now-this.seq.t0>10000){ this.seq.n=0; this.seq.t0=now; }
      if (++this.seq.n>=10){ this.seq.n=0; if (this.enabled) this.toggle(); else this.authPrompt(); }
    }, true);
  },
  authPrompt(){
    let m=document.getElementById('devauth'); if (m) m.remove();
    if (document.pointerLockElement) document.exitPointerLock();
    m=document.createElement('div'); m.id='devauth'; m.className='panel';
    m.innerHTML='<h3>DEVELOPER SIGN-IN</h3><input type="password" id="devauth-in" autocomplete="off" spellcheck="false" style="width:100%"><p class="err" id="devauth-err"></p><div class="btns"><button id="devauth-cancel">CLOSE</button><button class="primary" id="devauth-ok">SIGN IN</button></div>';
    document.body.appendChild(m); const inp=document.getElementById('devauth-in'), err=document.getElementById('devauth-err'); inp.focus();
    const close=()=>m.remove();
    const go=async()=>{
      const now=performance.now(); if (now<this.lockUntil){ err.textContent='Too many attempts · wait '+Math.ceil((this.lockUntil-now)/1000)+' s'; return; }
      const pw=inp.value; inp.value=''; if (!pw) return; err.textContent='Checking…';
      const r=await this.verify(pw);
      if (r.ok){ this.fails=0; close(); this.enabled=true; this.remote=!!r.remote; if (Settings.devTag===undefined){ Settings.devTag=true; saveSettings(); } Bus.emit('profile'); Bus.emit('devtag'); this.toggle(); if (r.why) UI.toast('DEV · SERVER: '+String(r.why).toUpperCase(),'warn'); return; }
      this.fails++; if (this.fails>=3) this.lockUntil=performance.now()+Math.min(60000, 5000*2**(this.fails-3));
      err.textContent=r.why||'Incorrect password'; inp.focus();
    };
    document.getElementById('devauth-ok').onclick=go; document.getElementById('devauth-cancel').onclick=close;
    inp.onkeydown=e=>{ e.stopPropagation(); if (e.key==='Enter') go(); if (e.key==='Escape') close(); };
  },
  async verify(pw){
    const ok=await devCheck(pw);
    if (!ok) return {ok:false};
    // online: also sign in on the server so it accepts developer commands for your saved profile
    if (typeof Net!=='undefined' && Net.connected){ const r=await Net.devAuth(pw); return {ok:true, remote:!!r.ok, why:r.ok?'':r.why}; }
    return {ok:true};
  },
  lock(){ this.enabled=false; this.remote=false; this.god=false; this.infAmmo=false; this.wall=false; this.aim='off'; const p=document.getElementById('devpanel'); if (p) p.remove(); Bus.emit('profile'); Bus.emit('devtag'); },
  showTag(){ return this.enabled && Settings.devTag!==false; },
  toggle(){
    let p=document.getElementById('devpanel');
    if (p){ p.remove(); return; }
    if (document.pointerLockElement) document.exitPointerLock();
    p=document.createElement('div'); p.id='devpanel';
    const S=ProfileAuthority.s;
    p.innerHTML=`<b>DEVELOPER MENU</b><small>Every action is logged${S.remote?' · online: the server checks your developer sign-in':''}</small>
      <div><button data-c="unlockAll">Unlock all</button><button data-c="reset">Reset profile</button></div>
      <div><label>Level <input id="dv-lvl" type="number" min="1" value="${ProfileAuthority.level()}"></label><button data-c="setLevel">Set</button></div>
      <div><label>XP <input id="dv-xp" type="number" min="0" value="${S.xp}"></label><button data-c="setXP">Set</button></div>
      <div><label>Cash + <input id="dv-cash" type="number" min="0" value="1000"></label><button data-c="addCash">Add</button></div>
      <div><label><input id="dv-unl" type="checkbox" ${S.unlimited?'checked':''}> Unlimited cash</label></div>
      <div><label><input id="dv-god" type="checkbox" ${this.god?'checked':''}> Take no damage (testing)</label></div>
      <div><label><input id="dv-ammo" type="checkbox" ${this.infAmmo?'checked':''}> Infinite reserve ammo (testing)</label></div>
      <div>Aim assist <select id="dv-aim"><option value="off">Off</option><option value="body">Aim lock (body)</option><option value="head">Head lock</option></select><small style="display:block">Locks on while you aim or shoot, to the nearest target you can see near the crosshair</small></div>
      <div><label><input id="dv-wall" type="checkbox" ${this.wall?'checked':''}> Wall hack (see players and bots through walls)</label></div>
      <div><label><input id="dv-tag" type="checkbox" ${Settings.devTag!==false?'checked':''}> Show DEV tag above my name</label></div>
      <div><button data-c="copyControls">Copy my controls</button></div>
      <div><button data-c="night">Skip to night</button><button data-c="day">Skip to day</button></div>
      <div><button data-c="lock">Sign out</button><button data-c="close">Close</button></div>`;
    document.body.appendChild(p);
    const v=id=>+document.getElementById(id).value;
    p.querySelectorAll('button').forEach(b=>b.onclick=()=>{ const c=b.dataset.c;
      if (c==='close') return p.remove();
      if (c==='lock'){ this.lock(); UI.toast('SIGNED OUT',''); return; }
      if (c==='copyControls'){ const code='OBLOCK-CONTROLS '+JSON.stringify({binds:Binds, sens:Settings.sens, leanMode:Settings.leanMode, crouchMode:Settings.crouchMode});
        const done=()=>UI.toast('CONTROLS COPIED · PASTE THEM TO CLAUDE','ok');
        (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(done, ()=>{ prompt('Copy this:', code); });
        return; }
      if (c==='night'){ Env.t=PERIOD_SECONDS*5+1; return; } if (c==='day'){ Env.t=PERIOD_SECONDS*2+1; return; }
      const arg = c==='setLevel'?v('dv-lvl') : c==='setXP'?v('dv-xp') : c==='addCash'?v('dv-cash') : undefined;
      const r=ProfileAuthority.dev(c,arg); UI.toast(r.ok?'DEV · '+c.toUpperCase():'DEV · '+r.why.toUpperCase(), r.ok?'ok':'warn'); p.remove(); this.toggle(); });
    const sel=document.getElementById('dv-aim'); sel.value=this.aim;
    sel.onchange=e=>{ this.aim=e.target.value; UI.toast('DEV · '+(this.aim==='head'?'HEAD LOCK':this.aim==='body'?'AIM LOCK':'AIM ASSIST OFF'),'ok'); };
    sel.onkeydown=e=>e.stopPropagation();
    document.getElementById('dv-wall').onchange=e=>{ this.wall=e.target.checked; UI.toast(this.wall?'DEV · WALL HACK ON':'DEV · WALL HACK OFF', 'ok'); };
    document.getElementById('dv-tag').onchange=e=>{ Settings.devTag=e.target.checked; saveSettings(); Bus.emit('devtag'); };
    document.getElementById('dv-unl').onchange=e=>ProfileAuthority.dev('unlimitedCash', e.target.checked);
    document.getElementById('dv-god').onchange=e=>{ this.god=e.target.checked; ProfileAuthority.dev('testing', {god:this.god}); };
    document.getElementById('dv-ammo').onchange=e=>{ this.infAmmo=e.target.checked; ProfileAuthority.dev('testing', {infAmmo:this.infAmmo}); };
  },
};
