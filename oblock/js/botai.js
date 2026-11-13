'use strict';
/* Bot AI: navigation grid + A*, perception (FOV, line of sight, hearing, memory), a state machine
   (patrol / investigate / engage / cover+peek / flank / chase / search / retreat), real weapon use
   (ammo, reload, bursts, recoil, falloff, wall checks) and staggered, budgeted updates.
   Free-for-all: bots fight the player and each other. Tuning lives in BOT_TUNE / DIFFICULTY / PERSONALITY. */

const BOT_TUNE = {
  respawnDelay:5,                 // s after death before a bot re-enters the match
  minSpawnFromPlayer:25,          // m
  viewDist:{glock:45, drako:60, sniper:95, ar15:70, shotgun:32, knife:40},
  fov:120,                        // degrees (bots still notice anyone within closeAware)
  closeAware:4,
  hearRange:{normal:40, suppressed:12},
  memory:6,                       // s a bot remembers a target's last known position
  pathBudgetPerFrame:1,           // A* searches per frame (all bots)
  losBudgetPerFrame:8,            // line-of-sight raycasts per frame (all bots)
  farDist:60,                     // beyond this from the camera: slower thinking + animation
  speeds:{walk:1.6, run:3.7, sprint:5.3, crouch:1.3},
  meleeRange:2.0, knifeSwitch:3.2,
  pref:{glock:[0,18], drako:[8,38], sniper:[25,95], ar15:[6,45], shotgun:[0,10]},   // preferred engagement band per weapon (m)
};
const DIFFICULTY = {
  easy:  {recoilCtl:1.3, react:[0.7,1.1], think:0.5, aimErr:0.075, aimSettle:2.5, leadK:0.2, coverUse:0.25, flank:0.0, hearMul:0.7, burstMul:1.4, retreatHp:20, strafe:0.3},
  normal:{recoilCtl:1.0, react:[0.38,0.6], think:0.33, aimErr:0.045, aimSettle:4,  leadK:0.6, coverUse:0.55, flank:0.25, hearMul:1.0, burstMul:1.0, retreatHp:30, strafe:0.6},
  hard:  {recoilCtl:0.6, react:[0.18,0.32], think:0.2, aimErr:0.025, aimSettle:7,  leadK:0.95, coverUse:0.85, flank:0.6, hearMul:1.35, burstMul:0.8, retreatHp:38, strafe:1.0},
};
const PERSONALITY = {
  aggressive:{push:1.0, coverMul:0.4, flankMul:0.5, holdMul:0.3, retreatMul:0.6, weapons:['glock','drako','shotgun','ar15']},
  defensive: {push:0.2, coverMul:1.5, flankMul:0.3, holdMul:1.6, retreatMul:1.3, weapons:['sniper','drako','sniper','ar15']},
  tactical:  {push:0.6, coverMul:1.1, flankMul:1.8, holdMul:0.8, retreatMul:1.0, weapons:['drako','sniper','ar15','shotgun']},
  balanced:  {push:0.6, coverMul:1.0, flankMul:1.0, holdMul:1.0, retreatMul:1.0, weapons:['glock','drako','sniper','ar15','shotgun']},
};
const BOT_NAMES = ['Lil Smoke','Dre','Kiko','Pooh','Bandz','Juju','Tre','Mookie','Scrappy','Nino','Lowkey','Boogie','Tay','Ghost','Rello','Fats','Duke','Slim','Zay','Monty'];

