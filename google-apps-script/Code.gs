/**
 * KaraLoki v1.8.2 — Google Apps Script backend.
 * Guest identity is the approved display name (case-insensitive matching).
 * Device IDs and room codes are no longer used. Google Sheets remains the database.
 * RadioLoki is a shared-name convenience gate, not secure authentication.
 */
const QUEUE_HEADERS = ["id","song","artist","requester","status","createdAt","position"];
const PLAYBACK_HEADERS = ["key","value"];
const HISTORY_HEADERS = ["id","song","artist","requester","result","playedAt","hidden","entryId","cleared"];
const USER_HEADERS = ["name","nameKey","status","cooldownUntil","bannedUntil","createdAt","updatedAt"];
const DEFAULT_SONG_SECONDS = 300;
const DEFAULT_COOLDOWN_SECONDS = 900;
const TEMP_BAN_SECONDS = 1800;
const OWNER_NAME = "RadioLoki";

function setupKaraLoki() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("SPREADSHEET_ID")) throw new Error("Set SPREADSHEET_ID in Project Settings > Script properties first.");
  const ss = SpreadsheetApp.openById(props.getProperty("SPREADSHEET_ID"));
  removeLegacyIdentityColumns_(ss, "Queue");
  removeLegacyIdentityColumns_(ss, "History");
  ensureSheet_(ss, "Queue", QUEUE_HEADERS);
  ensureSheet_(ss, "Playback", PLAYBACK_HEADERS);
  ensureSheet_(ss, "History", HISTORY_HEADERS);
  ensureHistoryEntryIds_();
  ensureSheet_(ss, "Users", USER_HEADERS);
  ensureSheet_(ss, "Settings", ["key","value"]);
  if (getRows_(ss.getSheetByName("Settings")).length===0) ss.getSheetByName("Settings").getRange(1,1,4,2).setValues([["key","value"],["autoplay","true"],["songSeconds","300"],["cooldownSeconds","900"]]);
  const pb = ss.getSheetByName("Playback");
  if (pb.getLastRow() < 2) pb.getRange(2,1,4,2).setValues([["currentSongId",""],["paused","false"],["startedAt",""],["remainingSeconds",String(DEFAULT_SONG_SECONDS)]]);
}

function doGet(e) {
  const p = (e && e.parameter) || {}, cb = String(p.callback || "");
  if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,80}$/.test(cb)) return ContentService.createTextOutput("Invalid callback").setMimeType(ContentService.MimeType.TEXT);
  let result;
  try { result = handle_(p); } catch (err) { result = {ok:false,error:String(err && err.message ? err.message : err)}; }
  return ContentService.createTextOutput(cb + "(" + JSON.stringify(result) + ");").setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function handle_(p) {
  const a = String(p.action || "");
  if (a === "adminCheck") { requireOwnerName_(p.ownerName); return {ok:true}; }
  if (a === "guestLogin") return guestLogin_(p);
  if (a === "state") {
    const admin = isOwner_(p.ownerName);
    if (!admin) return {ok:true,state:withLock_(() => stateWhileLocked_(false, clean_(p.guestName,32)))};
    return {ok:true,state:withLock_(() => stateWhileLocked_(true, ""))};
  }
  if (a === "add") return addSong_(p);
  if (a === "renameGuest") return withLock_(() => { renameGuest_(p.oldName,p.newName); return {ok:true}; });
  const adminActions = ["skip","pause","resume","move","remove","play","clearQueue","approveUser","denyUser","liftCooldown","banUser","returnToPending","hideHistory","deleteHistory","clearHistory","shuffle","reorder","saveSettings","setEventMode"];
  if (adminActions.indexOf(a) >= 0) {
    requireOwnerName_(p.ownerName);
    return withLock_(() => {
      if (a === "skip") advance_("Skipped");
      if (a === "pause") pause_();
      if (a === "resume") resume_();
      if (a === "move") moveQueueItem_(String(p.songId || ""), String(p.direction || ""));
      if (a === "remove") removeQueueItem_(String(p.songId || ""));
      if (a === "play") {
        if (String(p.source || "") === "history") queueHistorySongNext_(String(p.songId || ""));
        else playSong_(String(p.songId || ""));
      }
      if (a === "clearQueue") clearQueue_();
      if (a === "approveUser") approveUser_(p.name);
      if (a === "denyUser") denyUser_(p.name);
      if (a === "liftCooldown") liftCooldown_(p.name);
      if (a === "banUser") banUser_(p.name);
      if (a === "returnToPending") returnUserToPending_(p.name);
      if (a === "hideHistory") setHistoryHidden_(String(p.historyId || ""), true);
      if (a === "deleteHistory") deleteHistory_(String(p.historyId || ""));
      if (a === "clearHistory") clearHistory_();
      if (a === "shuffle") shuffleQueue_();
      if (a === "reorder") reorderQueue_(String(p.ids || ""));
      if (a === "saveSettings") saveSettings_(p);
      if (a === "setEventMode") setEventMode_(String(p.enabled)==="true");
      return {ok:true};
    });
  }
  return {ok:false,error:"Unknown action."};
}

