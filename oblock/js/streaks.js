'use strict';
/* Kill streaks, perks and character abilities.
   StreakAuthority owns every streak and perk state and validates every request (who, character,
   streak, charges, cooldowns, durations). Clients only send requests; they never grant themselves
   healing, speed or invulnerability. In this build the authority runs in-page (like BackpackAuthority);
   its request()/tick() interface is what a game server would run for real multiplayer.

   TAP THE NIC   — every character, 5 kills in a row: one Nic (max 3 carried). Using it heals 30% of max health and
                   gives the Nic effect: +35% run/sprint speed and -20% stamina capacity for exactly 10 s (no stacking).
   CHARACTER ABILITIES (key Y): unlocked by a 10-kill streak (kills in a row without dying, counted by the authority —
   the match server online), then activated manually. One activation per unlock; it stays on until you die or the
   match ends (no timer, no cooldown). Dying resets the streak and the readiness.
     Blood Hound Lil Jeff — TRIPLE HEALTH: max health x3 (ski mask on).
     Cop                  — DOUBLE DAMAGE: firearm and melee damage x2. */
const PERKS = {
  nic: {name:'TAP THE NIC', at:5, dur:10, heal:0.30, speed:1.35, stamina:0.8, max:3, action:'nic'},
};
const CHAR_ABILITIES = {
  jeff:{id:'triple', name:'TRIPLE HEALTH', at:10, hpMul:3},
  cop: {id:'double', name:'DOUBLE DAMAGE', at:10, dmgMul:2},
};
const StreakAuthority = {
  e:{},                         // entity id -> state
  reset(){ this.e={}; },
  st(id){ return this.e[id] || (this.e[id]={streak:0, best:0, charId:null, charges:{nic:0}, active:{}, cool:{}, ab:{active:false, ready:false}, seq:0}); },
  // character is locked when the entity spawns into the match (switching characters mid-match can't keep or fake a streak)
  spawn(id, charId){ const s=this.st(id); if (s.charId && s.charId!==charId){ s.streak=0; s.charges={nic:0}; s.ab={active:false,ready:false}; } s.charId=charId; },
  kill(killer){
    const s=this.st(killer); s.streak++; s.best=Math.max(s.best,s.streak); const unlocked=[];
    const RR=roomRules();
    for (const k in PERKS){ const p=PERKS[k]; if (RR && k==='nic' && !RR.nic) continue;
      if (s.streak%p.at===0 && s.charges[k]<p.max){ s.charges[k]++; unlocked.push(k); } }
    const A=RR && !RR.abilities ? null : CHAR_ABILITIES[s.charId];
    if (A && !s.ab.active && !s.ab.ready && s.streak>=A.at){ s.ab.ready=true; unlocked.push('ability'); }
    return unlocked;
  },
  // dying ends the streak and any running effect; carried Nics are kept only until death (they are dropped)
  died(id){ const s=this.st(id); s.streak=0; s.charges={nic:0}; for (const k in s.active) s.active[k]=0; s.ab.active=false; s.ab.ready=false; },
  // activation request: validated here, effects applied here
  request(id, perk, ent){
    const s=this.st(id), p=PERKS[perk]; if (!p) return {ok:false, why:'unknown perk'};
    if (s.charges[perk]<1) return {ok:false, why:'need '+p.at+' kills in a row'};
    if ((s.active[perk]||0)>0) return {ok:false, why:'already active'};
    if (!ent || !ent.alive) return {ok:false, why:'dead'};
    s.charges[perk]--; s.seq++;
    s.active[perk]=p.dur+(perk==='nic'?NIC_CFG.effectAt:0);
    return {ok:true};
  },
  // cancelled before the effect landed: the Nic is given back (validated: only while the effect is still pending)
  cancel(id, perk){ const s=this.st(id), p=PERKS[perk]; if (!(s.active[perk]>p.dur)) return false; s.active[perk]=0; s.charges[perk]=Math.min(p.max,s.charges[perk]+1); return true; },
  // character ability: right character, not cooling down, alive
  requestAbility(id, ent){
    const s=this.st(id), A=CHAR_ABILITIES[s.charId];
    if (!A) return {ok:false, why:'this character has no ability'};
    if (s.ab.active) return {ok:false, why:'already active'};
    if (!s.ab.ready) return {ok:false, why:'need '+A.at+' kills in a row ('+s.streak+'/'+A.at+')'};
    if (!ent || !ent.alive) return {ok:false, why:'dead'};
    s.ab.ready=false; s.ab.active=true; s.seq++;
    return {ok:true, ability:A};
  },
  tick(dt){ for (const id in this.e){ const s=this.e[id]; for (const k in s.active) s.active[k]=Math.max(0,s.active[k]-dt); for (const k in s.cool) s.cool[k]=Math.max(0,s.cool[k]-dt);
    } },
  active(id, perk){ const s=this.e[id]; return !!(s && s.active[perk]>0); },
  remaining(id, perk){ const s=this.e[id]; return s ? s.active[perk]||0 : 0; },
  invulnerable(){ return false; },
  // the Nic effect only counts once it has landed (end of the hit), for exactly PERKS.nic.dur seconds
  nicOn(id){ const s=this.e[id]; return !!(s && s.active.nic>0 && s.active.nic<=PERKS.nic.dur); },
  speedMul(id){ return this.nicOn(id) ? PERKS.nic.speed : 1; },
  staminaMul(id){ return this.nicOn(id) ? PERKS.nic.stamina : 1; },
  ability(id){ const s=this.e[id]; return s ? CHAR_ABILITIES[s.charId]||null : null; },
  abilityActive(id){ const s=this.e[id]; return !!(s && s.ab.active); },
  abilityState(id){ const s=this.e[id]; return s ? {active:s.ab.active, ready:s.ab.ready, streak:s.streak, A:CHAR_ABILITIES[s.charId]||null} : {active:false,ready:false,streak:0,A:null}; },
  hpMul(id){ const s=this.e[id], A=s&&CHAR_ABILITIES[s.charId]; return A && A.hpMul && s.ab.active ? A.hpMul : 1; },
  dmgMul(id){ const s=this.e[id], A=s&&CHAR_ABILITIES[s.charId]; return A && A.dmgMul && s.ab.active ? A.dmgMul : 1; },
};
// Tap the Nic animation timeline (seconds). The effect lands at the end of the hit.
const NIC_CFG = { holster:0.25, raise:0.4, hit:4.0, lower:0.45, exhaleHold:0.3, unholster:0.3,
  scale:0.062,              // vape height in metres (about palm width, never bigger than the hand)
  fovSqueeze:3,             // degrees of FOV squeeze at the end of the hit (scaled by Camera motion)
  tremor:0.0025,            // hand tremor amplitude (m) during the hold
  cancelOnSprint:true, cancelOnDamage:false };
