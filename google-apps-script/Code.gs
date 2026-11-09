/**
 * KaraLoki v1.2 — Google Apps Script backend.
 * Google Sheets remains the database. setupKaraLoki() creates missing tabs
 * but never clears existing rows. RadioLoki is a shared-name convenience gate,
 * not secure authentication.
 */
const QUEUE_HEADERS = ["id","song","artist","requester","deviceId","status","createdAt","position"];
const PLAYBACK_HEADERS = ["key","value"];
const HISTORY_HEADERS = ["id","song","artist","requester","deviceId","result","playedAt"];
const SONG_SECONDS = 300;
const COOLDOWN_SECONDS = 900;
const OWNER_NAME = "RadioLoki";
const ROOM_TZ = "Europe/Moscow";
const ROOM_CUTOFF_HOUR = 18;

function setupKaraLoki() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("SPREADSHEET_ID")) throw new Error("Set SPREADSHEET_ID in Project Settings > Script properties first.");
  const ss = SpreadsheetApp.openById(props.getProperty("SPREADSHEET_ID"));
  ensureSheet_(ss,"Queue",QUEUE_HEADERS); ensureSheet_(ss,"Playback",PLAYBACK_HEADERS); ensureSheet_(ss,"History",HISTORY_HEADERS);
  const pb = ss.getSheetByName("Playback");
  if (pb.getLastRow() < 2) pb.getRange(2,1,4,2).setValues([["currentSongId",""],["paused","false"],["startedAt",""],["remainingSeconds",String(SONG_SECONDS)]]);
}

function doGet(e) {
  const p=(e&&e.parameter)||{}, cb=String(p.callback||"");
  if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,80}$/.test(cb)) return ContentService.createTextOutput("Invalid callback").setMimeType(ContentService.MimeType.TEXT);
  let result;
  try { result=handle_(p); } catch(err) { result={ok:false,error:String(err&&err.message?err.message:err)}; }
  return ContentService.createTextOutput(cb+"("+JSON.stringify(result)+");").setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function handle_(p) {
  const a=String(p.action||"");
  if (a==="verifyRoom") { if (!validRoomCode_(p.roomPassword)) throw new Error("Неверный или устаревший код комнаты."); return {ok:true}; }
  if (a==="adminCheck") { requireOwnerName_(p.ownerName); return {ok:true}; }
  if (a==="state") {
    const admin=isOwner_(p.ownerName);
    if (!admin && !validRoomCode_(p.roomPassword)) throw new Error("Код комнаты недействителен или истёк. Введите актуальный код комнаты.");
    return {ok:true,state:withLock_(()=>stateWhileLocked_(admin,p.deviceId))};
  }
  if (a==="add") return addSong_(p);
  const adminActions=["skip","pause","resume","move","remove","play","clearQueue"];
  if (adminActions.indexOf(a)>=0) {
    requireOwnerName_(p.ownerName);
    return withLock_(()=>{
      if (a==="skip") advance_("Skipped");
      if (a==="pause") pause_();
      if (a==="resume") resume_();
      if (a==="move") moveQueueItem_(String(p.songId||""),String(p.direction||""));
      if (a==="remove") removeQueueItem_(String(p.songId||""));
      if (a==="play") playSong_(String(p.songId||""));
      if (a==="clearQueue") clearQueue_();
      return {ok:true};
    });
  }
  return {ok:false,error:"Unknown action."};
}

function isOwner_(v) { return String(v||"").trim().toLowerCase()===OWNER_NAME.toLowerCase(); }
function requireOwnerName_(v) { if (!isOwner_(v)) throw new Error("Owner access required."); }
function roomCycleKey_() { return Utilities.formatDate(new Date(Date.now()-ROOM_CUTOFF_HOUR*3600000),ROOM_TZ,"yyyyMMdd"); }
function currentRoomCode_() {
  const props=PropertiesService.getScriptProperties(), cycle=roomCycleKey_();
  const savedCycle=props.getProperty("ROOM_CODE_CYCLE"), savedCode=props.getProperty("ROOM_CODE");
  if (cycle!==savedCycle || !/^\d{4}$/.test(savedCode||"")) {
    const code=String(Math.floor(Math.random()*10000)).padStart(4,"0");
    props.setProperties({ROOM_CODE_CYCLE:cycle,ROOM_CODE:code},false);
    return code;
  }
  return savedCode;
}
function validRoomCode_(v) { return String(v||"").trim()===currentRoomCode_(); }

