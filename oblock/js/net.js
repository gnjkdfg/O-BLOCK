// which magazine each gun carries (the server checks you own it and sizes your magazine to match)
function magChoices(){ const o={}; for (const id of WEAPON_ORDER) if (WEAPON_SLOTS[id].includes('mag')) o[id]=(WCustomSaved[id]||WCustom[id]).att.mag||'mag_std'; return o; }
// Gang Wars teams: the host makes 2-4 (name, colour, emblem); the server sends the cleaned list with the match
const TEAM_COLS=['#ff4a3a','#4aa8ff','#3fd46a','#ffcf3f','#c86bff','#ff8a2a','#f2f4f6','#2ee6d6'], EMBLEMS=['★','☠','♠','♦','♣','♥','⚡','♛'];
const TEAM_DEFAULTS=[{name:'RED GANG', col:'#ff4a3a', emblem:'★'}, {name:'BLUE GANG', col:'#4aa8ff', emblem:'☠'}, {name:'GREEN GANG', col:'#3fd46a', emblem:'♠'}, {name:'GOLD GANG', col:'#ffcf3f', emblem:'♛'}];
let GANGS = TEAM_DEFAULTS.slice(0,2);
const teamTagOf = t => t ? t.emblem+' '+t.name : '?', teamTag = i => GANGS[i] ? GANGS[i].emblem+' '+GANGS[i].name : '?';
'use strict';
/* Online private matches (client side). Talks to the O-Block game server (server/server.js) over WebSocket.
   Nothing here decides anything: health, damage, kills, respawns, the bag, hold times, rewards, purchases and loot
   all come back from the server. Without a server address this module does nothing and the lobby says so — it never
   fakes players, rooms or a connection.
   Note: browsers only allow a secure page (https) to open secure sockets (wss://). A page served over https can't
   reach a plain ws:// server, and some hosting sandboxes block outside connections entirely. */
const NET_CFG = { stateHz:20, botHz:10, interp:0.12 };
const NET_DEFAULT_URL = 'wss://oblock-multiplayer.onrender.com';

class RemoteEnt {
  constructor(d){
    this.id=d.id; this.kind=d.kind; this.name=d.name; this.dev=d.tag==='DEV'; this.team=d.team; this.char=d.char; this.w=d.w; this.alive=true; this.hp=d.hp||100; this.kills=0; this.deaths=0;
    this.pos=new V3(...(d.pos||[0,0,0])); this.tpos=this.pos.clone(); this.yaw=d.yaw||0; this.tyaw=this.yaw; this.pitch=0; this.vel=new V3(); this.crouch=false; this.speed=0;
    // the colours the player picked (sent by the server); bots wear the bot outfit
    const L=d.look||{}, ok=(list,v)=>list.some(c=>c[0]===v);
    this.rig=buildCharacter(d.kind==='bot' ? Object.assign({char:'tracksuit'}, BOT_LOOK) : {char:CHARACTERS[d.char]?d.char:'tracksuit', jacket:ok(JACKET_COLORS,L.jacket)?L.jacket:'Black', pants:ok(PANTS_COLORS,L.pants)?L.pants:'Black'}, {merged:true}); scene.add(this.rig.root); Thermal.tagBot(this.rig);
    this.label=makeLabel(); this.rig.root.add(this.label.s); this.setWeapon(d.w); this.drawLabel();
  }
  setWeapon(w){ if (this.weapon) this.rig.weaponSlot.remove(this.weapon.model); this.w=w; this.weapon=createWeapon(w, STOCK_CONFIG(w)); this.rig.weaponSlot.add(this.weapon.model); }
  drawLabel(){ const g=this.label.c.getContext('2d'); g.clearRect(0,0,128,36); g.fillStyle='rgba(0,0,0,.55)'; g.fillRect(4,2,120,32);
    if (this.team!==undefined && GANGS[this.team]){ g.fillStyle=GANGS[this.team].col; g.fillRect(4,2,4,32); }      // Gang Wars: gang colour stripe
    g.fillStyle=this.team!==undefined&&GANGS[this.team] ? GANGS[this.team].col : this.kind==='bot'?'#ffcf3f':'#7fd0ff'; g.font='bold 13px sans-serif'; g.textAlign='center'; g.fillText(this.name,64,15);
    g.fillStyle='#999'; g.font='9px sans-serif'; g.fillText(this.kind==='bot'?'BOT':'PLAYER',108,15);
    g.fillStyle='#333'; g.fillRect(14,21,100,7); g.fillStyle='#4fd06a'; g.fillRect(14,21,Math.max(0,Math.min(100,this.hp)),7);
    if (this.dev){ g.fillStyle='#c0262b'; g.fillRect(6,4,26,11); g.fillStyle='#fff'; g.font='bold 8px sans-serif'; g.fillText('DEV',19,12); } this.label.tex.needsUpdate=true; }
  snap(a){ this.tpos.set(a[1],a[2],a[3]); this.tyaw=a[4]; this.pitch=a[5]; if (a[6]!==this.w) this.setWeapon(a[6]); const alive=!!a[7]; if (alive && !this.alive) this.pos.copy(this.tpos); this.alive=alive; if (Math.round(this.hp)!==a[8]){ this.hp=a[8]; this.drawLabel(); } this.kills=a[9]; this.deaths=a[10]; this.crouch=!!(a[12]&1); this.seated=!!(a[12]&2); }
  update(dt){
    const prev=this.pos.clone(); this.pos.lerp(this.tpos, 1-Math.exp(-dt/NET_CFG.interp)); this.vel.copy(this.pos).sub(prev).divideScalar(Math.max(dt,1e-3)); this.speed=Math.hypot(this.vel.x,this.vel.z);
    this.yaw+=angleDiff(this.tyaw,this.yaw)*Math.min(1,dt*12);
    const rg=this.rig; rg.root.visible=this.alive; if (!this.alive) return;
    if (this.ride){ const v=this.ride; this.pos.set(v.pos.x, v.pos.y+v.S.deck, v.pos.z); this.yaw=v.yaw; }   // riding: stand / sit on the vehicle
    rg.root.position.copy(this.pos); rg.root.rotation.y=this.yaw; this.label.s.visible=this.pos.distanceTo(camera.position)<40 || (Net.gang && this.team===Net.myTeam);   // teammates: tag at any range
    const inv=this.vel.clone().applyAxisAngle(new V3(0,1,0),-this.yaw);
    charLOD(this, this.pos.distanceTo(camera.position)>Perf.lodDist()); charOutline(this);
    // far players animate less often on weak settings (same idea as the bots)
    if (Perf.potato || Settings.perf){ this.animAcc=(this.animAcc||0)+dt; if (this.pos.distanceTo(camera.position)>(Settings.superPerf?22:35) && this.animAcc<1/Perf.botAnimHz()) return; dt=this.animAcc; this.animAcc=0; }
    if (this.ride){ animateCharacter(rg,{speed:0, sit:!this.ride.S.stand, pitch:this.pitch, hold:{weapon:this.weapon, firing:true}}, dt); return; }
    if (this.stunT>0){ this.stunT=Math.max(0,this.stunT-dt); animateCharacter(rg,{speed:0, pitch:-0.2, hold:{weapon:this.weapon}}, dt); stunPose(rg, this.stunDur-this.stunT, this.stunDur, this.stunDir); if (this.stunT<=0) stunPose(rg,-1); return; }
    if (this.fist && this.fist.punch){ const p=this.fist.punch; p.t+=dt; p.k=p.t/p.dur; if (p.k>=1) this.fist.punch=null; }
    animateCharacter(rg,{speed:this.seated?0:this.speed, sit:this.seated, bench:this.seated, moveX:inv.x, moveZ:inv.z, sprint:this.speed>6, crouch:this.crouch, pitch:this.pitch, hold:{weapon:this.weapon, fist:this.fist, firing:true}}, dt);
  }
  chest(){ return new V3(this.pos.x, this.pos.y+(this.crouch?0.8:1.15), this.pos.z); }
  rayHit(o,dir,maxT){ return Bot.prototype.rayHit.call(this,o,dir,maxT); }
  remove(){ scene.remove(this.rig.root); }
}

