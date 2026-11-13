'use strict';
/* Player controller (shared by first- and third-person): movement with acceleration,
   gravity, collision, stairs, crouch, slide, stamina, lean, ladders, fence vaults,
   vehicles (enter + search), smoking, health, death/ragdoll and safe respawns.
   Plus the camera rig for both camera modes. */
const STEP=0.6, GRAV=22, JUMP=7.2, RADIUS=0.35;
const SLIDE_TIME=3.0, SLIDE_SPEED=9.5;
// stamina: capacity +40% over the old 100 (sprint drain per second unchanged, so sprints last 40% longer); slides cost 40% less
const STAMINA = { base:140, slideCost:9, slideMin:9, jumpCost:4 };
// private-match rules from the server (null offline): starting health / stamina, equipment, etc.
const roomRules = () => (typeof Net!=='undefined' && Net.inMatch && Net.settings) || null;
function staminaMax(){ const R=roomRules(); return STAMINA.base*StreakAuthority.staminaMul('player')*(R?R.stamina/100:1); }
// Exactly 15 designated spawn points inside the map, shared by the player and the bots (x, z, facing).
// Each one is validated against the colliders and the nav grid when the map loads (validateSpawns); a blocked point is
// moved to the nearest open ground and reported in SPAWN_REPORT.
const SPAWN_POINTS = [
  [-13,15,0],[-7,4,0.3],[30,-4,PI/2],[-60,20,-PI/2],[0,-44,PI],[-44,-30,-PI/2],[40,30,PI*0.75],[-70,-12,-PI/2],
  [44,-60,PI],[-13,60,0],[15,-50,PI],[-40,40,-PI*0.8],[60,10,PI/2],[-25,-52,PI],[20,28,0.2],
];
for (const s of SPAWN_POINTS){ const [x,z]=RM(s[0],s[1]); s[0]=x; s[1]=z; }   // compressed map layout
const SPAWN_REPORT = [];
function validateSpawns(){
  SPAWN_REPORT.length=0;
  for (const s of SPAWN_POINTS){
    const ok = pointFree(s[0],s[1],0.05,1.7,0.5) && Nav.walkable(s[0],s[1]) && Math.abs(s[0])<RMv(84)-2 && Math.abs(s[1])<RMv(84)-2;
    if (!ok){ const f=Nav.nearestFree(s[0],s[1],8); if (f){ SPAWN_REPORT.push({from:[s[0],s[1]], to:f}); s[0]=f[0]; s[1]=f[1]; } else SPAWN_REPORT.push({from:[s[0],s[1]], to:null}); }
  }
  return SPAWN_REPORT;
}
// which of the 15 points a mode may use: THE FIGHT FOR ZA can keep spawns away from the objective
function spawnPool(){
  if (Mode.cur==='backpack' && ZARules.spawns==='far'){
    const o=BackpackAuthority.home||{x:0,z:0};
    return SPAWN_POINTS.slice().sort((a,b)=>Math.hypot(b[0]-o.x,b[1]-o.z)-Math.hypot(a[0]-o.x,a[1]-o.z)).slice(0,8);
  }
  return SPAWN_POINTS;
}
const P = { pos:new V3(-13,0,15), vel:new V3(), yaw:0, pitch:0, bodyYaw:0, grounded:false, crouch:false, height:1.7,
  ladder:null, anim:null, inCar:null, jumpQueued:false, hp:100, alive:true, deadT:0, lastHurt:-99, speed:0, sprinting:false,
  climb:0, stepT:0, kills:0, deaths:0, stamina:100, exhausted:false, lastStrain:-99, slide:null, lean:0, smoking:null,
  items:{blunt:0, beer:0, zyn:0}, bluntCap:false, using:null, riding:null, flash:0, mine:0, search:null, lastSpawn:-1, lastHitDir:new V3(0,0,1), airT:0, carrying:false, prone:false, leanToggle:0 };
const keys = Input.down;
// max health: 100, +20% after a blunt (until death), x3 during Triple Health
P.maxHp = () => ((roomRules()||{}).hp||100)*(P.bluntCap?ITEMS.blunt.capMul:1)*StreakAuthority.hpMul('player');

function resolveHorizontal(p=P.pos, h=P.height, r=RADIUS){
  for (let pass=0; pass<2; pass++) for (const c of colliders){
    if (c.y1 <= p.y+STEP || c.y0 >= p.y+h-0.05) continue;
    const o = overlapXZ(c,p.x,p.z,r); if (!o) continue;
    let px, pz;
    if (o.d2 > 1e-8){ const d=Math.sqrt(o.d2), k=(r-d)/d; px=o.ex*k; pz=o.ez*k; }
    else { const ox=c.hx-Math.abs(o.lx), oz=c.hz-Math.abs(o.lz);
      if (ox<oz){ px=(o.lx>=0?1:-1)*(ox+r); pz=0; } else { pz=(o.lz>=0?1:-1)*(oz+r); px=0; } }
    p.x += px*c.c + pz*c.s; p.z += -px*c.s + pz*c.c;
  }
}
function probeVertical(x,z,fromY){
  let ground=0, ceil=1e9;
  for (const c of colliders){
    if (!overlapXZ(c,x,z,RADIUS*0.8)) continue;
    if (c.y1 <= fromY+STEP+1e-3){ if (c.y1>ground) ground=c.y1; }
    else if (c.y0 >= fromY+STEP){ if (c.y0<ceil) ceil=c.y0; }
  }
  return {ground,ceil};
}
function canStand(){
  const p=P.pos;
  for (const c of colliders){ if (c.y0 < p.y+1.75 && c.y1 > p.y+1.05 && overlapXZ(c,p.x,p.z,RADIUS*0.9)) return false; }
  return true;
}
function strain(){ P.lastStrain=performance.now()/1000; }
function useStamina(n){ P.stamina=Math.max(0,P.stamina-n); strain(); if (P.stamina<=0) P.exhausted=true; }
function staminaK(){ return P.stamina/staminaMax(); }

