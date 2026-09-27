import {sourceName,safeUrl,prepareEvents,selectEvents,eventDate,eventTime,locationText,isOngoing,isLongRunning,dayKey} from './event-data.mjs';

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
const icon=name=>{const n=el('span',null,'ev-icon');n.setAttribute('aria-hidden','true');n.style.setProperty('--ev-icon',`url("${new URL(`icons/${name}.svg`,import.meta.url)}")`);return n;};
const button=(text,cls='')=>{const b=el('button',text,cls);b.type='button';return b;};
const link=(label,url,cls)=>{const a=el('a',label,cls);a.href=safeUrl(url);a.target='_blank';a.rel='noopener noreferrer';return a;};
const defaults=()=>({query:'',period:'upcoming',sort:'soonest',food:'',category:'',campus:'',source:'',free:false,cancelled:false});

export function mountEvents({map,L,dataUrl='../data/events.current.json',buildingsUrl='Buildings.json',autoOpen=false}={}) {
    if(document.getElementById('events-dialog'))return;
    let opener=document.getElementById('open-events');
    if(!opener){
        opener=button('', '');opener.id='open-events';
        const glyph=el('span',null,'action-bar-icon');glyph.append(icon('calendar-event'));
        const copy=el('span',null,'action-bar-copy');copy.append(el('strong','Events'),el('small','Discover what’s happening at FIU'));
        opener.append(glyph,copy);
        const group=document.querySelector('.action-bar-actions');group.insertBefore(opener,document.getElementById('open-chat'));
    }
    opener.setAttribute('aria-haspopup','dialog');opener.setAttribute('aria-controls','events-dialog');opener.setAttribute('aria-expanded','false');
    const dialog=el('dialog');dialog.id='events-dialog';dialog.tabIndex=-1;dialog.setAttribute('aria-labelledby','ev-title');
    dialog.innerHTML=`<div class="ev-surface">
      <header class="ev-header">
        <div class="ev-heading"><span class="ev-brand" aria-hidden="true"></span><div><h2 id="ev-title">Campus events</h2><p>Discover what’s happening at FIU</p></div><button class="ev-close ev-icon-button" type="button" aria-label="Close events"></button></div>
        <form class="ev-toolbar" role="search" aria-label="Search campus events">
          <div class="ev-search"><input id="ev-query" type="text" placeholder="Search events, food, or keywords" aria-label="Search events, food, or keywords" autocomplete="off" maxlength="120" spellcheck="false" enterkeyhint="search"><button id="ev-clear-query" class="ev-icon-button" type="button" aria-label="Clear search" hidden></button></div>
          <label class="ev-select ev-period"><span class="ev-sr">Date range</span><select id="ev-period" aria-label="Date range"><option value="upcoming">Next 3 weeks</option><option value="today">Today</option><option value="week">Next 7 days</option><option value="past">Past 7 days</option></select></label>
          <button class="ev-filter-button" type="button" aria-controls="ev-filters" aria-expanded="false"><span>Filters</span><span class="ev-filter-count" hidden></span></button>
          <label class="ev-select ev-sort"><span class="ev-sr">Sort events</span><select id="ev-sort" aria-label="Sort events"><option value="soonest">Soonest</option><option value="match">Best match</option><option value="az">A–Z</option><option value="updated">Updated</option></select></label>
        </form>
        <div class="ev-countline"><span id="ev-count" role="status" aria-live="polite" aria-atomic="true">Loading events…</span><button type="button" class="ev-clear-all" hidden>Clear all</button></div><div class="ev-chipline" hidden></div>
      </header>
      <div class="ev-scroll" tabindex="-1">
        <section class="ev-filters" id="ev-filters" aria-label="Event filters" hidden>
          <label>Food<select id="ev-food" aria-label="Food"><option value="">Any food option</option><option value="available">Food available</option><option value="free">Free food</option><option value="refreshments">Refreshments</option></select></label>
          <label>Category<select id="ev-category" aria-label="Category"><option value="">All categories</option></select></label>
          <label>Campus<select id="ev-campus" aria-label="Campus"><option value="">All locations</option><option>MMC</option><option>BBC</option><option>Online</option><option>Other locations</option><option>Unspecified</option></select></label>
          <label>Source<select id="ev-source" aria-label="Source"><option value="">Both sources</option><option value="fiu_calendar">FIU Calendar</option><option value="panther_connect">Panther Connect</option></select></label>
          <label class="ev-check"><input id="ev-free" type="checkbox">Free admission only</label>
          <label class="ev-check"><input id="ev-cancelled" type="checkbox">Include cancelled events</label>
        </section>
        <div class="ev-status" hidden></div><div class="ev-list" aria-label="Event results"></div>
        <button class="ev-more ev-action" type="button" hidden>Show more events</button>
      </div>
      <footer class="ev-footer"><span class="ev-updated">Loading published events…</span><button class="ev-about" type="button" aria-expanded="false">About these events</button></footer>
      <span class="ev-sr ev-announcement" role="status" aria-live="polite"></span>
    </div>`;
    document.body.append(dialog);
    const $=s=>dialog.querySelector(s), list=$('.ev-list'), query=$('#ev-query');
    // A short landscape viewport scrolls the whole panel so controls cannot consume all result space.
    const shortViewport=matchMedia('(max-height:520px)');
    let scroll=shortViewport.matches?$('.ev-surface'):$('.ev-scroll');
    shortViewport.addEventListener('change',()=>{scroll=shortViewport.matches?$('.ev-surface'):$('.ev-scroll');});
    $('.ev-brand').append(icon('calendar-event'));$('.ev-close').append(icon('x'));$('#ev-clear-query').append(icon('x'));
    $('.ev-search').prepend(icon('search'));$('.ev-filter-button').prepend(icon('adjustments-horizontal'));
    for(const [selector,name] of [['.ev-period','calendar-event'],['.ev-sort','sort-ascending']]) {$(selector).prepend(icon(name));const arrow=icon('chevron-down');arrow.classList.add('ev-chevron');$(selector).append(arrow);}
    const reduced=matchMedia('(prefers-reduced-motion: reduce)'), mobile=matchMedia('(max-width:620px)');
    let state=defaults(),events=[],feed=null,loading=false,openId=null,limit=24,timer,closeTimer,initial=true,showAbout=false,loadError=false,lastRead=0;
    const cards=new Map();let marker=null,mapMode=false,mapScroll=0;
    const mapReturn=el('aside',null,'ev-map-return');mapReturn.hidden=true;mapReturn.setAttribute('aria-label','Selected event location');
    const back=button('', '');back.append(icon('arrow-left'),el('span','Back to events'));
    const mapCopy=el('div');mapReturn.append(back,mapCopy);document.body.append(mapReturn);
    function clearMap(){mapReturn.hidden=true;if(marker){marker.remove();marker=null;}mapMode=false;}
    function open(){clearTimeout(closeTimer);dialog.classList.remove('is-closing');if(!dialog.open)dialog.showModal();opener.setAttribute('aria-expanded','true');if((!feed||Date.now()-lastRead>60000)&&!loading)load();dialog.focus({preventScroll:true});}
    function close(){if(!dialog.open)return;dialog.classList.add('is-closing');closeTimer=setTimeout(()=>{dialog.close();dialog.classList.remove('is-closing');},reduced.matches?0:160);}
    opener.addEventListener('click',()=>{clearMap();open();});$('.ev-close').addEventListener('click',close);
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    dialog.addEventListener('close',()=>{opener.setAttribute('aria-expanded','false');if(!mapMode){const target=getComputedStyle(opener).visibility==='hidden'?document.getElementById('action-bar-handle'):opener;(target||opener).focus({preventScroll:true});}});
    dialog.addEventListener('click',e=>{if(e.target!==dialog)return;const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();});
    back.addEventListener('click',()=>{clearMap();open();scroll.scrollTop=mapScroll;cards.get(openId)?.querySelector('.ev-card-toggle').focus({preventScroll:true});});
    if(L){L.DomEvent.disableClickPropagation(dialog);L.DomEvent.disableScrollPropagation(dialog);}
    function showMap(e){
        const b=e.venue.building;if(!b||!map||!L)return;
        mapScroll=scroll.scrollTop;mapMode=true;dialog.close();
        if(marker)marker.remove();
        marker=L.circleMarker([b.latitude,b.longitude],{radius:12,color:'#fff',weight:4,fillColor:'#0450ef',fillOpacity:1}).addTo(map);
        const popup=el('div');popup.append(el('strong',e.title),el('p',`${b.full_name}${e.room?' · '+e.room:''}`),el('small','Building location · Check room details in the listing'));
        marker.bindPopup(popup,{maxWidth:290});
        map.flyTo([b.latitude,b.longitude],18,{animate:!reduced.matches,duration:.65});marker.openPopup();
        mapCopy.replaceChildren(el('strong',b.full_name),el('small',e.room?`Room ${e.room} · Building pin`:'Approximate building location'));
        mapReturn.hidden=false;back.focus({preventScroll:true});
    }
    async function load(){
        loading=true;loadError=false;list.setAttribute('aria-busy','true');
        if(!feed){const n=el('div',null,'ev-loading');n.append(icon('refresh'),el('p','Finding campus events…'));list.replaceChildren(n);}
        try {
            const [r,b]=await Promise.all([fetch(dataUrl,{cache:'no-store'}),fetch(buildingsUrl)]);
            if(!r.ok)throw Error('Events are unavailable');
            const next=await r.json(), buildings=b.ok?await b.json():[];
            if(!Array.isArray(next.events)||!next.events.every(e=>e.id&&e.title&&Number.isFinite(Date.parse(e.start_at))))throw Error('Invalid catalog');
            feed=next;lastRead=Date.now();events=prepareEvents(next.events,buildings);
            $('#ev-category').replaceChildren(new Option('All categories',''),...Array.from(new Set(events.flatMap(e=>e.categories||[]))).sort().map(c=>new Option(c,c)));
            $('#ev-category').value=state.category;
            if(initial){openId=selectEvents(events,state)[0]?.id;initial=false;}
            render();
        }catch(error){
            loadError=true;
            if(!feed){$('#ev-count').textContent='Events unavailable';const n=emptyState('Events couldn’t load','Your connection may be unavailable. Try loading the saved listings again.','Try again',load);list.replaceChildren(n);}
            else render();
        }finally{loading=false;list.removeAttribute('aria-busy');updateStatus();}
    }
    function emptyState(title,body,cta,action){const n=el('div',null,'ev-empty');n.append(icon('search'),el('h3',title),el('p',body));const b=button(cta,'ev-action');b.addEventListener('click',action);n.append(b);return n;}
    function updateStatus(){
        const health=Object.values(feed?.source_health||{}), stale=health.some(s=>s.status==='failed'||Date.now()-Date.parse(s.last_success_at)>36*3600e3);
        const text=feed?`Updated ${new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(feed.generated_at))}`:'No event data loaded';
        $('.ev-updated').textContent=text+(stale?' · Some listings may be out of date':'');
        const status=$('.ev-status');status.hidden=!(showAbout||(loadError&&feed)||stale);
        if(showAbout){status.replaceChildren(el('strong','From FIU Calendar & Panther Connect'),el('p','These are published listings from our connected sources, refreshed manually. Some campus events may be missing. Food labels reflect organizer descriptions; check the official listing for changes. All times are Eastern.'));
            if(health.length)for(const [name,h] of Object.entries(feed.source_health))status.append(el('p',`${sourceName(name)}: ${h.status==='failed'?'last refresh unavailable':'last refreshed'} ${h.last_success_at?new Date(h.last_success_at).toLocaleString('en-US',{timeZone:'America/New_York'}):'unknown'}`));
        }else status.textContent=loadError?'The latest saved listings couldn’t load. Showing the events already loaded.':stale?'Some sources have not refreshed recently. Check the official listing before heading out.':'';
        $('.ev-about').setAttribute('aria-expanded',String(showAbout));
    }
    $('.ev-about').addEventListener('click',()=>{showAbout=!showAbout;updateStatus();if(showAbout)scroll.scrollTop=0;});
    const filterKeys=['food','category','campus','source','free','cancelled'];
    function syncControls(){query.value=state.query;$('#ev-period').value=state.period;$('#ev-sort').value=state.sort;for(const k of filterKeys){if(['free','cancelled'].includes(k))$('#ev-'+k).checked=state[k];else $('#ev-'+k).value=state[k];}$('#ev-clear-query').hidden=!state.query;}
    function reset(){state=defaults();limit=24;openId=null;syncControls();render();scroll.scrollTop=0;query.focus({preventScroll:true});}
    $('.ev-clear-all').addEventListener('click',reset);
    function change(resetScroll=true){limit=24;render();if(resetScroll)scroll.scrollTop=0;}
    query.addEventListener('input',()=>{state.query=query.value;$('#ev-clear-query').hidden=!state.query;clearTimeout(timer);timer=setTimeout(()=>change(),130);});
    $('.ev-toolbar').addEventListener('submit',e=>{e.preventDefault();clearTimeout(timer);change();query.blur();});
    $('#ev-clear-query').addEventListener('click',()=>{state.query='';syncControls();change();query.focus();});
    for(const key of ['period','sort',...filterKeys])$('#ev-'+key).addEventListener('change',e=>{state[key]=e.target.type==='checkbox'?e.target.checked:e.target.value;change();});
    $('.ev-filter-button').addEventListener('click',()=>{const f=$('.ev-filters');f.hidden=!f.hidden;$('.ev-filter-button').setAttribute('aria-expanded',String(!f.hidden));if(!f.hidden)scroll.scrollTop=0;});
    function chips(){
        const count=filterKeys.filter(k=>state[k]).length;
        $('.ev-filter-count').textContent=count;$('.ev-filter-count').hidden=!count;$('.ev-filter-button').classList.toggle('is-active',!!count);
        const chipline=$('.ev-chipline');chipline.replaceChildren();
        const names={food:{available:'Food available',free:'Free food',refreshments:'Refreshments'}[state.food],category:state.category,campus:state.campus,source:sourceName(state.source),free:'Free admission',cancelled:'Including cancelled'};
        for(const k of filterKeys.filter(k=>state[k])){const chip=button('','ev-chip');chip.append(el('span',names[k],'ev-chip-label'),icon('x'));chip.setAttribute('aria-label',`Remove filter: ${names[k]}`);chip.addEventListener('click',()=>{state[k]=typeof state[k]==='boolean'?false:'';syncControls();change();$('.ev-filter-button').focus({preventScroll:true});});chipline.append(chip);}
        chipline.hidden=!count;$('.ev-clear-all').hidden=!(count||state.query||state.period!=='upcoming');
        $('#ev-sort').options[0].textContent=state.period==='past'?(matchMedia('(max-width:420px)').matches?'Recent':'Most recent'):'Soonest';
    }
    function badge(label,cls='',name='tools-kitchen-2'){const b=el('span',label,'ev-badge '+cls);b.prepend(icon(name));return b;}
    function fact(name,title,value){const n=el('div',null,'ev-fact'),body=el('div');body.append(el('small',title),el('span',value,'ev-fact-value'));n.append(icon(name),body);return n;}
    function details(e){
        const detail=el('div',null,'ev-detail'),body=el('div'),actions=el('div',null,'ev-actions');
        const desc=el('p',e.description||'See the official listing for the full event description.','ev-description');body.append(desc);
        if((e.description||'').length>(mobile.matches?220:500)){desc.classList.add('is-short');const more=button('Read full description','ev-read-more');more.setAttribute('aria-expanded','false');more.addEventListener('click',()=>{const collapsed=desc.classList.toggle('is-short');more.textContent=collapsed?'Read full description':'Show less';more.setAttribute('aria-expanded',String(!collapsed));});body.append(more);}
        const facts=el('div',null,'ev-facts');facts.append(fact('users','Hosted by',e.host||'See official listing'),fact('ticket','Admission',e.published_cost || (e.admission==='free'?'Free admission':'Not listed')));
        if(e.food?.availability==='available')facts.append(fact('tools-kitchen-2','Food',e.food.details||e.food.labels.join(', ')));
        else facts.append(fact('tools-kitchen-2','Food','Not confirmed by the organizer'));
        body.append(facts);
        const source=el('p',null,'ev-source-note');source.append(document.createTextNode('Source: '));
        const sources=e.sources?.length?e.sources:[{source:e.source,official_url:e.official_url}];
        sources.forEach((s,i)=>{if(i)source.append(document.createTextNode(' · '));if(safeUrl(s.official_url))source.append(link(sourceName(s.source),s.official_url));else source.append(document.createTextNode(sourceName(s.source)));});body.append(source);
        if(e.needs_source_check)body.append(el('p','This event is no longer confirmed in the latest feed. Check with the organizer.','ev-source-note'));
        if(e.status==='cancelled')body.append(el('p','The source has marked this event cancelled.','ev-source-note'));
        if(e.venue.building&&map&&L){const locate=button('', 'ev-action primary');locate.append(icon('map-pin'),el('span','Show on map'));locate.addEventListener('click',()=>showMap(e));actions.append(locate);}
        else actions.append(el('p',e.venue.campus==='Online'?'Online event · See the official listing for joining details.':'See the official listing for location and directions.','ev-map-note'));
        if(safeUrl(e.official_url)){const official=link('',e.official_url,'ev-action'+(!e.venue.building?' primary':''));official.append(icon('external-link'),el('span','Official event'));official.setAttribute('aria-label',`Official event: ${e.title} (opens in a new tab)`);actions.append(official);}
        detail.append(body,actions);return detail;
    }
    function card(e){
        const article=el('article',null,'ev-card');article.dataset.eventId=e.id;
        const toggle=button('', 'ev-card-toggle');toggle.setAttribute('aria-label',`${e.title} · ${eventDate(e)} · ${eventTime(e)}`);
        toggle.setAttribute('aria-expanded',String(e.id===openId));const panelId='ev-detail-'+e.id.replace(/[^a-zA-Z0-9_-]/g,'-');toggle.setAttribute('aria-controls',panelId);
        const thumb=el('span',null,'ev-thumb');thumb.append(icon('calendar-event'));
        const imageUrl=safeUrl(e.image?.url);if(imageUrl){const img=new Image();img.alt='';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.addEventListener('load',()=>{img.style.opacity='1';},{once:true});img.addEventListener('error',()=>img.remove(),{once:true});img.src=imageUrl;thumb.append(img);}
        const copy=el('span',null,'ev-card-copy'),titleline=el('span',null,'ev-titleline');titleline.append(el('span',e.title,'ev-card-title'));
        if(e.status==='cancelled')titleline.append(badge('Cancelled','cancelled','info-circle'));
        else if(e.needs_source_check)titleline.append(badge('Check listing','unconfirmed','info-circle'));
        else if(e.food?.labels?.length)titleline.append(badge(e.food.labels[0],e.food.items?.some(x=>/coffee|refreshment|tea/.test(x))&&e.food.price!=='free'?'refreshments':'',e.food.items?.some(x=>/coffee|tea|refreshment/.test(x))?'coffee':'tools-kitchen-2'));
        if(isOngoing(e)&&!isLongRunning(e)&&e.status!=='cancelled')titleline.append(badge('Happening now','live','clock'));
        copy.append(titleline,el('span',`${eventDate(e)} · ${eventTime(e)}`,'ev-meta'),el('span',locationText(e),'ev-location'),el('span',e.description||e.summary||'View event details','ev-summary'));
        const chev=icon('chevron-down');chev.classList.add('ev-card-chevron');toggle.append(thumb,copy,chev);
        const expansion=el('div',null,'ev-expansion');expansion.id=panelId;expansion.setAttribute('role','region');expansion.setAttribute('aria-label',`${e.title} details`);const clip=el('div',null,'ev-expansion-clip');expansion.append(clip);
        article.append(toggle,expansion);
        function setExpanded(expanded){article.classList.toggle('is-open',expanded);toggle.setAttribute('aria-expanded',String(expanded));expansion.setAttribute('aria-hidden',String(!expanded));expansion.inert=!expanded;if(expanded&&!clip.children.length)clip.append(details(e));}
        article.setExpanded=setExpanded;setExpanded(e.id===openId);
        toggle.addEventListener('click',()=>{
            const before=toggle.getBoundingClientRect().top, previous=cards.get(openId), wasOpen=openId===e.id;
            previous?.setExpanded(false);openId=wasOpen?null:e.id;setExpanded(!wasOpen);
            // Anchor the clicked row while a preceding expanded card contracts.
            if(previous&&previous!==article&&previous.compareDocumentPosition(article)&Node.DOCUMENT_POSITION_FOLLOWING){const started=performance.now();const anchor=()=>{scroll.scrollTop+=toggle.getBoundingClientRect().top-before;if(!reduced.matches&&performance.now()-started<270)requestAnimationFrame(anchor);};requestAnimationFrame(anchor);}
        });
        return article;
    }
    function render(){
        if(!feed)return;const oldScroll=scroll.scrollTop, active=document.activeElement?.closest?.('.ev-card')?.dataset.eventId;
        const matches=selectEvents(events,state);chips();$('#ev-count').textContent=`${matches.length} ${matches.length===1?'event':'events'}`;
        cards.clear();const fragment=document.createDocumentFragment();let longHeading=false;
        for(const e of matches.slice(0,limit)){
            if(state.sort==='soonest'&&state.period!=='past'&&isLongRunning(e)&&!longHeading){fragment.append(el('h3','Ongoing & all-day','ev-section-label'));longHeading=true;}
            const item=card(e);cards.set(e.id,item);fragment.append(item);
        }
        if(!matches.length)fragment.append(emptyState('No events match yet','Try a different keyword, date range, or fewer filters.','Clear search & filters',reset));
        list.replaceChildren(fragment);$('.ev-more').hidden=matches.length<=limit;
        $('.ev-more').textContent=`Show ${Math.min(24,matches.length-limit)} more events`;
        scroll.scrollTop=oldScroll;if(active)cards.get(active)?.querySelector('button').focus({preventScroll:true});
        updateStatus();
    }
    $('.ev-more').addEventListener('click',()=>{const old=limit;limit+=24;render();const next=list.querySelectorAll('.ev-card')[old];next?.querySelector('button').focus({preventScroll:true});});
    setInterval(()=>{if(dialog.open&&feed&&!loading&&!openId&&!query.matches(':focus'))render();},60000);
    mobile.addEventListener('change',()=>{if(feed)render();});
    const narrow=matchMedia('(max-width:360px)'),compactLabels=matchMedia('(max-width:420px)');
    const dateLabels=()=>{$('#ev-period').options[0].textContent=narrow.matches?'Next 3 wk':'Next 3 weeks';$('#ev-period').options[2].textContent=narrow.matches?'Next 7 d':'Next 7 days';$('#ev-period').options[3].textContent=narrow.matches?'Past 7 d':'Past 7 days';$('#ev-sort').options[0].textContent=state.period==='past'?(compactLabels.matches?'Recent':'Most recent'):'Soonest';$('#ev-sort').options[1].textContent=compactLabels.matches?'Relevant':'Best match';};
    narrow.addEventListener('change',dateLabels);compactLabels.addEventListener('change',dateLabels);dateLabels();
    if(autoOpen)open();
    return {open,close};
}
