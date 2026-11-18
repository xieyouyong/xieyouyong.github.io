// Run after changing published DAT or raw CSV files: node flux/build-availability.cjs
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const readline = require('node:readline');
const root = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/raw/index.json'), 'utf8'));
const sites = {};
const valid = value => value !== '' && Number.isFinite(Number(value)) && ![-9999, -6999].includes(Number(value));
const stamp = time => new Date(time).toISOString().slice(0, 16);
function add(columns, name, value, time) {
  if (!valid(value)) return;
  const record = columns[name] ||= {start: time, end: time, count: 0};
  record.start = Math.min(record.start, time);
  record.end = Math.max(record.end, time);
  record.count++;
}
function finish(columns) {
  for (const record of Object.values(columns)) {
    record.start = stamp(record.start); record.end = stamp(record.end);
  }
  return columns;
}
(async () => {
  const datNames = ['windspeed', 'temperature', 'humidity', 'pressure', 'shortwave', 'longwave', 'precipitation'];
  for (const file of fs.readdirSync(path.join(root, 'data/dat')).filter(name => name.endsWith('.dat')).sort()) {
    const columns = {};
    for (const line of fs.readFileSync(path.join(root, 'data/dat', file), 'utf8').split('\n')) {
      if (!/^\s*\d{4}\s/.test(line)) continue;
      const cells = line.trim().split(/\s+/);
      if (cells.length !== 12) continue;
      const [y,m,d,h,min] = cells.slice(0,5).map(Number);
      const time = Date.UTC(y,m-1,d,h,min);
      datNames.forEach((name,i) => add(columns, name, cells[i+5], time));
    }
    const site = file.slice(0,-4);
    sites[site] = {dat: {source: file, columns: finish(columns)}};
  }
  for (const [site, record] of Object.entries(manifest)) {
    const columns = {};
    for (const file of Object.values(record.years)) {
      const lines = readline.createInterface({input: fs.createReadStream(path.join(root,'data/raw',file)).pipe(zlib.createGunzip()), crlfDelay: Infinity});
      let header;
      for await (const line of lines) {
        if (!header) {header = line.replace(/^\uFEFF/, '').split(','); continue;}
        if (!/^\d{12},/.test(line)) continue;
        const time = Date.UTC(+line.slice(0,4),+line.slice(4,6)-1,+line.slice(6,8),+line.slice(8,10),+line.slice(10,12)) - record.utc_offset*3600000;
        const cells = line.split(',');
        for (let i=2; i<header.length; i++) add(columns,header[i],cells[i],time);
      }
      console.log(file);
    }
    (sites[site] ||= {}).raw = {source: record.source, columns: finish(columns)};
  }
  fs.writeFileSync(path.join(root,'data/availability.json'),JSON.stringify({version:1,time_zone:'UTC',sites})+'\n');
  console.log('Built availability for '+Object.keys(sites).length+' sites');
})().catch(error => {console.error(error);process.exitCode=1;});