function addSong_(p) {
  const song=clean_(p.song,140), artist=clean_(p.artist,100), requester=clean_(p.requester,32);
  const deviceId=clean_(p.deviceId,120), admin=isOwner_(p.ownerName);
  if (!song || !requester || !deviceId) throw new Error("Укажите название песни, имя и устройство.");
  if (!admin && !validRoomCode_(p.roomPassword)) throw new Error("Код комнаты недействителен или истёк.");
  return withLock_(()=>{
    const props=PropertiesService.getScriptProperties();
    if (!admin) {
      const last=Number(props.getProperty("COOLDOWN_"+deviceId)||0);
      const remaining=Math.ceil((last+COOLDOWN_SECONDS*1000-Date.now())/1000);
      if (remaining>0) throw new Error("Пожалуйста подождите перед заказом следующей песни: "+formatSeconds_(remaining));
    }
    const sh=getSS_().getSheetByName("Queue"), rows=getRows_(sh);
    if (!admin && rows.some(r=>String(r.deviceId)===deviceId && ["Waiting","Playing"].includes(String(r.status)))) throw new Error("У вас уже есть активный заказ. Дождитесь его исполнения.");
    const id=Utilities.getUuid(), pos=rows.filter(r=>r.status==="Waiting").length+1;
    sh.appendRow([id,song,artist,requester,deviceId,"Waiting",new Date(),pos]);
    if (!admin) props.setProperty("COOLDOWN_"+deviceId,String(Date.now()));
    ensureCurrent_();
    return {ok:true,message:"Песня добавлена в очередь.",cooldownSeconds:admin?0:COOLDOWN_SECONDS};
  });
}
function formatSeconds_(s) { return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); }

function stateWhileLocked_(admin,deviceId) {
  const ss=getSS_(); ensureCurrent_();
  let pb=getPlayback_(), rows=getRows_(ss.getSheetByName("Queue"));
  let current=rows.find(r=>r.id===pb.currentSongId&&r.status==="Playing")||null;
  let remaining=Number(pb.remainingSeconds||SONG_SECONDS);
  if (current && String(pb.paused)!=="true" && pb.startedAt) {
    remaining=Math.max(0,SONG_SECONDS-Math.floor((Date.now()-new Date(pb.startedAt).getTime())/1000));
    if (remaining<=0) {
      advance_("Completed"); pb=getPlayback_(); rows=getRows_(ss.getSheetByName("Queue"));
      current=rows.find(r=>r.id===pb.currentSongId&&r.status==="Playing")||null; remaining=current?SONG_SECONDS:0;
    }
  }
  const queue=rows.filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position)).map(publicSong_);
  const historyRows=getRows_(ss.getSheetByName("History"));
  const history=[];
  for (let i=historyRows.length-1;i>=0 && history.length<60;i--) {
    const h=historyRows[i];
    if (!["Completed","Skipped","Interrupted"].includes(h.result)) continue;
    const q=rows.find(r=>r.id===h.id);
    if (q && ["Completed","Skipped","Interrupted"].includes(q.status) && !history.some(x=>x.id===h.id)) history.push({...publicSong_(q),result:h.result,playedAt:h.playedAt});
  }
  const last=admin?0:Number(PropertiesService.getScriptProperties().getProperty("COOLDOWN_"+String(deviceId||""))||0);
  const cooldownRemaining=admin?0:Math.max(0,Math.ceil((last+COOLDOWN_SECONDS*1000-Date.now())/1000));
  const out={current:current?publicSong_(current):null,queue,history,paused:String(pb.paused)==="true",remainingSeconds:current?remaining:null,cooldownRemaining};
  if (admin) out.roomCode=currentRoomCode_();
  return out;
}
function publicSong_(r) { return {id:r.id,song:r.song,artist:r.artist,requester:r.requester}; }

