import {fluxPublic} from "./public-data.js?v=2";
import {bindModelDialog} from "../assets/model-dialog.js?v=1";

const form = document.querySelector("#ask");
const input = document.querySelector("#question");
const send = form.querySelector("button");
const stopAnswer = document.querySelector("#stop-answer");
const messages = document.querySelector("#messages");
const status = document.querySelector("#status");
const launchHelp = document.querySelector("#launch-help");
const examples = [...document.querySelectorAll(".suggestions button")];
const welcome = document.querySelector("#welcome");
const settingsOpen = document.querySelector("#settings-open");
const newChat = document.querySelector("#new-chat");
const historyKey = "flux-chat-v1";
const maxTurns = 20;
let context = {};
let turns = [];
let readyText = "";
let connection = null;
let activeRequest = null;

function answerBrand(text) {
  return text.replace(/deepseek(?:[-_][a-z0-9]+(?:[._-][a-z0-9]+)*)?/gi, "FluxAI");
}

function cancelRequest(request) {
  request.controller.abort();
}

stopAnswer.addEventListener("click", () => {
  if (!activeRequest) return;
  activeRequest.stopped = true;
  stopAnswer.disabled = true;
  cancelRequest(activeRequest);
});

async function streamAnswer(question, reply, request) {
  const timeout = setTimeout(() => cancelRequest(request), 210000);
  let partial = "";
  try {
    return await fluxPublic.ask(question, context, connection, request.controller.signal, text => {
      if (!partial) reply.textContent = text;
    }, chunk => {
      partial += chunk;
      reply.replaceChildren();
      renderMarkdown(reply, answerBrand(partial));
    });
  } finally {
    clearTimeout(timeout);
  }
}

