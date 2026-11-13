'use strict';
/* Map module — the existing O-Block map (preserved), plus lighting hooks,
   climbable fences and ladder data. */
// ---------- Textures (all generated, low-res) ----------
function canvasTex(w, h, draw, repeat=true){
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function noise(g, w, h, amt){
  const id = g.getImageData(0,0,w,h), d = id.data;
  for (let i=0;i<d.length;i+=4){ const n=(rnd()-0.5)*amt; d[i]+=n; d[i+1]+=n; d[i+2]+=n; }
  g.putImageData(id,0,0);
}
function blotches(g, w, h, n, colors, rmin, rmax){
  for (let i=0;i<n;i++){ g.fillStyle = pick(colors); g.beginPath(); g.arc(rnd()*w, rnd()*h, rr(rmin,rmax), 0, PI*2); g.fill(); }
}
function streaks(g, w, h, n){
  for (let i=0;i<n;i++){
    const x=rnd()*w, y=rnd()*h, l=rr(h*0.08,h*0.4);
    const gr=g.createLinearGradient(0,y,0,y+l); gr.addColorStop(0,'rgba(25,20,15,0.32)'); gr.addColorStop(1,'rgba(25,20,15,0)');
    g.fillStyle=gr; g.fillRect(x,y,rr(2,6),l);
  }
}
function drawWindow(g, x, y, w, h, e){
  const r = rnd();
  if (e && r < 0.48 && rnd() < 0.42){ e.fillStyle = pick(['#ffd79a','#ffc77a','#fff0c8','#9fd0ff']); e.fillRect(x+1,y+1,w-2,h-2); }
  g.fillStyle='#2f2b26'; g.fillRect(x-3,y-3,w+6,h+6);
  g.fillStyle='#8c877b'; g.fillRect(x-4,y+h+2,w+8,4);
  if (r < 0.48){
    const gr=g.createLinearGradient(x,y,x+w,y+h); gr.addColorStop(0,'#62717a'); gr.addColorStop(1,'#262c31');
    g.fillStyle=gr; g.fillRect(x,y,w,h);
    if (rnd()<0.45){ g.fillStyle=pick(['rgba(190,170,130,.65)','rgba(120,40,40,.6)','rgba(200,200,190,.55)']); g.fillRect(x+2,y+2,w*rr(.3,.5),h-4); }
    g.fillStyle='#3f3c35'; g.fillRect(x+w/2-1,y,2,h); g.fillRect(x,y+h*0.42,w,2);
  } else if (r < 0.74){
    g.fillStyle='#0e0e0e'; g.fillRect(x,y,w,h);
    g.fillStyle='rgba(95,112,120,.85)';
    for (let i=0;i<3;i++){ const side = i%2? x+w : x; g.beginPath(); g.moveTo(side,y+rnd()*h); g.lineTo(x+rnd()*w,y+rnd()*h); g.lineTo(side,y+rnd()*h); g.fill(); }
    g.fillStyle='#3f3c35'; g.fillRect(x+w/2-1,y,2,h);
  } else if (r < 0.93){
    g.fillStyle='#7b6448'; g.fillRect(x,y,w,h);
    g.fillStyle='rgba(0,0,0,.35)'; for (let k=1;k<4;k++) g.fillRect(x,y+k*h/4,w,1.5);
    g.fillStyle='rgba(255,255,255,.08)'; g.fillRect(x,y,w,3);
    g.fillStyle='#2a2a2a'; for (let k=0;k<4;k++){ g.fillRect(x+2,y+k*h/4+3,2,2); g.fillRect(x+w-4,y+k*h/4+3,2,2); }
  } else {
    g.fillStyle='#141210'; g.fillRect(x,y,w,h);
    const gr=g.createLinearGradient(0,y,0,y-26); gr.addColorStop(0,'rgba(10,8,6,.7)'); gr.addColorStop(1,'rgba(10,8,6,0)');
    g.fillStyle=gr; g.fillRect(x-4,y-26,w+8,26);
  }
}
function makeFacade(base, brick){
  // 8 bays x 4 floors, each 3m x 3m -> 64px. Wraps every 24m x 12m.
  // Also paints a matching emissive map: lit apartment windows at night.
  const ec = document.createElement('canvas'); ec.width=512; ec.height=256;
  const e = ec.getContext('2d'); e.fillStyle='#000'; e.fillRect(0,0,512,256);
  const t = canvasTex(512,256,(g,w,h)=>{
    g.fillStyle=base; g.fillRect(0,0,w,h);
    if (brick){ g.fillStyle='rgba(0,0,0,.12)'; for(let y=0;y<h;y+=6){ g.fillRect(0,y,w,1); for(let x=(y/6)%2?0:7;x<w;x+=14) g.fillRect(x,y,1,6);} }
    noise(g,w,h,30);
    blotches(g,w,h,40,['rgba(40,35,28,.08)','rgba(255,250,240,.05)'],8,30);
    for (let f=0;f<4;f++){ g.fillStyle='rgba(0,0,0,.2)'; g.fillRect(0,f*64+61,w,3); g.fillStyle='rgba(255,255,255,.07)'; g.fillRect(0,f*64+58,w,2); }
    for (let f=0;f<4;f++) for (let b=0;b<8;b++) drawWindow(g, b*64+14, f*64+11, 36, 36, e);
    streaks(g,w,h,45);
  });
  const et = new THREE.CanvasTexture(ec); et.wrapS = et.wrapT = THREE.RepeatWrapping;
  t.emi = et; return t;
}
function makeGroundFloor(base, brick){
  // 8 bays x 1 floor (24m x 3m). Steel door in bay 3.
  return canvasTex(512,64,(g,w,h)=>{
    g.fillStyle=base; g.fillRect(0,0,w,h);
    if (brick){ g.fillStyle='rgba(0,0,0,.12)'; for(let y=0;y<h;y+=6){ g.fillRect(0,y,w,1); for(let x=(y/6)%2?0:7;x<w;x+=14) g.fillRect(x,y,1,6);} }
    noise(g,w,h,34);
    for (let b=0;b<8;b++){
      const x=b*64;
      if (b===3){
        g.fillStyle='#2b2b29'; g.fillRect(x+15,10,34,54);
        g.fillStyle='#4b5650'; g.fillRect(x+18,13,28,51);
        g.fillStyle='rgba(0,0,0,.35)'; g.fillRect(x+18,36,28,2);
        g.fillStyle='#a9a59a'; g.fillRect(x+40,38,3,5);
        g.fillStyle='rgba(120,60,30,.45)'; g.fillRect(x+18,52,28,12);
      } else if (rnd()<0.5){
        g.fillStyle='#6b665c'; g.fillRect(x+10,12,44,38);
        g.fillStyle='rgba(0,0,0,.25)'; for(let k=0;k<12;k++) g.fillRect(x+10,12+k*3.2,44,1);
        g.fillStyle='rgba(130,70,30,.5)'; g.fillRect(x+10,40,44,10);
      } else {
        g.fillStyle='#121212'; g.fillRect(x+14,14,36,26);
        g.fillStyle='#55524c'; for(let k=0;k<6;k++) g.fillRect(x+16+k*6,14,2,26);
        g.fillStyle='#8c877b'; g.fillRect(x+12,41,40,3);
      }
    }
    const gr=g.createLinearGradient(0,h,0,h-26); gr.addColorStop(0,'rgba(20,16,12,.55)'); gr.addColorStop(1,'rgba(20,16,12,0)');
    g.fillStyle=gr; g.fillRect(0,h-26,w,26);
  });
}
const T = {};
T.towerUp   = makeFacade('#9a8570', false);
T.towerLow  = makeGroundFloor('#8a7663', false);
T.lowUp     = makeFacade('#7e5a45', true);
T.lowLow    = makeGroundFloor('#70503d', true);
T.tar = canvasTex(128,128,(g,w,h)=>{ g.fillStyle='#43423f'; g.fillRect(0,0,w,h); noise(g,w,h,26); blotches(g,w,h,30,['rgba(20,20,20,.25)','rgba(120,115,105,.15)'],4,14); });
T.concrete = canvasTex(128,128,(g,w,h)=>{ g.fillStyle='#8e8a82'; g.fillRect(0,0,w,h); noise(g,w,h,30); blotches(g,w,h,25,['rgba(40,35,30,.12)','rgba(255,255,255,.06)'],4,18); streaks(g,w,h,10); });
T.brick = canvasTex(128,128,(g,w,h)=>{
  g.fillStyle='#5d5650'; g.fillRect(0,0,w,h);
  for (let y=0;y<h;y+=8) for (let x=((y/8)%2)*-8; x<w; x+=16){ g.fillStyle=pick(['#7a3e2c','#6e3626','#83452f','#5f3123','#8a5038']); g.fillRect(x+1,y+1,14,6); }
  noise(g,w,h,24); streaks(g,w,h,8);
});
T.grime = canvasTex(128,128,(g,w,h)=>{
  g.fillStyle='#e4e1da'; g.fillRect(0,0,w,h); noise(g,w,h,22);
  blotches(g,w,h,30,['rgba(90,80,70,.18)','rgba(60,55,50,.15)'],3,12);
  blotches(g,w,h,22,['rgba(150,75,30,.55)','rgba(120,55,25,.5)','rgba(170,95,45,.45)'],1,6);
  g.strokeStyle='rgba(60,50,40,.35)'; g.lineWidth=1; for(let i=0;i<14;i++){ g.beginPath(); const x=rnd()*w,y=rnd()*h; g.moveTo(x,y); g.lineTo(x+rr(-30,30),y+rr(-6,6)); g.stroke(); }
});
T.char = canvasTex(128,128,(g,w,h)=>{ g.fillStyle='#2a2522'; g.fillRect(0,0,w,h); noise(g,w,h,30); blotches(g,w,h,35,['rgba(130,65,25,.6)','rgba(90,85,80,.4)','rgba(10,8,6,.6)'],3,14); });
T.rust = canvasTex(64,64,(g,w,h)=>{ g.fillStyle='#6b3f24'; g.fillRect(0,0,w,h); noise(g,w,h,40); blotches(g,w,h,20,['rgba(160,90,40,.5)','rgba(40,25,15,.5)'],2,7); });
T.wood = canvasTex(64,64,(g,w,h)=>{ g.fillStyle='#7a6448'; g.fillRect(0,0,w,h); g.fillStyle='rgba(0,0,0,.3)'; for(let x=0;x<w;x+=16) g.fillRect(x,0,1,h); noise(g,w,h,30); });
T.rib = canvasTex(64,64,(g,w,h)=>{ g.fillStyle='#3d3d3b'; g.fillRect(0,0,w,h); g.fillStyle='rgba(0,0,0,.35)'; for(let y=0;y<h;y+=4) g.fillRect(0,y,w,1); noise(g,w,h,20); });
T.chain = canvasTex(64,64,(g,w,h)=>{
  g.clearRect(0,0,w,h); g.strokeStyle='rgba(165,168,165,1)'; g.lineWidth=2;
  for (let i=-w;i<w*2;i+=12){ g.beginPath(); g.moveTo(i,0); g.lineTo(i+h,h); g.stroke(); g.beginPath(); g.moveTo(i,h); g.lineTo(i+h,0); g.stroke(); }
});
T.sign = canvasTex(128,32,(g,w,h)=>{ g.fillStyle='#111'; g.fillRect(0,0,w,h); g.fillStyle='#ff9a2a'; g.font='bold 15px monospace'; g.textAlign='center'; g.textBaseline='middle'; g.fillText('NOT IN SERVICE',w/2,h/2+1); }, false);

T.siding = canvasTex(64,64,(g,w,h)=>{ g.fillStyle='#d8d4ca'; g.fillRect(0,0,w,h); for (let y=0;y<h;y+=8){ g.fillStyle='rgba(0,0,0,.28)'; g.fillRect(0,y+7,w,1); g.fillStyle='rgba(255,255,255,.18)'; g.fillRect(0,y,w,1); } noise(g,w,h,26); blotches(g,w,h,10,['rgba(90,80,70,.2)','rgba(60,55,50,.18)'],2,8); });
T.plywood = canvasTex(64,64,(g,w,h)=>{ g.fillStyle='#a88a5e'; g.fillRect(0,0,w,h); g.strokeStyle='rgba(80,55,30,.35)'; for (let i=0;i<9;i++){ g.beginPath(); const y=rnd()*h; g.moveTo(0,y); g.bezierCurveTo(w*0.3,y+rr(-6,6),w*0.6,y+rr(-6,6),w,y+rr(-4,4)); g.stroke(); } noise(g,w,h,20); });
T.shingle = canvasTex(64,64,(g,w,h)=>{ g.fillStyle='#3a3836'; g.fillRect(0,0,w,h); for (let y=0;y<h;y+=8) for (let x=((y/8)%2)*-6;x<w;x+=12){ g.fillStyle=pick(['#43403d','#353331','#4a4542','#2f2d2b']); g.fillRect(x+1,y+1,10,6); } noise(g,w,h,18); });
// Graffiti atlas: 4x4 cells of 256x128. Invented tags only.
function drawTag(g, word, pal, style){
  g.lineJoin='round'; g.textBaseline='middle';
  if (style===3){
    g.rotate(rr(-0.18,0.04));
    g.font='italic bold 54px "Segoe Script","Brush Script MT",cursive';
    const w=g.measureText(word).width; g.lineWidth=3.5; g.strokeStyle=pal[0];
    g.strokeText(word,-w/2,0);
    g.beginPath(); g.moveTo(-w/2,30); g.quadraticCurveTo(0,44,w/2+10,22); g.stroke();
    return;
  }
  g.rotate(rr(-0.12,0.12));
  let size=88; g.font=`900 ${size}px Impact,"Arial Black",sans-serif`;
  let w=g.measureText(word).width;
  if (w>214){ size*=214/w; g.font=`900 ${size}px Impact,"Arial Black",sans-serif`; w=g.measureText(word).width; }
  if (style===2){ for(let k=7;k>0;k--){ g.fillStyle=pal[1]; g.fillText(word,-w/2+k,k); } }
  g.lineWidth = style===1? 18: 20; g.strokeStyle='#0c0c0c'; g.strokeText(word,-w/2,0);
  if (style===0){ g.lineWidth=10; g.strokeStyle=pal[1]; g.strokeText(word,-w/2,0); }
  const gr=g.createLinearGradient(0,-size/2,0,size/2);
  if (style===1){ gr.addColorStop(0,'#f4f4f4'); gr.addColorStop(.5,'#9b9b9b'); gr.addColorStop(1,'#d8d8d8'); }
  else { gr.addColorStop(0,pal[0]); gr.addColorStop(1,pal[1]); }
  g.fillStyle=gr; g.fillText(word,-w/2,0);
  if (style===1){ g.lineWidth=2; g.strokeStyle=pal[0]; g.strokeText(word,-w/2,0); }
  g.fillStyle='rgba(255,255,255,.75)'; for(let i=0;i<5;i++) g.fillRect(-w/2+rnd()*w, -size*0.25+rnd()*size*0.2, 5, 3);
  g.strokeStyle= style===1? '#9b9b9b' : pal[0]; g.lineWidth=3;
  for (let i=0;i<6;i++){ const x=-w/2+rnd()*w, y=size*0.28; g.beginPath(); g.moveTo(x,y); g.lineTo(x,y+rr(8,26)); g.stroke(); }
  if (rnd()<0.5){ // crown or star
    g.fillStyle=pal[0]; g.strokeStyle='#0c0c0c'; g.lineWidth=3; const x=w/2-10, y=-size*0.55;
    g.beginPath(); g.moveTo(x-14,y+10); g.lineTo(x-14,y-4); g.lineTo(x-7,y+3); g.lineTo(x,y-8); g.lineTo(x+7,y+3); g.lineTo(x+14,y-4); g.lineTo(x+14,y+10); g.closePath(); g.fill(); g.stroke();
  }
}
T.graffiti = canvasTex(1024,512,(g)=>{
  const words=['SKRT','NOVA','KRASH','REKS','DBOY','ZONE 6','WAX','BLAZE','KING','VOID','OG','4EVER','SMOKE','TOXIC','RIP T','HAZE'];
  const pals=[['#e83a3a','#ffd23f'],['#3fa7ff','#ffffff'],['#9bff3f','#1a6b1a'],['#ff6ad5','#5b1a8a'],['#ffa53f','#7a2a00'],['#e8e8e8','#5a5a5a'],['#ffe23f','#c41d1d'],['#47e0c8','#13505a']];
  for (let i=0;i<16;i++){
    const cx=(i%4)*256, cy=Math.floor(i/4)*128;
    g.save(); g.beginPath(); g.rect(cx+2,cy+2,252,124); g.clip(); g.translate(cx+128,cy+62);
    drawTag(g, words[i], pals[(i*3)%8], i%4);
    g.restore();
  }
}, false);

// ---------- Materials ----------
const lam = (color, map, extra={}) => new THREE.MeshLambertMaterial(Object.assign({color, map: map||null}, extra));
const M = {
  towerUp: lam('#ffffff',T.towerUp,{emissive:'#ffd9a0',emissiveMap:T.towerUp.emi,emissiveIntensity:0}), towerLow: lam('#ffffff',T.towerLow),
  lowUp: lam('#ffffff',T.lowUp,{emissive:'#ffd9a0',emissiveMap:T.lowUp.emi,emissiveIntensity:0}), lowLow: lam('#ffffff',T.lowLow),
  tar: lam('#ffffff',T.tar), concrete: lam('#ffffff',T.concrete), concreteDk: lam('#9a968e',T.concrete),
  brick: lam('#ffffff',T.brick), rust: lam('#ffffff',T.rust), wood: lam('#ffffff',T.wood), rib: lam('#ffffff',T.rib),
  metal: lam('#8a8d90'), dark: lam('#262626'), tire: lam('#191919'), light: lam('#d9d5c6'), red: lam('#7a1d16'),
  glass: lam('#5b6d78',null,{transparent:true,opacity:0.32,depthWrite:false,side:THREE.DoubleSide}),
  glassDk: lam('#1f262b'),
  bpGlass: lam('#7d929c',null,{transparent:true,opacity:0.38,depthWrite:false,side:THREE.DoubleSide}),
  // low-poly houses (Update 5): painted siding in a few faded colours, two brick tones, shingles, tin, trim, plywood boards
  sidBlue: lam('#8ea2b0',T.siding), sidWhite: lam('#d2cdbf',T.siding), sidGreen: lam('#8b9a78',T.siding), sidYellow: lam('#c4ae72',T.siding), sidGrey: lam('#8c8780',T.siding),
  brickB: lam('#b0806a',T.brick), shingle: lam('#ffffff',T.shingle), tin: lam('#9a6a4a',T.rust), trim: lam('#e2ddd0'), doorWood: lam('#6a4630',T.wood), floorWood: lam('#8a6a4c',T.wood), plywood: lam('#ffffff',T.plywood), interior: lam('#cfc6b4',T.grime),
  char: lam('#ffffff',T.char),
  seat: lam('#3a4160',T.grime), seatBrn: lam('#5a4636',T.grime), dash: lam('#1e1e1e'),
  busWhite: lam('#d4cebd',T.grime), busStripe: lam('#2c4f86',T.grime), busYellow: lam('#c8a23a',T.grime),
  dumpster: lam('#41603d',T.grime), dumpBlue: lam('#2e4a6e',T.grime),
  bag: new THREE.MeshPhongMaterial({color:'#1c1e1c',specular:'#2a2c2e',shininess:24}), bag2: new THREE.MeshPhongMaterial({color:'#2b3526',specular:'#2a2c28',shininess:20}), leaves: lam('#3e4b2b'), bark: lam('#4a3b2c'), soil: lam('#3a3027'),
  fire: new THREE.MeshBasicMaterial({color:'#ff8a2a'}),
  sign: new THREE.MeshBasicMaterial({map:T.sign}),
  chain: lam('#ffffff',T.chain,{alphaTest:0.5,side:THREE.DoubleSide}),
  graffiti: lam('#ffffff',T.graffiti,{alphaTest:0.4,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),
  mattress: lam('#bdb39a',T.grime), couch: lam('#5b4a3a',T.grime),
  skyline: new THREE.MeshBasicMaterial({color:'#7d868d', map:canvasTex(128,256,(g,w,h)=>{
    // distant towers: window grid with a few lit / dark panes (tinted by the fog colour each frame)
    g.fillStyle='#c4c8cc'; g.fillRect(0,0,w,h);
    for (let y=6;y<h-4;y+=10) for (let x=5;x<w-4;x+=9){ const r=Math.random(); g.fillStyle=r<0.08?'#efe2bf':r<0.55?'#7f8790':'#99a1a9'; g.fillRect(x,y,5,6); }
    for (let x=0;x<w;x+=36){ g.fillStyle='rgba(0,0,0,0.08)'; g.fillRect(x,0,2,h); } })}),
  lampHead: new THREE.MeshBasicMaterial({color:'#4a4a44'}),
  climb: lam('#d6b21e'),
  pool: new THREE.MeshBasicMaterial({map:canvasTex(64,64,(g,w,h)=>{ const gr=g.createRadialGradient(32,32,0,32,32,32); gr.addColorStop(0,'rgba(255,214,150,1)'); gr.addColorStop(0.45,'rgba(255,190,110,.45)'); gr.addColorStop(1,'rgba(255,170,90,0)'); g.fillStyle=gr; g.fillRect(0,0,w,h); },false), transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, polygonOffset:true, polygonOffsetFactor:-4, polygonOffsetUnits:-4}),
  firePool: new THREE.MeshBasicMaterial({color:'#ff7a2a', transparent:true, opacity:0.2, depthWrite:false, blending:THREE.AdditiveBlending}),
};
M.paints = ['#6b2b2b','#2b3a55','#6d4a2c','#4b5a3d','#b9b5a8','#262626','#8b8e90','#7a6a2e'].map(c=>lam(c,T.grime));

// ---------- Geometry batcher (merges static meshes by material + spatial chunk) ----------
const Batch = {
  groups: new Map(),
  add(geo, mat, m){
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(m);
    const cx = Math.floor((m.elements[12]+120)/60), cz = Math.floor((m.elements[14]+120)/60);
    const key = mat.uuid+':'+cx+':'+cz;
    let e = this.groups.get(key); if (!e){ e = {mat, geos:[]}; this.groups.set(key,e); }
    e.geos.push(g);
  },
  flush(scene){
    let meshes = 0;
    for (const e of this.groups.values()){
      let n=0; for (const g of e.geos) n += g.attributes.position.count;
      const pos=new Float32Array(n*3), nor=new Float32Array(n*3), uv=new Float32Array(n*2);
      let o=0;
      for (const g of e.geos){
        pos.set(g.attributes.position.array, o*3); nor.set(g.attributes.normal.array, o*3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array, o*2);
        o += g.attributes.position.count; g.dispose();
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(pos,3));
      bg.setAttribute('normal', new THREE.BufferAttribute(nor,3));
      bg.setAttribute('uv', new THREE.BufferAttribute(uv,2));
      bg.computeBoundingSphere();
      const mesh = new THREE.Mesh(bg, e.mat);
      mesh.matrixAutoUpdate = false; mesh.castShadow = !e.mat.transparent; mesh.receiveShadow = true;
      scene.add(mesh); meshes++;
    }
    this.groups.clear();
    return meshes;
  }
};
const _e = new THREE.Euler(), _q = new THREE.Quaternion();
function mtx(x,y,z,rx=0,ry=0,rz=0,sx=1,sy=1,sz=1){
  _e.set(rx,ry,rz,'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x,y,z), _q, new THREE.Vector3(sx,sy,sz));
}
function boxGeo(w,h,d,ts){
  const g = new THREE.BoxGeometry(w,h,d);
  if (ts){
    const uv=g.attributes.uv, dims=[[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
    for (let f=0;f<6;f++) for (let k=0;k<4;k++){ const i=f*4+k; uv.setXY(i, uv.getX(i)*dims[f][0]/ts, uv.getY(i)*dims[f][1]/ts); }
  }
  return g;
}
function planeUV(w,h,su,sv,ou=0,ov=0){
  const g = new THREE.PlaneGeometry(w,h), uv=g.attributes.uv;
  for (let i=0;i<uv.count;i++) uv.setXY(i, uv.getX(i)*su+ou, uv.getY(i)*sv+ov);
  return g;
}

// ---------- Colliders (oriented boxes in XZ, with vertical range) ----------
const colliders = [];      // movement (and, unless flagged nb, bullets / line of sight)
const bulletCols = [];     // bullets / line of sight only: posts, rails and plates of see-through fences
function addCol(cx,cz,hx,hz,y0,y1,yaw=0,o={}){
  const c={cx,cz,hx,hz,y0,y1,yaw,c:Math.cos(yaw),s:Math.sin(yaw),br:Math.hypot(hx,hz)};
  if (o.nb) c.nb=true;                       // body blocker only: bullets fly through (chain-link mesh)
  (o.nm ? bulletCols : colliders).push(c); return c;
}

// Local frames: lets vehicles/props be built in local coords with one transform.
function frame(x,z,yaw=0,y=0){ return {x,y,z,yaw,c:Math.cos(yaw),s:Math.sin(yaw),m:mtx(x,y,z,0,yaw,0)}; }
const F0 = frame(0,0,0);
function toWorld(F,lx,lz){ return [F.x+lx*F.c+lz*F.s, F.z-lx*F.s+lz*F.c]; }
function part(F,mat,w,h,d,lx,ly,lz,o={}){
  if (mat){
    const m = mtx(lx,ly,lz,o.rx||0,o.ry||0,o.rz||0,o.sx||1,o.sy||1,o.sz||1); m.premultiply(F.m);
    Batch.add(o.geo || boxGeo(w,h,d, o.ts===undefined?2:o.ts), mat, m);
  }
  if (o.col){
    const [wx,wz] = toWorld(F,lx,lz);
    addCol(wx,wz,w/2,d/2, F.y+(o.y0!==undefined?o.y0:ly-h/2), F.y+(o.y1!==undefined?o.y1:ly+h/2), F.yaw+(o.ry||0), o.col);
  }
}
const cylGeo = (r1,r2,h,seg=8) => new THREE.CylinderGeometry(r1,r2,h,seg);
function cyl(F,mat,r,h,lx,ly,lz,o={}){ part(F,mat,0,0,0,lx,ly,lz,Object.assign({geo:cylGeo(o.r2!==undefined?o.r2:r,r,h,o.seg||8)},o)); }
// Graffiti decal: cell 0..15 from the atlas
function decal(F,cell,w,h,lx,ly,lz,ry){
  const col=cell%4, row=Math.floor(cell/4);
  part(F,M.graffiti,0,0,0,lx,ly,lz,{ry, geo:planeUV(w,h,0.25,0.25,col*0.25,(3-row)*0.25)});
}

// ---------- Map data (from the reference image, top-down) ----------
// Courtyard centre ~(-7,-6). Two 8-storey towers at the back, two 4-storey blocks at the front.
const FLOOR_H = 3;
const BUILDINGS = [
  {id:'A', x0:-30, x1:-2, z0:-34, z1:-22, floors:8, style:'tower'},
  {id:'B', x0:6,   x1:18, z0:-36, z1:-8,  floors:8, style:'tower'},
  {id:'C', x0:-30, x1:-20,z0:-14, z1:14,  floors:4, style:'low'},
  {id:'D', x0:-6,  x1:22, z0:10,  z1:20,  floors:4, style:'low'},
];
BUILDINGS.forEach(b=>{ b.h=b.floors*FLOOR_H; });
const B = Object.fromEntries(BUILDINGS.map(b=>[b.id,b]));
// Gaps in roof parapets: ladders, stairs and the tower bridge
const PARAPET_GAPS = {
  A:{n:[[-21,-19]], e:[[-27,-25]]},
  B:{w:[[-27,-25]], e:[[-15,-13]]},
  C:{w:[[-5,-3]]},
  D:{s:[[16.5,19.6]]},
};
const ladders = [];   // ladders (attach with E)
const vaults = [];    // designated climbable fences (vault with Space)
const lightPools = []; // ground light pools: [x,z,r]
const windowMats = [];
const shadowRects = []; // painted (baked) shadows for small objects
const interactCars = [];
const searchables = [];   // vehicles that can be searched for items
const busZones = [];

// ---------- Ground (one painted texture = baked layout + baked shadows) ----------
const GROUND_SIZE = 180, GPX = 1024, SC = GPX/GROUND_SIZE;
const gX = x => (x+GROUND_SIZE/2)*SC, gZ = z => (z+GROUND_SIZE/2)*SC, gL = m => m*SC;
const groundCanvas = document.createElement('canvas'); groundCanvas.width = groundCanvas.height = GPX;
const gg = groundCanvas.getContext('2d');
const ROADS = [
  {pts:[[-48,-46],[44,-46],[44,34],[-48,34],[-48,-46]], w:9, side:2.6, line:true},
  {pts:[[-13,6],[-13,86]], w:7, side:2},
  {pts:[[44,-46],[44,-86]], w:9, side:2.6, line:true},
  {pts:[[-48,-12],[-66,-12],[-86,-26]], w:7, side:2},
  {pts:[[-66,-12],[-86,2]], w:6, side:1.6},
];
ROADS.forEach(r=>{ r.pts=r.pts.map(p=>RM(p[0],p[1])); });   // compressed layout (widths unchanged)
function gRect(x0,z0,x1,z1,fill){ gg.fillStyle=fill; gg.fillRect(gX(x0),gZ(z0),gL(x1-x0),gL(z1-z0)); }
function gPath(pts){ gg.beginPath(); pts.forEach((p,i)=> i? gg.lineTo(gX(p[0]),gZ(p[1])) : gg.moveTo(gX(p[0]),gZ(p[1]))); }
function paintGroundBase(){
  const g = gg;
  g.fillStyle='#5f5a4e'; g.fillRect(0,0,GPX,GPX);
  for (let i=0;i<700;i++){ g.fillStyle=pick(['rgba(70,62,50,.35)','rgba(110,104,92,.25)','rgba(90,82,66,.3)']); g.beginPath(); g.arc(rnd()*GPX,rnd()*GPX,rr(2,14),0,PI*2); g.fill(); }
  // Reduced grass: patchy strips only
  const grass=[[-43,-42,-33,-17],[20,-42,37,-12],[-5,22,37,27],[-86,60,-66,86],[62,-86,86,-66]];
  for (const z of grass){ [z[0],z[1]]=RM(z[0],z[1]); [z[2],z[3]]=RM(z[2],z[3]); }
  for (const z of grass) for (let i=0;i<45;i++){
    g.fillStyle=pick(['#4d5530','#59603a','#454e2a','#5d5a3c']);
    g.beginPath(); g.arc(gX(rr(z[0],z[2])),gZ(rr(z[1],z[3])),gL(rr(0.8,3)),0,PI*2); g.fill();
  }
  // sidewalks then roads
  g.lineCap='round'; g.lineJoin='round';
  for (const r of ROADS){ gPath(r.pts); g.strokeStyle='#8a877f'; g.lineWidth=gL(r.w+r.side*2); g.stroke(); }
  for (const r of ROADS){ gPath(r.pts); g.strokeStyle='#353534'; g.lineWidth=gL(r.w); g.stroke(); }
  for (const r of ROADS) if (r.line){ gPath(r.pts); g.setLineDash([gL(3),gL(4)]); g.strokeStyle='rgba(190,160,60,.55)'; g.lineWidth=gL(0.25); g.stroke(); g.setLineDash([]); }
  // west parking lot
  gRect(RMv(-79),3,RMv(-55),31,'#3c3c3b');
  g.strokeStyle='rgba(220,220,210,.4)'; g.lineWidth=gL(0.15);
  for (let x=RMv(-78);x<=RMv(-56);x+=2.8){ g.beginPath(); g.moveTo(gX(x),gZ(3.5)); g.lineTo(gX(x),gZ(9)); g.moveTo(gX(x),gZ(25)); g.lineTo(gX(x),gZ(30.5)); g.stroke(); }
  // east lot
  gRect(25,-6,37.5,28,'#57554f');
  for (let z=-5;z<=27;z+=2.8){ g.beginPath(); g.moveTo(gX(32),gZ(z)); g.lineTo(gX(37),gZ(z)); g.stroke(); }
  // courtyard + gaps between buildings
  gRect(-21,-22,6,10,'#5c5a54');
  gRect(-30,-22,-20,-14,'#66635c');
  gRect(-2,-46,6,-22,'#7d7a72');
  gRect(6,-8,37,10,'#57554f');
  gRect(-20,9,-6,13,'#4a4945');
  for (const b of BUILDINGS) gRect(b.x0-1.5,b.z0-1.5,b.x1+1.5,b.z1+1.5,'#77746c');
  // courtyard details
  g.fillStyle='#66625a'; g.beginPath(); g.arc(gX(-7),gZ(-5),gL(7),0,PI*2); g.fill();
  g.strokeStyle='rgba(0,0,0,.18)'; g.lineWidth=1; for (let r=4;r<7;r+=1){ g.beginPath(); g.arc(gX(-7),gZ(-5),gL(r),0,PI*2); g.stroke(); }
  gRect(-1,1,5.5,9.5,'#4e5a5c');
  g.strokeStyle='rgba(230,230,220,.5)'; g.lineWidth=gL(0.12);
  g.strokeRect(gX(0.6),gZ(4),gL(2.8),gL(5.5)); g.beginPath(); g.arc(gX(2),gZ(4),gL(1.4),PI,0); g.stroke();
  g.beginPath(); g.arc(gX(2),gZ(9),gL(5.6),PI*1.03,PI*1.97); g.stroke();
  g.strokeStyle='rgba(220,220,210,.4)'; g.lineWidth=gL(0.15);
  for (let z=-13;z<=7;z+=2.8){ g.beginPath(); g.moveTo(gX(-20),gZ(z)); g.lineTo(gX(-15),gZ(z)); g.stroke(); }
  // crosswalk at south exit
  g.fillStyle='rgba(220,220,210,.35)'; for (let x=-16;x<-10;x+=1) g.fillRect(gX(x),gZ(27.5),gL(0.5),gL(2.6));
  // cracks, potholes, stains, manholes, litter
  const id = g.getImageData(0,0,GPX,GPX).data;
  const paved = (x,z)=>{ const px=Math.floor(gX(x)), pz=Math.floor(gZ(z)); if(px<0||pz<0||px>=GPX||pz>=GPX) return false; const i=(pz*GPX+px)*4; return !(id[i+1]>id[i]+4); };
  for (let i=0;i<420;i++){
    const x=rr(-86,86), z=rr(-86,86); if(!paved(x,z)) continue;
    g.strokeStyle='rgba(15,15,15,.55)'; g.lineWidth=1; g.beginPath(); let px=gX(x), pz=gZ(z); g.moveTo(px,pz);
    let a=rnd()*PI*2; for (let k=0;k<rr(4,10);k++){ a+=rr(-0.8,0.8); px+=Math.cos(a)*rr(3,8); pz+=Math.sin(a)*rr(3,8); g.lineTo(px,pz); }
    g.stroke();
  }
  for (let i=0;i<70;i++){ const x=rr(-86,86), z=rr(-86,86); if(!paved(x,z)) continue;
    const r=gL(rr(0.4,1.2)); g.fillStyle='rgba(95,90,82,.6)'; g.beginPath(); g.ellipse(gX(x),gZ(z),r*1.3,r,rnd()*PI,0,PI*2); g.fill();
    g.fillStyle='rgba(18,18,18,.85)'; g.beginPath(); g.ellipse(gX(x),gZ(z),r,r*0.75,rnd()*PI,0,PI*2); g.fill(); }
  for (let i=0;i<90;i++){ const x=rr(-86,86), z=rr(-86,86); if(!paved(x,z)) continue;
    g.fillStyle='rgba(10,10,12,.3)'; g.beginPath(); g.arc(gX(x),gZ(z),gL(rr(0.3,1.1)),0,PI*2); g.fill(); }
  for (const [x,z] of [[0,-46],[30,-46],[44,0],[-20,34],[10,34],[RMv(-48),10],[-13,22],[-6,-5.2]]){
    g.fillStyle='#2a2826'; g.beginPath(); g.arc(gX(x+1.6),gZ(z+1.2),gL(0.45),0,PI*2); g.fill();
  }
  for (let i=0;i<900;i++){ g.fillStyle=pick(['rgba(230,230,220,.5)','rgba(200,60,50,.45)','rgba(60,90,160,.45)','rgba(30,30,30,.4)']); g.fillRect(rnd()*GPX,rnd()*GPX,rr(1,2.5),rr(1,2.5)); }
}
function paintGroundShadows(){
  const sc = document.createElement('canvas'); sc.width=sc.height=GPX; const s=sc.getContext('2d');
  s.fillStyle='#000';
  // Sun-independent ambient occlusion only (contact darkening). The sun moves with the
  // day/night cycle, so directional shadows are never baked into the ground.
  for (const b of BUILDINGS){ const m=1.6; s.fillRect(gX(b.x0-m),gZ(b.z0-m),gL(b.x1-b.x0+2*m),gL(b.z1-b.z0+2*m)); }
  for (const r of shadowRects){
    s.save(); s.translate(gX(r.x), gZ(r.z)); s.rotate(-r.yaw);
    s.fillRect(-gL(r.w/2+0.25),-gL(r.d/2+0.25),gL(r.w+0.5),gL(r.d+0.5)); s.restore();
  }
  gg.save(); gg.filter='blur(5px)'; gg.globalAlpha=0.3; gg.drawImage(sc,0,0); gg.restore();
}

// ---------- Buildings ----------
function buildBuilding(b){
  const tower = b.style==='tower';
  const up = tower? M.towerUp : M.lowUp, low = tower? M.towerLow : M.lowLow;
  const cx=(b.x0+b.x1)/2, cz=(b.z0+b.z1)/2, w=b.x1-b.x0, d=b.z1-b.z0, h=b.h;
  addCol(cx,cz,w/2,d/2,0,h);
  const sides = [
    {s:'s', len:w, x:cx, z:b.z1, ry:0},
    {s:'n', len:w, x:cx, z:b.z0, ry:PI},
    {s:'e', len:d, x:b.x1, z:cz, ry:PI/2},
    {s:'w', len:d, x:b.x0, z:cz, ry:-PI/2},
  ];
  for (const sd of sides){
    const Fs = frame(sd.x, sd.z, sd.ry);
    const ou = Math.floor(rnd()*8)/8;
    part(Fs, low, 0,0,0, 0, FLOOR_H/2, 0, {geo:planeUV(sd.len,FLOOR_H,sd.len/24,1,ou,0)});
    part(Fs, up, 0,0,0, 0, FLOOR_H+(h-FLOOR_H)/2, 0, {geo:planeUV(sd.len,h-FLOOR_H,sd.len/24,(h-FLOOR_H)/12,ou,0)});
    // cornice band
    part(Fs, M.concreteDk, sd.len+0.3, 0.35, 0.3, 0, h-0.17, 0.05);
    part(Fs, M.concreteDk, sd.len+0.1, 0.18, 0.18, 0, FLOOR_H, 0.06);
    // door canopies where the texture paints doors (bay 3 of each 24m repeat)
    for (let k=-1;k<4;k++){
      const t = -sd.len/2 + 24*(k - ou) + 10.5;
      if (t < -sd.len/2+1.5 || t > sd.len/2-1.5) continue;
      part(Fs, M.concrete, 2.4, 0.15, 1.2, t, 2.75, 0.6);
      part(Fs, M.lampHead, 0.3, 0.08, 0.2, t, 2.64, 0.5);
      { const [px,pz]=toWorld(Fs,t,1.6); lightPools.push([px,pz,2.6]); }
      part(Fs, M.concrete, 2.4, 0.2, 1.8, t, 0.1, 0.9, {col:true});
    }
    // graffiti along the ground floor, plus the odd high "heaven spot"
    const n = Math.floor(sd.len/6);
    for (let i=0;i<n;i++){
      const gw = rr(2.6,4.4), t = -sd.len/2 + (i+0.5)*sd.len/n + rr(-1,1);
      if (rnd()<0.85) decal(Fs, Math.floor(rnd()*16), gw, gw*0.5, t, rr(1.1,1.7), 0.04, 0);
    }
    if (rnd()<0.6) decal(Fs, Math.floor(rnd()*16), 4, 2, rr(-sd.len/3,sd.len/3), h-1.6, 0.04, 0);
    // drainpipe
    part(Fs, M.rust, 0.14, h, 0.14, sd.len/2-0.4, h/2, 0.12);
  }
  // roof
  part(F0, M.tar, 0,0,0, cx, h+0.01, cz, {rx:-PI/2, geo:planeUV(w,d,w/6,d/6)});
  // parapets with gaps
  const gaps = PARAPET_GAPS[b.id] || {};
  const PH=1.0, PT=0.3;
  const seg = (side, a0, a1) => {
    if (a1-a0 < 0.05) return;
    const m=(a0+a1)/2, L=a1-a0;
    if (side==='n') part(F0,M.concrete,L,PH,PT,m,h+PH/2,b.z0+PT/2,{col:true});
    if (side==='s') part(F0,M.concrete,L,PH,PT,m,h+PH/2,b.z1-PT/2,{col:true});
    if (side==='w') part(F0,M.concrete,PT,PH,L,b.x0+PT/2,h+PH/2,m,{col:true});
    if (side==='e') part(F0,M.concrete,PT,PH,L,b.x1-PT/2,h+PH/2,m,{col:true});
  };
  for (const side of ['n','s','e','w']){
    const horiz = side==='n'||side==='s';
    let a = horiz? b.x0 : b.z0; const end = horiz? b.x1 : b.z1;
    for (const [g0,g1] of (gaps[side]||[]).slice().sort((p,q)=>p[0]-q[0])){ seg(side,a,g0); a=g1; }
    seg(side,a,end);
  }
}
function roofBox(mat,w,hh,d,x,z,b,o={}){ part(F0,mat,w,hh,d,x,b.h+hh/2,z,Object.assign({col:true},o)); }
function buildRoofs(){
  const A=B.A, Bb=B.B, C=B.C, D=B.D;
  // Tower A: stair/elevator room (the box on top in the reference), AC units, antenna, sandbag cover
  roofBox(M.concrete,5,3.2,4,-10.5,-31,A);
  part(F0,M.dark,1.1,2.1,0.05,-10.5,A.h+1.05,-28.97);
  decal(F0,9,3,1.5,-12.6,A.h+2.0,-28.96,0);
  roofBox(M.metal,1.6,1.1,1.2,-24,-30,A); roofBox(M.metal,1.6,1.1,1.2,-21.5,-30,A); roofBox(M.metal,1.6,1.1,1.2,-17,-24.5,A);
  cyl(F0,M.metal,0.05,5,-28,A.h+2.5,-32.5);
  sandbags(-14,-24.3,4,0,A.h); sandbags(-4.5,-31,3,PI/2,A.h);
  // Tower B: stair room, water tank, dish, sandbags
  roofBox(M.concrete,4,3.2,5,12,-32,Bb);
  part(F0,M.dark,0.05,2.1,1.1,9.97,Bb.h+1.05,-32);
  for (const [dx,dz] of [[-1.1,-1.1],[1.1,-1.1],[-1.1,1.1],[1.1,1.1]]) cyl(F0,M.rust,0.08,2,12+dx,Bb.h+1,-20+dz);
  cyl(F0,M.wood,1.6,3,12,Bb.h+3.5,-20,{seg:10});
  addCol(12,-20,1.6,1.6,Bb.h,Bb.h+5);
  cyl(F0,M.metal,0.6,0.08,15.5,Bb.h+1.4,-27,{rx:0.9});
  cyl(F0,M.metal,0.05,1.4,15.5,Bb.h+0.7,-27);
  roofBox(M.metal,1.6,1.1,1.2,9,-12,Bb); roofBox(M.metal,1.6,1.1,1.2,9,-24,Bb);
  sandbags(15,-11,4,0,Bb.h); sandbags(7.3,-17,3,PI/2,Bb.h);
  // C: skylights, AC, vents
  roofBox(M.glassDk,2,0.6,3,-25,-9,C); roofBox(M.glassDk,2,0.6,3,-25,5,C);
  roofBox(M.metal,1.4,1,1.1,-22.5,-1,C); cyl(F0,M.metal,0.25,1.2,-27,C.h+0.6,10);
  sandbags(-21,-12.5,3,PI/2,C.h);
  // D: shed, AC
  roofBox(M.rust,3,2.4,2.4,0,13,D);
  roofBox(M.metal,1.4,1,1.1,8,15,D); roofBox(M.metal,1.4,1,1.1,12,15,D);
  sandbags(4,11,4,0,D.h); sandbags(20.5,14,3,PI/2,D.h);
  // Plank bridge between the two towers (A east edge -> B west edge)
  part(F0,M.wood,8.6,0.15,1.4,2,A.h-0.075,-26,{col:true});
  part(F0,M.rust,8.6,0.08,0.08,2,A.h+0.9,-26.7); part(F0,M.rust,8.6,0.08,0.08,2,A.h+0.9,-25.3);
  for (const x of [-1.5,2,5.5]){ part(F0,M.rust,0.08,0.9,0.08,x,A.h+0.45,-26.7); part(F0,M.rust,0.08,0.9,0.08,x,A.h+0.45,-25.3); }
}
function sandbags(x,z,len,yaw,y){
  const F = frame(x,z,yaw,y);
  for (let r=0;r<3;r++) for (let i=0;i<Math.floor(len/0.7);i++)
    part(F,M.mattress,0.68,0.3,0.45,-len/2+0.35+i*0.7+(r%2)*0.3,0.15+r*0.3,0,{ts:1});
  part(F,null,len,1.0,0.5,0,0.5,0,{col:true});
}
function addLadder(x,z,side,b){
  // side: outward normal of the wall it is fixed to
  const h=b.h, top=h+1.15;
  const n = {n:[0,-1],s:[0,1],e:[1,0],w:[-1,0]}[side];
  const along = side==='n'||side==='s' ? [1,0] : [0,1];
  const ox = x + n[0]*0.22, oz = z + n[1]*0.22;
  for (const k of [-0.32,0.32]){
    const rx=ox+along[0]*k, rz=oz+along[1]*k;
    part(F0,M.rust,0.07,top,0.07,rx,top/2,rz);
    // hoop over parapet
    part(F0,M.rust,0.07,0.07,1.0,rx-n[0]*0.4,top,rz-n[1]*0.4, {ry: side==='e'||side==='w'? PI/2:0});
  }
  const rungW = 0.64;
  for (let y=0.3;y<top;y+=0.3) part(F0,M.rust, along[0]? rungW:0.05, 0.05, along[1]? rungW:0.05, ox, y, oz);
  for (let y=2.5;y<top;y+=1.2){ // safety cage
    for (const k of [-0.4,0.4]) part(F0,M.rust, along[0]?0.04:0.7, 0.04, along[1]?0.04:0.7, ox+n[0]*0.35+along[0]*k, y, oz+n[1]*0.35+along[1]*k);
    part(F0,M.rust, along[0]?0.84:0.04, 0.04, along[1]?0.84:0.04, ox+n[0]*0.7, y, oz+n[1]*0.7);
  }
  // climb zone (outside the wall)
  const zx0 = Math.min(x, x+n[0]*0.95) - (along[0]?0.6:0), zx1 = Math.max(x, x+n[0]*0.95) + (along[0]?0.6:0);
  const zz0 = Math.min(z, z+n[1]*0.95) - (along[1]?0.6:0), zz1 = Math.max(z, z+n[1]*0.95) + (along[1]?0.6:0);
  ladders.push({x0:zx0,x1:zx1,z0:zz0,z1:zz1,top:h+0.25,nx:n[0],nz:n[1],name:'Building '+b.id,
    wx:x, wz:z, h, ax:along[0], az:along[1]});
}
function buildStairsD(){
  // Concrete exterior stairway up the south face of Building D (40 steps, 12m)
  const D=B.D, z0=D.z1+0.05, z1=z0+1.4, zm=(z0+z1)/2;
  for (let i=0;i<40;i++){
    const top=(i+1)*0.3, x=-3+i*0.5+0.25;
    part(F0,M.concrete,0.5,top,1.4,x,top/2,zm,{col:true});
  }
  part(F0,M.concrete,2.6,12,1.4,18.3,6,zm,{col:true}); // landing
  // railing
  const len=Math.hypot(20,12);
  part(F0,M.rust,len,0.07,0.07,7,6+1.0,z1-0.05,{rz:Math.atan2(12,20)});
  for (let i=0;i<=10;i++){ const x=-3+i*2, y=(x+3)/20*12; part(F0,M.rust,0.07,1.0,0.07,x,y+0.5,z1-0.05); }
  addCol(8,z1+0.05,11.5,0.06,0,13.5); // outer rail (keeps you on the stairs)
  addCol(19.65,zm,0.06,0.75,0,13.5); part(F0,M.rust,0.07,1.0,1.4,19.6,12.5,zm); // landing end rail
  decal(F0,4,3.2,1.6,4,1.4,z1+0.02,0);
  decal(F0,13,3,1.5,10,2.4,z1+0.02,0);
}

// ---------- Vehicles ----------
const CARSPEC = {
  sedan: {L:4.6,W:1.8,y0:0.32,y1:1.0,cx0:-1.25,cx1:0.85,cy1:1.42,cw:1.6,wx:1.45,wr:0.33},
  suv:   {L:4.8,W:1.95,y0:0.42,y1:1.15,cx0:-2.2,cx1:0.75,cy1:1.85,cw:1.8,wx:1.55,wr:0.4},
  pickup:{L:5.4,W:2.0,y0:0.45,y1:1.15,cx0:-0.45,cx1:0.95,cy1:1.9,cw:1.85,wx:1.75,wr:0.42},
};
function makeCar(scene,type,x,z,yaw,o={}){ [x,z]=RM(x,z);
  const S=CARSPEC[type], F=frame(x,z,yaw), paint=o.burned? M.char : (o.paint||pick(M.paints));
  const hw=S.W/2, hl=S.L/2, bh=S.y1-S.y0, bm=(S.y0+S.y1)/2;
  const cl=S.cx1-S.cx0, cm=(S.cx0+S.cx1)/2, ch=S.cy1-S.y1;
  // wheels or cinder blocks
  for (const sx of [-1,1]) for (const sz of [-1,1]){
    if (o.noWheels){ part(F,M.concrete,0.4,S.y0,0.4,sx*S.wx,S.y0/2,sz*(hw-0.3)); continue; }
    const flat = o.flat && rnd()<0.5, r = flat? S.wr*0.82 : S.wr;
    cyl(F,M.tire,r,0.26,sx*S.wx,r,sz*(hw-0.13),{rx:PI/2});
    cyl(F,o.burned?M.char:M.metal,r*0.5,0.28,sx*S.wx,r,sz*(hw-0.13),{rx:PI/2});
  }
  // bumpers & lights
  part(F,M.dark,0.14,0.2,S.W,hl,S.y0+0.12,0); part(F,M.dark,0.14,0.2,S.W,-hl,S.y0+0.12,0);
  if (!o.burned){ for (const sz of [-1,1]){ part(F,M.light,0.05,0.12,0.3,hl+0.01,S.y1-0.17,sz*(hw-0.25)); part(F,M.red,0.05,0.12,0.3,-hl-0.01,S.y1-0.17,sz*(hw-0.25)); } }
  const enter = !!o.enterable;
  let doorX0 = S.cx1-1.1;
  if (type==='pickup'){
    // front: hood+cab lower; rear: bed
    part(F,paint,hl-S.cx1,bh,S.W,(S.cx1+hl)/2,bm,0);
    part(F,paint,hl+S.cx0,0.32,S.W,(S.cx0-hl)/2,S.y0+0.16,0);
    part(F,paint,hl+S.cx0,bh,0.08,(S.cx0-hl)/2,bm,hw-0.04); part(F,paint,hl+S.cx0,bh,0.08,(S.cx0-hl)/2,bm,-hw+0.04);
    part(F,paint,0.08,bh*0.9,S.W,-hl+0.2,bm-0.4,0,{rz:1.2}); // dropped tailgate
    part(F,M.tire,0.8,0.3,0.8,-1.6,S.y0+0.47,0.3,{geo:new THREE.TorusGeometry(0.33,0.13,5,8),rx:PI/2});
    // hitboxes follow the visible shape: hood up to the body line, cab up to the roof (no invisible wall above the hood)
    addCol(...toWorld(F,(S.cx1+hl)/2,0), (hl-S.cx1)/2, hw, 0, S.y1, yaw);
    addCol(...toWorld(F,cm,0), cl/2, hw, 0, S.cy1, yaw);
    addCol(...toWorld(F,(S.cx0-hl)/2,0), (hl+S.cx0)/2, hw, 0, S.y0+0.32, yaw);
    addCol(...toWorld(F,(S.cx0-hl)/2,hw-0.04), (hl+S.cx0)/2, 0.06, 0, S.y1, yaw);
    addCol(...toWorld(F,(S.cx0-hl)/2,-hw+0.04), (hl+S.cx0)/2, 0.06, 0, S.y1, yaw);
    if (!enter) part(F,paint,cl,bh,S.W,cm,bm,0);
    else {
      part(F,M.dark,cl,0.1,S.W-0.1,cm,S.y0+0.05,0);
      part(F,paint,cl,bh,0.08,cm,bm,hw-0.04);
      part(F,paint,0.08,bh,S.W,S.cx0+0.04,bm,0);
      doorX0 = S.cx0;
    }
  } else {
    if (!enter) part(F,paint,S.L,bh,S.W,0,bm,0);
    else {
      part(F,M.dark,cl,0.1,S.W-0.1,cm,S.y0+0.05,0);
      part(F,paint,hl-S.cx1,bh,S.W,(S.cx1+hl)/2,bm,0);
      if (hl+S.cx0>0.05) part(F,paint,hl+S.cx0,bh,S.W,(S.cx0-hl)/2,bm,0);
      part(F,paint,cl,bh,0.08,cm,bm,hw-0.04);
      if (doorX0 > S.cx0+0.05) part(F,paint,doorX0-S.cx0,bh,0.08,(S.cx0+doorX0)/2,bm,-hw+0.04);
    }
    // body box up to the belt line, cabin box only over the cabin (bullets used to stop in mid-air above the hood/boot)
    addCol(F.x,F.z,hl,hw,0,S.y1,yaw);
    addCol(...toWorld(F,cm,0), cl/2, S.cw/2, S.y1, S.cy1, yaw);
  }
  // cabin
  part(F,paint,cl+0.06,0.07,S.cw,cm,S.cy1-0.035,0);
  if (!enter){
    part(F,o.burned?M.dark:M.glassDk,cl-0.02,ch-0.07,S.cw-0.04,cm,S.y1+(ch-0.07)/2,0);
  } else {
    for (const px of [S.cx1-0.05, cm, S.cx0+0.05]) for (const sz of [-1,1])
      part(F,paint,0.08,ch,0.08,px,S.y1+ch/2,sz*(S.cw/2-0.04));
    part(F,M.glass,0.02,ch-0.1,S.cw-0.12,S.cx1-0.04,S.y1+(ch-0.1)/2,0,{rz:-0.25});
    part(F,M.glass,0.02,ch-0.1,S.cw-0.12,S.cx0+0.04,S.y1+(ch-0.1)/2,0);
    part(F,M.glass,cl/2-0.1,ch-0.12,0.02,cm-cl/4,S.y1+(ch-0.12)/2,S.cw/2-0.04);
    // interior: seats, dashboard, steering wheel
    const seatX = S.cx1-0.95, seatTop=S.y0+0.45;
    for (const sz of [-1,1]){
      part(F,M.seat,0.55,0.16,0.6,seatX,seatTop-0.08,sz*0.42);
      part(F,M.seat,0.12,0.65,0.6,seatX-0.32,seatTop+0.28,sz*0.42,{rz:0.15});
    }
    if (type!=='pickup'){
      part(F,M.seat,0.55,0.16,S.cw-0.2,S.cx0+0.45,seatTop-0.08,0);
      part(F,M.seat,0.12,0.6,S.cw-0.2,S.cx0+0.17,seatTop+0.25,0,{rz:0.15});
    }
    part(F,M.dash,0.4,0.3,S.cw-0.08,S.cx1-0.05,S.y1-0.02,0);
    part(F,M.dash,0,0,0,S.cx1-0.33,S.y1+0.2,-0.42,{geo:new THREE.TorusGeometry(0.17,0.025,5,12),ry:PI/2,rx:0.45});
    part(F,M.dash,0.3,0.04,0.04,S.cx1-0.2,S.y1+0.12,-0.42,{rz:0.45});
    part(F,M.dash,0.06,0.25,0.06,seatX+0.4,S.y0+0.4,0);
    part(F,M.dark,0.04,0.06,0.18,S.cx1-0.15,S.cy1-0.15,0);
    // driver door (separate mesh, swings open)
    const dl = S.cx1-doorX0;
    const pivot = new THREE.Object3D();
    const [px,pz] = toWorld(F,S.cx1,-hw+0.04); pivot.position.set(px,bm,pz); pivot.rotation.y=yaw;
    const door = new THREE.Mesh(boxGeo(dl,bh,0.08,2), paint); door.position.x=-dl/2; door.castShadow=true;
    pivot.add(door); scene.add(pivot);
    interactCars.push({F, pivot, yaw, open:0, target:0, name: o.name||type,
      seat:[seatX+0.05, Math.min(seatTop+0.62, S.cy1-0.14), -0.42],
      exits:[[seatX,-(hw+0.75)],[seatX,hw+0.75],[-hl-0.9,0]]});
  }
  shadowRects.push({x,z,w:S.L,d:S.W,h:0.8,yaw});
  searchables.push({F, L:S.L, W:S.W, name:o.name||type, searched:false});
  if (o.tag!==undefined && !enter) decal(F,o.tag,1.8,0.9,-0.6,bm,hw+0.01,0);
  return F;
}
function makeBus(type,x,z,yaw,o={}){ [x,z]=RM(x,z);
  const F=frame(x,z,yaw), L=12, W=2.6, hl=6, hw=1.3, FL=0.55, TOP=3.0;
  const paint = o.burned? M.char : (o.paint||M.busWhite), stripe = o.burned? M.char : M.busStripe;
  const enter = type==='enterable';
  part(F,M.dark,L-0.4,0.22,W-0.2,0,0.44,0);
  for (const wxp of [-3.9,-3.0,3.9]) for (const sz of [-1,1]){
    cyl(F,M.tire,0.5,0.3,wxp,0.5,sz*(hw-0.18),{rx:PI/2});
    cyl(F,o.burned?M.char:M.metal,0.26,0.32,wxp,0.5,sz*(hw-0.18),{rx:PI/2});
  }
  const segs = (side) => side<0 ? [[-hl,hl]] : [[-hl,-0.6],[0.6,4.3],[5.4,hl]];
  for (const sd of [-1,1]){
    const zz = sd*(hw-0.04);
    for (const [a,b] of segs(sd)){
      part(F,paint,b-a,1.15,0.08,(a+b)/2,0.925,zz);
      part(F,stripe,b-a,0.22,0.02,(a+b)/2,1.25,zz+sd*0.05);
      if (enter) part(F,null,b-a,1.5,0.2,(a+b)/2,0.75,zz,{col:true});
    }
    for (let px=-hl+0.06; px<=hl; px+=1.45){
      if (sd>0 && ((px>-0.7&&px<0.7)||(px>4.2&&px<5.5))) continue;
      part(F,paint,0.14,1.1,0.08,px,2.05,zz);
    }
    part(F,paint,L,0.42,0.08,0,2.81,zz);
    if (enter) part(F,null,L,0.55,0.2,0,2.875,zz,{col:true});
  }
  if (enter){
    // open doors (folded panels)
    for (const [a,b] of [[-0.6,0.6],[4.3,5.4]]){
      part(F,M.glassDk,0.06,2.0,0.32,a+0.05,1.6,hw-0.2); part(F,M.glassDk,0.06,2.0,0.32,b-0.05,1.6,hw-0.2);
    }
  }
  // front & rear
  part(F,paint,0.08,1.1,W,hl-0.04,0.9,0); part(F,stripe,0.02,0.22,W,hl+0.01,1.25,0);
  for (const sz of [-1,0,1]) part(F,paint,0.08,1.15,0.12,hl-0.04,2.05,sz*(hw-0.06));
  part(F,paint,0.08,0.42,W,hl-0.04,2.81,0);
  part(F,M.sign,0.02,0.26,1.6,hl+0.01,2.8,0,{ry:PI/2,geo:new THREE.PlaneGeometry(1.6,0.26)});
  part(F,M.dark,0.18,0.3,W,hl+0.05,0.5,0);
  for (const sz of [-1,1]) part(F,o.burned?M.dark:M.light,0.04,0.18,0.3,hl+0.01,0.8,sz*0.9);
  part(F,paint,0.08,2.65,W,-hl+0.04,1.675,0);
  part(F,M.glassDk,0.02,0.9,2.0,-hl-0.01,2.1,0);
  part(F,M.dark,0.18,0.3,W,-hl-0.05,0.5,0);
  part(F,paint,L+0.08,0.15,W+0.06,0,TOP+0.075,0);
  part(F,paint,2.4,0.35,1.6,-3.5,TOP+0.32,0);
  if (enter){
    part(F,null,L,FL,W,0,FL/2,0,{col:true});
    part(F,null,0.2,1.45,W,hl-0.05,0.725,0,{col:true});
    part(F,null,0.2,TOP,W,-hl+0.05,TOP/2,0,{col:true});
    part(F,null,L,0.15,W,0,TOP+0.075,0,{col:true});
    // interior
    part(F,M.rib,L-0.2,0.02,W-0.2,0,FL+0.01,0,{ts:1});
    part(F,M.light,L-1,0.05,0.4,0,TOP-0.03,0);
    const seat = (sx,sz,wide=0.8) => {
      part(F,M.seat,0.45,0.12,wide,sx,FL+0.42,sz);
      part(F,M.dark,0.3,0.36,0.08,sx,FL+0.18,sz);
      part(F,M.seat,0.08,0.58,wide,sx-0.22,FL+0.75,sz,{rz:0.1});
      part(F,null,0.5,FL+0.48,wide,sx,(FL+0.48)/2,sz,{col:true});
    };
    for (let sx=-4.9; sx<=3.5; sx+=0.85){ seat(sx,-0.85); if ((sx<-1.0)||(sx>1.0&&sx<3.9)) seat(sx,0.85); }
    seat(-5.6,0,2.3);
    // driver area
    part(F,M.seatBrn,0.5,0.14,0.55,4.85,FL+0.45,-0.8);
    part(F,M.seatBrn,0.1,0.65,0.55,4.58,FL+0.8,-0.8,{rz:0.12});
    part(F,M.dash,0.5,0.8,W-0.1,5.68,FL+0.4,0,{col:true});
    part(F,M.dash,0,0,0,5.3,FL+0.95,-0.8,{geo:new THREE.TorusGeometry(0.25,0.03,5,14),ry:PI/2,rx:0.9});
    part(F,M.dash,0.4,0.05,0.05,5.48,FL+0.85,-0.8,{rz:0.9});
    part(F,M.metal,0.05,1.35,0.85,4.3,FL+0.68,-0.85,{col:true});
    part(F,M.metal,0.28,1.0,0.28,4.75,FL+0.5,-0.25,{col:true});
    // grab poles & rails
    for (let px=-4.5; px<=3.5; px+=2.4) for (const sz of [-0.48,0.48]) cyl(F,M.metal,0.025,TOP-FL,px,(TOP+FL)/2,sz);
    for (const sz of [-0.95,0.95]) cyl(F,M.metal,0.022,L-1,0,2.45,sz,{rz:PI/2});
    // trash inside
    part(F,M.bag,0,0,0,-2.4,FL+0.25,0.05,{geo:new THREE.IcosahedronGeometry(0.28,0)});
    part(F,M.wood,0.8,0.05,0.6,1.5,FL+0.03,0.1,{ry:0.4});
    decal(F,11,1.8,0.9,-hl+0.1,2.0,0,PI/2);
    busZones.push({F,hl,hw});
  } else {
    part(F,M.char,L-0.3,2.3,W-0.3,0,1.75,0);
    addCol(F.x,F.z,hl,hw,0,TOP+0.15,yaw);
  }
  // graffiti on sides
  decal(F,o.tags?o.tags[0]:2,3.4,1.7,-2.8,1.0,-hw-0.01,PI);
  decal(F,o.tags?o.tags[1]:6,3.0,1.5,2.5,1.0,hw+0.01,0);
  shadowRects.push({x,z,w:L,d:W,h:2.5,yaw});
}

// ---------- Props ----------
function dumpster(x,z,yaw,blue){ [x,z]=RM(x,z);
  const F=frame(x,z,yaw), mat=blue?M.dumpBlue:M.dumpster;
  part(F,mat,1.9,1.15,1.1,0,0.68,0,{col:true,y0:0,y1:1.25});
  part(F,M.dark,1.95,0.08,0.7,0,1.45,-0.38,{rx:-0.9});
  for (const sx of [-0.8,0.8]) for (const sz of [-0.45,0.45]) cyl(F,M.dark,0.06,0.1,sx,0.06,sz,{rx:PI/2});
  if (rnd()<0.7) decal(F,Math.floor(rnd()*16),1.6,0.8,0,0.7,0.56,0);
  for (let i=0;i<4;i++) bag(x+rr(-1.6,1.6),z+rr(0.6,1.6));
  shadowRects.push({x,z,w:1.9,d:1.1,h:1.2,yaw});
}
// garbage bag: lumpy rounded sack with a flat base sitting on the ground and a tied neck on top
const BAG_GEOS=[];
function bagGeo(){
  if (BAG_GEOS.length<4){
    const g=new THREE.SphereGeometry(1,12,9), p=g.attributes.position, v=new V3(), ph=rnd()*6;
    for (let i=0;i<p.count;i++){ v.fromBufferAttribute(p,i);
      const n=1+0.09*Math.sin(v.x*5+ph)*Math.cos(v.z*4+ph*1.3)+0.05*Math.sin(v.y*7+ph*2);
      v.multiplyScalar(n); if (v.y<-0.55) v.y=-0.55-(v.y+0.55)*0.15;     // flattened where it rests on the ground
      v.y*=0.78; if (v.y>0.55) { v.x*=1-(v.y-0.55)*1.2; v.z*=1-(v.y-0.55)*1.2; }
      p.setXYZ(i,v.x,v.y,v.z); }
    g.translate(0,0.45,0); g.computeVertexNormals();
    const knot=new THREE.ConeGeometry(0.14,0.32,6); knot.translate(0,1.0,0);
    const ear1=new THREE.BoxGeometry(0.34,0.06,0.1); ear1.rotateZ(0.5); ear1.translate(0.12,1.12,0);
    const ear2=new THREE.BoxGeometry(0.3,0.06,0.1); ear2.rotateZ(-0.6); ear2.translate(-0.1,1.1,0.02);
    BAG_GEOS.push({_parts:[g,knot,ear1,ear2]});
  }
  return BAG_GEOS[Math.floor(rnd()*BAG_GEOS.length)];
}
function bag(x,z){
  const s=rr(0.26,0.36), mat=rnd()<0.6?M.bag:M.bag2, geo=bagGeo(), ry=rnd()*PI;
  for (const gp of geo._parts) part(F0,mat,0,0,0,x,0,z,{ry,geo:gp,sx:s,sy:s*rr(0.85,1.1),sz:s*rr(0.85,1.05)});
}
// a few bags along a wall/kerb line between two points
function bagRow(x0,z0,x1,z1,n){ [x0,z0]=RM(x0,z0); [x1,z1]=RM(x1,z1); for (let i=0;i<n;i++){ const t=rnd(); bag(lerp(x0,x1,t)+rr(-0.15,0.15), lerp(z0,z1,t)+rr(-0.15,0.15)); } }
function barrel(x,z,fire){ [x,z]=RM(x,z);
  cyl(F0,M.rust,0.3,0.9,x,0.45,z,{seg:9}); addCol(x,z,0.3,0.3,0,0.9);
  if (fire){ part(F0,M.fire,0,0,0,x,0.88,z,{geo:new THREE.ConeGeometry(0.22,0.45,5),ry:rnd()});
    part(F0,M.firePool,0,0,0,x,0.04,z,{rx:-PI/2,geo:new THREE.CircleGeometry(2.4,12)}); }
}
function tires(x,z,n){ [x,z]=RM(x,z); for (let i=0;i<n;i++) part(F0,M.tire,0,0,0,x+rr(-0.08,0.08),0.13+i*0.26,z+rr(-0.08,0.08),{geo:new THREE.TorusGeometry(0.33,0.13,5,9),rx:PI/2}); if(n>1) addCol(x,z,0.45,0.45,0,n*0.26); }
function bench(x,z,yaw){ [x,z]=RM(x,z);
  const F=frame(x,z,yaw);
  for (const dz of [-0.15,0,0.15]) part(F,M.wood,1.8,0.05,0.13,0,0.45,dz,{ts:1});
  part(F,M.wood,1.8,0.3,0.05,0,0.75,-0.25,{rx:-0.15,ts:1});
  for (const sx of [-0.75,0.75]) part(F,M.dark,0.08,0.45,0.45,sx,0.22,0);
  part(F,null,1.8,0.5,0.5,0,0.25,0,{col:true});
}
function lamp(x,z,yaw,lean=0){ [x,z]=RM(x,z);
  const F=frame(x,z,yaw);
  cyl(F,M.metal,0.08,6,0,3,0,{rz:lean,r2:0.06});
  part(F,M.metal,1.4,0.08,0.08,0.65+Math.sin(-lean)*6*0,6,0,{rz:lean});
  part(F,M.dark,0.5,0.15,0.25,1.3,5.95,0,{rz:lean});
  part(F,M.lampHead,0.4,0.04,0.18,1.3,5.86,0,{rz:lean});
  { const [px,pz]=toWorld(F,1.3+lean*-5,0); lightPools.push([px,pz,5]); }
  addCol(x,z,0.15,0.15,0,6);
}
function tree(x,z,dead){ [x,z]=RM(x,z);
  const h = dead? rr(3,4.5): rr(4,5.5);
  cyl(F0,M.bark,0.12,h,x,h/2,z,{r2:0.07,seg:6});
  if (dead){ for (let i=0;i<4;i++){ const a=rnd()*PI*2; part(F0,M.bark,0,0,0,x+Math.cos(a)*0.5,h*rr(0.6,0.9),z+Math.sin(a)*0.5,{geo:cylGeo(0.03,0.06,1.5,5),rx:Math.sin(a)*0.8,rz:-Math.cos(a)*0.8}); } }
  else { part(F0,M.leaves,0,0,0,x,h+0.6,z,{geo:new THREE.IcosahedronGeometry(rr(1.6,2.2),0)}); part(F0,M.leaves,0,0,0,x+0.6,h-0.3,z-0.4,{geo:new THREE.IcosahedronGeometry(1.2,0)}); }
  addCol(x,z,0.25,0.25,0,h);
}
function bush(x,z){ [x,z]=RM(x,z); part(F0,M.leaves,0,0,0,x,0.4,z,{geo:new THREE.IcosahedronGeometry(rr(0.5,0.9),0)}); }
function jersey(x,z,yaw){ [x,z]=RM(x,z);
  const F=frame(x,z,yaw);
  part(F,M.concrete,3,0.45,0.62,0,0.225,0); part(F,M.concrete,3,0.4,0.32,0,0.65,0);
  part(F,null,3,0.85,0.62,0,0.425,0,{col:true});
  if (rnd()<0.5) decal(F,Math.floor(rnd()*16),1.4,0.7,0,0.5,0.33,0);
}
function brickWall(x0,z0,x1,z1,h=3){ [x0,z0]=RM(x0,z0); [x1,z1]=RM(x1,z1);
  const len=Math.hypot(x1-x0,z1-z0), yaw=-Math.atan2(z1-z0,x1-x0);
  const F=frame((x0+x1)/2,(z0+z1)/2,yaw);
  part(F,M.brick,len,h,0.35,0,h/2,0,{col:true});
  part(F,M.concrete,len+0.1,0.15,0.45,0,h+0.07,0);
  const n=Math.floor(len/4);
  for (let i=0;i<n;i++){ const t=-len/2+(i+0.5)*len/n; decal(F,Math.floor(rnd()*16),rr(2.6,3.6),1.6,t,1.4,0.19,0); if(rnd()<0.8) decal(F,Math.floor(rnd()*16),rr(2.6,3.6),1.6,t+rr(-0.5,0.5),1.4,-0.19,PI); }
  shadowRects.push({x:F.x,z:F.z,w:len,d:0.35,h,yaw});
}
/* Chain-link fences. Bodies: one thin box along the fence (no gaps a player fits through).
   Bullets: only the solid parts — posts, the top rail and the sign plates — so shots go through the open mesh and over the
   top rail exactly where the visible fence ends (no oversized invisible barrier). */
function fenceBullet(F,len,h,postStep){
  for (let t=-len/2;t<=len/2+0.01;t+=postStep) part(F,null,0.08,h,0.08,t,h/2,0,{col:{nm:true}});
  part(F,null,len,0.07,0.07,0,h,0,{col:{nm:true}});
}
function fence(x0,z0,x1,z1,h=2.6){ [x0,z0]=RM(x0,z0); [x1,z1]=RM(x1,z1);
  const len=Math.hypot(x1-x0,z1-z0), yaw=-Math.atan2(z1-z0,x1-x0);
  const F=frame((x0+x1)/2,(z0+z1)/2,yaw);
  part(F,M.chain,0,0,0,0,h/2,0,{geo:planeUV(len,h,len/1.2,h/1.2)});
  for (let t=-len/2;t<=len/2+0.01;t+=3) cyl(F,M.metal,0.04,h,t,h/2,0,{seg:5});
  cyl(F,M.metal,0.03,len,0,h,0,{rz:PI/2,seg:5});
  part(F,null,len,h+0.04,0.15,0,(h+0.04)/2,0,{col:{nb:true}});
  fenceBullet(F,len,h,3);
}
// Designated climbable fence: low chain-link with a yellow top rail. Its body collider is taller than you can jump
// (the only way over is the SPACE vault) but bullets only stop on the posts / rail / plates: you can shoot through the
// mesh and over the 1.5 m rail.
function climbFence(x0,z0,x1,z1){ [x0,z0]=RM(x0,z0); [x1,z1]=RM(x1,z1);
  const h=1.5, len=Math.hypot(x1-x0,z1-z0), yaw=-Math.atan2(z1-z0,x1-x0);
  const F=frame((x0+x1)/2,(z0+z1)/2,yaw);
  part(F,M.chain,0,0,0,0,h/2,0,{geo:planeUV(len,h,len/1.2,h/1.2)});
  for (let t=-len/2;t<=len/2+0.01;t+=2.5) cyl(F,M.metal,0.04,h,t,h/2,0,{seg:5});
  cyl(F,M.climb,0.045,len,0,h,0,{rz:PI/2,seg:6});
  for (let t=-len/2+0.6;t<len/2;t+=1.6){ part(F,M.climb,0.25,0.12,0.02,t,1.0,0.02); part(F,null,0.25,0.12,0.03,t,1.0,0.02,{col:{nm:true}}); }
  part(F,null,len,2.4,0.16,0,1.2,0,{col:{nb:true}});
  fenceBullet(F,len,h,2.5);
  vaults.push({ax:x0,az:z0,bx:x1,bz:z1,h,len});
}
function mattress(x,z,yaw){ [x,z]=RM(x,z); part(frame(x,z,yaw),M.mattress,1.9,0.2,1.4,0,0.6,0.5,{rx:1.1,ts:1}); }
function couch(x,z,yaw){ [x,z]=RM(x,z);
  const F=frame(x,z,yaw);
  part(F,M.couch,2,0.45,0.85,0,0.22,0,{ts:1}); part(F,M.couch,2,0.5,0.25,0,0.7,-0.32,{ts:1});
  for (const sx of [-0.92,0.92]) part(F,M.couch,0.2,0.3,0.85,sx,0.6,0,{ts:1});
  part(F,null,2,0.5,0.85,0,0.25,0,{col:true});
}
function crates(x,z,yaw){ [x,z]=RM(x,z);
  const F=frame(x,z,yaw);
  part(F,M.wood,1.2,0.14,1.0,0,0.07,0,{ts:1}); part(F,M.wood,1.2,0.14,1.0,0.05,0.21,0,{ts:1,ry:0.1});
  part(F,M.wood,0.9,0.9,0.9,0.1,0.72,0.05,{ts:1,ry:0.3});
  part(F,null,1.2,1.2,1.0,0,0.6,0,{col:true});
}
function hoop(x,z,yaw){ [x,z]=RM(x,z);
  const F=frame(x,z,yaw);
  cyl(F,M.metal,0.08,3.4,0,1.7,0); part(F,M.metal,0.08,0.08,0.9,0,3.3,-0.45);
  part(F,M.light,1.8,1.05,0.06,0,3.45,-0.9); decal(F,7,1.2,0.6,0,3.3,-0.94,PI);
  part(F,M.red,0,0,0,0,3.05,-1.18,{geo:new THREE.TorusGeometry(0.23,0.02,4,10),rx:PI/2+0.3});
  addCol(...toWorld(F,0,0),0.15,0.15,0,3.4,yaw);
}
function busShelter(x,z,yaw){ [x,z]=RM(x,z);
  const F=frame(x,z,yaw);
  part(F,M.metal,3.4,0.08,1.6,0,2.5,0); for (const sx of [-1.6,1.6]) part(F,M.metal,0.08,2.5,0.08,sx,1.25,-0.7);
  part(F,M.glass,3.2,1.6,0.03,0,1.5,-0.72,{col:false});
  part(F,null,3.4,2.5,0.12,0,1.25,-0.72,{col:true});
  bench(...toWorld(F,0,-0.35),yaw);
  decal(F,14,1.6,0.8,-0.6,1.7,-0.7,0);
}
function planter(cx,cz){
  for (let i=0;i<8;i++){
    const a=i*PI/4, x=cx+3*Math.cos(a), z=cz+3*Math.sin(a);
    part(F0,M.concrete,2.55,0.55,0.4,x,0.275,z,{col:true,ry:-a-PI/2});
  }
  cyl(F0,M.soil,2.8,0.4,cx,0.2,cz,{seg:10});
  addCol(cx,cz,2.2,2.2,0,0.45,PI/8);   // (no tree: this is THE FIGHT FOR ZA objective spot)
  decal(F0,10,1.6,0.8,cx+3.22*Math.cos(PI/2),0.3,cz+3.22*Math.sin(PI/2),0);
}
function skyline(scene){
  const grp = new THREE.Group();
  for (let i=0;i<40;i++){
    const a=i/40*PI*2+rr(-0.05,0.05), r=rr(140,200), w=rr(14,34), h=rr(18,70);
    const geo=new THREE.BoxGeometry(w,h,w*rr(0.6,1.2)), uv=geo.attributes.uv;
    for (let k=0;k<uv.count;k++) uv.setXY(k, uv.getX(k)*w/14, uv.getY(k)*h/26);   // window size stays constant per tower
    const m=new THREE.Mesh(geo, M.skyline);
    m.position.set(Math.cos(a)*r,h/2,Math.sin(a)*r); m.rotation.y=-a; grp.add(m);
  }
  scene.add(grp); return grp;
}

// ---------- Whole map ----------
// ---------- Enterable buildings around the outside of the block (central layout unchanged) ----------
// Imported models (assets/outer.js): 2 shanty warehouses and 2 abandoned shelters, one of each pair on opposite sides of the
// map, turned at natural angles. The models are only visuals; the walls, doorways, window gaps, walkable roofs, ladders and
// props below are built in each building's local frame and match the models (measured from the meshes).
const OUTER_BUILDINGS = [
  // Update 5: placed just outside the ring road (compressed map), fronts facing the block
  {id:'W1', name:'Shanty warehouse',  model:'warehouse', x:-37, z:51.6, yaw:PI+0.03, painting:true},
  {id:'W2', name:'Rusted warehouse',  model:'warehouse', x:26,  z:49.5,  yaw:PI-0.04},
  {id:'S1', name:'Abandoned shelter', model:'shelter',   x:57.4, z:-30, yaw:0.05},
  {id:'S2', name:'Old shelter',       model:'shelter',   x:-58.6, z:46, yaw:PI-0.06},
];
// local layouts (three.js model space: x right, y up, z = toward the model's front)
const OUTER_LAYOUT = {
  warehouse:{ half:[5.2,4.0],
    // [axis, fixed, from, to, height, openings, y0]
    walls:[ ['z',-4.75,-2.87,3.13,6.3,[{c:0,w:1.4,y0:1.0,y1:1.9}]],                                  // west (window)
            ['x',-2.87,-4.75,0.5,6.3,[{c:-3.0,w:1.2,y0:1.0,y1:1.9}]],                                // back, tall part (window)
            ['x',-2.87,0.5,3.5,2.9,[]],                                                               // back, lean-to
            ['z',3.5,-2.87,2.55,2.45,[{c:0,w:1.2,y0:1.0,y1:1.8}]],                                   // east (window)
            ['x',3.13,-4.75,-0.25,6.3,[{c:-2.5,w:1.3,y0:1.0,y1:1.9},{c:-1.02,w:1.45,y0:0,y1:2.2}]],  // front: window + doorway
            ['z',-0.25,2.55,3.13,3.0,[]], ['x',2.55,-0.25,3.5,2.9,[]],                                // lean-to front
            ['z',0.5,-2.87,2.55,6.3,[],3.1] ],                                                        // tall wall above the lean-to roof
    // walkable lean-to roof: [x0, x1, top] strips (measured from the scan)
    roof:{axis:'x', from:-3.0, to:2.65, strips:[[0.5,1.0,3.14],[1.0,1.5,3.05],[1.5,2.0,2.96],[2.0,2.5,2.87],[2.5,3.0,2.76],[3.0,3.5,2.64],[3.5,4.0,2.48],[4.0,4.5,2.38]]},
    ladder:{x:2.25, z:-2.87, nx:0, nz:-1, h:2.87},          // on the back wall, up to the lean-to roof
    props:[ ['crate',2.6,1.6,0.8], ['crate',2.6,0.7,0.6], ['crate',-4.0,2.4,0.7], ['table',-2.0,-1.6], ['mattress',1.8,-1.7] ],
    door:{x:-1.02, z:3.13, nx:0, nz:1},
    easel:[-3.7,-1.0,1.35] },        // canvas turned toward the room
  shelter:{ half:[2.6,2.2],
    walls:[ ['z',-1.53,-1.83,1.92,2.4,[{c:-1.3,w:1.1,y0:0,y1:2.1}]],     // west: the doorway (door leaf hangs open outside)
            ['x',-1.83,-1.53,2.0,2.3,[{c:0.6,w:0.8,y0:1.0,y1:1.65,glass:true}]],      // north (window)
            ['x',1.92,-1.53,2.0,2.3,[{c:0.37,w:0.72,y0:0.78,y1:1.63,glass:true}]],    // south (the model's own window; measured by ray-probing the mesh)
            ['z',2.0,-1.83,1.92,2.4,[{c:-0.55,w:0.8,y0:1.0,y1:1.65,glass:true}]] ],   // east / back (window)
    roof:{axis:'z', from:-2.0, to:2.0, ridge:3.4, slope:0.55, band:0.4, w:3.9, cx:0.25},
    ladder:{x:2.0, z:1.0, nx:1, nz:0},
    door:{x:-1.53, z:-1.3, nx:-1, nz:0},
    props:[ ['mattress',0.9,1.0], ['crate',1.5,-1.3,0.6] ] },
};
/* Update 5: the imported houses are 1.2x bigger (model, walls, openings, roof, ladder, door — furniture keeps its size)
   and sit on the compressed layout. */
const HOUSE_SCALE = 1.2;
(function scaleLayouts(k){
  for (const L of Object.values(OUTER_LAYOUT)){
    L.half=L.half.map(v=>v*k);
    for (const w of L.walls){ w[1]*=k; w[2]*=k; w[3]*=k; w[4]*=k; if (w[6]) w[6]*=k; for (const o of w[5]){ o.c*=k; o.w*=k; o.y0*=k; o.y1*=k; } }
    const R=L.roof; for (const key of ['from','to','ridge','band','w','cx']) if (R[key]!==undefined) R[key]*=k;
    if (R.strips) R.strips=R.strips.map(([a,b,t])=>[a*k,b*k,t*k]);
    for (const key of ['x','z','h']) if (L.ladder[key]!==undefined) L.ladder[key]*=k;
    for (const p of L.props){ p[1]*=k; p[2]*=k; }
    if (L.door){ L.door.x*=k; L.door.z*=k; }
    if (L.easel){ L.easel[0]*=k; L.easel[1]*=k; }
  }
})(HOUSE_SCALE);
OUTER_BUILDINGS.forEach(o=>{ const L=OUTER_LAYOUT[o.model], c=Math.abs(Math.cos(o.yaw)), sn=Math.abs(Math.sin(o.yaw)), hx=L.half[0]*c+L.half[1]*sn, hz=L.half[0]*sn+L.half[1]*c; o.x0=o.x-hx; o.x1=o.x+hx; o.z0=o.z-hz; o.z1=o.z+hz; });
// invisible wall colliders with real gaps for doorways and windows: [axis, fixed, from, to, height, openings, y0]
function outerWallCols(F, axis, fixed, a, b, h, openings, base=0, T=0.22){
  const ops=openings.slice().sort((p,q)=>p.c-q.c); let cur=a;
  const seg=(u0,u1,y0,y1)=>{ const len=u1-u0; if (len<0.02||y1-y0<0.02) return; const cu=(u0+u1)/2, cy=(y0+y1)/2;
    if (axis==='x') part(F,null,len,y1-y0,T,cu,cy,fixed,{col:true}); else part(F,null,T,y1-y0,len,fixed,cy,cu,{col:true}); };
  for (const o of ops){ const o0=o.c-o.w/2, o1=o.c+o.w/2; seg(cur,o0,base,h); seg(o0,o1,base,o.y0); seg(o0,o1,o.y1,h); cur=o1;
    // glass: breakable pane exactly filling the opening (see Glass)
    if (o.glass) Glass.add(F, axis, fixed, o.c, o.y0, o.y1, o.w, 'thick'); }
  seg(cur,b,base,h);
}
// steel ladder fixed to a wall (any angle); the climb zone uses the same rules as the block's ladders
function outerLadder(F, lx, lz, nx, nz, h, name){
  const ax=-nz, az=nx, top=h+1.0, wn=[nx*F.c+nz*F.s, -nx*F.s+nz*F.c];
  const ox=lx+nx*0.2, oz=lz+nz*0.2;
  for (const k of [-0.3,0.3]){ part(F,M.rust,0.06,top,0.06,ox+ax*k,top/2,oz+az*k); part(F,M.rust,0.06,0.06,0.9,ox+ax*k-nx*0.35,top,oz+az*k-nz*0.35,{ry:Math.atan2(nx,nz)}); }
  for (let y=0.3;y<top;y+=0.3) part(F,M.rust,0.6,0.05,0.05,ox,y,oz,{ry:Math.atan2(-nz,nx)});
  const [wx,wz]=toWorld(F,lx,lz), [cx,cz]=toWorld(F,lx+nx*0.5,lz+nz*0.5);
  ladders.push({x0:Math.min(wx,cx)-0.45, x1:Math.max(wx,cx)+0.45, z0:Math.min(wz,cz)-0.45, z1:Math.max(wz,cz)+0.45, top:h+0.25, nx:wn[0], nz:wn[1], name, wx, wz, h, ax:0, az:0});
}
function outerProp(F, kind, x, z, s){
  if (kind==='crate') part(F,M.wood,s,s,s,x,s/2,z,{col:true, ry:x*0.37});
  else if (kind==='table'){ part(F,M.wood,1.3,0.08,0.8,x,0.78,z); part(F,M.wood,1.2,0.74,0.7,x,0.37,z,{col:true}); }
  else if (kind==='mattress') part(F,M.mattress,1.9,0.22,1.0,x,0.11,z,{col:true, ry:0.15});
}
// the canvas on an easel; the picture is the imported image
function outerEasel(F, x, z, ry){
  const [wx,wz]=toWorld(F,x,z), E=frame(wx,wz,F.yaw+ry);           // easel frame: canvas faces +z
  part(E,M.wood,0.05,1.8,0.05,-0.4,0.9,0.05,{rz:-0.12}); part(E,M.wood,0.05,1.8,0.05,0.4,0.9,0.05,{rz:0.12}); part(E,M.wood,0.05,1.7,0.05,0,0.82,-0.35,{rx:0.28});
  part(E,M.wood,0.95,0.05,0.1,0,0.63,0.1);
  part(E,null,0.9,1.4,0.6,0,0.7,-0.05,{col:true});
  const g=new THREE.Group(); g.position.set(wx,0,wz); g.rotation.y=E.yaw;
  const tex=new THREE.TextureLoader().load(window.IMG_PAINTING||'', t=>{ t.encoding=THREE.sRGBEncoding; t.needsUpdate=true; });
  const w=0.72, h=0.72*598/360, c=new THREE.Group(); c.position.set(0,0.66+h/2,0.12); c.rotation.x=-0.1;
  const frameM=new THREE.Mesh(new THREE.BoxGeometry(w+0.06,h+0.06,0.035), new THREE.MeshLambertMaterial({color:'#ece6d6'}));
  const pic=new THREE.Mesh(new THREE.PlaneGeometry(w,h), new THREE.MeshLambertMaterial({map:tex})); pic.position.z=0.019;
  c.add(frameM,pic); g.add(c); g.traverse(m=>{ if (m.isMesh) m.castShadow=true; }); OuterModels.extra.push(g);
}
/* ---------- Breakable windows (Update 5) ----------
   Every glass pane is a real target: a collider exactly the size of the visible pane (3 cm thick) that stops bullets
   (player's and bots') and bodies. Hits take durability (thin / standard / thick glass); at 60% the pane cracks
   (it turns milky), at 0 it shatters: the collider is REMOVED from the world (nothing invisible is left in the
   opening), the pane disappears, jagged shards stay in the frame, and pooled fragments fall. Broken stays broken
   until the next match. All panes are one merged mesh (one draw call); fragments are one instanced mesh. */
const GLASS_HP = { thin:20, std:40, thick:70 };
const Glass = {
  panes:[], mesh:null, rim:null, frag:null, frags:[],
  add(F, axis, fixed, c, y0, y1, w, kind='std', o={}){
    const T=0.03, cy=(y0+y1)/2, h=y1-y0, lx=axis==='x'?c:fixed, lz=axis==='x'?fixed:c, [wx,wz]=toWorld(F,lx,lz);
    const P=(u,y)=>{ const [x,z]= axis==='x' ? toWorld(F,c+u,fixed) : toWorld(F,fixed,c+u); return new V3(x,F.y+y,z); };
    const pane={id:this.panes.length, kind, max:GLASS_HP[kind]||40, hp:0, broken:false, cracked:false, startBroken:!!o.broken,
      corners:[P(-w/2,y0),P(w/2,y0),P(w/2,y1),P(-w/2,y1)], center:new V3(wx,F.y+cy,wz), w, h,
      colArgs:[wx,wz, axis==='x'?w/2:T/2, axis==='x'?T/2:w/2, F.y+y0, F.y+y1, F.yaw], col:null};
    this.panes.push(pane); this.restore(pane, true); return pane;
  },
  restore(p, first){
    p.hp=p.max; p.cracked=false; p.broken=p.startBroken;
    if (!p.broken && !p.col){ const a=p.colArgs; p.col=addCol(a[0],a[1],a[2],a[3],a[4],a[5],a[6]); p.col.glass=p; }
    if (p.broken && p.col){ const i=colliders.indexOf(p.col); if (i>=0) colliders.splice(i,1); p.col=null; }
    if (!first) this.write(p);
  },
  // merged pane mesh + merged jagged-rim mesh (rim triangles are collapsed until the pane breaks)
  build(scene){
    const n=this.panes.length; if (!n) return;
    const pos=new Float32Array(n*6*3), col=new Float32Array(n*6*3), rim=new Float32Array(n*RIM_TRIS*9);
    const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(pos,3)); g.setAttribute('color',new THREE.BufferAttribute(col,3));
    const r=new THREE.BufferGeometry(); r.setAttribute('position',new THREE.BufferAttribute(rim,3));
    this.mesh=new THREE.Mesh(g, new THREE.MeshLambertMaterial({color:'#ffffff', vertexColors:true, transparent:true, opacity:0.36, depthWrite:false, side:THREE.DoubleSide}));
    this.rim=new THREE.Mesh(r, new THREE.MeshLambertMaterial({color:'#b9c9cf', transparent:true, opacity:0.6, side:THREE.DoubleSide}));
    this.mesh.frustumCulled=this.rim.frustumCulled=false; this.mesh.renderOrder=2;
    scene.add(this.mesh); scene.add(this.rim);
    for (const p of this.panes) this.write(p);
    const fg=new THREE.BufferGeometry(); fg.setAttribute('position',new THREE.BufferAttribute(new Float32Array([-0.06,0,0, 0.07,0.02,0, 0,0.11,0]),3)); fg.computeVertexNormals();
    this.frag=new THREE.InstancedMesh(fg, new THREE.MeshLambertMaterial({color:'#c8d8de', transparent:true, opacity:0.75, side:THREE.DoubleSide}), 64);
    this.frag.count=0; this.frag.frustumCulled=false; scene.add(this.frag);
  },
  write(p){
    if (!this.mesh) return;
    const pa=this.mesh.geometry.attributes.position, ca=this.mesh.geometry.attributes.color, ra=this.rim.geometry.attributes.position;
    const [a,b,c,d]=p.corners, o=p.id*6;
    const quad=p.broken ? [a,a,a,a,a,a] : [a,b,c, a,c,d];
    quad.forEach((v,i)=>pa.setXYZ(o+i,v.x,v.y,v.z));
    const t=p.cracked ? [0.95,0.97,0.98] : [0.55,0.68,0.74]; for (let i=0;i<6;i++) ca.setXYZ(o+i,...t);
    // jagged shards left in the frame: triangles from each edge pointing inward, only when broken
    const R=rimTris(p); for (let i=0;i<RIM_TRIS;i++) for (let k=0;k<3;k++){ const v=p.broken?R[i][k]:a; ra.setXYZ((p.id*RIM_TRIS+i)*3+k, v.x,v.y,v.z); }
    pa.needsUpdate=ca.needsUpdate=ra.needsUpdate=true; this.rim.geometry.computeVertexNormals();
  },
  hit(p, dmg, point, dir){
    if (p.broken) return false;
    p.hp-=Math.max(1,dmg);
    if (p.hp<=0){ this.shatter(p, dir, true); return true; }
    if (!p.cracked && p.hp<=p.max*0.6){ p.cracked=true; this.write(p); }
    if (typeof Snd!=='undefined' && Snd.glassHit) Snd.glassHit(point);
    return false;
  },
  shatter(p, dir, local){
    if (p.broken) return; p.broken=true;
    if (p.col){ const i=colliders.indexOf(p.col); if (i>=0) colliders.splice(i,1); p.col=null; }   // nothing left in the opening
    this.write(p);
    const d=(dir||new V3(0,0,1)).clone().setY(0).normalize();
    const nFrag={full:12,reduced:7,minimal:3}[Perf.fx()]||12;
    for (let i=0;i<nFrag;i++){
      const f=this.frags.length<64 ? {} : this.frags.shift();
      const u=Math.random(), v=Math.random(), [a,b,,dd]=p.corners;
      f.p=a.clone().lerp(b,u).add(dd.clone().sub(a).multiplyScalar(v));
      f.v=d.clone().multiplyScalar(1.2+Math.random()*2.2).add(new V3((Math.random()-0.5)*1.5, Math.random()*1.4, (Math.random()-0.5)*1.5));
      f.r=new V3(Math.random()*6,Math.random()*6,Math.random()*6); f.rv=new V3((Math.random()-0.5)*14,(Math.random()-0.5)*14,(Math.random()-0.5)*14);
      f.t=0; f.s=0.6+Math.random()*0.9; this.frags.push(f);
    }
    if (typeof Snd!=='undefined' && Snd.glassBreak) Snd.glassBreak(p.center);
    if (local && typeof Net!=='undefined' && Net.inMatch) Net.send({t:'glass', id:p.id});
  },
  update(dt){
    if (!this.frag) return; const m=new THREE.Matrix4(), q=new THREE.Quaternion(), e=new THREE.Euler(), S=new V3();
    this.frags=this.frags.filter(f=>f.t<1.6); let n=0;
    for (const f of this.frags){ f.t+=dt;
      if (f.p.y>0.02){ f.v.y-=9.8*dt; f.p.addScaledVector(f.v,dt); f.r.addScaledVector(f.rv,dt); if (f.p.y<0.02){ f.p.y=0.02; f.v.set(0,0,0); f.rv.set(0,0,0); } }
      const k=f.t>1.2 ? 1-(f.t-1.2)/0.4 : 1; S.setScalar(f.s*Math.max(0.01,k));
      m.compose(f.p, q.setFromEuler(e.set(f.r.x,f.r.y,f.r.z)), S); this.frag.setMatrixAt(n++, m); }
    this.frag.count=n; this.frag.instanceMatrix.needsUpdate=true;
  },
  reset(){ for (const p of this.panes) this.restore(p); this.frags=[]; if (this.frag) this.frag.count=0; },
};
const RIM_TRIS=8;
function rimTris(p){
  const [a,b,c,d]=p.corners, L=(x,y,t)=>x.clone().lerp(y,t), C=p.center, T=[], rs=p.id*7.13;
  const jag=(x,y,t0,t1,k)=>{ const m=L(x,y,(t0+t1)/2), depth=0.18+0.22*Math.abs(Math.sin(rs+k*2.1)); T.push([L(x,y,t0), L(x,y,t1), m.clone().lerp(C,depth)]); };
  jag(a,b,0,0.45,1); jag(a,b,0.5,1,2); jag(b,c,0,0.55,3); jag(b,c,0.6,1,4); jag(c,d,0,0.4,5); jag(c,d,0.45,1,6); jag(d,a,0,0.5,7); jag(d,a,0.55,1,8);
  return T;
}

/* ---------- Low-poly buildings (Update 5) ----------
   Simple boxes with real openings: walls are built in segments around doors and windows (each segment is both the
   visible wall and its collider), windows get frames and breakable glass (or plywood boards), roofs are flat
   (walkable, with a ladder and a parapet gap), gable, hip or shed. Enterable ones have a floor, a ceiling, an inside
   partition with a doorway, and furniture with colliders. Front = local +z. */
function lpWall(F, axis, fixed, a, b, h, ops, mat, T=0.2){
  const seg=(u0,u1,y0,y1)=>{ const len=u1-u0; if (len<0.02||y1-y0<0.02) return; const cu=(u0+u1)/2, cy=(y0+y1)/2;
    if (axis==='x') part(F,mat,len,y1-y0,T,cu,cy,fixed,{col:true}); else part(F,mat,T,y1-y0,len,fixed,cy,cu,{col:true}); };
  let cur=a;
  for (const o of ops.slice().sort((p,q)=>p.c-q.c)){ const o0=o.c-o.w/2, o1=o.c+o.w/2; seg(cur,o0,0,h); seg(o0,o1,0,o.y0); seg(o0,o1,o.y1,h); cur=o1;
    if (o.y0>0.1){   // window: trim + glass or boards
      const tf=(du,y,w,hh)=>{ if (axis==='x') part(F,M.trim,w,hh,T+0.06,o.c+du,y,fixed); else part(F,M.trim,T+0.06,hh,w,fixed,y,o.c+du); };
      tf(0,o.y0-0.04,o.w+0.16,0.08); tf(0,o.y1+0.04,o.w+0.16,0.08); tf(-o.w/2-0.04,(o.y0+o.y1)/2,0.08,o.y1-o.y0); tf(o.w/2+0.04,(o.y0+o.y1)/2,0.08,o.y1-o.y0);
      if (o.boards){ for (let k=0;k<3;k++){ const y=o.y0+(k+0.5)*(o.y1-o.y0)/3, sk=(k-1)*0.12;
          if (axis==='x') part(F,M.plywood,o.w+0.1,0.24,0.03,o.c,y,fixed+(fixed>0?0.13:-0.13),{rz:sk,ts:1}); else part(F,M.plywood,0.03,0.24,o.w+0.1,fixed+(fixed>0?0.13:-0.13),y,o.c,{rx:sk,ts:1}); }
        seg(o0,o1,o.y0,o.y1); }              // boarded up: solid
      else Glass.add(F, axis, fixed, o.c, o.y0, o.y1, o.w, o.glass||'std', {broken:!!o.broken});
    } else if (o.door!==false){   // door leaf standing open inside the room
      const sgn=fixed>0?-1:1;
      if (axis==='x') part(F,M.doorWood,0.05,o.y1-0.06,o.w-0.1,o.c-o.w/2+0.03,(o.y1-0.06)/2,fixed+sgn*(o.w-0.1)/2,{});
      else part(F,M.doorWood,o.w-0.1,o.y1-0.06,0.05,fixed+sgn*(o.w-0.1)/2,(o.y1-0.06)/2,o.c-o.w/2+0.03,{});
    }
  }
  seg(cur,b,0,h);
}
function lpFurniture(F, kind, x, z, ry=0){
  const P=(w,h,d,y,mat,col=true,dx=0,dz=0)=>part(F,mat,w,h,d,x+dx,y,z+dz,{ry,col});
  if (kind==='bed'){ P(2.0,0.35,1.2,0.18,M.wood); part(F,M.mattress,1.9,0.18,1.1,x,0.44,z,{ry}); }
  else if (kind==='couch'){ P(2.0,0.45,0.85,0.22,M.couch); part(F,M.couch,2.0,0.5,0.22,x,0.7,z-0.32,{ry}); }
  else if (kind==='table'){ part(F,M.wood,1.3,0.08,0.8,x,0.76,z,{ry}); P(1.2,0.72,0.7,0.36,M.wood,true); }
  else if (kind==='fridge') P(0.75,1.8,0.7,0.9,M.light);
  else if (kind==='counter'){ P(2.2,0.9,0.6,0.45,M.wood); part(F,M.light,2.2,0.05,0.62,x,0.92,z,{ry}); }
  else if (kind==='shelf') P(1.2,1.9,0.4,0.95,M.wood);
  else if (kind==='crate') P(0.8,0.8,0.8,0.4,M.wood);
  else if (kind==='tv'){ P(1.2,0.5,0.45,0.25,M.dark); part(F,M.dark,1.0,0.6,0.08,x,0.82,z,{ry}); }
}
const LP_BUILDINGS = [];
function lpBuilding(o){
  const F=frame(o.x,o.z,o.yaw), w=o.w, d=o.d, h=o.h||2.9, T=0.2, hw=w/2, hd=d/2, before=colliders.length;
  const ops={s:[],n:[],e:[],w:[]};
  if (o.door) ops[o.door.side||'s'].push({c:o.door.c||0, w:o.door.w||1.2, y0:0, y1:2.15});
  for (const wn of o.wins||[]) ops[wn.side].push({c:wn.c, w:wn.w||1.1, y0:wn.y0||0.95, y1:wn.y1||1.95, glass:wn.glass, boards:wn.boards, broken:wn.broken});
  lpWall(F,'x', hd, -hw, hw, h, ops.s, o.mat, T);
  lpWall(F,'x',-hd, -hw, hw, h, ops.n, o.mat, T);
  lpWall(F,'z',-hw, -hd+T/2, hd-T/2, h, ops.w, o.mat, T);
  lpWall(F,'z', hw, -hd+T/2, hd-T/2, h, ops.e, o.mat, T);
  part(F,M.concreteDk,w+0.3,0.18,d+0.3,0,0.09-0.16,0);                                    // foundation lip
  if (o.enter){ part(F,M.floorWood,w-0.3,0.03,d-0.3,0,0.015,0,{ts:1});                    // floor (visual)
    if (o.roof!=='flat') part(F,M.interior,w-0.2,0.06,d-0.2,0,h-0.03,0); }                 // ceiling
  // roof
  const R=o.roof, rm=o.roofMat||M.shingle, rh=o.rh||Math.min(1.6,d*0.3);
  if (R==='flat'){
    part(F,o.mat===M.brickB||o.mat===M.brick?M.concreteDk:M.tar,w+0.2,0.2,d+0.2,0,h+0.1,0,{col:true});
    const ls=o.ladder&&(o.ladder.side||'n'), pg=o.ladder ? [o.ladder.c-0.75,o.ladder.c+0.75] : null;   // parapet with a gap where the ladder arrives
    const gapHere=(axis,fixed)=> pg && ((ls==='n'&&axis==='x'&&fixed<0)||(ls==='s'&&axis==='x'&&fixed>0)||(ls==='w'&&axis==='z'&&fixed<0)||(ls==='e'&&axis==='z'&&fixed>0));
    const par=(axis,fixed,a,b)=>{ const runs = gapHere(axis,fixed) ? [[a,pg[0]],[pg[1],b]] : [[a,b]];
      for (const [u0,u1] of runs) if (u1-u0>0.05){ if (axis==='x') part(F,M.concreteDk,u1-u0,0.45,0.2,(u0+u1)/2,h+0.42,fixed,{col:true}); else part(F,M.concreteDk,0.2,0.45,u1-u0,fixed,h+0.42,(u0+u1)/2,{col:true}); } };
    par('x',hd,-hw-0.1,hw+0.1); par('x',-hd,-hw-0.1,hw+0.1); par('z',-hw,-hd+0.1,hd-0.1); par('z',hw,-hd+0.1,hd-0.1);
    if (o.ladder){ const L={n:[o.ladder.c,-hd,0,-1],s:[o.ladder.c,hd,0,1],e:[hw,o.ladder.c,1,0],w:[-hw,o.ladder.c,-1,0]}[ls]; outerLadder(F, L[0], L[1], L[2], L[3], h+0.2, o.name); }
  } else if (R==='gable'){
    const ang=Math.atan2(rh,hd+0.3), sl=Math.hypot(hd+0.3,rh)+0.05;
    part(F,rm,w+0.5,0.12,sl,0,h+rh/2,(hd+0.3)/2,{rx:ang,ts:2}); part(F,rm,w+0.5,0.12,sl,0,h+rh/2,-(hd+0.3)/2,{rx:-ang,ts:2});
    const tri=new THREE.Shape(); tri.moveTo(-hd,0); tri.lineTo(hd,0); tri.lineTo(0,rh); tri.lineTo(-hd,0);
    const tg=new THREE.ExtrudeGeometry(tri,{depth:0.16,bevelEnabled:false}); tg.translate(0,0,-0.08); tg.rotateY(PI/2);
    part(F,o.mat,0,0,0,-hw+0.08,h,0,{geo:tg}); part(F,o.mat,0,0,0,hw-0.08,h,0,{geo:tg.clone()});
    part(F,null,w,rh*0.7,d*0.6,0,h+rh*0.35,0,{col:true}); part(F,null,w,0.15,d,0,h+0.07,0,{col:true});
  } else if (R==='hip'){
    const cg=new THREE.ConeGeometry(1,1,4,1); cg.rotateY(PI/4); cg.translate(0,0.5,0);
    part(F,rm,0,0,0,0,h,0,{geo:cg, sx:(w+0.6)/Math.SQRT2, sy:rh, sz:(d+0.6)/Math.SQRT2});
    part(F,null,w*0.7,rh*0.6,d*0.7,0,h+rh*0.3,0,{col:true}); part(F,null,w,0.15,d,0,h+0.07,0,{col:true});
  } else {   // shed: one slope from the front (high) to the back (low)
    const ang=Math.atan2(rh,d+0.4), sl=Math.hypot(d+0.4,rh)+0.05;
    part(F,o.roofMat||M.tin,w+0.4,0.08,sl,0,h+rh/2,0,{rx:-ang,ts:2});
    for (const sx of [-1,1]){ const tri=new THREE.Shape(); tri.moveTo(-hd,0); tri.lineTo(hd,0); tri.lineTo(hd,rh); tri.lineTo(-hd,0); const tg=new THREE.ExtrudeGeometry(tri,{depth:0.16,bevelEnabled:false}); tg.translate(0,0,-0.08); tg.rotateY(PI/2); part(F,o.mat,0,0,0,sx*(hw-0.08),h,0,{geo:tg}); }
    part(F,null,w,rh*0.5+0.15,d,0,h+rh*0.25,0,{col:true});
  }
  if (o.damaged) for (const [x,z,s] of o.damaged) part(F,M.plywood,s,0.05,s*0.7,x,h+rh*0.6,z,{rx:0.4,rz:0.2,ts:1});   // patched holes
  // porch: deck (walkable step), posts, little roof
  if (o.porch){ const pc=o.door?o.door.c||0:0, pw=o.porch.w||3.2;
    part(F,M.wood,pw,0.24,1.7,pc,0.12,hd+0.85,{col:true,ts:1});
    part(F,M.wood,pw*0.5,0.12,0.4,pc,0.06,hd+1.9,{col:true,ts:1});
    for (const sx of [-1,1]){ part(F,M.trim,0.12,2.3,0.12,pc+sx*(pw/2-0.1),1.39,hd+1.6); }
    part(F,o.roofMat||M.tin,pw+0.4,0.08,2.0,pc,2.6,hd+1.0,{rx:0.12}); }
  // front path to the door
  if (o.door && (o.door.side||'s')==='s'){ const [px,pz]=toWorld(F,o.door.c||0,hd+3); shadowRects.push({x:px,z:pz,w:1.6,d:4,h:0.1,yaw:o.yaw}); }
  // inside
  if (o.enter){
    if (o.split){ const sz=o.split.z, dc=o.split.door||0; lpWall(F,'x',sz,-hw+T/2,hw-T/2,h,[{c:dc,w:1.0,y0:0,y1:2.1,door:false}],M.interior,0.12); }
    for (const f of o.furn||[]) lpFurniture(F, f[0], f[1], f[2], f[3]||0);
  }
  if (o.door){ const dside=o.door.side||'s', n= dside==='s'?[0,1]:dside==='n'?[0,-1]:dside==='e'?[1,0]:[-1,0], dx=n[0]?n[0]*(dside==='e'?hw:hw):(o.door.c||0), dz=n[1]?n[1]*hd:(o.door.c||0);
    for (let t=-1.8;t<=1.8;t+=0.2) NAV_PORTALS.push(toWorld(F, dx+n[0]*t, dz+n[1]*t)); }
  // footprint (+ porch) for overlap checks, zone names and the minimap
  const c=Math.abs(Math.cos(o.yaw)), sn=Math.abs(Math.sin(o.yaw)), ex=hw*c+(hd+(o.porch?2.1:0.3))*sn, ez=hw*sn+(hd+(o.porch?2.1:0.3))*c;
  o.x0=o.x-ex; o.x1=o.x+ex; o.z0=o.z-ez; o.z1=o.z+ez; o.cols=[before, colliders.length]; LP_BUILDINGS.push(o);
}

// the new low-poly buildings, in the bands between the ring road and the (pulled-in) perimeter
const LP_LIST = [
  {id:'N1', name:'Corner store', x:-6, z:-58.4, yaw:0, w:10, d:7, h:3.3, mat:M.brickB, roof:'flat', enter:true, ladder:{side:'e',c:-1.6},
    door:{c:-2.2,w:1.4}, wins:[{side:'s',c:1.6,w:3.0,y0:0.7,y1:2.4,glass:'thick'},{side:'e',c:1.4,w:1.0},{side:'w',c:-1,w:1.2}],
    split:{z:-1.4,door:-3}, furn:[['counter',1.6,0.6],['shelf',-3.4,0.9,PI/2],['shelf',3.9,-0.3,PI/2],['crate',-3.6,-2.6],['crate',-2.7,-2.7],['table',2.2,-2.4]]},
  {id:'N2', name:'Blue house', x:12, z:-59.2, yaw:0, w:8, d:6.4, mat:M.sidBlue, roof:'gable', rh:1.5, enter:true, porch:{w:3.2},
    door:{c:-1.2}, wins:[{side:'s',c:2.2},{side:'n',c:-1.8},{side:'e',c:0,glass:'thin'},{side:'w',c:0.6}],
    split:{z:-0.6,door:2.4}, furn:[['couch',1.6,1.6,PI],['tv',1.6,0.1],['bed',-2.2,-1.9],['shelf',2.9,-2.4]]},
  {id:'N3', name:'Rundown shack', x:28.5, z:-58.6, yaw:0.04, w:6, d:5, h:2.6, mat:M.sidGrey, roof:'shed', rh:0.7, enter:true,
    door:{c:1.2,w:1.1}, wins:[{side:'s',c:-1.4,w:1.0,broken:true},{side:'w',c:0,w:0.9,boards:true}], furn:[['bed',-1.3,-1.2],['crate',1.9,-1.6]]},
  {id:'W3', name:'Abandoned shack', x:-58.6, z:-38, yaw:PI/2, w:6.5, d:5, h:2.7, mat:M.sidGreen, roof:'gable', rh:1.1, enter:true,
    door:{c:0.8,w:1.1}, wins:[{side:'s',c:-1.8,boards:true},{side:'e',c:0,broken:true},{side:'n',c:1.2,glass:'thin'}], damaged:[[0.8,0.6,1.2]], furn:[['couch',-1.4,-1.2],['crate',2.3,-1.4]]},
  {id:'E1', name:'Brick house', x:58, z:-6, yaw:-PI/2, w:9, d:7, h:3.0, mat:M.brick, roof:'hip', rh:1.7, roofMat:M.shingle, enter:true,
    door:{c:1.5,w:1.2}, wins:[{side:'s',c:-2.3},{side:'n',c:-2},{side:'n',c:2},{side:'e',c:-1.6},{side:'w',c:1.6,glass:'thick'}],
    split:{z:-0.4,door:-2.6}, furn:[['table',-2.2,1.6],['fridge',-3.9,2.8],['counter',-2.6,2.95],['bed',2.3,-2.2],['shelf',3.9,-2.5,PI/2]]},
  {id:'E2', name:'Yellow house', x:58.2, z:14.5, yaw:-PI/2, w:9, d:6.4, mat:M.sidYellow, roof:'gable', rh:1.5, enter:true, porch:{w:3.4},
    door:{c:0}, wins:[{side:'s',c:-2.8},{side:'s',c:2.8},{side:'n',c:0,glass:'thin'},{side:'e',c:-1},{side:'w',c:1}],
    split:{z:-0.8,door:-3}, furn:[['couch',2.4,1.6,PI],['table',-2.4,1.4],['bed',2.4,-2],['crate',-3.6,-2.2]]},
  {id:'E3', name:'Burnt-out house', x:58.6, z:36, yaw:-PI/2, w:8, d:6, mat:M.sidWhite, roof:'gable', rh:1.4, roofMat:M.char, enter:true,
    door:{c:-1.6,w:1.2}, wins:[{side:'s',c:1.8,boards:true},{side:'n',c:-1.5,broken:true},{side:'n',c:1.8,boards:true},{side:'e',c:0,broken:true}],
    damaged:[[-1.5,0.8,1.6],[1.5,-0.7,1.2]], furn:[['crate',2.5,-1.8],['crate',3.1,-1.2],['couch',-1.6,-1.8]]},
  {id:'S3', name:'Green house', x:-30, z:-59.3, yaw:0, w:8.5, d:6.5, mat:M.sidGreen, roof:'gable', rh:1.5, enter:true, porch:{w:3.2},
    door:{c:1.6}, wins:[{side:'s',c:-1.8},{side:'n',c:-2},{side:'n',c:2},{side:'e',c:0},{side:'w',c:0,glass:'thin'}],
    split:{z:-0.5,door:2.8}, furn:[['couch',-1.8,1.6,PI],['tv',-1.8,0.2],['bed',2.3,-2],['table',-2.4,-1.8]]},
  {id:'S4', name:'Laundromat', x:2, z:50.5, yaw:PI, w:10, d:7, h:3.3, mat:M.sidGrey, roof:'flat', enter:true, ladder:{c:-3.4},
    door:{c:2.6,w:1.4}, wins:[{side:'s',c:-1.4,w:3.4,y0:0.8,y1:2.4,glass:'thick'},{side:'e',c:0},{side:'w',c:0}],
    furn:[['counter',-1.6,-2.8],['counter',2.2,-2.8],['shelf',-4.4,0,PI/2],['table',0,0.4]]},
  {id:'S5', name:'Tin shack', x:46, z:54.5, yaw:PI+0.05, w:5.5, d:4.5, h:2.5, mat:M.tin, roof:'shed', rh:0.6, roofMat:M.rust, enter:true,
    door:{c:-1,w:1.0}, wins:[{side:'e',c:0,w:0.9,boards:true}], furn:[['crate',1.4,-1.1],['bed',-1,-1.2]]},
];
// doorways narrower than the nav grid's clearance are carved into the grid explicitly so bots can always walk through
const NAV_PORTALS = [];
function outerBuilding(o){
  const L=OUTER_LAYOUT[o.model], F=frame(o.x,o.z,o.yaw);
  if (L.door){ const d=L.door; for (let t=-1.6;t<=1.6;t+=0.2) NAV_PORTALS.push(toWorld(F, d.x+d.nx*t, d.z+d.nz*t)); }
  for (const w of L.walls) outerWallCols(F, w[0], w[1], w[2], w[3], w[4], w[5], w[6]||0);
  const R=L.roof;
  if (R.strips) for (const [a,b,top] of R.strips) part(F,null,b-a,0.25,R.to-R.from,(a+b)/2,top-0.125,(R.from+R.to)/2,{col:true});
  else for (let z=R.from; z<R.to-0.01; z+=R.band){ const zc=z+R.band/2, top=R.ridge-R.slope*Math.abs(zc); part(F,null,R.w,0.25,R.band,R.cx,top-0.125,zc,{col:true}); }   // stepped pitched roof
  const lad=L.ladder; let h=lad.h;
  if (h===undefined){ const z=lad.z, zc=R.from+R.band*(Math.floor((z-R.from)/R.band)+0.5); h=+(R.ridge-R.slope*Math.abs(zc)).toFixed(3); }
  outerLadder(F, lad.x, lad.z, lad.nx, lad.nz, h, o.name);
  for (const p of L.props) outerProp(F, p[0], p[1], p[2], p[3]);
  if (o.painting && L.easel) outerEasel(F, L.easel[0], L.easel[1], L.easel[2]);
}
// the model meshes, added once the assets are decoded (the colliders above already exist, so the nav grid is right)
const OuterModels = {
  extra:[],
  load(scene){
    for (const e of this.extra) scene.add(e);
    const dec=name=>new Promise(res=>{ const b64=(window.GLB||{})[name]; if (!b64){ console.warn('building model missing: '+name); return res(null); }
      const bin=atob(b64), buf=new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
      new THREE.GLTFLoader().parse(buf.buffer,'',g=>res(g.scene),()=>res(null)); });
    return Promise.all([dec('warehouse'), dec('shelter')]).then(([wh,sh])=>{
      for (const src of [wh,sh]) if (src) src.traverse(m=>{ if (m.isMesh){ m.castShadow=true; m.receiveShadow=true; for (const mt of [].concat(m.material)){ mt.side=THREE.DoubleSide; mt.metalnessMap=null; mt.roughnessMap=null; mt.normalMap=null; mt.metalness=0.1; mt.roughness=0.9; mt.needsUpdate=true; } } });
      for (const o of OUTER_BUILDINGS){ const src=o.model==='warehouse'?wh:sh; if (!src) continue;
        const m=src.clone(true); m.position.set(o.x,0,o.z); m.rotation.y=o.yaw; m.scale.setScalar(HOUSE_SCALE); m.updateMatrixWorld(true); m.traverse(c=>{ c.matrixAutoUpdate=false; }); scene.add(m); }
    });
  },
};
function buildMap(scene){
  paintGroundBase();
  BUILDINGS.forEach(buildBuilding);
  buildRoofs();
  addLadder(-20,-34,'n',B.A);
  addLadder(18,-14,'e',B.B);
  addLadder(-30,-4,'w',B.C);
  buildStairsD();

  // --- Vehicles: enterable cars ---
  makeCar(scene,'sedan',-17.3,-6,PI/2,{enterable:true,paint:M.paints[0],name:'Maroon sedan'});
  makeCar(scene,'suv',-13,1.8,0.55,{enterable:true,paint:M.paints[1],name:'Navy SUV'});
  makeCar(scene,'sedan',-62,6.6,PI/2+0.08,{enterable:true,paint:M.paints[3],name:'Green sedan'});
  makeCar(scene,'pickup',31,8,0.25,{enterable:true,paint:M.paints[2],name:'Rusty pickup'});
  // --- Abandoned wrecks (solid cover) ---
  makeCar(scene,'sedan',8,34.6,0.2,{burned:true,noWheels:true});
  makeCar(scene,'suv',-22,-46.5,3.0,{flat:true,paint:M.paints[6],tag:3});
  makeCar(scene,'sedan',-70,6.8,PI/2,{noWheels:true,paint:M.paints[4],tag:0});
  makeCar(scene,'sedan',-56,27.3,-PI/2+0.06,{flat:true,paint:M.paints[5]});
  makeCar(scene,'pickup',-48.5,-24,1.45,{flat:true,paint:M.paints[7]});
  makeCar(scene,'sedan',33.5,22,-0.1,{noWheels:true,paint:M.paints[1],tag:8});
  makeCar(scene,'suv',13,-1,1.2,{flat:true,paint:M.paints[3],tag:12});
  makeCar(scene,'sedan',-30,31.7,0.04,{paint:M.paints[2],flat:true,tag:5});
  makeCar(scene,'sedan',41,-6,PI/2+0.1,{paint:M.paints[4],flat:true});
  makeCar(scene,'sedan',16,-44,0.06,{burned:true});
  makeCar(scene,'suv',-38,-46,-0.12,{paint:M.paints[5],noWheels:true,tag:1});
  // --- Buses ---
  makeBus('enterable',-6.5,-16,0.06,{tags:[2,6]});
  makeBus('enterable',-65,26.6,PI+0.05,{paint:M.busYellow,tags:[13,1]});
  makeBus('wreck',44.6,-24,PI/2+0.12,{burned:true,tags:[9,15]});

  // --- Courtyard: planter replaces the UFO, benches, lamps, half court, clutter ---
  planter(-7,-5);
  bench(-7,1.2,0); bench(-12.3,-5,PI/2); bench(-1.5,-6,-PI/2);
  hoop(2,9.6,0);
  barrel(-11,-11,true); barrel(-10.2,-11.6,false);
  tires(-2,-11,3); tires(-1.2,-10.3,1);
  couch(-15.5,-19,0.15); mattress(-18,-17,0.3);
  crates(3.5,-15,0.3);
  jersey(-3,6.5,0.1);
  for (const [x,z] of [[-19,-20],[4.5,-20],[-19,7],[4.5,-2]]) lamp(x,z,rnd()*PI*2, rnd()<0.3?0.12:0);
  tree(-18,-1,true); tree(4,-9,false);
  bagRow(-20.3,-20,-20.3,-12,4); bagRow(5.3,-20,5.3,-14,3); bagRow(-12,-21.3,-4,-21.3,3); bagRow(-19,9.3,-12,9.3,3);

  // --- Alleys & walls ---
  brickWall(-44,12,-30,12); brickWall(-44,19.5,-21,19.5);
  dumpster(-36,15.8,0); crates(-41,16,0.4); tires(-33,17.3,2);
  dumpster(-24,-19.5,0.1,true); dumpster(-27.5,-19.5,-0.05);
  climbFence(-30.2,-22,-30.2,-14.2);
  dumpster(20,-4,PI/2,false); dumpster(20,2.5,PI/2+0.1,true);
  climbFence(22,-8,22,-1); fence(26,10,26,4);
  climbFence(-2,-40,6,-40); climbFence(37.6,12,37.6,20); climbFence(-55,-2,-55,4);
  mattress(24,6,1.2); couch(24,-6,PI/2-0.2);
  dumpster(-3,23,0); dumpster(19,24,0.1,true);
  dumpster(-34,-38,0.3); crates(-36,-40,0); tires(8,-40,4);
  barrel(36,-3,true); barrel(28,26,false); tires(36,-1,2);

  // --- Streets ---
  busShelter(5,28.2,0);
  for (const [x,z] of [[-30,28],[0,28],[30,28],[38,-30],[38,10],[-42,-20],[-42,10],[-20,-40],[20,-40],[-58,-6],[-62,32]]) lamp(x,z,Math.atan2(-z,-x)+PI, rnd()<0.25?0.15:0);
  jersey(-13,83,0); jersey(-16.5,83,0.05); jersey(-9.5,83,-0.05);
  jersey(44,-83,0); jersey(40.5,-83,0); jersey(47.5,-83,0.06);
  jersey(-83,-23,1.1); jersey(-83,1,0.8);
  jersey(30,40,0.3); jersey(-40,40,-0.1);
  for (const [x,z] of [[-40,-42],[-34,-10],[-38,25],[28,30],[30,-42],[-46,40],[50,-50],[-60,-40],[60,20],[-20,40],[12,24]]) tree(x,z,rnd()<0.5);
  for (let i=0;i<24;i++){ const b=pick(BUILDINGS); bush(rr(b.x0-1.2,b.x1+1.2), rnd()<0.5? b.z0-1.2 : b.z1+1.2); }
  // garbage bags only against building walls (never in the middle of roads or lots)
  for (let i=0;i<16;i++){ const b=pick(BUILDINGS), side=Math.floor(rnd()*4);
    if (side===0) bagRow(b.x0+1,b.z0-0.5,b.x0+3,b.z0-0.5,2); else if (side===1) bagRow(b.x1-3,b.z1+0.5,b.x1-1,b.z1+0.5,2);
    else if (side===2) bagRow(b.x0-0.5,b.z0+1,b.x0-0.5,b.z0+3,2); else bagRow(b.x1+0.5,b.z1-3,b.x1+0.5,b.z1-1,2); }
  for (let i=0;i<20;i++){ part(F0,M.concreteDk,rr(0.2,0.6),rr(0.1,0.3),rr(0.2,0.6),RMv(rr(-80,80)),0.1,RMv(rr(-80,80)),{ry:rnd()*PI}); }

  // --- Enterable buildings outside the block ---
  for (const o of OUTER_BUILDINGS) outerBuilding(o);
  for (const o of LP_LIST) lpBuilding(o);

  // --- Perimeter fence + invisible bounds ---
  const E=RMv(84);                // perimeter pulled in with the rest of the outer ring
  fence(-84,-84,84,-84); fence(84,-84,84,84); fence(84,84,-84,84); fence(-84,84,-84,-84);   // fence() applies the compression itself
  addCol(0,-E-1,E+2,1,-5,50); addCol(0,E+1,E+2,1,-5,50); addCol(-E-1,0,1,E+2,-5,50); addCol(E+1,0,1,E+2,-5,50);

  // --- Ground meshes ---
  paintGroundShadows();
  const gtex = new THREE.CanvasTexture(groundCanvas);
  gtex.anisotropy = 4;
  const groundMat = lam('#ffffff',gtex);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE,GROUND_SIZE), groundMat);
  ground.rotation.x = -PI/2; ground.receiveShadow = true; scene.add(ground);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(900,900), lam('#57524a'));
  outer.rotation.x = -PI/2; outer.position.y = -0.03; scene.add(outer);
  for (const [x,z,r] of lightPools) part(F0,M.pool,0,0,0,x,0.035,z,{rx:-PI/2,geo:new THREE.PlaneGeometry(r*2,r*2)});
  const meshes = Batch.flush(scene);
  Glass.build(scene);
  return {meshes, ground, groundMat, gtex};
}


// surface under the player for footsteps: roofs = concrete, vehicle/bus tops = metal, ground from the painted ground map
function surfaceUnderPlayer(){
  const p=P.pos;
  if (P.ladder) return 'metal';
  if (p.y>0.35){ for (const b of BUILDINGS) if (p.x>b.x0-0.5&&p.x<b.x1+0.5&&p.z>b.z0-0.5&&p.z<b.z1+0.5) return 'concrete'; return p.y<0.6?'concrete':'metal'; }
  if (!surfaceUnderPlayer.g) surfaceUnderPlayer.g=groundCanvas.getContext('2d');
  const x=clamp(Math.floor((p.x+GROUND_SIZE/2)*SC),0,GPX-1), z=clamp(Math.floor((p.z+GROUND_SIZE/2)*SC),0,GPX-1);
  const d=surfaceUnderPlayer.g.getImageData(x,z,1,1).data, r=d[0],g=d[1],b=d[2], l=(r+g+b)/765;
  if (g>r*1.08 && g>b*1.08) return 'grass';
  return l>0.48 ? 'concrete' : 'asphalt';
}