function ensureCurrent_() {
  const pb=getPlayback_(), rows=getRows_(getSS_().getSheetByName("Queue"));
  if (pb.currentSongId && rows.some(r=>r.id===pb.currentSongId&&r.status==="Playing")) return;
  const next=rows.filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position))[0];
  if (next) { updateQueueStatus_(next.id,"Playing"); setPlayback_({currentSongId:next.id,paused:"false",startedAt:new Date().toISOString(),remainingSeconds:String(SONG_SECONDS)}); }
  else setPlayback_({currentSongId:"",paused:"false",startedAt:"",remainingSeconds:String(SONG_SECONDS)});
}
function advance_(result) {
  const pb=getPlayback_();
  if (pb.currentSongId) {
    const cur=getRows_(getSS_().getSheetByName("Queue")).find(r=>r.id===pb.currentSongId&&r.status==="Playing");
    if (cur) { appendHistory_(cur,result); updateQueueStatus_(cur.id,result); }
  }
  setPlayback_({currentSongId:"",paused:"false",startedAt:"",remainingSeconds:String(SONG_SECONDS)});
  ensureCurrent_(); renumberQueue_();
}
function playSong_(id) {
  const ss=getSS_(), sh=ss.getSheetByName("Queue"), rows=getRows_(sh);
  const target=rows.find(r=>r.id===id && ["Waiting","Completed","Skipped","Interrupted"].includes(r.status));
  if (!target) throw new Error("Эта песня больше недоступна для запуска.");
  const pb=getPlayback_();
  if (pb.currentSongId===id && target.status==="Playing") return;
  if (pb.currentSongId) {
    const cur=rows.find(r=>r.id===pb.currentSongId&&r.status==="Playing");
    if (cur) { appendHistory_(cur,"Interrupted"); updateQueueStatus_(cur.id,"Interrupted"); }
  }
  if (["Completed","Skipped","Interrupted"].includes(target.status)) setLatestHistoryResult_(id,"Replayed");
  updateQueueStatus_(id,"Playing");
  setPlayback_({currentSongId:id,paused:"false",startedAt:new Date().toISOString(),remainingSeconds:String(SONG_SECONDS)});
  renumberQueue_();
}
function clearQueue_() {
  const sh=getSS_().getSheetByName("Queue");
  getRows_(sh).filter(r=>r.status==="Waiting").forEach(r=>updateQueueStatus_(r.id,"Cleared"));
  renumberQueue_();
}
function pause_() {
  const pb=getPlayback_(); if (!pb.currentSongId||String(pb.paused)==="true") return;
  const remaining=Math.max(0,SONG_SECONDS-Math.floor((Date.now()-new Date(pb.startedAt).getTime())/1000));
  setPlayback_({paused:"true",remainingSeconds:String(remaining)});
}
function resume_() {
  const pb=getPlayback_(); if (!pb.currentSongId||String(pb.paused)!=="true") return;
  const remaining=Number(pb.remainingSeconds||SONG_SECONDS);
  setPlayback_({paused:"false",startedAt:new Date(Date.now()-(SONG_SECONDS-remaining)*1000).toISOString()});
}
function moveQueueItem_(id,direction) {
  const rows=getRows_(getSS_().getSheetByName("Queue")).filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position));
  const i=rows.findIndex(r=>r.id===id), j=direction==="up"?i-1:direction==="down"?i+1:-1;
  if (i<0) throw new Error("Песня уже не находится в очереди.");
  if (j<0||j>=rows.length) return;
  const a=rows[i],b=rows[j]; updatePosition_(a.id,Number(b.position)); updatePosition_(b.id,Number(a.position));
}
function removeQueueItem_(id) {
  const row=getRows_(getSS_().getSheetByName("Queue")).find(r=>r.id===id&&r.status==="Waiting");
  if (!row) throw new Error("Песня уже не находится в очереди.");
  appendHistory_(row,"Removed"); updateQueueStatus_(id,"Removed"); renumberQueue_();
}
function appendHistory_(r,result) { getSS_().getSheetByName("History").appendRow([r.id,r.song,r.artist,r.requester,r.deviceId,result,new Date()]); }
function setLatestHistoryResult_(id,result) {
  const sh=getSS_().getSheetByName("History"), v=sh.getDataRange().getValues();
  for (let i=v.length-1;i>=1;i--) if (String(v[i][0])===id) { sh.getRange(i+1,6).setValue(result); return; }
}
function updatePosition_(id,pos) {
  const sh=getSS_().getSheetByName("Queue"),v=sh.getDataRange().getValues();
  for(let i=1;i<v.length;i++) if(String(v[i][0])===id){sh.getRange(i+1,8).setValue(pos);return;}
}
function updateQueueStatus_(id,status) {
  const sh=getSS_().getSheetByName("Queue"),v=sh.getDataRange().getValues();
  for(let i=1;i<v.length;i++) if(String(v[i][0])===id){sh.getRange(i+1,6).setValue(status);return;}
}
function renumberQueue_() {
  const rows=getRows_(getSS_().getSheetByName("Queue")).filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position));
  rows.forEach((r,i)=>updatePosition_(r.id,i+1));
}
function getPlayback_() {
  const v=getSS_().getSheetByName("Playback").getDataRange().getValues(),o={};
  for(let i=1;i<v.length;i++) o[String(v[i][0])]=String(v[i][1]);
  return o;
}
function setPlayback_(changes) {
  const sh=getSS_().getSheetByName("Playback"),v=sh.getDataRange().getValues();
  Object.keys(changes).forEach(k=>{
    let found=false;
    for(let i=1;i<v.length;i++) if(String(v[i][0])===k){sh.getRange(i+1,2).setValue(changes[k]);found=true;break;}
    if(!found) sh.appendRow([k,changes[k]]);
  });
}
function getRows_(sh) {
  const v=sh.getDataRange().getValues(); if(v.length<2)return [];
  const headers=v[0].map(String);
  return v.slice(1).filter(row=>row.some(x=>x!=="")).map(row=>{
    const o={};headers.forEach((h,i)=>o[h]=row[i] instanceof Date?row[i].toISOString():String(row[i]==null?"":row[i]));return o;
  });
}
function ensureSheet_(ss,name,headers) {
  let sh=ss.getSheetByName(name); if(!sh)sh=ss.insertSheet(name);
  if(sh.getLastRow()===0)sh.appendRow(headers);
}
function getSS_() {
  const id=PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if(!id)throw new Error("Missing SPREADSHEET_ID script property.");
  return SpreadsheetApp.openById(id);
}
function withLock_(fn) {
  const lock=LockService.getScriptLock();lock.waitLock(20000);
  try{return fn();}finally{lock.releaseLock();}
}
function clean_(v,max) { return String(v||"").replace(/[<>]/g,"").trim().slice(0,max); }