// ---- Ladders: Interact to attach, W/S climb, Jump or strafe to let go ----
function nearLadder(){
  const p=P.pos;
  for (const L of ladders){
    if (p.x>=L.x0-0.4&&p.x<=L.x1+0.4&&p.z>=L.z0-0.4&&p.z<=L.z1+0.4&&p.y<L.h-0.4) return {L,top:false};
    const ix=L.wx-L.nx*0.7, iz=L.wz-L.nz*0.7;
    if (Math.abs(p.y-L.h)<0.35 && Math.hypot(p.x-ix,p.z-iz)<1.4) return {L,top:true};
  }
  return null;
}
function attachLadder(n){
  const L=n.L; P.ladder=L; P.vel.set(0,0,0); P.crouch=false; P.height=1.7; endSlide();
  P.pos.x=L.wx+L.nx*0.5; P.pos.z=L.wz+L.nz*0.5;
  if (n.top) P.pos.y=L.h-1.3;
  P.bodyYaw=Math.atan2(L.nx,L.nz);
}
function detachLadder(push){ const L=P.ladder; P.ladder=null; if (push){ P.vel.set(L.nx*3,3.5,L.nz*3); P.grounded=false; } }
// ---- Vault over designated fences ----
function nearVault(){
  if (!P.grounded || P.pos.y>0.4) return null;
  const p=P.pos, fx=-Math.sin(P.yaw), fz=-Math.cos(P.yaw);
  for (const V of vaults){
    const dx=V.bx-V.ax, dz=V.bz-V.az, L2=dx*dx+dz*dz;
    const t=clamp(((p.x-V.ax)*dx+(p.z-V.az)*dz)/L2, 0.03, 0.97);
    const qx=V.ax+dx*t, qz=V.az+dz*t, ox=qx-p.x, oz=qz-p.z, d=Math.hypot(ox,oz);
    if (d<1.15 && d>0.05 && (ox*fx+oz*fz)/d>0.35){
      const tx=qx+ox/d*0.95, tz=qz+oz/d*0.95;
      if (pointFree(tx,tz,0.05,1.7,RADIUS*0.9)) return {from:p.clone(), to:new V3(tx,0,tz), h:V.h};
    }
  }
  return null;
}
function startMove(from,to,dur,arc,kind){ P.anim={from:from.clone(),to:to.clone(),t:0,dur,arc,kind}; P.vel.set(0,0,0); }

// ---- Slide: Slide key while sprinting. Fast burst, friction, slight steering, full pose lasts 3 s unless cancelled ----
function startSlide(){
  if (P.prone) return false;
  const v=P.vel, sp=Math.hypot(v.x,v.z); if (sp<4.5 || P.stamina<STAMINA.slideMin) return false;
  P.slide={t:0, dx:v.x/sp, dz:v.z/sp, speed:Math.max(sp,SLIDE_SPEED)};
  P.sprinting=false; P.crouch=false; useStamina(STAMINA.slideCost); Snd.slideStart(); return true;
}
function endSlide(){ if (!P.slide) return; P.slide=null; Snd.slideStop(); }

