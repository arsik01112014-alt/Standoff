import { createCharacter } from '../world/characters.js';
// Match / round / economy / combat orchestrator.
import * as THREE from '../../vendor/three.module.js';
import { Level } from '../world/level.js';
import { Effects, getFlashTexture } from '../world/effects.js';
import { Player } from '../entities/player.js';
import { Bot } from '../entities/bot.js';
import { makeGunMesh } from '../world/guns.js';
import { buildMap, buildCustomMap } from '../data/maps.js';
import { WEAPONS, GRENADES } from '../data/weapons.js';
import { getDifficulty } from '../data/difficulty.js';
import { agentAt, getAgent } from '../data/agents.js';
import { getState, equippedSkin } from '../core/state.js';
import { clamp } from '../core/utils.js';
import { computeDamage, spreadFor, recoilFor, hitSpheresAt } from './combat.js';

export const MODES = {
  competitive: { label:'Competitive 5v5', short:'COMPETITIVE', teamSize:5, roundMode:true, roundTime:115, buyTime:15, overTime:4, scoreTo:13, startMoney:800, respawn:false, ffa:false },
  casual:      { label:'Casual 5v5',      short:'CASUAL',      teamSize:5, roundMode:true, roundTime:100, buyTime:12, overTime:4, scoreTo:8,  startMoney:800, respawn:false, ffa:false },
  deathmatch:  { label:'Deathmatch',      short:'DEATHMATCH',  teamSize:6, roundMode:false, matchTime:480, scoreTo:40, startMoney:6000, respawn:3, ffa:true },
  tdm:         { label:'Team Deathmatch',  short:'TDM',         teamSize:6, roundMode:false, matchTime:480, scoreTo:75, startMoney:6000, respawn:3, ffa:false },
  training:    { label:'Тренировка',       short:'TRAINING',    teamSize:4, roundMode:false, matchTime:0, scoreTo:0, startMoney:9000, respawn:2, ffa:true }
};

const T_SITE_NAMES = ['A','B'];
const BOT_NAMES = ['Viper','Ghost','Rook','Falcon','Nomad','Snake','Wolf','Raven','Tango','Echo','Reaper','Sable','Mako','Onyx','Vandal','Wraith','Havoc','Zulu','Bravo','Kilo'];

export class Match {
  constructor(opts){
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.hud = opts.hud;
    this.audio = opts.audio;
    this.mode = opts.mode || 'competitive';
    this.privateMatch = !!opts.privateMatch;
    this.modAllowed = this.privateMatch || this.mode === 'training' || !(MODES[this.mode] && MODES[this.mode].roundMode);
    this.customMap = opts.customMap || null;
    const base = MODES[this.mode] || MODES.competitive;
    this.cfg = { ...base };
    this.ffa = !!base.ffa;
    this.roundMode = !!base.roundMode;
    this.teamSize = clamp(opts.teamSize || base.teamSize, 1, 8);
    this.playerTeam = opts.team || 'CT';
    this.difficultyId = opts.difficulty || getState().settings.botDifficulty || 'normal';
    this.difficulty = getDifficulty(this.difficultyId);
    const selAgents = opts.agents || getState().selectedAgents || {};
    this.agents = {
      CT: getAgent('CT', selAgents.CT).id,
      T: getAgent('T', selAgents.T).id
    };
    this.onExit = opts.onExit || (()=>{});
    this.onEnd = opts.onEnd || (()=>{});
    this.paused = false;
    this.buyPause = false;

    if(opts.roundsToWin) this.cfg.scoreTo = clamp(opts.roundsToWin, 1, 30);
    if(!this.roundMode){
      const minutes = clamp(opts.matchMinutes || 8, 1, 30);
      this.cfg.matchTime = minutes * 60;
    }
    this.matchMinutes = this.roundMode ? 0 : Math.round((this.cfg.matchTime||0)/60);

    const settings = getState().settings;
    this.settings = settings;

    const mapData = this.customMap ? buildCustomMap(this.customMap) : buildMap(opts.mapId || 'city');
    this.level = new Level(mapData, this.scene, settings.quality, {
      shadows: settings.shadows,
      particles: settings.particles,
      viewDistance: settings.viewDistance,
      textureQuality: settings.textureQuality
    });
    this.effects = new Effects(this.scene);

    this.scene.add(this.camera);
    this.player = new Player(this.playerTeam, this.camera, getState().profile.name);
    this.player.agentId = this.agents[this.playerTeam];
    this.player.money = this.cfg.startMoney;
    this.player.sens = settings.sensitivity;
    this.player.invertY = settings.invertY;
    this.player.onFootstep = (vol)=>{ if(this.audio) this.audio.footstep(vol); };
    this.player.onLand = (v)=>{ if(this.audio && v > 5) this.audio.footstep(1.1); };

    this.bots = [];
    this._spawnBots();

    this.score = { CT:0, T:0 };
    this.round = 0;
    this.clock = 0;
    this.phase = 'buy';
    this.bomb = { state:'carried', carrier:null, x:0, z:0, timer:0, defuse:0, plant:0, site:null, beepTimer:0 };
    this.grenadesLive = [];
    this.fireZones = [];
    this.pickups = [];
    this.pickupHint = null;
    this.playerFlash = 0;
    this.playerZoom = 0;
    this.playerRespawnTimer = 0;
    this.spreadHeat = 0;
    this.fireTimer = 0;
    this.grenadeTimer = 0;
    this.shotIndex = 0;
    this.lastShotAt = -10;
    this.reload = { active:false, timer:0, slot:0, total:1 };
    this.viewKick = 0;
    this.vmFlash = 0;
    this.vmKick = 0;
    this.vmAction = 0;
    this.inspectT = 0;
    this.inspectTotal = 1;
    this.matchTimer = this.cfg.matchTime || 0;
    this.ended = false;
    this.roundResultTimer = 0;
    this.lossStreak = { CT:0, T:0 };
    this.stats = { shotsFired:0, shotsHit:0, damage:0, headshots:0 };
    this.flashCooldown = 0;
    this._lastCountdown = 99;
    this._lastFrameNow = performance.now();
    this.spectate = { active:false, free:false, index:0, target:null, pos:new THREE.Vector3(), yaw:0, pitch:0 };
    this.freeCam = null;
    this._modWarned = false;
    this.debugInfo = '';

    this._setupViewmodel();
    this.beginRound();
  }

  // ---------------- setup ----------------
  _spawnBots(){
    let n = 0;
    for(const team of ['CT','T']){
      const count = this.teamSize - (team === this.playerTeam ? 1 : 0);
      for(let i=0;i<count;i++){
        const name = BOT_NAMES[n % BOT_NAMES.length] + (n >= BOT_NAMES.length ? '_'+(n+1) : '');
        const bot = new Bot({
          team, name,
          level: this.level, match: this, difficulty: this.difficultyId,
          weaponId: team === 'CT' ? 'usp' : 'glock',
          agentId: agentAt(team, i + (team === this.playerTeam ? 1 : 0)).id
        });
        // a little individual variation inside the chosen difficulty
        bot.skill = clamp(bot.skill + (Math.random()-0.5)*0.10, 0.05, 0.98);
        bot.siteIndex = i % 2;
        bot.role = ['entry','support','anchor','lurker'][i % 4];
        bot.money = this.cfg.startMoney;
        bot.respawnTimer = 0;
        bot.blind = 0;
        this.bots.push(bot);
        n++;
      }
    }
  }

  _setupViewmodel(){
    this.viewGroup = new THREE.Group();
    this.camera.add(this.viewGroup);
    this.vm = null;
    this.hands = null;
    this._vmMaterials = [];
    this._handMaterials = [];
    this.vmMuzzleLight = new THREE.PointLight(0xffb060, 0, 6, 2);
    this.vmMuzzleLight.position.set(0.2, 0.0, -0.8);
    this.camera.add(this.vmMuzzleLight);
    this._buildHands();
    this._rebuildViewmodel();
  }

  _mat(color, rough=0.7, metal=0.1){
    const m = new THREE.MeshStandardMaterial({ color:new THREE.Color(color), roughness:rough, metalness:metal });
    this._vmMaterials.push(m);
    return m;
  }

  _buildHands(){
    this.hands = new THREE.Group();
    this.hands.visible = true;
    const glove = this._mat('#1b222c', 0.86, 0.05);
    const gloveAccent = this._mat('#2d3a48', 0.8, 0.08);
    const sleeve = this._mat(this.playerTeam === 'CT' ? '#2a3a52' : '#5a4a2e', 0.92, 0.02);
    const skin = this._mat(this.playerTeam === 'CT' ? '#c8a07a' : '#b98a5a', 0.8, 0.02);
    const mk = (w,h,d, mat, x,y,z, rx=0,ry=0,rz=0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
      m.position.set(x,y,z); m.rotation.set(rx,ry,rz);
      m.castShadow = false; m.receiveShadow = false;
      this.hands.add(m);
      return m;
    };
    // right hand + forearm (weapon-side)
    this.handR = new THREE.Group();
    mk(0.10,0.115,0.15, glove, 0,0,0);
    mk(0.108,0.03,0.16, gloveAccent, 0,-0.05,0.005);
    mk(0.065,0.085,0.06, skin, 0,0.075,-0.035);
    mk(0.115,0.12,0.34, sleeve, 0,-0.05,0.23, -0.28,0,0);
    this.handR.add(...this.hands.children.splice(-4));
    this.hands.add(this.handR);
    // left support hand + forearm
    this.handL = new THREE.Group();
    mk(0.105,0.10,0.16, glove, 0,0,0);
    mk(0.11,0.03,0.17, gloveAccent, 0,0.05,-0.01);
    mk(0.065,0.08,0.06, skin, 0,0.06,-0.04);
    mk(0.12,0.12,0.36, sleeve, 0,-0.04,0.24, -0.35,0,0);
    this.handL.add(...this.hands.children.splice(-4));
    this.hands.add(this.handL);
    this.viewGroup.add(this.hands);
  }

