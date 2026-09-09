import type { BiomeId, BiomeSample } from '../types';
import { WORLD_REF_HEIGHT } from '../constants';
import { BIOME_VISUAL_VERSION, biomeHash, biomeRandom01, getBiomeAtX, mixHex, paletteForBiomeSample, VISUAL_BIOMES } from '../world/biomes';

const BACKGROUND_CHUNK_WIDTH = 600;
const MAX_DESCRIPTOR_CACHE = 96;
const RIDGE_SEGMENTS = 8;
const NS_FAR=0x464152, NS_MID=0x4d4944, NS_NEAR=0x4e4541, NS_FORE=0x464f52;

type Layer = 'far'|'mid'|'near'|'foreground';
interface FeatureDescriptor { x:number; scale:number; variant:number; yJitter:number; flipX:boolean; }
interface BackgroundChunkDescriptor { chunkIndex:number; layer:Layer; ridge:number[]; features:FeatureDescriptor[]; }
interface BackgroundDrawOptions { cameraCenterX:number; cameraCenterY:number; cameraScale:number; cssWidth:number; cssHeight:number; worldSeed:number; }

const parallaxByLayer={far:.13,mid:.31,near:.58} as const;
const namespaceForLayer=(layer:Layer)=>layer==='far'?NS_FAR:layer==='mid'?NS_MID:layer==='near'?NS_NEAR:NS_FORE;
const dominantBiome=(sample:BiomeSample):BiomeId=>sample.secondary&&sample.blend>=.5?sample.secondary:sample.primary;
const snap=(v:number,g=2)=>Math.round(v/g)*g;
function rgba(hex:string,alpha:number){const h=hex.replace('#','');const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);return `rgba(${r}, ${g}, ${b}, ${alpha})`;}

function visualVariantForBiome(biome:BiomeId,layer:Layer,hash:number):number{
  // Landmark variants are intentionally weighted. Rare silhouettes (windmills, chalets, etc.)
  // should punctuate a biome rather than repeat every few hundred pixels.
  if(biome==='rural-village'&&layer!=='far'){
    const choices=[0,1,2,3,4,6,0,1,2,3,4,6,0,1,2,5];
    return choices[hash%choices.length];
  }
  if(biome==='snowy-mountains'&&layer!=='far'){
    const choices=[1,2,3,4,5,1,2,3,4,5,6,2];
    return choices[hash%choices.length];
  }
  if(biome==='desert'&&layer!=='far'){
    const choices=[0,1,2,3,4,1,2,3,4,1];
    return choices[hash%choices.length];
  }
  return hash%7;
}

function drawPixelDisc(ctx:CanvasRenderingContext2D,cx:number,cy:number,r:number,color:string){ctx.fillStyle=color;const rows=[.62,.86,1,1,.86,.62];for(let i=0;i<rows.length;i++){const hh=Math.max(2,Math.round((r*2)/rows.length)),ww=Math.round(r*2*rows[i]),yy=Math.round(cy-r+i*hh);ctx.fillRect(snap(cx-ww*.5),snap(yy),snap(ww),hh+1);}}

export class BiomeBackgroundCache {
  private chunks=new Map<string,BackgroundChunkDescriptor>();
  clear(){this.chunks.clear();}
  get size(){return this.chunks.size;}
  getChunk(layer:Layer,chunkIndex:number,seed:number):BackgroundChunkDescriptor{
    const key=`v${BIOME_VISUAL_VERSION}:${seed}:${layer}:${chunkIndex}`;const existing=this.chunks.get(key);
    if(existing){this.chunks.delete(key);this.chunks.set(key,existing);return existing;}
    const descriptor=this.generateChunk(layer,chunkIndex,seed);this.chunks.set(key,descriptor);
    if(this.chunks.size>MAX_DESCRIPTOR_CACHE){const oldest=this.chunks.keys().next().value as string|undefined;if(oldest)this.chunks.delete(oldest);}
    return descriptor;
  }
  private generateChunk(layer:Layer,chunkIndex:number,seed:number):BackgroundChunkDescriptor{
    const namespace=namespaceForLayer(layer),ridge:number[]=[];
    for(let i=0;i<=RIDGE_SEGMENTS;i++){const globalNode=chunkIndex*RIDGE_SEGMENTS+i;ridge.push(.28+biomeRandom01(seed,namespace^0x726964,globalNode)*.58);}
    const centerX=(chunkIndex+.5)*BACKGROUND_CHUNK_WIDTH,sample=getBiomeAtX(centerX,seed),biomeId=dominantBiome(sample),biome=VISUAL_BIOMES[biomeId];
    const density=layer==='far'?biome.farDensity:layer==='mid'?biome.midDensity:layer==='near'?biome.nearDensity:biome.nearDensity*.55;
    const minFeatures=layer==='far'?0:layer==='foreground'?0:1;
    const maxFeatures=layer==='far'?2:layer==='mid'?5:layer==='near'?4:2;
    const count=Math.max(minFeatures,Math.min(maxFeatures,Math.round(
      minFeatures+density*(maxFeatures-minFeatures)+(biomeRandom01(seed,namespace,chunkIndex)-.5)*.9
    )));
    const features:FeatureDescriptor[]=[];
    // Place assets in jittered slots instead of independent random X positions. This keeps the
    // procedural look while avoiding the accidental clumps/near-duplicates that made otherwise
    // good silhouettes read like stretched stamps. Size is one scalar only; aspect ratio lives in
    // the asset profile below and is therefore never randomized independently.
    for(let i=0;i<count;i++){
      const k=chunkIndex*37+i;
      const slotCenter=(i+.5)/count;
      const slotJitter=(biomeRandom01(seed,namespace^0x78,k)-.5)*Math.min(.7/count,.16);
      const x=Math.max(.06,Math.min(.94,slotCenter+slotJitter));
      const featureBiome=dominantBiome(getBiomeAtX(chunkIndex*BACKGROUND_CHUNK_WIDTH+x*BACKGROUND_CHUNK_WIDTH,seed));
      features.push({
        x,
        scale:.86+biomeRandom01(seed,namespace^0x77,k)*.28,
        variant:visualVariantForBiome(featureBiome,layer,biomeHash(seed,namespace^0x76,k)),
        yJitter:biomeRandom01(seed,namespace^0x79,k)*2-1,
        flipX:(biomeHash(seed,namespace^0x6d6972,k)&1)===1,
      });
    }
    return {chunkIndex,layer,ridge,features};
  }
}

