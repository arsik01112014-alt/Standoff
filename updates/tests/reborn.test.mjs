// Headless smoke + logic tests for the REBORN update.
// Run: node tests/reborn.test.mjs
import { JSDOM } from 'jsdom';
import * as THREE from '../vendor/three.module.js';
import { buildMap, buildCustomMap, MAP_INFO, isSolid } from '../src/data/maps.js';
import { findPath } from '../src/game/pathfinding.js';
import { WEAPONS, GRENADES, SKIN_STYLES, getSkin, skinIdFor, defaultSkins } from '../src/data/weapons.js';
import { DIFFICULTIES, DIFFICULTY_ORDER, getDifficulty } from '../src/data/difficulty.js';
import { TEAM_AGENTS, AGENT_ORDER, getAgent, agentAt } from '../src/data/agents.js';
import { makeGunMesh } from '../src/world/guns.js';
import { getState } from '../src/core/state.js';
import { computeDamage, damageFalloff, spreadFor, recoilFor, hitSpheresAt, HIT_ZONES } from '../src/game/combat.js';

let passed = 0, failed = 0;
function ok(cond, label){
  if(cond){ passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ✗ ' + label); }
}
function section(name){ console.log('\n' + name); }

// ---------- DOM stub for Three.js / texture generation ----------
const dom = new JSDOM('<!doctype html><html><body><canvas id="game"></canvas><div id="gameHud"></div><div id="menuRoot"></div><div id="pauseOverlay"></div><div id="resultOverlay"></div></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
try{ Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true }); }catch{}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame ? dom.window.requestAnimationFrame.bind(dom.window) : (cb => setTimeout(() => cb(Date.now()), 0));
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame ? dom.window.cancelAnimationFrame.bind(dom.window) : clearTimeout;
globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement;
globalThis.Image = dom.window.Image;
try{ Object.defineProperty(globalThis, 'self', { value: dom.window, configurable: true }); }catch{}

