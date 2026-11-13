'use strict';
/* Combat: weapon state machine (one firearm + knife, Glock Switch mode, recoil patterns,
   synced reloads), hitscan + melee hit detection with damage falloff, pooled effects,
   ammo drops, flash grenades, landmines, smoke, and the test bots. */

// ---------- Effects (pooled) ----------
const FX = {
  init(scene){
    this.scene=scene;
    this.tracers=[]; for (let i=0;i<16;i++){ const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
      const l=new THREE.Line(g,new THREE.LineBasicMaterial({color:'#ffd9a0',transparent:true,opacity:0.8,depthWrite:false})); l.visible=false; l.frustumCulled=false; scene.add(l); this.tracers.push({l,t:0}); }
    const holeTex=canvasTex(32,32,(g)=>{ const gr=g.createRadialGradient(16,16,0,16,16,16); gr.addColorStop(0,'rgba(0,0,0,1)'); gr.addColorStop(0.35,'rgba(20,18,16,.9)'); gr.addColorStop(1,'rgba(40,36,30,0)'); g.fillStyle=gr; g.fillRect(0,0,32,32); },false);
    const hm=new THREE.MeshBasicMaterial({map:holeTex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
    this.holes=[]; this.holeI=0; for (let i=0;i<40;i++){ const m=new THREE.Mesh(new THREE.PlaneGeometry(0.12,0.12),hm); m.visible=false; scene.add(m); this.holes.push(m); }
    this.puffTex=canvasTex(32,32,(g)=>{ const gr=g.createRadialGradient(16,16,0,16,16,16); gr.addColorStop(0,'rgba(255,255,255,.9)'); gr.addColorStop(1,'rgba(255,255,255,0)'); g.fillStyle=gr; g.fillRect(0,0,32,32); },false);
    this.puffs=[]; for (let i=0;i<28;i++){ const s=new THREE.Sprite(new THREE.SpriteMaterial({map:this.puffTex,transparent:true,depthWrite:false})); s.visible=false; scene.add(s); this.puffs.push({s,t:0,v:new V3()}); }
    this.flash=new THREE.Sprite(new THREE.SpriteMaterial({map:VM.flashTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending})); this.flash.visible=false; scene.add(this.flash);
    this.light=new THREE.PointLight('#ffb35a',0,9,2); scene.add(this.light);
    this.boom=new THREE.Sprite(new THREE.SpriteMaterial({map:VM.flashTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,color:'#ffe2b0'})); this.boom.visible=false; scene.add(this.boom);
    this.flashT=0; this.puffI=0; this.trI=0; this.boomT=0;
  },
  tracer(a,b,col){ const T=this.tracers[this.trI++%this.tracers.length]; const p=T.l.geometry.attributes.position.array; p.set([a.x,a.y,a.z,b.x,b.y,b.z]); T.l.geometry.attributes.position.needsUpdate=true; T.l.material.color.set(col||'#ffd9a0'); T.l.visible=true; T.t=0.05; },
  hole(p,n){ const fx=Perf.fx(), cap=fx==='minimal'?8:fx==='reduced'?20:this.holes.length;
    if (cap<this.holes.length) for (let i=cap;i<this.holes.length;i++) this.holes[i].visible=false;
    const m=this.holes[this.holeI++%cap]; m.position.copy(p).addScaledVector(n,0.01); m.lookAt(p.clone().add(n)); m.visible=true; },
  puff(p,col,size=0.35,life=0.35){ const fx=Perf.fx(); if (fx!=='full' && Math.random()<(fx==='minimal'?0.7:0.35)) return; const P_=this.puffs[this.puffI++%this.puffs.length]; P_.s.position.copy(p); P_.s.material.color.set(col); P_.s.scale.setScalar(size); P_.s.visible=true; P_.t=life; P_.life=life; P_.v.set(rr(-0.3,0.3),rr(0.3,0.8),rr(-0.3,0.3)); P_.size=size; },
  muzzle(p,scale){ this.flash.position.copy(p); this.flash.scale.setScalar(0.35*scale); this.flash.material.rotation=Math.random()*PI; this.flash.visible=true; this.flashT=0.05; this.lightFlash(p,scale); },
  lightFlash(p,scale){ this.light.position.copy(p); this.light.intensity=1.6*scale; },
  explode(p,col,size){ this.boom.position.copy(p).add(new V3(0,0.4,0)); this.boom.material.color.set(col); this.boom.scale.setScalar(size); this.boom.visible=true; this.boomT=0.18; this.boomSize=size;
    for (let i=0;i<6;i++) this.puff(p.clone().add(new V3(rr(-0.6,0.6),rr(0.2,1),rr(-0.6,0.6))),'#6d6a66',1.3,1.2); this.lightFlash(p,3); },
  update(dt){
    for (const T of this.tracers) if (T.t>0){ T.t-=dt; if (T.t<=0) T.l.visible=false; }
    for (const p of this.puffs) if (p.t>0){ p.t-=dt; p.s.position.addScaledVector(p.v,dt); p.s.scale.setScalar(p.size*(1+(p.life-p.t)*2.5)); p.s.material.opacity=Math.max(0,p.t/p.life)*0.9; if (p.t<=0) p.s.visible=false; }
    if (this.flashT>0){ this.flashT-=dt; if (this.flashT<=0) this.flash.visible=false; }
    if (this.light.intensity>0) this.light.intensity=Math.max(0,this.light.intensity-dt*40);
    if (this.boomT>0){ this.boomT-=dt; this.boom.scale.setScalar(this.boomSize*(1+(0.18-this.boomT)*4)); if (this.boomT<=0) this.boom.visible=false; }
  },
};
// Lingering smoke (smoking item): slow, pooled, fades over several seconds
const Smoke = {
  list:[], i:0,
  init(scene){ for (let k=0;k<30;k++){ const s=new THREE.Sprite(new THREE.SpriteMaterial({map:FX.puffTex,color:'#c9c9c9',transparent:true,depthWrite:false,opacity:0})); s.visible=false; scene.add(s); this.list.push({s,t:0,life:1,v:new V3()}); } },
  puff(p,size,o){ const fx=Perf.fx(); if (fx==='minimal' || (fx==='reduced' && Math.random()<0.5)) return; const S=this.list[this.i++%this.list.length]; S.s.position.copy(p); S.size=size*0.3; S.s.scale.setScalar(S.size); S.life=S.t=o&&o.life||rr(3,5.5); S.alpha=o&&o.alpha||null; if (o&&o.v) S.v.copy(o.v); else S.v.set(rr(-0.12,0.12),rr(0.15,0.35),rr(-0.12,0.12)); S.s.visible=true; },
  update(dt){ for (const S of this.list) if (S.t>0){ S.t-=dt; const k=1-S.t/S.life; S.s.position.addScaledVector(S.v,dt); S.v.multiplyScalar(1-dt*0.3); S.s.scale.setScalar(S.size*(1+k*4)); S.s.material.opacity=Math.sin(Math.min(1,k*4)*PI/2)*(1-k)*(S.alpha||0.45); if (S.t<=0) S.s.visible=false; } },
};

// ---------- Weapon state machine ----------
const Arsenal = {
  firearm:'drako', cur:'drako', def:WEAPON_DEFS.drako, ammo:{}, state:'idle', stateT:0, stateDur:0, pending:null, inserted:false, reloadSnd:null,
  ads:false, adsK:0, trigger:false, triggerEdge:false, nextFire:0, kick:0, bloom:0, lowerK:0, flashT:0,
  swing:0, swingDur:0, heavy:false, swingHit:false, recoilP:0, glockAuto:false, spray:0, lastShot:0, recoilDebt:0,
  // firearm the player may actually carry: allowed by the mode AND unlocked by level (validated by ProfileAuthority)
  usable(id){ id=Mode.allowedFirearm(id); const R=roomRules();
    if (R){ const ok=w=>R.weapons.includes(w)&&(R.unlocks==='all'||ProfileAuthority.canUse(w))&&(R.startWeapon!=='glock'||w==='glock'); if (ok(id)) return id; return R.weapons.find(ok)||R.weapons[0]; }
    return ProfileAuthority.canUse(id) ? id : 'glock'; },
  reset(){
    this.firearm=this.usable(Loadout.firearm); this.ammo={}; if (!Mode.allowSwitch()) this.glockAuto=false;
    for (const id of FIREARMS){ const d=weaponDef(id); this.ammo[id]={mag:d.mag, res:d.reserve}; }
    this.cur=null; this.state='idle'; this.equip(this.firearm, true);
  },
  refreshDef(){ this.def=weaponDef(this.cur, this.glockAuto); },
  // change firearm mid-match (in-game loadout); the knife is always kept
  setFirearm(id){
    if (!FIREARMS.includes(id)) return;
    if (Mode.allowedFirearm(id)!==id){ Bus.emit('toast',{t:'GLOCK ONLY IN '+Mode.title(),kind:'warn'}); return; }
    { const R=roomRules(); if (R && (!R.weapons.includes(id) || R.startWeapon==='glock'&&id!=='glock')){ Bus.emit('toast',{t:WEAPON_DEFS[id].name+' IS OFF IN THIS ROOM',kind:'warn'}); return; }
      if (!(R && R.unlocks==='all') && !ProfileAuthority.canUse(id)){ Bus.emit('toast',{t:WEAPON_DEFS[id].name+' · BUY IT IN LOADOUT ('+fmtCash(ProfileAuthority.price(id))+')',kind:'warn'}); return; } }
    this.cancelReload(); Snd.autoStop();
    this.firearm=id; const d=weaponDef(id); if (!this.ammo[id]) this.ammo[id]={mag:d.mag,res:d.reserve}; if (Net.inMatch) Net.send({t:'equip', w:id});
    if (this.cur!=='knife') this.equip(id, true); Bus.emit('weapon', this.cur);
  },
  equip(id, instant){
    if (id!=='knife' && id!==this.firearm) return false;
    if (id===this.cur && this.state!=='switch') return false;
    this.cancelReload(); Snd.autoStop();
    if (instant){ this.cur=id; this.refreshDef(); this.state='idle'; this.lowerK=0; VM.setWeapon(id); Bus.emit('weapon', id); return true; }
    this.pending=id; this.state='switch'; this.stateT=0; this.stateDur=0.36; this.ads=false; this.swing=0; Snd.switchW();
    return true;
  },
  cycle(){ this.equip(this.cur==='knife' ? this.firearm : 'knife'); },
  toggleFireMode(){
    if (this.cur!=='glock') return;
    if (!Mode.allowSwitch()){ Bus.emit('toast',{t:'SWITCH DISABLED IN '+Mode.title(),kind:'warn'}); return; }
    if (!ProfileAuthority.owns('switch')){ Bus.emit('toast',{t:'GLOCK SWITCH NOT OWNED · BUY IT IN THE ARMORY ('+fmtCash(PROG.price.switch)+')',kind:'warn'}); return; }
    this.glockAuto=!this.glockAuto; this.refreshDef(); Snd.click(0,2600,0.25); Bus.emit('firemode', this.glockAuto);
  },
  reload(){
    const d=this.def, a=this.ammo[this.cur];
    if (Net.inMatch && a && this.state==='idle' && a.mag<d.mag && a.res>0) Net.send({t:'reload'});
    if (a && Dev.infAmmo) a.res=Math.max(a.res, d.mag*4);
    if (!a || this.state!=='idle' || a.mag>=d.mag || a.res<=0 || P.smoking || P.using) return;
    this.state='reload'; this.stateT=0; this.stateDur=d.reloadTime; this.inserted=false; this.ads=false; Snd.autoStop();
    this.reloadSnd=Snd.reload(this.cur); Bus.emit('reload',true);
  },
  cancelReload(){ if (this.state==='reload'){ this.state='idle'; Snd.stop(this.reloadSnd,0.05); this.reloadSnd=null; Bus.emit('reload',false); } },
  canSprintPose(){ return this.state!=='reload' && this.swing<=0 && this.recoilP<0.01; },
  canFire(){ return Game.state==='playing' && P.alive && !P.inCar && !P.ladder && !P.anim && !P.smoking && !P.using && !Perks.busy() && !P.search && !Mode.ended; },
  update(dt){
    const d=this.def;
    this.kick=damp(this.kick,0,14,dt); this.flashT=Math.max(0,this.flashT-dt); this.bloom=damp(this.bloom,0,5,dt);
    this.recoilP=Math.max(0,this.recoilP-dt);
    // recoil recovery: the view drifts back down part of the way once you stop firing
    if (this.recoilDebt>0 && performance.now()/1000-this.lastShot>0.12){ const r=Math.min(this.recoilDebt,(d.recover||5)*0.02*dt*10); P.pitch-=r; this.recoilDebt-=r; }
    if (performance.now()/1000-this.lastShot>0.3) this.spray=0;
    const wantAds = this.ads && this.state!=='reload' && this.state!=='switch' && !P.sprinting && !P.slide && this.cur!=='knife' && this.canFire();
    this.adsK = clamp(this.adsK + (wantAds?1:-1)*dt/(d.adsTime||0.15), 0, 1);
    if (this.state==='switch'){
      this.stateT+=dt; const half=this.stateDur/2;
      if (this.stateT<half) this.lowerK=this.stateT/half;
      else { if (this.pending){ this.cur=this.pending; this.refreshDef(); this.pending=null; VM.setWeapon(this.cur); Bus.emit('weapon',this.cur); }
        this.lowerK=Math.max(0,1-(this.stateT-half)/half); }
      if (this.stateT>=this.stateDur){ this.state='idle'; this.lowerK=0; }
    } else if (this.state==='reload'){
      this.stateT+=dt;
      // ammo changes when the new magazine actually seats, not when the animation starts
      if (!this.inserted && this.stateT>=this.stateDur*d.insertAt){ const a=this.ammo[this.cur], take=Math.min(d.mag-a.mag,a.res); a.mag+=take; a.res-=take; this.inserted=true; }
      if (this.stateT>=this.stateDur){ this.state='idle'; this.reloadSnd=null; Bus.emit('reload',false); Bus.emit('toast',{t:'RELOADED',kind:'ok',quiet:true}); }
    } else if (this.state==='bolt' || this.state==='pump'){
      this.stateT+=dt; if (this.stateT>=this.stateDur) this.state='idle';
    }
    if (this.swing>0){
      this.swing=Math.max(0,this.swing-dt);
      if (!this.swingHit && 1-this.swing/this.swingDur>0.38){ this.swingHit=true; meleeHit(this.heavy); }
    }
    let firedNow=false;
    if (this.trigger && this.canFire() && this.state==='idle' && !P.sprinting){
      const now=performance.now()/1000;
      if (d.kind==='melee'){ if (this.swing<=0 && now>=this.nextFire) this.startSwing(false); }
      else if (now>=this.nextFire && (d.kind==='auto' || this.triggerEdge)){
        const a=this.ammo[this.cur];
        if (a.mag<=0){ if (this.triggerEdge) Snd.dry(); this.triggerEdge=false; Snd.autoStop(); if (a.res>0) this.reload(); }
        else {
          // full-auto keeps its real cyclic rate on slow machines: catch up (max 3 rounds) when a frame took longer than one shot interval
          const iv=60/d.rpm; let base=Math.max(this.nextFire, now-0.1), n=0;
          do { this.fire(); n++; base+=iv; } while (d.kind==='auto' && base<=now && n<3 && a.mag>0);
          firedNow=true; this.nextFire=Math.max(base, now-iv*0.5); }
      }
    }
    this.triggerEdge=false;
    // burst finished (trigger up, empty or interrupted): one full tail rings out
    if (this._burst && (!this.trigger || this.state!=='idle' || (this.ammo[this.cur]&&this.ammo[this.cur].mag<=0)) && performance.now()/1000-this.lastShot>0.02){
      if (!d.suppressed){ Snd.triggerUp(this._burst.id, this._burst.rapid); Smoke.puff(muzzleWorld(),0.1,{alpha:d.noFlash?0.1:0.18,life:1.3,v:new V3(rr(-0.05,0.05),0.25,rr(-0.05,0.05))}); } this._burst=null; }
  },
  startSwing(heavy){
    const d=WEAPON_DEFS.knife; this.heavy=heavy; this.swingDur=heavy?0.7:0.42; this.swing=this.swingDur; this.swingHit=false;
    this.nextFire=performance.now()/1000+(heavy?d.heavyRate:d.rate); Snd.swing(); this.recoilP=0.3; useStamina(heavy?6:3);
  },
  fire(){
    const d=this.def, a=this.ammo[this.cur]; a.mag--;
    const now=performance.now()/1000, continuous = now-this.lastShot < 0.16;
    this.lastShot=now; this.kick=1; this.flashT=0.05; this.recoilP=0.25;
    // stamina: continuous automatic fire is strenuous; single shots barely cost anything
    if (d.kind==='auto' && continuous) useStamina(d.auto ? 0.95 : 0.4); else if (continuous) useStamina(0.2);
    Snd.shot(this.cur, {suppressed:d.suppressed, loud:d.loudness, rapid:!!d.auto && this.cur==='glock'}); this._burst={id:this.cur, rapid:!!d.auto && this.cur==='glock'};
    { const am=this.ammo[this.cur]; if (am && am.mag>0 && am.mag<=AUDIO_TUNE.lowAmmo) Snd.lowAmmo(); }
    if (!d.suppressed) Bots.hear(P.pos);              // unsuppressed shots alert nearby bots
    const moving=Math.min(1,P.speed/4);
    let spread = lerp(d.spreadHip, d.spreadAds, this.adsK) + d.spreadMove*moving*(1-this.adsK*0.7) + this.bloom;
    if (P.crouch) spread*=0.7; if (!P.grounded && !P.riding) spread+=0.05; if (P.slide) spread+=0.03;
    if (P.exhausted) spread*=1.25;
    spread*=Effects.spreadMul();                       // Zyn: +50% accuracy
    this.bloom=Math.min(0.05,this.bloom+d.recoil.p*0.3);
    if (d.pellets) shootPellets(spread, d); else shootRay(spread, d);
    // recoil: vertical climb + weapon-specific horizontal pattern
    const pat=d.recoil.pattern, kmul=(1-this.adsK*0.35)*(P.crouch?0.75:1);
    const up=d.recoil.p*kmul*(this.spray<4?1:0.8);
    P.pitch=clamp(P.pitch+up,-1.5,1.5); this.recoilDebt+=up*0.6;
    P.yaw += pat ? pat[this.spray%pat.length]*d.recoil.y*kmul : (Math.random()-0.5)*2*d.recoil.y;
    this.spray++;
    if (d.kind==='bolt' && a.mag>0){ this.state='bolt'; this.stateT=0; this.stateDur=0.9; setTimeout(()=>Snd.bolt(),250); }
    if (d.kind==='pump'){ this.state='pump'; this.stateT=0; this.stateDur=d.pumpTime; setTimeout(()=>{ if (this.cur==='shotgun') Snd.pump(); },180); }
    if (a.mag===0 && a.res>0) setTimeout(()=>{ if (this.state==='idle') this.reload(); }, 250);
    Bus.emit('shot');
  },
};

// ---------- Hit detection ----------
function cameraRay(spread){
  const o=camera.position.clone(), dir=new V3(); camera.getWorldDirection(dir);
  if (spread>0){
    const right=new V3().crossVectors(dir,new V3(0,1,0)).normalize(), up=new V3().crossVectors(right,dir);
    const a=Math.random()*PI*2, r=Math.sqrt(Math.random())*spread;
    dir.addScaledVector(right,Math.cos(a)*r).addScaledVector(up,Math.sin(a)*r).normalize();
  }
  if (Rig.mode==='third' && !Rig.scoped){ const head=new V3(P.pos.x,P.pos.y+P.height-0.1,P.pos.z); const t=head.sub(o).dot(dir); if (t>0) o.addScaledVector(dir,t); }
  return {o,dir};
}
function muzzleWorld(){
  if (Rig.mode==='first' || Rig.scoped){ const v=VM.cur? VM.cur.model.localToWorld(VM.cur.muzzle.clone()) : new V3(0.1,-0.1,-0.5); return camera.localToWorld(v); }
  const w=PlayerChar.weapon; return w ? w.model.localToWorld(w.muzzle.clone()) : camera.position.clone();
}
function falloff(d, dist){ const f=d.falloff; if (!f) return 1; if (dist<=f[0]) return 1; if (dist>=f[1]) return f[2]; return lerp(1,f[2],(dist-f[0])/(f[1]-f[0])); }
function shootRay(spread, d){
  const {o,dir}=cameraRay(spread);
  const world=bulletRay(o,dir,d.range,d.dmg);
  let best=world.dist, hitBot=null, head=false;
  for (const b of Bots.list){ if (!b.alive) continue; const h=b.rayHit(o,dir,best); if (h){ best=h.t; hitBot=b; head=h.head; } }
  if (Net.inMatch) for (const e of Net.targets()){ const h=e.rayHit(o,dir,best); if (h){ best=h.t; hitBot=e; head=h.head; } }
  const end=o.clone().addScaledVector(dir,best), mz=muzzleWorld();
  if (!d.suppressed) FX.tracer(mz,end);
  playerShotFX(d);
  if (Net.inMatch){   // online: report the hit; the server checks it and applies the damage
    Net.shot(Arsenal.cur, P.pos, hitBot?[{id:Net.netIdOf(hitBot), head, d:+best.toFixed(2)}]:[], end, {auto:!!d.auto, sup:!!d.suppressed});
    if (hitBot) FX.puff(end,'#8a1010',0.3); else if (world.hit && !world.glass){ FX.hole(world.point, world.normal); FX.puff(world.point,'#b8b0a0',0.25); }
    return; }
  if (hitBot){
    const dmg=Math.round(d.dmg*(head?d.headMul:1)*falloff(d,best)*StreakAuthority.dmgMul('player'));     // Cop: Double Damage
    hitBot.damage(dmg, head, Arsenal.cur, dir); FX.puff(end,'#8a1010',0.3);
  } else if (world.hit && !world.glass){ FX.hole(world.point, world.normal); FX.puff(world.point,'#b8b0a0',0.25); Snd.impact(world.point); }
}
// shotgun: every pellet is its own ray; damage per bot is added up and applied once (one hitmarker, one kill)
function shootPellets(spread, d){
  const per=new Map(), mz=muzzleWorld(); let anyHead=false;
  for (let i=0;i<d.pellets;i++){
    const {o,dir}=cameraRay(spread + d.pelletSpread*Math.sqrt(Math.random()));
    const world=bulletRay(o,dir,d.range,d.dmg);
    let best=world.dist, hitBot=null, head=false;
    for (const b of Bots.list){ if (!b.alive) continue; const h=b.rayHit(o,dir,best); if (h){ best=h.t; hitBot=b; head=h.head; } }
    if (Net.inMatch) for (const e of Net.targets()){ const h=e.rayHit(o,dir,best); if (h){ best=h.t; hitBot=e; head=h.head; } }
    const end=o.clone().addScaledVector(dir,best);
    if (i<3 && !d.suppressed) FX.tracer(mz,end);
    if (Net.inMatch && hitBot) (per.claims=per.claims||[]).push({id:Net.netIdOf(hitBot), head, d:+best.toFixed(2)});
    if (hitBot){ const e=per.get(hitBot)||{dmg:0, head:false, dir}; e.dmg+=d.dmg*(head?d.headMul:1)*falloff(d,best); e.head=e.head||head; per.set(hitBot,e); if (i%2===0) FX.puff(end,'#8a1010',0.22); }
    else if (world.hit && !world.glass){ if (i%2===0) FX.hole(world.point, world.normal); if (i===0){ FX.puff(world.point,'#b8b0a0',0.3); Snd.impact(world.point); } }
  }
  playerShotFX(d);
  if (Net.inMatch){ Net.shot('shotgun', P.pos, per.claims||[], null, {}); return; }
  for (const [b,e] of per) b.damage(Math.round(e.dmg*StreakAuthority.dmgMul('player')), e.head, 'shotgun', e.dir);
}
function meleeHit(heavy){
  const d=WEAPON_DEFS.knife, eye=new V3(P.pos.x,P.pos.y+P.height-0.15,P.pos.z);
  const fwd=new V3(-Math.sin(P.yaw),0,-Math.cos(P.yaw));
  let best=null, bd=d.range+0.4;
  for (const b of Bots.list.concat(Net.inMatch?Net.targets():[])){ if (!b.alive) continue;
    const c=b.chest(); const to=c.clone().sub(eye); const dist=to.length(); to.y=0; to.normalize();
    if (dist<bd && to.dot(fwd)>0.55 && lineOfSight(eye,c)){ bd=dist; best=b; } }
  if (best){
    const bf=new V3(-Math.sin(best.yaw),0,-Math.cos(best.yaw)); const behind = bf.dot(fwd)>0.6;
    const dmg = (heavy ? (behind?200:d.heavyDmg) : (behind?d.heavyDmg:d.dmg)) * StreakAuthority.dmgMul('player');
    if (Net.inMatch){ Net.shot('knife', P.pos, [{id:Net.netIdOf(best), head:false, heavy:heavy||behind, d:+bd.toFixed(2)}], null, {}); Snd.stab(); FX.puff(best.chest(),'#8a1010',0.35); return; }
    best.damage(dmg,false,'knife',fwd); Snd.stab(); FX.puff(best.chest(),'#8a1010',0.35);
  } else { const {o,dir}=cameraRay(0); const w=raycastWorld(o,dir,2.2); if (w.hit){ Snd.impact(w.point); FX.puff(w.point,'#b8b0a0',0.2); } }
}

// ---------- Ammo drops ----------
const AMMO_COLORS={drako:'#c9a04a',glock:'#7fa8d8',sniper:'#9ed07a',ar15:'#d9d2c0',shotgun:'#c43a2a'};
const Pickups = {
  list:[], pool:[],
  make(){ const g=new THREE.Group(); const box=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.2,0.22), new THREE.MeshLambertMaterial({color:'#4b5233'}));
    const band=new THREE.Mesh(new THREE.BoxGeometry(0.35,0.05,0.23), new THREE.MeshBasicMaterial({color:'#ffffff'})); band.position.y=0.04; g.add(box,band);
    const ring=new THREE.Mesh(new THREE.RingGeometry(0.32,0.38,20), new THREE.MeshBasicMaterial({color:'#ffd23f',transparent:true,opacity:0.7,side:THREE.DoubleSide,depthWrite:false})); ring.rotation.x=-PI/2; ring.position.y=-0.09; g.add(ring);
    g.userData={band,ring}; scene.add(g); return g; },
  drop(pos, type, amount){
    if (!type || amount<=0) return;
    const m=this.pool.pop()||this.make(); m.visible=true; m.position.set(pos.x,(pos.y||0)+0.12,pos.z); m.userData.band.material.color.set(AMMO_COLORS[type]);
    this.list.push({m,type,amount,t:0,baseY:(pos.y||0)+0.14});
    while (this.list.length>10) this.remove(0);
  },
  remove(i){ const p=this.list[i]; p.m.visible=false; this.pool.push(p.m); this.list.splice(i,1); },
  near(){ let best=-1, bd=1.6; this.list.forEach((p,i)=>{ const d=Math.hypot(p.m.position.x-P.pos.x,p.m.position.z-P.pos.z); if (d<bd && Math.abs(p.m.position.y-P.pos.y)<1.2){ bd=d; best=i; } }); return best; },
  tryPick(){
    const i=this.near(); if (i<0) return false;
    const p=this.list[i], fa=Arsenal.firearm, a=Arsenal.ammo[fa];
    const add = p.type===fa ? p.amount : Math.ceil(weaponDef(fa).mag*0.5);  // other calibres convert to half a mag
    a.res+=add; Bus.emit('pickup',{type:p.type, add, weapon:WEAPON_DEFS[fa].name}); Snd.click(0,1800,0.25); this.remove(i); return true;
  },
  update(dt){ for (let i=this.list.length-1;i>=0;i--){ const p=this.list[i]; p.t+=dt; p.m.rotation.y+=dt*1.5; p.m.position.y=p.baseY+Math.sin(p.t*3)*0.03; if (p.t>40) this.remove(i); } },
  clear(){ while (this.list.length) this.remove(0); },
};