function drawSkyBands(ctx:CanvasRenderingContext2D,o:BackgroundDrawOptions){
  const {cssWidth,cssHeight,cameraCenterX,worldSeed}=o,sample=getBiomeAtX(cameraCenterX,worldSeed),palette=paletteForBiomeSample(sample),biome=dominantBiome(sample);
  const bands=14;for(let i=0;i<bands;i++){const t0=i/bands,t1=(i+1)/bands;ctx.fillStyle=mixHex(palette.skyTop,palette.skyBottom,Math.round(t0*8)/8);ctx.fillRect(0,Math.floor(cssHeight*t0),cssWidth,Math.ceil(cssHeight*(t1-t0))+1);}

  // Large celestial accents are intentionally blocky and low-contrast so agents remain focal.
  if(biome==='desert'){
    const r=Math.max(18,Math.round(cssHeight*.055));drawPixelDisc(ctx,cssWidth*.76,cssHeight*.16,r,rgba('#f6cf7a',.7));
  } else if(biome==='snowy-mountains'){
    const r=Math.max(14,Math.round(cssHeight*.04));drawPixelDisc(ctx,cssWidth*.78,cssHeight*.14,r,rgba('#dcebf2',.28));
  } else if(biome==='swamp'){
    ctx.fillStyle=rgba(palette.haze,.11);ctx.fillRect(0,snap(cssHeight*.38),cssWidth,snap(cssHeight*.08));ctx.fillRect(0,snap(cssHeight*.52),cssWidth,snap(cssHeight*.05));
  }

  const starSpacing=240,starParallax=.045,halfStarWorld=cssWidth*.62/Math.max(.0001,o.cameraScale*starParallax),starStart=Math.floor((cameraCenterX-halfStarWorld)/starSpacing)-2,starCount=Math.ceil((halfStarWorld*2)/starSpacing)+6;
  if(biome!=='city' && biome!=='desert'){
    ctx.fillStyle=rgba(palette.haze,.34);
    for(let i=0;i<starCount;i++){const starIndex=starStart+i,worldX=starIndex*starSpacing+biomeRandom01(worldSeed,0x53544152,starIndex)*70,screenX=cssWidth*.5+(worldX-cameraCenterX)*o.cameraScale*starParallax;if(screenX<-8||screenX>cssWidth+8)continue;const y=cssHeight*(.08+biomeRandom01(worldSeed,0x535459,starIndex)*.34),size=biomeRandom01(worldSeed,0x535453,starIndex)>.84?3:2;ctx.fillRect(snap(screenX),snap(y),size,size);}
  }
}

function rectTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  w: number,
  h: number,
  color: string,
  detail: string,
  broad = false,
) {
  ctx.fillStyle = color;
  const trunk = Math.max(3, snap(w * (broad ? 0.09 : 0.1)));
  ctx.fillRect(snap(x + w * 0.47), snap(baseY - h * 0.54), trunk, snap(h * 0.54));
  if (broad) {
    // Broad crowns use staggered blocks so they read as foliage rather than a rectangular skyline.
    ctx.fillRect(snap(x + w * 0.12), snap(baseY - h * 0.72), snap(w * 0.76), snap(h * 0.19));
    ctx.fillRect(snap(x + w * 0.23), snap(baseY - h * 0.9), snap(w * 0.55), snap(h * 0.2));
    ctx.fillRect(snap(x + w * 0.02), snap(baseY - h * 0.61), snap(w * 0.92), snap(h * 0.15));
    ctx.fillRect(snap(x + w * 0.32), snap(baseY - h), snap(w * 0.36), snap(h * 0.12));
  } else {
    for (let i = 0; i < 4; i++) {
      const yy = baseY - h * (0.3 + i * 0.15);
      const ww = w * (0.9 - i * 0.15);
      ctx.fillRect(snap(x + (w - ww) / 2), snap(yy), snap(ww), snap(h * 0.14));
    }
  }
  ctx.fillStyle = rgba(detail, 0.24);
  ctx.fillRect(snap(x + w * 0.31), snap(baseY - h * 0.72), Math.max(2, snap(w * 0.07)), Math.max(2, snap(h * 0.05)));
}

function drawLowland(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  if (layer === 'far') {
    // Small copses instead of a wall of tree spikes.
    ctx.fillStyle = c;
    const crownY = b - h * 0.42;
    ctx.fillRect(snap(x + w * 0.08), snap(crownY), snap(w * 0.34), snap(h * 0.26));
    ctx.fillRect(snap(x + w * 0.31), snap(crownY - h * 0.12), snap(w * 0.37), snap(h * 0.38));
    ctx.fillRect(snap(x + w * 0.62), snap(crownY + h * 0.03), snap(w * 0.28), snap(h * 0.23));
    return;
  }
  const kind = v % 5;
  if (kind === 0) {
    // Low hedge / scrub mass gives the biome horizontal visual weight.
    ctx.fillStyle = c;
    ctx.fillRect(snap(x + w * 0.04), snap(b - h * 0.28), snap(w * 0.92), snap(h * 0.28));
    ctx.fillRect(snap(x + w * 0.16), snap(b - h * 0.41), snap(w * 0.3), snap(h * 0.15));
    ctx.fillRect(snap(x + w * 0.58), snap(b - h * 0.37), snap(w * 0.25), snap(h * 0.11));
  } else if (kind === 2) {
    // Poplar pair — narrow vertical punctuation, but much shorter than Spires architecture.
    const tw = Math.max(3, snap(w * 0.07));
    for (const [ox, scale] of [[0.28, 0.85], [0.58, 0.68]] as const) {
      ctx.fillStyle = c;
      ctx.fillRect(snap(x + w * ox), snap(b - h * 0.5 * scale), tw, snap(h * 0.5 * scale));
      ctx.fillRect(snap(x + w * (ox - 0.1)), snap(b - h * 0.82 * scale), snap(w * 0.22), snap(h * 0.36 * scale));
    }
  } else if (kind === 3) {
    // Grass-covered stone mound: a low landmark that keeps the horizon open.
    ctx.fillStyle = c;
    ctx.fillRect(snap(x + w * 0.12), snap(b - h * 0.22), snap(w * 0.76), snap(h * 0.22));
    ctx.fillRect(snap(x + w * 0.26), snap(b - h * 0.34), snap(w * 0.42), snap(h * 0.13));
    ctx.fillStyle = rgba(d, 0.26);
    ctx.fillRect(snap(x + w * 0.18), snap(b - h * 0.22), snap(w * 0.54), 3);
  } else {
    rectTree(ctx, x, b, w, h, c, d, true);
  }
}