// ---------------------------------------------------------------- navigation grid (1 m cells, ground level)
const Nav = {
  N:180, off:90, cell:1, grid:null, cover:[], ready:false,
  idx(x,z){ const i=Math.floor(x+this.off), j=Math.floor(z+this.off); return (i<0||j<0||i>=this.N||j>=this.N)?-1:j*this.N+i; },
  ctr(k){ return [k%this.N-this.off+0.5, Math.floor(k/this.N)-this.off+0.5]; },
  build(){
    const N=this.N, g=this.grid=new Uint8Array(N*N), tall=new Uint8Array(N*N);
    // rasterise every collider that blocks a standing body at ground level (steps under STEP are walkable)
    for (const c of colliders){
      if (c.y0>=1.65 || c.y1<=STEP) continue;
      const r=c.br+0.4, i0=Math.max(0,Math.floor(c.cx-r+this.off)), i1=Math.min(N-1,Math.floor(c.cx+r+this.off));
      const j0=Math.max(0,Math.floor(c.cz-r+this.off)), j1=Math.min(N-1,Math.floor(c.cz+r+this.off));
      for (let j=j0;j<=j1;j++) for (let i=i0;i<=i1;i++){ const x=i-this.off+0.5, z=j-this.off+0.5;
        if (overlapXZ(c,x,z,0.42)){ g[j*N+i]=1; if (c.y1>1.25) tall[j*N+i]=1; } }
    }
    // doorways carved through (the walls either side keep their colliders, so bodies still collide with the frame)
    if (typeof NAV_PORTALS!=='undefined') for (const [x,z] of NAV_PORTALS){ const k=this.idx(x,z); if (k>=0){ g[k]=0; tall[k]=0; } }
    // map edge
    for (let k=0;k<N;k++){ g[k]=g[(N-1)*N+k]=g[k*N]=g[k*N+N-1]=1; }
    // cover cells: walkable cells next to a tall blocker
    this.cover=[];
    for (let j=2;j<N-2;j+=1) for (let i=2;i<N-2;i+=1){ const k=j*N+i; if (g[k]) continue;
      let wall=null; for (const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]) if (tall[k+di+dj*N]){ wall=[di,dj]; break; }
      if (wall && (i+j)%2===0) this.cover.push({k, x:i-this.off+0.5, z:j-this.off+0.5, wx:wall[0], wz:wall[1], used:null}); }
    this.ready=true;
  },
  walkable(x,z){ const k=this.idx(x,z); return k>=0 && !this.grid[k]; },
  nearestFree(x,z,maxR=6){
    if (this.walkable(x,z)) return [x,z];
    for (let r=1;r<=maxR;r++) for (let a=0;a<8*r;a++){ const t=a/(8*r)*PI*2, px=x+Math.cos(t)*r, pz=z+Math.sin(t)*r; if (this.walkable(px,pz)) return [px,pz]; }
    return null;
  },
  // straight walkable segment? (grid march)
  clear(ax,az,bx,bz){
    const d=Math.hypot(bx-ax,bz-az), n=Math.ceil(d/0.5);
    for (let s=1;s<=n;s++){ const t=s/n; if (!this.walkable(ax+(bx-ax)*t, az+(bz-az)*t)) return false; }
    return true;
  },
  // A* on the grid (8-connected, no corner cutting), node budget, then string-pulled
  path(ax,az,bx,bz, budget=6000){
    const N=this.N, g=this.grid; let s=this.idx(ax,az), e=this.idx(bx,bz);
    if (s<0||e<0) return null;
    if (g[s]){ const f=this.nearestFree(ax,az,3); if (!f) return null; s=this.idx(f[0],f[1]); }
    if (g[e]){ const f=this.nearestFree(bx,bz,6); if (!f) return null; e=this.idx(f[0],f[1]); }
    if (this.clear(ax,az,bx,bz)) return [[bx,bz]];
    const G=this._G||(this._G=new Float32Array(N*N)), from=this._F||(this._F=new Int32Array(N*N)), seen=this._S||(this._S=new Uint32Array(N*N));
    this.stamp=(this.stamp||0)+1; const st=this.stamp;
    const ex=e%N, ez=Math.floor(e/N), h=k=>{ const dx=Math.abs(k%N-ex), dz=Math.abs(Math.floor(k/N)-ez); return Math.max(dx,dz)+0.414*Math.min(dx,dz); };
    const heap=[], push=(k,f)=>{ heap.push([f,k]); let i=heap.length-1; while(i>0){ const p=(i-1)>>1; if (heap[p][0]<=heap[i][0]) break; [heap[p],heap[i]]=[heap[i],heap[p]]; i=p; } },
      pop=()=>{ const top=heap[0], last=heap.pop(); if (heap.length){ heap[0]=last; let i=0; for(;;){ const l=2*i+1, r=l+1; let m=i; if (l<heap.length&&heap[l][0]<heap[m][0]) m=l; if (r<heap.length&&heap[r][0]<heap[m][0]) m=r; if (m===i) break; [heap[m],heap[i]]=[heap[i],heap[m]]; i=m; } } return top[1]; };
    seen[s]=st; G[s]=0; from[s]=-1; push(s,h(s));
    let n=0, found=false, best=s, bestH=h(s);
    while (heap.length && n++<budget){
      const k=pop(); if (k===e){ found=true; break; }
      const kx=k%N, kz=Math.floor(k/N), hk=h(k); if (hk<bestH){ bestH=hk; best=k; }
      for (let dz=-1;dz<=1;dz++) for (let dx=-1;dx<=1;dx++){ if (!dx&&!dz) continue;
        const nx=kx+dx, nz=kz+dz; if (nx<0||nz<0||nx>=N||nz>=N) continue; const q=nz*N+nx; if (g[q]) continue;
        if (dx&&dz && (g[kz*N+nx]||g[nz*N+kx])) continue;
        const ng=G[k]+(dx&&dz?1.414:1);
        if (seen[q]!==st || ng<G[q]){ seen[q]=st; G[q]=ng; from[q]=k; push(q, ng+h(q)); } }
    }
    let k=found?e:best; if (k===s) return null;
    const pts=[]; while (k!==-1 && k!==s){ pts.push(this.ctr(k)); k=from[k]; } pts.reverse();
    if (found) pts[pts.length-1]=[bx,bz];
    // string pulling: skip waypoints while the straight line stays walkable
    const out=[]; let cx=ax, cz=az, i=0;
    while (i<pts.length){ let j=pts.length-1; while (j>i && !this.clear(cx,cz,pts[j][0],pts[j][1])) j--; out.push(pts[j]); cx=pts[j][0]; cz=pts[j][1]; i=j+1; }
    return out;
  },
  randomPoint(){ for (let t=0;t<40;t++){ const x=rr(-80,80), z=rr(-80,80); if (this.walkable(x,z) && this.walkable(x+0.8,z) && this.walkable(x,z+0.8) && this.walkable(x-0.8,z) && this.walkable(x,z-0.8)) return [x,z]; } return [-13,15]; },
};

// ---------------------------------------------------------------- per-frame budgets
const Budget = { los:0, path:0, reset(){ this.los=BOT_TUNE.losBudgetPerFrame; this.path=BOT_TUNE.pathBudgetPerFrame; } };

// ---------------------------------------------------------------- shared helpers
function eyeOf(t){ return t===P ? new V3(P.pos.x, P.pos.y+P.height-0.12, P.pos.z) : new V3(t.pos.x, t.pos.y+(t.crouch?1.05:1.55), t.pos.z); }
function chestOf(t){ return t===P ? new V3(P.pos.x, P.pos.y+Math.max(0.35,P.height*0.65), P.pos.z) : new V3(t.pos.x, t.pos.y+(t.crouch?0.8:1.15), t.pos.z); }
function velOf(t){ return t===P ? P.vel : (t.vel||new V3()); }
function aliveT(t){ return t===P ? (P.alive && Game.state==='playing' && !P.inCar) : t.alive; }
function nameOfT(t){ return t===P ? 'YOU' : t.name; }
// player hit volume for bot bullets (head sphere + body spheres following stance)
function playerRayHit(o,dir,maxT){
  const h=P.height; let best=maxT, head=false, any=false;
  const t=raySphere(o,dir,new V3(P.pos.x,P.pos.y+h-0.12,P.pos.z),0.13,best); if (t>=0){ best=t; head=true; any=true; }
  for (const f of [0.18,0.38,0.58,0.76]){ const t2=raySphere(o,dir,new V3(P.pos.x,P.pos.y+h*f,P.pos.z),0.22,best); if (t2>=0 && t2<best){ best=t2; head=false; any=true; } }
  return any ? {t:best, head} : null;
}
function angleDiff(a,b){ let d=a-b; while(d>PI) d-=2*PI; while(d<-PI) d+=2*PI; return d; }

