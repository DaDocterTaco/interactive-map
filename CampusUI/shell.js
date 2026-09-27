/* Shared panel: feature controllers retain their state and subscriptions. */
(() => {
 const assetRoot=new URL('CampusUI/icons/',document.baseURI);
 const icon=n=>`<span class="cu-icon" aria-hidden="true" style="--icon:url('${new URL(n+'.svg',assetRoot).href}')"></span>`;
 const tabs=[['explore','Explore','compass'],['classes','Classes','school'],['events','Events','calendar-event'],['community','Community','users'],['assistant','Assistant','sparkles']];
 const legacy=document.createElement('nav');legacy.id='action-bar';legacy.hidden=true;
 legacy.innerHTML='<div id="action-bar-actions"><button id="open-location"><strong>Locate me</strong><small id="location-status" role="status"></small></button><button id="stop-location">Stop location</button><button id="open-class">Classes</button><button id="open-events">Events</button><button id="open-chat" disabled>Chat</button><button id="open-assistant">Assistant</button></div>';
 document.querySelector('.app-shell').append(legacy);
 const collegeSelector=document.createElement('div');collegeSelector.className='cu-college-selector';
 const brand=document.createElement('button');brand.type='button';brand.className='cu-brand';brand.setAttribute('aria-label','Select college, FIU Navigator');brand.setAttribute('aria-haspopup','menu');brand.setAttribute('aria-expanded','false');brand.setAttribute('aria-controls','cu-college-menu');brand.title='Select college';brand.innerHTML=`<img src="CampusUI/fiu-logo.png" alt="" width="52" height="25"><span>Navigator</span>${icon('chevron-down')}`;
 const collegeDropdown=document.createElement('section');collegeDropdown.className='cu-college-dropdown';collegeDropdown.hidden=true;
 collegeDropdown.innerHTML=`<h2 id="cu-college-heading">Select college</h2><div id="cu-college-menu" role="menu" aria-labelledby="cu-college-heading" aria-describedby="cu-college-note"><button type="button" class="cu-college-option" role="menuitemradio" aria-checked="true" tabindex="-1"><img src="CampusUI/fiu-logo.png" alt="" width="42" height="24"><span><strong>FIU Navigator</strong><small>Florida International University</small></span>${icon('check')}</button></div><p id="cu-college-note">FIU is the only college currently available.</p>`;
 collegeSelector.append(brand,collegeDropdown);document.querySelector('.app-shell').append(collegeSelector);
 const collegeOption=collegeDropdown.querySelector('.cu-college-option');
 function setCollegeOpen(open,{restoreFocus=false}={}){collegeDropdown.hidden=!open;brand.setAttribute('aria-expanded',String(open));if(open)collegeOption.focus({preventScroll:true});else if(restoreFocus)brand.focus({preventScroll:true});}
 brand.addEventListener('click',()=>setCollegeOpen(collegeDropdown.hidden));
 collegeOption.addEventListener('click',()=>{setCollegeOpen(false,{restoreFocus:true});window.dispatchEvent(new Event('campus-overview'));});
 collegeSelector.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&!collegeDropdown.hidden){e.preventDefault();e.stopPropagation();setCollegeOpen(false,{restoreFocus:true});}
  else if(['ArrowDown','ArrowUp'].includes(e.key)||(!collegeDropdown.hidden&&['Home','End'].includes(e.key))){e.preventDefault();setCollegeOpen(true);}
 });
 document.addEventListener('pointerdown',e=>{if(!collegeSelector.contains(e.target))setCollegeOpen(false);});
 collegeSelector.addEventListener('focusout',e=>{if(!collegeSelector.contains(e.relatedTarget))setCollegeOpen(false);});
 const sheet=document.createElement('section');sheet.id='campus-sheet';sheet.dataset.snap='peek';sheet.dataset.tab='explore';sheet.setAttribute('aria-label','Campus explorer');
 sheet.innerHTML=`<button id="sheet-handle" class="cu-handle" type="button" aria-label="Expand campus panel" aria-expanded="false" aria-controls="sheet-content"><span></span></button><button class="cu-collapse" type="button" aria-label="Collapse campus panel">${icon('chevron-down')}</button><div id="sheet-content" class="cu-content">${tabs.map(([id])=>`<section id="page-${id}" class="cu-page" role="tabpanel" aria-labelledby="tab-${id}" ${id==='explore'?'':'hidden inert'}></section>`).join('')}</div><nav class="cu-tabs" role="tablist" aria-label="Campus features">${tabs.map(([id,label,glyph])=>`<button type="button" id="tab-${id}" role="tab" aria-controls="page-${id}" aria-selected="${id==='explore'}" tabindex="${id==='explore'?0:-1}" data-tab="${id}">${icon(glyph)}<span>${label}</span></button>`).join('')}</nav>`;
 document.body.append(sheet);
 const controls=document.createElement('aside');controls.className='cu-map-actions';controls.setAttribute('aria-label','Location and reporting');controls.innerHTML=`<p id="cu-location-feedback" role="status" aria-live="polite" hidden></p><button id="cu-recenter" type="button" class="cu-recenter" aria-label="Find my location" title="Find my location" aria-pressed="false">${icon('current-location')}</button><button id="cu-report" type="button" class="cu-report">${icon('alert-triangle')}<span>Report</span></button>`;document.body.append(controls);
 const zoom=document.createElement('aside');zoom.className='cu-map-zoom';zoom.setAttribute('aria-label','Map zoom and gestures');zoom.innerHTML='<button type="button" aria-label="Zoom in" data-zoom="1">+</button><button type="button" aria-label="Zoom out" data-zoom="-1">−</button><button type="button" aria-label="How to move the map" aria-expanded="false" aria-controls="cu-gesture-help" id="cu-gesture-button">?</button><p id="cu-gesture-help" hidden><strong>Move around campus</strong><br>Drag with one finger to move.<br>Pinch with two fingers to zoom and pan.<br>Double-tap to zoom in.<br>Tap Recenter to follow your location.</p>';document.body.append(zoom);
 zoom.addEventListener('click',e=>{const b=e.target.closest('[data-zoom]');if(b)window.dispatchEvent(new CustomEvent('campus-map-zoom',{detail:{delta:Number(b.dataset.zoom)}}));});
 document.getElementById('cu-gesture-button').addEventListener('click',e=>{const help=document.getElementById('cu-gesture-help');help.hidden=!help.hidden;e.currentTarget.setAttribute('aria-expanded',String(!help.hidden));});
 const toast=document.createElement('p');toast.className='cu-toast';toast.setAttribute('role','status');toast.hidden=true;document.body.append(toast);
 document.getElementById('page-explore').innerHTML=`<div class="cu-explore-home"><h1>Where are you headed?</h1><form class="cu-search" id="campus-search" role="search">${icon('search')}<input id="campus-query" type="search" aria-label="Search campus or classes" placeholder="Where are you headed?" autocomplete="off" maxlength="100"><button type="submit" class="cu-sr">Search</button></form><div class="cu-explore-body"><div class="cu-section-heading"><h2 id="places-heading">Recent</h2><button id="cu-saved" type="button" aria-pressed="false">${icon('bookmark')}Saved places</button></div><div id="campus-results" aria-live="polite"></div></div></div><section id="place-detail" hidden></section>`;
 const community=document.getElementById('page-community');community.innerHTML=`<section id="community-home" class="cu-hub"><h1>Community</h1><p>Find your people. Stay in the loop.</p><button data-community="pulse">${icon('activity')}<span><strong>Campus Pulse</strong><small>Find people for coffee, food or a chat.</small></span>${icon('chevron-right')}</button><button data-community="chat">${icon('message-circle')}<span><strong>Chats & forums</strong><small>Conversations with other Panthers</small></span>${icon('chevron-right')}</button><button data-community="report">${icon('alert-triangle')}<span><strong>Report a problem</strong><small>Help others get around campus</small></span>${icon('chevron-right')}</button><button id="cu-open-terms" type="button">${icon('book')}<span><strong>Terms &amp; Conditions</strong><small>Read how to use Navigator</small></span>${icon('chevron-right')}</button><p id="community-feedback" role="status"></p></section><button id="community-back" class="cu-back" hidden>${icon('arrow-left')}Community</button>`;
 let current='explore',snap='peek',drag,suppressClick=false,timer,pendingReport=false;
 const registrations=new Map(),mapViews=new Map(),small=()=>innerWidth<=640;
 function viewportHeight(){return window.CampusInput.getViewport().height;}
 let keyboardHeight=null;
 function sizes(){
   const h=viewportHeight(),view=mapViews.get(current),chrome=sheet.querySelector('.cu-handle').offsetHeight+sheet.querySelector('.cu-tabs').offsetHeight;
   const natural=view?Math.ceil(view.node.getBoundingClientRect().height)+chrome:208;
   const compact=Math.min(Math.max(208,natural),Math.min(420,Math.max(208,h*.48)),h-80);
   return {peek:Math.min(208,h-24),map:compact,half:Math.min(small()?(current==='explore'?400:520):620,h-88),full:Math.max(160,h-(small()?80:100))};
 }
 function clearMapView(tab,{restore=true}={}){
   const view=mapViews.get(tab);if(!view)return;
   view.observer.disconnect();mapViews.delete(tab);view.node.hidden=true;if(view.node.classList.contains('cu-map-card'))view.node.remove();
   for(const [node,hidden] of view.siblings)node.hidden=hidden;
   document.getElementById('page-'+tab).classList.remove('cu-map-view');
   if(current===tab&&restore)setSnap(view.returnSnap);
 }
 function showMapView(tab,node){
   const previous=mapViews.get(tab);const returnSnap=previous?.returnSnap||(['half','full'].includes(snap)?snap:'half');
   if(previous?.node!==node)clearMapView(tab,{restore:false});
   activate(tab,{launch:false,expand:false});
   const page=document.getElementById('page-'+tab);page.append(node);node.hidden=false;page.scrollTop=0;page.classList.add('cu-map-view');
   if(!mapViews.has(tab)){
     const siblings=[...page.children].filter(child=>child!==node).map(child=>[child,child.hidden]);
     for(const [child] of siblings)child.hidden=true;
     const observer=new ResizeObserver(()=>{if(current===tab&&snap==='map')setSnap('map');});
     mapViews.set(tab,{node,siblings,observer,returnSnap});observer.observe(node);
   }
   setSnap('map');
 }
 function showMapCard(tab,{title,description='',backLabel='Back',onBack}){
   const card=document.createElement('section');card.className='cu-map-card';
   const back=document.createElement('button');back.type='button';back.className='cu-back';back.innerHTML=icon('arrow-left');back.append(document.createTextNode(backLabel));
   const heading=document.createElement('h2');heading.textContent=title;
   const detail=document.createElement('p');detail.textContent=description;
   card.append(back,heading,detail);back.addEventListener('click',()=>{clearMapView(tab);onBack?.();card.remove();});
   showMapView(tab,card);back.focus({preventScroll:true});return card;
 }
 function publish(){const r=sheet.getBoundingClientRect();document.body.classList.toggle('cu-map-obscured',small()&&r.top<220);document.documentElement.style.setProperty('--sheet-top',`${r.top}px`);document.documentElement.style.setProperty('--sheet-height',`${r.height}px`);window.dispatchEvent(new CustomEvent('campus-panel-layout',{detail:{tab:current,snap,height:r.height,rect:{top:r.top,left:r.left,right:r.right,bottom:r.bottom}}}));}
 function setSnap(value,{focus=false}={}){snap=['peek','map','half','full'].includes(value)?value:'half';sheet.dataset.snap=snap;sheet.style.height=`${keyboardHeight===null?sizes()[snap]:Math.min(keyboardHeight,Math.max(0,viewportHeight()-8))}px`;const h=sheet.querySelector('.cu-handle');h.setAttribute('aria-expanded',String(snap!=='peek'));h.setAttribute('aria-label',snap==='peek'?'Expand campus panel':(snap==='half'||snap==='map')?'Expand campus panel fully':'Collapse campus panel');document.getElementById('campus-query').placeholder=snap==='peek'?'Where are you headed?':'Search campus or classes';if(focus)document.getElementById(`tab-${current}`).focus({preventScroll:true});publish();}
 function announce(message){clearTimeout(timer);toast.textContent=message;toast.hidden=!message;timer=setTimeout(()=>toast.hidden=true,4200);}
 function activate(id,{expand=true,launch=true}={}){if(!tabs.some(t=>t[0]===id))return;if(id!==current&&window.CampusInput.isMobile()&&window.CampusInput.isTextField(document.activeElement))document.activeElement.blur();current=id;sheet.dataset.tab=id;for(const [key] of tabs){const page=document.getElementById(`page-${key}`);page.hidden=key!==id;page.inert=key!==id;const t=document.getElementById(`tab-${key}`);t.setAttribute('aria-selected',String(key===id));t.tabIndex=key===id?0:-1;}if(expand){if(mapViews.has(id))setSnap('map');else if(snap==='peek'||snap==='half'||snap==='map')setSnap(id==='assistant'?'full':'half');}const r=registrations.get(id);if(launch&&r&&!r.opened){r.opened=true;r.open?.();}window.dispatchEvent(new CustomEvent('campus-tab-change',{detail:{tab:id}}));publish();}
 function communityBackTarget(){
   const chat=document.getElementById('chat-panel');
   if(!chat?.open||chat.hidden)return null;
   if(chat.dataset.section==='forums'){
     if(chat.dataset.forumView==='compose')return document.getElementById('forum-cancel-post');
     if(chat.dataset.forumView==='thread')return document.getElementById('forum-back');
   }else{
     if(chat.dataset.chatView==='explore')return document.getElementById('close-explore');
     if(chat.dataset.mobileView==='conversation')return document.getElementById('back-to-chats');
   }
   return null;
 }
 function syncCommunityBack(){
   const back=document.getElementById('community-back'),target=communityBackTarget();
   back.innerHTML=icon('arrow-left');back.append(document.createTextNode(target?.textContent.trim()||'Community'));
 }
 function communityHome(){clearMapView('community');community.querySelector('#community-home').hidden=false;community.querySelector('#community-back').hidden=true;community.querySelector('#community-feedback').textContent='';community.querySelectorAll('.cu-embedded').forEach(el=>el.hidden=true);}
 function openTerms(){
   const terms=document.createElement('article');terms.className='cu-map-card cu-terms';
   terms.innerHTML=`<button type="button" class="cu-back" id="cu-terms-back">${icon('arrow-left')}Community</button>
     <h1 tabindex="-1">Terms &amp; Conditions</h1><p class="cu-terms-date">Effective September 27, 2026</p>
     <p>FIU Navigator helps people explore campus, find classes and events, and use community features. Please use it responsibly.</p>
     <h2>Campus information and directions</h2><p>Maps, routes, times, class details, events, alerts, and assistant answers may be incomplete or out of date. Check signs and official FIU sources before making important decisions. Stay aware of your surroundings and follow campus rules. Do not use Navigator for emergencies; call 911 or campus emergency services.</p>
     <h2>Community features</h2><p>Be respectful. Do not post unlawful, threatening, harassing, misleading, or private information about others. You are responsible for what you share. We may remove content or limit access to protect users and keep the service working.</p>
     <h2>Your content</h2><p>You keep ownership of content you submit. By posting, you allow the Navigator project team to store, display, and share it within the app as needed to operate community features. Only share content you have the right to use.</p>
     <h2>Location and other services</h2><p>Location features need your device's permission and may be inaccurate. Some features use third-party maps or services with their own terms. You can stop sharing location through your browser or device settings.</p>
     <h2>Availability and responsibility</h2><p>Navigator is provided as available, without a promise that it will always work or that its information is accurate. To the extent allowed by law, the project team is not responsible for losses caused by using or relying on the app. Nothing here limits rights that cannot legally be limited.</p>
     <h2>FIU materials and updates</h2><p>FIU names and logos belong to Florida International University. These terms may be updated as the app changes; the current version will be shown here.</p>`;
   terms.querySelector('#cu-terms-back').addEventListener('click',()=>{communityHome();document.getElementById('cu-open-terms').focus({preventScroll:true});});
   showMapView('community',terms);setSnap('full');terms.querySelector('h1').focus({preventScroll:true});
 }
 function communitySubview(dialog){community.querySelector('#community-home').hidden=true;community.querySelector('#community-back').hidden=false;community.querySelector('#community-feedback').textContent='';community.querySelectorAll('.cu-embedded').forEach(el=>el.hidden=el!==dialog);dialog.hidden=false;syncCommunityBack();setSnap('full');}
 function registerDialog(dialog,tab,{opener}={}){if(dialog.dataset.embedded)return;dialog.dataset.embedded=tab;dialog.classList.add('cu-embedded');document.getElementById(`page-${tab}`).append(dialog);const nativeShow=dialog.show.bind(dialog);dialog.showModal=()=>{clearMapView(tab);activate(tab,{launch:false});if(tab==='community')communitySubview(dialog);if(!dialog.open)nativeShow();};if(tab!=='community')registrations.set(tab,{opened:false,open:()=>document.getElementById(opener)?.click()});dialog.addEventListener('close',()=>{if(tab==='community'&&!mapViews.has(tab))communityHome();});}
 function tryReport(){if(!pendingReport)return;const r=document.getElementById('forum-new-alert');if(document.getElementById('chat-panel')?.open&&r){document.getElementById('forums-tab')?.click();r.click();pendingReport=false;}}
 function openCommunity(kind){activate('community');const f=document.getElementById('community-feedback');f.textContent='';if(kind==='pulse'){const d=document.getElementById('pulse-dialog');if(d?.open){communitySubview(d);return;}document.getElementById('open-pulse')?.click();return;}pendingReport=kind==='report';const d=document.getElementById('chat-panel');if(d?.open){if(kind==='chat')d.dispatchEvent(new Event('campus-chat-home'));communitySubview(d);tryReport();return;}const b=document.getElementById('open-chat');if(!b||b.disabled){f.textContent='Community is still connecting. Try again in a moment.';return;}f.textContent='Opening your community…';b.click();}
 window.addEventListener('campus-chat-ready',()=>{tryReport();syncCommunityBack();});
 new MutationObserver(syncCommunityBack).observe(community,{subtree:true,attributes:true,attributeFilter:['data-section','data-mobile-view','data-chat-view','data-forum-view']});
 document.addEventListener('click',e=>{if(e.target.closest('#cancel-name')){pendingReport=false;document.getElementById('community-feedback').textContent='';}});
 community.addEventListener('click',e=>{if(e.target.closest('#cu-open-terms')){openTerms();return;}const b=e.target.closest('[data-community]');if(b)openCommunity(b.dataset.community);});document.getElementById('community-back').addEventListener('click',()=>{const target=communityBackTarget();if(target){target.click();syncCommunityBack();document.getElementById('community-back').focus({preventScroll:true});}else{communityHome();community.querySelector('[data-community=chat]').focus({preventScroll:true});}});document.getElementById('cu-report').addEventListener('click',()=>openCommunity('report'));
 sheet.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.tab==='community')communityHome();activate(b.dataset.tab);}));
 sheet.querySelector('.cu-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=tabs.findIndex(t=>t[0]===current),n=e.key==='Home'?0:e.key==='End'?4:(i+(e.key==='ArrowRight'?1:-1)+5)%5;if(tabs[n][0]==='community')communityHome();activate(tabs[n][0]);document.getElementById(`tab-${tabs[n][0]}`).focus();});
 const handle=sheet.querySelector('.cu-handle');handle.addEventListener('click',()=>{if(!suppressClick)setSnap(snap==='peek'?'half':(snap==='half'||snap==='map')?'full':'peek');});sheet.querySelector('.cu-collapse').addEventListener('click',()=>setSnap('peek',{focus:true}));
 handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag={id:e.pointerId,y:e.clientY,height:sheet.getBoundingClientRect().height,time:performance.now()};handle.setPointerCapture(e.pointerId);sheet.classList.add('is-dragging');});
 handle.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;sheet.style.height=`${Math.max(sizes().peek,Math.min(sizes().full,drag.height+drag.y-e.clientY))}px`;publish();});
 handle.addEventListener('pointerup',e=>{if(!drag||e.pointerId!==drag.id)return;const d=drag.y-e.clientY,ms=Math.max(1,performance.now()-drag.time),h=sheet.getBoundingClientRect().height;drag=null;sheet.classList.remove('is-dragging');if(Math.abs(d)>8){const states=mapViews.has(current)?['peek','map','full']:['peek','half','full'];let n=states.reduce((best,s)=>Math.abs(sizes()[s]-h)<Math.abs(sizes()[best]-h)?s:best,'peek');if(Math.abs(d/ms)>.5)n=states[Math.max(0,Math.min(2,states.indexOf(snap)+(d>0?1:-1)))];setSnap(n);suppressClick=true;setTimeout(()=>suppressClick=false,0);}else setSnap(snap);});
 handle.addEventListener('pointercancel',()=>{drag=null;sheet.classList.remove('is-dragging');setSnap(snap);});sheet.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented){setSnap(snap==='full'?'half':'peek',{focus:true});e.stopPropagation();}});
 document.getElementById('campus-query').addEventListener('focus',()=>{if(snap==='peek')setSnap('half');});
 function resize(){const v=window.CampusInput.getViewport();if(v.keyboard&&keyboardHeight===null)keyboardHeight=parseFloat(sheet.style.height)||sheet.offsetHeight;else if(!v.keyboard)keyboardHeight=null;setSnap(snap);}
 window.addEventListener('campus-input-viewport',resize);new ResizeObserver(publish).observe(sheet);
 const assistant=document.getElementById('chat-container');if(assistant){document.getElementById('page-assistant').append(assistant);assistant.classList.add('cu-embedded');}registrations.set('assistant',{opened:false,open:()=>document.getElementById('open-assistant')?.click()});
 window.CampusUI={icon,activate,setSnap,announce,registerDialog,openCommunity,communityHome,publish,sheet,showMapView,clearMapView,showMapCard,getState:()=>({tab:current,snap}),host:id=>document.getElementById(`page-${id}`),showSubview:showMapView,closeToMap(){setSnap('peek');}};
 setSnap('peek');
})();