function drawSpire(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle = c;
  const kind = v % 5;
  if (kind === 1 && layer !== 'far') {
    // Twin towers connected by a narrow high bridge.
    const towerW = Math.max(7, snap(w * 0.22));
    for (const ox of [0.2, 0.6]) {
      const bx = snap(x + w * ox);
      ctx.fillRect(bx, snap(b - h * 0.64), towerW, snap(h * 0.64));
      ctx.beginPath();
      ctx.moveTo(bx - 2, snap(b - h * 0.64));
      ctx.lineTo(snap(bx + towerW * 0.5), snap(b - h * 0.92));
      ctx.lineTo(bx + towerW + 2, snap(b - h * 0.64));
      ctx.closePath(); ctx.fill();
    }
    ctx.fillRect(snap(x + w * 0.29), snap(b - h * 0.4), snap(w * 0.44), Math.max(4, snap(h * 0.07)));
    return;
  }
  if (kind === 2 && layer !== 'far') {
    // Open gate/arch: broad base and negative space keep it distinct from the needle towers.
    const colW = Math.max(7, snap(w * 0.18));
    ctx.fillRect(snap(x + w * 0.12), snap(b - h * 0.56), colW, snap(h * 0.56));
    ctx.fillRect(snap(x + w * 0.7), snap(b - h * 0.56), colW, snap(h * 0.56));
    ctx.fillRect(snap(x + w * 0.12), snap(b - h * 0.58), snap(w * 0.76), Math.max(6, snap(h * 0.1)));
    ctx.beginPath();
    ctx.moveTo(snap(x + w * 0.2), snap(b - h * 0.58));
    ctx.lineTo(snap(x + w * 0.5), snap(b - h * 0.82));
    ctx.lineTo(snap(x + w * 0.8), snap(b - h * 0.58));
    ctx.closePath(); ctx.fill();
    return;
  }
  if (kind === 4 && layer !== 'far') {
    // Cluster of three smaller pinnacles.
    const specs = [[0.16, 0.56, 0.18], [0.42, 0.76, 0.2], [0.68, 0.48, 0.16]] as const;
    for (const [ox, hh, ww] of specs) {
      const bx = x + w * ox;
      ctx.fillRect(snap(bx), snap(b - h * hh), snap(w * ww), snap(h * hh));
      ctx.beginPath();
      ctx.moveTo(snap(bx - w * 0.02), snap(b - h * hh));
      ctx.lineTo(snap(bx + w * ww * 0.5), snap(b - h * (hh + 0.18)));
      ctx.lineTo(snap(bx + w * ww + w * 0.02), snap(b - h * hh));
      ctx.closePath(); ctx.fill();
    }
    return;
  }

  const bodyW = Math.max(9, snap(w * (kind === 3 ? 0.42 : 0.35)));
  const bx = snap(x + (w - bodyW) * 0.5);
  const shoulderY = b - h * (kind === 3 ? 0.6 : 0.67);
  ctx.fillRect(bx, snap(shoulderY), bodyW, snap(b - shoulderY));
  ctx.fillRect(snap(bx - bodyW * 0.26), snap(b - h * 0.27), snap(bodyW * 1.52), snap(h * 0.27));
  ctx.beginPath();
  ctx.moveTo(bx - 3, snap(shoulderY));
  ctx.lineTo(snap(x + w * 0.5), snap(b - h * (kind === 3 ? 0.86 : 1)));
  ctx.lineTo(bx + bodyW + 3, snap(shoulderY));
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba(d, 0.34);
  for (let yy = b - h * 0.52; yy < b - h * 0.12; yy += Math.max(9, h * 0.18)) {
    ctx.fillRect(snap(bx + bodyW * 0.38), snap(yy), Math.max(2, snap(bodyW * 0.22)), 3);
  }
}

function drawFoundry(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle = c;
  const kind = v % 4;
  if (kind === 0) {
    // Furnace hall + one substantial stack.
    ctx.fillRect(snap(x + w * 0.08), snap(b - h * 0.42), snap(w * 0.72), snap(h * 0.42));
    ctx.fillRect(snap(x + w * 0.58), snap(b - h * 0.9), snap(w * 0.16), snap(h * 0.52));
    ctx.fillRect(snap(x + w * 0.55), snap(b - h * 0.92), snap(w * 0.22), Math.max(4, snap(h * 0.06)));
    ctx.fillStyle = rgba(d, 0.3);
    ctx.fillRect(snap(x + w * 0.14), snap(b - h * 0.3), snap(w * 0.35), Math.max(4, snap(h * 0.08)));
  } else if (kind === 1) {
    // Storage tank with a short pipe run.
    const tankX = x + w * 0.17, tankW = w * 0.5;
    ctx.fillRect(snap(tankX), snap(b - h * 0.53), snap(tankW), snap(h * 0.53));
    ctx.fillRect(snap(tankX + tankW * 0.1), snap(b - h * 0.6), snap(tankW * 0.8), snap(h * 0.08));
    ctx.fillRect(snap(x + w * 0.67), snap(b - h * 0.3), snap(w * 0.26), Math.max(4, snap(h * 0.08)));
    ctx.fillRect(snap(x + w * 0.84), snap(b - h * 0.3), Math.max(4, snap(w * 0.06)), snap(h * 0.22));
  } else if (kind === 2 && layer !== 'far') {
    // Gantry/crane silhouette — broad rather than another vertical chimney.
    const legW = Math.max(4, snap(w * 0.07));
    ctx.fillRect(snap(x + w * 0.18), snap(b - h * 0.64), legW, snap(h * 0.64));
    ctx.fillRect(snap(x + w * 0.7), snap(b - h * 0.48), legW, snap(h * 0.48));
    ctx.fillRect(snap(x + w * 0.16), snap(b - h * 0.66), snap(w * 0.64), Math.max(5, snap(h * 0.08)));
    ctx.fillRect(snap(x + w * 0.48), snap(b - h * 0.58), 3, snap(h * 0.22));
  } else {
    // Sawtooth factory roof.
    ctx.fillRect(snap(x + w * 0.06), snap(b - h * 0.38), snap(w * 0.88), snap(h * 0.38));
    for (let i = 0; i < 3; i++) {
      const sx = x + w * (0.1 + i * 0.27);
      ctx.beginPath();
      ctx.moveTo(snap(sx), snap(b - h * 0.38));
      ctx.lineTo(snap(sx + w * 0.11), snap(b - h * 0.52));
      ctx.lineTo(snap(sx + w * 0.21), snap(b - h * 0.38));
      ctx.closePath(); ctx.fill();
    }
  }
}

function drawRuins(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle = c;
  const kind = v % 4;
  if (kind === 0) {
    // Broken arch with asymmetric surviving sides.
    const colW = Math.max(6, snap(w * 0.16));
    ctx.fillRect(snap(x + w * 0.12), snap(b - h * 0.68), colW, snap(h * 0.68));
    ctx.fillRect(snap(x + w * 0.72), snap(b - h * 0.52), colW, snap(h * 0.52));
    ctx.fillRect(snap(x + w * 0.12), snap(b - h * 0.68), snap(w * 0.76), Math.max(6, snap(h * 0.12)));
    ctx.fillStyle = rgba(d, 0.18);
    ctx.fillRect(snap(x + w * 0.36), snap(b - h * 0.46), snap(w * 0.28), snap(h * 0.46));
  } else if (kind === 1) {
    // Column pair and fragmentary lintel.
    const colW = Math.max(6, snap(w * 0.14));
    ctx.fillRect(snap(x + w * 0.22), snap(b - h * 0.72), colW, snap(h * 0.72));
    ctx.fillRect(snap(x + w * 0.62), snap(b - h * 0.64), colW, snap(h * 0.64));
    ctx.fillRect(snap(x + w * 0.17), snap(b - h * 0.74), snap(w * 0.56), Math.max(4, snap(h * 0.07)));
  } else if (kind === 2) {
    // Collapsed wall with deliberately irregular skyline.
    ctx.fillRect(snap(x + w * 0.06), snap(b - h * 0.34), snap(w * 0.86), snap(h * 0.34));
    ctx.fillRect(snap(x + w * 0.12), snap(b - h * 0.53), snap(w * 0.24), snap(h * 0.2));
    ctx.fillRect(snap(x + w * 0.55), snap(b - h * 0.46), snap(w * 0.18), snap(h * 0.13));
    ctx.fillStyle = rgba(d, 0.22);
    ctx.fillRect(snap(x + w * 0.36), snap(b - h * 0.25), snap(w * 0.14), snap(h * 0.25));
  } else {
    // Broken tower, broader than Spires and visibly incomplete.
    ctx.fillRect(snap(x + w * 0.27), snap(b - h * 0.72), snap(w * 0.42), snap(h * 0.72));
    ctx.fillStyle = rgba(d, 0.24);
    ctx.fillRect(snap(x + w * 0.37), snap(b - h * 0.52), snap(w * 0.12), snap(h * 0.14));
    ctx.fillRect(snap(x + w * 0.52), snap(b - h * 0.31), snap(w * 0.09), snap(h * 0.1));
    ctx.fillRect(snap(x + w * 0.27), snap(b - h * 0.78), snap(w * 0.13), snap(h * 0.08));
  }
}

