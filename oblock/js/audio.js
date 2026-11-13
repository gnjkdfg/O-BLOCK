'use strict';
/* Audio: imported sound files (decoded once into buffers), positional playback with
   distance attenuation + stereo panning, per-category volume buses, voice limiting,
   streamed music tracks with crossfades, and synthesized fallbacks for sounds that
   were not supplied (footsteps, ambience, coughing, explosions, flashbang ring). */
const CATS = ['guns','hits','steps','breath','ambience','vehicles','env','ui','reload'];
// ---- audio tuning (all levels linear gain unless noted)
const AUDIO_TUNE = {
  pool:10,                      // voices per weapon layer; the oldest voice fades out (15 ms) instead of being cut
  pitchRand:0.04, volRandDb:1.5,
  drako:  {crack:1.15, body:0.55, tail:0.42, crackDur:0.30, variants:[['drako_a',1.0],['drako_b',1.0],['drako_a',0.965],['drako_b',1.035]]},
  glock:  {crack:0.95, body:0.42, tail:0.35, crackDur:0.16, variants:[['glock_shot',1.0],['glock_shot',0.97],['glock_shot',1.03],['glock_shot',0.985]]},
  switchG:{crack:0.9, body:0.36, tail:0.38, crackDur:0.11, rate:1.07, bright:3500, rattle:0.06},
  sniper: {crack:1.05, body:0.7, tail:0.55, crackDur:0.6, variants:[['sniper_shot',1.0],['sniper_shot',0.97],['sniper_shot',1.025]]},
  ar15:   {crack:1.1, body:0.5, tail:0.4, crackDur:0.2, variants:[['ar_a',1.0],['ar_b',1.0],['ar_c',1.0],['ar_b',0.97]]},
  shotgun:{crack:1.2, body:0.85, tail:0.5, crackDur:0.55, variants:[['sg_a',1.0],['sg_b',1.0],['sg_a',0.96],['sg_b',1.03]]},
  tailOffset:{ar_a:0.2, ar_b:0.2, ar_c:0.2, sg_a:0.3, sg_b:0.3, drako_a:0.09, drako_b:0.09, glock_shot:0.13, sniper_shot:0.18}, releaseTail:1.2,
  lowAmmo:3, lowAmmoClick:0.14,
  far:{ref:4, rolloff:1.1, lpNear:16000, lpFar:1600, farDist:120, tailBoost:1.8},
  limiter:{threshold:-3, ratio:20, attack:0.001, release:0.08},
};
// footstep onsets (seconds) inside the imported footstep recording
const STEP_ONSETS=[0.34,1.06,1.78,2.55,3.26,3.93,4.6,5.32,6.03,6.82,7.55,8.35,9.06,9.77];
const Snd = {
  ctx:null, master:null, bus:{}, buf:{}, noiseBuf:null, voices:{}, rain:null, breathSrc:null, slideSrc:null, autoSrc:null,
  music:{ els:{}, cur:null },
  init(){
    if (this.ctx){ if (this.ctx.state==='suspended') this.ctx.resume(); return; }
    const AC=window.AudioContext||window.webkitAudioContext; if (!AC) return;
    try { this.ctx=new AC(); } catch(e){ return; }
    const c=this.ctx;
    this.master=c.createGain();
    // master limiter so sustained full-auto never clips
    const L=AUDIO_TUNE.limiter, lim=c.createDynamicsCompressor(); lim.threshold.value=L.threshold; lim.knee.value=0; lim.ratio.value=L.ratio; lim.attack.value=L.attack; lim.release.value=L.release;
    this.master.connect(lim); lim.connect(c.destination); this.limiter=lim;
    // SFX group (everything except ambience/music) and the ambience group, each with its own slider
    this.sfx=c.createGain(); this.sfx.connect(this.master); this.amb=c.createGain(); this.amb.connect(this.master);
    for (const k of CATS){ this.bus[k]=c.createGain(); this.bus[k].connect(k==='ambience'?this.amb:this.sfx); }
    // weapons go through a fast compressor: rapid fire stays punchy without clipping/distortion
    const comp=c.createDynamicsCompressor(); comp.threshold.value=-10; comp.knee.value=6; comp.ratio.value=6; comp.attack.value=0.002; comp.release.value=0.12;
    this.bus.guns.disconnect(); this.bus.guns.connect(comp); comp.connect(this.sfx); this.gunComp=comp;
    // space: slapback delay (outdoors/streets) fed from guns + steps; tuned every 0.4 s from the surroundings
    this.slap=c.createDelay(0.5); this.slapFb=c.createGain(); this.slapWet=c.createGain(); this.slapSend=c.createGain();
    this.slap.delayTime.value=0.12; this.slapFb.gain.value=0.18; this.slapWet.gain.value=0.22; this.slapSend.gain.value=0.6;
    this.slapSend.connect(this.slap); this.slap.connect(this.slapFb); this.slapFb.connect(this.slap); this.slap.connect(this.slapWet); this.slapWet.connect(this.sfx);
    this.verbSend=c.createGain(); this.verbSend.gain.value=0.5;
    // resume on the first user gesture (autoplay policies)
    const resume=()=>{ if (c.state!=='running') c.resume(); }; addEventListener('pointerdown',resume); addEventListener('keydown',resume);
    const len=c.sampleRate*2, b=c.createBuffer(1,len,c.sampleRate), d=b.getChannelData(0);
    for (let i=0;i<len;i++) d[i]=Math.random()*2-1; this.noiseBuf=b;
    this.verb=c.createConvolver(); const rl=c.sampleRate*1.3, rb=c.createBuffer(2,rl,c.sampleRate);
    for (let ch=0;ch<2;ch++){ const x=rb.getChannelData(ch); for (let i=0;i<rl;i++) x[i]=(Math.random()*2-1)*Math.pow(1-i/rl,3)*0.4; }
    this.verb.buffer=rb; this.verbSend.connect(this.verb); const vg=c.createGain(); vg.gain.value=0.25; this.verb.connect(vg); vg.connect(this.bus.guns);
    // decode imported sounds
    const data=window.SFX_DATA||{};
    for (const k in data){
      const bin=atob(data[k]), u=new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
      c.decodeAudioData(u.buffer).then(buf=>{ this.buf[k]=buf; }).catch(()=>{});
    }
    this.applyVolumes();
    Ambience.start();
  },
  applyVolumes(){
    if (this.ctx){ this.master.gain.value=Settings.master/100; this.sfx.gain.value=(Settings.sfx??100)/100; this.amb.gain.value=(Settings.ambience??45)/100*2;
      for (const k of CATS) this.bus[k].gain.value= k==='ambience' ? 0.5 : k==='reload' ? (Settings.guns??95)/100 : (Settings[k]??80)/100; }
    for (const k in this.music.els){ const e=this.music.els[k]; if (k===this.music.cur) e.volume=clamp((Settings.master/100)*(Settings.music/100),0,1); }
  },
  // where a sound is relative to the listener (camera)
  spatial(pos){
    if (!pos) return {g:1,pan:0};
    const cp=camera.position, dx=pos.x-cp.x, dz=pos.z-cp.z, dy=pos.y-cp.y, d=Math.sqrt(dx*dx+dy*dy+dz*dz);
    const yaw=Math.atan2(-dx,-dz)-P.yaw;
    return {g:1/(1+Math.max(0,d-2)*0.07), pan:clamp(-Math.sin(yaw),-1,1)*Math.min(1,d/4), d};
  },
  play(key, {pos=null, cat='guns', vol=1, rate=1, max=6, offset=0, loop=false, dur, pool, filter, send=0, hrtf=false}={}){
    if (!this.ctx || !this.buf[key]) return null;
    const v=this.voices[pool||key]||(this.voices[pool||key]=[]);
    const c=this.ctx, now=c.currentTime;
    // voice limit: the oldest voice fades out over 15 ms (never a hard cut)
    while (v.length>=max){ const old=v.shift(); try{ old.g.gain.cancelScheduledValues(now); old.g.gain.setTargetAtTime(0,now,0.005); old.s.stop(now+0.03); }catch(e){} }
    const s=c.createBufferSource(); s.buffer=this.buf[key]; s.playbackRate.value=rate; s.loop=loop;
    const sp=this.spatial(pos); if (sp.d>160) return null;
    const g=c.createGain(); let head=g;
    if (filter){ const f=c.createBiquadFilter(); f.type=filter.type; f.frequency.value=filter.f; if (filter.gain!==undefined) f.gain.value=filter.gain; f.connect(g); head=f; }
    let node=g;
    if (pos && hrtf && c.createPanner){ const F=AUDIO_TUNE.far, p=c.createPanner(); p.panningModel='HRTF'; p.distanceModel='inverse'; p.refDistance=F.ref; p.rolloffFactor=F.rolloff; p.maxDistance=400;
      p.positionX ? (p.positionX.value=pos.x, p.positionY.value=pos.y, p.positionZ.value=pos.z) : p.setPosition(pos.x,pos.y,pos.z); g.gain.value=vol; g.connect(p); node=p; }
    else { g.gain.value=vol*sp.g; if (pos && c.createStereoPanner){ const p=c.createStereoPanner(); p.pan.value=sp.pan; g.connect(p); node=p; } }
    s.connect(head); node.connect(this.bus[cat]);
    if (send>0){ const sg=c.createGain(); sg.gain.value=send; node.connect(sg); sg.connect(this.verbSend); if (cat==='guns') sg.connect(this.slapSend); }
    if (dur){ const end=now+dur/rate; g.gain.setValueAtTime(g.gain.value,Math.max(now,end-0.02)); g.gain.linearRampToValueAtTime(0,end); }   // no click at the cut
    s.start(0, offset, dur?dur+0.01:undefined);
    const rec={s,g}; v.push(rec); s.onended=()=>{ const i=v.indexOf(rec); if (i>=0) v.splice(i,1); };
    return rec;
  },
  stop(rec, fade=0.05){ if (!rec||!this.ctx) return; const t=this.ctx.currentTime; try{ rec.g.gain.setTargetAtTime(0,t,fade/3); rec.s.stop(t+fade); }catch(e){} },
  // ---------- synthesized helpers
  noise(t, dur, {f=1000,q=1,type='bandpass',gain=1,attack=0.002,cat='env',pan=0}={}){
    const c=this.ctx, s=c.createBufferSource(); s.buffer=this.noiseBuf; s.playbackRate.value=0.8+Math.random()*0.4;
    const fl=c.createBiquadFilter(); fl.type=type; fl.frequency.value=f; fl.Q.value=q;
    const g=c.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002,gain),t+attack); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    s.connect(fl); fl.connect(g); let n=g; if (pan && c.createStereoPanner){ const p=c.createStereoPanner(); p.pan.value=pan; g.connect(p); n=p; } n.connect(this.bus[cat]);
    s.start(t, Math.random()*1.5, dur+0.05);
  },
  tone(t, f0, f1, dur, {type='sine',gain=0.5,cat='env',pan=0}={}){
    const c=this.ctx, o=c.createOscillator(), g=c.createGain(); o.type=type;
    o.frequency.setValueAtTime(f0,t); o.frequency.exponentialRampToValueAtTime(Math.max(1,f1),t+dur);
    g.gain.setValueAtTime(gain,t); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    let n=g; if (pan && c.createStereoPanner){ const p=c.createStereoPanner(); p.pan.value=pan; g.connect(p); n=p; }
    o.connect(g); n.connect(this.bus[cat]); o.start(t); o.stop(t+dur+0.02);
  },
  // ---------- weapons (imported files)
  // suppressed shots are quieter, higher and shorter — never silent
  // ---- layered gunfire: crack (sample head, every shot) + body (low thump, every shot) + one shared tail per weapon
  pickVariant(id){ const T=AUDIO_TUNE[id], n=T.variants.length; let i; do { i=Math.floor(Math.random()*n); } while (n>1 && i===this['_lv'+id]); this['_lv'+id]=i; return T.variants[i]; },
  thump(t, f0, gain, dest){ const c=this.ctx, o=c.createOscillator(), g=c.createGain(); o.type='sine'; o.frequency.setValueAtTime(f0,t); o.frequency.exponentialRampToValueAtTime(f0*0.5,t+0.12);
    g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002,gain),t+0.004); g.gain.exponentialRampToValueAtTime(0.0001,t+0.16); o.connect(g); g.connect(dest); o.start(t); o.stop(t+0.18); },
  shot(id, {pos=null, suppressed=false, loud=1, rapid=false}={}){
    if (!this.ctx) return;
    const A=AUDIO_TUNE, T=rapid ? Object.assign({}, A.glock, A.switchG) : A[id]; if (!T) return;
    const c=this.ctx, t=c.currentTime, remote=!!pos;
    const [key,vr]=this.pickVariant(id);
    const rate=vr*(1+(Math.random()*2-1)*A.pitchRand)*(T.rate||1)*(suppressed?1.2:1);
    const dB=(Math.random()*2-1)*A.volRandDb, vol=Math.pow(10,dB/20)*loud*(suppressed?0.55:1);
    const d = remote ? this.spatial(pos).d : 0, farK = remote ? clamp(d/A.far.farDist,0,1) : 0;
    const lp = remote ? {type:'lowpass', f:lerp(A.far.lpNear, A.far.lpFar, farK)} : (rapid ? {type:'highshelf', f:T.bright, gain:5} : suppressed ? {type:'lowpass', f:2600} : null);
    // crack (+ the sample's own punch) — pooled, plays to its end
    this.play(key,{pos, rate, vol:T.crack*vol, max:A.pool, pool:id+'_crack', dur:suppressed?0.18:T.crackDur, filter:lp, hrtf:remote, send:remote?0.25+farK*0.6:0.12});
    // body: low thump (own shots only; distant shots lose their low end)
    if (!remote || d<25) this.thump(t, id==='sniper'?75:id==='shotgun'?65:id==='drako'||id==='ar15'?85:110, T.body*vol*(remote?0.4:1)*(suppressed?0.5:1), this.bus.guns);
    // tail: one voice per weapon, restarted (extended) by each shot; the last one rings out in full on release
    const tk=A.tailOffset[key]||0.1, tv=T.tail*vol*(remote?1+farK*(A.far.tailBoost-1):1)*(suppressed?0.4:1);
    this.play(key,{pos, rate:rate*0.98, vol:tv, max:1, pool:id+'_tail'+(remote?'_r':''), offset:tk, dur:remote||!rapid ? undefined : 0.35, filter:{type:'lowpass',f:remote?lerp(5000,1200,farK):5200}, hrtf:remote, send:0.35});
    // switch: quiet mechanical rattle while the trigger is held
    if (rapid && !remote) this.noise(t+0.005,0.025,{f:2800+Math.random()*600,q:5,gain:T.rattle,cat:'guns'});
  },
  // trigger released after a burst: let one full tail ring out
  triggerUp(id, rapid){ if (!this.ctx) return; const A=AUDIO_TUNE, T=rapid?Object.assign({},A.glock,A.switchG):A[id]; if (!T || !T.variants) return;
    const [key]=T.variants[0]; this.play(key,{rate:0.97, vol:T.tail*0.9, max:1, pool:id+'_tail', offset:A.tailOffset[key]||0.1, dur:A.releaseTail, filter:{type:'lowpass',f:4200}, send:0.45}); },
  lowAmmo(){ this.click(0,4200,AUDIO_TUNE.lowAmmoClick); },
  // Switch (full-auto) Glock: the imported burst recording plays while the trigger is held
  autoStart(pos){ if (!this.ctx || this.autoSrc) return; this.autoSrc=this.play('glock_auto',{pos,vol:0.85,max:1,loop:true,offset:0.05}); },
  autoStop(){ if (this.autoSrc){ this.stop(this.autoSrc,0.08); this.autoSrc=null; } },
  reload(id){ if (id==='shotgun') return this.shellReload(); const k={drako:'drako_reload',glock:'glock_reload',sniper:'sniper_reload',ar15:'ar_reload'}[id]; if (k) return this.play(k,{vol:0.9,max:1,cat:'reload'}); },
  // shotgun: shells pushed into the tube (short clicks), then the pump racks
  shellReload(){ if (!this.ctx) return null; const T=WEAPON_DEFS.shotgun.reloadTime; const ids=[];
    for (let i=0;i<5;i++) ids.push(setTimeout(()=>{ if (Arsenal.state==='reload') this.click(0,1500+Math.random()*300,0.2,'reload'); }, (0.25+i*0.42)*1000));
    ids.push(setTimeout(()=>{ if (Arsenal.state==='reload') this.pump(); }, T*0.78*1000));
    return {timers:ids}; },
  pump(pos){ return this.play('sg_pump',{pos, vol:0.95, max:2, cat:'reload', hrtf:!!pos}); },   // own channel: gunfire never cuts it
  click(t0=0, f=2500, g=0.25, cat='guns'){ if (!this.ctx) return; const t=this.ctx.currentTime+t0; this.noise(t,0.03,{f,q:3,gain:g,cat}); this.tone(t,f*0.6,f*0.3,0.03,{type:'square',gain:g*0.3,cat}); },
  dry(){ this.click(0,3200,0.25); },
  switchW(){ this.click(0,1400,0.2); this.click(0.12,2100,0.15); },
  bolt(){ this.click(0,1500,0.3); this.click(0.18,1900,0.3); },
  swing(){ if (!this.ctx) return; this.noise(this.ctx.currentTime,0.22,{f:1800,q:0.6,gain:0.35,attack:0.05,cat:'guns'}); },
  stab(){ if (!this.ctx) return; const t=this.ctx.currentTime; this.noise(t,0.12,{f:500,q:1,gain:0.6,cat:'hits'}); this.tone(t,220,90,0.1,{gain:0.3,cat:'hits'}); },
  // ---------- hits
  hitmarker(head){ this.play('hitmarker',{cat:'hits',vol:head?1:0.8,rate:head?1.35:1,max:3}); if (head && this.ctx) this.tone(this.ctx.currentTime,2400,1800,0.08,{type:'triangle',gain:0.15,cat:'hits'}); },
  hurt(){ if (!this.ctx) return; const t=this.ctx.currentTime; this.noise(t,0.12,{f:350,q:1,gain:0.5,cat:'hits'}); this.tone(t,140,80,0.16,{type:'sawtooth',gain:0.12,cat:'hits'}); },
  impact(pos){ if (!this.ctx) return; const s=this.spatial(pos); if (s.g<0.05) return; this.noise(this.ctx.currentTime,0.06,{f:3200,q:1,gain:0.18*s.g,cat:'hits',pan:s.pan}); },
  // ---------- movement
  // imported footstep recording: a random step from it, louder/faster for running, quiet when crouched
  step(kind, pos, side){
    if (!this.ctx) return;
    const now=this.ctx.currentTime; if (now-(this._lastStep||0)<0.12) return; this._lastStep=now;   // one sound per contact
    const vol={walk:0.32,run:0.7,sprint:0.95,crouch:0.16}[kind], rate={walk:0.97,run:1.03,sprint:1.08,crouch:0.93}[kind]*(0.96+Math.random()*0.08);
    const surf=surfaceUnderPlayer(), SF={asphalt:{f:{type:'lowpass',f:5200},r:1,v:1}, concrete:{f:{type:'highshelf',f:2500,gain:4},r:1.06,v:1.05}, grass:{f:{type:'lowpass',f:1500},r:0.9,v:0.75}, metal:{f:{type:'peaking',f:2300,gain:9},r:1.1,v:1.1}}[surf];
    if (surf==='grass') this.noise(now,0.12,{f:2600,q:0.7,gain:0.05*vol,cat:'steps'});                 // grass rustle
    if (surf==='metal') this.tone(now,780+Math.random()*80,700,0.12,{type:'triangle',gain:0.04*vol,cat:'steps'});   // hollow ring
    if (this.buf.steps){
      // alternate between onsets taken from the left/right halves of the recording so consecutive steps differ
      const half=side==='L'?0:1, pool=STEP_ONSETS.filter((_,i)=>i%2===half), o=pool[Math.floor(Math.random()*pool.length)];
      const r=this.play('steps',{pos,cat:'steps',vol:vol*SF.v,rate:rate*SF.r,max:3,offset:Math.max(0,o-0.02),dur:kind==='walk'?0.24:0.2,filter:SF.f,send:0.15});
      if (r && side) { try{ const p=this.ctx.createStereoPanner(); r.g.disconnect(); r.g.connect(p); p.pan.value=side==='L'?-0.12:0.12; p.connect(this.bus.steps); }catch(e){} }
      return; }
    const s=this.spatial(pos), t=this.ctx.currentTime; this.noise(t,0.06,{f:330+Math.random()*160,q:1.4,gain:0.2*vol*s.g,cat:'steps',pan:s.pan});
  },
  // fence climb: metallic chain-link rattle (synthesized; no rattle file was supplied)
  rattle(){ if (!this.ctx) return;
    // imported fence-jump recording holds three different rattles: pick one, never the same twice in a row
    if (this.buf.fence){ const opts=[0.03,0.45,0.91]; let i; do { i=Math.floor(Math.random()*3); } while (i===this._lastFence && Math.random()<0.9); this._lastFence=i;
      this.play('fence',{cat:'env',vol:1.0,rate:0.97+Math.random()*0.06,max:2,offset:opts[i],dur:0.44}); return; }
    const t=this.ctx.currentTime; for (let i=0;i<9;i++){ this.noise(t+i*0.045+Math.random()*0.02,0.09,{f:3000+Math.random()*2500,q:6,gain:0.16*(1-i/10),cat:'env'}); } this.noise(t,0.5,{f:1600,q:3,gain:0.08,attack:0.02,cat:'env'}); },
  hover(){ this.uiSfx('hover'); },
  install(){ if (!this.ctx) return; const t=this.ctx.currentTime; this.noise(t,0.05,{f:2600,q:4,gain:0.25,cat:'ui'}); this.tone(t+0.05,900,500,0.06,{type:'square',gain:0.05,cat:'ui'}); this.noise(t+0.09,0.04,{f:3800,q:5,gain:0.2,cat:'ui'}); },
  land(){ if (!this.ctx) return; const t=this.ctx.currentTime; this.noise(t,0.12,{f:220,q:1,gain:0.3,cat:'steps'}); },
  slideStart(){ this.slideStop(); this.slideSrc=this.play('slide',{cat:'steps',vol:0.9,max:1}); },
  slideStop(){ if (this.slideSrc){ this.stop(this.slideSrc,0.25); this.slideSrc=null; } },
  // breathing loop: volume follows exhaustion, never restarted while it is already playing
  breath(level){
    if (!this.ctx || !this.buf.breath) return;
    if (level>0.02 && !this.breathSrc){ this.breathSrc=this.play('breath',{cat:'breath',vol:0,max:1,loop:true}); }
    if (this.breathSrc){ this.breathSrc.g.gain.setTargetAtTime(level*0.9, this.ctx.currentTime, 0.4);
      if (level<=0.02){ const b=this.breathSrc; this.breathSrc=null; this.stop(b,1.2); } }
  },
  cough(){ if (!this.ctx) return; const t=this.ctx.currentTime; for (let i=0;i<3;i++){ this.noise(t+i*0.32,0.2,{f:600+Math.random()*200,q:0.9,gain:0.45,attack:0.01,cat:'env'}); this.tone(t+i*0.32,180,110,0.15,{type:'sawtooth',gain:0.08,cat:'env'}); } },
  // Nic hit: button click + short draw + exhale (synthesized; no Nic sound file was supplied)
  vape(){ if (!this.ctx) return; const t=this.ctx.currentTime; this.noise(t+0.35,0.03,{f:3500,q:6,gain:0.2,cat:'env'}); this.noise(t+0.4,0.55,{f:2400,q:0.6,gain:0.12,attack:0.15,cat:'env'}); this.noise(t+1.05,0.7,{f:900,q:0.5,gain:0.13,attack:0.05,cat:'env'}); },
  // Blood Hound activation: low hit + rising growl
  bloodhound(){ if (!this.ctx) return; const t=this.ctx.currentTime; this.tone(t,70,40,0.6,{type:'sawtooth',gain:0.35,cat:'env'}); this.noise(t,0.4,{f:180,q:1,gain:0.5,cat:'env'}); this.tone(t+0.1,110,220,0.8,{type:'square',gain:0.06,cat:'env'}); },
  inhale(){ if (!this.ctx) return; const t=this.ctx.currentTime; this.noise(t,1.1,{f:1200,q:0.4,gain:0.15,attack:0.6,cat:'env'}); this.noise(t+1.4,1.2,{f:700,q:0.4,gain:0.12,attack:0.1,cat:'env'}); },
  // ---------- world / equipment
  explosion(pos){ if (!this.ctx) return; const s=this.spatial(pos), t=this.ctx.currentTime; this.noise(t,1.4,{f:180,q:0.5,type:'lowpass',gain:1.0*Math.max(0.15,s.g),cat:'env',pan:s.pan}); this.tone(t,90,30,0.6,{gain:0.8*s.g,cat:'env'}); this.noise(t,0.3,{f:1500,q:0.5,gain:0.5*s.g,cat:'env',pan:s.pan}); },
  flashBang(pos){ if (!this.ctx) return; const s=this.spatial(pos), t=this.ctx.currentTime; this.noise(t,0.5,{f:2500,q:0.4,gain:0.9*Math.max(0.2,s.g),cat:'env',pan:s.pan}); this.tone(t,140,40,0.3,{gain:0.6*s.g,cat:'env'}); },
  ring(strength){ if (!this.ctx || strength<0.1) return; const t=this.ctx.currentTime; const c=this.ctx, o=c.createOscillator(), g=c.createGain(); o.frequency.value=3900; g.gain.setValueAtTime(0.12*strength,t); g.gain.exponentialRampToValueAtTime(0.0001,t+2.5*strength+0.3); o.connect(g); g.connect(this.bus.env); o.start(t); o.stop(t+3); },
  bounce(pos){ if (!this.ctx) return; const s=this.spatial(pos); this.click(0,900,0.2*s.g,'env'); },
  mineArm(){ if (!this.ctx) return; const t=this.ctx.currentTime; this.tone(t,1200,1200,0.06,{type:'square',gain:0.08,cat:'env'}); this.tone(t+0.12,1600,1600,0.06,{type:'square',gain:0.08,cat:'env'}); },
  // drawn sounds for the items (no recordings were supplied for beer / Zyn / scooter bell)
  levelUp(){ if (!this.ctx) return; const t=this.ctx.currentTime; [523,659,784,1047].forEach((f,i)=>this.tone(t+i*0.09,f,f,0.22,{type:'triangle',gain:0.12,cat:'ui'})); },
  canOpen(){ if (!this.ctx) return; const t=this.ctx.currentTime; this.click(0,2200,0.25,'env'); this.noise(t+0.03,0.32,{f:5200,q:0.8,type:'highpass',gain:0.35,cat:'env'}); },
  gulps(n){ if (!this.ctx) return; const t=this.ctx.currentTime; for (let i=0;i<n;i++){ this.tone(t+i*0.42,260,140,0.13,{gain:0.22,cat:'env'}); this.noise(t+i*0.42,0.1,{f:420,q:2,gain:0.25,cat:'env'}); } },
  zynTin(){ if (!this.ctx) return; const t=this.ctx.currentTime; this.click(0,3000,0.2,'env'); this.click(0.08,2400,0.15,'env'); this.noise(t+0.15,0.05,{f:1800,q:3,gain:0.12,cat:'env'}); },
  door(){ if (!this.ctx) return; const t=this.ctx.currentTime; this.noise(t,0.25,{f:500,q:1,gain:0.35,cat:'vehicles'}); this.click(0.2,700,0.3,'vehicles'); },
  rummage(){ if (!this.ctx) return; if (this.buf.trunk){ this.play('trunk',{cat:'env',vol:1,max:1}); return; }   // imported trunk recording cut to the 1.6 s search
 const t=this.ctx.currentTime; for (let i=0;i<5;i++) this.noise(t+i*0.22,0.15,{f:900+Math.random()*900,q:0.8,gain:0.18,cat:'vehicles'}); },
  ui(){ this.uiSfx('click'); },
  // windows: a dull tick when a pane cracks, a bright crash + tinkles when it shatters (distance-attenuated)
  _glassGain(pos){ const d=pos&&typeof camera!=='undefined'?camera.position.distanceTo(pos):5; return Math.max(0.05, Math.min(1, 6/(d+1))); },
  glassHit(pos){ if (!this.ctx) return; const t=this.ctx.currentTime, g=this._glassGain(pos); this.noise(t,0.05,{f:3800,q:6,gain:0.35*g,cat:'hits'}); this.tone(t,2400,1800,0.04,{type:'triangle',gain:0.06*g,cat:'hits'}); },
  glassBreak(pos){ if (!this.ctx) return; const t=this.ctx.currentTime, g=this._glassGain(pos);
    this.noise(t,0.25,{f:5200,q:0.7,type:'highpass',gain:0.75*g,cat:'hits'}); this.noise(t,0.12,{f:1800,q:1.2,gain:0.35*g,cat:'hits'});
    for (let i=0;i<7;i++){ const dt=0.05+Math.random()*0.45, f=3000+Math.random()*4500; this.tone(t+dt,f,f*0.92,0.06,{type:'sine',gain:(0.05+Math.random()*0.05)*g,cat:'hits'}); } },
  /* Interface sounds: a different short sound per kind of interaction, all on the 'ui' bus (Settings → Audio → Interface).
     Throttled: the same kind can't retrigger within 45 ms and at most 4 interface sounds start in any 150 ms window,
     so fast clicking or sweeping the mouse over a list never stacks into a loud burst. */
  uiSfx(kind){
    if (!this.ctx || (Settings.ui??80)<=0) return;
    if (kind==='hover' && Settings.uiHover===false) return;
    const c=this.ctx, t=c.currentTime, L=this._uiLast||(this._uiLast={}), W=this._uiWin||(this._uiWin=[]);
    if (t-(L[kind]||-1) < (kind==='hover'?0.06:0.045)) return;
    while (W.length && t-W[0]>0.15) W.shift(); if (W.length>=4) return;
    L[kind]=t; W.push(t);
    const N=(dt,dur,o)=>this.noise(t+dt,dur,Object.assign({cat:'ui'},o)), T=(dt,f0,f1,dur,o)=>this.tone(t+dt,f0,f1,dur,Object.assign({cat:'ui'},o));
    switch(kind){
      case 'hover':   T(0,2100,1900,0.018,{type:'triangle',gain:0.022}); N(0,0.012,{f:6500,q:8,gain:0.018}); break;                 // faint tick
      case 'click':   N(0,0.025,{f:3200,q:6,gain:0.11}); T(0,1200,780,0.04,{gain:0.07}); break;                                         // crisp tock
      case 'select':  T(0,900,900,0.035,{type:'triangle',gain:0.055}); T(0.035,1350,1350,0.045,{type:'triangle',gain:0.05}); break;      // two-step blip
      case 'char':    N(0,0.13,{f:1800,q:1.5,gain:0.05,attack:0.04}); T(0.02,660,700,0.12,{gain:0.06}); T(0.07,990,1000,0.16,{gain:0.05}); break;   // soft whoosh + chime
      case 'weapon':  N(0,0.03,{f:2400,q:10,gain:0.14}); T(0,380,300,0.05,{type:'square',gain:0.025}); N(0.055,0.022,{f:5200,q:12,gain:0.09}); break; // metal clack + bolt
      case 'buy':     T(0,1046,1046,0.11,{type:'triangle',gain:0.07}); T(0.075,1568,1568,0.16,{type:'triangle',gain:0.07}); N(0.075,0.08,{f:7000,q:15,gain:0.05}); break; // register chime
      case 'deny':    T(0,220,200,0.09,{type:'square',gain:0.032}); T(0.11,196,180,0.12,{type:'square',gain:0.032}); break;            // low double buzz
      case 'back':    T(0,760,520,0.07,{type:'triangle',gain:0.065}); N(0,0.03,{f:1800,q:4,gain:0.05}); break;                          // falling blip
      case 'open':    T(0,420,900,0.13,{gain:0.045}); N(0,0.12,{f:2200,q:1.2,gain:0.035,attack:0.06}); break;                           // rising swish
      case 'close':   T(0,900,420,0.12,{gain:0.04}); N(0,0.1,{f:1600,q:1.2,gain:0.03,attack:0.02}); break;                             // falling swish
      case 'confirm': T(0,523,523,0.2,{type:'triangle',gain:0.06}); T(0,784,784,0.2,{type:'triangle',gain:0.05}); T(0,150,55,0.16,{gain:0.14}); N(0,0.05,{f:900,q:1,gain:0.06}); break; // chord + thump
      default:        N(0,0.025,{f:3200,q:6,gain:0.1});
    }
  },
  thunder(delay){ if (!this.ctx) return; const t=this.ctx.currentTime+delay; this.noise(t,3.5,{f:120,q:0.5,type:'lowpass',gain:0.9,attack:0.15,cat:'env'}); this.noise(t+0.3,2.5,{f:300,q:0.6,type:'lowpass',gain:0.4,attack:0.05,cat:'env'}); },
  setRain(on, level=1){
    if (!this.ctx) return;
    if (on && !this.rain){ const c=this.ctx, s=c.createBufferSource(); s.buffer=this.noiseBuf; s.loop=true;
      const f=c.createBiquadFilter(); f.type='bandpass'; f.frequency.value=2500; f.Q.value=0.4;
      const g=c.createGain(); g.gain.value=0; s.connect(f); f.connect(g); g.connect(this.bus.env); s.start(); this.rain={s,g}; }
    if (this.rain) this.rain.g.gain.setTargetAtTime(on?0.22*level:0, this.ctx.currentTime, 1.5);
    if (!on && this.rain){ const r=this.rain; this.rain=null; setTimeout(()=>{ try{r.s.stop();}catch(e){} }, 6000); }
  },
  // ---------- space: the slapback / reverb follow the surroundings (open street vs. close to walls)
  spaceT:0,
  updateSpace(dt){
    if (!this.ctx || !this.slap) return; this.spaceT-=dt; if (this.spaceT>0) return; this.spaceT=0.4;
    const o=new V3(P.pos.x,P.pos.y+1.5,P.pos.z); let dmin=60, open=0;
    for (let i=0;i<8;i++){ const a=i/8*PI*2, d=new V3(Math.cos(a),0,Math.sin(a)), h=raycastWorld(o,d,40); const dd=h.hit?h.dist:40; dmin=Math.min(dmin,dd); if (dd>25) open++; }
    open/=8; const t=this.ctx.currentTime;
    this.slap.delayTime.setTargetAtTime(clamp(2*Math.max(dmin,4)/343,0.025,0.22),t,0.3);           // echo off the nearest wall
    this.slapFb.gain.setTargetAtTime(lerp(0.32,0.1,open),t,0.4);
    this.slapWet.gain.setTargetAtTime(lerp(0.3,0.16,open),t,0.4);
    this.verbSend.gain.setTargetAtTime(lerp(0.65,0.3,open),t,0.4);                                  // tighter room near buildings, drier in the open
  },
  updateListener(){
    if (!this.ctx) return; const L=this.ctx.listener, p=camera.position, f=new V3(); camera.getWorldDirection(f);
    if (L.positionX){ L.positionX.value=p.x; L.positionY.value=p.y; L.positionZ.value=p.z; L.forwardX.value=f.x; L.forwardY.value=f.y; L.forwardZ.value=f.z; L.upX.value=0; L.upY.value=1; L.upZ.value=0; }
    else { L.setPosition(p.x,p.y,p.z); L.setOrientation(f.x,f.y,f.z,0,1,0); }
  },
  // ---------- music: imported tracks, streamed from data URLs, crossfaded, never overlapping
  playMusic(name){
    const data=(window.MUSIC_DATA||{})[name];
    if (this.music.cur===name) return;
    const prev=this.music.cur; this.music.cur=name;
    if (prev && this.music.els[prev]) this.fadeEl(this.music.els[prev],0,()=>{ this.music.els[prev].pause(); });
    if (!data) return; // track script not loaded yet: retried by loadMusic()
    let e=this.music.els[name];
    if (!e){ e=new window.Audio('data:audio/mpeg;base64,'+data); e.loop=true; e.volume=0; this.music.els[name]=e; }
    e.play().catch(()=>{});
    this.fadeEl(e, clamp((Settings.master/100)*(Settings.music/100),0,1));
  },
  fadeEl(e, to, done){ clearInterval(e._f); const from=e.volume, t0=performance.now();
    e._f=setInterval(()=>{ const k=Math.min(1,(performance.now()-t0)/1200); e.volume=clamp(lerp(from,to,k),0,1); if (k>=1){ clearInterval(e._f); done&&done(); } },50); },
};
function loadMusic(){
  for (const n of ['song_menu','song_game']){
    const s=document.createElement('script'); s.src='assets/'+n+'.js';
    s.onload=()=>{ if (Snd.music.cur===n){ Snd.music.cur=null; Snd.playMusic(n); } };
    document.body.appendChild(s);
  }
}

