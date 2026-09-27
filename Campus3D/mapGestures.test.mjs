import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapTapGesture} from './mapGestures.mjs';
const event=(id=1,x=10,y=10)=>({pointerId:id,clientX:x,clientY:y,pointerType:'touch',button:0});
test('a stationary finger taps, two nearby taps request zoom',()=>{
 let t=0;const g=createMapTapGesture({now:()=>t});g.down(event());t=60;assert.equal(g.up(event()),'tap');
 t=180;g.down(event());t=240;assert.equal(g.up(event()),'double');
});
test('a drag that returns to its start never selects a marker',()=>{
 const g=createMapTapGesture();g.down(event());g.move(event(1,90));assert.equal(g.up(event()),null);assert.ok(g.suppressClick());
});
test('pinch suppresses both releases and compatibility click',()=>{
 const g=createMapTapGesture();g.down(event());g.down(event(2,100));assert.equal(g.up(event(2,180)),null);assert.equal(g.up(event()),null);assert.ok(g.suppressClick());
});
test('cancellation and long press cannot leave a pending map tap',()=>{
 let t=0;const g=createMapTapGesture({now:()=>t});g.down(event());g.cancel(event());assert.equal(g.up(event()),null);
 t=1000;g.down(event());t=1600;assert.equal(g.up(event()),null);
});
test('fresh gestures recover after pointer cancellation',()=>{
 let t=0;const g=createMapTapGesture({now:()=>t});g.down(event());g.cancel(event());t=500;g.down(event());assert.equal(g.up(event()),'tap');assert.equal(g.suppressClick(),false);
});