function drawDesert(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle = c;
  if (layer === 'far') {
    // Broad stepped mesas with different shoulder heights.
    const top = b - h * (0.38 + (v % 3) * 0.055);
    ctx.fillRect(snap(x + w * 0.08), snap(top + h * 0.1), snap(w * 0.84), snap(b - top - h * 0.1));
    ctx.fillRect(snap(x + w * 0.2), snap(top), snap(w * 0.53), snap(h * 0.16));
    if (v % 2 === 0) ctx.fillRect(snap(x + w * 0.32), snap(top - h * 0.1), snap(w * 0.24), snap(h * 0.12));
    ctx.fillStyle = rgba(d, 0.16);
    ctx.fillRect(snap(x + w * 0.2), snap(top + h * 0.2), snap(w * 0.48), 4);
    return;
  }
  const kind = v % 5;
  if (kind === 0) {
    // Saguaro: deliberately slender and clearly organic.
    const trunkW = Math.max(4, snap(w * 0.1));
    const tx = snap(x + w * 0.47);
    ctx.fillRect(tx, snap(b - h * 0.76), trunkW, snap(h * 0.76));
    ctx.fillRect(snap(tx - w * 0.22), snap(b - h * 0.5), snap(w * 0.23), trunkW);
    ctx.fillRect(snap(tx - w * 0.22), snap(b - h * 0.5), trunkW, snap(h * 0.2));
    ctx.fillRect(snap(tx + trunkW), snap(b - h * 0.38), snap(w * 0.24), trunkW);
    ctx.fillRect(snap(tx + w * 0.21), snap(b - h * 0.54), trunkW, snap(h * 0.18));
  } else if (kind === 1 || kind === 4) {
    // Layered boulders: low, broad counterweight to the cactus.
    ctx.fillRect(snap(x + w * 0.06), snap(b - h * 0.28), snap(w * 0.88), snap(h * 0.28));
    ctx.fillRect(snap(x + w * 0.18), snap(b - h * 0.43), snap(w * 0.56), snap(h * 0.17));
    ctx.fillRect(snap(x + w * 0.42), snap(b - h * 0.52), snap(w * 0.29), snap(h * 0.1));
  } else if (kind === 2) {
    // Eroded arch with a generous opening.
    ctx.fillRect(snap(x + w * 0.1), snap(b - h * 0.54), snap(w * 0.18), snap(h * 0.54));
    ctx.fillRect(snap(x + w * 0.72), snap(b - h * 0.46), snap(w * 0.16), snap(h * 0.46));
    ctx.fillRect(snap(x + w * 0.1), snap(b - h * 0.54), snap(w * 0.78), snap(h * 0.13));
  } else {
    // Split hoodoo pair.
    ctx.fillRect(snap(x + w * 0.22), snap(b - h * 0.58), snap(w * 0.18), snap(h * 0.58));
    ctx.fillRect(snap(x + w * 0.17), snap(b - h * 0.61), snap(w * 0.29), snap(h * 0.1));
    ctx.fillRect(snap(x + w * 0.61), snap(b - h * 0.42), snap(w * 0.14), snap(h * 0.42));
    ctx.fillRect(snap(x + w * 0.56), snap(b - h * 0.45), snap(w * 0.24), snap(h * 0.08));
  }
  ctx.fillStyle = rgba(d, 0.24);
  ctx.fillRect(snap(x + w * 0.2), snap(b - h * 0.16), snap(w * 0.52), 3);
}

function drawSnowyMountain(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  if (layer === 'far') {
    ctx.fillStyle = c;
    const peak = 0.42 + (v % 3) * 0.07;
    ctx.beginPath();
    ctx.moveTo(snap(x), snap(b));
    ctx.lineTo(snap(x + w * peak), snap(b - h));
    ctx.lineTo(snap(x + w), snap(b));
    ctx.closePath(); ctx.fill();
    // Snow cap follows the peak rather than forming an oversized white triangle.
    ctx.fillStyle = rgba(d, 0.68);
    ctx.beginPath();
    ctx.moveTo(snap(x + w * peak), snap(b - h));
    ctx.lineTo(snap(x + w * (peak - 0.14)), snap(b - h * 0.69));
    ctx.lineTo(snap(x + w * (peak - 0.03)), snap(b - h * 0.74));
    ctx.lineTo(snap(x + w * (peak + 0.07)), snap(b - h * 0.65));
    ctx.lineTo(snap(x + w * (peak + 0.17)), snap(b - h * 0.71));
    ctx.closePath(); ctx.fill();
    return;
  }
  if (v % 6 === 0) {
    // Small chalet breaks up endless conifers.
    ctx.fillStyle = c;
    ctx.fillRect(snap(x + w * 0.18), snap(b - h * 0.31), snap(w * 0.64), snap(h * 0.31));
    ctx.fillStyle = rgba(d, 0.64);
    ctx.beginPath();
    ctx.moveTo(snap(x + w * 0.08), snap(b - h * 0.31));
    ctx.lineTo(snap(x + w * 0.5), snap(b - h * 0.53));
    ctx.lineTo(snap(x + w * 0.92), snap(b - h * 0.31));
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba('#17222d', 0.5);
    ctx.fillRect(snap(x + w * 0.44), snap(b - h * 0.18), snap(w * 0.14), snap(h * 0.18));
  } else if (v % 4 === 1) {
    // Pair of pines at different heights.
    rectTree(ctx, x, b, w * 0.58, h * 0.9, c, d, false);
    rectTree(ctx, x + w * 0.43, b, w * 0.52, h * 0.7, c, d, false);
  } else {
    rectTree(ctx, x, b, w, h, c, d, false);
  }
}

