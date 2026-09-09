import type { BiomeId, BiomeSample } from '../types';
import { WORLD_REF_HEIGHT } from '../constants';
import { biomeHash, biomeRandom01, getBiomeAtX, mixHex, paletteForBiomeSample, VISUAL_BIOMES } from '../world/biomes';

const BACKGROUND_CHUNK_WIDTH = 600;
const MAX_DESCRIPTOR_CACHE = 96;
const RIDGE_SEGMENTS = 8;
const NS_FAR=0x464152, NS_MID=0x4d4944, NS_NEAR=0x4e4541, NS_FORE=0x464f52;

type Layer = 'far'|'mid'|'near'|'foreground';
interface FeatureDescriptor { x:number; width:number; height:number; variant:number; offsetY:number; }
interface BackgroundChunkDescriptor { chunkIndex:number; layer:Layer; ridge:number[]; features:FeatureDescriptor[]; }
interface BackgroundDrawOptions { cameraCenterX:number; cameraCenterY:number; cameraScale:number; cssWidth:number; cssHeight:number; worldSeed:number; }

const parallaxByLayer={far:.13,mid:.31,near:.58} as const;
const namespaceForLayer=(layer:Layer)=>layer==='far'?NS_FAR:layer==='mid'?NS_MID:layer==='near'?NS_NEAR:NS_FORE;
const dominantBiome=(sample:BiomeSample):BiomeId=>sample.secondary&&sample.blend>=.5?sample.secondary:sample.primary;
const snap=(v:number,g=2)=>Math.round(v/g)*g;
function rgba(hex:string,alpha:number){const h=hex.replace('#','');const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);return `rgba(${r}, ${g}, ${b}, ${alpha})`;}
function drawPixelDisc(ctx:CanvasRenderingContext2D,cx:number,cy:number,r:number,color:string){ctx.fillStyle=color;const rows=[.62,.86,1,1,.86,.62];for(let i=0;i<rows.length;i++){const hh=Math.max(2,Math.round((r*2)/rows.length)),ww=Math.round(r*2*rows[i]),yy=Math.round(cy-r+i*hh);ctx.fillRect(snap(cx-ww*.5),snap(yy),snap(ww),hh+1);}}