function isOwner_(v) { return String(v || "").trim().toLowerCase() === OWNER_NAME.toLowerCase(); }
function requireOwnerName_(v) { if (!isOwner_(v)) throw new Error("Owner access required."); }
function nameKey_(v) { return clean_(v,32).toLocaleLowerCase().replace(/\s+/g," "); }

function guestLogin_(p) {
  const name = clean_(p.name,32), key = nameKey_(name);
  if (!name || key.length < 2) throw new Error("Введите имя длиной не менее двух символов.");
  if (key === nameKey_(OWNER_NAME)) throw new Error("Это имя зарезервировано для ведущего.");
  return withLock_(() => {
    const user = findUser_(key), now = Date.now();
    if (user) {
      const bannedUntil = Number(user.bannedUntil || 0);
      if (bannedUntil > now) return {ok:true,status:"banned",name:user.name,banRemaining:Math.ceil((bannedUntil-now)/1000)};
      if (String(user.status) === "Confirmed") return {ok:true,status:"confirmed",name:user.name,isNew:false};
      if (String(user.status) === "Pending") return {ok:true,status:"pending",name:user.name,isNew:false};
      if (String(user.status) === "Denied") {
        updateUser_(key,{status:"Pending",updatedAt:new Date()});
        return {ok:true,status:"pending",name:user.name,isNew:false};
      }
    }
    const sh = getSS_().getSheetByName("Users");
    sh.appendRow([name,key,"Pending",0,0,new Date(),new Date()]);
    return {ok:true,status:"pending",name:name,isNew:true};
  });
}

function addSong_(p) {
  const song = clean_(p.song,140), artist = clean_(p.artist,100), requester = clean_(p.requester,32), key = nameKey_(requester);
  const admin = isOwner_(p.ownerName);
  if (!song || !requester) throw new Error("Укажите название песни и имя.");
  return withLock_(() => {
    const user = admin ? null : findUser_(key), now = Date.now();
    if (!admin) {
      if (truthy_(getSettings_().eventMode)) throw new Error("Приём заявок временно приостановлен.");
      if (!user || String(user.status) !== "Confirmed") throw new Error("Ваше имя ещё не подтверждено администратором.");
      const bannedUntil = Number(user.bannedUntil || 0);
      if (bannedUntil > now) throw new Error("Заказы временно заблокированы: " + formatSeconds_(Math.ceil((bannedUntil-now)/1000)));
      const remaining = Math.ceil((Number(user.cooldownUntil || 0)-now)/1000);
      if (remaining > 0) throw new Error("Пожалуйста подождите перед заказом следующей песни: " + formatSeconds_(remaining));
    }
    const sh = getSS_().getSheetByName("Queue"), rows = getRows_(sh);
    if (!admin && rows.some(r => nameKey_(r.requester) === key && ["Waiting","Playing"].includes(String(r.status)))) throw new Error("У вас уже есть активный заказ. Дождитесь его исполнения.");
    const id = Utilities.getUuid(), pos = rows.filter(r => r.status === "Waiting").length + 1;
    sh.appendRow([id,song,artist,requester,"Waiting",new Date(),pos]);
    if (!admin) updateUser_(key,{cooldownUntil:now + getSettings_().cooldownSeconds*1000,updatedAt:new Date()});
    ensureCurrent_();
    return {ok:true,message:"Песня добавлена в очередь.",cooldownSeconds:admin?0:getSettings_().cooldownSeconds};
  });
}

