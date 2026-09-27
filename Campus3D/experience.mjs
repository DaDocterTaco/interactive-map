import * as THREE from 'three';

import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { modelToGeographic } from './campus3d-projection.mjs';
import { createMapTapGesture } from './mapGestures.mjs';
import { headingView } from '../locationservices/direction.mjs';

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
  const compactControls = createMapControls(toolbar);
  container.append(toolbar);
  L.DomEvent.disableClickPropagation(toolbar); L.DomEvent.disableScrollPropagation(toolbar);
  L.DomEvent.disableClickPropagation(host);
  const notice=document.createElement('div'); notice.className='campus-credit'; notice.innerHTML='Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'; notice.hidden=true; container.append(notice);
  const status=toolbar.querySelector('[role=status]');
  let mapLoader;
  let active=false, renderer, camera, controls, scene, model, loading, frame, interval, creditTimer, disposed=false, request=0, syncing=false;
  let width=1,height=1,popup=null,initial=true,cameraFrame=null,interacting=false,interactionMoved=false,handledClickUntil=0;
  const taps=createMapTapGesture(),tapTargets=new Map();
  const elements=new Map(), paths=new Map(), disabledHandlers=[];
  const raycaster=new THREE.Raycaster(), ground=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  const project=ll=>new THREE.Vector3((ll.lng+80.3745)*111320*Math.cos(25.7565*Math.PI/180),2,(25.7565-ll.lat)*111320);
  const screen=v=>{const p=v.clone().project(camera); return {x:(p.x+1)*width/2,y:(1-p.y)*height/2,visible:p.z>=-1&&p.z<=1};};
  const message=text=>{status.textContent=text;status.hidden=!text;};
  function home(){
    if(!model)return;cancelAnimationFrame(cameraFrame);interactionMoved=false;
    if(window.CampusUI){const panelTop=window.CampusUI.sheet.getBoundingClientRect().top,top=innerWidth<=640?80:100,anchorY=top+(Math.max(top+80,panelTop-16)-top)/2;camera.clearViewOffset();controls.target.copy(project({lat:25.75665,lng:-80.3747}));controls.target.y=0;camera.position.copy(controls.target).add(new THREE.Vector3(0,innerWidth<=640?660:750,100));camera.setViewOffset(width,height,0,height/2-anchorY,width,height);controls.update();syncMap();invalidate();return;}
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
  function focus(ll,zoom=17){if(!camera)return;interactionMoved=false;const target=project(ll);target.y=0;const distance=Math.max(65,Math.min(4200,650*2**(17-zoom)));const direction=camera.position.clone().sub(controls.target).normalize();controls.target.copy(target);camera.position.copy(target).addScaledVector(direction,distance);controls.update();invalidate();}
  function syncMap(){if(!active||syncing)return;syncing=true;const g=modelToGeographic(controls.target.x,controls.target.z);const zoom=Math.max(14,Math.min(21,17-Math.log2(camera.position.distanceTo(controls.target)/650)));map.setView([g.latitude,g.longitude],zoom,{animate:false});syncing=false;}
  function fromMap(){if(active&&!syncing){camera.clearViewOffset();const c=map.getCenter();focus(c,map.getZoom());message(c.lat<25.750||c.lat>25.763||c.lng< -80.385||c.lng> -80.367?'This destination is outside the modeled MMC campus. Use 2D for surrounding streets.':'');}}
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
        if(source && !(source instanceof SVGElement)){const copy=source.cloneNode(true);copy.removeAttribute('id');copy.removeAttribute('tabindex');copy.removeAttribute('role');copy.removeAttribute('aria-hidden');copy.classList.remove('cu-label-hidden');const size=opts.icon?.options?.iconSize;copy.style.cssText=`position:relative;transform:none;margin:0;pointer-events:none;width:${size?.x||size?.[0]||25}px;height:${size?.y||size?.[1]||41}px;`;copy.classList.remove('leaflet-zoom-animated');entry.button.append(copy);}
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
    window.CampusApp?.layoutBuildingLabels?.();
    if(popup){const p=screen(project(popup.getLatLng()));popupHost.style.left=`${Math.max(160,Math.min(width-160,p.x))}px`;popupHost.style.top=`${Math.max(85,Math.min(height-140,p.y-24))}px`;}
  }
  function popupOpen(event){if(!active)return;popup=event.popup;const element=popup.getElement();if(element){popupHost.replaceChildren(element);popupHost.hidden=false;element.style.transform='none';element.style.left='0';element.style.bottom='0';}invalidate();}
  function popupClose(){popup=null;popupHost.hidden=true;popupHost.replaceChildren();}
  function pointerDown(e){taps.down(e);tapTargets.set(e.pointerId,e.target);}
  function pointerMove(e){taps.move(e);}
  function pointerCancel(e){taps.cancel(e);tapTargets.delete(e.pointerId);}
  function pointerUp(e){
    const original=tapTargets.get(e.pointerId);tapTargets.delete(e.pointerId);
    const kind=taps.up(e);if(!kind)return;
    // OrbitControls captures on the whole surface, so restore intentional marker taps.
    const pin=original?.closest('.campus-pin, .campus-vectors path');
    handledClickUntil=performance.now()+400;
    if(pin&&!container.classList.contains('nav-picking-start')){pin.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));return;}
    if(kind==='double'&&!container.classList.contains('nav-picking-start')){window.dispatchEvent(new CustomEvent('campus-map-zoom',{detail:{delta:1}}));return;}
    const rect=renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/width*2-1,-(e.clientY-rect.top)/height*2+1),camera);
    const point=new THREE.Vector3();if(raycaster.ray.intersectPlane(ground,point)){const g=modelToGeographic(point.x,point.z);map.fire('click',{latlng:L.latLng(g.latitude,g.longitude),originalEvent:e});}
  }
  // Popup controls are independent of map gestures, including their release events.
  host.addEventListener('click',e=>{if(popupHost.contains(e.target))return;if(e.detail>0&&(taps.suppressClick()||performance.now()<handledClickUntil)){e.preventDefault();e.stopImmediatePropagation();}},true);
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel','wheel'])popupHost.addEventListener(type,e=>e.stopPropagation());
  async function setup(){
    if(renderer)return;
    const candidate=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});renderer=candidate;renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0xf3f1e9);renderer.outputColorSpace=THREE.SRGBColorSpace;
    const canvas=renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','Campus 3D view. Drag with one finger to move. Pinch with two fingers to zoom and pan. Double-tap to zoom in. Tap Recenter to follow your location.');host.prepend(canvas);
    host.addEventListener('pointerdown',pointerDown);host.addEventListener('pointermove',pointerMove);host.addEventListener('pointerup',pointerUp);host.addEventListener('pointercancel',pointerCancel);canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();show2D();message('3D graphics were interrupted. Your 2D map is available. Reload to retry.');});
    scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0xc5b99a,2.2));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-500,900,350);scene.add(sun);
    camera=new THREE.PerspectiveCamera(42,1,1,15000);camera.position.set(200,800,1000);
    controls=new OrbitControls(camera,host);controls.enableDamping=true;controls.dampingFactor=.2;
    controls.mouseButtons.LEFT=THREE.MOUSE.PAN;controls.mouseButtons.RIGHT=THREE.MOUSE.ROTATE;
    controls.touches.ONE=THREE.TOUCH.PAN;controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;
    controls.panSpeed=1;controls.zoomSpeed=.85;controls.rotateSpeed=.65;
    controls.minDistance=650*2**(17-map.getMaxZoom());controls.maxDistance=5200;controls.maxPolarAngle=Math.PI*.43;
    controls.screenSpacePanning=false;
    controls.addEventListener('start',()=>{cancelAnimationFrame(cameraFrame);interacting=true;interactionMoved=false;});
    controls.addEventListener('change',()=>{if(interacting&&!interactionMoved){interactionMoved=true;window.dispatchEvent(new Event('campus-map-interaction'));}if(interactionMoved)syncMap();invalidate();});
    controls.addEventListener('end',()=>{interacting=false;syncMap();});
    resize();
    const gltf=await new GLTFLoader().loadAsync(new URL('./fiu-mmc-simple.glb',import.meta.url).href);if(disposed)return;model=gltf.scene;scene.add(model);
  }
  function paint(){compactControls.setView(active); }
  function show2D(){cancelAnimationFrame(cameraFrame);interacting=interactionMoved=false;mapLoader?.remove();mapLoader=null;window.CampusLoopLoading?.ready();request++;active=false;host.hidden=true;container.classList.remove('campus-active');map.closePopup();popupClose();for(const handler of disabledHandlers.splice(0))handler.enable();clearInterval(interval);cancelAnimationFrame(frame);frame=null;notice.hidden=true;clearTimeout(creditTimer);paint();map.invalidateSize();message('');window.dispatchEvent(new Event('campus-map-viewchange'));}
  async function show3D(){if(active)return;const token=++request;message('Loading 3D campus…');window.CampusLoopLoading?.message('Bringing your campus into view…');mapLoader?.remove();const pendingLoader=window.CampusLoopLoading?.mount(toolbar,{label:'Loading 3D campus…'});mapLoader=pendingLoader;try{loading ||= setup();await loading;if(disposed||token!==request)return;active=true;host.hidden=false;container.classList.add('campus-active');for(const name of ['dragging','scrollWheelZoom','doubleClickZoom','touchZoom','boxZoom','keyboard'])if(map[name]?.enabled()){disabledHandlers.push(map[name]);map[name].disable();}map.closePopup();paint();resize();if(initial){initial=false;home();}else fromMap();clearInterval(interval);interval=setInterval(draw,180);message('');notice.hidden=false;clearTimeout(creditTimer);creditTimer=setTimeout(()=>notice.hidden=true,6500);invalidate();window.dispatchEvent(new Event('campus-map-viewchange'));}catch(error){show2D();loading=null;controls?.dispose();renderer?.domElement.remove();renderer?.dispose();renderer=null;message('3D could not load. The original 2D map is available. Tap 3D to retry.');console.warn('Campus 3D unavailable',error);}finally{pendingLoader?.remove();if(mapLoader===pendingLoader)mapLoader=null;if(!disposed&&token===request)requestAnimationFrame(()=>window.CampusLoopLoading?.ready());}}
  toolbar.addEventListener('click',event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;interactionMoved=false;if(action==='2d'){show2D();return;}if(action==='3d'){show3D();return;}if(action==='north'){if(!active)return;window.dispatchEvent(new Event('campus-map-interaction'));const g=modelToGeographic(controls.target.x,controls.target.z);api.focusAt({lat:g.latitude,lng:g.longitude},map.getZoom(),{x:width/2-(camera.view?.offsetX||0),y:height/2-(camera.view?.offsetY||0)},{northUp:true});window.CampusUI?.announce('Map facing north');return;}if(action==='home'){if(!active){map.fitBounds([[25.7516,-80.3842],[25.7611,-80.3682]]);return;}home();}else if(active){const offset=camera.position.clone().sub(controls.target);if(action==='in'||action==='out')offset.multiplyScalar(action==='in'?.75:1.33);if(action==='left'||action==='right')offset.applyAxisAngle(new THREE.Vector3(0,1,0),action==='left'?.35:-.35);if(action==='top')offset.set(0,offset.length(),.01);if(action==='tilt'){const spherical=new THREE.Spherical().setFromVector3(offset);spherical.phi=spherical.phi>.8?.45:1.05;offset.setFromSpherical(spherical);}camera.position.copy(controls.target).add(offset);}else return;controls.update();syncMap();invalidate();});
  map.on('moveend',fromMap);map.on('layeradd layerremove',invalidate);map.on('popupopen',popupOpen);map.on('popupclose',popupClose);
  const dispose=()=>{compactControls.dispose();disposed=true;cancelAnimationFrame(cameraFrame);show2D();observer.disconnect();map.off('moveend',fromMap);map.off('layeradd layerremove',invalidate);map.off('popupopen',popupOpen);map.off('popupclose',popupClose);controls?.dispose();model?.traverse(o=>{o.geometry?.dispose();for(const m of (Array.isArray(o.material)?o.material:[o.material]))m?.dispose();});renderer?.dispose();host.remove();toolbar.remove();notice.remove();};
  map.on('unload',dispose);const api={show3D,show2D,dispose,overview:home,
    frameRoute(points,{top=110,bottom=280,padding=36,animate=true}={}){
      if(!active||!points.length)return;
      const vectors=points.map(([lat,lng])=>project({lat,lng}));
      const box=new THREE.Box3().setFromPoints(vectors),target=box.getCenter(new THREE.Vector3());target.y=0;
      const anchor={x:width/2,y:top+Math.max(80,height-top-bottom)/2};
      const testCamera=new THREE.PerspectiveCamera(42,width/height,1,15000),direction=new THREE.Vector3(0,1,.18).normalize();
      testCamera.setViewOffset(width,height,0,height/2-anchor.y,width,height);
      let distance=100;
      for(let attempt=0;attempt<45;attempt++){
        testCamera.position.copy(target).addScaledVector(direction,distance);testCamera.lookAt(target);testCamera.updateMatrixWorld();
        if(vectors.every(v=>{const p=v.clone().project(testCamera),x=(p.x+1)*width/2,y=(1-p.y)*height/2;return x>=padding&&x<=width-padding&&y>=top&&y<=height-bottom;}))break;
        distance*=1.12;
      }
      const center=modelToGeographic(target.x,target.z);
      api.focusAt({lat:center.latitude,lng:center.longitude},17-Math.log2(distance/650),anchor,{animate,northUp:true});
    },
    getViewState:()=>camera?{distance:camera.position.distanceTo(controls.target),bearing:controls.getAzimuthalAngle(),tilt:controls.getPolarAngle()}:null,
    zoomTo(zoom){const g=modelToGeographic(controls.target.x,controls.target.z);api.focusAt({lat:g.latitude,lng:g.longitude},zoom,{x:width/2-(camera.view?.offsetX||0),y:height/2-(camera.view?.offsetY||0)});},
    focusAt(ll,zoom,anchor,{animate=true,northUp=false,heading=null}={}){
      if(!active||interacting)return;cancelAnimationFrame(cameraFrame);interactionMoved=false;animate=animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
      const target=project(ll);target.y=0;
      const oriented=Number.isFinite(heading),view=oriented?headingView(heading):null;
      const direction=oriented?new THREE.Vector3(view.x,view.y,view.z):northUp?new THREE.Vector3(0,1,.18).normalize():camera.position.clone().sub(controls.target).normalize();
      const distance=Math.max(65,Math.min(4200,650*2**(17-zoom)));
      const end=target.clone().addScaledVector(direction,distance),start=camera.position.clone(),old=controls.target.clone();
      const oldX=camera.view?.enabled?camera.view.offsetX:0,oldY=camera.view?.enabled?camera.view.offsetY:0;
      const dx=width/2-anchor.x,dy=height/2-anchor.y,startTime=performance.now();
      syncing=true;map.setView([ll.lat,ll.lng],zoom,{animate:false});syncing=false;
      const tick=()=>{const t=animate?Math.min(1,(performance.now()-startTime)/420):1,k=1-(1-t)**3;controls.target.lerpVectors(old,target,k);camera.position.lerpVectors(start,end,k);camera.setViewOffset(width,height,oldX+(dx-oldX)*k,oldY+(dy-oldY)*k,width,height);controls.update();invalidate();if(t<1)cameraFrame=requestAnimationFrame(tick);};tick();
    },get active(){return active;}};map.campusExperience=api;paint();if(new URLSearchParams(location.search).get('campusView')!=='2d')show3D();return api;
}

