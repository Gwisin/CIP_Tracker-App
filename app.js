'use strict';
let holes = [];
let byId = new Map();
let records = Object.create(null);
let user;
const revisions = new Map();
const memos = new Map();
const savingMemos = new Set();
const editableRoles = new Set(['editor','admin']);
const roleName = {admin:'관리자', editor:'편집 가능', viewer:'조회 전용', pending:'승인 대기', revoked:'접근 중지'};
const $ = id => document.getElementById(id);
const map = $('map');
const mapSurface = map.closest('.map-surface') || map;
const overview = {zoom:1, x:353.5, y:398.5, selected:null};
const state = {...overview};
let viewport;
const pointers = new Map();
let gestureMoved = false;
let pending = [];
let inspectorId = null;
let rowNumber = 0;
const namespace = 'http://www.w3.org/2000/svg';
const fmtDate = date => date.split('-').slice(1).map(Number).join('/');
const typeOf = id => id.includes('-') ? 'cip' : 'h';
const zoomLimit = 160;
const maximumRows = 100;
let saving = false;
const entries = $('rows');
let historyLimit = 8;
let usersRequest = 0;

function draw(layer, tag, attrs, label) {
  const element = document.createElementNS(namespace, tag);
  for (const [attr, value] of Object.entries(attrs)) element.setAttribute(attr, value);
  if (label) element.textContent = label;
  layer.append(element);
  return element;
}
function project(hole) {
  return {x:viewport.width/2+(hole.x-state.x)*viewport.scale, y:viewport.height/2+(hole.y-state.y)*viewport.scale};
}
function numberFits(hole,size) {
  return size*1.75 >= hole.id.length*6+3;
}
function renderMetrics() {
  const completed = Object.keys(records);
  for (const kind of ['h', 'cip']) {
    $(`${kind}-total`).textContent = holes.filter(hole => typeOf(hole.id) === kind).length;
    $(`${kind}-completed`).textContent = completed.filter(id => typeOf(id) === kind).length;
  }
  $('completed').textContent = completed.length;
  $('remaining').textContent = holes.length - completed.length;
}
function renderInspector() {
  const hole = byId.get(state.selected);
  const canEdit = editableRoles.has(user?.role);
  $('selection-empty').hidden = Boolean(hole);
  $('hole-info').hidden = !hole;
  $('clear-selection').hidden = !hole;
  $('detail').disabled = !hole;
  if (!hole) {
    inspectorId = null;
    return;
  }
  const kind = typeOf(hole.id);
  $('selected-kind').textContent = kind === 'h' ? 'H파일' : '철근망';
  $('selected-number').textContent = hole.id;
  $('selected-status').textContent = records[hole.id] ? '타설 완료' : '미등록';
  $('selected-status').classList.toggle('done', Boolean(records[hole.id]));
  $('selected-status').classList.toggle('cip-completion', kind === 'cip');
  $('selected-date').textContent = records[hole.id] || '등록된 완료일 없음';
  $('memo-form').hidden = !canEdit;
  $('memo-readonly').hidden = canEdit;
  $('memo-text').textContent = memos.get(hole.id)?.memo || '등록된 메모 없음';
  const memo = $('hole-memo');
  const isSaving = savingMemos.has(hole.id);
  memo.readOnly = isSaving;
  $('save-memo').disabled = isSaving;
  if (inspectorId !== hole.id) {
    inspectorId = hole.id;
    memo.value = memos.get(hole.id)?.memo || '';
    setMessage('memo-message', isSaving ? '메모를 저장하는 중입니다.' : '');
  }
}
function selectHole(id, {zoom = false} = {}) {
  if (saving || !byId.has(id)) return;
  state.selected = id;
  if (zoom && viewport) {
    state.x = byId.get(id).x;
    state.y = byId.get(id).y;
    state.zoom = Math.min(zoomLimit, 14 / (viewport.scale / state.zoom));
  }
  render();
}
function render() {
  const {width,height} = map.getBoundingClientRect();
  if (!width || !height) return;
  viewport = {width,height,scale:Math.min((width-64)/707,(height-110)/797)*state.zoom};
  map.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const scene = document.createDocumentFragment();
  const detail = viewport.scale >= 4;
  const step = state.zoom < 1.65 ? 20 : 10;
  const size = Math.max(1,1.39*viewport.scale);
  const coordinates = holes.map(hole => ({...hole, ...project(hole)}));
  const visible = coordinates.filter(h => h.x>=-size && h.x<=width+size && h.y>=-size && h.y<=height+size);
  const points = coordinates.map(h => `${h.x},${h.y}`).join(' ');
  draw(scene,'polygon',{points,fill:'none',stroke:'#c6d5d5','stroke-width':1.5,'stroke-linejoin':'round'});
  // Completed holes render last so their marks remain visible at overview scale.
  const ordered = [...visible].sort((a, b) => Number(Boolean(records[a.id])) - Number(Boolean(records[b.id])));
  for (const hole of ordered) {
    const done = Boolean(records[hole.id]);
    const selected = state.selected === hole.id;
    const hFile = typeOf(hole.id)==='h';
    const cipCompletion = done && !hFile;
    const completionClass = cipCompletion ? 'cip-completion' : '';
    const outline = selected ? 1.75 : done ? (cipCompletion && !detail ? .7 : 1.1) : detail ? (hFile ? 1.2 : .8) : .55;
    const fill = done ? 'var(--done-fill)' : hFile ? 'var(--h-fill)' : '#fdfefe';
    const stroke = selected ? 'var(--teal)' : done ? 'var(--done-edge)' : hFile ? 'var(--h-edge)' : '#698589';
    if (selected) draw(scene, 'circle', {cx:hole.x, cy:hole.y, r:size+5, fill:'none', stroke:'var(--teal)', 'stroke-width':2, 'pointer-events':'none'});
    const node = draw(scene,'circle',{cx:hole.x,cy:hole.y,r:size*.95,fill,stroke,'stroke-width':outline,class:completionClass,'data-hole':hole.id,opacity:done||selected||detail?1:.55});
    draw(node,'title',{},`${hole.id} · ${records[hole.id] || '미등록'}`);
    if (detail && done && numberFits(hole,size)) {
      draw(scene,'text',{x:hole.x,y:hole.y+4,'text-anchor':'middle','font-size':11,'font-weight':700,fill:'var(--done-number-ink)',class:completionClass,'pointer-events':'none','data-number':hole.id},hole.id);
    }
  }
  const occupied = [];
  const labelHoles = [...visible].sort((a,b) => (Number(b.id===state.selected) - Number(a.id===state.selected)) || (detail ? Number(Boolean(records[b.id])) - Number(Boolean(records[a.id])) : 0));
  for (const hole of labelHoles) {
    const date = records[hole.id];
    const selected = state.selected === hole.id;
    let label;
    if (detail && date) {
      label = numberFits(hole,size) ? fmtDate(date) : `${hole.id} · ${fmtDate(date)}`;
    }
    else if (selected || (detail && viewport.scale >= 10)) label=hole.id;
    else if (typeOf(hole.id)==='h' && Number(hole.id)%step===0) label=hole.id;
    if (!label) continue;
    const boxWidth = Math.max(25,label.length*6.3+8);
    for (const stagger of [0,17,34,51,68]) {
      const offset = size + 13 + stagger;
      const x = hole.x + hole.nx*offset;
      const y = hole.y + hole.ny*offset;
      const left = x-boxWidth/2;
      const top = y-8;
      if (left<2 || left+boxWidth>width-2 || top<2 || top+16>height-2) continue;
      if (occupied.some(box => left < box.left+box.w+2 && left+boxWidth+2 > box.left && top < box.top+18 && top+18 > box.top)) continue;
      occupied.push({left,top,w:boxWidth});
      const completedLabel = detail && Boolean(date);
      const labelLayer = completedLabel && typeOf(hole.id) === 'cip'
        ? draw(scene, 'g', {class:'cip-completion'}) : scene;
      const color = completedLabel ? 'var(--done-edge)' : '#698589';
      const start = size*.93;
      draw(labelLayer,'line',{x1:hole.x+hole.nx*start,y1:hole.y+hole.ny*start,x2:x,y2:y,stroke:color,'stroke-width':1,'pointer-events':'none'});
      draw(labelLayer,'rect',{x:left,y:top,width:boxWidth,height:16,rx:3,fill:completedLabel?'var(--done-label-fill)':'#eef5f4',stroke:color,'stroke-width':.65,'pointer-events':'none'});
      draw(labelLayer,'text',{x,y:y+4,'text-anchor':'middle','font-size':11,'font-weight':650,fill:completedLabel?'var(--done-label-ink)':'#315456','pointer-events':'none','data-label-for':hole.id},label);
      break;
    }
  }
  map.replaceChildren(scene);
  const choice = byId.get(state.selected);
  $('selection').classList.toggle('visible',Boolean(choice));
  $('selection').textContent = choice ? `${choice.id} · ${typeOf(choice.id)==='h'?'H파일':'철근망'} · ${records[choice.id] || '미등록'}` : '';
  $('zoom-value').textContent = Math.round(state.zoom*100)+'%';
  $('overview').setAttribute('aria-pressed', String(state.zoom === 1 && state.x === overview.x && state.y === overview.y));
  renderInspector();
}
function setView(detail) {
  if (!viewport) return;
  const hole = byId.get(state.selected);
  if (detail) {
    if (!hole) return;
    state.zoom = Math.min(zoomLimit, 14 / (viewport.scale/state.zoom));
    state.x = hole.x;
    state.y = hole.y;
  } else {
    Object.assign(state,{zoom:overview.zoom, x:overview.x, y:overview.y});
  }
  render();
}
function zoomBy(factor,x=viewport.width/2,y=viewport.height/2,previousX=x,previousY=y) {
  const next = Math.max(1,Math.min(zoomLimit,state.zoom*factor));
  const centerX = viewport.width/2, centerY = viewport.height/2;
  const ratio = state.zoom/next;
  state.x += ((previousX-centerX)-(x-centerX)*ratio)/viewport.scale;
  state.y += ((previousY-centerY)-(y-centerY)*ratio)/viewport.scale;
  state.zoom = next;
  render();
}
$('overview').onclick=()=>setView(false);
$('detail').onclick=()=>setView(true);
$('zoom-in').onclick=()=>zoomBy(1.5);
$('zoom-out').onclick=()=>zoomBy(1/1.5);
$('clear-selection').onclick=()=>{
  if (saving) return;
  state.selected = null;
  render();
  $('hole-query').focus();
};
$('hole-search').onsubmit=event=>{
  event.preventDefault();
  if (saving) return;
  const input = $('hole-query');
  const id = input.value.trim();
  if (!byId.has(id)) {
    input.setAttribute('aria-invalid', 'true');
    $('search-message').className = 'message error';
    $('search-message').textContent = id ? `${id}: 도면에 없는 홀 번호입니다. 예: 213 또는 213-1` : '찾을 홀 번호를 입력하세요.';
    input.focus();
    return;
  }
  input.removeAttribute('aria-invalid');
  selectHole(id, {zoom:true});
  $('search-message').className = 'message';
  $('search-message').textContent = `${id}번 홀을 선택했습니다. 홀 상세에서 완료일과 메모를 확인하세요.`;
};
function mapPoint(event) {
  const box=map.getBoundingClientRect();
  return {x:event.clientX-box.left,y:event.clientY-box.top};
}
map.addEventListener('wheel',event=>{
  if (!event.deltaY) return;
  event.preventDefault();
  const {x,y}=mapPoint(event);
  zoomBy(event.deltaY<0?1.2:1/1.2,x,y);
},{passive:false});
// Keep Safari's page gestures from taking over touches that start on the drawing.
mapSurface.addEventListener('touchstart',event=>{
  if (event.cancelable) event.preventDefault();
},{passive:false});
mapSurface.addEventListener('pointerdown',event=>{
  if ((event.pointerType!=='touch' && event.button!==0) || pointers.size>=2) return;
  const active = pointers.values().next().value;
  if (active && (event.pointerType!=='touch' || active.type!=='touch')) return;
  mapSurface.setPointerCapture(event.pointerId);
  gestureMoved=Boolean(active);
  pointers.set(event.pointerId,{...mapPoint(event),type:event.pointerType,hole:event.target.closest('[data-hole]')?.dataset.hole});
});
function pinchFrame(a,b) {
  return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y)};
}
mapSurface.addEventListener('pointermove',event=>{
  const previous=pointers.get(event.pointerId);
  if (!previous) return;
  const next=mapPoint(event);
  const other=[...pointers.entries()].find(([id])=>id!==event.pointerId)?.[1];
  if (other) {
    const from=pinchFrame(previous,other), to=pinchFrame(next,other);
    Object.assign(previous,next);
    if (from.distance>1 && to.distance>1) zoomBy(to.distance/from.distance,to.x,to.y,from.x,from.y);
    return;
  }
  const dx=next.x-previous.x,dy=next.y-previous.y;
  if (!gestureMoved && Math.hypot(dx,dy)<4) return;
  gestureMoved=true;
  Object.assign(previous,next);
  state.x-=dx/viewport.scale;
  state.y-=dy/viewport.scale;
  map.classList.add('dragging');
  render();
});
function endGesture(event) {
  if (event.type==='lostpointercapture' && event.target!==mapSurface) return;
  const point=pointers.get(event.pointerId);
  if (!point) return;
  pointers.delete(event.pointerId);
  if (event.type==='pointerup' && !gestureMoved && !pointers.size) {
    if (point.hole) selectHole(point.hole);
  }
  if (!pointers.size) map.classList.remove('dragging');
}
for (const type of ['pointerup','pointercancel','lostpointercapture']) mapSurface.addEventListener(type,endGesture);
map.addEventListener('keydown',event=>{
  if(event.key==='+' || event.key==='=') zoomBy(1.5);
  else if(event.key==='-') zoomBy(1/1.5);
  else if(event.key.startsWith('Arrow')) {
    const shift=30/viewport.scale;
    state.x += event.key==='ArrowRight'?shift:event.key==='ArrowLeft'?-shift:0;
    state.y += event.key==='ArrowDown'?shift:event.key==='ArrowUp'?-shift:0;
    render();
  } else return;
  event.preventDefault();
});
new ResizeObserver(render).observe(map);

