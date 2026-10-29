// Opt-in local measurement, no storage and no network/telemetry.
export function createProfile(renderer, boxes) {
  if(new URLSearchParams(location.search).get('record')==='1')installRecorder(renderer.domElement);
  if(new URLSearchParams(location.search).get('profile')!=='1')return null;
  const start=performance.now(),samples=[],labels=[];
  const stats={draws:0,labelPasses:0,lastDrawCalls:0,decorativeMeshes:boxes};
  const output=document.createElement('output');output.id='gesture-stats';
  Object.assign(output.style,{position:'fixed',left:'8px',top:'145px',zIndex:99,background:'#fffffff5',padding:'8px',font:'12px monospace',maxWidth:'310px',whiteSpace:'pre-wrap',pointerEvents:'none'});document.body.append(output);
  const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
  const publish=()=>{output.textContent=JSON.stringify({...stats,elapsedSeconds:+((performance.now()-start)/1000).toFixed(2),meanCpuMs:+mean(samples).toFixed(3),meanLabelMs:+mean(labels).toFixed(3),pixelRatio:renderer.getPixelRatio(),limit:'This Mac CPU only; not iPhone FPS'},null,2);};
  setInterval(publish,500);publish();
  return {frame(ms){stats.draws++;stats.lastDrawCalls=renderer.info.render.calls;samples.push(ms);if(samples.length>300)samples.shift();},labels(ms){stats.labelPasses++;labels.push(ms);if(labels.length>300)labels.shift();}};
}

function installRecorder(canvas){
  const panel=document.createElement('div');Object.assign(panel.style,{position:'fixed',left:'8px',top:'145px',zIndex:100,background:'white',padding:'6px',font:'14px sans-serif'});
  panel.innerHTML='<button id="record-start">録画開始</button> <button id="record-stop" disabled>録画停止</button><span id="record-state"></span>';
  document.body.append(panel);let recorder,parts=[];
  panel.querySelector('#record-start').onclick=()=>{
    parts=[];const stream=canvas.captureStream(30);recorder=new MediaRecorder(stream,{videoBitsPerSecond:2500000});
    recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
    recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const a=document.createElement('a');a.id='record-download';a.href=URL.createObjectURL(new Blob(parts,{type:recorder.mimeType}));a.download='tokyo-motion.webm';a.textContent='操作録画を保存';panel.append(a);panel.querySelector('#record-state').textContent='保存可能';};
    recorder.start();panel.querySelector('#record-state').textContent='録画中（地図の形だけ）';panel.querySelector('#record-stop').disabled=false;
  };
  panel.querySelector('#record-stop').onclick=()=>{recorder.stop();panel.querySelector('#record-stop').disabled=true;};
}
