// Complete procedural weapon models. All models point toward -Z.
import * as THREE from '../../vendor/three.module.js';
import { getSkin, SKIN_STYLES } from '../data/weapons.js';

import { bevelBox } from './geometry.js';
const geoCache = new Map();
const matCache = new Map();
const skinTexCache = new Map();
let activeSkinTex = null;

function gBox(w,h,d){
  const k = `b${w}_${h}_${d}`;
  if(!geoCache.has(k)) geoCache.set(k, bevelBox(w,h,d));
  return geoCache.get(k);
}
function gCyl(rt,rb,h,seg=10){
  const k = `c${rt}_${rb}_${h}_${seg}`;
  if(!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt,rb,h,seg));
  return geoCache.get(k);
}
function gSphere(r,seg=10){
  const k = `s${r}_${seg}`;
  if(!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(r,seg,Math.max(6,Math.floor(seg/2))));
  return geoCache.get(k);
}
function gCone(r,h,seg=8){
  const k = `k${r}_${h}_${seg}`;
  if(!geoCache.has(k)) geoCache.set(k, new THREE.ConeGeometry(r,h,seg));
  return geoCache.get(k);
}
function gTorus(r,tube,seg=8,seg2=16){
  const k = `t${r}_${tube}_${seg}_${seg2}`;
  if(!geoCache.has(k)) geoCache.set(k, new THREE.TorusGeometry(r,tube,seg,seg2));
  return geoCache.get(k);
}

