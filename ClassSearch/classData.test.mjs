// Exercise searches against the bundled snapshot, including room/date grouping
// and loader behavior without a browser or Firebase connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCatalog,createCatalogLoader,formatTime,formatDays} from './classData.mjs';
const data=JSON.parse(readFileSync(new URL('./classes.json',import.meta.url)));
const catalog=createCatalog(data);

test('bare course numbers and numeric prefixes find sections across departments',()=>{
    for(const course of ['2021','202',' 2021 ']) {
        const expected=data.sections.filter(row=>row.course_code.match(/\d{4}/)?.[0].startsWith(course.trim())).map(row=>row.class_id).sort();
        const actual=catalog.search({mode:'auto',course});
        assert.ok(expected.length>0);
        assert.deepEqual(actual.map(row=>row.class_id).sort(),expected);
    }
    const rows=catalog.search({mode:'auto',course:'2021'});
    assert.ok(rows.some(row=>row.course_code==='ACG 2021'));
    const first=rows[0];
    assert.deepEqual(catalog.search({mode:'auto',course:'2021',professor:first.instructor,time:first.start_time}),rows.filter(row=>row.instructor===first.instructor&&row.start_time===first.start_time));
    assert.deepEqual(catalog.search({mode:'auto',course:'2021',professor:'Nobody Matches'}),[]);
    assert.deepEqual(catalog.search({mode:'auto',course:'999999'}),[]);
    assert.deepEqual(catalog.search({mode:'id',classId:'2021'}),[]);
});

test('unified search handles IDs, department prefixes and partial numbers with filters',()=>{
    const expected=catalog.search({mode:'id',classId:'84848'});
    assert.deepEqual(catalog.search({mode:'auto',course:'84848'}),expected);
    assert.deepEqual(catalog.search({mode:'auto',course:'84848',professor:'nobody'}),[]);
    for(const course of ['COT','cot 3','cot-31']) {
        const results=catalog.search({mode:'auto',course});
        assert.ok(results.some(row=>row.class_id==='84848'));
        assert.ok(results.every(row=>row.course_code.startsWith('COT')));
    }
    assert.deepEqual(catalog.search({mode:'auto',course:'COT 3100',professor:'WHITTAKER',time:'08:00'}),expected);
});

test('class ID and course/professor/time find the same verified COT section',()=>{
    const id=catalog.search({mode:'id',classId:' 84848 '});
    assert.equal(id.length,1);
    for(const course of ['cot3100','COT 3100','COT-3100','Discrete Structures']) {
        assert.deepEqual(catalog.search({course,professor:'whittaker',time:'08:00'}),id);
    }
    assert.equal(id[0].locations[0].building.code,'INV1');
    assert.equal(id[0].locations[0].room,'302');
    assert.equal(id[0].locations[0].dates.length,29);
    assert.ok(!id[0].locations[0].dates.includes('2026-11-26'));
    assert.equal(id[0].location_status,'Assigned in FIU 25Live');
    assert.equal(id[0].assignment_verified,true);
});
test('no unrelated results for empty input, wrong term, wrong professor/time or malformed ID',()=>{
    for(const query of [{},{course:'   '},{mode:'id',classId:'8484'},{mode:'id',classId:'84848abc'},{mode:'id',classId:'843076'},{course:'cot3100',term:'1258'},{course:'cot3100',professor:'Nobody Matches'},{course:'cot3100',time:'09:30'}])assert.deepEqual(catalog.search(query),[]);
});
test('all sections stay searchable and every original room/date survives grouping',()=>{
    for(const section of data.sections){
        const [row]=catalog.search({mode:'id',classId:section.class_id});
        assert.equal(row.assignment_verified,true);
        assert.equal(row.instructor,section.instructor);
        for(const meeting of section.meetings){
            const location=row.locations.find(location=>location.id===meeting.room_id);
            assert.ok(location);
            assert.ok(meeting.dates.every(date=>location.dates.includes(date)));
        }
    }
    const rows=catalog.search({course:'ACG 2021'});
    assert.ok(rows.length>1);
    assert.equal(rows.length,data.sections.filter(s=>s.course_code==='ACG 2021').length);
    assert.ok(rows.every((row,i)=>i===0||rows[i-1].start_time<=row.start_time));
});
test('old or unverified records cannot inherit an assigned badge from metadata',()=>{
    const altered=structuredClone(data);
    altered.metadata.location_status='Assigned in FIU 25Live';
    altered.sections[0].assignment_verified=false;
    const first=altered.sections[0].class_id;
    assert.equal(createCatalog(altered).search({mode:'id',classId:first})[0].location_status,'Assignment not verified');
    altered.sections[0].assignment_verified=true;altered.sections[0].assignment_checked_at=undefined;
    assert.equal(createCatalog(altered).search({mode:'id',classId:first})[0].assignment_verified,false);
    altered.metadata.schema_version=1;
    assert.equal(createCatalog(altered).search({mode:'id',classId:data.sections.at(-1).class_id})[0].assignment_verified,false);
});
test('loader fetches once for concurrent and repeated searches, but retries failures',async()=>{
    let calls=0;
    const load=createCatalogLoader('unused',async()=>{calls++;return {ok:true,json:async()=>data};});
    const [a,b]=await Promise.all([load(),load()]);assert.equal(a,b);await load();assert.equal(calls,1);
    let attempts=0;
    const retry=createCatalogLoader('unused',async()=>{if(++attempts===1)return {ok:false};return {ok:true,json:async()=>data};});
    await assert.rejects(retry());assert.ok(await retry());assert.equal(attempts,2);
});
test('schedule text preserves noon, midnight and weekday meanings',()=>{
    assert.equal(formatTime('00:15'),'12:15 AM');assert.equal(formatTime('12:00'),'12:00 PM');assert.equal(formatTime('17:30'),'5:30 PM');assert.equal(formatDays(['T','Th']),'Tue / Thu');
});