/* City ambience (no ambience files were supplied, so it is synthesized):
   traffic rumble bed, wind gusts, and occasional distant sirens, horns and voices,
   placed around the edges of the map and quieter in the enclosed courtyard. */
const Ambience = {
  bed:null, t:5,
  start(){
    const c=Snd.ctx; if (!c || this.bed) return;
    const s=c.createBufferSource(); s.buffer=Snd.noiseBuf; s.loop=true;
    const f=c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=260;
    const g=c.createGain(); g.gain.value=0.12; s.connect(f); f.connect(g); g.connect(Snd.bus.ambience); s.start();
    this.bed={s,g};
  },
  update(dt, inMenu){
    const c=Snd.ctx; if (!c || !this.bed) return;
    const p=inMenu?{x:0,z:0}:P.pos, open=clamp(Math.hypot(p.x+7,p.z+6)/60,0.35,1);   // courtyard is sheltered
    this.bed.g.gain.setTargetAtTime(0.13*open, c.currentTime, 1);
    this.t-=dt; if (this.t>0) return; this.t=rr(5,14);
    const a=Math.random()*PI*2, pan=Math.sin(a)*0.8, t=c.currentTime, k=Math.random();
    if (k<0.3){ // distant siren
      const o=c.createOscillator(), g=c.createGain(), p2=c.createStereoPanner(); o.type='triangle';
      for (let i=0;i<8;i++){ o.frequency.setValueAtTime(700,t+i*0.6); o.frequency.linearRampToValueAtTime(1100,t+i*0.6+0.3); o.frequency.linearRampToValueAtTime(700,t+i*0.6+0.6); }
      g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.025,t+1.2); g.gain.exponentialRampToValueAtTime(0.0001,t+5);
      p2.pan.value=pan; o.connect(g); g.connect(p2); p2.connect(Snd.bus.ambience); o.start(t); o.stop(t+5.1);
    } else if (k<0.42){ // dog barking somewhere in the block
      for (let i=0;i<2+Math.floor(Math.random()*3);i++){ const tt=t+i*0.32; Snd.noise(tt,0.11,{f:650,q:2.5,gain:0.06,attack:0.01,cat:'ambience',pan}); Snd.tone(tt,420,300,0.1,{type:'sawtooth',gain:0.018,cat:'ambience',pan}); }
    } else if (k<0.52){ // bird
      for (let i=0;i<3;i++) Snd.tone(t+i*0.14,3200+Math.random()*600,2400,0.08,{type:'sine',gain:0.02,cat:'ambience',pan});
    } else if (k<0.6 && Snd.buf.fence){ // somebody climbing a chain-link fence far away
      const r=Snd.play('fence',{cat:'ambience',vol:0.12,rate:0.95,max:1,offset:[0.03,0.45,0.91][Math.floor(Math.random()*3)],dur:0.44,filter:{type:'lowpass',f:2500}});
    } else if (k<0.68){ // horn
      Snd.tone(t,392,390,0.35,{type:'sawtooth',gain:0.02,cat:'ambience',pan}); Snd.tone(t,494,492,0.35,{type:'sawtooth',gain:0.015,cat:'ambience',pan});
    } else if (k<0.8){ // wind gust
      Snd.noise(t,3,{f:500,q:0.3,gain:0.08,attack:1.2,cat:'ambience',pan});
    } else { // distant voices (murmur)
      for (let i=0;i<4;i++) Snd.noise(t+i*0.25,0.2,{f:500+Math.random()*400,q:4,gain:0.025,attack:0.05,cat:'ambience',pan});
    }
  },
};
