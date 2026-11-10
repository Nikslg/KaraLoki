/**
 * KaraLoki v1.9.0 — Google Apps Script backend.
 * Guest identity is the approved display name (case-insensitive matching).
 * Device IDs and room codes are no longer used. Google Sheets remains the database.
 * Admin identity and PIN are stored in the private Admin sheet. Admin sessions are server-validated.
 */
const QUEUE_HEADERS = ["id","song","artist","requester","status","createdAt","position"];
const PLAYBACK_HEADERS = ["key","value"];
const HISTORY_HEADERS = ["id","song","artist","requester","result","playedAt","hidden","entryId","cleared"];
const USER_HEADERS = ["name","nameKey","status","cooldownUntil","bannedUntil","createdAt","updatedAt"] ;
const SESSION_HEADERS = ["nameKey","name","token","lastHeartbeat","clientInfo","lastLogin"];
const TRANSFER_HEADERS = ["requestId","nameKey","name","clientInfo","createdAt","status"];
const DEFAULT_SONG_SECONDS = 300;
const DEFAULT_COOLDOWN_SECONDS = 900;
const TEMP_BAN_SECONDS = 1800;
const ADMIN_HEADERS = ["username","pin","enabled","updatedAt"];
const ADMIN_SESSION_HEADERS = ["token","username","createdAt","lastSeen"];

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
  ensureSheet_(ss, "Sessions", SESSION_HEADERS);
  ensureSheet_(ss, "SessionTransfers", TRANSFER_HEADERS);
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
  if (a === "adminChallenge") return adminChallenge_(p);
  if (a === "adminCheck") return adminLogin_(p);
  if (a === "adminLogout") return adminLogout_(p.adminToken);
  if (a === "adminBootstrap") return adminBootstrap_();
  if (a === "guestLogin") return guestLogin_(p);
  if (a === "requestSessionTransfer") return requestSessionTransfer_(p);
  if (a === "transferStatus") return transferStatus_(p);
  if (a === "cancelTransferRequest") return cancelTransferRequest_(p);
  if (a === "heartbeat") return heartbeat_(p);
  if (a === "releaseSession") return releaseSession_(p);
  if (a === "respondTransfer") return respondTransfer_(p);
  if (a === "state") {
    const admin = validAdminSession_(p.adminToken);
    if (p.adminToken && !admin) throw new Error("Сессия администратора завершена. Войдите снова.");
    if (!admin) return {ok:true,state:withLock_(() => stateWhileLocked_(false, clean_(p.guestName,32), String(p.sessionToken||"")))};
    return {ok:true,state:withLock_(() => stateWhileLocked_(true, ""))};
  }
  if (a === "advanceIfExpired") return withLock_(() => advanceIfExpired_());
  if (a === "add") return addSong_(p);
  if (a === "renameGuest") return withLock_(() => { if(!validAdminSession_(p.adminToken)) requireSession_(p.oldName,p.sessionToken); renameGuest_(p.oldName,p.newName); renameSession_(p.oldName,p.newName); return {ok:true}; });
  const adminActions = ["skip","pause","resume","move","remove","play","clearQueue","approveUser","denyUser","liftCooldown","banUser","returnToPending","hideHistory","deleteHistory","clearHistory","shuffle","reorder","saveSettings","setEventMode","forceLogoutSession","rejectTransferRequest"];
  if (adminActions.indexOf(a) >= 0) {
    requireAdminSession_(p.adminToken);
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
      if (a === "forceLogoutSession") forceLogoutSession_(p.name);
      if (a === "rejectTransferRequest") rejectTransferRequest_(p.name);
      return {ok:true};
    });
  }
  return {ok:false,error:"Unknown action."};
}