const gradient = { addColorStop(){} };
const fake2d = new Proxy({}, {
  get(target, prop){
    if(prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
    if(prop === 'measureText') return () => ({ width: 10 });
    if(prop === 'getImageData') return (x,y,w,h) => ({ data: new Uint8ClampedArray(w*h*4) });
    if(prop in target) return target[prop];
    return () => {};
  },
  set(target, prop, value){ target[prop] = value; return true; }
});
dom.window.HTMLCanvasElement.prototype.getContext = function(){ return fake2d; };
dom.window.HTMLCanvasElement.prototype.toDataURL = function(){ return ''; };

// ---------- maps + pathfinding ----------
section('Карты и поиск пути');
for(const info of MAP_INFO){
  const map = buildMap(info.id);
  ok(map.w > 10 && map.h > 10, `${info.name}: размер сетки ${map.w}×${map.h}`);
  ok(map.spawns.CT.length >= 5 && map.spawns.T.length >= 5, `${info.name}: списки спавнов`);
  ok(map.sites.length === 2, `${info.name}: две точки A/B`);
  for(const site of map.sites){
    ok(!isSolid(map, Math.floor(site.x/map.tile), Math.floor(site.z/map.tile)), `${info.name}: точка ${site.name} проходима`);
  }
  const s = map.spawns.CT[0], t = map.sites[0];
  const path = findPath(map, s.x, s.z, t.x, t.z);
  ok(path.length > 2, `${info.name}: путь от CT до A (${path.length} узлов)`);
  const open = path.every(p => !isSolid(map, Math.floor(p.x/map.tile), Math.floor(p.z/map.tile)));
  ok(open, `${info.name}: путь не проходит сквозь стены`);
}

// ---------- weapon data ----------
section('Новые карты и редактор');
try{
  ok(MAP_INFO.some(m=>m.id==='harbor') && MAP_INFO.some(m=>m.id==='office') && MAP_INFO.some(m=>m.id==='dust'), 'добавлены Порт, Офис и Пыльная Бухта');
  const grid = Array.from({length:24}, (_,y)=>Array.from({length:24}, (_,x)=>(x===0||y===0||x===23||y===23)?1:0));
  grid[10][10] = 1; grid[11][10] = 2; grid[12][10] = 3;
  const cm = buildCustomMap({ name:'Тест-арена', w:24, h:24, grid, theme:'harbor', light:'night',
    sites:[{name:'A',x:18,y:6},{name:'B',x:6,y:18}], spawns:{ CT:[{x:3,y:12}], T:[{x:20,y:12}] } });
  ok(cm.w===24 && cm.h===24, 'кастомная карта сохраняет размер');
  ok(cm.light==='night' && cm.info.name==='Тест-арена', 'кастомная карта сохраняет свет и имя');
  ok(cm.spawns.CT.length===1 && cm.spawns.T.length===1, 'кастомные спавны сохранены');
  ok(cm.sites.length===2 && cm.sites[0].name==='A', 'кастомные точки A/B сохранены');
  ok(isSolid(cm,0,0) && isSolid(cm,23,23), 'границы кастомной карты непроходимы');
  ok(!!cm.grid && cm.grid[10*cm.w+10]===1, 'кисти стен/ящиков записаны в сетку');
}catch(e){ ok(false, 'карты редактора: ' + e.message); }

section('Оружие и баланс');
const required = ['id','name','type','slot','price','dmg','headMult','fireDelay','mag','range'];
for(const id in WEAPONS){
  const w = WEAPONS[id];
  ok(required.every(k => w[k] !== undefined), `${w.name}: обязательные поля`);
  if(w.slot === 1 || w.slot === 2){
    ok(w.falloffStart < w.falloffEnd, `${w.name}: корректный falloff-диапазон`);
    ok((w.armorPen ?? 0) >= 0 && (w.armorPen ?? 0) <= 1, `${w.name}: бронепробитие 0..1`);
  }
}
ok(Object.keys(WEAPONS).length >= 19, `стволов в игре: ${Object.keys(WEAPONS).length}`);
ok(!!WEAPONS.mp9 && !!WEAPONS.mac10 && !!WEAPONS.ump45, 'новые ПП добавлены');
ok(Object.values(SKIN_STYLES).length >= 8, 'скины оружия доступны');
const skin = getSkin('ak47', 'ak47:crimson');
ok(skin && skin.styleKey === 'crimson' && skin.body, 'скин применяется к модели');
ok(defaultSkins().length > 15, 'стартовый инвентарь скинов заполнен');
for(const id in GRENADES){
  ok(GRENADES[id].radius > 0 && GRENADES[id].fuse > 0, `граната ${GRENADES[id].name}: параметры`);
}

section('3D-модели оружия');
const modelIds = Object.keys(WEAPONS).filter(id=>id !== 'grenade');
let signatures = new Set();
for(const id of modelIds){
  let g = null, err = null;
  try{ g = makeGunMesh(id, null, 'high'); }catch(e){ err = e; }
  ok(!err && !!g, `${WEAPONS[id].name}: модель собирается`);
  if(!g) continue;
  const parts = g.userData.parts || {};
  const box = new THREE.Box3().setFromObject(g);
  const size = box.getSize(new THREE.Vector3());
  ok(g.children.length >= 8 && g.userData.muzzle && g.userData.muzzle.position.z < -0.1, `${WEAPONS[id].name}: ствол и дульный узел`);
  if(id === 'glock' || id === 'usp' || id === 'p250' || id === 'deagle') ok(!!parts.slide, `${WEAPONS[id].name}: подвижный затвор`);
  if(id === 'awp' || id === 'ssg08') ok(!!parts.bolt, `${WEAPONS[id].name}: затворная группа`);
  if(!['knife','nova','xm1014','negev','m249'].includes(id)) ok(!!parts.mag, `${WEAPONS[id].name}: магазин`);
  if(id === 'nova' || id === 'xm1014') ok(!!parts.pump || !!parts.mag, `${WEAPONS[id].name}: помпа/трубчатый магазин`);
  signatures.add(`${g.children.length}:${Math.round(size.x*100)}:${Math.round(size.z*100)}:${g.userData.viewType}`);
}
ok(signatures.size >= 17, `уникальных силуэтов оружия: ${signatures.size}/${modelIds.length}`);

section('Агенты');
for(const team of ['CT','T']){
  ok(TEAM_AGENTS[team].length === 3, `${team}: три агента`);
  const ids = TEAM_AGENTS[team].map(a=>a.id);
  ok(new Set(ids).size === 3, `${team}: уникальные id`);
  ok(ids.every(id => getAgent(team,id).id === id) && agentAt(team,3).id === ids[0], `${team}: getAgent/agentAt`);
  const palKeys = ['cloth','cloth2','vest','helmet','accent','skin','mask','boots','glove','pack','visor','strap'];
  ok(TEAM_AGENTS[team].every(a=>palKeys.every(k=>typeof a.palette[k] === 'string')), `${team}: полные палитры`);
}
let charCrash = null;
try{
  const { createCharacter } = await import('../src/world/characters.js');
  for(const team of ['CT','T']){
    for(const id of AGENT_ORDER[team]){
      const ch = createCharacter(team, 'm4a1', null, id);
      ok(ch.agentId === id && ch.root && ch.parts && typeof ch.animate === 'function', `${team}/${id}: персонаж и API`);
      ch.animate(1/60, 4, 0.1, false, 8, { crouch:false, air:false, turn:0.2 });
      ch.playShoot(); ch.playReload(1.2); ch.playInspect(1);
      ch.animate(1/60, 0, 0, false, 8, { crouch:true });
    }
  }
}catch(e){ charCrash = e; }
ok(!charCrash, charCrash ? 'персонаж упал: ' + charCrash.message : 'все агенты анимируются без ошибок');

// damage math
const body = computeDamage(WEAPONS.ak47, 'chest', 10, 0, false);
const head = computeDamage(WEAPONS.ak47, 'head', 10, 0, false);
const armored = computeDamage(WEAPONS.ak47, 'chest', 10, 100, false);
const helmet = computeDamage(WEAPONS.ak47, 'head', 10, 100, true);
ok(head.dmg > body.dmg, 'выстрел в голову наносит больше урона');
ok(armored.dmg < body.dmg && armored.armorLoss > 0, 'броня снижает урон и тратится');
ok(helmet.dmg < head.dmg, 'шлем снижает урон в голову');
ok(damageFalloff(WEAPONS.awp, 20) > damageFalloff(WEAPONS.awp, 119), 'урон падает с дистанцией');
const hip = spreadFor(WEAPONS.ak47, { speed: 0, aiming:false, crouch:false, heat:0, shotIndex:0 });
const ads = spreadFor(WEAPONS.ak47, { speed: 0, aiming:true, crouch:false, heat:0, shotIndex:0 });
const moving = spreadFor(WEAPONS.ak47, { speed: 5, aiming:false, crouch:false, heat:1, shotIndex:3 });
ok(ads < hip, 'прицеливание уменьшает разброс');
ok(moving > hip, 'движение и нагрев увеличивают разброс');
const rc = recoilFor(WEAPONS.ak47, 5, () => 0.5);
ok(rc.pitch > 0, 'отдача подбрасывает прицел');
const zones = hitSpheresAt(0, 0, 0, 1);
ok(zones.length === Object.keys(HIT_ZONES).length && zones.some(z => z.zone === 'head'), 'зоны попадания: голова/корпус/живот/ноги');

// ---------- difficulty ----------
section('Сложность ботов');
let prevSkill = -1;
for(const id of DIFFICULTY_ORDER){
  const d = getDifficulty(id);
  ok(d.id === id && d.name && d.reaction[0] < d.reaction[1], `${d.name}: профиль и время реакции`);
  ok(d.aimError > 0 && d.sightRange > 0 && d.hearing > 0 && d.memory > 0, `${d.name}: восприятие`);
  ok(d.skill > prevSkill, `${d.name}: skill растёт по сложности`);
  prevSkill = d.skill;
}
ok(DIFFICULTIES.easy.aimError > DIFFICULTIES.expert.aimError, 'лёгкие боты менее точные, чем эксперты');

// ---------- full match smoke test ----------
section('Скины оружия');
for(const styleKey of Object.keys(SKIN_STYLES)){
  let err = null, g = null;
  try{ g = makeGunMesh('ak47', skinIdFor('ak47', styleKey), 'high'); }catch(e){ err = e; }
  ok(!err && !!g && g.children.length > 5, `скин ${styleKey}: модель и текстура собираются${err ? ' ('+err.message+')' : ''}`);
}

section('Интеграционный прогон матча');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 16/9, 0.08, 240);
const { HUD } = await import('../src/ui/hud.js');
const hud = new HUD();
const { Match } = await import('../src/game/match.js');
const match = new Match({
  scene, camera, hud, audio: null, mode: 'competitive', mapId: 'city',
  team: 'CT', teamSize: 3, difficulty: 'normal', roundsToWin: 5
});
ok(match.bots.length === 5, `боты созданы: ${match.bots.length}`);
ok(match.level.map.sites.length === 2, 'уровень собран');
const input = {
  look:{dx:0,dy:0}, move:{x:0,y:0}, run:false, crouch:false,
  jumpPressed:false, fire:false, firePressed:false, aim:false,
  reloadPressed:false, slotRequest:0, use:false
};
let crashed = null;
try{
  for(let i=0;i<1800;i++){
    input.move.y = (i % 240 < 120) ? -1 : 1;
    input.move.x = Math.sin(i/90) * 0.4;
    input.fire = (i % 90) > 65;
    input.firePressed = input.fire && ((i % 90) === 66);
    if(i % 300 === 0){ input.reloadPressed = true; }
    if(i % 600 === 0){ input.slotRequest = 1 + (i/600 % 3); }
    if(i === 1000 && match.bots.length){
      const b = match.bots.find(b => b.alive && b.team !== match.player.team);
      if(b){ match.player.x = b.pos.x + 3; match.player.z = b.pos.z + 3; }
    }
    match.update(1/60, input, 60);
    input.reloadPressed = false;
    input.slotRequest = 0;
  }
}catch(e){ crashed = e; }
ok(!crashed, crashed ? 'матч упал: ' + crashed.message : '1800 кадров (30 с) матча без исключений');
ok(Number.isFinite(match.clock) && match.score.CT + match.score.T >= 0, 'таймер и счёт остаются валидными');
ok(document.getElementById('hpText').textContent !== '', 'HUD: здоровье обновляется');
ok(document.getElementById('ammoMag').textContent !== '', 'HUD: патроны обновляются');
ok(document.getElementById('matchInfo').textContent.includes('Улицы Рейна'), 'HUD: режим/карта/сложность');
ok(document.getElementById('teamStatus').innerHTML.includes('ctdot'), 'HUD: счёт живых игроков');
ok(document.querySelectorAll('#allyList .allyRow').length === 2, 'HUD: маркеры союзников');
ok(document.querySelectorAll('#crosshair .ch').length === 5, 'HUD: перекрестие собрано');
const aimDir = match._lookDirWithSpread(0);
const camDir = camera.getWorldDirection(new THREE.Vector3());
ok(aimDir.distanceTo(camDir) < 0.001, 'нулевой разброс точно совпадает с камерой/прицелом');
ok(Number.isFinite(match.crosshairSpread()) && match.crosshairSpread() > 0, 'разброс прицела рассчитывается в пикселях');
ok(document.querySelectorAll('#tbtns .tbtn').length >= 9, 'HUD: мобильные кнопки (включая E/осмотр)');
ok(match.player.x !== 0 || match.player.z !== 0, 'игрок размещён на карте');
ok(match.effects.tracers.length >= 0 && match.level.walls, 'эффекты и геометрия уровня инициализированы');
const hasFindCover = match.level.findCover(match.player.x, match.player.z, match.bots[0].pos.x, match.bots[0].pos.z);
ok(hasFindCover && Number.isFinite(hasFindCover.x), 'поиск укрытия возвращает точку');
const standH = hitSpheresAt(0,0,0,1,1).find(z=>z.zone==='head').y;
const crouchH = hitSpheresAt(0,0,0,1,0.74).find(z=>z.zone==='head').y;
ok(crouchH < standH, 'хитбокс головы опускается при приседе');
let endResult = null;
match.onEnd = r => { endResult = r; };
try{ match.endMatch('CT'); }catch(e){ console.error(e); }
ok(endResult && endResult.win === true, 'итог матча содержит победу игрока');
ok(endResult && Number.isInteger(endResult.accuracy) && endResult.difficulty === 'normal', 'итог содержит точность/сложность/счёт');
ok(endResult && endResult.score && Number.isFinite(endResult.duration), 'итог содержит счёт и длительность');
try{ match.dispose(); ok(true, 'dispose() завершается без ошибок'); }
catch(e){ ok(false, 'dispose() упал: ' + e.message); }