function stepPlayer(dt){
  const p=P.pos, v=P.vel;
  const f=(Input.held('forward')?1:0)-(Input.held('back')?1:0);
  const r=(Input.held('right')?1:0)-(Input.held('left')?1:0);
  if (P.anim){
    const A=P.anim; A.t+=dt/A.dur; const k=Math.min(1,A.t), e=k*k*(3-2*k);
    p.lerpVectors(A.from,A.to,e); p.y += Math.sin(k*PI)*A.arc;
    if (k>=1){ if (A.kind==='vault') P.landT=0.7; P.anim=null; P.grounded=false; }
    P.jumpQueued=false; P.speed=2; return;
  }
  if (P.ladder){
    const L=P.ladder;
    p.y += f*2.8*dt; P.climb += f*dt*6; P.speed=0;
    if (P.jumpQueued || r!==0){ detachLadder(true); P.jumpQueued=false; return; }
    if (p.y >= L.h-0.05 && f>0){ P.ladder=null; startMove(p, new V3(L.wx-L.nx*0.75, L.h, L.wz-L.nz*0.75), 0.45, 0.35, 'mount'); return; }
    if (p.y <= 0 && f<0){ p.y=0; P.ladder=null; P.grounded=true; }
    return;
  }
  const now=performance.now()/1000;
  // stamina regen after a short rest
  if (now-P.lastStrain>1.1) P.stamina=Math.min(staminaMax(),P.stamina+(P.speed<0.5?26:16)*dt);
  P.stamina=Math.min(P.stamina, staminaMax());
  if (P.exhausted && P.stamina>staminaMax()*0.25) P.exhausted=false;
  // crouch (Crouch key, or Slide key when not sprinting)
  // crouch: Hold mode = while the key is held; Toggle mode = press once to crouch, again to stand (Settings → Controls).
  // Prone stays on its own key. Sprinting or jumping cancels a toggled crouch.
  const crouchKey = Settings.crouchMode==='toggle' ? !!P.crouchToggle : Input.held('crouch');
  const wantCrouch = crouchKey || (Input.held('slide') && !P.slide && !P.sprinting);
  if (P.prone && (P.jumpQueued || !P.grounded)){ P.jumpQueued=false; setProne(false); }
  if (P.slide){
    const S=P.slide; S.t+=dt;
    // friction: quick burst that bleeds off, slight steering toward where you look
    S.speed = Math.max(0, S.speed - (S.speed>4 ? 5.2 : 2.0)*dt);
    const fx=-Math.sin(P.yaw), fz=-Math.cos(P.yaw), cr=S.dx*fz-S.dz*fx;
    const turn=clamp(cr, -1, 1)*-0.9*dt; const c=Math.cos(turn), s=Math.sin(turn);
    const nx=S.dx*c-S.dz*s, nz=S.dx*s+S.dz*c; S.dx=nx; S.dz=nz;
    v.x=S.dx*S.speed; v.z=S.dz*S.speed;
    P.height=1.0; strain();
    if (S.t>=SLIDE_TIME || P.jumpQueued || P.airT>0.3){ const jump=P.jumpQueued && P.grounded; endSlide(); if (jump && canStand()){ v.y=JUMP*0.9; P.grounded=false; } P.jumpQueued=false; P.crouch=!canStand()||Input.held('crouch'); }
  } else {
    if (P.prone){ P.crouch=false; }
    else if (wantCrouch) P.crouch=true; else if (P.crouch && canStand()) P.crouch=false;
    P.height = P.prone ? 0.55 : P.crouch? 1.1 : 1.7;
    if (P.crouchToggle && Input.held('sprint') && f>0 && !P.prone && canStand()){ P.crouchToggle=false; P.crouch=false; }
    const sprintHeld = Input.held('sprint') && f>0 && !P.crouch && !P.prone && Arsenal.adsK<0.3 && !P.smoking && !P.using && !P.exhausted && P.stamina>0;
    P.sprinting = sprintHeld && !(Arsenal.trigger && Arsenal.cur!=='knife');
    if (P.sprinting) useStamina(13*dt);
    const wmul = (Arsenal.def.moveMul||1) * (P.carrying?0.9:1);
    const speed = (P.prone? 1.1 : P.crouch? 2.2 : P.sprinting? 7.4 : 4.6) * wmul * (Arsenal.adsK>0.5?0.62:1) * (P.smoking||P.using?0.7:1) * StreakAuthority.speedMul('player');
    const sy=Math.sin(P.yaw), cy=Math.cos(P.yaw);
    let wx=-sy*f+cy*r, wz=-cy*f-sy*r; const wl=Math.hypot(wx,wz); if (wl>0){ wx=wx/wl*speed; wz=wz/wl*speed; }
    if (P.jumpQueued){
      const vt=nearVault();
      if (vt){ P.jumpQueued=false; startMove(vt.from, vt.to, 0.75, vt.h+0.35, 'vault'); Snd.rattle(); return; }
    }
    if (P.grounded){
      // acceleration: quick but not instant pick-up, firmer braking, slower build-up into a sprint (no snapping)
      const cur=Math.hypot(v.x,v.z), tgt=Math.hypot(wx,wz);
      const k = wl===0 ? 12 : tgt>cur+0.2 ? (P.sprinting && cur>4 ? 5 : 10) : 13;
      v.x=damp(v.x,wx,k,dt); v.z=damp(v.z,wz,k,dt);
      if (P.jumpQueued && !P.crouch){ v.y=JUMP; P.grounded=false; useStamina(STAMINA.jumpCost); }
    } else { v.x=damp(v.x,wx,2.5,dt); v.z=damp(v.z,wz,2.5,dt); }
  }
  v.y -= GRAV*dt;
  P.jumpQueued = false;
  const prevY = p.y, wasGrounded = P.grounded;
  p.x += v.x*dt; p.z += v.z*dt; p.y += v.y*dt;
  resolveHorizontal();
  const {ground,ceil} = probeVertical(p.x,p.z,prevY);
  if (p.y <= ground){ p.y=ground; if (v.y<0){ if (P.airT>0.45) Snd.land(); if (P.airT>0.25) P.landT=Math.min(1,0.35+P.airT*0.6); v.y=0; } P.grounded=true; }
  else if (wasGrounded && v.y<=0 && p.y-ground<0.4){ p.y=ground; v.y=0; P.grounded=true; }
  else P.grounded=false;
  P.airT = P.grounded ? 0 : P.airT+dt;
  if (p.y+P.height > ceil){ p.y=Math.max(ground,ceil-P.height); if (v.y>0) v.y=0; }
  P.speed=Math.hypot(v.x,v.z);
  if (P.landT) P.landT=Math.max(0,P.landT-dt*3.2);          // landing absorb (legs bend, camera dips) fades out
  if (p.y < -20) killPlayer('the void');
}

