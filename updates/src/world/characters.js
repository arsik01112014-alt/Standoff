// Fully procedural tactical agents with articulated limbs, gear and animation.
import * as THREE from '../../vendor/three.module.js';
import { makeGunMesh } from './guns.js';
import { getAgent } from '../data/agents.js';

import { bevelBox } from './geometry.js';
const geoCache = new Map();
const matCache = new Map();
const texCache = new Map();

function d(v, fallback){ return Number.isFinite(v) ? v : fallback; }
function damp(cur, target, rate, dt){ return cur + (target - cur) * (1 - Math.exp(-rate * dt)); }
function clamp01(v){ return Math.max(0, Math.min(1, v)); }

function boxGeo(w,h,d){
  const k = `b${w}_${h}_${d}`;
  if(!geoCache.has(k)) geoCache.set(k, bevelBox(w,h,d,0.22));
  return geoCache.get(k);
}
function cylGeo(rt,rb,h,seg=10){
  const k = `c${rt}_${rb}_${h}_${seg}`;
  if(!geoCache.has(k)) geoCache.set(k, new THREE.CylinderGeometry(rt,rb,h,seg));
  return geoCache.get(k);
}
function capGeo(r,len,seg=8){
  const k = `p${r}_${len}_${seg}`;
  if(!geoCache.has(k)) geoCache.set(k, new THREE.CapsuleGeometry(r,len,Math.max(2, seg/2),seg));
  return geoCache.get(k);
}
function sphGeo(r,seg=12){
  const k = `s${r}_${seg}`;
  if(!geoCache.has(k)) geoCache.set(k, new THREE.SphereGeometry(r,seg,Math.max(6, Math.floor(seg/2))));
  return geoCache.get(k);
}
function torusGeo(r,tube,seg=8,seg2=18,arc=Math.PI*2){
  const k = `t${r}_${tube}_${seg}_${seg2}_${arc}`;
  if(!geoCache.has(k)) geoCache.set(k, new THREE.TorusGeometry(r,tube,seg,seg2,arc));
  return geoCache.get(k);
}

function fabricTexture(kind){
  if(texCache.has(kind)) return texCache.get(kind);
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#b9b9b9'; g.fillRect(0,0,128,128);
  for(let i=0;i<900;i++){
    const v = 120 + Math.floor(Math.random()*90);
    g.fillStyle = `rgba(${v},${v},${v},${0.10 + Math.random()*0.22})`;
    g.fillRect(Math.random()*128, Math.random()*128, 1 + Math.random()*3, 1 + Math.random()*2);
  }
  if(kind === 'camo'){
    for(let i=0;i<18;i++){
      g.fillStyle = i % 3 === 0 ? 'rgba(70,70,70,.22)' : 'rgba(210,210,210,.16)';
      g.beginPath();
      g.ellipse(Math.random()*128, Math.random()*128, 8+Math.random()*20, 4+Math.random()*12, Math.random()*3, 0, 6.283);
      g.fill();
    }
  } else if(kind === 'webbing'){
    g.strokeStyle = 'rgba(40,40,40,.35)'; g.lineWidth = 2;
    for(let y=8;y<128;y+=16){ g.beginPath(); g.moveTo(0,y); g.lineTo(128,y); g.stroke(); }
    for(let x=8;x<128;x+=16){ g.beginPath(); g.moveTo(x,0); g.lineTo(x,128); g.stroke(); }
  }
  g.globalAlpha = 0.12; g.fillStyle = '#ffffff';
  for(let n=0;n<128;n+=3){ g.fillRect(n,0,1,128); g.fillRect(0,n,128,1); }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2,2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(kind, tex);
  return tex;
}

function material(color, opts={}){
  const tex = opts.tex ? `|${opts.tex}` : '';
  const key = `${color}|${opts.rough??0.8}|${opts.metal??0.08}|${opts.emissive||''}|${opts.emissiveIntensity||0}|${opts.opacity??1}${tex}`;
  if(matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.rough !== undefined ? opts.rough : 0.8,
    metalness: opts.metal !== undefined ? opts.metal : 0.08,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? (opts.emissive ? 0.35 : 0),
    transparent: (opts.opacity ?? 1) < 1,
    opacity: opts.opacity ?? 1,
    map: opts.tex ? fabricTexture(opts.tex) : null,
    side: opts.side || THREE.FrontSide
  });
  matCache.set(key, m);
  return m;
}