// ---------- shop in non-round modes ----------
section('Магазин вне раундов');
try{
  const buyScene = new THREE.Scene();
  const buyCamera = new THREE.PerspectiveCamera(75, 16/9, 0.08, 240);
  const buyHud = new HUD();
  const dm = new Match({
    scene: buyScene, camera: buyCamera, hud: buyHud, audio: null,
    mode: 'training', mapId: 'city', team: 'CT', teamSize: 2, difficulty: 'easy'
  });
  dm.beginRound();
  dm.player.money = 5000;
  buyHud.openBuy(dm);
  const enabled = [...document.querySelectorAll('#buyMenu .buyItem:not([disabled])')].length;
  ok(enabled > 0, `в тренировке магазин доступен: ${enabled} товаров`);
  const akBtn = [...document.querySelectorAll('#buyMenu .buyItem')].find(b => b.dataset.item === 'ak47');
  if(akBtn) akBtn.click();
  ok(!!(dm.player.loadout[1] && dm.player.loadout[1].id === 'ak47'), 'покупка в тренировке применяется');
  buyHud.closeBuy();
  dm.dispose();
  ok(document.getElementById('buyMenu').classList.contains('hidden'), 'закрытие магазина скрывает панель');
}catch(e){ ok(false, 'магазин вне раундов упал: ' + e.message); }

