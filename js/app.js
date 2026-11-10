(() => {
  // KaraLoki v1.8.7 — guest client.
  "use strict";
  const cfg = window.KARALOKI_CONFIG || {}, $ = id => document.getElementById(id);
  const NAME_KEY = "karaloki_guest_name";
  let guestName = localStorage.getItem(NAME_KEY) || "";
  const SESSION_KEY="karaloki_guest_session";let sessionToken=localStorage.getItem(SESSION_KEY)||"",transferRequestId="",transferStatusTimer=null;
  let lastState = null, countdownTarget = null, countdownPaused = false, initialLoadDone = false, serverOffsetMs = 0;
  let cooldownUntil = 0, banUntil = 0, busy = false, refreshBusy = false, refreshPromise = null, nextRefreshAt = 0, retryDelay = 2000, zeroRefreshRequested = false, playbackTransitionBusy = false;

  function api(action, params = {}) {
    if (!cfg.API_URL || cfg.API_URL.includes("PASTE_YOUR")) return Promise.reject(new Error("Сначала укажите URL Apps Script в файле js/config.js."));
    return new Promise((resolve,reject) => {
      const callback = "kl_cb_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2), query = new URLSearchParams({action,callback,...params});
      const script = document.createElement("script"); let settled=false,cleaned=false,graceTimer=null;
      const cleanup=()=>{if(cleaned)return;cleaned=true;clearTimeout(timeout);clearTimeout(graceTimer);delete window[callback];script.remove();};
      const finish=(err,data)=>{if(settled){cleanup();return;}settled=true;clearTimeout(timeout);err?reject(err):resolve(data);if(err){graceTimer=setTimeout(cleanup,120000);}else cleanup();};
      const timeout=setTimeout(()=>finish(new Error("Сервер отвечает слишком долго. Попробуйте ещё раз.")),45000);
      window[callback] = data => {if(settled){cleanup();return;}data&&data.ok?finish(null,data):finish(new Error(data?.error || "Не удалось выполнить запрос."));};
      script.onerror = () => {if(!settled)finish(new Error("Не удалось связаться с сервером. Проверьте URL Apps Script."));else cleanup();};
      script.src = cfg.API_URL + (cfg.API_URL.includes("?")?"&":"?") + query.toString(); document.body.appendChild(script);
    });
  }
  function msg(id,value,error=false){$(id).textContent=value||"";$(id).style.color=error?"#ff9c9c":"";}
  function time(s){s=Math.max(0,Math.floor(Number(s)||0));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}
  function songLabel(item){return item.artist?`${item.song} — ${item.artist}`:item.song;}
  function normalizeName(value){return String(value||"").trim().replace(/\s+/g," ").toLocaleLowerCase();}
  function recentPrevious(items){const now=Date.now()+serverOffsetMs,cutoff=now-60*60*1000;return (items||[]).filter(item=>{const t=new Date(item.playedAt||0).getTime();return Number.isFinite(t)&&t>=cutoff&&t<=now;}).slice(-2);}
  function showOnly(id){["guest-login-panel","guest-pending-panel","guest-banned-panel","guest-session-occupied-panel","public-content"].forEach(x=>$(x).classList.toggle("hidden",x!==id));$("guest-logout").classList.toggle("hidden",id!=="public-content");}
  function renderQueue(state){
    const list=$("queue-list"),upcoming=state.queue||[],previous=recentPrevious(state.previous),current=state.current;
    list.replaceChildren();
    $("queue-count").textContent=`${upcoming.length} ${upcoming.length===1?"песня":"песен"}`;
    const entries=[
      ...previous.map(item=>({item,kind:"previous",number:""})),
      ...(current?[{item:current,kind:"current",number:""}]:[]),
      ...upcoming.map((item,i)=>({item,kind:"upcoming",number:String(i+1).padStart(2,"0")}))
    ];
    if(!entries.length){const li=document.createElement("li");li.className="empty";li.textContent="Очередь пока пуста. Закажите первую песню!";list.appendChild(li);return;}
    entries.forEach(({item,kind,number})=>{
      const li=document.createElement("li");li.className=`queue-item public-queue-item ${kind}`;
      if(kind==="upcoming"&&normalizeName(item.requester)===normalizeName(guestName))li.classList.add("my-request");
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
    lastState=state;initialLoadDone=true;$("startup-loading")?.classList.add("is-hidden");const current=state.current;
    $("current-song").textContent=current?songLabel(current):"Пока ничего не играет";
    $("current-requester").textContent=current?`Заказал(а): ${current.requester}`:"Будьте первым, кто закажет песню";
    $("playback-state").textContent=state.paused?"Пауза":(current?"Играет":"Ожидание");
    countdownPaused=!!state.paused;serverOffsetMs=Number(state.serverNow||Date.now())-Date.now();countdownTarget=current&&!countdownPaused&&state.expiresAt?Number(state.expiresAt):(current&&!countdownPaused?Date.now()+serverOffsetMs+Math.max(0,Number(state.remainingSeconds)||0)*1000:null);zeroRefreshRequested=false;
    $("countdown").textContent=current?time(state.remainingSeconds):"—";$("countdown").classList.toggle("paused",countdownPaused);
    renderQueue(state);
    if(guestName&&state.guest){
      const g=state.guest;
      if(g.status==="Confirmed"){
        if(g.sessionValid===false){sessionToken="";localStorage.removeItem(SESSION_KEY);guestName="";localStorage.removeItem(NAME_KEY);showOnly("guest-login-panel");msg("guest-login-message","Ваша сессия завершена. Войдите снова.",true);return;}
        banUntil=Date.now()+Math.max(0,Number(g.banRemaining)||0)*1000;
        showOnly(banUntil>Date.now()?"guest-banned-panel":"public-content");
        $("confirmed-guest-name").textContent=g.name;
        if(banUntil>Date.now())$("guest-ban-message").textContent=`Доступ временно ограничен ещё на ${time(g.banRemaining)}.`;
        cooldownUntil=Date.now()+Math.max(0,Number(g.cooldownRemaining)||0)*1000;
        updateRestrictions();
      }else if(g.status==="Pending"){
        showOnly("guest-pending-panel");$("pending-name").textContent=g.name;
      }else if(g.status==="Denied"){
        guestName="";localStorage.removeItem(NAME_KEY);showOnly("guest-login-panel");
        msg("guest-login-message","Заявка отклонена. Вы можете выбрать другое имя.",true);
      }else{showOnly("guest-pending-panel");$("pending-name").textContent=guestName;}
    }else if(guestName){
      showOnly("guest-pending-panel");$("pending-name").textContent=guestName;
    }
  }
  function updateRestrictions(){
    const cooldown=Math.max(0,Math.ceil((cooldownUntil-Date.now())/1000)),ban=Math.max(0,Math.ceil((banUntil-Date.now())/1000));
    $("cooldown-box").classList.toggle("hidden",cooldown<=0);$("cooldown-countdown").textContent=time(cooldown);
    $("guest-ban-inline").classList.toggle("hidden",ban<=0);$("guest-ban-inline").textContent=ban>0?`Заказы временно заблокированы ещё на ${time(ban)}.`:"";
    $("request-button").disabled=busy||cooldown>0||ban>0;
  }
  async function refresh(force=false){
    if(refreshPromise)return refreshPromise;
    if(!force&&Date.now()<nextRefreshAt)return;
    refreshBusy=true;
    refreshPromise=(async()=>{try{const result=await api("state",{guestName,sessionToken});if(!result||!result.state)throw new Error("Сервер вернул неполные данные.");retryDelay=2000;nextRefreshAt=0;if(!playbackTransitionBusy){
        if(guestName&&result.state.guest?.status==="Confirmed"&&!sessionToken){
          const claim=await api("guestLogin",{name:guestName,clientInfo:clientInfo()});
          if(claim.status==="confirmed"&&claim.sessionToken){sessionToken=claim.sessionToken;localStorage.setItem(SESSION_KEY,sessionToken);}
          else if(claim.status==="sessionOccupied"){showOnly("guest-session-occupied-panel");$("session-occupied-message").textContent=`Имя «${guestName}» используется на другом устройстве.`;return;}
        }
        render(result.state);
      }}
      catch(e){nextRefreshAt=Date.now()+retryDelay;retryDelay=Math.min(30000,retryDelay*2);if(!lastState){const overlay=$("startup-loading");if(overlay){overlay.classList.remove("is-hidden");const t=$("startup-loading-text");if(t)t.textContent="Не удалось загрузить очередь. Повторяем подключение…";}msg("guest-login-message","Пока нет ответа от сервера. Проверяем соединение повторно…");}}
      finally{refreshBusy=false;refreshPromise=null;}})();
    return refreshPromise;
  }
  async function login(name){
    const result=await api("guestLogin",{name,sessionToken,clientInfo:clientInfo()});
    if(result.status==="sessionOccupied"){sessionToken="";localStorage.removeItem(SESSION_KEY);guestName=result.name||name;localStorage.setItem(NAME_KEY,guestName);showOnly("guest-session-occupied-panel");$("session-occupied-message").textContent=`Имя «${guestName}» используется на другом устройстве. Запрос можно отправить текущему пользователю.`;return;}
    guestName=result.name||name;localStorage.setItem(NAME_KEY,guestName);
    if(result.sessionToken){sessionToken=result.sessionToken;localStorage.setItem(SESSION_KEY,sessionToken);}
    if(result.status==="pending"){
      sessionToken="";localStorage.removeItem(SESSION_KEY);
      showOnly("guest-pending-panel");$("pending-name").textContent=guestName;
      msg("pending-message",result.isNew?"Запрос отправлен. Ожидайте подтверждения Администратора.":"Ожидайте подтверждения Администратора.");
    }else if(result.status==="banned"){
      banUntil=Date.now()+Math.max(0,Number(result.banRemaining)||0)*1000;showOnly("guest-banned-panel");
      $("guest-ban-message").textContent=`Доступ временно ограничен ещё на ${time(result.banRemaining)}.`;
    }else{
      const overlay=$("startup-loading"),loadingText=$("startup-loading-text");
      if(overlay&&loadingText){loadingText.textContent=`Добро пожаловать ${guestName}`;overlay.classList.remove("is-hidden");}
      showOnly("public-content");$("confirmed-guest-name").textContent=guestName;
      await refresh(true);
      if(overlay&&lastState){loadingText.textContent="Подключаемся к очереди…";overlay.classList.add("is-hidden");}
    }
  }
  async function changeGuestName(){
    const next=prompt("Введите новое имя:",guestName);if(next===null)return;const clean=next.trim().replace(/\s+/g," ");if(clean.length<2)return msg("guest-login-message","Введите имя длиной не менее двух символов.",true);
    if(clean===guestName)return;const buttonIds=["pending-rename","confirmed-rename"];buttonIds.forEach(id=>{const b=$(id);if(b)b.disabled=true;});
    try{await api("renameGuest",{oldName:guestName,newName:clean,sessionToken});guestName=clean;localStorage.setItem(NAME_KEY,guestName);if(lastState?.guest){lastState.guest.name=guestName;}$("pending-name").textContent=guestName;$("confirmed-guest-name").textContent=guestName;msg("pending-message","Имя изменено.");await refresh(true);}
    catch(err){msg("pending-message",err.message,true);}
    finally{buttonIds.forEach(id=>{const b=$(id);if(b)b.disabled=false;});}
  }
  ["pending-rename","confirmed-rename"].forEach(id=>$(id)?.addEventListener("click",changeGuestName));
  function logout(){
    if(guestName&&sessionToken)api("releaseSession",{name:guestName,sessionToken}).catch(()=>{});
    guestName="";sessionToken="";localStorage.removeItem(SESSION_KEY);localStorage.removeItem(NAME_KEY);cooldownUntil=0;banUntil=0;lastState=null;
    $("guest-name-input").value="";msg("guest-login-message","");msg("pending-message","");msg("request-message","");
    showOnly("guest-login-panel");
  }

  $("guest-login-form").addEventListener("submit",async e=>{
    e.preventDefault();if(busy)return;const name=$("guest-name-input").value.trim();
    if(name.length<2)return msg("guest-login-message","Введите имя длиной не менее двух символов.",true);
    busy=true;$("guest-login-button").disabled=true;msg("guest-login-message","Проверяем имя... ожидайте");
    try{await login(name);}catch(err){msg("guest-login-message",err.message,true);}
    finally{busy=false;$("guest-login-button").disabled=false;}
  });
  ["pending-logout","banned-logout","guest-logout"].forEach(id=>$(id).addEventListener("click",logout));
  function clientInfo(){return `${navigator.userAgent.includes("Windows")?"Windows":navigator.userAgent.includes("Mac")?"macOS":navigator.userAgent.includes("Android")?"Android":navigator.userAgent.includes("iPhone")?"iPhone":"Browser"} · ${navigator.userAgent.includes("Edg/")?"Edge":navigator.userAgent.includes("Chrome/")?"Chrome":navigator.userAgent.includes("Firefox/")?"Firefox":navigator.userAgent.includes("Safari/")?"Safari":"Browser"}`;}
  $("request-session-transfer")?.addEventListener("click",async()=>{try{const r=await api("requestSessionTransfer",{name:guestName,clientInfo:clientInfo()});if(r.status==="Available"){sessionToken="";await login(guestName);return;}transferRequestId=r.requestId;$("transfer-request-message").textContent="Запрос отправлен. Ожидаем решения текущего пользователя или администратора…";if(transferStatusTimer)clearInterval(transferStatusTimer);transferStatusTimer=setInterval(async()=>{try{const x=await api("transferStatus",{name:guestName});if(x.status==="Approved"){clearInterval(transferStatusTimer);transferStatusTimer=null;sessionToken="";await login(guestName);}else if(x.status==="Rejected"||x.status==="Expired"){clearInterval(transferStatusTimer);transferStatusTimer=null;$("transfer-request-message").textContent="Запрос отклонён или истёк.";}}catch(_){}},5000);}catch(e){msg("transfer-request-message",e.message,true);}});
  $("occupied-cancel")?.addEventListener("click",()=>{guestName="";localStorage.removeItem(NAME_KEY);showOnly("guest-login-panel");});
  async function answerTransfer(decision){try{await api("respondTransfer",{name:guestName,sessionToken,requestId:transferRequestId,decision});$("session-transfer-notice").classList.add("hidden");if(decision==="approve"){logout();msg("guest-login-message","Сессия передана другому устройству.");}}catch(e){msg("request-message",e.message,true);}}
  $("approve-session-transfer")?.addEventListener("click",()=>answerTransfer("approve"));$("reject-session-transfer")?.addEventListener("click",()=>answerTransfer("reject"));
  async function heartbeat(){if(!guestName||!sessionToken)return;try{const r=await api("heartbeat",{name:guestName,sessionToken,clientInfo:clientInfo()});if(!r.valid){sessionToken="";localStorage.removeItem(SESSION_KEY);guestName="";localStorage.removeItem(NAME_KEY);showOnly("guest-login-panel");msg("guest-login-message","Сессия завершена администратором или передана другому устройству.",true);return;}if(r.requests?.length){transferRequestId=r.requests[0].requestId;$("session-transfer-client").textContent=`Устройство: ${r.requests[0].clientInfo||"Неизвестное устройство"}. Оно хочет войти под вашим именем «${guestName}».`;$("session-transfer-notice").classList.remove("hidden");}}catch(_){}}
  setInterval(heartbeat,30000);
  $("request-form").addEventListener("submit",async e=>{
    e.preventDefault();if(busy)return;const song=$("song-input").value.trim(),artist=$("artist-input").value.trim();
    if(!song)return msg("request-message","Введите название песни.",true);
    busy=true;$("request-button").disabled=true;$("request-button").classList.add("is-loading");msg("request-message","Добавляем в очередь... ожидайте");
    try{const result=await api("add",{song,artist,requester:guestName,sessionToken});$("song-input").value="";$("artist-input").value="";msg("request-message",result.message||"Песня добавлена в очередь.");await refresh(true);}
    catch(err){msg("request-message",err.message,true);await refresh(true);}
    finally{busy=false;$("request-button").classList.remove("is-loading");updateRestrictions();}
  });
  if(guestName){$("guest-name-input").value=guestName;showOnly("guest-pending-panel");$("pending-name").textContent=guestName;}else showOnly("guest-login-panel");
  async function requestAdvance(){
    if(zeroRefreshRequested)return;zeroRefreshRequested=true;
    if(!lastState?.settings?.autoplay)return;
    playbackTransitionBusy=true;
    const optimistic={...lastState,previous:[...(lastState.previous||[]),...(lastState.current?[{...lastState.current,playedAt:new Date().toISOString()}]:[])].slice(-2)};
    const next=(optimistic.queue||[])[0]||null;
    if(next){optimistic.current=next;optimistic.queue=optimistic.queue.slice(1);optimistic.paused=false;optimistic.serverNow=Date.now()+serverOffsetMs;optimistic.expiresAt=optimistic.serverNow+Math.max(60,Number(optimistic.settings?.songSeconds)||300)*1000;optimistic.remainingSeconds=Number(optimistic.settings?.songSeconds)||300;render(optimistic);}
    else{$("playback-state").textContent="Ожидание обновления…";}
    try{await api("advanceIfExpired");}catch(_){}
    finally{playbackTransitionBusy=false;await refresh(true);}
  }
  setInterval(()=>{if(countdownTarget!==null&&!countdownPaused){const remaining=Math.ceil((countdownTarget-(Date.now()+serverOffsetMs))/1000);$("countdown").textContent=time(remaining);if(remaining<=0)requestAdvance();}updateRestrictions();},1000);
  document.querySelectorAll('a[href="admin.html"]') .forEach(a=>a.addEventListener("click",e=>{e.preventDefault();const href=a.href,overlay=$("startup-loading");if(overlay){overlay.classList.remove("is-hidden");const t=overlay.querySelector(".loading-text");if(t)t.textContent="Открываем панель ведущего…";}setTimeout(()=>{window.location.href=href;},120);}));
  refresh();setInterval(refresh,Math.max(5000,Number(cfg.REFRESH_MS)||5000));
})();
