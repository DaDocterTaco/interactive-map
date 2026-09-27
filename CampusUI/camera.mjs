import {createDirectionTracker,headingDelta} from '../locationservices/direction.mjs';
/** GPS ownership is independent of camera ownership: browsing never stops GPS. */
export function visibleMapAnchor({width,height,panelTop,topInset=82,navigating=false}) {
  const bottom=Math.min(height,Math.max(topInset+80,Number.isFinite(panelTop)?panelTop-16:height-20));
  return {x:width/2,y:topInset+(bottom-topInset)*(navigating?.62:.5)};
}
export function usableFix(fix,now=Date.now()) {
  return !!fix&&Number.isFinite(fix.latitude)&&Math.abs(fix.latitude)<=90&&
    Number.isFinite(fix.longitude)&&Math.abs(fix.longitude)<=180&&
    Number.isFinite(fix.accuracy)&&fix.accuracy>=0&&
    now-fix.timestamp<30000&&fix.timestamp<=now+5000;
}
export function walkingZoom(accuracy,maxZoom=19) {
  return Math.min(maxZoom,accuracy<=50?19:accuracy<=150?18:accuracy<=400?17:16);
}
export function createCampusCamera({map,locationServices,ui,now=Date.now,directionFactory=createDirectionTracker}) {
  let mode='explore',latest=null,navigating=false,layoutTimer,moving=false,disposed=false;
  let lastDrawn=null,focusedPlace=null,firstFollow=false,precisionPending=false;
  let locationStatus='idle',overviewing=true;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const button=document.getElementById('cu-recenter'),feedback=document.getElementById('cu-location-feedback');
  const terminal=new Set(['denied','stopped','timeout','unavailable','insecure','unsupported','boundary-error']);
  const live=()=>usableFix(latest,now())&&['tracking','weak','outside'].includes(locationStatus);
  let heading=null,lastHeading=null,compassNotice='';
  const direction=directionFactory({now,onChange:s=>{
    if(disposed)return;
    heading=Number.isFinite(s.heading)?s.heading:null;
    locationServices.setHeading?.(heading);
    if(heading!==null){
      compassNotice='';
      if(mode==='follow'&&live()&&map.campusExperience?.active&&
        (lastHeading===null||Math.abs(headingDelta(lastHeading,heading))>=3))follow({force:true});
    }else if(['denied','unsupported','insecure','unavailable','stale'].includes(s.status)){
      const message=s.status==='denied'?'Compass access is off. Your location still works.':
        'Compass direction unavailable. Your location still works.';
      if(compassNotice!==message){compassNotice=message;ui.announce(message);}
    }
    updateButton();
  }});
  locationServices.setFollowing(false);
  function updateZoomButtons(){
    const plus=document.querySelector?.('.cu-map-zoom [data-zoom="1"]');
    const minus=document.querySelector?.('.cu-map-zoom [data-zoom="-1"]');
    if(plus)plus.disabled=map.getZoom()>=map.getMaxZoom()-.01;
    if(minus)minus.disabled=map.getZoom()<=14.01;
  }
  map.on('zoomend',updateZoomButtons);updateZoomButtons();
  function state(){return {mode,navigating,heading,fix:latest?{...latest}:null};}
  function updateButton(){
    const following=mode==='follow'&&live(),busy=locationStatus==='locating'||locationStatus==='preparing';
    const label=busy?'Finding your location':following?(heading!==null?'Following your location and direction':'Following your location'):terminal.has(locationStatus)&&locationStatus!=='stopped'?
      'Retry my location':latest?'Recenter and follow my location':'Find my location';
    button.setAttribute('aria-pressed',String(following));button.setAttribute('aria-label',label);
    button.title=label;button.setAttribute('aria-busy',String(busy));button.dataset.mode=following?'follow':'explore';
    window.dispatchEvent(new CustomEvent('campus-camera-state',{detail:state()}));
  }
  function frame(point,{zoom,animate=true,northUp=false}={}){
    const size=map.getSize(),rect=ui.sheet.getBoundingClientRect();
    const directional=mode==='follow'&&live()&&heading!==null;
    const anchor=visibleMapAnchor({width:size.x,height:size.y,panelTop:rect.top,topInset:innerWidth<=640?80:100,navigating:navigating||directional});
    const z=zoom??map.getZoom();
    if(map.campusExperience?.active){
      map.campusExperience.focusAt({lat:point.latitude,lng:point.longitude},z,anchor,{animate:animate&&!reduced.matches,northUp,heading:directional?heading:null});
      lastHeading=directional?heading:null;
    }else{
      const target=map.project([point.latitude,point.longitude],z);
      const center=map.unproject([target.x+size.x/2-anchor.x,target.y+size.y/2-anchor.y],z);
      moving=true;map.stop();map.setView(center,z,{animate:animate&&!reduced.matches,duration:.4});moving=false;
    }
    lastDrawn={latitude:point.latitude,longitude:point.longitude};
  }
  function moveTo(point,options){overviewing=false;mode='explore';focusedPlace={point,options};updateButton();frame(point,options);}
  function follow({force=false}={}){
    if(mode!=='follow'||!live())return;
    const improve=precisionPending&&latest.accuracy<=50;
    const distance=lastDrawn?map.distance([lastDrawn.latitude,lastDrawn.longitude],[latest.latitude,latest.longitude]):Infinity;
    if(!force&&!firstFollow&&!improve&&distance<Math.min(4,Math.max(1,latest.accuracy*.1)))return;
    if(locationStatus==='outside'&&map.campusExperience?.active)map.campusExperience.show2D();
    frame(latest,{zoom:firstFollow||improve?walkingZoom(latest.accuracy,map.getMaxZoom()):undefined,northUp:firstFollow});
    if(firstFollow)precisionPending=latest.accuracy>50;
    if(improve)precisionPending=false;
    firstFollow=false;
  }
  async function recenter(){
    void direction.start();
    overviewing=false;mode='follow';focusedPlace=null;firstFollow=true;
    ui.setSnap?.('peek');updateButton();
    if(live()){feedback.hidden=!['outside','weak'].includes(locationStatus);follow({force:true});ui.announce('Following your location');return;}
    feedback.textContent='Finding your location…';feedback.hidden=false;await locationServices.start();
  }
  function explore(){if(moving)return;overviewing=false;focusedPlace=null;precisionPending=false;mode='explore';updateButton();}
  function zoomBy(delta){
    const current=map.getZoom(),z=Math.max(Math.max(14,map.getMinZoom?.()??14),Math.min(map.getMaxZoom(),current+delta));
    precisionPending=false;
    if(Math.abs(z-current)<.01){ui.announce(delta>0?'Closest map view':'Widest map view');return;}
    if(mode==='follow'&&live())frame(latest,{zoom:z});
    else if(map.campusExperience?.active)map.campusExperience.zoomTo(z);
    else map.setZoom(z,{animate:!reduced.matches});
    ui.announce(delta>0?'Zoomed in':'Zoomed out');
  }
  const errors={denied:'Location is blocked. Allow it in your browser, then tap Recenter.',insecure:'Live location needs a secure connection. You can still browse campus.',unsupported:'This device cannot share location. You can still search campus.',unavailable:'Location is unavailable. Check your device settings, then retry.',timeout:'Location timed out. Move into a clearer area and tap Recenter to retry.',weak:'Location is approximate. The blue circle shows its accuracy.',outside:'You are outside campus. Recenter shows your location on the 2D map.',stale:'Waiting for a fresh location. Following is paused.',paused:'Location paused while the app was hidden. Tap Recenter to resume.','boundary-error':'Campus location data could not load. Tap Recenter to retry.'};
  const unsub=locationServices.subscribe(s=>{
    if(disposed)return;locationStatus=s.status;
    if(s.fix&&usableFix(s.fix,now()))latest={...s.fix};
    if(terminal.has(s.status)){latest=null;mode='explore';firstFollow=false;precisionPending=false;direction.stop();}
    else if(s.status==='paused'||s.status==='stale')direction.stop();
    feedback.textContent=errors[s.status]||(['locating','preparing'].includes(s.status)?'Finding your location…':'');
    feedback.hidden=!feedback.textContent;updateButton();
    if(s.markerVisible||s.status==='outside')follow();
  });
  button.addEventListener('click',recenter);map.on('dragstart',explore);
  const container=map.getContainer();container.addEventListener('wheel',explore,{passive:true});
  window.addEventListener('campus-map-interaction',explore);
  const onZoom=event=>zoomBy(event.detail?.delta||1);window.addEventListener('campus-map-zoom',onZoom);
  const onLayout=()=>{
    clearTimeout(layoutTimer);layoutTimer=setTimeout(()=>{
      if(mode==='follow')follow({force:true});
      else if(focusedPlace)frame(focusedPlace.point,focusedPlace.options);
      else if(overviewing&&map.campusExperience?.active)frame({latitude:25.75665,longitude:-80.3747});
    },100);
  };
  window.addEventListener('campus-panel-layout',onLayout);
  window.addEventListener('campus-map-viewchange',onLayout);
  const onOverview=()=>{
    overviewing=true;focusedPlace=null;mode='explore';updateButton();map.campusExperience?.overview?.();
    if(!map.campusExperience?.active)map.setView([25.7562,-80.3748],16);
  };
  window.addEventListener('campus-overview',onOverview);
  const onNavigate=event=>{
    navigating=event.detail?.active!==false;
    if(navigating){mode='follow';overviewing=false;focusedPlace=null;firstFollow=true;follow({force:true});}
    updateButton();
  };
  window.addEventListener('campus-navigation-active',onNavigate);updateButton();
  return {recenter,explore,moveTo,zoomBy,getState:state,frame,dispose(){
    disposed=true;direction.dispose();locationServices.setHeading?.(null);unsub();clearTimeout(layoutTimer);map.off('dragstart',explore);map.off('zoomend',updateZoomButtons);button.removeEventListener('click',recenter);
    container.removeEventListener('wheel',explore);window.removeEventListener('campus-map-interaction',explore);
    window.removeEventListener('campus-map-zoom',onZoom);window.removeEventListener('campus-panel-layout',onLayout);
    window.removeEventListener('campus-map-viewchange',onLayout);
    window.removeEventListener('campus-overview',onOverview);window.removeEventListener('campus-navigation-active',onNavigate);
  }};
}

