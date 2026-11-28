'use strict';
let holes = [];
let byId = new Map();
let records = Object.create(null);
let user;
let completionDays = [];
let rigAssignments;
const revisions = new Map();
const memos = new Map();
const savingMemos = new Set();
const editableRoles = new Set(['editor','admin']);
const roleName = {admin:'관리자', editor:'편집 가능', viewer:'조회 전용', pending:'승인 대기', revoked:'접근 중지'};
const $ = id => document.getElementById(id);
const map = $('map');
const mapSurface = map.closest('.map-surface') || map;
const mapWrap = map.closest('.map-wrap');
const holePopup = $('hole-popup');
let popupTrigger = map;
const mainViews = {
  tracker: 'tracker-menu',
  'record-manager': 'records-menu',
  mypage: 'mypage-menu',
};
let mainView = 'tracker';
const overview = {zoom:1, x:353.5, y:398.5, selected:null};
const state = {...overview};
const dayInMilliseconds = 86400000;
const progressPercent = new Intl.NumberFormat('ko-KR', {
  style:'percent', minimumFractionDigits:1, maximumFractionDigits:1,
});
const projectDateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit',
});
const timeline = $('timeline-date');
const rigDate = $('rig-date');
const dailyProgressPageSize = 10;
let dailyProgressLimit = dailyProgressPageSize;
let today = projectToday();
let firstDate = today;
let pastDate = null;
let viewport;
const pointers = new Map();
let gestureMoved = false;
let pending = [];
let inspectorId = null;
let rowNumber = 0;
const namespace = 'http://www.w3.org/2000/svg';
const fmtDate = date => date.split('-').slice(1).map(Number).join('/');
const typeOf = completionType;
const zoomLimit = 160;
const detailViewScale = 15;
const maximumRows = 100;
const editPageSize = 10;
let saving = false;
const entries = $('rows');
const entryTitle = $('entry-title').textContent;
const entryHelp = $('entry-help').textContent;
let editing = null;
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
function numberFits(length, size) {
  return size*1.75 >= length*6+3;
}
function projectToday() {
  const parts = projectDateFormat.formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}
function dayNumber(date) {
  return Date.parse(date + 'T00:00:00Z') / dayInMilliseconds;
}
function dateAtDay(day) {
  return new Date(day * dayInMilliseconds).toISOString().slice(0, 10);
}
function canEditRecords() {
  return editableRoles.has(user?.role) && (!pastDate || mainView === 'record-manager');
}
function completionOnDate(id) {
  const date = records[id];
  return date && date <= (pastDate || today) ? date : '';
}
function incompleteLabel(id) {
  return pastDate || records[id] ? '기준일 미완료' : '미등록';
}
function renderMetrics() {
  const selectedDate = pastDate || today;
  const completed = {h:0, cip:0};
  const daily = {h:0, cip:0};
  for (const [id, date] of Object.entries(records)) {
    if (date > selectedDate) continue;
    const kind = typeOf(id);
    completed[kind]++;
    if (date === selectedDate) daily[kind]++;
  }
  $('h-completed').textContent = completed.h;
  $('cip-completed').textContent = completed.cip;
  $('completed').textContent = completed.h + completed.cip;
  const count = daily.h + daily.cip;
  $('timeline-summary').textContent = count
    ? `선택일 완료 ${count}개 · H파일 ${daily.h}개 · 철근망 ${daily.cip}개`
    : '선택일 완료 기록 없음';
}
function renderRigProgress(selectedDate) {
  const rigRows = CompletionTools.rigProgress(rigAssignments, records, selectedDate).map(({label, h, cip}) => {
    const row = document.createElement('tr');
    if (label === '합계') row.className = 'progress-total';
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = label;
    if (label !== '합계') {
      const allocation = document.createElement('span');
      allocation.className = 'rig-allocation';
      allocation.textContent = `(${h.planned + cip.planned}공)`;
      name.append(allocation);
    }
    row.append(name);
    row.insertCell().textContent = h.daily + cip.daily;
    for (const {daily, cumulative, planned} of [h, cip]) {
      row.insertCell().textContent = daily;
      const count = row.insertCell();
      count.append(`${cumulative} / ${planned}`);
      const percentage = document.createElement('span');
      percentage.className = 'progress-rate';
      percentage.textContent = planned ? progressPercent.format(cumulative / planned) : '—';
      count.append(percentage);
    }
    return row;
  });
  $('rig-progress').replaceChildren(...rigRows);
}
function renderDailyProgress() {
  const dailyRows = completionDays.slice(0, dailyProgressLimit).map(({date, total, h, cip}) => {
    const row = document.createElement('tr');
    const heading = document.createElement('th');
    heading.scope = 'row';
    heading.textContent = date;
    row.append(heading);
    row.insertCell().textContent = total;
    row.insertCell().textContent = h.length;
    row.insertCell().textContent = cip.length;
    return row;
  });
  $('daily-progress').replaceChildren(...dailyRows);
  $('daily-progress-empty').hidden = dailyRows.length !== 0;
  const more = $('daily-progress-more');
  const remaining = completionDays.length - dailyRows.length;
  more.hidden = remaining === 0;
  more.textContent = `더보기 · ${remaining}일 남음`;
}
$('daily-progress-more').onclick = () => {
  const firstNewIndex = dailyProgressLimit;
  dailyProgressLimit += dailyProgressPageSize;
  renderDailyProgress();
  const heading = $('daily-progress').rows[firstNewIndex]?.cells[0];
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
};

