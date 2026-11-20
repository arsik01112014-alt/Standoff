// Application bootstrap: renderer, menu, match lifecycle, main loop.
import * as THREE from '../vendor/three.module.js';
import { loadState, getState, recordMatch, saveState } from './core/state.js';
import { audio } from './core/audio.js';
import { Input } from './core/input.js';
import { HUD } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { Match } from './game/match.js';
import { bindAccountSync, restoreSession } from './core/accounts.js';

loadState();
bindAccountSync();
restoreSession();

const canvas = document.getElementById('game');
const menuRoot = document.getElementById('menuRoot');
const pauseOverlay = document.getElementById('pauseOverlay');
const resultOverlay = document.getElementById('resultOverlay');
const hud = new HUD();

const settings = getState().settings;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.msaa !== false && settings.quality !== 'low' && settings.quality !== 'verylow', powerPreference: 'high-performance' });
renderer.setPixelRatio(targetPixelRatio(settings));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08 * (settings.brightness || 1);
renderer.shadowMap.enabled = settings.shadows && (settings.quality === 'medium' || settings.quality === 'high' || settings.quality === 'ultra');
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

audio.setVolume(settings.volume);

const input = new Input();
input.attach(canvas);

let state = 'menu';
let match = null;
let lastConfig = null;

const menu = new Menu({
  onStart: startMatch,
  onSettingsChanged: applySettings
});
menu.resize(window.innerWidth, window.innerHeight);

const gameCamera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth/window.innerHeight, 0.08, Math.max(120, Number(settings.viewDistance) || 240));
let gameScene = null;

// ---------------- lifecycle ----------------
function startMatch(config){
  audio.init(); audio.resume();
  lastConfig = config;
  if(match){ match.dispose(); match = null; }
  menu.hide();
  pauseOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  hud.resetGame();
  hud.setVisible(true);
  hud.refreshSettings();

  gameScene = new THREE.Scene();
  gameCamera.fov = getState().settings.fov;
  gameCamera.aspect = window.innerWidth / window.innerHeight;
  gameCamera.updateProjectionMatrix();

  input.setEnabled(true);
  state = 'game';
  updateRotateHint();
  last = performance.now();
  match = new Match({
    scene: gameScene,
    camera: gameCamera,
    hud,
    audio,
    mode: config.mode,
    mapId: config.map,
    team: config.team,
    teamSize: config.teamSize,
    difficulty: config.difficulty,
    agents: getState().selectedAgents,
    matchMinutes: config.matchMinutes,
    roundsToWin: config.roundsToWin,
    privateMatch: !!config.privateMatch,
    customMap: config.customMap || null,
    onEnd: handleMatchEnd,
    onExit: exitToMenu
  });
  if(match && match.player) match.player.sens = getState().settings.sensitivity;
}

function exitToMenu(){
  if(match){ match.dispose(); match = null; }
  gameScene = null;
  state = 'menu';
  updateRotateHint();
  input.setEnabled(false);
  input.exitLock();
  hud.setVisible(false);
  hud.closeBuy();
  pauseOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  menu.show();
  menu.render();
  last = performance.now();
}

function handleMatchEnd(result){
  recordMatch({
    win: result.win,
    mode: result.mode,
    kills: result.kills,
    deaths: result.deaths,
    headshots: result.headshots,
    duration: result.duration,
    shotsFired: result.shotsFired,
    shotsHit: result.shotsHit,
    damage: result.damage
  });
  if(match) match.setPaused(true);
  input.setEnabled(false);
  input.exitLock();

  const title = result.win ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
  const p = getState().profile;
  const mins = Math.floor((result.duration || 0) / 60), secs = Math.round((result.duration || 0) % 60);
  document.getElementById('resTitle').textContent = title;
  document.getElementById('resTitle').className = result.win ? 'win' : 'lose';
  const scoreLine = result.ffa ? `${result.kills} : ${result.topKills ?? 0}` : `${result.score.CT} : ${result.score.T}`;
  const scoreLabel = result.ffa ? 'Вы : лидер ботов' : 'Счёт';
  document.getElementById('resStats').innerHTML = `
    <div class="rsGrid">
      <div><b>${result.kills}</b><span>Убийств</span></div>
      <div><b>${result.deaths}</b><span>Смертей</span></div>
      <div><b>${result.headshots}</b><span>В голову</span></div>
      <div><b>${result.accuracy}%</b><span>Точность</span></div>
      <div><b>${result.damage}</b><span>Урон</span></div>
      <div><b>${scoreLine}</b><span>${scoreLabel}</span></div>
    </div>
    <div class="rsMeta">${result.modeLabel} · ${result.difficulty.toUpperCase()} · ${mins}:${String(secs).padStart(2,'0')}</div>
    <div class="rsProfile">Уровень ${p.level} · ${p.wins} побед · ${p.matches} матчей · ${p.shotsFired ? Math.round(p.shotsHit/p.shotsFired*100) : 0}% средняя точность</div>`;
  resultOverlay.classList.remove('hidden');
}

