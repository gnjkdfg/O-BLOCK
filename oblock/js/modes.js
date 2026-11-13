'use strict';
/* Game modes: Deathmatch (custom kill/time limits) and THE FIGHT FOR ZA (most accumulated time holding the ziplock bag;
   the classic 30-second hold is still available as a rule).
   Backpack rules live in BackpackAuthority, which owns the state and validates every
   request (pickup distance, carrier, drop on death, 30-second win). Clients never decide
   the winner. In this single-player build the authority runs in-page; its request()/tick()
   interface is what a WebSocket game server would run for real multiplayer. */
// THE FIGHT FOR ZA rules (host settings, locked once the match starts)
//   variant 'hold'    — accumulated hold time: whoever has held the bag longest when the clock runs out wins (default 5 min)
//   variant 'classic' — the original: hold it for 30 uninterrupted seconds
const ZA_DEFAULTS = { variant:'hold', time:300, classicHold:30, bots:7, difficulty:'normal', spawns:'all', respawn:'drop', resetAfter:20 };
const ZARules = Object.assign({}, ZA_DEFAULTS, Store.get('zaRules',{}));
function saveZARules(){ Store.set('zaRules', ZARules); }
const HOLD_TIME = 30;     // classic variant (kept for the rules text)
const BACKPACK_HOME = {x:-7, y:0.42, z:-5};   // default: on top of the courtyard planter (tree removed)
// objective spawn points: one is picked per round; each is validated against the colliders at match start
const ZA_SPAWNS = [ {x:-7,y:0.42,z:-5}, {x:-14.5,y:0,z:4}, {x:0.5,y:0,z:3.5}, {x:-15,y:0,z:-15.5}, {x:0.5,y:0,z:-16}, {x:-7,y:0,z:6.5} ];
function validSpawns(){ return ZA_SPAWNS.filter(p=> (p.y>0.3 || pointFree(p.x,p.z,0.15,1.6,0.5)) ); }

// The authority owns the bag and every player's hold time; clients only ask to pick it up and report positions.
const BackpackAuthority = {
  s:null,
  home:BACKPACK_HOME, last:null,
  pickHome(){ const v=validSpawns(); let h=v[Math.floor(Math.random()*v.length)]||BACKPACK_HOME;
    if (v.length>1) while (h===this.last) h=v[Math.floor(Math.random()*v.length)];   // a different spot every round / reset
    this.home=this.last=h; return h; },
  reset(){
    const h=this.pickHome();
    this.s={x:h.x, y:h.y, z:h.z, carrier:null, holdStart:0, winner:null, clock:0, seq:0, hold:{}, groundT:0, atHome:true}; },
  tick(dt){
    const s=this.s; s.clock+=dt;
    if (s.carrier && !s.winner){ s.hold[s.carrier]=(s.hold[s.carrier]||0)+dt;
      if (ZARules.variant==='classic' && s.clock-s.holdStart>=ZARules.classicHold) s.winner=s.carrier; }
    // objective respawn rule: a bag left on the ground goes back to a fresh spawn point after a while
    if (!s.carrier && !s.atHome){ s.groundT+=dt;
      if (ZARules.respawn==='reset' && s.groundT>=ZARules.resetAfter){ const h=this.pickHome(); s.x=h.x; s.y=h.y; s.z=h.z; s.atHome=true; s.groundT=0; s.seq++; Bus.emit('toast',{t:'THE BAG RESPAWNED',kind:'obj'}); } }
  },
  // msg: {type:'pickup', who, pos} | {type:'died', who, pos} | {type:'carrierPos', who, pos}
  request(msg){
    const s=this.s; if (s.winner) return false;
    if (msg.type==='pickup'){
      if (s.carrier) return false;
      const d=Math.hypot(msg.pos.x-s.x, msg.pos.z-s.z);
      if (d>1.8 || Math.abs(msg.pos.y-s.y)>1.5) return false;           // too far: rejected
      s.carrier=msg.who; s.holdStart=s.clock; s.seq++; s.atHome=false; s.groundT=0; return true;
    }
    if (msg.type==='died' && s.carrier===msg.who){
      s.carrier=null; s.x=msg.pos.x; s.y=Math.max(0,msg.pos.y); s.z=msg.pos.z; s.seq++; s.groundT=0; return true;   // drops where they died
    }
    if (msg.type==='carrierPos' && s.carrier===msg.who){ s.x=msg.pos.x; s.y=msg.pos.y; s.z=msg.pos.z; return true; }
    return false;
  },
  remaining(){ const s=this.s; return s.carrier ? Math.max(0, ZARules.classicHold-(s.clock-s.holdStart)) : ZARules.classicHold; },
  holdOf(id){ return this.s.hold[id]||0; },
  // standings by accumulated hold time
  standings(){ return Object.entries(this.s.hold).sort((a,b)=>b[1]-a[1]); },
};