// ---------- bomb objective ----------
section('Бомба и исход раунда');
try{
  const bombInput = {
    look:{dx:0,dy:0}, move:{x:0,y:0}, run:false, crouch:false,
    jumpPressed:false, fire:false, firePressed:false, aim:false,
    reloadPressed:false, slotRequest:0, use:false
  };
  const mkBombMatch = (team) => new Match({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(75, 16/9, 0.08, 240),
    hud: new HUD(), audio: null, mode: 'competitive', mapId: 'city',
    team, teamSize: 2, difficulty: 'easy', privateMatch: true
  });
  const tMatch = mkBombMatch('T');
  tMatch.beginRound(); tMatch.beginLive();
  const siteT = tMatch.level.map.sites[0];
  tMatch.player.x = siteT.x; tMatch.player.z = siteT.z; tMatch.player.y = 0;
  tMatch.bomb.carrier = tMatch.player; tMatch.bomb.state = 'carried';
  bombInput.use = true;
  for(let i=0;i<260;i++) tMatch.update(1/60, bombInput, 60);
  ok(tMatch.bomb.state === 'planted', `игрок-T устанавливает бомбу: ${tMatch.bomb.state}`);
  bombInput.use = false;
  tMatch.dispose();

  const ctMatch = mkBombMatch('CT');
  ctMatch.beginRound(); ctMatch.beginLive();
  const siteCT = ctMatch.level.map.sites[0];
  ctMatch.bomb = { state:'planted', carrier:null, x:siteCT.x, z:siteCT.z, timer:35, defuse:0, plant:0, site:siteCT, beepTimer:0 };
  ctMatch._makeBombMesh(siteCT.x, siteCT.z);
  ctMatch.player.x = siteCT.x + 1; ctMatch.player.z = siteCT.z; ctMatch.player.y = 0;
  bombInput.use = true;
  for(let i=0;i<500 && ctMatch.bomb.state !== 'defused'; i++) ctMatch.update(1/60, bombInput, 60);
  ok(ctMatch.bomb.state === 'defused' && ctMatch.score.CT === 1, 'спецназ обезвреживает бомбу и получает раунд');
  bombInput.use = false;
  ctMatch.dispose();

  const elim = mkBombMatch('CT');
  elim.beginRound(); elim.beginLive();
  const siteE = elim.level.map.sites[0];
  elim.bomb = { state:'planted', carrier:null, x:siteE.x, z:siteE.z, timer:30, defuse:0, plant:0, site:siteE, beepTimer:0 };
  for(const b of elim.bots) if(b.team === 'CT') b.alive = false;
  elim.player.alive = false; elim.player.health = 0;
  elim.update(1/60, bombInput, 60);
  ok(elim.phase === 'over' && elim.score.T === 1, 'после закладки уничтожение всех CT сразу завершает раунд');
  elim.dispose();
}catch(e){ ok(false, 'бомба: ' + e.message); }

