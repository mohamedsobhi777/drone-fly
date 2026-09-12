import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Course, Frame } from './types';

type CameraMode = 'chase'|'orbit'|'top';
const point = (a:number[]) => new THREE.Vector3(a[0],a[2],-a[1]);

export function World({course,frame}:{course:Course|null;frame:Frame|null}) {
  const host=useRef<HTMLDivElement>(null), live=useRef(frame), modeRef=useRef<CameraMode>('chase');
  const [mode,setMode]=useState<CameraMode>('chase'), [error,setError]=useState('');
  live.current=frame; modeRef.current=mode;
  useEffect(()=>{
    if(!host.current||!course)return;
    const element=host.current, scene=new THREE.Scene();
    scene.background=new THREE.Color('#151a1d');scene.fog=new THREE.Fog('#151a1d',24,65);
    let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true});}catch{setError('3D view unavailable. Camera and telemetry remain available.');return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.25;element.append(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(52,1,.05,150);
    camera.position.set(-4.5,4,5.5);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;
    controls.target.set(4,1,0);controls.maxPolarAngle=Math.PI*.49;controls.minDistance=2;controls.maxDistance=40;
    scene.add(new THREE.HemisphereLight('#d8e8ed','#171717',2));
    const sun=new THREE.DirectionalLight('#fff0da',3);sun.position.set(5,14,6);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-25,right:25,top:15,bottom:-15,near:.1,far:50});scene.add(sun);
    const neutral=new THREE.MeshStandardMaterial({color:'#465158',roughness:.85});
    const floorMat=new THREE.MeshStandardMaterial({color:'#252c30',roughness:.94});
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(90,24),floorMat);floor.rotation.x=-Math.PI/2;floor.position.x=15;floor.receiveShadow=true;scene.add(floor);
    const grid=new THREE.GridHelper(80,80,'#4b555a','#343e43');grid.position.set(15,.005,0);scene.add(grid);
    const box=(size:number[],pos:number[],material:THREE.Material=neutral)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size as [number,number,number]),material);
      mesh.position.copy(point(pos));mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);return mesh;
    };
    // Low walls keep the full course visible from the operator camera.
    for(const side of [-1,1]) {
      box([course.length+8,.55,.12],[course.length/2,side*5,.275]);
      for(let x=0;x<course.length+4;x+=5.5){
        box([.08,4.5,.08],[x,side*5,2.25]);
      }
      box([course.length+8,.08,.08],[course.length/2,side*5,4.5]);
    }
    const gateMeshes:THREE.Mesh[][]=[];
    for(const gate of course.gates){
      const mat=new THREE.MeshStandardMaterial({color:'#809397',roughness:.55,metalness:.3});
      const parts:THREE.Mesh[]=[];
      for(const side of [-1,1]){
        parts.push(box([.12,gate.height+.2,.10],[gate.x,gate.y+side*(gate.width/2+.05),gate.z],mat));
        parts.push(box([.12,.10,gate.width],[gate.x,gate.y,gate.z+side*(gate.height/2+.05)],mat));
      }
      gateMeshes.push(parts);
      const base=box([.6,.012,gate.width+.6],[gate.x,gate.y,.012],new THREE.MeshStandardMaterial({color:'#333c40'}));base.castShadow=false;
    }
    for(const o of course.obstacles){
      const pillar=new THREE.Mesh(new THREE.CylinderGeometry(o.radius,o.radius,o.height,20),neutral);
      pillar.position.copy(point([o.x,o.y,o.z]));pillar.castShadow=true;scene.add(pillar);
      const stripe=new THREE.Mesh(new THREE.CylinderGeometry(o.radius+.003,o.radius+.003,.16,20),new THREE.MeshStandardMaterial({color:'#afb6b4'}));
      stripe.position.copy(pillar.position);stripe.position.y=2.5;scene.add(stripe);
    }
    const drone=new THREE.Group();scene.add(drone);
    const shell=new THREE.MeshStandardMaterial({color:'#e8ece9',metalness:.45,roughness:.35});
    const dark=new THREE.MeshStandardMaterial({color:'#15191b',metalness:.5,roughness:.4});
    const body=new THREE.Mesh(new THREE.BoxGeometry(.22,.075,.15),shell);body.castShadow=true;drone.add(body);
    const canopy=new THREE.Mesh(new THREE.BoxGeometry(.08,.025,.12),new THREE.MeshStandardMaterial({color:'#ff573b'}));canopy.position.set(.065,.05,0);drone.add(canopy);
    const rotors:THREE.Mesh[]=[];
    for(const x of [-.12,.12])for(const z of [-.12,.12]){
      const arm=new THREE.Mesh(new THREE.BoxGeometry(.34,.024,.025),dark);arm.rotation.y=Math.sign(x*z)*Math.PI/4;drone.add(arm);
      const motor=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,.055,12),dark);motor.position.set(x,.012,z);drone.add(motor);
      const rotor=new THREE.Mesh(new THREE.BoxGeometry(.16,.005,.016),new THREE.MeshStandardMaterial({color:'#adb8bb',transparent:true,opacity:.75}));rotor.position.set(x,.045,z);drone.add(rotor);rotors.push(rotor);
    }
    drone.scale.setScalar(1.5); // Display scale only; physics collision size is unchanged.
    const trailGeometry=new THREE.BufferGeometry();const trailData=new Float32Array(2400*3);
    trailGeometry.setAttribute('position',new THREE.BufferAttribute(trailData,3));trailGeometry.setDrawRange(0,0);
    const trail=new THREE.Line(trailGeometry,new THREE.LineBasicMaterial({color:'#ff634a',transparent:true,opacity:.85}));scene.add(trail);
    let trailCount=0,lastSequence=-1,lastTime=-1,raf=0,previous=performance.now();
    const quatMap=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),-Math.PI/2);
    const inverseMap=quatMap.clone().invert();
    const resize=()=>{const {width,height}=element.getBoundingClientRect();renderer.setSize(width,Math.max(1,height));camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(element);resize();
    const draw=(now:number)=>{
      const dt=Math.min(.05,(now-previous)/1000);previous=now;
      const state=live.current;
      if(state){
        const p=point(state.position);drone.position.lerp(p,1-Math.exp(-dt*22));
        const [w,x,y,z]=state.quaternion;drone.quaternion.slerp(quatMap.clone().multiply(new THREE.Quaternion(x,y,z,w)).multiply(inverseMap),1-Math.exp(-dt*22));
        if(state.time<lastTime||state.sequence<lastSequence){trailCount=0;}
        if(state.sequence!==lastSequence){
          if(trailCount<2400){trailData.set(p.toArray(),trailCount*3);trailCount++;}
          trailGeometry.attributes.position.needsUpdate=true;trailGeometry.setDrawRange(0,trailCount);
          trailGeometry.computeBoundingSphere();lastSequence=state.sequence;lastTime=state.time;
        }
        for(let i=0;i<rotors.length;i++)if(state.running)rotors[i].rotation.y+=dt*(40+(state.motors[i]??0)*70);
        for(let i=0;i<gateMeshes.length;i++){
          const mat=gateMeshes[i][0].material as THREE.MeshStandardMaterial;
          mat.color.set(i===state.gateIndex?'#ff573b':i<state.gateIndex?'#697e7c':'#7a8b91');
          mat.emissive.set(i===state.gateIndex?'#541006':'#000000');
        }
        controls.enabled=modeRef.current==='orbit';
        if(modeRef.current==='chase'){
          camera.position.lerp(p.clone().add(new THREE.Vector3(-4.4,2.7,4.4)),1-Math.exp(-dt*3));
          controls.target.lerp(p.clone().add(new THREE.Vector3(4,.1,0)),1-Math.exp(-dt*5));
        }else if(modeRef.current==='top'){
          camera.position.lerp(p.clone().add(new THREE.Vector3(-.1,16,.01)),1-Math.exp(-dt*4));controls.target.lerp(p,1-Math.exp(-dt*5));
        }
      }
      controls.update();renderer.render(scene,camera);raf=requestAnimationFrame(draw);
    };raf=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(raf);observer.disconnect();controls.dispose();scene.traverse(obj=>{if(obj instanceof THREE.Mesh||obj instanceof THREE.Line){obj.geometry.dispose();const mats=Array.isArray(obj.material)?obj.material:[obj.material];mats.forEach(m=>m.dispose());}});renderer.dispose();renderer.domElement.remove();};
  },[course]);
  return <div className="world-wrap"><div className="world-canvas" ref={host} aria-label="Live 3D quadcopter and obstacle course"/>
    {error&&<p className="view-error">{error}</p>}
    <div className="view-switch" aria-label="Flight camera">{(['chase','orbit','top'] as CameraMode[]).map(m=><button key={m} aria-pressed={mode===m} onClick={()=>setMode(m)}>{m}</button>)}</div>
    <div className="world-label"><span>MUJOCO / LIVE PHYSICS</span><strong>{course?`COURSE ${course.seed}`:'CONNECTING'}</strong></div>
    <div className="world-readouts"><div><span>GROUND SPEED</span><strong>{frame?Math.hypot(...frame.velocity.slice(0,2)).toFixed(2):'—'}<small>m/s</small></strong></div><div><span>ALTITUDE</span><strong>{frame?.position[2].toFixed(2)??'—'}<small>m</small></strong></div></div>
    {frame&&frame.status!=='flying'&&<div className={'flight-result '+(frame.status==='complete'?'success':'')}><span>FLIGHT ENDED</span><strong>{frame.status==='complete'?'COURSE COMPLETE':frame.status.replaceAll('-',' ').toUpperCase()}</strong><p>{frame.passed} / 5 gates · {frame.time.toFixed(1)} s{frame.collision?` · ${frame.collision}`:''}</p></div>}
  </div>;
}