function timeTicks(start, end, width, monthAligned) {
  const hour = 3600000;
  const day = 24 * hour;
  const target = Math.max(2, Math.floor(width / 88));
  const span = end - start;
  const steps = [hour, 3 * hour, 6 * hour, 12 * hour, day, 2 * day, 5 * day, 7 * day, 14 * day];
  const step = steps.find(value => value >= span / target);
  const values = [];
  if (!span) {
    values.push(start);
  } else if (step) {
    for (let time = Math.ceil(start / step) * step; time <= end; time += step) values.push(time);
  } else {
    const first = new Date(start);
    const last = new Date(end);
    const months = (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth();
    const interval = [1, 2, 3, 6, 12, 24, 60, 120].find(value => value >= months / target) || 240;
    let month = Math.ceil((first.getUTCFullYear() * 12 + first.getUTCMonth()) / interval) * interval;
    for (let time = Date.UTC(Math.floor(month / 12), month % 12, 1); time <= end;) {
      if (time >= start) values.push(time);
      month += interval;
      time = Date.UTC(Math.floor(month / 12), month % 12, 1);
    }
  }
  if (!values.length) values.push(start);
  if (span && values[0] - start >= span / target * .8) values.unshift(start);
  if (span && end - values.at(-1) >= span / target * .8) values.push(end);
  return values.map(time => {
    const stamp = new Date(time).toISOString();
    const label = monthAligned ? Number(stamp.slice(8, 10)) + " 日" +
      (span < 2 * day ? " " + stamp.slice(11, 16) : "") :
      span < 2 * day ? stamp.slice(5, 10) + " " + stamp.slice(11, 16) :
      step ? stamp.slice(0, 10) : stamp.slice(0, 7);
    return {time, label};
  });
}

function renderChart(chart, parent) {
  const figure = document.createElement("figure");
  const canvas = document.createElement("canvas");
  const palette = ["#247452", "#a74834", "#315c9f", "#76539b", "#916719", "#0e747d", "#a64270", "#50596b"];
  const parse = stamp => Date.parse((chart.month_aligned ? "2000-01" + stamp.slice(7) : stamp) + "Z");
  const lines = (chart.series || [chart]).map((item, i) => ({
    site: item.legend || item.site || chart.label,
    axis: item.axis || 0,
    mark: item.mark || "line",
    color: palette[i % palette.length],
    dash: [[], [7, 3], [2, 3]][Math.floor(i / palette.length) % 3],
    points: item.points.map(([stamp, value]) => ({stamp, t: parse(stamp), value})),
    gaps: item.gaps.map(([from, to]) => [parse(from), parse(to)]),
  }));
  const points = lines.flatMap(line => line.points);
  if (!points.length) return;
  const axes = (chart.axes || [{label: chart.label, unit: chart.unit}]).map((axis, index) => {
    const selected = lines.filter(line => line.axis === index);
    const values = selected.flatMap(line => line.points.map(point => point.value));
    if (selected.some(line => line.mark === "bar")) values.push(0);
    const min = Math.min(...values), max = Math.max(...values);
    return {...axis, min, max: min === max && selected.some(line => line.mark === "bar") ? max + 1 : max};
  });
  const t0 = points.reduce((v, p) => Math.min(v, p.t), Infinity);
  const t1 = points.reduce((v, p) => Math.max(v, p.t), -Infinity);
  const day = t => chart.month_aligned ? new Date(t).getUTCDate() + " 日" : new Date(t).toISOString().slice(0, 10);
  const title = [chart.design_title && answerBrand(chart.design_title), chart.label + (chart.unit ? " (" + chart.unit + ")" : ""), chart.kind, chart.period]
    .filter(Boolean).join(" · ");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", chart.label + "时间序列：" + lines.map(line => line.site).join("、")
    + (chart.period ? " · " + chart.period : ""));
  const caption = document.createElement("figcaption");
  const defaultCaption = "移动指针查看各站点数值";
  caption.textContent = defaultCaption;
  const download = document.createElement("button");
  download.className = "outline chart-download";
  download.type = "button";
  download.textContent = "下载 PNG";
  figure.append(canvas, caption, download);
  parent.append(figure);
  let hover = null;
  const columns = width => Math.max(1, Math.floor((width - 32) / 105));
  const legendHeight = width => Math.ceil(lines.length / columns(width)) * 17;

  function paint(target, w, h, ratio, pointer = null) {
    target.width = w * ratio;
    target.height = h * ratio;
    const ctx = target.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#203b34";
    ctx.font = "600 14px system-ui";
    ctx.fillText(title, 16, 24, w - 32);
    ctx.font = "12px system-ui";
    lines.forEach((line, i) => {
      const x = 16 + i % columns(w) * 105;
      const y = 43 + Math.floor(i / columns(w)) * 17;
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(line.dash);
      if (line.mark === "bar") {
        ctx.fillStyle = line.color;
        ctx.fillRect(x, y - 3, 18, 6);
      } else {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 18, y);
        ctx.stroke();
      }
      ctx.fillStyle = "#203b34";
      ctx.fillText(line.site, x + 23, y + 4, 77);
    });
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    const left = 60, right = w - (axes.length > 1 ? 60 : 18);
    const top = 41 + legendHeight(w) + (axes.length > 1 ? 22 : 0), bottom = h - 33;
    const px = t => t1 === t0 ? (left + right) / 2 : left + (right - left) * (t - t0) / (t1 - t0);
    const py = (v, {min, max}) => max === min ? (top + bottom) / 2 : bottom - (bottom - top) * (v - min) / (max - min);
    ctx.font = "12px system-ui";
    ctx.fillStyle = "#4d6660";
    ctx.strokeStyle = "#d3e0d9";
    for (const [index, axis] of axes.entries()) {
      ctx.textAlign = index ? "left" : "right";
      const ticks = axis.min === axis.max ? [axis.min] :
        Array.from({length: 5}, (_, i) => axis.min + i * (axis.max - axis.min) / 4);
      for (const value of ticks) {
        const y = py(value, axis);
        if (!index) {
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
        }
        ctx.fillText(Number(value.toPrecision(4)), index ? right + 6 : left - 6, y + 4);
      }
      if (axes.length > 1) {
        ctx.textAlign = index ? "right" : "left";
        ctx.fillText(axis.label + (axis.unit ? " (" + axis.unit + ")" : ""), index ? right : left, top - 10);
      }
    }
    ctx.textAlign = "center";
    for (const {time, label} of timeTicks(t0, t1, right - left, chart.month_aligned)) {
      const x = px(time);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom + 4);
      ctx.stroke();
      const halfLabel = ctx.measureText(label).width / 2;
      ctx.fillText(label, Math.max(halfLabel + 2, Math.min(w - halfLabel - 2, x)), h - 11);
    }
    const timestamp = pointer === null ? null :
      t0 + (t1 - t0) * Math.max(0, Math.min(1, (pointer - left) / (right - left)));
    const readout = [];
    const drawOrder = [...lines].sort((a, b) => Number(b.mark === "bar") - Number(a.mark === "bar"));
    for (const line of drawOrder) {
      const axis = axes[line.axis];
      ctx.strokeStyle = line.color;
      ctx.fillStyle = line.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(line.dash);
      ctx.beginPath();
      let previous;
      let gapIndex = 0;
      for (const point of line.points) {
        if (line.mark === "bar") {
          const barWidth = Math.max(1, Math.min(18, (right - left) / line.points.length * .85));
          const y = py(point.value, axis);
          const baseline = py(0, axis);
          if (y !== baseline) ctx.fillRect(px(point.t) - barWidth / 2, Math.min(y, baseline), barWidth, Math.abs(y - baseline));
          continue;
        }
        while (previous && line.gaps[gapIndex]?.[1] <= previous.t) gapIndex++;
        const crossesGap = previous && line.gaps[gapIndex]?.[0] < point.t && line.gaps[gapIndex]?.[1] > previous.t;
        if (!previous || crossesGap) ctx.moveTo(px(point.t), py(point.value, axis));
        else ctx.lineTo(px(point.t), py(point.value, axis));
        previous = point;
      }
      ctx.stroke();
      if (line.points.length === 1 || (timestamp !== null &&
          timestamp >= line.points[0].t && timestamp <= line.points.at(-1).t)) {
        const point = line.points.reduce((best, p) =>
          Math.abs(p.t - timestamp) < Math.abs(best.t - timestamp) ? p : best);
        ctx.beginPath();
        ctx.arc(px(point.t), py(point.value, axis), 3.5, 0, 2 * Math.PI);
        ctx.fill();
        if (timestamp !== null) {
          readout.push(line.site + " · " + point.stamp.replace("T", " ") + " · " + point.value);
        }
      }
    }
    if (target === canvas) caption.textContent = readout.length ? readout.join("　|　") : defaultCaption;
  }

  function draw() {
    const width = canvas.clientWidth;
    if (!width) return;
    const height = 280 + legendHeight(width);
    if (canvas.style.height !== height + "px") canvas.style.height = height + "px";
    paint(canvas, width, height, window.devicePixelRatio || 1, hover);
  }
  canvas.addEventListener("pointermove", (event) => { hover = event.offsetX; draw(); });
  canvas.addEventListener("pointerleave", () => { hover = null; draw(); });
  download.addEventListener("click", () => {
    const image = document.createElement("canvas");
    const width = 1200;
    paint(image, width, 460 + legendHeight(width), 1.5);
    image.toBlob(blob => {
      if (!blob) {
        caption.textContent = "图片生成失败，请重试。";
        return;
      }
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = lines.map(line => line.site).join("_").slice(0, 75) + "_" + chart.label
        + "_" + (chart.month_aligned ? "按月比较" : day(t0)) + ".png";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }, "image/png");
  });
  new ResizeObserver(draw).observe(canvas);
  draw();
}

