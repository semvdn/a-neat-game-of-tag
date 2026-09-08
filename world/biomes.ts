import type { BiomeId, BiomeSample, BiomeVisualStamp, PlatformState, TerrainRuntimeConfig } from '../types';

/** Visual RNG is intentionally independent from terrain/training RNG. */
export const DEFAULT_BIOME_WORLD_SEED = 0x54414731;
export const BIOME_REGION_LENGTH = 12_000;
export const BIOME_TRANSITION_LENGTH = 2_000;
export const BIOME_VISUAL_VERSION = 2;
export const BIOME_TERRAIN_VERSION = 1;
export const WORLD_GEN_VERSION = 1;

export interface BiomePalette {
  skyTop: string; skyBottom: string; haze: string; far: string; mid: string; near: string; detail: string;
  platformTop: string; platformFace: string; platformShadow: string; motionAccent: string;
}

export interface VisualBiomeDefinition {
  id: BiomeId;
  label: string;
  palette: BiomePalette;
  farDensity: number;
  midDensity: number;
  nearDensity: number;
}

export interface TerrainBiomeProfile {
  id: BiomeId;
  platformWidthMultiplier: number;
  verticalVariationMultiplier: number;
  gapMultiplier: number;
  branchWeightMultiplier: number;
  movingPlatformWeightMultiplier: number;
  movingPlatformSpeedMultiplier: number;
  crumbleWeightMultiplier: number;
  routePersistenceMultiplier: number;
}

const ALL_BIOMES: readonly BiomeId[] = [
  'lowlands', 'spires', 'foundry', 'ruins', 'desert', 'snowy-mountains', 'temperate-forest', 'city', 'rural-village', 'swamp',
];

const neutralTerrainProfile = (id: BiomeId): TerrainBiomeProfile => ({
  id,
  platformWidthMultiplier: 1,
  verticalVariationMultiplier: 1,
  gapMultiplier: 1,
  branchWeightMultiplier: 1,
  movingPlatformWeightMultiplier: 1,
  movingPlatformSpeedMultiplier: 1,
  crumbleWeightMultiplier: 1,
  routePersistenceMultiplier: 1,
});

/** ACTIVE phase-one profiles. These are deliberately neutral and mechanically identical. */
export const TERRAIN_BIOME_PROFILES: Record<BiomeId, TerrainBiomeProfile> = Object.fromEntries(
  ALL_BIOMES.map(id => [id, neutralTerrainProfile(id)])
) as Record<BiomeId, TerrainBiomeProfile>;

/**
 * FUTURE design targets only. Nothing in simulationCore consumes this table yet.
 * These values document the intended mechanical identity while keeping this build visual-only.
 */
