'use strict';
/* Online private matches (client side). Talks to the O-Block game server (server/server.js) over WebSocket.
   Nothing here decides anything: health, damage, kills, respawns, the bag, hold times, rewards, purchases and loot
   all come back from the server. Without a server address this module does nothing and the lobby says so — it never
   fakes players, rooms or a connection.
   Note: browsers only allow a secure page (https) to open secure sockets (wss://). A page served over https can't
   reach a plain ws:// server, and some hosting sandboxes block outside connections entirely. */
const NET_CFG = { stateHz:20, botHz:10, interp:0.12 };

class RemoteEnt {
  constructor(d){
    this.id=d.id; this.kind=d.kind; this.name=d.name; this.dev=d.tag==='DEV'; this.char=d.char; this.w=d.w; this.alive=true; this.hp=d.hp||100; this.kills=0; this.deaths=0;
    this.pos=new V3(...(d.pos||[0,0,0])); this.tpos=this.pos.clone(); this.yaw=d.yaw||0; this.tyaw=this.yaw; this.pitch=0; this.vel=new V3(); this.crouch=false; this.speed=0;
    this.rig=buildCharacter({char:CHARACTERS[d.char]?d.char:'tracksuit', jacket:pick(JACKET_COLORS)[0], pants:pick(PANTS_COLORS)[0]}); scene.add(this.rig.root); Thermal.tagBot(this.rig);
    this.label=makeLabel(); this.rig.root.add(this.label.s); this.setWeapon(d.w); this.drawLabel();
  }
  setWeapon(w){ if (this.weapon) this.rig.weaponSlot.remove(this.weapon.model); this.w=w; this.weapon=createWeapon(w, STOCK_CONFIG(w)); this.rig.weaponSlot.add(this.weapon.model); }
  drawLabel(){ const g=this.label.c.getContext('2d'); g.clearRect(0,0,128,36); g.fillStyle='rgba(0,0,0,.55)'; g.fillRect(4,2,120,32);
    g.fillStyle=this.kind==='bot'?'#ffcf3f':'#7fd0ff'; g.font='bold 13px sans-serif'; g.textAlign='center'; g.fillText(this.name,64,15);
    g.fillStyle='#999'; g.font='9px sans-serif'; g.fillText(this.kind==='bot'?'BOT':'PLAYER',108,15);
    g.fillStyle='#333'; g.fillRect(14,21,100,7); g.fillStyle='#4fd06a'; g.fillRect(14,21,Math.max(0,Math.min(100,this.hp)),7);
    if (this.dev){ g.fillStyle='#c0262b'; g.fillRect(6,4,26,11); g.fillStyle='#fff'; g.font='bold 8px sans-serif'; g.fillText('DEV',19,12); } this.label.tex.needsUpdate=true; }
  snap(a){ this.tpos.set(a[1],a[2],a[3]); this.tyaw=a[4]; this.pitch=a[5]; if (a[6]!==this.w) this.setWeapon(a[6]); const alive=!!a[7]; if (alive && !this.alive) this.pos.copy(this.tpos); this.alive=alive; if (Math.round(this.hp)!==a[8]){ this.hp=a[8]; this.drawLabel(); } this.kills=a[9]; this.deaths=a[10]; this.crouch=!!(a[12]&1); }
  update(dt){
    const prev=this.pos.clone(); this.pos.lerp(this.tpos, 1-Math.exp(-dt/NET_CFG.interp)); this.vel.copy(this.pos).sub(prev).divideScalar(Math.max(dt,1e-3)); this.speed=Math.hypot(this.vel.x,this.vel.z);
    this.yaw+=angleDiff(this.tyaw,this.yaw)*Math.min(1,dt*12);
    const rg=this.rig; rg.root.visible=this.alive; if (!this.alive) return;
    rg.root.position.copy(this.pos); rg.root.rotation.y=this.yaw; this.label.s.visible=this.pos.distanceTo(camera.position)<40;
    const inv=this.vel.clone().applyAxisAngle(new V3(0,1,0),-this.yaw);
    animateCharacter(rg,{speed:this.speed, moveX:inv.x, moveZ:inv.z, sprint:this.speed>6, crouch:this.crouch, pitch:this.pitch, hold:{weapon:this.weapon, firing:true}}, dt);
  }
  chest(){ return new V3(this.pos.x, this.pos.y+(this.crouch?0.8:1.15), this.pos.z); }
  rayHit(o,dir,maxT){ return Bot.prototype.rayHit.call(this,o,dir,maxT); }
  remove(){ scene.remove(this.rig.root); }
}

