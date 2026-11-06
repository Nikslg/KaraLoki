/**
 * KaraLoki v1.1 backend (Google Apps Script).
 * Uses a shared owner name (RadioLoki) as requested by the project owner.
 * IMPORTANT: this is a convenience gate, not secure authentication. Anyone
 * who knows the name can invoke administrative actions through the public API.
 */
const QUEUE_HEADERS = ["id", "song", "artist", "requester", "deviceId", "status", "createdAt", "position"];
const PLAYBACK_HEADERS = ["key", "value"];
const HISTORY_HEADERS = ["id", "song", "artist", "requester", "deviceId", "result", "playedAt"];
const SONG_SECONDS = 300;
const OWNER_NAME = "RadioLoki";

function setupKaraLoki() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("SPREADSHEET_ID")) throw new Error("Set SPREADSHEET_ID in Project Settings > Script properties first.");
  const ss = SpreadsheetApp.openById(props.getProperty("SPREADSHEET_ID"));
  ensureSheet_(ss, "Queue", QUEUE_HEADERS);
  ensureSheet_(ss, "Playback", PLAYBACK_HEADERS);
  ensureSheet_(ss, "History", HISTORY_HEADERS);
  const playback = ss.getSheetByName("Playback");
  if (playback.getLastRow() < 2) playback.getRange(2, 1, 4, 2).setValues([["currentSongId", ""], ["paused", "false"], ["startedAt", ""], ["remainingSeconds", String(SONG_SECONDS)]]);
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const callback = String(p.callback || "");
  if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,80}$/.test(callback)) return ContentService.createTextOutput("Invalid callback").setMimeType(ContentService.MimeType.TEXT);
  let result;
  try { result = handle_(p); }
  catch (err) { result = { ok: false, error: String(err && err.message ? err.message : err) }; }
  return ContentService.createTextOutput(callback + "(" + JSON.stringify(result) + ");").setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function handle_(p) {
  const action = String(p.action || "");
  if (action === "state") return { ok: true, state: getState_() };
  if (action === "add") return addSong_(p);
  if (action === "adminCheck") { requireOwnerName_(p.ownerName); return { ok: true }; }
  if (["skip", "back", "pause", "resume", "move", "remove"].includes(action)) {
    requireOwnerName_(p.ownerName);
    return withLock_(() => {
      if (action === "skip") advance_("Skipped");
      if (action === "back") back_();
      if (action === "pause") pause_();
      if (action === "resume") resume_();
      if (action === "move") moveQueueItem_(String(p.songId || ""), String(p.direction || ""));
      if (action === "remove") removeQueueItem_(String(p.songId || ""));
      return { ok: true };
    });
  }
  return { ok: false, error: "Unknown action." };
}

function requireOwnerName_(value) {
  if (String(value || "").trim().toLowerCase() !== OWNER_NAME.toLowerCase()) throw new Error("Owner access required.");
}

function addSong_(p) {
  const song = clean_(p.song, 140), artist = clean_(p.artist, 100), requester = clean_(p.requester, 32), deviceId = clean_(p.deviceId, 100);
  if (!song || !artist || !requester || !deviceId) return { ok: false, error: "Please provide song, artist and requester name." };
  if (requester.toLowerCase() === OWNER_NAME.toLowerCase()) return { ok: false, error: OWNER_NAME + " is reserved for the host. Use your guest name to request songs." };
  return withLock_(() => {
    const sh = getSS_().getSheetByName("Queue"), rows = getRows_(sh);
    if (rows.some(r => String(r.deviceId) === deviceId && ["Waiting", "Playing"].includes(String(r.status)))) return { ok: false, error: "This device already has an active request. Wait until it is played or removed." };
    const id = Utilities.getUuid(), nextPosition = rows.filter(r => r.status === "Waiting").length + 1;
    sh.appendRow([id, song, artist, requester, deviceId, "Waiting", new Date(), nextPosition]);
    ensureCurrent_(); return { ok: true, message: "Your song has been added to the queue." };
  });
}