  _handPose(type){
    const R = this.handR, L = this.handL;
    if(!R || !L) return;
    R.visible = true; L.visible = true;
    if(type === 'pistol' || type === 'pistol_big'){
      R.position.set(0.035, -0.15, 0.02); R.rotation.set(-0.12, 0, -0.04);
      L.position.set(-0.065, -0.17, 0.01); L.rotation.set(-0.15, 0.25, 0.18);
    } else if(type === 'knife'){
      R.position.set(0.07, -0.16, 0.06); R.rotation.set(-0.2, -0.25, -0.2);
      L.visible = false;
    } else if(type === 'sniper' || type === 'sniper_scout'){
      R.position.set(0.03, -0.14, 0.10); R.rotation.set(-0.12, 0, -0.03);
      L.position.set(-0.06, -0.18, -0.28); L.rotation.set(-0.18, 0.18, 0.15);
    } else if(type === 'lmg'){
      R.position.set(0.04, -0.16, 0.06); R.rotation.set(-0.12, 0, -0.03);
      L.position.set(-0.05, -0.2, -0.34); L.rotation.set(-0.2, 0.15, 0.12);
    } else if(type === 'shotgun' || type === 'shotgun_semi'){
      R.position.set(0.04, -0.15, 0.05); R.rotation.set(-0.12, 0, -0.03);
      L.position.set(-0.045, -0.2, -0.33); L.rotation.set(-0.22, 0.12, 0.12);
    } else if(type === 'smg'){
      R.position.set(0.04, -0.15, 0.05); R.rotation.set(-0.12, 0, -0.03);
      L.position.set(-0.055, -0.18, -0.25); L.rotation.set(-0.18, 0.16, 0.14);
    } else {
      R.position.set(0.035, -0.15, 0.06); R.rotation.set(-0.12, 0, -0.03);
      L.position.set(-0.055, -0.19, -0.31); L.rotation.set(-0.2, 0.14, 0.12);
    }
  }

  _rebuildViewmodel(){
    if(this.vmFlashSprite){ this.vmFlashSprite.material.dispose(); this.vmFlashSprite = null; }
    if(this.vm){ this.viewGroup.remove(this.vm); }
    const w = this.player.getActiveWeapon();
    let id = 'knife';
    let skin = null;
    if(w){
      if(w.id === 'grenade'){ id = 'knife'; }
      else { id = w.id; skin = equippedSkin(w.id); }
    }
    this.vm = makeGunMesh(id, skin);
    this.vm.scale.setScalar(1.0);
    this.viewGroup.add(this.vm);
    this.vmType = this.vm.userData.viewType;
    if(this.vm.userData.muzzle && id !== 'knife'){
      const fmat = new THREE.SpriteMaterial({ map:getFlashTexture(), color:0xffd27a, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false });
      const fs = new THREE.Sprite(fmat);
      fs.scale.setScalar(0.22);
      this.vm.userData.muzzle.add(fs);
      this.vmFlashSprite = fs;
    }
    this._handPose(this.vmType);
    this._alignHandsToGrip(id);
    this.hands.visible = this.vm !== null;
    this._vmBase(id);
  }

  _alignHandsToGrip(id){
    const parts = this.vm && this.vm.userData ? this.vm.userData.parts : null;
    if(!parts || !this.handR || !this.handL) return;
    const grip = parts.grip;
    const fore = parts.foregrip;
    const R = this.handR, L = this.handL;
    if(grip){
      R.position.set(grip.position.x + 0.012, grip.position.y - 0.012, grip.position.z + 0.022);
      R.rotation.set(-0.14, 0, -0.03);
    }
    if(this.vmType === 'knife'){ L.visible = false; return; }
    L.visible = true;
    if(fore){
      L.position.set(fore.position.x - 0.005, fore.position.y + 0.005, fore.position.z + 0.015);
      L.rotation.set(-0.2, 0.12, 0.12);
    } else if(this.vmType === 'pistol' || this.vmType === 'pistol_big'){
      const g = grip ? grip.position : new THREE.Vector3(0,-0.12,0.03);
      L.position.set(g.x - 0.045, g.y + 0.008, g.z - 0.045);
      L.rotation.set(-0.26, 0.34, 0.34);
    } else if(grip){
      L.position.set(grip.position.x - 0.045, grip.position.y + 0.02, grip.position.z - 0.16);
      L.rotation.set(-0.2, 0.14, 0.12);
    }
  }

  _vmBase(id){
    const t = this.vmType;
    let x=0.18, y=-0.20, z=-0.42;
    if(t === 'pistol'){ x=0.16; y=-0.18; z=-0.34; }
    else if(t === 'pistol_big'){ x=0.17; y=-0.19; z=-0.36; }
    else if(t === 'rifle_ak' || t === 'rifle_m4' || t === 'rifle_famas' || t === 'rifle_aug'){ x=0.17; y=-0.21; z=-0.44; }
    else if(t === 'smg'){ x=0.17; y=-0.20; z=-0.38; }
    else if(t === 'sniper' || t === 'sniper_scout'){ x=0.16; y=-0.20; z=-0.40; }
    else if(t === 'lmg'){ x=0.18; y=-0.23; z=-0.46; }
    else if(t === 'shotgun' || t === 'shotgun_semi'){ x=0.17; y=-0.21; z=-0.42; }
    else if(t === 'knife'){ x=0.20; y=-0.22; z=-0.30; }
    this.vmBase = new THREE.Vector3(x,y,z);
    this.viewGroup.position.copy(this.vmBase);
    this.viewGroup.rotation.set(0,0,0);
  }

  // ---------------- rounds ----------------
  beginRound(){
    this.round++;
    this.phase = 'buy';
    this.clock = this.cfg.buyTime || 0;
    this._clearBombMesh();
    this.bomb = { state:'carried', carrier:null, x:0, z:0, timer:0, defuse:0, plant:0, site:null, beepTimer:0 };
    this.player.alive = true;
    this.player.health = 100;
    this.player.y = 0; this.player.vy = 0; this.player.pitch = 0;
    this.player.deathT = 0;
    this.player.recoilPitch = 0; this.player.recoilYaw = 0;
    this.player.frozen = true;
    this.player.refillAmmo();
    const sp = this.level.getSpawn(this.playerTeam, 0);
    this.player.x = sp.x; this.player.z = sp.z; this.player.yaw = sp.ang;
    this.player.eyeH = 1.62;
    this.player.moveVelX = 0; this.player.moveVelZ = 0;
    this.playerRespawnTimer = 0;
    this.reload.active = false;
    this.inspectT = 0;
    this.spreadHeat = 0;
    this.shotIndex = 0;
    this._rebuildViewmodel();

    for(const b of this.bots){
      const idx = this.bots.filter(x=>x.team===b.team).indexOf(b) + 1;
      const s = this.level.getSpawn(b.team, idx);
      b.spawnAt(s.x, s.z, s.ang);
      b.frozen = true;
      b._routeTarget = null;
      b._routeRound = -1;
      b._defend = null;
      b._escort = null;
      this._botBuy(b);
    }
    // Vary site splits and approach points every round. A deterministic
    // i%2 assignment made every bot take the exact same route each round.
    for(const team of ['CT','T']){
      const list = this.bots.filter(b=>b.team===team);
      const order = list.map((_,i)=>i).sort(()=>Math.random()-0.5);
      const half = Math.ceil(order.length/2);
      for(let n=0;n<order.length;n++){
        const b = list[order[n]];
        let site = n < half ? 0 : 1;
        if(b.role === 'lurker' && Math.random() < 0.48) site = 1-site;
        if(team === 'CT' && b.role === 'anchor') site = n % 2;
        if(team === 'T' && b.role === 'support' && Math.random() < 0.4) site = n % 2;
        b.siteIndex = site;
        const sites = this.level.map.sites;
        const anchor = sites[site % sites.length];
        if(anchor) b._routeTarget = this.level.openPointNear(anchor.x, anchor.z, b.role === 'anchor' ? 3.2 : 6.5);
        b._routeRound = this.round;
      }
    }
    // bomb carrier: prefer a T player with a reasonable chance
    const tAlive = this._teamEntities('T').filter(e=>e.alive);
    if(tAlive.length){
      const playerT = this.player.team === 'T' && this.player.alive;
      this.bomb.carrier = (playerT && Math.random() < 0.4) ? this.player : tAlive[Math.floor(Math.random()*tAlive.length)];
    }

    if(this.roundMode){
      if(this.hud) this.hud.message('РАУНД ' + this.round, 'Закупка снаряжения — B');
      if(this.audio) this.audio.click();
      if(this.bomb.carrier === this.player && this.hud) this.hud.message('ВЫ НЕСЁТЕ БОМБУ', 'Установка на точке A или B — удерживайте E', 2600);
    } else {
      this.phase = 'live';
      this.clock = this.matchTimer;
      this.player.frozen = false;
      for(const b of this.bots) b.frozen = false;
      if(this.round === 1 && this.hud) this.hud.message(this.cfg.label, 'Уничтожайте противников');
      if(this.mode === 'deathmatch' || this.mode === 'tdm' || this.mode === 'training'){
        this.player.money = this.cfg.startMoney;
      }
    }
    if(this.hud) this.hud.closeBuy();
  }

  _botBuy(bot){
    if(!bot.alive) return;
    const money = bot.money;
    let choice = null;
    const rifles = bot.team === 'CT' ? ['m4a1','m4a4','aug','famas'] : ['ak47','galil','sg553','famas'];
    const smgs = ['mp9','mac10','ump45'];
    if(money >= 3400 && bot.role === 'anchor' && Math.random() < 0.35) choice = 'aug';
    if(!choice && money >= 2700 && Math.random() < 0.82) choice = rifles[Math.floor(Math.random()*rifles.length)];
    else if(!choice && money >= 1500 && Math.random() < 0.4) choice = smgs[Math.floor(Math.random()*smgs.length)];
    else if(!choice && money >= 1700 && Math.random() < 0.18) choice = 'ssg08';
    else if(!choice && money >= 700 && Math.random() < 0.3) choice = 'deagle';
    else if(!choice) choice = (bot.team === 'CT' ? 'usp' : 'glock');
    if(choice && WEAPONS[choice]){
      const price = WEAPONS[choice].price;
      if(bot.money >= price){
        bot.money -= price;
        bot.setWeapon(choice);
      }
    }
    if(bot.armor <= 0 && bot.money >= 650){ bot.armor = 100; bot.money -= 650; }
    if(bot.money >= 1000 && !bot.helmet){ bot.helmet = true; bot.money -= 1000; bot.armor = 100; }
  }

  beginLive(){
    this.phase = 'live';
    this.clock = this.cfg.roundTime || 0;
    this.player.frozen = false;
    for(const b of this.bots) b.frozen = false;
    if(this.hud) this.hud.message('В БОЙ!', '');
    if(this.audio) this.audio.roundStart();
  }