// Compact disclosures share the map adapter's existing action handlers.
function createMapControls(toolbar) {
  const icon = name => `<span class="cu-icon" aria-hidden="true" style="--icon:url('${new URL(`CampusUI/icons/${name}.svg`, document.baseURI).href}')"></span>`;
  toolbar.innerHTML = `
    <div class="campus-tools-row">
      <div class="campus-view-control">
        <button type="button" class="campus-view-knob" aria-label="Choose map view, current view 2D" aria-expanded="false" aria-controls="campus-view-choices"><span class="campus-current-view">2D</span>${icon('chevron-down')}</button>
        <div id="campus-view-choices" class="campus-view-switch" role="group" aria-label="Map view" hidden>
          <button type="button" data-action="3d" aria-pressed="false">3D</button>
          <button type="button" data-action="2d" aria-pressed="true">2D</button>
        </div>
      </div>
      <button type="button" class="campus-tools-knob" aria-label="Map tools" title="Map tools" aria-expanded="false" aria-controls="campus-tools-menu">${icon('adjustments-horizontal')}</button>
    </div>
    <div id="campus-tools-menu" class="campus-tools-menu" hidden>
      <div class="campus-tools-shortcuts">
        <button type="button" class="campus-recenter-action">${icon('navigation')}<span>Recenter</span></button>
        <button type="button" class="campus-settings-action" aria-expanded="false" aria-controls="campus-map-settings">${icon('adjustments-horizontal')}<span>Map settings</span></button>
      </div>
      <section id="campus-map-settings" class="campus-map-settings" aria-label="Map settings" hidden>
        <button type="button" class="campus-settings-back">${icon('arrow-left')}<span>Map settings</span></button>
        <div class="campus-options-actions"><button type="button" data-action="home">View campus</button><button type="button" data-action="north">${icon('navigation')}<span>Face north</span></button><button type="button" data-action="top">Top view</button></div>
        <div class="campus-orbit"><button type="button" data-action="left" aria-label="Rotate left">${icon('arrow-left')}</button><button type="button" data-action="right" aria-label="Rotate right">${icon('arrow-right')}</button><button type="button" data-action="tilt">Tilt</button><button type="button" data-action="in" aria-label="Zoom in">${icon('plus')}</button><button type="button" data-action="out" aria-label="Zoom out">${icon('minus')}</button></div>
        <p>Drag to move · Pinch or scroll to zoom.<br>Right-drag to rotate in 3D.</p><p>Approximate building heights.<br>Exterior navigation only.</p><p>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL</p>
      </section>
    </div>
    <p role="status" class="campus-load" hidden></p>`;
  const view = toolbar.querySelector('.campus-view-control');
  const viewKnob = toolbar.querySelector('.campus-view-knob');
  const choices = toolbar.querySelector('.campus-view-switch');
  const toolsKnob = toolbar.querySelector('.campus-tools-knob');
  const menu = toolbar.querySelector('.campus-tools-menu');
  const shortcuts = toolbar.querySelector('.campus-tools-shortcuts');
  const settings = toolbar.querySelector('.campus-map-settings');
  const settingsAction = toolbar.querySelector('.campus-settings-action');
  const events = new AbortController();
  const listen = (target, event, callback) => target.addEventListener(event, callback, {signal: events.signal});
  let open = null;

  function setSettings(expanded, focus = false) {
    shortcuts.hidden = expanded;
    settings.hidden = !expanded;
    settingsAction.setAttribute('aria-expanded', String(expanded));
    menu.classList.toggle('is-settings', expanded);
    if (focus) (expanded ? toolbar.querySelector('.campus-settings-back') : settingsAction).focus({preventScroll:true});
  }
  function close({restoreFocus = false} = {}) {
    const trigger = open === 'view' ? viewKnob : toolsKnob;
    open = null;
    view.classList.remove('is-open');
    viewKnob.hidden = false;
    choices.hidden = true;
    menu.hidden = true;
    viewKnob.setAttribute('aria-expanded', 'false');
    toolsKnob.setAttribute('aria-expanded', 'false');
    setSettings(false);
    if (restoreFocus) trigger.focus({preventScroll:true});
  }
  function expand(which) {
    if (open === which) { close({restoreFocus:true}); return; }
    close();
    open = which;
    if (which === 'view') {
      view.classList.add('is-open');
      viewKnob.hidden = true;
      choices.hidden = false;
      viewKnob.setAttribute('aria-expanded', 'true');
      choices.querySelector('[aria-pressed="true"]').focus({preventScroll:true});
    } else {
      menu.hidden = false;
      toolsKnob.setAttribute('aria-expanded', 'true');
      shortcuts.querySelector('button').focus({preventScroll:true});
    }
  }
  listen(viewKnob, 'click', () => expand('view'));
  listen(toolsKnob, 'click', () => expand('tools'));
  listen(settingsAction, 'click', () => setSettings(true, true));
  listen(toolbar.querySelector('.campus-settings-back'), 'click', () => setSettings(false, true));
  listen(toolbar.querySelector('.campus-recenter-action'), 'click', () => {
    close({restoreFocus:true});
    document.getElementById('cu-recenter')?.click();
  });
  listen(toolbar, 'click', event => {
    if (event.target.closest('[data-action="2d"], [data-action="3d"]')) close({restoreFocus:true});
  });
  listen(document, 'pointerdown', event => { if (!toolbar.contains(event.target)) close(); });
  listen(toolbar, 'focusout', event => { if (event.relatedTarget && !toolbar.contains(event.relatedTarget)) close(); });
  listen(toolbar, 'keydown', event => {
    if (event.key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); close({restoreFocus:true});
    } else if (open === 'view' && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();
      const buttons = [...choices.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (index + 1) % 2].focus();
    } else if (open === 'tools' && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();
      const buttons = [...(settings.hidden ? shortcuts : settings).querySelectorAll('button:not(:disabled)')].filter(button => !button.closest('[hidden]'));
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  });
  listen(window, 'campus-panel-layout', () => { if (document.getElementById('campus-sheet')?.dataset.snap === 'full') close(); });
  return {
    close,
    setView(active) {
      const label = active ? '3D' : '2D';
      toolbar.querySelector('.campus-current-view').textContent = label;
      viewKnob.setAttribute('aria-label', `Choose map view, current view ${label}`);
      toolbar.querySelector('[data-action="3d"]').setAttribute('aria-pressed', String(active));
      toolbar.querySelector('[data-action="2d"]').setAttribute('aria-pressed', String(!active));
      toolbar.querySelector('.campus-orbit').hidden = !active;
      toolbar.querySelector('[data-action="top"]').disabled = !active;
      toolbar.querySelector('[data-action="north"]').disabled = !active;
    },
    dispose() { events.abort(); }
  };
}