function ensureAdminSheets_(){
  const ss=getSS_(); ensureSheet_(ss,"Admin",ADMIN_HEADERS); ensureSheet_(ss,"AdminSessions",ADMIN_SESSION_HEADERS); ensureSheet_(ss,"Devices",["nameKey","username","deviceId","firstSeen","lastSeen","active"]);
}
function getAdminRecord_(){
  ensureAdminSheets_(); const rows=getRows_(getSS_().getSheetByName("Admin"));
  const rec=rows.find(r=>String(r.enabled||"true").toLowerCase()!=="false");
  if(!rec||!String(rec.username||"").trim()||!String(rec.pin||"")) throw new Error("Заполните username и pin на вкладке Admin.");
  return rec;
}
function initializeAdminSheet(){
  ensureAdminSheets_(); const sh=getSS_().getSheetByName("Admin");
  if(sh.getLastRow()===1) sh.appendRow(["CHANGE_ME","0000","true",new Date()]);
  return "Admin sheet initialized. Replace CHANGE_ME and 0000 in the Admin tab before publishing.";
}
function adminBootstrap_(){ return {ok:true,message:initializeAdminSheet()}; }
function checkAdminLockout_(){const p=PropertiesService.getScriptProperties(),until=Number(p.getProperty("ADMIN_LOCK_UNTIL")||0);if(until>Date.now())throw new Error("Слишком много попыток. Повторите через 15 минут.");}
function recordAdminFailure_(){const p=PropertiesService.getScriptProperties(),n=Number(p.getProperty("ADMIN_FAILS")||0)+1;p.setProperty("ADMIN_FAILS",String(n));if(n>=5){p.setProperty("ADMIN_LOCK_UNTIL",String(Date.now()+15*60*1000));p.deleteProperty("ADMIN_FAILS");}}
function clearAdminFailures_(){const p=PropertiesService.getScriptProperties();p.deleteProperty("ADMIN_FAILS");p.deleteProperty("ADMIN_LOCK_UNTIL");}
function sha256Hex_(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value),Utilities.Charset.UTF_8).map(b=>(b<0?b+256:b).toString(16).padStart(2,"0")).join("");}
function adminChallenge_(p){
  return withLock_(()=>{
    checkAdminLockout_();const rec=getAdminRecord_(),username=String(p.username||"").trim();
    if(!username||nameKey_(username)!==nameKey_(rec.username)){recordAdminFailure_();throw new Error("Неверное имя администратора или PIN.");}
    const stored=String(rec.pin||""),parts=stored.startsWith("sha256$")?stored.split("$"):[];
    const salt=parts.length===3?parts[1]:Utilities.getUuid().replace(/-/g,"");
    const nonce=Utilities.getUuid()+Utilities.getUuid();
    CacheService.getScriptCache().put("kl_admin_chal_"+sha256Hex_(nameKey_(username)),JSON.stringify({nonce,salt,username:rec.username}),60);
    return {ok:true,nonce,salt};
  });
}
function adminLogin_(p){
  return withLock_(()=>{
    checkAdminLockout_();const rec=getAdminRecord_(),username=String(p.username||"").trim(),nonce=String(p.nonce||""),proof=String(p.proof||"");
    if(!username||nameKey_(username)!==nameKey_(rec.username)){recordAdminFailure_();throw new Error("Неверное имя администратора или PIN.");}
    const cache=CacheService.getScriptCache(),cacheKey="kl_admin_chal_"+sha256Hex_(nameKey_(username)),challenge=cache.get(cacheKey);
    cache.remove(cacheKey);
    if(!challenge) {recordAdminFailure_();throw new Error("Срок проверки истёк. Повторите вход.");}
    const c=JSON.parse(challenge),stored=String(rec.pin||"");let salt=c.salt,verifier="";
    if(c.nonce!==nonce||c.username!==rec.username){recordAdminFailure_();throw new Error("Проверка входа не пройдена.");}
    if(stored.startsWith("sha256$")){const parts=stored.split("$");if(parts.length!==3||parts[1]!==salt){recordAdminFailure_();throw new Error("Проверка входа не пройдена.");}verifier=parts[2];}
    else verifier=sha256Hex_(salt+":"+stored);
    if(sha256Hex_(verifier+":"+nonce)!==proof){recordAdminFailure_();throw new Error("Неверное имя администратора или PIN.");}
    if(!stored.startsWith("sha256$")){const sh=getSS_().getSheetByName("Admin"),rows=getRows_(sh),idx=rows.findIndex(r=>nameKey_(r.username)===nameKey_(rec.username)),headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);sh.getRange(idx+2,headers.indexOf("pin")+1).setValue("sha256$"+salt+"$"+verifier);const updated=headers.indexOf("updatedAt");if(updated>=0)sh.getRange(idx+2,updated+1).setValue(new Date());}
    clearAdminFailures_();const token=Utilities.getUuid()+Utilities.getUuid(),sessions=getSS_().getSheetByName("AdminSessions");sessions.appendRow([token,rec.username,Date.now(),Date.now()]);
    return {ok:true,adminToken:token,username:rec.username};
  });
}
function validAdminSession_(token){
  if(!token)return false; ensureAdminSheets_();const sh=getSS_().getSheetByName("AdminSessions"),rows=getRows_(sh),i=rows.findIndex(r=>r.token===String(token));
  if(i<0)return false;const age=Date.now()-Number(rows[i].lastSeen||0);if(age>12*60*60*1000){sh.getRange(i+2,1).setValue("");return false;}
  sh.getRange(i+2,4).setValue(Date.now());return true;
}
function requireAdminSession_(token){if(!validAdminSession_(token))throw new Error("Сессия администратора завершена. Войдите снова.");}
function adminLogout_(token){if(!token)return {ok:true};ensureAdminSheets_();const sh=getSS_().getSheetByName("AdminSessions"),rows=getRows_(sh),i=rows.findIndex(r=>r.token===String(token));if(i>=0)sh.getRange(i+2,1).setValue("");return {ok:true};}


