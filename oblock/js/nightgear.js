'use strict';
/* Night gear.
   FLASHLIGHTS — everyone has one. The player toggles it (rebindable, default U); bots switch theirs on at night.
     Cheap by design: no light ever casts shadows. The player's beam is one SpotLight on the camera; on Medium/High,
     two pooled SpotLights follow the nearest bots with their lights on; on Low (and in Performance Mode) bots only get
     the visible beam cone, no light. Lights are created once and dimmed to 0 instead of being added/removed, so
     toggling never recompiles shaders.
   SNIPER — new reticle (mil-dots, heavy posts, fine centre) and a THERMAL mode (default N, while scoped).
     Thermal renders the world cold and people hot in two passes; the hot pass is depth-tested against the world,
     so walls hide people exactly like normal vision does (no seeing through walls). */
const THERM_LAYER = 5;
const FLASH_CFG = { player:{intensity:2.4, distance:30, angle:0.42, penumbra:0.5}, bot:{intensity:1.6, distance:22, angle:0.4, penumbra:0.5}, botLights:2, nightK:0.55 };

const Flashlight = {
  on:false, spot:null, target:null, beams:[], botSpots:[],
  init(scene){
    // Low / Performance Mode: the player's light is only created the first time it is switched on, so players who never use it
    // pay nothing for it; Medium / High create it up front so the first toggle never hitches
    this.target=new THREE.Object3D(); scene.add(this.target);
    if (Settings.quality!=='low' && Settings.quality!=='potato' && !Settings.perf && !Settings.superPerf) this.makeSpot();
    this.beamGeo=new THREE.CylinderGeometry(0.02, 1.1, 7, 14, 1, true); this.beamGeo.translate(0,-3.5,0); this.beamGeo.rotateX(-PI/2);   // cone along -Z from its tip
    this.beamMat=new THREE.MeshBasicMaterial({color:'#fff2d0', transparent:true, opacity:0.06, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide, fog:true});
    this.playerBeam=this.makeBeam(scene);
    this.applyQuality(scene);
  },
  makeSpot(){ if (this.spot) return; const C=FLASH_CFG.player;
    this.spot=new THREE.SpotLight('#fff3dc', 0, C.distance, C.angle, C.penumbra, 1.6); this.spot.castShadow=false; this.spot.target=this.target; scene.add(this.spot); },
  makeBeam(scene){ const m=new THREE.Mesh(this.beamGeo, this.beamMat); m.visible=false; m.frustumCulled=false; scene.add(m); return m; },
  // Medium/High: pooled bot lights; Low / Performance Mode: none (created once per quality change)
  applyQuality(scene){
    const want = (Settings.quality!=='low' && Settings.quality!=='potato' && !Settings.perf && !Settings.superPerf) ? FLASH_CFG.botLights : 0;
    while (this.botSpots.length>want){ const s=this.botSpots.pop(); scene.remove(s, s.target); }
    while (this.botSpots.length<want){ const C=FLASH_CFG.bot, s=new THREE.SpotLight('#fff0d6', 0, C.distance, C.angle, C.penumbra, 1.6); s.castShadow=false; s.target=new THREE.Object3D(); scene.add(s, s.target); this.botSpots.push(s); }
  },
  toggle(){ if (!P.alive) return; this.on=!this.on; if (this.on) this.makeSpot(); Snd.click(0,this.on?2600:1900,0.18,'env'); },
  isNight(){ return (Env.nightK||0) > FLASH_CFG.nightK; },
  update(){
    // player light from the camera (first person) or the gun (third person), aimed where you look
    const fwd=new V3(); camera.getWorldDirection(fwd);
    const on = this.on && P.alive && Game.state==='playing' && !P.inCar && !Rig.scoped;
    let from;
    if (Rig.mode==='third' && PlayerChar.weapon){ from=PlayerChar.weapon.model.localToWorld(PlayerChar.weapon.muzzle.clone()); }
    else from=camera.position.clone().add(new V3(0.12,-0.12,0).applyQuaternion(camera.quaternion));
    this.target.position.copy(from).addScaledVector(fwd,10);
    if (this.spot){ this.spot.position.copy(from); this.spot.intensity = on ? FLASH_CFG.player.intensity : 0; }
    const pb=this.playerBeam; pb.visible = on && Rig.mode==='third';
    if (pb.visible){ pb.position.copy(from); pb.lookAt(from.clone().add(fwd)); }
    // bots: lights on at night; beams for everyone visible, real lights for the nearest few
    const night=this.isNight(), lit=[];
    let bi=0;
    for (const b of Bots.list){
      if (!b.beam) b.beam=this.makeBeam(scene);
      const show = night && b.alive && b.rig && b.rig.root.visible && !b.useKnife;
      b.beam.visible=show; b.flashOn=show;
      if (!show) continue;
      const w=b.weapon; const p=w.model.localToWorld(w.muzzle.clone()), q=w.model.getWorldQuaternion(new THREE.Quaternion());
      b.beam.position.copy(p); b.beam.quaternion.copy(q);
      lit.push([b.pos.distanceTo(camera.position), b, p, q]);
    }
    lit.sort((a,b)=>a[0]-b[0]);
    for (const s of this.botSpots){ const L=lit[bi++];
      if (!L){ s.intensity=0; continue; }
      const [,b,p,q]=L; s.position.copy(p); s.target.position.copy(p).add(new V3(0,0,-8).applyQuaternion(q)); s.intensity=FLASH_CFG.bot.intensity; }
  },
};

