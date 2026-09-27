export const TIMEZONE = 'America/New_York';
export const sourceName = s => s === 'fiu_calendar' ? 'FIU Calendar' : s === 'panther_connect' ? 'Panther Connect' : s;
export const normalize = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export const safeUrl = value => { try { const u = new URL(value); return ['https:','http:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
export const dayKey = value => new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function addDays(day, count) { const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10); }
const clock = value => new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,hour:'numeric',minute:'2-digit'}).format(new Date(value));
export function eventTime(e) {
    if(e.all_day) return 'All day';
    if(!e.end_at || Date.parse(e.end_at)<=Date.parse(e.start_at)) return `${clock(e.start_at)} · End time not listed`;
    const same=dayKey(e.start_at)===dayKey(e.end_at);
    let start=clock(e.start_at),end=clock(e.end_at);
    if(same&&start.slice(-2)===end.slice(-2))start=start.replace(/\s[AP]M$/,'');
    return `${start}–${same?'':new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,month:'short',day:'numeric'}).format(new Date(e.end_at))+' · '}${end}`;
}
export function eventDate(e, now=Date.now()) {
    const date=dayKey(e.start_at), today=dayKey(now);
    const prefix=date===today?'Today':date===addDays(today,1)?'Tomorrow':new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,weekday:'short'}).format(new Date(e.start_at));
    return `${prefix}, ${new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,month:'short',day:'numeric'}).format(new Date(e.start_at))}`;
}
const aliases={GL:['Green Library','Steven Dorothea Green Library'],GC:['Graham Center','Graham University Center'],PC:['Primera Casa','Charles Perry'],MARC:['MARC Building'],SIPA:['School of International Public Affairs'],SIPA2:['SIPA II','SIPA 2'],OBCC:['Ocean Bank Convocation Center','Golden Panther Arena'],WPAC:['Wertheim Performing Arts Center'],FROST:['Frost Art Museum'],PBST:['Pitbull Stadium','FIU Stadium']};
export function resolveVenue(e, buildings) {
    const location=e.location || '', text=normalize(location);
    const online=e.experience==='virtual' || /\b(zoom|teams microsoft|online|virtual)\b/.test(text);
    if(online) return {building:null,campus:'Online'};
    if(/\b(bbc|biscayne bay|wolfe|wuc)\b/.test(text)) return {building:null,campus:'BBC'};
    if(/\b(engineering center|ec \d|brickell|doral|washington|utep|ritz carlton|south beach)\b/.test(text)) return {building:null,campus:'Other locations'};
    if(safeUrl(location)) return {building:null,campus:'Unspecified'};
    const matches=buildings.filter(b=>b.abbreviation!=='EC' && b.latitude>=25.745 && b.latitude<=25.77 && b.longitude>=-80.39 && b.longitude<=-80.36).map(b=> {
        const names=[b.full_name,...(aliases[b.abbreviation]||[])].map(normalize);
        const nameMatch=names.filter(n=>n.length>3 && text.includes(n)).sort((a,b)=>b.length-a.length)[0];
        const code=b.abbreviation.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        const codeMatch=new RegExp(`(?:^|[^a-z0-9])${code}(?=$|[^a-z]|[0-9])`,'i').test(location);
        return {building:b,score:nameMatch?.length || (codeMatch?b.abbreviation.length:0)};
    }).filter(x=>x.score).sort((a,b)=>b.score-a.score);
    if(matches.length && (matches.length===1 || matches[0].score>matches[1].score)) return {building:matches[0].building,campus:'MMC'};
    return {building:null,campus:/\b(mmc|modesto a maidique)\b/.test(text)?'MMC':'Unspecified'};
}
export function prepareEvents(events,buildings) {
    return events.map(e=> {
        const venue=resolveVenue(e,buildings);
        return {...e,venue, _title:normalize(e.title), _search:normalize([e.search_text,e.title,e.description,e.host,e.location,e.room,e.categories?.join(' '),e.food?.items?.join(' '),venue.campus,venue.building?.full_name,venue.building?.abbreviation].join(' '))};
    });
}
export function isLongRunning(e) { return e.all_day || (Date.parse(e.end_at)-Date.parse(e.start_at)>24*3600e3); }
export function isOngoing(e,now=Date.now()) {return !e.all_day && !!e.end_at && Date.parse(e.start_at)<=now && Date.parse(e.end_at)>now;}
function typoMatch(term, word) {
    if(term.length<5 || Math.abs(term.length-word.length)>1) return false;
    let i=0,j=0,edits=0;
    while(i<term.length && j<word.length) {
        if(term[i]===word[j]){i++;j++;continue;}
        if(++edits>1)return false;
        if(term.length>=word.length)i++;
        if(word.length>=term.length)j++;
    }
    return edits+(term.length-i)+(word.length-j)<=1;
}
export function selectEvents(events,state={},now=Date.now()) {
    const today=dayKey(now), period=state.period||'upcoming', query=normalize(state.query), terms=query.split(' ').filter(Boolean);
    const latest=period==='past'?addDays(today,1):period==='today'?addDays(today,1):addDays(today,period==='week'?7:22);
    const selected=[];
    for(const e of events) {
        const start=Date.parse(e.start_at), end=Date.parse(e.visibility_end_at || e.end_at || e.start_at), startDay=dayKey(start);
        if(!state.cancelled && e.status==='cancelled')continue;
        if(period==='past') {if(end>now || dayKey(end)<addDays(today,-7))continue;}
        else {if(end<=now || startDay>=latest)continue;}
        if(state.food==='available' && e.food?.availability!=='available')continue;
        if(state.food==='free' && (e.food?.availability!=='available'||e.food?.price!=='free'))continue;
        if(state.food==='refreshments' && !e.food?.items?.some(x=>/coffee|tea|refreshment|water|drink/.test(x)))continue;
        if(state.free && e.admission!=='free')continue;
        if(state.category && !e.categories?.includes(state.category))continue;
        if(state.campus && e.venue.campus!==state.campus)continue;
        if(state.source && !e.sources?.some(s=>s.source===state.source))continue;
        let score=0, match=true;
        for(const term of terms) {
            if(e._search.includes(term)){score+=e._title.includes(term)?10:2;continue;}
            if(e._search.split(' ').some(w=>typoMatch(term,w))){score+=1;continue;}
            match=false;break;
        }
        if(match)selected.push({event:e,score});
    }
    const sort=state.sort||'soonest';
    selected.sort((a,b)=> {
        const x=a.event,y=b.event;
        if(sort==='match' && terms.length && a.score!==b.score)return b.score-a.score;
        if(sort==='az')return x.title.localeCompare(y.title) || x.start_at.localeCompare(y.start_at);
        if(sort==='updated') {const diff=(Date.parse(y.source_updated_at)||0)-(Date.parse(x.source_updated_at)||0);if(diff)return diff;}
        if(period==='past')return Date.parse(y.visibility_end_at)-Date.parse(x.visibility_end_at)||x.title.localeCompare(y.title);
        // Scheduled, short events take precedence over long exhibitions/deadlines.
        if(isLongRunning(x)!==isLongRunning(y))return isLongRunning(x)?1:-1;
        return x.start_at.localeCompare(y.start_at)||x.title.localeCompare(y.title);
    });
    return selected.map(x=>x.event);
}
export function locationText(e) { const place=e.location && !safeUrl(e.location)?e.location:(e.venue?.campus==='Online'?'Online':'Location in official listing');return place+(e.room && !normalize(place).includes(normalize(e.room))?` · ${e.room}`:''); }
