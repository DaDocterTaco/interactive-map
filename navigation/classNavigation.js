import { createNavigation, createLeafletRenderer, DEFAULT_SPEEDS } from './index.js?v=mode-speeds-1';
import { createClassNavigationSession } from './classNavigationSession.js?v=mode-speeds-1';
const normalized = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function startSuggestions(places, value) {
  const q = normalized(value);
  if (!q) return [];
  return places.map(place => {
    const aliases = [place.id, place.name, ...(place.aliases || [])].map(normalized);
    const score = aliases.includes(q) ? 0 : aliases.some(a => a.startsWith(q)) ? 1 : aliases.some(a => a.includes(q)) ? 2 : 3;
    return { place, score };
  }).filter(item => item.score < 3).sort((a,b) => a.score-b.score || a.place.name.localeCompare(b.place.name)).slice(0,5).map(item => item.place);
}
export function exactStart(places, value) {
  const q=normalized(value);
  return places.find(p=>[p.id,p.name,...(p.aliases||[])].some(alias=>normalized(alias)===q));
}
export function routeReady(state, now=Date.now()) {
  if (!state?.route || state.status==='error') return false;
  if (state.source==='manual') return true;
  if (state.status==='arrived') return true;
  return ['navigating','arrived'].includes(state.status) && state.locationStatus==='good' &&
    !!state.position && now-state.position.timestamp<15000 && !state.offRoute;
}
// Planning never starts guidance, even when GPS is enabled elsewhere in the app.
export function routeAction(state, phase, now=Date.now()) {
  if (!['preview','active'].includes(phase)) return null;
  if (state?.source==='manual') return 'close-estimate';
  if (state?.source!=='live') return null;
  if (state.status==='arrived') return 'finish-guidance';
  if (phase==='active') return 'end-guidance';
  return routeReady(state,now) ? 'start-guidance' : null;
}
export function locationFeedback(state) {
  const messages={denied:'Location is blocked in your browser. Choose a start below.',outside:'You’re outside campus. Choose a campus starting point.',weak:'Your device’s location is too approximate. Choose a start below.',stale:'Your location is out of date. Retry or choose a start.',paused:'Live location is paused. Retry or choose a start.',stopped:'Live location is off. Choose a start or retry.',insecure:'Live location needs a secure connection (HTTPS). Choose a start below.',unavailable:'Your device couldn’t find your location. Choose a start below.',unsupported:'This browser can’t provide live location. Choose a start below.',timeout:'Your device didn’t return a location. Choose a start below.','boundary-error':'Campus location data couldn’t load. Retry or choose a start.',invalid:'Your device hasn’t found a reliable location. Choose a start below.'};
  if(state?.source==='manual')return null;
  return messages[state?.locationStatus]||null;
}


const node=(tag,value,cls)=>{const el=document.createElement(tag);if(value!=null)el.textContent=value;if(cls)el.className=cls;return el;};
const button=(label,cls)=>{const el=node('button',label,cls);el.type='button';return el;};
const errors={OUTSIDE_NETWORK:'That point is too far from a campus path. Try a nearby building.',NO_ROUTE:'No connected path was found. Try another start or travel mode.',UNRESOLVED_LOCATION:'Choose a suggested building or pick a point on the map.',INVALID_LOCATION:'Choose a campus building or pick a point on the map.',AMBIGUOUS_LOCATION:'Choose a specific building from the suggestions.',DATA_UNAVAILABLE:'Route data couldn’t load. Check your connection and retry.'};
const modeIcons={walk:'<circle cx="13" cy="4" r="2"/><path d="m10 8 3-1 3 5 3 1M7 13l3-5-1 8-3 5m3-5 5 1 2 4"/>',bike:'<circle cx="5" cy="16" r="4"/><circle cx="19" cy="16" r="4"/><path d="m5 16 5-9 5 9H5m10-13h3l2 13M8 7h5"/>',scooter:'<circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 19h6l5-6-2-10h-4m6 10 1 4"/>'};