export const PLANNED_TERRAIN_BIOME_PROFILES: Record<BiomeId, TerrainBiomeProfile> = {
  lowlands: { id: 'lowlands', platformWidthMultiplier: 1.2, verticalVariationMultiplier: 0.75, gapMultiplier: 0.95, branchWeightMultiplier: 1.25, movingPlatformWeightMultiplier: 0.65, movingPlatformSpeedMultiplier: 0.9, crumbleWeightMultiplier: 0.6, routePersistenceMultiplier: 1.2 },
  spires: { id: 'spires', platformWidthMultiplier: 0.86, verticalVariationMultiplier: 1.45, gapMultiplier: 1.02, branchWeightMultiplier: 1.2, movingPlatformWeightMultiplier: 1.05, movingPlatformSpeedMultiplier: 1, crumbleWeightMultiplier: 0.8, routePersistenceMultiplier: 0.95 },
  foundry: { id: 'foundry', platformWidthMultiplier: 1.0, verticalVariationMultiplier: 1.05, gapMultiplier: 1.0, branchWeightMultiplier: 0.9, movingPlatformWeightMultiplier: 2.25, movingPlatformSpeedMultiplier: 1.2, crumbleWeightMultiplier: 0.55, routePersistenceMultiplier: 1.0 },
  ruins: { id: 'ruins', platformWidthMultiplier: 0.9, verticalVariationMultiplier: 1.15, gapMultiplier: 1.05, branchWeightMultiplier: 1.15, movingPlatformWeightMultiplier: 0.7, movingPlatformSpeedMultiplier: 0.9, crumbleWeightMultiplier: 2.2, routePersistenceMultiplier: 0.9 },
  desert: { id: 'desert', platformWidthMultiplier: 1.12, verticalVariationMultiplier: 0.8, gapMultiplier: 1.12, branchWeightMultiplier: 0.8, movingPlatformWeightMultiplier: 0.45, movingPlatformSpeedMultiplier: 0.9, crumbleWeightMultiplier: 0.95, routePersistenceMultiplier: 1.2 },
  'snowy-mountains': { id: 'snowy-mountains', platformWidthMultiplier: 0.84, verticalVariationMultiplier: 1.6, gapMultiplier: 0.94, branchWeightMultiplier: 1.35, movingPlatformWeightMultiplier: 1.05, movingPlatformSpeedMultiplier: 0.9, crumbleWeightMultiplier: 0.7, routePersistenceMultiplier: 0.9 },
  'temperate-forest': { id: 'temperate-forest', platformWidthMultiplier: 1.05, verticalVariationMultiplier: 1.05, gapMultiplier: 0.95, branchWeightMultiplier: 1.45, movingPlatformWeightMultiplier: 0.7, movingPlatformSpeedMultiplier: 0.85, crumbleWeightMultiplier: 0.75, routePersistenceMultiplier: 1.05 },
  city: { id: 'city', platformWidthMultiplier: 1.0, verticalVariationMultiplier: 1.25, gapMultiplier: 0.98, branchWeightMultiplier: 1.05, movingPlatformWeightMultiplier: 1.75, movingPlatformSpeedMultiplier: 1.15, crumbleWeightMultiplier: 0.65, routePersistenceMultiplier: 1.0 },
  'rural-village': { id: 'rural-village', platformWidthMultiplier: 1.22, verticalVariationMultiplier: 0.72, gapMultiplier: 0.9, branchWeightMultiplier: 1.15, movingPlatformWeightMultiplier: 0.45, movingPlatformSpeedMultiplier: 0.8, crumbleWeightMultiplier: 0.65, routePersistenceMultiplier: 1.3 },
  swamp: { id: 'swamp', platformWidthMultiplier: 0.92, verticalVariationMultiplier: 0.7, gapMultiplier: 0.92, branchWeightMultiplier: 1.4, movingPlatformWeightMultiplier: 1.1, movingPlatformSpeedMultiplier: 0.68, crumbleWeightMultiplier: 1.15, routePersistenceMultiplier: 0.9 },
};

export const VISUAL_BIOMES: Record<BiomeId, VisualBiomeDefinition> = {
  lowlands: { id: 'lowlands', label: 'Lowlands', palette: { skyTop:'#111827', skyBottom:'#34413f', haze:'#55645b', far:'#25333a', mid:'#31423d', near:'#3d4c42', detail:'#7b7852', platformTop:'#69745f', platformFace:'#4d5a4e', platformShadow:'#2c3732', motionAccent:'#d5c86d' }, farDensity:.65, midDensity:.58, nearDensity:.42 },
  spires: { id: 'spires', label: 'Spires', palette: { skyTop:'#101422', skyBottom:'#30364b', haze:'#555d78', far:'#222b3d', mid:'#2d3850', near:'#38445d', detail:'#777da1', platformTop:'#66718b', platformFace:'#4b556d', platformShadow:'#2a3142', motionAccent:'#9dd7e8' }, farDensity:.88, midDensity:.66, nearDensity:.48 },
  foundry: { id: 'foundry', label: 'Foundry', palette: { skyTop:'#17171c', skyBottom:'#453a36', haze:'#6a5850', far:'#2a292c', mid:'#3b3433', near:'#4a3d39', detail:'#9b6949', platformTop:'#705d52', platformFace:'#514640', platformShadow:'#2e2a29', motionAccent:'#e6a34c' }, farDensity:.76, midDensity:.9, nearDensity:.7 },
  ruins: { id: 'ruins', label: 'Ruins', palette: { skyTop:'#151522', skyBottom:'#453f4e', haze:'#6c6572', far:'#2c2b39', mid:'#3b3947', near:'#4a4652', detail:'#8e826f', platformTop:'#756e72', platformFace:'#565158', platformShadow:'#302e35', motionAccent:'#c7b58a' }, farDensity:.7, midDensity:.72, nearDensity:.58 },
  desert: { id: 'desert', label: 'Desert', palette: { skyTop:'#30243a', skyBottom:'#8d6448', haze:'#b58a63', far:'#5b4742', mid:'#785446', near:'#8e6248', detail:'#d8b06d', platformTop:'#c49460', platformFace:'#8e674e', platformShadow:'#513f3a', motionAccent:'#f0d57a' }, farDensity:.58, midDensity:.5, nearDensity:.36 },
  'snowy-mountains': { id:'snowy-mountains', label:'Snowy Mountains', palette: { skyTop:'#101a2c', skyBottom:'#45596e', haze:'#8da8b7', far:'#27384a', mid:'#354b5d', near:'#435969', detail:'#d8e7ea', platformTop:'#d0dde0', platformFace:'#657785', platformShadow:'#334351', motionAccent:'#bdeeff' }, farDensity:.9, midDensity:.56, nearDensity:.42 },
  'temperate-forest': { id:'temperate-forest', label:'Temperate Forest', palette: { skyTop:'#0f2022', skyBottom:'#405b4c', haze:'#6e8370', far:'#233b36', mid:'#2d4b3d', near:'#3b5b46', detail:'#8e9d65', platformTop:'#718262', platformFace:'#4d614b', platformShadow:'#293b34', motionAccent:'#d6d78a' }, farDensity:.75, midDensity:.95, nearDensity:.86 },
  city: { id:'city', label:'City', palette: { skyTop:'#111528', skyBottom:'#4b465a', haze:'#766f7f', far:'#262b3a', mid:'#343947', near:'#454957', detail:'#b69d6f', platformTop:'#79808a', platformFace:'#585e68', platformShadow:'#30343c', motionAccent:'#ffd166' }, farDensity:.95, midDensity:.95, nearDensity:.75 },
  'rural-village': { id:'rural-village', label:'Rural Village', palette: { skyTop:'#152333', skyBottom:'#536958', haze:'#83927a', far:'#2c4542', mid:'#3d5549', near:'#526450', detail:'#c4a56d', platformTop:'#8b8068', platformFace:'#655b4c', platformShadow:'#393832', motionAccent:'#e7ca82' }, farDensity:.7, midDensity:.86, nearDensity:.72 },
  swamp: { id:'swamp', label:'Swamp', palette: { skyTop:'#101c22', skyBottom:'#39483f', haze:'#617162', far:'#263a36', mid:'#314940', near:'#405446', detail:'#8a8a5e', platformTop:'#65715a', platformFace:'#485646', platformShadow:'#28352f', motionAccent:'#b9c86a' }, farDensity:.62, midDensity:.9, nearDensity:.95 },
};

