(() => {
  "use strict";
  const cfg=window.KARALOKI_CONFIG||{},$=id=>document.getElementById(id),OWNER_NAME="RadioLoki",ADMIN_KEY="karaloki_admin_unlocked";
  let ownerName=sessionStorage.getItem(ADMIN_KEY)==="1"?OWNER_NAME:"",lastState=null,countdownTarget=null,countdownPaused=false,busy=false,refreshBusy=false;
  function api(action,params={}){if(!cfg.API_URL||cfg.API_URL.includes("PASTE_YOUR"))return Promise.reject(new Error("Сначала укажите URL Apps Script в js/config.js."));return new Promise((resolve,reject)=>{const callback="kl_admin_cb_"+Math.random().toString(36).slice(2),query=new URLSearchParams({action,callback,...params}),script=document.createElement("script"),timeout=setTimeout(()=>finish(new Error("Сервер не ответил.")),15000);function finish(err,data){clearTimeout(timeout);delete window[callback];script.remove();err?reject(err):resolve(data);}window[callback]=data=>data&&data.ok?finish(null,data):finish(new Error(data?.error||"Не удалось выполнить запрос."));script.onerror=()=>finish(new Error("Не удалось связаться с Apps Script."));script.src=cfg.API_URL+(cfg.API_URL.includes("?")?"&":"?")+query.toString();document.body.appendChild(script);});}
  function time(s){s=Math.max(0,Math.floor(Number(s)||0));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}
  function label(item){return item.artist?`${item.song} — ${item.artist}`:item.song;}
  function normalizeName(value){return String(value||"").trim().replace(/\s+/g," ").toLocaleLowerCase();}
  function message(id,value,error=false){$(id).textContent=value||"";$(id).style.color=error?"#ff9c9c":"";}
  function unlocked(on){$("login-panel").classList.toggle("hidden",on);$("admin-content").classList.toggle("hidden",!on);}
  function makeButton(text,title,handler,classes=""){const b=document.createElement("button");b.type="button";b.className="icon-button square-action "+classes;b.textContent=text;b.title=title;b.setAttribute("aria-label",title);b.addEventListener("click",handler);return b;}
  function renderSongList(listId,items,mode){
    const list=$(listId);list.replaceChildren();
    if(!items||!items.length){const li=document.createElement("li");li.className="empty";li.textContent=mode==="history"?"История пока пуста.":mode==="recent"?"История воспроизведения пока пуста.":"Очередь пуста.";list.appendChild(li);return;}
    items.forEach((item,i)=>{
      const li=document.createElement("li");li.className="queue-item admin-queue-item";
      const num=document.createElement("span");num.className="queue-number";num.textContent=mode==="history"?"◷":mode==="recent"?"":String(i+1).padStart(2,"0");
      const body=document.createElement("div");body.className="queue-item-body";
      const song=document.createElement("div");song.className="queue-song";song.textContent=label(item);
      const requester=document.createElement("div");requester.className="queue-requester";requester.textContent=`${item.requester||"—"}${item.result?" · "+historyStatus(item.result):""}`;
      body.append(song,requester);const actions=document.createElement("div");actions.className="queue-actions";
      if(mode==="queue"||mode==="history")actions.append(makeButton("▶",mode==="history"?"Добавить следующей после текущей":"Воспроизвести сейчас",()=>adminAction("play",{songId:item.id,...(mode==="history"?{source:"history"}:{})})));
      if(mode==="queue"){
        const up=makeButton("↑","Переместить выше",()=>adminAction("move",{songId:item.id,direction:"up"}));up.disabled=i===0;
        const down=makeButton("↓","Переместить ниже",()=>adminAction("move",{songId:item.id,direction:"down"}));down.disabled=i===items.length-1;
        actions.append(up,down,makeButton("×","Удалить из очереди",()=>queueAction("remove",item.id),"remove-button"));
      }else if(mode==="history"){
        actions.append(makeButton("◌","Скрыть из истории",()=>adminAction("hideHistory",{historyId:item.historyId})),makeButton("×","Удалить запись истории",()=>{if(confirm("Удалить эту запись из истории навсегда?"))adminAction("deleteHistory",{historyId:item.historyId});},"remove-button"));
      }
      li.append(num,body,actions);list.appendChild(li);
    });
  }

  function renderCombinedQueue(state){
    const list=$("queue-list");list.replaceChildren();const entries=[...(state.previous||[]).map(x=>({item:x,kind:"previous"})),...(state.current?[{item:state.current,kind:"current"}]:[]),...(state.queue||[]).map((x,i)=>({item:x,kind:"upcoming",index:i}))];
    if(!entries.length){const li=document.createElement("li");li.className="empty";li.textContent="Очередь пуста.";list.append(li);return;}
    let dragIds=null;
    entries.forEach(({item,kind,index})=>{const li=document.createElement("li");li.className="queue-item admin-queue-item public-queue-item "+kind;li.dataset.songId=item.id;if(kind==="upcoming"&&normalizeName(item.requester)===normalizeName(OWNER_NAME))li.classList.add("my-request");const num=document.createElement("span");num.className="queue-number";num.textContent=kind==="upcoming"?String(index+1).padStart(2,"0"):kind==="current"?"▶":"";const body=document.createElement("div");body.className="queue-item-body";const song=document.createElement("div");song.className="queue-song";song.textContent=label(item);const requester=document.createElement("div");requester.className="queue-requester";const stamp=item.requestedAt?new Date(Number(item.requestedAt)).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"";requester.textContent=`${item.requester||"—"}${stamp?" · Заказ: "+stamp:""}`;body.append(song,requester);li.append(num,body);
      if(kind==="current"){const marker=document.createElement("span");marker.className="current-queue-marker";marker.textContent="СЕЙЧАС ИГРАЕТ";body.prepend(marker);}
      if(kind==="upcoming"){const actions=document.createElement("div");actions.className="queue-actions";actions.append(makeButton("▶","Воспроизвести сейчас",()=>adminAction("play",{songId:item.id})));if(index>=3){const drag=makeButton("","Включить перемещение этой песни",()=>{li.draggable=!li.draggable;li.classList.toggle("drag-armed",li.draggable);drag.title=li.draggable?"Перетащите песню на новое место":"Включить перемещение этой песни";});drag.classList.add("drag-handle");drag.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2v20M2 12h20M12 2l-3 3m3-3 3 3M12 22l-3-3m3 3 3-3M2 12l3-3m-3 3 3 3m16-3-3-3m3 3-3 3"/></svg>';actions.append(drag);}actions.append(makeButton("×","Удалить из очереди",()=>queueAction("remove",item.id),"remove-button"));li.append(actions);if(index>=3){li.addEventListener("dragstart",e=>{if(!li.draggable){e.preventDefault();return;}dragIds=Array.from(list.querySelectorAll("li.upcoming[data-song-id]")).slice(3).map(x=>x.dataset.songId);e.dataTransfer.setData("text/plain",item.id);e.dataTransfer.effectAllowed="move";});li.addEventListener("dragover",e=>{if(!dragIds||index<3)return;e.preventDefault();const moving=list.querySelector(`[data-song-id="${e.dataTransfer.getData("text/plain")}"]`);if(moving&&moving!==li)list.insertBefore(moving,li);});li.addEventListener("drop",e=>{e.preventDefault();if(!dragIds)return;const ids=Array.from(list.querySelectorAll("li.upcoming[data-song-id]")).slice(3).map(x=>x.dataset.songId);dragIds=null;adminAction("reorder",{ids:JSON.stringify(ids)});});li.addEventListener("dragend",()=>{dragIds=null;li.draggable=false;li.classList.remove("drag-armed");});}}
      list.append(li);});
  }
  function historyStatus(s){return({Completed:"Исполнена",Skipped:"Пропущена",Interrupted:"Прервана",Removed:"Удалена",Replayed:"Повтор"})[s]||s;}
  function renderPending(users){
    const list=$("pending-users-list");list.replaceChildren();
    if(!users.length){const li=document.createElement("li");li.className="empty";li.textContent="Нет ожидающих пользователей.";list.appendChild(li);return;}
    users.forEach(user=>{
      const li=document.createElement("li");li.className="user-entry";
      const name=document.createElement("strong");name.className="user-name";name.textContent=user.name;
      const actions=document.createElement("div");actions.className="user-actions";
      actions.append(makeButton("✓","Одобрить пользователя",()=>adminAction("approveUser",{name:user.name}),"allow-square"),
        makeButton("×","Отклонить пользователя",()=>{if(confirm(`Отклонить имя «${user.name}»? Гость сможет отправить другое имя.`))adminAction("denyUser",{name:user.name});},"deny-square"));
      li.append(name,actions);list.appendChild(li);
    });
  }
  function renderConfirmed(users){
    const list=$("confirmed-users-list");list.replaceChildren();
    if(!users.length){const li=document.createElement("li");li.className="empty";li.textContent="Пока нет подтверждённых пользователей.";list.appendChild(li);return;}
    users.forEach(user=>{
      const li=document.createElement("li");li.className="confirmed-entry";
      const name=document.createElement("strong");name.className="user-name";name.textContent=user.name;
      const row=document.createElement("div");row.className="cooldown-row";
      const labelEl=document.createElement("span");labelEl.className="cooldown-label";labelEl.textContent="Ожидание";
      const value=document.createElement("span");value.className="cooldown-value";
      value.textContent=user.banRemaining>0?`Бан ${time(user.banRemaining)}`:(user.cooldownRemaining>0?time(user.cooldownRemaining):"Нет");
      const spacer=document.createElement("span");spacer.className="cooldown-spacer";
      const actions=document.createElement("div");actions.className="user-actions";
      const allow=makeButton("⏱","Снять ожидание",()=>adminAction("liftCooldown",{name:user.name}),"allow-square");allow.disabled=user.cooldownRemaining<=0;
      const hammer=makeButton("🔨","Ограничить доступ",()=>{if(confirm(`Заблокировать заказы для «${user.name}» на 30 минут?`))adminAction("banUser",{name:user.name});},"ban-square");
      const restrict=makeButton("🚫","Вернуть на подтверждение",()=>{if(confirm(`Вернуть «${user.name}» в список ожидающих подтверждения? Пользователь потеряет доступ к заказу песен до повторного одобрения.`))adminAction("returnToPending",{name:user.name});},"deny-square");
      actions.append(allow,hammer,restrict);row.append(labelEl,value,spacer,actions);li.append(name,row);list.appendChild(li);
    });
  }
  function renderUsers(users){const pending=users.filter(u=>u.status==="Pending"),confirmed=users.filter(u=>u.status==="Confirmed");$("pending-count").textContent=String(pending.length);$("pending-list-count").textContent=String(pending.length);$("confirmed-count").textContent=String(confirmed.length);renderPending(pending);renderConfirmed(confirmed);}
  function render(state){
    lastState=state;const c=state.current;
    $("current-song").textContent=c?label(c):"Пока ничего не играет";$("current-requester").textContent=c?`Заказал(а): ${c.requester}`:"Нет активного заказа";
    $("playback-state").textContent=state.paused?"Пауза":(c?"Играет":"Ожидание");countdownPaused=!!state.paused;
    countdownTarget=c&&!countdownPaused?Date.now()+Math.max(0,Number(state.remainingSeconds)||0)*1000:null;
    $("countdown").textContent=c?time(state.remainingSeconds):"—";$("countdown").classList.toggle("paused",countdownPaused);
    $("pause-button").textContent=state.paused?"▶ Продолжить":"Ⅱ Пауза";
    renderCombinedQueue(state);renderSongList("history-list",state.history||[],"history");
    const settings=state.settings||{};$("autoplay-setting").checked=settings.autoplay!==false;$("song-duration-setting").value=settings.songSeconds||300;$("cooldown-setting").value=settings.cooldownSeconds??900;
    $("event-mode-button").textContent=state.eventMode?"▶ Режим: вкл.":"⏸ Режим: выкл.";$("event-mode-button").classList.toggle("danger",!!state.eventMode);
    $("queue-count").textContent=`${(state.queue||[]).length} песен`;$("shuffle-button").disabled=(state.queue||[]).length<5;$("history-count").textContent=String((state.history||[]).length);renderUsers(state.users||[]);
  }
  async function refresh(force=false){if(!ownerName)return;if(refreshBusy){if(!force)return;while(refreshBusy)await new Promise(resolve=>setTimeout(resolve,40));}refreshBusy=true;try{const result=await api("state",{ownerName});render(result.state);}catch(e){if(!lastState)message("control-message",e.message,true);}finally{refreshBusy=false;}}
  const pendingText={skip:"Пропускаем песню... ожидайте",pause:"Приостанавливаем воспроизведение... ожидайте",resume:"Возобновляем воспроизведение... ожидайте",play:"Запускаем выбранную песню... ожидайте",clearQueue:"Очищаем очередь... ожидайте",add:"Добавляем песню в очередь... ожидайте",remove:"Удаляем песню... ожидайте",move:"Обновляем порядок очереди... ожидайте",approveUser:"Подтверждаем пользователя... ожидайте",denyUser:"Отклоняем пользователя... ожидайте",liftCooldown:"Снимаем ожидание... ожидайте",banUser:"Применяем временную блокировку... ожидайте",returnToPending:"Возвращаем пользователя на подтверждение... ожидайте",hideHistory:"Скрываем запись истории... ожидайте",deleteHistory:"Удаляем запись истории... ожидайте"};
  const successText={clearHistory:"История отмечена как очищенная. Записи сохранены в таблице.",shuffle:"Очередь перемешана после первых трёх песен.",reorder:"Порядок очереди обновлён.",saveSettings:"Настройки сохранены.",setEventMode:"Режим мероприятия обновлён.",skip:"Песня пропущена.",pause:"Воспроизведение приостановлено.",resume:"Воспроизведение продолжено.",play:"Песня запущена.",clearQueue:"Очередь очищена. Ожидание затронутых гостей снято.",add:"Песня добавлена в очередь.",remove:"Песня удалена, ожидание заказчика снято.",move:"Порядок очереди обновлён.",approveUser:"Пользователь подтверждён.",denyUser:"Заявка отклонена.",liftCooldown:"Ожидание снято.",banUser:"Заказы заблокированы на 30 минут.",returnToPending:"Пользователь возвращён в список ожидающих подтверждения.",hideHistory:"Запись скрыта.",deleteHistory:"Запись удалена из истории."};
  function actionMessageId(action){if(["pause","resume","skip"].includes(action))return "control-message";if(["approveUser","denyUser","liftCooldown","banUser","returnToPending"].includes(action))return "users-message";return "queue-message";}
  async function adminAction(action,params={}){
    if(busy)return;busy=true;const target=actionMessageId(action),buttons=Array.from($("admin-content").querySelectorAll("button"));
    buttons.forEach(b=>b.disabled=true);message(target,pendingText[action]||"Выполняем действие...");
    try{await api(action,{ownerName,...params});await refresh(true);const success=action==="play"&&params.source==="history"?"Песня добавлена следующей после текущей.":(successText[action]||"Изменения сохранены.");message(target,success);}
    catch(e){message(target,e.message,true);}
    finally{busy=false;buttons.forEach(b=>{if(b.isConnected)b.disabled=false;});if(lastState)$("pause-button").textContent=lastState.paused?"▶ Продолжить":"Ⅱ Пауза";}
  }
  async function queueAction(action,songId){if(action==="remove"&&!confirm("Удалить эту песню из очереди? Ожидание заказчика будет снято."))return;await adminAction(action,{songId});}
  function switchTab(tabId){document.querySelectorAll(".admin-tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tabId));document.querySelectorAll(".admin-tab-panel").forEach(p=>p.classList.toggle("hidden",p.id!==tabId));}
  document.querySelectorAll(".admin-tab").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
  $("show-owner-name").addEventListener("change",()=>{$("owner-name").type=$("show-owner-name").checked?"text":"password";});
  $("admin-login-form").addEventListener("submit",async e=>{e.preventDefault();const entered=$("owner-name").value.trim();$("login-button").disabled=true;$("login-button").classList.add("is-loading");message("login-message","Проверяем данные для входа... ожидайте");try{await api("adminCheck",{ownerName:entered});ownerName=OWNER_NAME;sessionStorage.setItem(ADMIN_KEY,"1");unlocked(true);$("owner-name").value="";switchTab("queue-tab");await refresh();}catch(_){message("login-message","Не удалось выполнить вход. Проверьте данные и попробуйте снова.",true);}finally{$("login-button").disabled=false;$("login-button").classList.remove("is-loading");}});
  $("lock-button").addEventListener("click",()=>{ownerName="";sessionStorage.removeItem(ADMIN_KEY);lastState=null;unlocked(false);$("owner-name").value="";});
  $("event-mode-button").addEventListener("click",()=>adminAction("setEventMode",{enabled:String(!lastState?.eventMode)}));
  $("shuffle-button").addEventListener("click",()=>{const n=Math.max(0,(lastState?.queue||[]).length-3);if(n<2)return;if(confirm(`Перемешать ${n} песен после первых трёх?`))adminAction("shuffle");});
  $("clear-history-button").addEventListener("click",()=>{if(confirm("Отметить все записи истории как очищенные? Данные останутся в Google Sheets."))adminAction("clearHistory");});
  $("save-settings-button").addEventListener("click",()=>adminAction("saveSettings",{autoplay:String($("autoplay-setting").checked),songSeconds:$("song-duration-setting").value,cooldownSeconds:$("cooldown-setting").value}));
  $("skip-button").addEventListener("click",()=>adminAction("skip"));
  $("pause-button").addEventListener("click",()=>adminAction(lastState?.paused?"resume":"pause"));
  $("clear-queue-button").addEventListener("click",()=>{if(confirm("Очистить все ожидающие песни? Ожидание затронутых гостей будет снято. История сохранится."))adminAction("clearQueue");});
  $("admin-request-form").addEventListener("submit",async e=>{e.preventDefault();const song=$("admin-song-input").value.trim(),artist=$("admin-artist-input").value.trim();if(!song)return;await adminAction("add",{song,artist,requester:OWNER_NAME,ownerName});$("admin-song-input").value="";$("admin-artist-input").value="";});
  unlocked(!!ownerName);switchTab("queue-tab");
  setInterval(()=>{if(countdownTarget!==null&&!countdownPaused)$("countdown").textContent=time(Math.ceil((countdownTarget-Date.now())/1000));},1000);
  refresh();setInterval(refresh,Math.max(5000,Number(cfg.REFRESH_MS)||5000));
})();
