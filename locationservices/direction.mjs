export const wrapHeading = value => ((value % 360) + 360) % 360;
export const headingDelta = (from, to) => ((to - from + 540) % 360) - 180;

/** Model axes: east = +x, north = -z. Camera sits behind the compass heading. */
export function headingView(heading, tilt=32) {
  const bearing=heading*Math.PI/180, polar=tilt*Math.PI/180;
  return {x:-Math.sin(bearing)*Math.sin(polar),y:Math.cos(polar),z:Math.cos(bearing)*Math.sin(polar)};
}

/** Only Earth-referenced readings can point to north. Relative alpha is not a compass. */
export function compassHeading(event, screenAngle = 0) {
  if (Number.isFinite(event.webkitCompassHeading)) {
    if (Number.isFinite(event.webkitCompassAccuracy) &&
        (event.webkitCompassAccuracy < 0 || event.webkitCompassAccuracy > 35)) return null;
    return wrapHeading(event.webkitCompassHeading + screenAngle);
  }
  if (event.absolute !== true || !Number.isFinite(event.alpha)) return null;
  // For a phone held upright, project the outward viewing direction onto the ground.
  if (Number.isFinite(event.beta) && Number.isFinite(event.gamma) && Math.abs(event.beta) > 45) {
    const a=event.alpha*Math.PI/180, b=event.beta*Math.PI/180, g=event.gamma*Math.PI/180;
    const x=-Math.cos(a)*Math.sin(g)-Math.sin(a)*Math.sin(b)*Math.cos(g);
    const y=-Math.sin(a)*Math.sin(g)+Math.cos(a)*Math.sin(b)*Math.cos(g);
    if (Math.hypot(x,y) > .1) return wrapHeading(Math.atan2(x,y)*180/Math.PI);
  }
  return wrapHeading(360-event.alpha+screenAngle);
}

export function directionCone(fix, heading, radius=22) {
  const points=[[fix.latitude,fix.longitude]];
  for(let i=0;i<=16;i++) {
    const angle=(heading-28+i*56/16)*Math.PI/180;
    points.push([fix.latitude+Math.cos(angle)*radius/111320,
      fix.longitude+Math.sin(angle)*radius/(111320*Math.cos(fix.latitude*Math.PI/180))]);
  }
  return points;
}

/** User-initiated compass subscription; permission failures never interrupt GPS. */
export function createDirectionTracker({target=globalThis.window, document=globalThis.document,
  secure=globalThis.isSecureContext, now=Date.now, onChange=()=>{},
  setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  let active=false,disposed=false,pending=null,generation=0,heading=null,lastEmit=-Infinity,timer;
  const emit=(status,value=null)=>onChange({status,heading:value});
  const angle=()=>target?.screen?.orientation?.angle ?? target?.orientation ?? 0;
  function receive(event) {
    if(!active || disposed)return;
    const value=compassHeading(event,angle());
    if(value===null)return;
    clearTimer(timer);
    timer=setTimer(()=>{heading=null;emit('stale');},8000);
    const time=now();
    if(time-lastEmit<100)return;
    heading=heading===null?value:wrapHeading(heading+headingDelta(heading,value)*.3);
    lastEmit=time;emit('tracking',heading);
  }
  function stop() {
    generation++;active=false;pending=null;heading=null;lastEmit=-Infinity;clearTimer(timer);
    target?.removeEventListener('deviceorientation',receive);
    target?.removeEventListener('deviceorientationabsolute',receive);
    emit('paused');
  }
  async function start() {
    if(disposed||active)return;
    if(pending)return pending;
    if(!secure){emit('insecure');return;}
    const Orientation=target?.DeviceOrientationEvent;
    if(!Orientation){emit('unsupported');return;}
    const token=++generation;
    // Invoke synchronously inside the Recenter click, before any GPS/network await.
    let permission;
    try { permission=typeof Orientation.requestPermission==='function'?Orientation.requestPermission(true):'granted'; }
    catch { emit('denied');return; }
    pending=(async()=>{
      try {
        const result=await permission;
        if(disposed||token!==generation)return;
        if(result!=='granted'){emit('denied');return;}
        active=true;emit('waiting');
        target.addEventListener('deviceorientation',receive);
        target.addEventListener('deviceorientationabsolute',receive);
        timer=setTimer(()=>emit('unavailable'),8000);
      } catch { if(!disposed&&token===generation)emit('denied'); }
      finally { if(token===generation)pending=null; }
    })();
    return pending;
  }
  const visibility=()=>{if(document?.hidden)stop();};
  document?.addEventListener?.('visibilitychange',visibility);
  target?.addEventListener('pagehide',stop);
  return {start,stop,dispose(){stop();disposed=true;document?.removeEventListener?.('visibilitychange',visibility);target?.removeEventListener('pagehide',stop);}};
}