NIC_CFG.hitStart = NIC_CFG.holster+NIC_CFG.raise;
NIC_CFG.effectAt = NIC_CFG.hitStart+NIC_CFG.hit;
NIC_CFG.total = NIC_CFG.effectAt+NIC_CFG.lower+NIC_CFG.exhaleHold+NIC_CFG.unholster;
const NIC_ANIM = NIC_CFG.total;
// 0..1 phases of the Nic timeline for the animation code
function nicPhase(t){ const C=NIC_CFG;
  const weaponDown = t<C.holster ? t/C.holster : t<C.effectAt+C.lower+C.exhaleHold ? 1 : Math.max(0,1-(t-C.effectAt-C.lower-C.exhaleHold)/C.unholster);
  let hand; if (t<C.holster) hand=0; else if (t<C.hitStart){ const u=(t-C.holster)/C.raise; hand=1-(1-u)*(1-u); }      // ease-out raise
  else if (t<C.effectAt) hand=1; else if (t<C.effectAt+C.lower){ const u=(t-C.effectAt)/C.lower; hand=1-u*u; } else hand=0;
  const hold = t>=C.hitStart && t<C.effectAt ? (t-C.hitStart)/C.hit : 0;
  return {weaponDown, hand, hold, visible: t>=C.holster*0.6 && t<C.effectAt+C.lower+0.05}; }