// ---------- Equipment: flash grenades + landmines ----------
const Equip = {
  nades:[], mines:[], flashK:0, flashDur:1,
  meshNade(){ const g=new THREE.Group(); const b=new THREE.Mesh(new THREE.CylinderGeometry(0.035,0.035,0.11,8),new THREE.MeshLambertMaterial({color:'#5d6a4a'})); const c=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.04,0.05),new THREE.MeshLambertMaterial({color:'#999'})); c.position.y=0.07; g.add(b,c); scene.add(g); return g; },
  meshMine(){ const g=new THREE.Group(); const b=new THREE.Mesh(new THREE.CylinderGeometry(0.16,0.18,0.06,12),new THREE.MeshLambertMaterial({color:'#3d4433'})); b.position.y=0.03; const l=new THREE.Mesh(new THREE.SphereGeometry(0.02,6,4),new THREE.MeshBasicMaterial({color:'#ff2a2a'})); l.position.y=0.07; g.add(b,l); g.userData.led=l; scene.add(g); return g; },
  throwFlash(){
    if (!P.alive || P.flash<=0 || !Arsenal.canFire()) return;
    P.flash--; const dir=new V3(); camera.getWorldDirection(dir);
    const o=new V3(P.pos.x,P.pos.y+P.height-0.2,P.pos.z).addScaledVector(dir,0.4);
    const m=this.meshNade(); m.position.copy(o);
    this.nades.push({m, pos:o, vel:dir.multiplyScalar(15).add(new V3(0,3,0)).add(P.vel.clone().multiplyScalar(0.5)), t:0, fuse:1.6});
    Snd.swing();
  },
  placeMine(){
    if (Net.inMatch){ Bus.emit('notice','Landmines are offline-only (their damage is not validated by the server yet)'); return; }
    if (!P.alive || P.mine<=0 || !P.grounded || P.inCar || P.ladder) return;
    const fx=-Math.sin(P.yaw), fz=-Math.cos(P.yaw), x=P.pos.x+fx*1.1, z=P.pos.z+fz*1.1;
    const {ground}=probeVertical(x,z,P.pos.y+0.5);
    if (Math.abs(ground-P.pos.y)>0.7 || !pointFree(x,z,ground+0.02,ground+0.5,0.2)){ Bus.emit('notice','No room to place a mine here'); return; }
    if (this.mines.length>=3) this.removeMine(0);          // max 3 active in the world
    P.mine--; const m=this.meshMine(); m.position.set(x,ground,z);
    this.mines.push({m, t:0, armed:false, owner:'player'}); Snd.click(0,900,0.25);
  },
  removeMine(i){ const M_=this.mines[i]; scene.remove(M_.m); this.mines.splice(i,1); },
  detonate(pos, owner){
    FX.explode(pos,'#ffb36a',3.2); Snd.explosion(pos);
    for (const b of Bots.list){ if (!b.alive) continue; const d=b.pos.distanceTo(pos); if (d<4.5) b.damage(Math.round(130*(1-d/4.5)), false, 'mine', b.pos.clone().sub(pos).normalize()); }
    const dp=P.pos.distanceTo(pos); if (owner!=='player' && dp<4.5) damagePlayer(Math.round(130*(1-dp/4.5)), {name:'a landmine', pos});
  },
  flashAt(pos){
    FX.explode(pos,'#ffffff',4); Snd.flashBang(pos);
    // local player: strength from distance, where you were looking, and line of sight
    const eye=camera.position, to=pos.clone().sub(eye), d=to.length(); to.normalize();
    const look=new V3(); camera.getWorldDirection(look);
    if (P.alive && d<24 && lineOfSight(eye,pos.clone().add(new V3(0,0.2,0)))){
      const s=clamp(1-d/24,0,1)*(0.3+0.7*Math.max(0,look.dot(to)));
      if (s>0.05){ this.flashK=Math.max(this.flashK,Math.min(1,s*1.3)); this.flashDur=0.6+3.4*s; Snd.ring(s); }
    }
    for (const b of Bots.list){ if (!b.alive) continue; const bd=b.pos.distanceTo(pos); if (bd<18 && lineOfSight(new V3(b.pos.x,b.pos.y+1.5,b.pos.z),pos.clone().add(new V3(0,0.2,0)))) b.blindT=Math.max(b.blindT,4*(1-bd/18)+0.5); }
  },
  update(dt){
    for (let i=this.nades.length-1;i>=0;i--){
      const n=this.nades[i]; n.t+=dt; n.vel.y-=18*dt;
      const step=n.vel.clone().multiplyScalar(dt), L=step.length();
      if (L>0){ const h=raycastWorld(n.pos, step.clone().divideScalar(L), L+0.04);
        if (h.hit){ n.pos.copy(h.point).addScaledVector(h.normal,0.04); const vn=h.normal.clone().multiplyScalar(n.vel.dot(h.normal)); n.vel.sub(vn.multiplyScalar(1.45)).multiplyScalar(0.55); if (n.vel.length()>1.5) Snd.bounce(n.pos); }
        else n.pos.add(step); }
      n.m.position.copy(n.pos); n.m.rotation.x+=dt*8;
      if (n.t>=n.fuse){ this.flashAt(n.pos); scene.remove(n.m); this.nades.splice(i,1); }
    }
    for (let i=this.mines.length-1;i>=0;i--){
      const M_=this.mines[i]; M_.t+=dt;
      if (!M_.armed && M_.t>1.5){ M_.armed=true; Snd.mineArm(); }
      M_.m.userData.led.visible = M_.armed && (M_.t*2%1)<0.25;
      if (M_.armed){ for (const b of Bots.list){ if (b.alive && Math.hypot(b.pos.x-M_.m.position.x,b.pos.z-M_.m.position.z)<1.3 && Math.abs(b.pos.y-M_.m.position.y)<1){ const p=M_.m.position.clone(); this.removeMine(i); this.detonate(p,M_.owner); break; } } }
      if (M_.t>150 && this.mines[i]===M_) this.removeMine(i);   // cleanup
    }
    if (this.flashK>0){ this.flashK=Math.max(0,this.flashK-dt/this.flashDur); }
  },
  clear(){ for (const n of this.nades) scene.remove(n.m); this.nades=[]; while (this.mines.length) this.removeMine(0); this.flashK=0; },
};

