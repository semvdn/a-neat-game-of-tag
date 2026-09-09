import type { BiomeId, BiomeSample } from '../types';
import { WORLD_REF_HEIGHT } from '../constants';
import { BIOME_VISUAL_VERSION, biomeHash, biomeRandom01, getBiomeAtX, mixHex, paletteForBiomeSample, VISUAL_BIOMES } from '../world/biomes';
import type { WorldLightingState } from '../world/dayNight';
import { lightBiomePalette } from '../world/dayNight';

const BACKGROUND_CHUNK_WIDTH = 600;
const MIN_DESCRIPTOR_CACHE = 160;
const RIDGE_SEGMENTS = 8;
const NS_FAR=0x464152, NS_MID=0x4d4944, NS_NEAR=0x4e4541, NS_FORE=0x464f52;

type Layer = 'far'|'mid'|'near'|'foreground';
interface FeatureDescriptor { x:number; scale:number; variant:number; yJitter:number; flipX:boolean; biome:BiomeId; }
interface BackgroundChunkDescriptor { chunkIndex:number; layer:Layer; ridge:number[]; features:FeatureDescriptor[]; }
interface BackgroundDrawOptions { cameraCenterX:number; cameraCenterY:number; cameraScale:number; cssWidth:number; cssHeight:number; worldSeed:number; lighting:WorldLightingState; }

const parallaxByLayer={far:.13,mid:.31,near:.58} as const;
const namespaceForLayer=(layer:Layer)=>layer==='far'?NS_FAR:layer==='mid'?NS_MID:layer==='near'?NS_NEAR:NS_FORE;
const dominantBiome=(sample:BiomeSample):BiomeId=>sample.secondary&&sample.blend>=.5?sample.secondary:sample.primary;
const chooseBiome=(sample:BiomeSample,selector:number):BiomeId=>sample.secondary&&selector<sample.blend?sample.secondary:sample.primary;
const densityFor=(biome:BiomeId,layer:Layer)=>{const d=VISUAL_BIOMES[biome];return layer==='far'?d.farDensity:layer==='mid'?d.midDensity:layer==='near'?d.nearDensity:d.nearDensity*.55;};
const snap=(v:number,g=2)=>Math.round(v/g)*g;
function rgba(hex:string,alpha:number){const h=hex.replace('#','');const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);return `rgba(${r}, ${g}, ${b}, ${alpha})`;}

function visualVariantForBiome(biome:BiomeId,layer:Layer,hash:number):number{
  // Weighted vocabularies keep signature landmarks rare and prevent modulo aliases from making
  // supposedly different variants collapse onto the same silhouette.
  const pools: Partial<Record<BiomeId, readonly number[]>> = {
    lowlands: [0,1,1,2,3,4,4,5,6,1,4],
    spires: [0,0,1,2,3,4,4,5,6,0,3],
    foundry: [0,1,2,3,3,4,5,0,1,3],
    ruins: [0,1,2,2,3,4,5,0,2,4],
    desert: [0,1,1,2,3,4,4,5,6,1,4],
    'snowy-mountains': [0,1,1,2,2,3,4,4,5,6,2,4],
    'temperate-forest': [0,1,1,2,2,3,4,5,5,6,2,4],
    city: [0,1,2,3,3,4,4,5,6,0,3],
    'rural-village': [2,7,9,0,2,7,1,2,7,3,9,7,4,2,7,6,0,9,7,8,2,7,5],
    swamp: [0,1,1,2,3,3,4,5,6,1,3],
  };
  const pool=pools[biome] || [0,1,2,3,4,5,6];
  return pool[hash%pool.length];
}

function featureCountBounds(biome:BiomeId,layer:Layer):{min:number;max:number}{
  if(layer==='far') return {min:0,max:0};
  const table:Record<BiomeId,{mid:[number,number];near:[number,number];foreground:[number,number]}>={
    lowlands:{mid:[0,2],near:[0,3],foreground:[0,2]},
    spires:{mid:[0,2],near:[0,2],foreground:[0,1]},
    foundry:{mid:[0,2],near:[0,2],foreground:[0,2]},
    ruins:{mid:[0,2],near:[0,3],foreground:[0,2]},
    desert:{mid:[0,2],near:[0,2],foreground:[0,1]},
    'snowy-mountains':{mid:[0,2],near:[0,3],foreground:[0,1]},
    'temperate-forest':{mid:[1,3],near:[1,4],foreground:[0,2]},
    city:{mid:[1,3],near:[1,4],foreground:[0,2]},
    'rural-village':{mid:[0,1],near:[0,2],foreground:[0,1]},
    swamp:{mid:[0,3],near:[1,4],foreground:[0,2]},
  };
  const pair=table[biome][layer as 'mid'|'near'|'foreground'];
  return {min:pair[0],max:pair[1]};
}

function featureScaleForBiome(biome:BiomeId,seed:number,namespace:number,key:number):number{
  const r=biomeRandom01(seed,namespace^0x77,key);
  if(biome==='rural-village') return .76+r*.34;
  if(biome==='lowlands'||biome==='desert'||biome==='temperate-forest'||biome==='swamp') return .76+r*.42;
  if(biome==='city'||biome==='foundry'||biome==='spires'||biome==='ruins') return .84+r*.30;
  return .8+r*.34;
}

function drawPixelDisc(ctx:CanvasRenderingContext2D,cx:number,cy:number,r:number,color:string){ctx.fillStyle=color;const rows=[.62,.86,1,1,.86,.62];for(let i=0;i<rows.length;i++){const hh=Math.max(2,Math.round((r*2)/rows.length)),ww=Math.round(r*2*rows[i]),yy=Math.round(cy-r+i*hh);ctx.fillRect(snap(cx-ww*.5),snap(yy),snap(ww),hh+1);}}

