import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampusCamera,visibleMapAnchor,usableFix,walkingZoom} from './camera.mjs';
class Element extends EventTarget {attrs={};dataset={};hidden=true;setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}}
function fixture(){
 const button=new Element(),feedback=new Element(),container=new Element(),win=new EventTarget();
 globalThis.window=win;globalThis.document={getElementById:id=>id==='cu-recenter'?button:feedback};globalThis.innerWidth=390;globalThis.matchMedia=()=>({matches:false});
 let time=100000,listener,starts=0,top=636,zoom=17,center,frames=0,following=true,shown2D=0;const events=new Map();
 const map={getSize:()=>({x:390,y:844}),getContainer:()=>container,getZoom:()=>zoom,getMaxZoom:()=>19,project:([a,b])=>({x:b*100000,y:-a*100000}),unproject:([x,y])=>({lat:-y/100000,lng:x/100000}),setView:(c,z)=>{center=c;zoom=z;frames++;},stop(){},distance:(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])*111000,on:(n,f)=>events.set(n,f),off:n=>events.delete(n),campusExperience:{active:false,show2D(){shown2D++;this.active=false;}}};
 const locationServices={setFollowing:v=>following=v,subscribe:fn=>{listener=fn;return()=>listener=null;},async start(){starts++;}};
 const camera=createCampusCamera({map,locationServices,ui:{sheet:{getBoundingClientRect:()=>({top})},announce(){}},now:()=>time});
 const emit=(status='tracking',overrides={})=>listener({status,markerVisible:['tracking','weak'].includes(status),fix:{latitude:25.756,longitude:-80.375,accuracy:12,timestamp:time,...overrides}});
 return {camera,map,emit,button,feedback,win,pan:()=>events.get('dragstart')(),layout:t=>{top=t;win.dispatchEvent(new Event('campus-panel-layout'));},advance:n=>time+=n,stats:()=>({starts,center,frames,zoom,following,shown2D})};
}
test('visible location anchor stays centered above peek and expanded panels',()=>{
 assert.deepEqual(visibleMapAnchor({width:390,height:844,panelTop:444,topInset:80}),{x:195,y:254});
 assert.equal(visibleMapAnchor({width:390,height:844,panelTop:636,topInset:80}).y,350);
 assert.ok(visibleMapAnchor({width:390,height:844,panelTop:444,topInset:80,navigating:true}).y>254);
});
test('stale, future, invalid and missing fixes are rejected',()=>{
 const f={latitude:25,longitude:-80,accuracy:10,timestamp:100000};assert.ok(usableFix(f,100000));
 assert.equal(usableFix(f,130001),false);assert.equal(usableFix({...f,timestamp:110000},100000),false);assert.equal(usableFix({...f,accuracy:-1},100000),false);assert.equal(usableFix(null),false);
});
test('GPS updates never move the map until follow is requested',()=>{const f=fixture();f.emit();assert.equal(f.stats().frames,0);assert.equal(f.stats().following,false);f.camera.dispose();});
test('recenter uses a fresh fix, zooms once and offsets for the panel',async()=>{const f=fixture();f.emit();await f.camera.recenter();assert.equal(f.stats().starts,0);assert.equal(f.stats().frames,1);assert.equal(f.stats().zoom,19);assert.notEqual(f.stats().center.lat,25.756);assert.equal(f.button.getAttribute('aria-pressed'),'true');f.camera.dispose();});
test('panning pauses the camera but keeps GPS, then recenter resumes',async()=>{const f=fixture();await f.camera.recenter();assert.equal(f.stats().starts,1);f.emit();const count=f.stats().frames;f.pan();f.emit('tracking',{latitude:25.757});assert.equal(f.stats().frames,count);assert.equal(f.camera.getState().mode,'explore');await f.camera.recenter();assert.equal(f.stats().frames,count+1);assert.equal(f.stats().starts,1);f.camera.dispose();});
test('stationary GPS jitter does not continually animate the camera',async()=>{const f=fixture();f.emit();await f.camera.recenter();const count=f.stats().frames;f.emit('tracking',{latitude:25.756001});assert.equal(f.stats().frames,count);f.emit('tracking',{latitude:25.757});assert.equal(f.stats().frames,count+1);f.camera.dispose();});
test('changing panel height reframes location without raising user zoom',async()=>{const f=fixture();f.emit();await f.camera.recenter();f.map.setView({},16);f.layout(444);await new Promise(r=>setTimeout(r,130));assert.equal(f.stats().zoom,16);assert.equal(f.camera.getState().mode,'follow');f.camera.dispose();});
test('paused location requires restarting and cannot reuse an old visible marker',async()=>{const f=fixture();f.emit();await f.camera.recenter();f.emit('paused');const n=f.stats().frames;await f.camera.recenter();assert.equal(f.stats().starts,1);assert.equal(f.stats().frames,n);f.camera.dispose();});
test('outside-campus recenter switches to the geographic 2D map',async()=>{const f=fixture();f.map.campusExperience.active=true;f.emit('outside',{latitude:25.78});await f.camera.recenter();assert.equal(f.stats().shown2D,1);assert.equal(f.stats().frames,1);f.camera.dispose();});
test('location errors are actionable and disposal releases subscriptions',()=>{const f=fixture();f.emit('denied');assert.match(f.feedback.textContent,/Allow it in your browser/);assert.equal(f.feedback.hidden,false);f.camera.dispose();assert.throws(()=>f.emit());});
test('walking zoom stays honest about accuracy and map limits',()=>{
 assert.equal(walkingZoom(12),19);assert.equal(walkingZoom(120),18);assert.equal(walkingZoom(300),17);assert.equal(walkingZoom(1200),16);assert.equal(walkingZoom(12,18),18);
});
test('GPS acquiring does not claim it is already following',async()=>{
 const f=fixture();await f.camera.recenter();assert.equal(f.button.getAttribute('aria-pressed'),'false');f.emit();assert.equal(f.button.getAttribute('aria-pressed'),'true');f.camera.dispose();
});
test('timeout clears misleading follow state and retries the GPS watch',async()=>{
 const f=fixture();f.emit();await f.camera.recenter();f.emit('timeout');assert.equal(f.button.getAttribute('aria-pressed'),'false');assert.equal(f.camera.getState().fix,null);assert.equal(f.button.getAttribute('aria-label'),'Retry my location');await f.camera.recenter();assert.equal(f.stats().starts,1);f.camera.dispose();
});
test('precision improvement brings a weak initial fix closer once',async()=>{
 const f=fixture();f.emit('weak',{accuracy:180});await f.camera.recenter();assert.equal(f.stats().zoom,17);f.emit('tracking',{accuracy:12});assert.equal(f.stats().zoom,19);f.camera.dispose();
});
test('zoom buttons retain follow and chosen scale on the next GPS step',async()=>{
 const f=fixture();f.emit();await f.camera.recenter();f.camera.zoomBy(-1);assert.equal(f.stats().zoom,18);assert.equal(f.camera.getState().mode,'follow');f.emit('tracking',{latitude:25.757});assert.equal(f.stats().zoom,18);assert.equal(f.stats().starts,0);f.camera.dispose();
});
test('an explicit zoom adjustment prevents later automatic precision zoom',async()=>{
 const f=fixture();f.emit('weak',{accuracy:180});await f.camera.recenter();f.camera.zoomBy(1);f.emit('tracking',{accuracy:12});assert.equal(f.stats().zoom,18);f.camera.dispose();
});
test('starting live navigation tightens a previously wide overview',()=>{
 const f=fixture();f.emit();f.win.dispatchEvent(new CustomEvent('campus-navigation-active',{detail:{active:true}}));assert.equal(f.stats().zoom,19);assert.equal(f.camera.getState().navigating,true);f.camera.dispose();
});