function renderTimeline() {
  const selectedDate = pastDate || today;
  timeline.value = dayNumber(selectedDate);
  rigDate.value = selectedDate;
  const label = pastDate ? selectedDate : selectedDate + ' · 오늘';
  $('timeline-selected').textContent = label;
  timeline.setAttribute('aria-valuetext', label);
  $('timeline-prev').disabled = selectedDate === firstDate;
  $('timeline-next').disabled = !pastDate;
  $('timeline-today').disabled = !pastDate;
  $('tracker').classList.toggle('historical-view', Boolean(pastDate));
  renderMetrics();
  renderRigProgress(selectedDate);
}
function refreshTimeline() {
  today = projectToday();
  firstDate = today;
  for (const date of Object.values(records)) {
    if (date < firstDate) firstDate = date;
  }
  if (pastDate && pastDate < firstDate) pastDate = firstDate;
  if (pastDate && pastDate >= today) pastDate = null;
  timeline.min = dayNumber(firstDate);
  timeline.max = dayNumber(today);
  rigDate.min = firstDate;
  rigDate.max = today;
  timeline.disabled = firstDate === today;
  $('timeline-start').textContent = firstDate === today ? '' : firstDate;
  renderTimeline();
}
function selectTimelineDay(day) {
  const date = dateAtDay(day);
  pastDate = date < today ? date : null;
  renderTimeline();
  render();
}
timeline.oninput = () => selectTimelineDay(timeline.valueAsNumber);
rigDate.onchange = () => {
  if (rigDate.validity.valid) selectTimelineDay(dayNumber(rigDate.value));
  else rigDate.value = pastDate || today;
};
$('timeline-prev').onclick = () => selectTimelineDay(timeline.valueAsNumber - 1);
$('timeline-next').onclick = () => selectTimelineDay(timeline.valueAsNumber + 1);
$('timeline-today').onclick = () => selectTimelineDay(Number(timeline.max));