function renderStationMap(map, parent) {
  const figure = document.createElement("figure");
  const canvas = document.createElement("canvas");
  const caption = document.createElement("figcaption");
  const download = document.createElement("button");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", map.title);
  caption.textContent = map.projection + " · 海岸线 Natural Earth 1:110m";
  download.type = "button";
  download.className = "outline chart-download";
  download.textContent = "下载 PNG";
  figure.append(canvas, caption, download);
  parent.append(figure);

  function paint(target, width, height, ratio) {
    target.width = Math.round(width * ratio);
    target.height = Math.round(height * ratio);
    const ctx = target.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#111";
    ctx.font = "600 15px system-ui";
    ctx.fillText(map.title, 14, 23, width - 28);
    ctx.font = "11px system-ui";
    ctx.fillText(map.projection + " · Natural Earth 1:110m", 14, height - 10, width - 28);
    const [left, bottom, right, top] = map.bounds;
    const scale = Math.min((width - 76) / (right - left), (height - 87) / (top - bottom));
    const x0 = 48 + (width - 76 - (right - left) * scale) / 2;
    const y0 = 33 + (height - 87 - (top - bottom) * scale) / 2;
    const px = x => x0 + (x - left) * scale;
    const py = y => y0 + (top - y) * scale;
    ctx.save();
    ctx.beginPath();
    if (map.clip?.length) {
      const [[x, y], ...rest] = map.clip;
      ctx.moveTo(px(x), py(y));
      for (const [x, y] of rest) ctx.lineTo(px(x), py(y));
      ctx.closePath();
    } else {
      ctx.rect(x0, y0, (right - left) * scale, (top - bottom) * scale);
    }
    ctx.clip();
    ctx.strokeStyle = "#d7deda";
    ctx.lineWidth = .6;
    ctx.beginPath();
    for (const [[x, y], ...rest] of map.grid || []) {
      ctx.moveTo(px(x), py(y));
      for (const [gx, gy] of rest) ctx.lineTo(px(gx), py(gy));
    }
    ctx.stroke();
    ctx.strokeStyle = "#66716b";
    ctx.lineWidth = .75;
    ctx.beginPath();
    for (const [[x, y], ...rest] of map.coastlines) {
      ctx.moveTo(px(x), py(y));
      for (const [lon, lat] of rest) ctx.lineTo(px(lon), py(lat));
    }
    ctx.stroke();
    const {point_color: color = "#000", point_radius: radius = 2,
      point_opacity: opacity = 1} = map.style || {};
    ctx.fillStyle = color;
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    for (const [, x, y] of map.points) {
      ctx.moveTo(px(x) + radius, py(y));
      ctx.arc(px(x), py(y), radius, 0, 2 * Math.PI);
    }
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#4d6660";
    ctx.strokeStyle = "#84918a";
    ctx.lineWidth = .7;
    let lastX = -Infinity;
    let lastY = Infinity;
    for (const tick of map.ticks || []) {
      const x = px(tick.at[0]), y = py(tick.at[1]);
      if (tick.axis === "x") {
        if (x - lastX < 43) continue;
        lastX = x;
        ctx.textAlign = "center";
        ctx.fillText(tick.label, x, y + 16);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 4);
      } else {
        if (lastY - y < 17) continue;
        lastY = y;
        ctx.textAlign = "right";
        ctx.fillText(tick.label, x - 7, y + 4);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 4, y);
      }
      ctx.stroke();
    }
  }

  function draw() {
    if (canvas.clientWidth) paint(canvas, canvas.clientWidth, 420, window.devicePixelRatio || 1);
  }
  canvas.style.height = "420px";
  new ResizeObserver(draw).observe(canvas);
  draw();
  download.addEventListener("click", () => {
    const image = document.createElement("canvas");
    paint(image, 1200, 760, 1.5);
    image.toBlob(blob => {
      if (!blob) return;
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = map.title + ".png";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }, "image/png");
  });
}