function drawTemperateForest(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  if (layer === 'far') {
    // Rolling overlapping crowns with visible gaps; no rectangular skyline wall.
    ctx.fillStyle = c;
    const crowns = [
      [0.02, 0.58, 0.35, 0.3], [0.24, 0.72, 0.38, 0.42], [0.52, 0.62, 0.34, 0.34], [0.7, 0.75, 0.27, 0.44],
    ];
    for (const [ox, top, ww, hh] of crowns) {
      ctx.fillRect(snap(x + w * ox), snap(b - h * top), snap(w * ww), snap(h * hh));
    }
    return;
  }
  if (v % 5 === 0) {
    // Fallen log / understorey cluster adds a low form to the tree vocabulary.
    ctx.fillStyle = c;
    ctx.fillRect(snap(x + w * 0.08), snap(b - h * 0.18), snap(w * 0.82), snap(h * 0.13));
    ctx.fillRect(snap(x + w * 0.15), snap(b - h * 0.29), snap(w * 0.23), snap(h * 0.12));
    ctx.fillRect(snap(x + w * 0.61), snap(b - h * 0.26), snap(w * 0.18), snap(h * 0.1));
  } else if (v % 4 === 1) {
    rectTree(ctx, x, b, w * 0.66, h, c, d, true);
    rectTree(ctx, x + w * 0.43, b, w * 0.58, h * 0.8, c, d, true);
  } else {
    rectTree(ctx, x, b, w, h, c, d, true);
  }
}

function drawCity(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle = c;
  const kind = v % 5;
  let bx = x + w * 0.12, buildingW = w * 0.72, buildingH = h * 0.72;
  if (kind === 1) { bx = x + w * 0.23; buildingW = w * 0.5; buildingH = h * 0.9; }
  if (kind === 2) { bx = x + w * 0.08; buildingW = w * 0.84; buildingH = h * 0.48; }
  if (kind === 3) { bx = x + w * 0.17; buildingW = w * 0.62; buildingH = h * 0.8; }
  ctx.fillRect(snap(bx), snap(b - buildingH), snap(buildingW), snap(buildingH));

  if (kind === 0 || kind === 3) {
    // Stepped roof mass.
    ctx.fillRect(snap(bx + buildingW * 0.18), snap(b - buildingH - h * 0.1), snap(buildingW * 0.52), snap(h * 0.11));
  }
  if (kind === 1) {
    // Antenna only on the narrow tower variant.
    ctx.fillRect(snap(bx + buildingW * 0.48), snap(b - buildingH - h * 0.14), 3, snap(h * 0.14));
  }
  if (kind === 2 && layer !== 'far') {
    // Low rooftop water tank/utility silhouette.
    ctx.fillRect(snap(bx + buildingW * 0.58), snap(b - buildingH - h * 0.13), snap(buildingW * 0.22), snap(h * 0.14));
    ctx.fillRect(snap(bx + buildingW * 0.62), snap(b - buildingH), 3, snap(h * 0.12));
    ctx.fillRect(snap(bx + buildingW * 0.76), snap(b - buildingH), 3, snap(h * 0.12));
  }

  ctx.fillStyle = rgba(d, layer === 'far' ? 0.19 : 0.38);
  const cols = Math.max(1, Math.floor(buildingW / 16));
  const rows = Math.max(1, Math.floor(buildingH / 20));
  for (let yy = 0; yy < rows; yy++) {
    for (let xx = 0; xx < cols; xx++) {
      if ((xx + yy + v) % 3 !== 0) {
        ctx.fillRect(snap(bx + 6 + xx * 15), snap(b - buildingH + 8 + yy * 19), 3, 4);
      }
    }
  }
}

function drawRuralVillage(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  const kind = v % 7;
  if (kind === 5 && layer !== 'far') {
    // One windmill landmark. Rotor diameter is proportional to tower height, not the whole chunk.
    ctx.fillStyle = c;
    const towerX = x + w * 0.43;
    ctx.fillRect(snap(towerX), snap(b - h * 0.52), snap(w * 0.14), snap(h * 0.52));
    const hubX = x + w * 0.5, hubY = b - h * 0.58;
    ctx.fillStyle = rgba(d, 0.46);
    ctx.fillRect(snap(hubX - w * 0.22), snap(hubY - 2), snap(w * 0.44), 4);
    ctx.fillRect(snap(hubX - 2), snap(hubY - h * 0.22), 4, snap(h * 0.44));
    ctx.fillRect(snap(hubX - 3), snap(hubY - 3), 6, 6);
    return;
  }
  ctx.fillStyle = c;
  if (kind === 3 || kind === 6) {
    // Barn: low and broad, with a large central door.
    ctx.fillRect(snap(x + w * 0.07), snap(b - h * 0.32), snap(w * 0.86), snap(h * 0.32));
    ctx.fillStyle = rgba(d, 0.43);
    ctx.beginPath();
    ctx.moveTo(snap(x + w * 0.03), snap(b - h * 0.32));
    ctx.lineTo(snap(x + w * 0.33), snap(b - h * 0.51));
    ctx.lineTo(snap(x + w * 0.67), snap(b - h * 0.51));
    ctx.lineTo(snap(x + w * 0.97), snap(b - h * 0.32));
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba('#1d2524', 0.44);
    ctx.fillRect(snap(x + w * 0.42), snap(b - h * 0.2), snap(w * 0.18), snap(h * 0.2));
    return;
  }
  if (kind === 2 && layer !== 'far') {
    // Haystack + small tree keeps the village grounded in landscape, not just buildings.
    ctx.fillStyle = c;
    ctx.fillRect(snap(x + w * 0.1), snap(b - h * 0.22), snap(w * 0.38), snap(h * 0.22));
    ctx.fillRect(snap(x + w * 0.17), snap(b - h * 0.31), snap(w * 0.24), snap(h * 0.11));
    rectTree(ctx, x + w * 0.52, b, w * 0.43, h * 0.54, c, d, true);
    return;
  }
  // Cottage; windows/door keep it recognizable when scaled down.
  ctx.fillRect(snap(x + w * 0.14), snap(b - h * 0.35), snap(w * 0.72), snap(h * 0.35));
  ctx.fillStyle = rgba(d, 0.46);
  ctx.beginPath();
  ctx.moveTo(snap(x + w * 0.06), snap(b - h * 0.35));
  ctx.lineTo(snap(x + w * 0.5), snap(b - h * 0.58));
  ctx.lineTo(snap(x + w * 0.94), snap(b - h * 0.35));
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = rgba('#1d2524', 0.46);
  ctx.fillRect(snap(x + w * 0.44), snap(b - h * 0.19), snap(w * 0.13), snap(h * 0.19));
  ctx.fillRect(snap(x + w * 0.24), snap(b - h * 0.22), snap(w * 0.1), snap(h * 0.09));
  ctx.fillRect(snap(x + w * 0.67), snap(b - h * 0.22), snap(w * 0.1), snap(h * 0.09));
}