function hashSeed(str){
  let h = 2166136261 >>> 0;
  for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngFrom(seed){
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hand-painted procedural weapon finishes. Every style gets its own pattern,
// scratches, panel lines and metallic accents instead of a flat color fill.
function finishTexture(styleKey, seedStr){
  const cacheKey = styleKey + '|' + seedStr;
  if(skinTexCache.has(cacheKey)) return skinTexCache.get(cacheKey);
  const S = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = H;
  const g = c.getContext('2d');
  const rnd = rngFrom(hashSeed(cacheKey));
  const st = SKIN_STYLES[styleKey] || SKIN_STYLES.stock;
  const P = {
    a: st.a || st.body || '#15181c',
    b: st.b || st.body || '#252a30',
    c: st.c || st.accent || '#343b44',
    accent: st.accent || '#59636f',
    ink: st.ink || st.metal || '#0a0c0f'
  };
  const pattern = st.pattern || styleKey;
  const grd = g.createLinearGradient(0,0,S,H);
  grd.addColorStop(0,P.a); grd.addColorStop(0.45,P.b); grd.addColorStop(1,P.a);
  g.fillStyle = grd; g.fillRect(0,0,S,H);

  // micro grain / brushed metal
  for(let i=0;i<2600;i++){
    const v = 120 + Math.floor(rnd()*120);
    g.fillStyle = `rgba(${v},${v},${v},${0.015 + rnd()*0.035})`;
    g.fillRect(rnd()*S, rnd()*H, 1 + rnd()*8, 1);
  }

  if(pattern === 'carbon'){
    const cell = 12;
    for(let y=0;y<H;y+=cell){
      for(let x=0;x<S;x+=cell){
        const odd = ((x/cell)+(y/cell)) % 2;
        g.fillStyle = odd ? 'rgba(120,130,145,.16)' : 'rgba(0,0,0,.24)';
        g.fillRect(x,y,cell,cell);
        g.fillStyle = odd ? 'rgba(0,0,0,.20)' : 'rgba(150,165,180,.12)';
        g.fillRect(x,y,cell/2,cell/2);
      }
    }
  } else if(pattern === 'circuit'){
    g.strokeStyle = P.accent; g.lineWidth = 2; g.shadowColor = P.accent; g.shadowBlur = 10;
    for(let i=0;i<9;i++){
      let x = rnd()*S, y = rnd()*H;
      g.beginPath(); g.moveTo(x,y);
      for(let k=0;k<4;k++){
        if(rnd()<0.5) x += (rnd()-0.5)*70; else y += (rnd()-0.5)*40;
        g.lineTo(x,y);
      }
      g.stroke();
      g.fillStyle = P.accent; g.beginPath(); g.arc(x,y,2.2,0,6.283); g.fill();
    }
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(0,0,0,.28)';
    for(let i=0;i<8;i++) g.fillRect(rnd()*S, rnd()*H, 18+rnd()*50, 3);
  } else if(pattern === 'tiger'){
    g.fillStyle = P.accent;
    for(let i=0;i<20;i++){
      const x = rnd()*S, y = rnd()*H;
      g.save(); g.translate(x,y); g.rotate((rnd()-0.5)*1.4);
      g.beginPath(); g.moveTo(-4,0);
      for(let k=1;k<=7;k++){ const w = (3+rnd()*7); g.lineTo(k*10-30, (k%2?1:-1)*w); }
      g.lineTo(70,0); g.lineTo(-4,0); g.fill(); g.restore();
    }
  } else if(pattern === 'camo'){
    for(let i=0;i<42;i++){
      g.fillStyle = i%3===0 ? 'rgba(255,255,255,.09)' : (i%3===1 ? 'rgba(0,0,0,.30)' : P.c);
      g.globalAlpha = i%3===2 ? 0.42 : 1;
      g.beginPath();
      g.ellipse(rnd()*S, rnd()*H, 8+rnd()*30, 5+rnd()*17, rnd()*3, 0, 6.283);
      g.fill();
    }
    g.globalAlpha = 1;
  } else if(pattern === 'marble'){
    for(let i=0;i<28;i++){
      g.fillStyle = i%3===0 ? 'rgba(255,255,255,.10)' : (i%3===1 ? 'rgba(0,0,0,.20)' : 'rgba(210,225,240,.13)');
      g.beginPath();
      g.ellipse(rnd()*S, rnd()*H, 10+rnd()*34, 5+rnd()*18, rnd()*3, 0, 6.283);
      g.fill();
    }
    g.strokeStyle = 'rgba(235,245,255,.55)'; g.lineWidth = 1.2;
    for(let i=0;i<16;i++){
      let x=rnd()*S,y=rnd()*H; g.beginPath(); g.moveTo(x,y);
      for(let k=0;k<4;k++){ x+=(rnd()-0.5)*28; y+=(rnd()-0.5)*18; g.lineTo(x,y); }
      g.stroke();
    }
  } else if(pattern === 'static'){
    for(let i=0;i<420;i++){
      const v = 80 + Math.floor(rnd()*150);
      g.fillStyle = `rgba(${v},${v},${v},${0.10+rnd()*0.30})`;
      g.fillRect(rnd()*S, rnd()*H, 1+rnd()*5, 1+rnd()*3);
    }
    g.fillStyle = 'rgba(255,255,255,.06)';
    for(let i=0;i<12;i++) g.fillRect(0, rnd()*H, S, 1);
  } else if(pattern === 'blood'){
    g.fillStyle = 'rgba(130,20,16,.55)';
    for(let i=0;i<22;i++){
      const x=rnd()*S,y=rnd()*H,r=3+rnd()*15;
      g.beginPath(); g.arc(x,y,r,0,6.283); g.fill();
      for(let k=0;k<3;k++){ g.beginPath(); g.arc(x+(rnd()-0.5)*30,y+(rnd()-0.5)*24,1+rnd()*3,0,6.283); g.fill(); }
    }
  } else if(pattern === 'gold'){
    g.fillStyle = 'rgba(255,240,180,.18)';
    for(let i=0;i<40;i++) g.fillRect(0, rnd()*H, S, 1);
    g.fillStyle = 'rgba(60,38,4,.24)';
    for(let i=0;i<12;i++) g.fillRect(rnd()*S, rnd()*H, 40+rnd()*80, 2);
  } else if(pattern === 'stripes' || pattern === 'royal' || pattern === 'web'){
    g.fillStyle = 'rgba(8,4,8,.32)';
    for(let i=0;i<9;i++){
      g.save(); g.translate(rnd()*S, rnd()*H); g.rotate((rnd()-0.5)*0.9);
      g.fillRect(-40,-6,80,12); g.restore();
    }
    g.strokeStyle = P.accent; g.globalAlpha = 0.55; g.lineWidth = 1.4;
    for(let i=0;i<5;i++){ const y=rnd()*H; g.beginPath(); g.moveTo(0,y); g.lineTo(S,y+(rnd()-0.5)*18); g.stroke(); }
    if(pattern === 'web'){
      g.lineWidth = 1.1;
      for(let i=0;i<3;i++){
        const cx = rnd()*S, cy = rnd()*H;
        for(let k=0;k<10;k++){ const a=k/10*6.283; g.beginPath(); g.moveTo(cx,cy); g.lineTo(cx+Math.cos(a)*(60+rnd()*40), cy+Math.sin(a)*(30+rnd()*20)); g.stroke(); }
        for(let r=12;r<60;r+=14) g.beginPath(), g.arc(cx,cy,r,0,6.283), g.stroke();
      }
    }
    g.globalAlpha = 1;
  } else if(pattern === 'aqua' || pattern === 'jade'){
    g.strokeStyle = pattern === 'jade' ? 'rgba(109,255,192,.48)' : 'rgba(57,230,216,.42)';
    g.lineWidth = 2;
    for(let i=0;i<11;i++){
      const y = rnd()*H; g.beginPath();
      for(let x=0;x<=S;x+=10) g.lineTo(x, y + Math.sin(x*0.05+i)*6);
      g.stroke();
    }
  } else if(pattern === 'ember' || pattern === 'magma'){
    g.strokeStyle = pattern === 'magma' ? 'rgba(255,90,40,.85)' : 'rgba(255,140,60,.6)';
    g.lineWidth = 2;
    for(let i=0;i<16;i++){
      let x=rnd()*S,y=rnd()*H; g.beginPath(); g.moveTo(x,y);
      for(let k=0;k<4;k++){ x+=(rnd()-0.5)*22; y+=(rnd()-0.2)*16; g.lineTo(x,y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(255,190,90,.7)';
    for(let i=0;i<40;i++) g.fillRect(rnd()*S, rnd()*H, 1+rnd()*2, 1+rnd()*2);
  } else if(pattern === 'venom'){
    g.fillStyle = 'rgba(154,255,61,.45)';
    for(let i=0;i<18;i++){
      const x=rnd()*S,y=rnd()*H;
      g.beginPath(); g.arc(x,y,2+rnd()*5,0,6.283); g.fill();
      g.fillRect(x-1, y, 2, 8+rnd()*16);
    }
  } else if(pattern === 'sakura'){
    g.fillStyle = 'rgba(255,184,216,.55)';
    for(let i=0;i<30;i++){
      const x=rnd()*S,y=rnd()*H;
      g.save(); g.translate(x,y); g.rotate(rnd()*6.283);
      for(let k=0;k<5;k++){ g.beginPath(); g.ellipse(Math.cos(k*1.25)*5, Math.sin(k*1.25)*5, 5, 2.5, k*1.25, 0, 6.283); g.fill(); }
      g.restore();
    }
  } else if(pattern === 'hex'){
    g.strokeStyle = 'rgba(92,208,255,.45)'; g.lineWidth = 1.4;
    const r = 13;
    for(let y=-r;y<H+r;y+=r*1.5){
      for(let x=-r;x<S+r;x+=r*1.74){
        const ox = (Math.round(y/(r*1.5))%2) ? r*0.87 : 0;
        g.beginPath();
        for(let k=0;k<6;k++){ const a=k/6*6.283; g.lineTo(x+ox+Math.cos(a)*r, y+Math.sin(a)*r); }
        g.closePath(); g.stroke();
      }
    }
  } else if(pattern === 'tribal'){
    g.strokeStyle = P.accent; g.lineWidth = 3;
    for(let i=0;i<18;i++){
      const x=rnd()*S,y=rnd()*H;
      g.beginPath(); g.moveTo(x,y);
      for(let k=0;k<5;k++) g.lineTo(x+(rnd()-0.5)*34, y+(rnd()-0.5)*24);
      g.stroke();
    }
  } else if(pattern === 'scales'){
    g.strokeStyle = 'rgba(84,224,232,.45)'; g.lineWidth = 1.3;
    for(let y=0;y<H+14;y+=9){
      for(let x=0;x<S+14;x+=14){
        const ox = (Math.round(y/9)%2) ? 7 : 0;
        g.beginPath(); g.arc(x+ox, y, 7, 0, Math.PI); g.stroke();
      }
    }
  } else if(pattern === 'galaxy' || pattern === 'night'){
    g.fillStyle = 'rgba(255,255,255,.85)';
    for(let i=0;i<120;i++){
      const r = rnd()*1.4;
      g.globalAlpha = 0.25 + rnd()*0.75;
      g.beginPath(); g.arc(rnd()*S, rnd()*H, r, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = pattern === 'night' ? 'rgba(255,211,106,.35)' : 'rgba(192,138,255,.30)';
    for(let i=0;i<10;i++) g.fillRect(rnd()*S, rnd()*H, 20+rnd()*60, 2);
  } else if(pattern === 'aurora'){
    for(let i=0;i<8;i++){
      g.strokeStyle = `rgba(${80+i*12},${220-i*8},${190+i*4},.28)`;
      g.lineWidth = 6 + rnd()*10;
      g.beginPath();
      for(let x=0;x<=S;x+=12) g.lineTo(x, H*0.5 + Math.sin(x*0.035+i)*18 + (rnd()-0.5)*5);
      g.stroke();
    }
  } else if(pattern === 'copper'){
    for(let i=0;i<60;i++){
      g.fillStyle = i%2 ? 'rgba(255,190,140,.10)' : 'rgba(40,20,8,.16)';
      g.fillRect(0, rnd()*H, S, 1);
    }
  }

  // panel lines + edge wear shared by all finishes
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 3;
  g.strokeRect(0.5,0.5,S-1,H-1);
  g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 1.5;
  for(let i=0;i<3;i++){ const y = 24+i*34; g.beginPath(); g.moveTo(0,y); g.lineTo(S,y); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.10)';
  for(let i=0;i<16;i++) g.fillRect(rnd()*S, rnd()*H, 8+rnd()*28, 1);
  g.fillStyle = P.accent; g.globalAlpha = 0.9; g.fillRect(0, 8, S, 2); g.globalAlpha = 1;
  // subtle serial/brand block
  g.fillStyle = 'rgba(255,255,255,.20)'; g.font = 'bold 10px monospace'; g.fillText('STANDOFF 3', 12, H-10);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1,1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  skinTexCache.set(cacheKey, tex);
  return tex;
}

let gunBump = null;
function gunBumpTexture(){
  if(gunBump) return gunBump;
  if(typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0,0,128,128);
  for(let i=0;i<2600;i++){
    const v = 96 + Math.floor(Math.random()*64);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random()*128, Math.random()*128, 1 + Math.random()*2, 1);
  }
  for(let i=0;i<24;i++){
    const v = 130 + Math.floor(Math.random()*70);
    g.strokeStyle = `rgb(${v},${v},${v})`;
    g.lineWidth = 0.6 + Math.random();
    g.beginPath();
    const y = Math.random()*128;
    g.moveTo(0,y);
    g.lineTo(128, y + (Math.random()-0.5)*8);
    g.stroke();
  }
  gunBump = new THREE.CanvasTexture(c);
  gunBump.wrapS = gunBump.wrapT = THREE.RepeatWrapping;
  gunBump.repeat.set(2.5, 2.5);
  return gunBump;
}

function mat(color, opts={}){
  let texKey = opts.tex || null;
  if(!texKey && activeSkinTex){
    const keyColor = String(color).toLowerCase();
    texKey = activeSkinTex.get(keyColor) || null;
  }
  const key = `${texKey ? 'T:'+texKey : color}|${opts.rough??0.56}|${opts.metal??0.42}|${opts.emissive||''}|${opts.opacity??1}`;
  if(matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: texKey ? new THREE.Color('#ffffff') : new THREE.Color(color),
    roughness: opts.rough !== undefined ? opts.rough : 0.56,
    metalness: opts.metal !== undefined ? opts.metal : 0.42,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : 0x000000,
    emissiveIntensity: opts.emissive ? 0.55 : 0,
    transparent: (opts.opacity ?? 1) < 1,
    opacity: opts.opacity ?? 1,
    map: texKey ? (()=>{ const [st, sd] = String(texKey).split('|'); return finishTexture(st, sd || 'sf'); })() : null,
    bumpMap: opts.bump === false ? null : gunBumpTexture(),
    bumpScale: opts.bumpScale ?? 0.004
  });
  matCache.set(key, m);
  return m;
}

function add(parent, geo, color, opts={}, x=0,y=0,z=0, rx=0,ry=0,rz=0){
  const m = new THREE.Mesh(geo, mat(color,opts));
  m.position.set(x,y,z);
  m.rotation.set(rx,ry,rz);
  m.castShadow = false; m.receiveShadow = false;
  parent.add(m);
  return m;
}
function bx(parent,w,h,d,color,opts,x,y,z,rx=0,ry=0,rz=0){ return add(parent,gBox(w,h,d),color,opts,x,y,z,rx,ry,rz); }
function cylY(parent,r,h,color,opts,x,y,z,rx=0,ry=0,rz=0,seg=10){ return add(parent,gCyl(r,r,h,seg),color,opts,x,y,z,rx,ry,rz); }
function cylZ(parent,r,len,color,opts,x,y,z){ return add(parent,gCyl(r,r,len,12),color,opts,x,y,z,Math.PI/2,0,0); }
function sph(parent,r,color,opts,x,y,z,seg=10){ return add(parent,gSphere(r,seg),color,opts,x,y,z); }

function rail(parent,color,y,z,len,count,width=0.034){
  const n = Math.max(2,count);
  for(let i=0;i<n;i++) bx(parent,width,0.010,0.020,color,{metal:0.86,rough:0.28},0,y,z+(i/(n-1)-0.5)*len);
}
function ironSights(parent,color,y,zRear,zFront){
  bx(parent,0.050,0.018,0.026,color,{metal:0.84,rough:0.3},0,y,zRear);
  bx(parent,0.012,0.030,0.020,color,{metal:0.82,rough:0.32},0.020,y+0.014,zRear);
  bx(parent,0.012,0.030,0.020,color,{metal:0.82,rough:0.32},-0.020,y+0.014,zRear);
  bx(parent,0.013,0.042,0.018,color,{metal:0.86,rough:0.28},0,y+0.021,zFront);
}
function optic(parent,color,y,z,len=0.16,radius=0.033){
  cylZ(parent,radius,len,'#0b0d10',{metal:0.86,rough:0.2},0,y,z);
  cylZ(parent,radius*1.18,0.035,color,{metal:0.78,rough:0.28},0,y,z-len*0.5);
  cylZ(parent,radius*1.12,0.032,color,{metal:0.78,rough:0.28},0,y,z+len*0.5);
  add(parent,new THREE.CircleGeometry(radius*0.92,14),'#26506a',{metal:0.9,rough:0.08,emissive:'#1d455f'},0,y,z-len*0.5-0.019,0,Math.PI,0);
  bx(parent,0.028,0.045,0.045,color,{metal:0.76,rough:0.3},0,y-0.042,z);
}
function triggerGroup(parent,metal,body,y,z){
  bx(parent,0.022,0.060,0.020,metal,{metal:0.82,rough:0.28},0,y,z,0.28,0,0);
  bx(parent,0.056,0.012,0.105,metal,{metal:0.7,rough:0.38},0,y-0.045,z+0.018);
  bx(parent,0.014,0.052,0.014,metal,{metal:0.72,rough:0.36},0,y-0.018,z+0.070);
  return { triggerGuard:body, trigger:metal };
}
function magazine(parent,parts,color,accent,x,y,z,w,h,len,rx=0){
  const mag = bx(parent,w,h,len,color,{metal:0.35,rough:0.62},x,y,z,rx,0,0);
  bx(parent,w+0.012,0.018,len+0.012,accent,{metal:0.5,rough:0.45},x,y-h*0.48,z+Math.sin(rx)*h*0.2,rx,0,0);
  for(let i=0;i<3;i++) bx(parent,w+0.008,0.007,len*0.55,'#17191d',{metal:0.4,rough:0.55},x,y-h*0.18+i*h*0.18,z-(len*0.02),rx,0,0);
  parts.mag = mag;
  return mag;
}
function grip(parent,parts,color,dark,x,y,z,rx=0.32){
  const g = bx(parent,0.060,0.155,0.092,dark,{metal:0.16,rough:0.9},x,y,z,rx,0,0);
  for(let i=0;i<3;i++) bx(parent,0.062,0.008,0.070,color,{metal:0.2,rough:0.82},x,y+i*0.026-0.02,z+i*0.012,rx,0,0);
  parts.grip = g;
  return g;
}
function stock(parent,parts,color,dark,x,y,z,w=0.070,h=0.12,d=0.34){
  bx(parent,0.045,0.052,d*0.30,color,{metal:0.55,rough:0.45},x,y,z-d*0.28);
  const stockMesh = bx(parent,w,h,d,color,{metal:0.28,rough:0.72},x,y,z);
  bx(parent,w+0.010,h+0.012,0.030,dark,{metal:0.2,rough:0.8},x,y,z+d*0.5);
  parts.stock = stockMesh;
  return stockMesh;
}
function foregrip(parent,parts,color,dark,x,y,z){
  bx(parent,0.042,0.030,0.15,color,{metal:0.52,rough:0.5},x,y,z);
  const fg = bx(parent,0.038,0.11,0.047,dark,{metal:0.2,rough:0.88},x,y-0.065,z,0.12,0,0);
  parts.foregrip = fg;
}

function palette(weaponId, skin){
  const style = skin.styleKey || 'stock';
  const stock = style === 'stock';
  const body = skin.body || (weaponId.startsWith('ak') || weaponId === 'galil' ? '#5f3a1c' : '#2c3138');
  const metal = skin.metal || '#22262c';
  const accent = skin.accent || '#4a5058';
  return {
    body, metal, accent,
    wood: stock && (weaponId === 'ak47' || weaponId === 'galil' || weaponId === 'nova') ? '#6a4423' : body,
    dark:'#121418',
    polymer:'#1b2026',
    rubber:'#0d1013',
    em: skin.emissive || null,
    style
  };
}

function pistol(g, parts, id, C, hi){
  const five = id === 'five-seven';
  const cz = id === 'cz75';
  const tec = id === 'tec9';
  const rev = id === 'r8';
  const long = id === 'deagle' || five || rev;
  const compact = id === 'p250' || cz;
  const suppressed = id === 'usp';
  const len = rev ? 0.44 : (tec ? 0.42 : (id === 'deagle' ? 0.43 : (five ? 0.38 : (cz ? 0.31 : (compact ? 0.29 : (id === 'p2000' ? 0.33 : 0.34))))));
  const slideH = long ? 0.086 : 0.070;
  const z0 = -0.06;
  bx(g,0.080,0.056,len*0.92,C.body,{metal:0.34,rough:0.62},0,-0.020,z0-len*0.40);
  const slide = bx(g,long?0.104:0.090,slideH,len,C.metal,{metal:0.86,rough:0.24},0,0.034,z0-len*0.48);
  bx(g,long?0.108:0.094,0.011,len,C.accent,{metal:0.76,rough:0.3},0,0.034+slideH*0.5,z0-len*0.48);
  for(let i=0;i<(hi?5:2);i++) bx(g,0.092,0.010,0.010,C.dark,{metal:0.76,rough:0.34},0,0.065,z0-len*0.25-i*0.022);
  const barrel = cylZ(g,0.014,len*0.34,C.dark,{metal:0.96,rough:0.18},0,0.034,z0-len*0.98);
  parts.barrel = barrel;
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0,0.034,z0-len*1.15);
  g.add(muzzle);
  if(suppressed){
    const s = cylZ(g,0.027,0.19,'#20242a',{metal:0.82,rough:0.4},0,0.034,z0-len*1.02);
    for(let i=0;i<(hi?5:2);i++) cylZ(g,0.028,0.009,C.accent,{metal:0.7,rough:0.4},0,0.034,z0-len*0.95-i*0.025);
    muzzle.position.z = z0-len*1.32;
    parts.suppressor = s;
  }
  const gripMesh = bx(g,long?0.084:0.073,long?0.225:0.195,0.11,C.body,{metal:0.2,rough:0.86},0,long?-0.145:-0.13,0.030,0.21,0,0);
  const pmag = bx(g,long?0.054:0.047,0.085,0.038,C.metal,{metal:0.7,rough:0.34},0,long?-0.252:-0.224,0.056,0.21,0,0);
  bx(g,long?0.058:0.051,0.012,0.042,C.accent,{metal:0.62,rough:0.4},0,long?-0.292:-0.263,0.066,0.21,0,0);
  parts.mag = pmag;
  bx(g,long?0.088:0.077,0.020,0.115,C.metal,{metal:0.6,rough:0.4},0,long?-0.255:-0.225,0.055,0.21,0,0);
  for(let i=0;i<(hi?4:2);i++) bx(g,0.075,0.008,0.085,C.dark,{metal:0.16,rough:0.92},0,long?-0.08-i*0.030:-0.07-i*0.028,0.022,0.21,0,0);
  parts.grip = gripMesh;
  parts.receiver = slide;
  parts.slide = slide;
  parts.bolt = slide;
  slide.userData.travel = 0.050;
  triggerGroup(g,C.metal,C.body,-0.052,-0.050);
  ironSights(g,C.metal,long?0.091:0.077,0.015,-len*0.94);
  if(hi){
    rail(g,C.dark,0.085,-len*0.25,len*0.55,4);
    bx(g,0.012,0.022,0.020,C.metal,{metal:0.84,rough:0.3},0.046,0.018,-0.015);
    bx(g,0.012,0.022,0.020,C.metal,{metal:0.84,rough:0.3},-0.046,0.018,-0.015);
    bx(g,0.015,0.035,0.015,C.metal,{metal:0.78,rough:0.3},0.050,0.056,0.02,0,0,0.1);
  }
  if(rev){
    // swing-out cylinder, exposed hammer and ventilated barrel rib
    const cylMesh = cylZ(g,0.064,0.155,C.metal,{metal:0.84,rough:0.26},0,0.025,-len*0.34);
    for(let i=0;i<6;i++){
      const a = i/6*Math.PI*2;
      cylZ(g,0.014,0.158,C.dark,{metal:0.9,rough:0.24},Math.cos(a)*0.030,0.025+Math.sin(a)*0.030,-len*0.34);
    }
    parts.mag = cylMesh;
    bx(g,0.050,0.060,0.050,C.metal,{metal:0.8,rough:0.3},0,0.075,0.015,0.35,0,0);
    bx(g,0.030,0.080,0.024,C.metal,{metal:0.82,rough:0.34},0,0.066,0.075,0.35,0,0);
    bx(g,0.020,0.012,0.20,C.accent,{metal:0.7,rough:0.38},0,0.086,-len*0.62);
    for(let i=0;i<(hi?5:2);i++) bx(g,0.026,0.012,0.030,C.dark,{metal:0.7,rough:0.4},0,0.086,-len*0.28-i*0.042);
  } else if(tec){
    // barrel shroud with cooling slots and a long stick magazine
    bx(g,0.066,0.070,len*0.46,C.metal,{metal:0.8,rough:0.34},0,0.030,-len*0.98);
    for(let i=0;i<(hi?5:3);i++) bx(g,0.070,0.012,0.022,C.dark,{metal:0.6,rough:0.5},0,0.056,-len*0.82-i*0.044);
    bx(g,0.050,0.190,0.045,C.metal,{metal:0.72,rough:0.36},0,-0.225,0.060,0.18,0,0);
    bx(g,0.054,0.014,0.050,C.accent,{metal:0.62,rough:0.4},0,-0.312,0.078,0.18,0,0);
    bx(g,0.020,0.016,0.070,C.dark,{metal:0.72,rough:0.36},0.052,0.034,0.012,0,0,0.25);
  } else if(cz){
    // squared trigger guard, extended base plate and frame-mounted selector
    bx(g,0.060,0.014,0.128,C.metal,{metal:0.74,rough:0.32},0,-0.130,-0.06);
    bx(g,0.058,0.024,0.022,C.metal,{metal:0.78,rough:0.3},0,-0.130,-0.12);
    bx(g,0.026,0.016,0.070,C.dark,{metal:0.5,rough:0.5},0.048,-0.030,0.035,0,0,0.2);
    bx(g,0.012,0.020,0.032,C.accent,{metal:0.62,rough:0.4},0.052,0.030,0.045);
    bx(g,0.040,0.010,0.070,C.accent,{metal:0.66,rough:0.38},0,-0.300,0.066,0.21,0,0);
  } else if(five){
    // long polymer slide, front serrations and ambidextrous controls
    for(let i=0;i<(hi?6:3);i++){
      bx(g,0.086,0.008,0.010,C.dark,{metal:0.5,rough:0.5},0,0.066,-len*0.70+i*0.018);
      bx(g,0.086,0.008,0.010,C.dark,{metal:0.5,rough:0.5},0,0.066,-len*0.26+i*0.018);
    }
    bx(g,0.020,0.018,0.050,C.accent,{metal:0.55,rough:0.45},0.050,0.014,-0.02);
    bx(g,0.020,0.018,0.050,C.accent,{metal:0.55,rough:0.45},-0.050,0.014,-0.02);
    bx(g,0.070,0.012,0.080,C.dark,{metal:0.35,rough:0.7},0,-0.075,0.02,0.15,0,0);
  }
  if(C.em) bx(g,0.008,0.012,0.22,C.em,{emissive:C.em,metal:0.2},0.047,0.042,-len*0.45);
  return muzzle.position.z;
}

function smg(g, parts, id, C, hi){
  const mac = id === 'mac10';
  const ump = id === 'ump45';
  const mp7 = id === 'mp7';
  const bizon = id === 'bizon';
  const mp5 = id === 'mp5sd';
  const uzi = id === 'uzi';
  const p90 = id === 'p90';
  const vec = id === 'vector';
  const w = mac ? 0.105 : (ump ? 0.090 : (mp7 ? 0.084 : (bizon ? 0.086 : (mp5 ? 0.086 : (uzi ? 0.098 : (p90 ? 0.095 : (vec ? 0.086 : 0.082)))))));
  const len = mac ? 0.34 : (ump ? 0.40 : (mp7 ? 0.31 : (bizon ? 0.42 : (mp5 ? 0.38 : (uzi ? 0.38 : (p90 ? 0.46 : (vec ? 0.35 : 0.36)))))));
  const recv = bx(g,w,0.125,len,C.metal,{metal:0.6,rough:0.48},0,0.02,-0.02);
  bx(g,w*0.92,0.09,len*0.72,C.body,{metal:0.4,rough:0.64},0,-0.030,0.01);
  parts.receiver = recv;
  if(p90){
    // bullpup shell with the magazine lying flat on top of the receiver
    bx(g,0.075,0.055,len*0.90,C.body,{metal:0.32,rough:0.7},0,0.118,0.02);
    for(let i=0;i<(hi?6:3);i++) bx(g,0.078,0.010,0.020,C.dark,{metal:0.4,rough:0.55},0,0.148,0.14-i*0.060);
    const topMag = bx(g,0.096,0.038,0.30,C.polymer,{metal:0.24,rough:0.74},0,0.095,-0.10);
    parts.mag = topMag;
    bx(g,0.070,0.095,0.030,C.accent,{metal:0.6,rough:0.42},0,0.150,0.16);
    // thumbhole stock and integrated foregrip
    bx(g,0.030,0.11,0.30,C.body,{metal:0.3,rough:0.7},0.065,-0.105,0.22,-0.15,0,0);
    bx(g,0.030,0.11,0.30,C.body,{metal:0.3,rough:0.7},-0.065,-0.105,0.22,-0.15,0,0);
    bx(g,0.12,0.055,0.055,C.dark,{metal:0.24,rough:0.8},0,-0.145,-0.28,0.18,0,0);
    bx(g,0.050,0.060,0.24,C.polymer,{metal:0.3,rough:0.72},0,-0.190,-0.02,0.05,0,0);
    bx(g,0.080,0.030,0.040,C.dark,{metal:0.4,rough:0.6},0,-0.020,-len*1.10);
    // ambidextrous charging handles
    bx(g,0.036,0.016,0.045,C.metal,{metal:0.74,rough:0.34},0.060,-0.010,0.035);
    bx(g,0.036,0.016,0.045,C.metal,{metal:0.74,rough:0.34},-0.060,-0.010,0.035);
  } else if(vec){
    // angular Vector lower, short shroud and folding stock
    bx(g,w*0.94,0.090,len*0.62,C.polymer,{metal:0.26,rough:0.72},0,-0.086,-0.04,0,0,0.06);
    bx(g,w*0.86,0.055,len*0.40,C.dark,{metal:0.58,rough:0.46},0,0.078,-len*0.74);
    bx(g,0.020,0.030,0.20,C.metal,{metal:0.8,rough:0.32},0.055,0.020,0.24);
    bx(g,0.070,0.10,0.024,C.dark,{metal:0.22,rough:0.82},0.055,0.020,0.355);
    bx(g,0.030,0.055,0.018,C.accent,{metal:0.6,rough:0.4},0,-0.035,-len*1.42);
  } else if(uzi){
    // squared receiver, top cover and folding wire stock
    bx(g,w*0.98,0.035,len*0.92,C.dark,{metal:0.62,rough:0.42},0,0.090,-0.02);
    for(let i=0;i<(hi?5:2);i++) bx(g,0.018,0.012,0.030,C.accent,{metal:0.6,rough:0.4},0,0.112,-len*0.30-i*0.050);
    bx(g,0.016,0.016,0.30,C.metal,{metal:0.7,rough:0.38},0.070,-0.030,0.215);
    bx(g,0.016,0.016,0.30,C.metal,{metal:0.7,rough:0.38},-0.070,-0.030,0.215);
    bx(g,0.125,0.070,0.022,C.dark,{metal:0.3,rough:0.74},0,-0.030,0.355);
  } else if(mac){
    bx(g,0.055,0.032,0.34,C.dark,{metal:0.5,rough:0.55},0,0.10,-0.06);
    for(let i=0;i<(hi?4:2);i++) cylY(g,0.040,0.012,C.metal,{metal:0.8,rough:0.3},0,0.10,-0.18+i*0.055);
  } else {
    bx(g,w*0.78,0.016,len*1.25,C.dark,{metal:0.55,rough:0.5},0,0.095,-0.07);
    rail(g,C.dark,0.106,-0.15,len*0.55,hi?7:3);
  }
  const hand = bx(g,w*0.86,0.080,len*0.72,C.body,{metal:0.34,rough:0.64},0,0.012,-len*1.06);
  for(let i=0;i<(hi?4:2);i++){
    bx(g,w*0.92,0.016,0.025,C.dark,{metal:0.5,rough:0.5},0,0.043,-len*0.80-i*0.050);
    bx(g,w*0.92,0.012,0.022,C.dark,{metal:0.5,rough:0.5},0,-0.018,-len*0.80-i*0.050);
  }
  parts.handguard = hand;
  cylZ(g,0.015,len*0.66,C.dark,{metal:0.96,rough:0.2},0,0.020,-len*1.22);
  cylZ(g,0.024,len*0.11,C.metal,{metal:0.86,rough:0.28},0,0.020,-len*1.55);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0,0.020,-len*1.62); g.add(muzzle);
  if(bizon){
    // PP-Bizon's helical drum sits under the barrel instead of a box mag.
    const drum = cylZ(g,0.052,0.255,C.polymer,{metal:0.24,rough:0.72},0,-0.120,-len*0.82);
    for(let i=0;i<(hi?5:2);i++) cylZ(g,0.054,0.010,C.accent,{metal:0.55,rough:0.45},0,-0.120,-len*0.72-i*0.040);
    cylZ(g,0.046,0.030,C.metal,{metal:0.7,rough:0.34},0,-0.120,-len*1.06);
    parts.mag = drum;
    bx(g,0.066,0.028,0.20,C.dark,{metal:0.4,rough:0.6},0,-0.055,-len*0.78);
  } else {
    magazine(g,parts,mac?C.polymer:C.metal,C.accent,0,mac?-0.21:(mp7?-0.205:-0.19),-0.035,w*0.62,ump?0.28:(mp7?0.23:0.25),0.082,-0.04);
  }
  grip(g,parts,C.body,C.dark,0,-0.135,0.145,0.36);
  triggerGroup(g,C.metal,C.body,-0.068,-0.040);
  if(mac){
    bx(g,0.020,0.018,0.28,C.metal,{metal:0.72,rough:0.38},0.05,-0.015,0.20);
    bx(g,0.020,0.018,0.28,C.metal,{metal:0.72,rough:0.38},-0.05,-0.015,0.20);
    bx(g,0.115,0.09,0.025,C.dark,{metal:0.3,rough:0.75},0,-0.005,0.345);
  } else if(ump){
    stock(g,parts,C.body,C.dark,0,-0.005,0.32,0.070,0.125,0.30);
    foregrip(g,parts,C.body,C.dark,0,-0.03,-0.26);
  } else if(mp7){
    // telescoping PDW stock, folding foregrip and tall top rail
    bx(g,0.032,0.038,0.30,C.metal,{metal:0.66,rough:0.38},0.042,-0.005,0.24);
    bx(g,0.032,0.038,0.30,C.metal,{metal:0.66,rough:0.38},-0.042,-0.005,0.24);
    bx(g,0.095,0.075,0.022,C.dark,{metal:0.28,rough:0.8},0,-0.005,0.405);
    bx(g,0.042,0.026,0.15,C.body,{metal:0.36,rough:0.64},0,-0.085,-len*0.95);
    bx(g,0.026,0.080,0.040,C.dark,{metal:0.3,rough:0.7},0,-0.125,-len*0.82,0.18,0,0);
    rail(g,C.dark,0.092,-0.18,len*0.75,hi?10:4);
  } else if(mp5){
    // integral suppressor shroud
    const can = cylZ(g,0.034,0.22,C.dark,{metal:0.84,rough:0.36},0,0.020,-len*1.56);
    for(let i=0;i<(hi?4:2);i++) cylZ(g,0.036,0.012,C.accent,{metal:0.62,rough:0.44},0,0.020,-len*1.46-i*0.035);
    muzzle.position.z = -len*1.86;
    parts.suppressor = can;
    stock(g,parts,C.body,C.dark,0,-0.005,0.33,0.068,0.12,0.28);
    foregrip(g,parts,C.body,C.dark,0,-0.03,-0.25);
  } else if(!p90 && !vec && !uzi){
    stock(g,parts,C.body,C.dark,0,-0.005,0.32,0.064,0.11,0.26);
    bx(g,0.040,0.050,0.22,C.metal,{metal:0.7,rough:0.4},0,-0.005,0.27);
    bx(g,0.062,0.10,0.025,C.dark,{metal:0.25,rough:0.82},0,-0.005,0.39);
  }
  if(!p90) ironSights(g,C.metal,0.072,0.11,-len*1.48);
  if(hi && !mac && !p90 && !uzi) optic(g,C.metal,0.115,-0.12,0.13,0.027);
  if(bizon){
    bx(g,0.024,0.050,0.030,C.metal,{metal:0.7,rough:0.36},0.046,0.075,0.04);
    bx(g,0.024,0.050,0.030,C.metal,{metal:0.7,rough:0.36},-0.046,0.075,0.04);
  }
  if(C.em) bx(g,0.010,0.010,0.26,C.em,{emissive:C.em,metal:0.2},w*0.48,0.04,-len*0.6);
  return muzzle.position.z;
}

function rifle(g, parts, id, C, hi){
  if(id === 'famas' || id === 'aug') return bullpup(g,parts,id,C,hi);
  const g36 = id === 'g36';
  const val = id === 'val';
  const ak = id === 'ak47' || id === 'galil' || id === 'sg553' || val;
  const w = 0.090;
  const len = g36 ? 0.52 : (ak ? 0.56 : 0.50);
  const recv = bx(g,w,ak?0.15:0.115,len,C.metal,{metal:0.62,rough:0.46},0,0.015,-0.02);
  bx(g,w*0.92,0.026,len*0.82,C.body,{metal:0.52,rough:0.5},0,0.098,0.00);
  if(hi) for(let i=0;i<4;i++) bx(g,w*0.94,0.007,0.020,C.accent,{metal:0.58,rough:0.45},0,0.108,0.15-i*0.07);
  parts.receiver = recv;
  const handMat = ak ? (id==='galil'?C.polymer:C.wood) : C.body;
  const hand = bx(g,0.082,ak?0.090:0.080,len*0.48,handMat,{metal:0.12,rough:ak?0.82:0.62},0,0.005,-len*1.02);
  if(hi) for(let i=0;i<4;i++) bx(g,0.086,0.011,0.024,C.dark,{metal:0.4,rough:0.62},0,ak?-0.025:0.030,-len*0.82-i*0.060);
  parts.handguard = hand;
  cylZ(g,0.016,len*0.42,C.metal,{metal:0.84,rough:0.3},0,0.054,-len*0.98);
  cylZ(g,0.018,len*0.52,C.dark,{metal:0.96,rough:0.22},0,0.026,-len*1.52);
  bx(g,0.044,0.050,0.046,C.metal,{metal:0.82,rough:0.32},0,0.028,-len*1.22);
  bx(g,0.036,0.070,0.045,C.metal,{metal:0.82,rough:0.32},0,0.052,-len*1.62);
  bx(g,0.011,0.050,0.013,C.metal,{metal:0.86,rough:0.26},0,0.102,-len*1.62);
  cylZ(g,0.024,len*0.10,C.metal,{metal:0.86,rough:0.28},0,0.026,-len*1.82);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0,0.026,-len*1.90); g.add(muzzle);
  if(id === 'm4a1'){ parts.suppressor = cylZ(g,0.028,0.17,'#20242a',{metal:0.8,rough:0.42},0,0.026,-len*1.86); muzzle.position.z -= 0.17; }
  if(val){
    const can = cylZ(g,0.034,0.30,'#1c2026',{metal:0.84,rough:0.38},0,0.026,-len*1.88);
    for(let i=0;i<(hi?5:2);i++) cylZ(g,0.036,0.012,C.accent,{metal:0.62,rough:0.44},0,0.026,-len*1.74-i*0.046);
    muzzle.position.z -= 0.30; parts.suppressor = can;
  }
  if(g36){
    // integrated carry handle with a low-profile optic and skeletal stock
    bx(g,0.058,0.055,0.34,C.dark,{metal:0.55,rough:0.48},0,0.150,-0.11);
    bx(g,0.030,0.028,0.26,C.metal,{metal:0.76,rough:0.34},0,0.182,-0.11);
    bx(g,0.020,0.035,0.022,C.metal,{metal:0.8,rough:0.32},0,0.205,0.00);
    bx(g,0.020,0.035,0.022,C.metal,{metal:0.8,rough:0.32},0,0.205,-0.22);
    bx(g,0.055,0.020,0.24,C.metal,{metal:0.7,rough:0.4},0,-0.035,0.50);
    bx(g,0.070,0.095,0.028,C.dark,{metal:0.3,rough:0.74},0,-0.030,0.62);
  }
  if(ak && id !== 'galil'){
    magazine(g,parts,C.body,C.accent,0,-0.155,-len*0.14,0.072,0.29,0.12,-0.12);
  } else if(ak){
    magazine(g,parts,C.polymer,C.accent,0,-0.15,-len*0.12,0.070,0.25,0.10,-0.08);
  } else {
    magazine(g,parts,C.metal,C.accent,0,-0.15,-len*0.10,0.068,0.22,0.095,-0.06);
  }
  grip(g,parts,C.body,C.dark,0,-0.145,0.14,0.34);
  if(ak){
    stock(g,parts,C.wood,C.dark,0,-0.010,0.42,0.074,0.12,0.34);
    bx(g,0.055,0.016,0.030,C.metal,{metal:0.8,rough:0.34},0.070,0.030,0.02);
    bx(g,0.052,0.026,0.052,C.metal,{metal:0.8,rough:0.34},0,0.105,0.15);
  } else {
    cylZ(g,0.026,0.22,C.metal,{metal:0.62,rough:0.42},0,-0.005,0.36);
    stock(g,parts,C.body,C.dark,0,-0.01,0.46,0.066,0.10,0.24);
    bx(g,0.052,0.014,0.020,C.metal,{metal:0.8,rough:0.34},0,0.075,0.20);
    rail(g,C.dark,0.084,-0.28,0.40,hi?11:3);
  }
  triggerGroup(g,C.metal,C.body,-0.082,-0.075);
  ironSights(g,C.metal,0.098,0.12,-len*1.58);
  if(id === 'sg553') optic(g,C.metal,0.132,-0.06,0.16,0.030);
  else if(hi && id === 'm4a4') optic(g,C.metal,0.120,-0.16,0.12,0.024);
  if(C.em) bx(g,0.010,0.010,0.36,C.em,{emissive:C.em,metal:0.2},0.045,0.042,-len*0.62);
  return muzzle.position.z;
}

function bullpup(g, parts, id, C, hi){
  const famas = id === 'famas';
  const len = famas ? 0.62 : 0.58;
  const recv = bx(g,0.092,famas?0.14:0.12,len,C.metal,{metal:0.55,rough:0.5},0,0.02,-0.03);
  parts.receiver = recv;
  bx(g,0.084,0.070,len*0.55,C.body,{metal:0.35,rough:0.64},0,-0.045,-len*0.20);
  const hand = bx(g,0.084,0.082,len*0.48,famas?C.body:C.polymer,{metal:0.3,rough:0.66},0,0.018,-len*0.82);
  for(let i=0;i<(hi?4:2);i++) bx(g,0.088,0.016,0.024,C.dark,{metal:0.45,rough:0.58},0,0.048,-len*0.72-i*0.058);
  parts.handguard = hand;
  cylZ(g,0.017,len*0.46,C.dark,{metal:0.95,rough:0.22},0,0.028,-len*1.28);
  cylZ(g,0.023,len*0.09,C.metal,{metal:0.86,rough:0.28},0,0.028,-len*1.46);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0,0.028,-len*1.52); g.add(muzzle);
  if(famas){
    bx(g,0.032,0.10,0.034,C.body,{metal:0.25,rough:0.8},0,0.12,-0.12);
    bx(g,0.022,0.035,0.28,C.dark,{metal:0.72,rough:0.38},0,0.158,-0.11);
    bx(g,0.020,0.045,0.020,C.metal,{metal:0.8,rough:0.34},0,0.185,-0.24);
    bx(g,0.020,0.045,0.020,C.metal,{metal:0.8,rough:0.34},0,0.185,0.02);
    bx(g,0.025,0.035,0.16,C.metal,{metal:0.8,rough:0.32},0.075,0.020,-0.20);
    magazine(g,parts,C.polymer,C.accent,0,-0.14,0.14,0.068,0.24,0.093,-0.05);
  } else {
    optic(g,C.metal,0.125,-0.10,0.22,0.034);
    bx(g,0.040,0.035,0.20,C.body,{metal:0.35,rough:0.7},0,0.095,-0.22);
    bx(g,0.026,0.055,0.022,C.dark,{metal:0.4,rough:0.6},0,-0.055,-0.06);
    magazine(g,parts,C.polymer,C.accent,0,-0.15,0.09,0.066,0.20,0.090,-0.04);
  }
  bx(g,0.076,0.14,0.10,C.dark,{metal:0.18,rough:0.9},0,-0.16,0.26,0.30,0,0);
  bx(g,0.085,0.12,0.030,C.dark,{metal:0.2,rough:0.82},0,-0.02,0.33);
  triggerGroup(g,C.metal,C.body,-0.09,0.015);
  ironSights(g,C.metal,0.102,0.11,-len*1.38);
  if(C.em) bx(g,0.010,0.010,0.32,C.em,{emissive:C.em,metal:0.2},0.046,0.035,-len*0.55);
  return muzzle.position.z;
}

function sniper(g, parts, id, C, hi){
  const scout = id === 'ssg08';
  const semi = id === 'g3sg1' || id === 'scar20';
  const barrett = id === 'barrett';
  const len = barrett ? 0.86 : (scout ? 0.60 : (semi ? 0.74 : 0.70));
  const recv = bx(g,0.086,0.125,len,C.body,{metal:0.52,rough:0.5},0,0.005,-0.02);
  parts.receiver = recv;
  cylZ(g,0.020,len*0.78,C.dark,{metal:0.96,rough:0.2},0,0.028,-len*1.42);
  cylZ(g,0.032,len*0.13,C.metal,{metal:0.86,rough:0.28},0,0.028,-len*1.86);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0,0.028,-len*1.94); g.add(muzzle);
  for(let i=0;i<(hi?4:2);i++){
    bx(g,0.036,0.012,0.014,C.dark,{metal:0.8,rough:0.3},0,0.050,-len*1.80+i*0.030);
    bx(g,0.036,0.012,0.014,C.dark,{metal:0.8,rough:0.3},0,0.006,-len*1.80+i*0.030);
  }
  if(barrett){
    // enormous muzzle brake, reinforced receiver and side-mounted magazine
    cylZ(g,0.058,0.19,C.metal,{metal:0.82,rough:0.3},0,0.028,-len*1.94);
    for(let i=0;i<3;i++) bx(g,0.130,0.012,0.020,C.dark,{metal:0.6,rough:0.46},0,0.070,-len*1.80+i*0.045);
    bx(g,0.110,0.050,0.28,C.dark,{metal:0.55,rough:0.44},0,0.115,0.05);
    bx(g,0.080,0.16,0.18,C.polymer,{metal:0.24,rough:0.76},0.09,-0.10,-0.02);
    for(let i=0;i<(hi?4:2);i++) bx(g,0.014,0.030,0.024,'#c8a23a',{metal:0.9,rough:0.25},0.09,-0.04,-0.10+i*0.045);
  }
  const scopeY = barrett ? 0.175 : (scout ? 0.105 : 0.145);
  optic(g,C.metal,scopeY,-0.10,barrett?0.38:(scout?0.20:0.30),barrett?0.052:(scout?0.030:0.044));
  bx(g,0.020,0.045,0.045,C.metal,{metal:0.8,rough:0.32},0,scopeY-0.055,-0.22);
  bx(g,0.020,0.045,0.045,C.metal,{metal:0.8,rough:0.32},0,scopeY-0.055,0.01);
  bx(g,0.085,0.155,0.10,C.dark,{metal:0.16,rough:0.9},0,-0.155,0.02,0.32,0,0);
  magazine(g,parts,C.metal,C.accent,0,-0.13,-0.03,semi?0.084:0.060,semi?0.23:0.18,semi?0.105:0.085,-0.05);
  if(semi){
    bx(g,0.092,0.026,0.15,C.dark,{metal:0.5,rough:0.52},0,-0.255,-0.01);
    bx(g,0.100,0.014,0.060,C.accent,{metal:0.62,rough:0.4},0,-0.365,-0.01);
    bx(g,0.034,0.026,0.13,C.dark,{metal:0.3,rough:0.7},0.060,0.040,0.10);
    for(let i=0;i<(hi?3:1);i++) bx(g,0.020,0.010,0.020,C.metal,{metal:0.8,rough:0.32},0.066,0.075,0.02+i*0.035);
  }
  stock(g,parts,scout?C.body:C.body,C.dark,0,-0.010,scout?0.43:(semi?0.50:0.48),0.070,0.11,scout?0.30:(semi?0.44:0.40));
  bx(g,0.060,0.040,0.24,C.dark,{metal:0.25,rough:0.72},0,0.060,0.40);
  if(!scout){
    bx(g,0.060,0.034,0.055,C.metal,{metal:0.8,rough:0.32},0.078,0.035,0.10);
    cylY(g,0.010,0.10,C.metal,{metal:0.9,rough:0.25},0.13,0.035,0.10,0,0,Math.PI/2,8);
    sph(g,0.020,C.metal,{metal:0.9,rough:0.25},0.18,0.035,0.10,8);
    for(const s of [-1,1]) cylY(g,0.007,0.24,C.metal,{metal:0.82,rough:0.34},s*0.038,-0.055,-0.86,0.5,0,s*0.16,6);
  }
  triggerGroup(g,C.metal,C.body,-0.085,-0.08);
  const bolt = bx(g,0.055,0.020,0.030,C.metal,{metal:0.86,rough:0.28},0.070,0.040,0.07,0,0,0.18);
  cylY(g,0.009,0.095,C.metal,{metal:0.9,rough:0.22},0.105,0.040,0.07,0,0,1.15,7);
  sph(g,0.017,C.metal,{metal:0.9,rough:0.24},0.148,0.018,0.07,7);
  bolt.userData.travel = 0.075; parts.bolt = bolt;
  if(C.em) bx(g,0.012,0.012,0.38,C.em,{emissive:C.em,metal:0.2},0.047,0.028,-len*0.72);
  return muzzle.position.z;
}