function nameKey_(v) { return clean_(v,32).toLocaleLowerCase().replace(/\s+/g," "); }

function guestLogin_(p) {
  const name = clean_(p.name,32), key = nameKey_(name), suppliedToken=String(p.sessionToken||"");
  if (!name || key.length < 2) throw new Error("Введите имя длиной не менее двух символов.");
  if (key === nameKey_(getAdminRecord_().username)) throw new Error("Это имя зарезервировано для ведущего.");
  return withLock_(() => {
    const user=findUser_(key), now=Date.now();
    if(user){
      const bannedUntil=Number(user.bannedUntil||0);
      if(bannedUntil>now)return {ok:true,status:"banned",name:user.name,banRemaining:Math.ceil((bannedUntil-now)/1000)};
      if(String(user.status)==="Confirmed"){
        const session=findSession_(key);
        if(session && session.token && session.token===suppliedToken){updateSessionHeartbeat_(key,suppliedToken,p.clientInfo);recordDevice_(key,user.name,p.clientInfo);return {ok:true,status:"confirmed",name:user.name,sessionToken:suppliedToken};}
        // Recover a returning browser on the same installation if its session token was lost.
        // clientInfo includes a persistent browser-installation ID generated by app.js.
        const incomingClient=String(p.clientInfo||"");
        if(session && session.token && incomingClient && session.clientInfo===incomingClient){
          updateSessionHeartbeat_(key,session.token,incomingClient);recordDevice_(key,user.name,incomingClient);
          return {ok:true,status:"confirmed",name:user.name,sessionToken:session.token,recovered:true};
        }
        const last=Number(session?.lastHeartbeat||0),age=now-last;
        if(session && session.token && age<60*60*1000){
          const approved=approvedTransferFor_(key);
          if(!approved)return {ok:true,status:"sessionOccupied",name:user.name,onlineState:age<=5*60*1000?"online":"recent",remainingSeconds:Math.ceil((60*60*1000-age)/1000)};
        }
        const token=Utilities.getUuid();upsertSession_(key,user.name,token,now,p.clientInfo);
        approveWaitingTransfers_(key);recordDevice_(key,user.name,p.clientInfo);
        return {ok:true,status:"confirmed",name:user.name,sessionToken:token};
      }
      if(String(user.status)==="Pending")return {ok:true,status:"pending",name:user.name,isNew:false};
      if(String(user.status)==="Denied"){updateUser_(key,{status:"Pending",updatedAt:new Date()});return {ok:true,status:"pending",name:user.name,isNew:false};}
    }
    const sh=getSS_().getSheetByName("Users");sh.appendRow([name,key,"Pending",0,0,new Date(),new Date()]);
    return {ok:true,status:"pending",name:name,isNew:true};
  });
}

