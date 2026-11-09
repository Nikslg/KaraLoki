(() => {
  // KaraLoki v1.8.4 — admin client.
  "use strict";
  const cfg=window.KARALOKI_CONFIG||{},$=id=>document.getElementById(id),OWNER_NAME="RadioLoki",ADMIN_KEY="karaloki_admin_unlocked";
  let ownerName=sessionStorage.getItem(ADMIN_KEY)==="1"?OWNER_NAME:"",lastState=null,countdownTarget=null,countdownPaused=false,busy=false,refreshBusy=false,serverOffsetMs=0,zeroAdvanceBusy=false,playbackActionBusy=false;
  const rowLocks=new Set(); let pendingOps=0,optimisticOps=0;
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
      if(mode==="queue"||mode==="history"){const play=makeButton("▶",mode==="history"?"Добавить следующей после текущей":"Воспроизвести сейчас",()=>playLocked(item,mode,play));actions.append(play);}
      if(mode==="queue"){
        const up=makeButton("↑","Переместить выше",()=>moveOptimistic(item.id,"up"));up.disabled=i===0;
        const down=makeButton("↓","Переместить ниже",()=>moveOptimistic(item.id,"down"));down.disabled=i===items.length-1;
        actions.append(up,down,makeButton("×","Удалить из очереди",()=>queueAction("remove",item.id),"remove-button"));
      }else if(mode==="history"){
        actions.append(makeButton("◌","Скрыть из истории",()=>adminAction("hideHistory",{historyId:item.historyId})),makeButton("×","Удалить запись истории",()=>{if(confirm("Удалить эту запись из истории навсегда?"))adminAction("deleteHistory",{historyId:item.historyId});},"remove-button"));
      }
      li.append(num,body,actions);list.appendChild(li);
    });
  }

  let queueDragActive=false,activeDraggedElement=null;
  function renderCombinedQueue(state){
    const list=$("queue-list");list.replaceChildren();
    const entries=[...(state.previous||[]).map(x=>({item:x,kind:"previous"})),...(state.current?[{item:state.current,kind:"current"}]:[]),...(state.queue||[]).map((x,i)=>({item:x,kind:"upcoming",index:i}))];
    if(!entries.length){const li=document.createElement("li");li.className="empty";li.textContent="Очередь пуста.";list.append(li);return;}
    entries.forEach(({item,kind,index})=>{
      const li=document.createElement("li");li.className="queue-item admin-queue-item public-queue-item "+kind;li.dataset.songId=item.id;
      if(kind==="upcoming"&&normalizeName(item.requester)===normalizeName(OWNER_NAME))li.classList.add("my-request");
      const num=document.createElement("span");num.className="queue-number";num.textContent=kind==="upcoming"?String(index+1).padStart(2,"0"):kind==="current"?"▶":kind==="previous"?"◷":"";
      const body=document.createElement("div");body.className="queue-item-body";
      const song=document.createElement("div");song.className="queue-song";song.textContent=label(item);
      const requester=document.createElement("div");requester.className="queue-requester";
      const stamp=item.requestedAt?new Date(Number(item.requestedAt)).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"";
      requester.textContent=`${item.requester||"—"}${stamp?" · Заказ: "+stamp:""}`;body.append(song,requester);li.append(num,body);
      if(kind==="current"){const marker=document.createElement("span");marker.className="current-queue-marker";marker.textContent="СЕЙЧАС ИГРАЕТ";body.prepend(marker);}
      if(kind==="upcoming"){
        const actions=document.createElement("div");actions.className="queue-actions";
        actions.append(makeButton("▶","Воспроизвести сейчас",()=>adminAction("play",{songId:item.id})));
        const up=makeButton("↑","Переместить выше",()=>moveOptimistic(item.id,"up"));up.disabled=index===0;
        const down=makeButton("↓","Переместить ниже",()=>moveOptimistic(item.id,"down"));down.disabled=index===(state.queue||[]).length-1;
        actions.append(up,down);
        const drag=makeButton("","Включить перемещение этой песни",()=>{li.draggable=!li.draggable;li.classList.toggle("drag-armed",li.draggable);drag.title=li.draggable?"Перетащите песню на новое место":"Включить перемещение этой песни";});
        drag.classList.add("drag-handle");drag.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2v20M2 12h20M12 2l-3 3m3-3 3 3M12 22l-3-3m3 3 3-3M2 12l3-3m-3 3 3 3m16-3-3-3m3 3-3 3"/></svg>';actions.append(drag);
        actions.append(makeButton("×","Удалить из очереди",()=>queueAction("remove",item.id),"remove-button"));li.append(actions);
        li.addEventListener("dragstart",e=>{if(!li.draggable){e.preventDefault();return;}queueDragActive=true;activeDraggedElement=li;list.classList.add("is-reordering");e.dataTransfer.setData("text/plain",item.id);e.dataTransfer.effectAllowed="move";});
        li.addEventListener("dragover",e=>{if(!queueDragActive||!e.dataTransfer.types.includes("text/plain"))return;e.preventDefault();const moving=activeDraggedElement;if(!moving||moving===li)return;const rect=li.getBoundingClientRect();const after=e.clientY>rect.top+rect.height/2;list.insertBefore(moving,after?li.nextSibling:li);});
        li.addEventListener("drop",e=>{e.preventDefault();if(!queueDragActive)return;const ids=Array.from(list.querySelectorAll("li.upcoming[data-song-id]")).map(x=>x.dataset.songId);queueDragActive=false;activeDraggedElement=null;list.classList.remove("is-reordering");list.querySelectorAll(".drag-armed").forEach(x=>{x.draggable=false;x.classList.remove("drag-armed")});optimisticOps++;showLoading("Сохраняем новый порядок…");api("reorder",{ownerName,ids:JSON.stringify(ids)}).then(()=>refresh(true)).catch(e=>{message("queue-message",e.message,true);refresh(true);}).finally(()=>{optimisticOps=Math.max(0,optimisticOps-1);hideLoading();refresh(true);});});
        li.addEventListener("dragend",()=>{queueDragActive=false;activeDraggedElement=null;list.classList.remove("is-reordering");li.draggable=false;li.classList.remove("drag-armed");});
      }
      list.append(li);
    });
  }
  const playingLocks=new Set();
  async function playLocked(item,mode,button){const key=String(item.historyId||item.id);if(playingLocks.has(key))return;playingLocks.add(key);if(button){button.disabled=true;button.textContent="…";}showLoading("Добавляем песню в очередь…");try{await api("play",{ownerName,songId:item.id,...(mode==="history"?{source:"history"}:{})});await refresh(true);message("queue-message",mode==="history"?"Песня добавлена следующей после текущей.":"Песня запущена.");}catch(e){message("queue-message",e.message,true);}finally{playingLocks.delete(key);if(button&&button.isConnected){button.disabled=false;button.textContent="▶";}hideLoading();}}
  function historyStatus(s){return({Completed:"Исполнена",Skipped:"Пропущена",Interrupted:"Прервана",Removed:"Удалена",Replayed:"Повтор"})[s]||s;}
  async function approveUserOptimistic(name,row){
    const key=normalizeName(name);if(rowLocks.has(key))return;rowLocks.add(key);optimisticOps++;const originalUsers=(lastState?.users||[]).map(u=>({...u}));
    if(lastState){lastState.users=lastState.users.filter(u=>!(normalizeName(u.name)===key&&u.status==="Pending"));renderUsers(lastState.users);}
    row?.classList.add("is-pending-action");showLoading(`Подтверждаем ${name}…`);
    try{await api("approveUser",{ownerName,name});message("users-message",`Пользователь «${name}» подтверждён.`);await refresh(true);}
    catch(e){if(lastState){lastState.users=originalUsers;renderUsers(lastState.users);}message("users-message",e.message,true);}
    finally{rowLocks.delete(key);optimisticOps=Math.max(0,optimisticOps-1);hideLoading();await refresh(true);}
  }
  function showLoading(text){pendingOps++;const el=$("admin-loading");if(el){el.classList.remove("hidden");$("admin-loading-text").textContent=text||"Выполняем действие…";}}
  function hideLoading(){pendingOps=Math.max(0,pendingOps-1);if(!pendingOps)$("admin-loading")?.classList.add("hidden");}
  async function moveOptimistic(songId,direction){
    if(busy||!lastState)return;optimisticOps++;const q=[...(lastState.queue||[])],i=q.findIndex(x=>x.id===songId),j=direction==="up"?i-1:i+1;if(i<0||j<0||j>=q.length){optimisticOps=Math.max(0,optimisticOps-1);return;}[q[i],q[j]]=[q[j],q[i]];const old=lastState.queue;lastState.queue=q;renderCombinedQueue(lastState);
    showLoading("Обновляем порядок очереди…");try{await api("move",{ownerName,songId,direction});await refresh(true);}catch(e){lastState.queue=old;renderCombinedQueue(lastState);message("queue-message",e.message,true);}finally{optimisticOps=Math.max(0,optimisticOps-1);hideLoading();await refresh(true);}
  }
  function renderPending(users){
    const list=$("pending-users-list");list.replaceChildren();
    if(!users.length){const li=document.createElement("li");li.className="empty";li.textContent="Нет ожидающих пользователей.";list.appendChild(li);return;}
    users.forEach(user=>{
      const li=document.createElement("li");li.className="user-entry";
      const name=document.createElement("strong");name.className="user-name";name.textContent=user.name;
      const actions=document.createElement("div");actions.className="user-actions";
      actions.append(makeButton("✓","Одобрить пользователя",()=>approveUserOptimistic(user.name,li),"allow-square"),
        makeButton("×","Отклонить пользователя",()=>{if(confirm(`Отклонить имя «${user.name}»? Гость сможет отправить другое имя.`))adminAction("denyUser",{name:user.name});},"deny-square"));
      li.append(name,actions);list.appendChild(li);
    });
  }
  async function renameUser(oldName){const next=prompt("Новое имя пользователя:",oldName);if(next===null)return;const newName=next.trim().replace(/\s+/g," ");if(newName.length<2)return message("users-message","Введите имя длиной не менее двух символов.",true);showLoading("Изменяем имя пользователя…");try{await api("renameGuest",{ownerName,oldName,newName});await refresh(true);message("users-message",`Имя «${oldName}» изменено на «${newName}».`);}catch(e){message("users-message",e.message,true);}finally{hideLoading();}}
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
      const rename=makeButton("✎","Изменить имя пользователя",()=>renameUser(user.name),"rename-square");actions.append(rename,allow,hammer,restrict);row.append(labelEl,value,spacer,actions);li.append(name,row);list.appendChild(li);
    });
  }
  function renderUsers(users){const pending=users.filter(u=>u.status==="Pending"),confirmed=users.filter(u=>u.status==="Confirmed");$("pending-count").textContent=String(pending.length);$("pending-list-count").textContent=String(pending.length);$("confirmed-count").textContent=String(confirmed.length);renderPending(pending);renderConfirmed(confirmed);}
  function render(state){
    lastState=state;const c=state.current;
    $("current-song").textContent=c?label(c):"Пока ничего не играет";$("current-requester").textContent=c?`Заказал(а): ${c.requester}`:"Нет активного заказа";
    $("playback-state").textContent=state.paused?"Пауза":(c?"Играет":"Ожидание");countdownPaused=!!state.paused;serverOffsetMs=Number(state.serverNow||Date.now())-Date.now();
    countdownTarget=c&&!countdownPaused&&state.expiresAt?Number(state.expiresAt):(c&&!countdownPaused?Date.now()+serverOffsetMs+Math.max(0,Number(state.remainingSeconds)||0)*1000:null);
    $("countdown").textContent=c?time(state.remainingSeconds):"—";$("countdown").classList.toggle("paused",countdownPaused);
    $("pause-button").textContent=state.paused?"▶ Продолжить":"Ⅱ Пауза";
    renderCombinedQueue(state);renderSongList("history-list",state.history||[],"history");
    const settings=state.settings||{};$("autoplay-setting").checked=settings.autoplay!==false;if(document.activeElement!==$("song-duration-setting"))$("song-duration-setting").value=secondsToClock(settings.songSeconds||300);$("cooldown-setting").value=settings.cooldownSeconds??900;
    $("event-mode-button").textContent=state.eventMode?"▶ Режим: вкл.":"⏸ Режим: выкл.";$("event-mode-button").classList.toggle("danger",!!state.eventMode);
    $("queue-count").textContent=`${(state.queue||[]).length} песен`;$("shuffle-button").disabled=Math.max(0,(state.queue||[]).length-3)<2;$("history-count").textContent=String((state.history||[]).length);renderUsers(state.users||[]);
  }
  async function refresh(force=false){if(!ownerName||queueDragActive)return;if(refreshBusy){if(!force)return;while(refreshBusy)await new Promise(resolve=>setTimeout(resolve,40));}refreshBusy=true;try{const result=await api("state",{ownerName});if(!queueDragActive&&optimisticOps===0&&!playbackActionBusy)render(result.state);}catch(e){if(!lastState)message("control-message",e.message,true);}finally{refreshBusy=false;}}
  const pendingText={skip:"Пропускаем песню... ожидайте",pause:"Приостанавливаем воспроизведение... ожидайте",resume:"Возобновляем воспроизведение... ожидайте",play:"Запускаем выбранную песню... ожидайте",clearQueue:"Очищаем очередь... ожидайте",add:"Добавляем песню в очередь... ожидайте",remove:"Удаляем песню... ожидайте",move:"Обновляем порядок очереди... ожидайте",approveUser:"Подтверждаем пользователя... ожидайте",denyUser:"Отклоняем пользователя... ожидайте",liftCooldown:"Снимаем ожидание... ожидайте",banUser:"Применяем временную блокировку... ожидайте",returnToPending:"Возвращаем пользователя на подтверждение... ожидайте",hideHistory:"Скрываем запись истории... ожидайте",deleteHistory:"Удаляем запись истории... ожидайте"};
  const successText={clearHistory:"История отмечена как очищенная. Записи сохранены в таблице.",shuffle:"Очередь перемешана после первых трёх песен.",reorder:"Порядок очереди обновлён.",saveSettings:"Настройки сохранены.",setEventMode:"Режим мероприятия обновлён.",skip:"Песня пропущена.",pause:"Воспроизведение приостановлено.",resume:"Воспроизведение продолжено.",play:"Песня запущена.",clearQueue:"Очередь очищена. Ожидание затронутых гостей снято.",add:"Песня добавлена в очередь.",remove:"Песня удалена, ожидание заказчика снято.",move:"Порядок очереди обновлён.",approveUser:"Пользователь подтверждён.",denyUser:"Заявка отклонена.",liftCooldown:"Ожидание снято.",banUser:"Заказы заблокированы на 30 минут.",returnToPending:"Пользователь возвращён в список ожидающих подтверждения.",hideHistory:"Запись скрыта.",deleteHistory:"Запись удалена из истории."};
  function actionMessageId(action){if(["pause","resume","skip"].includes(action))return "control-message";if(["approveUser","denyUser","liftCooldown","banUser","returnToPending"].includes(action))return "users-message";return "queue-message";}
  async function adminAction(action,params={}){
    if(busy)return;busy=true;const target=actionMessageId(action);message(target,pendingText[action]||"Выполняем действие...");showLoading(pendingText[action]||"Выполняем действие...");
    try{await api(action,{ownerName,...params});await refresh(true);const success=action==="play"&&params.source==="history"?"Песня добавлена следующей после текущей.":(successText[action]||"Изменения сохранены.");message(target,success);}
    catch(e){message(target,e.message,true);}
    finally{busy=false;hideLoading();if(lastState){render(lastState);$("pause-button").textContent=lastState.paused?"▶ Продолжить":"Ⅱ Пауза";}}
  }
  async function queueAction(action,songId){if(action==="remove"&&!confirm("Удалить эту песню из очереди? Ожидание заказчика будет снято."))return;await adminAction(action,{songId});}
  function switchTab(tabId){document.querySelectorAll(".admin-tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tabId));document.querySelectorAll(".admin-tab-panel").forEach(p=>p.classList.toggle("hidden",p.id!==tabId));}
  document.querySelectorAll(".admin-tab").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
  $("show-owner-name").addEventListener("change",()=>{$("owner-name").type=$("show-owner-name").checked?"text":"password";});
  $("admin-login-form").addEventListener("submit",async e=>{e.preventDefault();const entered=$("owner-name").value.trim();$("login-button").disabled=true;$("login-button").classList.add("is-loading");message("login-message","Проверяем данные для входа... ожидайте");showLoading("Открываем панель ведущего…");try{await api("adminCheck",{ownerName:entered});ownerName=OWNER_NAME;sessionStorage.setItem(ADMIN_KEY,"1");unlocked(true);$("owner-name").value="";switchTab("queue-tab");await refresh();}catch(_){message("login-message","Не удалось выполнить вход. Проверьте данные и попробуйте снова.",true);}finally{$("login-button").disabled=false;$("login-button").classList.remove("is-loading");hideLoading();}});
  $("lock-button").addEventListener("click",()=>{ownerName="";sessionStorage.removeItem(ADMIN_KEY);lastState=null;unlocked(false);$("owner-name").value="";});
  async function optimisticPlaybackAction(action,params={}){
    if(!lastState||playbackActionBusy)return;
    playbackActionBusy=true;optimisticOps++;
    const snapshot=JSON.parse(JSON.stringify(lastState));
    const now=Date.now()+serverOffsetMs;
    const optimistic={...lastState,settings:{...(lastState.settings||{})}};
    if(action==="pause"){
      const remaining=countdownTarget===null?Number(lastState.remainingSeconds)||0:Math.max(0,Math.ceil((countdownTarget-now)/1000));
      optimistic.paused=true;optimistic.remainingSeconds=remaining;optimistic.expiresAt=null;
      countdownPaused=true;countdownTarget=null;
    }else if(action==="resume"){
      const remaining=Math.max(0,Number(lastState.remainingSeconds)||0);
      optimistic.paused=false;optimistic.remainingSeconds=remaining;optimistic.serverNow=now;optimistic.expiresAt=now+remaining*1000;
      countdownPaused=false;countdownTarget=optimistic.expiresAt;
    }else if(action==="skip"){
      const previous=[...(lastState.previous||[]),...(lastState.current?[lastState.current]:[])].slice(-2),next=(lastState.queue||[])[0]||null;
      optimistic.previous=previous;optimistic.current=next;optimistic.queue=(lastState.queue||[]).slice(next?1:0);optimistic.paused=false;
      optimistic.serverNow=now;optimistic.remainingSeconds=next?(Number(lastState.settings?.songSeconds)||300):null;optimistic.expiresAt=next?now+optimistic.remainingSeconds*1000:null;
      countdownPaused=false;countdownTarget=optimistic.expiresAt;
    }else if(action==="setEventMode"){
      optimistic.eventMode=String(params.enabled)==="true";
    }
    render(optimistic);
    const target="control-message";message(target,pendingText[action]||"Выполняем действие…");showLoading(pendingText[action]||"Выполняем действие…");
    try{
      await api(action,{ownerName,...params});
      const result=await api("state",{ownerName});lastState=result.state;render(result.state);
      message(target,successText[action]||"Изменения сохранены.");
    }catch(err){
      lastState=snapshot;render(snapshot);message(target,err.message,true);
    }finally{
      playbackActionBusy=false;optimisticOps=Math.max(0,optimisticOps-1);hideLoading();
    }
  }
  $("event-mode-button").addEventListener("click",()=>optimisticPlaybackAction("setEventMode",{enabled:String(!lastState?.eventMode)}));
  $("shuffle-button").addEventListener("click",()=>{const n=Math.max(0,(lastState?.queue||[]).length-3);if(n<2)return;if(confirm(`Перемешать ${n} песен после первых трёх?`))adminAction("shuffle");});
  $("clear-history-button").addEventListener("click",()=>{if(confirm("Отметить все записи истории как очищенные? Данные останутся в Google Sheets."))adminAction("clearHistory");});
  function secondsToClock(value){const n=Math.max(0,Number(value)||0);return `${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`;}
  function clockToSeconds(value){const m=String(value||"").trim().match(/^(\d{1,2}):([0-5]\d)$/);if(!m)return null;const n=Number(m[1])*60+Number(m[2]);return n>=60&&n<=1800?n:null;}
  $("save-settings-button").addEventListener("click",()=>{const seconds=clockToSeconds($("song-duration-setting").value);if(seconds===null){message("settings-message","Введите длительность в формате М:СС (например, 5:00). Допустимо от 1:00 до 30:00.",true);return;}adminAction("saveSettings",{autoplay:String($("autoplay-setting").checked),songSeconds:String(seconds),cooldownSeconds:$("cooldown-setting").value});});
  $("skip-button").addEventListener("click",()=>optimisticPlaybackAction("skip"));
  $("pause-button").addEventListener("click",()=>optimisticPlaybackAction(lastState?.paused?"resume":"pause"));
  $("clear-queue-button").addEventListener("click",()=>{if(confirm("Очистить все ожидающие песни? Ожидание затронутых гостей будет снято. История сохранится."))adminAction("clearQueue");});
  $("admin-request-form").addEventListener("submit",async e=>{e.preventDefault();const song=$("admin-song-input").value.trim(),artist=$("admin-artist-input").value.trim();if(!song)return;await adminAction("add",{song,artist,requester:OWNER_NAME,ownerName});$("admin-song-input").value="";$("admin-artist-input").value="";});
  unlocked(!!ownerName);switchTab("queue-tab");
  async function requestAdvance(){
    if(zeroAdvanceBusy||!lastState?.settings?.autoplay)return;zeroAdvanceBusy=true;
    optimisticOps++;
    const optimistic={...lastState,previous:[...(lastState.previous||[]),...(lastState.current?[lastState.current]:[])].slice(-2)};
    const next=(optimistic.queue||[])[0]||null;
    if(next){optimistic.current=next;optimistic.queue=optimistic.queue.slice(1);optimistic.paused=false;optimistic.serverNow=Date.now()+serverOffsetMs;optimistic.expiresAt=optimistic.serverNow+Math.max(60,Number(optimistic.settings?.songSeconds)||300)*1000;optimistic.remainingSeconds=Number(optimistic.settings?.songSeconds)||300;render(optimistic);}
    else{$("playback-state").textContent="Ожидание обновления…";}
    try{await api("advanceIfExpired");}catch(e){message("control-message",e.message,true);}finally{optimisticOps=Math.max(0,optimisticOps-1);zeroAdvanceBusy=false;await refresh(true);}
  }
  setInterval(()=>{if(countdownTarget!==null&&!countdownPaused){const remaining=Math.ceil((countdownTarget-(Date.now()+serverOffsetMs))/1000);$("countdown").textContent=time(remaining);if(remaining<=0)requestAdvance();}},1000);
  document.querySelectorAll('a[href="index.html"]') .forEach(a=>a.addEventListener("click",e=>{e.preventDefault();const href=a.href,overlay=$("startup-loading");if(overlay){overlay.classList.remove("is-hidden");const t=overlay.querySelector(".loading-text");if(t)t.textContent="Возвращаемся к публичной очереди…";}setTimeout(()=>{window.location.href=href;},120);}));
  refresh();setInterval(refresh,Math.max(5000,Number(cfg.REFRESH_MS)||5000));
})();