// Client side for the local player: unlock notices, activation input, the animation, HUD state.
const Perks = {
  nic:null, // {t}
  reset(){ this.nic=null; this.abWas=false; StreakAuthority.reset(); StreakAuthority.spawn('player', CharLook.char); for (const b of Bots.list) StreakAuthority.spawn('bot'+b.i, b.rig?b.rig.charId:'tracksuit'); },
  onKill(killer){
    const unlocked=StreakAuthority.kill(killer);
    if (killer!=='player') return;
    const s=StreakAuthority.st('player');
    if ([3,5,10,15,20,25].includes(s.streak)) Bus.emit('toast',{t:s.streak+' KILL STREAK',kind:'kill'});
    for (const k of unlocked){ if (k==='ability'){ this.abilityReady(); continue; }
      Bus.emit('toast',{t:'+1 NIC ('+s.charges.nic+'/'+PERKS.nic.max+') · PRESS '+Input.label(Binds[PERKS[k].action]),kind:'obj'}); }
  },
  abilityReady(){ const A=StreakAuthority.ability('player'); if (!A) return;
    Bus.emit('toast',{t:A.at+' KILL STREAK · '+A.name+' READY · PRESS '+Input.label(Binds.ability),kind:'kill'}); Snd.uiSfx('buy'); Bus.emit('abready'); },
  onDeath(id){ StreakAuthority.died(id); if (id==='player'){ if (this.nic) Snd.stop(this.nic.snd,0.3); this.nic=null; setBloodHoundLook(false); this.abWas=false; } },
  use(perk){
    if (!P.alive || Game.state!=='playing' || Mode.ended) return;
    if (perk==='ability') return this.useAbility();
    if (perk==='nic' && (P.smoking || P.using || this.nic || P.inCar || P.riding || P.ladder || P.anim)) return;
    if (perk==='nic' && StreakAuthority.nicOn('player')){ Bus.emit('toast',{t:'NIC ALREADY ACTIVE · NO STACKING',kind:'warn'}); return; }
    const r=StreakAuthority.request('player', perk, P);
    if (!r.ok){ Bus.emit('toast',{t:PERKS[perk].name+': '+r.why.toUpperCase(),kind:'warn'}); return; }
    this.nic={t:0, applied:false, snd:null}; Arsenal.trigger=false; Arsenal.ads=false; Snd.autoStop(); if (Arsenal.state==='reload') Arsenal.cancelReload();
  },
  useAbility(){
    if (Net.inMatch){ Net.send({t:'ability'}); return; }      // the server validates the streak and broadcasts the activation
    const r=StreakAuthority.requestAbility('player', P);
    if (!r.ok){ const A=StreakAuthority.ability('player'); Bus.emit('toast',{t:(A?A.name:'ABILITY')+': '+r.why.toUpperCase(),kind:'warn'}); return; }
    const A=r.ability;
    if (A.id==='triple'){ P.hp*=A.hpMul; setBloodHoundLook(true); Snd.bloodhound(); }
    else { Snd.click(0,900,0.4); Snd.click(0.1,1300,0.35); }
    Bus.emit('toast',{t:A.name+' ACTIVE · UNTIL YOU DIE',kind:'kill'}); this.abWas=true;
  },
  update(dt){
    StreakAuthority.tick(dt);
    const N=this.nic, C=NIC_CFG;
    if (N){ const t0=N.t; N.t+=dt;
      // cancel rule: sprinting cancels (taking damage does not). Sound fades, a small puff still comes out, the Nic is refunded.
      if (C.cancelOnSprint && P.sprinting && !N.applied && N.t>C.holster){ this.cancelNic(); return; }
      if (!P.alive){ this.nic=null; return; }
      if (t0<C.hitStart && N.t>=C.hitStart) N.snd=Snd.play('vape',{cat:'env',vol:1.0,max:1});            // inhale/crackle across the 4 s hold
      if (!N.applied && N.t>=C.effectAt){ N.applied=true;
        Snd.stop(N.snd,0.25); N.snd=null; Snd.play('exhale',{cat:'env',vol:1.0,max:1}); setTimeout(()=>Snd.play('cough',{cat:'env',vol:0.9,max:1}),1300);
        // effect (granted by the authority at activation; lands now): heal 30% of max, +35% speed / -20% stamina capacity for 10 s
        if (Net.inMatch) Net.send({t:'use', item:'nic'}); else P.hp=Math.min(P.maxHp(), P.hp+P.maxHp()*PERKS.nic.heal); P.stamina=Math.min(P.stamina, staminaMax());
        Bus.emit('toast',{t:'TAPPED THE NIC · +30% HP · +35% SPEED '+PERKS.nic.dur+'s',kind:'ok'});
        vaporCloud(1); }
      if (N.t>=C.total) this.nic=null; }
    // ability ended: Triple Health shrinks back proportionally (never kills), the mask comes off
    if (this.abWas && !StreakAuthority.abilityActive('player')){ this.abWas=false; const A=StreakAuthority.ability('player');
      if (A && A.hpMul){ P.hp=Math.max(1, P.hp/A.hpMul); setBloodHoundLook(false); }
      if (P.alive) Bus.emit('toast',{t:(A?A.name:'ABILITY')+' ENDED',kind:'warn'}); }
    P.hp=Math.min(P.hp, P.maxHp());
  },
  busy(){ return !!this.nic; },
  cancelNic(){ const N=this.nic; if (!N) return; Snd.stop(N.snd,0.35); if (N.t>NIC_CFG.hitStart){ vaporCloud(0.35); Snd.play('exhale',{cat:'env',vol:0.5,max:1}); }
    StreakAuthority.cancel('player','nic'); this.nic=null; Bus.emit('toast',{t:'TAP THE NIC CANCELLED · NIC KEPT',kind:'warn'}); },
};
function setBloodHoundLook(on){
  Perks.bh=on;
  if (PlayerChar.rig){ setSkiMask(PlayerChar.rig, on);
    for (const o of PlayerChar.rig.meshes){ const m=o.material; if (!m.emissive || o.name.startsWith('SkiMask')) continue; m.emissive.set(on?'#2a0000':'#000000'); } }   // faint red glow = invulnerable
  if (VM.rig) for (const o of VM.rig.meshes){ const m=o.material; if (m.emissive) m.emissive.set(on?'#200000':'#000000'); }
}
// exhaled vapour: soft billboard puffs in front of the face that expand, drift up/forward and fade over ~2 s
function vaporCloud(k){
  const fwd=new V3(); camera.getWorldDirection(fwd);
  const fp = Rig.mode==='first' || Rig.optic, base = fp ? camera.position.clone().addScaledVector(fwd,0.5).add(new V3(0,-0.1,0)) : mouthPos();
  const n=Math.round(9*k);
  for (let i=0;i<n;i++) setTimeout(()=>{ const p=base.clone().add(new V3(rr(-0.08,0.08),rr(-0.04,0.05),rr(-0.08,0.08)));
    Smoke.puff(p, (fp?0.55:0.8)*k+0.15, {life:rr(1.6,2.3), v:fwd.clone().multiplyScalar(rr(0.25,0.55)).add(new V3(rr(-0.08,0.08),rr(0.12,0.3),rr(-0.08,0.08))), alpha:fp?0.32:0.55}); }, i*45);
}
function nicTipWorld(){
  const fp = Rig.mode==='first' || Rig.optic, n = fp ? VM.nic : PlayerChar.nic; if (!n || !n.visible) return null;
  const p=new V3(0,0.05,0); n.localToWorld(p); return fp ? camera.localToWorld(p) : p;
}
// Nic device (imported model, assets/nic.js)
let NicAsset=null;
function loadNicAsset(){
  return new Promise(res=>{ const b64=(window.GLB||{}).nic; if (!b64) return res();
    const bin=atob(b64), buf=new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
    new THREE.GLTFLoader().parse(buf.buffer,'',g=>{ g.scene.traverse(o=>{ if (o.isMesh){ o.castShadow=true;
      // normal lit material: pink body with a little gloss, nothing emissive (it was blowing out)
      const m=o.material; o.material=new THREE.MeshStandardMaterial({map:m.map||null, color:'#e6e0e2', roughness:0.42, metalness:0.0}); } }); NicAsset=g.scene; res(); }, ()=>res()); });
}
function makeNicModel(){
  const g=new THREE.Group(); if (!NicAsset) return g;
  const m=NicAsset.clone(true); const box=new THREE.Box3().setFromObject(m), sz=box.getSize(new V3()), c=box.getCenter(new V3());
  const s=NIC_CFG.scale/Math.max(sz.x,sz.y,sz.z); m.scale.setScalar(s); m.position.copy(c).multiplyScalar(-s); g.add(m);
  // the only glowing part: a thin LED strip near the base (brightens through the hit)
  const led=new THREE.Mesh(new THREE.BoxGeometry(sz.x*s*0.5, 0.0025, 0.001), new THREE.MeshBasicMaterial({color:'#ff3b8a', transparent:true, opacity:0.25}));
  led.position.set(0, -sz.y*s*0.36, sz.z*s*0.5+0.0006); g.add(led); g.userData.led=led;
  g.traverse(o=>{ o.frustumCulled=false; });
  return g;
}