function recordDevice_(key,name,clientInfo){
  const match=String(clientInfo||"").match(/device:([^\s]+)/);if(!match)return;const id=match[1],sh=getSS_().getSheetByName("Devices"),rows=getRows_(sh),i=rows.findIndex(r=>r.nameKey===key&&r.deviceId===id),now=Date.now();
  if(i<0)sh.appendRow([key,name,id,now,now,"true"]);else{sh.getRange(i+2,5).setValue(now);sh.getRange(i+2,6).setValue("true");}
}
function requestSessionTransfer_(p){
  const key=nameKey_(p.name);return withLock_(()=>{const user=findUser_(key);if(!user||String(user.status)!=="Confirmed")throw new Error("Подтверждённый пользователь не найден.");const session=findSession_(key);if(!session||!session.token||Date.now()-Number(session.lastHeartbeat||0)>=60*60*1000)return {ok:true,status:"Available"};const sh=getSS_().getSheetByName("SessionTransfers"),rows=getRows_(sh);let existing=rows.find(r=>r.nameKey===key&&r.status==="Pending");if(existing)return {ok:true,requestId:existing.requestId};const id=Utilities.getUuid();sh.appendRow([id,key,user.name,clean_(p.clientInfo,100),new Date(),"Pending"]);return {ok:true,requestId:id};});
}
function cancelTransferRequest_(p){return withLock_(()=>{const key=nameKey_(p.name),sh=getSS_().getSheetByName("SessionTransfers"),rows=getRows_(sh),i=rows.findIndex(r=>r.requestId===String(p.requestId)&&r.nameKey===key&&r.status==="Pending");if(i>=0)sh.getRange(i+2,6).setValue("Cancelled");return {ok:true,status:"Cancelled"};});}
function transferStatus_(p){return withLock_(()=>{const key=nameKey_(p.name),sess=findSession_(key);if(!sess||!sess.token||Date.now()-Number(sess.lastHeartbeat||0)>=60*60*1000)return {ok:true,status:"Available"};const rows=getRows_(getSS_().getSheetByName("SessionTransfers")),r=rows.filter(x=>x.nameKey===key).sort((a,b)=>Number(b.createdAt)-Number(a.createdAt))[0];if(r&&r.status==="Pending"&&Date.now()-Number(r.createdAt)>=180000){setTransferStatus_(r.requestId,"Expired");return {ok:true,status:"Expired"};}return {ok:true,status:r?String(r.status):"None"};});}
function releaseSession_(p){return withLock_(()=>{const key=nameKey_(p.name),session=findSession_(key);if(session&&session.token===String(p.sessionToken||""))revokeSession_(key);return {ok:true};});}
function heartbeat_(p){return withLock_(()=>{const key=nameKey_(p.name),token=String(p.sessionToken||""),session=findSession_(key);if(!session||!token||session.token!==token)return {ok:true,valid:false};updateSessionHeartbeat_(key,token,p.clientInfo);const requests=getRows_(getSS_().getSheetByName("SessionTransfers")).filter(r=>r.nameKey===key&&r.status==="Pending"&&Date.now()-Number(r.createdAt)<180000).map(r=>({requestId:r.requestId,clientInfo:r.clientInfo}));return {ok:true,valid:true,requests};});}
function respondTransfer_(p){return withLock_(()=>{const key=nameKey_(p.name),token=String(p.sessionToken||""),session=findSession_(key);if(!session||session.token!==token)throw new Error("Сессия больше не активна.");const sh=getSS_().getSheetByName("SessionTransfers"),rows=getRows_(sh),r=rows.find(x=>x.requestId===String(p.requestId)&&x.nameKey===key&&x.status==="Pending");if(!r)throw new Error("Запрос уже недоступен.");const decision=String(p.decision)==="approve"?"Approved":"Rejected";setTransferStatus_(r.requestId,decision);if(decision==="Approved")revokeSession_(key);return {ok:true,status:decision};});}
function findSession_(key){return getRows_(getSS_().getSheetByName("Sessions")).find(r=>r.nameKey===key)||null;}
function upsertSession_(key,name,token,now,client){const sh=getSS_().getSheetByName("Sessions"),rows=getRows_(sh),i=rows.findIndex(r=>r.nameKey===key);const row=[key,name,token,now,clean_(client,100),now];if(i<0)sh.appendRow(row);else sh.getRange(i+2,1,1,row.length).setValues([row]);}
function updateSessionHeartbeat_(key,token,client){const sh=getSS_().getSheetByName("Sessions"),rows=getRows_(sh),i=rows.findIndex(r=>r.nameKey===key&&r.token===token);if(i>=0){sh.getRange(i+2,4).setValue(Date.now());if(client)sh.getRange(i+2,5).setValue(clean_(client,100));}}
function revokeSession_(key){const sh=getSS_().getSheetByName("Sessions"),rows=getRows_(sh),i=rows.findIndex(r=>r.nameKey===key);if(i>=0)sh.getRange(i+2,3).setValue("");}
function forceLogoutSession_(name){const key=nameKey_(name);if(!findUser_(key))throw new Error("Пользователь не найден.");revokeSession_(key);getRows_(getSS_().getSheetByName("SessionTransfers")).filter(r=>r.nameKey===key&&r.status==="Pending").forEach(r=>setTransferStatus_(r.requestId,"Approved"));}
function rejectTransferRequest_(name){const key=nameKey_(name);getRows_(getSS_().getSheetByName("SessionTransfers")).filter(r=>r.nameKey===key&&r.status==="Pending").forEach(r=>setTransferStatus_(r.requestId,"Rejected"));}
function setTransferStatus_(id,status){const sh=getSS_().getSheetByName("SessionTransfers"),rows=getRows_(sh),i=rows.findIndex(r=>r.requestId===id);if(i>=0)sh.getRange(i+2,6).setValue(status);}
function approvedTransferFor_(key){const rows=getRows_(getSS_().getSheetByName("SessionTransfers"));const r=rows.filter(x=>x.nameKey===key).sort((a,b)=>Number(b.createdAt)-Number(a.createdAt))[0];return !!r&&r.status==="Approved";}
function approveWaitingTransfers_(key){getRows_(getSS_().getSheetByName("SessionTransfers")).filter(r=>r.nameKey===key&&r.status==="Approved").forEach(r=>setTransferStatus_(r.requestId,"Consumed"));}
function requireSession_(name,token){const key=nameKey_(name),s=findSession_(key);if(!s||!token||s.token!==String(token))throw new Error("Сессия завершена. Войдите снова.");updateSessionHeartbeat_(key,String(token));}
function renameSession_(oldName,newName){const key=nameKey_(oldName),newKey=nameKey_(newName),s=findSession_(key);if(s){const sh=getSS_().getSheetByName("Sessions"),rows=getRows_(sh),i=rows.findIndex(r=>r.nameKey===key);if(i>=0){sh.getRange(i+2,1).setValue(newKey);sh.getRange(i+2,2).setValue(clean_(newName,32));}}const ts=getSS_().getSheetByName("SessionTransfers"),tr=getRows_(ts);tr.forEach((r,i)=>{if(r.nameKey===key){ts.getRange(i+2,2).setValue(newKey);ts.getRange(i+2,3).setValue(clean_(newName,32));}});}