export class BiomeBackgroundCache {
  private chunks=new Map<string,BackgroundChunkDescriptor>();
  private capacity=MIN_DESCRIPTOR_CACHE;
  clear(){this.chunks.clear();}
  get size(){return this.chunks.size;}
  ensureCapacity(minimum:number){
    const target=Math.max(MIN_DESCRIPTOR_CACHE,Math.ceil(minimum));
    if(target>this.capacity)this.capacity=target;
    while(this.chunks.size>this.capacity){const oldest=this.chunks.keys().next().value as string|undefined;if(oldest)this.chunks.delete(oldest);else break;}
  }
  getChunk(layer:Layer,chunkIndex:number,seed:number):BackgroundChunkDescriptor{
    const key=`v${BIOME_VISUAL_VERSION}:${seed}:${layer}:${chunkIndex}`;const existing=this.chunks.get(key);
    if(existing){this.chunks.delete(key);this.chunks.set(key,existing);return existing;}
    const descriptor=this.generateChunk(layer,chunkIndex,seed);this.chunks.set(key,descriptor);
    if(this.chunks.size>this.capacity){const oldest=this.chunks.keys().next().value as string|undefined;if(oldest)this.chunks.delete(oldest);}
    return descriptor;
  }
  private generateChunk(layer:Layer,chunkIndex:number,seed:number):BackgroundChunkDescriptor{
    const namespace=namespaceForLayer(layer),ridge:number[]=[];
    for(let i=0;i<=RIDGE_SEGMENTS;i++){const globalNode=chunkIndex*RIDGE_SEGMENTS+i;ridge.push(.28+biomeRandom01(seed,namespace^0x726964,globalNode)*.58);}
    const centerX=(chunkIndex+.5)*BACKGROUND_CHUNK_WIDTH,sample=getBiomeAtX(centerX,seed);
    const densityA=densityFor(sample.primary,layer),densityB=sample.secondary?densityFor(sample.secondary,layer):densityA;
    const density=densityA+(densityB-densityA)*(sample.secondary?sample.blend:0);
    const centerBiome=dominantBiome(sample);
    const bounds=featureCountBounds(centerBiome,layer);
    const count=Math.max(bounds.min,Math.min(bounds.max,Math.round(
      bounds.min+density*(bounds.max-bounds.min)+(biomeRandom01(seed,namespace,chunkIndex)-.5)*1.25
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
      const featureSample=getBiomeAtX(chunkIndex*BACKGROUND_CHUNK_WIDTH+x*BACKGROUND_CHUNK_WIDTH,seed);
      const featureBiome=chooseBiome(featureSample,biomeRandom01(seed,namespace^0x62696f,k));
      features.push({
        x,
        scale:featureScaleForBiome(featureBiome,seed,namespace,k),
        variant:visualVariantForBiome(featureBiome,layer,biomeHash(seed,namespace^0x76,k)),
        yJitter:biomeRandom01(seed,namespace^0x79,k)*2-1,
        flipX:(biomeHash(seed,namespace^0x6d6972,k)&1)===1,
        biome:featureBiome,
      });
    }
    return {chunkIndex,layer,ridge,features};
  }
}

function drawSkyBands(ctx:CanvasRenderingContext2D,o:BackgroundDrawOptions){
  const {cssWidth,cssHeight,cameraCenterX,worldSeed,lighting,cameraScale}=o;
  const bands=16, columns=Math.max(12,Math.ceil(cssWidth/80)), skyParallax=.16;
  for(let col=0;col<columns;col++){
    const x0=(cssWidth*col)/columns, x1=(cssWidth*(col+1))/columns;
    const sampleWorldX=cameraCenterX+(((x0+x1)*.5)-cssWidth*.5)/Math.max(.0001,cameraScale*skyParallax);
    const palette=lightBiomePalette(paletteForBiomeSample(getBiomeAtX(sampleWorldX,worldSeed)),lighting);
    for(let i=0;i<bands;i++){
      const t0=i/bands,t1=(i+1)/bands;
      ctx.fillStyle=mixHex(palette.skyTop,palette.skyBottom,Math.round(t0*10)/10);
      ctx.fillRect(Math.floor(x0),Math.floor(cssHeight*t0),Math.ceil(x1-x0)+1,Math.ceil(cssHeight*(t1-t0))+1);
    }
  }

  // Celestial bodies follow world time instead of belonging to a particular biome.
  const sunAltitude=Math.sin(Math.PI*lighting.sunProgress);
  const sunX=cssWidth*(.1+.8*lighting.sunProgress);
  const sunY=cssHeight*(.39-.28*Math.max(0,sunAltitude));
  const sunAlpha=Math.max(lighting.daylight*.62,lighting.twilight*.5);
  if(sunAlpha>.025){
    const r=Math.max(16,Math.round(cssHeight*.045));
    drawPixelDisc(ctx,sunX,sunY,r,rgba(lighting.dusk>lighting.dawn?'#f3a15f':'#f6cf7a',sunAlpha));
  }
  const moonAltitude=Math.sin(Math.PI*lighting.moonProgress);
  const moonX=cssWidth*(.1+.8*lighting.moonProgress);
  const moonY=cssHeight*(.38-.25*Math.max(0,moonAltitude));
  if(lighting.night>.18){
    const r=Math.max(12,Math.round(cssHeight*.034));
    drawPixelDisc(ctx,moonX,moonY,r,rgba('#dce7f2',lighting.night*.42));
  }

  const starSpacing=220,starParallax=.045,halfStarWorld=cssWidth*.62/Math.max(.0001,o.cameraScale*starParallax),starStart=Math.floor((cameraCenterX-halfStarWorld)/starSpacing)-2,starCount=Math.ceil((halfStarWorld*2)/starSpacing)+6;
  const starAlpha=lighting.night*.58;
  if(starAlpha>.02){
    ctx.fillStyle=rgba('#d9e7ef',starAlpha);
    for(let i=0;i<starCount;i++){
      const starIndex=starStart+i,worldX=starIndex*starSpacing+biomeRandom01(worldSeed,0x53544152,starIndex)*70,screenX=cssWidth*.5+(worldX-cameraCenterX)*o.cameraScale*starParallax;
      if(screenX<-8||screenX>cssWidth+8)continue;
      const y=cssHeight*(.06+biomeRandom01(worldSeed,0x535459,starIndex)*.36),size=biomeRandom01(worldSeed,0x535453,starIndex)>.84?3:2;
      ctx.fillRect(snap(screenX),snap(y),size,size);
    }
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
  ctx.fillStyle=c;
  const kind=v%7;
  if(kind===0){
    // Hedge/scrub bank.
    ctx.fillRect(snap(x+w*.04),snap(b-h*.27),snap(w*.92),snap(h*.27));
    ctx.fillRect(snap(x+w*.16),snap(b-h*.4),snap(w*.3),snap(h*.15));
    ctx.fillRect(snap(x+w*.59),snap(b-h*.36),snap(w*.24),snap(h*.11));
  } else if(kind===1){
    // Mature spreading oak.
    rectTree(ctx,x,b,w,h,c,d,true);
  } else if(kind===2){
    // Poplar pair.
    const specs=[[.28,.9],[.61,.7]] as const;
    for(const [ox,scale] of specs){
      const tw=Math.max(3,snap(w*.065));
      ctx.fillRect(snap(x+w*ox),snap(b-h*.48*scale),tw,snap(h*.48*scale));
      ctx.fillRect(snap(x+w*(ox-.1)),snap(b-h*.84*scale),snap(w*.22),snap(h*.39*scale));
    }
  } else if(kind===3){
    // Turf-covered fieldstone mound.
    ctx.fillRect(snap(x+w*.1),snap(b-h*.2),snap(w*.8),snap(h*.2));
    ctx.fillRect(snap(x+w*.25),snap(b-h*.32),snap(w*.45),snap(h*.13));
    ctx.fillStyle=rgba(d,.25);ctx.fillRect(snap(x+w*.18),snap(b-h*.21),snap(w*.57),3);
  } else if(kind===4){
    // Uneven pair of field trees.
    rectTree(ctx,x,b,w*.58,h*.8,c,d,true);
    rectTree(ctx,x+w*.43,b,w*.55,h,c,d,true);
  } else if(kind===5){
    // Old low dry-stone wall with a shrub breaking the line.
    ctx.fillRect(snap(x+w*.05),snap(b-h*.13),snap(w*.9),snap(h*.13));
    ctx.fillStyle=rgba(d,.25);
    for(let i=0;i<5;i++)ctx.fillRect(snap(x+w*(.09+i*.17)),snap(b-h*.13),2,snap(h*.13));
    ctx.fillStyle=c;ctx.fillRect(snap(x+w*.58),snap(b-h*.29),snap(w*.24),snap(h*.18));
  } else {
    // Three-bush copse keeps some chunks low and open.
    ctx.fillRect(snap(x+w*.08),snap(b-h*.2),snap(w*.27),snap(h*.2));
    ctx.fillRect(snap(x+w*.31),snap(b-h*.31),snap(w*.35),snap(h*.31));
    ctx.fillRect(snap(x+w*.63),snap(b-h*.18),snap(w*.26),snap(h*.18));
  }
}

function drawSpire(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle=c;
  const kind=v%7;
  const roof=(cx:number,y:number,ww:number,hh:number)=>{ctx.beginPath();ctx.moveTo(snap(cx-ww*.55),snap(y));ctx.lineTo(snap(cx),snap(y-hh));ctx.lineTo(snap(cx+ww*.55),snap(y));ctx.closePath();ctx.fill();};
  if(kind===1){
    // Twin towers and high bridge.
    const tw=Math.max(7,snap(w*.2));
    for(const ox of [.19,.62]){const bx=x+w*ox;ctx.fillRect(snap(bx),snap(b-h*.62),tw,snap(h*.62));roof(bx+tw*.5,b-h*.62,tw,h*.24);}
    ctx.fillRect(snap(x+w*.28),snap(b-h*.4),snap(w*.46),Math.max(4,snap(h*.065)));
  } else if(kind===2){
    // Ceremonial gate / pointed arch mass.
    const cw=Math.max(7,snap(w*.17));
    ctx.fillRect(snap(x+w*.1),snap(b-h*.55),cw,snap(h*.55));ctx.fillRect(snap(x+w*.73),snap(b-h*.55),cw,snap(h*.55));
    ctx.fillRect(snap(x+w*.1),snap(b-h*.58),snap(w*.8),snap(h*.1));roof(x+w*.5,b-h*.58,w*.62,h*.22);
  } else if(kind===3){
    // Broad stepped bastion rather than another needle.
    ctx.fillRect(snap(x+w*.16),snap(b-h*.4),snap(w*.68),snap(h*.4));
    ctx.fillRect(snap(x+w*.26),snap(b-h*.58),snap(w*.48),snap(h*.19));
    ctx.fillRect(snap(x+w*.39),snap(b-h*.73),snap(w*.22),snap(h*.16));
    ctx.fillStyle=rgba(d,.27);ctx.fillRect(snap(x+w*.46),snap(b-h*.33),snap(w*.08),snap(h*.14));
  } else if(kind===4){
    // Three-pinnacle cluster.
    for(const [ox,hh,ww] of [[.12,.53,.18],[.4,.75,.21],[.7,.46,.16]] as const){const bx=x+w*ox;ctx.fillRect(snap(bx),snap(b-h*hh),snap(w*ww),snap(h*hh));roof(bx+w*ww*.5,b-h*hh,w*ww,h*.17);}
  } else if(kind===5){
    // Buttressed sanctuary with wide shoulders.
    ctx.fillRect(snap(x+w*.25),snap(b-h*.62),snap(w*.5),snap(h*.62));
    ctx.fillRect(snap(x+w*.08),snap(b-h*.27),snap(w*.2),snap(h*.27));ctx.fillRect(snap(x+w*.72),snap(b-h*.27),snap(w*.2),snap(h*.27));
    roof(x+w*.5,b-h*.62,w*.52,h*.25);
  } else if(kind===6){
    // Elevated bridge between unequal towers.
    const lW=w*.2,rW=w*.17;
    ctx.fillRect(snap(x+w*.13),snap(b-h*.5),snap(lW),snap(h*.5));ctx.fillRect(snap(x+w*.72),snap(b-h*.7),snap(rW),snap(h*.7));
    roof(x+w*.23,b-h*.5,lW,h*.19);roof(x+w*.805,b-h*.7,rW,h*.2);
    ctx.fillRect(snap(x+w*.28),snap(b-h*.34),snap(w*.5),snap(h*.075));
  } else {
    // Signature solitary needle.
    const bw=Math.max(9,snap(w*.34)),bx=x+(w-bw)*.5,shoulder=b-h*.66;
    ctx.fillRect(snap(bx),snap(shoulder),bw,snap(b-shoulder));ctx.fillRect(snap(bx-bw*.25),snap(b-h*.27),snap(bw*1.5),snap(h*.27));roof(x+w*.5,shoulder,bw,h*.31);
    ctx.fillStyle=rgba(d,.3);for(let yy=b-h*.5;yy<b-h*.12;yy+=Math.max(9,h*.18))ctx.fillRect(snap(x+w*.47),snap(yy),Math.max(2,snap(bw*.18)),3);
  }
}

function drawFoundry(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle=c; const kind=v%6;
  if(kind===0){
    // Furnace hall and substantial stack.
    ctx.fillRect(snap(x+w*.07),snap(b-h*.4),snap(w*.72),snap(h*.4));ctx.fillRect(snap(x+w*.58),snap(b-h*.9),snap(w*.15),snap(h*.53));ctx.fillRect(snap(x+w*.55),snap(b-h*.92),snap(w*.21),snap(h*.055));
    ctx.fillStyle=rgba(d,.3);ctx.fillRect(snap(x+w*.14),snap(b-h*.29),snap(w*.34),snap(h*.075));
  } else if(kind===1){
    // Storage tank and pipe run.
    ctx.fillRect(snap(x+w*.14),snap(b-h*.5),snap(w*.5),snap(h*.5));ctx.fillRect(snap(x+w*.19),snap(b-h*.58),snap(w*.4),snap(h*.09));ctx.fillRect(snap(x+w*.64),snap(b-h*.27),snap(w*.28),snap(h*.075));ctx.fillRect(snap(x+w*.84),snap(b-h*.27),4,snap(h*.2));
  } else if(kind===2){
    // Gantry/crane.
    const leg=Math.max(4,snap(w*.065));ctx.fillRect(snap(x+w*.18),snap(b-h*.62),leg,snap(h*.62));ctx.fillRect(snap(x+w*.72),snap(b-h*.48),leg,snap(h*.48));ctx.fillRect(snap(x+w*.15),snap(b-h*.66),snap(w*.67),snap(h*.075));ctx.fillRect(snap(x+w*.5),snap(b-h*.58),3,snap(h*.23));
  } else if(kind===3){
    // Sawtooth factory.
    ctx.fillRect(snap(x+w*.05),snap(b-h*.36),snap(w*.9),snap(h*.36));
    for(let i=0;i<3;i++){const sx=x+w*(.09+i*.28);ctx.beginPath();ctx.moveTo(snap(sx),snap(b-h*.36));ctx.lineTo(snap(sx+w*.12),snap(b-h*.51));ctx.lineTo(snap(sx+w*.22),snap(b-h*.36));ctx.closePath();ctx.fill();}
  } else if(kind===4){
    // Pipe rack with two squat vessels.
    ctx.fillRect(snap(x+w*.07),snap(b-h*.18),snap(w*.86),snap(h*.08));
    for(const ox of [.18,.62]){ctx.fillRect(snap(x+w*ox),snap(b-h*.43),snap(w*.18),snap(h*.34));ctx.fillRect(snap(x+w*(ox+.03)),snap(b-h*.49),snap(w*.12),snap(h*.07));}
    ctx.fillStyle=rgba(d,.28);ctx.fillRect(snap(x+w*.13),snap(b-h*.29),snap(w*.68),3);
  } else {
    // Broad cooling tower / hopper silhouette.
    ctx.beginPath();ctx.moveTo(snap(x+w*.22),snap(b));ctx.lineTo(snap(x+w*.32),snap(b-h*.65));ctx.lineTo(snap(x+w*.68),snap(b-h*.65));ctx.lineTo(snap(x+w*.78),snap(b));ctx.closePath();ctx.fill();
    ctx.fillRect(snap(x+w*.28),snap(b-h*.69),snap(w*.44),snap(h*.07));ctx.fillStyle=rgba(d,.22);ctx.fillRect(snap(x+w*.4),snap(b-h*.38),snap(w*.2),3);
  }
}

function drawRuins(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle=c; const kind=v%6;
  if(kind===0){
    // Broken arch.
    const cw=Math.max(6,snap(w*.15));ctx.fillRect(snap(x+w*.1),snap(b-h*.66),cw,snap(h*.66));ctx.fillRect(snap(x+w*.74),snap(b-h*.5),cw,snap(h*.5));ctx.fillRect(snap(x+w*.1),snap(b-h*.67),snap(w*.8),snap(h*.11));ctx.fillStyle=rgba(d,.18);ctx.fillRect(snap(x+w*.36),snap(b-h*.44),snap(w*.28),snap(h*.44));
  } else if(kind===1){
    // Column pair and broken lintel.
    const cw=Math.max(6,snap(w*.13));ctx.fillRect(snap(x+w*.2),snap(b-h*.7),cw,snap(h*.7));ctx.fillRect(snap(x+w*.64),snap(b-h*.6),cw,snap(h*.6));ctx.fillRect(snap(x+w*.15),snap(b-h*.73),snap(w*.57),snap(h*.065));
  } else if(kind===2){
    // Collapsed wall.
    ctx.fillRect(snap(x+w*.05),snap(b-h*.31),snap(w*.88),snap(h*.31));ctx.fillRect(snap(x+w*.12),snap(b-h*.5),snap(w*.22),snap(h*.2));ctx.fillRect(snap(x+w*.56),snap(b-h*.43),snap(w*.17),snap(h*.13));ctx.fillStyle=rgba(d,.2);ctx.fillRect(snap(x+w*.38),snap(b-h*.23),snap(w*.13),snap(h*.23));
  } else if(kind===3){
    // Broken tower.
    ctx.fillRect(snap(x+w*.28),snap(b-h*.7),snap(w*.4),snap(h*.7));ctx.fillStyle=rgba(d,.22);ctx.fillRect(snap(x+w*.38),snap(b-h*.5),snap(w*.1),snap(h*.13));ctx.fillRect(snap(x+w*.52),snap(b-h*.29),snap(w*.08),snap(h*.1));ctx.fillRect(snap(x+w*.28),snap(b-h*.77),snap(w*.13),snap(h*.08));
  } else if(kind===4){
    // Fragment of an aqueduct: two surviving bays.
    ctx.fillRect(snap(x+w*.06),snap(b-h*.52),snap(w*.88),snap(h*.12));
    for(const ox of [.12,.56]){ctx.fillRect(snap(x+w*ox),snap(b-h*.5),snap(w*.12),snap(h*.5));ctx.fillRect(snap(x+w*(ox+.24)),snap(b-h*.42),snap(w*.11),snap(h*.42));}
    ctx.fillStyle=rgba(d,.18);ctx.fillRect(snap(x+w*.28),snap(b-h*.34),snap(w*.2),snap(h*.34));ctx.fillRect(snap(x+w*.7),snap(b-h*.28),snap(w*.15),snap(h*.28));
  } else {
    // Pedestal, toppled statue/block and scattered fragments.
    ctx.fillRect(snap(x+w*.36),snap(b-h*.32),snap(w*.28),snap(h*.13));ctx.fillRect(snap(x+w*.42),snap(b-h*.5),snap(w*.16),snap(h*.19));
    ctx.fillRect(snap(x+w*.08),snap(b-h*.1),snap(w*.22),snap(h*.1));ctx.fillRect(snap(x+w*.72),snap(b-h*.13),snap(w*.18),snap(h*.13));
    ctx.fillStyle=rgba(d,.22);ctx.fillRect(snap(x+w*.16),snap(b-h*.18),snap(w*.2),snap(h*.07));
  }
}

function drawDesert(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle=c; const kind=v%7;
  if(kind===0){
    // Slender saguaro.
    const tw=Math.max(4,snap(w*.1)),tx=x+w*.47;ctx.fillRect(snap(tx),snap(b-h*.76),tw,snap(h*.76));ctx.fillRect(snap(tx-w*.22),snap(b-h*.5),snap(w*.23),tw);ctx.fillRect(snap(tx-w*.22),snap(b-h*.5),tw,snap(h*.2));ctx.fillRect(snap(tx+tw),snap(b-h*.38),snap(w*.24),tw);ctx.fillRect(snap(tx+w*.21),snap(b-h*.54),tw,snap(h*.18));
  } else if(kind===1||kind===4){
    // Layered boulders.
    ctx.fillRect(snap(x+w*.06),snap(b-h*.27),snap(w*.88),snap(h*.27));ctx.fillRect(snap(x+w*.18),snap(b-h*.42),snap(w*.56),snap(h*.16));ctx.fillRect(snap(x+w*.43),snap(b-h*.5),snap(w*.28),snap(h*.09));
  } else if(kind===2){
    // Eroded arch.
    ctx.fillRect(snap(x+w*.1),snap(b-h*.54),snap(w*.18),snap(h*.54));ctx.fillRect(snap(x+w*.72),snap(b-h*.46),snap(w*.16),snap(h*.46));ctx.fillRect(snap(x+w*.1),snap(b-h*.54),snap(w*.78),snap(h*.13));
  } else if(kind===3){
    // Hoodoo pair.
    ctx.fillRect(snap(x+w*.22),snap(b-h*.58),snap(w*.18),snap(h*.58));ctx.fillRect(snap(x+w*.17),snap(b-h*.61),snap(w*.29),snap(h*.1));ctx.fillRect(snap(x+w*.61),snap(b-h*.42),snap(w*.14),snap(h*.42));ctx.fillRect(snap(x+w*.56),snap(b-h*.45),snap(w*.24),snap(h*.08));
  } else if(kind===5){
    // Dead twisted desert tree.
    const tw=Math.max(3,snap(w*.07));ctx.fillRect(snap(x+w*.48),snap(b-h*.52),tw,snap(h*.52));ctx.fillRect(snap(x+w*.3),snap(b-h*.45),snap(w*.22),3);ctx.fillRect(snap(x+w*.68),snap(b-h*.35),snap(w*.16),3);ctx.fillRect(snap(x+w*.31),snap(b-h*.45),3,snap(h*.14));
  } else {
    // Yucca/agave cluster, intentionally low.
    const cx=x+w*.5,base=b-h*.06;ctx.fillRect(snap(x+w*.36),snap(base),snap(w*.28),snap(h*.06));
    for(const [dx,hh] of [[-.22,.28],[-.1,.36],[0,.44],[.1,.34],[.22,.26]] as const){ctx.fillRect(snap(cx+w*dx),snap(b-h*hh),3,snap(h*hh));}
  }
  ctx.fillStyle=rgba(d,.22);ctx.fillRect(snap(x+w*.18),snap(b-h*.12),snap(w*.54),2);
}

function drawSnowyMountain(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle=c; const kind=v%7;
  if(kind===0){
    // Small chalet.
    ctx.fillRect(snap(x+w*.18),snap(b-h*.3),snap(w*.64),snap(h*.3));ctx.fillStyle=rgba(d,.6);ctx.beginPath();ctx.moveTo(snap(x+w*.08),snap(b-h*.3));ctx.lineTo(snap(x+w*.5),snap(b-h*.52));ctx.lineTo(snap(x+w*.92),snap(b-h*.3));ctx.closePath();ctx.fill();ctx.fillStyle=rgba('#17222d',.48);ctx.fillRect(snap(x+w*.44),snap(b-h*.18),snap(w*.14),snap(h*.18));
  } else if(kind===1){
    rectTree(ctx,x,b,w*.58,h*.9,c,d,false);rectTree(ctx,x+w*.43,b,w*.52,h*.7,c,d,false);
  } else if(kind===2){
    rectTree(ctx,x,b,w,h,c,d,false);
  } else if(kind===3){
    // Snow-dusted rock outcrop.
    ctx.fillRect(snap(x+w*.08),snap(b-h*.25),snap(w*.84),snap(h*.25));ctx.fillRect(snap(x+w*.24),snap(b-h*.4),snap(w*.47),snap(h*.16));ctx.fillStyle=rgba(d,.56);ctx.fillRect(snap(x+w*.24),snap(b-h*.41),snap(w*.47),snap(h*.07));
  } else if(kind===4){
    // Three small pines, varying height.
    rectTree(ctx,x,b,w*.42,h*.62,c,d,false);rectTree(ctx,x+w*.3,b,w*.46,h*.82,c,d,false);rectTree(ctx,x+w*.62,b,w*.36,h*.54,c,d,false);
  } else if(kind===5){
    // Snow boulder cluster.
    ctx.fillRect(snap(x+w*.13),snap(b-h*.18),snap(w*.72),snap(h*.18));ctx.fillRect(snap(x+w*.3),snap(b-h*.31),snap(w*.38),snap(h*.14));ctx.fillStyle=rgba(d,.5);ctx.fillRect(snap(x+w*.28),snap(b-h*.32),snap(w*.42),snap(h*.06));
  } else {
    // Tiny mountain shrine / way marker.
    ctx.fillRect(snap(x+w*.43),snap(b-h*.48),snap(w*.14),snap(h*.48));ctx.fillRect(snap(x+w*.3),snap(b-h*.35),snap(w*.4),snap(h*.08));ctx.fillStyle=rgba(d,.48);ctx.fillRect(snap(x+w*.39),snap(b-h*.53),snap(w*.22),snap(h*.07));
  }
}

function drawTemperateForest(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle=c; const kind=v%7;
  if(kind===0){
    // Fallen log and understorey.
    ctx.fillRect(snap(x+w*.07),snap(b-h*.17),snap(w*.84),snap(h*.12));ctx.fillRect(snap(x+w*.14),snap(b-h*.28),snap(w*.23),snap(h*.12));ctx.fillRect(snap(x+w*.62),snap(b-h*.25),snap(w*.18),snap(h*.1));
  } else if(kind===1){
    rectTree(ctx,x,b,w*.66,h,c,d,true);rectTree(ctx,x+w*.43,b,w*.58,h*.8,c,d,true);
  } else if(kind===2){
    rectTree(ctx,x,b,w,h,c,d,true);
  } else if(kind===3){
    // Stump with low mushrooms/ferns.
    ctx.fillRect(snap(x+w*.4),snap(b-h*.32),snap(w*.2),snap(h*.32));ctx.fillRect(snap(x+w*.34),snap(b-h*.35),snap(w*.32),snap(h*.08));ctx.fillStyle=rgba(d,.3);for(const ox of [.16,.7]){ctx.fillRect(snap(x+w*ox),snap(b-h*.09),3,snap(h*.09));ctx.fillRect(snap(x+w*(ox-.04)),snap(b-h*.1),snap(w*.12),3);}
  } else if(kind===4){
    // Light-trunk grove with compact crowns.
    ctx.fillStyle=rgba(d,.25);for(const ox of [.22,.48,.7])ctx.fillRect(snap(x+w*ox),snap(b-h*.58),3,snap(h*.58));ctx.fillStyle=c;ctx.fillRect(snap(x+w*.08),snap(b-h*.76),snap(w*.34),snap(h*.24));ctx.fillRect(snap(x+w*.34),snap(b-h*.86),snap(w*.34),snap(h*.3));ctx.fillRect(snap(x+w*.6),snap(b-h*.72),snap(w*.3),snap(h*.22));
  } else if(kind===5){
    // Dense shrub/fern patch.
    ctx.fillRect(snap(x+w*.06),snap(b-h*.22),snap(w*.88),snap(h*.22));for(const ox of [.14,.3,.5,.69,.83])ctx.fillRect(snap(x+w*ox),snap(b-h*.38),3,snap(h*.22));
  } else {
    // Crooked old tree with one-sided crown.
    ctx.fillRect(snap(x+w*.46),snap(b-h*.58),snap(w*.09),snap(h*.58));ctx.fillRect(snap(x+w*.5),snap(b-h*.52),snap(w*.25),3);ctx.fillRect(snap(x+w*.17),snap(b-h*.82),snap(w*.62),snap(h*.28));ctx.fillRect(snap(x+w*.08),snap(b-h*.7),snap(w*.48),snap(h*.2));
  }
}

function drawCity(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle=c; const kind=v%7;
  let bx=x+w*.12,bw=w*.72,bh=h*.72,cols=3,rows=4;
  if(kind===1){bx=x+w*.25;bw=w*.48;bh=h*.9;cols=2;rows=5;}
  else if(kind===2){bx=x+w*.06;bw=w*.88;bh=h*.46;cols=4;rows=2;}
  else if(kind===3){bx=x+w*.16;bw=w*.66;bh=h*.8;cols=4;rows=5;}
  else if(kind===4){bx=x+w*.12;bw=w*.74;bh=h*.62;cols=3;rows=3;}
  else if(kind===5){bx=x+w*.04;bw=w*.92;bh=h*.38;cols=5;rows=2;}
  else if(kind===6){bx=x+w*.08;bw=w*.84;bh=h*.52;cols=4;rows=2;}
  ctx.fillRect(snap(bx),snap(b-bh),snap(bw),snap(bh));
  if(kind===0||kind===3){ctx.fillRect(snap(bx+bw*.18),snap(b-bh-h*.1),snap(bw*.52),snap(h*.11));}
  if(kind===1){ctx.fillRect(snap(bx+bw*.48),snap(b-bh-h*.14),3,snap(h*.14));}
  if(kind===2){ctx.fillRect(snap(bx+bw*.58),snap(b-bh-h*.12),snap(bw*.22),snap(h*.13));ctx.fillRect(snap(bx+bw*.62),snap(b-bh),3,snap(h*.11));ctx.fillRect(snap(bx+bw*.76),snap(b-bh),3,snap(h*.11));}
  if(kind===4){ // balcony slab apartment
    ctx.fillStyle=rgba(d,.2);for(const yy of [.3,.55,.8])ctx.fillRect(snap(bx+bw*.08),snap(b-bh+bh*yy),snap(bw*.84),3);ctx.fillStyle=c;
  }
  if(kind===5){ // rowhouse/low commercial rhythm
    ctx.fillStyle=rgba(d,.22);for(let i=1;i<4;i++)ctx.fillRect(snap(bx+bw*i/4),snap(b-bh),2,snap(bh));ctx.fillStyle=c;
  }
  if(kind===6){ // warehouse with rooftop units
    ctx.fillRect(snap(bx+bw*.18),snap(b-bh-h*.08),snap(bw*.18),snap(h*.085));ctx.fillRect(snap(bx+bw*.6),snap(b-bh-h*.06),snap(bw*.15),snap(h*.065));
  }
  ctx.fillStyle=rgba(d,layer==='far'?.18:.36);
  const winW=Math.max(2,snap(Math.min(4,bw*.05),1)),winH=Math.max(2,snap(Math.min(5,bh*.05),1));
  for(let yy=0;yy<rows;yy++)for(let xx=0;xx<cols;xx++){
    if((xx+yy+v)%3===0)continue; const tx=cols===1?.5:.16+.68*xx/Math.max(1,cols-1),ty=rows===1?.5:.17+.64*yy/Math.max(1,rows-1);
    ctx.fillRect(snap(bx+bw*tx-winW*.5),snap(b-bh+bh*ty-winH*.5),winW,winH);
  }
}

function drawRuralVillage(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle=c; const kind=v%10;
  const roof=(left:number,right:number,eave:number,peakX:number,peakY:number,color:string)=>{ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(snap(left),snap(eave));ctx.lineTo(snap(peakX),snap(peakY));ctx.lineTo(snap(right),snap(eave));ctx.closePath();ctx.fill();};
  if(kind===0){
    // Classic single-storey gable cottage.
    ctx.fillRect(snap(x+w*.16),snap(b-h*.34),snap(w*.68),snap(h*.34));roof(x+w*.08,x+w*.92,b-h*.34,x+w*.5,b-h*.57,rgba(d,.45));
    ctx.fillStyle=rgba('#1d2524',.44);ctx.fillRect(snap(x+w*.45),snap(b-h*.18),snap(w*.12),snap(h*.18));ctx.fillRect(snap(x+w*.25),snap(b-h*.22),snap(w*.1),snap(h*.08));ctx.fillRect(snap(x+w*.68),snap(b-h*.22),snap(w*.1),snap(h*.08));
  } else if(kind===1){
    // Side-gabled farmhouse with chimney and lean-to.
    ctx.fillRect(snap(x+w*.12),snap(b-h*.38),snap(w*.58),snap(h*.38));roof(x+w*.08,x+w*.74,b-h*.38,x+w*.36,b-h*.6,rgba(d,.44));ctx.fillRect(snap(x+w*.68),snap(b-h*.24),snap(w*.24),snap(h*.24));ctx.fillRect(snap(x+w*.22),snap(b-h*.66),snap(w*.07),snap(h*.18));
    ctx.fillStyle=rgba('#1d2524',.42);ctx.fillRect(snap(x+w*.42),snap(b-h*.18),snap(w*.11),snap(h*.18));
  } else if(kind===2){
    // Haystacks + shade tree.
    ctx.fillRect(snap(x+w*.06),snap(b-h*.2),snap(w*.32),snap(h*.2));ctx.fillRect(snap(x+w*.13),snap(b-h*.3),snap(w*.2),snap(h*.11));rectTree(ctx,x+w*.49,b,w*.46,h*.58,c,d,true);
  } else if(kind===3){
    // Barn.
    ctx.fillRect(snap(x+w*.06),snap(b-h*.32),snap(w*.88),snap(h*.32));ctx.fillStyle=rgba(d,.42);ctx.beginPath();ctx.moveTo(snap(x+w*.02),snap(b-h*.32));ctx.lineTo(snap(x+w*.32),snap(b-h*.51));ctx.lineTo(snap(x+w*.68),snap(b-h*.51));ctx.lineTo(snap(x+w*.98),snap(b-h*.32));ctx.closePath();ctx.fill();ctx.fillStyle=rgba('#1d2524',.43);ctx.fillRect(snap(x+w*.42),snap(b-h*.2),snap(w*.18),snap(h*.2));
  } else if(kind===4){
    // Taller stone farmhouse with offset roof and chimney.
    ctx.fillRect(snap(x+w*.19),snap(b-h*.5),snap(w*.58),snap(h*.5));roof(x+w*.13,x+w*.83,b-h*.5,x+w*.54,b-h*.68,rgba(d,.42));ctx.fillRect(snap(x+w*.25),snap(b-h*.74),snap(w*.07),snap(h*.18));ctx.fillStyle=rgba(d,.24);ctx.fillRect(snap(x+w*.31),snap(b-h*.36),snap(w*.1),snap(h*.09));ctx.fillRect(snap(x+w*.58),snap(b-h*.36),snap(w*.1),snap(h*.09));
  } else if(kind===5){
    // Rare windmill.
    const tx=x+w*.45;ctx.fillRect(snap(tx),snap(b-h*.51),snap(w*.12),snap(h*.51));const hx=x+w*.51,hy=b-h*.57;ctx.fillStyle=rgba(d,.45);ctx.fillRect(snap(hx-w*.22),snap(hy-2),snap(w*.44),4);ctx.fillRect(snap(hx-2),snap(hy-h*.22),4,snap(h*.44));ctx.fillRect(snap(hx-3),snap(hy-3),6,6);
  } else if(kind===6){
    // Open-front stable / shed.
    ctx.fillRect(snap(x+w*.1),snap(b-h*.27),snap(w*.78),snap(h*.27));ctx.fillStyle=rgba(d,.38);ctx.fillRect(snap(x+w*.06),snap(b-h*.35),snap(w*.86),snap(h*.09));ctx.fillStyle=rgba('#1d2524',.35);ctx.fillRect(snap(x+w*.24),snap(b-h*.22),snap(w*.2),snap(h*.22));ctx.fillRect(snap(x+w*.58),snap(b-h*.22),snap(w*.18),snap(h*.22));
  } else if(kind===7){
    // Orchard/copse: intentionally no building.
    rectTree(ctx,x,b,w*.42,h*.64,c,d,true);rectTree(ctx,x+w*.3,b,w*.4,h*.72,c,d,true);rectTree(ctx,x+w*.62,b,w*.34,h*.56,c,d,true);
  } else if(kind===8){
    // Tiny chapel as a rare civic landmark.
    ctx.fillRect(snap(x+w*.26),snap(b-h*.38),snap(w*.5),snap(h*.38));roof(x+w*.2,x+w*.82,b-h*.38,x+w*.5,b-h*.58,rgba(d,.44));ctx.fillRect(snap(x+w*.42),snap(b-h*.72),snap(w*.16),snap(h*.2));roof(x+w*.4,x+w*.6,b-h*.72,x+w*.5,b-h*.84,rgba(d,.44));ctx.fillStyle=rgba('#1d2524',.38);ctx.fillRect(snap(x+w*.46),snap(b-h*.2),snap(w*.1),snap(h*.2));
  } else {
    // Hedgerow / field boundary: deliberately low and building-free.
    ctx.fillRect(snap(x+w*.05),snap(b-h*.12),snap(w*.9),snap(h*.12));
    ctx.fillRect(snap(x+w*.18),snap(b-h*.22),snap(w*.18),snap(h*.12));ctx.fillRect(snap(x+w*.61),snap(b-h*.2),snap(w*.22),snap(h*.1));
    ctx.fillStyle=rgba(d,.23);for(const ox of [.1,.31,.55,.78])ctx.fillRect(snap(x+w*ox),snap(b-h*.2),2,snap(h*.2));
  }
}

function drawSwamp(
  ctx: CanvasRenderingContext2D, x: number, b: number, w: number, h: number,
  c: string, d: string, v: number, layer: Layer,
) {
  ctx.fillStyle=c; const kind=v%7;
  if(kind===0){
    // Dead snag.
    const tx=x+w*.46,tw=Math.max(4,snap(w*.09));ctx.fillRect(snap(tx),snap(b-h*.75),tw,snap(h*.75));ctx.fillRect(snap(tx-w*.2),snap(b-h*.1),snap(w*.5),snap(h*.1));ctx.fillRect(snap(tx-w*.24),snap(b-h*.53),snap(w*.27),4);ctx.fillRect(snap(tx+w*.06),snap(b-h*.42),snap(w*.27),4);
  } else if(kind===1||kind===4){
    // Cypress with buttressed base.
    ctx.fillRect(snap(x+w*.44),snap(b-h*.66),Math.max(4,snap(w*.1)),snap(h*.66));ctx.fillRect(snap(x+w*.27),snap(b-h*.12),snap(w*.46),snap(h*.12));ctx.fillRect(snap(x+w*.18),snap(b-h*.68),snap(w*.64),snap(h*.18));ctx.fillRect(snap(x+w*.28),snap(b-h*.82),snap(w*.47),snap(h*.16));
  } else if(kind===2){
    // Willow with hanging strands.
    ctx.fillRect(snap(x+w*.44),snap(b-h*.54),Math.max(4,snap(w*.1)),snap(h*.54));ctx.fillRect(snap(x+w*.07),snap(b-h*.7),snap(w*.86),snap(h*.2));ctx.fillRect(snap(x+w*.18),snap(b-h*.82),snap(w*.62),snap(h*.16));ctx.fillStyle=rgba(d,.24);for(let i=0;i<5;i++)ctx.fillRect(snap(x+w*(.18+i*.15)),snap(b-h*.57),2,snap(h*(.15+(i%2)*.08)));
  } else if(kind===3){
    // Reed island.
    ctx.fillRect(snap(x+w*.04),snap(b-h*.12),snap(w*.92),snap(h*.12));for(let i=0;i<7;i++){const rx=x+w*(.1+i*.125);ctx.fillRect(snap(rx),snap(b-h*(.2+(i%3)*.06)),2,snap(h*(.16+(i%3)*.06)));}
  } else if(kind===5){
    // Fallen waterlogged trunk.
    ctx.fillRect(snap(x+w*.07),snap(b-h*.13),snap(w*.78),snap(h*.11));ctx.fillRect(snap(x+w*.13),snap(b-h*.23),snap(w*.18),snap(h*.11));ctx.fillStyle=rgba(d,.25);ctx.fillRect(snap(x+w*.63),snap(b-h*.18),snap(w*.22),3);
  } else {
    // Cypress knees + cattail patch, low and distinctive.
    for(const [ox,hh] of [[.16,.18],[.28,.28],[.43,.2],[.6,.32],[.77,.22]] as const){ctx.beginPath();ctx.moveTo(snap(x+w*(ox-.05)),snap(b));ctx.lineTo(snap(x+w*ox),snap(b-h*hh));ctx.lineTo(snap(x+w*(ox+.05)),snap(b));ctx.closePath();ctx.fill();}
    ctx.fillStyle=rgba(d,.3);for(const ox of [.09,.52,.86]){ctx.fillRect(snap(x+w*ox),snap(b-h*.3),2,snap(h*.3));ctx.fillRect(snap(x+w*(ox-.015)),snap(b-h*.31),4,4);}
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
  let layout:AssetLayout;
  const v7=variant%7,v6=variant%6,v10=variant%10;
  if(biome==='lowlands'){
    const specs:AssetLayout[]=[{aspect:2.5,height:64},{aspect:1.08,height:94},{aspect:1.15,height:82},{aspect:2.3,height:56},{aspect:1.5,height:88},{aspect:2.45,height:54},{aspect:2.25,height:58}];layout=specs[v7];
  }else if(biome==='spires'){
    const specs:AssetLayout[]=[{aspect:.58,height:122},{aspect:1.08,height:106},{aspect:1.3,height:96},{aspect:1.18,height:92},{aspect:1.18,height:102},{aspect:1.12,height:108},{aspect:1.3,height:112}];layout=specs[v7];
  }else if(biome==='foundry'){
    const specs:AssetLayout[]=[{aspect:1.45,height:86},{aspect:1.58,height:74},{aspect:1.82,height:78},{aspect:1.95,height:84},{aspect:2.0,height:72},{aspect:1.18,height:88}];layout=specs[v6];
  }else if(biome==='ruins'){
    const specs:AssetLayout[]=[{aspect:1.25,height:82},{aspect:1.08,height:86},{aspect:1.8,height:82},{aspect:.8,height:90},{aspect:2.05,height:84},{aspect:1.75,height:68}];
    layout=specs[v6]; if(v6===3)layout={aspect:.8,height:90};
  }else if(biome==='desert'){
    const specs:AssetLayout[]=[{aspect:.72,height:84},{aspect:1.9,height:72},{aspect:1.46,height:80},{aspect:1.08,height:84},{aspect:1.85,height:68},{aspect:1.25,height:72},{aspect:1.55,height:60}];layout=specs[v7];
  }else if(biome==='snowy-mountains'){
    const specs:AssetLayout[]=[{aspect:1.55,height:86},{aspect:1.15,height:94},{aspect:.76,height:102},{aspect:1.75,height:68},{aspect:1.4,height:92},{aspect:1.7,height:58},{aspect:.9,height:72}];layout=specs[v7];
  }else if(biome==='temperate-forest'){
    const specs:AssetLayout[]=[{aspect:2.15,height:74},{aspect:1.48,height:98},{aspect:1.02,height:104},{aspect:1.3,height:72},{aspect:1.65,height:96},{aspect:2.0,height:64},{aspect:1.15,height:100}];layout=specs[v7];
  }else if(biome==='city'){
    const specs:AssetLayout[]=[{aspect:.78,height:122},{aspect:.52,height:148},{aspect:1.45,height:80},{aspect:.83,height:132},{aspect:1.02,height:112},{aspect:1.8,height:76},{aspect:1.55,height:84}];layout=specs[v7];
  }else if(biome==='rural-village'){
    const specs:AssetLayout[]=[{aspect:1.7,height:84},{aspect:1.8,height:88},{aspect:1.7,height:80},{aspect:1.9,height:88},{aspect:1.45,height:96},{aspect:.95,height:104},{aspect:1.85,height:72},{aspect:1.75,height:82},{aspect:1.15,height:94},{aspect:2.35,height:52}];layout=specs[v10];
  }else{
    const specs:AssetLayout[]=[{aspect:1.08,height:90},{aspect:1.02,height:96},{aspect:1.32,height:90},{aspect:2.1,height:76},{aspect:1.02,height:94},{aspect:2.0,height:58},{aspect:1.7,height:66}];layout=specs[v7];
  }
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
  const zoomScale=Math.max(.22,Math.min(1.7,cameraScale/.8));
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
  // Render the whole motif in a local pixel coordinate system, then translate that rigid image
  // into screen space. Previously every sub-rectangle re-snapped its own absolute screen X/Y,
  // which let windows/details cross pixel thresholds on different frames and appear to crawl.
  ctx.save();
  ctx.translate(snap(centerX,1), snap(baseY,1));
  if(flipX) ctx.scale(-1,1);
  drawFeatureForBiome(ctx,biome,-width*.5,0,width,height,color,detail,variant,layer);
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

function smooth01(value:number){ const t=Math.max(0,Math.min(1,value)); return t*t*(3-2*t); }
function lerp(a:number,b:number,t:number){ return a+(b-a)*t; }
function noise1D(seed:number, namespace:number, x:number){
  const i=Math.floor(x), t=x-i, a=biomeRandom01(seed,namespace,i), b=biomeRandom01(seed,namespace,i+1), s=t*t*(3-2*t);
  return a+(b-a)*s;
}
function fbm1D(seed:number, namespace:number, x:number, octaves=4){
  let amplitude=.5, frequency=1, sum=0, norm=0;
  for(let i=0;i<octaves;i++){
    sum += noise1D(seed, namespace ^ (i*0x9e37), x*frequency) * amplitude;
    norm += amplitude; amplitude *= .5; frequency *= 2;
  }
  return norm>0?sum/norm:0;
}
function quantizedNoise(seed:number, namespace:number, worldX:number, segmentWidth:number, min:number, max:number){
  const seg=Math.floor(worldX/segmentWidth);
  const local=(worldX-seg*segmentWidth)/segmentWidth;
  const a=min+(max-min)*biomeRandom01(seed,namespace,seg);
  const b=min+(max-min)*biomeRandom01(seed,namespace,seg+1);
  const edge=Math.max(0,Math.min(1,(local-.08)/.16))*Math.max(0,Math.min(1,(.92-local)/.16));
  const t=smooth01(local);
  return lerp(lerp(a,a,edge), lerp(a,b,t), 1-edge);
}

function snowyMassifUnits(layer:'far'|'mid', worldX:number, seed:number){
  const namespace=0x1200|namespaceForLayer(layer);
  const spacing=layer==='far'?3800:3100;
  const baseIndex=Math.floor(worldX/spacing);
  let dominant=0;
  let secondary=0;
  // Evaluate a small number of broad, world-anchored peaks. Adjacent massifs overlap gently,
  // producing large mountain bodies instead of high-frequency ridged-noise saw teeth.
  for(let index=baseIndex-2; index<=baseIndex+2; index++){
    const jitter=(biomeRandom01(seed,namespace^0x31,index)-.5)*spacing*.28;
    const center=index*spacing+spacing*.5+jitter;
    const halfWidth=spacing*(.48+biomeRandom01(seed,namespace^0x32,index)*.18);
    const distance=Math.abs(worldX-center)/halfWidth;
    if(distance>=1) continue;

    // Keep a broad massif base but add a much narrower cusp-like summit. The previous pure
    // polynomial bump made every peak read as a rounded hill. The absolute-distance summit keeps
    // the peak world-anchored while giving the upper silhouette a sharper alpine point.
    const shoulder=1-distance*distance;
    const broadMass=shoulder*shoulder;
    const summitWidth=.34+biomeRandom01(seed,namespace^0x36,index)*.12;
    const summitDistance=distance/summitWidth;
    const summit=summitDistance<1 ? Math.pow(1-summitDistance,.72) : 0;
    const height=(layer==='far'?.46:.24)+(layer==='far'?.28:.16)*biomeRandom01(seed,namespace^0x33,index);
    const value=broadMass*height*.78 + summit*height*.42;
    if(value>dominant){ secondary=dominant; dominant=value; }
    else if(value>secondary){ secondary=value; }
  }
  const foothills=fbm1D(seed,namespace^0x34,worldX/(layer==='far'?4200:3300),3);
  const localShoulders=fbm1D(seed,namespace^0x35,worldX/(layer==='far'?1550:1250),2);
  return (layer==='far'?.16:.13) + dominant + secondary*.22 + foothills*(layer==='far'?.09:.06) + localShoulders*.035;
}

function panoramaUnitsForBiome(biome:BiomeId,layer:'far'|'mid',worldX:number,seed:number){
  const x = worldX;
  if(biome==='lowlands'){
    const broad=fbm1D(seed,0x1000|namespaceForLayer(layer),x/1800,3), soft=fbm1D(seed,0x1001|namespaceForLayer(layer),x/700,2);
    return layer==='far' ? .22 + broad*.18 + soft*.06 : .14 + broad*.13 + soft*.08;
  }
  if(biome==='desert'){
    const dunes=fbm1D(seed,0x1100|namespaceForLayer(layer),x/1600,3), mesas=Math.max(0,(noise1D(seed,0x1101|namespaceForLayer(layer),x/2100)-.54)/.46);
    return layer==='far' ? .12 + dunes*.1 + mesas*.34 : .1 + dunes*.08 + mesas*.24;
  }
  if(biome==='snowy-mountains'){
    return snowyMassifUnits(layer,x,seed);
  }
  if(biome==='temperate-forest'){
    const hills=fbm1D(seed,0x1300|namespaceForLayer(layer),x/1700,3), canopy=fbm1D(seed,0x1301|namespaceForLayer(layer),x/320,2);
    return layer==='far' ? .16 + hills*.14 + canopy*.08 : .16 + hills*.1 + canopy*.14;
  }
  if(biome==='city'){
    const blocks=quantizedNoise(seed,0x1400|namespaceForLayer(layer),x,layer==='far'?420:300,.18,layer==='far'?.74:.62);
    const towers=Math.max(0,(noise1D(seed,0x1401|namespaceForLayer(layer),x/(layer==='far'?1000:760))-.72)/.28);
    return blocks + towers*(layer==='far'?.12:.18);
  }
  if(biome==='rural-village'){
    const fields=fbm1D(seed,0x1500|namespaceForLayer(layer),x/1700,3), roofline=Math.max(0,(noise1D(seed,0x1501|namespaceForLayer(layer),x/950)-.74)/.26);
    return layer==='far' ? .12 + fields*.1 + roofline*.08 : .12 + fields*.08 + roofline*.12;
  }
  if(biome==='swamp'){
    const flats=fbm1D(seed,0x1600|namespaceForLayer(layer),x/2000,2), reeds=fbm1D(seed,0x1601|namespaceForLayer(layer),x/420,2);
    return layer==='far' ? .08 + flats*.05 + reeds*.06 : .1 + flats*.04 + reeds*.1;
  }
  if(biome==='spires'){
    const base=quantizedNoise(seed,0x1700|namespaceForLayer(layer),x,layer==='far'?520:360,.08,.18);
    const spike=Math.pow(Math.max(0,(noise1D(seed,0x1701|namespaceForLayer(layer),x/(layer==='far'?650:420))-.55)/.45), layer==='far'?2.8:2.2);
    return base + spike*(layer==='far'?.74:.58);
  }
  if(biome==='foundry'){
    const blocks=quantizedNoise(seed,0x1800|namespaceForLayer(layer),x,layer==='far'?440:320,.14,.34);
    const stacks=Math.max(0,(noise1D(seed,0x1801|namespaceForLayer(layer),x/(layer==='far'?780:520))-.68)/.32);
    return blocks + stacks*(layer==='far'?.32:.26);
  }
  // ruins
  const walls=quantizedNoise(seed,0x1900|namespaceForLayer(layer),x,layer==='far'?480:340,.1,.28);
  const towers=Math.max(0,(noise1D(seed,0x1901|namespaceForLayer(layer),x/(layer==='far'?900:600))-.7)/.3);
  return walls + towers*(layer==='far'?.28:.22);
}

function mixedPanoramaUnits(sample:BiomeSample,layer:'far'|'mid',worldX:number,seed:number){
  const a=panoramaUnitsForBiome(sample.primary,layer,worldX,seed);
  if(!sample.secondary) return a;
  const b=panoramaUnitsForBiome(sample.secondary,layer,worldX,seed);
  return lerp(a,b,sample.blend);
}

function panoramaHeightScalePx(layer:'far'|'mid',cssHeight:number){
  return layer==='far' ? cssHeight*.34 : cssHeight*.23;
}

function panoramaAlphaForLayer(layer:'far'|'mid',normalizedZoom:number){
  return layer==='far'
    ? lerp(.55,.82,smooth01((normalizedZoom-.28)/.6))
    : lerp(.62,.92,smooth01((normalizedZoom-.34)/.6));
}

function landmarkAlphaForLayer(layer:'mid'|'near'|'foreground',normalizedZoom:number){
  if(layer==='mid') return smooth01((normalizedZoom-.22)/.55)*.95;
  if(layer==='near') return smooth01((normalizedZoom-.36)/.5)*.96;
  return smooth01((normalizedZoom-.58)/.5)*.18;
}

function landmarkStrideForLayer(layer:'mid'|'near'|'foreground',normalizedZoom:number){
  if(layer==='mid') return normalizedZoom<.35?4:normalizedZoom<.5?3:normalizedZoom<.75?2:1;
  if(layer==='near') return normalizedZoom<.42?4:normalizedZoom<.58?3:normalizedZoom<.82?2:1;
  return normalizedZoom<.72?3:normalizedZoom<.95?2:1;
}

function drawContinuousPanorama(ctx:CanvasRenderingContext2D,layer:'far'|'mid',o:BackgroundDrawOptions){
  const parallax=parallaxByLayer[layer],{cameraCenterX,cameraCenterY,cameraScale,cssWidth,cssHeight,worldSeed}=o;
  const verticalParallax=layer==='far'?.045:.09,baselineRatio=layer==='far'?.72:.79;
  const baselineY=cssHeight*baselineRatio+(WORLD_REF_HEIGHT*.64-cameraCenterY)*cameraScale*verticalParallax;
  const fitScale=Math.max(.0001,Math.min(cssWidth/1280,cssHeight/720));
  const normalizedZoom=cameraScale/fitScale;
  // Preserve silhouette proportions when pair framing zooms out. Previously only panorama X
  // compressed with cameraScale while Y stayed tied to viewport height, visibly distorting peaks.
  const panoramaZoom=Math.max(.45,Math.min(1.8,normalizedZoom));
  const maxHeight=panoramaHeightScalePx(layer,cssHeight)*panoramaZoom;
  const alpha=panoramaAlphaForLayer(layer,normalizedZoom);

  // IMPORTANT: sample the panorama on a FIXED WORLD-SPACE lattice. A previous screen-space
  // tessellation sampled different world X values every time the camera moved, so sharp mountain
  // ridges were linearly reconstructed from a changing set of points and appeared to wave/breathe.
  // Fixed world nodes only translate under parallax; their heights never change with camera X.
  const worldStep=layer==='far'?180:110;
  const halfVisibleWorld=cssWidth*.55/Math.max(.0001,cameraScale*parallax);
  const minWorldX=cameraCenterX-halfVisibleWorld-worldStep*2;
  const maxWorldX=cameraCenterX+halfVisibleWorld+worldStep*2;
  const firstNode=Math.floor(minWorldX/worldStep)*worldStep;

  ctx.save(); ctx.globalAlpha*=alpha;
  type Point={x:number;y:number;worldX:number;units:number};
  const points:Point[]=[];
  for(let worldX=firstNode;worldX<=maxWorldX+worldStep;worldX+=worldStep){
    const sample=getBiomeAtX(worldX,worldSeed);
    const units=mixedPanoramaUnits(sample,layer,worldX,worldSeed);
    const x=cssWidth*.5+(worldX-cameraCenterX)*cameraScale*parallax;
    points.push({x,y:baselineY-maxHeight*units,worldX,units});
  }

  // Fill one fixed-world segment at a time. Color is sampled at the segment midpoint so biome
  // transitions remain geographically anchored as well.
  for(let i=0;i<points.length-1;i++){
    const a=points[i], b=points[i+1];
    if(b.x<-80||a.x>cssWidth+80) continue;
    const midSample=getBiomeAtX((a.worldX+b.worldX)*.5,worldSeed);
    const midPalette=lightBiomePalette(paletteForBiomeSample(midSample),o.lighting);
    ctx.fillStyle=layer==='far'?midPalette.far:midPalette.mid;
    ctx.beginPath();
    ctx.moveTo(snap(a.x),snap(cssHeight+2));
    ctx.lineTo(snap(a.x),snap(a.y));
    ctx.lineTo(snap(b.x),snap(b.y));
    ctx.lineTo(snap(b.x),snap(cssHeight+2));
    ctx.closePath(); ctx.fill();
  }

  // Subtle horizon highlight. Because the same fixed world nodes are reused every frame, this
  // outline now slides rigidly with the landscape instead of being re-fitted to screen columns.
  ctx.globalAlpha *= layer==='far' ? .28 : .22;
  ctx.lineWidth=2;
  for(let i=0;i<points.length-1;i++){
    const a=points[i], b=points[i+1];
    if(b.x<-80||a.x>cssWidth+80) continue;
    const midSample=getBiomeAtX((a.worldX+b.worldX)*.5,worldSeed);
    const biome=chooseBiome(midSample,.5);
    const palette=lightBiomePalette(paletteForBiomeSample(midSample),o.lighting);
    ctx.strokeStyle=biome==='snowy-mountains' ? rgba('#eef6ff',layer==='far'?.36:.28)
      : biome==='city'||biome==='foundry'||biome==='spires'||biome==='ruins' ? rgba(palette.detail,.18)
      : rgba(palette.detail,.12);
    ctx.beginPath();ctx.moveTo(snap(a.x),snap(a.y));ctx.lineTo(snap(b.x),snap(b.y));ctx.stroke();
    if(biome==='snowy-mountains'){
      // A proper snow cap covers the upper massif rather than acting as a thin ridge highlight.
      // It is still drawn as a continuous strip between fixed world nodes, so sharpening the
      // mountains does not bring back the old saw-tooth / camera-wobble artifact.
      const snowThreshold=layer==='far'?.34:.28;
      const snowRange=layer==='far'?.42:.30;
      const strength=Math.max(0,Math.min(1,((a.units+b.units)*.5-snowThreshold)/snowRange));
      if(strength>.02){
        const baseDepth=layer==='far'?.012:.008;
        const extraDepth=layer==='far'?.034:.021;
        const depth=Math.max(layer==='far'?5:3,cssHeight*(baseDepth+extraDepth*strength));
        const daylightAlpha=layer==='far'?.34:.22;
        const twilightAlpha=layer==='far'?.28:.18;
        const nightAlpha=layer==='far'?.18:.12;
        ctx.fillStyle=rgba('#f1f8ff',(daylightAlpha*o.lighting.daylight+twilightAlpha*o.lighting.twilight+nightAlpha*o.lighting.night)*(.48+.52*strength));
        ctx.beginPath();
        ctx.moveTo(snap(a.x),snap(a.y));
        ctx.lineTo(snap(b.x),snap(b.y));
        ctx.lineTo(snap(b.x),snap(b.y+depth));
        ctx.lineTo(snap(a.x),snap(a.y+depth));
        ctx.closePath();ctx.fill();

        // A small brighter crown on the very highest sections makes the summit read snowy even
        // against a pale daytime sky without adding separate triangular teeth.
        if(strength>.62){
          const crownDepth=Math.max(2,depth*.34);
          ctx.fillStyle=rgba('#ffffff',(layer==='far'?.26:.17)*strength);
          ctx.beginPath();
          ctx.moveTo(snap(a.x),snap(a.y));
          ctx.lineTo(snap(b.x),snap(b.y));
          ctx.lineTo(snap(b.x),snap(b.y+crownDepth));
          ctx.lineTo(snap(a.x),snap(a.y+crownDepth));
          ctx.closePath();ctx.fill();
        }
      }
    }
  }
  ctx.restore();
}

function placementJitterForBiome(biome:BiomeId,layer:'mid'|'near'|'foreground',viewportScale:number):number{
  const built=biome==='city'||biome==='foundry'||biome==='spires'||biome==='ruins';
  const base=built ? (layer==='mid'?2:layer==='near'?3:4) : biome==='rural-village' ? (layer==='mid'?3:layer==='near'?5:7) : (layer==='mid'?4:layer==='near'?6:9);
  return base*viewportScale;
}

function drawLandmarkLayer(ctx:CanvasRenderingContext2D,cache:BiomeBackgroundCache,layer:'mid'|'near',o:BackgroundDrawOptions){
  const parallax=parallaxByLayer[layer],{cameraCenterX,cameraCenterY,cameraScale,cssWidth,cssHeight,worldSeed}=o;
  const halfWorldVisible=cssWidth*.62/Math.max(.0001,cameraScale*parallax),minChunk=Math.floor((cameraCenterX-halfWorldVisible)/BACKGROUND_CHUNK_WIDTH)-1,maxChunk=Math.floor((cameraCenterX+halfWorldVisible)/BACKGROUND_CHUNK_WIDTH)+1;
  const chunkCount=maxChunk-minChunk+1;
  cache.ensureCapacity(chunkCount*3+48);
  const verticalParallax=layer==='mid'?.09:.16, baselineRatio=layer==='mid'?.79:.85;
  const baselineY=cssHeight*baselineRatio+(WORLD_REF_HEIGHT*.64-cameraCenterY)*cameraScale*verticalParallax;
  const viewportScale=Math.max(.68,Math.min(1.45,Math.min(cssWidth/1280,cssHeight/720)));
  const fitScale=Math.max(.0001,Math.min(cssWidth/1280,cssHeight/720));
  const normalizedZoom=cameraScale/fitScale;
  const alpha=landmarkAlphaForLayer(layer,normalizedZoom); if(alpha<=.01) return;
  const stride=landmarkStrideForLayer(layer,normalizedZoom);
  ctx.save(); ctx.globalAlpha*=alpha;
  for(let chunkIndex=minChunk;chunkIndex<=maxChunk;chunkIndex++){
    const chunk=cache.getChunk(layer,chunkIndex,worldSeed), chunkWorldX=chunkIndex*BACKGROUND_CHUNK_WIDTH;
    for(let featureIndex=0;featureIndex<chunk.features.length;featureIndex++){
      if(featureIndex%stride!==0) continue;
      const feature=chunk.features[featureIndex], featureWorldX=chunkWorldX+feature.x*BACKGROUND_CHUNK_WIDTH, screenX=cssWidth*.5+(featureWorldX-cameraCenterX)*cameraScale*parallax;
      const featureSample=getBiomeAtX(featureWorldX,worldSeed), featurePalette=lightBiomePalette(paletteForBiomeSample(featureSample),o.lighting), biome=feature.biome;
      const dims=featureDimensions(biome,layer,feature.variant,feature.scale,cssWidth,cssHeight,cameraScale);
      const baseY=baselineY+feature.yJitter*placementJitterForBiome(biome,layer,viewportScale)+dims.groundOffset;
      const color=layer==='mid'?featurePalette.mid:featurePalette.near;
      drawPlacedFeature(ctx,biome,screenX,baseY,dims.width,dims.height,color,featurePalette.detail,feature.variant,layer,feature.flipX);
    }
  }
  ctx.restore();
}

function drawAmbientDetailsForBiome(ctx:CanvasRenderingContext2D,o:BackgroundDrawOptions,biome:BiomeId,alpha:number,xMin:number,xMax:number){
  if(alpha<=.01)return;
  const sample=getBiomeAtX((xMin+xMax)*.5,o.worldSeed),p=lightBiomePalette(paletteForBiomeSample(sample),o.lighting);
  ctx.save();ctx.globalAlpha*=alpha;
  const span=xMax-xMin;
  const countFactor=Math.max(1,Math.floor(span/1800));
  if(biome==='desert'){
    ctx.fillStyle=rgba(p.detail,.12);for(let i=0;i<6*countFactor;i++){const wx=xMin+biomeRandom01(o.worldSeed,0x53414e44,i+sample.regionIndex*11)*span;const x=o.cssWidth*.5+(wx-o.cameraCenterX)*o.cameraScale*.58;const y=o.cssHeight*(.6+((i%4)*.05));ctx.fillRect(snap(x),snap(y),18+(i%3)*12,2);}
  } else if(biome==='snowy-mountains'){
    ctx.fillStyle=rgba(p.detail,.26);for(let i=0;i<10*countFactor;i++){const wx=xMin+biomeRandom01(o.worldSeed,0x534e4f57,i+sample.regionIndex*29)*span;const x=o.cssWidth*.5+(wx-o.cameraCenterX)*o.cameraScale*.4;const y=o.cssHeight*(.12+biomeRandom01(o.worldSeed,0x534e5959,i+sample.regionIndex*29)*.66);ctx.fillRect(snap(x),snap(y),i%5===0?3:2,i%5===0?3:2);}
  } else if(biome==='temperate-forest'){
    ctx.fillStyle=rgba(p.detail,.12);for(let i=0;i<8*countFactor;i++){const wx=xMin+biomeRandom01(o.worldSeed,0x4c454146,i+sample.regionIndex*17)*span;const x=o.cssWidth*.5+(wx-o.cameraCenterX)*o.cameraScale*.46;const y=o.cssHeight*(.3+biomeRandom01(o.worldSeed,0x4c454159,i+sample.regionIndex*17)*.42);ctx.fillRect(snap(x),snap(y),3,2);}
  } else if(biome==='rural-village'){
    ctx.fillStyle=rgba(p.detail,.12);const y=snap(o.cssHeight*.83);for(let x=28;x<o.cssWidth;x+=164){ctx.fillRect(x,y,54,2);ctx.fillRect(x,y-11,3,14);ctx.fillRect(x+51,y-11,3,14);}
  } else if(biome==='swamp'){
    ctx.fillStyle=rgba(p.haze,.11);ctx.fillRect(0,snap(o.cssHeight*.51),o.cssWidth,16);ctx.fillRect(0,snap(o.cssHeight*.69),o.cssWidth,10);ctx.fillStyle=rgba(p.detail,.16);for(let x=14;x<o.cssWidth;x+=58){ctx.fillRect(x,snap(o.cssHeight*.83+(x%4)*2),22,2);if((x/58)%2>.35){ctx.fillRect(x+5,snap(o.cssHeight*.77),2,24);ctx.fillRect(x+9,snap(o.cssHeight*.79),2,18);}}
  }
  ctx.restore();
}

function drawAmbientDetails(ctx:CanvasRenderingContext2D,o:BackgroundDrawOptions){
  const worldSpan=o.cssWidth/Math.max(.0001,o.cameraScale*.35);
  const sampleCount=Math.max(6,Math.ceil(o.cssWidth/220));
  for(let i=0;i<sampleCount;i++){
    const t0=i/sampleCount, t1=(i+1)/sampleCount;
    const worldX0=o.cameraCenterX-worldSpan*.5+t0*worldSpan, worldX1=o.cameraCenterX-worldSpan*.5+t1*worldSpan;
    const sample=getBiomeAtX((worldX0+worldX1)*.5,o.worldSeed);
    if(!sample.secondary){ drawAmbientDetailsForBiome(ctx,o,sample.primary,1/sampleCount,worldX0,worldX1); }
    else { drawAmbientDetailsForBiome(ctx,o,sample.primary,(1-sample.blend)/sampleCount,worldX0,worldX1); drawAmbientDetailsForBiome(ctx,o,sample.secondary,sample.blend/sampleCount,worldX0,worldX1); }
  }
}

export function drawBiomeBackground(ctx:CanvasRenderingContext2D,cache:BiomeBackgroundCache,o:BackgroundDrawOptions){
  ctx.save();ctx.imageSmoothingEnabled=false;
  drawSkyBands(ctx,o);
  drawContinuousPanorama(ctx,'far',o);
  drawContinuousPanorama(ctx,'mid',o);
  drawLandmarkLayer(ctx,cache,'mid',o);
  drawLandmarkLayer(ctx,cache,'near',o);
  drawAmbientDetails(ctx,o);
  const hazeColumns=Math.max(8,Math.ceil(o.cssWidth/120));
  for(let i=0;i<hazeColumns;i++){
    const x0=(o.cssWidth*i)/hazeColumns, x1=(o.cssWidth*(i+1))/hazeColumns;
    const wx=o.cameraCenterX+(((x0+x1)*.5)-o.cssWidth*.5)/Math.max(.0001,o.cameraScale*.22);
    const p=lightBiomePalette(paletteForBiomeSample(getBiomeAtX(wx,o.worldSeed)),o.lighting);
    ctx.fillStyle=rgba(p.haze,.045);
    ctx.fillRect(x0,o.cssHeight*.42,Math.ceil(x1-x0)+1,o.cssHeight*.58);
  }
  ctx.restore();
}

export function drawBiomeForeground(ctx:CanvasRenderingContext2D,cache:BiomeBackgroundCache,o:BackgroundDrawOptions){
  const {cssWidth,cssHeight,cameraCenterX,cameraScale,worldSeed}=o;
  const fitScale=Math.max(.0001,Math.min(cssWidth/1280,cssHeight/720));
  const normalizedZoom=cameraScale/fitScale;
  const alpha=landmarkAlphaForLayer('foreground',normalizedZoom); if(alpha<=.01)return;
  const layer:Layer='foreground',parallax=.88,halfWorldVisible=cssWidth*.55/Math.max(.0001,cameraScale*parallax),minChunk=Math.floor((cameraCenterX-halfWorldVisible)/BACKGROUND_CHUNK_WIDTH)-1,maxChunk=Math.floor((cameraCenterX+halfWorldVisible)/BACKGROUND_CHUNK_WIDTH)+1;
  cache.ensureCapacity((maxChunk-minChunk+1)*3+48);
  const stride=landmarkStrideForLayer('foreground',normalizedZoom);
  ctx.save();ctx.globalAlpha*=alpha;
  for(let chunkIndex=minChunk;chunkIndex<=maxChunk;chunkIndex++){
    const chunk=cache.getChunk(layer,chunkIndex,worldSeed),chunkWorldX=chunkIndex*BACKGROUND_CHUNK_WIDTH;
    for(let idx=0; idx<chunk.features.length; idx++){
      if(idx%stride!==0) continue;
      const feature=chunk.features[idx];
      const featureWorldX=chunkWorldX+feature.x*BACKGROUND_CHUNK_WIDTH,x=cssWidth*.5+(featureWorldX-cameraCenterX)*cameraScale*parallax;
      if(x>cssWidth*.18&&x<cssWidth*.82)continue;
      const sample=getBiomeAtX(featureWorldX,worldSeed),palette=lightBiomePalette(paletteForBiomeSample(sample),o.lighting),biome=feature.biome,dims=featureDimensions(biome,layer,feature.variant,feature.scale*.9,cssWidth,cssHeight,cameraScale);
      drawPlacedFeature(ctx,biome,x,cssHeight+4,dims.width,dims.height,palette.near,palette.detail,feature.variant,layer,feature.flipX);
    }
  }
  ctx.restore();
}