function message(text, role) {
  const item = document.createElement("article");
  item.className = "message " + role;
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = role === "question" ? "你" : "站点问答";
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = text;
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.append(label, body);
  item.append(bubble);
  messages.append(item);
  return body;
}

let skipDeleteConfirmation = false;
let pendingDeletion = null;
const deleteDialog = document.querySelector("#delete-message-dialog");
const skipDeleteCheckbox = document.querySelector("#skip-delete-confirmation");
deleteDialog.addEventListener("close", () => {
  const remove = pendingDeletion;
  pendingDeletion = null;
  if (remove && deleteDialog.returnValue === "delete") {
    skipDeleteConfirmation = skipDeleteCheckbox.checked;
    remove();
  }
});

function addMessageActions(body, turn, field) {
  const article = body.closest(".message");
  const actions = document.createElement("div");
  actions.className = "message-actions";
  for (const [label, action] of [
    ["复制", async button => {
      try {
        await navigator.clipboard.writeText(field === "question" ? turn.question :
          answerBrand(turn.reply?.summary || turn.reply?.text || body.innerText));
        button.textContent = "已复制";
      } catch {
        button.textContent = "复制失败";
      }
      setTimeout(() => { button.textContent = label; }, 1500);
    }],
    ["删除", () => {
      const remove = () => {
        turn[field] = null;
        turns = turns.filter(item => item.question !== null || item.reply !== null);
        article.remove();
        if (!persistTurns()) status.textContent = "浏览器未能保存这次删除。";
        if (!messages.children.length && !activeRequest) {
          welcome.hidden = false;
          newChat.hidden = true;
        }
      };
      if (skipDeleteConfirmation) {
        remove();
      } else {
        pendingDeletion = remove;
        skipDeleteCheckbox.checked = false;
        deleteDialog.returnValue = "";
        deleteDialog.querySelector("#delete-message-description").textContent =
          field === "question" ? "删除这条问题？" : "删除这条回答？";
        deleteDialog.showModal();
      }
    }],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-label", label + (field === "question" ? "问题" : "回答"));
    button.addEventListener("click", () => action(button));
    actions.append(button);
  }
  article.append(actions);
}

function appendInlineMarkdown(parent, text) {
  const inline = /(\x60[^\x60]+\x60|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)/g;
  for (const part of text.replace(/\\(\*\*|__)/g, "$1").split(inline)) {
    const token = part.match(/^(\x60|\*\*|__|\*)(.+)\1$/);
    if (!token) {
      parent.append(document.createTextNode(part));
      continue;
    }
    const element = document.createElement({"\x60": "code", "**": "strong", "__": "strong", "*": "em"}[token[1]]);
    element.textContent = token[2];
    parent.append(element);
  }
}

function codeBlock(lines, language) {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = lines.join("\n");
  pre.append(code);
  if (lines.length <= 5) return pre;

  const details = document.createElement("details");
  details.className = "code-fold";
  const summary = document.createElement("summary");
  summary.textContent = (language ? language + " · " : "") + lines.length + " 行代码";
  const preview = document.createElement("pre");
  preview.className = "code-preview";
  preview.textContent = lines.slice(0, 5).join("\n") + "\n…";
  details.append(summary, preview, pre);
  return details;
}

function tableCells(line) {
  const text = line.trim().replace(/^\\?\|/, "").replace(/\\?\|\\?$/, "");
  return text.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));
}