function drawSwamp(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle = c;
  const kind = v % 5;
  if (kind === 0) {
    // Dead snag with a flared, irregular base.
    const tx = snap(x + w * 0.46), trunkW = Math.max(4, snap(w * 0.1));
    ctx.fillRect(tx, snap(b - h * 0.76), trunkW, snap(h * 0.76));
    ctx.fillRect(snap(tx - w * 0.2), snap(b - h * 0.1), snap(w * 0.5), snap(h * 0.1));
    ctx.fillRect(snap(tx - w * 0.25), snap(b - h * 0.54), snap(w * 0.27), 4);
    ctx.fillRect(snap(tx + w * 0.06), snap(b - h * 0.43), snap(w * 0.27), 4);
    ctx.fillRect(snap(tx - w * 0.22), snap(b - h * 0.54), 4, snap(h * 0.18));
  } else if (kind === 1 || kind === 4) {
    // Cypress crown: narrower top, heavier buttressed base.
    ctx.fillRect(snap(x + w * 0.43), snap(b - h * 0.67), Math.max(4, snap(w * 0.11)), snap(h * 0.67));
    ctx.fillRect(snap(x + w * 0.28), snap(b - h * 0.12), snap(w * 0.45), snap(h * 0.12));
    ctx.fillRect(snap(x + w * 0.18), snap(b - h * 0.69), snap(w * 0.64), snap(h * 0.19));
    ctx.fillRect(snap(x + w * 0.28), snap(b - h * 0.82), snap(w * 0.47), snap(h * 0.16));
  } else if (kind === 2) {
    // Willow mass with hanging strands.
    ctx.fillRect(snap(x + w * 0.44), snap(b - h * 0.55), Math.max(4, snap(w * 0.1)), snap(h * 0.55));
    ctx.fillRect(snap(x + w * 0.08), snap(b - h * 0.72), snap(w * 0.84), snap(h * 0.2));
    ctx.fillRect(snap(x + w * 0.18), snap(b - h * 0.83), snap(w * 0.62), snap(h * 0.16));
    ctx.fillStyle = rgba(d, 0.24);
    for (let i = 0; i < 5; i++) ctx.fillRect(snap(x + w * (0.18 + i * 0.15)), snap(b - h * 0.58), 2, snap(h * (0.16 + (i % 2) * 0.08)));
  } else {
    // Low reed/island clump prevents the swamp becoming another forest wall.
    ctx.fillRect(snap(x + w * 0.05), snap(b - h * 0.13), snap(w * 0.9), snap(h * 0.13));
    for (let i = 0; i < 6; i++) {
      const rx = x + w * (0.12 + i * 0.13);
      ctx.fillRect(snap(rx), snap(b - h * (0.22 + (i % 3) * 0.06)), 2, snap(h * (0.18 + (i % 3) * 0.06)));
    }
  }
  if (layer !== 'far' && kind !== 3) {
    ctx.fillStyle = rgba(d, 0.28);
    for (let i = 0; i < 4; i++) ctx.fillRect(snap(x + w * (0.08 + i * 0.22)), snap(b - h * (0.06 + (i % 2) * 0.02)), 2, snap(h * 0.07));
  }
}

interface AssetLayout {
  /** Natural width / height of the motif. Width is always derived from height to prevent stretch. */
  aspect: number;
  /** Pixel height at 1280×720 and cameraScale 0.8 for the midground layer. */
  height: number;
  /** Small per-motif grounding adjustment in units of its rendered height. */
  groundOffset?: number;
}

function assetLayoutForBiome(biome: BiomeId, layer: Layer, variant: number): AssetLayout {
  const kind5=variant%5, kind4=variant%4, kind7=variant%7;
  let layout:AssetLayout;
  if(biome==='lowlands'){
    if(layer==='far') layout={aspect:2.7,height:62};
    else if(kind5===0) layout={aspect:2.55,height:66};
    else if(kind5===2) layout={aspect:1.15,height:82};
    else if(kind5===3) layout={aspect:2.35,height:56};
    else layout={aspect:1.05,height:92};
  }else if(biome==='spires'){
    if(kind5===1&&layer!=='far') layout={aspect:1.05,height:108};
    else if(kind5===2&&layer!=='far') layout={aspect:1.28,height:94};
    else if(kind5===4&&layer!=='far') layout={aspect:1.16,height:102};
    else layout={aspect:kind5===3?.72:.58,height:kind5===3?100:122};
  }else if(biome==='foundry'){
    if(kind4===0) layout={aspect:1.45,height:86};
    else if(kind4===1) layout={aspect:1.58,height:72};
    else if(kind4===2&&layer!=='far') layout={aspect:1.8,height:78};
    else layout={aspect:1.95,height:84};
  }else if(biome==='ruins'){
    if(kind4===0) layout={aspect:1.25,height:82};
    else if(kind4===1) layout={aspect:1.08,height:86};
    else if(kind4===2) layout={aspect:1.78,height:86};
    else layout={aspect:.78,height:88};
  }else if(biome==='desert'){
    if(layer==='far') layout={aspect:2.65,height:70};
    else if(kind5===0) layout={aspect:.72,height:84};
    else if(kind5===1||kind5===4) layout={aspect:1.9,height:74};
    else if(kind5===2) layout={aspect:1.45,height:80};
    else layout={aspect:1.08,height:84};
  }else if(biome==='snowy-mountains'){
    if(layer==='far') layout={aspect:1.72,height:180};
    else if(variant%6===0) layout={aspect:1.55,height:86};
    else if(variant%4===1) layout={aspect:1.15,height:94};
    else layout={aspect:.76,height:102};
  }else if(biome==='temperate-forest'){
    if(layer==='far') layout={aspect:2.75,height:68};
    else if(kind5===0) layout={aspect:2.15,height:76};
    else if(variant%4===1) layout={aspect:1.48,height:98};
    else layout={aspect:1.02,height:104};
  }else if(biome==='city'){
    if(kind5===0) layout={aspect:.78,height:122};
    else if(kind5===1) layout={aspect:.52,height:148};
    else if(kind5===2) layout={aspect:1.45,height:78};
    else if(kind5===3) layout={aspect:.8,height:132};
    else layout={aspect:.92,height:112};
  }else if(biome==='rural-village'){
    if(kind7===5&&layer!=='far') layout={aspect:.95,height:104};
    else if(kind7===3||kind7===6) layout={aspect:1.85,height:90};
    else if(kind7===2&&layer!=='far') layout={aspect:1.65,height:86};
    else layout={aspect:1.7,height:84};
  }else{
    if(kind5===0) layout={aspect:1.08,height:90};
    else if(kind5===1||kind5===4) layout={aspect:1.02,height:96};
    else if(kind5===2) layout={aspect:1.32,height:90};
    else layout={aspect:2.1,height:78};
  }

  // Distance changes apparent size uniformly. Aspect ratio remains untouched.
  const layerScale=layer==='far'?.72:layer==='mid'?1:layer==='near'?1.18:1.34;
  return {...layout,height:layout.height*layerScale};
}

function featureDimensions(
  biome:BiomeId,
  layer:Layer,
  variant:number,
  scalar:number,
  cssWidth:number,
  cssHeight:number,
  cameraScale:number,
):{width:number;height:number;groundOffset:number}{
  const layout=assetLayoutForBiome(biome,layer,variant);
  const viewportScale=Math.max(.68,Math.min(1.45,Math.min(cssWidth/1280,cssHeight/720)));
  // Backgrounds should follow world zoom, but clamping prevents pair-framing extremes from making
  // landmarks microscopic or screen-filling. Both axes use this exact same scalar.
  const zoomScale=Math.max(.58,Math.min(1.7,cameraScale/.8));
  const height=Math.max(18,layout.height*scalar*viewportScale*zoomScale);
  return {width:height*layout.aspect,height,groundOffset:(layout.groundOffset||0)*height};
}