  endRound(winner, reason){
    if(this.phase !== 'live') return;
    this.phase = 'over';
    this.roundResultTimer = this.cfg.overTime;
    this.clock = this.cfg.overTime;
    this.score[winner]++;
    // economy with a simple loss bonus ladder
    const winning = winner;
    const losing = winner === 'CT' ? 'T' : 'CT';
    this.lossStreak[winning] = 0;
    this.lossStreak[losing] = Math.min(4, (this.lossStreak[losing]||0) + 1);
    const winReward = 3250;
    const loseReward = 1400 + Math.max(0, (this.lossStreak[losing]-1)) * 350;
    for(const e of this._allEntities()){
      if(e.team === winner) e.money = Math.min(16000, e.money + winReward);
      else e.money = Math.min(16000, e.money + loseReward);
    }
    if(this.hud) this.hud.message((winner === 'CT' ? 'СПЕЦНАЗ ПОБЕДИЛ' : 'ТЕРРОРИСТЫ ПОБЕДИЛИ'), reason, 3200);
    if(this.audio){ if(winner === this.playerTeam) this.audio.win(); else this.audio.lose(); }
    if(this.score[winner] >= this.cfg.scoreTo){ this.endMatch(winner); }
  }

  endMatch(winner){
    if(this.ended) return;
    this.ended = true;
    this.phase = 'ended';
    const duration = this.roundMode ? (this.round * (this.cfg.roundTime + this.cfg.buyTime) - this.clock) : (this.cfg.matchTime - Math.max(0,this.clock));
    const accuracy = this.stats.shotsFired ? this.stats.shotsHit / this.stats.shotsFired : 0;
    if(this.hud) this.hud.message(winner === this.playerTeam ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ', 'Матч завершён', 5000);
    this.onEnd({
      win: winner === this.playerTeam,
      mode: this.mode,
      modeLabel: this.cfg.label,
      difficulty: this.difficultyId,
      score: { ...this.score },
      ffa: this.ffa,
      topKills: this.bots.reduce((m,b)=>Math.max(m, b.kills||0), 0),
      kills: this.player.kills,
      deaths: this.player.deaths,
      headshots: this.stats.headshots,
      damage: Math.round(this.stats.damage),
      accuracy: Math.round(accuracy * 100),
      shotsFired: this.stats.shotsFired,
      shotsHit: this.stats.shotsHit,
      duration: Math.max(0, duration)
    });
  }

  // ---------------- entities helpers ----------------
  _allEntities(){ return [this.player, ...this.bots]; }
  _teamEntities(team){ return [this.player, ...this.bots].filter(e=>e.team===team); }
  aliveCount(team){ return this._teamEntities(team).filter(e=>e.alive).length; }
  isEnemy(a, b){ if(a === b) return false; return this.ffa ? true : a.team !== b.team; }
  getEnemiesOf(shooter){
    return this._allEntities().filter(e=> e.alive && this.isEnemy(shooter, e));
  }
  getAlliesOf(entity){
    return this._allEntities().filter(e=> e !== entity && e.alive && !this.isEnemy(entity, e));
  }
  getEnemiesAll(){ return this._allEntities(); }

  getObjective(bot){
    if(!this.roundMode){
      if(!bot._dmObj || Math.hypot(bot.pos.x-bot._dmObj.x, bot.pos.z-bot._dmObj.z) < 2.6){
        bot._dmObj = this.level.randomOpenPoint();
      }
      return bot._dmObj;
    }
    if(this.bomb.state === 'planted'){
      if(bot.team === 'CT') return { x:this.bomb.x, z:this.bomb.z };
      const site = this.bomb.site || this.level.map.sites[0];
      if(!bot._defend) bot._defend = this.level.openPointNear(site.x, site.z, 7);
      return bot._defend;
    }
    if(this.bomb.state === 'dropped'){
      if(bot.team === 'T') return { x:this.bomb.x, z:this.bomb.z };
    }
    // T support players occasionally escort the carrier instead of taking a
    // fixed lane; this breaks up the single-file conga line every round.
    if(bot.team === 'T' && bot.role === 'support' && this.bomb.carrier && this.bomb.carrier !== bot && this.round % 3 !== 0){
      const c = this.bomb.carrier;
      const cx = c.pos ? c.pos.x : c.x, cz = c.pos ? c.pos.z : c.z;
      if(!bot._escort || bot._escortRound !== this.round){
        bot._escort = this.level.openPointNear(cx, cz, 5);
        bot._escortRound = this.round;
      }
      if(bot._escort) return bot._escort;
    }
    const sites = this.level.map.sites;
    const site = sites[bot.siteIndex % sites.length];
    if(bot._routeTarget && bot._routeRound === this.round) return bot._routeTarget;
    return { x:site.x, z:site.z };
  }

  botVisibleToPlayer(bot){
    if(!bot.alive) return false;
    if(!this.ffa && bot.team === this.player.team) return true;
    const p = this.player;
    const dx = bot.pos.x - p.x, dz = bot.pos.z - p.z;
    const d = Math.hypot(dx,dz);
    if(d > 52) return false;
    if(!this.level.lineOfSight(p.x, p.y+p.eyeH, p.z, bot.pos.x, 1.4, bot.pos.z)) return false;
    if(this.effects.isSmokeBlocked(p.x, p.z, bot.pos.x, bot.pos.z)) return false;
    return true;
  }

  botSkin(id){ return equippedSkin(id); }

  // ---------------- combat ----------------
  _lookDirWithSpread(spread){
    // Always start from the actual camera forward vector so the first pellet
    // lands exactly on the visual crosshair, then apply a radial spread cone.
    const dir = this.camera.getWorldDirection(new THREE.Vector3()).normalize();
    if(spread <= 0.00001) return dir;
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0,1,0));
    if(right.lengthSq() < 1e-6) right.set(1,0,0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * Math.tan(Math.min(spread, 0.35));
    dir.addScaledVector(right, Math.cos(angle) * radius)
       .addScaledVector(up, Math.sin(angle) * radius)
       .normalize();
    return dir;
  }

  _currentSpread(def){
    const p = this.player;
    const speed = Math.hypot(p.moveVelX||0, p.moveVelZ||0);
    return spreadFor(def, {
      speed,
      airborne: p.airborne && !p.onGround,
      crouch: p.crouch,
      aiming: p.aiming,
      heat: this.spreadHeat,
      shotIndex: this.shotIndex
    });
  }

  _firePlayer(){
    const p = this.player;
    if(!p.alive || this.paused) return;
    if(this.modActive('aimbot')) this._updateAimAssist(1, true);
    if(this.phase === 'buy' || this.phase === 'over' || this.phase === 'ended') return;
    if(this.fireTimer > 0) return;
    if(this.inspectT > 0) this.inspectT = 0;
    const w = p.getActiveWeapon();
    if(!w) return;

    if(w.id === 'grenade'){
      if(this.grenadeTimer > 0) return;
      this._throwGrenade(w.grenade);
      return;
    }
    if(w.id === 'knife'){
      this.fireTimer = w.def.fireDelay/1000;
      this._melee();
      return;
    }
    const def = w.def;
    const slot = p.loadout[p.currentSlot];
    if(!slot) return;
    if(this.reload.active) return;
    if(slot.ammo <= 0){
      if(slot.reserve > 0) this._startReload();
      else if(this.audio) this.audio.dryFire();
      return;
    }

    const now = performance.now()/1000;
    if(now - this.lastShotAt > 0.34) this.shotIndex = 0;
    this.lastShotAt = now;

    const spreadBase = this.modActive('aimbot') ? 0 : this._currentSpread(def);
    this.camera.updateMatrixWorld(true);
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const pellets = def.pellets || 1;
    for(let i=0;i<pellets;i++){
      const pelletSpread = spreadBase + (pellets>1 ? 0.055 : 0);
      const dir = this._lookDirWithSpread(pelletSpread);
      this._hitscan(p, origin, dir, def, { damageMul: 1 });
    }
    this.stats.shotsFired += pellets;
    if(!this.modActive('infiniteAmmo')) slot.ammo--;
    this.fireTimer = def.fireDelay/1000;
    const rc = recoilFor(def, this.shotIndex, Math.random);
    p.addRecoil(rc.pitch, rc.yaw);
    this.shotIndex++;
    this.spreadHeat = Math.min(3.2, this.spreadHeat + (def.recoil || 0.5) * 0.42);
    this.vmFlash = 1;
    this.vmKick = 1;
    this.vmAction = 1;
    this.vmMuzzleLight.intensity = 6;
    if(this.vmFlashSprite){
      this.vmFlashSprite.material.opacity = 0.95;
      this.vmFlashSprite.material.rotation = Math.random()*6.283;
      this.vmFlashSprite.scale.setScalar(0.20 + Math.random()*0.12);
    }
    const camRight = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    this.effects.casing(origin.clone().addScaledVector(camRight, 0.12).add(new THREE.Vector3(0,-0.12,0)), p.getLookDir(new THREE.Vector3()));
    if(this.audio) this.audio.shot(def.sound || 'rifle');
    this._alertGunshot(origin, p, def);
    if(slot.ammo <= 0 && slot.reserve > 0 && !this.modActive('infiniteAmmo')) this._startReload();
  }

  _melee(){
    const p = this.player;
    const def = WEAPONS.knife;
    const origin = p.getEyePos(new THREE.Vector3());
    const dir = this._lookDirWithSpread(0.02);
    this._hitscan(p, origin, dir, def, {});
    if(this.audio) this.audio.shot('knife');
    this.vmKick = 1;
  }