function getState_() { return withLock_(() => stateWhileLocked_()); }
function stateWhileLocked_() {
  const ss = getSS_(); ensureCurrent_();
  let playback = getPlayback_(), rows = getRows_(ss.getSheetByName("Queue"));
  let current = rows.find(r => r.id === playback.currentSongId && r.status === "Playing") || null;
  let remaining = Number(playback.remainingSeconds || SONG_SECONDS);
  if (current && String(playback.paused) !== "true" && playback.startedAt) {
    remaining = Math.max(0, SONG_SECONDS - Math.floor((Date.now() - new Date(playback.startedAt).getTime()) / 1000));
    if (remaining <= 0) {
      advance_("Completed"); playback = getPlayback_(); rows = getRows_(ss.getSheetByName("Queue"));
      current = rows.find(r => r.id === playback.currentSongId && r.status === "Playing") || null; remaining = current ? SONG_SECONDS : 0;
    }
  }
  const queue = rows.filter(r => r.status === "Waiting").sort((a,b) => Number(a.position)-Number(b.position)).map(r => ({ id:r.id, song:r.song, artist:r.artist, requester:r.requester }));
  const canGoBack = getRows_(ss.getSheetByName("History")).some(r => ["Completed", "Skipped"].includes(r.result) && rows.some(q => q.id === r.id && q.status === r.result));
  return { current: current ? { id:current.id, song:current.song, artist:current.artist, requester:current.requester } : null, queue, paused:String(playback.paused)==="true", remainingSeconds:current ? remaining : null, canGoBack };
}

function ensureCurrent_() {
  const pb = getPlayback_();
  if (pb.currentSongId && getRows_(getSS_().getSheetByName("Queue")).some(r => r.id === pb.currentSongId && r.status === "Playing")) return;
  const next = getRows_(getSS_().getSheetByName("Queue")).filter(r => r.status === "Waiting").sort((a,b) => Number(a.position)-Number(b.position))[0];
  if (next) { updateQueueStatus_(next.id, "Playing"); setPlayback_({ currentSongId:next.id, paused:"false", startedAt:new Date().toISOString(), remainingSeconds:String(SONG_SECONDS) }); }
  else setPlayback_({ currentSongId:"", paused:"false", startedAt:"", remainingSeconds:String(SONG_SECONDS) });
}

function advance_(result) {
  const pb = getPlayback_();
  if (pb.currentSongId) {
    const current = getRows_(getSS_().getSheetByName("Queue")).find(r => r.id === pb.currentSongId);
    if (current) { getSS_().getSheetByName("History").appendRow([current.id,current.song,current.artist,current.requester,current.deviceId,result,new Date()]); updateQueueStatus_(current.id,result); }
  }
  setPlayback_({ currentSongId:"", paused:"false", startedAt:"", remainingSeconds:String(SONG_SECONDS) }); ensureCurrent_(); renumberQueue_();
}

// Restore the latest previously completed/skipped song. The song playing now
// is returned to the end of the waiting queue; history is retained for audit.
function back_() {
  const ss = getSS_(), history = ss.getSheetByName("History"), historyRows = getRows_(history), queueRows = getRows_(ss.getSheetByName("Queue"));
  let target = null;
  for (let i = historyRows.length - 1; i >= 0; i--) {
    const h = historyRows[i];
    if (["Completed", "Skipped"].includes(h.result)) {
      const q = queueRows.find(r => r.id === h.id && r.status === h.result);
      if (q) { target = { row:h, queue:q }; break; }
    }
  }
  if (!target) throw new Error("There is no previously played song to go back to.");
  const pb = getPlayback_();
  if (pb.currentSongId) {
    const current = queueRows.find(r => r.id === pb.currentSongId && r.status === "Playing");
    if (current) {
      const waiting = queueRows.filter(r => r.status === "Waiting");
      updatePosition_(current.id, waiting.length + 1);
      ss.getSheetByName("History").appendRow([current.id,current.song,current.artist,current.requester,current.deviceId,"Returned to queue",new Date()]);
      updateQueueStatus_(current.id,"Waiting");
    }
  }
  updateQueueStatus_(target.queue.id,"Playing");
  setHistoryResult_(target.row.id,target.row.playedAt,"Replayed");
  setPlayback_({ currentSongId:target.queue.id, paused:"false", startedAt:new Date().toISOString(), remainingSeconds:String(SONG_SECONDS) });
  renumberQueue_();
}