function addRow(type='h') {
  const row=document.createElement('tr');
  const number=++rowNumber;
  row.innerHTML = `<td data-label="완료일"><input type="date" name="date" autocomplete="off" aria-label="완료일 ${number}"></td>
    <td data-label="구분"><select name="kind" aria-label="구분 ${number}"><option value="">선택</option><option value="h">H파일</option><option value="cip">철근망</option></select></td>
    <td data-label="홀 번호"><input name="hole" aria-label="홀 번호 ${number}" autocomplete="off" maxlength="2000"></td>
    <td><button class="remove" type="button" aria-label="행 ${number} 삭제">×</button></td>`;
  const date = row.querySelector('[name=date]');
  const today = new Date();
  date.value = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  date.addEventListener('click', () => {
    if (typeof date.showPicker === 'function') {
      try { date.showPicker(); } catch { /* Keep the native date control available when opening is restricted. */ }
    }
  });
  const select = row.querySelector('select');
  select.value = type;
  select.onchange = () => updateHolePlaceholder(row);
  updateHolePlaceholder(row);
  row.querySelector('button').onclick = () => {
    if (saving) return;
    const next = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    (next || addRow()).querySelector('[name=date]').focus();
  };
  entries.append(row);
  return row;
}
function updateHolePlaceholder(row) {
  const kind = row.querySelector('[name=kind]').value;
  row.querySelector('[name=hole]').placeholder = kind === 'cip' ? '예: 215-1, 215-2' : '예: 213, 214';
}
function setMessage(id, text, kind = '') {
  const target = $(id);
  target.textContent = text;
  target.className = 'message ' + kind;
}
function message(text, kind) {
  setMessage('message', text, kind);
}
async function api(path, {body, method} = {}) {
  const options = {method, body:body === undefined ? undefined : JSON.stringify(body),
    headers:body === undefined ? undefined : {'content-type':'application/json'}};
  const response = await (PagesAuth ? PagesAuth.request(path, options) : fetch(path, options));
  if (response.status === 401 && PagesAuth?.hasSession()) {
    PagesAuth.clear();
    location.reload();
  }
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '요청을 처리할 수 없습니다.');
  return data;
}
function applyRecords(rows) {
  for (const item of rows) {
    records[item.id] = item.date;
    revisions.set(item.id,item.revision);
  }
  renderHistory();
  renderMetrics();
}
function recordHoleButton(id, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'record-hole';
  button.textContent = id;
  button.setAttribute('aria-label', `${label} ${id} 도면에서 보기`);
  button.onclick = () => {
    selectHole(id, {zoom:true});
    map.scrollIntoView({block:'center'});
    map.focus({preventScroll:true});
  };
  return button;
}
function renderHistory() {
  const groups = CompletionTools.group(records);
  $('history-count').textContent = `${groups.length}일 · ${Object.keys(records).length}개 홀`;
  const list = $('history-list');
  list.replaceChildren();
  for (const {date, total, h, cip} of groups.slice(0, historyLimit)) {
    const card = document.createElement('section');
    card.className = 'history-card';
    const heading = document.createElement('h3');
    heading.textContent = `${date} · ${total}개`;
    card.append(heading);
    for (const [label, ids] of [['H파일', h], ['철근망', cip]]) {
      if (!ids.length) continue;
      const summary = document.createElement('p');
      summary.textContent = `${label} ${ids.length}개`;
      const numbers = document.createElement('div');
      numbers.className = 'record-holes';
      numbers.append(...ids.map(id => recordHoleButton(id, label)));
      card.append(summary, numbers);
    }
    list.append(card);
  }
  if (!groups.length) list.textContent = '등록된 타설기록이 없습니다.';
  const remaining = groups.length - historyLimit;
  $('history-more').hidden = remaining <= 0;
  $('history-more').textContent = `더보기 · ${Math.max(0, remaining)}일 남음`;
}
$('history-more').onclick = () => {
  const list = $('history-list');
  const top = list.scrollTop;
  historyLimit += 8;
  renderHistory();
  list.scrollTop = top;
  list.scrollBy({top:240, behavior:'smooth'});
};
$('new-record').onclick = () => {
  if (saving || !editableRoles.has(user?.role)) return;
  $('record-message').textContent = '';
  if (!entries.rows.length) addRow();
  $('entries').showModal();
  entries.querySelector('[name=date]').focus();
};
$('close-entry').onclick = () => {
  if (!saving) $('entries').close();
};
$('entries').addEventListener('cancel', event => {
  if (saving) event.preventDefault();
});
async function writeRecords() {
  if (saving) return;
  saving = true;
  const items = pending;
  $('bulk-fields').disabled = true;
  $('add').disabled = true;
  $('close-entry').disabled = true;
  message('기록을 저장하는 중입니다.');
  try {
    const data = await api('/api/completions', {method:'POST', body:{items}});
    applyRecords(data.records);
    state.selected = items.at(-1).id;
    if (viewport?.scale >= 4) {
      const hole = byId.get(state.selected);
      state.x = hole.x;
      state.y = hole.y;
    }
    entries.replaceChildren();
    addRow(typeOf(state.selected));
    message('');
    $('entries').close();
    $('record-message').textContent = `${items.length}개 홀의 타설완료일을 저장했습니다.`;
    render();
  } catch (error) {
    message(error.message, 'error');
  } finally {
    pending = [];
    saving = false;
    $('bulk-fields').disabled = false;
    $('add').disabled = false;
    $('close-entry').disabled = false;
  }
}
function requestSave(items) {
  if (saving || $('confirm').open) return;
  pending = items;
  const changed = items.filter(item => records[item.id] && records[item.id] !== item.date);
  if (changed.length) {
    $('changes').textContent = changed.map(item => `${item.id} (${records[item.id]} → ${item.date})`).join(', ');
    $('confirm').returnValue = 'cancel';
    $('confirm').showModal();
  } else writeRecords();
}
$('memo-form').onsubmit = async event => {
  event.preventDefault();
  const id = state.selected;
  if (!id || !editableRoles.has(user?.role) || savingMemos.has(id)) return;
  const field = $('hole-memo');
  const existing = memos.get(id);
  const memo = field.value.trim();
  if (memo === (existing?.memo || '')) {
    field.value = memo;
    setMessage('memo-message', memo ? '저장되었습니다.' : '', 'ok');
    return;
  }
  savingMemos.add(id);
  renderInspector();
  setMessage('memo-message', '메모를 저장하는 중입니다.');
  try {
    const data = await api('/api/hole-memos', {method:'POST', body:{id, memo, expectedRevision:existing?.revision || 0}});
    memos.set(id, data.memo);
    if (state.selected === id) {
      field.value = data.memo.memo;
      setMessage('memo-message', '저장되었습니다.', 'ok');
    }
  } catch (error) {
    if (state.selected === id) {
      field.value = memo;
      setMessage('memo-message', error.message, 'error');
    }
  } finally {
    savingMemos.delete(id);
    if (state.selected === id) renderInspector();
  }
};
$('hole-memo').oninput = () => setMessage('memo-message', '');
$('add').onclick = () => {
  if (saving) return;
  if (entries.rows.length >= maximumRows) return message('한 번에 최대 100개 행을 입력할 수 있습니다.', 'error');
  addRow(entries.lastElementChild?.querySelector('select').value).querySelector('[name=date]').focus();
};
entries.addEventListener('paste', event => {
  const cell = event.target.closest('td');
  if (!cell || cell.cellIndex > 2 || !event.clipboardData) return;
  const text = event.clipboardData.getData('text/plain');
  if (!text || (cell.cellIndex === 2 && !/[\t\r\n]/.test(text))) return;
  event.preventDefault();
  if (saving) return;
  const firstRow = cell.parentElement.sectionRowIndex;
  const {rows, error} = CompletionTools.parsePaste(text, cell.cellIndex, maximumRows - firstRow, maximumRows);
  if (error) return message(error, 'error');
  if (!rows.length) return;
  rows.forEach((values, offset) => {
    const row = entries.rows[firstRow + offset] || addRow('');
    for (const [name, value] of Object.entries(values)) {
      const field = row.querySelector(`[name=${name}]`);
      field.value = value;
      field.removeAttribute('aria-invalid');
    }
    updateHolePlaceholder(row);
  });
  message(`${rows.length}개 행을 붙여넣었습니다. 내용을 확인한 뒤 기록을 저장하세요.`, 'ok');
});
$('entry-form').addEventListener('submit',event=>{
  event.preventDefault();
  if (saving || !editableRoles.has(user?.role)) return;
  const rows = [...entries.rows];
  const input = rows.map(row => {
    for (const field of row.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');
    const date = row.querySelector('[name=date]');
    return {type: row.querySelector('select').value, holes: row.querySelector('[name=hole]').value,
      date: date.value};
  });
  const {items, errors} = CompletionTools.collect(input, byId, revisions, maximumRows);
  for (const error of errors) rows[error.index].querySelector(`[name=${error.field}]`).setAttribute('aria-invalid', 'true');
  if (errors.length || !items.length) {
    message(errors.map(error => `${error.index + 1}행 ${error.reason}`).join(' ') || '저장할 홀 번호와 타설완료일을 입력하세요.', 'error');
    entries.querySelector('[aria-invalid]')?.focus();
    return;
  }
  requestSave(items);
});
$('confirm').addEventListener('close',()=>{
  if($('confirm').returnValue==='apply') writeRecords();
  else pending=[];
});

function showGate(title,text,{signIn=false,reload=false}={}) {
  document.body.classList.toggle('login-open', signIn);
  $('gate-title').textContent=title;
  $('gate-title').hidden=!title;
  $('gate-text').textContent=text;
  $('google').hidden=!signIn;
  $('reload').hidden=!reload;
}
function showMainView(mypage) {
  $('tracker').hidden = mypage;
  $('mypage').hidden = !mypage;
  const active = mypage ? 'mypage-menu' : 'tracker-menu';
  const inactive = mypage ? 'tracker-menu' : 'mypage-menu';
  $(active).setAttribute('aria-current', 'page');
  $(inactive).removeAttribute('aria-current');
  if (mypage) {
    if (user.role === 'admin') loadUsers();
  } else {
    render();
  }
}
$('tracker-menu').onclick = () => {
  showMainView(false);
  window.scrollTo(0, 0);
};
$('mypage-menu').onclick = () => {
  showMainView(true);
  window.scrollTo(0, 0);
};
async function loadUsers() {
  const request = ++usersRequest;
  const status=$('users-status');
  const users=$('users');
  status.textContent='계정 목록을 불러오는 중입니다.';
  try {
    const data=await api('/api/users');
    if (request !== usersRequest) return false;
    const pendingCount = data.users.filter(account => account.role === 'pending').length;
    $('pending-count').hidden = !pendingCount;
    $('pending-count').textContent = pendingCount;
    $('pending-count').setAttribute('aria-label', `승인 대기 ${pendingCount}건`);
    $('approvals-count').textContent = `승인 대기 ${pendingCount}건`;
    users.replaceChildren();
    for (const account of data.users) {
      const row=users.insertRow();
      const profile = row.insertCell();
      if (account.applicant) {
        const name = document.createElement('strong');
        name.textContent = account.applicant;
        const company = document.createElement('div');
        company.textContent = account.company;
        const phone = document.createElement('div');
        phone.textContent = account.phone;
        profile.append(name, company, phone);
      }
      const email = document.createElement('div');
      email.textContent = account.email;
      profile.append(email);
      const role=document.createElement('select');
      role.setAttribute('aria-label',`${account.email} 권한`);
      const awaitingApproval = account.role === 'pending';
      if (awaitingApproval) {
        role.add(new Option('승인 대기 · 권한 선택', 'pending', true, true));
      }
      for (const value of ['viewer', 'editor', 'revoked']) {
        role.add(new Option(roleName[value], value, value === account.role, value === account.role));
      }
      row.insertCell().append(role);
      const apply=document.createElement('button');
      apply.type = 'button';
      apply.className = 'header-action';
      function updateAction() {
        apply.disabled = role.value === account.role;
        apply.textContent = awaitingApproval
          ? (role.value === 'revoked' ? '접근 중지' : '승인')
          : '저장';
      }
      updateAction();
      role.onchange = updateAction;
      apply.onclick = async () => {
        const selectedRole = role.value;
        apply.disabled = true;
        role.disabled = true;
        try {
          await api('/api/users', {method:'POST', body:{subject:account.subject, role:selectedRole}});
          if (await loadUsers()) {
            const action = awaitingApproval ? '승인했습니다' : '변경했습니다';
            status.textContent = selectedRole === 'revoked'
              ? `${account.email} 계정의 접근을 중지했습니다.`
              : `${account.email} 계정을 ${roleName[selectedRole]} 권한으로 ${action}.`;
          }
        } catch (error) {
          status.textContent = error.message;
        } finally {
          role.disabled = false;
          updateAction();
        }
      };
      row.insertCell().append(apply);
    }
    status.textContent=data.users.length?'':'승인을 요청한 계정이 아직 없습니다.';
    return true;
  } catch (error) {
    if (request === usersRequest) status.textContent=error.message;
    return false;
  }
}
function showPendingApproval() {
  $('registration').hidden = true;
  $('gate').hidden = false;
  showGate('관리자 승인 대기', '권한이 부여되면 다시 확인을 누르세요.', {reload:true});
}
$('registration-form').onsubmit = async event => {
  event.preventDefault();
  const fields = $('registration-fields');
  if (fields.disabled) return;
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form));
  const status = $('registration-status');
  status.textContent = '';
  fields.disabled = true;
  try {
    await api('/api/registration', {method:'POST', body});
    form.reset();
    showPendingApproval();
    $('reload').focus();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    fields.disabled = false;
  }
};
$('refresh-users').onclick=loadUsers;
$('reload').onclick=()=>location.reload();
$('google').onclick = async () => {
  if (!PagesAuth) {
    location.assign('/auth/google');
    return;
  }
  $('google').disabled = true;
  try {
    await PagesAuth.signIn();
  } catch {
    $('gate-text').textContent = '로그인을 시작하지 못했습니다. 브라우저에서 이 사이트의 저장 공간을 허용하고 다시 시도하세요.';
    $('google').disabled = false;
  }
};
window.addEventListener('pageshow', () => { $('google').disabled = false; });
$('logout').onclick=async ()=>{
  try {
    await api('/api/logout',{method:'POST'});
    if (PagesAuth) {
      PagesAuth.clear();
      location.replace(location.pathname);
    } else {
      location.assign('/');
    }
  } catch (error) {
    alert(error.message);
  }
};
async function load() {
  let loginError;
  try {
    await PagesAuth?.completeSignIn();
  } catch (error) {
    PagesAuth.clear();
    loginError = error.message;
  }
  try {
    ({user}=await api('/api/me'));
    if (!user) {
      PagesAuth?.clear();
      if (!loginError && new URLSearchParams(location.search).get('login') === 'failed') {
        loginError = '로그인을 완료하지 못했습니다. 다시 시도하세요.';
      }
      showGate('', loginError || '처음 로그인하면 사용신청과 관리자 승인 후 이용할 수 있습니다.',{signIn:true});
      return;
    }
    $('site-header').hidden=false;
    $('account').hidden=false;
    const name = user.applicant || user.email;
    const company = user.company || '미등록';
    $('account-name').textContent = name;
    $('account-name').title = name;
    $('account-company').textContent = company;
    $('account-company').title = company;
    $('profile-name').textContent = name;
    $('profile-company').textContent = company;
    $('profile-role').textContent = roleName[user.role];
    if (user.role === 'pending') {
      if (user.needsRegistration) {
        document.body.classList.remove('login-open');
        $('gate').hidden = true;
        $('registration-email').textContent = user.email;
        $('registration').hidden = false;
      } else {
        showPendingApproval();
      }
      return;
    }
    if (user.role === 'revoked') {
      showGate('접근이 중지된 계정입니다.', '권한이 부여되면 다시 확인을 누르세요.', {reload:true});
      return;
    }
    const data=await api('/api/holes');
    holes=data.holes;
    byId=new Map(holes.map(hole=>[hole.id,hole]));
    for (const memo of data.memos || []) memos.set(memo.id, memo);
    applyRecords(data.records);
    $('total').textContent=holes.length;
    $('gate').hidden=true;
    document.body.classList.remove('gate-open', 'login-open');
    $('header-title').hidden = true;
    $('tracker-menu').hidden = false;
    $('mypage-menu').hidden = false;
    if (editableRoles.has(user.role)) {
      $('new-record').hidden=false;
    }
    if (user.role==='admin') {
      $('approvals').hidden = false;
      loadUsers();
    }
    showMainView(false);
  } catch (error) {
    showGate('현황을 불러오지 못했습니다.',error.message,{reload:true});
  }
}
load();
