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

const completionFields = ['date', 'kind', 'hole'];
const pastedKinds = new Map([['h파일', 'h'], ['철근망', 'cip']]);
const CompletionTools = {
  parsePaste(text, startColumn, availableRows, limit = 100) {
    const lines = text.replace(/^\uFEFF/, '').replace(/[\r\n]+$/, '').split(/\r\n|\n|\r/);
    const cells = lines.map(line => line.split('\t').map(value => value.trim().replace(/^"(.*)"$/, '$1').trim()));
    if (startColumn === 0 && /^(?:타설\s*)?완료일$/.test(cells[0][0]) &&
        cells[0][1] === '구분' && /^홀\s*번호$/.test(cells[0][2] || '')) cells.shift();
    if (cells.length > availableRows) return {error: `한 번에 최대 ${limit}개 행을 입력할 수 있습니다.`};
    const rows = [];
    for (const [index, values] of cells.entries()) {
      const fail = reason => ({error: `붙여넣기 ${index + 1}행: ${reason}`});
      if (values.length > completionFields.length - startColumn) {
        return fail('완료일, 구분, 홀 번호 순서와 시작 칸을 확인하세요.');
      }
      const row = {};
      for (const [offset, value] of values.entries()) {
        const field = completionFields[startColumn + offset];
        if (field === 'date' && value) {
          const date = normalizeCompletionDate(value);
          if (!date) return fail('완료일을 확인하세요. 예: 2026-11-19');
          row.date = date;
        } else if (field === 'kind' && value) {
          const kind = pastedKinds.get(value.replace(/\s/g, '').toLowerCase());
          if (!kind) return fail('구분은 H파일 또는 철근망을 입력하세요.');
          row.kind = kind;
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
      if (!row.type) fail('kind', '구분을 선택하세요.');
      const ids = value.split(',').map(id => id.trim());
      for (const id of ids) {
        if (!byId.has(id)) fail('hole', `${id || '(빈 번호)'}: 도면에 있는 홀 번호를 입력하세요.`);
        else if (row.type && row.type !== (id.includes('-') ? 'cip' : 'h')) fail('hole', `${id}: 홀 번호와 구분이 일치하지 않습니다.`);
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
  editItems(snapshot, selected, value, limit = 100) {
    const date = normalizeCompletionDate(value);
    if (!date) return {error: '올바른 타설완료일을 선택하세요.'};
    const items = snapshot.filter(item => selected.has(item.id)).map(item => ({...item, date}));
    if (!items.length) return {error: '수정할 홀을 선택하세요.'};
    if (items.length > limit) return {error: `한 번에 최대 ${limit}개 홀을 수정할 수 있습니다.`};
    return {items};
  },
  group(records) {
    const dates = new Map();
    for (const [id, date] of Object.entries(records)) {
      if (!dates.has(date)) dates.set(date, {date, h: [], cip: [], total: 0});
      const group = dates.get(date);
      group[id.includes('-') ? 'cip' : 'h'].push(id);
      group.total++;
    }
    return [...dates.values()].sort((a, b) => b.date.localeCompare(a.date)).map(group => {
      for (const type of ['h', 'cip']) group[type].sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
      return group;
    });
  }
};