function pause_() {
  const pb=getPlayback_(); if (!pb.currentSongId || String(pb.paused)==="true") return;
  const remaining=Math.max(0,SONG_SECONDS-Math.floor((Date.now()-new Date(pb.startedAt).getTime())/1000));
  setPlayback_({ paused:"true", remainingSeconds:String(remaining) });
}
function resume_() {
  const pb=getPlayback_(); if (!pb.currentSongId || String(pb.paused)!=="true") return;
  const remaining=Number(pb.remainingSeconds || SONG_SECONDS);
  setPlayback_({ paused:"false", startedAt:new Date(Date.now()-(SONG_SECONDS-remaining)*1000).toISOString() });
}
function moveQueueItem_(id,direction) {
  const rows=getRows_(getSS_().getSheetByName("Queue")).filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position));
  const index=rows.findIndex(r=>r.id===id); if(index<0) throw new Error("That song is no longer in the waiting queue.");
  const otherIndex=direction==="up"?index-1:direction==="down"?index+1:-1;
  if(otherIndex<0 || otherIndex>=rows.length) return;
  const a=rows[index], b=rows[otherIndex]; updatePosition_(a.id,Number(b.position)); updatePosition_(b.id,Number(a.position));
}
function removeQueueItem_(id) {
  const sh=getSS_().getSheetByName("Queue"), row=getRows_(sh).find(r=>r.id===id && r.status==="Waiting");
  if(!row) throw new Error("That song is no longer in the waiting queue.");
  ssHistoryAppend_(row,"Removed"); updateQueueStatus_(id,"Removed"); renumberQueue_();
}
function ssHistoryAppend_(row,result) { getSS_().getSheetByName("History").appendRow([row.id,row.song,row.artist,row.requester,row.deviceId,result,new Date()]); }
function setHistoryResult_(id,playedAt,result) {
  const sh=getSS_().getSheetByName("History"), values=sh.getDataRange().getValues();
  for(let i=values.length-1;i>=1;i--) if(String(values[i][0])===id && values[i][6] instanceof Date && values[i][6].toISOString()===String(playedAt)) { sh.getRange(i+1,6).setValue(result); return; }
}
function updatePosition_(id,position) {
  const sh=getSS_().getSheetByName("Queue"), values=sh.getDataRange().getValues();
  for(let i=1;i<values.length;i++) if(String(values[i][0])===id) { sh.getRange(i+1,8).setValue(position); return; }
}
function updateQueueStatus_(id,status) {
  const sh=getSS_().getSheetByName("Queue"), values=sh.getDataRange().getValues();
  for(let i=1;i<values.length;i++) if(String(values[i][0])===id) { sh.getRange(i+1,6).setValue(status); return; }
}
function renumberQueue_() {
  const sh=getSS_().getSheetByName("Queue"), rows=getRows_(sh).filter(r=>r.status==="Waiting").sort((a,b)=>Number(a.position)-Number(b.position));
  rows.forEach((r,i)=>updatePosition_(r.id,i+1));
}
function getPlayback_() { const values=getSS_().getSheetByName("Playback").getDataRange().getValues(), obj={}; for(let i=1;i<values.length;i++) obj[String(values[i][0])]=String(values[i][1]); return obj; }
function setPlayback_(changes) {
  const sh=getSS_().getSheetByName("Playback"), values=sh.getDataRange().getValues();
  Object.keys(changes).forEach(key=>{ let found=false; for(let i=1;i<values.length;i++) if(String(values[i][0])===key) { sh.getRange(i+1,2).setValue(changes[key]); found=true; break; } if(!found) sh.appendRow([key,changes[key]]); });
}
function getRows_(sh) {
  const values=sh.getDataRange().getValues(); if(values.length<2) return [];
  const headers=values[0].map(String);
  return values.slice(1).filter(row=>row.some(v=>v!=="")).map(row=>{ const o={}; headers.forEach((h,i)=>o[h]=row[i] instanceof Date?row[i].toISOString():String(row[i]==null?"":row[i])); return o; });
}
function ensureSheet_(ss,name,headers) { let sh=ss.getSheetByName(name); if(!sh) sh=ss.insertSheet(name); if(sh.getLastRow()===0) sh.appendRow(headers); }
function getSS_() { const id=PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID"); if(!id) throw new Error("Missing SPREADSHEET_ID script property."); return SpreadsheetApp.openById(id); }
function withLock_(fn) { const lock=LockService.getScriptLock(); lock.waitLock(20000); try{return fn();}finally{lock.releaseLock();} }
function clean_(value,max) { return String(value||"").replace(/[<>]/g,"").trim().slice(0,max); }
