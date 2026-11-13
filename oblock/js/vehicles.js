'use strict';
/* Rideable vehicles: exactly 2 e-scooters and 1 e-bike per match (imported models: assets/scooter.js, assets/ebike.js).
   Interact to get on / off. W accelerates, S brakes then reverses slowly, A/D steer. You can shoot while riding,
   but steering is locked while the trigger is held (the vehicle keeps its line). Works in first and third person.
   Vehicles collide with the world (same colliders as players), bump and lose speed on impact, and go back to
   their parking spots at the start of every match. */
const RIDE_SPEC = {
  scooter:{name:'E-SCOOTER', glb:'scooter', max:7.5, accel:4.5, brake:9, reverse:1.5, turn:2.3, radius:0.42, deck:0.16, eye:1.62, stand:true, yawFix:0},
  ebike:  {name:'E-BIKE',    glb:'ebike',   max:9.5, accel:4.0, brake:10, reverse:1.6, turn:1.9, radius:0.5,  deck:0.38, eye:1.25, stand:false, yawFix:0},
};
// parking spots (x, z, heading); validated against colliders + the nav grid when the match starts
const RIDE_SPOTS = [ {kind:'scooter', x:-10.5, z:12.2, yaw:0.4}, {kind:'scooter', x:29, z:2, yaw:PI/2}, {kind:'ebike', x:-58, z:14, yaw:-PI/2} ];
for (const r of RIDE_SPOTS){ [r.x,r.z]=RM(r.x,r.z); }