function readMarkdownTable(lines, start) {
  const header = lines[start];
  const delimiter = lines[start + 1];
  if (!header.includes("|") || !delimiter?.includes("|")) return null;
  const headings = tableCells(header);
  const alignment = tableCells(delimiter);
  if (headings.length < 2 || alignment.length !== headings.length ||
      !alignment.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
  const wrapper = document.createElement("div");
  wrapper.className = "markdown-table";
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const body = document.createElement("tbody");
  table.append(head, body);
  wrapper.append(table);
  function addRow(section, values, tag) {
    const row = document.createElement("tr");
    headings.forEach((_, index) => {
      const cell = document.createElement(tag);
      if (tag === "th") cell.scope = "col";
      const format = alignment[index];
      if (format.endsWith(":")) cell.style.textAlign = format.startsWith(":") ? "center" : "right";
      appendInlineMarkdown(cell, values[index] || "");
      row.append(cell);
    });
    section.append(row);
  }
  addRow(head, headings, "th");
  let end = start + 2;
  while (end < lines.length && lines[end].includes("|") && lines[end].trim()) {
    addRow(body, tableCells(lines[end]), "td");
    end++;
  }
  return {wrapper, end};
}

function renderMarkdown(parent, markdown) {
  const container = document.createElement("div");
  container.className = "markdown";
  const lines = markdown.split(/\r?\n/);
  let paragraph = null;
  let list = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(\x60{3,}|~{3,})\s*([\w+-]*)\s*$/);
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    const item = line.match(/^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/);
    const table = !fence && readMarkdownTable(lines, i);
    if (table) {
      container.append(table.wrapper);
      i = table.end - 1;
    } else if (fence) {
      const source = [];
      const closing = new RegExp("^\\s*" + fence[1][0] + "{" + fence[1].length + ",}\\s*$");
      while (++i < lines.length && !closing.test(lines[i])) source.push(lines[i]);
      container.append(codeBlock(source, fence[2]));
    } else if (heading) {
      const title = document.createElement("h" + Math.min(6, heading[1].length + 2));
      appendInlineMarkdown(title, heading[2]);
      container.append(title);
    } else if (item) {
      paragraph = null;
      const tag = item[2] ? "ol" : "ul";
      if (!list || list.localName !== tag) {
        list = document.createElement(tag);
        if (item[2]) list.start = Number(item[2]);
        container.append(list);
      }
      const li = document.createElement("li");
      appendInlineMarkdown(li, item[3]);
      list.append(li);
      continue;
    } else if (line.trim()) {
      list = null;
      if (!paragraph) {
        paragraph = document.createElement("p");
        container.append(paragraph);
      } else {
        paragraph.append(document.createElement("br"));
      }
      appendInlineMarkdown(paragraph, line);
      continue;
    }
    paragraph = null;
    list = null;
  }
  parent.append(container);
}

