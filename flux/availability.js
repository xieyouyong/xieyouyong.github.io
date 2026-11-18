// Coverage describes actual non-missing numeric samples, not catalog source years.
const datLabels = {
  windspeed: '风速（wind）', temperature: '气温（temp）', humidity: '相对湿度（rh）',
  pressure: '气压（press）', shortwave: '短波辐射（sw）', longwave: '长波辐射（lw）',
  precipitation: '降水（precip）',
};
const cell = value => String(value || '未记录').replace(/\|/g, '｜').replace(/\s+/g, ' ');

export function stationAvailability(site, catalog, inventory) {
  const row = catalog.find(row => row.id === site);
  return {site_id: site, name: row?.name || '未记录',
    catalog_sources: row?.source_all || '未记录',
    sources: inventory.sites[site] || {}};
}

export function formatAvailability(stations) {
  if (!stations.length) return '';
  const lines = ['### 所查站点的可用数据信息',
    '以下为本站已发布文件中非缺测数值的实际覆盖，时间均为 UTC。首末有效时间之间可能仍有缺测，不代表连续完整。'];
  for (const station of stations) {
    lines.push('**SITE_ID：' + cell(station.site_id) + ' · 站名：' + cell(station.name) + '**');
    const sources = Object.entries(station.sources);
    if (!sources.length) {
      lines.push('本站尚未发布该站点的观测文件，无法核实有效时间跨度和有效变量名。',
        '目录列出的数据来源（不代表本站有效覆盖）：' + cell(station.catalog_sources) + '。');
      continue;
    }
    for (const [kind, source] of sources) {
      const columns = Object.entries(source.columns);
      lines.push('**' + (kind === 'dat' ? '质控逐小时 DAT' : '原始半小时 CSV') + '** · 文件：' + cell(source.source));
      if (!columns.length) {lines.push('文件中没有非缺测数值，暂无有效时间跨度或有效变量。'); continue;}
      const start = columns.map(([, value]) => value.start).sort()[0];
      const end = columns.map(([, value]) => value.end).sort().at(-1);
      lines.push('有效时间跨度：' + start + ' 至 ' + end + '（UTC）。');
      const groups = new Map();
      for (const [name, record] of columns) {
        const key = record.start + '|' + record.end;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push('`' + cell(name) + '`' + (kind === 'dat' ? ' ' + (datLabels[name] || '') : ''));
      }
      lines.push('| 有效变量名 / 字段名 | 首个有效时间（UTC） | 最后有效时间（UTC） |', '| --- | --- | --- |');
      for (const [range, names] of groups) {
        const [first, last] = range.split('|');
        lines.push('| ' + names.join('、') + ' | ' + first + ' | ' + last + ' |');
      }
      if (kind === 'raw') lines.push('CSV 字段包含有有效值的观测、填补、质控和统计列；全缺测字段不列出。可用反引号指定确切字段名查询。');
    }
  }
  return lines.join('\n\n').replace(/\n\n(?=\|)/g, '\n');
}
