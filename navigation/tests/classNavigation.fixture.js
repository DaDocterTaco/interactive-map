// Deliberately simulated device source. This page never reads navigator.geolocation.
import { mountClassSearch } from '../../ClassSearch/classSearch.js';
import { mountLocationServices } from '../../locationservices/leafletLocation.js';
import { createClassNavigation } from '../classNavigation.js';
const map = L.map('map', { zoomControl: false }).setView([25.757,-80.373],16);
L.control.zoom({position:'bottomright'}).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
let position = [25.7560301,-80.3728718], accuracy = 5, denied = false, id = 0;
const watchers = new Map();
function emit(watch) {
  if (denied) watch.error({code:1,message:'Simulated permission denial'});
  else watch.success({coords:{latitude:position[0],longitude:position[1],accuracy},timestamp:Date.now()});
}
function publish() { for (const watch of [...watchers.values()]) emit(watch); }
const geolocation = {
  watchPosition(success,error) {
    const watch = {success,error}; const key = id++;
    watchers.set(key,watch); watch.timer = setInterval(()=>emit(watch),1000);
    setTimeout(()=>{if(watchers.has(key)) emit(watch);},0); return key;
  },
  clearWatch(key) {clearInterval(watchers.get(key)?.timer);watchers.delete(key);},
};
const locationServices = mountLocationServices({map,L,geolocation,secureContext:true,
  locateButton:document.querySelector('#open-location'),stopButton:document.querySelector('#stop-location'),
  statusElement:document.querySelector('#location-status')});
const navigation = createClassNavigation({map,L,locationServices});
mountClassSearch({map,L,navigation});
document.querySelector('#test-start').onclick=()=>{position=[25.7560301,-80.3728718];accuracy=5;denied=false;publish();};
document.querySelector('#test-deny').onclick=()=>{denied=true;publish();};
document.querySelector('#test-weak').onclick=()=>{accuracy=200;publish();};
document.querySelector('#test-move').onclick=()=>{
  const points=navigation.getState()?.route?.geometry.coordinates;
  if(points?.length){const [lng,lat]=points[Math.floor(points.length*.55)];position=[lat,lng];accuracy=5;publish();}
};
document.querySelector('#test-arrive').onclick=()=>{
  const point=navigation.getState()?.destination;
  if(point){position=[point.lat,point.lng];accuracy=5;publish();}
};
const report=setInterval(()=>{
  const state=navigation.getState();
  document.querySelector('#test-state').textContent=`Active GPS watches: ${watchers.size} · ${state?.status || 'idle'} · ${state?.mode || 'walk'}`;
},250);
map.on('unload',()=>clearInterval(report));
