'use strict';
/* Day/night cycle + night-time rain roll.
   Six periods, each lasting 5 real minutes of gameplay. Lighting interpolates
   continuously from one period's look to the next, so nothing switches abruptly. */
const PERIOD_SECONDS = 300;
const PHASES = [
  {name:'Early morning', hour:5,  sky:'#5a6582', fog:'#5e6780', hs:'#8d9ab8', hg:'#3b3633', hi:0.42, si:0.22, sc:'#ffb294', el:6,  az:-1.3, night:0.55},
  {name:'Morning',       hour:8,  sky:'#a3bad0', fog:'#a9b8c4', hs:'#c9d5df', hg:'#4f463c', hi:0.6,  si:0.8,  sc:'#ffe6c4', el:28, az:-0.9, night:0},
  {name:'Afternoon',     hour:13, sky:'#93aecb', fog:'#a2b0bc', hs:'#c3d0dc', hg:'#4a4238', hi:0.56, si:0.9,  sc:'#ffe9c9', el:55, az:0.2,  night:0},
  {name:'Evening',       hour:17, sky:'#b9a68f', fog:'#b3a08b', hs:'#e3d2bb', hg:'#584a3c', hi:0.66, si:0.6,  sc:'#ffd29a', el:24, az:1.0,  night:0.12},
  {name:'Sunset',        hour:19, sky:'#c4735c', fog:'#9c6253', hs:'#e69a7a', hg:'#3d2c28', hi:0.48, si:0.38, sc:'#ff8a5a', el:5,  az:1.35, night:0.5},
  {name:'Night',         hour:22, sky:'#121829', fog:'#141a2a', hs:'#3c4a72', hg:'#17171c', hi:0.3,  si:0.16, sc:'#93a8db', el:45, az:-0.4, night:1},
];
const _c1=new THREE.Color(), _c2=new THREE.Color();
function lerpCol(a,b,t,out){ return out.copy(_c1.set(a)).lerp(_c2.set(b),t); }