// ---------------------------------------------------------------- the bot
class Bot {
  constructor(i){
    this.i=i; this.kills=0; this.deaths=0; this.alive=false; this.pos=new V3(); this.vel=new V3(); this.yaw=0;
    this.carrying=false; this.blindT=0; this.lastSpawn=-1; this.alive=false;
    this.reroll(true);
  }
  // new identity: name, character model + colours, personality, primary weapon (on creation and on each respawn of the match)
  reroll(first){
    const used=new Set(Bots.list.filter(b=>b!==this).map(b=>b.name));
    if (first || !this.name){ const free=BOT_NAMES.filter(n=>!used.has(n)); this.name=(free.length?pick(free):'Bot '+(this.i+1)); }
    if (first){
      this.persona=pick(Object.keys(PERSONALITY));
      const look={char:pick(CHAR_ORDER), jacket:pick(JACKET_COLORS)[0], pants:pick(PANTS_COLORS)[0]};
      if (this.rig){ scene.remove(this.rig.root); }
      this.rig=buildCharacter(look); scene.add(this.rig.root); this.rig.root.visible=false; Thermal.tagBot(this.rig);
      this.label=makeLabel(); this.rig.root.add(this.label.s);
      this.pack=makeBagModel(); this.pack.visible=false; this.rig.bones.chest.add(this.pack); this.pack.position.set(0.12,-0.12,0.13); this.pack.rotation.set(0.1,PI,0.25); this.pack.scale.setScalar(0.9);
      this.knife=createWeapon('knife'); this.knife.model.visible=false; this.rig.weaponSlot.add(this.knife.model);
    }
    const P_=PERSONALITY[this.persona];
    this.setFirearm(Mode.cur==='backpack' ? 'glock' : pick(P_.weapons));
  }
  setFirearm(id){
    if (this.weapon) this.rig.weaponSlot.remove(this.weapon.model);
    this.fw=id; const cfg=STOCK_CONFIG(id);
    this.comp = WEAPON_SLOTS[id].includes('muzzle') && id!=='sniper' && Math.random()<0.25; if (this.comp) cfg.att.muzzle='compensator';
    this.cfg=cfg; this.weapon=createWeapon(id, cfg); this.rig.weaponSlot.add(this.weapon.model);
    this.auto = id==='glock' && Mode.allowSwitch() && this.persona==='aggressive';     // Switch only where the mode allows it
    this.def=weaponDef(id, this.auto, cfg);
    this.mag=this.def.mag; this.res=this.def.mag*3; this.useKnife=false;
  }
  get D(){ return DIFFICULTY[Settings.botDifficulty]||DIFFICULTY.normal; }
  get Pe(){ return PERSONALITY[this.persona]; }
  respawn(){
    const s=Bots.spawnPoint(this); this.pos.set(s[0],0,s[1]);
    const {ground}=probeVertical(s[0],s[1],1); this.pos.y=ground;
    this.vel.set(0,0,0); this.yaw=s[2]??rr(-PI,PI);
    if (this.weapon && this.fw!==(Mode.cur==='backpack'?'glock':this.fw)) this.setFirearm('glock');
    this.mag=this.def.mag; this.res=this.def.mag*3;
    this.abWas=false; StreakAuthority.spawn('bot'+this.i, this.rig.charId); this.hp=this.maxHp(); this.alive=true; this.deadT=0; this.rig.root.visible=true; this.carrying=false; this.blindT=0;
    this.state='patrol'; this.stateT=0; this.target=null; this.mem=null; this.seenT=0; this.reactT=0; this.aimErr=new V3();
    this.path=null; this.goal=null; this.thinkT=rr(0,0.3); this.losT=0; this.fireT=0; this.burst=0; this.bloom=0; this.kick=0;
    this.reloadT=0; this.swingT=0; this.crouch=false; this.strafe=0; this.strafeT=0; this.stuckT=0; this.lastPos=this.pos.clone(); this.lastHurt=-99;
    this.cover=null; this.peekT=0; this.heard=null; this.speed=0; this.moveDir=0; this.useKnife=false; this.showWeapon();
    this.label.s.visible=true; this.drawLabel();
  }
  drawLabel(){ const g=this.label.c.getContext('2d'); g.clearRect(0,0,128,36); g.fillStyle='rgba(0,0,0,.55)'; g.fillRect(4,2,120,32);
    const gc = this.team!==undefined && typeof GANGS!=='undefined' && GANGS[this.team] ? GANGS[this.team].col : null; if (gc){ g.fillStyle=gc; g.fillRect(4,2,4,32); }
    g.fillStyle=gc||'#ffcf3f'; g.font='bold 13px sans-serif'; g.textAlign='center'; g.fillText(this.name,64,15);
    g.fillStyle='#999'; g.font='9px sans-serif'; g.fillText('BOT',112,15);
    const k=this.hp/this.maxHp(); g.fillStyle='#333'; g.fillRect(14,21,100,7); g.fillStyle=StreakAuthority.hpMul('bot'+this.i)>1?'#ff5a4a':k>0.5?'#4fd06a':k>0.25?'#f0c03a':'#e04040'; g.fillRect(14,21,100*k,7); this.label.tex.needsUpdate=true; }
  maxHp(){ return 100*StreakAuthority.hpMul('bot'+this.i); }
  // character ability (Jeff: Triple Health, Cop: Double Damage): only after a 10-kill streak (same rules as players), used when a fight starts
  tryAbility(){ if (Net.inMatch){ const s=StreakAuthority.abilityState('bot'+this.i); if (this.netId && s.A && !s.active && s.ready && !this.abReq){ this.abReq=true; setTimeout(()=>this.abReq=false,3000); Net.send({t:'ability', id:this.netId}); } return; }
    const r=StreakAuthority.requestAbility('bot'+this.i, this); if (!r.ok) return; this.abWas=true; if (r.ability.hpMul){ this.hp*=r.ability.hpMul; if (this.rig) setSkiMask(this.rig,true); } this.drawLabel(); }
  showWeapon(){ this.weapon.model.visible=!this.useKnife; this.knife.model.visible=this.useKnife; }
  heldWeapon(){ return this.useKnife ? this.knife : this.weapon; }
  chest(){ return chestOf(this); }
  rayHit(o,dir,maxT){
    const hp=new V3(); this.rig.bones.head.getWorldPosition(hp); hp.y+=0.1;
    let best=maxT, head=false, any=false;
    const t=raySphere(o,dir,hp,0.13,best); if (t>=0){ best=t; head=true; any=true; }
    const hs=this.crouch?[0.3,0.6,0.88]:[0.3,0.62,0.95,1.25];
    for (const y of hs){ const t2=raySphere(o,dir,new V3(this.pos.x,this.pos.y+y,this.pos.z),0.21,best); if (t2>=0 && t2<best){ best=t2; head=false; any=true; } }
    return any ? {t:best, head} : null;
  }
  // attacker: P | Bot | null
  damage(n, head, by, dir, attacker){
    if (!this.alive) return;
    if (StreakAuthority.invulnerable('bot'+this.i)) return;
    this.hp=Math.max(0,this.hp-n); this.drawLabel(); this.lastHurt=performance.now()/1000;
    if (attacker===undefined || attacker===P){ Bus.emit('hit',{head, kill:this.hp<=0}); Snd.hitmarker(head); attacker=P; }
    // being shot: know roughly where it came from
    if (attacker && aliveT(attacker)){ this.mem={t:attacker, pos:attacker.pos.clone(), time:performance.now()/1000}; if (!this.target){ this.target=attacker; this.reactT=this.D.react[0]; } }
    if (this.hp<=0) this.die(by, dir, head, attacker);
  }
  die(by, dir, head, attacker){
    this.alive=false; this.deadT=0; this.deaths++; this.label.s.visible=false; this.blindT=0; this.target=null; this.path=null; this.mem=null;
    Corpses.spawn(this.rig, dir||new V3(0,0,1), {part:head?'head':null, vel:this.vel?new V3(this.vel.x||0,0,this.vel.z||0):null, force:attacker&&attacker.pos?clamp(14/Math.max(4,attacker.pos.distanceTo(this.pos)),0.8,1.6):1}); this.rig.root.visible=false;
    if (this.fw && !this.useKnife) Pickups.drop(this.pos, this.fw, Math.max(6,Math.min(this.def.mag, this.mag+this.res)));
    else Pickups.drop(this.pos, this.fw, this.def.mag);
    const killer = attacker===P ? 'player' : attacker ? attacker.i : null;
    Match.kill(killer, this.i, by, head);
    Mode.onDeath(this, this.pos);
  }
  // ------------------------------------------------ perception
  canPerceive(t, dist){
    if (!aliveT(t) || this.blindT>0) return false;
    const D=this.D, range=BOT_TUNE.viewDist[this.fw]*(t===P && (P.prone?0.55:P.crouch?0.8:1)||1);
    if (dist>range) return false;
    const to=Math.atan2(-(t.pos.x-this.pos.x), -(t.pos.z-this.pos.z));
    if (dist>BOT_TUNE.closeAware && Math.abs(angleDiff(to,this.yaw))>BOT_TUNE.fov*PI/360) return false;
    if (Budget.los<=0) return this.lastVis===t;          // out of raycast budget: keep last result
    Budget.los--;
    // remember which part is exposed, so shots go at something visible instead of into cover
    if (lineOfSight(eyeOf(this), chestOf(t))){ this.aimPart='chest'; return true; }
    if (lineOfSight(eyeOf(this), eyeOf(t))){ this.aimPart='head'; return true; }
    return false;
  }
  enemies(){ const out=[]; if (aliveT(P) && Settings.botsFire) out.push(P); for (const b of Bots.list) if (b!==this && b.alive) out.push(b); if (Net.inMatch) for (const e of Net.targets()) out.push(e);
    if (Net.gang){ const mine=Net.teamOf(this); return out.filter(t=>Net.teamOf(t)!==mine); }   // Gang Wars: never shoot your own gang
    return out; }
  perceive(){
    // nearest few candidates by distance, then FOV + line of sight
    const list=this.enemies().map(t=>[t, Math.hypot(t.pos.x-this.pos.x,t.pos.z-this.pos.z)]).sort((a,b)=>a[1]-b[1]).slice(0,3);
    let vis=null, vd=1e9;
    if (this.target && aliveT(this.target)){ const d=Math.hypot(this.target.pos.x-this.pos.x,this.target.pos.z-this.pos.z); if (this.canPerceive(this.target,d)){ vis=this.target; vd=d; } }
    if (!vis) for (const [t,d] of list){ if (t===this.target) continue; if (this.canPerceive(t,d)){ vis=t; vd=d; break; } }
    const now=performance.now()/1000;
    if (vis){
      if (vis!==this.lastVis){ this.reactT=rr(...this.D.react); this.aimErr.set(rr(-1,1),rr(-0.6,1),rr(-1,1)).multiplyScalar(this.D.aimErr*vd*1.6); }
      if (this.crouch && this.aimPart==='head') this.noCrouchT=4;         // crouched behind something low: stand up to get the body in view
      this.target=vis; this.mem={t:vis, pos:vis.pos.clone(), time:now}; this.seenT=now; this.seenFrom=[this.pos.x,this.pos.z];
    }
    this.lastVis=vis; this.visDist=vd;
    if (this.mem && (!aliveT(this.mem.t) || now-this.mem.time>BOT_TUNE.memory)){ this.mem=null; if (!vis) this.target=null; }
  }
  hear(pos, shooter, suppressed){
    if (!this.alive || shooter===this) return;
    const r=(suppressed?BOT_TUNE.hearRange.suppressed:BOT_TUNE.hearRange.normal)*this.D.hearMul, d=this.pos.distanceTo(pos);
    if (d>r) return;
    if (!this.lastVis && (this.state==='patrol'||this.state==='search'||this.state==='investigate')){
      this.heard={x:pos.x+rr(-3,3), z:pos.z+rr(-3,3)}; this.setState('investigate');
      if (Settings.botDifficulty!=='easy') this.yaw=Math.atan2(-(pos.x-this.pos.x),-(pos.z-this.pos.z));
    }
  }
  setState(s){ if (this.state!==s){ this.state=s; this.stateT=0; this.path=null; this.cover=null; } }
  // ------------------------------------------------ movement
  goTo(x,z){
    if (this.goal && Math.hypot(this.goal[0]-x,this.goal[1]-z)<1.5 && this.path) return true;
    if (Budget.path<=0) return false;
    Budget.path--; this.goal=[x,z]; this.path=Nav.path(this.pos.x,this.pos.z,x,z) || null; this.pathI=0;
    return !!this.path;
  }
  followPath(speed, dt, face){
    if (!this.path || this.pathI>=this.path.length){ this.speed=damp(this.speed,0,8,dt); return true; }
    const [tx,tz]=this.path[this.pathI]; let dx=tx-this.pos.x, dz=tz-this.pos.z; const d=Math.hypot(dx,dz);
    if (d<0.45){ this.pathI++; return this.pathI>=this.path.length; }
    this.speed=damp(this.speed,speed,6,dt);
    const step=Math.min(d,this.speed*dt); this.pos.x+=dx/d*step; this.pos.z+=dz/d*step;
    resolveHorizontal(this.pos, this.crouch?1.2:1.7, 0.35);
    const {ground}=probeVertical(this.pos.x,this.pos.z,this.pos.y+0.6); this.pos.y=ground;
    const moveYaw=Math.atan2(-dx,-dz);
    if (face===undefined) this.yaw+=angleDiff(moveYaw,this.yaw)*Math.min(1,dt*6);
    this.moveDir=angleDiff(moveYaw,this.yaw);
    // stuck: no progress for 1.2 s -> re-plan from here (or hop sideways)
    this.stuckT+=dt; if (this.stuckT>1.2){ if (this.pos.distanceTo(this.lastPos)<0.35*speed){ const g=this.goal; this.path=null; this.goal=null;
        if (g) this.goTo(g[0]+rr(-1.5,1.5),g[1]+rr(-1.5,1.5)); this.stuck=(this.stuck||0)+1; if (this.stuck>3){ const f=Nav.nearestFree(this.pos.x,this.pos.z,4); if (f){ this.pos.x=f[0]; this.pos.z=f[1]; } this.stuck=0; this.setState('patrol'); } }
      else this.stuck=0; this.lastPos.copy(this.pos); this.stuckT=0; }
    return false;
  }
  strafeStep(dt){
    // side-steps while fighting so the bot is not a still target
    this.strafeT-=dt; if (this.strafeT<=0){ this.strafeT=rr(0.6,1.4); this.strafe=Math.random()<this.D.strafe ? (Math.random()<0.5?-1:1) : 0; }
    if (!this.strafe) { this.speed=damp(this.speed,0,8,dt); return; }
    const sx=Math.cos(this.yaw)*this.strafe, sz=-Math.sin(this.yaw)*this.strafe, nx=this.pos.x+sx*0.6, nz=this.pos.z+sz*0.6;
    if (!Nav.walkable(nx,nz)){ this.strafe*=-1; return; }
    const v=BOT_TUNE.speeds[this.crouch?'crouch':'walk']*1.2; this.speed=damp(this.speed,v,6,dt);
    this.pos.x+=sx*this.speed*dt; this.pos.z+=sz*this.speed*dt; resolveHorizontal(this.pos, 1.7, 0.35);
    const {ground}=probeVertical(this.pos.x,this.pos.z,this.pos.y+0.6); this.pos.y=ground; this.moveDir=this.strafe*PI/2;
  }
  faceToward(x,z,dt,k=6){ const want=Math.atan2(-(x-this.pos.x),-(z-this.pos.z)); this.yaw+=angleDiff(want,this.yaw)*Math.min(1,dt*k); return Math.abs(angleDiff(want,this.yaw)); }
  // ------------------------------------------------ cover
  findCover(threat){
    let best=null, bs=1e9; const tp=eyeOf(threat); let checks=0;
    for (const c of Nav.cover){
      const d=Math.hypot(c.x-this.pos.x,c.z-this.pos.z); if (d>11 || d<1) continue;
      if (c.used && c.used!==this && c.used.alive) continue;
      // the wall must sit between the cover cell and the threat
      const tx=tp.x-c.x, tz=tp.z-c.z, tl=Math.hypot(tx,tz)||1; if ((tx*c.wx+tz*c.wz)/tl<0.5) continue;
      const s=d+Math.max(0,12-tl)*1.5 + Math.random()*2; if (s<bs){ bs=s; best=c; }
    }
    // verify the best few with a real occlusion test
    if (best && Budget.los>0){ Budget.los--; checks++; if (lineOfSight(tp,new V3(best.x,this.pos.y+1.1,best.z))) best=null; }
    if (best){ if (this.cover) this.cover.used=null; best.used=this; }
    return best;
  }
  flankPoint(t){
    const ax=this.pos.x-t.pos.x, az=this.pos.z-t.pos.z, D0=Math.hypot(ax,az), sn=this.fw==='sniper';
    const a=Math.atan2(az,ax)+(Math.random()<0.5?1:-1)*(sn?rr(0.25,0.5):rr(1.0,1.6)), r=sn?clamp(D0,28,60):rr(10,16);
    return Nav.nearestFree(t.pos.x+Math.cos(a)*r, t.pos.z+Math.sin(a)*r, 5);
  }
  // ------------------------------------------------ weapons
  reload(){ if (this.reloadT>0 || this.res<=0 || this.mag>=this.def.mag) return; this.reloadT=this.def.reloadTime||2.4; this.burst=0; if (Net.inMatch && this.netId) Net.send({t:'reload', id:this.netId}); }
  tryFire(t, dt){
    const d=this.def, now=performance.now()/1000;
    if (this.reloadT>0 || this.reactT>0 || !this.lastVis || this.lastVis!==t) return;
    if (this.useKnife){ if (this.visDist<BOT_TUNE.meleeRange && this.swingT<=0){ this.swingT=0.55;
        const kd=WEAPON_DEFS.knife; Snd.swing(); setTimeout(()=>{ if (!this.alive||!aliveT(t)) return; const dd=Math.hypot(t.pos.x-this.pos.x,t.pos.z-this.pos.z); if (Net.inMatch){ if (dd<BOT_TUNE.meleeRange+0.3 && this.netId){ this.fw0=this.fw; Net.send({t:'botshot', id:this.netId, w:'knife', o:[this.pos.x,this.pos.y,this.pos.z], hits:[{id:Net.netIdOf(t), d:+dd.toFixed(2)}]}); } return; } if (dd<BOT_TUNE.meleeRange+0.3) this.hitTarget(t, kd.dmg*StreakAuthority.dmgMul('bot'+this.i), false, 'knife', new V3(-Math.sin(this.yaw),0,-Math.cos(this.yaw))); },180); }
      return; }
    if (this.mag<=0){ this.reload(); return; }
    if (this.visDist>BOT_TUNE.viewDist[this.fw]*0.95) return;                // too far: don't waste ammo
    this.fireT-=dt; if (this.fireT>0) return;
    // aim before firing: wait for the aim to settle (snipers wait for a tighter picture)
    if (this.aimErr.length() > (this.fw==='sniper'?0.25:1.0)){ this.fireT=0.05; return; }
    // never fire into a wall: check the exact shot line first (stance may have changed since perception)
    { const o0=eyeOf(this); let ok=false;
      for (const part of [this.aimPart||'chest', this.aimPart==='head'?'chest':'head']){ if (lineOfSight(o0, part==='head'?eyeOf(t):chestOf(t))){ this.aimPart=part; ok=true; break; } }
      if (!ok){ if (this.crouch){ this.crouch=false; this.noCrouchT=4; } this.fireT=0.2; return; } }
    // shoot
    this.mag--; this.burst++; this.kick=1; this.bloom=Math.min(1,this.bloom+(this.fw==='sniper'?0.6:this.auto?0.12:0.18)*this.D.recoilCtl);
    const iv=60/(this.auto?d.rpm:Math.min(d.rpm, this.fw==='glock'?220:600)), B=this.D.burstMul;
    if (this.fw==='sniper') this.fireT=rr(1.3,2.0)*B;
    else if (this.fw==='shotgun') this.fireT=Math.max(d.pumpTime+0.1, rr(0.75,1.05)*B);
    else if (this.fw==='glock' && !this.auto) this.fireT=rr(0.22,0.4)*B;
    else { const bl=this.fw==='drako'?[3,6]:this.fw==='ar15'?[4,8]:[5,9]; if (this.burst>=Math.round(rr(...bl))){ this.burst=0; this.fireT=rr(0.3,0.6)*B; } else this.fireT=iv; }
    const mz=this.weapon.model.localToWorld(this.weapon.muzzle.clone()), o=eyeOf(this);
    // aim: lead the target, add difficulty error that shrinks as the bot settles, plus recoil bloom
    const tgt=(this.aimPart==='head'?eyeOf(t).add(new V3(0,-0.04,0)):chestOf(t)).addScaledVector(velOf(t), this.D.leadK*clamp(this.visDist/300,0,0.25));
    // per-shot scatter: difficulty error + recoil bloom + the bot's own movement, all growing with distance
    const still=this.speed<0.5, wsp=(still&&this.fw!=='glock'?d.spreadAds:d.spreadHip)||0;      // aimed rifles use the ADS spread, like the player
    const scat=this.D.aimErr*(this.fw==='sniper'&&still?0.12:0.55) + this.bloom*0.04 + Math.min(this.speed,4)*0.006 + wsp*0.4;
    tgt.add(this.aimErr).add(new V3(rr(-1,1),rr(-0.7,1),rr(-1,1)).multiplyScalar(scat*this.visDist));
    if (t===P && (P.slide||P.prone)) tgt.y-=0.2;
    const dir0=tgt.sub(o).normalize(), dm=StreakAuthority.dmgMul('bot'+this.i);
    // one ray per pellet for the shotgun (pellet spread around the aim), one ray otherwise; damage per target is summed
    const rays = d.pellets||1, per=new Map(); let end=null, world=null;
    for (let r=0;r<rays;r++){
      const dir=dir0.clone(); if (d.pellets){ const a=Math.random()*PI*2, k=d.pelletSpread*Math.sqrt(Math.random()), up=new V3(0,1,0), rt=new V3().crossVectors(dir,up).normalize(), u2=new V3().crossVectors(rt,dir); dir.addScaledVector(rt,Math.cos(a)*k).addScaledVector(u2,Math.sin(a)*k).normalize(); }
      const w=bulletRay(o,dir,d.range||200,d.dmg); let best=w.dist, who=null, head=false;
      const ph=aliveT(P)?playerRayHit(o,dir,best):null; if (ph){ best=ph.t; who=P; head=ph.head; }
      for (const b of Bots.list){ if (b===this||!b.alive) continue; const h=b.rayHit(o,dir,best); if (h){ best=h.t; who=b; head=h.head; } }
      const e=o.clone().addScaledVector(dir,best); if (r<3) FX.tracer(mz,e,'#ffb070'); if (r===0){ end=e; world=w; }
      if (who){ const q=per.get(who)||{dmg:0, head:false, dir, d:best}; q.dmg+=d.dmg*(head?d.headMul:1)*falloff(d,best); q.head=q.head||head; per.set(who,q); if (Net.inMatch) (per.claims=per.claims||[]).push({id:Net.netIdOf(who), head, d:+best.toFixed(2)}); }
      else if (w.hit && !w.glass && r%2===0){ FX.hole(w.point, w.normal); if (r===0) FX.puff(w.point,'#b8b0a0',0.2); }
    }
    Snd.shot(this.fw,{pos:mz, suppressed:d.suppressed, rapid:this.auto}); if (this.fw==='shotgun') setTimeout(()=>{ if (this.alive) Snd.pump(mz); },200);
    if (!d.noPing && !d.suppressed) Pings.add(this.pos);
    const wq=this.weapon.model.getWorldQuaternion(new THREE.Quaternion());
    if (!d.noFlash && !d.suppressed) MuzzleFlash.spawn('world', mz, wq, flashSpec(this.fw,this.auto), {scale:1});
    Casings.eject(this.fw, this.weapon.model.localToWorld(new V3(...CASING_TUNE.eject[this.fw])), wq, this.pos.y, true);
    Bots.hear(this.pos, this, d.suppressed);
    if (Net.inMatch){ if (this.netId) Net.botShot(this, this.fw, this.pos, per.claims||[], end); }    // online: the server validates and applies it
    else for (const [who,q] of per) this.hitTarget(who, Math.round(q.dmg*dm), q.head, this.fw, q.dir);
    if (this.mag<=0) this.reload();
  }
  hitTarget(t, dmg, head, wpn, dir){
    if (t===P) damagePlayer(dmg, this, dir, head);
    else t.damage(dmg, head, wpn, dir, this);
  }
  // ------------------------------------------------ brain (runs every think interval)
  think(){
    const D=this.D, Pe=this.Pe, t=this.target, now=performance.now()/1000;
    const lowHp=this.hp<D.retreatHp*Pe.retreatMul;
    const goal=Mode.botGoal(this);
    // weapon choice: knife up close (or when dry), firearm otherwise
    const near=this.lastVis ? this.visDist : 99;
    const wantKnife = (near<BOT_TUNE.knifeSwitch && this.fw!=='glock' && this.fw!=='shotgun') || (this.mag<=0 && this.res<=0);
    if (wantKnife!==this.useKnife){ this.useKnife=wantKnife; this.showWeapon(); }
    if (goal && goal.urgent && !this.lastVis){ this.setState('objective'); return; }
    if (lowHp && t && this.state!=='retreat' && Pe.retreatMul>0.5){ this.setState('retreat'); return; }
    if (this.state==='retreat'){ if (this.hp>70 || (!t && now-this.lastHurt>8)) this.setState(t?'engage':'patrol'); return; }
    if (this.lastVis){
      if (this.state==='patrol'||this.state==='investigate'||this.state==='search'||this.state==='objective'||this.state==='chase') this.setState('engage');
      if (this.visDist<40 && Math.random()<(Settings.botDifficulty==='easy'?0.15:0.4)) this.tryAbility();
      // only a head showing over cover for a while: relocate to a better angle
      this.headOnlyT = this.aimPart==='head' ? (this.headOnlyT||0)+D.think : 0;
      if (this.state==='engage' && this.headOnlyT>3*(Settings.botDifficulty==='easy'?2:1)){ this.headOnlyT=0; this.setState('flank'); return; }
      const sniperHold = this.fw==='sniper' && this.visDist>=BOT_TUNE.pref.sniper[0];      // snipers in range hold position (crouched) instead of relocating
      if (this.state==='engage' && this.stateT>1 && !sniperHold && Math.random()<D.coverUse*Pe.coverMul*0.35 && !this.useKnife){ this.setState('cover'); return; }
      if (this.state==='engage' && this.stateT>2 && Math.random()<D.flank*Pe.flankMul*0.25 && this.fw!=='sniper'){ this.setState('flank'); return; }
      return;
    }
    if (this.mem){
      if (this.state==='engage' && now-this.seenT<2.5) return;            // just lost sight: step back to where the shot was clear
      if (this.state==='engage'||this.state==='cover'){ this.setState(Pe.push>0.5 || Settings.botDifficulty==='hard' ? 'chase' : 'search'); }
      return;
    }
    if (this.state==='engage'||this.state==='chase'||this.state==='cover'||this.state==='flank') this.setState('search');
    if (this.state==='search' && this.stateT>6) this.setState('patrol');
    if (this.state==='investigate' && this.stateT>10) this.setState('patrol');
    if (goal && this.state==='patrol') this.setState('objective');
    if (this.mag<this.def.mag*0.5 && this.res>0) this.reload();          // tactical reload while calm
  }
  // ------------------------------------------------ per-frame update
  update(dt){
    if (!this.alive){ this.deadT+=dt; if (this.deadT>BOT_TUNE.respawnDelay && !Mode.ended && !Net.inMatch) this.respawn(); return; }   // online: the server respawns bots
    const camD=this.pos.distanceTo(camera.position), far=camD>(Settings.superPerf?22:Settings.perf||Settings.quality==='potato'?35:BOT_TUNE.farDist);
    this.blindT=Math.max(0,this.blindT-dt); this.stateT+=dt; this.reactT=Math.max(0,this.reactT-dt); this.swingT=Math.max(0,this.swingT-dt); this.noCrouchT=Math.max(0,(this.noCrouchT||0)-dt);
    this.bloom=Math.max(0,this.bloom-dt*1.8); this.kick=damp(this.kick,0,12,dt);
    this.aimErr.multiplyScalar(Math.exp(-this.D.aimSettle*dt*0.35));                  // aim settles on a held target
    if (this.reloadT>0){ this.reloadT-=dt; if (this.reloadT<=0){ const n=Math.min(this.def.mag-this.mag,this.res); this.mag+=n; this.res-=n; } }
    if (this.abWas && !StreakAuthority.abilityActive('bot'+this.i)){ this.abWas=false; const A=StreakAuthority.ability('bot'+this.i); if (A && A.hpMul){ this.hp=Math.max(1,this.hp/A.hpMul); if (this.rig) setSkiMask(this.rig,false); } this.drawLabel(); }
    if (performance.now()/1000-this.lastHurt>6 && this.hp<this.maxHp()){ this.hp=Math.min(this.maxHp(),this.hp+6*dt); if (Math.random()<dt*2) this.drawLabel(); }
    // perception + decisions are staggered and slower for distant bots
    this.thinkT-=dt;
    if (this.thinkT<=0){ this.thinkT=this.D.think*(far?2:1)*rr(0.85,1.15); if (Game.state==='playing') this.perceive(); this.think(); }
    this.speed=this.speed||0; let ads=false, firing=false, sprint=false;
    const t=this.target, st=this.state, S=BOT_TUNE.speeds;
    const pref=BOT_TUNE.pref[this.useKnife?'glock':this.fw];
    if (st==='engage' && t){
      const tp=t.pos; this.faceToward(tp.x,tp.z,dt,this.reactT>0?3:8); ads=this.fw!=='glock'&&!this.useKnife; firing=!!this.lastVis;
      const d=this.visDist;
      // keep the preferred range for the weapon; aggressive bots push, defensive hold
      if (this.useKnife || d>pref[1] || (this.Pe.push>0.8 && d>pref[0]+4)){ if (this.goTo(tp.x,tp.z) || this.path) this.followPath(this.useKnife?S.sprint:S.run*0.8, dt, true); }
      else if (d<pref[0] && this.fw==='sniper'){ const a=Math.atan2(this.pos.z-tp.z,this.pos.x-tp.x); const f=Nav.nearestFree(this.pos.x+Math.cos(a)*10,this.pos.z+Math.sin(a)*10,4); if (f && this.goTo(f[0],f[1])) this.followPath(S.run,dt,true); }
      else if (!this.lastVis && this.seenFrom){ if (!this.path) this.goTo(this.seenFrom[0],this.seenFrom[1]); this.followPath(S.walk*1.4,dt,true); }
      else if (this.fw==='sniper'){ this.speed=damp(this.speed,0,8,dt); }
      else this.strafeStep(dt);
      this.crouch = this.fw==='sniper' && d>BOT_TUNE.pref.sniper[0] && !!this.lastVis && !(this.noCrouchT>0);
      this.tryFire(t,dt);
    } else if (st==='cover' && t){
      if (!this.cover){ this.cover=this.findCover(t); if (!this.cover){ this.setState('engage'); } else { this.goTo(this.cover.x,this.cover.z); this.peekT=0; } }
      if (this.cover){
        const arrived=this.followPath(S.run,dt,true); this.faceToward(t.pos.x,t.pos.z,dt,6);
        if (arrived){
          // hold behind the wall (crouched, reloading) then peek out sideways to shoot
          this.peekT+=dt; const cyc=2.2*this.Pe.holdMul, ph=this.peekT%cyc;
          const peeking=ph>cyc*0.45;
          this.crouch=!peeking && !(this.noCrouchT>0);
          if (peeking){ const sx=Math.cos(this.yaw)*0.6*(this.i%2?1:-1), sz=-Math.sin(this.yaw)*0.6*(this.i%2?1:-1); if (Nav.walkable(this.cover.x+sx,this.cover.z+sz)){ this.pos.x=lerp(this.pos.x,this.cover.x+sx,dt*4); this.pos.z=lerp(this.pos.z,this.cover.z+sz,dt*4); } this.tryFire(t,dt); ads=true; firing=!!this.lastVis; }
          else { this.pos.x=lerp(this.pos.x,this.cover.x,dt*4); this.pos.z=lerp(this.pos.z,this.cover.z,dt*4); if (this.mag<this.def.mag*0.6) this.reload(); }
          if (this.stateT>8*this.Pe.holdMul) this.setState('engage');
        } else if (this.lastVis && this.fw!=='sniper') { this.tryFire(t,dt); firing=true; }
      }
    } else if (st==='flank' && t){
      if (!this.path && this.stateT<0.6){ const f=this.flankPoint(t); if (f) this.goTo(f[0],f[1]); else this.setState('engage'); }
      if (this.followPath(S.run,dt) || this.stateT>(this.fw==='sniper'?5:9)) this.setState(this.lastVis?'engage':'chase');
      if (this.lastVis && this.visDist<pref[1]){ this.faceToward(t.pos.x,t.pos.z,dt,8); this.tryFire(t,dt); firing=true; }
      this.crouch=false;
    } else if (st==='chase' && this.mem){
      if (!this.path) this.goTo(this.mem.pos.x,this.mem.pos.z);
      sprint=this.Pe.push>0.8; if (this.followPath(sprint?S.sprint:S.run,dt)){ this.setState('search'); } this.crouch=false;
    } else if (st==='retreat'){
      const th=this.target||this.mem&&this.mem.t;
      if (!this.path){ const c=th?this.findCover(th):null; if (c){ this.cover=c; this.goTo(c.x,c.z); } else { const a=th?Math.atan2(this.pos.z-th.pos.z,this.pos.x-th.pos.x):rr(0,PI*2); const f=Nav.nearestFree(this.pos.x+Math.cos(a)*18,this.pos.z+Math.sin(a)*18,6); if (f) this.goTo(f[0],f[1]); } }
      sprint=true; if (this.followPath(S.sprint,dt)){ this.crouch=true; if (this.mag<this.def.mag) this.reload(); if (th && this.lastVis){ this.faceToward(th.pos.x,th.pos.z,dt,6); this.tryFire(th,dt); firing=true; } } else this.crouch=false;
    } else if (st==='investigate' && this.heard){
      if (!this.path) this.goTo(this.heard.x,this.heard.z);
      if (this.followPath(S.run*0.85,dt)){ this.setState('search'); }
    } else if (st==='search'){
      // sweep around the last known / heard position
      if (!this.path || this.followPath(S.walk*1.3,dt)){ const c=this.mem?this.mem.pos:(this.heard||this.pos); const f=Nav.nearestFree(c.x+rr(-8,8),c.z+rr(-8,8),4); if (f) this.goTo(f[0],f[1]); }
      this.yaw+=Math.sin(this.stateT*1.7)*dt*0.8;
    } else if (st==='objective'){
      const g=Mode.botGoal(this); if (!g){ this.setState('patrol'); }
      else { if (!this.path || (this.goal && Math.hypot(this.goal[0]-g.x,this.goal[1]-g.z)>3)) this.goTo(g.x,g.z); sprint=g.urgent; this.followPath(g.urgent?S.sprint:S.run,dt);
        if (this.lastVis && t){ this.tryFire(t,dt); firing=true; } }
    } else { // patrol
      if (!this.path || this.followPath(S.walk,dt)){ const p=Nav.randomPoint(); this.goTo(p[0],p[1]); }
      this.crouch=false;
    }
    if (st!=='cover' && st!=='retreat' && st!=='engage') this.crouch=false;
    this.vel.set(-Math.sin(this.yaw+this.moveDir)*this.speed,0,-Math.cos(this.yaw+this.moveDir)*this.speed);
    this.pack.visible=this.carrying;
    // animation (same system as the player); distant bots animate at 10 Hz
    const rg=this.rig; rg.root.position.copy(this.pos); rg.root.rotation.y=this.yaw;
    const tp=t&&this.lastVis?chestOf(t):null, e=eyeOf(this);
    const pitch = tp ? Math.atan2(tp.y-e.y, Math.hypot(tp.x-e.x,tp.z-e.z)) : -0.15;
    this.label.s.visible = camD<40 || (Net.gang && this.team!==undefined && this.team===Net.myTeam);
    this.animAcc=(this.animAcc||0)+dt;
    if (!far || this.animAcc>1/Perf.botAnimHz()){
      const md=this.moveDir||0;
      animateCharacter(rg,{speed:this.speed, moveX:-Math.sin(md), moveZ:-Math.cos(md), sprint, crouch:this.crouch, ads, pitch,
        hold:{weapon:this.heldWeapon(), kick:this.kick, firing:firing||ads, lowReady:this.speed>3.2 && !firing, reloadK:this.reloadT>0?1-this.reloadT/(this.def.reloadTime||2.4):0, swing:this.swingT>0?1-this.swingT/0.55:0}}, this.animAcc);
      this.animAcc=0;
    }
  }
}
// nameplate with an optional red DEV tag above the name
function drawNameTag(L, name, dev, col){ const g=L.c.getContext('2d'); g.clearRect(0,0,128,36);
  if (dev){ g.fillStyle='#c0262b'; g.fillRect(44,0,40,13); g.fillStyle='#fff'; g.font='bold 10px sans-serif'; g.textAlign='center'; g.fillText('DEV',64,10); }
  g.fillStyle='rgba(0,0,0,.55)'; g.fillRect(4,15,120,19); g.fillStyle=col||'#fff'; g.font='bold 13px sans-serif'; g.textAlign='center'; g.fillText(name,64,29); L.tex.needsUpdate=true; }