const Net = {
  ws:null, url:null, connected:false, id:null, room:null, inMatch:false, isHost:false, ents:new Map(), dev:false, profile:null, lastSt:0, lastBots:0, err:'', za:null, clock:0,
  token(){ let t=Store.get('netToken',null); if (!t){ t=Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join(''); Store.set('netToken',t); } return t; },
  connect(url){
    this.close(); this.err=''; this.url=url;
    let ws; try { ws=new WebSocket(url); } catch(e){ this.err='Could not open a connection: '+e.message; Lobby.render(); return; }
    this.ws=ws; Lobby.render('Connecting to '+url+' …');
    const to=setTimeout(()=>{ if (!this.connected){ this.err='No answer from '+url+' (is the server running, and is the address right?)'; try{ ws.close(); }catch(e){} Lobby.render(); } }, 6000);
    ws.onopen=()=>{ clearTimeout(to); this.connected=true; this.send({t:'hello', token:this.token(), name:Settings.name||'PLAYER', char:CharLook.char, weapon:Loadout.firearm, tag:Dev.showTag()?'DEV':''}); };
    ws.onclose=()=>{ clearTimeout(to); const was=this.connected; this.connected=false; this.room=null; if (this.inMatch) this.leaveMatch('Connection to the server was lost'); ProfileAuthority.useRemote(null); if (was) this.err='Disconnected from the server.'; Lobby.render(); UI.menuInfo(); };
    ws.onerror=()=>{ this.err='Connection failed. Check the address; an https page needs a wss:// server, and some hosts block outside connections.'; Lobby.render(); };
    ws.onmessage=ev=>{ let m; try { m=JSON.parse(ev.data); } catch(e){ return; } this.onMessage(m); };
  },
  close(){ if (this.ws){ try{ this.ws.close(); }catch(e){} } this.ws=null; this.connected=false; },
  send(m){ if (this.ws && this.ws.readyState===1) this.ws.send(JSON.stringify(m)); },
  // developer sign-in: the server checks the password against its private DEV_PASSWORD (nothing is stored here)
  devAuth(pw){ return new Promise(res=>{ this._devCb=res; this.send({t:'devauth', pw}); setTimeout(()=>{ if (this._devCb===res){ this._devCb=null; res({ok:false, why:'no answer from the server'}); } },5000); }); },
  online(){ return this.inMatch; },
  // everything the local game can shoot at besides the host's own bots
  targets(){ const out=[]; for (const e of this.ents.values()) if (e.alive) out.push(e); return out; },
  netIdOf(t){ return t===P ? this.id : t.netId || t.id; },
  entityById(id){ if (id===this.id) return P; const b=Bots.list.find(x=>x.netId===id); return b || this.ents.get(id) || null; },
  onMessage(m){
    switch(m.t){
      case 'devauth': { const cb=this._devCb; this._devCb=null; if (m.ok) this.dev=true; if (cb) cb({ok:!!m.ok, remote:true, why:m.ok?'':m.why}); break; }
      case 'welcome': this.id=m.id; this.dev=m.dev; ProfileAuthority.useRemote(m.profile); Lobby.render(); UI.menuInfo(); break;
      case 'profile': ProfileAuthority.useRemote(m.profile); if (m.xp) Bus.emit('xp',{n:m.xp, why:m.why}); if (m.cash) Bus.emit('cash',{n:m.cash, why:m.why}); if (m.bought) Bus.emit('toast',{t:'PURCHASED · '+m.bought.toUpperCase(),kind:'ok'}); UI.menuInfo(); break;
      case 'room': this.room=m; this.isHost=m.host===this.id; Lobby.render(); break;
      case 'error': this.err=m.why; Lobby.render(); break;
      case 'reject': if (m.what!=='hits') Bus.emit('toast',{t:'SERVER: '+m.what.toUpperCase()+' REJECTED · '+m.why.toUpperCase(),kind:'warn'}); else this.rejected=(this.rejected||0)+1; break;
      case 'start': this.startMatch(m); break;
      case 'snap': this.snap(m); break;
      case 'hit': this.onHit(m); break;
      case 'kill': this.onKill(m); break;
      case 'respawn': this.onRespawn(m); break;
      case 'shotfx': { const e=this.entityById(m.by); if (e && e!==P && m.o){ const o=new V3(...m.o); Snd.shot(m.w,{pos:o, suppressed:m.sup}); if (m.e) FX.tracer(o,new V3(...m.e),'#ffb070'); if (!m.sup) Pings.add(o); } break; }
      case 'carrier': { const n=m.id===this.id?'YOU':(this.entityById(m.id)||{}).name; Bus.emit('toast',{t:(n||'SOMEONE')+(n==='YOU'?' HAVE':' HAS')+' THE BAG',kind:'obj'}); break; }
      // the server counted the 10-kill streak (abready) and validated the activation (ability); mirror its state here
      case 'glass': { const g=Glass.panes[m.id|0]; if (g) Glass.shatter(g, null, false); break; }   // someone else broke a window
      case 'abready': { const sid = m.id===this.id ? 'player' : (()=>{ const b=Bots.list.find(x=>x.netId===m.id); return b?'bot'+b.i:null; })(); if (!sid) break;
        StreakAuthority.st(sid).ab.ready=true; if (sid==='player') Perks.abilityReady(); break; }
      case 'ability': { const own=m.id===this.id, b=own?null:Bots.list.find(x=>x.netId===m.id), sid=own?'player':b?'bot'+b.i:null;
        if (sid){ const st=StreakAuthority.st(sid); st.ab.ready=false; st.ab.active=true; }
        if (own){ Perks.abWas=true; if (m.hp) P.hp=m.hp; const A=StreakAuthority.ability('player'); if (A&&A.hpMul) setBloodHoundLook(true); } else if (b){ b.abWas=true; b.hp=m.hp; b.drawLabel(); }
        Bus.emit('toast',{t:(own?'':((this.entityById(m.id)||{}).name||'')+' · ')+m.name+' ACTIVE',kind:own?'kill':'warn'}); break; }
      case 'loot': P.items.beer=m.items.beer; P.items.blunt=m.items.blunt; P.items.zyn=m.items.zyn; { const a=Arsenal.ammo[Arsenal.firearm]; if (a) a.res=m.res; } Bus.emit('loot',{found:m.found}); break;
      case 'used': P.hp=m.hp; P.items.beer=m.items.beer; P.items.blunt=m.items.blunt; P.items.zyn=m.items.zyn; break;
      case 'carhop': if (m.profile) ProfileAuthority.useRemote(m.profile); Bus.emit(m.wait?'toast':'carhop', m.wait?{t:'NOTHING LEFT IN THIS CAR · '+m.wait+'s',kind:''}:m.amount); break;
      case 'correct': P.pos.set(...m.pos); break;
      case 'tag': { const e=this.ents.get(m.id); if (e){ e.dev=m.dev; e.drawLabel(); } break; }
      case 'left': { const e=this.ents.get(m.id); if (e){ e.remove(); this.ents.delete(m.id); } break; }
      case 'end': this.onEnd(m); break;
    }
  },
  // ---- match lifecycle
  startMatch(m){
    this.inMatch=true; this.matchId=m.matchId; this.settings=m.settings; this.za=null; this.clock=0; this.rejected=0;
    for (const e of this.ents.values()) e.remove(); this.ents.clear();
    const st=m.settings, mine=new Set(); let bi=0;
    // the host runs the bots (AI needs the 3D scene); the server owns their health
    if (st.mode==='backpack'){ this.zaBackup=Object.assign({},ZARules); Object.assign(ZARules, {variant:st.variant, time:st.time, classicHold:st.classicHold, spawns:st.spawns, respawn:st.respawn, resetAfter:st.resetAfter, difficulty:st.difficulty, bots:this.isHost?st.bots:0}); }
    else { this.mrBackup=Object.assign({},MatchRules); Object.assign(MatchRules, {time:st.time, kills:st.kills, tie:st.tie, difficulty:st.difficulty, bots:this.isHost?st.bots:0}); }
    Game.startMatch(st.mode, true);
    for (const d of m.ents){
      if (d.id===this.id){ P.pos.set(...d.pos); P.yaw=d.yaw;
        // the server applied the room rules: start weapon and an allowed character
        if (d.w && d.w!==Arsenal.firearm && FIREARMS.includes(d.w)){ Arsenal.firearm=d.w; Arsenal.ammo={}; Arsenal.cur=null; Arsenal.equip(d.w,true); }
        if (d.char && d.char!==CharLook.char){ this.lookBackup=Object.assign({},CharLook); Object.assign(CharLook,{char:d.char},CHARACTERS[d.char].defaults); Game.applyCharacter(); Bus.emit('toast',{t:'CHARACTER NOT ALLOWED IN THIS ROOM · PLAYING AS '+CHARACTERS[d.char].name,kind:'warn'}); }
        continue; }
      if (d.kind==='bot' && this.isHost){ const b=Bots.list[bi++]; if (b){ b.netId=d.id; b.name=d.name; b.pos.set(...d.pos); b.drawLabel(); mine.add(d.id); } continue; }
      this.ents.set(d.id, new RemoteEnt(d));
    }
    Game.state='playing'; UI.show(null);
  },
  leaveMatch(why){ this.inMatch=false; for (const e of this.ents.values()) e.remove(); this.ents.clear();
    if (this.lookBackup){ Object.assign(CharLook,this.lookBackup); this.lookBackup=null; Game.applyCharacter(); }
    if (this.zaBackup){ Object.assign(ZARules,this.zaBackup); this.zaBackup=null; } if (this.mrBackup){ Object.assign(MatchRules,this.mrBackup); this.mrBackup=null; }
    if (why) Bus.emit('toast',{t:why.toUpperCase(),kind:'warn'}); },
  snap(m){
    this.clock=m.clock; Mode.clock=m.clock;
    for (const a of m.ents){
      if (a[0]===this.id){ P.kills=a[9]; P.deaths=a[10]; if (Math.abs(P.hp-a[8])>1 && P.alive) P.hp=a[8]; continue; }
      const b=Bots.list.find(x=>x.netId===a[0]); if (b){ b.kills=a[9]; b.deaths=a[10]; continue; }
      const e=this.ents.get(a[0]); if (e) e.snap(a);
    }
    if (m.za){ this.za=m.za; const s=BackpackAuthority.s; if (s){ const toLocal=id=> id===this.id ? 'player' : id; s.carrier=m.za.carrier?toLocal(m.za.carrier):null; s.x=m.za.x; s.y=m.za.y; s.z=m.za.z; s.atHome=m.za.atHome; s.hold={}; for (const k in m.za.hold) s.hold[toLocal(k)]=m.za.hold[k]; } }
  },
  onHit(m){
    const t=this.entityById(m.target);
    if (m.by===this.id) { Bus.emit('hit',{head:m.head, kill:m.hp<=0}); Snd.hitmarker(m.head); }
    if (t===P){ P.hp=m.hp; P.lastHurt=performance.now()/1000; Snd.hurt(); const src=this.entityById(m.by); let ang=0; if (src&&src.pos){ ang=Math.atan2(-(src.pos.x-P.pos.x),-(src.pos.z-P.pos.z))-P.yaw; } Bus.emit('hurt',{n:m.dmg, ang}); }
    else if (t instanceof Bot){ t.hp=m.hp; t.drawLabel(); t.lastHurt=performance.now()/1000; const src=this.entityById(m.by); if (src && !t.target){ t.target=src; } }
    else if (t){ t.hp=m.hp; t.drawLabel(); }
  },
  onKill(m){
    const t=this.entityById(m.target), k=this.entityById(m.by), wn=WEAPON_DEFS[m.w]?WEAPON_DEFS[m.w].name:'—';
    const nm=e=>e===P?'YOU':e?e.name:'—';
    if (k===P) Bus.emit('kill',{victim:nm(t), weapon:wn, head:m.head}); else Bus.emit('killfeed',{killer:nm(k), victim:nm(t), weapon:wn});
    if (t===P) killPlayer(nm(k));
    else if (t instanceof Bot){ t.alive=false; t.deadT=0; t.label.s.visible=false; Corpses.spawn(t.rig,new V3(0,0,1)); t.rig.root.visible=false; t.target=null; }
    else if (t){ t.alive=false; Corpses.spawn(t.rig,new V3(0,0,1)); t.rig.root.visible=false; }
    if (m.by===this.id){ const s=StreakAuthority.kill('player'); }
  },
  onRespawn(m){
    if (m.id===this.id){ P.pos.set(...m.pos); P.yaw=m.yaw; P.vel.set(0,0,0); P.hp=m.hp; P.alive=true; P.crouch=false; P.prone=false; P.stamina=staminaMax(); P.exhausted=false; P.bluntCap=false; Arsenal.reset(); Bus.emit('respawn'); return; }
    const b=Bots.list.find(x=>x.netId===m.id); if (b){ b.respawn(); b.pos.set(...m.pos); b.yaw=m.yaw; b.hp=m.hp; b.drawLabel(); return; }
    const e=this.ents.get(m.id); if (e){ e.pos.set(...m.pos); e.tpos.set(...m.pos); e.alive=true; e.hp=m.hp; e.drawLabel(); }
  },
  onEnd(m){
    const nm=id=> id==='TIE' ? 'TIE' : id===this.id ? 'YOU' : ((this.entityById(id)||{}).name||'?');
    this.endRows=m.rows; Game.rewards=m.rewards; ProfileAuthority.useRemote(m.profile);
    Mode.end(nm(m.winner));
  },
  // ---- per frame: own state at 20 Hz, the host's bots at 10 Hz, remote interpolation
  update(dt){
    if (!this.inMatch) return;
    const now=performance.now();
    if (now-this.lastSt>1000/NET_CFG.stateHz && P.alive){ this.lastSt=now; this.send({t:'st', p:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)], yaw:+P.yaw.toFixed(3), pitch:+P.pitch.toFixed(3), f:(P.crouch||P.prone)?1:0}); }
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
  open(){ this.render(); },
  leave(){ if (Net.room) Net.send({t:'leave'}); Net.room=null; },
  render(status){
    const box=document.getElementById('on-body'); if (!box || Game.state!=='online') return;
    const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    let h='';
    if (!Net.connected){
      h+=`<div class="note">Online private matches need the <b>O-Block game server</b> (the <code>server/</code> folder that comes with the game: <code>npm install</code>, then <code>node server.js</code>). Enter its address below. There is no public server built in, and this screen never pretends to be connected.<br><small>An https page can only reach a <code>wss://</code> server; some hosting sandboxes block outside connections completely.</small></div>
        <div class="row"><input type="text" id="on-url" placeholder="ws://localhost:8787" value="${esc(Settings.server||'')}"><button class="primary" id="on-connect">CONNECT</button></div>
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
      document.getElementById('on-create').onclick=()=>{ Net.err=''; Net.send({t:'loadout', char:CharLook.char, weapon:Loadout.firearm}); Net.send({t:'create', settings:this.defaults()}); };
      document.getElementById('on-join').onclick=()=>{ Net.err=''; Net.send({t:'loadout', char:CharLook.char, weapon:Loadout.firearm}); Net.send({t:'join', code:document.getElementById('on-code').value}); };
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
    const T=[['general','ROOM'],['match','MATCH'],['loadout','WEAPONS & GEAR'],['mode',S.mode==='dm'?'DEATHMATCH':'ZA / BAG'],['rewards','REWARDS'],['summary','SUMMARY']];
    for (const [k,l] of T){ const b=el('button',this.tab===k?'on':'',l); b.onclick=()=>{ this.tab=k; this.render(); }; tabs.appendChild(b); }
    wrap.appendChild(tabs); wrap.appendChild(body);
    const put=(k,v)=>{ if (locked) return; const n=Object.assign({},S,{[k]:v}); if (k==='mode'){ n.time=v==='dm'?600:300; delete n.weapons; } send(n); };
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
        row('Mode', drop('mode',[['dm','Deathmatch'],['backpack','The Fight for Za']]));
        row('Bots', toggle('botsOn'));
        if (S.botsOn){ row('Bot count', slider('bots',1,12,1,v=>v+' bots')); row('Bot difficulty', drop('difficulty',[['easy','Easy'],['normal','Normal'],['hard','Hard']])); }
        row('Teams', el('span','muted','Free-for-all only — this build has no team modes, so team and friendly-fire options are not offered'));
        break;
      case 'match':
        row('Time limit', slider('time',0,S.mode==='dm'?1800:1200,60,mins), '0 = unlimited');
        if (S.mode==='dm') row('Kill limit', slider('kills',0,100,5,v=>v===0?'Unlimited':v+' kills'), '0 = unlimited');
        row('Respawns', toggle('respawnOn'), S.respawnOn?'':'last one standing wins');
        if (S.respawnOn) row('Respawn delay', slider('respawnDelay',1,15,1,v=>v+' s'));
        row('Starting health', slider('hp',50,200,10,v=>v+' HP'));
        row('Starting stamina', slider('stamina',50,200,10,v=>v+'%'));
        if (S.mode==='dm') row('Tie on time-out', drop('tie',[['tie','Draw'],['deaths','Fewest deaths wins']]));
        break;
      case 'loadout':
        row('Weapons allowed', checks('weapons', MODE_RULES[S.mode].firearms.map(w=>[w,WEAPON_DEFS[w].name])), 'the knife is always allowed');
        row('Weapon unlocks', drop('unlocks',[['levels','Respect each player\'s level'],['all','Everything unlocked in this room']]));
        row('Starting weapon', drop('startWeapon',[['loadout','Each player\'s loadout'],['glock','Glock only'],['random','Random allowed weapon']]));
        row('Characters allowed', checks('chars', CHAR_ORDER.map(c=>[c,CHARACTERS[c].name])), 'others play as Masked Tracksuit');
        row('Consumables', toggle('items'), 'trunk loot, blunt, beer, Zyn');
        row('Tap the Nic (5-kill streak)', toggle('nic'));
        row('Character abilities (10-kill streak)', toggle('abilities'));
        row('Flash grenades at spawn', slider('flash',0,3,1,v=>String(v)));
        row('Landmines at spawn', slider('mines',0,3,1,v=>String(v)));
        break;
      case 'mode':
        if (S.mode==='dm'){ row('Kill limit', slider('kills',0,100,5,v=>v===0?'Unlimited':v+' kills')); row('Time limit', slider('time',0,1800,60,mins)); row('Respawns', toggle('respawnOn')); row('Starting weapon', drop('startWeapon',[['loadout','Each player\'s loadout'],['glock','Glock only'],['random','Random allowed weapon']])); }
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
  summary(S){
    const t=S.time===0?'no time limit':Math.round(S.time/60)+' min';
    const head = S.mode==='dm' ? `Deathmatch · ${S.kills?S.kills+' kills':'no kill limit'} · ${t}` : `The Fight for Za · ${S.variant==='hold'?'most hold time · '+t:'hold '+S.classicHold+' s to win'}`;
    return `<b>${esc(S.name)}</b> — ${head} · ${S.botsOn?S.bots+' '+S.difficulty+' bots':'no bots'} · up to ${S.maxPlayers} players<br>
      ${S.respawnOn?'respawn after '+S.respawnDelay+' s':'no respawns'} · ${S.hp} HP · ${S.stamina}% stamina · weapons: ${S.weapons.map(w=>WEAPON_DEFS[w].name).join(', ')} + knife${S.unlocks==='all'?' (all unlocked)':''} · start: ${S.startWeapon}<br>
      characters: ${S.chars.map(c=>CHARACTERS[c].name).join(', ')} · consumables ${S.items?'on':'off'} · Nic ${S.nic?'on':'off'} · abilities ${S.abilities?'on':'off'} · ${S.flash} flash / ${S.mines} mines · XP ×${S.xpMul} · cash ×${S.cashMul}`;
  },
  defaults(){ return {mode:'dm', name:(Settings.name||'PLAYER')+'\'s room', maxPlayers:8, botsOn:true, bots:3, difficulty:'normal', time:600, kills:20, tie:'tie', respawnOn:true, respawnDelay:4, hp:100, stamina:100,
    unlocks:'levels', startWeapon:'loadout', items:true, nic:true, abilities:true, flash:2, mines:1, xpMul:1, cashMul:1,
    variant:'hold', classicHold:30, spawns:'all', respawn:'drop', resetAfter:20, zaStart:'random', botsCarry:true}; },
};

// Regenerates server/shared.json from the live game data (open the game, run copy(exportSharedData()) in the console, paste into the file).
function exportSharedData(){
  const W={}; for (const id of [...FIREARMS,'knife']){ const d=WEAPON_DEFS[id]; W[id]={kind:d.kind, mag:d.mag||0, reserve:d.reserve||0, rpm:d.rpm||0, dmg:d.dmg, heavyDmg:d.heavyDmg, headMul:d.headMul||1, range:d.range, falloff:d.falloff||null, reloadTime:d.reloadTime||0, pellets:d.pellets||1, rate:d.rate||0}; }
  W.glock.switchRpm=GLOCK_SWITCH_RPM;
  return JSON.stringify({version:GAME_VERSION, weapons:W, prog:PROG, abilities:CHAR_ABILITIES, characters:Object.fromEntries(Object.entries(CHARACTERS).map(([k,c])=>[k,{price:c.price||0}])), perks:PERKS,
    items:ITEMS, loot:LOOT_TABLE, spawns:SPAWN_POINTS.map(s=>[+s[0].toFixed(2),+s[1].toFixed(2),+(s[2]||0).toFixed(3)]), zaSpawns:ZA_SPAWNS.filter(p=>p.y>0.3||pointFree(p.x,p.z,0.15,1.6,0.5)), modes:MODE_RULES,
    matchDefaults:MATCH_DEFAULTS, zaDefaults:ZA_DEFAULTS,
    colliders:colliders.filter(c=>!c.nb && !c.glass).concat(bulletCols).map(c=>[+c.cx.toFixed(3),+c.cz.toFixed(3),+c.hx.toFixed(3),+c.hz.toFixed(3),+c.y0.toFixed(3),+c.y1.toFixed(3),+c.yaw.toFixed(4)]),   // what stops bullets (see-through fence bodies excluded, their posts/rails included)
    cars:interactCars.map(c=>({name:c.name, x:+c.F.x.toFixed(2), z:+c.F.z.toFixed(2)})),
    trunks:searchables.map((s,i)=>{ const [x,z]=toWorld(s.F,-s.L/2-0.7,0); return {id:i, x:+x.toFixed(2), z:+z.toFixed(2)}; })});
}