function lmg(g, parts, id, C, hi){
  const negev = id === 'negev';
  const len = negev ? 0.58 : 0.62;
  const recv = bx(g,0.120,0.155,len,C.metal,{metal:0.6,rough:0.46},0,0.01,-0.02);
  parts.receiver = recv;
  bx(g,0.11,0.030,len*0.72,C.body,{metal:0.55,rough:0.5},0,0.102,-0.03);
  const hand = bx(g,0.108,0.080,len*0.44,C.polymer,{metal:0.3,rough:0.68},0,0.010,-len*0.90);
  for(let i=0;i<(hi?4:2);i++) bx(g,0.112,0.014,0.025,C.dark,{metal:0.4,rough:0.6},0,0.040,-len*0.76-i*0.055);
  parts.handguard = hand;
  cylZ(g,0.036,len*0.44,C.dark,{metal:0.9,rough:0.27},0,0.030,-len*1.34);
  for(let i=0;i<(hi?5:2);i++) cylZ(g,0.043,0.020,C.metal,{metal:0.84,rough:0.3},0,0.030,-len*1.12-i*0.060);
  cylZ(g,0.024,len*0.50,C.dark,{metal:0.95,rough:0.22},0,0.030,-len*1.72);
  cylZ(g,0.033,len*0.09,C.metal,{metal:0.86,rough:0.28},0,0.030,-len*2.00);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0,0.030,-len*2.08); g.add(muzzle);
  if(negev){
    magazine(g,parts,C.polymer,C.accent,0,-0.205,-0.05,0.13,0.20,0.18,0.02);
    bx(g,0.10,0.032,0.19,C.metal,{metal:0.64,rough:0.4},0,-0.09,-0.05);
  } else {
    bx(g,0.15,0.22,0.24,C.body,{metal:0.34,rough:0.66},0.01,-0.19,-0.06);
    bx(g,0.16,0.025,0.25,C.metal,{metal:0.62,rough:0.4},0.01,-0.075,-0.06);
    for(let i=0;i<(hi?6:2);i++) bx(g,0.018,0.050,0.030,'#c8a23a',{metal:0.9,rough:0.25},0.06,-0.12,-0.14+i*0.037);
    parts.mag = g.children[g.children.length-1];
  }
  bx(g,0.074,0.115,0.36,C.body,{metal:0.3,rough:0.7},0,-0.015,0.45);
  bx(g,0.084,0.13,0.030,C.dark,{metal:0.2,rough:0.8},0,-0.015,0.625);
  grip(g,parts,C.body,C.dark,0,-0.15,0.16,0.35);
  triggerGroup(g,C.metal,C.body,-0.09,-0.06);
  const lmgBolt = bx(g,0.060,0.026,0.040,C.metal,{metal:0.84,rough:0.3},0.070,0.070,0.06,0,0,0.12);
  lmgBolt.userData.travel = 0.065; parts.bolt = lmgBolt;
  rail(g,C.dark,0.118,-0.08,len*0.48,hi?9:3);
  bx(g,0.075,0.06,0.04,C.metal,{metal:0.8,rough:0.32},0,0.155,-0.28);
  bx(g,0.075,0.06,0.04,C.metal,{metal:0.8,rough:0.32},0,0.155,0.10);
  bx(g,0.040,0.022,0.38,C.metal,{metal:0.76,rough:0.36},0,0.195,-0.09);
  for(const s of [-1,1]) cylY(g,0.010,0.28,C.metal,{metal:0.8,rough:0.34},s*0.055,-0.05,-0.92,0.48,0,s*0.18,6);
  if(C.em) bx(g,0.012,0.012,0.42,C.em,{emissive:C.em,metal:0.2},0.064,0.06,-len*0.55);
  return muzzle.position.z;
}