function makeLabel(){
  const c=document.createElement('canvas'); c.width=128; c.height=36; const tex=new THREE.CanvasTexture(c);
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
  s.scale.set(0.9,0.25,1); s.position.y=2.1; return {s,c,tex};
}

// ---------------------------------------------------------------- manager
const Bots = {
  list:[], spawnHistory:[],
  init(){ if (!Nav.ready) Nav.build(); validateSpawns(); this.setCount(MatchRules.bots); },
  setCount(n){
    n=clamp(n|0,0,12);
    while (this.list.length>n){ const b=this.list.pop(); scene.remove(b.rig.root); if (b.cover) b.cover.used=null; }
    while (this.list.length<n){ this.list.push(new Bot(this.list.length)); }
  },
  update(dt){ Budget.reset(); for (const b of this.list) b.update(dt); },
  // gunshot awareness: anyone within hearing range investigates (not the shooter)
  hear(pos, shooter, suppressed){ for (const b of this.list) b.hear(pos, shooter===undefined?P:shooter, !!suppressed); },
  setMode(){ for (const b of this.list){ b.reroll(false); } },
  // safe spawn: designated points + random open ground; away from the player and other bots, not in the player's view, not the same spot twice
  spawnPoint(bot){
    const pool = spawnPool();
    let best=null, bs=-1e9;
    for (const s of pool){
      if (!Nav.walkable(s[0],s[1]) || !pointFree(s[0],s[1],0.05,1.7,0.45)) continue;
      const dp=Math.hypot(s[0]-P.pos.x,s[1]-P.pos.z);
      let minB=60; for (const b of this.list) if (b!==bot && b.alive) minB=Math.min(minB,Math.hypot(b.pos.x-s[0],b.pos.z-s[1]));
      let score=Math.min(dp,70)+minB*0.6+Math.random()*12;
      if (dp<BOT_TUNE.minSpawnFromPlayer && P.alive) score-=80;
      if (this.spawnHistory.some(h=>Math.hypot(h[0]-s[0],h[1]-s[1])<4)) score-=30;
      if (P.alive && dp<55 && Budget.los>0 && lineOfSight(camera.position,new V3(s[0],1.2,s[1]))) score-=40;
      if (score>bs){ bs=score; best=s; }
    }
    best=best||Nav.randomPoint();
    this.spawnHistory.push(best); if (this.spawnHistory.length>6) this.spawnHistory.shift();
    return best;
  },
};
// is the player's flashlight pointed at this bot?
function glareOn(b){ const d=new V3(); camera.getWorldDirection(d); const to=new V3(b.pos.x,b.pos.y+1.3,b.pos.z).sub(camera.position).normalize(); return d.dot(to)>0.97; }

// ---------------------------------------------------------------- Deathmatch rules (set before the match by the local host; locked once it starts)
const MATCH_DEFAULTS = { time:0, kills:20, bots:7, difficulty:'normal', tie:'tie' };
const MatchRules = Object.assign({}, MATCH_DEFAULTS, Store.get('matchRules',{}));
function saveMatchRules(){ Store.set('matchRules', MatchRules); }
Object.defineProperty(Settings,'botDifficulty',{get(){ return (typeof Mode!=='undefined' && Mode.cur==='backpack' ? ZARules : MatchRules).difficulty; }, set(v){ (Mode.cur==='backpack' ? ZARules : MatchRules).difficulty=v; }, configurable:true});
