import './mobileInput.js';
import {createCampusCamera} from './camera.mjs';
import {loadCampusCatalog} from '../ClassSearch/classData.mjs?v=numeric-course-search-1';
const names={GL:'Green Library',GC:'Graham Center',PG5:'PG5 Market Station'};
const types={GL:'Library',GC:'Student center',PG5:'Classes & dining'};
// Work in screen pixels, so density follows the actual camera and available map
// area rather than a Leaflet zoom threshold (which differs from the 3D camera).
export function chooseBuildingLabels(candidates,{viewport,obstacles=[],previous=new Set(),gap=8}) {
 const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
 const expand=r=>({left:r.left-gap/2,right:r.right+gap/2,top:r.top-gap/2,bottom:r.bottom+gap/2});
 const cx=(viewport.left+viewport.right)/2,cy=(viewport.top+viewport.bottom)/2;
 const score=c=>Math.hypot((c.rect.left+c.rect.right)/2-cx,(c.rect.top+c.rect.bottom)/2-cy)-(previous.has(c.code)?24:0);
 const ordered=candidates.filter(c=>c.rect.left>=viewport.left+4&&c.rect.right<=viewport.right-4&&c.rect.top>=viewport.top+4&&c.rect.bottom<=viewport.bottom-4&&!obstacles.some(o=>intersects(expand(c.rect),o)))
  .sort((a,b)=>(b.priority||0)-(a.priority||0)||score(a)-score(b)||a.code.localeCompare(b.code));
 const placed=[],visible=new Set();
 for(const c of ordered){const box=expand(c.rect);if(placed.some(r=>intersects(box,r)))continue;placed.push(box);visible.add(c.code);}
 return visible;
}
export async function mountCampusExplorer({map,L,locationServices,navigation}) {
 const ui=window.CampusUI,camera=createCampusCamera({map,locationServices,ui});
 const api={map,locationServices,camera,navigation};window.CampusApp=api;
 const input=document.getElementById('campus-query'),results=document.getElementById('campus-results'),detail=document.getElementById('place-detail'),home=document.querySelector('.cu-explore-home');
 let buildings=[],savedMode=false,selected=null,searchRevision=0,classLookupTimer;
 const read=key=>{try{const v=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(v)?v.filter(x=>typeof x==='string'):[];}catch{return [];}};
 const save=(key,v)=>{try{localStorage.setItem(key,JSON.stringify(v));}catch{ui.announce('Your browser could not save this preference.');}};
 let recent=read('campus:recent'),saved=read('campus:saved');
 const text=(tag,value,cls)=>{const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;};
 function render(){const revision=++searchRevision;clearTimeout(classLookupTimer);results.replaceChildren();const searchText=input.value.trim(),q=searchText.toLowerCase();document.getElementById('places-heading').textContent=q?'Search results':savedMode?'Saved places':recent.length?'Recent':'Popular places';
   let matches=q?buildings.filter(b=>`${b.abbreviation} ${b.full_name} ${names[b.abbreviation]||''}`.toLowerCase().includes(q)):savedMode?saved.map(c=>buildings.find(b=>b.abbreviation===c)).filter(Boolean):(recent.length?recent:['GL','GC']).map(c=>buildings.find(b=>b.abbreviation===c)).filter(Boolean);
   for(const building of matches.slice(0,12)){const b=document.createElement('button');b.type='button';b.className='cu-place-row';b.innerHTML=ui.icon(building.abbreviation==='GL'?'book':building.abbreviation==='GC'?'users':'map-pin')+'<span></span>'+ui.icon('chevron-right');b.children[1].append(text('strong',names[building.abbreviation]||building.full_name),text('small',`${building.abbreviation} · ${types[building.abbreviation]||'Campus building'}`));b.addEventListener('click',()=>showBuilding(building));results.append(b);}
   if(q){
    const feedback=!matches.length?text('p','Searching classes…','cu-empty'):null;if(feedback){feedback.setAttribute('role','status');results.append(feedback);}
    classLookupTimer=setTimeout(async()=>{
     try{
      const catalog=await loadCampusCatalog();if(revision!==searchRevision)return;
      const sections=catalog.search({mode:'auto',course:searchText});
      if(!sections.length){if(feedback)feedback.textContent='No matching places or classes.';return;}
      feedback?.remove();const b=document.createElement('button');b.type='button';b.className='cu-place-row';
      b.innerHTML=ui.icon('school')+'<span></span>'+ui.icon('chevron-right');
      b.children[1].append(text('strong',`Classes matching “${searchText}”`),text('small',`${sections.length} matching ${sections.length===1?'section':'sections'}`));
      b.addEventListener('click',()=>{ui.activate('classes');const query=document.getElementById('class-query');query.value=searchText;
       // The advertised count is unfiltered; do not carry stale filters into it.
       document.getElementById('class-professor').value='';document.getElementById('class-time').value='';
       query.dispatchEvent(new Event('input',{bubbles:true}));window.CampusInput.focus(query,{preventScroll:true});});results.append(b);
     }catch{if(revision===searchRevision&&feedback)feedback.textContent='No places found. Class search is temporarily unavailable.';}
    },180);
   }
   if(!matches.length&&!q)results.append(text('p',savedMode?'Save a building to find it quickly here.':'Campus places are loading…','cu-empty'));
 }
 function showBuilding(b){navigation.stop();detail.classList.remove('is-routing');delete detail.dataset.routePhase;selected=b;recent=[b.abbreviation,...recent.filter(c=>c!==b.abbreviation)].slice(0,8);save('campus:recent',recent);home.hidden=true;detail.hidden=false;detail.replaceChildren();
   const back=document.createElement('button');back.type='button';back.className='cu-back';back.innerHTML=ui.icon('arrow-left')+'Explore';back.addEventListener('click',()=>{ui.clearMapView('explore');detail.hidden=true;home.hidden=false;render();});
   const header=text('div',null,'cu-place-heading'),heading=text('h2',names[b.abbreviation]||b.full_name),bookmark=document.createElement('button');bookmark.type='button';bookmark.className='cu-save-place';bookmark.innerHTML=ui.icon('bookmark');
   const refreshSave=()=>{const exists=saved.includes(b.abbreviation);bookmark.setAttribute('aria-pressed',String(exists));bookmark.setAttribute('aria-label',exists?'Remove saved place':'Save this place');};refreshSave();bookmark.addEventListener('click',()=>{saved=saved.includes(b.abbreviation)?saved.filter(c=>c!==b.abbreviation):[b.abbreviation,...saved];save('campus:saved',saved);refreshSave();api.layoutBuildingLabels?.();ui.announce(saved.includes(b.abbreviation)?'Place saved':'Place removed from saved');});header.append(heading,bookmark);
   const directions=document.createElement('button');directions.type='button';directions.className='cu-primary';directions.innerHTML='Directions '+ui.icon('arrow-right');
   const route=document.createElement('section');route.hidden=true;route.className='cu-place-route';
   directions.addEventListener('click',()=>{route.hidden=false;directions.hidden=true;detail.classList.add('is-routing');const building={code:b.abbreviation,name:b.full_name,latitude:b.latitude,longitude:b.longitude};route.append(stop);ui.showMapView('explore',detail);navigation.start({location:{building},panel:route,onFinish:()=>{route.hidden=true;directions.hidden=false;detail.classList.remove('is-routing');delete detail.dataset.routePhase;ui.showMapView('explore',detail);}});});
   const stop=document.createElement('button');stop.type='button';stop.className='cu-back';stop.textContent='Stop directions';stop.addEventListener('click',()=>{navigation.stop();route.hidden=true;directions.hidden=false;detail.classList.remove('is-routing');window.dispatchEvent(new CustomEvent('campus-navigation-active',{detail:{active:false}}));ui.announce('Directions stopped');});route.append(stop);
   detail.append(back,header,text('p',`${b.abbreviation} · ${types[b.abbreviation]||'Campus building'}`),directions,route);ui.showMapView('explore',detail);
   // The named plate itself highlights the selection; a second pin would cover it.
   camera.moveTo(b,{zoom:18,animate:true});
 }
 input.addEventListener('input',render);document.getElementById('campus-search').addEventListener('submit',e=>{e.preventDefault();ui.setSnap('half');render();results.querySelector('button')?.focus();});document.getElementById('cu-saved').addEventListener('click',e=>{savedMode=!savedMode;e.currentTarget.setAttribute('aria-pressed',String(savedMode));input.value='';render();});
 try{const r=await fetch('Buildings.json');if(!r.ok)throw Error();buildings=await r.json();render();}catch{results.append(text('p','Campus places could not load. Refresh to try again.','cu-empty'));}
 // Replace the older dense marker layer with named, zoom-aware real campus buildings.
 map.eachLayer(layer=>{if(layer instanceof L.Marker&&layer.options?.title?.match(/\([A-Z0-9]+\)$/))map.removeLayer(layer);});
 const buildingLayer=L.layerGroup().addTo(map);
 for(const b of buildings){
  const labelName=names[b.abbreviation]||b.full_name;
  // Keep long, similar names distinguishable even when the two-line plate clips.
  const label=text('span',labelName.length>28?`${b.abbreviation} · ${labelName}`:labelName,'cu-building-label');
  const node=document.createElement('span');node.className='cu-building-marker';node.dataset.buildingCode=b.abbreviation;
  node.innerHTML=ui.icon(b.abbreviation==='GL'?'book':b.abbreviation==='GC'?'users':'map-pin');node.append(label);
  const m=L.marker([b.latitude,b.longitude],{title:names[b.abbreviation]||b.full_name,icon:L.divIcon({className:'cu-building-marker',html:node,iconSize:[120,58],iconAnchor:[60,29]})}).addTo(buildingLayer);
  m.on('click',()=>showBuilding(b));
 }
 let previousLabels=new Set(),layoutFrame=0;
 function layoutBuildingLabels(){
  const container=map.getContainer(),is3D=container.classList.contains('campus-active');
  const elements=[...container.querySelectorAll(is3D?'.campus-pin':'.leaflet-marker-pane>.cu-building-marker')];
  const obstacles=[...document.querySelectorAll('#campus-sheet,.cu-college-selector,#cu-account-controls,.campus-tools,.cu-map-zoom,.cu-map-actions,.cu-college-dropdown')]
   .filter(e=>!e.hidden&&getComputedStyle(e).visibility!=='hidden').map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height);
  // Verified hazards must remain unobscured even when they share a building.
  for(const alert of container.querySelectorAll(is3D?'.campus-pin:not([hidden]):has(.verified-warning-marker)':'.leaflet-marker-pane>.verified-warning-marker')){
   const rect=alert.getBoundingClientRect();if(rect.width&&rect.height)obstacles.push(rect);
  }
  const candidates=[];
  for(const element of elements){
   const plate=element.querySelector('.cu-building-marker[data-building-code]');if(!plate)continue;
   const code=plate.dataset.buildingCode,rect=plate.getBoundingClientRect();
   if(!element.hidden&&rect.width&&rect.height)candidates.push({code,rect,priority:(element===document.activeElement?3:selected?.abbreviation===code&&!detail.hidden?2:saved.includes(code)?1:0)});
  }
  const visible=chooseBuildingLabels(candidates,{viewport:container.getBoundingClientRect(),obstacles,previous:previousLabels});
  previousLabels=visible;
  for(const element of elements){const plate=element.querySelector('.cu-building-marker[data-building-code]');if(!plate)continue;
   const hide=!visible.has(plate.dataset.buildingCode);
   plate.classList.toggle('is-current',selected?.abbreviation===plate.dataset.buildingCode&&!detail.hidden);
   element.classList.toggle('cu-label-hidden',hide);element.setAttribute('aria-hidden',String(hide));element.tabIndex=hide?-1:0;
  }
 }
 const scheduleLabels=()=>{if(!layoutFrame)layoutFrame=requestAnimationFrame(()=>{layoutFrame=0;layoutBuildingLabels();});};
 api.layoutBuildingLabels=layoutBuildingLabels;
 map.on('move zoom resize moveend zoomend layeradd layerremove',scheduleLabels);
 window.addEventListener('campus-map-viewchange',scheduleLabels);window.addEventListener('campus-panel-layout',scheduleLabels);
 new ResizeObserver(scheduleLabels).observe(ui.sheet);
 document.fonts?.ready.then(scheduleLabels);
 scheduleLabels();api.showBuilding=showBuilding;
}