function shotgun(g, parts, id, C, hi){
  const semi = id === 'xm1014';
  const saw = id === 'sawedoff';
  const mag7 = id === 'mag7';
  const len = saw ? 0.40 : (mag7 ? 0.50 : (semi ? 0.56 : 0.60));
  const recv = bx(g,0.090,0.115,len,C.body,{metal:0.45,rough:0.56},0,0,-0.02);
  parts.receiver = recv;
  cylZ(g,0.027,len*0.78,C.dark,{metal:0.96,rough:0.26},0,0.045,-len*1.34);
  cylZ(g,0.021,len*0.68,C.metal,{metal:0.8,rough:0.35},0,-0.005,-len*1.22);
  if(saw){
    // side-by-side short barrels and a break-action hinge
    cylZ(g,0.013,len*0.56,C.dark,{metal:0.95,rough:0.25},-0.020,0.045,-len*1.20);
    cylZ(g,0.013,len*0.56,C.dark,{metal:0.95,rough:0.25},0.020,0.045,-len*1.20);
    bx(g,0.090,0.040,0.090,C.metal,{metal:0.72,rough:0.36},0,0.020,-len*0.68);
    const breakMag = bx(g,0.080,0.060,0.10,C.metal,{metal:0.7,rough:0.36},0,-0.045,-len*0.66);
    parts.mag = breakMag;
    bx(g,0.086,0.018,0.028,C.accent,{metal:0.68,rough:0.4},0,0.078,-len*1.30);
  } else if(semi){
    bx(g,0.075,0.070,len*0.34,C.polymer,{metal:0.3,rough:0.66},0,0.010,-len*1.12);
    const tube = cylZ(g,0.024,len*0.42,C.metal,{metal:0.78,rough:0.34},0,-0.020,-len*1.18);
    tube.userData.travel = 0.02; parts.mag = tube;
    magazine(g,parts,C.metal,C.accent,0,-0.135,-0.02,0.058,0.17,0.085,-0.03);
  } else if(mag7){
    const pump = bx(g,0.076,0.072,0.20,C.polymer,{metal:0.26,rough:0.72},0,-0.012,-len*1.02);
    parts.pump = pump; parts.handguard = pump;
    magazine(g,parts,C.metal,C.accent,0,-0.150,-0.01,0.070,0.22,0.11,-0.02);
    bx(g,0.082,0.030,0.14,C.dark,{metal:0.4,rough:0.62},0,-0.070,-0.02);
  } else {
    const pump = bx(g,0.076,0.076,0.24,C.wood,{metal:0.08,rough:0.9},0,-0.005,-len*1.02);
    parts.pump = pump; parts.handguard = pump;
    for(let i=0;i<(hi?4:2);i++) bx(g,0.080,0.012,0.020,'#4a2e15',{metal:0.05,rough:0.95},0,-0.020,-len*0.88-i*0.045);
  }
  bx(g,0.018,0.012,len*0.72,C.accent,{metal:0.7,rough:0.4},0,0.076,-len*1.28);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0,0.045,-len*1.78); g.add(muzzle);
  if(saw){
    bx(g,0.070,0.100,0.16,C.wood,{metal:0.08,rough:0.9},0,-0.035,0.15);
    bx(g,0.076,0.030,0.020,C.dark,{metal:0.2,rough:0.82},0,-0.035,0.235);
  } else {
    bx(g,0.075,0.115,0.34,C.wood,{metal:0.08,rough:0.9},0,-0.005,0.42);
    bx(g,0.082,0.13,0.030,C.dark,{metal:0.2,rough:0.8},0,-0.005,0.605);
  }
  grip(g,parts,C.wood,C.dark,0,-0.12,0.14,0.30);
  triggerGroup(g,C.metal,C.body,-0.07,-0.07);
  bx(g,0.010,0.010,0.020,'#ffd27a',{metal:0.9,rough:0.2},0,0.090,-len*1.74);
  ironSights(g,C.metal,0.083,0.07,-len*1.70);
  if(C.em) bx(g,0.012,0.012,0.40,C.em,{emissive:C.em,metal:0.2},-0.05,0.045,-len*0.75);
  return muzzle.position.z;
}