function stateWhileLocked_(admin, guestName) {
  const ss = getSS_(); ensureCurrent_();
  let pb = getPlayback_(), rows = getRows_(ss.getSheetByName("Queue"));
  let current = rows.find(r => r.id === pb.currentSongId && r.status === "Playing") || null;
  let remaining = Number(pb.remainingSeconds || getSettings_().songSeconds);
  if (current && String(pb.paused) !== "true" && pb.startedAt) {
    remaining = Math.max(0, getSettings_().songSeconds - Math.floor((Date.now()-new Date(pb.startedAt).getTime())/1000));
    if (remaining <= 0 && getSettings_().autoplay) { advance_("Completed"); pb=getPlayback_(); rows=getRows_(ss.getSheetByName("Queue")); current=rows.find(r=>r.id===pb.currentSongId&&r.status==="Playing")||null; remaining=current?getSettings_().songSeconds:0; }
  }
  const queue = rows.filter(r => r.status === "Waiting").sort((a,b)=>Number(a.position)-Number(b.position)).map(publicSong_);
  const historyRows = getRows_(ss.getSheetByName("History"));
  const visibleHistory = historyRows.filter(h => !truthy_(h.hidden) && ["Completed","Skipped","Interrupted","Removed","Replayed"].includes(String(h.result)));
  const history = visibleHistory.filter(h=>!truthy_(h.cleared)).slice(-200).reverse().map(h => ({id:h.id,historyId:h.entryId,song:h.song,artist:h.artist,requester:h.requester,result:h.result,playedAt:h.playedAt}));
  const playedHistory = visibleHistory.filter(h => ["Completed","Skipped","Interrupted","Replayed"].includes(String(h.result)));
  const previous = playedHistory.slice(-2).map(h => ({id:h.id,historyId:h.entryId,song:h.song,artist:h.artist,requester:h.requester,result:h.result,playedAt:h.playedAt}));
  const settings=getSettings_();
  const out = {current:current?publicSong_(current):null,queue,history,previous,paused:String(pb.paused)==="true",remainingSeconds:current?remaining:null,eventMode:settings.eventMode,settings};
  if (admin) {
    out.users = getRows_(ss.getSheetByName("Users")).map(user => ({name:user.name,status:user.status,cooldownRemaining:Math.max(0,Math.ceil((Number(user.cooldownUntil||0)-Date.now())/1000)),banRemaining:Math.max(0,Math.ceil((Number(user.bannedUntil||0)-Date.now())/1000))}));
  } else {
    const key = nameKey_(guestName), user = key ? findUser_(key) : null;
    out.guest = user ? {name:user.name,status:user.status,cooldownRemaining:Math.max(0,Math.ceil((Number(user.cooldownUntil||0)-Date.now())/1000)),banRemaining:Math.max(0,Math.ceil((Number(user.bannedUntil||0)-Date.now())/1000))} : null;
  }
  return out;
}
function publicSong_(r) { return {id:r.id,song:r.song,artist:r.artist,requester:r.requester,requestedAt:r.createdAt}; }
function formatSeconds_(s) { s=Math.max(0,Number(s)||0); return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); }

