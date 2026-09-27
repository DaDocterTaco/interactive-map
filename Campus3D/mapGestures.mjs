/** Keep a map tap distinct from a drag, canceled touch, or multi-finger gesture. */
export function createMapTapGesture({now = () => performance.now()} = {}) {
  const pointers = new Map();
  let blocked = false, lastTap = null, suppressUntil = 0;
  return {
    down(event) {
      if (!pointers.size) blocked = false;
      pointers.set(event.pointerId, {x:event.clientX, y:event.clientY, time:now()});
      if (pointers.size > 1 || event.button > 0) blocked = true;
    },
    move(event) {
      const start = pointers.get(event.pointerId);
      if (start && Math.hypot(event.clientX-start.x,event.clientY-start.y) > 8) blocked = true;
    },
    up(event) {
      this.move(event);
      const start = pointers.get(event.pointerId);
      pointers.delete(event.pointerId);
      if (!start || blocked || now()-start.time > 500) {
        lastTap = null; suppressUntil = now()+400; return null;
      }
      const point = {x:event.clientX,y:event.clientY,time:now()};
      const double = event.pointerType === 'touch' && lastTap && now()-lastTap.time < 320 &&
        Math.hypot(point.x-lastTap.x,point.y-lastTap.y) < 28;
      lastTap = double ? null : point;
      return double ? 'double' : 'tap';
    },
    cancel(event) {
      pointers.delete(event.pointerId); blocked=true; lastTap=null; suppressUntil=now()+400;
    },
    suppressClick() { return now() < suppressUntil; }
  };
}