// ---------- mod combat: wallbang + aimbot ----------
section('MOD: прострел и автонаводка');
try{
  const st = getState();
  const prev = { unlocked: st.settings.modUnlocked, cheats: { ...(st.settings.cheats || {}) } };
  st.settings.modUnlocked = true;
  st.settings.cheats = { ...prev.cheats, wallbang: true, aimbot: true };
  const m = new Match({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(75, 16/9, 0.08, 240),
    hud: new HUD(), audio: null, mode: 'training', mapId: 'city',
    team: 'CT', teamSize: 1, difficulty: 'easy', privateMatch: true
  });
  m.beginRound(); m.beginLive();
  m.player.x = 0; m.player.y = 0; m.player.z = 0; m.player.yaw = 0; m.player.pitch = 0;
  const target = m.bots.find(b => b.alive);
  target.pos.set(0, 0, -10); target.x = 0; target.y = 0; target.z = -10;
  target.health = 100; target.armor = 0; target.helmet = false;
  const realRaycast = m.level.raycast.bind(m.level);
  m.level.raycast = () => ({ hit:true, t:3, x:0, y:1.6, z:-3, side:0 });
  const eye = m.player.getEyePos(new THREE.Vector3());
  const dir = new THREE.Vector3(0, 0, -1);
  const hp0 = target.health;
  m._hitscan(m.player, eye, dir, WEAPONS.ak47, {});
  ok(target.health < hp0, 'прострел сквозь стену наносит урон');
  target.health = 100; target.alive = true;
  m.level.raycast = () => ({ hit:true, t:3, x:0, y:1.6, z:-3, side:0 });
  st.settings.cheats.wallbang = false;
  m._hitscan(m.player, eye, dir, WEAPONS.ak47, {});
  ok(target.health === 100, 'без мода стена блокирует пулю');
  m.level.raycast = realRaycast;

  st.settings.cheats.wallbang = true;
  m.camera.rotation.order = 'YXZ';
  m.camera.rotation.set(0.2, 0.5, 0);
  m.camera.updateMatrixWorld(true);
  m.player.yaw = 0.5; m.player.pitch = 0.2;
  m._updateAimAssist(1, true);
  ok(Math.abs(m.player.yaw) < 0.03 && Math.abs(m.player.pitch) < 0.03, 'автонаводка сводит прицел на цель');
  m.dispose();
  st.settings.modUnlocked = prev.unlocked;
  st.settings.cheats = prev.cheats;
}catch(e){ ok(false, 'MOD-прострел/автонаводка: ' + e.message); }