function drawPlacedFeature(
  ctx:CanvasRenderingContext2D,
  biome:BiomeId,
  centerX:number,
  baseY:number,
  width:number,
  height:number,
  color:string,
  detail:string,
  variant:number,
  layer:Layer,
  flipX=false,
){
  if(!flipX){drawFeatureForBiome(ctx,biome,centerX-width*.5,baseY,width,height,color,detail,variant,layer);return;}
  ctx.save();
  ctx.translate(centerX*2,0);
  ctx.scale(-1,1);
  drawFeatureForBiome(ctx,biome,centerX-width*.5,baseY,width,height,color,detail,variant,layer);
  ctx.restore();
}

function drawFeatureForBiome(
  ctx: CanvasRenderingContext2D,
  biome: BiomeId,
  x: number,
  b: number,
  w: number,
  h: number,
  c: string,
  d: string,
  v: number,
  layer: Layer,
) {
  if (biome === 'lowlands') drawLowland(ctx, x, b, w, h, c, d, v, layer);
  else if (biome === 'spires') drawSpire(ctx, x, b, w, h, c, d, v, layer);
  else if (biome === 'foundry') drawFoundry(ctx, x, b, w, h, c, d, v, layer);
  else if (biome === 'ruins') drawRuins(ctx, x, b, w, h, c, d, v, layer);
  else if (biome === 'desert') drawDesert(ctx, x, b, w, h, c, d, v, layer);
  else if (biome === 'snowy-mountains') drawSnowyMountain(ctx, x, b, w, h, c, d, v, layer);
  else if (biome === 'temperate-forest') drawTemperateForest(ctx, x, b, w, h, c, d, v, layer);
  else if (biome === 'city') drawCity(ctx, x, b, w, h, c, d, v, layer);
  else if (biome === 'rural-village') drawRuralVillage(ctx, x, b, w, h, c, d, v, layer);
  else drawSwamp(ctx, x, b, w, h, c, d, v, layer);
}

/** Development/documentation helper: renders one procedural motif at representative scale. */
export function drawBiomeAssetPreview(
  ctx: CanvasRenderingContext2D,
  biome: BiomeId,
  layer: Layer,
  variant: number,
  centerX: number,
  baseY: number,
  baseWidth: number,
  baseHeight: number,
  color: string,
  detail: string,
): void {
  // Preview callers provide a bounding box; fit the motif into it without changing its natural
  // aspect ratio so the catalog is representative of gameplay rendering.
  const layout=assetLayoutForBiome(biome,layer,variant);
  const height=Math.min(baseHeight,baseWidth/layout.aspect);
  const width=height*layout.aspect;
  drawFeatureForBiome(ctx,biome,centerX-width*.5,baseY,width,height,color,detail,variant,layer);
}