// Mode rules (also enforced by the authority: requests that break them are rejected)
const MODE_RULES = {
  dm:       {title:'DEATHMATCH', firearms:['glock','drako','sniper','shotgun','ar15'], switch:true},
  backpack: {title:'THE FIGHT FOR ZA', firearms:['glock'], switch:false},
};
const Mode = {
  cur:'dm', ended:false, winner:null, mesh:null, beam:null, clock:0,
  title(){ return MODE_RULES[this.cur].title; },
  allowedFirearm(id){ const f=MODE_RULES[this.cur].firearms; return f.includes(id) ? id : f[0]; },
  allowSwitch(){ return MODE_RULES[this.cur].switch; },
  label(){ return this.cur==='dm' ? 'DEATHMATCH · '+rulesText() : 'THE FIGHT FOR ZA · '+zaRulesText(); },
  rules(){ return this.cur==='backpack' ? ZARules : MatchRules; },
  init(){
    this.mesh=makeBagModel(); this.mesh.scale.setScalar(1.6); this.mesh.visible=false; scene.add(this.mesh);
    this.beam=new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.25,30,10,1,true), new THREE.MeshBasicMaterial({color:'#ff4a4a',transparent:true,opacity:0.18,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide}));
    this.beam.visible=false; scene.add(this.beam);
  },
  start(m){
    this.cur=m; this.ended=false; this.winner=null; this.clock=0; this._lastNow=null; Match.reset(); Bots.setMode();
    BackpackAuthority.reset(); this.lastCarrier=null; this.anim=null; this.mesh.scale.setScalar(1.6);
    this.mesh.visible=this.beam.visible=(m==='backpack');
    for (const b of Bots.list){ b.carrying=false; }
    P.carrying=false;
  },
  idOf(who){ return who==='player' ? 'player' : 'bot'+who.i; },
  nameOf(id){ if (!id) return null; if (id==='player') return 'YOU'; if (Net.inMatch){ const e=Net.entityById(id); return e?(e===P?'YOU':e.name):'?'; } return Bots.list[+id.slice(3)].name; },
  carrierEntity(){ const c=BackpackAuthority.s.carrier; if (!c) return null; if (c==='player') return P; if (Net.inMatch) return Net.entityById(c); return Bots.list[+c.slice(3)]; },
  tryPickBackpack(){
    if (this.cur!=='backpack' || this.ended || !P.alive) return false;
    if (Net.inMatch){ if (this.nearBackpack()){ Net.send({t:'pickup'}); return true; } return false; }
    if (BackpackAuthority.request({type:'pickup', who:'player', pos:P.pos})){ Snd.click(0,1200,0.3); Bus.emit('toast',{t:ZARules.variant==='classic'?'YOU HAVE THE BAG — SURVIVE '+ZARules.classicHold+'s':'YOU HAVE THE BAG — EVERY SECOND COUNTS',kind:'obj'}); ProfileAuthority.objective(Game.matchId,'BAG PICKUP'); return true; }
    return false;
  },
  nearBackpack(){ if (this.cur!=='backpack' || BackpackAuthority.s.carrier) return false; const s=BackpackAuthority.s; return Math.hypot(P.pos.x-s.x,P.pos.z-s.z)<1.8 && Math.abs(P.pos.y-s.y)<1.5; },
  onDeath(who, pos){
    if (this.cur!=='backpack' || Net.inMatch) return;
    const id=this.idOf(who);
    if (BackpackAuthority.request({type:'died', who:id, pos})) Bus.emit('toast',{t:(id==='player'?'YOU':this.nameOf(id))+' DROPPED THE BAG',kind:'obj'});
  },
  // where bots want to go in this mode (null = normal behaviour)
  botGoal(bot){
    if (this.cur!=='backpack' || this.ended) return null;
    const s=BackpackAuthority.s, id=this.idOf(bot);
    if (!s.carrier) return {x:s.x, z:s.z, urgent:Math.hypot(bot.pos.x-s.x,bot.pos.z-s.z)>6};
    if (s.carrier===id){ // defend the hold: move away from the nearest enemy, toward cover, keep the bag alive
      let th=null, td=1e9; for (const e of bot.enemies()){ const d=Math.hypot(e.pos.x-bot.pos.x,e.pos.z-bot.pos.z); if (d<td){ td=d; th=e; } }
      if (!th) return null;
      const ax=bot.pos.x-th.pos.x, az=bot.pos.z-th.pos.z, l=Math.hypot(ax,az)||1;
      let best=null, bs=-1e9; for (let i=0;i<12;i++){ const c=Nav.cover[Math.floor(Math.random()*Nav.cover.length)]; if (!c) break; const dx=c.x-bot.pos.x, dz=c.z-bot.pos.z, d=Math.hypot(dx,dz); if (d>25) continue; const sc=(dx*ax+dz*az)/l - d*0.3; if (sc>bs){ bs=sc; best=c; } }
      return best ? {x:best.x, z:best.z, urgent:td<15} : {x:clamp(bot.pos.x+ax/l*18,-78,78), z:clamp(bot.pos.z+az/l*18,-78,78), urgent:td<15};
    }
    // everyone else hunts the carrier
    const c=this.carrierEntity(); if (c) return {x:c.pos.x, z:c.pos.z, urgent:Math.hypot(c.pos.x-bot.pos.x,c.pos.z-bot.pos.z)>12, carrier:c};
    return {x:s.x+rr(-6,6), z:s.z+rr(-6,6), urgent:false};
  },
  update(dt){
    // match clock runs on real time (frame dt is capped at 50 ms, which would slow the timer on low frame rates); pauses don't count
    const now=performance.now()/1000, real=Math.min(0.25, now-(this._lastNow||now)); this._lastNow=now;
    const step=Math.max(dt,real); if (!this.ended) this.clock+=step;
    if (Net.inMatch) return this.updateOnline(dt);       // online: the server runs the clock, the bag and the result
    if (this.cur==='dm' && !this.ended && MatchRules.time>0 && this.clock>=MatchRules.time) Match.timeUp();
    if (this.cur!=='backpack' || this.ended) return;
    // accumulated-hold variant: the clock decides; the longest total hold wins (a tie is a draw)
    if (ZARules.variant==='hold' && this.clock>=ZARules.time){ const st=BackpackAuthority.standings(); const tie=st.length>1 && Math.abs(st[0][1]-st[1][1])<0.05;
      this.end(!st.length||tie ? 'TIE' : this.nameOf(st[0][0])); return; }
    // authority-side rule check: carriers and everyone else must hold the allowed firearm, no Switch
    if (Arsenal.firearm!==this.allowedFirearm(Arsenal.firearm)) Arsenal.setFirearm(this.allowedFirearm(Arsenal.firearm));
    if (Arsenal.glockAuto && !this.allowSwitch()){ Arsenal.glockAuto=false; Arsenal.refreshDef(); }
    const A=BackpackAuthority, s=A.s;
    // bots ask the authority to pick it up when they reach it
    if (!s.carrier) for (const b of Bots.list){ if (b.alive && A.request({type:'pickup', who:this.idOf(b), pos:b.pos})){ Bus.emit('toast',{t:b.name+' HAS THE BAG',kind:'warn'}); break; } }
    const c=this.carrierEntity();
    if (c) A.request({type:'carrierPos', who:s.carrier, pos:c.pos});
    A.tick(step);                       // real time, like the match clock: hold time is exact even on slow frames
    P.carrying = s.carrier==='player';
    for (const b of Bots.list) b.carrying = s.carrier===this.idOf(b);
    // pickup: the bag flies into the carrier's hands; drop: it falls from chest height and bounces
    if (s.carrier!==this.lastCarrier){
      if (s.carrier) this.anim={type:'pick', t:0, from:this.mesh.position.clone()};
      else if (this.lastCarrier) this.anim={type:'drop', t:0, y:s.y+1.25, vy:1.5};
      this.lastCarrier=s.carrier; }
    const an=this.anim;
    if (an && an.type==='pick'){ an.t+=dt; const c2=this.carrierEntity(); const k=Math.min(1,an.t/0.28);
      if (c2){ const to=new V3(c2.pos.x,c2.pos.y+1.15,c2.pos.z); this.mesh.position.copy(an.from).lerp(to,k*k); this.mesh.scale.setScalar(1.6*(1-k*0.6)); }
      this.mesh.visible=k<1; if (k>=1){ this.anim=null; this.mesh.scale.setScalar(1.6); } }
    else if (an && an.type==='drop'){ an.t+=dt; an.vy-=9.8*dt; an.y+=an.vy*dt; const floor=s.y+0.12;
      if (an.y<floor){ an.y=floor; an.vy=-an.vy*0.35; if (Math.abs(an.vy)<0.4) this.anim=null; }
      this.mesh.visible=true; this.mesh.position.set(s.x,an.y,s.z); this.mesh.rotation.y+=dt*4; }
    else { this.mesh.visible=!s.carrier;
      if (!s.carrier){ this.mesh.position.set(s.x, s.y+0.35+Math.sin(performance.now()/400)*0.06, s.z); this.mesh.rotation.y+=dt; } }
    this.beam.visible = s.carrier!=='player';            // the carrier's own camera would sit inside the beam
    this.beam.position.set(s.x, s.y+15, s.z);
    this.beam.material.color.set(s.carrier==='player'?'#4aff7a':s.carrier?'#ff4a4a':'#ffd23f');
    if (s.winner) this.end(this.nameOf(s.winner));
    // bots that see the carrier go after the carrier first
    const ce=this.carrierEntity(); if (ce) for (const b of Bots.list){ if (b.alive && b!==ce && b.lastVis!==ce && !b.mem && Math.hypot(ce.pos.x-b.pos.x,ce.pos.z-b.pos.z)<30 && aliveT(ce)) b.mem={t:ce, pos:ce.pos.clone(), time:performance.now()/1000}; }
  },
  // online: draw the server's bag; the host asks the server to let its bots pick it up
  updateOnline(dt){
    if (this.cur!=='backpack' || this.ended) return;
    const s=BackpackAuthority.s; if (!s) return;
    P.carrying = s.carrier==='player';
    for (const b of Bots.list) b.carrying = !!b.netId && s.carrier===b.netId;
    if (!s.carrier && Net.isHost) for (const b of Bots.list){ if (b.alive && b.netId && Math.hypot(b.pos.x-s.x,b.pos.z-s.z)<1.6){ Net.send({t:'pickup', id:b.netId}); break; } }
    this.mesh.visible=!s.carrier; if (!s.carrier){ this.mesh.position.set(s.x, s.y+0.35+Math.sin(performance.now()/400)*0.06, s.z); this.mesh.rotation.y+=dt; }
    this.beam.visible = s.carrier!=='player'; this.beam.position.set(s.x, s.y+15, s.z);
    this.beam.material.color.set(s.carrier==='player'?'#4aff7a':s.carrier?'#ff4a4a':'#ffd23f');
  },
  idOf2(id){ return id; },
  // world position for the HUD objective marker
  objectivePos(){ if (this.cur!=='backpack') return null; const s=BackpackAuthority.s; return new V3(s.x, s.y+(s.carrier?2.3:1.0), s.z); },
  end(name){ if (this.ended) return; this.ended=true; this.winner=name; Arsenal.trigger=false; Snd.autoStop(); Bus.emit('matchEnd', name); },
};

// human-readable match rules
function zaRulesText(R=ZARules){
  if (R.variant==='classic') return 'HOLD THE BAG '+R.classicHold+'s IN A ROW';
  return 'MOST HOLD TIME IN '+(R.time>=60?Math.round(R.time/60)+' MIN':R.time+' S');
}
function rulesText(R=MatchRules){
  const k=R.kills>0?'FIRST TO '+R.kills+' KILLS':'NO KILL LIMIT', t=R.time>0?(R.time>=60?Math.round(R.time/60)+' MIN':R.time+' S'):'NO TIME LIMIT';
  return k+' · '+t;
}