// Bots live in botai.js
// Minimap pings: unsuppressed gunfire shows as a red dot for 0.3 s (no permanent positions)
const Pings = { list:[], add(pos){ this.list.push({x:pos.x,z:pos.z,t:0.3}); if (this.list.length>20) this.list.shift(); }, update(dt){ for (const p of this.list) p.t-=dt; this.list=this.list.filter(p=>p.t>0); } };
// Laser beam: drawn from the laser to the first surface it hits, so it never shows through walls
const LaserBeam = {
  init(){ const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
    this.line=new THREE.Line(g,new THREE.LineBasicMaterial({color:'#ff2a2a',transparent:true,opacity:0.55,depthWrite:false})); this.line.frustumCulled=false; scene.add(this.line);
    this.dot=new THREE.Sprite(new THREE.SpriteMaterial({map:VM.flashTex,color:'#ff3030',transparent:true,depthWrite:false,blending:THREE.AdditiveBlending})); this.dot.scale.setScalar(0.06); scene.add(this.dot); this.hide(); },
  hide(){ if (!this.line) return; this.line.visible=false; this.dot.visible=false; },
  update(){
    const d=Arsenal.def;
    if (!d.laser || Arsenal.cur==='knife' || !P.alive || P.inCar || P.smoking || Rig.scoped || Game.state!=='playing'){ this.hide(); return; }
    // origin AND direction come from the laser module's transform on the gun itself (not the crosshair),
    // so the beam follows sway, recoil, the run cycle, reloads and aiming
    let from, dir;
    const q=new THREE.Quaternion();
    if (Rig.mode==='first' || Rig.optic){ const w=VM.cur; if (!w||!w.laserFrom) return this.hide();
      w.model.updateWorldMatrix(true,false);
      from=camera.localToWorld(w.model.localToWorld(w.laserFrom.clone()));
      w.model.getWorldQuaternion(q); dir=new V3(0,0,-1).applyQuaternion(q).applyQuaternion(camera.quaternion); }
    else { const w=PlayerChar.weapon; if (!w||!w.laserFrom) return this.hide();
      from=w.model.localToWorld(w.laserFrom.clone()); w.model.getWorldQuaternion(q); dir=new V3(0,0,-1).applyQuaternion(q); }
    dir.normalize(); const o=from;
    const hit=raycastWorld(o,dir,80);
    let end=hit.point; for (const b of Bots.list){ if (!b.alive) continue; const h=b.rayHit(o,dir,hit.dist); if (h) end=o.clone().addScaledVector(dir,h.t); }
    const p=this.line.geometry.attributes.position.array; p.set([from.x,from.y,from.z,end.x,end.y,end.z]); this.line.geometry.attributes.position.needsUpdate=true;
    this.line.visible=true; this.dot.visible=true; this.dot.position.copy(end).addScaledVector(dir,-0.03);
  },
};

