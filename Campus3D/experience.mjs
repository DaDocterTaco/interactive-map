import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { modelToGeographic } from './campus3d-projection.mjs';

// Existing feature modules remain the authority for destinations and routes.
// This adapter reads their public Leaflet layers and presents them in 3D.
export function mountExperience({map, L}) {
  if (map.campusExperience) return map.campusExperience;
  const container=map.getContainer();
  const host=document.createElement('section'); host.className='campus-experience'; host.hidden=true;
  host.setAttribute('aria-label','3D campus map');
  const pins=document.createElement('div'); pins.className='campus-pins';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'); svg.classList.add('campus-vectors');
  const popupHost=document.createElement('div'); popupHost.className='campus-popup'; popupHost.hidden=true;
  host.append(svg,pins,popupHost); container.append(host);
  const toolbar=document.createElement('section'); toolbar.className='campus-tools'; toolbar.setAttribute('aria-label','Map controls');
  toolbar.innerHTML='<div><button data-action="3d" aria-pressed="false">3D</button><button data-action="2d" aria-pressed="true">2D</button><button data-action="home">Campus</button><button data-action="top">Top</button></div><div class="campus-orbit"><button data-action="left" aria-label="Rotate left">↶</button><button data-action="right" aria-label="Rotate right">↷</button><button data-action="tilt" aria-label="Change viewing angle">Tilt</button><button data-action="in" aria-label="Zoom in">+</button><button data-action="out" aria-label="Zoom out">−</button></div><p role="status" class="campus-load" hidden></p><details><summary>Map info</summary><p>Drag to rotate · Right-drag to pan · Pinch or scroll to zoom. On touch, use two fingers to pan.</p><p>Approximate building heights. Exterior navigation only.</p><p>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL</p></details>';
  container.append(toolbar);
  L.DomEvent.disableClickPropagation(toolbar); L.DomEvent.disableScrollPropagation(toolbar);
  L.DomEvent.disableClickPropagation(host);
  const notice=document.createElement('div'); notice.className='campus-credit'; notice.innerHTML='Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'; notice.hidden=true; container.append(notice);
  const status=toolbar.querySelector('[role=status]');
  let active=false, renderer, camera, controls, scene, model, loading, frame, interval, creditTimer, disposed=false, request=0, syncing=false;
  let width=1,height=1, popup=null, initial=true, down=null;
  const elements=new Map(), paths=new Map(), disabledHandlers=[];
  const raycaster=new THREE.Raycaster(), ground=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  const project=ll=>new THREE.Vector3((ll.lng+80.3745)*111320*Math.cos(25.7565*Math.PI/180),2,(25.7565-ll.lat)*111320);
  const screen=v=>{const p=v.clone().project(camera); return {x:(p.x+1)*width/2,y:(1-p.y)*height/2,visible:p.z>=-1&&p.z<=1};};
  const message=text=>{status.textContent=text;status.hidden=!text;};
  function home(){
    if(!model)return;
    const bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3());center.y=0;
    const direction=new THREE.Vector3(.075,.645,.76).normalize(),corners=[];
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])corners.push(new THREE.Vector3(x,y,z));
    controls.target.copy(center);let distance=1100;
    for(let attempt=0;attempt<20;attempt++){
      camera.position.copy(center).addScaledVector(direction,distance);camera.lookAt(center);camera.updateMatrixWorld();
      if(corners.every(v=>{const p=v.clone().project(camera);return Math.abs(p.x)<.90&&Math.abs(p.y)<.85;}))break;
      distance*=1.12;
    }
    controls.update();syncMap();invalidate();message('');
  }
  function resize(){if(!renderer)return; width=container.clientWidth;height=container.clientHeight;if(!width||!height)return;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();svg.setAttribute('viewBox',`0 0 ${width} ${height}`);invalidate();}
  const observer=new ResizeObserver(resize);observer.observe(container);
  function invalidate(){if(active&&!frame)frame=requestAnimationFrame(()=>{frame=null;controls.update();renderer.render(scene,camera);draw();});}
  function focus(ll,zoom=17){if(!camera)return;const target=project(ll);target.y=0;const distance=Math.max(65,Math.min(4200,650*2**(17-zoom)));const direction=camera.position.clone().sub(controls.target).normalize();controls.target.copy(target);camera.position.copy(target).addScaledVector(direction,distance);controls.update();invalidate();}
  function syncMap(){if(!active||syncing)return;syncing=true;const g=modelToGeographic(controls.target.x,controls.target.z);const zoom=Math.max(14,Math.min(21,17-Math.log2(camera.position.distanceTo(controls.target)/650)));map.setView([g.latitude,g.longitude],zoom,{animate:false});syncing=false;}
  function fromMap(){if(active&&!syncing){const c=map.getCenter();focus(c,map.getZoom());message(c.lat<25.750||c.lat>25.763||c.lng< -80.385||c.lng> -80.367?'This destination is outside the modeled MMC campus. Use 2D for surrounding streets.':'');}}
  function flatten(value){return Array.isArray(value)&&value.length&&value[0]?.lat!==undefined?[value]:Array.isArray(value)?value.flatMap(flatten):[];}
  function draw(){
    if(!active||!camera)return;
    host.classList.toggle('campus-overview',camera.position.distanceTo(controls.target)>1800);
    const live=new Set(), lineLive=new Set();
    map.eachLayer(layer=>{
      if(layer instanceof L.TileLayer || layer instanceof L.LayerGroup || layer instanceof L.Popup || layer instanceof L.Tooltip)return;
      const id=L.stamp(layer), ll=layer.getLatLng?.(), opts=layer.options||{};
      if(layer.getLatLngs || layer instanceof L.Circle){
        lineLive.add(id);let entry=paths.get(id);
        if(!entry){entry=document.createElementNS(svg.namespaceURI,'path');paths.set(id,entry);svg.append(entry);}
        let rings=layer.getLatLngs?flatten(layer.getLatLngs()):[Array.from({length:65},(_,i)=>{const a=i/64*Math.PI*2,r=layer.getRadius();return {lat:ll.lat+Math.sin(a)*r/111320,lng:ll.lng+Math.cos(a)*r/(111320*Math.cos(ll.lat*Math.PI/180))};})];
        const closed=layer instanceof L.Polygon||layer instanceof L.Circle;
        entry.setAttribute('d',rings.map(r=>{const points=r.map(p=>screen(project(p)));if(points.some(p=>!p.visible))return '';return points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')+(closed?' Z':'');}).join(' '));
        entry.setAttribute('stroke',opts.color||'#255de8');entry.setAttribute('stroke-width',opts.weight??3);entry.setAttribute('stroke-opacity',opts.opacity??1);entry.setAttribute('fill',closed?(opts.fillColor||opts.color||'#255de8'):'none');entry.setAttribute('fill-opacity',opts.fillOpacity??.2);entry.setAttribute('stroke-linecap','round');entry.style.pointerEvents=opts.interactive===false?'none':'auto';
        entry.onclick=e=>{e.stopPropagation();layer.fire('click',{latlng:ll||map.getCenter(),originalEvent:e},true);};return;
      }
      if(!ll)return; live.add(id);let entry=elements.get(id);
      if(!entry){const button=document.createElement('button');button.className='campus-pin';button.type='button';button.onclick=e=>{e.stopPropagation();layer.fire('click',{latlng:layer.getLatLng(),originalEvent:e},true);};pins.append(button);entry={button,signature:null};elements.set(id,entry);}
      const source=layer.getElement?.();const signature=source?.outerHTML||`${opts.fillColor}|${opts.radius}`;
      if(signature!==entry.signature){entry.signature=signature;entry.button.replaceChildren();
        if(source && !(source instanceof SVGElement)){const copy=source.cloneNode(true);copy.removeAttribute('id');copy.removeAttribute('tabindex');copy.removeAttribute('role');const size=opts.icon?.options?.iconSize;copy.style.cssText=`position:relative;transform:none;margin:0;pointer-events:none;width:${size?.x||size?.[0]||25}px;height:${size?.y||size?.[1]||41}px;`;copy.classList.remove('leaflet-zoom-animated');entry.button.append(copy);}
        else {const dot=document.createElement('span');dot.className='campus-dot';dot.style.background=opts.fillColor||opts.color||'#255de8';dot.style.width=dot.style.height=`${Math.max(10,Math.min(28,(opts.radius||7)*2))}px`;entry.button.append(dot);}
        const content=layer.getPopup?.()?.getContent();let label='';if(typeof content==='string'){const doc=new DOMParser().parseFromString(content,'text/html');label=(doc.querySelector('b,strong,h2,h3')||doc.body).textContent.trim().slice(0,140);}else label=content?.textContent?.trim().slice(0,140)||'';
        entry.button.setAttribute('aria-label',opts.title||label||source?.getAttribute('aria-label')||source?.textContent?.trim()||'Map location');entry.button.title=entry.button.getAttribute('aria-label');
        entry.button.classList.toggle('campus-base-pin',source?.tagName==='IMG');
        const tooltip=layer.getTooltip?.();if(tooltip?.options?.permanent){const caption=document.createElement('span');caption.className='campus-pin-label';const c=tooltip.getContent();caption.textContent=typeof c==='string'?new DOMParser().parseFromString(c,'text/html').body.textContent:c?.textContent||'';entry.button.append(caption);}
      }
      const p=screen(project(ll));entry.button.hidden=!p.visible||p.x< -80||p.x>width+80||p.y< -80||p.y>height+80;
      const anchor=opts.icon?.options?.iconAnchor;entry.button.style.transform=`translate(${p.x}px,${p.y}px) translate(${anchor?-(anchor.x??anchor[0])+'px':'-50%'},${anchor?-(anchor.y??anchor[1])+'px':'-50%'})`;entry.button.style.pointerEvents=opts.interactive===false?'none':'auto';
    });
    for(const [id,e] of elements)if(!live.has(id)){e.button.remove();elements.delete(id);}
    for(const [id,e] of paths)if(!lineLive.has(id)){e.remove();paths.delete(id);}
    if(popup){const p=screen(project(popup.getLatLng()));popupHost.style.left=`${Math.max(160,Math.min(width-160,p.x))}px`;popupHost.style.top=`${Math.max(85,Math.min(height-140,p.y-24))}px`;}
  }
  function popupOpen(event){if(!active)return;popup=event.popup;const element=popup.getElement();if(element){popupHost.replaceChildren(element);popupHost.hidden=false;element.style.transform='none';element.style.left='0';element.style.bottom='0';}invalidate();}
  function popupClose(){popup=null;popupHost.hidden=true;popupHost.replaceChildren();}
  function pointerDown(e){down={x:e.clientX,y:e.clientY};}
  function pointerUp(e){if(!down||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;const rect=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/width*2-1,-(e.clientY-rect.top)/height*2+1),camera);const point=new THREE.Vector3();if(raycaster.ray.intersectPlane(ground,point)){const g=modelToGeographic(point.x,point.z);map.fire('click',{latlng:L.latLng(g.latitude,g.longitude),originalEvent:e});}}
  async function setup(){
    if(renderer)return;
    const candidate=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});renderer=candidate;renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0xf3f1e9);renderer.outputColorSpace=THREE.SRGBColorSpace;
    const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','Campus 3D view. Drag to rotate; two fingers or right drag to pan. Use the map control buttons to rotate, zoom and tilt.');host.prepend(canvas);
    canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();show2D();message('3D graphics were interrupted. Your 2D map is available. Reload to retry.');});
    scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0xc5b99a,2.2));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-500,900,350);scene.add(sun);
    camera=new THREE.PerspectiveCamera(42,1,1,15000);camera.position.set(200,800,1000);
    controls=new OrbitControls(camera,canvas);controls.enableDamping=false;controls.minDistance=45;controls.maxDistance=10000;controls.maxPolarAngle=Math.PI*.46;controls.screenSpacePanning=false;controls.addEventListener('change',invalidate);controls.addEventListener('end',syncMap);
    resize();
    const gltf=await new GLTFLoader().loadAsync(new URL('./fiu-mmc-simple.glb',import.meta.url).href);if(disposed)return;model=gltf.scene;scene.add(model);
  }
  function paint(){toolbar.querySelector('[data-action="3d"]').setAttribute('aria-pressed',String(active));toolbar.querySelector('[data-action="2d"]').setAttribute('aria-pressed',String(!active));toolbar.querySelector('.campus-orbit').hidden=!active;toolbar.querySelector('[data-action="top"]').disabled=!active;}
  function show2D(){request++;active=false;host.hidden=true;container.classList.remove('campus-active');map.closePopup();popupClose();for(const handler of disabledHandlers.splice(0))handler.enable();clearInterval(interval);cancelAnimationFrame(frame);frame=null;notice.hidden=true;clearTimeout(creditTimer);paint();map.invalidateSize();message('');}
  async function show3D(){const token=++request;message('Loading 3D campus…');try{loading ||= setup();await loading;if(disposed||token!==request)return;active=true;host.hidden=false;container.classList.add('campus-active');for(const name of ['dragging','scrollWheelZoom','doubleClickZoom','touchZoom','boxZoom','keyboard'])if(map[name]?.enabled()){disabledHandlers.push(map[name]);map[name].disable();}map.closePopup();paint();resize();if(initial){initial=false;home();}else fromMap();clearInterval(interval);interval=setInterval(draw,180);message('');notice.hidden=false;clearTimeout(creditTimer);creditTimer=setTimeout(()=>notice.hidden=true,6500);invalidate();}catch(error){show2D();loading=null;controls?.dispose();renderer?.domElement.remove();renderer?.dispose();renderer=null;message('3D could not load. The original 2D map is available. Tap 3D to retry.');console.warn('Campus 3D unavailable',error);}}
  toolbar.addEventListener('click',event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;if(action==='2d'){show2D();return;}if(action==='3d'){show3D();return;}if(action==='home'){if(!active){map.fitBounds([[25.7516,-80.3842],[25.7611,-80.3682]]);return;}home();}else if(active){const offset=camera.position.clone().sub(controls.target);if(action==='in'||action==='out')offset.multiplyScalar(action==='in'?.75:1.33);if(action==='left'||action==='right')offset.applyAxisAngle(new THREE.Vector3(0,1,0),action==='left'?.35:-.35);if(action==='top')offset.set(0,offset.length(),.01);if(action==='tilt'){const spherical=new THREE.Spherical().setFromVector3(offset);spherical.phi=spherical.phi>.8?.45:1.05;offset.setFromSpherical(spherical);}camera.position.copy(controls.target).add(offset);}else return;controls.update();syncMap();invalidate();});
  map.on('moveend',fromMap);map.on('layeradd layerremove',invalidate);map.on('popupopen',popupOpen);map.on('popupclose',popupClose);
  const dispose=()=>{disposed=true;show2D();observer.disconnect();map.off('moveend',fromMap);map.off('layeradd layerremove',invalidate);map.off('popupopen',popupOpen);map.off('popupclose',popupClose);controls?.dispose();model?.traverse(o=>{o.geometry?.dispose();for(const m of (Array.isArray(o.material)?o.material:[o.material]))m?.dispose();});renderer?.dispose();host.remove();toolbar.remove();notice.remove();};
  map.on('unload',dispose);const api={show3D,show2D,dispose,get active(){return active;}};map.campusExperience=api;paint();if(new URLSearchParams(location.search).get('campusView')!=='2d')show3D();return api;
}