// Prone: lie down (toggle). Getting up needs headroom.
function setProne(on){
  if (on){ if (!P.alive || !P.grounded || P.slide || P.ladder || P.inCar || P.anim) return;
    // the body lies out behind the camera: there must be room for it (no proning into walls, fences or cars)
    const bx=Math.sin(P.yaw), bz=Math.cos(P.yaw);
    for (const d of [-0.6,0.45,0.9,1.15]) if (!pointFree(P.pos.x+bx*d, P.pos.z+bz*d, P.pos.y+0.08, P.pos.y+0.5, 0.22)){ Bus.emit('toast',{t:'NO ROOM TO GO PRONE',kind:'warn'}); return; }
    P.prone=true; P.crouchToggle=false; P.crouch=false; P.sprinting=false; Arsenal.ads=false; }
  else { const h=P.height; P.height=1.1; if (!canStand() && !pointFree(P.pos.x,P.pos.z,P.pos.y+0.6,P.pos.y+1.1,RADIUS*0.9)){ P.height=h; return; } P.prone=false; P.crouch=true; }
}
// Lean: smooth, limited, and stopped short of walls (the body never moves, only the view). Hold or toggle.
function updateLean(dt){
  let want=0;
  const input = Settings.leanMode==='toggle' ? P.leanToggle : (Input.held('leanR')?1:0)-(Input.held('leanL')?1:0);
  if (P.alive && !P.sprinting && !P.slide && !P.ladder && !P.inCar && !P.anim && !P.prone) want=input; else P.leanToggle=0;
  P.leanTarget=want; P.lean=damp(P.lean,want,10,dt);
}
function leanOffset(){
  if (Math.abs(P.lean)<0.01) return 0;
  const side=new V3(Math.cos(P.yaw),0,-Math.sin(P.yaw)).multiplyScalar(Math.sign(P.lean));
  const head=new V3(P.pos.x,P.pos.y+P.height-0.12,P.pos.z);
  const h=raycastWorld(head, side, 0.5);
  const maxOff = h.hit ? Math.max(0,h.dist-0.18) : 0.38;
  return Math.sign(P.lean)*Math.min(Math.abs(P.lean)*0.38, maxOff);
}

// ---- Vehicles ----
function nearestCar(){
  let best=null, bd=2.0;
  for (const car of interactCars) for (const e of car.exits.slice(0,2)){
    const [x,z]=toWorld(car.F,e[0],e[1]); const d=Math.hypot(P.pos.x-x,P.pos.z-z);
    if (d<bd && Math.abs(P.pos.y)<1){ bd=d; best=car; }
  }
  return best;
}
// searchable vehicles: search the trunk / rear of any car (one search per vehicle per match)
function nearestSearchable(){
  let best=null, bd=1.7;
  for (const s of searchables){ if (s.searched) continue; const [x,z]=toWorld(s.F,-s.L/2-0.7,0); const d=Math.hypot(P.pos.x-x,P.pos.z-z); if (d<bd && Math.abs(P.pos.y)<1){ bd=d; best=s; } }
  return best;
}
function startSearch(s){ const R=roomRules(); if (R && !R.items){ Bus.emit('toast',{t:'CONSUMABLES ARE OFF IN THIS ROOM',kind:'warn'}); return; } P.search={s, t:0, dur:1.6, from:P.pos.clone()}; Snd.rummage(); }
function updateSearch(dt){
  const S=P.search; if (!S) return;
  if (P.pos.distanceTo(S.from)>0.6 || !P.alive){ P.search=null; return; }
  S.t+=dt;
  if (S.t>=S.dur){
    P.search=null; S.s.searched=true;
    if (Net.inMatch) Net.send({t:'search', id:searchables.indexOf(S.s)}); else Bus.emit('loot',{found:rollTrunk()});
  }
}
function interact(){
  if (!P.alive || P.anim) return;
  if (P.riding){ Rides.dismount(); return; }
  if (P.inCar){
    const car=P.inCar;
    for (const e of car.exits){
      const [x,z]=toWorld(car.F,e[0],e[1]);
      if (pointFree(x,z,0.6,1.7,RADIUS)){ P.pos.set(x,0,z); P.vel.set(0,0,0); P.inCar=null; car.target=-1.1; Snd.door(); setTimeout(()=>{car.target=0;},900); return; }
    }
    return;
  }
  if (P.ladder){ detachLadder(false); return; }
  if (Pickups.tryPick()) return;
  if (Mode.tryPickBackpack()) return;
  const lad=nearLadder(); if (lad){ attachLadder(lad); return; }
  const car=nearestCar();
  if (car){ P.inCar=car; P.crouch=false; endSlide(); Arsenal.ads=false; car.target=-1.1; Snd.door(); setTimeout(()=>{ if(P.inCar===car) car.target=0; },700);
    // car hopping: rummage the cabin for loose cash (1 in 3, $1-$20, once per vehicle per cooldown)
    const h=ProfileAuthority.carHop(car.name); if (h.pending){} else if (h.ok) setTimeout(()=>Bus.emit('carhop',h.amount),500); else Bus.emit('toast',{t:'NOTHING LEFT IN THIS CAR · '+h.wait+'s',kind:''}); return; }
  if (Rides.tryMount()) return;
  const s=nearestSearchable(); if (s) startSearch(s);
}