function showReply(reply, result) {
  reply.replaceChildren();
  if (result.summary) renderMarkdown(reply, answerBrand(result.summary));
  else reply.textContent = answerBrand(result.text);
  if (result.map) renderStationMap(result.map, reply);
  for (const chart of [result.chart, ...(result.other_charts || [])].filter(Boolean)) {
    try {
      renderChart(chart, reply);
    } catch {
      reply.append(document.createTextNode("\n图表无法显示，以上为查询结果。"));
    }
  }
  if (result.model_used) {
    const details = document.createElement("details");
    const title = document.createElement("summary");
    title.textContent = "查看检索数据与来源";
    details.append(title, document.createTextNode(answerBrand(result.text)));
    reply.append(details);
  }
  if (result.model_used) reply.append(document.createTextNode("\n由 FluxAI 生成"));
  if (result.chart_design_fallback) reply.append(document.createTextNode("\nFlint 图表配置未通过校验，已使用本地绘图配置。"));
  if (result.model_error) {
    const reason = typeof result.model_error === "string" ? result.model_error : "服务暂不可用。";
    reply.append(document.createTextNode("\nFluxAI 调用失败：" + answerBrand(reason) + " 当前显示本地查询结果。"));
  }
}

function saveTurn(turn, result) {
  const {context: nextContext, ...reply} = result;
  if (nextContext) context = nextContext;
  turn.reply = reply;
  turns.push(turn);
  turns = turns.slice(-maxTurns);
  return persistTurns();
}

function persistTurns() {
  try {
    let stored = JSON.stringify({turns, context});
    while (stored.length > 1500000 && turns.length > 1) {
      turns.shift();
      stored = JSON.stringify({turns, context});
    }
    localStorage.setItem(historyKey, stored);
    return true;
  } catch {
    return false;
  }
}

function restoreChat() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(historyKey));
  } catch {
    return;
  }
  if (!Array.isArray(stored?.turns)) return;
  turns = stored.turns.slice(-maxTurns).filter(turn =>
    typeof turn?.question === "string" || typeof turn?.reply?.text === "string");
  if (stored.context && typeof stored.context === "object") context = stored.context;
  if (!turns.length) return;
  welcome.hidden = true;
  newChat.hidden = false;
  for (const turn of turns) {
    if (typeof turn.question === "string") addMessageActions(message(turn.question, "question"), turn, "question");
    if (turn.reply) {
      const reply = message("", "answer");
      showReply(reply, turn.reply);
      addMessageActions(reply, turn, "reply");
    }
  }
  messages.lastElementChild.scrollIntoView({block: "start"});
}