export class BiomeBackgroundCache {
  private chunks=new Map<string,BackgroundChunkDescriptor>();
  clear(){this.chunks.clear();}
  get size(){return this.chunks.size;}
  getChunk(layer:Layer,chunkIndex:number,seed:number):BackgroundChunkDescriptor{
    const key=`${seed}:${layer}:${chunkIndex}`;const existing=this.chunks.get(key);
    if(existing){this.chunks.delete(key);this.chunks.set(key,existing);return existing;}
    const descriptor=this.generateChunk(layer,chunkIndex,seed);this.chunks.set(key,descriptor);
    if(this.chunks.size>MAX_DESCRIPTOR_CACHE){const oldest=this.chunks.keys().next().value as string|undefined;if(oldest)this.chunks.delete(oldest);}
    return descriptor;
  }
  private generateChunk(layer:Layer,chunkIndex:number,seed:number):BackgroundChunkDescriptor{
    const namespace=namespaceForLayer(layer),ridge:number[]=[];
    for(let i=0;i<=RIDGE_SEGMENTS;i++){const globalNode=chunkIndex*RIDGE_SEGMENTS+i;ridge.push(.28+biomeRandom01(seed,namespace^0x726964,globalNode)*.58);}
    const centerX=(chunkIndex+.5)*BACKGROUND_CHUNK_WIDTH,sample=getBiomeAtX(centerX,seed),biome=VISUAL_BIOMES[dominantBiome(sample)];
    const density=layer==='far'?biome.farDensity:layer==='mid'?biome.midDensity:layer==='near'?biome.nearDensity:biome.nearDensity*.55;
    const minFeatures=layer==='far'?1:layer==='foreground'?1:2,maxFeatures=layer==='far'?3:layer==='foreground'?4:7;
    const count=minFeatures+Math.floor(density*(maxFeatures-minFeatures)+biomeRandom01(seed,namespace,chunkIndex)*2);
    const features:FeatureDescriptor[]=[];
    for(let i=0;i<count;i++){const k=chunkIndex*37+i;features.push({x:biomeRandom01(seed,namespace^0x78,k),width:.045+biomeRandom01(seed,namespace^0x77,k)*(layer==='near'?.13:.09),height:.16+biomeRandom01(seed,namespace^0x68,k)*(layer==='far'?.34:.5),variant:biomeHash(seed,namespace^0x76,k)%7,offsetY:(biomeRandom01(seed,namespace^0x79,k)-.5)*.08});}
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

function rectTree(ctx:CanvasRenderingContext2D,x:number,baseY:number,w:number,h:number,color:string,detail:string,broad=false){
  ctx.fillStyle=color;const trunk=Math.max(3,snap(w*.1));ctx.fillRect(snap(x+w*.47),snap(baseY-h*.55),trunk,snap(h*.55));
  if(broad){ctx.fillRect(snap(x+w*.12),snap(baseY-h*.77),snap(w*.76),snap(h*.25));ctx.fillRect(snap(x+w*.25),snap(baseY-h*.94),snap(w*.52),snap(h*.22));ctx.fillRect(snap(x+w*.04),snap(baseY-h*.64),snap(w*.92),snap(h*.18));}
  else {for(let i=0;i<4;i++){const yy=baseY-h*(.34+i*.14),ww=w*(.9-i*.15);ctx.fillRect(snap(x+(w-ww)/2),snap(yy),snap(ww),snap(h*.16));}}
  ctx.fillStyle=rgba(detail,.28);ctx.fillRect(snap(x+w*.34),snap(baseY-h*.7),Math.max(2,snap(w*.08)),Math.max(2,snap(h*.06)));
}

function drawLowland(ctx:CanvasRenderingContext2D,x:number,b:number,w:number,h:number,c:string,d:string,v:number){rectTree(ctx,x,b,w,h,c,d,v%3!==0);}
function drawSpire(ctx:CanvasRenderingContext2D,x:number,b:number,w:number,h:number,c:string,d:string,v:number){ctx.fillStyle=c;const bw=Math.max(8,snap(w*(.38+(v%3)*.08))),bx=snap(x+(w-bw)*.5);ctx.fillRect(bx,snap(b-h*.72),bw,snap(h*.72));ctx.beginPath();ctx.moveTo(bx-3,snap(b-h*.72));ctx.lineTo(snap(x+w*.5),snap(b-h));ctx.lineTo(bx+bw+3,snap(b-h*.72));ctx.closePath();ctx.fill();ctx.fillStyle=rgba(d,.4);for(let yy=b-h*.58;yy<b-h*.12;yy+=Math.max(8,h*.16))ctx.fillRect(snap(bx+bw*.38),snap(yy),Math.max(2,snap(bw*.22)),3);}
function drawFoundry(ctx:CanvasRenderingContext2D,x:number,b:number,w:number,h:number,c:string,d:string,v:number){ctx.fillStyle=c;if(v%2===0){const sw=Math.max(7,snap(w*.24));ctx.fillRect(snap(x+w*.18),snap(b-h*.88),sw,snap(h*.88));ctx.fillRect(snap(x+w*.55),snap(b-h*.62),Math.max(7,snap(w*.28)),snap(h*.62));ctx.fillRect(snap(x+w*.08),snap(b-h*.22),snap(w*.84),snap(h*.22));}else{ctx.fillRect(snap(x+w*.12),snap(b-h*.55),snap(w*.76),snap(h*.55));ctx.fillRect(snap(x+w*.3),snap(b-h*.82),snap(w*.18),snap(h*.27));}ctx.fillStyle=rgba(d,.46);ctx.fillRect(snap(x+w*.18),snap(b-h*.32),snap(w*.64),4);ctx.fillRect(snap(x+w*.58),snap(b-h*.5),4,snap(h*.28));}
function drawRuins(ctx:CanvasRenderingContext2D,x:number,b:number,w:number,h:number,c:string,d:string,v:number){ctx.fillStyle=c;const cw=Math.max(6,snap(w*.18));ctx.fillRect(snap(x+w*.12),snap(b-h*.72),cw,snap(h*.72));ctx.fillRect(snap(x+w*.68),snap(b-h*(v%2?.5:.7)),cw,snap(h*(v%2?.5:.7)));ctx.fillRect(snap(x+w*.12),snap(b-h*.72),snap(w*.74),Math.max(5,snap(h*.1)));ctx.fillStyle=rgba(d,.22);ctx.fillRect(snap(x+w*.36),snap(b-h*.48),snap(w*.26),snap(h*.48));}

function drawDesert(ctx:CanvasRenderingContext2D,x:number,b:number,w:number,h:number,c:string,d:string,v:number,layer:Layer){
  if(layer==='far'){
    ctx.fillStyle=c;const top=b-h*(.42+(v%3)*.08);ctx.fillRect(snap(x+w*.12),snap(top),snap(w*.7),snap(b-top));ctx.fillRect(snap(x+w*.02),snap(top+h*.12),snap(w*.92),snap(h*.18));ctx.fillStyle=rgba(d,.18);ctx.fillRect(snap(x+w*.2),snap(top+h*.18),snap(w*.5),4);return;
  }
  ctx.fillStyle=c;
  if(v===0||v===4){ // sparse cactus landmark
    const tw=Math.max(4,snap(w*.12)),tx=snap(x+w*.47);ctx.fillRect(tx,snap(b-h*.78),tw,snap(h*.78));ctx.fillRect(snap(tx-w*.22),snap(b-h*.55),snap(w*.24),tw);ctx.fillRect(snap(tx-w*.22),snap(b-h*.55),tw,snap(h*.2));ctx.fillRect(snap(tx+tw),snap(b-h*.4),snap(w*.25),tw);ctx.fillRect(snap(tx+w*.22),snap(b-h*.55),tw,snap(h*.18));
  } else if(v===2||v===6){ // low weathered boulder / shelf
    ctx.fillRect(snap(x+w*.08),snap(b-h*.3),snap(w*.84),snap(h*.3));ctx.fillRect(snap(x+w*.2),snap(b-h*.43),snap(w*.56),snap(h*.15));
  } else { // eroded rock arch
    ctx.fillRect(snap(x+w*.14),snap(b-h*.58),snap(w*.18),snap(h*.58));ctx.fillRect(snap(x+w*.68),snap(b-h*.46),snap(w*.16),snap(h*.46));ctx.fillRect(snap(x+w*.14),snap(b-h*.58),snap(w*.7),snap(h*.13));
  }
  ctx.fillStyle=rgba(d,.3);ctx.fillRect(snap(x+w*.2),snap(b-h*.18),snap(w*.55),3);
}

function drawSnowyMountain(ctx:CanvasRenderingContext2D,x:number,b:number,w:number,h:number,c:string,d:string,v:number,layer:Layer){
  if(layer==='far'){
    ctx.fillStyle=c;ctx.beginPath();ctx.moveTo(snap(x),snap(b));ctx.lineTo(snap(x+w*.48),snap(b-h));ctx.lineTo(snap(x+w),snap(b));ctx.closePath();ctx.fill();ctx.fillStyle=rgba(d,.72);ctx.beginPath();ctx.moveTo(snap(x+w*.48),snap(b-h));ctx.lineTo(snap(x+w*.33),snap(b-h*.68));ctx.lineTo(snap(x+w*.46),snap(b-h*.73));ctx.lineTo(snap(x+w*.56),snap(b-h*.64));ctx.lineTo(snap(x+w*.65),snap(b-h*.7));ctx.closePath();ctx.fill();return;
  }
  if(v%5===0){ctx.fillStyle=c;ctx.fillRect(snap(x+w*.18),snap(b-h*.34),snap(w*.64),snap(h*.34));ctx.fillStyle=rgba(d,.68);ctx.beginPath();ctx.moveTo(snap(x+w*.08),snap(b-h*.34));ctx.lineTo(snap(x+w*.5),snap(b-h*.58));ctx.lineTo(snap(x+w*.92),snap(b-h*.34));ctx.closePath();ctx.fill();ctx.fillStyle=rgba('#17222d',.55);ctx.fillRect(snap(x+w*.44),snap(b-h*.2),snap(w*.14),snap(h*.2));}
  else rectTree(ctx,x,b,w,h,c,d,false);
}

function drawTemperateForest(ctx:CanvasRenderingContext2D,x:number,b:number,w:number,h:number,c:string,d:string,v:number,layer:Layer){
  if(layer==='far'){ctx.fillStyle=c;const blobs=4;for(let i=0;i<blobs;i++){const bw=w*(.32+(i%2)*.08);ctx.fillRect(snap(x+i*w*.2),snap(b-h*(.5+(i%3)*.09)),snap(bw),snap(h*(.38+(i%2)*.08)));}return;}
  rectTree(ctx,x,b,w,h,c,d,true);
  if(v%4===0){ctx.fillStyle=rgba(d,.26);ctx.fillRect(snap(x+w*.05),snap(b-h*.12),snap(w*.28),3);ctx.fillRect(snap(x+w*.68),snap(b-h*.2),snap(w*.24),3);}
}

function drawCity(ctx:CanvasRenderingContext2D,x:number,b:number,w:number,h:number,c:string,d:string,v:number,layer:Layer){
  ctx.fillStyle=c;const buildingW=Math.max(12,snap(w*(.55+(v%3)*.12))),bx=snap(x+(w-buildingW)*.5),bh=h*(.55+(v%4)*.11);ctx.fillRect(bx,snap(b-bh),buildingW,snap(bh));
  if(v%3===0)ctx.fillRect(snap(bx+buildingW*.18),snap(b-bh-h*.16),snap(buildingW*.18),snap(h*.16));
  if(v%5===0){ctx.fillRect(snap(bx+buildingW*.66),snap(b-bh-h*.1),3,snap(h*.1));ctx.fillRect(snap(bx+buildingW*.58),snap(b-bh-h*.1),snap(buildingW*.18),3);}
  ctx.fillStyle=rgba(d,layer==='far'?.22:.42);const cols=Math.max(1,Math.floor(buildingW/14)),rows=Math.max(1,Math.floor(bh/18));for(let yy=0;yy<rows;yy++)for(let xx=0;xx<cols;xx++)if((xx+yy+v)%3!==0)ctx.fillRect(snap(bx+5+xx*13),snap(b-bh+7+yy*17),3,4);
}

function drawRuralVillage(ctx:CanvasRenderingContext2D,x:number,b:number,w:number,h:number,c:string,d:string,v:number,layer:Layer){
  if(layer==='far'&&v===0){ // one occasional distant windmill, not a forest of poles
    ctx.fillStyle=c;ctx.fillRect(snap(x+w*.46),snap(b-h*.7),4,snap(h*.7));ctx.fillStyle=rgba(d,.35);ctx.fillRect(snap(x+w*.18),snap(b-h*.5),snap(w*.64),4);ctx.fillRect(snap(x+w*.48),snap(b-h*.78),4,snap(h*.5));return;
  }
  if(v===5){ // near/mid windmill landmark
    ctx.fillStyle=c;ctx.fillRect(snap(x+w*.42),snap(b-h*.54),snap(w*.16),snap(h*.54));ctx.fillStyle=rgba(d,.48);ctx.fillRect(snap(x+w*.47),snap(b-h*.8),4,snap(h*.52));ctx.fillRect(snap(x+w*.22),snap(b-h*.56),snap(w*.56),4);return;
  }
  ctx.fillStyle=c;
  if(v===3||v===6){ // low barn
    ctx.fillRect(snap(x+w*.08),snap(b-h*.32),snap(w*.84),snap(h*.32));ctx.fillStyle=rgba(d,.44);ctx.beginPath();ctx.moveTo(snap(x+w*.04),snap(b-h*.32));ctx.lineTo(snap(x+w*.34),snap(b-h*.53));ctx.lineTo(snap(x+w*.66),snap(b-h*.53));ctx.lineTo(snap(x+w*.96),snap(b-h*.32));ctx.closePath();ctx.fill();ctx.fillStyle=rgba('#1d2524',.48);ctx.fillRect(snap(x+w*.43),snap(b-h*.2),snap(w*.16),snap(h*.2));return;
  }
  // Cottage: deliberately broader than it is tall so it reads as a building, never a platform.
  ctx.fillRect(snap(x+w*.14),snap(b-h*.36),snap(w*.72),snap(h*.36));ctx.fillStyle=rgba(d,.48);ctx.beginPath();ctx.moveTo(snap(x+w*.06),snap(b-h*.36));ctx.lineTo(snap(x+w*.5),snap(b-h*.6));ctx.lineTo(snap(x+w*.94),snap(b-h*.36));ctx.closePath();ctx.fill();ctx.fillStyle=rgba('#1d2524',.5);ctx.fillRect(snap(x+w*.43),snap(b-h*.19),snap(w*.14),snap(h*.19));
}

function drawSwamp(ctx:CanvasRenderingContext2D,x:number,b:number,w:number,h:number,c:string,d:string,v:number,layer:Layer){
  ctx.fillStyle=c;
  if(v%4===0){ // dead tree
    const tx=snap(x+w*.46),tw=Math.max(4,snap(w*.11));ctx.fillRect(tx,snap(b-h*.78),tw,snap(h*.78));ctx.fillRect(snap(tx-w*.28),snap(b-h*.58),snap(w*.3),4);ctx.fillRect(snap(tx+w*.06),snap(b-h*.48),snap(w*.3),4);ctx.fillRect(snap(tx-w*.24),snap(b-h*.58),4,snap(h*.18));
  } else { // cypress / willow mass
    ctx.fillRect(snap(x+w*.43),snap(b-h*.64),Math.max(4,snap(w*.12)),snap(h*.64));ctx.fillRect(snap(x+w*.12),snap(b-h*.78),snap(w*.76),snap(h*.26));ctx.fillRect(snap(x+w*.2),snap(b-h*.58),snap(w*.62),snap(h*.18));ctx.fillStyle=rgba(d,.26);for(let i=0;i<4;i++)ctx.fillRect(snap(x+w*(.22+i*.15)),snap(b-h*.56),2,snap(h*(.14+(i%2)*.08)));
  }
  if(layer!=='far'){ctx.fillStyle=rgba(d,.36);for(let i=0;i<5;i++)ctx.fillRect(snap(x+i*w*.18),snap(b-h*(.07+(i%2)*.03)),2,snap(h*.08));}
}

function scaleFeatureForBiome(biome:BiomeId,layer:Layer,variant:number,width:number,height:number):{width:number;height:number}{
  let w=width,h=height;
  if(biome==='desert'){
    if(layer==='far'){w*=2.3;h*=.8;} else if(variant===0||variant===4){w*=.68;h*=1.34;} else if(variant===2||variant===6){w*=1.55;h*=.76;} else {w*=1.48;h*=.92;}
  } else if(biome==='snowy-mountains'){
    if(layer==='far'){w*=2.2;h*=1.34;} else {w*=.92;h*=1.24;}
  } else if(biome==='temperate-forest'){
    if(layer==='far'){w*=1.8;h*=.76;} else {w*=1.42;h*=1.12;}
  } else if(biome==='city'){
    w*=layer==='far'?.95:1.02; h*=layer==='far'?1.38:1.32;
  } else if(biome==='rural-village'){
    if(layer==='far'){w*=1.62;h*=.84;} else if(variant===5){w*=1.18;h*=1.34;} else {w*=1.68;h*=.86;}
  } else if(biome==='swamp'){
    w*=1.22; h*=layer==='far'?.96:1.26;
  } else if(biome==='lowlands'){
    w*=1.16;h*=1.02;
  } else if(biome==='spires'){
    w*=.9;h*=1.08;
  }
  return {width:Math.max(12,w),height:Math.max(20,h)};
}

function drawFeatureForBiome(ctx:CanvasRenderingContext2D,biome:BiomeId,x:number,b:number,w:number,h:number,c:string,d:string,v:number,layer:Layer){
  if(biome==='lowlands')drawLowland(ctx,x,b,w,h,c,d,v);
  else if(biome==='spires')drawSpire(ctx,x,b,w,h,c,d,v);
  else if(biome==='foundry')drawFoundry(ctx,x,b,w,h,c,d,v);
  else if(biome==='ruins')drawRuins(ctx,x,b,w,h,c,d,v);
  else if(biome==='desert')drawDesert(ctx,x,b,w,h,c,d,v,layer);
  else if(biome==='snowy-mountains')drawSnowyMountain(ctx,x,b,w,h,c,d,v,layer);
  else if(biome==='temperate-forest')drawTemperateForest(ctx,x,b,w,h,c,d,v,layer);
  else if(biome==='city')drawCity(ctx,x,b,w,h,c,d,v,layer);
  else if(biome==='rural-village')drawRuralVillage(ctx,x,b,w,h,c,d,v,layer);
  else drawSwamp(ctx,x,b,w,h,c,d,v,layer);
}

function drawNaturalRidge(ctx:CanvasRenderingContext2D,biome:BiomeId,chunk:BackgroundChunkDescriptor,x0:number,w:number,b:number,cssHeight:number,color:string,detail:string){
  if(biome==='city'||biome==='foundry'||biome==='ruins')return;
  ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(snap(x0-2),snap(cssHeight+2));
  for(let i=0;i<=RIDGE_SEGMENTS;i++){const x=x0+w*(i/RIDGE_SEGMENTS);let ridgeHeight=cssHeight*(.1+chunk.ridge[i]*.22);if(biome==='desert')ridgeHeight*=.48;if(biome==='swamp')ridgeHeight*=.28;if(biome==='rural-village')ridgeHeight*=.5;if(biome==='temperate-forest')ridgeHeight*=.55;if(biome==='snowy-mountains')ridgeHeight*=1.18;ctx.lineTo(snap(x),snap(b-ridgeHeight));}
  ctx.lineTo(snap(x0+w+2),snap(cssHeight+2));ctx.closePath();ctx.fill();
  if(biome==='snowy-mountains'){ctx.strokeStyle=rgba(detail,.16);ctx.lineWidth=2;ctx.stroke();}
}

function drawLayer(ctx:CanvasRenderingContext2D,cache:BiomeBackgroundCache,layer:'far'|'mid'|'near',o:BackgroundDrawOptions){
  const parallax=parallaxByLayer[layer],{cameraCenterX,cameraCenterY,cameraScale,cssWidth,cssHeight,worldSeed}=o,halfWorldVisible=cssWidth*.62/Math.max(.0001,cameraScale*parallax),minChunk=Math.floor((cameraCenterX-halfWorldVisible)/BACKGROUND_CHUNK_WIDTH)-1,maxChunk=Math.floor((cameraCenterX+halfWorldVisible)/BACKGROUND_CHUNK_WIDTH)+1;
  const verticalParallax=layer==='far'?.045:layer==='mid'?.09:.16,baselineRatio=layer==='far'?.7:layer==='mid'?.76:.82,baselineY=cssHeight*baselineRatio+(WORLD_REF_HEIGHT*.64-cameraCenterY)*cameraScale*verticalParallax,layerAlpha=layer==='far'?.78:layer==='mid'?.9:.94;
  ctx.save();ctx.globalAlpha=layerAlpha;
  for(let chunkIndex=minChunk;chunkIndex<=maxChunk;chunkIndex++){
    const chunk=cache.getChunk(layer,chunkIndex,worldSeed),chunkWorldX=chunkIndex*BACKGROUND_CHUNK_WIDTH,screenStartX=cssWidth*.5+(chunkWorldX-cameraCenterX)*cameraScale*parallax,screenChunkWidth=BACKGROUND_CHUNK_WIDTH*cameraScale*parallax;if(screenStartX>cssWidth+120||screenStartX+screenChunkWidth<-120)continue;
    const chunkSample=getBiomeAtX(chunkWorldX+BACKGROUND_CHUNK_WIDTH*.5,worldSeed),chunkPalette=paletteForBiomeSample(chunkSample),chunkBiome=dominantBiome(chunkSample);
    if(layer==='far')drawNaturalRidge(ctx,chunkBiome,chunk,screenStartX,screenChunkWidth,baselineY,cssHeight,chunkPalette.far,chunkPalette.detail);
    for(let featureIndex=0;featureIndex<chunk.features.length;featureIndex++){
      if(cameraScale<.55&&layer==='far')continue;if(cameraScale<.48&&layer==='mid'&&featureIndex%2===1)continue;
      const feature=chunk.features[featureIndex],featureWorldX=chunkWorldX+feature.x*BACKGROUND_CHUNK_WIDTH,screenX=cssWidth*.5+(featureWorldX-cameraCenterX)*cameraScale*parallax,featureSample=getBiomeAtX(featureWorldX,worldSeed),featurePalette=paletteForBiomeSample(featureSample),biome=dominantBiome(featureSample),baseWidth=Math.max(12,BACKGROUND_CHUNK_WIDTH*feature.width*cameraScale*parallax*(layer==='near'?1.2:1)),heightScale=layer==='far'?.38:layer==='mid'?.64:.82,baseHeight=cssHeight*feature.height*heightScale,scaled=scaleFeatureForBiome(biome,layer,feature.variant,baseWidth,baseHeight),width=scaled.width,height=scaled.height,baseY=baselineY+cssHeight*feature.offsetY,color=layer==='far'?featurePalette.far:layer==='mid'?featurePalette.mid:featurePalette.near;
      drawFeatureForBiome(ctx,biome,screenX-width*.5,baseY,width,height,color,featurePalette.detail,feature.variant,layer);
    }
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

export function drawBiomeForeground(ctx:CanvasRenderingContext2D,cache:BiomeBackgroundCache,o:BackgroundDrawOptions){const {cssWidth,cssHeight,cameraCenterX,cameraScale,worldSeed}=o;if(cameraScale<.5)return;const layer:Layer='foreground',parallax=.88,halfWorldVisible=cssWidth*.55/Math.max(.0001,cameraScale*parallax),minChunk=Math.floor((cameraCenterX-halfWorldVisible)/BACKGROUND_CHUNK_WIDTH)-1,maxChunk=Math.floor((cameraCenterX+halfWorldVisible)/BACKGROUND_CHUNK_WIDTH)+1;ctx.save();ctx.globalAlpha=.18;for(let chunkIndex=minChunk;chunkIndex<=maxChunk;chunkIndex++){const chunk=cache.getChunk(layer,chunkIndex,worldSeed),chunkWorldX=chunkIndex*BACKGROUND_CHUNK_WIDTH;for(const feature of chunk.features){const featureWorldX=chunkWorldX+feature.x*BACKGROUND_CHUNK_WIDTH,x=cssWidth*.5+(featureWorldX-cameraCenterX)*cameraScale*parallax;if(x>cssWidth*.2&&x<cssWidth*.8)continue;const sample=getBiomeAtX(featureWorldX,worldSeed),palette=paletteForBiomeSample(sample),biome=dominantBiome(sample),width=Math.max(18,feature.width*420*cameraScale),height=Math.max(30,feature.height*cssHeight*.34);drawFeatureForBiome(ctx,biome,x-width*.5,cssHeight+8,width,height,palette.near,palette.detail,feature.variant,layer);}}ctx.restore();}