function mesh(parent, geo, mat, x=0,y=0,z=0, rx=0,ry=0,rz=0){
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x,y,z);
  m.rotation.set(rx,ry,rz);
  m.castShadow = false;
  m.receiveShadow = false;
  parent.add(m);
  return m;
}
function box(parent,w,h,d,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0){ return mesh(parent,boxGeo(w,h,d),mat,x,y,z,rx,ry,rz); }
function cyl(parent,rt,rb,h,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0,seg=10){ return mesh(parent,cylGeo(rt,rb,h,seg),mat,x,y,z,rx,ry,rz); }
function cap(parent,r,len,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0,seg=8){ return mesh(parent,capGeo(r,len,seg),mat,x,y,z,rx,ry,rz); }
function sph(parent,r,mat,x=0,y=0,z=0,sx=1,sy=1,sz=1,seg=12){ const m=mesh(parent,sphGeo(r,seg),mat,x,y,z); m.scale.set(sx,sy,sz); return m; }
function torus(parent,r,tube,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0,arc=Math.PI*2){ return mesh(parent,torusGeo(r,tube,8,18,arc),mat,x,y,z,rx,ry,rz); }

export function createCharacter(team, weaponId='ak47', skinId=null, agentId=null){
  const agent = getAgent(team, agentId);
  const st = agent.palette;
  const feat = agent.features;

  const mats = {
    cloth: material(st.cloth,{rough:0.9,metal:0.02,tex:'camo'}),
    cloth2: material(st.cloth2,{rough:0.92,metal:0.02,tex:'camo'}),
    vest: material(st.vest,{rough:0.72,metal:0.06,tex:'webbing'}),
    helmet: material(st.helmet,{rough:0.48,metal:0.25}),
    skin: material(st.skin,{rough:0.82,metal:0.01}),
    mask: material(st.mask,{rough:0.9,metal:0.02}),
    boots: material(st.boots,{rough:0.88,metal:0.04}),
    glove: material(st.glove,{rough:0.84,metal:0.03}),
    pack: material(st.pack,{rough:0.8,metal:0.04,tex:'camo'}),
    accent: material(st.accent,{rough:0.4,metal:0.35,emissive:st.accent,emissiveIntensity:0.32}),
    strap: material(st.strap,{rough:0.85,metal:0.03}),
    metal: material('#1a2027',{rough:0.36,metal:0.72}),
    lens: material(st.visor||st.accent,{rough:0.08,metal:0.82,emissive:st.visor||st.accent,emissiveIntensity:0.25,opacity:0.72}),
    rubber: material('#0d1013',{rough:0.95,metal:0.01}),
    teamGlow: material(team === 'CT' ? '#3d9bff' : '#ff8a2a', {
      rough:0.42, metal:0.3,
      emissive: team === 'CT' ? '#2a7dff' : '#ff7a18',
      emissiveIntensity:0.75
    })
  };

  const parts = {};
  const farParts = [];
  function far(obj){ farParts.push(obj); return obj; }

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const rig = new THREE.Group();
  root.add(rig);

  // ---------- hips / torso ----------
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  rig.add(hips);

  box(hips,0.30,0.20,0.22,mats.cloth2,0,0,0);
  box(hips,0.33,0.065,0.235,mats.strap,0,0.085,0);
  far(box(hips,0.075,0.065,0.055,mats.metal,-0.19,0.03,0.10));
  far(box(hips,0.025,0.16,0.06,mats.metal,-0.215,-0.08,0.13,0.2,0,0));

  const torso = new THREE.Group();
  torso.position.y = 0.09;
  hips.add(torso);
  parts.torso = torso;

  box(torso,0.40,0.22,0.235,mats.cloth,0,-0.015,0);
  const chest = mesh(torso,cylGeo(0.245,0.19,0.44,12),mats.cloth,0,0.22,0);
  chest.scale.z = 0.61;
  box(torso,0.47,0.36,0.045,mats.vest,0,0.19,-0.145);
  box(torso,0.47,0.39,0.05,mats.vest,0,0.19,0.145);
  box(torso,0.43,0.075,0.29,mats.strap,0,-0.035,0);
  box(torso,0.50,0.075,0.29,mats.strap,0,0.39,0);

  // cummerbund + side panels
  far(box(torso,0.08,0.27,0.30,mats.vest,0.245,0.08,0));
  far(box(torso,0.08,0.27,0.30,mats.vest,-0.245,0.08,0));
  for(let i=0;i<3;i++){
    far(box(torso,0.30,0.012,0.012,mats.strap,0,0.02+i*0.055,-0.172));
    far(box(torso,0.30,0.012,0.012,mats.strap,0,0.02+i*0.055,0.172));
  }

  // front magazine pouches and admin pouch
  for(let i=-1;i<=1;i++){
    far(box(torso,0.105,0.14,0.065,mats.pack,i*0.13,-0.045,-0.205));
    far(box(torso,0.10,0.04,0.075,mats.strap,i*0.13,0.02,-0.21));
    far(box(torso,0.018,0.10,0.016,mats.metal,i*0.13,-0.045,-0.24));
  }
  far(box(torso,0.19,0.09,0.055,mats.pack,0,0.105,-0.207));
  far(box(torso,0.16,0.045,0.015,mats.accent,0,0.105,-0.238));

  // shoulder straps, chest rig, team patch
  far(box(torso,0.09,0.34,0.035,mats.strap,0.145,0.22,-0.153,0,0,-0.08));
  far(box(torso,0.09,0.34,0.035,mats.strap,-0.145,0.22,-0.153,0,0,0.08));
  far(box(torso,0.07,0.045,0.012,mats.accent,0.20,0.33,-0.16,0,0,-0.3));
  far(box(torso,0.07,0.035,0.012,mats.accent,-0.20,0.33,-0.16,0,0,0.3));
  far(box(torso,0.16,0.055,0.014,mats.accent,0,0.28,0.176));
  far(box(torso,0.20,0.075,0.016,mats.teamGlow,0,0.10,0.176));

  // radio / antenna / grenade
  if(feat.pack === 'radio'){
    far(box(torso,0.11,0.20,0.08,mats.pack,0.20,0.10,0.20));
    far(box(torso,0.012,0.055,0.012,mats.metal,0.20,0.24,0.20));
    far(box(torso,0.007,0.30,0.007,mats.metal,0.215,0.37,0.21,0.08,0,0));
    far(box(torso,0.03,0.03,0.012,mats.accent,0.20,0.15,0.245));
  } else if(feat.pack === 'assault'){
    far(box(torso,0.37,0.40,0.18,mats.pack,0,0.17,0.23));
    far(box(torso,0.27,0.10,0.045,mats.strap,0,0.09,0.325));
    far(box(torso,0.05,0.14,0.045,mats.pack,0.15,0.19,0.325));
  } else {
    far(box(torso,0.27,0.32,0.13,mats.pack,0,0.17,0.21));
  }

  // belt gear / holster / knife
  far(box(torso,0.30,0.055,0.27,mats.strap,0,-0.105,0));
  far(box(torso,0.105,0.21,0.10,mats.mask,0.25,-0.14,-0.02,0.1,0,-0.08));
  far(box(torso,0.075,0.10,0.035,mats.pack,-0.23,-0.11,0.15));
  far(box(torso,0.035,0.19,0.04,mats.metal,-0.26,-0.13,0.19,0.2,0,0));

  // ---------- head ----------
  const neck = new THREE.Group();
  neck.position.y = 0.49;
  torso.add(neck);
  cyl(neck,0.062,0.072,0.10,mats.skin,0,0.01,0);
  far(torus(neck,0.072,0.012,mats.cloth2,0,0.04,0,Math.PI/2));

  const head = new THREE.Group();
  head.position.y = 0.12;
  neck.add(head);
  parts.head = head;

  sph(head,0.115,mats.skin,0,0.055,0,0.86,1.05,0.92,14);
  sph(head,0.085,mats.skin,0,-0.006,-0.028,0.92,0.72,0.92,14);
  sph(head,0.045,mats.skin,0,-0.035,-0.071,1.1,0.65,0.66,12);
  far(box(head,0.022,0.026,0.045,mats.skin,0,0.015,-0.125));
  for(const s of [-1,1]){
    far(sph(head,0.026,mats.skin,s*0.105,0.06,0.01,1,1.2,0.55,8));
    far(box(head,0.018,0.018,0.008,mats.mask,s*0.040,0.072,-0.112));
  }

  // headgear and facewear variants
  if(feat.helmet === 'full'){
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.143,16,10,0,Math.PI*2,0,Math.PI*0.58),mats.helmet);
    helmet.position.y = 0.105; helmet.scale.set(1,0.94,1.03); head.add(helmet); far(helmet);
    far(box(head,0.25,0.035,0.20,mats.helmet,0,0.055,0.02));
    far(box(head,0.20,0.032,0.10,mats.helmet,0,0.16,-0.04));
    for(const s of [-1,1]){
      far(box(head,0.032,0.045,0.14,mats.helmet,s*0.132,0.10,-0.01));
      far(box(head,0.018,0.018,0.01,mats.metal,s*0.132,0.10,-0.085));
      far(cyl(head,0.045,0.045,0.06,mats.rubber,s*0.127,0.03,0,0,0,Math.PI/2));
    }
    far(box(head,0.052,0.045,0.035,mats.metal,0,0.16,-0.135));
    far(cyl(head,0.018,0.018,0.06,mats.metal,0,0.16,-0.165,Math.PI/2));
  } else if(feat.helmet === 'cap'){
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.128,14,8,0,Math.PI*2,0,Math.PI*0.52),mats.helmet);
    crown.position.y = 0.11; crown.scale.y = 0.78; head.add(crown); far(crown);
    far(box(head,0.21,0.018,0.11,mats.helmet,0,0.075,-0.11));
  } else if(feat.helmet === 'bump'){
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.135,14,8,0,Math.PI*2,0,Math.PI*0.54),mats.helmet);
    crown.position.y = 0.105; crown.scale.y = 0.84; head.add(crown); far(crown);
    far(box(head,0.06,0.024,0.14,mats.metal,0.09,0.13,-0.01));
    far(box(head,0.06,0.024,0.14,mats.metal,-0.09,0.13,-0.01));
  } else if(feat.helmet === 'hood'){
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.17,12,10,0,Math.PI*2,0,Math.PI*0.65),mats.cloth2);
    hood.position.set(0,0.06,0.035); hood.scale.set(0.95,1.05,0.82); head.add(hood); far(hood);
    far(box(head,0.20,0.14,0.03,mats.cloth2,0,0.02,0.115));
  }

  if(feat.visor){
    far(box(head,0.205,0.055,0.025,mats.lens,0,0.075,-0.108));
    far(box(head,0.23,0.024,0.032,mats.strap,0,0.104,-0.105));
  }
  if(feat.mask === 'balaclava' || feat.mask === 'respirator'){
    box(head,0.205,0.145,0.145,mats.mask,0,-0.015,-0.055);
    far(box(head,0.18,0.04,0.02,mats.mask,0,0.045,-0.13));
  } else if(feat.mask === 'shemagh' || feat.mask === 'scarf'){
    box(head,0.215,0.12,0.155,mats.mask,0,-0.035,-0.045);
    far(box(head,0.16,0.16,0.025,mats.mask,0,-0.09,0.105,0.12,0,0.05));
    far(box(head,0.08,0.08,0.025,mats.mask,0.08,-0.13,0.09,0.15,0,0.5));
  }
  if(feat.mask === 'respirator'){
    far(cyl(head,0.048,0.042,0.06,mats.rubber,0,-0.06,-0.145,Math.PI/2));
    far(cyl(head,0.028,0.028,0.035,mats.metal,0.055,-0.07,-0.13,Math.PI/2));
    far(cyl(head,0.028,0.028,0.035,mats.metal,-0.055,-0.07,-0.13,Math.PI/2));
  }
  if(team === 'CT'){
    far(cyl(head,0.047,0.047,0.055,mats.rubber,0.126,0.045,0.01,0,0,Math.PI/2));
    far(cyl(head,0.047,0.047,0.055,mats.rubber,-0.126,0.045,0.01,0,0,Math.PI/2));
    far(box(head,0.012,0.012,0.12,mats.metal,0.10,-0.005,-0.075,0.35,0,0.2));
    far(sph(head,0.015,mats.metal,0.085,-0.025,-0.14,1,1,1,6));
  }

  // ---------- arms ----------
  const armR = new THREE.Group(); armR.position.set(0.275,0.40,0); torso.add(armR);
  const armL = new THREE.Group(); armL.position.set(-0.275,0.40,0); torso.add(armL);
  parts.armR = armR; parts.armL = armL;

  function buildArm(side, arm){
    const s = side;
    box(arm,0.135,0.115,0.17,mats.vest,0,0.035,0);
    far(box(arm,0.075,0.04,0.16,mats.accent,s*0.06,0.075,-0.02,0,0,0.2));
    // team armband: readable at distance and distinct from the other side
    far(box(arm,0.148,0.052,0.184,mats.teamGlow,0,0.005,0));
    cap(arm,0.060,0.19,mats.cloth,0,-0.115,0);
    far(torus(arm,0.062,0.014,mats.accent,0,-0.085,0,Math.PI/2));
    const elbow = new THREE.Group(); elbow.position.y = -0.235; arm.add(elbow);
    far(box(elbow,0.112,0.08,0.12,mats.vest,0,0.01,0));
    if(feat.sleeves === 'rolled'){
      cap(elbow,0.052,0.13,mats.skin,0,-0.095,0);
      far(torus(elbow,0.056,0.012,mats.cloth,0,-0.025,0,Math.PI/2));
    } else {
      cap(elbow,0.056,0.16,mats.cloth2,0,-0.105,0);
    }
    const cuff = new THREE.Group(); cuff.position.y = -0.215; elbow.add(cuff);
    box(cuff,0.085,0.055,0.09,mats.glove,0,-0.01,0);
    box(cuff,0.085,0.105,0.135,mats.glove,0,-0.085,-0.025);
    far(box(cuff,0.085,0.03,0.10,mats.rubber,0,-0.145,-0.03));
    for(let i=0;i<4;i++) far(box(cuff,0.014,0.055,0.024,mats.glove,-0.033+i*0.022,-0.105,-0.085,0.2,0,0));
    far(box(cuff,0.025,0.05,0.03,mats.glove,s*0.052,-0.075,-0.025,0,0,s*0.4));
    return { elbow, cuff };
  }
  const armRP = buildArm(1,armR);
  const armLP = buildArm(-1,armL);
  far(box(armR,0.07,0.13,0.20,mats.vest,0.045,0.005,0));
  far(box(armL,0.07,0.13,0.20,mats.vest,-0.045,0.005,0));

  // ---------- agent-specific silhouette gear ----------
  // Each agent gets one dominant, readable shape so squads are not recolors.
  const aid = agent.id;
  if(aid === 'aegis'){
    // heavy breacher: oversized pauldrons and frontal trauma plate
    for(const [arm,s] of [[armR,1],[armL,-1]]){
      far(box(arm,0.19,0.15,0.23,mats.vest,s*0.02,0.045,0));
      far(box(arm,0.205,0.045,0.245,mats.helmet,s*0.02,0.115,0,0,0,s*0.12));
      far(box(arm,0.16,0.035,0.21,mats.teamGlow,s*0.02,0.005,0));
    }
    far(box(torso,0.34,0.30,0.055,mats.helmet,0,0.22,-0.185));
    far(box(torso,0.12,0.08,0.02,mats.teamGlow,0,0.12,-0.215));
  } else if(aid === 'vanguard'){
    // support: tall rucksack with bedroll and side pouches
    far(box(torso,0.38,0.44,0.20,mats.pack,0,0.17,0.235));
    far(cyl(torso,0.07,0.07,0.34,mats.mask,0,0.43,0.25,0,0,Math.PI/2,8));
    for(const s of [-1,1]) far(box(torso,0.09,0.13,0.07,mats.pack,s*0.21,0.05,0.25));
    far(box(torso,0.18,0.05,0.02,mats.teamGlow,0,0.30,0.34));
  } else if(aid === 'specter'){
    // recon: low-profile hood, draped scarf and antenna
    far(box(torso,0.30,0.24,0.03,mats.cloth2,0,0.26,0.155));
    far(box(torso,0.14,0.34,0.035,mats.cloth2,0.17,0.20,0.17,0,0,0.25));
    far(box(torso,0.009,0.36,0.009,mats.metal,-0.21,0.32,0.21));
    far(box(torso,0.045,0.035,0.012,mats.teamGlow,-0.21,0.47,0.21));
  } else if(aid === 'scorpion'){
    // assault: chest rig, angular shoulder plates and orange slash
    far(box(torso,0.42,0.20,0.06,mats.pack,0,0.22,-0.19));
    for(const s of [-1,1]) far(box(torso,0.12,0.10,0.20,mats.helmet,s*0.24,0.34,0,0,0,s*0.3));
    far(box(torso,0.06,0.26,0.02,mats.teamGlow,0.13,0.20,-0.225,0,0,-0.35));
    far(box(torso,0.03,0.19,0.02,mats.teamGlow,-0.02,0.20,-0.225,0,0,0.28));
  } else if(aid === 'nomad'){
    // sniper: long desert cloak and chest bandolier
    far(box(torso,0.42,0.62,0.035,mats.cloth2,0,0.06,0.185,0.06,0,0));
    far(box(torso,0.36,0.40,0.030,mats.cloth2,0.06,0.05,-0.175,-0.05,0,-0.05));
    for(let i=0;i<6;i++) far(box(torso,0.035,0.10,0.035,mats.strap,-0.17+i*0.068,0.18,-0.215,0,0,0.35));
    far(box(torso,0.20,0.045,0.015,mats.teamGlow,0,0.33,0.205));
  } else if(aid === 'cinder'){
    // sabotage: back tank, heavy apron and mask hose
    far(cyl(torso,0.10,0.10,0.38,mats.metal,-0.12,0.24,0.235,0,0,0,10));
    far(cyl(torso,0.10,0.10,0.38,mats.metal,0.12,0.24,0.235,0,0,0,10));
    far(box(torso,0.34,0.45,0.035,mats.mask,0,-0.02,-0.19));
    far(box(torso,0.30,0.06,0.04,mats.teamGlow,0,0.20,-0.21));
    far(box(torso,0.025,0.26,0.02,mats.rubber,0.16,0.09,-0.20,0,0,0.2));
  }

  // ---------- legs ----------
  const legR = new THREE.Group(); legR.position.set(0.115,0,0); hips.add(legR);
  const legL = new THREE.Group(); legL.position.set(-0.115,0,0); hips.add(legL);
  parts.legR = legR; parts.legL = legL;

  function buildLeg(side, leg){
    const s = side;
    cap(leg,0.078,0.24,mats.cloth,0,-0.22,0);
    far(box(leg,0.105,0.14,0.055,mats.pack,s*0.055,-0.18,-0.075));
    const knee = new THREE.Group(); knee.position.y = -0.43; leg.add(knee);
    far(box(knee,0.118,0.105,0.06,mats.vest,0,0.015,-0.075));
    cap(knee,0.067,0.22,mats.cloth2,0,-0.20,0);
    far(box(knee,0.10,0.19,0.035,mats.mask,0,-0.16,0.062));
    const ankle = new THREE.Group(); ankle.position.y = -0.43; knee.add(ankle);
    box(ankle,0.14,0.09,0.20,mats.boots,0,-0.025,-0.03);
    far(box(ankle,0.148,0.032,0.23,mats.rubber,0,-0.075,-0.04));
    far(box(ankle,0.11,0.055,0.035,mats.boots,0,0.02,-0.125));
    for(let i=0;i<3;i++) far(box(ankle,0.012,0.012,0.05,mats.metal,s*0.035,0.005,-0.10+i*0.035));
    return { knee, ankle };
  }
  const legRP = buildLeg(1,legR);
  const legLP = buildLeg(-1,legL);

  // ---------- weapon ----------
  const weaponHolder = new THREE.Group();
  weaponHolder.position.set(0.12,0.21,-0.37);
  torso.add(weaponHolder);
  parts.weaponHolder = weaponHolder;
  let gun = null;
  let gunParts = null;
  const gunBases = new Map();

  function setWeapon(id, skin){
    if(gun) weaponHolder.remove(gun);
    gunBases.clear();
    gun = makeGunMesh(id, skin, 'low');
    gun.scale.setScalar(0.82);
    weaponHolder.add(gun);
    gunParts = gun.userData.parts || {};
    for(const key in gunParts){
      const p = gunParts[key];
      if(p && p.position) gunBases.set(p, p.position.clone());
    }
  }
  if(weaponId) setWeapon(weaponId, skinId);

  // ---------- animation ----------
  const base = {
    armRX:-1.10, armRY:0.02, armRZ:-0.34,
    armLX:-1.16, armLY:-0.04, armLZ:0.42,
    elbowR:0.58, elbowL:0.44
  };
  let phase = 0;
  let deadT = 0;
  let landT = 0;
  let prevAir = false;
  let reloadT = 0, reloadTotal = 1;
  let inspectT = 0, inspectTotal = 1.35;
  let shootKick = 0;
  let turnLean = 0;
  const clock = () => (typeof performance !== 'undefined' ? performance.now() : 0);

  function playReload(duration=2){ reloadTotal = Math.max(0.35,duration); reloadT = reloadTotal; }
  function playInspect(duration=1.35){ inspectTotal = Math.max(0.5,duration); inspectT = inspectTotal; }
  function playShoot(){ shootKick = Math.min(1, shootKick + 0.85); }

  function animate(dt, speed=0, aimPitch=0, dead=false, dist=0, opts={}){
    dt = Math.max(0, Math.min(0.08, d(dt,0)));
    for(const m of farParts) m.visible = dead || dist <= 0 || dist < 25;

    if(dead){
      deadT = Math.min(1, deadT + dt*2.4);
      rig.rotation.x = damp(rig.rotation.x, -1.42, 8, dt);
      rig.position.y = damp(rig.position.y, 0.05, 8, dt);
      hips.position.y = damp(hips.position.y, 0.50, 7, dt);
      torso.rotation.x = damp(torso.rotation.x, -0.08, 6, dt);
      head.rotation.x = damp(head.rotation.x, 0.35, 5, dt);
      armR.rotation.set(damp(armR.rotation.x,-0.5,4,dt),0,damp(armR.rotation.z,-0.7,4,dt));
      armL.rotation.set(damp(armL.rotation.x,-0.3,4,dt),0,damp(armL.rotation.z,0.8,4,dt));
      legR.rotation.x = damp(legR.rotation.x,0.2,4,dt);
      legL.rotation.x = damp(legL.rotation.x,-0.25,4,dt);
      legRP.knee.rotation.x = damp(legRP.knee.rotation.x,0.6,4,dt);
      legLP.knee.rotation.x = damp(legLP.knee.rotation.x,0.35,4,dt);
      if(gun) gun.rotation.z = damp(gun.rotation.z, 0.8, 3, dt);
      return;
    }

    deadT = 0;
    rig.rotation.x = damp(rig.rotation.x, 0, 10, dt);

    const crouch = !!opts.crouch;
    const air = !!opts.air;
    const moving = speed > 0.25;
    const run = clamp01((speed - 4.6) / 3.0);
    const walk = clamp01(speed / 4.2);
    const reloading = reloadT > 0;
    const inspecting = inspectT > 0;

    if(air && !prevAir) landT = 0;
    if(!air && prevAir) landT = 0.24;
    prevAir = air;
    landT = Math.max(0, landT - dt);
    reloadT = Math.max(0, reloadT - dt);
    inspectT = Math.max(0, inspectT - dt);
    shootKick = Math.max(0, shootKick - dt*9);

    const moveRate = moving ? 4.6 + speed*1.05 : 1.25;
    phase += dt * moveRate * (moving ? 1 : 0.35);

    const swing = (0.52 + run*0.32) * walk;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    const crouchBlend = crouch ? 1 : 0;
    const land = landT > 0 ? Math.sin((1-landT/0.24)*Math.PI) : 0;

    // legs: articulated stride, knees and ankles
    let thighR = s * swing;
    let thighL = -s * swing;
    let kneeR = Math.max(0, -s) * (0.55 + run*0.6);
    let kneeL = Math.max(0, s) * (0.55 + run*0.6);
    let ankleR = -thighR*0.30;
    let ankleL = -thighL*0.30;

    if(crouch){
      thighR = -0.72 + s*0.12*walk;
      thighL = -0.72 - s*0.12*walk;
      kneeR = 1.18 + Math.max(0,s)*0.22;
      kneeL = 1.18 + Math.max(0,-s)*0.22;
      ankleR = -0.36; ankleL = -0.36;
    }
    if(air){
      thighR = -0.35 + s*0.10;
      thighL = 0.28 - s*0.10;
      kneeR = 0.95; kneeL = 0.50;
      ankleR = 0.25; ankleL = -0.1;
    }
    if(land > 0){
      thighR = -0.50*land + s*0.10;
      thighL = -0.50*land - s*0.10;
      kneeR += 0.60*land; kneeL += 0.60*land;
    }

    legR.rotation.x = damp(legR.rotation.x, thighR, 12, dt);
    legL.rotation.x = damp(legL.rotation.x, thighL, 12, dt);
    legRP.knee.rotation.x = damp(legRP.knee.rotation.x, kneeR, 13, dt);
    legLP.knee.rotation.x = damp(legLP.knee.rotation.x, kneeL, 13, dt);
    legRP.ankle.rotation.x = damp(legRP.ankle.rotation.x, ankleR, 12, dt);
    legLP.ankle.rotation.x = damp(legLP.ankle.rotation.x, ankleL, 12, dt);
    legR.rotation.z = damp(legR.rotation.z, crouch ? 0.06 : 0, 8, dt);
    legL.rotation.z = damp(legL.rotation.z, crouch ? -0.06 : 0, 8, dt);

    const hipDrop = crouch ? -0.29 : (land*0.10);
    hips.position.y = damp(hips.position.y, 0.92 + hipDrop, 12, dt);
    rig.position.y = damp(rig.position.y, air ? 0.02 : (land*0.03), 10, dt);

    // torso lean, breathing, body bob
    const lean = run*0.12 + (moving ? Math.abs(c)*0.012 : 0);
    torso.rotation.x = damp(torso.rotation.x, -aimPitch*0.22 + lean + crouch*0.12, 10, dt);
    torso.rotation.z = damp(torso.rotation.z, s*0.035*walk, 9, dt);
    torso.position.y = damp(torso.position.y, 0.09 + (moving ? Math.abs(c)*0.014*walk : Math.sin(clock()*0.0014)*0.006), 10, dt);
    head.rotation.x = damp(head.rotation.x, -aimPitch*0.52 - torso.rotation.x*0.25 + (dead?0:0), 9, dt);
    head.rotation.y = damp(head.rotation.y, Math.sin(clock()*0.00045)*0.055*(1-walk), 4, dt);
    if(opts.turn !== undefined){
      turnLean = damp(turnLean, Math.max(-0.22, Math.min(0.22, opts.turn)), 6, dt);
      head.rotation.y += turnLean*0.35;
    }

    // arms / weapon handling
    const kick = shootKick;
    let armRX = base.armRX + s*0.075*walk - run*0.18;
    let armLX = base.armLX - s*0.075*walk - run*0.14;
    let armRZ = base.armRZ - run*0.12;
    let armLZ = base.armLZ + run*0.10;
    let elbowR = base.elbowR + run*0.15;
    let elbowL = base.elbowL + run*0.10;
    let wY = 0.21, wZ = -0.37, wRX = -aimPitch*0.08, wRY = 0, wRZ = 0;

    if(reloading){
      const k = 1 - reloadT / reloadTotal;
      const dip = Math.sin(Math.min(1,k)*Math.PI);
      wY -= 0.06*dip; wZ += 0.055*dip;
      wRX += 0.22*dip; wRZ += 0.32*Math.sin(k*Math.PI*2)*0.5;
      armLX -= 0.28*dip; elbowL += 0.65*dip;
      armRX += 0.06*dip;
    } else if(inspecting){
      const k = 1 - inspectT / inspectTotal;
      wRY += Math.sin(k*Math.PI)*0.70;
      wRZ += Math.sin(k*Math.PI*2)*0.22;
      wY += Math.sin(k*Math.PI)*0.035;
      armLX -= 0.12*Math.sin(k*Math.PI);
      armRX -= 0.05*Math.sin(k*Math.PI);
    }

    armR.rotation.x = damp(armR.rotation.x, armRX, 13, dt);
    armL.rotation.x = damp(armL.rotation.x, armLX, 13, dt);
    armR.rotation.y = damp(armR.rotation.y, base.armRY, 10, dt);
    armL.rotation.y = damp(armL.rotation.y, base.armLY, 10, dt);
    armR.rotation.z = damp(armR.rotation.z, armRZ, 12, dt);
    armL.rotation.z = damp(armL.rotation.z, armLZ, 12, dt);
    armRP.elbow.rotation.x = damp(armRP.elbow.rotation.x, elbowR, 13, dt);
    armLP.elbow.rotation.x = damp(armLP.elbow.rotation.x, elbowL, 13, dt);
    armRP.elbow.rotation.z = damp(armRP.elbow.rotation.z, -0.10, 10, dt);
    armLP.elbow.rotation.z = damp(armLP.elbow.rotation.z, 0.10, 10, dt);

    weaponHolder.position.y = damp(weaponHolder.position.y, wY, 14, dt);
    weaponHolder.position.z = damp(weaponHolder.position.z, wZ, 14, dt);
    weaponHolder.rotation.x = damp(weaponHolder.rotation.x, wRX - kick*0.06, 16, dt);
    weaponHolder.rotation.y = damp(weaponHolder.rotation.y, wRY, 12, dt);
    weaponHolder.rotation.z = damp(weaponHolder.rotation.z, wRZ, 12, dt);
    if(gun){
      gun.rotation.x = damp(gun.rotation.x, 0, 12, dt);
      gun.rotation.z = damp(gun.rotation.z, kick*0.025, 12, dt);
      // magazine / bolt animation during reload
      const mag = gunParts && gunParts.mag;
      const bolt = gunParts && (gunParts.bolt || gunParts.slide);
      const pump = gunParts && gunParts.pump;
      if(gunBases.has(mag)){
        const b = gunBases.get(mag);
        const k = reloading ? 1 - reloadT/reloadTotal : 0;
        const out = reloading ? Math.sin(Math.min(1,Math.max(0,(k-0.12)/0.55))*Math.PI) : 0;
        mag.position.set(b.x, b.y - out*0.20, b.z + out*0.045);
        mag.visible = true;
      }
      if(gunBases.has(bolt)){
        const b = gunBases.get(bolt);
        const k = reloading ? 1 - reloadT/reloadTotal : 0;
        const slide = reloading ? Math.sin(Math.min(1,k/0.35)*Math.PI) * (bolt.userData.travel || 0.04) : 0;
        bolt.position.set(b.x, b.y, b.z + slide);
      }
      if(gunBases.has(pump)){
        const b = gunBases.get(pump);
        const k = reloading ? 1 - reloadT/reloadTotal : 0;
        pump.position.set(b.x, b.y, b.z + Math.sin(Math.min(1,k/0.55)*Math.PI) * 0.10);
      }
    }
  }

  function setAlly(){ /* ally markers are drawn by the HUD */ }
  function dispose(){ /* cached geometry/materials are shared */ }

  animate(0,0,0,false,0);
  return {
    root, rig, parts, agentId:agent.id,
    setWeapon, setAlly, playReload, playInspect, playShoot, animate, dispose
  };
}
