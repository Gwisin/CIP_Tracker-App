'use strict';
function isCompletionDate(date) {
  const parsed = new Date(date + 'T00:00:00Z');
  return /^[1-9]\d{3}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function normalizeCompletionDate(value) {
  const parts = /^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?$/.exec(value.trim());
  const date = parts && parts.slice(1).map((part, i) => i ? part.padStart(2, '0') : part).join('-');
  return date && isCompletionDate(date) ? date : '';
}

const completionFields = ['date', 'hole'];
const completionType = id => id.includes('-') ? 'cip' : 'h';
// A reinforcement cage belongs to the range of its H-file prefix.
const rigRanges = [
  {h: [[97, 169], [249, 289]], cip: [[97, 175], [249, 289]]},
  {h: [[317, 395]], cip: [[317, 395]]},
  {h: [[1, 96], [290, 316], [396, 397]], cip: [[1, 96], [290, 316], [396, 397]]},
  {h: [[170, 248]], cip: [[176, 248]]},
];

const CompletionTools = {
  assignRigs(holes) {
    const byHole = new Map();
    const planned = rigRanges.map(() => ({h: 0, cip: 0}));
    for (const {id} of holes) {
      const type = completionType(id);
      const prefix = Number(id.split('-')[0]);
      const index = rigRanges.findIndex(ranges => ranges[type].some(([first, last]) => first <= prefix && prefix <= last));
      if (index < 0) continue;
      byHole.set(id, index);
      planned[index][type]++;
    }
    return {byHole, planned};
  },
  rigProgress(assignments, records, cutoff) {
    const rows = assignments.planned.map((planned, index) => ({
      label: `${index + 1}호기`,
      h: {planned: planned.h, daily: 0, cumulative: 0},
      cip: {planned: planned.cip, daily: 0, cumulative: 0},
    }));
    for (const [id, date] of Object.entries(records)) {
      const index = assignments.byHole.get(id);
      if (index === undefined || date > cutoff) continue;
      const values = rows[index][completionType(id)];
      values.cumulative++;
      if (date === cutoff) values.daily++;
    }
    const total = {
      label: '합계',
      h: {planned: 0, daily: 0, cumulative: 0},
      cip: {planned: 0, daily: 0, cumulative: 0},
    };
    for (const row of rows) {
      for (const type of ['h', 'cip']) {
        for (const key of ['planned', 'daily', 'cumulative']) total[type][key] += row[type][key];
      }
    }
    return [...rows, total];
  },
  parsePaste(text, startColumn, availableRows, limit = 100) {
    const lines = text.replace(/^\uFEFF/, '').replace(/[\r\n]+$/, '').split(/\r\n|\n|\r/);
    const cells = lines.map(line => line.split('\t').map(value => value.trim().replace(/^"(.*)"$/, '$1').trim()));
    const [dateHeader, secondHeader, thirdHeader] = cells[0];
    const hasDateHeader = /^(?:타설\s*)?완료일$/.test(dateHeader);
    const legacyHeader = startColumn === 0 && hasDateHeader && secondHeader === '구분' &&
      /^홀\s*번호$/.test(thirdHeader || '');
    if (startColumn === 0 && hasDateHeader && (legacyHeader || /^홀\s*번호$/.test(secondHeader || ''))) cells.shift();
    if (cells.length > availableRows) return {error: `한 번에 최대 ${limit}개 행을 입력할 수 있습니다.`};
    const rows = [];
    for (const [index, cellsInRow] of cells.entries()) {
      const fail = reason => ({error: `붙여넣기 ${index + 1}행: ${reason}`});
      // Previously copied records may still have a category column.
      const legacyRow = startColumn === 0 && cellsInRow.length === 3 &&
        (legacyHeader || /^(?:h\s*파일|철근망)?$/i.test(cellsInRow[1]));
      const values = legacyRow ? [cellsInRow[0], cellsInRow[2]] : cellsInRow;
      if (values.length > completionFields.length - startColumn) {
        return fail('완료일, 홀 번호 순서와 시작 칸을 확인하세요.');
      }
      const row = {};
      for (const [offset, value] of values.entries()) {
        const field = completionFields[startColumn + offset];
        if (field === 'date' && value) {
          const date = normalizeCompletionDate(value);
          if (!date) return fail('완료일을 확인하세요. 예: 2026-11-19');
          row.date = date;
        } else {
          row[field] = value;
        }
      }
      rows.push(row);
    }
    return {rows};
  },
  collect(rows, byId, revisions, limit = 100) {
    const items = [], errors = [], seen = new Set();
    rows.forEach((row, index) => {
      const fail = (field, reason) => errors.push({index, field, reason});
      const value = row.holes.trim();
      if (!value && !row.date.trim()) return;
      const date = normalizeCompletionDate(row.date);
      const ids = value.split(',').map(id => id.trim());
      for (const id of ids) {
        if (!byId.has(id)) fail('hole', `${id || '(빈 번호)'}: 도면에 있는 홀 번호를 입력하세요.`);
        else if (seen.has(id)) fail('hole', `${id}: 같은 홀을 한 번만 입력하세요.`);
        seen.add(id);
        items.push({id, date, expectedRevision: revisions.get(id) || 0});
      }
      if (!date) {
        fail('date', '올바른 타설완료일을 입력하세요.');
      }
    });
    if (items.length > limit) errors.push({index: 0, field: 'hole', reason: `한 번에 최대 ${limit}개 홀을 저장할 수 있습니다.`});
    return {items, errors};
  },
  editItems(rows, snapshot, byId, limit = 100) {
    const desired = new Map();
    for (const [index, row] of rows.entries()) {
      const fail = (field, reason) => ({index, field, error: `${index + 1}행 ${reason}`});
      const date = normalizeCompletionDate(row.date);
      if (!date) return fail('date', '올바른 타설완료일을 입력하세요.');
      const holes = row.holes.trim();
      for (const value of holes ? holes.split(',') : []) {
        const id = value.trim();
        if (!byId.has(id)) return fail('hole', `${id || '(빈 번호)'}: 도면에 있는 홀 번호를 입력하세요.`);
        if (desired.has(id)) return fail('hole', `${id}: 같은 홀을 한 번만 입력하세요.`);
        if (!snapshot.ids.has(id) && snapshot.dates[id]) {
          return fail('hole', `${id}: ${snapshot.dates[id]}에 이미 완료 기록이 있습니다. 더보기로 해당 날짜를 불러오세요.`);
        }
        desired.set(id, date);
      }
    }
    const items = [];
    for (const [id, date] of desired) {
      if (date !== snapshot.dates[id]) items.push({id, date, expectedRevision: snapshot.revisions.get(id) || 0});
    }
    for (const id of snapshot.ids) {
      if (!desired.has(id)) items.push({id, date:null, expectedRevision: snapshot.revisions.get(id)});
    }
    if (items.length > limit) return {error: `한 번에 최대 ${limit}개 홀의 기록을 변경할 수 있습니다.`};
    return {items};
  },
  group(records) {
    const dates = new Map();
    for (const [id, date] of Object.entries(records)) {
      if (!dates.has(date)) dates.set(date, {date, h: [], cip: [], total: 0});
      const group = dates.get(date);
      group[completionType(id)].push(id);
      group.total++;
    }
    return [...dates.values()].sort((a, b) => b.date.localeCompare(a.date)).map(group => {
      for (const type of ['h', 'cip']) group[type].sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
      return group;
    });
  }
};