function approveUser_(name) {
  const key=nameKey_(name), user=findUser_(key); if(!user||String(user.status)!=="Pending") throw new Error("Заявка пользователя уже недоступна.");
  updateUser_(key,{status:"Confirmed",updatedAt:new Date()});
}
function denyUser_(name) {
  const key=nameKey_(name), user=findUser_(key); if(!user||String(user.status)!=="Pending") throw new Error("Заявка пользователя уже недоступна.");
  updateUser_(key,{status:"Denied",updatedAt:new Date()});
}
function liftCooldown_(name) { const key=nameKey_(name), user=findUser_(key); if(!user) throw new Error("Пользователь не найден."); updateUser_(key,{cooldownUntil:0,updatedAt:new Date()}); }
function banUser_(name) { const key=nameKey_(name), user=findUser_(key); if(!user||String(user.status)!=="Confirmed") throw new Error("Подтверждённый пользователь не найден."); updateUser_(key,{bannedUntil:Date.now()+TEMP_BAN_SECONDS*1000,updatedAt:new Date()}); }
function returnUserToPending_(name) { const key=nameKey_(name), user=findUser_(key); if(!user||String(user.status)!=="Confirmed") throw new Error("Подтверждённый пользователь не найден."); updateUser_(key,{status:"Pending",updatedAt:new Date()}); }


function renameGuest_(oldName,newName){
  const oldKey=nameKey_(oldName), name=clean_(newName,32), newKey=nameKey_(name);
  if(!oldKey||!name||newKey.length<2)throw new Error("Введите имя длиной не менее двух символов.");
  if(newKey===nameKey_(OWNER_NAME))throw new Error("Это имя зарезервировано для ведущего.");
  const sh=getSS_().getSheetByName("Users"),rows=getRows_(sh),user=rows.find(r=>String(r.nameKey||nameKey_(r.name))===oldKey);
  if(!user)throw new Error("Пользователь не найден.");
  if(rows.some(r=>String(r.nameKey||nameKey_(r.name))===newKey && String(r.nameKey||nameKey_(r.name))!==oldKey))throw new Error("Это имя уже занято. Выберите другое.");
  const values=sh.getDataRange().getValues(),headers=values[0].map(String),rowIndex=values.findIndex((r,i)=>i>0&&String(r[headers.indexOf("nameKey")]||nameKey_(r[headers.indexOf("name")]))===oldKey);
  if(rowIndex<1)throw new Error("Пользователь не найден.");
  sh.getRange(rowIndex+1,headers.indexOf("name")+1).setValue(name);sh.getRange(rowIndex+1,headers.indexOf("nameKey")+1).setValue(newKey);sh.getRange(rowIndex+1,headers.indexOf("updatedAt")+1).setValue(new Date());
  const q=getSS_().getSheetByName("Queue"),qv=q.getDataRange().getValues(),qh=qv[0].map(String),requesterCol=qh.indexOf("requester");
  for(let i=1;i<qv.length;i++)if(nameKey_(qv[i][requesterCol])===oldKey)q.getRange(i+1,requesterCol+1).setValue(name);
  const h=getSS_().getSheetByName("History"),hv=h.getDataRange().getValues(),hh=hv[0].map(String),hr=hh.indexOf("requester");
  for(let i=1;i<hv.length;i++)if(nameKey_(hv[i][hr])===oldKey)h.getRange(i+1,hr+1).setValue(name);
}