// ---- sniper reticle (drawn once into the scope overlay) + thermal
function drawSniperReticle(cv){
  const g=cv.getContext('2d'), W=cv.width, c=W/2; g.clearRect(0,0,W,W);
  g.strokeStyle='#050505'; g.fillStyle='#050505';
  // heavy outer posts
  const post=W*0.012, gap=W*0.17;
  g.fillRect(0,c-post/2,c-gap,post); g.fillRect(c+gap,c-post/2,c-gap,post); g.fillRect(c-post/2,c+gap,post,c-gap);
  // fine crosshair
  g.lineWidth=Math.max(1,W*0.0018); g.beginPath(); g.moveTo(c-gap,c); g.lineTo(c+gap,c); g.moveTo(c,c-gap*1.6); g.lineTo(c,c+gap); g.stroke();
  // mil-dots
  const step=gap/5; for (let i=1;i<5;i++){ for (const [dx,dy] of [[i,0],[-i,0],[0,i],[0,-i]]){ g.beginPath(); g.ellipse(c+dx*step,c+dy*step, dx?W*0.004:W*0.0055, dx?W*0.0055:W*0.004, 0,0,PI*2); g.fill(); } }
  // holdover hash marks under the centre
  for (let i=1;i<=3;i++){ const y=c+step*(i+0.5); g.fillRect(c-W*0.012*(4-i)/3-1, y, W*0.024*(4-i)/3+2, Math.max(1,W*0.0018)); }
  // red centre dot (illuminated)
  g.fillStyle='#ff2a1f'; g.beginPath(); g.arc(c,c,W*0.0035,0,PI*2); g.fill();
}
const Thermal = {
  on:false, hide:[],
  init(){
    // light-independent shading (works day or night): cold world = dark grey from surface angle + distance, people = white hot.
    // Both passes share the same skinned vertex path, so the hot pass depth-tests exactly against the world.
    const vs=`#include <common>
#include <skinning_pars_vertex>
varying vec3 vN; varying float vD;
void main(){
#include <skinbase_vertex>
#include <beginnormal_vertex>
#include <skinnormal_vertex>
#include <defaultnormal_vertex>
#include <begin_vertex>
#include <skinning_vertex>
#include <project_vertex>
  vN=normalize(transformedNormal); vD=-mvPosition.z; }`;
    this.cold=new THREE.ShaderMaterial({vertexShader:vs, skinning:true, side:THREE.DoubleSide,
      fragmentShader:'varying vec3 vN; varying float vD; void main(){ float l=0.13+0.17*abs(vN.z)+0.05*vN.y; l*=1.0-clamp(vD/140.0,0.0,0.55); gl_FragColor=vec4(vec3(l),1.0); }'});
    this.hot=new THREE.ShaderMaterial({vertexShader:vs, skinning:true, side:THREE.DoubleSide,
      fragmentShader:'varying vec3 vN; varying float vD; void main(){ float l=0.82+0.18*abs(vN.z); gl_FragColor=vec4(l,l*0.97,l*0.9,1.0); }'});
    this.bg=new THREE.Color('#0d0d0d');
    const cv=document.querySelector('#scope canvas'); if (cv) drawSniperReticle(cv);
  },
  toggle(){
    if (Arsenal.cur!=='sniper'){ Bus.emit('toast',{t:'THERMAL · SNIPER SCOPE ONLY',kind:'warn'}); return; }
    this.on=!this.on; Snd.click(0,this.on?3000:2000,0.2,'env'); Bus.emit('toast',{t:'THERMAL '+(this.on?'ON':'OFF'),kind:''});
    if (this.on) this.collect();
  },
  // every person (bots, bodies) is drawn hot; everything else cold
  tagBot(rig){ for (const m of rig.meshes) m.layers.enable(THERM_LAYER); },
  collect(){ this.hide=[]; scene.traverse(o=>{ if ((o.isSprite || o.isPoints || o.isLine) && o.visible!==undefined) this.hide.push(o); }); },
  active(){ return this.on && Rig.scoped && Arsenal.cur==='sniper'; },
  render(r){
    const bg=scene.background, fog=scene.fog, vis=this.hide.map(o=>o.visible);
    for (const o of this.hide) o.visible=false;
    scene.background=this.bg; scene.fog=null;
    scene.overrideMaterial=this.cold; r.render(scene,camera);
    camera.layers.set(THERM_LAYER); scene.overrideMaterial=this.hot; scene.background=null; r.render(scene,camera);
    camera.layers.set(0); scene.overrideMaterial=null; scene.background=bg; scene.fog=fog;
    this.hide.forEach((o,i)=>o.visible=vis[i]);
  },
};
