import {searchWeb} from "../youxi/search.js?v=5";
import {apiRequest} from "../youxi/connection.js?v=5";

export const fluxPublic = (() => {
  const ids = "CN-Aro CN-BeO CN-Dda CN-Din CN-Dsh CN-Du2 CN-Dzo CN-HaM CN-Jng CN-Lch CN-Xi2 CN-YaS CN-You CN-Yuc".split(" ");
  const aliases = {"阿柔":"CN-Aro","鼎湖山":"CN-Din","禹城":"CN-Yuc","海北":"CN-HaM","内蒙古荒漠草原":"CN-Du2","长白山":"CN-Lch","西双版纳":"CN-Xi2","当雄":"CN-Dsh"};
  const variables = {
    wind: ["风速", "m/s", /\b(?:wind|WS(?:_F)?)\b|风速/i],
    temp: ["气温", "°C", /\b(?:temperature|temp|T_F|TA(?:_F(?:_MDS)?)?)\b|气温|温度/i],
    rh: ["相对湿度", "%", /\b(?:rh|RH_F|humidity)\b|湿度/i],
    press: ["气压", "hPa", /\b(?:press|PA(?:_F)?)\b|气压/i],
    sw: ["短波辐射", "W/m²", /\b(?:sw|SW_IN(?:_F)?)\b|短波/i],
    lw: ["长波辐射", "W/m²", /\b(?:lw|LW_IN(?:_F)?)\b|长波/i],
    precip: ["降水", "mm/时步", /\b(?:precip|P_F)\b|降水|降雨/i],
  };
  const rawFamilies = {
    wind: ["WS"], temp: ["TA", "T_AIR", "TAIR", "T_F"], rh: ["RH"], press: ["PA"], sw: ["SW_IN"],
    lw: ["LW_IN"], precip: ["P"], vpd: ["VPD"], nee: ["NEE"], gpp: ["GPP"], reco: ["RECO"],
  };
  const rawVariables = {
    vpd: ["饱和水汽压差", "hPa", /饱和水汽压差|水汽压亏缺|\bVPD(?:_[A-Z0-9]+)*\b/i],
    nee: ["NEE", "µmol CO₂ m⁻² s⁻¹", /净生态系统交换|\bNEE(?:_[A-Z0-9]+)*\b/i],
    gpp: ["GPP", "µmol CO₂ m⁻² s⁻¹", /总初级生产力|\bGPP(?:_[A-Z0-9]+)*\b/i],
    reco: ["RECO", "µmol CO₂ m⁻² s⁻¹", /生态系统呼吸|\bRECO(?:_[A-Z0-9]+)*\b/i],
  };
  const fields = {...variables, ...rawVariables};
  let rawIndex;
  const regions = {
    亚洲: "AE AF AM AZ BD BH BN BT CN CY GE HK ID IL IN IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR UZ VN YE",
    欧洲: "AD AL AT AX BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA",
    非洲: "AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW",
    北美洲: "AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI",
    南美洲: "AR BO BR CL CO EC FK GF GY PE PY SR UY VE",
    大洋洲: "AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS",
    南极洲: "AQ",
  };
  const countryRegions = new Map(Object.entries(regions).flatMap(([region, codes]) =>
    codes.split(" ").map(code => [code, region])));
  const paths = new Map(ids.map(id => [id, "./data/dat/" + id + ".dat"]));
  const dataCache = new Map();
  let catalog, countries, coastlines, loading, prompts;

  async function read(path, signal) {
    const response = await fetch(path, {signal});
    if (!response.ok) throw new Error("资料读取失败（HTTP " + response.status + "）：" + path);
    return response.text();
  }

  function parseCsv(source) {
    const rows = [[]];
    let value = "", quoted = false;
    for (let index = 0; index < source.length; index++) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') {
          value += char;
          index++;
        } else quoted = !quoted;
      } else if (!quoted && (char === "," || char === "\n")) {
        rows.at(-1).push(value);
        value = "";
        if (char === "\n") rows.push([]);
      } else if (quoted || char !== "\r") value += char;
    }
    if (value || rows.at(-1).length) rows.at(-1).push(value);
    const header = rows.shift();
    return rows.filter(row => row[0]).map(row => Object.fromEntries(header.map((key, index) => [key, row[index] || ""])));
  }

  const number = value => value === "" || value == null || !Number.isFinite(Number(value)) ||
    [-9999, -6999].includes(Number(value)) ? null : Number(value);

  async function load() {
    loading ||= Promise.all([read("./data/AllSites_info06.csv"), read("./country-names.json"), read("./data/raw/index.json")]).then(([csv, names, raw]) => {
      rawIndex = JSON.parse(raw);
      countries = JSON.parse(names);
      catalog = parseCsv(csv).map(row => {
        const prefix = row.SITE_ID.split("-")[0];
        const code = prefix === "UK" ? "GB" : prefix;
        return {id: row.SITE_ID, name: row.SITE_NAME, country: code, continent: countryRegions.get(code),
          longitude: number(row.longitude), latitude: number(row.latitude), elevation: number(row.elevation),
          igbp: row.IGBP, soil: row.soiltype, canopy_height: number(row.HEIGHTC), utc_offset: number(row.UTC_OFFSET),
          source_all: row.Source_all, source_done: row.Source_done};
      });
      return {sites: catalog.length, dat: paths.size};
    });
    return loading;
  }

  async function completion(connection, messages, signal, options = {}) {
    const {onDelta, ...parameters} = options;
    const shared = connection.mode === "shared";
    const streaming = shared || Boolean(onDelta);
    const response = shared ? await apiRequest("/chat", connection.credential, {messages}, signal) :
      await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST", signal, credentials: "omit", redirect: "error",
        headers: {"Content-Type": "application/json", Authorization: "Bearer " + connection.credential},
        body: JSON.stringify({model: connection.model, messages, stream: streaming, ...parameters}),
      });
    if (!response.ok) {
      const json = await response.json().catch(() => null);
      throw new Error((json?.error?.message || (typeof json?.error === "string" && json.error) || "API 请求失败（HTTP " + response.status + "）")
        .replaceAll(connection.credential, "•••").slice(0, 300));
    }
    if (!streaming) return (await response.json()).choices?.[0]?.message?.content?.trim() || "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", content = "";
    try {
      while (true) {
        const {value, done} = await reader.read();
        buffer += decoder.decode(value, {stream: !done});
        const lines = buffer.split("\n");
        buffer = done ? "" : lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          const event = JSON.parse(data);
          if (event.error) throw new Error("流式回答中断。");
          const delta = event.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            onDelta?.(delta);
          }
        }
        if (done) return content.trim();
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  async function connect(connection, signal) {
    if (connection.mode === "shared") {
      const response = await apiRequest("/auth", connection.credential, {}, signal);
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || "最尾厝密钥验证失败。");
      return;
    }
    const reply = await completion(connection, [
      {role: "user", content: "只回复 OK。"},
    ], signal, {thinking: {type: "disabled"}, max_tokens: 16});
    if (!reply) throw new Error("连接测试未收到可用回答。");
  }

  function fallback(question, previous, sites, countryCodes, columns) {
    const regionsAsked = Object.keys(regions).filter(name => question.includes(name) ||
      (name.endsWith("洲") && name.length > 2 && question.includes(name.slice(0, -1))));
    const selected = Object.keys(fields).filter(key => fields[key][2].test(question) || columns.some(column => family(column) === key));
    const raw = /原始|半小时|质控前|指控前/.test(question);
    const rawOnly = raw && !/质控后|指控后|质控前后|指控前后|\bDAT\b/i.test(question);
    const map = /地图|空间分布|Lambert|兰伯特/i.test(question);
    const draw = /绘制|画|图|曲线/.test(question);
    const metadata = /来源|经纬度|经度|纬度|海拔|植被|土壤|几个|多少|清单|位置|最高|最低/.test(question);
    const series = !map && !metadata && (selected.length || columns.length || raw || (draw && sites.length && previous?.tool === "series"));
    const mapEdit = previous?.tool === "map" && !sites.length && !countryCodes.length && !regionsAsked.length &&
      /颜色|散点|裁剪|范围|底图/.test(question);
    const continuation = !sites.length && !countryCodes.length && !regionsAsked.length &&
      /^(?:那|这些|需要|分别|请列)|的呢|清单/.test(question);
    const scope = continuation ? previous || {} : {};
    const plan = {tool: map || mapEdit ? "map" : series ? "series" : "catalog",
      sites: sites.length ? sites : series ? previous?.sites || [] : scope.sites || [],
      countries: countryCodes.length ? countryCodes : scope.countries || [], continents: regionsAsked.length ? regionsAsked : scope.continents || [],
      variables: selected.length ? selected : continuation ? previous?.variables || [] : [], columns, plot: Boolean(draw), raw: Boolean(raw), raw_only: rawOnly,
      dual_axis: /双\s*[yYＹ]\s*轴/.test(question), mark: /柱状|柱形/.test(question) ? "bar" : undefined,
      sort: /最高/.test(question) ? "desc" : /最低/.test(question) ? "asc" : undefined,
      list: /清单|分别|列出|哪些/.test(question), group: /按国家/.test(question) ? "country" : undefined};
    if (mapEdit) return {...previous, ...mapStyle(question), tool: "map"};
    Object.assign(plan, mapStyle(question));
    if (series) {
      const dates = [...question.matchAll(/(?<!\d)((?:19|20)\d{2})(?:\s*[年\/-]\s*(\d{1,2})(?:\s*[月\/-]\s*(\d{1,2}))?)?/g)];
      const lastMonth = dates.at(-1)?.[2];
      plan.periods = dates.map(match => period(+match[1],
        +(match[2] || (dates.length > 1 ? lastMonth : 0) || 0), +(match[3] || 0))).filter(Boolean);
      if (dates.length === 1 && dates[0][2]) {
        const next = question.slice(dates[0].index + dates[0][0].length).match(/(?:和|、|与|及|至|到)\s*(\d{1,2})\s*月/);
        if (next) plan.periods.push(period(+dates[0][1], +next[1]));
      }
      if (plan.periods.length > 1 && /(?:至|到)\s*\d/.test(question)) {
        plan.periods = [{start: plan.periods[0].start, end: plan.periods.at(-1).end}];
      }
      plan.periods = plan.periods.filter(Boolean);
      if (dates.length === 1 && !dates[0][2] && /夏季|夏天/.test(question)) {
        const year = dates[0][1];
        plan.periods = [{start: year + "-06-01", end: year + "-09-01"}];
      }
      if (!dates.length && continuation && previous?.tool === "series") plan.periods = previous.periods || [];
      plan.month_aligned = plan.periods.length > 1 && /月/.test(question);
    }
    return plan;
  }

  function period(year, month, day = 0) {
    if (month > 12 || day > 31 || month < 0 || day < 0) return null;
    const iso = time => new Date(time).toISOString().slice(0, 10);
    const start = Date.UTC(year, (month || 1) - 1, day || 1);
    if (day && new Date(start).getUTCDate() !== day) return null;
    const end = day ? start + 86400000 : month ? Date.UTC(year, month, 1) : Date.UTC(year + 1, 0, 1);
    return {start: iso(start), end: iso(end)};
  }

  function mapStyle(question) {
    const color = Object.entries({红色:"#b62030",黑色:"#000000",蓝色:"#155ca8",绿色:"#247452"}).find(([name]) => question.includes(name));
    return {...(color && {point_color: color[1]}), ...(/Lambert|兰伯特/i.test(question) && {projection: "lambert"})};
  }

  const strings = value => Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
  const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
  const pickSite = value => typeof value === "string" &&
    catalog.find(row => row.id.toLowerCase() === value.toLowerCase())?.id;
  const countryName = code => countries[code]?.[0] || code;

  function normalize(plan) {
    const mapEdit = plan.tool === "map";
    const extent = plan.extent;
    return {
      tool: ["catalog","series","map"].includes(plan.tool) ? plan.tool : "catalog",
      sites: [...new Set(strings(plan.sites).map(pickSite).filter(Boolean))],
      countries: strings(plan.countries).filter(code => countryRegions.has(code)),
      continents: strings(plan.continents).filter(name => Object.hasOwn(regions, name)),
      exclude_countries: strings(plan.exclude_countries).filter(code => countryRegions.has(code)),
      igbp: strings(plan.igbp),
      source: typeof plan.source === "string" ? plan.source.slice(0, 40) : "",
      min_elevation: Number.isFinite(plan.min_elevation) ? plan.min_elevation : null,
      max_elevation: Number.isFinite(plan.max_elevation) ? plan.max_elevation : null,
      variables: strings(plan.variables).filter(key => Object.hasOwn(fields, key)),
      columns: strings(plan.columns).filter(column => /^[A-Z][A-Z0-9_]{0,79}$/.test(column)).slice(0, 12),
      periods: (Array.isArray(plan.periods) ? plan.periods : []).slice(0, 12)
        .filter(item => item && date(item.start) && date(item.end) && item.end > item.start)
        .map(({start, end}) => ({start, end})),
      raw: plan.raw === true, raw_only: plan.raw_only === true, plot: plan.plot === true,
      dual_axis: plan.dual_axis === true, month_aligned: plan.month_aligned === true,
      mark: plan.mark === "bar" ? "bar" : undefined,
      group: ["country","continent","igbp"].includes(plan.group) ? plan.group : undefined,
      sort: ["asc","desc"].includes(plan.sort) ? plan.sort : undefined,
      limit: Number.isInteger(plan.limit) && plan.limit > 0 ? Math.min(640, plan.limit) : undefined,
      list: plan.list === true,
      projection: mapEdit && plan.projection === "lambert" ? "lambert" : undefined,
      point_color: mapEdit && /^#[a-f0-9]{6}$/i.test(plan.point_color) ? plan.point_color : undefined,
      point_radius: Number.isFinite(plan.point_radius) ? Math.max(1, Math.min(20, plan.point_radius)) : 2,
      point_opacity: Number.isFinite(plan.point_opacity) ? Math.max(0, Math.min(1, plan.point_opacity)) : 1,
      extent: Array.isArray(extent) && extent.length === 4 && extent.every(Number.isFinite) &&
        -180 <= extent[0] && extent[0] < extent[2] && extent[2] <= 180 &&
        -90 <= extent[1] && extent[1] < extent[3] && extent[3] <= 90 ? extent : undefined,
      worldwide: plan.worldwide === true,
    };
  }

  function selectCatalog(plan) {
    return catalog.filter(row =>
      (!plan.sites.length || plan.sites.includes(row.id)) &&
      (!plan.countries.length || plan.countries.includes(row.country)) &&
      (!plan.continents.length || plan.continents.includes(row.continent)) &&
      !plan.exclude_countries.includes(row.country) &&
      (!plan.igbp.length || plan.igbp.includes(row.igbp)) &&
      (plan.min_elevation === null || (row.elevation !== null && row.elevation >= plan.min_elevation)) &&
      (plan.max_elevation === null || (row.elevation !== null && row.elevation <= plan.max_elevation)) &&
      (!plan.source || row.source_all.split(";").some(entry =>
        entry.split(":")[0].trim().toLowerCase() === plan.source.toLowerCase())));
  }

  function catalogAnswer(plan, rows) {
    const scope = [...plan.continents, ...plan.countries.map(countryName)].join("、") || (plan.sites.length ? "所查" : "全球");
    const total = rows.length;
    const grouping = new Map();
    for (const row of rows) {
      const group = plan.group === "country" ? countryName(row.country) : row[plan.group] || "未记录";
      grouping.set(group, (grouping.get(group) || 0) + 1);
    }
    if (plan.sort) rows = rows.filter(row => row.elevation !== null).sort((a, b) =>
      (plan.sort === "desc" ? b.elevation - a.elevation : a.elevation - b.elevation) || a.id.localeCompare(b.id));
    const displayed = rows.slice(0, plan.limit || (plan.sort ? 5 : rows.length));
    const count = scope + "站点共 " + total + " 个，分布在 " + new Set(rows.map(row => row.country)).size + " 个国家或地区。";
    const source = "来源：AllSites_info06.csv。";
    const details = plan.group ? [...grouping].sort((a, b) => b[1] - a[1]).map(([key, n]) => "- " + key + " · " + n).join("\n") : "";
    const columns = [["id","站点编号"],["name","站名"],["longitude","经度"],["latitude","纬度"],["elevation","海拔 (m)"],["igbp","IGBP"]];
    if (plan.sites.length) columns.push(["source_all","目录来源"],["source_done","选用来源"]);
    const cell = value => String(value || value === 0 ? value : "未记录").replace(/\|/g, "｜").replace(/\s+/g, " ");
    const table = displayed.length && (plan.list || plan.sort || plan.sites.length) ?
      ["| " + columns.map(([, label]) => label).join(" | ") + " |",
        "| " + columns.map(() => "---").join(" | ") + " |",
        ...displayed.map(row => "| " + columns.map(([field]) => cell(row[field])).join(" | ") + " |")].join("\n") : "";
    const text = [count, details, table, source].filter(Boolean).join("\n\n");
    return {text, evidence: {scope, count: total, groups: details, source,
      rows: displayed.slice(0, plan.list || plan.sites.length || plan.sort ? 80 : 15),
      returned: displayed.length}};
  }

  async function hourly(site, signal) {
    if (dataCache.has(site)) return dataCache.get(site);
    const source = await read(paths.get(site), signal);
    const result = [];
    let index = 0;
    for (const line of source.split("\n")) {
      if (++index % 16000 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        signal.throwIfAborted();
      }
      if (!/^\s*\d{4}\s/.test(line)) continue;
      const values = line.trim().split(/\s+/);
      if (values.length !== 12) continue;
      const [year, month, day, hour, minute] = values.slice(0, 5).map(Number);
      result.push([Date.UTC(year, month - 1, day, hour, minute), ...values.slice(5).map(number)]);
    }
    if (dataCache.size >= 4) dataCache.delete(dataCache.keys().next().value);
    dataCache.set(site, result);
    return result;
  }

  function thin(points) {
    if (points.length <= 2000) return points;
    const size = Math.ceil(points.length / 1000);
    const result = [];
    for (let index = 0; index < points.length; index += size) {
      const bucket = points.slice(index, index + size);
      const low = bucket.reduce((a, b) => b[1] < a[1] ? b : a);
      const high = bucket.reduce((a, b) => b[1] > a[1] ? b : a);
      result.push(...[...new Set([low, high])].sort((a, b) => a[0] - b[0]));
    }
    return [...new Set([points[0], ...result, points.at(-1)])];
  }

  function family(column) {
    return Object.keys(rawFamilies).find(key => rawFamilies[key].some(base =>
      column === base || column.startsWith(base + "_")));
  }

  function candidates(record, key, column) {
    if (column) return record.columns.includes(column) ? [column] : [];
    const bases = rawFamilies[key];
    if (!bases) return [];
    return [...new Set([
      ...bases.map(base => base + "_F"), ...bases,
      ...record.columns.filter(name => family(name) === key && !/(?:^|_)(?:QC|NIGHT|DAY|SD|RANDUNC|JOINTUNC|N)(?:_|$)/.test(name)),
    ])].filter(name => record.columns.includes(name));
  }

  async function readRaw(site, queries, ranges, signal) {
    const record = rawIndex[site];
    if (!record) return null;
    const columns = [...new Set(queries.flatMap(({key, column}) => candidates(record, key, column)))];
    const result = new Map(columns.map(column => [column, []]));
    if (!columns.length) return result;
    const offset = record.utc_offset * 3600000;
    const years = Object.entries(record.years).filter(([year]) => ranges.some(({start, end}) =>
      Date.UTC(+year, 0, 1) - offset < end && Date.UTC(+year + 1, 0, 1) - offset > start));
    for (const [, filename] of years) {
      signal.throwIfAborted();
      const path = "./data/raw/" + filename;
      const response = await fetch(path, {signal});
      if (!response.ok || !response.body) throw new Error("读取 " + filename + " 失败（HTTP " + response.status + "）。");
      const source = await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).text();
      const lines = source.split("\n");
      const header = lines[0].trim().split(",");
      const indices = columns.map(column => ({
        index: header.indexOf(column), points: result.get(column),
        pressure: /^PA(?:_|$)/.test(column) && !/(?:^|_)(?:QC|N|COUNT)(?:_|$)/.test(column),
      })).filter(({index}) => index >= 0);
      for (let index = 1; index < lines.length; index++) {
        if (index % 10000 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
          signal.throwIfAborted();
        }
        const line = lines[index];
        if (!/^\d{12},/.test(line)) continue;
        const time = Date.UTC(+line.slice(0,4), +line.slice(4,6) - 1, +line.slice(6,8),
          +line.slice(8,10), +line.slice(10,12)) - offset;
        if (!ranges.some(range => time >= range.start && time < range.end)) continue;
        const cells = line.trimEnd().split(",");
        for (const {index: columnIndex, points, pressure} of indices) {
          const value = number(cells[columnIndex]);
          if (value !== null) points.push([time, pressure ? Number((value * 10).toPrecision(14)) : value]);
        }
      }
    }
    return result;
  }

  async function seriesAnswer(plan, signal) {
    if (!plan.sites.length) return {text: "请指定要查询的站点。", evidence: "未指定站点。"};
    const query = [...plan.columns.map(column => ({key: family(column) || column, column})),
      ...plan.variables.filter(key => !plan.columns.some(column => family(column) === key)).map(key => ({key}))];
    if (!query.length) return {text: "请指定变量或原始表中的列名。", evidence: "未指定变量。"};

    const ranges = (plan.periods.length ? plan.periods : [{}]).map(range => ({
      start: range.start ? Date.parse(range.start) : -Infinity, end: range.end ? Date.parse(range.end) : Infinity,
      label: range.start ? range.start.slice(0, 7) : "可用时段",
    }));
    const notices = [], series = [], stats = [];
    const stamp = time => new Date(time).toISOString().slice(0, 16);
    const within = (points, range) => points.filter(([time]) => time >= range.start && time < range.end);
    const stationIds = plan.sites.slice(0, 14);
    const axes = query.map(({key, column}) => ({
      label: fields[key]?.[0] || column, unit: column && /(?:^|_)(?:QC|N|COUNT)(?:_|$)/.test(column) ? "" : fields[key]?.[1] || "",
    }));

    function addSeries(site, index, range, points, rawColumn) {
      const {label, unit} = axes[index];
      const raw = Boolean(rawColumn);
      const kind = raw ? "FLUXNET 半小时" : "质控逐小时 DAT";
      const record = rawIndex[site];
      const source = raw ? record.source : paths.get(site);
      const gaps = [];
      let min = Infinity, max = -Infinity, sum = 0;
      points.forEach(([time, value], i) => {
        min = Math.min(min, value);
        max = Math.max(max, value);
        sum += value;
        if (i && time - points[i - 1][0] > (raw ? 1800000 : 3600000)) gaps.push([stamp(points[i - 1][0]), stamp(time)]);
      });
      stats.push({site, label, unit, kind, column: rawColumn || query[index].key,
        ...(raw && {citation: record.citation, source_url: record.url}),
        start: stamp(points[0][0]), end: stamp(points.at(-1)[0]), count: points.length,
        min, max, mean: Number((sum / points.length).toFixed(4)), sum: Number(sum.toFixed(4)), source});
      const legend = [stationIds.length > 1 && site, query.length > 1 && label,
        ranges.length > 1 && range.label, raw ? rawColumn : plan.raw ? "DAT" : ""].filter(Boolean).join(" · ") || site;
      series.push({site, legend, index, kind, mark: plan.mark || (plan.dual_axis && query[index].key === "precip" ? "bar" : "line"),
        points: thin(points).map(([time, value]) => [stamp(time), value]), gaps});
    }

    for (const site of stationIds) {
      const datKeys = Object.keys(variables);
      const dat = paths.has(site) && !plan.raw_only && query.some(item => !item.column && datKeys.includes(item.key) || plan.raw && datKeys.includes(item.key)) ?
        await hourly(site, signal) : [];
      const jobs = [];
      for (const [index, item] of query.entries()) {
        const columnIndex = datKeys.indexOf(item.key) + 1;
        const datPoints = columnIndex && !plan.raw_only && (!item.column || plan.raw) ?
          dat.filter(row => row[columnIndex] !== null).map(row => [row[0], row[columnIndex]]) : [];
        for (const range of ranges) {
          const points = within(datPoints, range);
          if (points.length) addSeries(site, index, range, points);
          else if (plan.raw && !plan.raw_only) notices.push(site + " " + axes[index].label + " " + range.label + " 没有有效的 DAT 数据。");
          if (plan.raw || item.column || !points.length) jobs.push({index, item, range});
        }
      }
      if (!jobs.length) continue;
      const raw = await readRaw(site, jobs.map(job => job.item), jobs.map(job => job.range), signal);
      if (!raw) {
        notices.push(site + " 没有已发布的原始半小时文件。");
        continue;
      }
      for (const {index, item, range} of jobs) {
        const names = candidates(rawIndex[site], item.key, item.column);
        let selected, values;
        for (const name of names) {
          const points = within(raw.get(name), range);
          if (points.length) { selected = name; values = points; break; }
        }
        if (selected) addSeries(site, index, range, values, selected);
        else notices.push(site + " " + (item.column || axes[index].label) + " " + range.label +
          (names.length ? " 的 FLUXNET 半小时数据无有效值。" : " 在原始 CSV 中没有匹配的字段。"));
      }
    }
    const makeChart = (items, indexes) => ({label: indexes.map(index => axes[index].label).join(" / "),
      unit: indexes.length === 1 ? axes[indexes[0]].unit : "", kind: [...new Set(items.map(item => item.kind))].join(" + ") + " · UTC",
      axes: indexes.map(index => axes[index]), month_aligned: plan.month_aligned && ranges.length > 1,
      series: items.map(item => ({...item, axis: indexes.indexOf(item.index)}))});
    const available = query.map((_, index) => index).filter(index => series.some(item => item.index === index));
    const charts = plan.plot && series.length ? plan.dual_axis && available.length === 2 ? [makeChart(series, available)] :
      available.map(index => makeChart(series.filter(item => item.index === index), [index])) : [];
    const report = stats.map(s => "- " + s.site + " · " + s.label + " · " + s.kind + "（" + s.column + "） · " + s.start + " 至 " + s.end +
      "（UTC），" + s.count + " 条。最小 " + s.min + "、平均 " + s.mean + "、最大 " + s.max + (s.unit ? " " + s.unit : "") +
      (s.label === "降水" && s.unit ? "，累计 " + s.sum + " mm" : "") + "。来源：" + s.source);
    const attribution = [...new Set(stats.filter(s => s.citation).map(s => s.site))].map(site => {
      const {citation, url, license} = rawIndex[site];
      return "[" + citation + "](" + url + ") · " + license + "。数据按年分片，半小时时间按站点时区换算为 UTC。";
    });
    return {text: [...notices, report.join("\n"), ...attribution].filter(Boolean).join("\n\n"), chart: charts[0], other_charts: charts.slice(1),
      evidence: {stats, notices, charts: charts.map(chart => ({axes: chart.axes, series: chart.series.map(item => ({legend: item.legend, mark: item.mark, axis: item.axis}))}))}};
  }

  async function mapAnswer(plan, rows, signal) {
    if (!coastlines) {
      const geo = JSON.parse(await read("./coastline.geojson", signal));
      coastlines = geo.features.flatMap(({geometry}) => geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates);
    }
    const coordinates = rows.filter(row => row.longitude !== null && row.latitude !== null &&
      Math.abs(row.longitude) <= 180 && Math.abs(row.latitude) <= 90);
    if (!coordinates.length) {
      const text = "所选站点没有可绘制的坐标。来源：AllSites_info06.csv。";
      return {text, evidence: text};
    }
    const box = (points, pad = 0) => {
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
    };
    const focus = box(coordinates.map(row => [row.longitude, row.latitude]));
    const pad = Math.max(focus[2] - focus[0], focus[3] - focus[1], 2) * .09;
    const extent = plan.extent || (plan.worldwide ? [-180,-85,180,85] :
      [Math.max(-180, focus[0] - pad), Math.max(-89, focus[1] - pad),
        Math.min(180, focus[2] + pad), Math.min(89, focus[3] + pad)]);
    const [west, south, east, north] = extent;
    const radians = degrees => degrees * Math.PI / 180;
    const lon0 = (west + east) / 2;
    let center = Math.min(70, Math.max(-70, (south + north) / 2));
    if (Math.abs(center) < 12) center = center < 0 ? -15 : 15;
    const parallel1 = center - 10, parallel2 = center + 10;
    const tangent = degrees => Math.tan(Math.PI / 4 + radians(degrees) / 2);
    const n = Math.log(Math.cos(radians(parallel1)) / Math.cos(radians(parallel2))) /
      Math.log(tangent(parallel2) / tangent(parallel1));
    const factor = Math.cos(radians(parallel1)) * tangent(parallel1) ** n / n;
    const origin = factor / tangent(center) ** n;
    const wrap = lon => ((lon - lon0 + 540) % 360) - 180;
    const lambert = plan.projection === "lambert" && east - west < 360;
    function project(lon, lat) {
      if (!lambert) return [lon, lat];
      const angle = n * radians(wrap(lon));
      const radius = factor / tangent(Math.max(-89.5, Math.min(89.5, lat))) ** n;
      return [radius * Math.sin(angle), origin - radius * Math.cos(angle)];
    }
    const line = (x1, y1, x2, y2) => Array.from({length: 81}, (_, i) =>
      project(x1 + (x2 - x1) * i / 80, y1 + (y2 - y1) * i / 80));
    const clip = [...line(west,south,east,south), ...line(east,south,east,north),
      ...line(east,north,west,north), ...line(west,north,west,south)];
    const bounds = box(clip);
    const projected = [];
    for (const coast of coastlines) {
      let segment = [], previous;
      for (const [lon, lat] of coast) {
        const relative = lambert ? wrap(lon) : lon;
        if (Math.abs(relative - previous) > 180) {
          if (segment.length > 1) projected.push(segment);
          segment = [];
        }
        segment.push(project(lon, lat));
        previous = relative;
      }
      if (segment.length > 1) projected.push(segment);
    }
    const grid = [], ticks = [];
    for (const [axis, lower, upper] of [["x",west,east],["y",south,north]]) {
      const magnitude = 10 ** Math.floor(Math.log10((upper - lower) / 6));
      const step = [1,2,2.5,5,10].map(value => value * magnitude).find(value => value >= (upper - lower) / 6);
      for (let value = Math.ceil(lower / step) * step; value <= upper + 1e-8; value += step) {
        const track = axis === "x" ? line(value,south,value,north) : line(west,value,east,value);
        const suffix = value ? (axis === "x" ? value > 0 ? "E" : "W" : value > 0 ? "N" : "S") : "";
        grid.push(track);
        ticks.push({axis, label: Number(Math.abs(value).toFixed(6)) + "°" + suffix, at: track[0]});
      }
    }
    const points = coordinates.filter(row => west <= row.longitude && row.longitude <= east &&
      south <= row.latitude && row.latitude <= north).map(row => [row.id, ...project(row.longitude, row.latitude)]);
    const title = ([...plan.continents, ...plan.countries.map(countryName)].join("、") ||
      (plan.sites.length ? plan.sites.join("、") : "全球")) + "站点空间分布";
    const projection = lambert ? "Lambert 正形圆锥 · 中央经线 " + lon0.toFixed(1) + "° · 标准纬线 " +
      parallel1.toFixed(1) + "°、" + parallel2.toFixed(1) + "°" : "等距圆柱";
    const style = {point_color: plan.point_color || "#000000", point_radius: plan.point_radius, point_opacity: plan.point_opacity};
    const text = title + "，绘制 " + points.length + " 个站点。投影为" + projection + "，点颜色 " + style.point_color +
      "。海岸线来自 Natural Earth 1:110m，站点坐标来自 AllSites_info06.csv。";
    return {text, map: {title, bounds, clip, projection, grid, ticks, points, style,
      coastlines: projected.filter(path => {
        const [l, b, r, t] = box(path);
        return r >= bounds[0] && l <= bounds[2] && t >= bounds[1] && b <= bounds[3];
      })}, evidence: {text, extent, points: points.length, style}};
  }

  async function ask(question, context, connection, signal, progress, delta) {
    await load();
    const previous = context.publicPlan;
    const sites = [...new Set([...catalog.filter(row => question.toLowerCase().includes(row.id.toLowerCase()) ||
      (row.name.length > 3 && question.toLowerCase().includes(row.name.toLowerCase()))).map(row => row.id),
    ...Object.entries(aliases).filter(([name]) => question.includes(name)).map(([, id]) => id)])];
    const countryCodes = Object.entries(countries).filter(([code, names]) => countryRegions.has(code) &&
      names.some(name => /[^\x00-\x7f]/.test(name) ? question.includes(name) :
        (" " + question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ") + " ").includes(" " + name.toLowerCase() + " ")))
      .map(([code]) => code);
    const knownColumns = new Set(Object.values(rawIndex).flatMap(record => record.columns));
    const explicitColumns = [...question.matchAll(/`([A-Za-z][A-Za-z0-9_]{0,79})`|(?<![A-Za-z0-9-])([A-Z][A-Z0-9_]{0,79})(?![A-Za-z0-9-])/g)]
      .map(match => (match[1] || match[2]).toUpperCase())
      .filter(column => knownColumns.has(column) && !/^(?:DAT|CSV|UTC)$/.test(column));
    const columns = [...new Set(explicitColumns)];
    let plan = fallback(question, previous, sites, countryCodes, columns), modelError;
    if (!sites.length && columns.length && previous?.tool === "series" &&
        /^(?:用|改用|换成|换为|指定为|列名)/.test(question)) {
      plan = {...previous, columns, variables: columns.map(family).filter(Boolean)};
    }
    if (connection) {
      progress("正在理解问题…");
      try {
        prompts ||= Promise.all([read("./data-query-prompt.md"), read("./answer-prompt.md")]);
        const [prompt] = await prompts;
        const planningInput = {question, previous_question: context.publicQuestion, previous_plan: previous, matched_sites: sites,
          matched_countries: countryCodes, dat_sites: ids, dat_variables: Object.keys(variables),
          raw_sites: Object.keys(rawIndex), raw_variables: Object.keys(fields), explicit_columns: columns};
        const output = await completion(connection, [{role: "system", content: prompt},
          {role: "user", content: JSON.stringify(planningInput)}], signal,
        {response_format: {type: "json_object"}, reasoning_effort: "low", max_tokens: 2400});
        const proposed = JSON.parse(output.replace(/^\s*(?:\x60{3}|~{3})(?:json)?\s*|\s*(?:\x60{3}|~{3})\s*$/gi, ""));
        if (!["catalog","map","series"].includes(proposed?.tool)) throw new Error("查询计划缺少有效操作。");
        if (proposed.tool === "series") {
          if (columns.length) proposed.columns = columns;
          if (plan.raw) {
            proposed.raw = true;
            proposed.raw_only = plan.raw_only;
          }
        }
        plan = proposed;
      } catch (error) {
        signal.throwIfAborted();
        modelError = error.message;
      }
    }
    plan = normalize(plan);
    progress(plan.tool === "series" ? "正在读取观测数据…" : "正在查询站点目录…");
    const result = plan.tool === "series" ? await seriesAnswer(plan, signal) :
      plan.tool === "map" ? await mapAnswer(plan, selectCatalog(plan), signal) :
        catalogAnswer(plan, selectCatalog(plan));
    let summary = result.text, modelUsed = false;
    if (connection && !modelError) {
      progress("正在生成回答…");
      try {
        const [, prompt] = await prompts;
        let webResults = [];
        if (connection.searchKey && /联网|上网|查官网|网络搜索/.test(question)) {
          try {
            webResults = (await searchWeb([question], connection.searchKey, signal)).results;
          } catch {
            signal.throwIfAborted();
          }
        }
        const output = await completion(connection, [{role: "system", content: prompt}, {role: "user",
          content: JSON.stringify({question, evidence: result.evidence, web_results: webResults, previous_question: context.publicQuestion})}],
        signal, {reasoning_effort: "low", max_tokens: 2300, onDelta: delta});
        if (!output) throw new Error("服务未返回可用回答。");
        const table = plan.tool === "catalog" && plan.list && result.text.match(/\n\n(\| [\s\S]+?)\n\n来源/);
        summary = table ? output + "\n\n" + table[1] : output;
        modelUsed = true;
      } catch (error) {
        signal.throwIfAborted();
        modelError = error.message;
      }
    }
    const {evidence, ...reply} = result;
    return {...reply, summary, model_used: modelUsed, model_error: modelError,
      context: {publicPlan: plan, publicQuestion: question}};
  }

  return {ask, connect, load};
})();
