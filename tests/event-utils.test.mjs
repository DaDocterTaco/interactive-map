import test from 'node:test';
import assert from 'node:assert/strict';
import {safeUrl, selectEvents, eventTime, isMappable, validateFeed, localDate} from '../event-utils.mjs';
const now=Date.parse('2026-09-26T16:00:00Z');
const event={id:'1',title:'Campus workshop',location:'Graham Center',host:'FIU',building_id:'GC',
    'start time':'2026-09-26T15:00:00Z','end time':'2026-09-26T17:00:00Z',expires_at:'2026-09-26T17:00:00Z',
    latitude:25.756,longitude:-80.373,experience:'inperson',sources:[{name:'fiu_calendar'}]};
test('expired events disappear but ongoing events remain',()=>{
    assert.equal(selectEvents([event],{now,period:'today'}).length,1);
    assert.equal(selectEvents([event],{now:Date.parse(event.expires_at)}).length,0);
});
test('date ranges respect New York and include exactly seven calendar days',()=>{
    const next={...event,'start time':'2026-10-03T04:00:00Z',expires_at:'2026-10-04T04:00:00Z'};
    assert.equal(selectEvents([next],{now}).length,0);
    assert.equal(selectEvents([next],{now,period:'all'}).length,1);
    assert.equal(localDate('2026-09-27T01:00:00Z'),'2026-09-26');
});
test('search and sources filter independently',()=>{
    assert.equal(selectEvents([event],{now,query:'graham'}).length,1);
    assert.equal(selectEvents([event],{now,source:'panther_connect'}).length,0);
});
test('virtual, null coordinates and BBC never get MMC pins',()=>{
    assert.ok(isMappable(event));
    assert.ok(!isMappable({...event,experience:'virtual'}));
    assert.ok(!isMappable({...event,latitude:null}));
    assert.ok(!isMappable({...event,latitude:25.91,longitude:-80.14}));
});
test('unsafe link protocols are rejected',()=>{
    assert.equal(safeUrl('javascript:alert(1)'),null);
    assert.equal(safeUrl('https://calendar.fiu.edu/event/test'),'https://calendar.fiu.edu/event/test');
});
test('all-day and unknown ends are labeled without invented times',()=>{
    assert.match(eventTime({...event,all_day:true}),/All day/);
    assert.match(eventTime({...event,'end time':null}),/End time not published/);
    assert.match(eventTime(event),/EDT/);
    const spanning=eventTime({...event,'end time':'2027-06-02T03:45:00Z'});
    assert.match(spanning,/2026/);assert.match(spanning,/2027/);
});
test('malformed feed cannot replace currently loaded data',()=>{
    const feed={schema_version:2,generated_at:new Date(now).toISOString(),events:[event]};
    assert.equal(validateFeed(feed),feed);
    assert.throws(()=>validateFeed({...feed,events:[event,event]}));
    assert.throws(()=>validateFeed({...feed,events:[{...event,expires_at:'invalid'}]}));
    assert.throws(()=>validateFeed([]));
});
