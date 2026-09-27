import test from 'node:test';
import assert from 'node:assert/strict';
import {startSuggestions,exactStart,routeReady,routeAction,locationFeedback} from '../classNavigation.js';
const places=[{id:'GL',name:'Steven and Dorothea Green Library',aliases:['Green Library']},{id:'GC',name:'Ernest R. Graham Center',aliases:['Graham Center']}];
test('autocomplete matches names, aliases and codes without treating partial text as a committed place',()=>{
  assert.equal(startSuggestions(places,'green')[0].id,'GL');assert.equal(startSuggestions(places,'gc')[0].id,'GC');
  assert.equal(exactStart(places,' GREEN LIBRARY ').id,'GL');assert.equal(exactStart(places,'green'),undefined);
  assert.deepEqual(startSuggestions(places,''),[]);assert.deepEqual(startSuggestions(places,'no such building'),[]);
});
test('a manual route is available without a GPS fix',()=>assert.equal(routeReady({source:'manual',route:{},status:'waiting_location'}),true));
test('an already completed route remains available to finish after GPS is released',()=>assert.equal(routeReady({source:'live',route:{},status:'arrived'}),true));
test('live route start requires a fresh usable position and a connected route',()=>{
  const state={source:'live',route:{},status:'navigating',locationStatus:'good',position:{timestamp:1000}};
  assert.equal(routeReady(state,2000),true);
  for(const patch of [{position:{timestamp:0}},{locationStatus:'weak'},{locationStatus:'denied'},{status:'routing'},{offRoute:true},{route:null}])assert.equal(routeReady({...state,...patch},16000),false);
});
test('manual routes never inherit misleading live-location errors',()=>{
  assert.equal(locationFeedback({source:'manual',locationStatus:'denied'}),null);
  assert.match(locationFeedback({source:'live',locationStatus:'weak'}),/too approximate/);
  assert.match(locationFeedback({source:'live',locationStatus:'denied'}),/blocked/);
  assert.match(locationFeedback({source:'live',locationStatus:'stale'}),/out of date/);
});

test('manual plans cannot enter GPS guidance, even with a usable live fix',()=>{
  const state={source:'manual',route:{},status:'navigating',locationStatus:'good',position:{timestamp:1000}};
  assert.equal(routeAction(state,'setup',2000),null);
  assert.equal(routeAction(state,'preview',2000),'close-estimate');
  assert.equal(routeAction({...state,locationStatus:'denied'},'preview',2000),'close-estimate');
  assert.equal(routeAction(state,'active',2000),'close-estimate');
});
test('GPS guidance starts only from a live preview with a fresh usable position',()=>{
  const state={source:'live',route:{},status:'navigating',locationStatus:'good',position:{timestamp:1000}};
  assert.equal(routeAction(state,'setup',2000),null);
  assert.equal(routeAction(state,'preview',2000),'start-guidance');
  for(const patch of [{source:null},{position:{timestamp:0}},{locationStatus:'weak'},{locationStatus:'denied'},{status:'routing'},{offRoute:true},{route:null}])
    assert.equal(routeAction({...state,...patch},'preview',16000),null);
});
test('an actual GPS trip can end after signal loss or finish after arrival',()=>{
  const state={source:'live',route:{},status:'navigating',locationStatus:'stale'};
  assert.equal(routeAction(state,'active'),'end-guidance');
  assert.equal(routeAction({...state,status:'arrived'},'active'),'finish-guidance');
});
