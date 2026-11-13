'use strict';
/* First-person viewmodel: a second instance of the imported character (only jacket,
   arms and hands visible), positioned so its eyes sit at the camera. Its real arm and
   hand bones are IK-driven onto each weapon's grip and support points, so the hands you
   see in first person are the model's own hands. Rendered in its own pass so it never
   clips into walls. */
// first-person arm rig tuning (camera space, metres)
function wq0(w){ return w.model.getWorldQuaternion(new THREE.Quaternion()); }
const VM_ARM = {
  poleR:[0.75,-1.0,0.3], poleL:[-0.75,-1.0,0.3], poleLPistol:[-1.2,-0.8,0.25],   // hip-fire elbow targets
  poleRAds:[0.45,-1.9,0.25], poleLAds:[-0.45,-1.9,0.25],                         // ADS: elbows tucked down
  poleNic:[0.7,-1.6,0.1],                                                         // Nic: elbow low and to the right
  sinkAds:[0,-0.07,-0.14],    // body offset at full ADS: lower and forward so the arms can reach the gun with the elbows down
  screenK:0.42,     // sleeves are cut above y = -0.33*depth: they stay inside the bottom ~20% of the screen
  near:0.14,        // and anywhere closer than 14 cm to the eye
};
const VM = {
  scene:null, cam:null, root:null, rig:null, weapons:{}, flash:null, hemi:null, sun:null,
  bobPh:0, lagX:0, lagY:0, swayX:0, swayY:0, sprintK:0, rot:new THREE.Euler(), blunt:null, slideK:0,
  init(){
    this.scene=new THREE.Scene();
    this.cam=new THREE.PerspectiveCamera(58, innerWidth/innerHeight, 0.01, 10);
    this.hemi=new THREE.HemisphereLight('#ffffff','#444444',0.8); this.scene.add(this.hemi);
    this.sun=new THREE.DirectionalLight('#ffffff',0.6); this.sun.position.set(-0.5,1,0.6); this.scene.add(this.sun);
    this.root=new THREE.Group(); this.scene.add(this.root);
    this.wroot=new THREE.Group(); this.root.add(this.wroot);
    const ft=canvasTex(64,64,(g,w,h)=>{ const gr=g.createRadialGradient(32,32,0,32,32,32); gr.addColorStop(0,'rgba(255,250,220,1)'); gr.addColorStop(0.25,'rgba(255,200,90,0.9)'); gr.addColorStop(1,'rgba(255,120,20,0)'); g.fillStyle=gr; g.translate(32,32); for (let i=0;i<6;i++){ g.rotate(PI/3); g.fillRect(-3,-32,6,64);} g.beginPath(); g.arc(0,0,16,0,PI*2); g.fill(); },false);
    this.flashTex=ft;
    this.flash=new THREE.Sprite(new THREE.SpriteMaterial({map:ft,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
    this.flash.scale.setScalar(0.12); this.flash.visible=false; this.scene.add(this.flash);
    this.flash2=new THREE.Sprite(new THREE.SpriteMaterial({map:ft,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,color:'#ffcf8a'}));
    this.flash2.visible=false; this.scene.add(this.flash2);
  },
  setCharacter(){
    if (this.rig) this.root.remove(this.rig.root);
    this.rig=buildCharacter(CharLook); setFirstPersonOnly(this.rig);
    this.rig.root.position.set(0,-1.675,-0.02);   // eyes at the camera (body slightly forward so arms reach the handguard)
    this.rig.root.rotation.y=-0.22;              // slightly bladed stance: support shoulder forward
    // sleeve clipping (camera space): while aiming / hitting the Nic, arm geometry is cut away above the bottom band of the
    // screen and within VM_ARM.near of the eye, so only hands, wrists and the start of the sleeves stay visible
    this.root.add(this.rig.root); this.rig.root.visible=false;     // skinned arms are third-person only now
    FPArms.build(this.scene, CharLook);
    if (this.blunt) this.root.remove(this.blunt);
    if (this.nic) this.root.remove(this.nic); this.nic=makeNicModel(); this.nic.visible=false; this.root.add(this.nic);
    this.blunt=makeBluntModel(); this.blunt.visible=false; this.root.add(this.blunt); this.blunt.traverse(o=>{ o.frustumCulled=false; });
    if (this.can) this.root.remove(this.can); if (this.zyn) this.root.remove(this.zyn);
    this.can=makeCanModel(); this.zyn=makeZynModel(); this.root.add(this.can); this.root.add(this.zyn);
  },
  recolor(){ if (this.rig) setLookColors(this.rig, CharLook); FPArms.recolor(CharLook); },
  setWeapon(id){
    for (const k in this.weapons) this.weapons[k].model.visible=false;
    if (!this.weapons[id]){ this.weapons[id]=createWeapon(id); this.wroot.add(this.weapons[id].model); }
    this.weapons[id].model.visible=true; this.cur=this.weapons[id];
  },
  refreshWeapons(){ for (const k in this.weapons) applyWeaponConfig(this.weapons[k], WCustomSaved[k]); },
  addLook(dx,dy){ this.swayX+=dx; this.swayY+=dy; },
  update(dt, A, mv){
    const w=this.cur; if (!w || !this.rig) return;
    const H=w.hold, ads=A.adsK, R=this.rig;
    this.lagX=damp(this.lagX, clamp(this.swayX*0.0009,-0.05,0.05), 9, dt); this.lagY=damp(this.lagY, clamp(this.swayY*0.0009,-0.04,0.04), 9, dt);
    this.swayX=0; this.swayY=0;
    this.sprintK=damp(this.sprintK, mv.sprint&&A.canSprintPose()?1:0, 10, dt);
    this.slideK=damp(this.slideK, P.slide?1:0, 10, dt);
    if (mv.speed>0.3 && mv.grounded) this.bobPh += dt*(mv.sprint?13:8.5);
    const bob=((mv.speed>0.3&&mv.grounded)?(mv.sprint?0.024:0.01):0.0022)*(0.4+Settings.bob/100*0.6);
    const t=performance.now()/1000;
    // ADS: the sight point goes exactly on the camera axis at the eye distance, after the ADS rotation (cant) is applied
    const adsE=new THREE.Euler((w.adsRot||[0,0,0])[0], (w.adsRot||[0,0,0])[1], (w.adsRot||[0,0,0])[2]+(H.cant||0));
    const hip=new V3(...H.vm), adsP=new V3(0,0,-(w.adsDist||H.ads)).sub(w.sight.clone().applyEuler(adsE));
    // ease-out on the way in
    const adsE2=1-(1-ads)*(1-ads);
    const vfov=lerp(58, H.vmFov||58, adsE2); if (Math.abs(this.cam.fov-vfov)>0.01){ this.cam.fov=vfov; this.cam.updateProjectionMatrix(); }
    const p=hip.lerp(adsP, adsE2), bk=1-ads*0.85;
    p.x += (Math.cos(this.bobPh)*bob - this.lagX)*bk;
    p.y += (-Math.abs(Math.sin(this.bobPh))*bob + Math.sin(t*1.6)*0.002 + this.lagY)*bk;
    const r=this.rot; r.set(H.vmRot[0]*(1-ads), H.vmRot[1]*(1-ads), H.vmRot[2]*(1-ads));
    r.y += this.lagX*2*bk; r.x += this.lagY*2*bk;
    r.x+=adsE.x*adsE2; r.y+=adsE.y*adsE2; r.z+=adsE.z*adsE2;
    const s=this.sprintK; p.x+=0.04*s; p.y-=0.05*s; r.y+=0.65*s; r.x-=0.3*s; r.z+=0.15*s;
    r.z += this.slideK*0.25; p.x -= this.slideK*0.03;
    const kA=1-ads*0.6;               // aiming: the gun kicks less, so the sights come back on target
    const swK=(w.id==='glock'&&A.glockAuto)?GLOCK_SWITCH_RECOIL:1; p.z += A.kick*0.045*w.kickMul*swK*kA; r.x += A.kick*0.09*w.kickMul*swK*kA;
    if (w.id==='drako'){ r.z += A.kick*0.03*(A.spray%2?1:-1); p.y += A.kick*0.006; }
    p.y -= A.lowerK*0.35; r.x -= A.lowerK*0.7;
    const nicPole=new V3(...VM_ARM.poleNic);
    const nicT=Perks.nic?Perks.nic.t:null, nph=nicT!==null?nicPhase(nicT):null, nicK=nph?nph.weaponDown:0;
    const smoking=!!P.smoking, U=P.using, useE=U?useCurve(U.t,U.dur):0; const smokeK=Math.max(smoking?smokeIn(P.smoking.t):0, nicK, U?Math.min(1,U.t/0.2, (U.dur-U.t)/0.2+0.0001):0);
    p.y -= smokeK*0.55; r.x -= smokeK*0.8;        // weapon goes fully down out of view while smoking
    let magOff=0;
    if (A.state==='reload'){
      const k=A.stateT/A.stateDur, dip=Math.sin(Math.min(1,k*1.15)*PI);
      r.z += 0.45*dip; r.x += 0.22*dip; p.y -= 0.04*dip; p.x -= 0.03*dip;
      // mag out -> held low -> back in at the weapon's insert point
      const ins=A.def.insertAt||0.6;
      magOff = k<0.12?0 : k<0.3?-(k-0.12)/0.18 : k<ins-0.12?-1 : k<ins?-(ins-k)/0.12 : 0;
    }
    if (w.id==='knife' && A.swing>0){
      const k=1-A.swing/A.swingDur;
      if (A.heavy){ const st=Math.sin(Math.min(1,k*1.6)*PI); p.z-=0.22*st; p.y+=0.05*st; r.x-=0.4*st; }
      else { const e=Math.sin(k*PI); p.x += lerp(0.12,-0.2,k)*e*1.4; p.y += 0.06*e; r.y += lerp(0.9,-1.2,k)*e; r.z += lerp(-0.6,1.0,k)*e; }
    }
    this.wroot.position.copy(p); this.wroot.rotation.copy(r);
    if (w.parts.mag){ const m=w.parts.mag; if (m.userData.y0===undefined) m.userData.y0=m.position.y; m.position.y = m.userData.y0 + magOff*(w.id==='drako'||w.id==='ar15'?0.12:w.id==='glock'?4:2); m.visible = magOff>-0.95 || w.id==='sniper'; }
    // shotgun pump stroke: weapon rocks back and the support hand slides the forend
    this.pumpK = w.id==='shotgun' && A.state==='pump' ? Math.sin(clamp(A.stateT/A.stateDur,0,1)*PI) : 0;
    if (this.pumpK){ this.wroot.position.z += this.pumpK*0.02; this.wroot.rotation.x += this.pumpK*0.06; }
    if (w.id==='glock' && w.parts.slide){
      let so=Math.max(0,A.kick)*-0.7;
      if (A.state==='reload'){ const k=A.stateT/A.stateDur; if (k>0.72 && k<0.9) so=-0.9*Math.sin((k-0.72)/0.18*PI); }  // slide release
      for (const o of w.parts.slide){ if (o.userData.x0===undefined) o.userData.x0=o.position.x; o.position.x=o.userData.x0+so; } }
    if (w.id==='drako' && A.state==='reload'){ /* charging handle pull at the end */ }
    if (w.id==='sniper' && w.parts.bolt){ const b=w.parts.bolt; if (b.userData.x0===undefined) b.userData.x0=b.position.x;
      let k=A.state==='bolt'?Math.sin(clamp(A.stateT/A.stateDur,0,1)*PI):0;
      if (A.state==='reload'){ const q=A.stateT/A.stateDur; k = q<0.1? q/0.1 : q<0.85 ? 1 : Math.max(0,(1-q)/0.15); }
      b.position.x=b.userData.x0-k*1.4; }
    this.root.updateMatrixWorld(true);
    // ----- dedicated first-person arms (rigid, see fparms.js)
    const FA=FPArms; if (!FA.R) FA.build(this.scene, CharLook);
    const aK=clamp(ads,0,1), lerpA=(a,b)=>new V3(...a).lerp(new V3(...b),aK).toArray();
    const HP=HAND_PLACE[w.id];
    if (nph && nph.visible){
      // Tap the Nic: hand rises from below the bottom-right corner to just under the mouth, palm toward the mouth
      const e=nph.hand, NT=NIC_TUNE;
      const gp = e<0.5 ? new V3(...NT.low).lerp(new V3(...NT.mid), e*2) : new V3(...NT.mid).lerp(new V3(...NT.mouth), (e-0.5)*2);
      gp.x+=Math.cos(this.bobPh)*bob*0.8 - this.lagX*0.5; gp.y-=Math.abs(Math.sin(this.bobPh))*bob*0.8 - this.lagY*0.5;   // same sway/bob as the weapons
      if (nph.hold>0){ const tt=performance.now()/1000; gp.x+=Math.sin(tt*9.1)*NIC_CFG.tremor; gp.y+=Math.sin(tt*7.3+1)*NIC_CFG.tremor; }
      const hq=basisQ(NT.palm, NT.fingers);
      FA.R.root.scale.setScalar(1); FA.pose(FA.R,'vape'); FA.place(FA.R, gp, hq, FP_ELBOW.nic); FA.hide(FA.L);
      this.holdItem(this.nic, NT.tilt*e); this.blunt.visible=false;
      if (this.nic.userData.led) this.nic.userData.led.material.opacity=0.25+0.75*nph.hold;
    } else if (U && smokeK>0.02){
      // beer / Zyn: same hand path as the blunt, the can tips up toward the mouth while drinking
      this.nic.visible=false; this.blunt.visible=false; const item=U.kind==='beer'?this.can:this.zyn, other=U.kind==='beer'?this.zyn:this.can; other.visible=false;
      const e=useE*useE*(3-2*useE), NT=NIC_TUNE;
      const gp=new V3(...NT.low).lerp(new V3(...NT.mid),Math.min(1,e*2)).lerp(new V3(...NT.mouth),Math.max(0,e*2-1));
      gp.x+=Math.cos(this.bobPh)*bob*0.6; gp.y-=Math.abs(Math.sin(this.bobPh))*bob*0.6;
      FA.R.root.scale.setScalar(1); FA.pose(FA.R, U.kind==='beer'?'pistolL':'vape'); FA.place(FA.R, gp, basisQ(NT.palm, NT.fingers), FP_ELBOW.nic); FA.hide(FA.L);
      item.visible=true; item.position.copy(FA.pinchAnchor(FA.R));
      item.quaternion.setFromEuler(U.kind==='beer' ? new THREE.Euler(0.2+1.25*e, 0.25, -0.15) : new THREE.Euler(0.9+0.6*e, 0.2, 0));
    } else if (smoking && smokeK>0.05){
      this.nic.visible=false;
      const k=smokeCurve(P.smoking.t), e=k*k*(3-2*k), NT=NIC_TUNE;
      const gp=new V3(...NT.low).lerp(new V3(...NT.mid),Math.min(1,e*2)).lerp(new V3(...NT.mouth),Math.max(0,e*2-1)); gp.y-=(1-smokeK)*0.3;
      gp.x+=Math.cos(this.bobPh)*bob*0.6; gp.y-=Math.abs(Math.sin(this.bobPh))*bob*0.6;
      const hq=basisQ(NT.palm, NT.fingers);
      FA.R.root.scale.setScalar(1); FA.pose(FA.R,'vape'); FA.place(FA.R, gp, hq, FP_ELBOW.nic); FA.hide(FA.L);
      this.holdItem(this.blunt, 0.6*e, true);
    } else if (HP){
      this.blunt.visible=false; this.nic.visible=false; this.can.visible=false; this.zyn.visible=false;
      const EA=HP.elbowAds||{R:FP_ELBOW.adsR, L:FP_ELBOW.adsL};
      const eR = w.id==='knife' ? FP_ELBOW.knife : lerpA(FP_ELBOW.hipR, EA.R);
      FA.placeOnWeapon(FA.R, w, HP.R, eR);
      if (A.state==='bolt' && w.id==='sniper'){ const b=new V3(); w.parts.bolt.getWorldPosition(b); FA.pose(FA.R,'relax'); FA.place(FA.R, b.add(new V3(0.03,-0.03,0.05)), FA.R.hand.quaternion, eR); }
      let sp=null;
      if (A.state==='reload' && w.parts.mag && magOff<-0.05){ sp=new V3(); w.parts.mag.getWorldPosition(sp); }
      if (this.pumpK && HP.L){ const spt=w.model.localToWorld(new V3(0,0.02,-0.36+this.pumpK*0.09)); FA.pose(FA.L,'rifleL'); FA.place(FA.L, spt, wq0(w).multiply(basisQ(HP.L.palm, HP.L.fingers)), lerpA(FP_ELBOW.hipL, FP_ELBOW.adsL)); }
      else if (sp){ FA.pose(FA.L,'pistolL'); FA.place(FA.L, sp.add(new V3(-0.035,-0.02,0.02)), wq0(w).multiply(basisQ([1,0.2,0],[0,0.3,-0.95])), lerpA(FP_ELBOW.hipL, FP_ELBOW.adsL)); }
      else if (HP.L) FA.placeOnWeapon(FA.L, w, HP.L, lerpA(FP_ELBOW.hipL, EA.L));
      else { FA.pose(FA.L,'relax'); FA.hide(FA.L); }
    } else { FA.hide(FA.R); FA.hide(FA.L); }
    this.flash.visible=false; this.flash2.visible=false;   // flashes now come from MuzzleFlash (fx2.js)
  },
  // a hand-held item (vape / blunt) sits in the right hand's pinch, upright, tilted toward the face by `tilt`
  holdItem(item, tilt, blunt){
    const FA=FPArms; item.visible=true;
    item.position.copy(FA.pinchAnchor(FA.R));
    const hq=FA.R.hand.getWorldQuaternion(new THREE.Quaternion());
    // upright in camera space (mouthpiece up), leaning toward the camera; the blunt points out of the fingers instead
    item.quaternion.setFromEuler(blunt ? new THREE.Euler(1.2, 0.3, -0.5) : new THREE.Euler(tilt, VAPE_GRIP.rot[1], VAPE_GRIP.rot[2]));
  },
  syncLights(hemi, sun){
    this.hemi.color.copy(hemi.color); this.hemi.groundColor.copy(hemi.groundColor); this.hemi.intensity=hemi.intensity*1.05;
    this.sun.color.copy(sun.color); this.sun.intensity=sun.intensity*0.9;
  },
};