/** Route setup, map preview, and live guidance share one GPS owner. */
export function createClassNavigation({map,L,locationServices,navigation=createNavigation({cacheSize:0})}) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const renderer=createLeafletRenderer({map,L,fitBounds:false});
  let panel,root,input,status,suggestions,showButton,liveButton,summaryMetric,summaryStatus,primary,summaryTitle,summaryOrigin,summaryKind,notes,noteList;
  let destination,finishCallback,currentRoute,lastState,phase='setup',picking=false,disposed=false,announced=false;
  let places=[],placesTask,results=[],activeOption=-1,inputTimer,frameTimer,committed='',manualLabel='',editing=false;
  let generation=0;
  const session=createClassNavigationSession({navigation,locationServices,renderer:{
    show(route){currentRoute=route;if(phase==='preview'||phase==='active'){renderer.show(route);if(phase==='preview')scheduleFrame();}},
    clear(){currentRoute=null;renderer.clear();},dispose(){renderer.dispose();}
  },onState(state){lastState=state;render();}});

  function announceGuidance(active){if(announced===active)return;announced=active;window.dispatchEvent(new CustomEvent('campus-navigation-active',{detail:{active}}));}
  function cancelPick(){map.off('click',pickOrigin);picking=false;map.getContainer().classList.remove('nav-picking-start');}
  function scheduleFrame(){clearTimeout(frameTimer);frameTimer=setTimeout(frame,reduced.matches?0:360);}
  function frame(){
    if(!destination||!root||root.closest('[hidden],[inert]')||picking||phase==='setup')return;
    if(phase==='active'&&lastState?.source==='live'&&routeReady(lastState))return;
    const points=currentRoute?currentRoute.geometry.coordinates.map(([lng,lat])=>[lat,lng]):[[destination.latitude,destination.longitude]];
    points.push([destination.latitude,destination.longitude]);
    const height=map.getSize().y,sheet=window.CampusUI?.sheet;
    const bottom=sheet?Math.max(0,height-sheet.getBoundingClientRect().top)+24:Math.min(panel.getBoundingClientRect().height+30,height*.6);
    map.invalidateSize({pan:false});map.stop();window.CampusApp?.camera.explore();
    const top=Math.min(innerWidth<=640?145:110,Math.max(24,height-bottom-100));
    if(map.campusExperience?.active&&map.campusExperience.frameRoute){map.campusExperience.frameRoute(points,{top,bottom,padding:36,animate:!reduced.matches});return;}
    map.flyToBounds(L.latLngBounds(points),{paddingTopLeft:[36,top],paddingBottomRight:[36,bottom],maxZoom:18,animate:!reduced.matches,duration:.5});
  }
  function setPhase(next){
    phase=next;root.dataset.phase=next;panel.dataset.routePhase=next;
    const place=panel.closest('#place-detail');if(place)place.dataset.routePhase=next;
    if(next!=='active'){announceGuidance(false);window.CampusApp?.camera.explore();}
    if(next==='setup'){renderer.clear();window.CampusUI?.setSnap('full');}
    else {if(currentRoute&&next!=='picking')renderer.show(currentRoute);window.CampusUI?.setSnap('map');}
    const host=root.closest('.cu-page');if(host)host.scrollTop=0;
    render();if(next==='preview')scheduleFrame();
  }
  function render(){
    if(!root||disposed)return;
    const state=lastState,ready=routeReady(state)&&!editing;
    root.dataset.status=state?.status||'waiting';
    root.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===(state?.mode||'walk'))));
    const issue=state?.status==='error'?(errors[state.error?.code]||'The route couldn’t load. Try another start.'):locationFeedback(state);
    if(!editing){
      status.textContent=issue||((state?.source==='manual'&&ready)?'Starting point selected.':state?.source==='live'&&ready?'Live location connected.':state?.status==='routing'||state?.status==='resolving'?'Finding your route…':'Finding your location…');
      status.dataset.tone=issue?'error':ready?'success':'waiting';
      if(state?.source==='live'&&ready){input.value='Current location';committed='';manualLabel='';}
      else if(state?.source==='live'&&input.value==='Current location'&&!ready)input.value='';
    }
    liveButton.textContent=state?.source==='manual'?'Use live location':issue?'Retry location':'Live location';
    liveButton.disabled=state?.source==='live'&&!issue;
    showButton.disabled=!ready;showButton.textContent=state?.source==='manual'?'See travel time':'Show route';
    const metric=state?.source==='live'&&phase==='active'?state?.progress&&{seconds:state.progress.remainingDurationSeconds,metres:state.progress.remainingDistanceMeters}:state?.route&&{seconds:state.route.durationSeconds,metres:state.route.distanceMeters};
    summaryMetric.textContent=metric?`${Math.max(1,Math.ceil(metric.seconds/60))} min · ${metric.metres<1000?Math.round(metric.metres)+' m':(metric.metres/1000).toFixed(1)+' km'}`:'Route unavailable';
    summaryOrigin.textContent=state?.source==='manual'?`From ${manualLabel||state.originLabel}`:'From your current location';
    summaryKind.textContent=state?.source==='manual'?({walk:'Walking estimate',bike:'Cycling estimate',scooter:'Scooter estimate'}[state.mode]||'Travel time estimate'):phase==='active'?'GPS guidance':'Route preview';
    summaryKind.parentElement.setAttribute('aria-label',state?.source==='manual'?'Travel time estimate':'Route preview');
    const assumedMph=Math.round(DEFAULT_SPEEDS[state?.mode||'walk']/0.44704);
    summaryStatus.textContent=state?.source==='manual'?`Based on ${assumedMph} mph · time may vary.`:state?.status==='arrived'?'You’re near your destination.':phase==='active'?(issue||(state?.offRoute?'Updating your route…':'Following your location')):issue||'Ready when you are';
    summaryStatus.dataset.tone=issue?'error':'normal';
    const action=routeAction(state,phase);
    primary.textContent=({'close-estimate':'Close estimate','finish-guidance':'Finish route','end-guidance':'End route','start-guidance':'Start route'})[action]||'Start route';
    primary.disabled=!action;
    noteList.replaceChildren(...(state?.route?.warnings||[]).map(value=>node('li',value)));notes.hidden=!state?.route?.warnings?.length;
    if(phase==='active')announceGuidance(state?.source==='live'&&ready&&state.status!=='arrived');
  }
  function closeSuggestions(){suggestions.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');activeOption=-1;}
  function updateSuggestions(){
    results=startSuggestions(places,input.value);suggestions.replaceChildren();activeOption=-1;
    for(const [i,place] of results.entries()){
      const option=button('', 'nav-start-option');option.id=`nav-start-option-${i}`;option.setAttribute('role','option');option.setAttribute('aria-selected','false');
      option.append(node('strong',place.name),node('span',place.id));option.addEventListener('pointerdown',e=>e.preventDefault());
      option.addEventListener('click',()=>choosePlace(place));suggestions.append(option);
    }
    suggestions.hidden=!results.length;input.setAttribute('aria-expanded',String(!!results.length));
  }
  function loadPlaces(){return placesTask||=fetch(new URL('./data/campus-places.json',import.meta.url)).then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{places=data.places.map(p=>({...p,aliases:[...(p.aliases||[]),...(p.id==='GL'?['Green Library']:p.id==='GC'?['Graham Center']:[])]}));return places;}).catch(()=>{placesTask=null;return [];});}
  function choosePlace(place){input.value=`${place.name} (${place.id})`;closeSuggestions();void useManual(place.id,place.name);}
  async function useManual(value,label=value){
    clearTimeout(inputTimer);cancelPick();editing=false;committed=input.value.trim();manualLabel=label;announceGuidance(false);
    await session.useManual(value);
  }
  function commitInput(){
    const value=input.value.trim();if(!value||value===committed||value==='Current location')return;
    const exact=exactStart(places,value);if(exact)choosePlace(exact);else void useManual(value,value);
  }
  function beginPick(){
    clearTimeout(inputTimer);closeSuggestions();cancelPick();editing=false;announceGuidance(false);window.CampusApp?.camera.explore();
    picking=true;map.getContainer().classList.add('nav-picking-start');map.once('click',pickOrigin);setPhase('picking');
    map.closePopup();if(map.campusExperience?.active)map.campusExperience.overview();else map.flyToBounds([[25.7516,-80.3842],[25.7611,-80.3682]],{animate:!reduced.matches});
  }
  function pickOrigin(event){
    cancelPick();const point=event.latlng;
    const nearby=places.map(p=>({place:p,distance:map.distance(point,[p.lat,p.lng])})).sort((a,b)=>a.distance-b.distance)[0];
    if(nearby?.distance<=28)choosePlace(nearby.place);
    else {input.value=`${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;void useManual(input.value,'Selected map point');}
    setPhase('setup');input.focus({preventScroll:true});
  }
  function finish(){const done=finishCallback;stop();if(done)done();else{panel.hidden=true;window.CampusUI?.closeToMap();}}
  function mount(target){
    if(panel&&panel!==target){panel.classList.remove('has-class-navigation');delete panel.dataset.routePhase;const prior=panel.closest('#place-detail');if(prior)delete prior.dataset.routePhase;}
    panel=target;panel.classList.add('has-class-navigation');
    if(root){panel.append(root);return;}
    root=node('section','', 'nav-class-route');root.setAttribute('aria-label','Campus directions');
    const setup=node('div','', 'nav-setup');
    const modes=node('div','', 'nav-mode-group');modes.setAttribute('role','group');modes.setAttribute('aria-label','Travel by');
    for(const [value,label] of [['walk','Walk'],['bike','Bike'],['scooter','Scooter']]){
      const b=button('', 'nav-mode');b.dataset.mode=value;b.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${modeIcons[value]}</svg>`;b.append(node('span',label));
      b.addEventListener('click',()=>{cancelPick();void session.setMode(value);});modes.append(b);
    }
    const form=node('form','', 'nav-start-form'),label=node('label','Starting point');label.htmlFor='nav-start-input';
    input=document.createElement('input');input.id='nav-start-input';input.type='text';input.placeholder='Search a campus building';input.maxLength=180;input.autocomplete='off';input.setAttribute('role','combobox');input.setAttribute('aria-label','Starting point');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('aria-controls','nav-start-suggestions');input.setAttribute('aria-describedby','nav-start-status');
    suggestions=node('div','', 'nav-start-suggestions');suggestions.id='nav-start-suggestions';suggestions.setAttribute('role','listbox');suggestions.setAttribute('aria-label','Starting point suggestions');suggestions.hidden=true;
    status=node('p','Finding your location…','nav-class-status');status.id='nav-start-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const actions=node('div','', 'nav-start-actions');liveButton=button('Live location','nav-start-live');const pick=button('Pick on map','nav-start-pick');actions.append(liveButton,pick);
    form.append(label,input,suggestions,status,actions);
    showButton=button('Show route','nav-primary nav-show');showButton.disabled=true;
    setup.append(node('h3','Travel by','nav-label'),modes,form,showButton);
    const preview=node('section','', 'nav-preview');preview.setAttribute('aria-label','Route preview');
    summaryKind=node('p','', 'nav-preview-kind');
    const topline=node('div','', 'nav-preview-top');summaryTitle=node('h2','', 'nav-preview-title');summaryMetric=node('strong','', 'nav-preview-metric');topline.append(summaryTitle,summaryMetric);
    summaryOrigin=node('p','', 'nav-preview-origin');summaryStatus=node('p','', 'nav-preview-status');summaryStatus.setAttribute('role','status');
    const previewActions=node('div','', 'nav-preview-actions');const back=button('Edit route','nav-secondary');primary=button('Start route','nav-primary');previewActions.append(back,primary);
    notes=document.createElement('details');notes.className='nav-class-notes';noteList=node('ul');notes.append(node('summary','Route details'),noteList);
    preview.append(summaryKind,topline,summaryOrigin,summaryStatus,previewActions,notes);
    const picker=node('section','', 'nav-picker');const cancel=button('Cancel','nav-secondary');picker.append(node('h2','Tap your starting point'),node('p','Choose a building or path on the map.'),cancel);
    root.append(setup,preview,picker);panel.append(root);
    input.addEventListener('input',()=>{
      clearTimeout(inputTimer);editing=true;showButton.disabled=true;status.dataset.tone='waiting';status.textContent='Choose a suggestion or pick on the map.';updateSuggestions();
      const value=input.value.trim();if(exactStart(places,value)||/^[+-]?[\d.]+\s*,\s*[+-]?[\d.]+$/.test(value))inputTimer=setTimeout(commitInput,450);
    });
    input.addEventListener('focus',()=>{if(input.value==='Current location')input.select();else updateSuggestions();});
    input.addEventListener('blur',()=>{setTimeout(closeSuggestions,120);if(editing&&input.value.trim())commitInput();});
    input.addEventListener('keydown',e=>{
      if(['ArrowDown','ArrowUp'].includes(e.key)&&results.length){e.preventDefault();activeOption=(activeOption+(e.key==='ArrowDown'?1:-1)+results.length)%results.length;[...suggestions.children].forEach((n,i)=>n.setAttribute('aria-selected',String(i===activeOption)));input.setAttribute('aria-activedescendant',suggestions.children[activeOption].id);}
      else if(e.key==='Enter'){e.preventDefault();if(activeOption>=0)choosePlace(results[activeOption]);else commitInput();closeSuggestions();}
      else if(e.key==='Escape'&&!suggestions.hidden){e.preventDefault();e.stopPropagation();closeSuggestions();}
    });
    form.addEventListener('submit',e=>{e.preventDefault();commitInput();});
    liveButton.addEventListener('click',()=>{clearTimeout(inputTimer);cancelPick();closeSuggestions();editing=false;input.value='';committed='';manualLabel='';void session.useLive();});
    pick.addEventListener('click',beginPick);
    cancel.addEventListener('click',()=>{cancelPick();setPhase('setup');});
    showButton.addEventListener('click',()=>{if(routeReady(lastState)&&!editing){setPhase('preview');primary.focus({preventScroll:true});}});
    back.addEventListener('click',()=>{setPhase('setup');input.focus({preventScroll:true});});
    primary.addEventListener('click',()=>{
      const action=routeAction(lastState,phase);
      if(action==='start-guidance'){setPhase('active');announceGuidance(true);}
      else if(action){finish();}
    });
  }
  const onLayout=()=>{if(destination&&phase==='preview')scheduleFrame();};
  const onView=()=>{if(destination&&phase==='preview')scheduleFrame();};
  const onTab=()=>{if(destination&&phase==='setup'&&!root?.closest('[hidden],[inert]'))window.CampusUI?.setSnap('full');};
  window.addEventListener('campus-panel-layout',onLayout);window.addEventListener('campus-map-viewchange',onView);window.addEventListener('campus-tab-change',onTab);
  function stop(){
    generation++;phase='idle';if(root)root.dataset.phase='idle';clearTimeout(inputTimer);clearTimeout(frameTimer);cancelPick();destination=null;announceGuidance(false);map.stop();session.stop();renderer.clear();
  }
  function dispose(){if(disposed)return;stop();disposed=true;session.dispose();root?.remove();map.off('unload',dispose);window.removeEventListener('campus-panel-layout',onLayout);window.removeEventListener('campus-map-viewchange',onView);window.removeEventListener('campus-tab-change',onTab);}
  map.on('unload',dispose);
  return {
    async start({location,panel:target,onFinish}){
      const token=++generation;cancelPick();announceGuidance(false);mount(target);destination=location.building;finishCallback=onFinish;editing=false;committed='';manualLabel='';input.value='';closeSuggestions();
      summaryTitle.textContent=location.room?`${location.building.code} · Room ${location.room}`:location.building.name||'Your destination';
      setPhase('setup');void loadPlaces();await session.start({to:location.building,preferLive:true});if(token!==generation)return;
    },
    frame,
    getState:()=>({...session.getState(),phase}),stop,dispose,
  };
}
