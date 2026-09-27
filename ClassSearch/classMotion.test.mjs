import test from 'node:test';
import assert from 'node:assert/strict';
import { locateOnMap } from './classMotion.mjs';

function fixture() {
    const listeners=new Map(),inputs=new Map(),queue=new Map();let id=0,arrivals=0,cancellations=0;
    const map={options:{zoomSnap:1},center:[0,0],zoom:16,views:[],
        getContainer:()=>({addEventListener:(key,fn)=>inputs.set(key,fn),removeEventListener:key=>inputs.delete(key)}),
        getCenter(){return this.center;},getZoom(){return this.zoom;},getMaxZoom:()=>19,
        distance:(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])*1000,
        project:p=>({x:p[0],y:p[1]}),unproject:p=>p,
        on:(key,fn)=>listeners.set(key,fn),off:key=>listeners.delete(key),stop(){if(this.options.zoomSnap)this.zoom=Math.round(this.zoom/this.options.zoomSnap)*this.options.zoomSnap;listeners.get('moveend')?.();},
        setView(p,z,o){this.center=p;this.zoom=z;this.views.push({p,z,o});listeners.get('moveend')?.();}};
    const start=extra=>locateOnMap({map,coordinates:[1,1],onArrival:()=>arrivals++,onCancel:()=>cancellations++,now:()=>0,requestFrame:fn=>{queue.set(++id,fn);return id;},cancelFrame:key=>queue.delete(key),...extra});
    const tick=time=>{const callbacks=[...queue.values()];queue.clear();callbacks.forEach(fn=>fn(time));};
    return {map,start,tick,inputs,listeners,queue,counts:()=>[arrivals,cancellations]};
}
test('camera zoom is monotonic, settles at the padded center, and restores map settings',()=>{
    const f=fixture();f.start({center:[1,1.4]});
    for(let time=0;time<=2800;time+=100)f.tick(time);
    assert.deepEqual(f.counts(),[1,0]);assert.deepEqual(f.map.center,[1,1.4]);
    assert.equal(f.map.zoom,18);assert.equal(f.map.options.zoomSnap,1);
    assert.ok(f.map.views.every((v,i,all)=>v.z>=16&&v.z<=18&&(!i||v.z>=all[i-1].z)));
    assert.equal(f.queue.size+f.listeners.size+f.inputs.size,0);
});
test('reduced motion jumps directly without a queued animation',()=>{
    const f=fixture();f.start({reducedMotion:true});assert.deepEqual(f.counts(),[1,0]);assert.equal(f.map.views.length,1);assert.equal(f.queue.size,0);
});
test('repeated locate at the same center does not restart motion',()=>{
    const f=fixture();f.map.center=[1,1];f.map.zoom=18;f.start();assert.deepEqual(f.counts(),[1,0]);assert.equal(f.queue.size,0);
});
for(const input of ['pointerdown','wheel','keydown'])test(`${input} interrupts without a false arrival`,()=>{
    const f=fixture();const cancel=f.start();f.tick(800);f.inputs.get(input)({key:'Escape'});cancel();f.tick(2800);
    assert.deepEqual(f.counts(),[0,1]);assert.equal(f.map.options.zoomSnap,1);assert.equal(f.queue.size+f.listeners.size+f.inputs.size,0);
});
test('external map movement cancels; normal Tab navigation does not',()=>{
    const f=fixture();f.start();f.inputs.get('keydown')({key:'Tab'});assert.deepEqual(f.counts(),[0,0]);f.listeners.get('moveend')();assert.deepEqual(f.counts(),[0,1]);
});
test('large elapsed time still completes once at the exact destination',()=>{
    const f=fixture();f.start();f.tick(15000);f.tick(16000);assert.deepEqual(f.counts(),[1,0]);assert.deepEqual(f.map.center,[1,1]);
});
test('fractional zoom neither snaps on repeat nor jumps when interrupted',()=>{
    const f=fixture();f.map.center=[1,1];f.map.zoom=17.5;f.start({zoom:17.5});
    assert.deepEqual(f.counts(),[1,0]);assert.equal(f.queue.size,0);assert.equal(f.map.zoom,17.5);
    const g=fixture();const cancel=g.start();g.tick(800);const before=g.map.zoom;cancel();assert.equal(g.map.zoom,before);
});
