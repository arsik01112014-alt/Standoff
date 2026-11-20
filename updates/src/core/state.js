// Persistent player profile / settings / inventory (localStorage).
import { defaultSkins } from '../data/weapons.js';

const KEY = 'standoff3_profile_v1';
const LEGACY_KEY = 'cs_tactical_profile_v1';

export const RANKS = [
  { name:'Серебро I',   min:0    },
  { name:'Серебро II',  min:300  },
  { name:'Золото I',    min:700  },
  { name:'Золото II',   min:1200 },
  { name:'Платина',     min:1800 },
  { name:'Алмаз',       min:2600 },
  { name:'Мастер',      min:3600 },
  { name:'Элита',       min:5000 },
  { name:'Легенда',     min:7000 }
];

function defaults(){
  return {
    profile: {
      name: 'PLAYER',
      avatar: 'falcon',
      level: 1,
      xp: 0,
      wins: 0,
      losses: 0,
      matches: 0,
      kills: 0,
      deaths: 0,
      headshots: 0,
      mmr: 1000,
      teamPref: 'CT',
      playtime: 0,
      shotsFired: 0,
      shotsHit: 0,
      damage: 0,
      bestKills: 0,
      crateTokens: 2,
      casesOpened: 0,
      lastFreeCase: '',
      trainingWins: 0
    },
    settings: {
      sensitivity: 1.0,
      fov: 75,
      quality: 'high',   // verylow | low | medium | high | ultra
      volume: 0.75,
      shadows: true,
      showFps: true,
      msaa: true,
      textureQuality: 'high',
      viewDistance: 240,
      maxFps: 0,
      vsync: true,
      resolutionScale: 1,
      brightness: 1,
      motionBlur: false,
      gamepadEnabled: true,
      gamepadSensitivity: 1,
      gamepadDeadzone: 0.18,
      gamepadVibration: true,
      gamepadLayout: 'standard',
      keybinds: {
        moveForward:'KeyW', moveBack:'KeyS', moveLeft:'KeyA', moveRight:'KeyD',
        jump:'Space', crouch:'ControlLeft', run:'ShiftLeft',
        reload:'KeyR', use:'KeyE', buy:'KeyB', inspect:'KeyF', drop:'KeyG',
        lastSlot:'KeyQ', scoreboard:'Tab', pause:'Escape',
        slot1:'Digit1', slot2:'Digit2', slot3:'Digit3', slot4:'Digit4'
      },
      modUnlocked: true,
      crosshairColor: '#7dff9a',
      crosshairSize: 6,
      crosshairThickness: 2,
      crosshairGap: 4,
      crosshairOpacity: 0.92,
      crosshairDot: true,
      crosshairOutline: true,
      crosshairDynamic: true,
      crosshairEnabled: true,
      aimSensitivity: 0.78,
      invertY: false,
      touchControls: true,
      touchScale: 1,
      touchSensitivity: 1,
      touchOpacity: 0.82,
      touchLeftHanded: false,
      botDifficulty: 'normal',
      dynamicResolution: true,
      particles: true,
      renderScale: 1,
      hudScale: 1,
      toggleCrouch: true,
      damageDirections: true,
      showHints: true,
      touchLayout: null,
      touchLayoutData: null,
      cheats: {
        fly: false,
        noclip: false,
        infiniteAmmo: false,
        esp: false,
        god: false,
        infiniteMoney: false,
        speed: false,
        freeCam: false,
        debugInfo: false,
        speedControl: 1.6,
        jumpPower: 1
      }
    },
    selectedAgents: { CT: 'aegis', T: 'scorpion' },
    lastMatch: {
      mode: 'competitive',
      map: 'city',
      team: 'CT',
      teamSize: 5,
      matchMinutes: 8,
      difficulty: 'normal',
      privateMatch: false
    },
    inventory: {
      owned: defaultSkins(),
      equipped: {},
      history: []
    }
  };
}

function deepMerge(base, extra){
  if(typeof base !== 'object' || base === null) return extra !== undefined ? extra : base;
  if(Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  const out = { ...base };
  if(extra && typeof extra === 'object'){
    for(const k in extra){
      if(k in base) out[k] = deepMerge(base[k], extra[k]);
      else out[k] = extra[k];
    }
  }
  return out;
}

let state = defaults();
let onSaved = null;

export function onStateSaved(fn){ onSaved = fn; }

export function snapshotState(){
  return JSON.parse(JSON.stringify(state));
}

export function applySnapshot(snap){
  state = deepMerge(defaults(), snap || {});
  saveState();
  return state;
}

export function loadState(){
  try{
    const raw = localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      state = deepMerge(defaults(), parsed);
    }
  }catch(e){ /* ignore corrupt storage */ }
  return state;
}

export function saveState(){
  try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){}
  if(onSaved){ try{ onSaved(state); }catch(e){ /* account sync is best effort */ } }
}

export function getState(){ return state; }

export function resetState(){
  state = defaults();
  saveState();
  return state;
}

// ---------- profile helpers ----------
export function xpForLevel(level){ return 100 + (level - 1) * 120; }