const Env = {
  t: PERIOD_SECONDS*1,           // start of "Morning"
  phase: 1, raining:false, wet:0, rollLog:[], nightRolled:false,
  thunderT: 20, flash:0, refs:null, rain:null, stars:null,
  init(refs){
    this.refs=refs;
    // stars
    const n=500, pos=new Float32Array(n*3);
    for (let i=0;i<n;i++){ const u=Math.random()*PI*2, v=Math.random()*0.45+0.08, r=230; pos[i*3]=Math.cos(u)*Math.cos(v)*r; pos[i*3+1]=Math.sin(v)*r; pos[i*3+2]=Math.sin(u)*Math.cos(v)*r; }
    const sg=new THREE.BufferGeometry(); sg.setAttribute('position',new THREE.BufferAttribute(pos,3));
    this.stars=new THREE.Points(sg,new THREE.PointsMaterial({color:'#e8eeff',size:1.4,sizeAttenuation:false,transparent:true,opacity:0,fog:false,depthWrite:false}));
    this.stars.renderOrder=-1; refs.scene.add(this.stars);
    // moon / sun disc
    this.disc=new THREE.Mesh(new THREE.CircleGeometry(7,16),new THREE.MeshBasicMaterial({color:'#fff',fog:false,transparent:true,opacity:0.9,depthWrite:false}));
    refs.scene.add(this.disc);
    // rain streaks (pooled line segments around the camera)
    const max=1400, rp=new Float32Array(max*6);
    const rg=new THREE.BufferGeometry(); rg.setAttribute('position',new THREE.BufferAttribute(rp,3)); rg.setDrawRange(0,0);
    this.rain=new THREE.LineSegments(rg,new THREE.LineBasicMaterial({color:'#a9b8cc',transparent:true,opacity:0.45,fog:true,depthWrite:false}));
    this.rain.frustumCulled=false; this.rain.visible=false; refs.scene.add(this.rain);
    this.drops=[]; for (let i=0;i<max;i++) this.drops.push({x:rr(-22,22),y:rr(0,22),z:rr(-22,22),v:rr(16,22)});
    this.apply(0);
  },
  get periodIndex(){ return Math.floor(this.t/PERIOD_SECONDS)%PHASES.length; },
  clockString(){
    const i=this.periodIndex, f=(this.t%PERIOD_SECONDS)/PERIOD_SECONDS;
    let h0=PHASES[i].hour, h1=PHASES[(i+1)%PHASES.length].hour; if (h1<h0) h1+=24;
    const h=(h0+(h1-h0)*f)%24, hh=Math.floor(h), mm=Math.floor((h-hh)*60);
    const ap=hh>=12?'PM':'AM', h12=((hh+11)%12)+1;
    return h12+':'+String(mm).padStart(2,'0')+' '+ap;
  },
  // Exactly one weather roll at the start of each night; rain ends with the night.
  onPeriodChange(prev, next){
    if (PHASES[next].name==='Night'){
      const roll=Math.random(); const rain=roll<0.10;
      this.rollLog.push({at:this.t, roll, rain}); this.setRain(rain);
    } else if (PHASES[prev].name==='Night' && this.raining){ this.setRain(false); }
  },
  setRain(on){ this.raining=on; Snd.setRain(on, Settings.rainFx==='reduced'?0.6:1); Bus.emit('weather', on); },
  update(dt, cam){
    const prev=this.periodIndex; this.t += dt; const next=this.periodIndex;
    if (next!==prev) this.onPeriodChange(prev,next);
    this.apply(dt, cam);
  },
  apply(dt, cam){
    const R=this.refs, i=this.periodIndex, j=(i+1)%PHASES.length, f=(this.t%PERIOD_SECONDS)/PERIOD_SECONDS;
    const A=PHASES[i], Bp=PHASES[j], s=f*f*(3-2*f); // smoothstep for gentle transitions
    const night=lerp(A.night,Bp.night,s); this.nightK=night;
    const wet=this.wet = damp(this.wet, this.raining?1:0, 0.08, dt||1);
    const rainDim = 1-wet*0.25;
    lerpCol(A.sky,Bp.sky,s,R.scene.background); R.scene.background.multiplyScalar(rainDim);
    lerpCol(A.fog,Bp.fog,s,R.scene.fog.color); R.scene.fog.color.multiplyScalar(rainDim);
    lerpCol(A.hs,Bp.hs,s,R.hemi.color); lerpCol(A.hg,Bp.hg,s,R.hemi.groundColor);
    this.flash=Math.max(0,this.flash-(dt||0)*3);
    R.hemi.intensity=lerp(A.hi,Bp.hi,s)*rainDim + this.flash;
    R.sun.intensity=lerp(A.si,Bp.si,s)*(1-wet*0.6);
    lerpCol(A.sc,Bp.sc,s,R.sun.color);
    const el=lerp(A.el,Bp.el,s)*PI/180, az=lerp(A.az,Bp.az,s);
    this.sunDir = new V3(Math.cos(el)*Math.sin(az), Math.sin(el), -Math.cos(el)*Math.cos(az)).normalize();
    // windows, street lamps, ground pools
    for (const m of R.windowMats) m.emissiveIntensity = night*0.95;
    lerpCol('#4a4a44','#ffe0a0',night,M.lampHead.color);
    M.pool.opacity = night*0.55;
    M.firePool.opacity = 0.12+night*0.35;
    M.skyline.color.copy(R.scene.fog.color).multiplyScalar(0.95+night*0.1);
    this.stars.material.opacity = night*(1-wet)*0.9;
    // wet pavement
    R.groundMat.color.setRGB(1-wet*0.32, 1-wet*0.3, 1-wet*0.26);
    if (R.wetPhong){ R.wetPhong(wet>0.3 && Settings.quality==='high'); }
    if (cam){
      this.stars.position.copy(cam.position);
      const isNight=night>0.6;
      this.disc.position.copy(cam.position).addScaledVector(this.sunDir,200);
      this.disc.lookAt(cam.position);
      this.disc.material.color.set(isNight?'#dfe6ff':'#fff2d0');
      this.disc.material.opacity = (isNight?0.9:0.6)*(1-wet*0.9)*(A.el>3||Bp.el>3?1:0.5);
      this.updateRain(dt,cam);
    }
  },
  updateRain(dt,cam){
    const on=this.wet>0.02 && this.raining || (this.wet>0.02 && !this.raining && this.rain.visible && this.wet>0.2);
    const showDrops = this.raining;
    this.rain.visible = showDrops;
    if (!showDrops) return;
    const q={potato:160,low:500,med:900,high:1400}[Settings.quality]||600;
    const n=Math.floor(q*(Settings.rainFx==='reduced'?0.4:1)*(Settings.superPerf?0.3:1)*Math.min(1,this.wet*1.5+0.2));
    const p=this.rain.geometry.attributes.position.array, cx=cam.position.x, cy=cam.position.y, cz=cam.position.z;
    for (let k=0;k<n;k++){
      const d=this.drops[k]; d.y-=d.v*dt; if (d.y<-2){ d.y=rr(16,22); d.x=rr(-22,22); d.z=rr(-22,22); }
      const x=cx+d.x, y=cy-4+d.y, z=cz+d.z, o=k*6;
      p[o]=x; p[o+1]=y; p[o+2]=z; p[o+3]=x+0.04; p[o+4]=y-0.55; p[o+5]=z+0.02;
    }
    this.rain.geometry.setDrawRange(0,n*2); this.rain.geometry.attributes.position.needsUpdate=true;
    this.thunderT-=dt;
    if (this.thunderT<=0){ this.thunderT=rr(18,45); this.flash=0.9; Snd.thunder(rr(0.4,2.0)); }
  },
};
