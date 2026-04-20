const COLORS = [
  '#ff00ff','#00ffff','#ffff00','#ff6600',
  '#00ff88','#ff0088','#88ff00','#4488ff',
  '#ff8800','#aa00ff','#00ffcc','#ffcc00'
];

let trips     = [];
let map;
let mapLayers = [];

// ── room state ───────────────────────────────────────────────────
let roomId       = null;
let roomKey      = null;
let syncTimer    = null;
let countTimer   = null;
let lastSynced   = null;
let isSyncing    = false;

// ── local storage ────────────────────────────────────────────────
function loadLocal() {
  try { trips = JSON.parse(localStorage.getItem('ft3k_trips') || '[]'); }
  catch { trips = []; }
}
function saveLocal() {
  localStorage.setItem('ft3k_trips', JSON.stringify(trips));
}

// ── room storage ─────────────────────────────────────────────────
function saveRoomMeta() {
  if (roomId && roomKey)
    localStorage.setItem('ft3k_room', JSON.stringify({ id: roomId, key: roomKey }));
  else
    localStorage.removeItem('ft3k_room');
}
function loadRoomMeta() {
  try {
    const r = JSON.parse(localStorage.getItem('ft3k_room') || 'null');
    if (r?.id && r?.key) { roomId = r.id; roomKey = r.key; return true; }
  } catch {}
  return false;
}

// ── room code ────────────────────────────────────────────────────
function makeRoomCode(id, key) {
  return btoa(JSON.stringify({ i: id, k: key }));
}
function parseRoomCode(code) {
  try {
    const { i, k } = JSON.parse(atob(code.trim()));
    if (i && k) return { id: i, key: k };
  } catch {}
  return null;
}

// ── jsonbin api ──────────────────────────────────────────────────
const BIN_BASE = 'https://api.jsonbin.io/v3/b';

async function apiFetch() {
  try {
    const r = await fetch(`${BIN_BASE}/${roomId}/latest`, {
      headers: { 'X-Master-Key': roomKey }
    });
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d.record?.trips) ? d.record.trips : [];
  } catch { return null; }
}

