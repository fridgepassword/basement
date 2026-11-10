/*
 * Basement: a top-down horror game.
 * Everything (art, sound, maze) is generated in code; there are no asset files.
 *
 * Sections: settings & nights, audio, jump-scare faces, maze, map art,
 * game state, update, intro, drawing, jump scare, main loop, input & menus.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const stage=$('stage'), cv=$('c'), ctx=cv.getContext('2d');
const dark=document.createElement('canvas'), dctx=dark.getContext('2d');
const T=40, SPEED=100, SPRINT=158, HALF=0.5, PR=9, MS=2, TAU=Math.PI*2;
let CW=9, CH=12; // maze size in cells; grows each night

// =================== SETTINGS & SAVE ===================
const STORE='basement.save.v2';
const save={nightMax:1,best:{},notes:[],scare:true,fx:true,vol:0.9};
try{ Object.assign(save,JSON.parse(localStorage.getItem(STORE)||'{}')); }catch(e){}
function persist(){ try{ localStorage.setItem(STORE,JSON.stringify(save)); }catch(e){} }
const motionMQ=window.matchMedia('(prefers-reduced-motion: reduce)');
let reduce=motionMQ.matches||!save.fx;

// Each night is a bigger maze with more fuses and more things in it.
// spawn: [kind, fuses collected before it appears]
const NIGHTS=[
  {cw:9, ch:12,fuses:3,bats:3,bulbs:3,drain:1.00,pace:1.00,spawn:[['pale',0],['crawler',1],['pale',2]]},
  {cw:10,ch:13,fuses:3,bats:3,bulbs:4,drain:1.05,pace:1.03,spawn:[['pale',0],['moth',1],['crawler',2]]},
  {cw:11,ch:14,fuses:4,bats:4,bulbs:4,drain:1.10,pace:1.05,spawn:[['pale',0],['crawler',1],['moth',2],['pale',3]]},
  {cw:12,ch:15,fuses:4,bats:4,bulbs:5,drain:1.15,pace:1.08,spawn:[['pale',0],['moth',1],['crawler',2],['pale',3]]},
  {cw:13,ch:16,fuses:5,bats:5,bulbs:5,drain:1.20,pace:1.10,spawn:[['pale',0],['crawler',1],['moth',2],['pale',3],['crawler',4]]},
];
const LAST_NIGHT=NIGHTS.length;
function nightCfg(n){
  const c=NIGHTS[Math.min(n,LAST_NIGHT)-1], extra=Math.max(0,n-LAST_NIGHT);
  return Object.assign({},c,{pace:c.pace+extra*0.04,drain:c.drain+extra*0.03});
}
const NUM=['no','one','two','three','four','five','six'];

// Notes left by the family who lived here. Found notes are kept in the journal.
const NOTES=[
  'Mom says the clicking is the pipes. Pipes don’t stop when you stop walking.',
  'Fuse box blew again. Every time it does, somebody has to go down. Every time, it takes them longer to come back up.',
  'If she’s in the light she can’t move. Dad put bulbs everywhere down here. Dad isn’t down here anymore.',
  'Day four. I counted her. There are two of her. Maybe three. They take turns.',
  'Don’t run. It can hear running from the other side of the house.',
  'The moths came after we boarded up the windows. Big ones. They want the light more than we do.',
  'We tried keeping the flashlight off. Then we tried keeping it on. Pick whichever one kills you slower.',
  'Mira’s doll keeps turning to look at me. I turned it to face the wall. It turned back.',
  'The stairs won’t take you up without power. Don’t ask me why. Nothing down here makes sense.',
  'I wrote WE NEVER LEFT on the floor so I would remember. I don’t remember writing it.',
  'The crib was here before we moved in. So was the baby monitor. It still picks up breathing.',
  'If you’re reading this, I made it up the stairs. Or I didn’t. Leave a light on for me.',
];
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
const rand=(a,b)=>a+Math.random()*(b-a);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const pick=a=>a[Math.random()*a.length|0];
function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.random()*(i+1)|0; const tmp=a[i]; a[i]=a[j]; a[j]=tmp; } return a; }
function angDiff(a,b){ const d=a-b; return Math.atan2(Math.sin(d),Math.cos(d)); }
function turnTo(a,b,max){ const d=angDiff(b,a); return a+(Math.abs(d)<max?d:Math.sign(d)*max); }

let W=0,H=0,dpr=1,zoom=1;
function resize(){
  const r=stage.getBoundingClientRect();
  dpr=Math.min(window.devicePixelRatio||1,2);
  W=r.width; H=r.height;
  cv.width=dark.width=Math.max(1,Math.round(W*dpr));
  cv.height=dark.height=Math.max(1,Math.round(H*dpr));
  zoom=Math.max(1.2,Math.min(W,H)/260);
}
window.addEventListener('resize',resize);
resize();

// =================== AUDIO ===================
let AC=null, master, noiseBuf, staticGain, droneGain, roomGain, breathGain, breathPan, flutterGain, flutterPan;
function initAudio(){
  if(AC){ if(AC.state==='suspended') AC.resume(); return; }
  try{
    AC=new (window.AudioContext||window.webkitAudioContext)();
    const comp=AC.createDynamicsCompressor(); comp.threshold.value=-14; comp.ratio.value=5;
    master=AC.createGain(); master.gain.value=save.vol; master.connect(comp); comp.connect(AC.destination);
    noiseBuf=AC.createBuffer(1,AC.sampleRate*2,AC.sampleRate);
    const nd=noiseBuf.getChannelData(0); for(let i=0;i<nd.length;i++) nd[i]=Math.random()*2-1;

    staticGain=gain(0);
    const sn=loopNoise(), sb=filt('bandpass',2600,0.6); sn.connect(sb); sb.connect(staticGain); staticGain.connect(master);

    droneGain=gain(0);
    const lp=filt('lowpass',170,1.5);
    const lfo=osc('sine',0.06), lfoG=gain(70); lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();
    [41.2,41.7,61.9,98.3].forEach((f,i)=>{
      const o=osc(i===3?'sine':'sawtooth',f), w=osc('sine',0.05+i*0.031), wg=gain(f*0.012);
      w.connect(wg); wg.connect(o.frequency); o.connect(lp); o.start(); w.start();
    });
    lp.connect(droneGain); droneGain.connect(master);

    roomGain=gain(0);
    const rn=loopNoise(), rl=filt('lowpass',380,0.7); rn.connect(rl); rl.connect(roomGain); roomGain.connect(master);

    breathGain=gain(0);
    breathPan=AC.createStereoPanner?AC.createStereoPanner():null;
    const bn=loopNoise(), bb=filt('bandpass',620,0.9); bn.connect(bb); bb.connect(breathGain);
    if(breathPan){ breathGain.connect(breathPan); breathPan.connect(master); } else breathGain.connect(master);

    // moth wings: band-passed noise chopped by a fast LFO
    flutterGain=gain(0);
    flutterPan=AC.createStereoPanner?AC.createStereoPanner():null;
    const fn=loopNoise(), fb=filt('bandpass',420,1.1), am=gain(0.5), fl=osc('triangle',17), flg=gain(0.5);
    fl.connect(flg); flg.connect(am.gain); fl.start();
    fn.connect(fb); fb.connect(am); am.connect(flutterGain);
    if(flutterPan){ flutterGain.connect(flutterPan); flutterPan.connect(master); } else flutterGain.connect(master);
  }catch(e){ AC=null; }
}
function setVolume(v){ save.vol=v; persist(); if(master) master.gain.setTargetAtTime(v,AC.currentTime,0.05); }
function loopNoise(){ const n=AC.createBufferSource(); n.buffer=noiseBuf; n.loop=true; n.start(0,Math.random()*1.5); return n; }
function filt(type,f,q){ const b=AC.createBiquadFilter(); b.type=type; b.frequency.value=f; if(q!=null) b.Q.value=q; return b; }
function osc(type,f){ const o=AC.createOscillator(); o.type=type; o.frequency.value=f; return o; }
function gain(v){ const g=AC.createGain(); g.gain.value=v; return g; }
function nz(t0,dur){ const s=AC.createBufferSource(); s.buffer=noiseBuf; s.loop=true; s.start(t0,Math.random()*1.5); s.stop(t0+dur); return s; }
function out(pan){ if(AC.createStereoPanner){ const s=AC.createStereoPanner(); s.pan.value=clamp(pan||0,-1,1); s.connect(master); return s; } return master; }
function env(g,peak,a,d,t0){
  g.gain.setValueAtTime(0.0001,t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002,peak),t0+a);
  g.gain.exponentialRampToValueAtTime(0.0001,t0+a+d);
}
function setGain(g,v,tc){ if(AC&&g) g.gain.setTargetAtTime(v,AC.currentTime,tc||0.08); }
function cutAll(){
  if(!AC) return; const n=AC.currentTime;
  [staticGain,droneGain,roomGain,breathGain,flutterGain].forEach(g=>{ if(!g) return; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(0,n); });
}
function distCurve(k){ const n=2048,c=new Float32Array(n); for(let i=0;i<n;i++){ const x=i*2/n-1; c[i]=(1+k)*x/(1+k*Math.abs(x)); } return c; }

function thump(vol){
  if(!AC) return; const t=AC.currentTime;
  [0,0.17].forEach((off,i)=>{
    const o=osc('sine',72), g=gain(0);
    o.frequency.setValueAtTime(72,t+off); o.frequency.exponentialRampToValueAtTime(38,t+off+0.16);
    env(g,vol*(i?0.65:1),0.02,0.18,t+off); o.connect(g); g.connect(master); o.start(t+off); o.stop(t+off+0.25);
  });
}
function footstep(vol,pan){
  if(!AC) return; const t=AC.currentTime, n=nz(t,0.12), f=filt('lowpass',420,0.8), g=gain(0);
  env(g,vol,0.005,0.09,t); n.connect(f); f.connect(g); g.connect(out(pan));
}
function flashClick(){
  if(!AC) return; const t=AC.currentTime;
  [0,0.07].forEach(o=>{ const n=nz(t+o,0.03), f=filt('highpass',2500,0.7), g=gain(0); env(g,0.2,0.002,0.02,t+o); n.connect(f); f.connect(g); g.connect(master); });
}
function blip(fr){
  if(!AC) return; const t=AC.currentTime, o=osc('triangle',fr), g=gain(0);
  env(g,0.12,0.01,0.4,t); o.connect(g); g.connect(master); o.start(t); o.stop(t+0.45);
}
function clickAt(pan,vol,when){
  if(!AC) return; const t=when||AC.currentTime, n=nz(t,0.03), f=filt('highpass',2800,0.8), g=gain(0);
  env(g,vol,0.002,0.018,t); n.connect(f); f.connect(g); g.connect(out(pan));
}
function creak(pan,vol){
  if(!AC) return; const t=AC.currentTime, o=osc('sawtooth',150), f=filt('bandpass',1000,7), g=gain(0);
  for(let k=0;k<12;k++) o.frequency.setValueAtTime(rand(95,240),t+k*0.09);
  env(g,vol||0.14,0.25,1.0,t); o.connect(f); f.connect(g); g.connect(out(pan)); o.start(t); o.stop(t+1.35);
}
function knock(pan){
  if(!AC) return; const t=AC.currentTime, d=out(pan);
  [0,0.34,0.63].forEach(o=>{
    const n=nz(t+o,0.2), f=filt('bandpass',170,1.4), g=gain(0); env(g,0.5,0.004,0.17,t+o); n.connect(f); f.connect(g); g.connect(d);
    const s=osc('sine',100), sg=gain(0); s.frequency.setValueAtTime(100,t+o); s.frequency.exponentialRampToValueAtTime(55,t+o+0.15);
    env(sg,0.25,0.004,0.16,t+o); s.connect(sg); sg.connect(d); s.start(t+o); s.stop(t+o+0.22);
  });
}
function clang(pan){
  if(!AC) return; const t=AC.currentTime, d=out(pan);
  [181,463,757,1129,1607].forEach((f,i)=>{ const o=osc('sine',f*rand(0.99,1.01)), g=gain(0); env(g,0.07/(1+i*0.3),0.004,2.6-i*0.3,t); o.connect(g); g.connect(d); o.start(t); o.stop(t+3); });
}
function drip(pan){
  if(!AC) return; const t=AC.currentTime, d=out(pan);
  const one=(t0,v)=>{ const o=osc('sine',2300), g=gain(0); o.frequency.setValueAtTime(2300,t0); o.frequency.exponentialRampToValueAtTime(650,t0+0.05); env(g,v,0.002,0.09,t0); o.connect(g); g.connect(d); o.start(t0); o.stop(t0+0.12); };
  one(t,0.1); if(Math.random()<0.6) one(t+rand(0.35,0.9),0.06);
}
function whisper(pan,vol){
  if(!AC) return; const t=AC.currentTime, d=out(pan), n=nz(t,1.8), hp=filt('highpass',500,0.7), b1=filt('bandpass',1000,5), b2=filt('bandpass',2400,6), g=gain(0);
  b1.frequency.setValueAtTime(900,t); b1.frequency.linearRampToValueAtTime(1500,t+1.5);
  b2.frequency.setValueAtTime(2500,t); b2.frequency.linearRampToValueAtTime(1800,t+1.5);
  n.connect(hp); hp.connect(b1); hp.connect(b2); b1.connect(g); b2.connect(g); g.connect(d);
  g.gain.setValueAtTime(0,t); const v=vol||0.8;
  for(let k=0;k<8;k++){ const s=t+k*0.19; g.gain.setTargetAtTime(v*rand(0.4,1),s,0.025); g.gain.setTargetAtTime(0,s+0.1,0.04); }
  g.gain.setTargetAtTime(0,t+1.55,0.05);
}
function musicBox(pan){
  if(!AC) return; const d=out(pan); let t=AC.currentTime, step=0.3;
  [880,1046.5,659.25,698.46,659.25,587.33,622.25,523.25].forEach((f,i)=>{
    [1,2].forEach(m=>{ const o=osc(m===1?'triangle':'sine',f*m), g=gain(0); o.detune.value=-i*9+rand(-6,6); env(g,m===1?0.06:0.02,0.004,0.9,t); o.connect(g); g.connect(d); o.start(t); o.stop(t+1); });
    t+=step; step*=1.14;
  });
}
function drag(pan){
  if(!AC) return; const t=AC.currentTime, d=out(pan), n=nz(t,2.4), f=filt('lowpass',260,1.2), g=gain(0);
  g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(0.35,t+0.8); g.gain.linearRampToValueAtTime(0.25,t+1.6); g.gain.linearRampToValueAtTime(0.0001,t+2.3);
  f.frequency.setValueAtTime(200,t); f.frequency.linearRampToValueAtTime(340,t+1.2); f.frequency.linearRampToValueAtTime(180,t+2.3);
  n.connect(f); f.connect(g); g.connect(d);
}
function groan(pan){
  if(!AC) return; const t=AC.currentTime, o=osc('sawtooth',78), g=gain(0), lp=filt('lowpass',320), lfo=osc('sine',6), lg=gain(5);
  o.frequency.setValueAtTime(78,t); o.frequency.exponentialRampToValueAtTime(46,t+2.2);
  lfo.connect(lg); lg.connect(o.frequency);
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.25,t+0.6); g.gain.exponentialRampToValueAtTime(0.0001,t+2.4);
  o.connect(lp); lp.connect(g); g.connect(out(pan)); o.start(t); lfo.start(t); o.stop(t+2.5); lfo.stop(t+2.5);
}
function sting(){
  if(!AC) return; const t=AC.currentTime, ws=AC.createWaveShaper(); ws.curve=distCurve(8);
  const lp=filt('lowpass',250,2), g=gain(0);
  lp.frequency.setValueAtTime(250,t); lp.frequency.exponentialRampToValueAtTime(4200,t+0.5);
  env(g,0.3,0.04,1.6,t);
  [98,103.8,146.8,207.7,311.1,329.6].forEach(f=>{ const o=osc('sawtooth',f); o.connect(lp); o.start(t); o.stop(t+1.8); });
  lp.connect(ws); ws.connect(g); g.connect(master);
  const n=nz(t,1.2), nf=filt('highpass',3000,0.7), ng=gain(0); env(ng,0.25,0.3,0.8,t); n.connect(nf); nf.connect(ng); ng.connect(master);
}
function slam(){
  if(!AC) return; const t=AC.currentTime;
  const o=osc('sine',75), g=gain(0); o.frequency.setValueAtTime(75,t); o.frequency.exponentialRampToValueAtTime(26,t+0.6); env(g,1.0,0.004,0.75,t); o.connect(g); g.connect(master); o.start(t); o.stop(t+0.85);
  const n=nz(t,0.5), f=filt('lowpass',1400,0.8), ng=gain(0); env(ng,0.8,0.003,0.38,t); n.connect(f); f.connect(ng); ng.connect(master);
  const r=nz(t+0.05,0.4), rf=filt('bandpass',3200,4), rg=gain(0); env(rg,0.25,0.004,0.3,t+0.05); r.connect(rf); rf.connect(rg); rg.connect(master);
}
function squeak(pan){
  if(!AC) return; const t=AC.currentTime, o=osc('sine',3300), g=gain(0);
  for(let k=0;k<5;k++) o.frequency.setValueAtTime(rand(2900,3900),t+k*0.025);
  env(g,0.035,0.005,0.12,t); o.connect(g); g.connect(out(pan)); o.start(t); o.stop(t+0.16);
}
function scream(kind,delay){
  if(!AC) return; const t=AC.currentTime+(delay||0);
  const ws=AC.createWaveShaper(); ws.curve=distCurve(kind==='pale'?40:25); ws.oversample='2x';
  const o2=gain(0); env(o2,0.85,0.015,1.45,t); ws.connect(o2); o2.connect(master);
  const fr=kind==='pale'?[420,447,598,873]:kind==='moth'?[330,352,940,1410]:[260,277,1050,1490];
  fr.forEach((f,i)=>{
    const o=osc('sawtooth',f*0.55), g=gain(0.16), l=osc('sine',11+i*2.3), lg=gain(f*0.05);
    o.frequency.setValueAtTime(f*0.55,t); o.frequency.exponentialRampToValueAtTime(f*1.45,t+0.16); o.frequency.exponentialRampToValueAtTime(f*0.95,t+1.4);
    l.connect(lg); lg.connect(o.frequency); o.connect(g); g.connect(ws);
    o.start(t); l.start(t); o.stop(t+1.55); l.stop(t+1.55);
  });
  const n=nz(t,1.5), bp=filt('bandpass',1200,3), ng=gain(0.9);
  bp.frequency.setValueAtTime(900,t); bp.frequency.exponentialRampToValueAtTime(3400,t+0.2); bp.frequency.exponentialRampToValueAtTime(2000,t+1.4);
  n.connect(bp); bp.connect(ng); ng.connect(ws);
  const b=osc('sine',110), bg=gain(0); b.frequency.setValueAtTime(110,t); b.frequency.exponentialRampToValueAtTime(28,t+0.7);
  env(bg,0.9,0.01,0.8,t); b.connect(bg); bg.connect(master); b.start(t); b.stop(t+0.9);
  if(kind==='crawler') for(let i=0;i<26;i++) clickAt(rand(-0.6,0.6),0.35,t+i*0.045);
  if(kind==='moth'){
    const wn=nz(t,1.4), wf=filt('bandpass',520,1.4), wg=gain(0), wl=osc('square',24), wlg=gain(0.5);
    wg.gain.setValueAtTime(0.5,t); wg.gain.linearRampToValueAtTime(0,t+1.4);
    wl.connect(wlg); wlg.connect(wg.gain); wn.connect(wf); wf.connect(wg); wg.connect(master); wl.start(t); wl.stop(t+1.45);
  }
}
function rustle(){
  if(!AC) return; const t=AC.currentTime;
  [0,0.09,0.16,0.3].forEach((o,i)=>{ const n=nz(t+o,0.12), f=filt('highpass',1800+i*300,0.6), g=gain(0); env(g,0.09,0.01,0.09,t+o); n.connect(f); f.connect(g); g.connect(master); });
}
function playAmbient(pan){
  pick([()=>knock(pan),()=>clang(pan),()=>creak(pan,0.16),()=>drip(pan),()=>drip(pan),()=>whisper(pan,0.8),()=>musicBox(pan),()=>drag(pan),()=>creak(pan,0.12)])();
}

// =================== FACES (jump scare art) ===================
const faces={};
function tint(src,color){
  const c=document.createElement('canvas'); c.width=src.width; c.height=src.height; const g=c.getContext('2d');
  g.drawImage(src,0,0); g.globalCompositeOperation='multiply'; g.fillStyle=color; g.fillRect(0,0,c.width,c.height);
  g.globalCompositeOperation='destination-in'; g.drawImage(src,0,0); return c;
}
function buildFace(kind){
  const w=600,h=800,c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d');
  const cx=w/2, cy=h*0.44, pale=kind==='pale', rx=pale?185:165, ry=pale?300:310;
  g.lineCap='round';
  if(pale){
    for(let i=0;i<220;i++){
      const side=Math.random()<.5?-1:1, sx=cx+side*rand(0,rx*0.9), sy=cy-ry*rand(0.85,1.0);
      g.strokeStyle='rgba(6,5,4,'+rand(.5,.95).toFixed(2)+')'; g.lineWidth=rand(1,4);
      g.beginPath(); g.moveTo(sx,sy); g.bezierCurveTo(sx+side*rand(60,140),sy+rand(120,250),sx+side*rand(40,160),sy+rand(380,560),cx+side*rand(150,300),h+20); g.stroke();
    }
  }
  g.fillStyle=pale?'#4A453B':'#3A382F'; g.beginPath(); g.ellipse(cx,cy+ry*0.95,rx*0.45,ry*0.35,0,0,TAU); g.fill();
  const sk=g.createRadialGradient(cx-rx*0.15,cy-ry*0.25,rx*0.1,cx,cy,ry*1.02);
  if(pale){ sk.addColorStop(0,'#E2DCCB'); sk.addColorStop(.45,'#B4AD97'); sk.addColorStop(.8,'#625C4D'); sk.addColorStop(1,'#15130F'); }
  else { sk.addColorStop(0,'#C9C5B2'); sk.addColorStop(.45,'#8F8B74'); sk.addColorStop(.8,'#4A483B'); sk.addColorStop(1,'#11100D'); }
  g.fillStyle=sk; g.beginPath(); g.ellipse(cx,cy,rx,ry,0,0,TAU); g.fill();
  const id=g.getImageData(0,0,w,h), d=id.data;
  for(let i=0;i<d.length;i+=4){ if(d[i+3]>10){ const n=(Math.random()-.5)*30; d[i]+=n; d[i+1]+=n; d[i+2]+=n; } }
  g.putImageData(id,0,0);

  g.save(); g.beginPath(); g.ellipse(cx,cy,rx,ry,0,0,TAU); g.clip();
  const vein=(x,y,a,len,wd)=>{
    if(len<6||wd<0.3) return;
    const nx=x+Math.cos(a)*len, ny=y+Math.sin(a)*len;
    g.lineWidth=wd; g.beginPath(); g.moveTo(x,y); g.quadraticCurveTo((x+nx)/2+rand(-6,6),(y+ny)/2+rand(-6,6),nx,ny); g.stroke();
    vein(nx,ny,a+rand(-.5,.5),len*0.78,wd*0.75);
    if(Math.random()<0.4) vein(nx,ny,a+(Math.random()<.5?-1:1)*rand(.5,1),len*0.6,wd*0.6);
  };
  const eyes=pale?[[cx-72,cy-70,48,60],[cx+72,cy-70,48,60]]:[[cx-48,cy-120,20,22],[cx+48,cy-120,20,22],[cx-82,cy-82,15,17],[cx+82,cy-82,15,17],[cx-28,cy-70,12,13],[cx+28,cy-70,12,13]];
  g.strokeStyle='rgba(60,25,55,.38)';
  eyes.forEach(([ex,ey])=>{ for(let k=0;k<5;k++) vein(ex,ey,rand(0,TAU),rand(30,50),2.4); });
  const my=pale?cy+165:cy+120;
  for(let k=0;k<5;k++) vein(cx+rand(-40,40),my,rand(0,TAU),rand(35,55),2.6);
  g.strokeStyle='rgba(20,12,10,.6)'; g.lineWidth=1.4;
  for(let k=0;k<7;k++){ let px=cx+rand(-rx,rx)*0.8, py=cy-ry*rand(.5,.9), a=rand(0,TAU); g.beginPath(); g.moveTo(px,py); for(let s=0;s<6;s++){ a+=rand(-.8,.8); px+=Math.cos(a)*rand(8,20); py+=Math.sin(a)*rand(8,20); g.lineTo(px,py); } g.stroke(); }
  const sock=(x,y,a,b)=>{ const gr=g.createRadialGradient(x,y,0,x,y,Math.max(a,b)*1.6); gr.addColorStop(0,'rgba(0,0,0,1)'); gr.addColorStop(.55,'rgba(0,0,0,.95)'); gr.addColorStop(1,'rgba(20,10,10,0)'); g.fillStyle=gr; g.beginPath(); g.ellipse(x,y,a*1.6,b*1.6,0,0,TAU); g.fill(); };
  eyes.forEach(([x,y,a,b])=>sock(x,y,a,b));
  if(pale){
    g.strokeStyle='rgba(70,6,4,.85)';
    [[cx-80,cy-20],[cx-62,cy-16],[cx+70,cy-18]].forEach(([x,y])=>{ g.lineWidth=rand(3,6); g.beginPath(); g.moveTo(x,y); g.bezierCurveTo(x+rand(-8,8),y+60,x+rand(-10,10),y+120,x+rand(-8,8),y+rand(140,220)); g.stroke(); });
    g.fillStyle='rgba(0,0,0,.85)';
    g.beginPath(); g.ellipse(cx-11,cy+38,4,9,.2,0,TAU); g.fill();
    g.beginPath(); g.ellipse(cx+11,cy+38,4,9,-.2,0,TAU); g.fill();
  }
  const mrx=pale?88:150, mry=pale?190:72;
  const mg=g.createRadialGradient(cx,my,0,cx,my,Math.max(mrx,mry));
  mg.addColorStop(0,'#000'); mg.addColorStop(.7,'#120202'); mg.addColorStop(.92,'#3A0706'); mg.addColorStop(1,'#5C1310');
  g.fillStyle=mg; g.beginPath(); g.ellipse(cx,my,mrx,mry,0,0,TAU); g.fill();
  const nT=pale?16:28;
  for(let i=0;i<nT;i++){
    const a=(i/nT)*TAU+rand(-.05,.05), ex=cx+Math.cos(a)*mrx, ey=my+Math.sin(a)*mry;
    const il=Math.hypot(cx-ex,my-ey)||1, ux=(cx-ex)/il, uy=(my-ey)/il, px=-uy, py=ux;
    const len=rand(pale?20:14,pale?44:30), wd=rand(pale?9:5,pale?15:9);
    g.fillStyle=Math.random()<.2?'#A39776':'#CFC6A8';
    g.beginPath(); g.moveTo(ex+px*wd/2,ey+py*wd/2); g.lineTo(ex-px*wd/2,ey-py*wd/2); g.lineTo(ex+ux*len+rand(-2,2),ey+uy*len+rand(-2,2)); g.closePath(); g.fill();
    g.strokeStyle='rgba(40,20,10,.5)'; g.lineWidth=1; g.stroke();
  }
  g.restore();
  g.save(); g.shadowBlur=18;
  if(pale){
    g.shadowColor='rgba(255,255,240,.9)'; g.fillStyle='#F4F0E2';
    g.beginPath(); g.arc(cx-70,cy-64,6,0,TAU); g.fill();
    g.beginPath(); g.arc(cx+80,cy-74,4.5,0,TAU); g.fill();
  } else {
    g.shadowColor='rgba(255,60,40,.9)'; g.fillStyle='#FFD9C4';
    eyes.forEach(([x,y])=>{ g.beginPath(); g.arc(x+rand(-3,3),y+rand(-2,4),3.2,0,TAU); g.fill(); });
  }
  g.restore();
  if(pale){
    for(let i=0;i<26;i++){
      const side=Math.random()<.5?-1:1, sx=cx+side*rand(20,rx*0.8), sy=cy-ry*rand(.75,.95);
      g.strokeStyle='rgba(5,4,3,'+rand(.6,.95).toFixed(2)+')'; g.lineWidth=rand(1.5,4);
      g.beginPath(); g.moveTo(sx,sy); g.bezierCurveTo(sx-side*rand(0,50),sy+rand(100,200),sx+side*rand(-30,40),sy+rand(250,380),sx+side*rand(-40,60),sy+rand(400,620)); g.stroke();
    }
  }
  return {base:c, red:tint(c,'#FF2A2A'), cyan:tint(c,'#20FFFF'), w, h};
}
function buildMothFace(){
  const w=600,h=800,c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d');
  const cx=w/2, cy=h*0.47, rx=215, ry=250;
  g.lineCap='round';
  // feathered antennae
  for(const s of [-1,1]){
    const ax=cx+s*60, ay=cy-ry*0.82, bx=cx+s*250, by=cy-ry*1.55, mx=cx+s*90, my=cy-ry*1.5;
    g.strokeStyle='#4A4136'; g.lineWidth=7; g.beginPath(); g.moveTo(ax,ay); g.quadraticCurveTo(mx,my,bx,by); g.stroke();
    g.lineWidth=1.6; g.strokeStyle='rgba(120,108,88,.8)';
    for(let k=0.08;k<1;k+=0.035){
      const u=1-k, px=u*u*ax+2*u*k*mx+k*k*bx, py=u*u*ay+2*u*k*my+k*k*by, len=40*(1-k*0.7);
      g.beginPath(); g.moveTo(px,py); g.lineTo(px+s*len*0.7,py+len*0.55); g.moveTo(px,py); g.lineTo(px-s*len*0.35,py-len*0.6); g.stroke();
    }
  }
  // furry head
  const sk=g.createRadialGradient(cx,cy+30,20,cx,cy,ry*1.05);
  sk.addColorStop(0,'#8E8370'); sk.addColorStop(.55,'#5C5344'); sk.addColorStop(.85,'#2C261F'); sk.addColorStop(1,'#0E0C0A');
  g.fillStyle=sk; g.beginPath(); g.ellipse(cx,cy,rx,ry,0,0,TAU); g.fill();
  for(let i=0;i<2600;i++){
    const a=rand(0,TAU), r=Math.sqrt(Math.random()), px=cx+Math.cos(a)*rx*r*1.04, py=cy+Math.sin(a)*ry*r*1.04, len=rand(6,16)*(0.6+r);
    g.strokeStyle=Math.random()<.45?'rgba(205,192,165,.12)':'rgba(10,8,6,.4)'; g.lineWidth=rand(.8,2);
    g.beginPath(); g.moveTo(px,py); g.lineTo(px+Math.cos(a)*len+rand(-3,3),py+Math.sin(a)*len+rand(-3,3)); g.stroke();
  }
  // huge compound eyes
  for(const s of [-1,1]){
    const ex=cx+s*118, ey=cy-48, erx=98, ery=126;
    const eg=g.createRadialGradient(ex-s*20,ey-30,8,ex,ey,ery);
    eg.addColorStop(0,'#5A1A10'); eg.addColorStop(.5,'#2A0805'); eg.addColorStop(1,'#060202');
    g.fillStyle=eg; g.beginPath(); g.ellipse(ex,ey,erx,ery,s*0.25,0,TAU); g.fill();
    g.save(); g.beginPath(); g.ellipse(ex,ey,erx,ery,s*0.25,0,TAU); g.clip();
    g.strokeStyle='rgba(255,110,60,.22)'; g.lineWidth=1.2;
    const hs=9;
    for(let yy=ey-ery;yy<ey+ery;yy+=hs*1.5) for(let xx=ex-erx;xx<ex+erx;xx+=hs*1.73){
      const ox=xx+((Math.round((yy-ey)/(hs*1.5))&1)?hs*0.86:0);
      g.beginPath(); for(let k=0;k<6;k++){ const a=k*Math.PI/3+Math.PI/6; const px=ox+Math.cos(a)*hs, py=yy+Math.sin(a)*hs; if(k) g.lineTo(px,py); else g.moveTo(px,py); } g.closePath(); g.stroke();
    }
    g.restore();
    g.save(); g.shadowBlur=24; g.shadowColor='rgba(255,90,40,.9)'; g.fillStyle='rgba(255,170,120,.85)';
    g.beginPath(); g.ellipse(ex-s*28,ey-52,10,16,s*0.3,0,TAU); g.fill(); g.restore();
  }
  // mouth: a round hole lined with needles, flanked by mandibles
  const my=cy+120, mrx=70, mry=86;
  const mg=g.createRadialGradient(cx,my,0,cx,my,mry);
  mg.addColorStop(0,'#000'); mg.addColorStop(.75,'#140303'); mg.addColorStop(1,'#4A0D0A');
  g.fillStyle=mg; g.beginPath(); g.ellipse(cx,my,mrx,mry,0,0,TAU); g.fill();
  for(let i=0;i<34;i++){
    const a=(i/34)*TAU, ex=cx+Math.cos(a)*mrx, ey=my+Math.sin(a)*mry, len=rand(16,34);
    const ux=(cx-ex)/Math.hypot(cx-ex,my-ey), uy=(my-ey)/Math.hypot(cx-ex,my-ey);
    g.strokeStyle=Math.random()<.2?'#A39776':'#D8CFB2'; g.lineWidth=rand(1.5,3);
    g.beginPath(); g.moveTo(ex,ey); g.lineTo(ex+ux*len,ey+uy*len); g.stroke();
  }
  for(const s of [-1,1]){
    g.fillStyle='#2A231B'; g.strokeStyle='#120E0A'; g.lineWidth=2;
    g.beginPath(); g.moveTo(cx+s*60,my-60); g.quadraticCurveTo(cx+s*150,my+10,cx+s*40,my+130);
    g.quadraticCurveTo(cx+s*95,my+20,cx+s*45,my-30); g.closePath(); g.fill(); g.stroke();
  }
  const id=g.getImageData(0,0,w,h), d=id.data;
  for(let i=0;i<d.length;i+=4){ if(d[i+3]>10){ const n=(Math.random()-.5)*28; d[i]+=n; d[i+1]+=n; d[i+2]+=n; } }
  g.putImageData(id,0,0);
  return {base:c, red:tint(c,'#FF2A2A'), cyan:tint(c,'#20FFFF'), w, h};
}
function ensureFaces(){
  if(!faces.pale) faces.pale=buildFace('pale');
  if(!faces.crawler) faces.crawler=buildFace('crawler');
  if(!faces.moth) faces.moth=buildMothFace();
}

// =================== MAP ===================
let COLS=0,ROWS=0,grid=null,mapC=null,exitT=[1,1],exitDir=[1,0],stairPoly=null;
const idx=(x,y)=>y*COLS+x;
const center=(tx,ty)=>({x:tx*T+T/2,y:ty*T+T/2});
const tileOf=o=>[Math.floor(o.x/T),Math.floor(o.y/T)];
function isFloor(x,y){ return x>=0&&y>=0&&x<COLS&&y<ROWS&&grid[idx(x,y)]===0; }
function cellList(){ const a=[]; for(let cy=0;cy<CH;cy++) for(let cx=0;cx<CW;cx++) a.push([2*cx+1,2*cy+1]); return a; }
function wallCount(tx,ty){ let n=0; for(const [dx,dy] of DIRS) if(!isFloor(tx+dx,ty+dy)) n++; return n; }
function genMaze(){
  COLS=CW*2+1; ROWS=CH*2+1;
  grid=new Uint8Array(COLS*ROWS).fill(1);
  const seen=new Uint8Array(CW*CH), stack=[[0,0]]; seen[0]=1; grid[idx(1,1)]=0;
  while(stack.length){
    const [x,y]=stack[stack.length-1];
    const nb=DIRS.map(([dx,dy])=>[x+dx,y+dy,dx,dy]).filter(([nx,ny])=>nx>=0&&ny>=0&&nx<CW&&ny<CH&&!seen[ny*CW+nx]);
    if(!nb.length){ stack.pop(); continue; }
    const [nx,ny,dx,dy]=pick(nb);
    seen[ny*CW+nx]=1; grid[idx(2*x+1+dx,2*y+1+dy)]=0; grid[idx(2*nx+1,2*ny+1)]=0; stack.push([nx,ny]);
  }
  for(let y=1;y<ROWS-1;y++) for(let x=1;x<COLS-1;x++){
    if(grid[idx(x,y)]!==1) continue;
    if(((x%2===0&&y%2===1)||(x%2===1&&y%2===0)) && Math.random()<0.12) grid[idx(x,y)]=0;
  }
}
function wallAt(px,py){
  const tx=Math.floor(px/T), ty=Math.floor(py/T);
  if(tx<0||ty<0||tx>=COLS||ty>=ROWS) return true;
  return grid[idx(tx,ty)]===1;
}
function collides(x,y,r){ return wallAt(x-r,y-r)||wallAt(x+r,y-r)||wallAt(x-r,y+r)||wallAt(x+r,y+r); }
function bfs(sx,sy){
  const d=new Int16Array(COLS*ROWS).fill(-1), q=[sx,sy]; d[idx(sx,sy)]=0; let h=0;
  while(h<q.length){
    const x=q[h++], y=q[h++], dd=d[idx(x,y)];
    for(const [dx,dy] of DIRS){ const nx=x+dx, ny=y+dy; if(!isFloor(nx,ny)) continue; const i=idx(nx,ny); if(d[i]>=0) continue; d[i]=dd+1; q.push(nx,ny); }
  }
  return d;
}
function los(x0,y0,x1,y1){
  const d=Math.hypot(x1-x0,y1-y0), n=Math.ceil(d/6);
  for(let i=1;i<n;i++){ const f=i/n; if(wallAt(x0+(x1-x0)*f,y0+(y1-y0)*f)) return false; }
  return true;
}
function rayPoly(x,y,r,a0,a1,N,withCenter){
  const pts=withCenter?[[x,y]]:[];
  for(let i=0;i<=N;i++){
    const a=a0+(a1-a0)*i/N, c=Math.cos(a), s=Math.sin(a); let d=0;
    while(d<r){ d+=4; if(wallAt(x+c*d,y+s*d)) break; }
    pts.push([x+c*d,y+s*d]);
  }
  return pts;
}
function polyPath(c,pts){ c.beginPath(); c.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) c.lineTo(pts[i][0],pts[i][1]); c.closePath(); }

// ---- static art for the map ----
function hand(g,x,y,a,s,smear){
  g.save(); g.translate(x,y); g.rotate(a); g.scale(s,s); g.fillStyle='rgba(95,10,7,.72)';
  g.beginPath(); g.ellipse(0,0,3.2,3.8,0,0,TAU); g.fill();
  [[-2.6,-4.6,-.5],[-0.9,-5.6,-.15],[0.9,-5.6,.15],[2.5,-4.8,.4],[3.6,-0.6,1.2]].forEach(([fx,fy,fa])=>{
    g.save(); g.translate(fx,fy); g.rotate(fa); g.beginPath(); g.ellipse(0,-1.4,0.9,2.3,0,0,TAU); g.fill(); g.restore();
  });
  g.globalAlpha=.45; g.fillRect(-2.5,3,5,smear==null?5:smear); g.restore();
}
function cobweb(g,cx,cy,sx,sy){
  g.strokeStyle='rgba(210,205,190,.17)'; g.lineWidth=.45; const L=rand(9,15);
  for(let k=0;k<=4;k++){ const a=k/4*Math.PI/2; g.beginPath(); g.moveTo(cx,cy); g.lineTo(cx-Math.cos(a)*L*sx,cy-Math.sin(a)*L*sy); g.stroke(); }
  for(let r=4;r<L;r+=3.5){ g.beginPath(); for(let k=0;k<=4;k++){ const a=k/4*Math.PI/2, px=cx-Math.cos(a)*r*sx, py=cy-Math.sin(a)*r*sy; if(k) g.lineTo(px,py); else g.moveTo(px,py); } g.stroke(); }
}
function scratches(g,x,y){
  g.strokeStyle='rgba(12,8,6,.85)'; g.lineWidth=.7;
  for(let k=0;k<4;k++){ g.beginPath(); g.moveTo(x+k*1.8,y); g.lineTo(x+k*1.8+3.5,y+6.5); g.stroke(); }
  g.strokeStyle='rgba(255,240,220,.08)';
  for(let k=0;k<4;k++){ g.beginPath(); g.moveTo(x+k*1.8+.6,y); g.lineTo(x+k*1.8+4.1,y+6.5); g.stroke(); }
}
function bloodTrail(g){
  let [x,y]=pick(cellList()); const pts=[[x,y]]; let prev=null;
  for(let k=0;k<7;k++){
    const opts=DIRS.filter(([dx,dy])=>isFloor(x+dx,y+dy)&&!(prev&&dx===-prev[0]&&dy===-prev[1]));
    if(!opts.length) break; const dd=pick(opts); x+=dd[0]; y+=dd[1]; prev=dd; pts.push([x,y]);
  }
  g.lineCap='round'; g.lineJoin='round';
  for(let i=1;i<pts.length;i++){
    const a=center(...pts[i-1]), b=center(...pts[i]);
    g.strokeStyle='rgba(72,8,6,'+Math.max(.2,0.75-i*0.05).toFixed(2)+')'; g.lineWidth=Math.max(1.4,6-i*0.45);
    g.beginPath(); g.moveTo(a.x+rand(-3,3),a.y+rand(-3,3)); g.lineTo(b.x+rand(-3,3),b.y+rand(-3,3)); g.stroke();
  }
  g.fillStyle='rgba(80,8,6,.7)';
  for(let i=0;i<16;i++){ const p=center(...pick(pts)); g.beginPath(); g.arc(p.x+rand(-10,10),p.y+rand(-10,10),rand(.6,1.8),0,TAU); g.fill(); }
  const s=center(...pts[0]); hand(g,s.x+rand(-5,5),s.y+rand(-5,5),rand(0,TAU),1.1);
}
function box(g,x,y,w,h,r){
  g.save(); g.translate(x,y); g.rotate(r);
  g.fillStyle='rgba(0,0,0,.4)'; g.fillRect(-w/2+1.5,-h/2+1.5,w,h);
  g.fillStyle='#7A5E3E'; g.fillRect(-w/2,-h/2,w,h);
  g.strokeStyle='#2E2418'; g.lineWidth=.8; g.strokeRect(-w/2,-h/2,w,h);
  g.fillStyle='#7D6C52'; g.fillRect(-w/2,-1,w,2);
  g.strokeStyle='rgba(0,0,0,.35)'; g.beginPath(); g.moveTo(-w/2,-h/2); g.lineTo(0,-1); g.lineTo(w/2,-h/2); g.stroke();
  g.restore();
}
function drawProp(g,p){
  const c=center(p.tx,p.ty), back=[-p.open[0],-p.open[1]];
  g.save(); g.translate(c.x+back[0]*8,c.y+back[1]*8); g.rotate(Math.atan2(back[1],back[0]));
  // local: +x toward the back wall, y runs along it
  if(p.type==='boxes'){ box(g,2,-7,12,13,.1); box(g,0,6,13,12,-.15); box(g,-11,-1,8,8,.5); }
  else if(p.type==='mattress'){
    g.fillStyle='rgba(0,0,0,.4)'; g.fillRect(-6,-16,16,34);
    g.fillStyle='#6A6352'; g.fillRect(-7,-17,15,34);
    const st=g.createRadialGradient(0,3,0,0,3,9); st.addColorStop(0,'rgba(70,14,8,.85)'); st.addColorStop(1,'rgba(70,14,8,0)'); g.fillStyle=st; g.fillRect(-7,-17,15,34);
    g.fillStyle='rgba(0,0,0,.35)'; for(let a=-12;a<=12;a+=8) for(let b=-3;b<=5;b+=8){ g.beginPath(); g.arc(b,a,.7,0,TAU); g.fill(); }
  }
  else if(p.type==='chair'){
    g.strokeStyle='#2B1E14'; g.lineWidth=1.6;
    g.fillStyle='#3E2C1F'; g.fillRect(-6,-6,11,11); g.fillRect(-12,-6,3.5,11);
    [[-6,-6],[5,-6],[-6,5],[5,5]].forEach(([a,b])=>{ g.beginPath(); g.moveTo(a,b); g.lineTo(a-4,b+(b<0?-3:3)); g.stroke(); });
  }
  else if(p.type==='shelf'){
    g.fillStyle='#35281E'; g.fillRect(2,-18,7,36);
    ['#5D6B3A','#7A5C2E','#4A3F55','#6B2A1E','#5D6B3A'].forEach((col,i)=>{ g.fillStyle=col; g.globalAlpha=.85; g.beginPath(); g.arc(5.5,-14+i*7,2.4,0,TAU); g.fill(); g.globalAlpha=1; g.strokeStyle='rgba(220,220,200,.2)'; g.lineWidth=.5; g.stroke(); });
    g.fillStyle='rgba(200,210,190,.25)'; for(let k=0;k<6;k++) g.fillRect(rand(-6,0),rand(-4,4),rand(.6,1.6),rand(.6,1.6));
  }
  else if(p.type==='barrels'){
    [[1,-7],[0,7]].forEach(([a,b])=>{ g.fillStyle='rgba(0,0,0,.4)'; g.beginPath(); g.arc(a+1.5,b+1.5,6.5,0,TAU); g.fill(); g.fillStyle='#34402F'; g.beginPath(); g.arc(a,b,6.5,0,TAU); g.fill(); g.strokeStyle='#202A1D'; g.lineWidth=1; g.beginPath(); g.arc(a,b,4.4,0,TAU); g.stroke(); g.fillStyle='rgba(110,50,20,.5)'; g.beginPath(); g.arc(a+2,b-1,1.6,0,TAU); g.fill(); });
  }
  else if(p.type==='crib'){
    g.fillStyle='rgba(0,0,0,.4)'; g.fillRect(-7,-14,17,30);
    g.fillStyle='#211A14'; g.fillRect(-8,-15,16,30);
    g.fillStyle='#6E675C'; g.beginPath(); g.ellipse(0,2,4,6,.3,0,TAU); g.fill();
    g.strokeStyle='#4B3B2C'; g.lineWidth=1; g.strokeRect(-8,-15,16,30);
    for(let k=-12;k<=12;k+=3){ g.beginPath(); g.moveTo(-8,k); g.lineTo(-6.5,k); g.moveTo(8,k); g.lineTo(6.5,k); g.stroke(); }
  }
  g.restore();
}
function drawStairsTile(g){
  const c=center(...exitT), back=[-exitDir[0],-exitDir[1]];
  g.save(); g.translate(c.x,c.y); g.rotate(Math.atan2(back[1],back[0]));
  for(let i=0;i<6;i++){ const x=-18+i*6, v=50+i*12; g.fillStyle='rgb('+(v+10)+','+(v+5)+','+v+')'; g.fillRect(x,-15,6,30); g.fillStyle='rgba(0,0,0,.55)'; g.fillRect(x,-15,1.2,30); }
  g.strokeStyle='#5A5148'; g.lineWidth=1.5; g.beginPath(); g.moveTo(-18,-16); g.lineTo(18,-16); g.stroke();
  g.restore();
}
function drawWallTile(g,x,y){
  const X=x*T, Y=y*T;
  g.fillStyle='#231E1A'; g.fillRect(X,Y,T,T);
  const bh=T/3;
  for(let r=0;r<3;r++){
    const off=(r+y)%2?T/4:0;
    for(let c=-1;c<3;c++){
      const bx=X+off+c*T/2, x0=Math.max(X,bx+0.8), x1=Math.min(X+T,bx+T/2-0.8);
      if(x1<=x0) continue;
      const v=56+Math.random()*20|0; g.fillStyle='rgb('+(v+8)+','+(v+3)+','+v+')'; g.fillRect(x0,Y+r*bh+0.8,x1-x0,bh-1.6);
    }
  }
  g.fillStyle='rgba(0,0,0,'+rand(.1,.35).toFixed(2)+')'; g.fillRect(X,Y,T,T);
  if(isFloor(x,y-1)){ g.fillStyle='rgba(255,240,220,.06)'; g.fillRect(X,Y,T,1.2); }
  if(isFloor(x,y+1)){
    const fy=Y+T-9, gr=g.createLinearGradient(0,fy,0,Y+T); gr.addColorStop(0,'#7A6E60'); gr.addColorStop(1,'#3A322B');
    g.fillStyle=gr; g.fillRect(X,fy,T,9);
    g.strokeStyle='rgba(0,0,0,.5)'; g.lineWidth=.6; g.beginPath(); g.moveTo(X,fy+4.5); g.lineTo(X+T,fy+4.5);
    for(let k=0;k<T;k+=T/2){ const jx=X+k+(x%2?T/4:0); g.moveTo(jx,fy); g.lineTo(jx,fy+4.5); }
    g.stroke();
    if(Math.random()<0.2) scratches(g,X+rand(6,28),fy+1);
    if(Math.random()<0.08) hand(g,X+rand(8,32),fy+4,rand(-.4,.4),0.75);
    if(Math.random()<0.35){ g.fillStyle='rgba(30,22,15,.55)'; g.fillRect(X+rand(3,36),fy,1.2,rand(4,9)); }
  }
}
function drawPipes(g){
  let made=0;
  for(let tries=0;tries<120&&made<6;tries++){
    const vert=Math.random()<.5, x=1+Math.random()*(COLS-2)|0, y=1+Math.random()*(ROWS-2)|0;
    if(grid[idx(x,y)]!==1) continue;
    const dx=vert?0:1, dy=vert?1:0; let len=0;
    while(x+dx*len<COLS-1&&y+dy*len<ROWS-1&&grid[idx(x+dx*len,y+dy*len)]===1) len++;
    if(len<3) continue; made++;
    const off=rand(0.3,0.7)*T;
    const x0=vert?x*T+off:x*T, y0=vert?y*T:y*T+off, x1=vert?x0:(x+len)*T, y1=vert?(y+len)*T:y0;
    const line=(ax,ay,bx,by)=>{ g.beginPath(); g.moveTo(ax,ay); g.lineTo(bx,by); g.stroke(); };
    g.lineCap='butt';
    g.strokeStyle='rgba(0,0,0,.5)'; g.lineWidth=6; line(x0+1.5,y0+1.5,x1+1.5,y1+1.5);
    g.strokeStyle='#4E524B'; g.lineWidth=5; line(x0,y0,x1,y1);
    g.strokeStyle='rgba(170,175,160,.25)'; g.lineWidth=1.2; line(x0-(vert?1.3:0),y0-(vert?0:1.3),x1-(vert?1.3:0),y1-(vert?0:1.3));
    g.fillStyle='#3C3F39';
    for(let k=1;k<len;k++){ const jx=vert?x0:x*T+k*T, jy=vert?y*T+k*T:y0; g.fillRect(jx-(vert?3.5:1.8),jy-(vert?1.8:3.5),vert?7:3.6,vert?3.6:7); }
    g.fillStyle='rgba(110,50,20,.4)';
    for(let k=0;k<len*3;k++){ const f=Math.random(); g.beginPath(); g.arc(x0+(x1-x0)*f+rand(-1.5,1.5),y0+(y1-y0)*f+rand(-1.5,1.5),rand(.6,1.8),0,TAU); g.fill(); }
  }
}
function prerender(props){
  mapC=document.createElement('canvas'); mapC.width=COLS*T*MS; mapC.height=ROWS*T*MS;
  const g=mapC.getContext('2d'); g.scale(MS,MS);
  g.fillStyle='#3A332C'; g.fillRect(0,0,COLS*T,ROWS*T);
  const floors=[];
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) if(grid[idx(x,y)]===0) floors.push([x,y]);
  floors.forEach(([x,y])=>{
    g.fillStyle='rgba(255,235,210,'+rand(0,0.05).toFixed(3)+')'; g.fillRect(x*T,y*T,T,T);
    g.strokeStyle='rgba(0,0,0,.35)'; g.lineWidth=0.7; g.strokeRect(x*T+0.35,y*T+0.35,T-0.7,T-0.7);
  });
  for(let i=0;i<9000;i++){ const [x,y]=pick(floors); g.fillStyle=Math.random()<.5?'rgba(0,0,0,.28)':'rgba(255,240,220,.05)'; g.fillRect(x*T+Math.random()*T,y*T+Math.random()*T,0.8,0.8); }
  for(let i=0;i<90;i++){
    const [x,y]=pick(floors), px=x*T+rand(4,36), py=y*T+rand(4,36), r=rand(5,20), tone=Math.random()<0.25?'40,10,6':'8,5,3';
    const s=g.createRadialGradient(px,py,0,px,py,r); s.addColorStop(0,'rgba('+tone+','+rand(.35,.6).toFixed(2)+')'); s.addColorStop(1,'rgba('+tone+',0)');
    g.fillStyle=s; g.beginPath(); g.arc(px,py,r,0,TAU); g.fill();
  }
  g.strokeStyle='rgba(0,0,0,.55)'; g.lineWidth=0.7;
  for(let i=0;i<40;i++){ const [x,y]=pick(floors); let px=x*T+rand(0,T), py=y*T+rand(0,T), a=rand(0,TAU); g.beginPath(); g.moveTo(px,py); const n=3+Math.random()*5|0; for(let k=0;k<n;k++){ a+=rand(-.7,.7); px+=Math.cos(a)*rand(4,9); py+=Math.sin(a)*rand(4,9); g.lineTo(px,py); } g.stroke(); }
  for(let i=0;i<6;i++){
    const [x,y]=pick(floors), px=x*T+rand(12,28), py=y*T+rand(12,28);
    g.save(); g.translate(px,py); g.rotate(rand(0,3));
    g.fillStyle='rgba(6,8,11,.85)'; g.beginPath(); g.ellipse(0,0,rand(7,13),rand(4,8),0,0,TAU); g.fill();
    g.strokeStyle='rgba(150,160,170,.14)'; g.lineWidth=0.8; g.beginPath(); g.ellipse(0,0,rand(4,6),rand(2,3),0,3.6,5.4); g.stroke();
    g.restore();
  }
  for(let i=0;i<2;i++){
    const [x,y]=pick(floors), px=x*T+T/2, py=y*T+T/2;
    g.fillStyle='rgba(0,0,0,.6)'; g.beginPath(); g.arc(px,py,9,0,TAU); g.fill();
    g.fillStyle='#2B2A27'; g.beginPath(); g.arc(px,py,6,0,TAU); g.fill();
    g.strokeStyle='#0A0908'; g.lineWidth=1.1; for(let k=-4;k<=4;k+=2){ g.beginPath(); g.moveTo(px+k,py-5); g.lineTo(px+k,py+5); g.stroke(); }
  }
  bloodTrail(g); bloodTrail(g);
  ['KEEP THE LIGHT ON','DON’T LOOK AWAY','STAND STILL WHEN IT CLICKS','SHE’S STILL HERE','WE NEVER LEFT'].forEach(w=>{
    const [x,y]=pick(floors);
    g.save(); g.translate(x*T+T/2,y*T+T/2); g.rotate(rand(-.35,.35));
    g.font='italic 7px "IM Fell English", Georgia, serif'; g.textAlign='center'; g.textBaseline='middle';
    g.fillStyle='rgba(115,12,9,.8)'; g.fillText(w,0,0,T*1.9);
    g.fillStyle='rgba(90,8,6,.6)'; for(let k=0;k<4;k++) g.fillRect(rand(-28,28),2,0.8,rand(2,7));
    g.restore();
  });
  for(let i=0;i<7;i++){ const [x,y]=pick(floors); hand(g,x*T+rand(8,32),y*T+rand(8,32),rand(0,TAU),rand(.9,1.2)); }
  props.forEach(p=>drawProp(g,p));
  drawStairsTile(g);
  floors.forEach(([x,y])=>{
    for(const [dx,dy] of DIRS){
      if(isFloor(x+dx,y+dy)) continue;
      const ex=x*T+(dx>0?T:0), ey=y*T+(dy>0?T:0);
      const gr=dx!==0?g.createLinearGradient(ex,0,ex-dx*12,0):g.createLinearGradient(0,ey,0,ey-dy*12);
      gr.addColorStop(0,'rgba(0,0,0,.6)'); gr.addColorStop(1,'rgba(0,0,0,0)'); g.fillStyle=gr;
      if(dx!==0) g.fillRect(dx>0?ex-12:ex,y*T,12,T); else g.fillRect(x*T,dy>0?ey-12:ey,T,12);
    }
    for(const [sx,sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){
      if(!isFloor(x+sx,y)&&!isFloor(x,y+sy)&&Math.random()<0.35) cobweb(g,x*T+(sx>0?T:0),y*T+(sy>0?T:0),sx,sy);
    }
  });
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++) if(grid[idx(x,y)]===1) drawWallTile(g,x,y);
  drawPipes(g);
}

// =================== GAME STATE ===================
let state='menu', scareOn=save.scare, introSeen=false, paused=false, night=1, pickNight=save.nightMax, cfg=nightCfg(1);
let P, monsters, items, bulbs, rats, doll, dust, glimpse, flags;
let fuses, battery, t, cam, distMap, pathT, heartT, flickT, flickOff, lightOn, lightWanted, range, ambT, glimT, msgT, lastLockMsg, lastFuseT, breathPh, scare, hudKey='';
let stamina, winded, sprinting, loudT, seen, seenT, exitKnown, mapOpen, spawnI, lastSpawnT, kindCount, lowBatWarned, noteT;
const keys={}; let joy=null;

function newGame(){
  cfg=nightCfg(night); CW=cfg.cw; CH=cfg.ch;
  genMaze();
  const s=center(1,1);
  P={x:s.x,y:s.y,face:0,step:0,lastStep:0,moving:false,still:0,intensity:0,litClose:false};
  cam={x:P.x,y:P.y};
  const d0=bfs(1,1); let far=[1,1], farD=-1; const cand=[];
  cellList().forEach(([tx,ty])=>{ const dd=d0[idx(tx,ty)]; if(dd>farD){ farD=dd; far=[tx,ty]; } if(dd>=8) cand.push([tx,ty]); });
  exitT=far; exitDir=DIRS.find(([dx,dy])=>isFloor(far[0]+dx,far[1]+dy))||[1,0];
  const pool=shuffle(cand.filter(c=>!(c[0]===far[0]&&c[1]===far[1])));
  const chosen=[], NF=cfg.fuses;
  for(const c of pool){ if(chosen.length>=NF) break; if(chosen.every(o=>Math.abs(o[0]-c[0])+Math.abs(o[1]-c[1])>=8)) chosen.push(c); }
  for(const c of pool){ if(chosen.length>=NF) break; if(!chosen.includes(c)) chosen.push(c); }
  const rest=pool.filter(c=>!chosen.includes(c));
  items=[];
  chosen.forEach(c=>items.push(Object.assign({k:'fuse',ph:rand(0,6)},center(...c))));
  const batCells=rest.slice(0,cfg.bats);
  batCells.forEach(c=>items.push(Object.assign({k:'bat',ph:rand(0,6)},center(...c))));
  // up to two unread notes per night
  const unread=NOTES.map((_,i)=>i).filter(i=>!save.notes.includes(i));
  const noteCells=rest.slice(cfg.bats,cfg.bats+Math.min(2,unread.length));
  noteCells.forEach((c,i)=>items.push(Object.assign({k:'note',id:unread[i],ph:rand(0,6)},center(...c))));
  const used=new Set(chosen.concat(batCells,noteCells,[far,[1,1]]).map(c=>c[0]+','+c[1]));
  const deads=shuffle(cellList().filter(([tx,ty])=>wallCount(tx,ty)===3&&!used.has(tx+','+ty)))
    .map(([tx,ty])=>({tx,ty,open:DIRS.find(([dx,dy])=>isFloor(tx+dx,ty+dy))}));
  const types=shuffle(['boxes','mattress','chair','shelf','barrels','crib']).concat(shuffle(['boxes','shelf','barrels','chair','boxes','mattress','shelf','barrels']));
  const props=[]; doll=null;
  deads.forEach((c,i)=>{
    used.add(c.tx+','+c.ty);
    if(i===0){ const cc=center(c.tx,c.ty); doll={x:cc.x-c.open[0]*10,y:cc.y-c.open[1]*10,ang:0}; return; }
    if(i-1<types.length){ c.type=types[i-1]; props.push(c); }
  });
  bulbs=shuffle(rest.slice(cfg.bats+noteCells.length).filter(c=>!used.has(c[0]+','+c[1]))).slice(0,cfg.bulbs).map(c=>{
    const cc=center(...c); return {x:cc.x,y:cc.y,r:85,on:true,t:rand(1,5),sw:rand(0,6),poly:rayPoly(cc.x,cc.y,85,0,TAU,60,false)};
  });
  const ec=center(...exitT); stairPoly=rayPoly(ec.x,ec.y,90,0,TAU,48,false);
  rats=[];
  for(let i=0;i<Math.min(7,3+night);i++){ const c=center(...pick(cand)); rats.push({x:c.x+rand(-8,8),y:c.y+rand(-8,8),dir:rand(0,TAU),run:0,tw:0}); }
  dust=[]; for(let i=0;i<45;i++){ const a=rand(0,TAU), r=rand(0,240); dust.push({x:P.x+Math.cos(a)*r,y:P.y+Math.sin(a)*r,vx:rand(-4,4),vy:rand(-4,4)}); }
  monsters=[]; glimpse=null; flags={litPale:0};
  fuses=0; battery=100; t=0; pathT=0; distMap=bfs(1,1); heartT=1; flickT=9; flickOff=0; lightOn=true; lightWanted=true; range=230;
  ambT=4; glimT=rand(16,26); msgT=0; lastLockMsg=-9; lastFuseT=0; breathPh=0; joy=null; hudKey='';
  stamina=100; winded=false; sprinting=false; loudT=9;
  seen=new Uint8Array(COLS*ROWS); seenT=0; exitKnown=false; mapOpen=false;
  spawnI=0; lastSpawnT=-9; kindCount={}; lowBatWarned=false; noteT=0;
  $('fuses').innerHTML='<span class="fz"></span>'.repeat(cfg.fuses);
  $('nightLabel').textContent='Night '+night;
  prerender(props);
}

function showMsg(s,dur){ const m=$('msg'); m.textContent=s; m.classList.add('show'); msgT=dur||3; }
function showNote(id){
  $('noteText').textContent=NOTES[id];
  $('noteNum').textContent='Note '+(id+1)+' of '+NOTES.length+' (saved to your journal)';
  $('note').classList.add('show'); noteT=Math.max(6,NOTES[id].length/14);
}
const OVERLAYS=['menu','help','settings','journal','pause','dead','won'];
function hideOverlays(){ OVERLAYS.forEach(id=>$(id).hidden=true); }
function updateHud(){
  const key=fuses+'|'+Math.round(battery)+'|'+Math.round(stamina)+'|'+winded+'|'+lightWanted;
  if(key===hudKey) return; hudKey=key;
  document.querySelectorAll('#fuses .fz').forEach((el,i)=>el.classList.toggle('on',i<fuses));
  const f=$('batFill'); f.style.width=Math.max(0,battery)+'%'; f.style.background=battery<25?'var(--blood)':'var(--amber)';
  $('batRow').classList.toggle('off',!lightWanted);
  $('stamFill').style.width=Math.max(0,stamina)+'%';
  $('stamRow').classList.toggle('full',stamina>=99.5); $('stamRow').classList.toggle('winded',winded);
  $('btnLight').classList.toggle('on',lightWanted);
}

function spawnMonster(kind){
  const [px,py]=tileOf(P), d=bfs(px,py); let max=0; for(let i=0;i<d.length;i++) if(d[i]>max) max=d[i];
  const all=cellList();
  let opts=all.filter(([tx,ty])=>{ const c=center(tx,ty); return d[idx(tx,ty)]>=max*0.6&&monsters.every(m=>Math.hypot(m.x-c.x,m.y-c.y)>T*4); });
  if(!opts.length) opts=all.filter(([tx,ty])=>d[idx(tx,ty)]>=max*0.5);
  const c=center(...pick(opts.length?opts:all));
  const paleCount=monsters.filter(m=>m.kind==='pale').length;
  monsters.push({kind,x:c.x,y:c.y,tx:0,ty:0,hasT:false,lit:false,wob:rand(0,6),gait:0,dir:0,clickT:0.2,burst:6,last:null,mul:paleCount?0.9:1,flap:rand(0,6),drawn:false});
  if(kind==='pale') groan(clamp((c.x-P.x)/250,-1,1));
  if(kind==='moth') creak(clamp((c.x-P.x)/250,-1,1),0.08);
  // first-time hints for each kind of thing
  const n=kindCount[kind]=(kindCount[kind]||0)+1, touch=matchMedia('(pointer:coarse)').matches;
  const lines={
    pale:['Something moved in the dark.','There’s more than one of her.','Another one. She’s everywhere.'],
    crawler:['Clicking. It hunts by sound. When you hear it, stand still.','More clicking. Two of them now.'],
    moth:['Wings. It’s drawn to your light. '+(touch?'Tap Light to switch it off.':'Press F to switch it off.'),'More wings. Keep your light low.'],
  };
  showMsg(lines[kind][Math.min(n,lines[kind].length)-1],4.5);
}
function toggleLight(){
  if(state!=='play'||paused) return;
  lightWanted=!lightWanted; flashClick();
  if(lightWanted&&battery<=0) showMsg('The battery is dead.');
  updateHud();
}

function inBeam(x,y){
  if(!lightOn) return false;
  const dx=x-P.x, dy=y-P.y, d=Math.hypot(dx,dy);
  if(d>range+10) return false; if(d<14) return true;
  if(Math.abs(angDiff(Math.atan2(dy,dx),P.face))>HALF+0.1) return false;
  return los(P.x,P.y,x,y);
}
function bulbLit(x,y){ return bulbs.some(b=>b.on&&Math.hypot(b.x-x,b.y-y)<b.r*0.8&&los(b.x,b.y,x,y)); }

function stepToward(m,spd,dt){
  if(!m.hasT) return;
  const dx=m.tx-m.x, dy=m.ty-m.y, d=Math.hypot(dx,dy), s=spd*dt;
  if(d<0.001){ m.hasT=false; return; }
  m.dir=turnTo(m.dir,Math.atan2(dy,dx),10*dt);
  if(d<=s){ m.x=m.tx; m.y=m.ty; m.hasT=false; } else { m.x+=dx/d*s; m.y+=dy/d*s; }
}
function chooseChase(m,ptx,pty){
  const [mtx,mty]=tileOf(m);
  if(mtx===ptx&&mty===pty){ m.tx=P.x; m.ty=P.y; m.hasT=true; return; }
  if(m.hasT) return;
  const cur=distMap[idx(mtx,mty)]; let best=null;
  for(const [dx,dy] of DIRS){ const nx=mtx+dx, ny=mty+dy; if(!isFloor(nx,ny)) continue; const v=distMap[idx(nx,ny)]; if(v>=0&&(cur<0||v<cur)&&(!best||v<best.v)) best={v,nx,ny}; }
  if(best){ const c=center(best.nx,best.ny); m.tx=c.x; m.ty=c.y; m.hasT=true; }
}
function chooseWander(m){
  if(m.hasT) return;
  const [mtx,mty]=tileOf(m), opts=DIRS.filter(([dx,dy])=>isFloor(mtx+dx,mty+dy));
  if(!opts.length) return;
  let o=opts.filter(([dx,dy])=>!(m.last&&dx===-m.last[0]&&dy===-m.last[1])); if(!o.length) o=opts;
  const d=pick(o); m.last=d; const c=center(mtx+d[0],mty+d[1]); m.tx=c.x; m.ty=c.y; m.hasT=true;
}

function fmt(s){ const m=Math.floor(s/60), r=Math.floor(s%60); return m+':'+String(r).padStart(2,'0'); }

function leavePlay(){
  joy=null; mapOpen=false; clearInput();
  $('hud').hidden=true; $('touch').hidden=true;
  $('msg').classList.remove('show'); $('note').classList.remove('show');
}
function die(kind){
  state='scare'; scare={t:0,kind};
  cutAll(); leavePlay();
  if(scareOn){ scream(kind,0.12); if(navigator.vibrate) try{ navigator.vibrate([0,120,60,380]); }catch(e){} }
  else thump(0.6);
}
function getOut(){
  state='won'; cutAll(); blip(990); leavePlay();
  const prev=save.best[night], isBest=!prev||t<prev;
  if(isBest) save.best[night]=Math.round(t*10)/10;
  save.nightMax=Math.max(save.nightMax,night+1); pickNight=night+1; persist();
  const final=night===LAST_NIGHT;
  $('wonTitle').textContent=final?'You got out. For good.':'You got out.';
  $('wonInfo').textContent=['Night '+night+' survived in '+fmt(t)+'.',isBest?(prev?'New best time!':''):'Best: '+fmt(prev)+'.',
    'Notes found: '+save.notes.length+' of '+NOTES.length+'.'].filter(Boolean).join(' ');
  $('wonStory').hidden=!final;
  $('wonStory').textContent='Five nights. The lights upstairs are on now and you are not going back down. Somewhere under the floor, something is clicking. The nights keep going if you want them to.';
  $('next').textContent=night>=LAST_NIGHT?'Night '+(night+1)+' (endless)':'Night '+(night+1);
  $('won').hidden=false; $('next').focus();
}

// =================== UPDATE ===================
function updatePlay(dt){
  t+=dt;
  let vx=0, vy=0;
  if(keys.left) vx-=1; if(keys.right) vx+=1; if(keys.up) vy-=1; if(keys.down) vy+=1;
  if(joy&&joy.mag>0){ vx+=joy.vx; vy+=joy.vy; }
  let mag=Math.hypot(vx,vy); if(mag>1){ vx/=mag; vy/=mag; mag=1; }
  P.moving=mag>0.05;
  // running: fast and loud, and it costs breath
  sprinting=P.moving&&!winded&&stamina>0&&(keys.sprint||(joy&&joy.sprint));
  if(sprinting){ stamina-=32*dt; loudT=0; if(stamina<=0){ stamina=0; winded=true; showMsg('You’re out of breath.'); } }
  else { stamina=Math.min(100,stamina+(P.moving?13:24)*dt); if(winded&&stamina>40) winded=false; }
  loudT+=dt;
  if(P.moving){
    P.face=turnTo(P.face,Math.atan2(vy,vx),9*dt);
    const sp=sprinting?SPRINT:SPEED, mx=vx*sp*dt, my=vy*sp*dt;
    if(!collides(P.x+mx,P.y,PR)) P.x+=mx;
    if(!collides(P.x,P.y+my,PR)) P.y+=my;
    P.step+=mag*dt*10*(sprinting?1.35:1); P.still=0;
    if(P.step-P.lastStep>Math.PI){ P.lastStep=P.step; footstep(sprinting?0.17:0.05+0.05*mag,0); }
  } else P.still+=dt;
  cam.x+=(P.x-cam.x)*Math.min(1,dt*8); cam.y+=(P.y-cam.y)*Math.min(1,dt*8);

  // flashlight: drains only while switched on
  if(lightWanted) battery=Math.max(0,battery-cfg.drain*dt);
  flickT-=dt;
  if(flickT<=0){ flickOff=rand(0.12,0.6); flickT=battery<25?rand(2,5):rand(7,15); if(lightWanted) flashClick(); }
  if(flickOff>0) flickOff-=dt;
  lightOn=lightWanted&&battery>0&&!(flickOff>0&&Math.random()<0.8);
  range=110+125*Math.min(1,battery/30);
  if(battery<20&&!lowBatWarned){ lowBatWarned=true; showMsg('Your light is dying. Find a battery.'); }
  if(battery>40) lowBatWarned=false;

  bulbs.forEach(b=>{ b.t-=dt; b.sw+=dt; if(b.t<=0){ if(b.on){ b.on=false; b.t=Math.random()<0.7?rand(0.05,0.25):rand(2,6); } else { b.on=true; b.t=rand(0.8,7); } } });

  for(let i=items.length-1;i>=0;i--){
    const it=items[i];
    if(Math.hypot(it.x-P.x,it.y-P.y)<20){
      items.splice(i,1);
      const NF=cfg.fuses;
      if(it.k==='fuse'){ fuses++; lastFuseT=t; blip(fuses===NF?660:520); showMsg(fuses===NF?'The stairs have power. Get out.':'Fuse '+fuses+' of '+NF+'.'); }
      else if(it.k==='bat'){ battery=Math.min(100,battery+45); blip(880); showMsg('Fresh battery.'); }
      else { rustle(); if(!save.notes.includes(it.id)){ save.notes.push(it.id); persist(); } showNote(it.id); }
    }
  }
  const [ptx,pty]=tileOf(P);
  if(ptx===exitT[0]&&pty===exitT[1]){
    if(fuses>=cfg.fuses){ getOut(); return; }
    else if(t-lastLockMsg>4){ lastLockMsg=t; showMsg('No power to the stairs yet. '+(cfg.fuses-fuses)+' more fuse'+(cfg.fuses-fuses>1?'s':'')+'.'); }
  }

  // things arrive as you collect fuses
  if(spawnI<cfg.spawn.length&&t-lastSpawnT>5){
    const [kind,need]=cfg.spawn[spawnI];
    if(need===0?t>6:(fuses>=need&&t-lastFuseT>3.5)){ spawnI++; lastSpawnT=t; spawnMonster(kind); }
  }

  // remember what you've seen, for the map
  seenT-=dt;
  if(seenT<=0){
    seenT=0.15;
    for(let dy=-3;dy<=3;dy++) for(let dx=-3;dx<=3;dx++){
      const tx=ptx+dx, ty=pty+dy; if(!isFloor(tx,ty)||seen[idx(tx,ty)]) continue;
      const c=center(tx,ty), near=Math.abs(dx)<=1&&Math.abs(dy)<=1;
      if(near?los(P.x,P.y,c.x,c.y):(inBeam(c.x,c.y)||bulbLit(c.x,c.y))) seen[idx(tx,ty)]=1;
    }
    items.forEach(it=>{ if(!it.known&&(Math.hypot(it.x-P.x,it.y-P.y)<50||inBeam(it.x,it.y))) it.known=true; });
    const ec=center(...exitT);
    if(!exitKnown&&(Math.hypot(ec.x-P.x,ec.y-P.y)<70||inBeam(ec.x,ec.y))){ exitKnown=true; if(fuses<cfg.fuses) showMsg('The stairs. They need power first.'); }
  }

  pathT-=dt; if(pathT<=0){ distMap=bfs(ptx,pty); pathT=0.2; }
  let nearest=1e9, nearestPale=1e9, palePan=0, litClose=false, nearestMoth=1e9, mothPan=0;
  const hearR=loudT<0.8?720:380; // how far away the crawler hears your footsteps
  for(const m of monsters){
    const d=Math.hypot(m.x-P.x,m.y-P.y);
    if(m.kind==='pale'){
      m.lit=inBeam(m.x,m.y)||bulbLit(m.x,m.y);
      m.wob+=dt*(m.lit?28:5);
      if(m.lit&&d<range&&!flags.litPale){ flags.litPale=1; showMsg('It stops when the light is on it.'); }
      if(!m.lit){ chooseChase(m,ptx,pty); stepToward(m,Math.min(108,68+t*0.4+fuses*5)*m.mul*cfg.pace,dt); }
      if(d<nearestPale){ nearestPale=d; palePan=clamp((m.x-P.x)/220,-1,1); }
      if(m.lit&&d<260) litClose=true;
      if(d<19){ die('pale'); return; }
    } else if(m.kind==='moth'){
      // drawn to your flashlight from far off, even through walls; lost when it goes dark
      m.lit=inBeam(m.x,m.y);
      const drawn=lightOn&&d<520;
      if(drawn) chooseChase(m,ptx,pty); else chooseWander(m);
      if(drawn&&!m.drawn&&d<300) flashClick();
      m.drawn=drawn;
      const spd=(drawn?116:58)*cfg.pace;
      stepToward(m,spd,dt); m.flap+=dt*(drawn?30:18);
      if(d<nearestMoth){ nearestMoth=d; mothPan=clamp((m.x-P.x)/220,-1,1); }
      if(d<17){ die('moth'); return; }
    } else {
      const hunting=P.still<0.45&&d<hearR;
      m.lit=inBeam(m.x,m.y);
      if(hunting) chooseChase(m,ptx,pty); else chooseWander(m);
      const spd=(hunting?126:46)*cfg.pace;
      stepToward(m,spd,dt); m.gait+=dt*spd*0.18;
      if(d<360){
        m.clickT-=dt;
        if(m.clickT<=0){
          if(m.burst>0){ m.burst--; m.clickT=rand(.04,.08); } else { m.burst=3+Math.random()*6|0; m.clickT=hunting?rand(.3,.7):rand(.9,1.8); }
          clickAt(clamp((m.x-P.x)/220,-1,1),(1-d/360)*(hunting?0.45:0.25));
        }
      }
      if(d<17){ die('crawler'); return; }
    }
    nearest=Math.min(nearest,d);
  }
  const I=monsters.length?Math.max(0,1-nearest/320):0;
  P.intensity=I; P.litClose=litClose;
  heartT-=dt; if(heartT<=0){ if(I>0.05) thump(0.1+I*0.5); heartT=1.1-0.75*I; }
  setGain(staticGain,litClose?0.05+I*0.22:I*0.02);
  const bpz=nearestPale<240?1-nearestPale/240:0;
  breathPh+=dt*(1.4+bpz*1.6);
  if(breathGain) breathGain.gain.setTargetAtTime(Math.pow(Math.max(0,Math.sin(breathPh)),2)*bpz*0.4,AC.currentTime,0.05);
  if(breathPan) breathPan.pan.setTargetAtTime(palePan,AC.currentTime,0.1);
  if(flutterGain) flutterGain.gain.setTargetAtTime(nearestMoth<320?Math.pow(1-nearestMoth/320,1.5)*0.55:0,AC.currentTime,0.08);
  if(flutterPan) flutterPan.pan.setTargetAtTime(mothPan,AC.currentTime,0.1);

  rats.forEach(r=>{
    const d=Math.hypot(r.x-P.x,r.y-P.y);
    if(d<90&&r.run<=0&&Math.random()<0.12){ r.run=rand(.6,1.2); r.dir=Math.atan2(r.y-P.y,r.x-P.x)+rand(-.6,.6); if(d<75) squeak(clamp((r.x-P.x)/150,-1,1)); }
    if(r.run>0){ r.run-=dt; const nx=r.x+Math.cos(r.dir)*150*dt, ny=r.y+Math.sin(r.dir)*150*dt; if(!collides(nx,ny,3)){ r.x=nx; r.y=ny; } else r.dir+=rand(1.5,3); }
    r.tw+=dt*(r.run>0?30:3);
  });
  if(doll&&!inBeam(doll.x,doll.y)) doll.ang=Math.atan2(P.y-doll.y,P.x-doll.x);

  if(glimpse){ glimpse.t-=dt; if(glimpse.t<=0) glimpse=null; }
  glimT-=dt;
  if(glimT<=0){
    glimT=rand(20,34);
    if(lightOn){
      const a=P.face+(Math.random()<.5?-1:1)*(HALF-0.06), dd=rand(120,Math.max(130,range-30));
      const gx=P.x+Math.cos(a)*dd, gy=P.y+Math.sin(a)*dd;
      if(!collides(gx,gy,8)&&los(P.x,P.y,gx,gy)){ glimpse={x:gx,y:gy,t:0.3,a:Math.atan2(P.y-gy,P.x-gx)}; whisper(clamp((gx-P.x)/200,-1,1),0.9); }
    }
  }
  ambT-=dt; if(ambT<=0){ ambT=rand(5,12); playAmbient(rand(-0.9,0.9)); }
  dust.forEach(p=>{ p.x+=p.vx*dt; p.y+=p.vy*dt; if(Math.hypot(p.x-P.x,p.y-P.y)>260){ const a=rand(0,TAU), r=rand(0,240); p.x=P.x+Math.cos(a)*r; p.y=P.y+Math.sin(a)*r; } });
  if(msgT>0){ msgT-=dt; if(msgT<=0) $('msg').classList.remove('show'); }
  if(noteT>0){ noteT-=dt; if(noteT<=0) $('note').classList.remove('show'); }
  updateHud();
}

function updateScare(dt){
  scare.t+=dt;
  if(scare.t>=(scareOn?1.85:0.9)){
    state='dead';
    const k=scare.kind;
    $('deadTitle').textContent=k==='pale'?'She found you.':k==='moth'?'It followed your light.':'It heard you.';
    $('deadInfo').textContent='Night '+night+'. You found '+fuses+' of '+cfg.fuses+' fuses and lasted '+fmt(t)+'.';
    $('deadTip').textContent=pick(DEATH_TIPS[k]);
    $('dead').hidden=false; $('retry').focus();
  }
}
const DEATH_TIPS={
  pale:['She can’t move while light is on her, from your flashlight or a bulb.','Keep your flashlight pointed at her and back away.','When your battery runs low, she gets bold. Grab batteries when you see them.'],
  crawler:['When you hear clicking, stop moving. It wanders off when it can’t hear you.','Running is loud. It hears running from much farther away.','If you can hear it, it can hear you.'],
  moth:['Switch your flashlight off (F, or the Light button) and it loses you.','It only finds you by your light. In the dark it just drifts, so you can slip past it.','Careful: going dark means nothing keeps her frozen.'],
};

// =================== INTRO ===================
const CAPTIONS=[[1.4,4.2,'11:52 p.m. The power went out again.'],[4.4,7.1,'The fuse box is down in the basement.'],[7.3,9.9,'The door at the bottom is open. Nobody ever leaves it open.'],[11.5,12.5,'Find the fuses. Get out.']];
let intro=null, introStains=[];
function startIntro(){
  ensureFaces();
  intro={t:0,next:1.35,ev:{}};
  introStains=[]; for(let i=0;i<14;i++) introStains.push({s:Math.random()<.5?-1:1,z:rand(1,8),h:rand(.15,.8),len:rand(.05,.3)});
  state='intro'; hideOverlays(); $('skip').hidden=false; setGain(roomGain,0.05);
}
function updateIntro(dt){
  const I=intro; I.t+=dt; const tt=I.t;
  const once=(k,at,fn)=>{ if(tt>=at&&!I.ev[k]){ I.ev[k]=1; fn(); } };
  once('click',0.8,flashClick);
  if(tt>=I.next&&tt<9.5){ I.next+=0.62; footstep(0.16,0); if(Math.random()<0.55) creak(rand(-0.4,0.4),0.07); }
  once('drip',3.1,()=>drip(-0.5));
  once('knock',5.4,()=>knock(0.55));
  once('whisper',9.6,()=>whisper(0,0.8));
  once('f1',10.0,flashClick);
  once('sting',10.33,sting);
  once('f2',10.9,flashClick);
  once('slam',12.6,slam);
  if(tt>=13.3) beginPlay();
}
function introLight(tt){
  if(tt<1.0||tt>=12.6) return false;
  if((tt>10.0&&tt<10.12)||(tt>10.2&&tt<10.33)||(tt>10.9&&tt<11.25)) return false;
  return true;
}
function stairGeo(vx,vy){
  const K=H*0.6, Wd=Math.min(W*0.55,H*0.42), zf=10, wallH=Wd*1.9;
  const Y=z=>vy+K/z, X=z=>Wd/z, top=z=>Y(z)-wallH/z;
  const bw=X(zf)*2, bt=top(zf), bh=Y(zf)-bt, doorW=bw*0.4, doorH=bh*0.8;
  return {K,Wd,zf,wallH,Y,X,top,vx,vy,backTop:bt,backH:bh,doorW,doorH,doorX:vx-doorW/2,doorY:Y(zf)-doorH};
}
function quad(a,b,c,d){ ctx.beginPath(); ctx.moveTo(a[0],a[1]); ctx.lineTo(b[0],b[1]); ctx.lineTo(c[0],c[1]); ctx.lineTo(d[0],d[1]); ctx.closePath(); ctx.fill(); }
function drawStairScene(G,frac,tt){
  const {Y,X,top,vx,zf,wallH}=G, zn=0.45;
  ctx.fillStyle='#0C0A08'; quad([vx-X(zn),Y(zn)],[vx+X(zn),Y(zn)],[vx+X(zf),Y(zf)],[vx-X(zf),Y(zf)]);
  for(const s of [-1,1]){
    const gr=ctx.createLinearGradient(vx+s*X(1),0,vx+s*X(zf),0); gr.addColorStop(0,'#2B251F'); gr.addColorStop(1,'#0D0B09');
    ctx.fillStyle=gr; quad([vx+s*X(zn),top(zn)],[vx+s*X(zf),top(zf)],[vx+s*X(zf),Y(zf)],[vx+s*X(zn),Y(zn)]);
    ctx.strokeStyle='rgba(0,0,0,.45)'; ctx.lineWidth=1;
    for(let h=0.08;h<1;h+=0.085){ ctx.beginPath(); ctx.moveTo(vx+s*X(zn),Y(zn)-wallH*h/zn); ctx.lineTo(vx+s*X(zf),Y(zf)-wallH*h/zf); ctx.stroke(); }
    for(let z=0.8;z<zf;z*=1.18){ ctx.beginPath(); ctx.moveTo(vx+s*X(z),Y(z)); ctx.lineTo(vx+s*X(z),top(z)); ctx.stroke(); }
  }
  introStains.forEach(st=>{
    const x=vx+st.s*X(st.z), y=Y(st.z)-wallH*st.h/st.z;
    ctx.strokeStyle='rgba(8,5,3,.55)'; ctx.lineWidth=Math.max(1,6/st.z);
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x,y+wallH*st.len/st.z); ctx.stroke();
  });
  ctx.fillStyle='#14110E'; ctx.fillRect(vx-X(zf),G.backTop,2*X(zf),G.backH);
  ctx.fillStyle='#000'; ctx.fillRect(G.doorX,G.doorY,G.doorW,G.doorH);
  if(tt>10.33&&tt<10.9&&faces.pale){
    const f=faces.pale, fh=G.doorH*0.62, fw=fh*f.w/f.h;
    ctx.globalAlpha=0.8; ctx.drawImage(f.base,vx-fw/2,G.doorY+G.doorH*0.06,fw,fh); ctx.globalAlpha=1;
  }
  ctx.fillStyle='#2A221B'; quad([G.doorX,G.doorY],[G.doorX+G.doorW*0.3,G.doorY+G.doorH*0.05],[G.doorX+G.doorW*0.3,G.doorY+G.doorH*0.97],[G.doorX,G.doorY+G.doorH]);
  ctx.strokeStyle='#3B3129'; ctx.lineWidth=2; ctx.strokeRect(G.doorX-1,G.doorY-1,G.doorW+2,G.doorH+1);
  const fs=Math.max(5,G.backH*0.1);
  ctx.font='italic '+fs+'px "IM Fell English", Georgia, serif'; ctx.fillStyle='rgba(120,14,10,.85)'; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText('DON’T COME DOWN',vx,(G.backTop+G.doorY)/2,X(zf)*1.9);
  hand(ctx,G.doorX+G.doorW+X(zf)*0.25,G.doorY+G.doorH*0.4,0.2,G.backH/70,6);
  for(let k=30;k>=0;k--){
    const z0=zn+(k-frac)*0.4; if(z0>zf-0.6) continue;
    const za=Math.max(z0,0.3), z1=z0+0.4*0.78; if(z1<=0.3) continue;
    const fog=clamp(1-(z0-zn)/(zf-zn),0,1), v=Math.round(16+fog*fog*40);
    ctx.fillStyle='rgb('+(v+9)+','+(v+5)+','+v+')';
    quad([vx-X(za),Y(za)],[vx+X(za),Y(za)],[vx+X(z1),Y(z1)],[vx-X(z1),Y(z1)]);
    ctx.strokeStyle='rgba(255,235,210,'+(0.1*fog).toFixed(3)+')'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(vx-X(za),Y(za)); ctx.lineTo(vx+X(za),Y(za)); ctx.stroke();
  }
}
function wrapText(txt,x,y,maxW,lh){
  const words=txt.split(' '), lines=[]; let line='';
  words.forEach(w=>{ const test=line?line+' '+w:w; if(ctx.measureText(test).width>maxW&&line){ lines.push(line); line=w; } else line=test; });
  if(line) lines.push(line);
  const y0=y-(lines.length-1)*lh/2; lines.forEach((l,i)=>ctx.fillText(l,x,y0+i*lh));
}
function drawIntro(){
  const tt=intro.t;
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
  ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
  if(tt>=1.0&&tt<12.6){
    const desc=clamp((tt-1)/8.5,0,1), stepsDone=(Math.min(tt,9.5)-1)*1.62;
    const bob=(!reduce&&tt<9.5)?Math.abs(Math.sin(stepsDone*Math.PI))*H*0.012:0;
    const vx=W/2, vy=H*0.33+bob, z=1+desc*desc*(3-2*desc)*0.3;
    const G=stairGeo(vx,vy);
    ctx.save(); ctx.translate(vx,vy); ctx.scale(z,z); ctx.translate(-vx,-vy);
    drawStairScene(G,stepsDone%1,tt);
    ctx.restore();
    let sx=vx+Math.sin(tt*1.3)*W*0.06, sy=vy+H*0.3+Math.sin(tt*2.1)*H*0.02;
    const dcy=vy+(G.doorY+G.doorH*0.5-vy)*z;
    if(tt>9.5){ const k=clamp((tt-9.5)/0.6,0,1); sx+=(vx-sx)*k; sy+=(dcy-sy)*k; }
    dctx.setTransform(1,0,0,1,0,0); dctx.globalCompositeOperation='source-over';
    dctx.clearRect(0,0,dark.width,dark.height); dctx.fillStyle='rgba(0,0,0,.985)'; dctx.fillRect(0,0,dark.width,dark.height);
    if(introLight(tt)){
      dctx.setTransform(dpr,0,0,dpr,0,0); dctx.globalCompositeOperation='destination-out';
      const R=Math.min(W,H)*0.55, gr=dctx.createRadialGradient(sx,sy,0,sx,sy,R);
      gr.addColorStop(0,'rgba(0,0,0,1)'); gr.addColorStop(.5,'rgba(0,0,0,.85)'); gr.addColorStop(1,'rgba(0,0,0,0)');
      dctx.fillStyle=gr; dctx.fillRect(0,0,W,H); dctx.globalCompositeOperation='source-over';
    }
    ctx.setTransform(1,0,0,1,0,0); ctx.drawImage(dark,0,0); ctx.setTransform(dpr,0,0,dpr,0,0);
    if(tt>10.9&&tt<11.25){
      const ey=vy+(G.doorY+G.doorH*0.3-vy)*z, sp=G.doorW*z*0.09;
      ctx.save(); ctx.fillStyle='#F2EDDF'; ctx.shadowColor='#fff'; ctx.shadowBlur=8;
      ctx.beginPath(); ctx.arc(vx-sp,ey,1.6,0,TAU); ctx.fill(); ctx.beginPath(); ctx.arc(vx+sp,ey,1.6,0,TAU); ctx.fill(); ctx.restore();
    }
  }
  const fs=clamp(W*0.052,17,28);
  ctx.font='italic '+fs+'px "IM Fell English", Georgia, serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#DCD2BE';
  CAPTIONS.forEach(([a,b,txt])=>{ if(tt<a||tt>b) return; ctx.globalAlpha=clamp(Math.min((tt-a)/0.4,(b-tt)/0.4),0,1); wrapText(txt,W/2,H*0.85,W*0.86,fs*1.3); });
  ctx.globalAlpha=1;
  screenFx(0,false);
}

// =================== DRAW: GAME ===================
function worldT(c){ c.setTransform(dpr*zoom,0,0,dpr*zoom,dpr*(W/2-cam.x*zoom),dpr*(H/2-cam.y*zoom)); }
function drawItem(it){
  ctx.save(); ctx.translate(it.x,it.y);
  ctx.fillStyle='rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(1.5,2,8,4,0,0,TAU); ctx.fill();
  if(it.k==='fuse'){
    ctx.rotate(0.6);
    ctx.fillStyle='rgba(226,170,90,.85)'; ctx.fillRect(-3,-7,6,14);
    ctx.strokeStyle='#3A2A15'; ctx.lineWidth=.7; ctx.beginPath(); ctx.moveTo(0,-7); ctx.lineTo(0.8,-2); ctx.lineTo(-0.8,2); ctx.lineTo(0,7); ctx.stroke();
    ctx.fillStyle='#A9A49A'; ctx.fillRect(-3.6,-9.5,7.2,3); ctx.fillRect(-3.6,6.5,7.2,3);
    ctx.fillStyle='rgba(255,255,255,.35)'; ctx.fillRect(-2.2,-6,1,12);
  } else if(it.k==='note'){
    ctx.rotate(it.ph);
    ctx.fillStyle='#BFB396'; ctx.fillRect(-6,-7.5,12,15);
    ctx.fillStyle='rgba(0,0,0,.18)'; ctx.beginPath(); ctx.moveTo(6,4.5); ctx.lineTo(3,7.5); ctx.lineTo(6,7.5); ctx.fill();
    ctx.strokeStyle='rgba(50,35,25,.55)'; ctx.lineWidth=.6;
    for(let y=-5;y<=4;y+=2.2){ ctx.beginPath(); ctx.moveTo(-4.5,y); ctx.lineTo(4.5-(y>2?3:0),y); ctx.stroke(); }
  } else {
    ctx.rotate(-0.4);
    ctx.fillStyle='#1E2A22'; ctx.fillRect(-8,-3.5,15,7);
    ctx.fillStyle='#B5832A'; ctx.fillRect(-2,-3.5,4,7);
    ctx.fillStyle='#C07A3A'; ctx.fillRect(7,-3.5,2,7); ctx.fillStyle='#999'; ctx.fillRect(9,-1.5,1.6,3);
  }
  ctx.restore();
}
function drawDoll(){
  ctx.save(); ctx.translate(doll.x,doll.y);
  ctx.fillStyle='rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(1,1.5,6,5,0,0,TAU); ctx.fill();
  ctx.fillStyle='#5B4A55'; ctx.beginPath(); ctx.ellipse(-1,0,4.5,5.5,0,0,TAU); ctx.fill();
  ctx.strokeStyle='#CFC3AE'; ctx.lineWidth=1.3; ctx.beginPath(); ctx.moveTo(-1,-4); ctx.lineTo(-4,-7); ctx.moveTo(-1,4); ctx.lineTo(-3,7.5); ctx.stroke();
  ctx.rotate(doll.ang);
  ctx.fillStyle='#3A2A22'; ctx.beginPath(); ctx.arc(1,0,4,Math.PI*0.5,Math.PI*1.5); ctx.fill();
  ctx.fillStyle='#D9CDB9'; ctx.beginPath(); ctx.arc(2,0,3.3,0,TAU); ctx.fill();
  ctx.fillStyle='#000'; ctx.beginPath(); ctx.arc(4,-1.2,.65,0,TAU); ctx.fill();
  ctx.strokeStyle='#000'; ctx.lineWidth=.5; ctx.beginPath(); ctx.moveTo(3.4,.6); ctx.lineTo(4.6,1.8); ctx.moveTo(4.6,.6); ctx.lineTo(3.4,1.8); ctx.stroke();
  ctx.restore();
}
function drawRat(r){
  ctx.save(); ctx.translate(r.x,r.y); ctx.rotate(r.dir);
  ctx.strokeStyle='#6B5F57'; ctx.lineWidth=.8; ctx.beginPath(); ctx.moveTo(-4,0); ctx.quadraticCurveTo(-8,Math.sin(r.tw)*3,-12,Math.sin(r.tw+1)*2); ctx.stroke();
  ctx.fillStyle='#4A433C'; ctx.beginPath(); ctx.ellipse(0,0,4.6,2.5,0,0,TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(4.4,0,2.3,1.6,0,0,TAU); ctx.fill();
  ctx.fillStyle='#B33'; ctx.fillRect(5,-1,.6,.6); ctx.fillRect(5,.4,.6,.6);
  ctx.restore();
}
function drawPale(m,silhouette){
  const ang=Math.atan2(P.y-m.y,P.x-m.x), j=m.lit?(Math.random()-.5)*2.4:0;
  ctx.save(); ctx.translate(m.x+j,m.y-j*0.5);
  ctx.fillStyle='rgba(0,0,0,.5)'; ctx.beginPath(); ctx.ellipse(1.5,2,15,13,0,0,TAU); ctx.fill();
  ctx.rotate(ang);
  ctx.fillStyle=silhouette?'#050404':'#24201D'; ctx.beginPath(); ctx.ellipse(-4,0,8,11.5,0,0,TAU); ctx.fill();
  const reach=m.lit?3:5+Math.sin(m.wob*0.7)*2.5;
  ctx.strokeStyle=silhouette?'#080606':'#BDB5A1'; ctx.lineCap='round';
  [[-1,-8.5],[-1,8.5]].forEach(([ax,ay],i)=>{
    const hx=10+reach+(i?Math.sin(m.wob):Math.cos(m.wob))*1.5, hy=ay*0.55;
    ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(ax,ay); ctx.quadraticCurveTo(ax+6,ay*1.05,hx,hy); ctx.stroke();
    ctx.lineWidth=0.8; for(let f=-1;f<=1;f++){ ctx.beginPath(); ctx.moveTo(hx,hy); ctx.lineTo(hx+5,hy+f*1.8+ay*0.08); ctx.stroke(); }
  });
  ctx.strokeStyle='#060505'; ctx.lineWidth=1.2;
  for(let i=0;i<26;i++){ const a=Math.PI+(i/25-0.5)*2.6, len=14+(i*37%7)+Math.sin(m.wob*0.6+i)*1.5; ctx.beginPath(); ctx.moveTo(2,0); ctx.lineTo(2+Math.cos(a)*len,Math.sin(a)*len); ctx.stroke(); }
  if(!silhouette){
    ctx.fillStyle='#D3CBB8'; ctx.beginPath(); ctx.ellipse(3,0,5.5,6.2,0,0,TAU); ctx.fill();
    ctx.fillStyle='#070606'; ctx.beginPath(); ctx.ellipse(1,0,5.2,6.6,0,Math.PI*0.5,Math.PI*1.5); ctx.fill();
    ctx.fillStyle='#000';
    ctx.beginPath(); ctx.ellipse(6,-2.2,1.5,1.1,0,0,TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(6,2.2,1.5,1.1,0,0,TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8,0,0.9,2.2,0,0,TAU); ctx.fill();
  } else { ctx.fillStyle='#050404'; ctx.beginPath(); ctx.arc(2,0,6,0,TAU); ctx.fill(); }
  ctx.restore();
}
function drawCrawler(m){
  ctx.save(); ctx.translate(m.x,m.y);
  ctx.fillStyle='rgba(0,0,0,.5)'; ctx.beginPath(); ctx.ellipse(1.5,2,17,14,0,0,TAU); ctx.fill();
  ctx.rotate(m.dir); ctx.lineCap='round'; ctx.strokeStyle='#9C9581';
  for(let i=0;i<3;i++) for(const s of [-1,1]){
    const sw=Math.sin(m.gait+i*2.1+(s>0?Math.PI:0))*4, hx=5-i*5, hy=s*3, kx=hx+3+sw, ky=s*11, fx=hx+7+sw*1.5, fy=s*17;
    ctx.lineWidth=1.7; ctx.beginPath(); ctx.moveTo(hx,hy); ctx.lineTo(kx,ky); ctx.stroke();
    ctx.lineWidth=1.1; ctx.beginPath(); ctx.moveTo(kx,ky); ctx.lineTo(fx,fy); ctx.stroke();
  }
  const bg=ctx.createLinearGradient(0,-5,0,5); bg.addColorStop(0,'#8F8875'); bg.addColorStop(.5,'#CBC4AF'); bg.addColorStop(1,'#8F8875');
  ctx.fillStyle=bg; ctx.beginPath(); ctx.ellipse(-1,0,11,5,0,0,TAU); ctx.fill();
  ctx.strokeStyle='rgba(60,50,40,.6)'; ctx.lineWidth=.8; ctx.beginPath(); ctx.moveTo(-10,0); ctx.lineTo(8,0); ctx.stroke();
  for(let k=-8;k<=6;k+=3.5){ ctx.beginPath(); ctx.moveTo(k,-3.5); ctx.lineTo(k+1,0); ctx.lineTo(k,3.5); ctx.stroke(); }
  ctx.fillStyle='#CEC7B2'; ctx.beginPath(); ctx.ellipse(11,0,5,4,0,0,TAU); ctx.fill();
  ctx.fillStyle='#2A0000';
  [[13,-1.4],[13,1.4],[14.6,-2.6],[14.6,2.6],[11.8,-2.8],[11.8,2.8]].forEach(([a,b])=>{ ctx.beginPath(); ctx.arc(a,b,.75,0,TAU); ctx.fill(); });
  ctx.strokeStyle='#2B241C'; ctx.lineWidth=.9; ctx.beginPath(); ctx.moveTo(15,-1.5); ctx.lineTo(18.5,-0.4); ctx.moveTo(15,1.5); ctx.lineTo(18.5,0.4); ctx.stroke();
  ctx.restore();
}
function drawMoth(m){
  const open=0.35+0.65*Math.abs(Math.sin(m.flap));
  ctx.save(); ctx.translate(m.x+Math.sin(m.flap*0.21)*2.5,m.y+Math.cos(m.flap*0.17)*2.5);
  ctx.fillStyle='rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(2,4,13,10,0,0,TAU); ctx.fill();
  ctx.rotate(m.dir);
  for(const s of [-1,1]){
    ctx.save(); ctx.scale(1,s*open);
    ctx.fillStyle='#6E6556'; ctx.beginPath(); ctx.moveTo(3,1); ctx.quadraticCurveTo(12,9,5,19); ctx.quadraticCurveTo(-5,16,-3,1.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#544C40'; ctx.beginPath(); ctx.moveTo(-2,1); ctx.quadraticCurveTo(-6,14,-13,11); ctx.quadraticCurveTo(-12,4,-6,1); ctx.closePath(); ctx.fill();
    ctx.strokeStyle='rgba(30,25,20,.6)'; ctx.lineWidth=.5; ctx.beginPath(); ctx.moveTo(2,2); ctx.lineTo(4,16); ctx.moveTo(0,2); ctx.lineTo(-2,14); ctx.stroke();
    ctx.fillStyle='#17120F'; ctx.beginPath(); ctx.arc(3,10,2.8,0,TAU); ctx.fill();
    ctx.fillStyle='#B8A27A'; ctx.beginPath(); ctx.arc(3.5,9.5,1,0,TAU); ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle='#3B342C'; ctx.beginPath(); ctx.ellipse(-2,0,8.5,3.2,0,0,TAU); ctx.fill();
  ctx.strokeStyle='rgba(20,16,12,.7)'; ctx.lineWidth=.6; for(let k=-8;k<=2;k+=2.5){ ctx.beginPath(); ctx.moveTo(k,-2.8); ctx.lineTo(k,2.8); ctx.stroke(); }
  ctx.fillStyle='#4A4238'; ctx.beginPath(); ctx.arc(6.5,0,3.1,0,TAU); ctx.fill();
  ctx.strokeStyle='#8A7F6A'; ctx.lineWidth=.7;
  ctx.beginPath(); ctx.moveTo(8.5,-1.2); ctx.quadraticCurveTo(12,-3,15,-7); ctx.moveTo(8.5,1.2); ctx.quadraticCurveTo(12,3,15,7); ctx.stroke();
  ctx.fillStyle='#6A120B'; ctx.beginPath(); ctx.arc(8.2,-1.7,1.2,0,TAU); ctx.fill(); ctx.beginPath(); ctx.arc(8.2,1.7,1.2,0,TAU); ctx.fill();
  ctx.restore();
}
function drawPlayer(){
  const sw=P.moving?Math.sin(P.step):0, br=P.moving?0:Math.sin(performance.now()/600)*0.3;
  ctx.save(); ctx.translate(P.x,P.y);
  ctx.fillStyle='rgba(0,0,0,.45)'; ctx.beginPath(); ctx.ellipse(1,2,12,10,0,0,TAU); ctx.fill();
  ctx.rotate(P.face);
  ctx.fillStyle='#17130F';
  ctx.beginPath(); ctx.ellipse(sw*5,-4.3,4,2.5,0,0,TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-sw*5,4.3,4,2.5,0,0,TAU); ctx.fill();
  const tg=ctx.createLinearGradient(-7,0,7,0); tg.addColorStop(0,'#2C352E'); tg.addColorStop(1,'#4A574B');
  ctx.fillStyle=tg; ctx.beginPath(); ctx.ellipse(0,0,6.6+br,10.4+br,0,0,TAU); ctx.fill();
  ctx.strokeStyle='#2E3830'; ctx.lineWidth=3.1; ctx.lineCap='round';
  ctx.beginPath(); ctx.moveTo(1,-8); ctx.lineTo(9.5,-2.4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(1,8); ctx.lineTo(9.5,2.4); ctx.stroke();
  ctx.fillStyle='#C6A688'; ctx.beginPath(); ctx.arc(10,-2,1.8,0,TAU); ctx.fill(); ctx.beginPath(); ctx.arc(10,2,1.8,0,TAU); ctx.fill();
  ctx.fillStyle='#29292B'; ctx.fillRect(9.5,-1.6,7.5,3.2);
  ctx.fillStyle=lightOn?'#FFE2A8':'#4A4A48'; ctx.fillRect(16.6,-2.1,1.6,4.2);
  ctx.strokeStyle='#25302A'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(-0.5,0,6.6,Math.PI*0.5,Math.PI*1.5); ctx.stroke();
  ctx.fillStyle='#C6A688'; ctx.beginPath(); ctx.arc(0.8,0,5.1,0,TAU); ctx.fill();
  ctx.fillStyle='#2B1E16'; ctx.beginPath(); ctx.arc(0,0,5.5,Math.PI*0.42,Math.PI*1.58); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(1.5,0,2.4,3.8,0,0,TAU); ctx.fill();
  ctx.restore();
}
function drawDarkness(poly){
  dctx.setTransform(1,0,0,1,0,0); dctx.globalCompositeOperation='source-over';
  dctx.clearRect(0,0,dark.width,dark.height);
  dctx.fillStyle='rgba(2,1,1,0.988)'; dctx.fillRect(0,0,dark.width,dark.height);
  worldT(dctx); dctx.globalCompositeOperation='destination-out';
  const pg=dctx.createRadialGradient(P.x,P.y,0,P.x,P.y,60); pg.addColorStop(0,'rgba(0,0,0,.8)'); pg.addColorStop(1,'rgba(0,0,0,0)');
  dctx.fillStyle=pg; dctx.beginPath(); dctx.arc(P.x,P.y,60,0,TAU); dctx.fill();
  bulbs.forEach(b=>{
    if(!b.on) return;
    const a=0.6*rand(0.85,1), gr=dctx.createRadialGradient(b.x,b.y,0,b.x,b.y,b.r);
    gr.addColorStop(0,'rgba(0,0,0,'+a.toFixed(3)+')'); gr.addColorStop(1,'rgba(0,0,0,0)');
    dctx.fillStyle=gr; polyPath(dctx,b.poly); dctx.fill();
  });
  if(fuses>=cfg.fuses){
    const c=center(...exitT), gr=dctx.createRadialGradient(c.x,c.y,0,c.x,c.y,90);
    gr.addColorStop(0,'rgba(0,0,0,.55)'); gr.addColorStop(1,'rgba(0,0,0,0)'); dctx.fillStyle=gr; polyPath(dctx,stairPoly); dctx.fill();
  }
  if(poly){
    const g2=dctx.createRadialGradient(P.x,P.y,8,P.x,P.y,range);
    g2.addColorStop(0,'rgba(0,0,0,1)'); g2.addColorStop(0.55,'rgba(0,0,0,0.9)'); g2.addColorStop(1,'rgba(0,0,0,0)');
    dctx.fillStyle=g2; polyPath(dctx,poly); dctx.fill();
  }
  dctx.globalCompositeOperation='source-over';
}
function grain(n,a){ ctx.fillStyle='#DCD2BE'; ctx.globalAlpha=a; for(let i=0;i<n;i++) ctx.fillRect(Math.random()*W,Math.random()*H,1.4,1.4); ctx.globalAlpha=1; }
function screenFx(I,lit){
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.globalCompositeOperation='source-over';
  const v=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.3,W/2,H/2,Math.max(W,H)*0.75);
  v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(1,'rgba(0,0,0,.65)'); ctx.fillStyle=v; ctx.fillRect(0,0,W,H);
  if(I>0){
    const r=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.25,W/2,H/2,Math.max(W,H)*0.7);
    r.addColorStop(0,'rgba(90,0,0,0)'); r.addColorStop(1,'rgba(90,0,0,'+(I*0.55).toFixed(3)+')'); ctx.fillStyle=r; ctx.fillRect(0,0,W,H);
  }
  grain(70+I*260,0.05+I*(lit?0.28:0.1));
  if(!reduce&&lit&&I>0.35&&Math.random()<0.22){
    ctx.setTransform(1,0,0,1,0,0);
    for(let k=0;k<2;k++){
      const sy=Math.random()*cv.height*0.9, sh=Math.min(cv.height-sy,(8+Math.random()*36)*dpr);
      if(sh>1) ctx.drawImage(cv,0,sy,cv.width,sh,(Math.random()-.5)*36*dpr,sy,cv.width,sh);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
}
function drawPlay(){
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
  ctx.fillStyle='#020101'; ctx.fillRect(0,0,W,H);
  worldT(ctx);
  const hw=W/2/zoom+T, hh=H/2/zoom+T;
  const sx=clamp(cam.x-hw,0,COLS*T), sy=clamp(cam.y-hh,0,ROWS*T), ex=clamp(cam.x+hw,0,COLS*T), ey=clamp(cam.y+hh,0,ROWS*T);
  if(ex>sx&&ey>sy) ctx.drawImage(mapC,sx*MS,sy*MS,(ex-sx)*MS,(ey-sy)*MS,sx,sy,ex-sx,ey-sy);
  items.forEach(drawItem);
  if(doll) drawDoll();
  rats.forEach(drawRat);
  bulbs.forEach(b=>{ if(!b.on){ ctx.fillStyle='#5E594E'; ctx.beginPath(); ctx.arc(b.x+Math.sin(b.sw*1.3)*2.5,b.y,2.4,0,TAU); ctx.fill(); } });
  if(glimpse) drawPale({x:glimpse.x,y:glimpse.y,lit:false,wob:0},true);
  monsters.forEach(m=>m.kind==='pale'?drawPale(m,false):m.kind==='moth'?drawMoth(m):drawCrawler(m));
  drawPlayer();
  const poly=lightOn?rayPoly(P.x,P.y,range,P.face-HALF,P.face+HALF,44,true):null;
  ctx.fillStyle='rgba(255,205,140,.05)'; bulbs.forEach(b=>{ if(b.on){ polyPath(ctx,b.poly); ctx.fill(); } });
  if(poly){ ctx.fillStyle='rgba(255,196,120,0.1)'; polyPath(ctx,poly); ctx.fill(); }
  drawDarkness(poly);
  ctx.setTransform(1,0,0,1,0,0); ctx.drawImage(dark,0,0);
  worldT(ctx);
  const now=performance.now()/1000;
  items.forEach(it=>{ const d=Math.hypot(it.x-P.x,it.y-P.y); if(d>240) return; ctx.globalAlpha=(0.14+0.14*Math.sin(now*3+it.ph))*(1-d/240); ctx.fillStyle=it.k==='fuse'?'#E2A247':it.k==='note'?'#EDE6D2':'#86C08C'; ctx.beginPath(); ctx.arc(it.x,it.y,2.6,0,TAU); ctx.fill(); });
  const powered=fuses>=cfg.fuses, ec=center(...exitT), lx=ec.x-exitDir[1]*15, ly=ec.y+exitDir[0]*15, de=Math.hypot(lx-P.x,ly-P.y);
  if(de<340){ ctx.globalAlpha=(powered?1:(Math.sin(now*4)>0?0.9:0.3))*(1-de/340); ctx.fillStyle=powered?'#73D98F':'#D23A2C'; ctx.beginPath(); ctx.arc(lx,ly,2.4,0,TAU); ctx.fill(); }
  ctx.globalAlpha=1; ctx.globalCompositeOperation='lighter';
  bulbs.forEach(b=>{ if(!b.on) return; const bx=b.x+Math.sin(b.sw*1.3)*2.5, gr=ctx.createRadialGradient(bx,b.y,0,bx,b.y,16); gr.addColorStop(0,'rgba(255,225,160,.45)'); gr.addColorStop(1,'rgba(255,225,160,0)'); ctx.fillStyle=gr; ctx.beginPath(); ctx.arc(bx,b.y,16,0,TAU); ctx.fill(); ctx.fillStyle='#FFF4D6'; ctx.beginPath(); ctx.arc(bx,b.y,2.2,0,TAU); ctx.fill(); });
  ctx.globalCompositeOperation='source-over';
  monsters.forEach(m=>{
    if(m.lit) return; const d=Math.hypot(m.x-P.x,m.y-P.y);
    if(m.kind==='pale'&&d<300){
      const a=Math.atan2(P.y-m.y,P.x-m.x), fx=Math.cos(a), fy=Math.sin(a), px=-fy*2.2, py=fx*2.2, hx=m.x+fx*6, hy=m.y+fy*6, al=(1-d/300);
      ctx.globalAlpha=al*0.18; ctx.fillStyle='#EDE5D0'; ctx.beginPath(); ctx.arc(hx,hy,5,0,TAU); ctx.fill();
      ctx.globalAlpha=al*0.95; ctx.beginPath(); ctx.arc(hx+px,hy+py,1.2,0,TAU); ctx.fill(); ctx.beginPath(); ctx.arc(hx-px,hy-py,1.2,0,TAU); ctx.fill();
    } else if(m.kind==='crawler'&&d<180){
      ctx.globalAlpha=(1-d/180)*0.75; ctx.fillStyle='#C2301F';
      const hx=m.x+Math.cos(m.dir)*13, hy=m.y+Math.sin(m.dir)*13, px=-Math.sin(m.dir), py=Math.cos(m.dir);
      [-2.6,-1.3,1.3,2.6].forEach(o=>{ ctx.beginPath(); ctx.arc(hx+px*o,hy+py*o,.7,0,TAU); ctx.fill(); });
    } else if(m.kind==='moth'&&d<260){
      const hx=m.x+Math.cos(m.dir)*8, hy=m.y+Math.sin(m.dir)*8, px=-Math.sin(m.dir)*1.8, py=Math.cos(m.dir)*1.8;
      ctx.globalAlpha=(1-d/260)*(m.drawn?0.9:0.5); ctx.fillStyle='#E0662E';
      ctx.beginPath(); ctx.arc(hx+px,hy+py,1,0,TAU); ctx.fill(); ctx.beginPath(); ctx.arc(hx-px,hy-py,1,0,TAU); ctx.fill();
    }
  });
  if(lightOn){
    ctx.fillStyle='#FFE9C4';
    dust.forEach(p=>{ const dx=p.x-P.x, dy=p.y-P.y, d=Math.hypot(dx,dy); if(d>range||d<10||wallAt(p.x,p.y)) return; if(Math.abs(angDiff(Math.atan2(dy,dx),P.face))>HALF) return; ctx.globalAlpha=(1-d/range)*0.45; ctx.beginPath(); ctx.arc(p.x,p.y,.7,0,TAU); ctx.fill(); });
  }
  ctx.globalAlpha=1;
  screenFx(P.intensity||0,P.litClose);
  if(joy){
    ctx.strokeStyle='rgba(220,210,190,.18)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(joy.ox,joy.oy,44,0,TAU); ctx.stroke();
    ctx.setLineDash([4,6]); ctx.strokeStyle=joy.sprint?'rgba(157,180,166,.45)':'rgba(220,210,190,.1)';
    ctx.beginPath(); ctx.arc(joy.ox,joy.oy,RUN_R,0,TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle='rgba(220,210,190,.18)'; ctx.beginPath(); ctx.arc(joy.ox+joy.vx*joy.reach,joy.oy+joy.vy*joy.reach,16,0,TAU); ctx.fill();
  }
  if(t<3.5&&state==='play'){
    ctx.globalAlpha=clamp(Math.min(t/0.6,(3.5-t)/0.8),0,1)*0.9;
    ctx.font='italic '+clamp(W*0.09,30,58)+'px "IM Fell English", Georgia, serif';
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#DCD2BE';
    ctx.fillText('Night '+night,W/2,H*0.3);
    ctx.globalAlpha=1;
  }
  if(mapOpen) drawMap();
}
// The map only shows what you have seen with your own light.
function drawMap(){
  const pad=24, cs=Math.floor(Math.min((W-pad*2)/COLS,(H-140)/ROWS)), mw=cs*COLS, mh=cs*ROWS;
  const ox=Math.round((W-mw)/2), oy=Math.round((H-mh)/2)+14;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle='rgba(30,24,18,.9)'; ctx.fillRect(ox-12,oy-40,mw+24,mh+52);
  ctx.strokeStyle='rgba(220,210,190,.25)'; ctx.lineWidth=1; ctx.strokeRect(ox-12.5,oy-40.5,mw+25,mh+53);
  ctx.font='italic 16px "IM Fell English", Georgia, serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillStyle='#A99C84';
  ctx.fillText('What you remember  ·  fuses '+fuses+' of '+cfg.fuses,W/2,oy-20);
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){
    if(!seen[idx(x,y)]) continue;
    ctx.fillStyle='rgba(205,190,160,.42)'; ctx.fillRect(ox+x*cs,oy+y*cs,cs,cs);
  }
  ctx.fillStyle='rgba(15,11,8,.95)';
  for(let y=0;y<ROWS;y++) for(let x=0;x<COLS;x++){
    if(isFloor(x,y)) continue;
    if(DIRS.some(([dx,dy])=>isFloor(x+dx,y+dy)&&seen[idx(x+dx,y+dy)])) ctx.fillRect(ox+x*cs,oy+y*cs,cs,cs);
  }
  const dot=(wx,wy,col,r)=>{ ctx.fillStyle=col; ctx.beginPath(); ctx.arc(ox+wx/T*cs,oy+wy/T*cs,r,0,TAU); ctx.fill(); };
  if(exitKnown){
    const ec=center(...exitT); dot(ec.x,ec.y,fuses>=cfg.fuses?'#73D98F':'#D23A2C',Math.max(3,cs*0.32));
    ctx.font='italic 12px "IM Fell English", Georgia, serif'; ctx.fillStyle='#CFC3A6'; ctx.fillText('stairs',ox+ec.x/T*cs,oy+ec.y/T*cs-cs*0.7);
  }
  items.forEach(it=>{ if(it.known) dot(it.x,it.y,it.k==='fuse'?'#E2A247':it.k==='note'?'#EDE6D2':'#86C08C',Math.max(2,cs*0.22)); });
  const pulse=0.6+0.4*Math.sin(performance.now()/180);
  ctx.globalAlpha=pulse; dot(P.x,P.y,'#FFE2A8',Math.max(3,cs*0.3)); ctx.globalAlpha=1;
  ctx.strokeStyle='#FFE2A8'; ctx.lineWidth=1.5; ctx.beginPath();
  ctx.moveTo(ox+P.x/T*cs,oy+P.y/T*cs); ctx.lineTo(ox+P.x/T*cs+Math.cos(P.face)*cs*0.8,oy+P.y/T*cs+Math.sin(P.face)*cs*0.8); ctx.stroke();
}

// =================== DRAW: JUMP SCARE ===================
function drawScare(){
  const tt=scare.t;
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
  ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
  if(!scareOn||tt<0.12) return;
  if(tt>1.5){ const a=clamp(1-(tt-1.5)/0.35,0,1); grain(500*a,0.35*a); return; }
  const f=faces[scare.kind]; if(!f) return;
  const k=clamp((tt-0.12)/0.14,0,1), e=1-Math.pow(1-k,3);
  const sc=0.2+e*1.0+(tt>0.26?Math.sin(tt*40)*0.015+(tt-0.26)*0.08:0);
  const dh=H*1.18*sc, dw=dh*f.w/f.h;
  const sh=reduce?0:(tt<0.6?28:12)*Math.min(1,k*2);
  const x=W/2-dw/2+(Math.random()-.5)*sh, y=H/2-dh/2+(Math.random()-.5)*sh+dh*0.05;
  if(!reduce&&tt>0.28&&Math.random()<0.3){
    const n=14;
    for(let i=0;i<n;i++){ const off=Math.random()<0.35?(Math.random()-.5)*dw*0.12:0; ctx.drawImage(f.base,0,f.h*i/n,f.w,f.h/n,x+off,y+dh*i/n,dw,dh/n+1); }
  } else ctx.drawImage(f.base,x,y,dw,dh);
  if(!reduce){
    const sp=6+Math.random()*16;
    ctx.globalCompositeOperation='screen'; ctx.globalAlpha=0.55;
    ctx.drawImage(f.red,x-sp,y,dw,dh); ctx.drawImage(f.cyan,x+sp,y+sp*0.3,dw,dh);
    ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
  }
  const v=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*0.2,W/2,H/2,Math.max(W,H)*0.75);
  v.addColorStop(0,'rgba(60,0,0,0)'); v.addColorStop(1,'rgba(40,0,0,.85)'); ctx.fillStyle=v; ctx.fillRect(0,0,W,H);
  grain(260,0.12);
  if(!reduce&&tt>0.3&&tt<1.3&&Math.random()<0.05){ ctx.globalCompositeOperation='difference'; ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,H); ctx.globalCompositeOperation='source-over'; }
}
function drawIdle(){
  ctx.setTransform(dpr,0,0,dpr,0,0); ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
  ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H); grain(90,0.06);
}

// =================== LOOP ===================
let last=0;
function frame(ts){
  const dt=last?Math.min(0.033,(ts-last)/1000):0; last=ts;
  step(dt);
  requestAnimationFrame(frame);
}
function step(dt){
  try{
    if(state==='intro') updateIntro(dt);
    else if(state==='play'&&!paused) updatePlay(dt);
    else if(state==='scare') updateScare(dt);
    if(state==='intro') drawIntro();
    else if(state==='play'||state==='won') drawPlay();
    else if(state==='scare') drawScare();
    else drawIdle();
  }catch(err){ console.error(err); }
}
requestAnimationFrame(frame);

function beginPlay(){
  introSeen=true; $('skip').hidden=true; hideOverlays(); ensureFaces();
  if(AC&&AC.state==='suspended') AC.resume();
  newGame(); state='play'; paused=false; $('hud').hidden=false; $('touch').hidden=false;
  setGain(droneGain,0.08); setGain(roomGain,0.05);
  showMsg('Find '+NUM[cfg.fuses]+' fuses. Then get to the stairs.',4); updateHud();
}
function setPaused(p){
  if(state!=='play'||paused===p) return;
  paused=p; clearInput(); mapOpen=false;
  if(AC) p?AC.suspend():AC.resume();
  $('pause').hidden=!p;
  if(p){ $('pauseInfo').textContent='Night '+night+'  ·  '+fuses+' of '+cfg.fuses+' fuses  ·  '+fmt(t); $('resume').focus(); }
}

// =================== MENUS ===================
let backTo='menu';
function openPanel(id,from){
  backTo=from; OVERLAYS.forEach(o=>{ if(o!=='pause') $(o).hidden=true; });
  if(from==='pause') $('pause').hidden=true;
  $(id).hidden=false;
  const b=$(id).querySelector('[data-back]'); if(b) b.focus();
}
function closePanel(){
  hideOverlays();
  if(backTo==='pause'&&state==='play'&&paused){ $('pause').hidden=false; $('resume').focus(); }
  else showMenu();
}
function showMenu(){
  state='menu'; paused=false; cutAll(); leavePlay(); hideOverlays();
  if(AC&&AC.state==='suspended') AC.resume();
  pickNight=clamp(pickNight,1,save.nightMax);
  $('nightPick').hidden=save.nightMax<=1;
  $('nLabel').textContent='Night '+pickNight+(pickNight>LAST_NIGHT?' (endless)':'');
  $('nPrev').disabled=pickNight<=1; $('nNext').disabled=pickNight>=save.nightMax;
  const best=save.best[pickNight];
  $('bestLine').textContent=best?'Best time on night '+pickNight+': '+fmt(best):'';
  $('bestLine').hidden=!best;
  $('start').textContent=pickNight===1&&save.nightMax<=1?'Go downstairs':'Go down: night '+pickNight;
  $('journalBtn').textContent='Journal ('+save.notes.length+'/'+NOTES.length+')';
  $('menu').hidden=false; $('start').focus();
}
function fillJournal(){
  const list=$('journalList'); list.innerHTML='';
  NOTES.forEach((txt,i)=>{
    const li=document.createElement('li'), found=save.notes.includes(i);
    li.textContent=found?txt:'Not found yet.'; if(!found) li.className='missing'; list.appendChild(li);
  });
  $('journalCount').textContent=save.notes.length?'Notes you found in the basement: '+save.notes.length+' of '+NOTES.length+'.':'Notes are scattered around the basement. Pick them up to read them.';
}
function syncSettings(){
  $('vol').value=Math.round(save.vol*100);
  $('scareToggle').textContent='Jump scares: '+(save.scare?'on':'off'); $('scareToggle').setAttribute('aria-pressed',String(save.scare));
  $('fxToggle').textContent='Screen shake and glitches: '+(save.fx?'on':'off'); $('fxToggle').setAttribute('aria-pressed',String(save.fx));
}
function startNight(n){
  initAudio(); night=n; pickNight=n;
  if(!introSeen&&n===1) startIntro(); else beginPlay();
}

// =================== INPUT ===================
const RUN_R=88; // drag past this ring to run on touch screens
function local(e){ const r=cv.getBoundingClientRect(); return [e.clientX-r.left,e.clientY-r.top]; }
cv.addEventListener('pointerdown',e=>{
  if(state!=='play'||paused) return; e.preventDefault();
  const [x,y]=local(e); joy={id:e.pointerId,ox:x,oy:y,vx:0,vy:0,mag:0,reach:0,sprint:false};
  try{ cv.setPointerCapture(e.pointerId); }catch(_){}
});
cv.addEventListener('pointermove',e=>{
  if(!joy||e.pointerId!==joy.id) return;
  const [x,y]=local(e), dx=x-joy.ox, dy=y-joy.oy, d=Math.hypot(dx,dy);
  if(d<8){ joy.vx=joy.vy=joy.mag=joy.reach=0; joy.sprint=false; return; }
  const m=Math.min(1,d/44); joy.vx=dx/d*m; joy.vy=dy/d*m; joy.mag=m; joy.reach=Math.min(d,RUN_R+10)/m; joy.sprint=d>RUN_R;
});
const endJoy=e=>{ if(joy&&e.pointerId===joy.id) joy=null; };
cv.addEventListener('pointerup',endJoy); cv.addEventListener('pointercancel',endJoy);

const KM={ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right',ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',Shift:'sprint'};
window.addEventListener('keydown',e=>{
  const playing=state==='play';
  if(e.key==='Escape'||e.key==='p'||e.key==='P'){
    if(playing){ setPaused(!paused); e.preventDefault(); }
    else if(e.key==='Escape'&&['help','settings','journal'].some(id=>!$(id).hidden)) closePanel();
    return;
  }
  if(!playing||paused) return;
  const k=KM[e.key]; if(k){ keys[k]=true; e.preventDefault(); return; }
  if((e.key==='f'||e.key==='F'||e.key===' ')&&!e.repeat){ toggleLight(); e.preventDefault(); return; }
  if(e.key==='m'||e.key==='M'||e.key==='Tab'){ mapOpen=true; e.preventDefault(); }
});
window.addEventListener('keyup',e=>{
  const k=KM[e.key]; if(k) keys[k]=false;
  if(e.key==='m'||e.key==='M'||e.key==='Tab') mapOpen=false;
});
function clearInput(){ for(const k in keys) keys[k]=false; joy=null; }
window.addEventListener('blur',clearInput);
document.addEventListener('visibilitychange',()=>{ last=0; clearInput(); if(document.hidden) setPaused(true); });

const on=(id,fn)=>$(id).addEventListener('click',fn);
on('start',()=>startNight(pickNight));
on('nPrev',()=>{ pickNight--; showMenu(); $('nPrev').focus(); });
on('nNext',()=>{ pickNight++; showMenu(); $('nNext').focus(); });
on('skip',()=>{ if(state==='intro') beginPlay(); });
on('retry',()=>startNight(night));
on('next',()=>startNight(night+1));
on('deadMenu',showMenu);
on('wonMenu',showMenu);
on('pauseBtn',()=>setPaused(true));
on('resume',()=>setPaused(false));
on('restart',()=>{ paused=false; startNight(night); });
on('quit',showMenu);
on('helpBtn',()=>openPanel('help','menu'));
on('journalBtn',()=>{ fillJournal(); openPanel('journal','menu'); });
on('settingsBtn',()=>{ syncSettings(); openPanel('settings','menu'); });
on('pauseSettings',()=>{ syncSettings(); openPanel('settings','pause'); });
document.querySelectorAll('[data-back]').forEach(b=>b.addEventListener('click',closePanel));
on('btnLight',toggleLight);
on('btnMap',()=>{ if(state==='play'&&!paused) mapOpen=!mapOpen; });
$('vol').addEventListener('input',e=>setVolume(e.target.value/100));
on('scareToggle',()=>{ save.scare=scareOn=!save.scare; persist(); syncSettings(); });
on('fxToggle',()=>{ save.fx=!save.fx; reduce=motionMQ.matches||!save.fx; persist(); syncSettings(); });
on('resetBtn',e=>{
  const b=e.currentTarget;
  if(b.dataset.armed){
    save.nightMax=1; save.best={}; save.notes=[]; pickNight=1; persist();
    b.textContent='Progress erased'; delete b.dataset.armed; return;
  }
  b.dataset.armed='1'; b.textContent='Tap again to erase nights, times and notes';
});

// Optional test hook: open the page with ?debug to drive the game from the console.
if(/[?&]debug\b/.test(location.search)){
  window.basement={
    get state(){ return {state,paused,night,fuses,battery,stamina,t,lightWanted,mapOpen,monsters:monsters&&monsters.map(m=>({kind:m.kind,x:Math.round(m.x),y:Math.round(m.y)})),player:P&&{x:Math.round(P.x),y:Math.round(P.y)}}; },
    takeFuse(){ const it=items.find(i=>i.k==='fuse'); if(it){ it.x=P.x; it.y=P.y; } },
    toItem(k){ const it=items.find(i=>i.k===k); if(it){ P.x=it.x; P.y=it.y; } },
    toExit(){ const c=center(...exitT); P.x=c.x; P.y=c.y; },
    spawn(kind){ spawnMonster(kind); },
    clearMonsters(){ monsters.length=0; spawnI=99; },
    revealMap(){ seen.fill(1); exitKnown=true; items.forEach(i=>i.known=true); },
    pullMonster(n){ const m=monsters[0], [px,py]=tileOf(P), d=bfs(px,py), c=cellList().find(([x,y])=>d[idx(x,y)]===n); if(m&&c){ const cc=center(...c); m.x=cc.x; m.y=cc.y; m.hasT=false; } },
    tick(sec){ for(let i=0;i<sec*60;i++) step(1/60); },
    setKeys(k){ for(const n in keys) keys[n]=false; Object.assign(keys,k); },
    setMap(v){ mapOpen=v; },
    setBattery(v){ battery=v; },
  };
}
showMenu();
})();