// ---------- skins / crates / inventory ----------
section('Скины, редкости и кейсы');
try{
  const { RARITIES, RARITY_ORDER, buildSkinCatalog, oddsFor, variantOf, rarityOf } = await import('../src/data/skins.js');
  const { CRATES, cratePool, crateOdds, openCrate, buildReel, crateById } = await import('../src/data/crates.js');
  const stateMod = await import('../src/core/state.js');
  ok(RARITY_ORDER.length === 6 && RARITY_ORDER.every(k=>RARITIES[k]), 'шесть редкостей с параметрами');
  ok(RARITY_ORDER.every(k => RARITIES[k].weight > 0), 'у всех редкостей положительный вес');
  ok(!!variantOf('crimson') && !!variantOf('nonexistent'), 'вариант скина с fallback');
  ok(rarityOf('crimson').id === 'rare', 'красный скин имеет редкость rare');
  const cat = buildSkinCatalog(WEAPONS);
  ok(cat.length > 200, `каталог скинов: ${cat.length} предметов`);
  ok(cat.every(s => s.id && s.weaponId && s.variantKey && s.rarityInfo), 'у каждого предмета есть id/оружие/вариант/редкость');
  ok(cat.every(s => s.name === `${WEAPONS[s.weaponId].name} | ${variantOf(s.variantKey).name}`), 'подписи скинов соответствуют оружию и варианту');
  const odds = oddsFor(cat);
  ok(odds.common >= odds.secret, 'обычные предметы выпадают чаще тайных');
  ok(Math.abs(Object.values(odds).reduce((a,b)=>a+b,0) - 100) < 0.5, 'сумма шансов каталога ≈ 100%');
  ok(CRATES.length === 5 && CRATES.every(c=>crateById(c.id) === c), 'пять кейсов доступны по id');
  for(const c of CRATES){
    const pool = cratePool(c.id);
    ok(pool.length > 0, `${c.name}: пул не пуст (${pool.length})`);
    const co = crateOdds(c.id);
    ok(Math.abs(Object.values(co).reduce((a,b)=>a+b,0) - 100) < 0.6, `${c.name}: шансы суммируются в 100%`);
    const winner = openCrate(c.id, () => 0.5);
    ok(winner && pool.some(p=>p.id === winner.id), `${c.name}: выпадает предмет из пула`);
    ok(!!winner.rarityInfo && !!winner.weaponName, `${c.name}: у выпавшего предмета есть редкость и имя`);
  }
  const secretOdds = crateOdds('secret');
  const starterOdds = crateOdds('starter');
  ok((secretOdds.secret || 0) > (starterOdds.secret || 0), 'тайный кейс чаще даёт secret-предметы');
  const winner = openCrate('starter', () => 0.5);
  const reel = buildReel('starter', winner.id, 30, () => 0.5);
  ok(reel.items.length === 30 && reel.index > 0 && reel.index < 30, 'лента кейса собирается вокруг выигрыша');
  ok(reel.items[reel.index].id === winner.id, 'выигрыш стоит в ленте на своём месте');

  const st = stateMod.getState();
  const before = { tokens: st.profile.crateTokens, cases: st.profile.casesOpened, owned: st.inventory.owned.length };
  const fresh = cat.find(s => !st.inventory.owned.includes(s.id));
  ok(!!fresh, 'найден ещё не полученный скин для проверки');
  stateMod.addCrateTokens(3);
  ok(stateMod.crateTokens() === before.tokens + 3, 'жетоны кейсов начисляются');
  ok(stateMod.spendCrateTokens(2) && stateMod.crateTokens() === before.tokens + 1, 'жетоны списываются');
  ok(!stateMod.spendCrateTokens(999), 'нельзя списать больше, чем есть');
  const grant = stateMod.grantSkin(fresh.id);
  ok(grant.ok && !grant.duplicate && st.inventory.owned.includes(fresh.id), 'скин добавляется в инвентарь');
  ok(st.inventory.history && st.inventory.history[0].id === fresh.id, 'история получения скина обновляется');
  const dup = stateMod.grantSkin(fresh.id);
  ok(dup.ok && dup.duplicate, 'повторный скин помечается дубликатом');
  const rec = stateMod.recordCaseOpen('starter', 'm4a4:jade', 'legendary');
  ok(rec.ok && st.profile.casesOpened === before.cases + 1, 'открытие кейса учитывается в профиле');
  ok(st.inventory.history[0].crateId === 'starter', 'история хранит кейс и редкость');
  const fresh2 = cat.find(s => !st.inventory.owned.includes(s.id));
  if(fresh2){
    stateMod.recordCaseOpen('starter', fresh2.id, 'rare');
    const entries = st.inventory.history.filter(h => h.id === fresh2.id);
    ok(entries.length === 1 && entries[0].crateId === 'starter', 'новый дроп кейса попадает в историю один раз');
  } else {
    ok(false, 'не найден второй неполученный скин для проверки истории');
  }
  st.inventory.equipped = st.inventory.equipped || {};
  st.inventory.equipped[fresh.weaponId] = fresh.id;
  stateMod.unequipSkin(fresh.weaponId);
  ok(!st.inventory.equipped[fresh.weaponId], 'скин снимается с оружия');
  const dailyTokens = st.profile.crateTokens || 0;
  const dailyFirst = stateMod.claimDaily('2099-01-01');
  const dailySecond = stateMod.claimDaily('2099-01-01');
  ok(dailyFirst === true && dailySecond === false && (st.profile.crateTokens || 0) === dailyTokens + 2, 'ежедневная награда = 2 жетона (один доступный кейс), повторно не выдаётся');
  const profileSnap = { ...st.profile };
  const trainTokens = st.profile.crateTokens || 0;
  stateMod.recordMatch({ win:true, mode:'training', kills:10, deaths:0, headshots:1, duration:60, shotsFired:20, shotsHit:12, damage:900 });
  ok((st.profile.crateTokens || 0) === trainTokens + 3, 'тренировка 10+ убийств: жетон за матч, победу и задание');
  Object.assign(st.profile, profileSnap);
  stateMod.saveState();

  const { ModelPreview } = await import('../src/ui/preview3d.js');
  const preview = new ModelPreview();
  ok(typeof preview.showWeapon === 'function' && typeof preview.showAgent === 'function' && typeof preview.close === 'function', '3D-предпросмотр имеет API');
  preview.showWeapon('ak47', 'ak47:crimson');
  const overlay = document.querySelector('.previewOverlay');
  ok(!!overlay && /Багров/i.test(overlay.textContent) && !!overlay.querySelector('.previewStage'), 'оверлей предпросмотра открывается с оружием');
  preview.close();
  ok(!document.querySelector('.previewOverlay'), 'предпросмотр закрывается');

  st.profile.crateTokens = before.tokens;
  st.profile.casesOpened = before.cases;
  st.inventory.owned.length = before.owned;
  delete st.inventory.equipped[fresh.weaponId];
}catch(e){ ok(false, 'скины/кейсы: ' + e.message); }

