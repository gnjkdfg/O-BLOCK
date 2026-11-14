'use strict';
/* Procedural muzzle flash (no image files) and ejected shell casings with landing sounds.
   Both use small fixed pools; nothing is allocated per shot. */
const FLASH_TUNE = {
  // len = flash length along the barrel (m), wid = cross size, front = burst radius, dur = lifetime (s), light = point-light strength
  glock:  {len:0.09, wid:0.05, front:0.055, dur:0.045, light:1.6},
  switchG:{len:0.075,wid:0.045,front:0.048, dur:0.035, light:1.3},
  drako:  {len:0.21, wid:0.1,  front:0.11,  dur:0.06,  light:2.6},
  sniper: {len:0.26, wid:0.11, front:0.12,  dur:0.06,  light:2.8},
  ar15:   {len:0.17, wid:0.085,front:0.095, dur:0.05,  light:2.3},
  shotgun:{len:0.3,  wid:0.16, front:0.16,  dur:0.07,  light:3.4},
  scaleRand:0.2, adsScale:0.7, adsAlpha:0.6, lightRange:7,
};
const CASING_TUNE = { pool:30, life:4, fade:0.6, gravity:9.8, restitution:0.35, maxSounds:6,
  eject:{glock:[0.03,0.055,-0.05], drako:[0.03,0.085,-0.07], sniper:[0.03,0.07,0.0], ar15:[0.03,0.075,-0.07], shotgun:[0.03,0.075,-0.11]},       // ejection port (weapon space)
  size:{glock:[0.0045,0.019], drako:[0.0055,0.039], sniper:[0.006,0.05], ar15:[0.0048,0.045], shotgun:[0.0105,0.068]},
  color:{shotgun:'#b3261e'} };

function flashTextures(){
  const side=canvasTex(128,64,(g,w,h)=>{
    // elongated star/cone seen from the side: bright yellow-white core fading to orange edges
    const gr=g.createLinearGradient(0,0,w,0); gr.addColorStop(0,'rgba(255,250,225,1)'); gr.addColorStop(0.35,'rgba(255,214,120,.9)'); gr.addColorStop(1,'rgba(255,120,30,0)');
    g.fillStyle=gr; g.beginPath(); g.moveTo(0,h/2-10); g.lineTo(w*0.45,h/2-18); g.lineTo(w*0.55,h/2-6); g.lineTo(w,h/2); g.lineTo(w*0.55,h/2+6); g.lineTo(w*0.45,h/2+18); g.lineTo(0,h/2+10); g.closePath(); g.fill();
    const c=g.createRadialGradient(10,h/2,0,10,h/2,26); c.addColorStop(0,'rgba(255,255,240,1)'); c.addColorStop(1,'rgba(255,220,140,0)'); g.fillStyle=c; g.fillRect(0,0,w,h); },false);
  const front=canvasTex(64,64,(g,w,h)=>{
    g.translate(32,32); for (let i=0;i<7;i++){ g.rotate(PI*2/7); const gr=g.createLinearGradient(0,0,0,30); gr.addColorStop(0,'rgba(255,240,200,.95)'); gr.addColorStop(1,'rgba(255,130,40,0)'); g.fillStyle=gr; g.beginPath(); g.moveTo(-5,0); g.lineTo(0,30); g.lineTo(5,0); g.fill(); }
    const c=g.createRadialGradient(0,0,0,0,0,16); c.addColorStop(0,'rgba(255,255,245,1)'); c.addColorStop(1,'rgba(255,200,110,0)'); g.fillStyle=c; g.beginPath(); g.arc(0,0,16,0,PI*2); g.fill(); },false);
  return {side, front};
}
const MuzzleFlash = {
  pools:{}, light:{},
  init(){
    const T=flashTextures(); this.tex=T;
    for (const [key, sc] of [['world',scene],['vm',VM.scene]]){
      const list=[];
      for (let i=0;i<(key==='world'?8:3);i++){
        const g=new THREE.Group(); g.visible=false; sc.add(g);
        const mk=(tex,geo)=>{ const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,fog:false})); m.frustumCulled=false; g.add(m); return m; };
        const pg=new THREE.PlaneGeometry(1,1); pg.translate(0.5,0,0); pg.rotateY(PI/2);           // extends along -Z (out of the barrel)
        const a=mk(T.side,pg), b=mk(T.side,pg); b.rotation.z=PI/2;                                  // two crossed side planes
        const f=mk(T.front,new THREE.PlaneGeometry(1,1));                                           // round burst facing the barrel axis
        list.push({g,a,b,f,t:0,dur:0});
      }
      this.pools[key]={list,i:0};
    }
    // one permanent light per scene (intensity 0 when idle, so shaders never recompile)
    this.light.vm=new THREE.PointLight('#ffb35a',0,1.5,2); VM.scene.add(this.light.vm);
  },
  // pos/quat: muzzle position and barrel orientation (barrel = -Z) in that scene's space
  spawn(key, pos, quat, spec, opts={}){
    const P=this.pools[key], F=P.list[P.i++%P.list.length];
    const s=(1+(Math.random()*2-1)*FLASH_TUNE.scaleRand)*(opts.scale||1), len=spec.len*s*(0.85+Math.random()*0.3), wid=spec.wid*s;
    F.g.position.copy(pos); F.g.quaternion.copy(quat); F.g.rotateZ(Math.random()*PI);
    F.a.scale.set(1,wid,len); F.b.scale.set(1,wid*(0.7+Math.random()*0.4),len*(0.8+Math.random()*0.3));
    F.a.scale.set(1,wid,len); F.f.scale.setScalar(spec.front*2*s*(0.8+Math.random()*0.4)); F.f.position.z=-0.004; F.f.rotation.z=Math.random()*PI;
    const al=opts.alpha||1; for (const m of [F.a,F.b,F.f]) m.material.opacity=al;
    F.g.visible=true; F.t=F.dur=spec.dur*(0.85+Math.random()*0.3);
    // light: walls in the world, and the hands in the viewmodel
    const wp = key==='vm' ? camera.localToWorld(pos.clone()) : pos;
    FX.light.position.copy(wp); FX.light.distance=FLASH_TUNE.lightRange; FX.light.intensity=Math.max(FX.light.intensity, spec.light*al);
    if (key==='vm'){ this.light.vm.position.copy(pos); this.light.vm.intensity=spec.light*0.7*al; }
  },
  update(dt){
    for (const k in this.pools) for (const F of this.pools[k].list) if (F.t>0){ F.t-=dt; const a=Math.max(0,F.t/F.dur); for (const m of [F.a,F.b,F.f]) m.material.opacity=Math.min(m.material.opacity,a+0.3); if (F.t<=0) F.g.visible=false; }
    if (this.light.vm && this.light.vm.intensity>0) this.light.vm.intensity=Math.max(0,this.light.vm.intensity-dt*60);
  },
};
function flashSpec(id, auto){ return id==='glock' ? (auto?FLASH_TUNE.switchG:FLASH_TUNE.glock) : FLASH_TUNE[id]||FLASH_TUNE.glock; }

