(() => {
  // KaraLoki v1.9.4.3 — admin client.
  "use strict";
  const cfg=window.KARALOKI_CONFIG||{},$=id=>document.getElementById(id),ADMIN_TOKEN_KEY="karaloki_admin_token",ADMIN_NAME_KEY="karaloki_admin_username";
  let adminToken=sessionStorage.getItem(ADMIN_TOKEN_KEY)||"",adminUsername=sessionStorage.getItem(ADMIN_NAME_KEY)||"",lastState=null,countdownTarget=null,countdownPaused=false,busy=false,pendingAdminSong=null,adminSongBusy=false,refreshBusy=false,refreshPromise=null,nextRefreshAt=0,retryDelay=2000,serverOffsetMs=0,zeroAdvanceBusy=false,playbackActionBusy=false,queueDragActive=false;
  const playbackActionQueue=[]; let playbackQueueRunning=false,playbackConfirmedState=null,lastConfirmedPlaybackState=null;
  const logoutActionQueue=[];let logoutQueueRunning=false;const userActionLocks=new Set();const userInlineNotices=new Map();
  const rowLocks=new Set(); let pendingOps=0,optimisticOps=0;
  // JSONP callbacks remain callable after a client timeout: Apps Script may still
  // return late, and deleting the global function early causes kl_admin_cb_* errors.
  function api(action,params={}){
    if(!cfg.API_URL||cfg.API_URL.includes("PASTE_YOUR"))return Promise.reject(new Error("Сначала укажите URL Apps Script в js/config.js."));
    return new Promise((resolve,reject)=>{
      const callback="kl_admin_cb_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2);
      const query=new URLSearchParams({action,callback,...params,...(adminToken?{adminToken}:{})}),script=document.createElement("script");
      let settled=false,cleaned=false,graceTimer=null;
      const cleanup=()=>{if(cleaned)return;cleaned=true;clearTimeout(timeout);clearTimeout(graceTimer);delete window[callback];script.remove();};
      const finish=(err,data)=>{if(settled){cleanup();return;}settled=true;clearTimeout(timeout);err?reject(err):resolve(data);if(err){graceTimer=setTimeout(cleanup,120000);}else cleanup();};
      const timeout=setTimeout(()=>finish(new Error("Сервер отвечает слишком долго. Повторите попытку.")),45000);
      window[callback]=data=>{if(settled){cleanup();return;}if(data&&data.ok)finish(null,data);else finish(new Error(data?.error||"Не удалось выполнить запрос."));};
      script.onerror=()=>{if(!settled)finish(new Error("Не удалось связаться с Apps Script."));else cleanup();};
      script.src=cfg.API_URL+(cfg.API_URL.includes("?")?"&":"?")+query.toString();document.body.appendChild(script);
    });
  }
  function time(s){s=Math.max(0,Math.floor(Number(s)||0));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}
  function label(item){return item.artist?`${item.song} — ${item.artist}`:item.song;}
  function normalizeName(value){return String(value||"").trim().replace(/\s+/g," ").toLocaleLowerCase();}
  function unlocked(value){$("login-panel")?.classList.toggle("hidden",!!value);$("admin-content")?.classList.toggle("hidden",!value);}
  const globalNotices=new Map();let noticeSequence=0;
  function renderGlobalNotices(){
    const host=$("global-notifications");if(!host)return;host.replaceChildren();
    [...globalNotices.values()].sort((x,y)=>y.created-x.created).slice(0,4).forEach(n=>{
      const item=document.createElement("div");item.className=`global-notice ${n.error?"is-error":n.loading?"is-loading":"is-success"}`;
      const icon=document.createElement("span");icon.className="global-notice-icon";icon.textContent=n.loading?"◌":n.error?"!":"✓";
      const text=document.createElement("span");text.className="global-notice-text";text.textContent=n.text;item.append(icon,text);
      if(n.error){const close=document.createElement("button");close.type="button";close.className="global-notice-close";close.textContent="×";close.setAttribute("aria-label","Закрыть");close.addEventListener("click",()=>{globalNotices.delete(n.id);renderGlobalNotices();});item.append(close);}
      host.append(item);
    });
  }
  function message(id,value,error=false){
    const old=globalNotices.get(id);if(old?.timer)clearTimeout(old.timer);
    if(!value){globalNotices.delete(id);renderGlobalNotices();return;}
    const loading=/ожидайте|добавляем|проверяем|выполняем|сохраняем|обновляем|отправляем|подключаем|загружаем|изменяем|приостанавливаем|возобновляем/i.test(value);
    const notice={id,text:String(value),error,loading,created:++noticeSequence,timer:null};
    if(!error&&!loading)notice.timer=setTimeout(()=>{globalNotices.delete(id);renderGlobalNotices();},4000);
    globalNotices.set(id,notice);
    if(globalNotices.size>4){const oldest=[...globalNotices.values()].sort((x,y)=>x.created-y.created)[0];if(oldest?.timer)clearTimeout(oldest.timer);globalNotices.delete(oldest.id);}
    renderGlobalNotices();
  }
  function showLoading(text){message("global-loading",text||"Выполняем действие…");}
  function hideLoading(){message("global-loading","");}
  async function moveOptimistic(songId,direction){
    if(busy||!lastState)return;optimisticOps++;const q=[...(lastState.queue||[])],i=q.findIndex(x=>x.id===songId),j=direction==="up"?i-1:i+1;if(i<0||j<0||j>=q.length){optimisticOps=Math.max(0,optimisticOps-1);return;}[q[i],q[j]]=[q[j],q[i]];const old=lastState.queue;lastState.queue=q;renderCombinedQueue(lastState);
    message("queue-message","Обновляем порядок очереди…");try{await api("move",{songId,direction});await refresh(true);message("queue-message","Порядок очереди обновлён.");}catch(e){lastState.queue=old;renderCombinedQueue(lastState);message("queue-message",e.message,true);}finally{optimisticOps=Math.max(0,optimisticOps-1);await refresh(true);}
  }
  function renderPending(users){
    const shared=new Set();const owners=new Map();users.forEach(u=>(u.deviceIds||[]).forEach(id=>{if(!owners.has(id))owners.set(id,[]);owners.get(id).push(u.name);}));owners.forEach(names=>{if(names.length>1)names.forEach(n=>shared.add(n));});
    const list=$("pending-users-list");list.replaceChildren();
    if(!users.length){const li=document.createElement("li");li.className="empty";li.textContent="Нет ожидающих пользователей.";list.appendChild(li);return;}
    users.forEach(user=>{
      const li=document.createElement("li");li.className="user-entry unified-user-card pending-card";li.dataset.userName=user.name;if(shared.has(user.name)){li.classList.add("shared-device");li.title="Есть совпадение Device ID с другим ожидающим пользователем.";}
      const name=document.createElement("strong");name.className="user-name";name.textContent=user.name;
      const presence=document.createElement("span");presence.className=`presence-light ${user.presence||"offline"}`;presence.title=user.presence==="online"?"В сети":user.presence==="recent"?"Нет связи до часа":"Не в сети";presence.setAttribute("aria-label",presence.title);name.prepend(presence);
      const row=document.createElement("div");row.className="unified-user-row";
      const info=document.createElement("div");info.className="unified-user-info";
      const meta=document.createElement("div");meta.className="user-meta-common";
      const login=document.createElement("span");login.textContent=`Вход: ${user.lastLogin?new Date(user.lastLogin).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—"}`;
      const device=document.createElement("span");const match=String(user.clientInfo||"").match(/device:([A-Za-z0-9-]+)/);device.textContent=`Устройство: ${match?match[1].slice(0,8):"—"}`;meta.append(login,device);
      const cooldown=document.createElement("div");cooldown.className="confirmed-cooldown pending-cooldown";
      const label=document.createElement("span");label.className="cooldown-label";label.textContent="Ожидание";
      const value=document.createElement("span");value.className="cooldown-value";value.textContent="—";cooldown.append(label,value);
      const actions=document.createElement("div");actions.className="user-actions unified-user-actions pending-user-actions";
      actions.append(makeButton("✓","Одобрить пользователя",()=>approveUserOptimistic(user.name,li),"allow-square"),
        makeButton("×","Отклонить пользователя",()=>adminAction("denyUser",{name:user.name}),"deny-square"));
      info.append(name,meta);row.append(info,cooldown,actions);
      const feedback=document.createElement("div");feedback.className="user-inline-feedback hidden";feedback.id=`user-feedback-${encodeURIComponent(user.name)}`;
      const savedNotice=userInlineNotices.get(user.name);if(savedNotice){feedback.textContent=savedNotice.text;feedback.classList.remove("hidden");feedback.classList.add(savedNotice.error?"is-error":"is-success");}
      li.append(row,feedback);list.appendChild(li);
    });
  }
  async function renameUser(oldName){const next=prompt("Новое имя пользователя:",oldName);if(next===null)return;const newName=next.trim().replace(/\s+/g," ");if(newName.length<2)return message("users-message","Введите имя длиной не менее двух символов.",true);message("users-message","Изменяем имя пользователя…");try{await api("renameGuest",{oldName,newName});await refresh(true);message("users-message",`Имя «${oldName}» изменено на «${newName}».`);}catch(e){message("users-message",e.message,true);}}
  function renderConfirmed(users){
    const shared=new Set();const owners=new Map();users.forEach(u=>(u.deviceIds||[]).forEach(id=>{if(!owners.has(id))owners.set(id,[]);owners.get(id).push(u.name);}));owners.forEach(names=>{if(names.length>1)names.forEach(n=>shared.add(n));});
    const list=$("confirmed-users-list");list.replaceChildren();
    if(!users.length){const li=document.createElement("li");li.className="empty";li.textContent="Пока нет подтверждённых пользователей.";list.appendChild(li);return;}
    users.forEach(user=>{
      const li=document.createElement("li");li.className="confirmed-entry unified-user-card";li.dataset.userName=user.name;if(shared.has(user.name)){li.classList.add("shared-device");li.title="Есть совпадение Device ID с другим подтверждённым пользователем.";}
      const name=document.createElement("strong");name.className="user-name";name.textContent=user.name;
      const presence=document.createElement("span");presence.className=`presence-light ${user.presence||"offline"}`;presence.title=user.presence==="online"?"В сети":user.presence==="recent"?"Нет связи до часа":"Не в сети";presence.setAttribute("aria-label",presence.title);name.prepend(presence);
      const row=document.createElement("div");row.className="confirmed-info-row unified-user-row";
      const info=document.createElement("div");info.className="unified-user-info";
      const meta=document.createElement("div");meta.className="confirmed-device-meta";
      const login=document.createElement("span");login.className="device-login";login.textContent=`Вход: ${user.lastLogin?new Date(user.lastLogin).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—"}`;
      const device=document.createElement("span");device.className="device-id";const match=String(user.clientInfo||"").match(/device:([A-Za-z0-9-]+)/);device.textContent=`Устройство: ${match?match[1].slice(0,8):"—"}`;meta.append(login,device);
      const cooldown=document.createElement("div");cooldown.className="confirmed-cooldown";
      const labelEl=document.createElement("span");labelEl.className="cooldown-label";labelEl.textContent="Ожидание";
      const value=document.createElement("span");value.className="cooldown-value";
      value.textContent=user.banRemaining>0?`Бан ${time(user.banRemaining)}`:(user.cooldownRemaining>0?time(user.cooldownRemaining):"Нет");cooldown.append(labelEl,value);
      const actions=document.createElement("div");actions.className="user-actions confirmed-user-actions";
      const allow=makeButton("⏱","Снять ожидание / блокировку",()=>adminAction("liftCooldown",{name:user.name}),"allow-square");allow.disabled=!(user.cooldownRemaining>0||user.banRemaining>0);
      const hammer=makeButton("🔨","Ограничить доступ",()=>{if(confirm(`Заблокировать заказы для «${user.name}» на 30 минут?`))adminAction("banUser",{name:user.name});},"ban-square");
      const restrict=makeButton("🚫","Вернуть на подтверждение",()=>{if(confirm(`Вернуть «${user.name}» в список ожидающих подтверждения? Пользователь потеряет доступ к заказу песен до повторного одобрения.`))adminAction("returnToPending",{name:user.name});},"deny-square");
      const rename=makeButton("✎","Изменить имя пользователя",()=>renameUser(user.name),"rename-square");
      const door=makeButton("","Завершить активную сессию",()=>{},"session-logout-square");door.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5M14 8l5 4-5 4M19 12H9"/></svg>';door.disabled=!user.sessionActive;
      actions.append(rename,allow,hammer,restrict,door);
       const feedback=document.createElement("div");feedback.className="user-inline-feedback hidden";feedback.id=`user-feedback-${encodeURIComponent(user.name)}`;
       const savedNotice=userInlineNotices.get(user.name);if(savedNotice){feedback.textContent=savedNotice.text;feedback.classList.remove("hidden");feedback.classList.add(savedNotice.error?"is-error":"is-success");}
       meta.classList.add("user-meta-common");
       info.append(name,meta);row.append(info,cooldown,actions);li.append(row,feedback);list.appendChild(li);
       door.addEventListener("click",()=>{if(!confirm(`Завершить сессию пользователя «${user.name}» и разрешить вход на другом устройстве?`))return;enqueueLogout(user.name,li,door,feedback);},{once:true});
    });
  }
  function renderUsers(users){const pending=users.filter(u=>u.status==="Pending"),confirmed=users.filter(u=>u.status==="Confirmed");$("pending-count").textContent=String(pending.length);$("pending-list-count").textContent=String(pending.length);$("confirmed-count").textContent=String(confirmed.length);renderPending(pending);renderConfirmed(confirmed);}
  function render(state){
    lastState=state;if(!playbackActionBusy)lastConfirmedPlaybackState=JSON.parse(JSON.stringify(state));const c=state.current;
    $("startup-loading")?.classList.add("is-hidden");
    $("current-song").textContent=c?label(c):"Пока ничего не играет";$("current-requester").textContent=c?`Заказал(а): ${c.requester}`:"Нет активного заказа";
    $("playback-state").textContent=state.paused?"Пауза":(c?"Играет":"Ожидание");countdownPaused=!!state.paused;serverOffsetMs=Number(state.serverNow||Date.now())-Date.now();
    countdownTarget=c&&!countdownPaused&&state.expiresAt?Number(state.expiresAt):(c&&!countdownPaused?Date.now()+serverOffsetMs+Math.max(0,Number(state.remainingSeconds)||0)*1000:null);
    $("countdown").textContent=c?time(state.remainingSeconds):"—";$("countdown").classList.toggle("paused",countdownPaused);
    $("pause-button").textContent=state.paused?"▶ Продолжить":"Ⅱ Пауза";
    renderCombinedQueue(state);renderSongList("history-list",state.history||[],"history");
    const settings=state.settings||{};$("autoplay-setting").checked=settings.autoplay!==false;if(document.activeElement!==$("song-duration-setting"))$("song-duration-setting").value=secondsToClock(settings.songSeconds||300);if(document.activeElement!==$("cooldown-setting"))$("cooldown-setting").value=secondsToClock(settings.cooldownSeconds??900);
    $("event-mode-button").textContent=state.eventMode?"Включить заказы":"Выключить заказы";$("event-mode-button").classList.remove("danger");$("event-mode-button").setAttribute("aria-pressed",String(!state.eventMode));
    $("queue-count").textContent=`${(state.queue||[]).length} песен`;$("shuffle-button").disabled=Math.max(0,(state.queue||[]).length-3)<2;$("history-count").textContent=String((state.history||[]).length);renderUsers(state.users||[]);
  }
  async function refresh(force=false){
    if(!adminToken||queueDragActive)return;
    if(refreshPromise)return refreshPromise;
    if(!force&&Date.now()<nextRefreshAt)return;
    refreshBusy=true;
    refreshPromise=(async()=>{try{const result=await api("state",{});if(!result||!result.state)throw new Error("Сервер вернул неполные данные.");retryDelay=2000;nextRefreshAt=0;if(!queueDragActive&&optimisticOps===0&&!playbackActionBusy)render(result.state);}
      catch(e){nextRefreshAt=Date.now()+retryDelay;retryDelay=Math.min(30000,retryDelay*2);if(!lastState){message("control-message",e.message,true);const t=$("startup-loading")?.querySelector(".loading-text");if(t)t.textContent="Не удалось загрузить данные. Повторяем подключение…";}}
      finally{refreshBusy=false;refreshPromise=null;}})();
    return refreshPromise;
  }
  const pendingText={skip:"Пропускаем песню... ожидайте",pause:"Приостанавливаем воспроизведение... ожидайте",resume:"Возобновляем воспроизведение... ожидайте",play:"Запускаем выбранную песню... ожидайте",clearQueue:"Очищаем очередь... ожидайте",add:"Добавляем песню в очередь... ожидайте",remove:"Удаляем песню... ожидайте",move:"Обновляем порядок очереди... ожидайте",approveUser:"Подтверждаем пользователя... ожидайте",denyUser:"Отклоняем пользователя... ожидайте",liftCooldown:"Снимаем ожидание... ожидайте",banUser:"Применяем временную блокировку... ожидайте",returnToPending:"Возвращаем пользователя на подтверждение... ожидайте",hideHistory:"Скрываем запись истории... ожидайте",deleteHistory:"Удаляем запись истории... ожидайте"};
  const successText={clearHistory:"История отмечена как очищенная. Записи сохранены в таблице.",shuffle:"Очередь перемешана после первых трёх песен.",reorder:"Порядок очереди обновлён.",saveSettings:"Настройки сохранены.",setEventMode:"Режим мероприятия обновлён.",skip:"Песня пропущена.",pause:"Воспроизведение приостановлено.",resume:"Воспроизведение продолжено.",play:"Песня запущена.",clearQueue:"Очередь очищена. Ожидание затронутых гостей снято.",add:"Песня добавлена в очередь.",remove:"Песня удалена, ожидание заказчика снято.",move:"Порядок очереди обновлён.",approveUser:"Пользователь подтверждён.",denyUser:"Заявка отклонена.",liftCooldown:"Ожидание снято.",banUser:"Заказы заблокированы на 30 минут.",forceLogoutSession:"Сессия завершена. Доступ к имени освобождён.",returnToPending:"Пользователь возвращён в список ожидающих подтверждения.",hideHistory:"Запись скрыта.",deleteHistory:"Запись удалена из истории."};
  function getUserRow(name){
    return [...$("confirmed-users-list").children,...$("pending-users-list").children]
      .find(el=>el.dataset?.userName===name)||null;
  }
  function getUserFeedback(name,row){
    row=row||getUserRow(name);
    const id=`user-feedback-${encodeURIComponent(name)}`;
    let feedback=document.getElementById(id);
    if(!feedback&&row){
      feedback=document.createElement("div");
      feedback.className="user-inline-feedback hidden";
      feedback.id=id;
      row.appendChild(feedback);
    }
    return feedback;
  }
  function inlineUserMessage(feedback,text,isError=false){
    if(!feedback)return;
    feedback.textContent=text;
    feedback.classList.remove("hidden","is-error","is-success");
    feedback.classList.add(isError?"is-error":"is-success");
    const key=feedback.id.replace("user-feedback-","");let name="";try{name=decodeURIComponent(key);}catch(_){}if(name)userInlineNotices.set(name,{text,error:isError});
  }
  function enqueueLogout(name,row,button,feedback){
    if(userActionLocks.has(name))return;
    userActionLocks.add(name);button.disabled=true;row.classList.add("is-pending-action");
    inlineUserMessage(feedback,"Завершаем сессию…");
    logoutActionQueue.push({name,row,button,feedback});drainLogoutQueue();
  }
  async function drainLogoutQueue(){
    if(logoutQueueRunning)return;logoutQueueRunning=true;
    while(logoutActionQueue.length){
      const item=logoutActionQueue.shift();
      try{
        await api("forceLogoutSession",{name:item.name});
        inlineUserMessage(item.feedback,"Сессия завершена. Доступ к имени освобождён.");
        setTimeout(()=>{userInlineNotices.delete(item.name);if(item.feedback.isConnected)item.feedback.classList.add("hidden");},5000);
        if(lastState?.users){const u=lastState.users.find(x=>x.name===item.name);if(u){u.sessionActive=false;u.presence="offline";}}
      }catch(e){inlineUserMessage(item.feedback,e.message||"Не удалось завершить сессию.",true);}
      finally{
        userActionLocks.delete(item.name);item.row.classList.remove("is-pending-action");
        if(item.button.isConnected)item.button.disabled=false;
      }
    }
    logoutQueueRunning=false;
  }
  function actionMessageId(action){if(["pause","resume","skip"].includes(action))return "control-message";if(["approveUser","denyUser","liftCooldown","banUser","returnToPending",].includes(action))return "users-message";return "queue-message";}
  async function adminAction(action,params={}){
    const userScoped=["denyUser","liftCooldown","banUser","returnToPending","forceLogoutSession"].includes(action)&&params.name;
    if(userScoped){
      const name=String(params.name),key=normalizeName(name);
      if(userActionLocks.has(key))return;
      userActionLocks.add(key);
      const row=getUserRow(name);
      const feedback=getUserFeedback(name,row);
      inlineUserMessage(feedback,pendingText[action]||"Выполняем действие…");
      try{
        await api(action,{...params});
        const success=successText[action]||"Изменения сохранены.";
        inlineUserMessage(feedback,success);
        await refresh(true);
        setTimeout(()=>{userInlineNotices.delete(name);const current=document.getElementById(`user-feedback-${encodeURIComponent(name)}`);if(current)current.classList.add("hidden");},5000);
      }catch(e){inlineUserMessage(feedback,e.message||"Не удалось выполнить действие.",true);}
      finally{userActionLocks.delete(key);}
      return;
    }
    if(busy)return;busy=true;const target=actionMessageId(action);message(target,pendingText[action]||"Выполняем действие...");
    try{
      await api(action,{...params});
      const success=action==="play"&&params.source==="history"?"Песня добавлена следующей после текущей.":(successText[action]||"Изменения сохранены.");
      message(target,success);
      await refresh(true);
    }catch(e){message(target,e.message,true);}
    finally{busy=false;if(lastState){render(lastState);$("pause-button").textContent=lastState.paused?"▶ Продолжить":"Ⅱ Пауза";}}
  }
  async function queueAction(action,songId){if(action==="remove"&&!confirm("Удалить эту песню из очереди? Ожидание заказчика будет снято."))return;await adminAction(action,{songId});}
  function switchTab(tabId){document.querySelectorAll(".admin-tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===tabId));document.querySelectorAll(".admin-tab-panel").forEach(p=>p.classList.toggle("hidden",p.id!==tabId));}
  document.querySelectorAll(".admin-tab").forEach(b=>b.addEventListener("click",()=>switchTab(b.dataset.tab)));
  $("show-admin-pin").addEventListener("change",()=>{$("admin-pin").type=$("show-admin-pin").checked?"text":"password";});
  $("admin-login-form").addEventListener("submit",async e=>{e.preventDefault();const username=$("admin-username").value.trim(),pin=$("admin-pin").value.trim();if(!/^\d{4}$/.test(pin)){message("login-message","PIN должен состоять ровно из четырёх цифр.",true);return;}$("login-button").disabled=true;$("login-button").classList.add("is-loading");message("login-message","");showLoading("Проверяем данные для входа…");try{if(!window.crypto?.subtle)throw new Error("Для безопасного входа нужен современный браузер с HTTPS.");const challenge=await api("adminChallenge",{username});const enc=new TextEncoder();const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(value)))).map(b=>b.toString(16).padStart(2,"0")).join("");const verifier=await digest(challenge.salt+":"+pin);const proof=await digest(verifier+":"+challenge.nonce);const result=await api("adminCheck",{username,nonce:challenge.nonce,proof});adminToken=result.adminToken;adminUsername=result.username;sessionStorage.setItem(ADMIN_TOKEN_KEY,adminToken);sessionStorage.setItem(ADMIN_NAME_KEY,adminUsername);unlocked(true);$("admin-username").value="";$("admin-pin").value="";switchTab("queue-tab");$("startup-loading")?.classList.remove("is-hidden");await refresh();}catch(err){message("login-message",err.message||"Не удалось выполнить вход. Проверьте данные и попробуйте снова.",true);}finally{$("login-button").disabled=false;$("login-button").classList.remove("is-loading");hideLoading();}});
  $("lock-button").addEventListener("click",()=>{const old=adminToken;adminToken="";adminUsername="";sessionStorage.removeItem(ADMIN_TOKEN_KEY);sessionStorage.removeItem(ADMIN_NAME_KEY);if(old)api("adminLogout",{adminToken:old}).catch(()=>{});lastState=null;unlocked(false);$("admin-username").value="";$("admin-pin").value="";});
  function applyOptimisticPlayback(action,params={}){
    if(!lastState)return;
    const now=Date.now()+serverOffsetMs;
    const optimistic={...lastState,settings:{...(lastState.settings||{})},previous:[...(lastState.previous||[])],queue:[...(lastState.queue||[])]};
    if(action==="pause"){
      const remaining=countdownTarget===null?Math.max(0,Number(lastState.remainingSeconds)||0):Math.max(0,Math.ceil((countdownTarget-now)/1000));
      optimistic.paused=true;optimistic.remainingSeconds=remaining;optimistic.expiresAt=null;
      countdownPaused=true;countdownTarget=null;
    }else if(action==="resume"){
      const remaining=Math.max(0,Number(lastState.remainingSeconds)||0);
      optimistic.paused=false;optimistic.remainingSeconds=remaining;optimistic.serverNow=now;optimistic.expiresAt=now+remaining*1000;
      countdownPaused=false;countdownTarget=optimistic.expiresAt;
    }else if(action==="skip"){
      const next=optimistic.queue.shift()||null;
      if(optimistic.current)optimistic.previous=[...optimistic.previous,{...optimistic.current,playedAt:new Date(now).toISOString()}].slice(-2);
      optimistic.current=next;optimistic.paused=false;optimistic.serverNow=now;
      optimistic.remainingSeconds=next?(Number(optimistic.settings.songSeconds)||300):null;
      optimistic.expiresAt=next?now+optimistic.remainingSeconds*1000:null;
      countdownPaused=false;countdownTarget=optimistic.expiresAt;
    }else if(action==="setEventMode"){
      optimistic.eventMode=String(params.enabled)==="true";
    }
    lastState=optimistic;render(optimistic);
  }
  async function drainPlaybackActionQueue(){
    if(playbackQueueRunning)return;
    playbackQueueRunning=true;playbackActionBusy=true;optimisticOps++;
    playbackConfirmedState=JSON.parse(JSON.stringify(lastConfirmedPlaybackState||lastState));
    try{
      while(playbackActionQueue.length){
        const item=playbackActionQueue.shift();
        message("control-message",pendingText[item.action]||"Сохраняем изменение…");
        await api(item.action,{...item.params});
      }
      const result=await api("state",{});lastState=result.state;render(result.state);
      message("control-message","Изменения воспроизведения сохранены.");
    }catch(err){
      playbackActionQueue.length=0;
      try{const result=await api("state",{});lastState=result.state;render(result.state);}
      catch(_){lastState=playbackConfirmedState;if(lastState)render(lastState);}
      message("control-message",`${err.message} Состояние синхронизировано с сервером.`,true);
    }finally{
      playbackConfirmedState=null;playbackQueueRunning=false;playbackActionBusy=false;optimisticOps=Math.max(0,optimisticOps-1);
    }
  }
  function optimisticPlaybackAction(action,params={}){
    if(!lastState)return;
    playbackActionQueue.push({action,params});
    applyOptimisticPlayback(action,params);
    message("control-message","Изменение применено. Сохраняем в фоне…");
    if(!playbackQueueRunning)drainPlaybackActionQueue();
  }
  $("event-mode-button").addEventListener("click",()=>optimisticPlaybackAction("setEventMode",{enabled:String(!lastState?.eventMode)}));
  $("shuffle-button").addEventListener("click",()=>{const n=Math.max(0,(lastState?.queue||[]).length-3);if(n<2)return;if(confirm(`Перемешать ${n} песен после первых трёх?`))adminAction("shuffle");});
  $("clear-history-button").addEventListener("click",()=>{if(confirm("Отметить все записи истории как очищенные? Данные останутся в Google Sheets."))adminAction("clearHistory");});
  function secondsToClock(value){const n=Math.max(0,Number(value)||0);return `${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`;}
  function clockToSeconds(value,min,max){const m=String(value||"").trim().match(/^(\d{1,3}):([0-5]\d)$/);if(!m)return null;const n=Number(m[1])*60+Number(m[2]);return n>=min&&n<=max?n:null;}
  $("save-settings-button").addEventListener("click",()=>{const seconds=clockToSeconds($("song-duration-setting").value,60,1800);if(seconds===null){message("settings-message","Введите длительность в формате М:СС (например, 5:00). Допустимо от 1:00 до 30:00.",true);return;}const cooldown=clockToSeconds($("cooldown-setting").value,0,7200);if(cooldown===null){message("settings-message","Введите задержку в формате М:СС (например, 15:00). Допустимо от 0:00 до 120:00.",true);return;}adminAction("saveSettings",{autoplay:String($("autoplay-setting").checked),songSeconds:String(seconds),cooldownSeconds:String(cooldown)});});
  $("skip-button").addEventListener("click",()=>optimisticPlaybackAction("skip"));
  $("pause-button").addEventListener("click",()=>optimisticPlaybackAction(lastState?.paused?"resume":"pause"));
  $("clear-queue-button").addEventListener("click",()=>{if(confirm("Очистить все ожидающие песни? Ожидание затронутых гостей будет снято. История сохранится."))adminAction("clearQueue");});
  $("admin-request-form").addEventListener("submit",async e=>{
    e.preventDefault();if(adminSongBusy||pendingAdminSong)return;
    const song=$("admin-song-input").value.trim(),artist=$("admin-artist-input").value.trim();if(!song)return;
    adminSongBusy=true;pendingAdminSong={song,artist,id:"admin-pending-"+Date.now()};
    const fields=$("admin-request-fields"),button=$("admin-request-button");
    if(fields)fields.querySelectorAll("input").forEach(input=>input.disabled=true);
    button.disabled=true;button.classList.add("is-loading");
    message("admin-request-message","Добавляем песню в очередь... Пожалуйста, подождите");
    if(lastState)renderCombinedQueue(lastState);
    try{
      const result=await api("add",{song,artist,requester:adminUsername,adminToken});
      pendingAdminSong=null;$("admin-song-input").value="";$("admin-artist-input").value="";
      message("admin-request-message",result.message||"Песня добавлена в очередь.");
      await refresh(true);setTimeout(()=>{if(!adminSongBusy)message("admin-request-message","");},3500);
    }catch(err){
      pendingAdminSong=null;message("admin-request-message",err.message||"Не удалось добавить песню.",true);
      if(lastState)renderCombinedQueue(lastState);await refresh(true);
    }finally{
      adminSongBusy=false;if(fields)fields.querySelectorAll("input").forEach(input=>input.disabled=false);
      button.disabled=false;button.classList.remove("is-loading");if(lastState)renderCombinedQueue(lastState);
    }
  });
  unlocked(!!adminToken);switchTab("queue-tab");
  if(adminToken){const overlay=$("startup-loading");overlay?.classList.remove("is-hidden");const loadingText=overlay?.querySelector(".loading-text");if(loadingText)loadingText.textContent="Загружаем данные панели…";}
  async function requestAdvance(){
    if(zeroAdvanceBusy||!lastState?.settings?.autoplay)return;zeroAdvanceBusy=true;
    optimisticOps++;
    const optimistic={...lastState,previous:[...(lastState.previous||[]),...(lastState.current?[{...lastState.current,playedAt:new Date().toISOString()}]:[])].slice(-2)};
    const next=(optimistic.queue||[])[0]||null;
    if(next){optimistic.current=next;optimistic.queue=optimistic.queue.slice(1);optimistic.paused=false;optimistic.serverNow=Date.now()+serverOffsetMs;optimistic.expiresAt=optimistic.serverNow+Math.max(60,Number(optimistic.settings?.songSeconds)||300)*1000;optimistic.remainingSeconds=Number(optimistic.settings?.songSeconds)||300;render(optimistic);}
    else{$("playback-state").textContent="Ожидание обновления…";}
    try{await api("advanceIfExpired");}catch(e){message("control-message",e.message,true);}finally{optimisticOps=Math.max(0,optimisticOps-1);zeroAdvanceBusy=false;await refresh(true);}
  }
  setInterval(()=>{if(countdownTarget!==null&&!countdownPaused){const remaining=Math.ceil((countdownTarget-(Date.now()+serverOffsetMs))/1000);$("countdown").textContent=time(remaining);if(remaining<=0)requestAdvance();}},1000);
  document.querySelectorAll('a[href="index.html"]') .forEach(a=>a.addEventListener("click",e=>{e.preventDefault();const href=a.href,overlay=$("startup-loading");if(overlay){overlay.classList.remove("is-hidden");const t=overlay.querySelector(".loading-text");if(t)t.textContent="Возвращаемся к публичной очереди…";}setTimeout(()=>{window.location.href=href;},120);}));
  refresh();setInterval(refresh,Math.max(5000,Number(cfg.REFRESH_MS)||5000));
})();