const Rides = {
  list:[], assets:{}, snd:null,
  load(){
    const load=name=>new Promise(res=>{ const b64=(window.GLB||{})[name]; if (!b64){ console.warn('vehicle model missing: '+name); return res(null); }
      const bin=atob(b64), buf=new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
      new THREE.GLTFLoader().parse(buf.buffer,'',g=>{ g.scene.traverse(o=>{ if (o.isMesh){ o.castShadow=true; for (const m of [].concat(o.material)){ m.metalnessMap=null; m.roughnessMap=null; m.metalness=Math.min(m.metalness,0.5); m.needsUpdate=true; } } }); res(g.scene); }, ()=>res(null)); });
    return Promise.all([load('scooter'), load('ebike')]).then(([s,e])=>{ this.assets.scooter=s; this.assets.ebike=e; });
  },
  init(scene){
    for (const spot of RIDE_SPOTS){
      const S=RIDE_SPEC[spot.kind], src=this.assets[spot.kind]; if (!src) continue;
      const root=new THREE.Group(), m=src.clone(true); m.rotation.y=S.yawFix; root.add(m); scene.add(root);
      this.list.push({id:spot.kind+this.list.length, kind:spot.kind, S, root, home:spot, pos:new V3(), yaw:0, speed:0, steer:0, rider:null, lean:0});
    }
    this.reset();
  },
  // back to the parking spots; a blocked spot is moved to the nearest open ground
  reset(){
    for (const v of this.list){
      let x=v.home.x, z=v.home.z;
      if (!pointFree(x,z,0.05,1.2,0.6) || !Nav.walkable(x,z)){ const f=Nav.nearestFree(x,z,8); if (f){ x=f[0]; z=f[1]; } }
      v.pos.set(x,0,z); v.yaw=v.home.yaw; v.speed=0; v.steer=0; v.rider=null; v.lean=0; this.place(v);
    }
    if (P.riding) this.dismount(true);
  },
  place(v){ v.root.position.copy(v.pos); v.root.rotation.set(0, v.yaw, 0); v.root.rotateZ(v.lean); },
  near(){ let best=null, bd=1.7; for (const v of this.list){ if (v.rider) continue; const d=Math.hypot(v.pos.x-P.pos.x, v.pos.z-P.pos.z); if (d<bd && Math.abs(v.pos.y-P.pos.y)<1){ bd=d; best=v; } } return best; },
  tryMount(){
    if (!P.alive || P.riding || P.inCar || P.smoking || P.using || Perks.busy() || P.prone) return false;
    const v=this.near(); if (!v) return false;
    v.rider='player'; P.riding=v; P.crouch=false; P.prone=false; endSlide(); P.vel.set(0,0,0); P.yaw=v.yaw; P.height=v.S.stand?1.7:1.3;
    Snd.click(0,700,0.3,'vehicles'); this.startSound(); Bus.emit('toast',{t:'ON THE '+v.S.name+' · '+Input.label(Binds.interact)+' TO GET OFF',kind:''});
    return true;
  },
  dismount(force){
    const v=P.riding; if (!v) return;
    // step off to the left (or right / behind) wherever there is room
    const rx=Math.cos(v.yaw), rz=-Math.sin(v.yaw), fx=-Math.sin(v.yaw), fz=-Math.cos(v.yaw);
    const tries=[[-rx*0.9,-rz*0.9],[rx*0.9,rz*0.9],[-fx*1.3,-fz*1.3],[fx*1.3,fz*1.3]];
    let spot=null; for (const [dx,dz] of tries){ const x=v.pos.x+dx, z=v.pos.z+dz; if (pointFree(x,z,v.pos.y+0.05,v.pos.y+1.7,RADIUS)){ spot=[x,z]; break; } }
    if (!spot && !force){ Bus.emit('toast',{t:'NO ROOM TO GET OFF HERE',kind:'warn'}); return; }
    if (spot){ P.pos.x=spot[0]; P.pos.z=spot[1]; }
    P.pos.y=v.pos.y; P.vel.set(0,0,0); P.height=1.7; P.riding=null; v.rider=null; v.speed=0; v.lean=0; this.place(v);
    this.stopSound(); Snd.click(0,600,0.25,'vehicles');
  },
  startSound(){ if (!this.snd) this.snd=Snd.play('scooter_loop',{cat:'vehicles', vol:0.0, loop:true, max:1}); },
  stopSound(){ if (this.snd){ Snd.stop(this.snd,0.2); this.snd=null; } },
  // steering is locked while firing
  steerLocked(){ return Arsenal.trigger && Arsenal.cur!=='knife' && Arsenal.canFire(); },
  update(dt){
    const v=P.riding;
    if (v){
      const S=v.S, f=(Input.held('forward')?1:0)-(Input.held('back')?1:0), r=(Input.held('right')?1:0)-(Input.held('left')?1:0);
      if (f>0) v.speed=Math.min(S.max, v.speed+S.accel*dt);
      else if (f<0) v.speed = v.speed>0.2 ? Math.max(0, v.speed-S.brake*dt) : Math.max(-S.reverse, v.speed-S.accel*0.5*dt);
      else v.speed=damp(v.speed, 0, 0.9, dt);
      const locked=this.steerLocked();
      v.steer = locked ? 0 : damp(v.steer, -r, 10, dt);          // firing: the bars are held straight
      const turnK=clamp(Math.abs(v.speed)/2.5,0,1)*Math.sign(v.speed||1);
      v.yaw += v.steer*S.turn*turnK*dt;
      v.lean = damp(v.lean, v.steer*clamp(v.speed/S.max,0,1)*0.22, 6, dt);
      // move + collide with the world (same resolver as players); a hard bump scrubs speed
      const fx=-Math.sin(v.yaw), fz=-Math.cos(v.yaw), before=v.pos.clone();
      v.pos.x+=fx*v.speed*dt; v.pos.z+=fz*v.speed*dt;
      const want=v.pos.clone(); resolveHorizontal(v.pos, 1.5, S.radius);
      const push=Math.hypot(want.x-v.pos.x, want.z-v.pos.z);
      if (push>0.02 && Math.abs(v.speed)>2){ if (Math.abs(v.speed)>4) Snd.impact(v.pos); v.speed*=0.35; }
      const {ground}=probeVertical(v.pos.x, v.pos.z, v.pos.y+0.5);
      if (ground-v.pos.y>0.35){ v.pos.copy(before); v.speed=0; } else v.pos.y=damp(v.pos.y, ground, 18, dt);
      this.place(v);
      P.pos.set(v.pos.x, v.pos.y+S.deck, v.pos.z); P.vel.set(fx*v.speed,0,fz*v.speed); P.speed=0; P.grounded=true; P.bodyYaw=v.yaw;
      P.height = S.stand ? 1.7 : 1.3;
      if (this.snd && this.snd.s){ const k=clamp(Math.abs(v.speed)/S.max,0,1); this.snd.s.playbackRate.value=0.75+k*0.55; this.snd.g.gain.value=0.12+k*0.55; }
    }
  },
};
