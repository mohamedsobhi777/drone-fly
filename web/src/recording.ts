import type { Recording } from './types';

export function parseRecording(value:unknown, graphHash:string):Recording {
  const data=value as Recording;
  if(!data||data.version!=='drone-fly-recording-v1'||data.graphHash!==graphHash||!data.course||!Array.isArray(data.course.gates)||data.course.gates.length!==5||!Array.isArray(data.course.obstacles))throw Error('This is not a compatible Drone Fly recording.');
  if(!Number.isSafeInteger(data.course.seed)||!Number.isFinite(data.course.length)||data.course.length<1||data.course.length>100)throw Error('Invalid recorded course.');
  for(const g of data.course.gates)if(![g.x,g.y,g.z,g.width,g.height].every(Number.isFinite)||g.width<=0||g.height<=0)throw Error('Invalid gate geometry.');
  for(const o of data.course.obstacles)if(![o.x,o.y,o.z,o.radius,o.height].every(Number.isFinite)||o.radius<=0||o.height<=0)throw Error('Invalid obstacle geometry.');
  if(!Array.isArray(data.frames)||data.frames.length<2||data.frames.length>2400)throw Error('Recording must contain 2–2,400 frames.');
  let previous=-1;
  for(const f of data.frames){
    if(!Number.isFinite(f.time)||f.time<previous||f.time>120)throw Error('Invalid recording timestamps.');previous=f.time;
    for(const [arr,count] of [[f.position,3],[f.velocity,3],[f.quaternion,4],[f.motors,4],[f.command,3],[f.activity,80],[f.observation,8]] as [number[],number][]){if(!Array.isArray(arr)||arr.length!==count||!arr.every(Number.isFinite))throw Error('Invalid recorded telemetry.');}
    if(typeof f.camera!=='string'||f.camera.length>150000||!/^[A-Za-z0-9+/=]*$/.test(f.camera)||!f.vision||typeof f.status!=='string')throw Error('Invalid camera or flight status.');
  }
  return data;
}

export function downloadJSON(value:unknown,name:string){const blob=new Blob([JSON.stringify(value)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