// ---------- menu UI smoke test ----------
section('Меню REBORN');
let startedCfg = null, changedSettings = null;
let menuCrash = null;
try{
  const { Menu } = await import('../src/ui/menu.js');
  const menu = new Menu({
    onStart: cfg => { startedCfg = cfg; },
    onSettingsChanged: s => { changedSettings = s; }
  });
  ok(!!menu.root.querySelector('.menuShell'), 'меню собирается');
  ok(menu.root.querySelector('.logoText b').textContent === 'STANDOFF', 'брендинг STANDOFF');
  ok(/REFORGED/.test(menu.root.querySelector('.logoText i').textContent), 'подзаголовок REBORN');

  menu.go('play');
  ok(menu.root.querySelectorAll('[data-diff]').length === 4, '4 карточки сложности');
  ok(menu.root.querySelectorAll('[data-teamsize]').length === 8, 'выбор размера команды 1v1..8v8');
  ok(menu.root.querySelectorAll('[data-rounds]').length === 4, 'выбор побед до для Competitive');
  menu.root.querySelector('[data-diff="hard"]').click();
  menu.root.querySelector('[data-teamsize="4"]').click();
  menu.root.querySelector('[data-rounds="8"]').click();
  menu.root.querySelector('#startMatch').click();
  ok(startedCfg && startedCfg.difficulty === 'hard' && startedCfg.teamSize === 4 && startedCfg.roundsToWin === 8, 'старт получает выбранную конфигурацию');

  menu.go('play');
  menu.root.querySelector('[data-mode="deathmatch"]').click();
  ok(menu.root.querySelectorAll('[data-minutes]').length === 4, 'для DM доступен выбор длительности');
  ok(menu.root.querySelectorAll('[data-rounds]').length === 0, 'для DM нет выбора раундов');

  menu.go('agents');
  ok(menu.root.querySelectorAll('[data-agent]').length === 6, 'экран агентов: 6 карточек');
  const beforeAgent = getState().selectedAgents.T;
  menu.root.querySelector('[data-agent="nomad"]').click();
  ok(getState().selectedAgents.T === 'nomad', 'выбор агента сохраняется');
  getState().selectedAgents.T = beforeAgent;
  menu.go('arsenal');
  ok([...menu.root.querySelectorAll('[data-acat]')].some(e => e.dataset.acat === 'smgs'), 'в арсенале есть категория ПП');
  menu.root.querySelector('[data-acat="smgs"]').click();
  ok(menu.root.querySelectorAll('.wcard').length === 9, 'в категории ПП девять стволов');

  menu.go('editor');
  ok(!!menu.root.querySelector('#mapEditor') && menu.root.querySelectorAll('[data-etool]').length === 8, 'редактор карт открывается');
  menu.root.querySelector('#editorSave').click();
  ok((menu.customMaps || []).length >= 1, 'карта сохраняется из редактора');
  menu.go('play');
  ok([...menu.root.querySelectorAll('[data-map]')].some(e => e.dataset.map.indexOf('custom:') === 0), 'сохранённая карта появляется в списке');
  getState().settings.modUnlocked = false;
  menu.go('mods');
  ok(getState().settings.modUnlocked === true && !!menu.root.querySelector('.modBanner'), 'MOD MENU открывается без кода');
  getState().settings.modUnlocked = false;

  menu.go('account');
  ok(menu.root.querySelectorAll('.authCard').length === 2, 'экран аккаунта: вход и регистрация');
  ok(!!menu.root.querySelector('#loginUser') && !!menu.root.querySelector('#regPass'), 'поля логина и пароля присутствуют');

  menu.go('settings');
  ok(!!menu.root.querySelector('[data-set="particles"]'), 'настройка частиц');
  ok(!!menu.root.querySelector('[data-set="dynamicResolution"]'), 'настройка динамического разрешения');
  ok(!!menu.root.querySelector('[data-set="damageDirections"]'), 'настройка индикаторов урона');
  ok(!!menu.root.querySelector('[data-set="touchScale"]') && !!menu.root.querySelector('[data-set="touchOpacity"]'), 'настройки размера/прозрачности touch');
  const ts = menu.root.querySelector('[data-set="touchScale"]');
  ts.value = '1.2'; ts.dispatchEvent(new dom.window.Event('change'));
  ok(Math.abs(getState().settings.touchScale - 1.2) < 0.001, 'масштаб touch применяется');
  const particles = menu.root.querySelector('[data-set="particles"]');
  particles.checked = false;
  particles.dispatchEvent(new dom.window.Event('change', { bubbles:true }));
  ok(changedSettings && changedSettings.particles === false, 'изменение настроек применяется');

  for(const screen of ['inventory','profile','home','cases','controls']){
    menu.go(screen);
    ok(menu.root.querySelectorAll('.navBtn').length === 11, `экран ${screen} отрисован`);
  }

  // inventory filters must survive a re-render (regression: state was only
  // applied on input events, so every tab switch reset the visible list)
  menu.go('inventory');
  menu.root.querySelector('[data-invtab="skins"]').click();
  const totalSkins = menu.root.querySelectorAll('.skinCard').length;
  const visibleSkins = () => [...menu.root.querySelectorAll('.skinCard')].filter(e => !e.classList.contains('invHidden')).length;
  const invSearch = menu.root.querySelector('#invSearch');
  invSearch.value = 'AK-47';
  invSearch.dispatchEvent(new dom.window.Event('input', { bubbles:true }));
  ok(visibleSkins() > 0 && visibleSkins() < totalSkins, 'поиск по инвентарю фильтрует скины сразу');
  menu.root.querySelector('[data-invtab="weapons"]').click();
  menu.root.querySelector('[data-invtab="skins"]').click();
  ok(visibleSkins() > 0 && visibleSkins() < totalSkins, 'фильтр инвентаря сохраняется после перерисовки');
  menu.go('inventory');
  menu.root.querySelector('[data-invtab="weapons"]').click();
  menu.root.querySelector('[data-invweapon="ak47"]').click();
  ok(menu.invTab === 'skins' && visibleSkins() > 0 && visibleSkins() < totalSkins, 'кнопка «СКИНЫ» у оружия открывает отфильтрованный список');
  menu.arsenalCat = 'rifles';
  menu.go('arsenal');
  const arsenalMore = menu.root.querySelector('[data-invweapon="ak47"]');
  ok(!!arsenalMore, 'в арсенале есть переход к полному списку скинов');
  if(arsenalMore) arsenalMore.click();
  ok(menu.screen === 'inventory' && menu.invTab === 'skins', 'переход «ВСЕ СКИНЫ» из арсенала открывает инвентарь');
  menu.invSearch = ''; menu.invRarity = 'all'; menu.invSort = 'weapon';
  menu.render();
  const weaponOrder = [...menu.root.querySelectorAll('.skinCard')].map(e => e.dataset.weapon || '');
  ok(weaponOrder.length > 0 && weaponOrder.join('|') === [...weaponOrder].sort().join('|'), 'сортировка по оружию применяется после перерисовки');
  menu.invRarity = 'secret'; menu.invSort = 'rarity'; menu.render();
  const secretCards = [...menu.root.querySelectorAll('.skinCard:not(.invHidden)')];
  ok(secretCards.length > 0 && secretCards.every(e => e.dataset.rarity === 'secret'), 'фильтр по редкости применяется после перерисовки');
  menu.invRarity = 'all';
}catch(e){ menuCrash = e; }
ok(!menuCrash, menuCrash ? 'меню упало: ' + menuCrash.message : 'все экраны меню проходят smoke-test');