function ensureCurrent_() {
  const pb=getPlayback_(), rows=getRows_(getSS_().getSheetByName("Queue"));
  if(pb.currentSongId&&rows.some(r=>r.id===pb.currentSongId&&r.status==="Playing"))return;
  const next=rows.filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position))[0];
  if(next){updateQueueStatus_(next.id,"Playing");setPlayback_({currentSongId:next.id,paused:"false",startedAt:new Date().toISOString(),remainingSeconds:String(DEFAULT_SONG_SECONDS)});}
  else setPlayback_({currentSongId:"",paused:"false",startedAt:"",remainingSeconds:String(DEFAULT_SONG_SECONDS)});
}
function advance_(result) {
  const pb=getPlayback_();
  if(pb.currentSongId){const cur=getRows_(getSS_().getSheetByName("Queue")).find(r=>r.id===pb.currentSongId&&r.status==="Playing");if(cur){appendHistory_(cur,result);updateQueueStatus_(cur.id,result);}}
  setPlayback_({currentSongId:"",paused:"false",startedAt:"",remainingSeconds:String(DEFAULT_SONG_SECONDS)});ensureCurrent_();renumberQueue_();
}
function playSong_(id) {
  const ss=getSS_(),sh=ss.getSheetByName("Queue"),rows=getRows_(sh),target=rows.find(r=>r.id===id&&["Waiting","Completed","Skipped","Interrupted","Removed"].includes(r.status));
  if(!target)throw new Error("Эта песня больше недоступна для запуска.");
  const pb=getPlayback_();if(pb.currentSongId===id&&target.status==="Playing")return;
  if(pb.currentSongId){const cur=rows.find(r=>r.id===pb.currentSongId&&r.status==="Playing");if(cur){appendHistory_(cur,"Interrupted");updateQueueStatus_(cur.id,"Interrupted");}}
  if(["Completed","Skipped","Interrupted","Removed"].includes(target.status))setLatestHistoryResult_(id,"Replayed");
  updateQueueStatus_(id,"Playing");setPlayback_({currentSongId:id,paused:"false",startedAt:new Date().toISOString(),remainingSeconds:String(DEFAULT_SONG_SECONDS)});renumberQueue_();
}