function damagePlayer(n, src, dir){
  if (!P.alive || Game.state!=='playing' || Mode.ended) return;
  if (Net.inMatch) return;                                         // online: only the server changes your health
  if (Dev.god) return;                                             // local developer testing option only
  n*=Effects.dmgTakenMul();                                         // beer: 10% less damage taken
  P.hp=Math.max(0,P.hp-n); P.lastHurt=performance.now()/1000; Snd.hurt();
  let ang=0; if (src && src.pos){ const dx=src.pos.x-P.pos.x, dz=src.pos.z-P.pos.z; ang=Math.atan2(-dx,-dz)-P.yaw; }
  if (dir) P.lastHitDir.copy(dir);
  Bus.emit('hurt',{n, ang});
  if (P.hp<=0){ if (src && src.i!==undefined) Match.kill(src.i,'player',src.fw,false); else Match.kill(null,'player',null,false); killPlayer(src?src.name:'the fall', dir); }
}

// ---------- Match scoring (kill limit / time limit from MatchRules; free-for-all) ----------
const Match = {
  reset(){ P.kills=0; P.deaths=0; for (const b of Bots.list){ b.kills=0; b.deaths=0; } this.startT=performance.now()/1000; },
  rows(){
    if (Net.inMatch){ const r=[{name:'YOU', kills:P.kills, deaths:P.deaths, me:true, streak:[(StreakAuthority.e.player||{streak:0}).streak,0]}, ...Bots.list.filter(b=>b.netId).map(b=>({name:b.name, kills:b.kills, deaths:b.deaths, bot:true, streak:[0,0]})), ...[...Net.ents.values()].map(e=>({name:e.name, kills:e.kills, deaths:e.deaths, bot:e.kind==='bot', streak:[0,0]}))];
      r.forEach(x=>x.score=x.kills*100-x.deaths*10); r.sort((a,b)=>b.kills-a.kills||b.score-a.score); return r; }
    const sk=id=>{ const s=StreakAuthority.e[id]; return s?[s.streak,s.best]:[0,0]; };
    const r=[{name:'YOU', kills:P.kills, deaths:P.deaths, me:true, streak:sk('player')}, ...Bots.list.map(b=>({name:b.name, kills:b.kills, deaths:b.deaths, streak:sk('bot'+b.i), bot:true}))];
    r.forEach(x=>x.score=x.kills*100-x.deaths*10); r.sort((a,b)=>b.kills-a.kills||(MatchRules.tie==='deaths'?a.deaths-b.deaths:0)||b.score-a.score); return r;
  },
  // killer: 'player' | bot index | null ; victim: 'player' | bot index
  kill(killer, victim, weapon, head){
    if (Mode.ended) return;
    if (killer!==null && killer!==undefined) Perks.onKill(killer==='player'?'player':'bot'+killer);
    if (victim!==null && victim!==undefined) Perks.onDeath(victim==='player'?'player':'bot'+victim);
    const wn=WEAPON_DEFS[weapon]?WEAPON_DEFS[weapon].name:(weapon==='mine'?'MINE':'—');
    const vname = victim==='player' ? 'YOU' : Bots.list[victim].name;
    if (killer==='player'){ P.kills++; Bus.emit('kill',{victim:vname, weapon:wn, head}); ProfileAuthority.kill(Game.matchId); }
    else if (killer!==null && killer!==undefined){ const b=Bots.list[killer]; b.kills++; Bus.emit('killfeed',{killer:b.name, victim:vname, weapon:wn}); }
    if (Mode.cur==='dm' && MatchRules.kills>0){ const top=this.rows()[0]; if (top.kills>=MatchRules.kills) Mode.end(top.name); }
  },
  // time limit reached: highest kills wins; a tie is shown as a tie (or broken by fewest deaths if chosen)
  timeUp(){
    const r=this.rows(); if (!r.length) return;
    const tied = r.length>1 && r[0].kills===r[1].kills && (MatchRules.tie!=='deaths' || r[0].deaths===r[1].deaths);
    Mode.end(tied ? 'TIE' : r[0].name);
  },
};