// ---- Smoking: consumes one item, 3 s with no weapon use, +30% max health, then a cough ----
function startSmoking(){
  if (!P.alive || P.smoking || P.using || Perks.busy() || P.items.blunt<=0 || P.inCar || P.riding || P.ladder || P.anim) return;
  P.items.blunt--; P.smoking={t:0}; Arsenal.trigger=false; Arsenal.ads=false; Snd.autoStop();
  // imported lighter + inhale + exhale recording plays through to its end, then the cough
  P.smoking.snd=Snd.play('lighter',{cat:'env',vol:1.0,max:1}); const dur=(Snd.buf.lighter?Snd.buf.lighter.duration:3.3);
  clearTimeout(startSmoking.cough); startSmoking.cough=setTimeout(()=>{ if (P.alive) Snd.play('cough',{cat:'env',vol:0.9,max:1}); }, dur*1000+80);
  if (Arsenal.state==='reload') Arsenal.cancelReload();
}
function updateSmoking(dt){
  const S=P.smoking; if (!S) return;
  S.t+=dt;
  // thin smoke from the lit end the whole time; the exhale comes out of the mouth after the inhale
  if (Math.random()<dt*5){ const e=bluntEmberWorld(); if (e) Smoke.puff(e, 0.12); }
  if (S.t>=3){
    P.smoking=null; P.bluntCap=true; if (Net.inMatch) Net.send({t:'use', item:'blunt'}); else P.hp=Math.min(P.maxHp(), P.hp+ITEMS.blunt.heal);   // heal 30 and max health +20% until death
    // the exhale in the recording starts right after the 3 s hit: puffs follow it
    for (let i=0;i<7;i++) setTimeout(()=>{ if (P.alive) Smoke.puff(mouthPos(),0.8); },60+i*170);
    Bus.emit('healed');
  }
}
function bluntEmberWorld(){
  const fp = Rig.mode==='first' || Rig.optic, b = fp ? VM.blunt : PlayerChar.blunt; if (!b || !b.visible) return null;
  const p=new V3(0,0.045,0); b.localToWorld(p); return fp ? camera.localToWorld(p) : p;
}
function mouthPos(){ return new V3(P.pos.x-Math.sin(P.yaw)*0.25, P.pos.y+P.height-0.2, P.pos.z-Math.cos(P.yaw)*0.25); }

// ---- Health / death / respawn ----
function killPlayer(by, hitDir){
  if (!P.alive) return;
  if (P.smoking && P.smoking.snd) Snd.stop(P.smoking.snd,0.3); clearTimeout(startSmoking.cough);
  if (P.riding) Rides.dismount(true);
  P.alive=false; P.deadT=0; P.hp=0; P.deaths++; P.ladder=null; P.anim=null; P.inCar=null; P.smoking=null; P.using=null; P.search=null; P.bluntCap=false; endSlide(); Effects.reset();
  Arsenal.trigger=false; Arsenal.ads=false; Snd.autoStop(); Snd.breath(0);
  const fa=Arsenal.firearm, am=Arsenal.ammo[fa];
  Pickups.drop(P.pos, fa, Math.max(weaponDef(fa).mag, am ? Math.min(am.res,weaponDef(fa).mag*2) : 0));
  if (PlayerChar.rig){ PlayerChar.update(0); P.corpse=Corpses.spawn(PlayerChar.rig, hitDir||P.lastHitDir, {vel:new V3(P.vel.x,0,P.vel.z), part:P.lastHitHead?'head':null}); }
  Mode.onDeath('player', P.pos);
  Bus.emit('died', by);
}
// Safe spawn: farthest from living enemies, not in their line of sight, clear of objects, not the last spot used
function pickSpawn(list){
  let best=null, bs=-1e9;
  list.forEach((s,i)=>{
    if (!pointFree(s[0],s[1],0.05,1.7,0.5)) return;
    let minD=1e9, seen=0;
    for (const b of Bots.list){ if (!b.alive) continue; const d=Math.hypot(b.pos.x-s[0],b.pos.z-s[1]); minD=Math.min(minD,d);
      if (d<45 && lineOfSight(new V3(b.pos.x,b.pos.y+1.5,b.pos.z), new V3(s[0],1.2,s[1]))) seen++; }
    const score = Math.min(minD,60) - seen*25 - (i===P.lastSpawn?40:0) + Math.random()*6;
    if (score>bs){ bs=score; best=i; }
  });
  P.lastSpawn=best; return list[best??0];
}
function respawnPlayer(){
  const s=pickSpawn(spawnPool());
  P.pos.set(s[0],0,s[1]); P.vel.set(0,0,0); P.yaw=s[2]; P.pitch=0; P.bluntCap=false; P.alive=true; P.crouch=false; P.grounded=true;
  P.hp=P.maxHp(); P.stamina=staminaMax(); P.exhausted=false; { const R=roomRules(); P.flash=R?R.flash:Loadout.flash; P.mine=R?R.mines:Loadout.mine; } P.lean=0; P.carrying=false; P.prone=false; P.leanToggle=0;
  Arsenal.reset(); Bus.emit('respawn');
}
function updateHealth(dt){
  if (!Net.inMatch && P.alive && P.hp<P.maxHp() && !P.smoking && performance.now()/1000-P.lastHurt>6) P.hp=Math.min(P.maxHp(),P.hp+8*dt*P.maxHp()/100);
  if (!P.alive){ P.deadT+=dt; if (P.deadT>3.5 && !Mode.ended && !Net.inMatch) respawnPlayer(); }   // online: the server respawns you
  // heavy breathing + vignette follow exhaustion
  const ex = P.alive ? clamp((0.32-staminaK())/0.32,0,1) : 0;
  Snd.breath(ex);
}