// ---------------- pause ----------------
function togglePause(force){
  if(!match || resultOverlay.classList.contains('hidden') === false) return;
  const want = force !== undefined ? force : !match.paused;
  if(want){
    match.setPaused(true);
    input.setEnabled(false);
    input.exitLock();
    renderPause();
    pauseOverlay.classList.remove('hidden');
  } else {
    match.setPaused(false);
    input.setEnabled(true);
    pauseOverlay.classList.add('hidden');
    input.requestLock();
  }
}

const MODS = [['god','Бессмертие'],['infiniteAmmo','Бесконечные патроны'],['infiniteMoney','Деньги'],['esp','Видеть противников'],['aimbot','Автонаводка'],['wallbang','Прострел'],['fly','Полёт'],['noclip','Сквозь стены'],['speed','Ускорение']];
function renderPause(tab='roster'){
  if(!match)return;
  hud.renderScoreboard(match);
  document.getElementById('pauseRoster').innerHTML=hud.scoreboard.innerHTML;
  document.getElementById('pauseRoster').classList.toggle('hidden',tab==='mods');
  const host=document.getElementById('pauseMods'); host.classList.toggle('hidden',tab!=='mods');
  host.innerHTML='<p>'+ (match.modAllowed?'Песочница: изменения применятся после продолжения.':'Функции доступны в тренировке и приватном матче.')+'</p>'+MODS.map(([key,label])=>`<label class="setRow"><span>${label}</span><input type="checkbox" data-pause-mod="${key}" ${getState().settings.cheats[key]?'checked':''} ${match.modAllowed?'':'disabled'}></label>`).join('');
  host.querySelectorAll('[data-pause-mod]').forEach(el=>{el.onchange=()=>{getState().settings.modUnlocked=true;getState().settings.cheats[el.dataset.pauseMod]=el.checked;saveState();};});
  document.getElementById('teamSwitchNote').textContent=match.roundMode?'Счёт сохранится. Текущий раунд начнётся заново.':'Счёт сохранится. Вы возродитесь за выбранную команду.';
  document.querySelectorAll('[data-team-switch]').forEach(el=>{el.disabled=el.dataset.teamSwitch===match.playerTeam;});
}
document.getElementById('pauseMatch').onclick=()=>togglePause(true);
document.getElementById('rosterMatch').onclick=()=>{togglePause(true);renderPause('roster');};
document.getElementById('modsMatch').onclick=()=>{togglePause(true);renderPause('mods');};
document.getElementById('pauseRosterTab').onclick=()=>renderPause('roster');
document.getElementById('pauseModsTab').onclick=()=>renderPause('mods');
document.querySelectorAll('[data-team-switch]').forEach(el=>{el.onclick=()=>{if(match?.switchTeam(el.dataset.teamSwitch)){lastConfig.team=match.playerTeam;renderPause();}};});
window.addEventListener('keydown',e=>{if(e.code==='Escape' && match?.paused && !pauseOverlay.classList.contains('hidden')){e.preventDefault();togglePause(false);}});
window.addEventListener('blur',()=>togglePause(true));
document.addEventListener('visibilitychange',()=>{if(document.hidden)togglePause(true);});
window.addEventListener('native-pause',()=>togglePause(true));

document.getElementById('resumeBtn').onclick = ()=>{ audio.click(); togglePause(false); };
document.getElementById('quitBtn').onclick = ()=>{ audio.click(); exitToMenu(); };
document.getElementById('resAgain').onclick = ()=>{ audio.click(); if(lastConfig) startMatch(lastConfig); };
document.getElementById('resMenu').onclick = ()=>{ audio.click(); exitToMenu(); };

// ---------------- input glue ----------------
let firstGesture = false;
function onGesture(){
  if(firstGesture) return;
  firstGesture = true;
  audio.init(); audio.resume();
}
window.addEventListener('pointerdown', onGesture, { passive:true });
window.addEventListener('keydown', onGesture);

canvas.addEventListener('mousedown', ()=>{
  if(state === 'game' && match && !match.paused && !match.buyPause && !input.usingTouch && !hud.buyOpen && !hud.scoreboardOpen){
    input.requestLock();
  }
});