newChat.addEventListener("click", () => {
  if (newChat.disabled) return;
  try {
    localStorage.removeItem(historyKey);
  } catch {
    // In-memory history can still be cleared if browser storage is unavailable.
  }
  context = {};
  skipDeleteConfirmation = false;
  turns = [];
  messages.replaceChildren();
  welcome.hidden = false;
  newChat.hidden = true;
  input.value = "";
  status.textContent = readyText;
  window.scrollTo(0, 0);
  input.focus({preventScroll: true});
});

async function submit(event) {
  event.preventDefault();
  const question = input.value.trim();
  if (!question || send.disabled) return;
  input.value = "";
  send.disabled = true;
  newChat.disabled = true;
  newChat.hidden = false;
  welcome.hidden = true;
  status.textContent = "";
  launchHelp.hidden = true;
  const turn = {question, reply: null};
  const questionBody = message(question, "question");
  const reply = message("正在查询…", "answer");
  reply.parentElement.scrollIntoView({block: "start"});
  const request = {id: crypto.randomUUID(), controller: new AbortController(), stopped: false};
  activeRequest = request;
  stopAnswer.hidden = false;
  stopAnswer.disabled = false;
  try {
    const recall = /^(?:我)?(?:刚才|上一轮|上一个问题)(?:都)?(?:问了?什么|是什么)[？?。！!\s]*$/;
    const lastQuestion = turns.findLast(turn => typeof turn.question === "string")?.question;
    const result = recall.test(question)
      ? {text: lastQuestion ? "你上一轮问的是：\n" + lastQuestion : "当前对话还没有上一条问题。"}
      : await streamAnswer(question, reply, request);
    if (request.stopped) return;
    showReply(reply, result);
    status.textContent = saveTurn(turn, result) ? readyText : "浏览器无法保存记录，刷新前仍可继续追问。";
  } catch (error) {
    if (!input.value) input.value = question;
    if (request.stopped) {
      if (!reply.textContent || /^正在|^FluxAI 正在/.test(reply.textContent)) reply.textContent = "已停止。";
      else reply.append(document.createTextNode("\n已停止。"));
      status.textContent = "已停止本次查询。";
      return;
    }
    if (error.name === "AbortError") {
      reply.textContent = "查询超过 210 秒。可以缩短时间范围后重试。";
    } else if (error instanceof TypeError) {
      reply.textContent = "无法完成网络请求，请检查网络后重试。";
      launchHelp.hidden = false;
    } else {
      reply.textContent = error instanceof SyntaxError ? "资料响应无法读取，请刷新页面后重试。" : answerBrand(error.message);
    }
    status.textContent = "本次查询未完成。";
  } finally {
    addMessageActions(questionBody, turn, "question");
    addMessageActions(reply, turn, "reply");
    activeRequest = null;
    stopAnswer.hidden = true;
    send.disabled = false;
    newChat.disabled = false;
    reply.parentElement.scrollIntoView({block: "start"});
    input.focus({preventScroll: true});
  }
}

form.addEventListener("submit", submit);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});
for (const button of examples) {
  button.addEventListener("click", () => {
    if (send.disabled) return;
    input.value = button.firstChild.textContent.trim();
    form.requestSubmit();
  });
}
bindModelDialog({
  authenticate: fluxPublic.connect,
  onConnection(value) {
    connection = value;
    settingsOpen.firstChild.textContent = value?.mode === "shared" ? "最尾厝已连接 " :
      value ? "DeepSeek 已连接 " : "连接模型 ";
  },
});
restoreChat();
fluxPublic.load().then(info => {
  readyText = "公开资料已就绪 · " + info.sites + " 个站点 · " + info.dat + " 份小时 DAT";
  status.textContent = readyText;
  settingsOpen.hidden = false;
  input.disabled = false;
  send.disabled = false;
  for (const button of examples) button.disabled = false;
}).catch(error => {
  status.textContent = error.message || "无法读取站点目录。";
  launchHelp.hidden = false;
});