function queueHistorySongNext_(id) {
  const sh=getSS_().getSheetByName("Queue"), rows=getRows_(sh);
  const target=rows.find(r=>r.id===id&&["Completed","Skipped","Interrupted","Removed","Replayed"].includes(String(r.status)));
  if(!target)throw new Error("Эта запись больше недоступна для добавления в очередь.");
  const waiting=rows.filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position));
  // Shift waiting songs down, then put the selected history song first.
  waiting.slice().reverse().forEach(r=>updatePosition_(r.id,Number(r.position)+1));
  updateQueueStatus_(id,"Waiting");
  updatePosition_(id,1);
  renumberQueue_();
}
function clearQueue_() {
  const sh=getSS_().getSheetByName("Queue"), rows=getRows_(sh), affected={};
  rows.filter(r=>r.status==="Waiting").forEach(r=>{affected[nameKey_(r.requester)]=true;updateQueueStatus_(r.id,"Cleared");});
  Object.keys(affected).forEach(key=>{if(key&&findUser_(key))updateUser_(key,{cooldownUntil:0,updatedAt:new Date()});});
  renumberQueue_();
}
function pause_(){const pb=getPlayback_();if(!pb.currentSongId||String(pb.paused)==="true")return;const remaining=Math.max(0,getSettings_().songSeconds-Math.floor((Date.now()-new Date(pb.startedAt).getTime())/1000));setPlayback_({paused:"true",remainingSeconds:String(remaining)});}
function resume_(){const pb=getPlayback_();if(!pb.currentSongId||String(pb.paused)!=="true")return;const remaining=Number(pb.remainingSeconds||getSettings_().songSeconds);setPlayback_({paused:"false",startedAt:new Date(Date.now()-(getSettings_().songSeconds-remaining)*1000).toISOString()});}
function moveQueueItem_(id,direction){const rows=getRows_(getSS_().getSheetByName("Queue")).filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position));const i=rows.findIndex(r=>r.id===id),j=direction==="up"?i-1:direction==="down"?i+1:-1;if(i<0)throw new Error("Песня уже не находится в очереди.");if(j<0||j>=rows.length)return;const a=rows[i],b=rows[j];updatePosition_(a.id,Number(b.position));updatePosition_(b.id,Number(a.position));}
function removeQueueItem_(id){const row=getRows_(getSS_().getSheetByName("Queue")).find(r=>r.id===id&&r.status==="Waiting");if(!row)throw new Error("Песня уже не находится в очереди.");appendHistory_(row,"Removed");updateQueueStatus_(id,"Removed");const key=nameKey_(row.requester);if(key&&findUser_(key))updateUser_(key,{cooldownUntil:0,updatedAt:new Date()});renumberQueue_();}
function appendHistory_(r,result){getSS_().getSheetByName("History").appendRow([r.id,r.song,r.artist,r.requester,result,new Date(),false,Utilities.getUuid()]);}
function setLatestHistoryResult_(id,result){const sh=getSS_().getSheetByName("History"),v=sh.getDataRange().getValues();for(let i=v.length-1;i>=1;i--)if(String(v[i][0])===id){sh.getRange(i+1,5).setValue(result);return;}}
function setHistoryHidden_(entryId,hidden){const sh=getSS_().getSheetByName("History"),v=sh.getDataRange().getValues(),headers=v[0].map(String),idCol=headers.indexOf("entryId"),hiddenCol=headers.indexOf("hidden");for(let i=1;i<v.length;i++)if(String(v[i][idCol])===entryId){sh.getRange(i+1,hiddenCol+1).setValue(hidden);return;}throw new Error("Запись истории не найдена.");}
function deleteHistory_(entryId){const sh=getSS_().getSheetByName("History"),v=sh.getDataRange().getValues(),headers=v[0].map(String),idCol=headers.indexOf("entryId");for(let i=v.length-1;i>=1;i--)if(String(v[i][idCol])===entryId){sh.deleteRow(i+1);return;}throw new Error("Запись истории не найдена.");}
function updatePosition_(id,pos){const sh=getSS_().getSheetByName("Queue"),v=sh.getDataRange().getValues();for(let i=1;i<v.length;i++)if(String(v[i][0])===id){sh.getRange(i+1,7).setValue(pos);return;}}
function updateQueueStatus_(id,status){const sh=getSS_().getSheetByName("Queue"),v=sh.getDataRange().getValues();for(let i=1;i<v.length;i++)if(String(v[i][0])===id){sh.getRange(i+1,5).setValue(status);return;}}
function renumberQueue_(){const rows=getRows_(getSS_().getSheetByName("Queue")).filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position));rows.forEach((r,i)=>updatePosition_(r.id,i+1));}
function getPlayback_(){const v=getSS_().getSheetByName("Playback").getDataRange().getValues(),o={};for(let i=1;i<v.length;i++)o[String(v[i][0])]=String(v[i][1]);return o;}
function setPlayback_(changes){const sh=getSS_().getSheetByName("Playback"),v=sh.getDataRange().getValues();Object.keys(changes).forEach(k=>{let found=false;for(let i=1;i<v.length;i++)if(String(v[i][0])===k){sh.getRange(i+1,2).setValue(changes[k]);found=true;break;}if(!found)sh.appendRow([k,changes[k]]);});}
function getRows_(sh){const v=sh.getDataRange().getValues();if(v.length<2)return[];const headers=v[0].map(String);return v.slice(1).filter(row=>row.some(x=>x!=="")).map(row=>{const o={};headers.forEach((h,i)=>o[h]=row[i] instanceof Date?row[i].getTime():String(row[i]==null?"":row[i]));return o;});}
function removeLegacyIdentityColumns_(ss,name){const sh=ss.getSheetByName(name);if(!sh||sh.getLastRow()===0)return;const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);["deviceId","requesterToken"].forEach(field=>{const index=headers.indexOf(field);if(index>=0)sh.deleteColumn(index+1);});}
function ensureSheet_(ss,name,headers){let sh=ss.getSheetByName(name);if(!sh)sh=ss.insertSheet(name);if(sh.getLastRow()===0){sh.appendRow(headers);return;}const existing=sh.getRange(1,1,1,Math.max(1,sh.getLastColumn())).getValues()[0].map(String);headers.forEach(h=>{if(existing.indexOf(h)<0){const col=sh.getLastColumn()+1;sh.getRange(1,col).setValue(h);existing.push(h);}});}