// ---------- accounts ----------
section('Аккаунты');
try{
  const mem = new Map();
  globalThis.localStorage = {
    getItem: k => mem.has(k) ? mem.get(k) : null,
    setItem: (k,v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
    clear: () => mem.clear()
  };
  const acc = await import('../src/core/accounts.js');
  const uname = 'Test_' + Date.now().toString(36);
  const pass = 'Secret123';
  const badUser = acc.validateUsername('ab');
  ok(!!badUser, 'короткий логин отклоняется');
  const badPass = acc.validatePassword('abcdef');
  ok(!!badPass, 'пароль без цифр отклоняется');
  const r1 = await acc.register({ username:uname, password:pass, confirm:pass, displayName:'Тестер' });
  ok(r1.ok, 'регистрация создаёт аккаунт');
  ok(acc.currentSession() && acc.currentSession().account.username === uname, 'сессия создаётся после регистрации');
  const dup = await acc.register({ username:uname.toUpperCase(), password:pass, confirm:pass, displayName:'Дубль' });
  ok(!dup.ok, 'повторный логин отклоняется');
  acc.logout();
  ok(!acc.currentSession(), 'выход очищает сессию');
  const wrong = await acc.login({ username:uname, password:'Wrong123' });
  ok(!wrong.ok, 'неверный пароль отклоняется');
  const r2 = await acc.login({ username:uname.toLowerCase(), password:pass });
  ok(r2.ok && acc.currentSession(), 'вход восстанавливает сессию');
  const restored = acc.restoreSession();
  ok(restored && restored.username === uname, 'restoreSession возвращает аккаунт');
  // Cross-check the pure-JS fallback against WebCrypto: register without
  // subtle, then log in with subtle using the stored iteration count.
  const realCrypto = globalThis.crypto;
  const cryptoDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value:{ getRandomValues: a => realCrypto.getRandomValues(a) }, configurable:true });
  const fbName = 'Fallback_' + Date.now().toString(36);
  const fb = await acc.register({ username:fbName, password:'Fallback123', confirm:'Fallback123', displayName:'FB' });
  acc.logout();
  if(cryptoDesc) Object.defineProperty(globalThis, 'crypto', cryptoDesc);
  else globalThis.crypto = realCrypto;
  const fbLogin = await acc.login({ username:fbName, password:'Fallback123' });
  ok(fb.ok && fbLogin.ok, 'PBKDF2 fallback совместим с WebCrypto');
  const { Menu } = await import('../src/ui/menu.js');
  const m2 = new Menu({});
  m2.go('account');
  ok(!!m2.root.querySelector('.authCard.signed'), 'меню показывает активную сессию');
  m2.root.querySelector('#accLogout').click();
  ok(!acc.currentSession(), 'кнопка выхода завершает сессию');
}catch(e){ ok(false, 'аккаунты: ' + e.message); }

section('Mobile 6 regression');
{
 const def={dmg:100,armorPen:0,headMult:4};
 const no=computeDamage(def,'chest',0,0,false), low=computeDamage(def,'chest',0,1,false), full=computeDamage(def,'chest',0,100,false);
 ok(low.dmg>full.dmg && low.dmg<no.dmg && low.armorLoss===1,'остаток брони ограничивает поглощённый урон');
 const {Input}=await import('../src/core/input.js'); const input=new Input(); input.attach(document.getElementById('game')); input.setEnabled(true);
 const button=document.getElementById('tSwitch');
 button.onpointerdown({pointerId:99,preventDefault(){},stopPropagation(){}});
 ok(input.slotCycle===1,'сенсорная кнопка переключает следующий доступный слот');
 input._touchJump=true;input.jumpHeld=true;input.sample();ok(input.jumpHeld,'сенсорный прыжок сохраняется при опросе');
 input.setEnabled(false);ok(!input.jumpHeld && !input._touchJump && !input.fire,'пауза сбрасывает удержания');
}

console.log(`\nИтог: ${passed} passed, ${failed} failed`);
if(failed) process.exit(1);