function handleGameInput(){
  if(!match) return;
  if(input.escapePressed){
    if(match.buyPause){ hud.closeBuy(); }
    else togglePause();
    return;
  }
  if(hud.buyOpen){ // pause while buying
    if(input.buyPressed){ hud.closeBuy(); }
    return;
  }
  if(input.scoreboard && !hud.scoreboardOpen){ hud.toggleScoreboard(match); }
  else if(!input.scoreboard && hud.scoreboardOpen){ hud.toggleScoreboard(match); }
  else if(input.scoreboard && hud.scoreboardOpen){ hud.renderScoreboard(match); }
}

function targetPixelRatio(s){
  const base = { verylow:0.8, low:1, medium:1.25, high:1.75, ultra:2 }[s.quality] || 1.5;
  const scale = Math.max(0.5, Math.min(1, s.renderScale || 1)) * Math.max(0.5, Math.min(1, s.resolutionScale || 1));
  return Math.min(window.devicePixelRatio || 1, base) * scale;
}
function qualityShadow(s){
  return !!s.shadows && (s.quality === 'medium' || s.quality === 'high' || s.quality === 'ultra');
}

function applySettings(s){
  audio.setVolume(s.volume);
  renderer.shadowMap.enabled = qualityShadow(s);
  renderer.toneMappingExposure = 1.08 * (s.brightness || 1);
  dynScale = 1;
  renderer.setPixelRatio(targetPixelRatio(s));
  hud.refreshSettings();
  if(hud.root) hud.root.style.zoom = String(Math.max(0.8, Math.min(1.3, s.hudScale || 1)));
  if(match){
    match.settings = s;
    if(match.level){
      const far = match.level.viewDistance || 240;
      if(match.scene && match.scene.fog) match.scene.fog.far = far;
    }
    gameCamera.fov = s.fov || 75;
  }
  if(gameCamera){
    gameCamera.far = Math.max(120, Number(s.viewDistance) || 240);
    gameCamera.aspect = window.innerWidth / window.innerHeight;
    gameCamera.updateProjectionMatrix();
  }
}

// ---------------- resize ----------------
function updateRotateHint(){
  const el = document.getElementById('rotateHint');
  if(!el) return;
  const touch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  const portrait = window.innerHeight > window.innerWidth;
  el.classList.toggle('hidden', !(touch && portrait && state === 'game'));
}

function onResize(){
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  renderer.setPixelRatio(targetPixelRatio(getState().settings));
  menu.resize(w, h);
  if(match){ gameCamera.aspect = w/h; gameCamera.updateProjectionMatrix(); }
  updateRotateHint();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', ()=>setTimeout(onResize, 120));

// ---------------- loop ----------------
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0, fps = 60;
let dynTimer = 0, dynScale = 1;
let lastRenderAt = 0;

function loop(now){
  const maxFps = Number(getState().settings.maxFps) || 0;
  if(maxFps > 0 && lastRenderAt && now - lastRenderAt < (1000 / maxFps) - 0.4){
    requestAnimationFrame(loop);
    return;
  }
  lastRenderAt = now;
  let dt = (now - last) / 1000;
  last = now;
  if(dt > 0.05) dt = 0.05;
  if(dt < 0) dt = 0;
  fpsAcc += dt; fpsFrames++;
  if(fpsAcc >= 0.5){ fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }

  if(state === 'menu'){
    menu.update(dt);
    renderer.render(menu.scene, menu.camera);
  } else if(state === 'game' && match){
    input.sample(dt);
    handleGameInput();
    if(input.gamepadJustConnected && hud) hud.message('ГЕЙМПАД ПОДКЛЮЧЁН', String(input.gamepadId || '').slice(0, 42), 2400);
    match.update(dt, input, fps);
    input.endFrame();
    const s = getState().settings;
    if(s.dynamicResolution !== false && !match.paused && !match.buyPause && !(Number(s.maxFps) > 0 && Number(s.maxFps) <= 60)){
      dynTimer += dt;
      if(dynTimer > 1.25){
        dynTimer = 0;
        if(fps < 42) dynScale = Math.max(0.65, dynScale - 0.08);
        else if(fps > 57) dynScale = Math.min(1, dynScale + 0.05);
        renderer.setPixelRatio(targetPixelRatio(s) * dynScale);
      }
    }
    renderer.render(match.scene, gameCamera);
  }
  requestAnimationFrame(loop);
}

applySettings(settings);
requestAnimationFrame(loop);

// expose for debugging
window.__game = { get match(){ return match; }, get state(){ return state; }, menu };
