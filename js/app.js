(() => {
  "use strict";
  const cfg = window.KARALOKI_CONFIG || {}, $ = id => document.getElementById(id);
  const NAME_KEY = "karaloki_guest_name";
  let guestName = localStorage.getItem(NAME_KEY) || "";
  let lastState = null, countdownTarget = null, countdownPaused = false, initialLoadDone = false;
  let cooldownUntil = 0, banUntil = 0, busy = false, refreshBusy = false, zeroRefreshRequested = false;

  function api(action, params = {}) {
    if (!cfg.API_URL || cfg.API_URL.includes("PASTE_YOUR")) return Promise.reject(new Error("Сначала укажите URL Apps Script в файле js/config.js."));
    return new Promise((resolve,reject) => {
      const callback = "kl_cb_" + Math.random().toString(36).slice(2), query = new URLSearchParams({action,callback,...params});
      const script = document.createElement("script"), timeout = setTimeout(() => finish(new Error("Сервер не ответил. Попробуйте ещё раз.")),15000);
      function finish(err,data){clearTimeout(timeout);delete window[callback];script.remove();err?reject(err):resolve(data);}
      window[callback] = data => data && data.ok ? finish(null,data) : finish(new Error(data?.error || "Не удалось выполнить запрос."));
      script.onerror = () => finish(new Error("Не удалось связаться с сервером. Проверьте URL Apps Script."));
      script.src = cfg.API_URL + (cfg.API_URL.includes("?")?"&":"?") + query.toString(); document.body.appendChild(script);
    });
  }
  function msg(id,value,error=false){$(id).textContent=value||"";$(id).style.color=error?"#ff9c9c":"";}
  function time(s){s=Math.max(0,Math.floor(Number(s)||0));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}
  function songLabel(item){return item.artist?`${item.song} — ${item.artist}`:item.song;}
  function normalizeName(value){return String(value||"").trim().replace(/\s+/g," ").toLocaleLowerCase();}
  function showOnly(id){["guest-login-panel","guest-pending-panel","guest-banned-panel","public-content"].forEach(x=>$(x).classList.toggle("hidden",x!==id));$("guest-logout").classList.toggle("hidden",id!=="public-content");}
  function renderQueue(state){
    const list=$("queue-list"),upcoming=state.queue||[],previous=state.previous||[],current=state.current;
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
    countdownPaused=!!state.paused;countdownTarget=current&&!countdownPaused?Date.now()+Math.max(0,Number(state.remainingSeconds)||0)*1000:null;zeroRefreshRequested=false;
    $("countdown").textContent=current?time(state.remainingSeconds):"—";$("countdown").classList.toggle("paused",countdownPaused);
    renderQueue(state);
    if(guestName&&state.guest){
      const g=state.guest;
      if(g.status==="Confirmed"){
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
    if(refreshBusy){if(!force)return;while(refreshBusy)await new Promise(resolve=>setTimeout(resolve,40));}
    refreshBusy=true;try{const result=await api("state",{guestName});render(result.state);}catch(e){if(!lastState){$("startup-loading")?.classList.add("is-hidden");msg("guest-login-message","Пока нет ответа от сервера. Проверяем соединение повторно…");} }finally{refreshBusy=false;}
  }
  async function login(name){
    const result=await api("guestLogin",{name});guestName=result.name||name;localStorage.setItem(NAME_KEY,guestName);
    if(result.status==="pending"){
      showOnly("guest-pending-panel");$("pending-name").textContent=guestName;
      msg("pending-message",result.isNew?"Запрос отправлен. Ожидайте подтверждения Администратора.":"Ожидайте подтверждения Администратора.");
    }else if(result.status==="banned"){
      banUntil=Date.now()+Math.max(0,Number(result.banRemaining)||0)*1000;showOnly("guest-banned-panel");
      $("guest-ban-message").textContent=`Доступ временно ограничен ещё на ${time(result.banRemaining)}.`;
    }else{
      showOnly("public-content");$("confirmed-guest-name").textContent=guestName;
      msg("welcome-message",`Добро пожаловать ${guestName}`);
      await refresh(true);
    }
  }
  function logout(){
    guestName="";localStorage.removeItem(NAME_KEY);cooldownUntil=0;banUntil=0;lastState=null;
    $("guest-name-input").value="";msg("guest-login-message","");msg("pending-message","");msg("welcome-message","");msg("request-message","");
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
  $("request-form").addEventListener("submit",async e=>{
    e.preventDefault();if(busy)return;const song=$("song-input").value.trim(),artist=$("artist-input").value.trim();
    if(!song)return msg("request-message","Введите название песни.",true);
    busy=true;$("request-button").disabled=true;$("request-button").classList.add("is-loading");msg("request-message","Добавляем в очередь... ожидайте");
    try{const result=await api("add",{song,artist,requester:guestName});$("song-input").value="";$("artist-input").value="";msg("request-message",result.message||"Песня добавлена в очередь.");await refresh(true);}
    catch(err){msg("request-message",err.message,true);await refresh(true);}
    finally{busy=false;$("request-button").classList.remove("is-loading");updateRestrictions();}
  });
  if(guestName){$("guest-name-input").value=guestName;showOnly("guest-pending-panel");$("pending-name").textContent=guestName;}else showOnly("guest-login-panel");
  setInterval(()=>{if(countdownTarget!==null&&!countdownPaused){const remaining=Math.ceil((countdownTarget-Date.now())/1000);$("countdown").textContent=time(remaining);if(remaining<=0&&!zeroRefreshRequested){zeroRefreshRequested=true;refresh(true);}}updateRestrictions();},1000);
  refresh();setInterval(refresh,Math.max(5000,Number(cfg.REFRESH_MS)||5000));
})();