  _throwGrenade(kind){
    const p = this.player;
    if(!p.grenades[kind] || p.grenades[kind] <= 0) return;
    if(!this.modActive('infiniteAmmo')) p.grenades[kind]--;
    if(p.grenades[kind] <= 0){
      const next = Object.keys(p.grenades).find(k=>p.grenades[k] > 0);
      if(next) p.currentGrenade = next;
      else p.switchSlot(p.loadout[1] ? 1 : (p.loadout[2] ? 2 : 3));
    }
    this.grenadeTimer = 0.9;
    const origin = p.getEyePos(new THREE.Vector3());
    const look = this.camera.getWorldDirection(new THREE.Vector3()).normalize();
    const pos = origin.clone().add(look.clone().multiplyScalar(0.55));
    const vel = look.clone().multiplyScalar(15.5);
    vel.y += 3.0;
    const g = GRENADES[kind];
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color:g.color, roughness:0.55, metalness:0.2 }));
    mesh.position.copy(pos);
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.grenadesLive.push({ kind, pos, vel, fuse:g.fuse || 1.5, mesh, owner:p });
    if(this.audio) this.audio.click();
    this._rebuildViewmodel();
  }

  _updateGrenades(dt){
    for(let i=this.grenadesLive.length-1;i>=0;i--){
      const g = this.grenadesLive[i];
      g.fuse -= dt;
      g.vel.y -= 16*dt;
      const np = g.pos.clone().addScaledVector(g.vel, dt);
      if(this.level.isBlocked(np.x, g.pos.z, 0.12)) g.vel.x *= -0.5; else g.pos.x = np.x;
      if(this.level.isBlocked(g.pos.x, np.z, 0.12)) g.vel.z *= -0.5; else g.pos.z = np.z;
      g.pos.y += g.vel.y*dt;
      if(g.pos.y < 0.12){ g.pos.y = 0.12; g.vel.y = Math.abs(g.vel.y)*0.35; g.vel.x *= 0.7; g.vel.z *= 0.7; }
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += dt*8; g.mesh.rotation.y += dt*6;
      if(g.fuse <= 0){
        this._detonate(g);
        this.scene.remove(g.mesh);
        g.mesh.geometry.dispose(); g.mesh.material.dispose();
        this.grenadesLive.splice(i,1);
      }
    }
  }

  _detonate(g){
    const kind = g.kind;
    const p = g.pos.clone();
    if(kind === 'smoke'){
      this.effects.smoke(p.clone().setY(0.2), GRENADES.smoke.radius, GRENADES.smoke.duration);
      if(this.audio) this.audio.explosion();
      return;
    }
    if(kind === 'molotov'){
      this.effects.fire(p.clone().setY(0.1), GRENADES.molotov.radius, GRENADES.molotov.duration);
      this.fireZones.push({ x:p.x, z:p.z, radius:GRENADES.molotov.radius, life:GRENADES.molotov.duration, dps:GRENADES.molotov.dps, owner:g.owner });
      if(this.audio) this.audio.explosion();
      return;
    }
    if(kind === 'he'){
      this.effects.explosion(p, GRENADES.he.radius);
      if(this.audio) this.audio.explosion();
      if(this.phase === 'over' || this.phase === 'ended') return;
      for(const e of this._allEntities()){
        if(!e.alive) continue;
        const ex = e.pos ? e.pos.x : e.x, ez = e.pos ? e.pos.z : e.z;
        const d = Math.hypot(ex-p.x, ez-p.z);
        if(d > GRENADES.he.radius) continue;
        const eyeY = (e.getEyePos ? e.getEyePos(new THREE.Vector3()).y : e.y + e.eyeH);
        if(!this.level.lineOfSight(p.x, p.y+0.3, p.z, ex, eyeY, ez)) continue;
        const dmg = GRENADES.he.dmg * Math.pow(1 - d/GRENADES.he.radius, 0.85);
        const r = e.takeDamage(dmg, false, g.owner);
        if(e === this.player){ if(this.hud) this.hud.hitDamage(); }
        if(r.killed) this._onKill(g.owner, e, 'HE', false, true);
      }
      return;
    }
    if(kind === 'flash'){
      this.effects.flashbang(p);
      if(this.audio) this.audio.flashRing();
      for(const e of this._allEntities()){
        if(!e.alive) continue;
        const ex = e.pos ? e.pos.x : e.x, ez = e.pos ? e.pos.z : e.z;
        const d = Math.hypot(ex-p.x, ez-p.z);
        if(d > GRENADES.flash.radius) continue;
        const eyeY = (e.getEyePos ? e.getEyePos(new THREE.Vector3()).y : e.y + e.eyeH);
        let mul = 1;
        if(!this.level.lineOfSight(p.x, p.y+0.15, p.z, ex, eyeY, ez)) mul = 0.35;
        const power = clamp(1 - d/GRENADES.flash.radius, 0.15, 1) * mul;
        if(e === this.player){
          this.playerFlash = Math.max(this.playerFlash, power * 1.15);
        } else {
          e.blind = Math.max(e.blind || 0, GRENADES.flash.blind * power);
        }
      }
    }
  }

  _hitscan(shooter, origin, dir, def, opts={}){
    const range = def.range || 60;
    const wallbang = shooter === this.player && this.modActive('wallbang');
    const wall = this.level.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);
    let maxT = wallbang ? range : (wall.hit ? wall.t : range);
    let best = null, bestT = maxT;
    for(const e of this._allEntities()){
      if(e === shooter || !e.alive) continue;
      const enemy = this.isEnemy(shooter, e);
      for(const s of e.getHitSpheres()){
        const t = raySphere(origin.x,origin.y,origin.z, dir.x,dir.y,dir.z, s.x,s.y,s.z, s.r);
        if(t >= 0 && t < bestT){
          bestT = t;
          best = { e, zone: s.zone, enemy, point:new THREE.Vector3(origin.x+dir.x*t, origin.y+dir.y*t, origin.z+dir.z*t) };
        }
      }
    }
    const endT = best ? bestT : (wall.hit ? wall.t : maxT);
    const endPoint = new THREE.Vector3(origin.x+dir.x*endT, origin.y+dir.y*endT, origin.z+dir.z*endT);
    if(def.type !== 'knife') this.effects.tracer(origin, endPoint, shooter === this.player ? 0xffe08a : 0xffc060);

    if(best){
      if(best.enemy){
        const dist = bestT;
        const calc = computeDamage(def, best.zone, dist, best.e.armor, best.e.helmet);
        const throughWall = wallbang && wall.hit && bestT > wall.t;
        const dmg = calc.dmg * (opts.damageMul ?? 1) * (throughWall ? 0.75 : 1);
        this.effects.blood(best.point, dir);
        const healthBefore = best.e.health;
        const res = best.e.takeDamage(dmg, best.zone === 'head', shooter, calc.armorLoss, best.zone);
        if(shooter === this.player){
          this.stats.shotsHit++;
          this.stats.damage += Math.min(dmg, healthBefore);
          if(best.zone === 'head') this.stats.headshots++;
          if(this.hud) this.hud.hitMark(res.killed, best.zone === 'head', Math.min(dmg, healthBefore));
          if(this.audio) this.audio.hit(best.zone === 'head');
        }
        if(best.e === this.player){
          if(this.hud){
            this.hud.hitDamage();
            if(this.settings.damageDirections !== false) this.hud.damageIndicator(this.player.lastDamageDir, clamp(dmg/45, 0.2, 1));
          }
          if(this._input && this._input.rumble) this._input.rumble(0.75, 150);
          if(this.audio) this.audio.hitArmor();
        }
        if(res.killed) this._onKill(shooter, best.e, def.name || 'Оружие', best.zone === 'head', false);
      } else {
        // friendly bodies stop bullets but take no damage
        this.effects.puff(best.point, 0x8a7a66, 0.08, 0.25, 0.5);
        if(shooter === this.player && this.audio) this.audio.hitArmor();
      }
    } else if(wall.hit){
      const nx = wall.side === 0 ? -Math.sign(dir.x) : 0;
      const nz = wall.side === 1 ? -Math.sign(dir.z) : 0;
      this.effects.impact(new THREE.Vector3(wall.x, wall.y, wall.z), new THREE.Vector3(nx, 0, nz));
    } else {
      this.effects.puff(endPoint, 0xb0a790, 0.05, 0.25, 0.3);
    }

    // near-miss whiz for the player
    if(shooter !== this.player && this.player.alive){
      const near = this._rayNearPlayer(origin, dir, endT);
      if(near > 0 && this.audio){
        const dx = origin.x - this.player.x, dz = origin.z - this.player.z;
        const yaw = this.player.yaw;
        const pan = Math.hypot(dx,dz) > 0.01 ? (dx*Math.cos(yaw) + dz*(-Math.sin(yaw))) / Math.hypot(dx,dz) : 0;
        this.audio.whiz(clamp(pan, -0.8, 0.8));
      }
    }
    return best;
  }

  _rayNearPlayer(origin, dir, maxT){
    const px = this.player.x - origin.x;
    const py = (this.player.y + this.player.eyeH) - origin.y;
    const pz = this.player.z - origin.z;
    const t = px*dir.x + py*dir.y + pz*dir.z;
    if(t < 0 || t > maxT) return -1;
    const cx = origin.x + dir.x*t, cy = origin.y + dir.y*t, cz = origin.z + dir.z*t;
    const d = Math.hypot(cx - this.player.x, cy - (this.player.y + this.player.eyeH), cz - this.player.z);
    return d < 1.9 ? t : -1;
  }

  botShoot(bot, origin, dir, def, opts={}){
    if(this.paused) return;
    this.effects.muzzle(origin.clone().addScaledVector(dir, 0.45), dir, 0.9, 0xffc070);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    this.effects.casing(origin.clone().addScaledVector(side, 0.15).add(new THREE.Vector3(0,-0.15,0)), dir);
    this._hitscan(bot, origin, dir, def, opts);
    if(this.audio){
      this.audio.shotAt(def.sound || 'rifle', origin.x-this.player.x, origin.z-this.player.z, this.player.yaw);
    }
    this._alertGunshot(origin, bot, def);
  }

  _alertGunshot(origin, shooter, def){
    const loud = (def.sound === 'm4_sil' || def.sound === 'pistol_sil') ? 0.5 : (def.type === 'sniper' ? 1.5 : 1);
    for(const b of this.bots){
      if(!b.alive || b === shooter) continue;
      if(!this.isEnemy(b, shooter)) continue;
      b.hearGunshot(origin.x, origin.z, loud);
    }
  }

  alertTeam(bot, x, z){
    if(!bot.alive) return;
    for(const b of this.bots){
      if(b === bot || !b.alive || b.team !== bot.team) continue;
      if(Math.hypot(b.pos.x - bot.pos.x, b.pos.z - bot.pos.z) > 17) continue;
      if(b.target) continue;
      if(Math.random() > b.profile.teamwork) continue;
      b.alertX = x + (Math.random()-0.5)*2.5;
      b.alertZ = z + (Math.random()-0.5)*2.5;
      b.alertAge = 0;
      if(b.state !== 'reload') b.state = 'search';
      b.repathTimer = 0;
    }
  }

  findCover(bot, threat){
    return this.level.findCover(bot.pos.x, bot.pos.z, threat.pos.x, threat.pos.z);
  }

  _onKill(killer, victim, weaponName, headshot, isExplosive){
    const environment = !killer || killer === victim;
    if(killer && killer !== victim){
      if(killer.kills !== undefined) killer.kills++;
      if(headshot && killer.headshots !== undefined) killer.headshots++;
      let reward = 300;
      if(!isExplosive){
        const wid = this._weaponIdByName(weaponName);
        reward = WEAPONS[wid] ? WEAPONS[wid].killReward : 300;
      }
      if(killer.money !== undefined) killer.money = Math.min(16000, killer.money + reward);
    }

    if(this.roundMode && this.bomb.carrier === victim && this.bomb.state === 'carried'){
      this.bomb.state = 'dropped';
      this.bomb.x = victim.pos ? victim.pos.x : victim.x;
      this.bomb.z = victim.pos ? victim.pos.z : victim.z;
      this.bomb.carrier = null;
      if(this.hud) this.hud.message('БОМБА ПОТЕРЯНА', 'Террористы могут подобрать её', 1600);
    }
    if(this.bomb.carrier === victim) this.bomb.carrier = null;

    if(!this.roundMode && !environment){
      this.score[killer.team] = (this.score[killer.team] || 0) + 1;
      if(this.mode === 'tdm' && this.score[killer.team] >= this.cfg.scoreTo){ this.endMatch(killer.team); return; }
      if(this.mode === 'deathmatch' && killer.kills >= this.cfg.scoreTo){ this._endDM(); return; }
    }
    if(this.hud){
      const killerName = environment ? 'СРЕДА' : (killer === this.player ? this.player.name : killer.name);
      const victimName = victim === this.player ? this.player.name : victim.name;
      const same = !environment && !this.ffa && killer.team === victim.team && killer !== victim;
      this.hud.addKill(killerName, victimName, weaponName, headshot, same, !environment && killer === this.player, victim === this.player);
    }
    if(this.audio){
      if(victim === this.player) this.audio.death();
      else if(!environment && killer === this.player) this.audio.beep(1200, 0.03);
    }

    if(!this.roundMode){
      if(victim === this.player) this.playerRespawnTimer = this.cfg.respawn || 3;
      else victim.respawnTimer = this.cfg.respawn || 3;
      if(victim !== this.player) this.effects.deathPuff(victim.pos ? victim.pos : { x:victim.x, y:0, z:victim.z });
    } else {
      if(this.aliveCount('CT') === 0) this.endRound('T', 'Спецназ уничтожен');
      else if(this.bomb.state !== 'planted' && this.aliveCount('T') === 0) this.endRound('CT', 'Террористы уничтожены');
    }
  }

  _weaponIdByName(name){
    for(const id in WEAPONS) if(WEAPONS[id].name === name) return id;
    return 'ak47';
  }

  // ---------------- reload / inspect / drop ----------------
  _startReload(){
    const p = this.player;
    const w = p.getActiveWeapon();
    if(!w || w.id === 'knife' || w.id === 'grenade') return;
    const slot = p.loadout[p.currentSlot];
    const def = w.def;
    if(!slot || slot.ammo >= def.mag || slot.reserve <= 0) return;
    this.inspectT = 0;
    this.reload.active = true;
    this.reload.total = def.reloadTime/1000;
    this.reload.timer = this.reload.total;
    this.reload.slot = p.currentSlot;
    if(this.audio) this.audio.reload();
  }

  _finishReload(){
    const slot = this.player.loadout[this.reload.slot];
    if(slot && slot.id && this.player.currentSlot === this.reload.slot){
      const def = WEAPONS[slot.id];
      const need = def.mag - slot.ammo;
      const take = Math.min(need, slot.reserve);
      slot.ammo += take; slot.reserve -= take;
    }
    this.reload.active = false;
  }

  _inspectWeapon(){
    const w = this.player.getActiveWeapon();
    if(!w || !w.def || w.id === 'grenade') return;
    if(this.reload.active) return;
    if(this.inspectT > 0) return;
    this.inspectTotal = w.def.inspectTime || 1.7;
    this.inspectT = this.inspectTotal;
    if(this.audio) this.audio.inspect();
  }

  _dropWeapon(){
    const p = this.player;
    if(!p.alive) return;
    const slotNum = p.currentSlot;
    if(slotNum !== 1 && slotNum !== 2) return;
    const slot = p.loadout[slotNum];
    if(!slot) return;
    const def = WEAPONS[slot.id];
    this._makePickup(slot.id, slot.ammo, slot.reserve, p.x, p.z, p.yaw);
    p.loadout[slotNum] = null;
    this.reload.active = false;
    const next = p.loadout[1] ? 1 : (p.loadout[2] ? 2 : 3);
    p.currentSlot = next;
    this._rebuildViewmodel();
    if(this.hud) this.hud.message('ОРУЖИЕ ВЫБРОШЕНО', def.name, 900);
    if(this.audio) this.audio.pickup();
  }

  _makePickup(id, ammo, reserve, x, z, yaw=0){
    const def = WEAPONS[id];
    if(!def) return;
    const mesh = makeGunMesh(id, equippedSkin(id), 'low');
    mesh.scale.setScalar(0.75);
    mesh.position.set(x, 0.22, z);
    mesh.rotation.set(0, yaw || 0, Math.PI/2);
    this.scene.add(mesh);
    this.pickups.push({ id, ammo, reserve, x, z, mesh, spin: Math.random()*6.28 });
    if(this.pickups.length > 12){
      const old = this.pickups.shift();
      this.scene.remove(old.mesh);
    }
  }

  _updatePickups(dt){
    const p = this.player;
    this.pickupHint = null;
    let nearest = null, nearestD = Infinity;
    for(let i=this.pickups.length-1;i>=0;i--){
      const it = this.pickups[i];
      it.mesh.rotation.z += dt*1.5;
      it.mesh.position.y = 0.22 + Math.sin(performance.now()*0.003 + it.spin)*0.03;
      if(!p.alive) continue;
      const d = Math.hypot(p.x-it.x, p.z-it.z);
      const slot = WEAPONS[it.id].slot;
      const cur = p.loadout[slot];
      if(d < 1.6 && (!cur || cur.id === it.id)){
        if(cur && cur.id === it.id){
          cur.reserve = Math.min(WEAPONS[it.id].reserve, cur.reserve + it.reserve + it.ammo);
        } else {
          p.loadout[slot] = { id:it.id, ammo:it.ammo, reserve:it.reserve };
          p.currentSlot = slot;
          this._rebuildViewmodel();
        }
        if(this.hud) this.hud.message('ПОДОБРАНО', WEAPONS[it.id].name, 1000);
        if(this.audio) this.audio.pickup();
        this.scene.remove(it.mesh);
        this.pickups.splice(i,1);
      } else if(d < 2.3 && d < nearestD){
        nearest = it; nearestD = d;
      }
    }
    if(nearest){
      const def = WEAPONS[nearest.id];
      if(this.pickupHint !== def.name) this.pickupHint = def.name;
      const slot = def.slot;
      const cur = p.loadout[slot];
      if(this._input && this._input.usePressed && cur && cur.id !== nearest.id){
        // Swap carried weapon with the one on the ground instead of requiring
        // an empty slot. The old gun drops at the player's feet.
        const old = { ...cur };
        p.loadout[slot] = { id:nearest.id, ammo:nearest.ammo, reserve:nearest.reserve };
        p.currentSlot = slot;
        this._makePickup(old.id, old.ammo, old.reserve, p.x + Math.cos(p.yaw)*0.5, p.z - Math.sin(p.yaw)*0.5, p.yaw);
        this.scene.remove(nearest.mesh);
        const idx = this.pickups.indexOf(nearest);
        if(idx >= 0) this.pickups.splice(idx,1);
        this._rebuildViewmodel();
        if(this.hud) this.hud.message('ОРУЖИЕ ЗАМЕНЕНО', def.name, 1100);
        if(this.audio) this.audio.pickup();
        this.pickupHint = null;
      }
    }
  }

  // ---------------- buying ----------------
  canBuy(){
    if(this.phase === 'buy') return true;
    if(!this.roundMode) return this.player.alive;
    return false;
  }

  buy(itemId){
    const p = this.player;
    if(!this.canBuy()) return false;
    if(WEAPONS[itemId]){
      const w = WEAPONS[itemId];
      if(w.slot === 3) return false;
      if(p.loadout[w.slot] && p.loadout[w.slot].id === itemId) return false;
      if(p.money < w.price) return false;
      p.money -= w.price;
      p.giveWeapon(itemId);
      this.reload.active = false;
      this.inspectT = 0;
      this._rebuildViewmodel();
      if(this.audio) this.audio.pickup();
      return true;
    }
    if(GRENADES[itemId]){
      const g = GRENADES[itemId];
      if(p.money < g.price) return false;
      if((p.grenades[itemId]||0) >= 4) return false;
      p.money -= g.price;
      p.giveGrenade(itemId);
      this._rebuildViewmodel();
      if(this.audio) this.audio.pickup();
      return true;
    }
    if(itemId === 'armor'){
      if(p.armor >= 100) return false;
      if(p.money < 650) return false;
      p.money -= 650; p.armor = 100;
      if(this.audio) this.audio.pickup();
      return true;
    }
    if(itemId === 'helmet'){
      if(p.helmet) return false;
      if(p.money < 1000) return false;
      p.money -= 1000; p.helmet = true; p.armor = 100;
      if(this.audio) this.audio.pickup();
      return true;
    }
    return false;
  }

  // ---------------- bomb ----------------
  _makeBombMesh(x,z){
    this._clearBombMesh();
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42,0.2,0.32), new THREE.MeshStandardMaterial({ color:0x23262a, roughness:0.6, metalness:0.4 }));
    body.position.y = 0.12;
    const ledMat = new THREE.MeshStandardMaterial({ color:0xff2222, emissive:0xff2222, emissiveIntensity:3, roughness:0.3 });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), ledMat);
    led.position.set(0.1, 0.24, 0.1);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.44,0.05,0.34), new THREE.MeshStandardMaterial({ color:0xb08a3a, roughness:0.9 }));
    tape.position.y = 0.13;
    group.add(body, led, tape);
    group.position.set(x, 0, z);
    this.scene.add(group);
    this.bombMesh = group;
    this.bombLED = led;
    this.bombLEDMat = ledMat;
    this._bombBlink = 0;
  }

  _clearBombMesh(){
    if(this.bombMesh){
      this.scene.remove(this.bombMesh);
      this.bombMesh.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material) o.material.dispose(); });
      this.bombMesh = null; this.bombLED = null; this.bombLEDMat = null;
    }
  }

  _updateBomb(dt){
    if(!this.roundMode || this.phase === 'ended' || this.phase === 'over') return;
    const b = this.bomb;
    const sites = this.level.map.sites;
    const inSite = (x,z) => sites.find(s => Math.hypot(x-s.x, z-s.z) < this.level.map.tile*2.4);
    const p = this.player;

    if(b.state === 'dropped'){
      for(const e of this._teamEntities('T')){
        if(!e.alive) continue;
        const ex = e.pos? e.pos.x : e.x, ez = e.pos? e.pos.z : e.z;
        if(Math.hypot(ex-b.x, ez-b.z) < 1.6){
          b.state = 'carried'; b.carrier = e;
          if(e === p && this.hud) this.hud.message('БОМБА ПОДОБРАНА', 'Установка — удерживайте E на точке', 2000);
          break;
        }
      }
    }

    if(b.state === 'carried' && b.carrier && b.carrier.alive){
      const c = b.carrier;
      const cx = c.pos ? c.pos.x : c.x, cz = c.pos ? c.pos.z : c.z;
      b.x = cx; b.z = cz;
      const site = inSite(cx, cz);
      if(site){
        let canPlant = false;
        if(c === p) canPlant = !!(this._input && this._input.use);
        else canPlant = true;
        // bots only plant after a short, readable delay; player must hold E
        b.plant += canPlant ? dt : -dt*2;
        b.plant = clamp(b.plant, 0, 3.2);
        if(this.hud && c === p && b.plant > 0.05){
          this.hud.message('УСТАНОВКА БОМБЫ', Math.max(0, 3.2-b.plant).toFixed(1)+' сек', 400);
        }
        if(b.plant >= 3.2){
          b.state = 'planted';
          b.timer = 40;
          b.site = site;
          b.x = site.x; b.z = site.z;
          b.carrier = null;
          b.defuse = 0;
          b.beepTimer = 0;
          this._makeBombMesh(site.x, site.z);
          if(this.hud) this.hud.message('БОМБА УСТАНОВЛЕНА', 'Спецназ: обезвредьте. Террористы: защитите!', 3200);
          if(this.audio) this.audio.roundStart();
          for(const e of this._teamEntities('T')) e.money = Math.min(16000, e.money + 300);
        }
      } else {
        b.plant = Math.max(0, b.plant - dt*2);
      }
    }

    if(b.state === 'planted'){
      b.timer -= dt;
      // blinking led + audio beeps
      this._bombBlink = (this._bombBlink + dt) % Math.max(0.22, Math.min(1.2, b.timer/20));
      if(this.bombLEDMat) this.bombLEDMat.emissiveIntensity = this._bombBlink < 0.12 ? 5 : 0.4;
      b.beepTimer -= dt;
      if(b.beepTimer <= 0){
        const interval = b.timer < 8 ? 0.22 : (b.timer < 18 ? 0.55 : 1.0);
        b.beepTimer = interval;
        const d = Math.hypot(p.x-b.x, p.z-b.z);
        if(this.audio && d < 28) this.audio.bombBeep(b.timer < 8);
        if(this.bombLEDMat) this.bombLEDMat.emissiveIntensity = 6;
      }

      let defusing = false;
      let defuser = null;
      for(const e of this._teamEntities('CT')){
        if(!e.alive) continue;
        const ex = e.pos? e.pos.x : e.x, ez = e.pos? e.pos.z : e.z;
        if(Math.hypot(ex-b.x, ez-b.z) < 2.5){
          if(e === p ? (this._input && this._input.use) : true){
            defusing = true; defuser = e;
            break;
          }
        }
      }
      if(defusing){
        b.defuse += dt;
        if(this.hud && defuser === p){
          this.hud.message('ОБЕЗВРЕЖИВАНИЕ', Math.max(0, 6.5-b.defuse).toFixed(1)+' сек', 300);
        }
        if(b.defuse >= 6.5){
          b.state = 'defused';
          if(this.bombLEDMat) this.bombLEDMat.emissiveIntensity = 0;
          this.endRound('CT', 'Бомба обезврежена');
          return;
        }
      } else {
        b.defuse = Math.max(0, b.defuse - dt*2);
      }
      if(b.timer <= 0){
        b.state = 'exploded';
        this.effects.explosion(new THREE.Vector3(b.x, 0.5, b.z), 11);
        if(this.audio) this.audio.explosion();
        for(const e of this._allEntities()){
          if(!e.alive) continue;
          const ex = e.pos? e.pos.x : e.x, ez = e.pos? e.pos.z : e.z;
          const d = Math.hypot(ex-b.x, ez-b.z);
          if(d < 14){
            const dmg = 500 * Math.pow(1 - d/14, 0.8);
            const r = e.takeDamage(dmg, false, null);
            if(r.killed) this._onKill(null, e, 'Бомба', false, true);
          }
        }
        this.endRound('T', 'Бомба взорвана');
      }
    }
  }

  // ---------------- mod menu / spectator ----------------
  modUnlocked(){
    try{ return getState().settings.modUnlocked === true; }catch(e){ return false; }
  }
  modActive(key){
    if(!this.modAllowed || !this.modUnlocked()) return false;
    const c = getState().settings.cheats || {};
    return !!c[key];
  }
  _updateAimAssist(dt, snap=false){
    const p = this.player;
    if(!p || !p.alive || this.freeCam || (this.spectate && this.spectate.active)) return false;
    const eye = p.getEyePos(new THREE.Vector3());
    const camDir = this.camera.getWorldDirection(new THREE.Vector3()).normalize();
    const wallbang = this.modActive('wallbang');
    let best = null, bestScore = -1;
    for(const b of this.bots){
      if(!b.alive || !this.isEnemy(p, b)) continue;
      const spheres = b.getHitSpheres();
      const head = spheres.find(s => s.zone === 'head') || spheres[0];
      if(!head) continue;
      const dx = head.x - eye.x, dy = head.y - eye.y, dz = head.z - eye.z;
      const dist = Math.hypot(dx, dz);
      if(dist < 0.5 || dist > 90) continue;
      const len = Math.hypot(dx, dy, dz) || 1;
      const dot = (dx*camDir.x + dy*camDir.y + dz*camDir.z) / len;
      if(dot < 0.82) continue;
      if(!wallbang && !this.level.lineOfSight(eye.x, eye.y, eye.z, head.x, head.y, head.z)) continue;
      const score = dot * 2 + (1 - Math.min(1, dist/90));
      if(score > bestScore){ bestScore = score; best = { x:head.x, y:head.y, z:head.z }; }
    }
    if(!best) return false;
    const dx = best.x - eye.x, dy = best.y - eye.y, dz = best.z - eye.z;
    const targetYaw = Math.atan2(-dx, -dz);
    const targetPitch = Math.atan2(dy, Math.hypot(dx, dz));
    const k = snap ? 1 : Math.min(1, dt * 16);
    const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
    p.yaw += wrap(targetYaw - p.yaw) * k;
    p.pitch += (targetPitch - p.pitch) * k;
    p.pitch = clamp(p.pitch, -1.45, 1.45);
    if(snap){ p.recoilPitch = 0; p.recoilYaw = 0; p.viewKick = 0; }
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(p.pitch + p.recoilPitch + p.viewKick, p.yaw + p.recoilYaw, 0);
    return true;
  }
  _applyMods(){
    const p = this.player;
    const c = getState().settings.cheats || {};
    p.cheatFly = this.modActive('fly');
    p.cheatNoclip = this.modActive('noclip');
    p.godMode = this.modActive('god');
    p.cheatJump = 1;
    p.cheatSpeed = this.modActive('speed') ? clamp(Number(c.speedControl) || 1.6, 0.3, 8) : 1;
    if(this.modActive('jumpPower')) p.cheatJump = clamp(Number(c.jumpPower) || 1.35, 0.5, 3);
    if(this.modActive('infiniteMoney')) p.money = Math.max(p.money, 16000);
    if(!this.modAllowed && this.modUnlocked() && !this._modWarned){
      const any = Object.keys(c).some(k => c[k] === true && k !== 'speedControl' && k !== 'jumpPower');
      if(any && this.hud){
        this._modWarned = true;
        this.hud.message('MOD MENU ЗАБЛОКИРОВАН', 'Функции доступны в тренировке, редакторе и приватном матче', 3200);
      }
    }
    this.debugInfo = this.modActive('debugInfo')
      ? `X ${p.x.toFixed(1)} Z ${p.z.toFixed(1)} Y ${p.y.toFixed(1)} · BOTS ${this.bots.filter(b=>b.alive).length}/${this.bots.length}`
      : '';
  }
  _spectatorTargets(){
    const p = this.player;
    let list = this.bots.filter(b=>b.alive && !this.ffa && b.team === p.team);
    if(!list.length) list = this.bots.filter(b=>b.alive);
    return list;
  }
  _updateSpectator(dt, input){
    const sp = this.spectate;
    if(!this.roundMode || this.player.alive || this.phase === 'ended'){
      sp.active = false; sp.target = null; this.freeCam = null;
      return;
    }
    const targets = this._spectatorTargets();
    if(!targets.length) return;
    if(!sp.active){
      sp.active = true;
      sp.index = 0;
      sp.free = false;
      sp.pos.copy(this.camera.position);
      sp.yaw = this.camera.rotation.y;
      sp.pitch = this.camera.rotation.x;
    }
    if(input && input.spectateFree) sp.free = !sp.free;
    if(input && input.spectateNext){ sp.index = (sp.index + 1) % targets.length; sp.free = false; }
    if(input && input.spectatePrev){ sp.index = (sp.index - 1 + targets.length) % targets.length; sp.free = false; }
    if(sp.index >= targets.length) sp.index = 0;
    const t = targets[sp.index];
    sp.target = t;
    if(sp.free){
      if(input && input.look){
        const sens = (this.settings.sensitivity || 1) * 0.0022;
        sp.yaw -= input.look.dx * sens;
        sp.pitch = clamp(sp.pitch - input.look.dy * sens, -1.4, 1.4);
      }
      const mv = input && input.move ? input.move : { x:0, y:0 };
      const speed = (input && input.run ? 16 : 7) * dt;
      const cy = Math.cos(sp.yaw), sy = Math.sin(sp.yaw);
      const fwd = -mv.y, str = mv.x;
      sp.pos.x += (-sy)*fwd*speed + cy*str*speed;
      sp.pos.z += (-cy)*fwd*speed + (-sy)*str*speed;
      sp.pos.y = clamp(sp.pos.y + ((input && input.jumpHeld) ? speed : 0) - ((input && input.crouch) ? speed : 0), 0.3, 35);
      const ws = this.level.worldSize ? this.level.worldSize() : null;
      if(ws){ sp.pos.x = clamp(sp.pos.x, 0.5, ws.w-0.5); sp.pos.z = clamp(sp.pos.z, 0.5, ws.h-0.5); }
      this.camera.position.copy(sp.pos);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(sp.pitch, sp.yaw, 0);
      this.camera.fov = this.settings.fov || 75;
      this.camera.updateProjectionMatrix();
    } else {
      const tpos = t.pos || t;
      this.camera.position.set(tpos.x, (t.pos ? t.pos.y : 0) + (t.crouching ? 1.1 : 1.58), tpos.z);
      this.camera.rotation.order = 'YXZ';
      const yaw = (t.aimYaw !== undefined ? t.aimYaw : t.yaw) || 0;
      const pitch = t.aimPitch || 0;
      this.camera.rotation.set(pitch, yaw, 0);
      this.camera.fov = this.settings.fov || 75;
      this.camera.updateProjectionMatrix();
      sp.pos.copy(this.camera.position);
      sp.yaw = yaw; sp.pitch = pitch;
    }
  }
  _updateFreeCam(dt, input){
    if(!this.modActive('freeCam') || !this.player.alive){ this.freeCam = null; return false; }
    if(!this.freeCam){
      this.freeCam = { pos: this.camera.position.clone(), yaw: this.player.yaw, pitch: this.player.pitch };
    }
    const f = this.freeCam;
    if(input && input.look){
      const sens = (this.settings.sensitivity || 1) * 0.0022;
      f.yaw -= input.look.dx * sens;
      f.pitch = clamp(f.pitch - input.look.dy * sens, -1.4, 1.4);
    }
    const mv = input && input.move ? input.move : { x:0, y:0 };
    const speed = (input && input.run ? 19 : 8.5) * dt;
    const cy = Math.cos(f.yaw), sy = Math.sin(f.yaw);
    const fwd = -mv.y, str = mv.x;
    f.pos.x += (-sy)*fwd*speed + cy*str*speed;
    f.pos.z += (-cy)*fwd*speed + (-sy)*str*speed;
    f.pos.y = clamp(f.pos.y + ((input && input.jumpHeld) ? speed : 0) - ((input && input.crouch) ? speed : 0), 0.3, 40);
    this.camera.position.copy(f.pos);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(f.pitch, f.yaw, 0);
    return true;
  }

  // ---------------- match update ----------------
  update(dt, input, fps){
    input = input || { look:{dx:0,dy:0}, move:{x:0,y:0}, run:false, crouch:false, jumpPressed:false, fire:false, firePressed:false, aim:false, reloadPressed:false, slotRequest:0, buyPressed:false };
    this._input = input;
    if(this.buyPause && this.hud && !this.hud.buyOpen) this.buyPause = false;
    if(this.paused || this.buyPause){
      if(this.hud){ this.hud.tick(dt); this.hud.update(this, fps||60); }
      return;
    }
    this.level.update(dt);
    this.effects.update(dt);

    // timers
    this.spreadHeat = Math.max(0, this.spreadHeat - dt*2.4);
    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.grenadeTimer = Math.max(0, this.grenadeTimer - dt);
    this.vmFlash = Math.max(0, this.vmFlash - dt*42);
    this.vmKick = Math.max(0, (this.vmKick||0) - dt*7);
    this.inspectT = Math.max(0, this.inspectT - dt);
    this.vmMuzzleLight.intensity = Math.max(0, this.vmMuzzleLight.intensity - dt*65);
    this.playerFlash = Math.max(0, this.playerFlash - dt*0.5);
    this.player.damageFlash = Math.max(0, this.player.damageFlash - dt*1.8);
    if(this.hud) this.hud.tick(dt);

    if(this.reload.active){
      this.reload.timer -= dt;
      if(this.reload.timer <= 0) this._finishReload();
    }

    // phase clock
    if(this.phase === 'buy'){
      this.clock -= dt;
      if(this.hud && this.player.frozen){
        const n = Math.ceil(this.clock);
        if(n !== this._lastBuyCountdown){ this._lastBuyCountdown = n; }
      }
      if(this.clock <= 0){ if(this.roundMode) this.beginLive(); }
    } else if(this.phase === 'live'){
      this.clock -= dt;
      if(this.roundMode){
        if(this.clock <= 0 && this.bomb.state !== 'planted') this.endRound('CT', 'Время вышло');
        const sec = Math.ceil(this.clock);
        if(sec <= 10 && sec !== this._lastCountdown && sec > 0){
          this._lastCountdown = sec;
          if(this.audio) this.audio.countdown(sec <= 3);
        }
      } else {
        if(this.clock <= 0){ this._endDM(); }
      }
    } else if(this.phase === 'over'){
      this.clock -= dt;
      if(this.clock <= 0 && !this.ended) this.beginRound();
    }

    if(this.phase === 'ended'){ if(this.hud) this.hud.update(this, fps||60); return; }

    // ---- player input ----
    if(input){
      if(input.buyPressed){
        if(this.canBuy() && this.hud){
          this.hud.toggleBuy(this);
          this.buyPause = this.hud.buyOpen;
          if(this.buyPause) input.exitLock && input.exitLock();
        }
      }
      if(this.modActive('aimbot')) this._updateAimAssist(dt);
      if(input.reloadPressed) this._startReload();
      if(input.inspectPressed) this._inspectWeapon();
      if(input.dropPressed) this._dropWeapon();
      if(input.slotCycle){
        const slots = [1,2,3,4].filter(n=>this.player.hasSlot(n));
        if(slots.length){
          const idx = slots.indexOf(this.player.currentSlot);
          const next = slots[(idx + (input.slotCycle > 0 ? 1 : slots.length-1)) % slots.length];
          if(this.player.switchSlot(next)){ this.reload.active=false; this.inspectT=0; this._rebuildViewmodel(); }
        }
      }
      if(input.lastSlotRequest){
        const alt = this.player.currentSlot === 1 ? 2 : 1;
        if(this.player.switchSlot(alt)){ this.reload.active=false; this.inspectT=0; this._rebuildViewmodel(); }
      }
      if(input.slotRequest){
        const n = input.slotRequest;
        if(n === 4){
          const kinds = Object.keys(this.player.grenades).filter(k=>this.player.grenades[k]>0);
          if(kinds.length){
            const idx = kinds.indexOf(this.player.currentGrenade);
            this.player.currentGrenade = kinds[(idx+1) % kinds.length];
            if(this.player.switchSlot(4)){ this.reload.active=false; this.inspectT=0; this._rebuildViewmodel(); }
          }
        } else if(this.player.switchSlot(n)){
          this.reload.active = false;
          this.inspectT = 0;
          this._rebuildViewmodel();
        }
      }
      this.player.aiming = !!input.aim;
      const w = this.player.getActiveWeapon();
      const auto = w && w.def && w.def.auto;
      if(this.player.alive && this.inspectT <= 0){
        if(auto ? input.fire : input.firePressed) this._firePlayer();
      }
    } else {
      this.player.aiming = false;
    }

    // ---- player movement ----
    this.player.frozen = (this.phase === 'buy');
    const lookOnly = this.phase === 'buy';
    if(lookOnly){
      const savedMove = { x: input ? input.move.x : 0, y: input ? input.move.y : 0 };
      const tmp = { look: input.look, move:{x:0,y:0}, run:false, crouch:input.crouch, jumpPressed:false, jumpHeld:false };
      this.player.update(dt, tmp, this.level);
      input.move.x = savedMove.x; input.move.y = savedMove.y;
    } else {
      this.player.update(dt, input || { look:{dx:0,dy:0}, move:{x:0,y:0}, run:false, crouch:false }, this.level);
    }

    this._applyMods();
    if(input && input.grenadeCycle){
      const kinds = Object.keys(this.player.grenades).filter(k=>this.player.grenades[k]>0);
      if(kinds.length){
        const idx = kinds.indexOf(this.player.currentGrenade);
        this.player.currentGrenade = kinds[(idx + (input.grenadeCycle > 0 ? 1 : kinds.length-1)) % kinds.length];
      }
    }
    if(!this._updateFreeCam(dt, input)) this._updateSpectator(dt, input);

    // zoom / fov (ADS for every weapon, true scopes for snipers)
    const w2 = this.player.getActiveWeapon();
    const def2 = w2 && w2.def;
    let zoom = 0;
    if(!this.spectate.active && !this.freeCam && this.player.aiming && def2 && def2.zoom > 1 && this.player.alive) zoom = def2.zoom;
    this.playerZoom = this.player.aiming ? zoom : 0;
    const baseFov = this.settings.fov || 75;
    const targetFov = zoom > 0 ? baseFov / zoom : (this.player.aiming ? baseFov - 7 : baseFov);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt*14);
    this.camera.updateProjectionMatrix();
    const adsMul = this.player.aiming ? (this.settings.aimSensitivity ?? 0.78) : 1;
    this.player.sens = (this.settings.sensitivity || 1) * adsMul * (zoom > 0 ? 0.35 : 1);

    // ---- viewmodel ----
    this._updateViewmodel(dt);

    // ---- fire zones ----
    for(let i=this.fireZones.length-1;i>=0;i--){
      const f = this.fireZones[i]; f.life -= dt;
      if(this.phase !== 'over' && this.phase !== 'ended'){
        for(const e of this._allEntities()){
          if(!e.alive) continue;
          const ex = e.pos? e.pos.x : e.x, ez = e.pos? e.pos.z : e.z;
          if(Math.hypot(ex-f.x, ez-f.z) < f.radius){
            const r = e.takeDamage(f.dps*dt, false, f.owner, 0, 'legs');
            if(e === this.player && this.hud) this.hud.hitDamage();
            if(r.killed) this._onKill(f.owner, e, 'Молотов', false, true);
          }
        }
      }
      if(f.life <= 0) this.fireZones.splice(i,1);
    }

    this._updateGrenades(dt);
    this._updateBomb(dt);
    this._updatePickups(dt);

    // ---- bots ----
    const world = {
      level: this.level,
      effects: this.effects,
      player: this.player,
      getEnemies: (bot)=> this.getEnemiesOf(bot),
      getAllies: (bot)=> this.getAlliesOf(bot),
      getObjective: (bot)=> this.getObjective(bot),
      findCover: (bot, threat)=> this.findCover(bot, threat),
      alertTeam: (bot, x, z)=> this.alertTeam(bot, x, z),
      botShoot: (bot, o, d, w, opts)=> this.botShoot(bot, o, d, w, opts),
      onReload: (bot)=>{
        bot.char.playReload(bot.weapon.reloadTime/1000);
        if(this.audio) this.audio.reloadAt(Math.hypot(bot.pos.x-this.player.x, bot.pos.z-this.player.z));
      },
      onBotShot: (bot)=>{ bot.char.playShoot(); },
      onBotFootstep: (bot, running)=>{
        if(!this.audio) return;
        const dx = bot.pos.x-this.player.x, dz = bot.pos.z-this.player.z;
        const dist = Math.hypot(dx,dz);
        if(dist > 17) return;
        const yaw = this.player.yaw;
        const pan = dist > 0.01 ? clamp((dx*Math.cos(yaw) + dz*(-Math.sin(yaw)))/dist, -0.8, 0.8) : 0;
        this.audio.footstepAt(dist, pan, running ? 1.05 : 0.7);
      }
    };
    for(const b of this.bots){
      b.update(dt, world);
    }

    // ---- respawns (DM/TDM/training) ----
    if(!this.roundMode){
      for(const b of this.bots){
        if(!b.alive){
          b.respawnTimer -= dt;
          if(b.respawnTimer <= 0){ this._respawnBot(b); }
        }
      }
      if(!this.player.alive && this.playerRespawnTimer > 0){
        this.playerRespawnTimer -= dt;
        if(this.playerRespawnTimer <= 0) this._respawnPlayer();
      }
    }

    if(this.roundMode && this.phase === 'live'){
      if(this.aliveCount('CT') === 0) this.endRound('T', 'Спецназ уничтожен');
      else if(this.bomb.state !== 'planted' && this.aliveCount('T') === 0) this.endRound('CT', 'Террористы уничтожены');
    }

    if(this.hud) this.hud.update(this, fps || 60);
  }

  _endDM(){
    let winner = 'CT';
    if(this.mode === 'deathmatch'){
      const all = this._allEntities();
      all.sort((a,b)=>b.kills-a.kills);
      winner = (all[0] === this.player) ? this.playerTeam : (this.playerTeam === 'CT' ? 'T' : 'CT');
      if(this.mode === 'training') winner = this.playerTeam;
    } else {
      winner = this.score.CT >= this.score.T ? 'CT' : 'T';
    }
    this.endMatch(winner);
  }

  _respawnPlayer(){
    const s = this.level.safeSpawn(this.playerTeam, this.getEnemiesOf(this.player));
    this.spectate.active = false; this.spectate.target = null; this.freeCam = null;
    this.player.alive = true;
    this.player.health = 100;
    this.player.y = 0; this.player.vy = 0; this.player.pitch = 0;
    this.player.recoilPitch = 0; this.player.recoilYaw = 0;
    this.player.deathT = 0;
    this.player.x = s.x; this.player.z = s.z; this.player.yaw = s.ang;
    this.player.pos.set(s.x, 0, s.z);
    this.player.moveVelX = 0; this.player.moveVelZ = 0;
    this.player.refillAmmo();
    this.playerRespawnTimer = 0;
    this.effects.spawnRing(new THREE.Vector3(s.x, 0.1, s.z), 0x6db6ff);
  }

  _respawnBot(b){
    const s = this.level.safeSpawn(b.team, this.getEnemiesOf(b));
    b.spawnAt(s.x, s.z, s.ang);
    b.respawnTimer = 0;
    this._botBuy(b);
    this.effects.spawnRing(new THREE.Vector3(s.x, 0.1, s.z), b.team === 'CT' ? 0x4fa3ff : 0xffb03a);
  }

  // ---------------- viewmodel animation ----------------
  _updateViewmodel(dt){
    if(!this.vm || !this.vmBase) return;
    const p = this.player;
    const w = p.getActiveWeapon();
    this.vmAction = Math.max(0, (this.vmAction || 0) - dt * 13);
    this.viewGroup.visible = !(this.playerZoom > 0);
    this.hands.visible = this.viewGroup.visible;
    if(!this.viewGroup.visible) return;
    const t = performance.now()/1000;
    const spd = Math.hypot(p.moveVelX||0, p.moveVelZ||0);
    const bobAmt = p.onGround ? Math.min(1, spd/6) : 0;
    const bobSpeed = p.running ? 12 : 8.6;
    const bobX = Math.sin(t*bobSpeed)*0.011*bobAmt;
    const bobY = Math.abs(Math.cos(t*bobSpeed))*0.009*bobAmt;
    let targetX = this.vmBase.x + bobX;
    let targetY = this.vmBase.y - bobY;
    let targetZ = this.vmBase.z + (this.vmKick||0)*0.055;
    let rotX = (this.vmKick||0)*0.22;
    let rotY = 0, rotZ = 0;

    // sprint pose
    if(p.running && !p.aiming && !this.reload.active && this.inspectT <= 0){
      targetY -= 0.055; targetZ += 0.05; rotY += 0.38; rotX -= 0.12; rotZ += 0.12;
    }
    // aim down sights
    if(p.aiming && !(this.playerZoom>0)){
      const aimX = 0.035, aimY = -0.115, aimZ = this.vmBase.z + 0.03;
      targetX += (aimX - targetX) * 0.55;
      targetY += (aimY - targetY) * 0.55;
      targetZ = aimZ;
      rotY *= 0.4;
    }
    // reload animation
    if(this.reload.active){
      const total = this.reload.total || (w && w.def ? w.def.reloadTime/1000 : 2);
      const k = clamp(1 - this.reload.timer/total, 0, 1);
      const swing = Math.sin(k*Math.PI);
      rotX += swing*0.85;
      rotZ += swing*0.24;
      targetY -= swing*0.14;
      targetZ += swing*0.03;
      this._animateGunParts(dt, k, 0);
    } else {
      this._animateGunParts(dt, 0, this.vmAction || 0);
    }
    // inspect animation
    if(this.inspectT > 0){
      const k = 1 - this.inspectT / Math.max(0.001, this.inspectTotal);
      const e = Math.sin(k*Math.PI);
      rotY += e*0.85;
      rotZ += e*0.45;
      rotX += e*0.35;
      targetX -= e*0.06;
      targetY += e*0.03;
    }
    // smooth transforms
    const k2 = Math.min(1, dt*18);
    this.viewGroup.position.x += (targetX - this.viewGroup.position.x) * k2;
    this.viewGroup.position.y += (targetY - this.viewGroup.position.y) * k2;
    this.viewGroup.position.z += (targetZ - this.viewGroup.position.z) * k2;
    this.viewGroup.rotation.x += (rotX - this.viewGroup.rotation.x) * k2;
    this.viewGroup.rotation.y += (rotY - this.viewGroup.rotation.y) * k2;
    this.viewGroup.rotation.z += (rotZ - this.viewGroup.rotation.z) * k2;

    if(this.vmFlashSprite){
      const op = Math.max(0, this.vmFlash || 0);
      this.vmFlashSprite.material.opacity = op*0.95;
      this.vmFlashSprite.scale.setScalar(0.16 + 0.22*op);
    }
    if(this.vm && this.vm.userData.muzzle){
      const wp = new THREE.Vector3();
      this.vm.userData.muzzle.getWorldPosition(wp);
      this.vmMuzzleLight.position.copy(this.camera.worldToLocal(wp));
    }
  }

  _animateGunParts(dt, k, firing=0){
    const parts = this.vm && this.vm.userData && this.vm.userData.parts;
    if(!parts) return;
    const smooth = Math.min(1, dt*16);
    const wave = k > 0 ? Math.sin(Math.min(1,k)*Math.PI) : 0;
    const cycle = k > 0 ? Math.sin(Math.min(1,k/0.55)*Math.PI) : Math.max(0, firing);
    const put = (part, dx, dy, dz)=>{
      if(!part || !part.userData.base) return;
      const b = part.userData.base;
      part.position.x += (b.x + dx - part.position.x) * smooth;
      part.position.y += (b.y + dy - part.position.y) * smooth;
      part.position.z += (b.z + dz - part.position.z) * smooth;
    };
    put(parts.slide, 0, 0, cycle * (parts.slide?.userData.travel || 0.06));
    put(parts.bolt, 0, 0, cycle * (parts.bolt?.userData.travel || 0.04));
    put(parts.mag, 0, -wave*0.17, wave*0.035);
    put(parts.pump, 0, 0, cycle*0.10);
  }

  crosshairSpread(){
    const w = this.player.getActiveWeapon();
    if(!w || !w.def) return 6;
    const spread = this._currentSpread(w.def);
    // Project the angular cone into screen pixels: the gap then matches the
    // actual hit cone instead of using a hard-coded multiplier.
    const halfH = (globalThis.innerHeight || 720) * 0.5;
    const halfFov = THREE.MathUtils.degToRad((this.camera.fov || 75) * 0.5);
    let base = Math.tan(Math.min(spread, 0.35)) * halfH / Math.max(0.05, Math.tan(halfFov));
    if(this.player.aiming) base *= 0.72;
    return clamp(base, 0.5, 42);
  }

  phaseLabel(){
    if(this.phase === 'buy') return 'ЗАКУПКА';
    if(this.phase === 'live') return this.roundMode ? (this.bomb.state === 'planted' ? 'БОМБА' : 'БОЙ') : 'БОЙ';
    if(this.phase === 'over') return 'КОНЕЦ РАУНДА';
    return 'МАТЧ ОКОНЧЕН';
  }
  modeLabel(){ return this.cfg.label; }
  difficultyLabel(){ return this.difficulty.name; }

  switchTeam(team){
    if(!['CT','T'].includes(team) || team === this.playerTeam || this.ended) return false;
    const old = this.playerTeam;
    const other = this.bots.find(b => b.team === team);
    if(other){
      other.team = old; other.agentId = this.agents[old];
      this.scene.remove(other.root);
      const replacement = createCharacter(old, other.weaponId, this.botSkin(other.weaponId), other.agentId);
      other.char = replacement; other.root = replacement.root; this.scene.add(other.root);
    }
    this.playerTeam = team; this.player.team = team; this.player.agentId = this.agents[team];
    this.reload.active = false; this.fireTimer = 0; this.inspectT = 0;
    this.spectate.active = false; this.freeCam = null;
    if(this.roundMode){ this.round = Math.max(0,this.round-1); this.beginRound(); }
    else { this._respawnPlayer(); if(other) this._respawnBot(other); this._rebuildViewmodel(); }
    return true;
  }

  setPaused(v){
    this.paused = v;
    if(v && this.hud){ this.hud.closeBuy(); this.buyPause = false; }
  }

  dispose(){
    for(const g of this.grenadesLive){ this.scene.remove(g.mesh); if(g.mesh.geometry) g.mesh.geometry.dispose(); if(g.mesh.material) g.mesh.material.dispose(); }
    this.grenadesLive = [];
    for(const it of this.pickups){ this.scene.remove(it.mesh); }
    this.pickups = [];
    this._clearBombMesh();
    this.effects.clear();
    for(const b of this.bots){ this.scene.remove(b.root); }
    this.bots = [];
    this.scene.remove(this.camera);
    if(this.vm) this.viewGroup.remove(this.vm);
    if(this.vmFlashSprite) this.vmFlashSprite.material.dispose();
    for(const m of this._vmMaterials) m.dispose();
    for(const m of this._handMaterials) m.dispose();
    this.level.dispose();
    this.scene.remove(this.viewGroup);
    this.scene.remove(this.vmMuzzleLight);
  }
}

function raySphere(ox,oy,oz,dx,dy,dz,cx,cy,cz,r){
  const lx=cx-ox, ly=cy-oy, lz=cz-oz;
  const tca = lx*dx+ly*dy+lz*dz;
  if(tca < 0) return -1;
  const d2 = (lx*lx+ly*ly+lz*lz) - tca*tca;
  const r2 = r*r;
  if(d2 > r2) return -1;
  const thc = Math.sqrt(r2-d2);
  const t0 = tca-thc;
  if(t0 >= 0) return t0;
  const t1 = tca+thc;
  return t1 >= 0 ? 0 : -1;
}
