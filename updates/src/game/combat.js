// Pure combat math shared by the player, bots and the HUD.
// Keeping this module free of THREE lets us unit-test balance headlessly.

export const HIT_ZONES = {
  head:  { key:'head',    y:1.62, r:0.205, mult:1,   name:'голова' },
  chest: { key:'chest',   y:1.22, r:0.335, mult:1,   name:'корпус' },
  belly: { key:'belly',   y:0.94, r:0.315, mult:1.12,name:'живот' },
  legs:  { key:'legs',    y:0.48, r:0.27,  mult:0.75,name:'ноги' }
};

export function hitSpheresAt(x, y, z, scale = 1, heightScale = 1){
  // heightScale compresses the vertical layout for crouching targets while
  // keeping their collider radii readable and fair.
  return Object.values(HIT_ZONES).map(z0 => ({
    x, y: y + z0.y * scale * heightScale, z, r: z0.r * scale,
    zone: z0.key,
    mult: z0.mult
  }));
}

export function damageFalloff(def, dist){
  const start = def.falloffStart ?? 18;
  const end = def.falloffEnd ?? (def.range || 60);
  const amount = def.falloff ?? 0.42;
  if(dist <= start) return 1;
  if(dist >= end) return Math.max(0.1, 1 - amount);
  return 1 - ((dist - start) / (end - start)) * amount;
}

// Returns final health damage and the amount of armor consumed.
// armorPen: 0..1, higher means the round ignores more protection.
export function computeDamage(def, zone, dist, armor = 0, helmet = false){
  const z = HIT_ZONES[zone] || HIT_ZONES.chest;
  let dmg = (def.dmg || 0) * damageFalloff(def, dist);
  dmg *= (zone === 'head' ? (def.headMult || 1) : z.mult);

  let armorLoss = 0;
  if(armor > 0 && zone !== 'legs'){
    const pen = clamp01(def.armorPen ?? 0.5);
    const reduction = (1 - pen) * 0.52;
    const after = dmg * (1 - reduction);
    armorLoss = Math.min(armor, (dmg - after) * 0.85);
    dmg -= armorLoss / 0.85;
  }
  if(zone === 'head' && helmet) dmg *= 0.78;
  return { dmg: Math.max(0, dmg), armorLoss };
}

// Current cone half-angle. All inputs are deliberately easy to reason about.
export function spreadFor(def, o = {}){
  const base = def.spread ?? 0.01;
  const speed = o.speed || 0;
  const moveMul = 1 + Math.min(1, speed / 5.4) * (def.moveSpread ?? 2.2);
  const airMul = o.airborne ? (def.airSpread ?? 6) : 1;
  const stanceMul = o.crouch ? 0.68 : 1;
  const aimMul = o.aiming ? (def.aimSpread ?? 0.52) : 1;
  const heat = o.heat || 0;
  const first = o.shotIndex === 0 ? (def.firstShotSpread ?? 0.45) : 1;
  return base * moveMul * airMul * stanceMul * aimMul * first + heat * 0.006;
}

export function recoilFor(def, shotIndex, rng = Math.random){
  const kick = def.recoil ?? 0.5;
  const pattern = def.recoilPattern || [0, 0.18, -0.24, 0.34, -0.36, 0.46, -0.5, 0.56, -0.4, 0.3];
  const h = pattern[shotIndex % pattern.length] * (def.recoilYaw ?? 0.34);
  const rise = 1 + Math.min(0.35, shotIndex * 0.012);
  return {
    pitch: kick * 0.0105 * rise * (0.92 + rng() * 0.16),
    yaw: h * 0.0105 * (0.85 + rng() * 0.3)
  };
}

export function weaponRangeFactor(def){
  return def.range || 60;
}

function clamp01(v){ return v < 0 ? 0 : (v > 1 ? 1 : v); }