function knife(g, parts, C){
  bx(g,0.050,0.055,0.16,C.dark,{metal:0.18,rough:0.92},0,0.01,0.01);
  for(let i=0;i<4;i++) bx(g,0.054,0.010,0.11,'#3a2817',{metal:0.08,rough:0.96},0,0.032-i*0.016,0.01);
  bx(g,0.092,0.016,0.026,C.metal,{metal:0.82,rough:0.3},0,0.0,-0.065);
  const blade = bx(g,0.015,0.070,0.30,'#d4d8de',{metal:0.96,rough:0.11},0,0.025,-0.22);
  bx(g,0.010,0.010,0.24,'#9aa0a8',{metal:0.96,rough:0.14},0,0.025,-0.20);
  const point = add(g,gCone(0.044,0.16,4),'#d4d8de',{metal:0.96,rough:0.11},0,0.025,-0.45,-Math.PI/2,0,0);
  parts.blade = blade; parts.point = point; parts.receiver = blade;
  sph(g,0.018,C.metal,{metal:0.9,rough:0.3},0,0.01,0.10,8);
  if(C.em) bx(g,0.006,0.012,0.20,C.em,{emissive:C.em,metal:0.2},0.014,0.03,-0.20);
  return -0.54;
}

const VIEW = {
  glock:'pistol', usp:'pistol', p250:'pistol', p2000:'pistol', tec9:'pistol',
  deagle:'pistol_big', r8:'pistol_big',
  cz75:'pistol', 'five-seven':'pistol',
  mp9:'smg', mac10:'smg', ump45:'smg', mp7:'smg', bizon:'smg', mp5sd:'smg',
  uzi:'smg', p90:'smg', vector:'smg',
  ak47:'rifle_ak', galil:'rifle_ak', sg553:'rifle_ak', val:'rifle_ak',
  m4a1:'rifle_m4', m4a4:'rifle_m4', g36:'rifle_m4', famas:'rifle_famas', aug:'rifle_aug',
  awp:'sniper', ssg08:'sniper_scout', g3sg1:'sniper', scar20:'sniper', barrett:'sniper',
  negev:'lmg', m249:'lmg',
  nova:'shotgun', xm1014:'shotgun_semi', mag7:'shotgun_semi', sawedoff:'shotgun', knife:'knife'
};

