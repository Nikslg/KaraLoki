(() => {
  "use strict";
  const cfg=window.KARALOKI_CONFIG||{},$=id=>document.getElementById(id);
  let refreshBusy=false,lastState=null,serverOffsetMs=0,countdownTarget=null,countdownPaused=false;
  function api(action,params={}){
    if(!cfg.API_URL||cfg.API_URL.includes("PASTE_YOUR"))return Promise.reject(new Error("Сначала укажите URL Apps Script в js/config.js."));
    return new Promise((resolve,reject)=>{
      const callback="kl_queue_cb_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2);
      const query=new URLSearchParams({action,callback,...params}),script=document.createElement("script");
      let settled=false,cleaned=false,graceTimer=null;
      const cleanup=()=>{if(cleaned)return;cleaned=true;clearTimeout(timeout);clearTimeout(graceTimer);delete window[callback];script.remove();};
      const finish=(err,data)=>{if(settled){cleanup();return;}settled=true;clearTimeout(timeout);err?reject(err):resolve(data);if(err)graceTimer=setTimeout(cleanup,120000);else cleanup();};
      const timeout=setTimeout(()=>finish(new Error("Сервер отвечает слишком долго.")),30000);
      window[callback]=data=>{if(settled){cleanup();return;}data&&data.ok?finish(null,data):finish(new Error(data?.error||"Не удалось загрузить очередь."));};
      script.onerror=()=>{if(!settled)finish(new Error("Не удалось связаться с сервером. Проверьте URL Apps Script."));else cleanup();};
      script.src=cfg.API_URL+(cfg.API_URL.includes("?")?"&":"?")+query.toString();document.body.appendChild(script);
    });
  }
  function songLabel(item){return item.artist?`${item.song} — ${item.artist}`:item.song;}
  function time(seconds){const n=Math.max(0,Math.floor(Number(seconds)||0));return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0");}
  function recentPrevious(items){
    const now=Date.now()+serverOffsetMs,cutoff=now-60*60*1000;
    return (items||[]).filter(item=>{const t=new Date(item.playedAt||0).getTime();return Number.isFinite(t)&&t>=cutoff&&t<=now;}).slice(-2);
  }
  function renderQueue(state){
    const list=$("queue-list"),upcoming=state.queue||[],previous=recentPrevious(state.previous),current=state.current;
    list.replaceChildren();
    $("queue-count").textContent=`${upcoming.length} ${upcoming.length===1?"песня":"песен"}`;
    const entries=[...previous.map(item=>({item,kind:"previous",number:""})),
      ...(current?[{item:current,kind:"current",number:""}]:[]),
      ...upcoming.map((item,i)=>({item,kind:"upcoming",number:String(i+1).padStart(2,"0")}))];
    if(!entries.length){const li=document.createElement("li");li.className="empty";li.textContent="Очередь пока пуста.";list.appendChild(li);return;}
    entries.forEach(({item,kind,number})=>{
      const li=document.createElement("li");li.className=`queue-item public-queue-item ${kind}`;
      if(kind==="current")li.setAttribute("aria-current","true");
      const num=document.createElement("span");num.className="queue-number";num.textContent=number;
      const body=document.createElement("div");body.className="queue-item-body";
      const song=document.createElement("div");song.className="queue-song";song.textContent=songLabel(item);
      const requester=document.createElement("div");requester.className="queue-requester";requester.textContent=`Заказал(а): ${item.requester||"—"}`;
      if(kind==="current"){const marker=document.createElement("span");marker.className="current-queue-marker";marker.textContent="СЕЙЧАС ИГРАЕТ";body.append(marker,song,requester);}
      else body.append(song,requester);
      li.append(num,body);list.appendChild(li);
    });
  }
  function render(state){
    lastState=state;$("startup-loading")?.classList.add("is-hidden");
    const current=state.current;
    $("current-song").textContent=current?songLabel(current):"Пока ничего не играет";
    $("current-requester").textContent=current?`Заказал(а): ${current.requester||"—"}`:"Будьте первым, кто закажет песню";
    $("playback-state").textContent=state.paused?"Пауза":(current?"Играет":"Ожидание");
    countdownPaused=!!state.paused;serverOffsetMs=Number(state.serverNow||Date.now())-Date.now();
    countdownTarget=current&&!countdownPaused&&state.expiresAt?Number(state.expiresAt):
      (current&&!countdownPaused?Date.now()+serverOffsetMs+Math.max(0,Number(state.remainingSeconds)||0)*1000:null);
    $("countdown").textContent=current?time(state.remainingSeconds):"—";
    $("countdown").classList.toggle("paused",countdownPaused);
    renderQueue(state);$("queue-error").classList.add("hidden");$("queue-error").textContent="";
  }
  async function refresh(){
    if(refreshBusy)return;refreshBusy=true;
    try{const result=await api("state");render(result.state);}
    catch(error){$("queue-error").textContent=error.message||"Не удалось обновить очередь.";$("queue-error").classList.remove("hidden");}
    finally{refreshBusy=false;}
  }
  setInterval(()=>{
    if(countdownTarget!==null&&!countdownPaused){
      const remaining=Math.max(0,Math.ceil((countdownTarget-(Date.now()+serverOffsetMs))/1000));
      $("countdown").textContent=time(remaining);
    }
  },1000);
  refresh();setInterval(refresh,Math.max(5000,Number(cfg.REFRESH_MS)||5000));
})();