// ---------- Third-person character for the local player ----------
const PlayerChar = {
  rig:null, weapon:null, weaponId:null, blunt:null,
  build(){
    if (this.rig) scene.remove(this.rig.root);
    this.rig=buildCharacter(CharLook); scene.add(this.rig.root); this.weaponId=null; this.setWeapon(Arsenal.cur);
    // footsteps come from the animation's own foot contacts (one sound per touchdown, alternating feet)
    this.rig.onStep=(side,mode)=>{ if (!P.alive || !P.grounded || P.slide || P.ladder || P.anim || P.inCar || P.speed<0.6) return;
      Snd.step(P.crouch?'crouch':mode==='walk'?'walk':P.sprinting?'sprint':'run', null, side); };
    this.blunt=makeBluntModel(); this.blunt.visible=false; this.rig.root.add(this.blunt);
    this.can=makeCanModel(); this.rig.root.add(this.can); this.zyn=makeZynModel(); this.rig.root.add(this.zyn);
    this.nic=makeNicModel(); this.nic.visible=false; this.rig.root.add(this.nic);
    this.tag=makeLabel(); this.rig.root.add(this.tag.s); this.updateTag();
    this.pack=makeBagModel(); this.pack.visible=false; this.rig.bones.chest.add(this.pack); this.pack.position.set(0.12,-0.12,0.13); this.pack.rotation.set(0.1,PI,0.25); this.pack.scale.setScalar(0.9);
  },
  recolor(){ if (this.rig) setLookColors(this.rig, CharLook); },
  // "DEV" tag above your name (shown in third person; online, other players see it on your nameplate)
  updateTag(){ const T=this.tag; if (!T) return; T.s.visible=Dev.showTag(); if (!T.s.visible) return; drawNameTag(T, (Settings.name||'PLAYER').toUpperCase(), true, '#7fd0ff'); },
  setWeapon(id){
    if (!this.rig || this.weaponId===id) return;
    if (this.weapon) this.rig.weaponSlot.remove(this.weapon.model);
    this.weapon=createWeapon(id); this.rig.weaponSlot.add(this.weapon.model); this.weaponId=id;
  },
  refreshWeapons(){ if (this.weapon) applyWeaponConfig(this.weapon, WCustomSaved[this.weapon.id]); },
  update(dt){
    const rg=this.rig; if (!rg) return;
    rg.root.visible = P.alive && ((Rig.mode==='third' && !Rig.scoped && !Rig.optic && !P.inCar));
    if (!P.alive) return;
    rg.root.position.copy(P.pos);
    if (!P.ladder && !P.riding) P.bodyYaw=P.yaw;
    rg.root.rotation.y=P.bodyYaw;
    if (this.weaponId!==Arsenal.cur) this.setWeapon(Arsenal.cur);
    if (!P.smoking) this.blunt.visible=false; this.pack.visible=P.carrying;
    const U=P.using, item = U ? (U.kind==='beer'?this.can:this.zyn) : null; this.can.visible=false; this.zyn.visible=false;
    const A=Arsenal;
    const inv=new V3(P.vel.x,0,P.vel.z).applyAxisAngle(new V3(0,1,0),-P.bodyYaw);
    let reloadK=0, supportOverride=null;
    if (A.state==='reload'){ reloadK=A.stateT/A.stateDur;
      if (this.weapon && reloadK>0.12 && reloadK<0.75){ const g=this.weapon.model.localToWorld(this.weapon.grip.clone()); supportOverride=g.add(new V3(0,-0.12-Math.sin((reloadK-0.12)/0.63*PI)*0.18,0)); } }
    const rideSit = P.riding && !P.riding.S.stand;
    animateCharacter(rg, {speed:P.riding?0:P.speed, moveX:inv.x, moveZ:inv.z, sprint:P.sprinting, crouch:P.crouch, prone:P.prone, slide:!!P.slide, sit:rideSit,
      air:!P.grounded&&!P.ladder&&!P.anim&&P.airT>0.12, ladder:!!P.ladder, climb:P.climb, vault:!!P.anim, vaultK:P.anim?P.anim.t:0, land:P.landT||0, pitch:P.pitch, ads:A.adsK>0.3, lean:P.lean,
      hold:{weapon:this.weapon, kick:A.kick*(this.weapon?this.weapon.kickMul:1)*(A.cur==='glock'&&A.glockAuto?GLOCK_SWITCH_RECOIL:1), reloadK, supportOverride, firing:A.recoilP>0||A.adsK>0.3,
        lowReady:P.speed>3.2 && !P.crouch && !P.riding, smoking:!!P.smoking||!!U, nicT:Perks.nic?Perks.nic.t:null, nic:this.nic, smokeT:P.smoking?P.smoking.t:U?3*U.t/U.dur:0, blunt:item||this.blunt, swing: A.swing>0 ? 1-A.swing/A.swingDur : 0}}, dt);
  },
};

