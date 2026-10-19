// No idle animation. A generation guard also ignores callbacks already queued
// when a drag ends, a view hides or a graph gets replaced.
export function createDragTicker({request,cancel,step}) {
  let frame=null,generation=0;
  function schedule(token) {
    frame=request(()=>{
      if(token!==generation)return;
      frame=null;
      if(step()&&token===generation)schedule(token);
    });
  }
  return {
    start(){if(frame!==null)return;schedule(++generation);},
    stop(){generation++;if(frame!==null)cancel(frame);frame=null;},
    get running(){return frame!==null;},
  };
}