const floorMod = (value:number, divisor:number) => ((value % divisor) + divisor) % divisor;
const smoothstep01 = (value:number) => { const t=Math.max(0,Math.min(1,value)); return t*t*(3-2*t); };
function hash32(value:number):number { let x=value|0; x^=x>>>16; x=Math.imul(x,0x7feb352d); x^=x>>>15; x=Math.imul(x,0x846ca68b); x^=x>>>16; return x>>>0; }
export function biomeHash(seed:number, namespace:number, index:number):number { return hash32((seed ^ Math.imul(namespace|0,0x9e3779b1) ^ Math.imul(index|0,0x85ebca6b))|0); }
export function biomeRandom01(seed:number, namespace:number, index:number):number { return biomeHash(seed,namespace,index)/4294967296; }

function biomeCycle(seed:number):readonly BiomeId[] {
  const tail:BiomeId[] = ALL_BIOMES.filter(id => id !== 'lowlands');
  let state=biomeHash(seed,0x51b10e,0);
  for(let i=tail.length-1;i>0;i--){ state=hash32(state ^ Math.imul(i+1,0x9e3779b1)); const j=state%(i+1); [tail[i],tail[j]]=[tail[j],tail[i]]; }
  return ['lowlands', ...tail];
}
export function biomeForRegion(regionIndex:number, seed=DEFAULT_BIOME_WORLD_SEED):BiomeId { const cycle=biomeCycle(seed); return cycle[floorMod(regionIndex,cycle.length)]; }
export function getBiomeAtX(worldX:number, seed=DEFAULT_BIOME_WORLD_SEED):BiomeSample {
  const regionIndex=Math.floor(worldX/BIOME_REGION_LENGTH), regionStartX=regionIndex*BIOME_REGION_LENGTH;
  const localX=worldX-regionStartX, primary=biomeForRegion(regionIndex,seed), regionT=localX/BIOME_REGION_LENGTH;
  const transitionStart=BIOME_REGION_LENGTH-BIOME_TRANSITION_LENGTH;
  if(localX<transitionStart) return {primary,secondary:null,blend:0,regionIndex,regionT};
  return {primary,secondary:biomeForRegion(regionIndex+1,seed),blend:smoothstep01((localX-transitionStart)/BIOME_TRANSITION_LENGTH),regionIndex,regionT};
}
export function toBiomeVisualStamp(sample:BiomeSample):BiomeVisualStamp { return {primary:sample.primary,secondary:sample.secondary,blend:sample.blend,regionIndex:sample.regionIndex}; }
export function stampPlatformVisualBiome(platform:PlatformState, seed=DEFAULT_BIOME_WORLD_SEED):PlatformState { if(platform.visualBiome)return platform; const centerX=platform.position.x+platform.width*.5; return {...platform,visualBiome:toBiomeVisualStamp(getBiomeAtX(centerX,seed))}; }