function checkProjectDate() {
  if (projectToday() === today) return;
  refreshTimeline();
  render();
}
function renderInspector() {
  const hole = byId.get(state.selected);
  $('detail').disabled = !hole;
  if (!hole || holePopup.hidden) return;
  const canEdit = canEditRecords();
  const kind = typeOf(hole.id);
  const rigIndex = rigAssignments.byHole.get(hole.id);
  const label = kind === 'h' ? 'H파일' : '철근망';
  $('selected-kind').textContent = rigIndex === undefined ? label : `${label} · ${rigIndex + 1}호기`;
  $('selected-number').textContent = hole.id;
  const date = completionOnDate(hole.id);
  $('selected-status').textContent = date ? '타설 완료' : incompleteLabel(hole.id);
  $('selected-status').classList.toggle('done', Boolean(date));
  $('selected-status').classList.toggle('cip-completion', kind === 'cip');
  $('selected-date').textContent = date || '기준일까지 완료일 없음';
  $('memo-form').hidden = !canEdit;
  $('memo-readonly').hidden = canEdit;
  $('memo-label').textContent = pastDate ? '현재 메모' : '메모';
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
  positionHolePopup(hole);
}
function positionHolePopup(hole) {
  const {x, y} = project(hole);
  const inset = 8;
  const maxLeft = mapWrap.clientWidth - holePopup.offsetWidth - inset;
  const maxTop = viewport.height - holePopup.offsetHeight - inset;
  const left = x + 12 <= maxLeft ? x + 12 : x - holePopup.offsetWidth - 12;
  holePopup.style.left = `${Math.max(inset, Math.min(maxLeft, left))}px`;
  holePopup.style.top = `${Math.max(inset, Math.min(maxTop, y + 12))}px`;
}
function closeHolePopup(restoreFocus = false) {
  if (holePopup.hidden) return;
  holePopup.hidden = true;
  inspectorId = null;
  if (restoreFocus) popupTrigger.focus({preventScroll:true});
}
function selectHole(id, {zoom = false, trigger = map} = {}) {
  if (saving || !byId.has(id)) return;
  state.selected = id;
  if (zoom && viewport) {
    state.x = byId.get(id).x;
    state.y = byId.get(id).y;
    state.zoom = Math.min(zoomLimit, detailViewScale / (viewport.scale / state.zoom));
  }
  popupTrigger = trigger;
  holePopup.hidden = false;
  render();
  $('close-hole-popup').focus({preventScroll:true});
}
function render() {
  const {width,height} = map.getBoundingClientRect();
  if (!width || !height) return;
  const verticalPadding = Math.min(110, height * .4);
  viewport = {width,height,scale:Math.min((width-64)/707,(height-verticalPadding)/797)*state.zoom};
  map.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const scene = document.createDocumentFragment();
  const atMinimumZoom = state.zoom === overview.zoom;
  const referenceInterval = atMinimumZoom ? 20 : 5;
  const detail = viewport.scale >= 4;
  const size = Math.max(1,1.39*viewport.scale);
  // Keep cage labels hidden until a full ID such as 215-1 fits.
  const showCipLabels = numberFits(5, size);
  const selectedDate = pastDate || today;
  const coordinates = holes.map(hole => ({...hole, ...project(hole), date:completionOnDate(hole.id)}));
  const visible = coordinates
    .filter(hole => hole.x>=-size && hole.x<=width+size && hole.y>=-size && hole.y<=height+size)
    .filter(hole => detail || typeOf(hole.id) === 'h')
    .map(hole => {
      const hFile = typeOf(hole.id) === 'h';
      const referenceNumber = hFile && (Number(hole.id) % referenceInterval === 0 ||
        (atMinimumZoom && hole.id === '1'));
      const showLabel = referenceNumber || (detail && (hFile || showCipLabels) &&
        (Boolean(hole.date) || hole.id === state.selected || viewport.scale >= 10));
      const showDate = detail && showLabel && Boolean(hole.date) && numberFits(hole.id.length, size);
      return {...hole, hFile, showLabel, showDate};
    });
  const points = coordinates.map(h => `${h.x},${h.y}`).join(' ');
  draw(scene,'polygon',{points,fill:'none',stroke:'#c6d5d5','stroke-width':1.5,'stroke-linejoin':'round'});
  const completionOrder = hole => hole.date === selectedDate ? 2 : Number(Boolean(hole.date));
  // Draw selected-day completions above nearby holes at overview scale.
  const ordered = [...visible].sort((a, b) => completionOrder(a) - completionOrder(b));
  for (const hole of ordered) {
    const done = Boolean(hole.date);
    const selected = state.selected === hole.id;
    const {hFile, showLabel, showDate} = hole;
    const cipCompletion = done && !hFile;
    const completionClass = cipCompletion ? 'cip-completion' : '';
    const outline = selected ? 1.75 : done ? 1.1 : detail ? (hFile ? 1.2 : .8) : .55;
    const fill = done ? 'var(--done-fill)' : hFile ? 'var(--h-fill)' : '#fdfefe';
    const stroke = selected ? 'var(--teal)' : done ? 'var(--done-edge)' : hFile ? 'var(--h-edge)' : '#698589';
    if (selected) draw(scene, 'circle', {cx:hole.x, cy:hole.y, r:size+5, fill:'none', stroke:'var(--teal)', 'stroke-width':2, 'pointer-events':'none'});
    const node = draw(scene,'circle',{cx:hole.x,cy:hole.y,r:size*.95,fill,stroke,'stroke-width':outline,class:completionClass,'data-hole':hole.id,opacity:done||selected||detail?1:.55});
    if (showLabel) {
      draw(node, 'title', {}, showDate ? `${hole.id} · ${hole.date}` : hole.id);
    }
    if (hole.date === selectedDate) {
      draw(scene, 'circle', {cx:hole.x, cy:hole.y, r:size+1.4, class:'timeline-marker', 'pointer-events':'none'});
    }
    if (showDate) {
      draw(scene,'text',{x:hole.x,y:hole.y+4,'text-anchor':'middle','font-size':11,'font-weight':700,fill:'var(--done-number-ink)',class:completionClass,'pointer-events':'none','data-number':hole.id},hole.id);
    }
  }
  const occupied = [];
  const labelHoles = [...visible].sort((a,b) => (Number(b.id===state.selected) - Number(a.id===state.selected)) || (detail ? completionOrder(b) - completionOrder(a) : 0));
  for (const hole of labelHoles) {
    const {date, hFile, showLabel, showDate} = hole;
    if (!showLabel) continue;
    const label = showDate ? fmtDate(date) : hole.id;
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
      const labelLayer = showDate && !hFile
        ? draw(scene, 'g', {class:'cip-completion'}) : scene;
      const color = showDate ? 'var(--done-edge)' : '#698589';
      const start = size*.93;
      draw(labelLayer,'line',{x1:hole.x+hole.nx*start,y1:hole.y+hole.ny*start,x2:x,y2:y,stroke:color,'stroke-width':1,'pointer-events':'none'});
      draw(labelLayer,'rect',{x:left,y:top,width:boxWidth,height:16,rx:3,fill:showDate?'var(--done-label-fill)':'#eef5f4',stroke:color,'stroke-width':.65,'pointer-events':'none'});
      draw(labelLayer,'text',{x,y:y+4,'text-anchor':'middle','font-size':11,'font-weight':650,fill:showDate?'var(--done-label-ink)':'#315456','pointer-events':'none','data-label-for':hole.id},label);
      break;
    }
  }
  map.replaceChildren(scene);
  const choice = byId.get(state.selected);
  $('selection').classList.toggle('visible',Boolean(choice));
  $('selection').textContent = choice ? `${choice.id} · ${typeOf(choice.id)==='h'?'H파일':'철근망'} · ${completionOnDate(choice.id) || incompleteLabel(choice.id)}` : '';
  $('zoom-value').textContent = Math.round(state.zoom*100)+'%';
  $('overview').setAttribute('aria-pressed', String(atMinimumZoom && state.x === overview.x && state.y === overview.y));
  renderInspector();
}
function setView(detail) {
  if (!viewport) return;
  const hole = byId.get(state.selected);
  if (detail) {
    if (!hole) return;
    state.zoom = Math.min(zoomLimit, detailViewScale / (viewport.scale/state.zoom));
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
$('close-hole-popup').onclick = () => closeHolePopup(true);
mapWrap.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || holePopup.hidden) return;
  event.preventDefault();
  closeHolePopup(true);
});
new ResizeObserver(() => {
  if (!holePopup.hidden && viewport && byId.has(state.selected)) positionHolePopup(byId.get(state.selected));
}).observe(holePopup);
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
  selectHole(id, {zoom:true, trigger:input});
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
    else closeHolePopup();
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
const wideLayout = matchMedia('(min-width: 850px) and (orientation: landscape)');
const timelinePanel = timeline.closest('.map-timeline');
const drawing = map.closest('.drawing');
function fitWideMap() {
  if (!wideLayout.matches || !$('tracker').getClientRects().length) return;
  // Measure the controls and surrounding layout separately from the SVG height.
  const timelineBottom = timelinePanel.getBoundingClientRect().bottom + window.scrollY;
  const surroundingHeight = timelineBottom - map.getBoundingClientRect().height;
  const height = Math.floor(window.innerHeight - surroundingHeight - 8);
  drawing.style.setProperty('--wide-map-height', `${height}px`);
}
const drawingChromeObserver = new ResizeObserver(fitWideMap);
for (const selector of ['.site-header', '.tracker-summary', '.drawing-toolbar', '.map-navigation', '.map-footer', '.map-timeline']) {
  drawingChromeObserver.observe(document.querySelector(selector));
}
window.addEventListener('resize', fitWideMap);