// ---------- shell casings ----------
const Casings = {
  list:[], i:0, sounds:0,
  init(){
    const mat=new THREE.MeshStandardMaterial({color:'#c9a24a', metalness:0.85, roughness:0.32, transparent:true});
    const geo=new THREE.CylinderGeometry(1,1,1,8); geo.rotateX(PI/2);
    for (let k=0;k<CASING_TUNE.pool;k++){ const m=new THREE.Mesh(geo,mat.clone()); m.visible=false; m.castShadow=false; scene.add(m);
      this.list.push({m, v:new V3(), spin:new V3(), t:0, bounces:0, ground:0, rest:false}); }
  },
  // world-space port position, gun orientation (barrel = -Z), ground height under the shooter
  eject(id, pos, quat, ground, remote){
    if (!CASING_TUNE.size[id]) return;
    const fx=Perf.fx(); if (fx==='minimal' || (fx==='reduced' && remote)) return;   // effects setting: fewer flying casings
    const C=this.list[this.i++%this.list.length], [r,l]=CASING_TUNE.size[id];
    C.m.material.color.set(CASING_TUNE.color[id]||'#c9a24a');
    C.m.scale.set(r,r,l); C.m.position.copy(pos); C.m.quaternion.copy(quat); C.m.visible=true; C.m.material.opacity=1;
    // up and to the right of the gun, with some randomness
    C.v.set(rr(1.6,2.4), rr(1.6,2.6), rr(-0.3,0.6)).applyQuaternion(quat);
    C.spin.set(rr(-20,20), rr(-30,30), rr(-20,20));
    C.t=0; C.bounces=0; C.ground=ground; C.rest=false; C.remote=remote;
  },
  update(dt){
    const T=CASING_TUNE;
    for (const C of this.list){ if (!C.m.visible) continue;
      C.t+=dt;
      if (!C.rest){
        C.v.y-=T.gravity*dt; C.m.position.addScaledVector(C.v,dt);
        C.m.rotation.x+=C.spin.x*dt; C.m.rotation.y+=C.spin.y*dt; C.m.rotation.z+=C.spin.z*dt;
        if (C.m.position.y<=C.ground+0.005 && C.v.y<0){
          C.m.position.y=C.ground+0.005;
          this.clink(C.m.position, C.bounces);
          C.bounces++; C.v.y=-C.v.y*T.restitution*rr(0.7,1.1); C.v.x*=0.5; C.v.z*=0.5; C.spin.multiplyScalar(0.5);
          if (C.bounces>=3 || Math.abs(C.v.y)<0.35){ C.rest=true; C.m.rotation.x=PI/2*0+0; C.m.rotation.set(0,Math.random()*PI,0); }
        }
      }
      if (C.t>T.life){ const k=1-(C.t-T.life)/T.fade; C.m.material.opacity=k; if (k<=0) C.m.visible=false; }
    }
  },
  // landing sound: one of 12 recorded shell drops, positional, surface-dependent; first impact louder, bounce quieter
  clink(pos, bounce){
    if (!Snd.ctx || !Snd.buf.shells) return;
    if (this.sounds>=CASING_TUNE.maxSounds) return; this.sounds++; setTimeout(()=>this.sounds--, 260);
    const surf=surfaceAt(pos.x,pos.z,pos.y), F={asphalt:{f:{type:'highshelf',f:3000,gain:0},r:1,v:1}, concrete:{f:{type:'highshelf',f:3000,gain:3},r:1.04,v:1.05},
      grass:{f:{type:'lowpass',f:1300},r:0.9,v:0.45}, metal:{f:{type:'peaking',f:4200,gain:8},r:1.12,v:1.1}}[surf]||{f:null,r:1,v:1};
    let i; do { i=Math.floor(Math.random()*12); } while (i===this.lastI); this.lastI=i;
    Snd.play('shells',{pos, cat:'hits', vol:(bounce?0.22:0.42)*F.v*Math.pow(10,(Math.random()*2-1)*0.1), rate:F.r*rr(0.95,1.06)*(bounce?1.08:1),
      max:CASING_TUNE.maxSounds, pool:'casing', offset:i*0.6+(bounce?0.08:0), dur:bounce?0.18:0.42, filter:F.f, hrtf:true});
  },
};
// surface at an arbitrary point (casings); falls back to the player-surface logic
function surfaceAt(x,z,y){
  if (y>0.35){ for (const b of BUILDINGS) if (x>b.x0-0.5&&x<b.x1+0.5&&z>b.z0-0.5&&z<b.z1+0.5) return 'concrete'; return 'metal'; }
  const px=clamp(Math.floor((x+GROUND_SIZE/2)*SC),0,GPX-1), pz=clamp(Math.floor((z+GROUND_SIZE/2)*SC),0,GPX-1);
  const D=groundPixels(), i=(pz*GPX+px)*4, d=[D[i],D[i+1],D[i+2]], l=(d[0]+d[1]+d[2])/765;
  if (d[1]>d[0]*1.08 && d[1]>d[2]*1.08) return 'grass';
  return l>0.48 ? 'concrete' : 'asphalt';
}