const Net = {
  ws:null, url:null, connected:false, id:null, room:null, inMatch:false, isHost:false, ents:new Map(), dev:false, profile:null, lastSt:0, lastBots:0, err:'', za:null, clock:0,
  token(){ let t=Store.get('netToken',null); if (!t){ t=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''); Store.set('netToken',t); } return t; },
  connect(url, again){
    this.close(); this.err=''; this.url=url; if (!again) this.rejoin=null;
    let ws; try { ws=new WebSocket(url); } catch(e){ this.err='Could not open a connection: '+e.message; Lobby.render(); return; }
    this.ws=ws; Lobby.render('Connecting to '+url+' …');
    const to=setTimeout(()=>{ if (!this.connected){ if (!this.rejoin) this.err='No answer from '+url+' (is the server running, and is the address right?)'; try{ ws.close(); }catch(e){} Lobby.render(); } }, 6000);
    ws.onopen=()=>{ clearTimeout(to); this.connected=true; this.send({t:'hello', token:this.token(), name:Settings.name||'PLAYER', char:CharLook.char, look:{jacket:CharLook.jacket, pants:CharLook.pants}, weapon:Loadout.firearm, secondary:Loadout.secondary, melee:Loadout.melee, mags:magChoices(), tag:Dev.showTag()?'DEV':'', restore:this.backup(), rejoin:!!this.rejoin}); this._lastLo=null; };
    ws.onclose=()=>{ clearTimeout(to); if (ws!==this.ws) return;              // a socket we closed ourselves (leaving, or a retry)
      const was=this.connected; this.connected=false;
      // dropped mid-match (Wi-Fi blip): the server keeps your place for 30 s, so keep trying to get back in
      if (this.inMatch && (was || this.rejoin)){ if (!this.rejoin){ this.rejoin={until:Date.now()+30000}; Bus.emit('toast',{t:'CONNECTION LOST · RECONNECTING…',kind:'warn'}); }
        if (Date.now()<this.rejoin.until){ this.rejoinNote(); this.rejoin.timer=setTimeout(()=>{ if (this.rejoin) this.connect(this.url, true); }, 1500); return; } }
      this.endRejoin(); this.room=null; if (this.inMatch) this.leaveMatch('Connection to the server was lost'); ProfileAuthority.useRemote(null); if (was) this.err='Disconnected from the server.'; Lobby.render(); UI.menuInfo(); };
    ws.onerror=()=>{ if (this.rejoin) return; this.err='Connection failed. Check the address; an https page needs a wss:// server, and some hosts block outside connections.'; Lobby.render(); };
    ws.onmessage=ev=>{ let m; try { m=JSON.parse(ev.data); } catch(e){ return; } this.onMessage(m); };
  },
  close(){ const w=this.ws; this.ws=null; this.connected=false; if (w){ try{ w.close(); }catch(e){} } },
  // reconnect banner (counts down while the server holds your place)
  rejoinNote(){ let b=document.getElementById('rejoin'); if (!b){ b=document.createElement('div'); b.id='rejoin'; document.body.appendChild(b); }
    const tick=()=>{ if (!this.rejoin){ b.style.display='none'; return; } const s=Math.max(0,Math.ceil((this.rejoin.until-Date.now())/1000)); b.style.display='block'; b.textContent='CONNECTION LOST · RECONNECTING… '+s+'s'; };
    tick(); clearInterval(this._rjI); this._rjI=setInterval(tick,500); },
  endRejoin(){ if (this.rejoin) clearTimeout(this.rejoin.timer); this.rejoin=null; clearInterval(this._rjI); const b=document.getElementById('rejoin'); if (b) b.style.display='none'; },
  send(m){ if (this.ws && this.ws.readyState===1) this.ws.send(JSON.stringify(m)); },
  // developer sign-in: the server checks the password against its private DEV_PASSWORD (nothing is stored here)
  devAuth(pw){ return new Promise(res=>{ this._devCb=res; this.send({t:'devauth', pw}); setTimeout(()=>{ if (this._devCb===res){ this._devCb=null; res({ok:false, why:'no answer from the server'}); } },5000); }); },
  online(){ return this.inMatch; },
  // everything the local game can shoot at besides the host's own bots
  // preferences that follow the account (character, outfit, loadout, weapon paint/attachments): newest copy wins
  prefsNow(){ return {char:CharLook.char, look:{jacket:CharLook.jacket, pants:CharLook.pants}, loadout:Object.assign({},Loadout), wcustom:WCustomSaved}; },
  syncPrefs(){ if (!this.connected) return; const k=JSON.stringify(this.prefsNow()); if (k===this._lastPrefs) return;
    if (this._lastPrefs!==undefined) Store.set('prefsTs', Date.now()); this._lastPrefs=k; this.send({t:'prefs', prefs:Object.assign({ts:Store.get('prefsTs',0)}, this.prefsNow())}); },
  adoptPrefs(p){ if (!p || !(p.ts > Store.get('prefsTs',0))) return;
    try { if (CHARACTERS[p.char]) Object.assign(CharLook,{char:p.char}, p.look||{}); saveLook();
      if (p.loadout) Object.assign(Loadout, p.loadout); saveLoadout();
      if (p.wcustom) for (const id in p.wcustom) if (WCustom[id]) Object.assign(WCustom[id], p.wcustom[id]); saveWCustom();
      Store.set('prefsTs', p.ts); this._lastPrefs=JSON.stringify(this.prefsNow()); Game.applyCharacter && Game.applyCharacter(); Bus.emit('toast',{t:'LOADOUT & CHARACTER RESTORED FROM YOUR ACCOUNT',kind:'ok'}); } catch(e){} },
  // signed copy of your online profile (cash, level, purchases), kept so a restarted server can restore it
  keepSeal(p){ if (p && p.seal && this.url) Store.set('seal:'+this.url, p.seal); },
  backup(){ return this.url ? Store.get('seal:'+this.url, null) : null; },
  // character, outfit colours and gun -> server; re-sent whenever they change (e.g. after visiting the Character screen)
  syncLoadout(force){ if (!this.connected) return; const m={t:'loadout', char:CharLook.char, look:{jacket:CharLook.jacket, pants:CharLook.pants}, weapon:Loadout.firearm, secondary:Loadout.secondary, melee:Loadout.melee, mags:magChoices()}, k=JSON.stringify(m);
    if (force || k!==this._lastLo){ this._lastLo=k; this.send(m); } },
  // Gang Wars: which gang an entity is in (P, host-run bots, remote players/bots); null outside Gang Wars
  teamOf(t){ if (!this.gang) return null; if (t===P) return this.myTeam; if (t && t.team!==undefined) return t.team; if (t && t.netId && this.teamById[t.netId]!==undefined) return this.teamById[t.netId]; return null; },
  targets(){ const out=[]; for (const e of this.ents.values()) if (e.alive) out.push(e); return out; },
  netIdOf(t){ return t===P ? this.id : t.netId || t.id; },
  entityById(id){ if (id===this.id) return P; const b=Bots.list.find(x=>x.netId===id); return b || this.ents.get(id) || null; },
  onMessage(m){
    switch(m.t){
      case 'devauth': { const cb=this._devCb; this._devCb=null; if (m.ok) this.dev=true; if (cb) cb({ok:!!m.ok, remote:true, why:m.ok?'':m.why}); break; }
      case 'welcome': if (this.rejoin){ const ok=m.resumed; this.endRejoin(); if (!ok && this.inMatch){ this.room=null; this.leaveMatch('Could not rejoin · the match moved on without you'); } else if (ok) Bus.emit('toast',{t:'RECONNECTED',kind:'ok'}); }
        this.id=m.id; this.dev=m.dev; this.keepSeal(m.profile); this.adoptPrefs(m.profile.prefs); this._lastPrefs=undefined; ProfileAuthority.useRemote(m.profile); if (m.restored) Bus.emit('toast',{t:'ONLINE PROFILE RESTORED',kind:'ok'}); Lobby.render(); UI.menuInfo(); break;
      case 'profile': this.keepSeal(m.profile); ProfileAuthority.useRemote(m.profile); if (m.xp || m.cash || m.bought) UI.saveState('pending'); if (m.xp) Bus.emit('xp',{n:m.xp, why:m.why}); if (m.cash) Bus.emit('cash',{n:m.cash, why:m.why}); if (m.bought){ Bus.emit('toast',{t:'PURCHASED · '+m.bought.replace('att:','').toUpperCase(),kind:'ok'}); Snd.uiSfx('buy'); const ab=UI._afterBuy; if (ab && ab.item===m.bought){ UI._afterBuy=null; clearTimeout(UI._buyTO); if (ab.then) ab.then(); } if (Game.state==='loadout') UI.renderLoadout(); } UI.menuInfo(); break;
      case 'room': this.room=m; this.isHost=m.host===this.id; Lobby.render(); break;
      case 'error': this.err=m.why; Lobby.render(); break;
      case 'ride': Rides.netRide(m); break;
      case 'rl': { const e=this.entityById(m.id); if (e && e!==P && !Bots.list.some(b=>b.netId===m.id) && e.pos && e.pos.distanceTo(P.pos)<40) Snd.reload(m.w, m.n, e.pos.clone().setY(e.pos.y+1.2)); break; }
      case 'away': if (m.id!==this.id) Bus.emit('toast',{t:(m.name||'A PLAYER').toUpperCase()+(m.on?' LOST CONNECTION · '+m.secs+'s TO REJOIN':' RECONNECTED'),kind:m.on?'warn':'ok'}); break;
      case 'fade': Arena.onState(m.st); break;
      case 'nade': case 'mine': case 'mineoff': Equip.onNet(m); break;
      case 'teamnext': Bus.emit('toast',{t:'YOU JOIN '+teamTag(m.team)+' WHEN YOU RESPAWN',kind:'ok'}); break;
      case 'teamset': { this.teamById[m.id]=m.team; const t=this.entityById(m.id); if (t===P){ this.myTeam=m.team; Bus.emit('toast',{t:'YOU ARE NOW IN '+teamTag(m.team),kind:'obj'}); } else if (t){ t.team=m.team; t.drawLabel&&t.drawLabel(); } for (const e of this.ents.values()) e.drawLabel&&e.drawLabel(); break; }
      case 'reject': this._lastRej=m; if (m.what==='dev') Bus.emit('toast',{t:'DEV · '+String(m.why).toUpperCase(),kind:'warn'}); if (m.what==='fade') Bus.emit('toast',{t:String(m.why).toUpperCase(),kind:'warn'}); if (m.what==='ride') Rides.pendingId=null; if (m.what==='nade'||m.what==='mine') Equip.onNet(m);
        if (m.what==='buy' && UI._afterBuy){ const ab=UI._afterBuy; UI._afterBuy=null; clearTimeout(UI._buyTO); UI.buyFailed(ab.name||'item', m.why); break; } if (m.what!=='hits') Bus.emit('toast',{t:'SERVER: '+m.what.toUpperCase()+' REJECTED · '+m.why.toUpperCase(),kind:'warn'}); else this.rejected=(this.rejected||0)+1; break;
      case 'start': this.startMatch(m); break;
      case 'snap': this.snap(m); break;
      case 'hit': this.onHit(m); break;
      case 'block': { const e=this.entityById(m.id); if (e && e!==P){ e.fist=e.fist||{}; e.fist.block=!!m.on; } break; }
      case 'kill': this.onKill(m); break;
      case 'respawn': this.onRespawn(m); break;
      case 'shotfx': { const e=this.entityById(m.by); if (e && e!==P && m.w==='fists'){ e.fist=e.fist||{}; e.fist.punch={side:m.heavy?1:(e.fistSide=-(e.fistSide||1)), heavy:!!m.heavy, t:0, k:0, dur:m.heavy?0.5:0.26}; Snd.swing(); break; }
        if (e && e!==P && m.o){ const o=new V3(...m.o); Snd.shot(m.w,{pos:o, suppressed:m.sup}); if (m.e) m.w==='taser' ? FX.wire(o.clone().setY(o.y+1.4),new V3(...m.e),false) : FX.tracer(o,new V3(...m.e),'#ffb070'); if (!m.sup) Pings.add(o); } break; }
      // Taser hit, decided by the server: you (no control for 5 s), one of the host's bots, or another player
      case 'stun': { const d=m.dur||5; this._stunSeen=true;
        const src=this.entityById(m.by), tgt=this.entityById(m.id), dir=src&&tgt&&src.pos&&tgt.pos ? tgt.pos.clone().sub(src.pos) : null;   // fall away from the shooter
        if (m.id===this.id){ if (!(P.stunT>0)){ P.stunT=d; P.stunDur=d; P.stunDir=dir; Arsenal.cancelReload(); Arsenal.trigger=false; Fists.reset(); if (!m.knock) Snd.zap(); Bus.emit('toast',{t:m.knock?'KNOCKED DOWN':'TASED · '+d+' s',kind:'warn'}); } }
        else { const b=Bots.list.find(x=>x.netId===m.id); if (b) b.stun(d, dir); else { const e=this.ents.get(m.id); if (e && !(e.stunT>0)){ e.stunT=d; e.stunDur=d; e.stunDir=dir; if (!m.knock) Snd.zap(e.pos.clone().setY(e.pos.y+1)); } } }
        break; }
      // saving: confirmed only when the server's storage has actually written your progress
      case 'saved': UI.saveState('saved', m.rev); break;
      case 'savefail': UI.saveState('failed', m.tries); break;
      case 'carrier': { const n=m.id===this.id?'YOU':(this.entityById(m.id)||{}).name; Bus.emit('toast',{t:(n||'SOMEONE')+(n==='YOU'?' HAVE':' HAS')+' THE BAG',kind:'obj'}); break; }
      // the server counted the 10-kill streak (abready) and validated the activation (ability); mirror its state here
      case 'glass': { const g=Glass.panes[m.id|0]; if (g) Glass.shatter(g, null, false); break; }   // someone else broke a window
      case 'abready': { const sid = m.id===this.id ? 'player' : (()=>{ const b=Bots.list.find(x=>x.netId===m.id); return b?'bot'+b.i:null; })(); if (!sid) break;
        StreakAuthority.st(sid).ab.ready=true; if (sid==='player') Perks.abilityReady(); break; }
      case 'ability': { const own=m.id===this.id, b=own?null:Bots.list.find(x=>x.netId===m.id), sid=own?'player':b?'bot'+b.i:null;
        if (sid){ const st=StreakAuthority.st(sid); st.ab.ready=false; st.ab.active=true; }
        if (own){ Perks.abWas=true; if (m.hp) P.hp=m.hp; const A=StreakAuthority.ability('player'); if (A&&A.hpMul) setBloodHoundLook(true); } else if (b){ b.abWas=true; b.hp=m.hp; b.drawLabel(); }
        Bus.emit('toast',{t:(own?'':((this.entityById(m.id)||{}).name||'')+' · ')+m.name+' ACTIVE',kind:own?'kill':'warn'}); break; }
      case 'loot': P.items.beer=m.items.beer; P.items.blunt=m.items.blunt; P.items.zyn=m.items.zyn; for (const w in (m.ammo||{})) if (Arsenal.ammo[w]) Arsenal.ammo[w].res=m.ammo[w]; Bus.emit('loot',{found:m.found}); break;
      case 'gift': { if (m.items){ P.items.beer=m.items.beer; P.items.blunt=m.items.blunt; P.items.zyn=m.items.zyn; } if (m.flash!==undefined) P.flash=m.flash; if (m.mines!==undefined) P.mine=m.mines;
        for (const w in (m.ammo||{})) if (Arsenal.ammo[w]) Arsenal.ammo[w].res=m.ammo[w];
        const nm=m.what==='cash'?'$'+m.n.toLocaleString():m.what.startsWith('own:')?(((CHARACTERS[m.what.slice(4)]||WEAPON_DEFS[m.what.slice(4)]||{}).name)||m.what.slice(4).replace(/^att:/,'').toUpperCase()):m.what==='ammo'?'AMMO':(m.n>1?m.n+' ':'')+m.what.toUpperCase();
        Bus.emit('toast',{t:'YOU RECEIVED '+nm,kind:'ok'}); break; }
      case 'devok': Bus.emit('toast',{t:'DEV · GAVE '+m.name.toUpperCase()+' '+String(m.what).toUpperCase(),kind:'ok'}); break;
      case 'used': P.hp=m.hp; P.items.beer=m.items.beer; P.items.blunt=m.items.blunt; P.items.zyn=m.items.zyn; break;
      case 'correct': P.pos.set(...m.pos); break;
      case 'tag': { const e=this.ents.get(m.id); if (e){ e.dev=m.dev; e.drawLabel(); } break; }
      case 'left': { const e=this.ents.get(m.id); if (e){ e.remove(); this.ents.delete(m.id); } break; }
      case 'end': this.onEnd(m); UI.saveState('pending'); break;
    }
  },
  // ---- match lifecycle
  startMatch(m){
    this.inMatch=true; this.matchId=m.matchId; this.settings=m.settings; if (m.settings.mode==='fade') Arena.enter(); else Arena.exit(); if (m.fade) Arena.onState(m.fade); this.za=null; this.clock=m.clock||0; this.rejected=0;
    this.gang = m.settings.mode==='gang'; if (this.gang && m.settings.teams) GANGS=m.settings.teams; this.teamKills=GANGS.map(()=>0); if (m.tk) this.teamKills=m.tk; this.teamById={}; this.myTeam=null;
    for (const d of m.ents){ if (d.team!==undefined) this.teamById[d.id]=d.team; if (d.id===this.id && d.team!==undefined) this.myTeam=d.team; }
    for (const e of this.ents.values()) e.remove(); this.ents.clear();
    const st=m.settings, mine=new Set(); let bi=0;
    // the host runs the bots (AI needs the 3D scene); the server owns their health
    if (st.mode==='backpack'){ this.zaBackup=this.zaBackup||Object.assign({},ZARules); Object.assign(ZARules, {variant:st.variant, time:st.time, classicHold:st.classicHold, spawns:st.spawns, respawn:st.respawn, resetAfter:st.resetAfter, difficulty:st.difficulty, bots:this.isHost?st.bots:0}); }
    else { this.mrBackup=this.mrBackup||Object.assign({},MatchRules); Object.assign(MatchRules, {time:st.time, kills:this.gang?0:st.kills, tie:st.tie, difficulty:st.difficulty, bots:this.isHost?st.bots:0}); }
    Game.startMatch(st.mode, true);
    if (this.gang) Bus.emit('toast',{t:'GANG WARS · YOU ARE IN '+teamTag(this.myTeam)+(st.friendlyFire?' · FRIENDLY FIRE ON':''),kind:'obj'});
    for (const d of m.ents){
      if (d.id===this.id){ P.pos.set(...d.pos); P.yaw=d.yaw;
        // the server applied the room rules: start weapon and an allowed character
        if (d.w && d.w!==Arsenal.cur && FIREARMS.includes(d.w)){ const sl=WEAPON_SLOT[d.w]; if (sl && sl!=='melee') Arsenal[sl]=d.w; Arsenal.firearm=d.w; const wd=weaponDef(d.w); Arsenal.ammo[d.w]={mag:wd.mag,res:wd.reserve}; Arsenal.cur=null; Arsenal.equip(d.w,true); }
        if (d.char && d.char!==CharLook.char){ this.lookBackup=Object.assign({},CharLook); Object.assign(CharLook,{char:d.char},CHARACTERS[d.char].defaults); Game.applyCharacter(); Bus.emit('toast',{t:'THE HOST DID NOT ALLOW THAT CHARACTER · PLAYING AS '+CHARACTERS[d.char].name,kind:'warn'}); }
        continue; }
      if (d.kind==='bot' && this.isHost){ const b=Bots.list[bi++]; if (b){ b.netId=d.id; b.name=d.name; b.team=d.team; b.pos.set(...d.pos); b.drawLabel(); mine.add(d.id); } continue; }
      this.ents.set(d.id, new RemoteEnt(d));
    }
    Game.state='playing'; UI.show(null);
  },
  leaveMatch(why){ Arena.exit(); this.inMatch=false; this.gang=false; this.myTeam=null; GANGS=TEAM_DEFAULTS.slice(0,2); for (const b of Bots.list){ b.team=undefined; b.drawLabel&&b.drawLabel(); } for (const e of this.ents.values()) e.remove(); this.ents.clear();
    if (this.lookBackup){ Object.assign(CharLook,this.lookBackup); this.lookBackup=null; Game.applyCharacter(); }
    if (this.zaBackup){ Object.assign(ZARules,this.zaBackup); this.zaBackup=null; } if (this.mrBackup){ Object.assign(MatchRules,this.mrBackup); this.mrBackup=null; }
    if (why) Bus.emit('toast',{t:why.toUpperCase(),kind:'warn'}); },
  snap(m){
    this.clock=m.clock; Mode.clock=m.clock; if (m.tk) this.teamKills=m.tk;
    for (const a of m.ents){
      if (a[0]===this.id){ P.kills=a[9]; P.deaths=a[10]; if (Math.abs(P.hp-a[8])>1 && P.alive) P.hp=a[8]; continue; }
      const b=Bots.list.find(x=>x.netId===a[0]); if (b){ b.kills=a[9]; b.deaths=a[10]; continue; }
      const e=this.ents.get(a[0]); if (e) e.snap(a);
    }
    if (m.rides){ Rides.netSnap(m.rides); for (const e of this.ents.values()) e.ride=Rides.list.find(v=>v.rider===e.id)||null; }
    if (m.za){ this.za=m.za; const s=BackpackAuthority.s; if (s){ const toLocal=id=> id===this.id ? 'player' : id; s.carrier=m.za.carrier?toLocal(m.za.carrier):null; s.x=m.za.x; s.y=m.za.y; s.z=m.za.z; s.atHome=m.za.atHome; s.hold={}; for (const k in m.za.hold) s.hold[toLocal(k)]=m.za.hold[k]; } }
  },
  onHit(m){
    const t=this.entityById(m.target);
    if (m.by===this.id) { Bus.emit('hit',{head:m.head, kill:m.hp<=0}); Snd.hitmarker(m.head); }
    if (m.w==='fists'){ if (t && t!==P) punchFlinch(t); if (t) Snd.punch(t===P?P.pos:t.pos.clone().setY(t.pos.y+1.3), m.dmg>=16, !!m.blocked); if (t===P) Fists.jolt=m.blocked?0.4:1; }
    if (t===P){ P.hp=m.hp; P.lastHurt=performance.now()/1000; Snd.hurt(); const src=this.entityById(m.by); let ang=0; if (src&&src.pos){ ang=Math.atan2(-(src.pos.x-P.pos.x),-(src.pos.z-P.pos.z))-P.yaw; } Bus.emit('hurt',{n:m.dmg, ang}); }
    else if (t instanceof Bot){ t.hp=m.hp; t.drawLabel(); t.lastHurt=performance.now()/1000; const src=this.entityById(m.by); if (src && !t.target){ t.target=src; } }
    else if (t){ t.hp=m.hp; t.drawLabel(); }
  },
  onKill(m){
    if (m.tk) this.teamKills=m.tk;
    const t=this.entityById(m.target), k=this.entityById(m.by), wn=WEAPON_DEFS[m.w]?WEAPON_DEFS[m.w].name:m.w==='mine'?'LANDMINE':'—';
    const nm=e=>e===P?'YOU':e?e.name:'—';
    if (m.w==='mystery') Bus.emit('killfeed',{victim:nm(t), mystery:true});      // no killer, no weapon: they just drop
    else if (k===P) Bus.emit('kill',{victim:nm(t), weapon:wn, head:m.head}); else Bus.emit('killfeed',{killer:nm(k), victim:nm(t), weapon:wn});
    if (t===P) killPlayer(m.w==='mystery' ? null : nm(k));
    else if (t instanceof Bot){ t.alive=false; t.deadT=0; t.label.s.visible=false; Corpses.spawn(t.rig,new V3(0,0,1)); t.rig.root.visible=false; t.target=null; }
    else if (t){ t.alive=false; Corpses.spawn(t.rig,new V3(0,0,1)); t.rig.root.visible=false; }
    if (m.by===this.id && m.target!==this.id) StreakAuthority.kill('player');   // your own death never counts as a kill
  },
  onRespawn(m){
    if (m.id===this.id){ P.pos.set(...m.pos); P.yaw=m.yaw; P.vel.set(0,0,0); P.hp=m.hp; P.alive=true; P.crouch=false; P.prone=false; P.stamina=staminaMax(); P.exhausted=false; P.bluntCap=false; Arsenal.reset(); Bus.emit('respawn'); return; }
    const b=Bots.list.find(x=>x.netId===m.id); if (b){ b.respawn(); b.pos.set(...m.pos); b.yaw=m.yaw; b.hp=m.hp; b.drawLabel(); return; }
    const e=this.ents.get(m.id); if (e){ e.pos.set(...m.pos); e.tpos.set(...m.pos); e.alive=true; e.hp=m.hp; e.drawLabel(); }
  },
  onEnd(m){
    const nm=id=> id==='TIE' ? 'TIE' : id===this.id || id==='team'+this.myTeam ? 'YOU' : /^team\d$/.test(id) ? teamTag(+id[4]) : ((this.entityById(id)||{}).name||'?');
    this.endRows=m.rows; Game.rewards=m.rewards; ProfileAuthority.useRemote(m.profile);
    Mode.end(nm(m.winner));
  },
  // ---- per frame: own state at 20 Hz, the host's bots at 10 Hz, remote interpolation
  update(dt){
    if (!this.inMatch) return;
    const now=performance.now();
    if (now-this.lastSt>1000/NET_CFG.stateHz && P.alive){ this.lastSt=now; this.send({t:'st', p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)], yaw:+P.yaw.toFixed(3), pitch:+P.pitch.toFixed(3), f:((P.crouch||P.prone)&&!P.seated?1:0)|(P.seated?2:0), v:P.riding?[+P.riding.pos.x.toFixed(2),+P.riding.pos.y.toFixed(2),+P.riding.pos.z.toFixed(2),+P.riding.yaw.toFixed(3),+P.riding.lean.toFixed(3)]:undefined}); }
    if (this.isHost && now-this.lastBots>1000/NET_CFG.botHz){ this.lastBots=now;
      this.send({t:'bots', list:Bots.list.filter(b=>b.netId && b.alive).map(b=>({id:b.netId, p:[+b.pos.x.toFixed(2),+b.pos.y.toFixed(2),+b.pos.z.toFixed(2)], yaw:+b.yaw.toFixed(3), pitch:0, w:b.fw, char:b.rig.charId, f:b.crouch?1:0}))}); }
    for (const e of this.ents.values()) e.update(dt);
  },
  // ---- requests (the server decides)
  shot(w, o, hits, end, extra){ this.send(Object.assign({t:'shot', w, o:[+o.x.toFixed(2),+o.y.toFixed(2),+o.z.toFixed(2)], hits, e:end?[+end.x.toFixed(2),+end.y.toFixed(2),+end.z.toFixed(2)]:null}, extra||{})); },
  botShot(bot, w, o, hits, end){ this.send({t:'botshot', id:bot.netId, w, o:[+o.x.toFixed(2),+o.y.toFixed(2),+o.z.toFixed(2)], hits, e:end?[+end.x.toFixed(2),+end.y.toFixed(2),+end.z.toFixed(2)]:null}); },
};