function ensureHistoryEntryIds_(){const sh=getSS_().getSheetByName("History"),v=sh.getDataRange().getValues(),headers=v[0].map(String),col=headers.indexOf("entryId");if(col<0)return;for(let i=1;i<v.length;i++)if(!String(v[i][col]||""))sh.getRange(i+1,col+1).setValue(Utilities.getUuid());}
function getSS_(){const id=PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");if(!id)throw new Error("Missing SPREADSHEET_ID script property.");return SpreadsheetApp.openById(id);}
function withLock_(fn){const lock=LockService.getScriptLock();lock.waitLock(20000);try{return fn();}finally{lock.releaseLock();}}
function clean_(v,max){return String(v||"").replace(/[<>]/g,"").trim().replace(/\s+/g," ").slice(0,max);}
function truthy_(v){return v===true||String(v).toLowerCase()==="true"||String(v)==="1";}
function findUser_(key){if(!key)return null;const rows=getRows_(getSS_().getSheetByName("Users"));return rows.find(r=>String(r.nameKey||nameKey_(r.name))===key)||null;}
function updateUser_(key,changes){const sh=getSS_().getSheetByName("Users"),v=sh.getDataRange().getValues(),headers=v[0].map(String);for(let i=1;i<v.length;i++){const rowKey=String(v[i][headers.indexOf("nameKey")]||nameKey_(v[i][headers.indexOf("name")]));if(rowKey===key){Object.keys(changes).forEach(k=>{const col=headers.indexOf(k);if(col>=0)sh.getRange(i+1,col+1).setValue(changes[k]);});return;}}throw new Error("Пользователь не найден.");}

function getSettings_(){const rows=getRows_(getSS_().getSheetByName("Settings")),o={autoplay:true,songSeconds:300,cooldownSeconds:900,eventMode:false};rows.forEach(r=>{if(r.key==="autoplay")o.autoplay=truthy_(r.value);if(r.key==="songSeconds")o.songSeconds=Math.max(60,Math.min(1800,Number(r.value)||300));if(r.key==="cooldownSeconds")o.cooldownSeconds=Math.max(0,Math.min(7200,Number(r.value)||0));if(r.key==="eventMode")o.eventMode=truthy_(r.value);});return o;}
function setSetting_(key,value){const sh=getSS_().getSheetByName("Settings"),v=sh.getDataRange().getValues();for(let i=1;i<v.length;i++)if(String(v[i][0])===key){sh.getRange(i+1,2).setValue(value);return;}sh.appendRow([key,value]);}
function saveSettings_(p){setSetting_("autoplay",String(p.autoplay)==="true");setSetting_("songSeconds",Math.max(60,Math.min(1800,Number(p.songSeconds)||300)));setSetting_("cooldownSeconds",Math.max(0,Math.min(7200,Number(p.cooldownSeconds)||0)));}
function setEventMode_(enabled){setSetting_("eventMode",enabled);}
function clearHistory_(){const sh=getSS_().getSheetByName("History"),v=sh.getDataRange().getValues(),headers=v[0].map(String),col=headers.indexOf("cleared");if(col<0)throw new Error("Поле cleared отсутствует. Запустите setupKaraLoki.");if(v.length>1)sh.getRange(2,col+1,v.length-1,1).setValue(true);}
function shuffleQueue_(){const sh=getSS_().getSheetByName("Queue"),rows=getRows_(sh).filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position));const eligible=rows.slice(3);if(eligible.length<2)throw new Error("Нужно минимум две песни после первых трёх.");for(let i=eligible.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[eligible[i],eligible[j]]=[eligible[j],eligible[i]];}rows.forEach((r,i)=>updatePosition_(r.id,i+1));eligible.forEach((r,i)=>updatePosition_(r.id,i+4));}
function reorderQueue_(idsJson){const ids=JSON.parse(idsJson);if(!Array.isArray(ids))throw new Error("Некорректный порядок песен.");const rows=getRows_(getSS_().getSheetByName("Queue")).filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position));const current=rows.map(r=>String(r.id));if(ids.length!==current.length||new Set(ids).size!==current.length||ids.some(id=>!current.includes(String(id)))||current.some(id=>!ids.includes(id)))throw new Error("Список песен изменился. Обновите очередь.");ids.forEach((id,i)=>updatePosition_(id,i+1));}