// player's shot: flash on the viewmodel (first person / optic) or on the third-person gun, plus a casing from the ejection port
function playerShotFX(d){
  const id=Arsenal.cur; if (id==='knife') return;
  const spec=flashSpec(id, !!d.auto), fp=(Rig.mode==='first'||Rig.optic);
  let port, wq;
  if (fp && VM.cur){
    const w=VM.cur; w.model.updateWorldMatrix(true,false); const q=w.model.getWorldQuaternion(new THREE.Quaternion());
    if (!d.noFlash && !d.suppressed && !Rig.scoped){ const a=Arsenal.adsK; MuzzleFlash.spawn('vm', w.model.localToWorld(w.muzzle.clone()), q, spec, {scale:lerp(1,FLASH_TUNE.adsScale,a), alpha:lerp(1,FLASH_TUNE.adsAlpha,a)}); }
    port=camera.localToWorld(w.model.localToWorld(new V3(...(CASING_TUNE.eject[id]||[0,0,0])))); wq=camera.quaternion.clone().multiply(q);
  } else {
    const w=PlayerChar.weapon; if (!w) return; const q=w.model.getWorldQuaternion(new THREE.Quaternion());
    if (!d.noFlash && !d.suppressed) MuzzleFlash.spawn('world', w.model.localToWorld(w.muzzle.clone()), q, spec, {});
    port=w.model.localToWorld(new V3(...(CASING_TUNE.eject[id]||[0,0,0]))); wq=q;
  }
  Casings.eject(id, port, wq, P.pos.y, false);
}
