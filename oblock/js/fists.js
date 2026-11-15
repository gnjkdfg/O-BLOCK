'use strict';
/* Fists (melee slot, replaces the knife when equipped; the only weapon in RUN THAT FADE).
   Left click tap = jab (hands alternate). Hold left click = charge a heavy punch (full at 0.8 s, thrown on release;
   released early = weaker; thrown by itself at 1.4 s so it can't be held forever). Hold F = block (cuts incoming punch
   damage by 75%, drains stamina, stops at empty stamina). A full-charge heavy that isn't blocked knocks the target down
   into the ragdoll for 1.8 s, then they get up. Online the server decides every hit, block and knockdown. */
const FIST = { tap:0.18, charge:0.8, maxHold:1.4, knock:0.9, knockDur:1.8, blockCut:0.25, blockDrain:14 };
const isMeleeId = id => id==='knife' || id==='fists';

const Fists = {
  chargeT:-1, held:false, punch:null, side:1, block:false, nextT:0, jolt:0,
  active(){ return Arsenal.cur==='fists'; },
  reset(){ this.chargeT=-1; this.held=false; this.punch=null; this.setBlock(false); },
  canAct(){ return this.active() && Arsenal.canFire() && Arsenal.state==='idle' && !(Arena.on && !Arena.fighter()) && !Arena.seat; },   // spectators can't throw punches
  setBlock(on){
    on = !!on && this.active() && P.alive && !(P.stunT>0) && P.stamina>5;
    if (on===this.block) return; this.block=on; if (on) this.chargeT=-1;
    if (Net.inMatch) Net.send({t:'block', on});
  },
  update(dt){
    const d=WEAPON_DEFS.fists, now=performance.now()/1000;
    this.jolt=Math.max(0,this.jolt-dt*5);
    if (!this.active()){ this.reset(); return; }
    if (this.block){ P.stamina=Math.max(0,P.stamina-FIST.blockDrain*dt); P.lastStrain=now; if (P.stamina<=0){ this.setBlock(false); Bus.emit('toast',{t:'TOO TIRED TO BLOCK',kind:'warn'}); } }
    const trig=Arsenal.trigger && this.canAct() && !this.block;
    if (trig && !this.punch && now>=this.nextT){ if (this.chargeT<0) this.chargeT=0; else this.chargeT+=dt; if (this.chargeT>=FIST.maxHold) this.release(); }
    else if (!Arsenal.trigger && this.chargeT>=0) this.release();
    if (!this.canAct() && this.chargeT>=0 && !Arsenal.trigger) this.chargeT=-1;
    const p=this.punch;
    if (p){ p.t+=dt; if (!p.hit && p.t>=p.dur*p.at){ p.hit=true; fistHit(p.heavy, p.charge); } if (p.t>=p.dur) this.punch=null; }
  },
  release(){
    const held=this.chargeT; this.chargeT=-1; if (held<0 || !this.canAct()) return;
    const heavy=held>=FIST.tap, charge=heavy?clamp(held/FIST.charge,0.25,1):0, d=WEAPON_DEFS.fists, now=performance.now()/1000;
    if (!heavy) this.side=-this.side;
    this.punch={side:heavy?1:this.side, heavy, charge, t:0, dur:heavy?0.5:0.26, at:heavy?0.42:0.45, hit:false};
    this.nextT=now+(heavy?d.heavyRate:d.rate); Arsenal.lastShot=now;
    Snd.swing(); useStamina(heavy?4+charge*5:2.5); Arsenal.recoilP=0.25;
  },
  // for the HUD and third person
  chargeK(){ return this.chargeT<0 ? 0 : Math.min(1,this.chargeT/FIST.charge); },
  pose(){ const p=this.punch; return {block:this.block, charge:this.chargeK(), punch:p?{side:p.side, heavy:p.heavy, k:p.t/p.dur}:null}; },
};

// the punch lands: nearest valid target in front, in reach and in sight (never through walls or the cage)
function fistHit(heavy, charge){
  const d=WEAPON_DEFS.fists, eye=new V3(P.pos.x,P.pos.y+P.height-0.15,P.pos.z), fwd=new V3(-Math.sin(P.yaw),0,-Math.cos(P.yaw));
  let best=null, bd=d.range+0.3;
  for (const b of Bots.list.concat(Net.inMatch?Net.targets():[])){ if (!b.alive || !canHit(b)) continue;
    const c=b.chest(), to=c.clone().sub(eye), dist=to.length(); to.y=0; to.normalize();
    if (dist<bd && to.dot(fwd)>0.5 && lineOfSight(eye,c)){ bd=dist; best=b; } }
  if (!best){ const {o,dir}=cameraRay(0), w=raycastWorld(o,dir,d.range); if (w.hit) Snd.punch(w.point, false, true); return; }
  if (Net.inMatch){ Net.shot('fists', P.pos, [{id:Net.netIdOf(best), head:false, heavy, d:+bd.toFixed(2)}], null, {c:+charge.toFixed(2)}); Snd.punch(best.chest(), heavy, false); return; }
  const dmg=(heavy ? lerp(d.heavyMin, d.heavyDmg, charge) : d.dmg) * StreakAuthority.dmgMul('player');
  best.damage(dmg, false, 'fists', fwd); Snd.punch(best.chest(), heavy, false); punchFlinch(best);
  if (heavy && charge>=FIST.knock && best.alive && best.stun) best.stun(FIST.knockDur, fwd);
}
// a short head-back flinch on the character that was hit (third person); one smooth motion, no shaking
function punchFlinch(ent){ if (ent && ent.rig) ent.rig.flinch=1; }

// punch sounds: a whoosh on the throw (Snd.swing) and a thud on contact; a blocked punch is a duller, shorter slap
Object.assign(Snd, {
  punch(pos, heavy, dull){ if (!this.ctx) return; const t=this.ctx.currentTime, far=pos?Math.min(1,pos.distanceTo(camera.position)/25):0, g=(1-far*0.8);
    this.noise(t,heavy?0.09:0.05,{f:dull?700:1100,q:1.2,gain:(heavy?0.5:0.32)*g,cat:'guns'});
    this.tone(t,heavy?150:190,heavy?55:80,heavy?0.14:0.08,{gain:(heavy?0.5:0.3)*g*(dull?0.6:1),cat:'guns'}); },
});