async function apiPush(data) {
  try {
    const r = await fetch(`${BIN_BASE}/${roomId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Master-Key': roomKey },
      body: JSON.stringify({ trips: data })
    });
    return r.ok;
  } catch { return false; }
}

async function apiCreate(key, initial) {
  try {
    const r = await fetch(BIN_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': key,
        'X-Bin-Name': 'slink-io-adulting',
        'X-Bin-Private': 'true'
      },
      body: JSON.stringify({ trips: initial })
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.metadata?.id || null;
  } catch { return null; }
}

// ── sync helpers ─────────────────────────────────────────────────
function setSyncStatus(html) {
  const el = document.getElementById('syncStatus');
  if (el) el.innerHTML = html;
}

// Read from cloud → merge via mutateFn → write back.
// mutateFn receives and mutates the array in-place.
async function cloudMergeWrite(mutateFn) {
  if (!roomId) {
    mutateFn(trips);
    saveLocal();
    renderAll();
    return;
  }

  isSyncing = true;
  setSyncStatus('<span class="spin"></span> saving...');

  const cloud = await apiFetch();
  if (cloud !== null) {
    mutateFn(cloud);
    trips = cloud;
  } else {
    mutateFn(trips);
  }

  saveLocal();
  const ok = await apiPush(trips);
  isSyncing = false;

  if (ok) {
    lastSynced = Date.now();
    setSyncStatus('🟢 synced just now');
    startCountdown();
  } else {
    setSyncStatus('🔴 sync failed (saved locally)');
  }
  renderAll();
}

async function syncFromCloud() {
  if (!roomId || isSyncing) return;
  isSyncing = true;
  setSyncStatus('<span class="spin"></span> syncing...');

  const cloud = await apiFetch();
  isSyncing = false;

  if (cloud !== null) {
    trips = cloud;
    saveLocal();
    lastSynced = Date.now();
    setSyncStatus('🟢 synced just now');
    startCountdown();
    renderAll();
  } else {
    setSyncStatus('🔴 sync failed');
  }
}

// ── polling ──────────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  syncTimer = setInterval(syncFromCloud, 30000);
}
function stopPolling() {
  clearInterval(syncTimer);
  clearInterval(countTimer);
  syncTimer = countTimer = null;
}
function startCountdown() {
  clearInterval(countTimer);
  countTimer = setInterval(() => {
    if (!lastSynced) return;
    const s = Math.round((Date.now() - lastSynced) / 1000);
    setSyncStatus(s < 60 ? `🟢 synced ${s}s ago` : `🟢 synced ${Math.round(s/60)}m ago`);
  }, 5000);
}

// ── create / join / leave ────────────────────────────────────────
async function createRoom() {
  const key = document.getElementById('apiKeyInput')?.value.trim();
  if (!key) { setRoomMsg('<span style="color:#ff4444">⚠ enter ur api key first</span>'); return; }

  setRoomMsg('<span class="spin"></span> creating room...');
  document.getElementById('createRoomBtn').disabled = true;

  const binId = await apiCreate(key, trips);
  document.getElementById('createRoomBtn').disabled = false;

  if (!binId) {
    setRoomMsg('<span style="color:#ff4444">⚠ failed — double-check ur api key</span>');
    return;
  }

  roomId = binId; roomKey = key;
  saveRoomMeta();
  renderRoomPanel();
  startPolling();
  lastSynced = Date.now();
  setSyncStatus('🟢 room created!');
  startCountdown();
}

async function joinRoom() {
  const code   = document.getElementById('roomCodeInput')?.value.trim();
  const parsed = parseRoomCode(code || '');
  if (!parsed) { setRoomMsg('<span style="color:#ff4444">⚠ invalid room code!!</span>'); return; }

  setRoomMsg('<span class="spin"></span> joining...');
  document.getElementById('joinRoomBtn').disabled = true;

  roomId = parsed.id; roomKey = parsed.key;
  const cloud = await apiFetch();
  document.getElementById('joinRoomBtn').disabled = false;

  if (cloud === null) {
    roomId = roomKey = null;
    setRoomMsg('<span style="color:#ff4444">⚠ could not connect — bad code?</span>');
    return;
  }

  trips = cloud;
  saveLocal();
  saveRoomMeta();
  renderRoomPanel();
  renderAll();
  startPolling();
  lastSynced = Date.now();
  setSyncStatus('🟢 joined!');
  startCountdown();
}

function leaveRoom() {
  if (!confirm('leave this room? ur local trips stay.')) return;
  stopPolling();
  roomId = roomKey = null;
  saveRoomMeta();
  renderRoomPanel();
}

function copyRoomCode() {
  navigator.clipboard.writeText(makeRoomCode(roomId, roomKey)).then(() => {
    setSyncStatus('📋 copied!');
    setTimeout(() => setSyncStatus('🟢 synced'), 2000);
  });
}

// ── room panel UI ────────────────────────────────────────────────
function setRoomMsg(html) {
  const el = document.getElementById('roomMsg');
  if (el) el.innerHTML = html;
}

function showRoomTab(tab) {
  document.getElementById('createTabContent').style.display = tab === 'create' ? '' : 'none';
  document.getElementById('joinTabContent').style.display   = tab === 'join'   ? '' : 'none';
  document.getElementById('tabCreate').className = 'tab-btn' + (tab === 'create' ? ' tab-active' : '');
  document.getElementById('tabJoin').className   = 'tab-btn' + (tab === 'join'   ? ' tab-active' : '');
}

function renderRoomPanel() {
  const body = document.getElementById('roomBody');
  if (!body) return;

  if (roomId) {
    const code = makeRoomCode(roomId, roomKey);
    body.innerHTML = `
      <div id="syncStatus" style="font-size:11px;margin-bottom:8px;color:#88ff00">🟢 connected</div>
      <label>room code — share with friends:</label>
      <div style="
        background:#000022;border:2px solid #ffff00;padding:5px 8px;
        font-family:'Courier New',monospace;font-size:10px;color:#ffff00;
        word-break:break-all;margin:4px 0 8px;
      ">${esc(code)}</div>
      <button class="btn" style="margin-top:0;font-size:11px;padding:4px 12px" onclick="copyRoomCode()">📋 copy code</button>
      <button class="btn-sm" style="margin-left:8px" onclick="leaveRoom()">leave room</button>
    `;
  } else {
    body.innerHTML = `
      <div style="font-size:11px;color:#666;margin-bottom:8px">sync trips w ur friends in real-time!!</div>
      <div style="display:flex;margin-bottom:10px">
        <button id="tabCreate" class="tab-btn tab-active" onclick="showRoomTab('create')">create room</button>
        <button id="tabJoin"   class="tab-btn"            onclick="showRoomTab('join')">join room</button>
      </div>
      <div id="createTabContent">
        <div style="font-size:10px;color:#555;margin-bottom:5px">
          free key at <a href="https://jsonbin.io" target="_blank" style="color:#4488ff">jsonbin.io</a> → sign up → api keys
        </div>
        <label>master key:</label>
        <input type="password" id="apiKeyInput" placeholder="$2b$10$..." autocomplete="off">
        <button class="btn" id="createRoomBtn" onclick="createRoom()" style="font-size:11px;padding:4px 12px;margin-top:6px">★ create room ★</button>
      </div>
      <div id="joinTabContent" style="display:none">
        <label>room code:</label>
        <input type="text" id="roomCodeInput" placeholder="paste code here" autocomplete="off">
        <button class="btn" id="joinRoomBtn" onclick="joinRoom()" style="font-size:11px;padding:4px 12px;margin-top:6px">★ join room ★</button>
      </div>
      <div id="roomMsg" style="font-size:11px;min-height:16px;margin-top:6px"></div>
    `;
  }
}

// ── color assignment ─────────────────────────────────────────────
function personColor(name) {
  const names = [...new Set(trips.map(t => t.name))].sort();
  return COLORS[names.indexOf(name) % COLORS.length] || COLORS[0];
}

// ── map init ─────────────────────────────────────────────────────
function initMap() {
  map = L.map('mapContainer', { center: [25, 15], zoom: 2 });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);
}

// ── geocoding ────────────────────────────────────────────────────
async function geocode(city) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1&accept-language=en`;
  try {
    const r = await fetch(url);
    const d = await r.json();
    if (d?.length > 0) return {
      lat: parseFloat(d[0].lat),
      lng: parseFloat(d[0].lon),
      label: d[0].display_name.split(',').slice(0,2).join(',').trim()
    };
  } catch {}
  return null;
}

// ── add trip ──────────────────────────────────────────────────────
async function addTrip() {
  const name  = document.getElementById('personName').value.trim();
  const city  = document.getElementById('cityName').value.trim();
  const start = document.getElementById('startDate').value;
  const end   = document.getElementById('endDate').value;
  const msg   = document.getElementById('statusMsg');
  const btn   = document.getElementById('addBtn');

  if (!name || !city || !start || !end) {
    msg.innerHTML = '<span style="color:#ff4444">⚠ fill in all fields first!!</span>'; return;
  }
  if (start > end) {
    msg.innerHTML = '<span style="color:#ff4444">⚠ end date must be after start date!!</span>'; return;
  }

  msg.innerHTML = '<span class="spin"></span> geocoding ur location...';
  btn.disabled = true;

  const geo = await geocode(city);
  btn.disabled = false;

  if (!geo) {
    msg.innerHTML = '<span style="color:#ff4444">⚠ city not found!! try being more specific</span>'; return;
  }

  const newTrip = {
    id: Date.now(), name, city,
    label: geo.label, lat: geo.lat, lng: geo.lng,
    startDate: start, endDate: end
  };

  msg.innerHTML = '<span class="spin"></span> saving...';

  await cloudMergeWrite(arr => {
    if (!arr.find(t => t.id === newTrip.id)) arr.push(newTrip);
  });

  msg.innerHTML = `<span style="color:#88ff00">✓ added ${esc(name)} in ${esc(city)}!! ⭐</span>`;
  document.getElementById('personName').value = '';
  document.getElementById('cityName').value   = '';
  document.getElementById('startDate').value  = '';
  document.getElementById('endDate').value    = '';
  setTimeout(() => { msg.textContent = ''; }, 3500);
}

// ── helpers ───────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(d) {
  if (!d) return '';
  const [y,m,day] = d.split('-');
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1] + ' ' + +day + ', ' + y;
}
function datesOverlap(a,b) { return a.startDate <= b.endDate && b.startDate <= a.endDate; }
function kmBetween(la1,lo1,la2,lo2) {
  const R=6371, r=Math.PI/180;
  const dLa=(la2-la1)*r, dLo=(lo2-lo1)*r;
  const x=Math.sin(dLa/2)**2+Math.cos(la1*r)*Math.cos(la2*r)*Math.sin(dLo/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function findOverlaps() {
  const out=[];
  for (let i=0;i<trips.length;i++) for (let j=i+1;j<trips.length;j++) {
    const a=trips[i],b=trips[j];
    if (a.name.toLowerCase()===b.name.toLowerCase()) continue;
    if (kmBetween(a.lat,a.lng,b.lat,b.lng)<100 && datesOverlap(a,b))
      out.push({ a, b,
        overlapStart: a.startDate>b.startDate?a.startDate:b.startDate,
        overlapEnd:   a.endDate  <b.endDate  ?a.endDate  :b.endDate });
  }
  return out;
}

// ── render map ────────────────────────────────────────────────────
function renderMap() {
  mapLayers.forEach(l=>map.removeLayer(l));
  mapLayers=[];
  if (!trips.length) return;

  const buckets={};
  trips.forEach(t=>{
    const k=`${(t.lat/0.5).toFixed(0)},${(t.lng/0.5).toFixed(0)}`;
    (buckets[k]=buckets[k]||[]).push(t);
  });

  Object.values(buckets).forEach(group=>{
    const lat=group.reduce((s,t)=>s+t.lat,0)/group.length;
    const lng=group.reduce((s,t)=>s+t.lng,0)/group.length;
    const people=[...new Set(group.map(t=>t.name))];
    const multi=people.length>1;
    const bgColors=people.map(n=>personColor(n));
    const bg=bgColors.length>1?`linear-gradient(135deg,${bgColors.join(',')})`:bgColors[0];

    const icon=L.divIcon({
      html:`<div style="
        background:${bg};color:#000;padding:3px 8px;
        border:${multi?'3px':'2px'} solid ${multi?'#ffff00':'#000'};
        font-family:'Comic Sans MS',cursive;font-size:11px;font-weight:bold;
        white-space:nowrap;border-radius:3px;
        box-shadow:${multi?'0 0 10px #ffff00':'2px 2px 0 rgba(0,0,0,.5)'}
      ">${multi?'⭐ ':'★ '}${people.map(esc).join(' & ')}</div>`,
      className:'', iconAnchor:[0,20]
    });

    const rows=group.map(t=>
      `<b style="color:${personColor(t.name)}">${esc(t.name)}</b><br>
       ${esc(t.label||t.city)}<br>
       ${fmtDate(t.startDate)} - ${fmtDate(t.endDate)}`
    ).join('<hr style="border-color:#333;margin:5px 0">');

    mapLayers.push(
      L.marker([lat,lng],{icon}).addTo(map)
       .bindPopup(`<div style="font-family:'Comic Sans MS',cursive;font-size:12px;min-width:170px">${rows}</div>`)
    );
  });

  findOverlaps().forEach(ov=>{
    mapLayers.push(L.circle(
      [(ov.a.lat+ov.b.lat)/2,(ov.a.lng+ov.b.lng)/2],
      {color:'#ffff00',fillColor:'#ffff00',fillOpacity:.07,radius:80000,weight:2,dashArray:'8 4'}
    ).addTo(map));
  });

  map.fitBounds(L.latLngBounds(trips.map(t=>[t.lat,t.lng])),{padding:[60,60],maxZoom:8});
}

// ── render trip list ──────────────────────────────────────────────
function renderTripList() {
  const tbody=document.getElementById('tripList');
  if (!trips.length) {
    tbody.innerHTML='<tr><td colspan="5" class="empty-msg" style="padding:10px">no trips yet!</td></tr>';
    return;
  }
  tbody.innerHTML=trips.map(t=>`<tr>
    <td style="color:${personColor(t.name)};font-weight:bold">${esc(t.name)}</td>
    <td style="color:#99aacc">${esc(t.city)}</td>
    <td style="color:#7799cc;font-size:10px">${fmtDate(t.startDate)}</td>
    <td style="color:#7799cc;font-size:10px">${fmtDate(t.endDate)}</td>
    <td><a class="del-btn" href="#" onclick="del(${t.id});return false;">✕</a></td>
  </tr>`).join('');
}

// ── render overlaps ───────────────────────────────────────────────
function renderOverlapsList() {
  const div=document.getElementById('overlapsList');
  const ovs=findOverlaps();
  if (!ovs.length) {
    div.innerHTML='<p class="empty-msg">no overlaps yet... get ur friends to add their trips!! ✨</p>';
    return;
  }
  const today=new Date().toISOString().slice(0,10);
  div.innerHTML=ovs.map(ov=>{
    const isNow=today>=ov.overlapStart&&today<=ov.overlapEnd;
    return `<div class="overlap-item">
      ${isNow?'<span class="now-badge">NOW!</span>':''}
      <span style="color:${personColor(ov.a.name)};font-weight:bold">★ ${esc(ov.a.name)}</span>
      <span style="color:#777"> and </span>
      <span style="color:${personColor(ov.b.name)};font-weight:bold">★ ${esc(ov.b.name)}</span>
      <span style="color:#888"> are both in </span>
      <span style="color:#ffff00;font-weight:bold">${esc(ov.a.city)}</span>
      <span style="color:#888"> from </span>
      <span style="color:#88ff88">${fmtDate(ov.overlapStart)}</span>
      <span style="color:#888"> → </span>
      <span style="color:#88ff88">${fmtDate(ov.overlapEnd)}</span>
      <span style="color:#ff88ff"> 🎉</span>
    </div>`;
  }).join('');
}

// ── delete / clear ────────────────────────────────────────────────
async function del(id) {
  if (!confirm('delete this trip?')) return;
  await cloudMergeWrite(arr => {
    const i = arr.findIndex(t => t.id === id);
    if (i >= 0) arr.splice(i, 1);
  });
}

async function clearAll() {
  if (!confirm('clear ALL trips? this cannot be undone!!')) return;
  await cloudMergeWrite(arr => { arr.length = 0; });
}

function renderAll() {
  renderMap();
  renderTripList();
  renderOverlapsList();
}

// ── visitor counter ───────────────────────────────────────────────
function initCounter() {
  let n = parseInt(localStorage.getItem('ft3k_visits') || '1336');
  if (!sessionStorage.getItem('ft3k_v')) {
    n++;
    localStorage.setItem('ft3k_visits', n);
    sessionStorage.setItem('ft3k_v', '1');
  }
  document.getElementById('visitorCount').textContent = String(n).padStart(6,'0');
}

// ── boot ──────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  loadLocal();
  initMap();
  initCounter();
  document.getElementById('lastUpdated').textContent =
    new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });

  renderRoomPanel();

  if (loadRoomMeta()) {
    renderRoomPanel();
    syncFromCloud().then(() => startPolling());
  } else {
    renderAll();
  }
});