function addSong_(p) {
  const song = clean_(p.song,140), artist = clean_(p.artist,100);
  const admin = validAdminSession_(p.adminToken);
  const requester = clean_(admin ? getAdminRecord_().username : p.requester,32), key = nameKey_(requester);
  if (!song || !requester) throw new Error("Укажите название песни и имя.");
  return withLock_(() => {
    const user = admin ? null : findUser_(key), now = Date.now();
    if (!admin) {
      if (truthy_(getSettings_().eventMode)) throw new Error("Приём заявок временно приостановлен.");
      if (!user || String(user.status) !== "Confirmed") throw new Error("Ваше имя ещё не подтверждено администратором.");
      requireSession_(requester,p.sessionToken);
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

function stateWhileLocked_(admin, guestName, sessionToken) {
  const ss = getSS_(); ensureCurrent_();
  let pb = getPlayback_(), rows = getRows_(ss.getSheetByName("Queue"));
  let current = rows.find(r => r.id === pb.currentSongId && r.status === "Playing") || null;
  let remaining = Number(pb.remainingSeconds || getSettings_().songSeconds);
  const serverNow = Date.now(), settings = getSettings_();
  let expiresAt = null;
  if (current && String(pb.paused) !== "true" && pb.startedAt) {
    expiresAt = new Date(pb.startedAt).getTime() + settings.songSeconds * 1000;
    remaining = Math.max(0, Math.ceil((expiresAt-serverNow)/1000));
  }
  const queue = rows.filter(r => r.status === "Waiting").sort((a,b)=>Number(a.position)-Number(b.position)).map(publicSong_);
  const historyRows = getRows_(ss.getSheetByName("History"));
  const visibleHistory = historyRows.filter(h => !truthy_(h.hidden) && ["Completed","Skipped","Interrupted","Removed","Replayed"].includes(String(h.result)));
  const history = visibleHistory.filter(h=>!truthy_(h.cleared)).slice(-200).reverse().map(h => ({id:h.id,historyId:h.entryId,song:h.song,artist:h.artist,requester:h.requester,result:h.result,playedAt:h.playedAt}));
  const playedHistory = visibleHistory.filter(h => ["Completed","Skipped","Interrupted","Replayed"].includes(String(h.result)));
  const previousCutoff = serverNow - 60 * 60 * 1000;
  const previous = playedHistory.filter(h => {
    const finishedAt = new Date(h.playedAt).getTime();
    return Number.isFinite(finishedAt) && finishedAt >= previousCutoff && finishedAt <= serverNow;
  }).slice(-2).map(h => ({id:h.id,historyId:h.entryId,song:h.song,artist:h.artist,requester:h.requester,result:h.result,playedAt:new Date(h.playedAt).toISOString()}));
  const out = {current:current?publicSong_(current):null,queue,history,previous,paused:String(pb.paused)==="true",remainingSeconds:current?remaining:null,serverNow,expiresAt,eventMode:settings.eventMode,settings};
  if (admin) {
    const sessions=getRows_(ss.getSheetByName("Sessions"));
    const deviceRows=getRows_(ss.getSheetByName("Devices"));out.users = getRows_(ss.getSheetByName("Users")).map(user => {const sess=sessions.find(x=>x.nameKey===nameKey_(user.name));const age=sess?Date.now()-Number(sess.lastHeartbeat||0):Infinity;return {name:user.name,status:user.status,cooldownRemaining:Math.max(0,Math.ceil((Number(user.cooldownUntil||0)-Date.now())/1000)),banRemaining:Math.max(0,Math.ceil((Number(user.bannedUntil||0)-Date.now())/1000)),presence:!sess||!sess.token||age>=60*60*1000?"offline":age<=5*60*1000?"online":"recent",sessionActive:!!(sess&&sess.token&&age<60*60*1000),lastLogin:sess?Number(sess.lastLogin||sess.lastHeartbeat||0):0,clientInfo:sess?String(sess.clientInfo||""):"",deviceIds:deviceRows.filter(d=>d.nameKey===nameKey_(user.name)&&String(d.active).toLowerCase()==="true").map(d=>String(d.deviceId)),transferPending:getRows_(ss.getSheetByName("SessionTransfers")).some(t=>t.nameKey===nameKey_(user.name)&&t.status==="Pending"&&Date.now()-Number(t.createdAt)<180000)};});
  } else {
    const key = nameKey_(guestName), user = key ? findUser_(key) : null;
    const sess=user?findSession_(key):null;
    out.guest = user ? {name:user.name,status:user.status,cooldownRemaining:Math.max(0,Math.ceil((Number(user.cooldownUntil||0)-Date.now())/1000)),banRemaining:Math.max(0,Math.ceil((Number(user.bannedUntil||0)-Date.now())/1000)),sessionValid:!!(sess&&sessionToken&&sess.token===String(sessionToken))} : null;
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
function returnUserToPending_(name) { const key=nameKey_(name), user=findUser_(key); if(!user||String(user.status)!=="Confirmed") throw new Error("Подтверждённый пользователь не найден."); updateUser_(key,{status:"Pending",updatedAt:new Date()}); revokeSession_(key); const sh=getSS_().getSheetByName("Devices"),rows=getRows_(sh);rows.forEach((r,i)=>{if(r.nameKey===key)sh.getRange(i+2,6).setValue("false");}); }


function renameGuest_(oldName,newName){
  const oldKey=nameKey_(oldName), name=clean_(newName,32), newKey=nameKey_(name);
  if(!oldKey||!name||newKey.length<2)throw new Error("Введите имя длиной не менее двух символов.");
  if(newKey===nameKey_(getAdminRecord_().username))throw new Error("Это имя зарезервировано для ведущего.");
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

function advanceIfExpired_() {
  const pb=getPlayback_(), settings=getSettings_(), now=Date.now();
  if (!pb.currentSongId || String(pb.paused)==="true" || !settings.autoplay || !pb.startedAt) return {ok:true,advanced:false};
  const expiresAt=new Date(pb.startedAt).getTime()+settings.songSeconds*1000;
  if (now < expiresAt) return {ok:true,advanced:false};
  advance_("Completed");
  return {ok:true,advanced:true};
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
function saveSettings_(p){
  const oldDuration=getSettings_().songSeconds;
  const newDuration=Math.max(60,Math.min(1800,Number(p.songSeconds)||300));
  const pb=getPlayback_(), now=Date.now();
  setSetting_("autoplay",String(p.autoplay)==="true");
  setSetting_("songSeconds",newDuration);
  setSetting_("cooldownSeconds",Math.max(0,Math.min(7200,Number(p.cooldownSeconds)||0)));
  if(pb.currentSongId){
    if(String(pb.paused)==="true"){
      const oldRemaining=Math.max(0,Number(pb.remainingSeconds)||oldDuration);
      const elapsed=Math.max(0,oldDuration-oldRemaining);
      setPlayback_({remainingSeconds:String(Math.max(0,newDuration-elapsed))});
    }else if(pb.startedAt){
      const elapsed=Math.max(0,Math.floor((now-new Date(pb.startedAt).getTime())/1000));
      setPlayback_({startedAt:new Date(now-Math.min(elapsed,newDuration)*1000).toISOString()});
    }
  }
}
function setEventMode_(enabled){setSetting_("eventMode",enabled);}
function clearHistory_(){const sh=getSS_().getSheetByName("History"),v=sh.getDataRange().getValues(),headers=v[0].map(String),col=headers.indexOf("cleared");if(col<0)throw new Error("Поле cleared отсутствует. Запустите setupKaraLoki.");if(v.length>1)sh.getRange(2,col+1,v.length-1,1).setValue(true);}
function shuffleQueue_(){const sh=getSS_().getSheetByName("Queue"),rows=getRows_(sh).filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position));const eligible=rows.slice(3);if(eligible.length<2)throw new Error("Нужно минимум две песни после первых трёх.");for(let i=eligible.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[eligible[i],eligible[j]]=[eligible[j],eligible[i]];}rows.forEach((r,i)=>updatePosition_(r.id,i+1));eligible.forEach((r,i)=>updatePosition_(r.id,i+4));}
function reorderQueue_(idsJson){const ids=JSON.parse(idsJson);if(!Array.isArray(ids))throw new Error("Некорректный порядок песен.");const rows=getRows_(getSS_().getSheetByName("Queue")).filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position));const current=rows.map(r=>String(r.id));if(ids.length!==current.length||new Set(ids).size!==current.length||ids.some(id=>!current.includes(String(id)))||current.some(id=>!ids.includes(id)))throw new Error("Список песен изменился. Обновите очередь.");ids.forEach((id,i)=>updatePosition_(id,i+1));}