export function makeGunMesh(weaponId, skinId, detail='high'){
  const hi = detail !== 'low';
  const skin = getSkin(weaponId, skinId) || { body:null, metal:'#22262c', accent:'#4a5058', styleKey:'stock' };
  const C = palette(weaponId, skin);
  activeSkinTex = null;
  if(skin.styleKey && skin.styleKey !== 'stock'){
    activeSkinTex = new Map();
    for(const col of [C.body, C.wood, C.accent, C.metal, C.polymer]){
      if(col) activeSkinTex.set(String(col).toLowerCase(), skin.styleKey + '|' + weaponId);
    }
  }
  const g = new THREE.Group();
  const parts = {};
  let muzzleZ = -0.5, muzzleY = 0.03;

  const vm = VIEW[weaponId] || 'rifle_ak';
  if(vm === 'pistol' || vm === 'pistol_big'){ muzzleZ = pistol(g,parts,weaponId,C,hi); muzzleY = 0.034; }
  else if(vm === 'smg'){ muzzleZ = smg(g,parts,weaponId,C,hi); muzzleY = 0.020; }
  else if(vm === 'rifle_ak' || vm === 'rifle_m4' || vm === 'rifle_famas' || vm === 'rifle_aug'){
    muzzleZ = rifle(g,parts,weaponId,C,hi); muzzleY = 0.026;
  }
  else if(vm === 'sniper' || vm === 'sniper_scout'){ muzzleZ = sniper(g,parts,weaponId,C,hi); muzzleY = 0.028; }
  else if(vm === 'lmg'){ muzzleZ = lmg(g,parts,weaponId,C,hi); muzzleY = 0.030; }
  else if(vm === 'shotgun' || vm === 'shotgun_semi'){ muzzleZ = shotgun(g,parts,weaponId,C,hi); muzzleY = 0.045; }
  else { muzzleZ = knife(g,parts,C); muzzleY = 0.025; }

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, muzzleY, muzzleZ);
  g.add(muzzle);
  for(const key in parts){
    const p = parts[key];
    if(p && p.position) p.userData.base = p.position.clone();
  }
  g.userData.muzzle = muzzle;
  g.userData.viewType = vm;
  g.userData.parts = parts;
  g.userData.detail = detail;
  g.userData.weaponId = weaponId;
  activeSkinTex = null;
  return g;
}
