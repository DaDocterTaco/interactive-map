import {sourceName, safeUrl, validateFeed, isMappable, selectEvents, eventTime} from './event-utils.mjs';

export async function mountEvents({map, L}) {
    const node = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
    const panel = node('section', '', 'events-panel');
    panel.setAttribute('aria-label', 'FIU events');
    const heading = node('div', '', 'events-heading');
    const title = node('div'); title.append(node('small', 'EXPLORE FIU'), node('h1', 'Campus events'));
    const toggle = node('button', 'Hide', 'events-toggle'); toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'true'); toggle.setAttribute('aria-controls', 'events-content');
    heading.append(title, toggle); panel.append(heading);
    const content = node('div'); content.id = 'events-content'; panel.append(content);
    const filters = node('div', '', 'events-filters');
    const search = node('input'); search.type = 'search'; search.placeholder = 'Search events or buildings'; search.setAttribute('aria-label', 'Search events or buildings');
    const period = node('select'); period.setAttribute('aria-label', 'Event date range');
    for (const [value, text] of [['week','Next 7 days'],['today','Today'],['all','All upcoming']]) { const option = node('option',text); option.value = value; period.append(option); }
    const source = node('select'); source.setAttribute('aria-label', 'Event source');
    for (const [value,text] of [['all','Both sources'],['fiu_calendar','FIU Calendar'],['panther_connect','Panther Connect']]) { const o=node('option',text);o.value=value;source.append(o); }
    filters.append(search, period, source); content.append(filters);
    const status = node('p', 'Loading event data…', 'events-status'); status.setAttribute('role','status');
    const summary = node('p', '', 'events-summary'); const list=node('div','','events-list');
    const more=node('button','Show more','events-more');more.type='button';more.hidden=true;
    const footer=node('p','MMC pins show building locations. Online, other-campus and unlocated events stay in the list.','events-note');
    content.append(status,summary,list,more,footer); document.body.append(panel);
    L.DomEvent.disableClickPropagation(panel); L.DomEvent.disableScrollPropagation(panel);
    toggle.onclick=()=>{content.hidden=!content.hidden;toggle.textContent=content.hidden?'Show':'Hide';toggle.setAttribute('aria-expanded',String(!content.hidden));};
    const layer = L.layerGroup().addTo(map);
    let buildings=[], feed=null, limit=30, busy=false, lastError=false, timer, expiryTimer;
    const markers=new Map();
    function eventCard(e, inPopup=false) {
        const card=node('article','','event-card');
        const heading=node('h2'); const url=safeUrl(e.link);
        if(url){const a=node('a',e.title);a.href=url;a.target='_blank';a.rel='noopener noreferrer';heading.append(a);}else{heading.textContent=e.title;}
        card.append(heading,node('p',eventTime(e),'event-time'),node('p',e.location+(e.room?' · Room '+e.room:''),'event-place'));
        const badges=node('div','','event-badges');
        for(const s of e.sources)badges.append(node('span',sourceName(s.name),'event-source'));
        if(Date.parse(e['start time'])<=Date.now() && e['end time'])badges.append(node('span','Ongoing','event-type'));
        if(e.experience==='virtual')badges.append(node('span','Online','event-type'));
        else if(!isMappable(e))badges.append(node('span','Not pinned on MMC','event-type'));
        card.append(badges);
        if(!inPopup && isMappable(e)) {
            const button=node('button','Show on map','event-locate');button.type='button';
            button.onclick=()=>{const marker=markers.get(e.building_id || e.id);if(marker){if(innerWidth<650){content.hidden=true;toggle.textContent='Show';toggle.setAttribute('aria-expanded','false');}map.setView(marker.getLatLng(),18,{animate:false});marker.openPopup();}};card.append(button);
        }
        return card;
    }
    function popup(building, events) {
        const box=node('div','','events-popup');box.append(node('h2',building.full_name+' ('+building.abbreviation+')'));
        box.append(node('p',events.length ? `${events.length} events in your selected range` : 'No events match your filters.'));
        for(const e of events)box.append(eventCard(e,true));return box;
    }
    function render() {
        const selected=feed ? selectEvents(feed.events,{period:period.value,source:source.value,query:search.value}) : [];
        const openKey=[...markers].find(([,m])=>m.isPopupOpen())?.[0];
        layer.clearLayers();markers.clear();
        for(const b of buildings) {
            const events=selected.filter(e=>e.building_id===b.abbreviation && isMappable(e));
            const icon=L.divIcon({className:'event-pin '+(events.length?'has-events':'no-events'),html:events.length?String(events.length):'',iconSize:events.length?[30,30]:[10,10],iconAnchor:events.length?[15,15]:[5,5]});
            const marker=L.marker([b.latitude,b.longitude],{icon,title:`${b.full_name}: ${events.length} events`,zIndexOffset:events.length?100:0}).addTo(layer);
            marker.bindPopup(popup(b,events),{maxHeight:330,maxWidth:330,autoPanPaddingTopLeft:[10,innerWidth<650?150:20],autoPanPaddingBottomRight:[20,20]});markers.set(b.abbreviation,marker);
        }
        for(const e of selected.filter(e=>!e.building_id && isMappable(e))) {
            const marker=L.marker([e.latitude,e.longitude],{title:e.title}).addTo(layer);
            const box=node('div');box.append(eventCard(e,true),node('small',e.coordinate_source||'Published location'));
            marker.bindPopup(box,{maxWidth:330});markers.set(e.id,marker);
        }
        if(openKey && markers.has(openKey))markers.get(openKey).openPopup();
        list.replaceChildren(...selected.slice(0,limit).map(e=>eventCard(e)));
        more.hidden=selected.length<=limit;
        if(feed){const pinned=selected.filter(isMappable).length;summary.textContent=`${selected.length} events · ${pinned} on the MMC map`;if(!selected.length)list.append(node('p','No events match these filters. Try another date range or search.','events-empty'));}
        if(feed && !lastError){const age=Date.now()-Date.parse(feed.generated_at);status.textContent=`Updated ${new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(feed.generated_at))}${age>36*3600000?' · Data is over 36 hours old':''}`;status.classList.toggle('events-stale',age>36*3600000);}
    }
    async function refresh() {
        if(busy)return;busy=true;
        try {
            const response=await fetch('events.json',{cache:'no-store',signal:AbortSignal.timeout(20000)});
            if(!response.ok)throw new Error('Event download failed');
            feed=validateFeed(await response.json());lastError=false;render();
        }catch(error){lastError=true;status.textContent=feed?'Could not refresh. Showing the last loaded events.':'Events could not load. Building locations are still available. Retrying in 5 minutes.';status.classList.add('events-stale');render();}
        finally{busy=false;}
    }
    try{const response=await fetch('buildings.json');if(!response.ok)throw new Error();buildings=await response.json();}
    catch{status.textContent='Building locations could not load. Event locations remain available in the list.';}
    render();await refresh();
    for(const control of [period,source])control.addEventListener('change',()=>{limit=30;render();});
    search.addEventListener('input',()=>{limit=30;render();});
    more.onclick=()=>{limit+=30;render();};
    const visible=()=>{if(!document.hidden){render();refresh();}};
    document.addEventListener('visibilitychange',visible);
    timer=setInterval(()=>{if(!document.hidden)refresh();},300000);
    expiryTimer=setInterval(()=>{if(!document.hidden)render();},60000);
    addEventListener('pagehide',()=>{clearInterval(timer);clearInterval(expiryTimer);document.removeEventListener('visibilitychange',visible);},{once:true});
}
