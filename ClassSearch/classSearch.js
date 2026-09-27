import { locateOnMap } from './classMotion.mjs';
import { createCatalogLoader, formatDays, formatTime, formatDate, dateRange } from './classData.mjs';

const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
};
const icon = name => `<span class="cs-icon cs-${name}" aria-hidden="true"></span>`;
const schedule = section => {
    let start = formatTime(section.start_time), end = formatTime(section.end_time);
    if (start.slice(-2) === end.slice(-2)) start = start.slice(0,-3);
    return `${formatDays(section.days)} · ${start}–${end}`;
};

export function mountClassSearch({ map, L, navigation }) {
    const openButton = document.getElementById('open-class');
    if (!openButton || document.getElementById('class-dialog')) return;
    const embedded = Boolean(window.CampusUI);
    const mobile = embedded ? {matches:true,addEventListener(){}} : matchMedia('(max-width: 700px)');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const dialog = el('dialog');
    dialog.id = 'class-dialog'; dialog.setAttribute('aria-labelledby','class-title');
    dialog.innerHTML = `
      <button type="button" class="class-close cs-icon-button" aria-label="Close class search">${icon('close')}</button>
      <section class="class-sidebar">
        <header class="class-header"><span class="class-book">${icon('book')}</span><div><h2 id="class-title">Find a class</h2><p id="class-term">Fall 2026 · MMC</p></div></header>
        <form id="class-search-form" role="search" aria-label="Find a class">
          <div class="class-search-line"><div class="class-search-input">${icon('search')}<input id="class-query" aria-label="Course, title or class ID" placeholder="Course, title or class ID" maxlength="100" autocomplete="off" spellcheck="false" enterkeyhint="search"><button type="button" class="cs-icon-button" id="class-clear-query" aria-label="Clear search" hidden>${icon('close')}</button></div>
          <button type="button" id="class-filter-toggle" aria-label="Filter classes" aria-expanded="false" aria-controls="class-filters">${icon('filters')}<span>Filters</span><span id="class-filter-count" hidden></span>${icon('right')}</button></div>
          <div id="class-filters" hidden><label>Professor<input id="class-professor" placeholder="e.g. Whittaker" maxlength="100" autocomplete="off"></label><label>Start time<input id="class-time" type="time"></label><button type="button" id="class-reset-filters">Reset filters</button></div>
          <button type="submit" class="cs-sr-only">Search classes</button>
        </form>
        <div class="class-results-heading"><h3>Results</h3><span id="class-count"></span></div>
        <p id="class-status" class="cs-sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
        <div class="class-results-scroll"><div id="class-feedback"><strong>Find your section</strong><p>Search by course, title or class ID.</p><button id="class-retry" type="button" hidden>Try again</button></div><div id="class-results" role="group" aria-label="Matching class sections"></div><button id="class-more" type="button" hidden>Show more sections</button></div>
        <button type="button" class="class-search-help">${icon('search')}<span>Search another course<small>Try a different course name or code.</small></span></button>
      </section>
      <section class="class-detail-pane" aria-label="Selected section">
        <div class="class-detail-empty">${icon('book')}<h3>Your class, in focus.</h3><p>Choose a section to see its meeting time,<br>room and building.</p></div>
        <div class="class-detail-content" hidden>
          <div class="class-detail-grid"><div class="class-detail-info">
            <header class="class-detail-header"><p>Selected section</p><h3 id="class-course-code"></h3><h4 id="class-course-name"></h4><span id="class-section"></span></header>
            <dl class="class-facts">
              <div>${icon('person')}<div><dt>Professor</dt><dd id="class-instructor"></dd></div></div>
              <div>${icon('id')}<div><dt>Class ID</dt><dd id="class-id"></dd></div></div>
              <div>${icon('clock')}<div><dt>Meeting time</dt><dd id="class-schedule"></dd></div></div>
              <div>${icon('geo')}<div><dt>Location</dt><dd><span id="class-room"></span><span id="class-building"></span></dd></div></div>
            </dl>
            <label id="class-location-label" hidden>Meeting location<select id="class-location-choice"></select></label>
            <details class="class-dates"><summary>${icon('calendar')}<span>Meeting dates</span>${icon('down')}</summary><div><p id="class-date-range"></p><p id="class-dates-list"></p><p id="class-data-note"></p></div></details>
          </div><div class="class-map-preview" role="img" aria-label="Selected building on the campus map"><div id="class-preview-map"></div><span class="class-preview-unavailable" hidden>Map preview unavailable. You can still view the building location.</span></div></div>
          <footer class="class-footer"><button type="button" id="class-clear-selection">Clear selection</button><button type="button" id="locate-class" class="cs-primary">${icon('directions')}<span>Directions</span></button></footer>
        </div>
      </section>`;
    document.body.append(dialog);
    window.CampusUI?.registerDialog(dialog,'classes',{opener:'open-class'});
    const journey = el('section',null,'class-journey'); journey.hidden=true;
    journey.setAttribute('aria-label','Class location');
    journey.innerHTML=`<div class="class-journey-handle" aria-hidden="true"></div><button type="button" class="class-dismiss cs-icon-button" aria-label="Dismiss class location">${icon('close')}</button>
      <p class="class-journey-state" role="status" aria-live="polite" aria-atomic="true">${icon('check-circle')}<span></span></p>
      <h2 class="class-journey-room"></h2><p class="class-journey-building"></p>
      <div class="class-journey-course">${icon('book')}<div><strong></strong><span></span></div></div>
      <p class="class-journey-time">${icon('calendar')}<span></span></p>
      <button type="button" class="class-stop">Stop movement</button><button type="button" class="class-directions cs-primary">${icon('directions')}<span>Directions</span></button>`;
    const mapNav = el('nav',null,'class-map-nav'); mapNav.hidden=true; mapNav.setAttribute('aria-label','Class map navigation');
    mapNav.innerHTML=`<button type="button" class="class-return">${icon('left')}Class details</button><span>MMC</span>`;
    document.body.append(journey,mapNav);
    const $ = selector => dialog.querySelector(selector);
    const query=$('#class-query'), results=$('#class-results'), status=$('#class-status'), pane=$('.class-detail-pane');
    const detail=$('.class-detail-content'), feedback=$('#class-feedback'), more=$('#class-more');
    let courseSummary,extraDetails;
    if(embedded){
        $('#class-title').textContent='Classes';
        courseSummary=el('div',null,'cu-course-summary');courseSummary.hidden=true;$('.class-results-heading').before(courseSummary);
        extraDetails=el('details',null,'cu-class-more');const summary=el('summary','Section details');extraDetails.append(summary);const grid=$('.class-detail-grid');grid.before(extraDetails);extraDetails.append(grid);
    }
    const feedbackHeading=feedback.querySelector('strong'), feedbackDetail=feedback.querySelector('p');
    const loadCatalog=createCatalogLoader(new URL('./classes.json',import.meta.url));
    let catalog, matches=[], shown=0, selected=null, revision=0, searchTimer, exitTimer;
    let preview, previewPin, previewShape, marker, shape, cancelJourney, observer;
    let footprints, footprintPromise, openingForMap=false;
    let searchLoading;
    function clearSearchLoading(){
        searchLoading?.remove();searchLoading=null;
        feedbackHeading.hidden=false;feedbackDetail.hidden=false;
    }
    const locationLayer=L.layerGroup().addTo(map);
    const loadFootprints=()=>footprintPromise ||= fetch(new URL('./buildings.geojson',import.meta.url))
        .then(r=>r.ok?r.json():null).then(data=>{footprints=data;return data;}).catch(()=>null);
    const announce = message => { status.textContent=message; };
    const coordinates = location => [location.building.latitude,location.building.longitude];
    function pinIcon(size=42) {
        return L.divIcon({className:'class-map-pin',html:icon('pin'),iconSize:[size,size],iconAnchor:[size/2,size]});
    }
    function addShape(target, location) {
        const feature=footprints?.features.find(f=>f.properties.code===location.building.code);
        return feature ? L.geoJSON(feature,{style:{color:'#0863ff',weight:2,fillColor:'#0863ff',fillOpacity:.17},interactive:false}).addTo(target):null;
    }
    function resetPreview() { previewPin?.remove(); previewShape?.remove(); previewPin=previewShape=null; }
    function framePreview() {
        if (!preview || !selected) return;
        if (previewShape) preview.fitBounds(previewShape.getBounds(),{padding:[28,44],maxZoom:18,animate:false});
        else preview.setView(coordinates(selected.location),$('#class-preview-map').clientWidth<300?17:18,{animate:false});
    }
    function updatePreview() {
        if (!selected || mobile.matches || !dialog.open) return;
        if (!preview) {
            preview=L.map('class-preview-map',{zoomControl:false,attributionControl:true,dragging:false,scrollWheelZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false,touchZoom:false,zoomAnimation:false,fadeAnimation:false});
            preview.attributionControl.setPrefix(false);
            const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(preview);
            tiles.on('tileerror',()=>$('.class-preview-unavailable').hidden=false);
            tiles.on('tileload',()=>$('.class-preview-unavailable').hidden=true);
            observer=new ResizeObserver(()=>{if(dialog.open&&!mobile.matches){preview.invalidateSize({pan:false});framePreview();}});
            observer.observe($('#class-preview-map'));
        }
        preview.invalidateSize({pan:false}); resetPreview();
        const {location}=selected;
        preview.setView(coordinates(location),18,{animate:false});
        previewPin=L.marker(coordinates(location),{icon:pinIcon(),keyboard:false,interactive:false}).addTo(preview)
            .bindTooltip(el('span',location.building.code),{permanent:true,direction:'top',className:'class-building-label',offset:[0,-44]}).openTooltip();
        previewShape=addShape(preview,location);
        framePreview();
        loadFootprints().then(()=>{if(selected?.location===location && preview && !previewShape){previewShape=addShape(preview,location);framePreview();}});
    }
    function placeDetails() {
        const article=selected && results.querySelector(`[data-class-id="${CSS.escape(selected.section.class_id)}"]`);
        if(mobile.matches&&article) article.append(pane); else dialog.append(pane);
        $('#locate-class').innerHTML=icon('directions')+`<span>${navigation?'Directions to class':mobile.matches?'Show on map':'Directions'}</span>`;
        requestAnimationFrame(updatePreview);
    }
    function hideJourney(removePin=false) {
        if(removePin) navigation?.stop();
        cancelJourney?.(); journey.hidden=true; mapNav.hidden=true;
        document.body.classList.remove('class-location-active');
        map.getContainer().classList.remove('class-map-focused');
        map.zoomControl?.setPosition('topleft');
        if(removePin) {locationLayer.clearLayers();marker=shape=null;}
    }
    function clearSelection() {
        dialog.append(pane); selected=null;
        results.querySelectorAll('.class-result').forEach(row=>{row.classList.remove('is-selected'); const b=row.querySelector('button');b.setAttribute('aria-pressed','false');b.setAttribute('aria-expanded','false');});
        detail.hidden=true; $('.class-detail-empty').hidden=false; dialog.classList.remove('has-selection');
        resetPreview(); hideJourney(true);
    }
    function choose(section,location=section.locations[0]) {
        const changed=selected?.section!==section;
        selected={section,location}; detail.hidden=false; $('.class-detail-empty').hidden=true; dialog.classList.add('has-selection');
        results.querySelectorAll('.class-result').forEach(row=>{const chosen=row.dataset.classId===section.class_id;row.classList.toggle('is-selected',chosen);row.querySelector('button').setAttribute('aria-pressed',String(chosen));row.querySelector('button').setAttribute('aria-expanded',String(chosen));});
        $('#class-course-code').textContent=section.course_code; $('#class-course-name').textContent=section.course_name;
        $('#class-section').textContent=`Section ${section.section}`; $('#class-instructor').textContent=section.instructor;
        $('#class-id').textContent=section.class_id; $('#class-schedule').textContent=schedule(section);
        $('#class-room').textContent=`${location.building.code} · Room ${location.room}`;
        $('#class-building').textContent=location.building.name.replace(/Building (\d+)/g,'Building\u00a0$1');
        $('#class-date-range').textContent=`${dateRange(location.dates)} · ${location.dates.length} meetings`;
        $('#class-dates-list').textContent=location.dates.map(formatDate).join(' · ');
        const checked=section.assignment_checked_at;
        $('#class-data-note').textContent=checked?`Room assignment checked ${formatDate(checked.slice(0,10))}, ${checked.slice(0,4)}. Schedules may change. Building pin, not a verified entrance.`:'Room assignment unverified. Building pin, not a verified entrance.';
        const locationChoice=$('#class-location-choice'); locationChoice.replaceChildren();
        section.locations.forEach((loc,index)=>{const option=el('option',`${loc.building.code} · Room ${loc.room} · ${dateRange(loc.dates)}`);option.value=index;option.selected=loc===location;locationChoice.append(option);});
        $('#class-location-label').hidden=section.locations.length<2;
        if(changed) $('.class-dates').open=false;
        if(embedded){extraDetails.open=true;const meta=results.querySelector(`[data-class-id="${CSS.escape(section.class_id)}"] .cu-room-meta`);if(meta)meta.textContent=`${location.building.code} · Room ${location.room}`;window.CampusUI.setSnap('half');}
        placeDetails();
        if(embedded)requestAnimationFrame(()=>{
            const host=window.CampusUI.host('classes'),row=results.querySelector('.class-result.is-selected');
            if(row)host.scrollTo({top:Math.max(0,host.scrollTop+row.getBoundingClientRect().top-host.getBoundingClientRect().top-8),behavior:reduced.matches?'instant':'smooth'});
        });
        announce(`${section.course_code}, section ${section.section} selected. ${location.building.code}, room ${location.room}.`);
    }
    function showFeedback(title,message,retry=false) {
        clearSearchLoading();
        feedback.hidden=false;feedbackHeading.textContent=title;feedbackDetail.textContent=message;$('#class-retry').hidden=!retry;
    }
    function renderMore() {
        const end=Math.min(shown+12,matches.length);
        for(;shown<end;shown++) {
            const section=matches[shown], row=el('article',null,'class-result');row.dataset.classId=section.class_id;
            const button=el('button',null,'class-result-choice');button.type='button';button.setAttribute('aria-pressed','false');button.setAttribute('aria-expanded','false');
            button.setAttribute('aria-label',`${section.course_code}, section ${section.section}, ${section.instructor}, ${schedule(section)}`);
            button.innerHTML=`<span class="class-result-check">${icon('check')}</span><span class="class-result-copy"></span>${icon('right')}`;
            const copy=button.querySelector('.class-result-copy');
            const meta=el('small');meta.append(el('span',`${section.section} · ${formatDays(section.days)}`,'class-result-desktop-meta'),el('span',`Section ${section.section}`,'class-result-mobile-meta'));
            if(embedded&&matches.every(s=>s.course_code===section.course_code)){
                copy.append(el('strong',`Section ${section.section}`),el('span',schedule(section)),el('small',`${section.locations[0].building.code} · Room ${section.locations[0].room}`,'cu-room-meta'));
            }else copy.append(el('strong',section.course_code),el('span',section.course_name),meta);
            button.addEventListener('click',()=>{if(mobile.matches&&selected?.section===section){clearSelection();announce('Selection cleared.');}else choose(section);});
            row.append(button);results.append(row);
        }
        more.hidden=shown>=matches.length;more.textContent=`Show more sections (${matches.length-shown} remaining)`;
    }
    function invalidateSearch() {
        if(courseSummary)courseSummary.hidden=true;
        clearSearchLoading();
        revision++; clearTimeout(searchTimer); clearSelection();results.replaceChildren();matches=[];shown=0;more.hidden=true;
        $('.class-results-scroll').removeAttribute('aria-busy');dialog.classList.remove('is-searching');
    }
    async function search() {
        invalidateSearch(); const current=revision, value=query.value.trim();
        $('#class-clear-query').hidden=!value; $('#class-count').textContent='';
        if(!value){showFeedback('Find your section','Search by course, title or class ID.');announce('Enter a course, title or class ID.');return;}
        dialog.classList.add('is-searching');$('.class-results-scroll').setAttribute('aria-busy','true');
        showFeedback('Finding your class…','Checking sections and meeting times.');announce('Searching the MMC class catalog.');
        searchLoading=window.CampusLoopLoading?.mount(feedback,{label:'Finding your class…',detail:'Checking sections and meeting times.',compact:true});
        if(searchLoading){feedbackHeading.hidden=true;feedbackDetail.hidden=true;}
        try {
            catalog=await loadCatalog();if(current!==revision||!dialog.open)return;
            $('#class-term').textContent=`${catalog.metadata.term_name} · ${catalog.metadata.campus}`;
            matches=catalog.search({mode:'auto',course:value,professor:$('#class-professor').value,time:$('#class-time').value});
            if(courseSummary){const grouped=matches.length&&matches.every(s=>s.course_code===matches[0].course_code);courseSummary.hidden=!grouped;if(grouped)courseSummary.replaceChildren(el('strong',matches[0].course_name),el('span',matches[0].course_code));$('.class-results-heading h3').textContent=grouped?'Choose a section':'Results';}
            $('#class-count').textContent=`${matches.length} ${matches.length===1?'result':'results'}`;
            if(matches.length){feedback.hidden=true;renderMore();announce(`${matches.length} matching sections. Choose a section.`);}
            else{showFeedback('No matching sections','Try a shorter course name or remove a filter. Only mapped MMC classes are included.');announce('No matching sections. Try another search or remove a filter.');}
        }catch{
            if(current!==revision||!dialog.open)return;
            showFeedback('Couldn’t load classes','Your search is saved. Check your connection and try again.',true);announce('Could not load classes. Try again.');
        }finally{if(current===revision){clearSearchLoading();dialog.classList.remove('is-searching');$('.class-results-scroll').removeAttribute('aria-busy');}}
    }
    function onInput() {
        invalidateSearch();$('#class-clear-query').hidden=!query.value;
        const filters=[$('#class-professor').value.trim(),$('#class-time').value].filter(Boolean).length;
        $('#class-filter-count').hidden=!filters;$('#class-filter-count').textContent=filters;
        $('#class-count').textContent='';
        showFeedback(query.value?'Finding your class…':'Find your section',query.value?'Checking sections and meeting times.':'Search by course, title or class ID.');
        searchTimer=setTimeout(search,220);
    }
    $('#class-search-form').addEventListener('submit',event=>{event.preventDefault();search();});
    for(const input of [query,$('#class-professor'),$('#class-time')])input.addEventListener('input',onInput);
    $('#class-clear-query').addEventListener('click',()=>{query.value='';onInput();query.focus();});
    $('#class-filter-toggle').addEventListener('click',()=>{const expanded=$('#class-filters').hidden;$('#class-filters').hidden=!expanded;$('#class-filter-toggle').setAttribute('aria-expanded',String(expanded));});
    $('#class-reset-filters').addEventListener('click',()=>{$('#class-professor').value='';$('#class-time').value='';onInput();});
    $('#class-retry').addEventListener('click',search);more.addEventListener('click',renderMore);
    $('#class-location-choice').addEventListener('change',event=>{if(selected)choose(selected.section,selected.section.locations[Number(event.target.value)]);});
    $('#class-clear-selection').addEventListener('click',()=>{const row=results.querySelector('.is-selected button');clearSelection();row?.focus();announce('Selection cleared. Choose a section.');});
    $('.class-search-help').addEventListener('click',()=>{query.focus();query.select();});
    function open() {
        clearTimeout(exitTimer);dialog.classList.remove('is-closing');hideJourney();
        if(!dialog.open)dialog.showModal();
        placeDetails();
        if(selected)results.querySelector('.is-selected button')?.focus({preventScroll:true});else query.focus({preventScroll:true});
        if(!selected&&query.value&&!matches.length)search();
    }
    function close() {
        if(embedded){window.CampusUI.closeToMap();return;}
        if(!dialog.open)return;
        clearSearchLoading();
        revision++;clearTimeout(searchTimer);
        dialog.classList.add('is-closing');
        exitTimer=setTimeout(()=>{dialog.close();dialog.classList.remove('is-closing');},reduced.matches?0:180);
    }
    openButton.addEventListener('click',open);$('.class-close').addEventListener('click',close);
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close();});
    dialog.addEventListener('close',()=>{clearSearchLoading();revision++;clearTimeout(searchTimer);if(!openingForMap)openButton.focus({preventScroll:true});});
    function finishJourney(state,message) {
        const focusOnStop=document.activeElement===journey.querySelector('.class-stop');
        journey.dataset.state=state;journey.querySelector('.class-journey-state span:last-child').textContent=message;
        journey.querySelector('.class-stop').hidden=true;journey.querySelector('.class-directions').hidden=false;
        if(focusOnStop)journey.querySelector('.class-directions').focus({preventScroll:true});
        if(state==='arrived')marker?.getElement()?.classList.add('has-arrived');
    }
    function locate() {
        if(!selected)return;
        cancelJourney?.();map.closePopup();
        const {section,location}=selected;
        locationLayer.clearLayers();shape=null;
        marker=L.marker(coordinates(location),{icon:pinIcon(mobile.matches?42:46),title:`${location.building.name}, ${location.building.code}`,zIndexOffset:1500}).addTo(locationLayer)
            .bindTooltip(el('span',location.building.code),{permanent:true,direction:'bottom',className:'class-building-label',offset:[0,6]});
        marker.on('click',()=>journey.querySelector('.class-directions').focus());
        shape=addShape(locationLayer,location);
        loadFootprints().then(()=>{if(selected?.location===location&&!shape&&!journey.hidden)shape=addShape(locationLayer,location);});
        journey.querySelector('.class-journey-room').textContent=`${location.building.code} · Room ${location.room}`;
        journey.querySelector('.class-journey-building').textContent=location.building.name;
        journey.querySelector('.class-journey-course strong').textContent=`${section.course_code} · ${section.section}`;
        journey.querySelector('.class-journey-course div > span').textContent=section.course_name;
        journey.querySelector('.class-journey-time > span:last-child').textContent=schedule(section);
        openingForMap=true;dialog.close();openingForMap=false;
        journey.hidden=false;mapNav.hidden=false;document.body.classList.add('class-location-active');
        if(embedded){window.CampusUI.showSubview('classes',journey);journey.prepend(mapNav);}
        map.getContainer().classList.add('class-map-focused');map.zoomControl?.setPosition('topright');
        journey.dataset.state='moving';journey.querySelector('.class-journey-state span:last-child').textContent='Locating building…';
        journey.querySelector('.class-stop').hidden=false;journey.querySelector('.class-directions').hidden=true;
        mapNav.querySelector('button').focus({preventScroll:true});
        if(navigation) {
            finishJourney('located','Class location');
            journey.querySelector('.class-directions span:last-child').textContent='Show route';
            void navigation.start({section,location,panel:journey,onFinish:open});
            return;
        }
        requestAnimationFrame(()=>{
            if(journey.hidden)return;
            map.invalidateSize({pan:false});
            const height=map.getSize().y, sheet=journey.getBoundingClientRect().height;
            const zoom=mobile.matches?17.5:18, dest=map.project(coordinates(location),zoom);
            const top=mobile.matches?70:60, bottom=sheet+(mobile.matches?10:30);
            // Center in the unobstructed area, not behind the summary sheet.
            const visibleCenter=(top+Math.max(top+80,height-bottom))/2;
            const center=map.unproject([dest.x,dest.y+(height/2-visibleCenter)],zoom);
            cancelJourney=locateOnMap({map,coordinates:coordinates(location),center,zoom,reducedMotion:reduced.matches,
                onArrival:()=>finishJourney('arrived','Building located'),
                onCancel:()=>finishJourney('paused','Movement paused')});
        });
    }
    $('#locate-class').addEventListener('click',locate);
    journey.querySelector('.class-stop').addEventListener('click',()=>{cancelJourney?.();journey.querySelector('.class-directions').focus();});
    journey.querySelector('.class-directions').addEventListener('click',()=>navigation?navigation.frame():locate());
    journey.querySelector('.class-dismiss').addEventListener('click',()=>{hideJourney(true);open();});
    mapNav.querySelector('.class-return').addEventListener('click',()=>{navigation?.stop();open();});
    mobile.addEventListener('change',()=>{if(dialog.open)placeDetails();});
    reduced.addEventListener('change',()=>{if(reduced.matches&&journey.dataset.state==='moving'&&!journey.hidden)locate();});
    window.addEventListener('resize',()=>{if(!journey.hidden){if(navigation)navigation.frame();else{cancelJourney?.();finishJourney('paused','Map resized · tap Directions to center');}}});
}