// ---------------------------------------------------------------- lobby screen
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const Lobby = {
  open(){ if (!Net.connected && (!Net.ws || Net.ws.readyState===WebSocket.CLOSED)) Net.connect(Settings.server||NET_DEFAULT_URL); this.render(); },
  leave(){ if (Net.room) Net.send({t:'leave'}); Net.room=null; },
  render(status){
    const box=document.getElementById('on-body'); if (!box || Game.state!=='online') return;
    const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    let h='';
    if (!Net.connected){
      h+=`<div class="note">Online private matches need the <b>O-Blick game server</b> (the <code>server/</code> folder that comes with the game: <code>npm install</code>, then <code>node server.js</code>). Enter its address below. There is no public server built in, and this screen never pretends to be connected.<br><small>An https page can only reach a <code>wss://</code> server; some hosting sandboxes block outside connections completely.</small></div>
        <div class="row"><input type="text" id="on-url" placeholder="ws://localhost:8787" value="${esc(Settings.server||NET_DEFAULT_URL)}"><button class="primary" id="on-connect">CONNECT</button></div>
        ${status?`<p class="hint">${esc(status)}</p>`:''}${Net.err?`<p class="err">${esc(Net.err)}</p>`:''}`;
      box.innerHTML=h;
      document.getElementById('on-connect').onclick=()=>{ const u=document.getElementById('on-url').value.trim(); if (!/^wss?:\/\//.test(u)){ Net.err='The address must start with ws:// or wss://'; this.render(); return; } Settings.server=u; saveSettings(); Net.connect(u); };
      return;
    }
    if (!Net.room){
      h+=`<p class="hint">Connected to <b>${esc(Net.url)}</b> as <b>${esc(Settings.name||'PLAYER')}</b>${Net.dev?' · developer account':''}. Your online profile (level, cash, unlocks) lives on this server.</p>
        <div class="row"><button class="primary" id="on-create">CREATE ROOM</button></div>
        <div class="row"><input type="text" id="on-code" placeholder="ROOM CODE" maxlength="5" style="text-transform:uppercase"><button id="on-join">JOIN</button></div>
        ${Net.err?`<p class="err">${esc(Net.err)}</p>`:''}<div class="row"><button id="on-disc">DISCONNECT</button></div>`;
      box.innerHTML=h;
      document.getElementById('on-create').onclick=()=>{ Net.err=''; Net.syncLoadout(true); Net.send({t:'create', settings:this.defaults()}); };
      document.getElementById('on-join').onclick=()=>{ Net.err=''; Net.syncLoadout(true); Net.send({t:'join', code:document.getElementById('on-code').value}); };
      document.getElementById('on-disc').onclick=()=>{ Net.close(); Net.err=''; this.render(); };
      return;
    }
    const R=Net.room, S=R.settings, host=Net.isHost;
    h+=`<div class="row"><span>${esc(R.settings.name)} · ROOM CODE</span><span class="code">${esc(R.code)}</span><small class="hint">Share this code. ${host?'You are the host.':'Waiting for the host to start.'}</small></div>
      <ul class="pl">${R.players.map(p=>`<li><span>${p.tag==='DEV'?'<span class="devtag">DEV</span> ':''}${esc(p.name)}${p.id===R.host?' · HOST':''}${p.id===Net.id?' (you)':''}</span><span>LV ${p.level} · ${esc((CHARACTERS[p.char]||{}).name||p.char)}</span></li>`).join('')}</ul>
      <div id="on-set"></div>${Net.err?`<p class="err">${esc(Net.err)}</p>`:''}
      <div class="row">${host?'<button class="primary" id="on-start">START MATCH</button>':''}<button id="on-leave">LEAVE ROOM</button></div>`;
    box.innerHTML=h;
    const set=document.getElementById('on-set'), locked=!host || !!R.state && R.state==='playing';
    set.appendChild(this.settingsUI(S, locked, n=>Net.send({t:'settings', settings:n})));
    const sb=document.getElementById('on-start'); if (sb) sb.onclick=()=>{ Net.err=''; Snd.uiSfx('confirm'); Net.send({t:'start'}); };
    document.getElementById('on-leave').onclick=()=>{ this.leave(); this.render(); };
  },
  // Private match setup: tabs, sliders for numbers, toggles for on/off, dropdowns for rule choices, reset to defaults and a
  // summary. Only the host can edit; every change goes to the server, which validates/clamps it and sends the result to
  // everyone (so all players always see the same, real settings). The server refuses changes once the match is running.
  tab:'general',
  settingsUI(S, locked, send){
    const wrap=el('div','msu'), tabs=el('div','seg tabs msu-tabs'), body=el('div','msu-body');
    const T=[['general','ROOM'],['match','MATCH'],['loadout','WEAPONS & GEAR'],['mode',S.mode==='dm'?'DEATHMATCH':S.mode==='gang'?'GANG WARS':'ZA / BAG'],['rewards','REWARDS'],['summary','SUMMARY']];
    for (const [k,l] of T){ const b=el('button',this.tab===k?'on':'',l); b.onclick=()=>{ this.tab=k; this.render(); }; tabs.appendChild(b); }
    wrap.appendChild(tabs); wrap.appendChild(body);
    const put=(k,v)=>{ if (locked) return; const n=Object.assign({},S,{[k]:v}); if (k==='mode'){ n.time=v==='backpack'?300:600; n.kills=v==='gang'?40:20; delete n.weapons; } send(n); };
    const row=(label, ctrl, hint)=>{ const r=el('div','srow'); r.appendChild(el('label','',label+(hint?`<small>${hint}</small>`:''))); r.appendChild(ctrl); body.appendChild(r); };
    const toggle=(k)=>{ const t=el('button','tgl'+(S[k]?' on':''),S[k]?'ON':'OFF'); t.disabled=locked; t.onclick=()=>put(k,!S[k]); return t; };
    const drop=(k,opts)=>{ const d=el('select'); d.disabled=locked; for (const [v,t] of opts){ const o=el('option','',t); o.value=JSON.stringify(v); if (JSON.stringify(S[k])===o.value) o.selected=true; d.appendChild(o); } d.onchange=()=>put(k,JSON.parse(d.value)); return d; };
    const slider=(k,min,max,step,fmt)=>{ const w=el('div','sl'), i=el('input'); i.type='range'; i.min=min; i.max=max; i.step=step; i.value=S[k]; i.disabled=locked; const v=el('b','',fmt(+S[k]));
      i.oninput=()=>{ v.textContent=fmt(+i.value); }; i.onchange=()=>put(k,+i.value); w.appendChild(i); w.appendChild(v); return w; };
    const checks=(k,list)=>{ const w=el('div','chips'); for (const [v,t] of list){ const on=S[k].includes(v); const b=el('button','chip'+(on?' on':''),t); b.disabled=locked;
      b.onclick=()=>{ const cur=S[k].slice(); const n=on?cur.filter(x=>x!==v):cur.concat(v); if (!n.length) return; put(k,n); }; w.appendChild(b); } return w; };
    const mins=v=>v===0?'Unlimited':v>=60?Math.round(v/60)+' min':v+' s';
    const zaName=i=>{ const p=validSpawns()[i]; if (!p) return 'Spot '+(i+1); const dx=p.x+7, dz=p.z+6, d=Math.hypot(dx,dz); return (d<3?'Courtyard centre':(Math.abs(dz)>Math.abs(dx)?(dz<0?'North':'South'):(dx<0?'West':'East'))+' courtyard')+(p.y>0.3?' (raised)':'')+' · #'+(i+1); };
    switch(this.tab){
      case 'general':
        row('Room name', (()=>{ const i=el('input'); i.type='text'; i.maxLength=24; i.value=S.name; i.disabled=locked; i.onchange=()=>put('name',i.value); return i; })());
        row('Private room code', el('span','code-sm',esc(Net.room.code)), 'players join with this code');
        row('Max players', slider('maxPlayers',2,8,1,v=>v+' players'));
        row('Mode', drop('mode',[['dm','Deathmatch'],['gang','Gang Wars (teams)'],['backpack','The Fight for Za'],['fade','Run That Fade (1v1 fists)']]));
        if (S.mode==='fade') row('Run That Fade', el('span','muted','1v1 fist fights in an MMA cage. You pick the two fighters in the match (pause menu); everyone else waits on the benches and watches. Real players only, no bots, no weapons.'));
        if (S.mode!=='gang') row('Bots', toggle('botsOn'));
        if (S.mode==='gang') row('Bot difficulty', drop('difficulty',[['easy','Easy · 0.5× rewards'],['normal','Normal · 1×'],['hard','Hard · 1.5×'],['expert','Expert · 2×']]), 'bots per team are set in the GANG WARS tab');
        else if (S.botsOn){ row('Bot count', slider('bots',1,12,1,v=>v+' bots')); row('Bot difficulty', drop('difficulty',[['easy','Easy · 0.5× rewards'],['normal','Normal · 1×'],['hard','Hard · 1.5×'],['expert','Expert · 2×']])); }
        row('Teams', el('span','muted', S.mode==='gang' ? (S.teams||[]).map((t,i)=>teamTagOf(t)).join(' vs ')+' · edit them in the GANG WARS tab' : 'Free-for-all (pick Gang Wars for teams)'));
        break;
      case 'match':
        row('Time limit', slider('time',0,S.mode!=='backpack'?1800:1200,60,mins), '0 = unlimited');
        if (S.mode==='dm') row('Kill limit', slider('kills',0,100,5,v=>v===0?'Unlimited':v+' kills'), '0 = unlimited');
        if (S.mode==='gang') row('Gang kill limit', slider('kills',0,200,5,v=>v===0?'Unlimited':v+' kills'), 'first gang to this many kills wins · 0 = unlimited');
        row('Respawns', toggle('respawnOn'), S.respawnOn?'':'last one standing wins');
        if (S.respawnOn) row('Respawn delay', slider('respawnDelay',1,15,1,v=>v+' s'));
        row('Starting health', slider('hp',50,200,10,v=>v+' HP'));
        row('Starting stamina', slider('stamina',50,200,10,v=>v+'%'));
        if (S.mode==='dm') row('Tie on time-out', drop('tie',[['tie','Draw'],['deaths','Fewest deaths wins']]));
        if (S.mode==='gang') row('On time-out', el('span','muted','the gang with more kills wins (equal = draw)'));
        break;
      case 'loadout':
        row('Weapons allowed', checks('weapons', MODE_RULES[S.mode==='gang'?'dm':S.mode].firearms.map(w=>[w,WEAPON_DEFS[w].name])), 'the knife is always allowed');
        row('Starting weapon', drop('startWeapon',[['loadout','Each player\'s loadout'],['glock','Glock only'],['random','Random allowed weapon']]));
        row('Characters allowed', checks('chars', CHAR_ORDER.map(c=>[c,CHARACTERS[c].name])), 'others play as Masked Tracksuit');
        row('Consumables', toggle('items'), 'trunk loot, blunt, beer, Zyn');
        row('Tap the Nic (5-kill streak)', toggle('nic'));
        row('Character abilities (10-kill streak)', toggle('abilities'));
        row('Flash grenades at spawn', slider('flash',0,3,1,v=>String(v)));
        row('Landmines at spawn', slider('mines',0,3,1,v=>String(v)));
        break;
      case 'mode':
        if (S.mode==='gang'){ row('Score limit', slider('kills',0,200,5,v=>v===0?'Unlimited':v+' kills')); row('Time limit', slider('time',0,1800,60,mins)); row('Respawns', toggle('respawnOn'), S.respawnOn?'':'last gang standing wins');
          row('Friendly fire', toggle('friendlyFire'), 'team kills never score or pay'); row('Team switching', toggle('teamSwitch'), S.teamSwitch?'players may switch (applies when they respawn)':'teams are locked once the match starts');
          body.appendChild(this.teamEditor(S, locked, send)); }
        else if (S.mode==='dm'){ row('Kill limit', slider('kills',0,100,5,v=>v===0?'Unlimited':v+' kills')); row('Time limit', slider('time',0,1800,60,mins)); row('Respawns', toggle('respawnOn')); row('Starting weapon', drop('startWeapon',[['loadout','Each player\'s loadout'],['glock','Glock only'],['random','Random allowed weapon']])); }
        else {
          row('Win rule', drop('variant',[['hold','Most hold time (scored by hold time)'],['classic','Backpack hold: first to hold it long enough']]));
          if (S.variant==='hold') row('Match length', slider('time',60,1200,60,mins)); else row('Hold time to win', slider('classicHold',10,120,5,v=>v+' s'));
          row('Bag / backpack spawn', drop('zaStart',[['random','Random spot']].concat(validSpawns().map((p,i)=>[i,zaName(i)]))));
          row('Dropped bag', drop('respawn',[['drop','Stays where it fell'],['reset','Respawns after a delay']]));
          if (S.respawn==='reset') row('Respawn bag after', slider('resetAfter',5,120,5,v=>v+' s'));
          row('Player spawns', drop('spawns',[['all','All 15 points'],['far','Far from the bag']]));
          row('Bots can carry the bag', toggle('botsCarry'));
        }
        break;
      case 'rewards':
        row('XP rewards', drop('xpMul',[[1,'Normal'],[0.5,'Half'],[0,'Off']]), 'can be lowered, never raised');
        row('Cash rewards', drop('cashMul',[[1,'Normal'],[0.5,'Half'],[0,'Off']]), 'can be lowered, never raised');
        row('Reward rules', el('span','muted', this.rewardText(S)));
        break;
      case 'summary': body.appendChild(el('div','msu-sum',this.summary(S))); break;
    }
    const foot=el('div','row msu-foot');
    if (!locked){ const rs=el('button','','RESET TO DEFAULTS'); rs.onclick=()=>send(Object.assign(this.defaults(),{mode:S.mode,name:S.name})); foot.appendChild(rs); }
    foot.appendChild(el('span','muted', locked ? (Net.isHost?'Settings are locked while the match is running.':'Only the host can change these settings.') : 'Changes are checked by the server and sent to every player.'));
    wrap.appendChild(foot);
    if (this.tab!=='summary') wrap.appendChild(el('div','msu-sum small',this.summary(S)));
    return wrap;
  },
  // Gang Wars team editor (host only): 2-4 teams with name / colour / emblem / max players / bots / reward / starting gun;
  // players are assigned by dragging their chip onto a team or with the team buttons on each chip. The server re-checks all of it.
  teamEditor(S, locked, send){
    const T=(S.teams||[]).map(t=>Object.assign({},t)), A=Object.assign({},S.assign||{}), players=(Net.room&&Net.room.players)||[], wrap=el('div','teamed');
    const save=()=>{ if (!locked) send(Object.assign({},S,{teams:T, assign:A})); };
    const ctl=(lab, node)=>{ const d=el('div','tctl'); d.appendChild(el('small','',lab)); d.appendChild(node); return d; };
    const step=(v,lo,hi,f)=>{ const d=el('div','stepper'), m=el('button','','−'), p=el('button','','+'); m.disabled=p.disabled=locked; m.onclick=()=>f(Math.max(lo,v-1)); p.onclick=()=>f(Math.min(hi,v+1)); d.append(m, el('b','',String(v)), p); return d; };
    const sel=(v,opts,f)=>{ const d=el('select'); d.disabled=locked; for (const [k,t] of opts){ const o=el('option','',t); o.value=k; if (String(v)===String(k)) o.selected=true; d.appendChild(o); } d.onchange=()=>f(d.value); return d; };
    const cols=el('div','tcols');
    T.forEach((t,i)=>{
      const c=el('div','tcol'); c.style.borderColor=t.col;
      const nm=el('input'); nm.type='text'; nm.maxLength=16; nm.value=t.name; nm.disabled=locked; nm.onchange=()=>{ T[i].name=nm.value; save(); };
      const head=el('div','thead'); head.append(el('b','temb',t.emblem), nm); head.style.color=t.col; c.appendChild(head);
      const sw=el('div','tswatch'); for (const col of TEAM_COLS){ const b=el('button',col===t.col?'on':''); b.style.background=col; b.disabled=locked; b.title=col; b.onclick=()=>{ T[i].col=col; save(); }; sw.appendChild(b); } c.appendChild(ctl('Colour',sw));
      const em=el('div','tswatch'); for (const e of EMBLEMS){ const b=el('button',e===t.emblem?'on':'',e); b.disabled=locked; b.onclick=()=>{ T[i].emblem=e; save(); }; em.appendChild(b); } c.appendChild(ctl('Emblem',em));
      const grid=el('div','tgrid');
      grid.append(ctl('Max players',step(t.max,1,8,v=>{ T[i].max=v; save(); })), ctl('Bots',step(t.bots,0,6,v=>{ T[i].bots=v; save(); })),
        ctl('Rewards',sel(t.reward,[[1,'Normal'],[0.5,'Half'],[0,'Off']],v=>{ T[i].reward=+v; save(); })),
        ctl('Starts with',sel(t.start,[['loadout','Own loadout']].concat(S.weapons.filter(w=>WEAPON_SLOT[w]!=='melee').map(w=>[w,WEAPON_DEFS[w].name])),v=>{ T[i].start=v; save(); })));
      c.appendChild(grid);
      const list=el('div','tplayers'); list.dataset.team=i;
      const mine=players.filter(p=>A[p.id]===i);
      if (!mine.length) list.appendChild(el('span','muted small',locked?'—':'drop players here'));
      for (const p of mine) list.appendChild(chip(p));
      if (t.bots) list.appendChild(el('span','tbot',`+ ${t.bots} bot${t.bots>1?'s':''}`));
      if (mine.length>t.max) list.appendChild(el('span','warn small',`over the max (${t.max}) — extras join the smallest team`));
      list.ondragover=e=>{ if (!locked){ e.preventDefault(); list.classList.add('over'); } }; list.ondragleave=()=>list.classList.remove('over');
      list.ondrop=e=>{ e.preventDefault(); list.classList.remove('over'); const id=e.dataTransfer.getData('text/plain'); if (id){ A[id]=i; save(); } };
      c.appendChild(list);
      if (T.length>2 && !locked){ const rm=el('button','small','REMOVE TEAM'); rm.onclick=()=>{ T.splice(i,1); for (const k in A){ if (A[k]===i) delete A[k]; else if (A[k]>i) A[k]--; } save(); }; c.appendChild(rm); }
      cols.appendChild(c);
    });
    function chip(p){ const ch=el('div','pchip'); ch.draggable=!locked; ch.appendChild(el('span','',esc(p.name)));
      ch.ondragstart=e=>e.dataTransfer.setData('text/plain',p.id);
      if (!locked) T.forEach((t,i)=>{ if (A[p.id]===i) return; const b=el('button','',t.emblem); b.title='Move to '+t.name; b.style.color=t.col; b.onclick=()=>{ A[p.id]=i; save(); }; ch.appendChild(b); });
      if (!locked && A[p.id]!==undefined){ const x=el('button','','✕'); x.title='Auto (smallest team)'; x.onclick=()=>{ delete A[p.id]; save(); }; ch.appendChild(x); }
      return ch; }
    const un=players.filter(p=>A[p.id]===undefined), pool=el('div','tplayers pool'); pool.dataset.team='';
    pool.appendChild(el('small','',un.length?'Unassigned (join the team with the fewest players):':'Everyone is assigned — no random teams.'));
    for (const p of un) pool.appendChild(chip(p));
    pool.ondragover=e=>{ if (!locked) e.preventDefault(); }; pool.ondrop=e=>{ e.preventDefault(); const id=e.dataTransfer.getData('text/plain'); if (id){ delete A[id]; save(); } };
    wrap.appendChild(pool); wrap.appendChild(cols);
    if (T.length<4 && !locked){ const add=el('button','','+ ADD TEAM'); add.onclick=()=>{ const d=TEAM_DEFAULTS[T.length]; T.push(Object.assign({max:8,bots:0,reward:1,start:'loadout'},d)); save(); }; wrap.appendChild(add); }
    return wrap;
  },
  // pause menu: team switch buttons (only when the host allowed switching)
  pauseTeams(){ const box=document.getElementById('pteam'); if (!box) return; box.innerHTML='';
    if (!(this.inMatch && this.gang && this.settings && this.settings.teamSwitch)) return;
    GANGS.forEach((t,i)=>{ if (i===this.myTeam) return; const b=el('button','','SWITCH TO '+esc(teamTag(i))); b.style.color=t.col; b.onclick=()=>this.send({t:'team',team:i}); box.appendChild(b); }); },
  // the same reward rules the server applies (shown to everyone before the match starts; settings lock once it does)
  rewardText(S){ const R={easy:0.5,normal:1,hard:1.5,expert:2}, d=S.botsOn&&S.bots?R[S.difficulty]||1:1, f=S.hp<100?0.75:1, x=+(d*f).toFixed(2);
    return `Rewards ×${x}`+(d!==1?` (${S.difficulty} bots ×${d})`:S.botsOn&&S.bots?' (normal bots)':' (no bots)')+(f!==1?' · low health ×0.75':'')+(S.xpMul<1||S.cashMul<1?` · host: XP ×${S.xpMul}, cash ×${S.cashMul}`:'')+' · killing the same player over 3 times a minute pays nothing'; },
  summary(S){
    const t=S.time===0?'no time limit':Math.round(S.time/60)+' min';
    const head = S.mode==='gang' ? `Gang Wars · ${(S.teams||[]).map(teamTagOf).join(' vs ')}${S.friendlyFire?' · friendly fire':''} · ${S.kills?'first gang to '+S.kills+' kills':'no kill limit'} · ${t}` : S.mode==='dm' ? `Deathmatch · ${S.kills?S.kills+' kills':'no kill limit'} · ${t}` : `The Fight for Za · ${S.variant==='hold'?'most hold time · '+t:'hold '+S.classicHold+' s to win'}`;
    return `<b>${esc(S.name)}</b> — ${head} · ${S.botsOn?S.bots+' '+S.difficulty+' bots':'no bots'} · up to ${S.maxPlayers} players<br>
      ${S.respawnOn?'respawn after '+S.respawnDelay+' s':'no respawns'} · ${S.hp} HP · ${S.stamina}% stamina · weapons: ${S.weapons.map(w=>WEAPON_DEFS[w].name).join(', ')} + knife${S.unlocks==='all'?' (all unlocked)':''} · start: ${S.startWeapon}<br>
      characters: ${S.chars.map(c=>CHARACTERS[c].name).join(', ')} · consumables ${S.items?'on':'off'} · Nic ${S.nic?'on':'off'} · abilities ${S.abilities?'on':'off'} · ${S.flash} flash / ${S.mines} mines · XP ×${S.xpMul} · cash ×${S.cashMul}<br><b>${this.rewardText(S)}</b>`;
  },
  defaults(){ return {mode:'dm', name:(Settings.name||'PLAYER')+'\'s room', maxPlayers:8, botsOn:true, bots:3, difficulty:'normal', time:600, kills:20, tie:'tie', respawnOn:true, respawnDelay:4, hp:100, stamina:100,
    unlocks:'levels', startWeapon:'loadout', items:true, nic:true, abilities:true, flash:2, mines:1, xpMul:1, cashMul:1,
    variant:'hold', classicHold:30, spawns:'all', respawn:'drop', resetAfter:20, zaStart:'random', botsCarry:true}; },
};

// Regenerates server/shared.json from the live game data (open the game, run copy(exportSharedData()) in the console, paste into the file).
function exportSharedData(){
  const W={}; for (const id of [...FIREARMS,'knife','fists','taser']){ const d=WEAPON_DEFS[id]; W[id]={kind:d.kind, slot:WEAPON_SLOT[id], mag:d.mag||0, reserve:d.reserve||0, rpm:d.rpm||0, dmg:d.dmg, heavyDmg:d.heavyDmg, headMul:d.headMul||1, range:d.range, falloff:d.falloff||null, reloadTime:d.reloadTime||0, reload1:d.reload1||0, stun:d.stun||0, pellets:d.pellets||1, rate:d.rate||0, fist:!!d.fist, heavyMin:d.heavyMin||0, heavyRate:d.heavyRate||0, charge:d.charge||0}; }
  W.glock.switchRpm=GLOCK_SWITCH_RPM;
  const att=Object.fromEntries(Object.entries(ATTACHMENTS).filter(([k,A])=>A.mods.cap).map(([k,A])=>[k,{for:A.for, cap:A.mods.cap}]));
  const arena={o:ARENA.o, mat:ARENA.mat, fenceR:ARENA.fenceR, corners:ARENA.corners.map(c=>c.map(v=>+v.toFixed(3))), spots:ARENA.spots};
  return JSON.stringify({version:GAME_VERSION, weapons:W, prog:PROG, att, arena, abilities:CHAR_ABILITIES, characters:Object.fromEntries(Object.entries(CHARACTERS).map(([k,c])=>[k,{price:c.price||0}])), perks:PERKS,
    items:ITEMS, loot:LOOT_TABLE, spawns:SPAWN_POINTS.map(s=>[+s[0].toFixed(2),+s[1].toFixed(2),+(s[2]||0).toFixed(3)]), zaSpawns:ZA_SPAWNS.filter(p=>p.y>0.3||pointFree(p.x,p.z,0.15,1.6,0.5)), modes:MODE_RULES,
    matchDefaults:MATCH_DEFAULTS, zaDefaults:ZA_DEFAULTS,
    colliders:colliders.filter(c=>!c.nb && !c.glass).concat(bulletCols).map(c=>[+c.cx.toFixed(3),+c.cz.toFixed(3),+c.hx.toFixed(3),+c.hz.toFixed(3),+c.y0.toFixed(3),+c.y1.toFixed(3),+c.yaw.toFixed(4)]),   // what stops bullets (see-through fence bodies excluded, their posts/rails included)
    rides:Rides.list.map(v=>({id:v.id, kind:v.kind, x:+v.pos.x.toFixed(2), z:+v.pos.z.toFixed(2), yaw:+v.home.yaw.toFixed(3)})),   // parking spots after validation (same as Rides.reset)
    cars:interactCars.map(c=>({name:c.name, x:+c.F.x.toFixed(2), z:+c.F.z.toFixed(2)})),
    trunks:searchables.map((s,i)=>{ const [x,z]=toWorld(s.F,-s.L/2-0.7,0); return {id:i, x:+x.toFixed(2), z:+z.toFixed(2)}; })});
}