// ---------- Camera rig ----------
// Third-person camera tuning (all in one place). k values are damping rates for 1-exp(-k*dt) smoothing.
const CAM = {
  follow:20,          // pivot follow rate (high = tight; position only, aim/rotation is never smoothed)
  snapDist:2.0,       // teleports / respawns snap instead of gliding
  shoulder:0.7, shoulderAds:0.58, height:0.24,
  bobRun:0.03, bobSprint:0.055, bobWalk:0.012, swayRun:0.018, swaySprint:0.03, bobFade:6,
  rollMaxDeg:2.5, rollStrafe:0.45, rollTurn:0.25, rollK:6,
  sprintFov:6, sprintBack:0.35, sprintK:4,
  landDip:0.11, landMinAir:0.25, landSpring:60, landDamp:11,
  collidePad:0.25, collideOut:6,   // pull in instantly when blocked, ease back out at this rate
};
const TP_DISTANCE = 1.5;     // default metres behind the character (Settings.tpDistance)
const Rig = {
  mode:'first', eyeY:0, scoped:false, tpDist:TP_DISTANCE, bobPh:0, bobAmt:0, roll:0,
  setMode(m){ this.mode=m; Settings.camMode=m; saveSettings(); Bus.emit('cammode',m); },
  toggle(){ this.setMode(this.mode==='first'?'third':'first'); },
  update(dt){
    const A=Arsenal;
    this.scoped = A.def.scope && A.adsK>0.85 && P.alive && !P.inCar;
    // rifle optics: aiming in third person goes through the real scope on the viewmodel
    this.optic = !A.def.scope && A.def.optic && A.adsK>0.6 && P.alive && !P.inCar && A.cur!=='knife';
    const aspect=camera.aspect, hf=Settings.fov*PI/180;
    // sprint FOV kick (third person) and the camera-motion slider
    const cm=(Settings.camMotion??100)/100, tp=this.mode==='third' && !this.scoped && !this.optic;
    this.sprintK=damp(this.sprintK||0, tp && P.sprinting && P.speed>5 ? 1 : 0, CAM.sprintK, dt);
    let zoom = A.cur==='knife'?1 : lerp(1, A.def.adsZoom||1, A.adsK);
    if (P.sprinting) zoom*=1.04; if (P.slide) zoom*=1.06;
    const nsq = Perks.nic ? NIC_CFG.fovSqueeze*cm*Math.sin(nicPhase(Perks.nic.t).hold*PI) : 0;    // slow push-in during the Nic hit
    const vf = 2*Math.atan(Math.tan(hf/2)*zoom/aspect)*180/PI + this.sprintK*CAM.sprintFov*cm - nsq;
    if (Math.abs(camera.fov-vf)>0.01){ camera.fov=vf; camera.updateProjectionMatrix(); }
    // head bob: follows real speed; walk < run < sprint, subtle when crouched, off while aiming
    const bobStr=Settings.bob/100;
    const moving=P.grounded && P.speed>0.5 && !P.slide && !P.ladder && !P.anim && !P.riding;
    const target = moving ? (P.sprinting?1:P.crouch?0.35:Math.min(1,P.speed/4.6)*0.6)*(1-A.adsK*0.85) : 0;
    this.bobAmt=damp(this.bobAmt,target*bobStr,8,dt);
    if (moving) this.bobPh += dt*(P.sprinting?13.5:P.crouch?7:9.5)*Math.max(0.6,P.speed/4.6);
    const bobY=-Math.abs(Math.sin(this.bobPh))*0.045*this.bobAmt, bobX=Math.cos(this.bobPh)*0.03*this.bobAmt;
    // lean roll
    const lean=leanOffset(); this.roll=damp(this.roll, -P.lean*0.2, 10, dt);
    // third-person roll from strafing / turning (eases back to level)
    const yawRate=(P.yaw-(this.prevYaw??P.yaw))/Math.max(dt,1e-3); this.prevYaw=P.yaw;
    const side=new V3(P.vel.x,0,P.vel.z).dot(new V3(Math.cos(P.yaw),0,-Math.sin(P.yaw)));
    const rollT = tp ? clamp(-side/7.4*CAM.rollStrafe - yawRate*0.05*CAM.rollTurn, -1, 1)*CAM.rollMaxDeg*PI/180*cm : 0;
    this.tpRoll=damp(this.tpRoll||0, rollT, CAM.rollK, dt);
    const bs=Effects.sway(performance.now()/1000);              // beer: slight aim sway
    camera.rotation.set(P.pitch+bs[1], P.yaw+bs[0], this.roll+this.tpRoll+Math.cos(this.bobPh)*0.004*this.bobAmt, 'YXZ');
    if (P.inCar){
      const s=P.inCar.seat, [x,z]=toWorld(P.inCar.F,s[0],s[2]);
      camera.position.set(x,s[1],z); this.eyeY=P.pos.y+P.height-0.12; return;
    }
    const target2 = P.pos.y + P.height - 0.12 - (P.landT||0)*0.11*((Settings.camMotion??100)/100);
    if (Math.abs(target2-this.eyeY) > 1.2 || P.ladder || P.anim) this.eyeY = target2;
    else this.eyeY = damp(this.eyeY, target2, P.slide?10:18, dt);
    const right=new V3(Math.cos(P.yaw),0,-Math.sin(P.yaw));
    const fwdFlat=new V3(-Math.sin(P.yaw),0,-Math.cos(P.yaw));
    this.proneK=damp(this.proneK||0, P.prone?1:0, 4, dt);
    const eye = new V3(P.pos.x, this.eyeY, P.pos.z).addScaledVector(right, lean).addScaledVector(fwdFlat, this.proneK*0.55);
    if (this.proneK>0.01) eye.y = lerp(this.eyeY, P.pos.y+0.32, this.proneK);
    if (!P.alive){
      const c=P.corpse ? (P.corpse.rag ? new V3(P.corpse.rag.x[0],Math.max(0,P.corpse.rag.x[1]-0.3),P.corpse.rag.x[2]) : P.corpse.root.position) : P.pos;
      const k=Math.min(1,P.deadT*1.5), back=new V3(Math.sin(P.yaw),0,Math.cos(P.yaw)).multiplyScalar(3*k);
      camera.position.set(c.x,c.y+0.6,c.z).add(back).add(new V3(0,1.4*k,0)); camera.lookAt(c.x,c.y+0.3,c.z); return;
    }
    if (this.mode==='first' || this.scoped || this.optic){ camera.position.copy(eye).addScaledVector(right,bobX); camera.position.y+=bobY; return; }
    // over-the-shoulder third person: smoothed follow, footstep-synced bob, landing dip, collision
    const fwd=new V3(); camera.getWorldDirection(fwd);
    const pTarget=new V3(P.pos.x, P.pos.y+Math.max(0.7,P.height-0.08), P.pos.z);
    if (!this.tpPivot || this.tpPivot.distanceTo(pTarget)>CAM.snapDist) this.tpPivot=pTarget.clone();
    else this.tpPivot.lerp(pTarget, 1-Math.exp(-CAM.follow*dt));
    // landing dip (spring)
    if (P.grounded && this.wasAir>CAM.landMinAir) this.dipV=(this.dipV||0)-CAM.landDip*Math.min(1.6,this.wasAir*1.8)*8;
    this.wasAir = P.grounded ? 0 : (this.wasAir||0)+dt;
    this.dipV=(this.dipV||0)+(-(this.dip||0)*CAM.landSpring - (this.dipV||0)*CAM.landDamp)*dt; this.dip=(this.dip||0)+this.dipV*dt;
    // bob from the character's own stride phase: two dips per cycle (one per footfall) + a side sway once per cycle
    const rg=PlayerChar.rig, ph=rg?rg.phase:0, moving2=P.grounded && P.speed>0.6 && !P.slide;
    const bobA = moving2 ? (P.sprinting?CAM.bobSprint:P.speed>3?CAM.bobRun:CAM.bobWalk) : 0, swA = moving2 ? (P.sprinting?CAM.swaySprint:CAM.swayRun*Math.min(1,P.speed/4.6)) : 0;
    this.tpBob=damp(this.tpBob||0,bobA,CAM.bobFade,dt); this.tpSway=damp(this.tpSway||0,swA,CAM.bobFade,dt);
    const tbobY=(Math.cos(ph*PI*4)*0.5-0.5)*this.tpBob*cm*(1-A.adsK*0.8), swX=Math.sin(ph*PI*2)*this.tpSway*cm*(1-A.adsK*0.8);
    const pivot=this.tpPivot.clone().addScaledVector(right, lean+swX); pivot.y+=tbobY+(this.dip||0)*cm;
    // further over the right shoulder and a little higher, so the gun and hands stay in view and the body is clear of the crosshair
    const sh=lerp(CAM.shoulder,CAM.shoulderAds,A.adsK);
    let shoulder=pivot.clone().addScaledVector(right,sh).add(new V3(0,CAM.height,0));
    const sd=shoulder.clone().sub(pivot), sl=sd.length(); sd.divideScalar(sl);
    const h1=raycastWorld(pivot,sd,sl+0.2); if (h1.hit) shoulder=pivot.clone().addScaledVector(sd,Math.max(0,h1.dist-0.2));
    const back=fwd.clone().negate();
    const want0=lerp((Settings.tpDistance||TP_DISTANCE)+this.sprintK*CAM.sprintBack*cm, 1.1, A.adsK);
    const h2=raycastWorld(shoulder,back,want0+CAM.collidePad);
    const want = h2.hit ? Math.max(0.3,h2.dist-CAM.collidePad) : want0;
    this.tpDist = want<this.tpDist ? want : damp(this.tpDist,want,CAM.collideOut,dt);     // in instantly (never through walls), out smoothly
    camera.position.copy(shoulder).addScaledVector(back,this.tpDist);
  },
};