export function addXP(amount){
  state.profile.xp += amount;
  while(state.profile.xp >= xpForLevel(state.profile.level)){
    state.profile.xp -= xpForLevel(state.profile.level);
    state.profile.level++;
  }
  saveState();
}

export function getRank(){
  const mmr = state.profile.mmr;
  let rank = RANKS[0];
  for(const r of RANKS) if(mmr >= r.min) rank = r;
  return rank;
}

export function recordMatch({ win, kills, deaths, headshots, duration, shotsFired, shotsHit, damage, mode }){
  const p = state.profile;
  p.matches++;
  p.kills += kills;
  p.deaths += deaths;
  p.headshots += headshots;
  p.playtime += Math.round(duration || 0);
  p.shotsFired += shotsFired || 0;
  p.shotsHit += shotsHit || 0;
  p.damage += Math.round(damage || 0);
  p.bestKills = Math.max(p.bestKills || 0, kills || 0);
  if(win){ p.wins++; p.mmr += 25; addXP(120); }
  else   { p.losses++; p.mmr = Math.max(0, p.mmr - 18); addXP(50); }
  addXP(kills * 12 + headshots * 6);
  // Free crate economy: every completed match pays a token, a win pays a
  // second one, and the training assignment pays one for 10+ eliminations.
  p.crateTokens = Math.max(0, Number(p.crateTokens) || 0) + 1 + (win ? 1 : 0);
  if(mode === 'training' && (kills || 0) >= 10){ p.crateTokens++; p.trainingWins = (p.trainingWins || 0) + 1; }
  saveState();
}

export function ownsSkin(id){
  return state.inventory.owned.includes(id);
}

export function equipSkin(weaponId, skinId){
  state.inventory.equipped[weaponId] = skinId;
  saveState();
}

export function equippedSkin(weaponId){
  return state.inventory.equipped[weaponId] || (weaponId + ':stock');
}

export function selectAgent(team, id){
  if(team !== 'CT' && team !== 'T') return;
  if(!state.selectedAgents) state.selectedAgents = { CT:'aegis', T:'scorpion' };
  state.selectedAgents[team] = id;
  saveState();
}

export function selectedAgent(team){
  if(!state.selectedAgents) state.selectedAgents = { CT:'aegis', T:'scorpion' };
  return state.selectedAgents[team] || (team === 'T' ? 'scorpion' : 'aegis');
}

export function crateTokens(){ return Math.max(0, Number(state.profile.crateTokens) || 0); }

export function addCrateTokens(n){
  state.profile.crateTokens = Math.max(0, (Number(state.profile.crateTokens) || 0) + (Number(n) || 0));
  saveState();
  return state.profile.crateTokens;
}

export function spendCrateTokens(n){
  const amount = Math.max(0, Number(n) || 0);
  if(crateTokens() < amount) return false;
  state.profile.crateTokens -= amount;
  saveState();
  return true;
}

export function grantSkin(skinId){
  if(!skinId) return { ok:false, duplicate:false };
  if(!state.inventory.owned.includes(skinId)){
    state.inventory.owned.push(skinId);
    state.inventory.history = (state.inventory.history || []).slice(0, 59);
    state.inventory.history.unshift({ id: skinId, at: Date.now() });
    saveState();
    return { ok:true, duplicate:false };
  }
  saveState();
  return { ok:true, duplicate:true };
}

export function recordCaseOpen(crateId, skinId, rarity){
  state.profile.casesOpened = (state.profile.casesOpened || 0) + 1;
  const res = grantSkin(skinId);
  state.inventory.history = state.inventory.history || [];
  if(res.duplicate){
    state.inventory.history.unshift({ id: skinId, crateId, rarity, at: Date.now() });
  } else if(state.inventory.history[0] && state.inventory.history[0].id === skinId){
    // grantSkin already logged the drop; enrich that entry instead of
    // writing a second, metadata-less history row for the same item.
    state.inventory.history[0].crateId = crateId;
    state.inventory.history[0].rarity = rarity;
  } else {
    state.inventory.history.unshift({ id: skinId, crateId, rarity, at: Date.now() });
  }
  state.inventory.history = state.inventory.history.slice(0, 60);
  saveState();
  return res;
}

export function canClaimDaily(dateKey){
  return state.profile.lastFreeCase !== dateKey;
}

export function claimDaily(dateKey){
  if(!canClaimDaily(dateKey)) return false;
  state.profile.lastFreeCase = dateKey;
  // 2 tokens = the price of the cheapest repeatable crate, so the daily
  // reward really is one free case instead of a token that buys nothing.
  state.profile.crateTokens = (Number(state.profile.crateTokens) || 0) + 2;
  saveState();
  return true;
}

export function unequipSkin(weaponId){
  if(state.inventory.equipped) delete state.inventory.equipped[weaponId];
  saveState();
}

export function buySkin(skinId, price){
  if(state.inventory.owned.includes(skinId)) return { ok:false, reason:'owned' };
  // skins bought with "credits" tied to level for simplicity: use mmr-free coin = level*100? keep free unlock system
  if(state.profile.level < price) return { ok:false, reason:'level' };
  state.inventory.owned.push(skinId);
  saveState();
  return { ok:true };
}