function drawNaturalRidge(
  ctx: CanvasRenderingContext2D,
  biome: BiomeId,
  chunk: BackgroundChunkDescriptor,
  x0: number,
  w: number,
  b: number,
  cssHeight: number,
  color: string,
  detail: string,
) {
  if (biome === 'city' || biome === 'foundry' || biome === 'ruins' || biome === 'spires') return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(snap(x0 - 2), snap(cssHeight + 2));
  const softLandscape = biome === 'lowlands' || biome === 'temperate-forest' || biome === 'rural-village' || biome === 'swamp' || biome === 'snowy-mountains';
  for (let i = 0; i <= RIDGE_SEGMENTS; i++) {
    const x = x0 + w * (i / RIDGE_SEGMENTS);
    const prev = chunk.ridge[Math.max(0, i - 1)];
    const current = chunk.ridge[i];
    const next = chunk.ridge[Math.min(RIDGE_SEGMENTS, i + 1)];
    const ridgeValue = softLandscape ? (prev + current * 2 + next) / 4 : current;
    let ridgeHeight = cssHeight * (0.1 + ridgeValue * 0.22);
    if (biome === 'desert') ridgeHeight *= 0.42;
    if (biome === 'swamp') ridgeHeight *= 0.22;
    if (biome === 'rural-village') ridgeHeight *= 0.38;
    if (biome === 'temperate-forest') ridgeHeight *= 0.48;
    // Snow mountains are now supplied by the large far assets; the ridge is only foothills.
    if (biome === 'snowy-mountains') ridgeHeight *= 0.52;
    ctx.lineTo(snap(x), snap(b - ridgeHeight));
  }
  ctx.lineTo(snap(x0 + w + 2), snap(cssHeight + 2));
  ctx.closePath();
  ctx.fill();
  if (biome === 'snowy-mountains') {
    ctx.strokeStyle = rgba(detail, 0.12);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function placementJitterForBiome(biome:BiomeId,layer:'far'|'mid'|'near',viewportScale:number):number{
  const built=biome==='city'||biome==='foundry'||biome==='spires'||biome==='ruins';
  const base=built
    ? (layer==='far'?2:layer==='mid'?3:4)
    : biome==='rural-village'
      ? (layer==='far'?3:layer==='mid'?5:7)
      : (layer==='far'?4:layer==='mid'?6:9);
  return base*viewportScale;
}

function drawLayer(ctx:CanvasRenderingContext2D,cache:BiomeBackgroundCache,layer:'far'|'mid'|'near',o:BackgroundDrawOptions){
  const parallax=parallaxByLayer[layer],{cameraCenterX,cameraCenterY,cameraScale,cssWidth,cssHeight,worldSeed}=o,halfWorldVisible=cssWidth*.62/Math.max(.0001,cameraScale*parallax),minChunk=Math.floor((cameraCenterX-halfWorldVisible)/BACKGROUND_CHUNK_WIDTH)-1,maxChunk=Math.floor((cameraCenterX+halfWorldVisible)/BACKGROUND_CHUNK_WIDTH)+1;
  const verticalParallax=layer==='far'?.045:layer==='mid'?.09:.16,baselineRatio=layer==='far'?.72:layer==='mid'?.79:.85,baselineY=cssHeight*baselineRatio+(WORLD_REF_HEIGHT*.64-cameraCenterY)*cameraScale*verticalParallax,layerAlpha=layer==='far'?.78:layer==='mid'?.9:.94;
  const viewportScale=Math.max(.68,Math.min(1.45,Math.min(cssWidth/1280,cssHeight/720)));
  ctx.save();ctx.globalAlpha=layerAlpha;
  for(let chunkIndex=minChunk;chunkIndex<=maxChunk;chunkIndex++){
    const chunk=cache.getChunk(layer,chunkIndex,worldSeed),chunkWorldX=chunkIndex*BACKGROUND_CHUNK_WIDTH,screenStartX=cssWidth*.5+(chunkWorldX-cameraCenterX)*cameraScale*parallax,screenChunkWidth=BACKGROUND_CHUNK_WIDTH*cameraScale*parallax;if(screenStartX>cssWidth+180||screenStartX+screenChunkWidth<-180)continue;
    const chunkSample=getBiomeAtX(chunkWorldX+BACKGROUND_CHUNK_WIDTH*.5,worldSeed),chunkPalette=paletteForBiomeSample(chunkSample),chunkBiome=dominantBiome(chunkSample);
    for(let featureIndex=0;featureIndex<chunk.features.length;featureIndex++){
      if(cameraScale<.55&&layer==='far')continue;if(cameraScale<.48&&layer==='mid'&&featureIndex%2===1)continue;
      const feature=chunk.features[featureIndex],featureWorldX=chunkWorldX+feature.x*BACKGROUND_CHUNK_WIDTH,screenX=cssWidth*.5+(featureWorldX-cameraCenterX)*cameraScale*parallax,featureSample=getBiomeAtX(featureWorldX,worldSeed),featurePalette=paletteForBiomeSample(featureSample),biome=dominantBiome(featureSample),dims=featureDimensions(biome,layer,feature.variant,feature.scale,cssWidth,cssHeight,cameraScale),baseY=baselineY+feature.yJitter*placementJitterForBiome(biome,layer,viewportScale)+dims.groundOffset,color=layer==='far'?featurePalette.far:layer==='mid'?featurePalette.mid:featurePalette.near;
      drawPlacedFeature(ctx,biome,screenX,baseY,dims.width,dims.height,color,featurePalette.detail,feature.variant,layer,feature.flipX);
    }
    // Far landmarks sit *behind* their ridge/foothill layer. Occluding their lower edge makes
    // mountains, trees, mesas and distant settlements feel grounded instead of pasted on top.
    if(layer==='far')drawNaturalRidge(ctx,chunkBiome,chunk,screenStartX,screenChunkWidth,baselineY,cssHeight,chunkPalette.far,chunkPalette.detail);
  }
  ctx.restore();
}

function drawAmbientDetails(ctx:CanvasRenderingContext2D,o:BackgroundDrawOptions){
  const sample=getBiomeAtX(o.cameraCenterX,o.worldSeed),biome=dominantBiome(sample),p=paletteForBiomeSample(sample);
  if(biome==='desert'){
    ctx.fillStyle=rgba(p.detail,.14);for(let i=0;i<8;i++){const x=(biomeHash(o.worldSeed,0x53414e44,i+sample.regionIndex*11)%Math.max(1,Math.floor(o.cssWidth)))|0;const y=o.cssHeight*(.58+(i%4)*.065);ctx.fillRect(snap(x),snap(y),18+(i%3)*12,2);}
  } else if(biome==='snowy-mountains'){
    ctx.fillStyle=rgba(p.detail,.28);for(let i=0;i<16;i++){const x=biomeHash(o.worldSeed,0x534e4f57,i+sample.regionIndex*29)%Math.max(1,Math.floor(o.cssWidth));const y=o.cssHeight*(.12+biomeRandom01(o.worldSeed,0x534e5959,i+sample.regionIndex*29)*.66);ctx.fillRect(snap(x),snap(y),i%5===0?3:2,i%5===0?3:2);}
  } else if(biome==='temperate-forest'){
    ctx.fillStyle=rgba(p.detail,.13);for(let i=0;i<12;i++){const x=biomeHash(o.worldSeed,0x4c454146,i+sample.regionIndex*17)%Math.max(1,Math.floor(o.cssWidth));const y=o.cssHeight*(.3+biomeRandom01(o.worldSeed,0x4c454159,i+sample.regionIndex*17)*.42);ctx.fillRect(snap(x),snap(y),3,2);}
  } else if(biome==='rural-village'){
    ctx.fillStyle=rgba(p.detail,.14);const y=snap(o.cssHeight*.83);for(let x=28;x<o.cssWidth;x+=164){ctx.fillRect(x,y,54,2);ctx.fillRect(x,y-11,3,14);ctx.fillRect(x+51,y-11,3,14);}
  } else if(biome==='swamp'){
    ctx.fillStyle=rgba(p.haze,.12);ctx.fillRect(0,snap(o.cssHeight*.51),o.cssWidth,16);ctx.fillRect(0,snap(o.cssHeight*.69),o.cssWidth,10);ctx.fillStyle=rgba(p.detail,.17);for(let x=14;x<o.cssWidth;x+=58){ctx.fillRect(x,snap(o.cssHeight*.83+(x%4)*2),22,2);if((x/58)%2>.35){ctx.fillRect(x+5,snap(o.cssHeight*.77),2,24);ctx.fillRect(x+9,snap(o.cssHeight*.79),2,18);}}
  }
}

export function drawBiomeBackground(ctx:CanvasRenderingContext2D,cache:BiomeBackgroundCache,o:BackgroundDrawOptions){ctx.save();ctx.imageSmoothingEnabled=false;drawSkyBands(ctx,o);drawLayer(ctx,cache,'far',o);drawLayer(ctx,cache,'mid',o);drawLayer(ctx,cache,'near',o);drawAmbientDetails(ctx,o);const p=paletteForBiomeSample(getBiomeAtX(o.cameraCenterX,o.worldSeed));ctx.fillStyle=rgba(p.haze,.045);ctx.fillRect(0,o.cssHeight*.42,o.cssWidth,o.cssHeight*.58);ctx.restore();}

export function drawBiomeForeground(ctx:CanvasRenderingContext2D,cache:BiomeBackgroundCache,o:BackgroundDrawOptions){
  const {cssWidth,cssHeight,cameraCenterX,cameraScale,worldSeed}=o;if(cameraScale<.5)return;
  const layer:Layer='foreground',parallax=.88,halfWorldVisible=cssWidth*.55/Math.max(.0001,cameraScale*parallax),minChunk=Math.floor((cameraCenterX-halfWorldVisible)/BACKGROUND_CHUNK_WIDTH)-1,maxChunk=Math.floor((cameraCenterX+halfWorldVisible)/BACKGROUND_CHUNK_WIDTH)+1;
  ctx.save();ctx.globalAlpha=.16;
  for(let chunkIndex=minChunk;chunkIndex<=maxChunk;chunkIndex++){
    const chunk=cache.getChunk(layer,chunkIndex,worldSeed),chunkWorldX=chunkIndex*BACKGROUND_CHUNK_WIDTH;
    for(const feature of chunk.features){
      const featureWorldX=chunkWorldX+feature.x*BACKGROUND_CHUNK_WIDTH,x=cssWidth*.5+(featureWorldX-cameraCenterX)*cameraScale*parallax;
      if(x>cssWidth*.18&&x<cssWidth*.82)continue;
      const sample=getBiomeAtX(featureWorldX,worldSeed),palette=paletteForBiomeSample(sample),biome=dominantBiome(sample),dims=featureDimensions(biome,layer,feature.variant,feature.scale*.92,cssWidth,cssHeight,cameraScale);
      drawPlacedFeature(ctx,biome,x,cssHeight+4,dims.width,dims.height,palette.near,palette.detail,feature.variant,layer,feature.flipX);
    }
  }
  ctx.restore();
}