function addRow() {
  const row=document.createElement('tr');
  const number=++rowNumber;
  row.innerHTML = `<td data-label="완료일"><input type="date" name="date" autocomplete="off" aria-label="완료일 ${number}"></td>
    <td data-label="홀 번호"><input name="hole" aria-label="홀 번호 ${number}" placeholder="예: 213, 213-1" autocomplete="off" maxlength="2000"></td>
    <td><button class="remove" type="button" aria-label="행 ${number} 삭제">×</button></td>`;
  const date = row.querySelector('[name=date]');
  date.value = projectToday();
  date.addEventListener('click', () => {
    if (typeof date.showPicker === 'function') {
      try { date.showPicker(); } catch { /* Keep the native date control available when opening is restricted. */ }
    }
  });
  row.querySelector('button').onclick = () => {
    if (saving) return;
    const next = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    if (next) next.querySelector('[name=date]').focus();
    else addRow().querySelector('[name=date]').focus();
  };
  entries.append(row);
  return row;
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
    if (item.date === null) delete records[item.id];
    else records[item.id] = item.date;
    revisions.set(item.id,item.revision);
  }
  completionDays = CompletionTools.group(records);
  renderDailyProgress();
  renderHistory();
  refreshTimeline();
}
function recordHoleButton(id, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'record-hole';
  button.textContent = id;
  button.setAttribute('aria-label', `${label} ${id} 도면에서 보기`);
  button.onclick = () => {
    showMainView('tracker');
    if (pastDate && records[id] > pastDate) {
      selectTimelineDay(Math.min(dayNumber(records[id]), dayNumber(today)));
    }
    map.scrollIntoView({block:'center'});
    selectHole(id, {zoom:true});
  };
  return button;
}
function renderHistory() {
  const groups = completionDays;
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
function openEntryDialog(focusTarget) {
  $('record-message').textContent = '';
  $('entries').showModal();
  focusTarget.focus();
}
function appendEditPage() {
  const start = entries.rows.length;
  for (const {date, h, cip} of editing.groups.slice(start, start + editPageSize)) {
    const ids = [...h, ...cip];
    for (const id of ids) editing.ids.add(id);
    const row = addRow();
    const dateField = row.querySelector('[name=date]');
    dateField.value = date;
    dateField.setAttribute('aria-label', `${date} 완료일`);
    const holeField = row.querySelector('[name=hole]');
    holeField.value = ids.join(', ');
    holeField.setAttribute('aria-label', `${date} 홀 번호`);
    holeField.removeAttribute('maxlength');
  }
  const remaining = editing.groups.length - entries.rows.length;
  $('edit-more').hidden = remaining === 0;
  $('edit-more').textContent = `더보기 · ${remaining}일 남음`;
  return entries.rows[start]?.querySelector('[name=hole]');
}
$('edit-records').onclick = () => {
  if (saving || $('entries').open || !canEditRecords()) return;
  const groups = completionDays;
  editing = {
    groups,
    ids: new Set(),
    dates: {...records},
    revisions: new Map(revisions),
    draftRows: [...entries.rows],
  };
  entries.replaceChildren();
  entries.closest('table').classList.replace('entry-table', 'record-edit-table');
  $('entry-title').textContent = '타설기록 수정';
  $('entry-help').textContent = '날짜별 홀 번호를 쉼표로 구분하세요. 목록에서 뺀 홀은 삭제되며, 한 번에 최대 100개 홀의 기록을 변경할 수 있습니다.';
  $('add').hidden = true;
  $('save-records').textContent = '수정 저장';
  $('save-records').hidden = groups.length === 0;
  $('entry-table-shell').hidden = groups.length === 0;
  message(groups.length ? '' : '수정할 타설기록이 없습니다.');
  const first = appendEditPage();
  openEntryDialog(first || $('close-entry'));
};
$('edit-more').onclick = () => {
  if (editing && !saving) appendEditPage()?.focus();
};
function closeEntryDialog() {
  $('entries').close();
  if (!editing) return;
  entries.replaceChildren(...editing.draftRows);
  entries.closest('table').classList.replace('record-edit-table', 'entry-table');
  editing = null;
  $('entry-title').textContent = entryTitle;
  $('entry-help').textContent = entryHelp;
  $('add').hidden = false;
  $('edit-more').hidden = true;
  $('save-records').textContent = '기록 저장';
  $('save-records').hidden = false;
  $('entry-table-shell').hidden = false;
  message('');
}
$('new-record').onclick = () => {
  if (saving || !canEditRecords()) return;
  if (!entries.rows.length) addRow();
  openEntryDialog(entries.querySelector('[name=date]'));
};
$('close-entry').onclick = () => {
  if (!saving) closeEntryDialog();
};
$('entries').addEventListener('cancel', event => {
  event.preventDefault();
  if (!saving) closeEntryDialog();
});
async function writeRecords() {
  if (saving || !canEditRecords()) return;
  saving = true;
  const items = pending;
  $('bulk-fields').disabled = true;
  $('add').disabled = true;
  $('close-entry').disabled = true;
  message('기록을 저장하는 중입니다.');
  try {
    const data = await api('/api/completions', {method:'POST', body:{items}});
    applyRecords(data.records);
    const updated = items.filter(item => item.date !== null);
    if (updated.length) state.selected = updated.at(-1).id;
    if (updated.length && viewport?.scale >= 4) {
      const hole = byId.get(state.selected);
      state.x = hole.x;
      state.y = hole.y;
    }
    const wasEditing = Boolean(editing);
    if (!wasEditing) {
      entries.replaceChildren();
      addRow();
    }
    message('');
    closeEntryDialog();
    if (wasEditing) $('edit-records').focus();
    const removed = items.length - updated.length;
    const saved = updated.length ? `${updated.length}개 홀의 타설완료일을 저장했습니다.` : '';
    const deleted = removed ? `${removed}개 홀의 기록을 삭제했습니다.` : '';
    $('record-message').textContent = [saved, deleted].filter(Boolean).join(' ');
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
  const dates = editing?.dates ?? records;
  const changed = items.filter(item => dates[item.id] && dates[item.id] !== item.date);
  if (changed.length) {
    $('changes').textContent = (editing ? items : changed).map(({id, date}) => {
      if (date === null) return `${id} (${dates[id]} 기록 삭제)`;
      if (!dates[id]) return `${id} (${date} 기록)`;
      return `${id} (${dates[id]} → ${date})`;
    }).join(', ');
    $('confirm').returnValue = 'cancel';
    $('confirm').showModal();
  } else writeRecords();
}
$('memo-form').onsubmit = async event => {
  event.preventDefault();
  const id = state.selected;
  if (!id || !canEditRecords() || savingMemos.has(id)) return;
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
  if (saving || editing) return;
  if (entries.rows.length >= maximumRows) return message('한 번에 최대 100개 행을 입력할 수 있습니다.', 'error');
  addRow().querySelector('[name=date]').focus();
};
entries.addEventListener('paste', event => {
  const cell = event.target.closest('td');
  if (!cell || cell.cellIndex >= completionFields.length || !event.clipboardData) return;
  const text = event.clipboardData.getData('text/plain');
  if (!text || (cell.cellIndex === completionFields.indexOf('hole') && !/[\t\r\n]/.test(text))) return;
  event.preventDefault();
  if (saving) return;
  const firstRow = cell.parentElement.sectionRowIndex;
  const available = (editing ? entries.rows.length : maximumRows) - firstRow;
  const {rows, error} = CompletionTools.parsePaste(text, cell.cellIndex, available, maximumRows);
  if (error) return message(error, 'error');
  if (!rows.length) return;
  rows.forEach((values, offset) => {
    const row = entries.rows[firstRow + offset] || addRow();
    for (const [name, value] of Object.entries(values)) {
      const field = row.querySelector(`[name=${name}]`);
      field.value = value;
      field.removeAttribute('aria-invalid');
    }
  });
  message(`${rows.length}개 행을 붙여넣었습니다. 내용을 확인한 뒤 기록을 저장하세요.`, 'ok');
});
$('entry-form').addEventListener('submit',event=>{
  event.preventDefault();
  if (saving || !canEditRecords()) return;
  const rows = [...entries.rows];
  const input = rows.map(row => {
    for (const field of row.querySelectorAll('[aria-invalid]')) field.removeAttribute('aria-invalid');
    const date = row.querySelector('[name=date]').value;
    return {holes:row.querySelector('[name=hole]').value, date};
  });
  if (editing) {
    const {items, error, field, index} = CompletionTools.editItems(input, editing, byId, maximumRows);
    if (error) {
      const invalid = rows[index]?.querySelector(`[name=${field}]`);
      invalid?.setAttribute('aria-invalid', 'true');
      invalid?.focus();
      return message(error, 'error');
    }
    if (!items.length) return message('변경된 기록이 없습니다.');
    return requestSave(items);
  }
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
function showMainView(view) {
  closeHolePopup();
  mainView = view;
  for (const [panel, menu] of Object.entries(mainViews)) {
    const active = panel === view;
    $(panel).hidden = !active;
    if (active) $(menu).setAttribute('aria-current', 'page');
    else $(menu).removeAttribute('aria-current');
  }
  if (view === 'tracker') render();
  if (view === 'mypage' && user.role === 'admin') loadUsers();
}
for (const [view, menu] of Object.entries(mainViews)) {
  $(menu).onclick = () => {
    showMainView(view);
    window.scrollTo(0, 0);
  };
}
$('view-records').onclick = () => {
  showMainView('record-manager');
  window.scrollTo(0, 0);
  $('history-title').focus({preventScroll:true});
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
    const displayName = user.role === 'admin'
      ? `${name.replace(/(?:\s*\(admin\))+\s*$/i, '')}(ADMIN)`
      : name;
    $('account-name').textContent = displayName;
    $('account-name').title = displayName;
    $('account-company').textContent = company;
    $('account-company').title = company;
    $('profile-name').textContent = displayName;
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
    rigAssignments = CompletionTools.assignRigs(holes);
    for (const [id, revision] of Object.entries(data.deletedRevisions || {})) revisions.set(id, revision);
    for (const memo of data.memos || []) memos.set(memo.id, memo);
    applyRecords(data.records);
    $('total').textContent=holes.length;
    $('gate').hidden=true;
    document.body.classList.remove('gate-open', 'login-open');
    $('header-title').hidden = true;
    $('tracker-menu').hidden = false;
    $('records-menu').hidden = false;
    $('mypage-menu').hidden = false;
    if (editableRoles.has(user.role)) {
      $('new-record').hidden=false;
      $('edit-records').hidden=false;
    }
    if (user.role==='admin') {
      $('approvals').hidden = false;
      loadUsers();
    }
    showMainView('tracker');
    window.addEventListener('focus', checkProjectDate);
    window.setInterval(checkProjectDate, 60000);
  } catch (error) {
    showGate('현황을 불러오지 못했습니다.',error.message,{reload:true});
  }
}
load();