const hexChannel=(value:string,offset:number)=>parseInt(value.slice(offset,offset+2),16);
export function mixHex(a:string,b:string,amount:number):string { const t=Math.max(0,Math.min(1,amount)); const lerp=(x:number,y:number)=>Math.round(x+(y-x)*t); const channel=(n:number)=>Math.max(0,Math.min(255,n)).toString(16).padStart(2,'0'); return `#${channel(lerp(hexChannel(a,1),hexChannel(b,1)))}${channel(lerp(hexChannel(a,3),hexChannel(b,3)))}${channel(lerp(hexChannel(a,5),hexChannel(b,5)))}`; }
export function paletteForBiomeSample(sample:Pick<BiomeSample,'primary'|'secondary'|'blend'>):BiomePalette { const a=VISUAL_BIOMES[sample.primary].palette; if(!sample.secondary||sample.blend<=0)return a; const b=VISUAL_BIOMES[sample.secondary].palette,t=sample.blend; return { skyTop:mixHex(a.skyTop,b.skyTop,t),skyBottom:mixHex(a.skyBottom,b.skyBottom,t),haze:mixHex(a.haze,b.haze,t),far:mixHex(a.far,b.far,t),mid:mixHex(a.mid,b.mid,t),near:mixHex(a.near,b.near,t),detail:mixHex(a.detail,b.detail,t),platformTop:mixHex(a.platformTop,b.platformTop,t),platformFace:mixHex(a.platformFace,b.platformFace,t),platformShadow:mixHex(a.platformShadow,b.platformShadow,t),motionAccent:mixHex(a.motionAccent,b.motionAccent,t)}; }
export function biomeLabel(sample:Pick<BiomeSample,'primary'|'secondary'|'blend'>):string { if(!sample.secondary||sample.blend<.08)return VISUAL_BIOMES[sample.primary].label; if(sample.blend>.92)return VISUAL_BIOMES[sample.secondary].label; return `${VISUAL_BIOMES[sample.primary].label} → ${VISUAL_BIOMES[sample.secondary].label}`; }

export function terrainProfileAtX(worldX:number, seed=DEFAULT_BIOME_WORLD_SEED):TerrainBiomeProfile { const sample=getBiomeAtX(worldX,seed),a=TERRAIN_BIOME_PROFILES[sample.primary]; if(!sample.secondary||sample.blend<=0)return a; const b=TERRAIN_BIOME_PROFILES[sample.secondary],t=sample.blend,m=(l:number,r:number)=>l+(r-l)*t; return { id:t<.5?a.id:b.id, platformWidthMultiplier:m(a.platformWidthMultiplier,b.platformWidthMultiplier), verticalVariationMultiplier:m(a.verticalVariationMultiplier,b.verticalVariationMultiplier), gapMultiplier:m(a.gapMultiplier,b.gapMultiplier), branchWeightMultiplier:m(a.branchWeightMultiplier,b.branchWeightMultiplier), movingPlatformWeightMultiplier:m(a.movingPlatformWeightMultiplier,b.movingPlatformWeightMultiplier), movingPlatformSpeedMultiplier:m(a.movingPlatformSpeedMultiplier,b.movingPlatformSpeedMultiplier), crumbleWeightMultiplier:m(a.crumbleWeightMultiplier,b.crumbleWeightMultiplier), routePersistenceMultiplier:m(a.routePersistenceMultiplier,b.routePersistenceMultiplier) }; }
export function terrainRuntimeForBiomeX(base:TerrainRuntimeConfig, worldX:number, seed=DEFAULT_BIOME_WORLD_SEED):TerrainRuntimeConfig { const p=terrainProfileAtX(worldX,seed); const neutral=p.branchWeightMultiplier===1&&p.movingPlatformWeightMultiplier===1&&p.movingPlatformSpeedMultiplier===1; if(neutral)return base; return {...base,branchSpawnChance:Math.max(0,Math.min(1,base.branchSpawnChance*p.branchWeightMultiplier)),movingSpawnChance:Math.max(0,Math.min(1,base.movingSpawnChance*p.movingPlatformWeightMultiplier)),movingPlatformMaxSpeed:Math.max(0,base.movingPlatformMaxSpeed*p.movingPlatformSpeedMultiplier)}; }
