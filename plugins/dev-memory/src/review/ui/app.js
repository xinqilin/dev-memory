// Review page. Bundled with marked, DOMPurify and diff so it works with no network at all.
// The file on disk is the truth: this page saves into it, and reloads when something else writes.
import { marked } from "marked";
import DOMPurify from "dompurify";
import { diffLines } from "diff";

const token = new URLSearchParams(location.search).get("token") ?? "";
const el = (id) => document.getElementById(id);
const editor = el("editor");
const preview = el("preview");
const statusLine = el("status");

let current = null; // { path, content, hash, base, checks }
let dirty = false;
let saveTimer = null;

const api = async (path, init = {}) => {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

const say = (message, kind = "") => {
  statusLine.textContent = message;
  statusLine.className = kind ? `status ${kind}` : "status muted";
};

const splitFrontmatter = (text) => {
  const match = (text ?? "").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  return match ? { meta: match[1], body: match[2] } : { meta: "", body: text ?? "" };
};

const render = (markdown) => {
  const { meta, body } = splitFrontmatter(markdown);
  preview.innerHTML = DOMPurify.sanitize(marked.parse(body));
  const strip = el("meta");
  strip.textContent = meta.replace(/\s*\n\s*/g, " · ").trim();
  strip.hidden = meta === "";
};

// ---------- page list ----------
function setStage({ dirty, ahead }) {
  const approve = el("approve");
  const publish = el("publish");

  approve.disabled = !dirty || approve.dataset.blocked === "1";
  publish.disabled = dirty || ahead === 0;

  approve.classList.toggle("primary", dirty);
  publish.classList.toggle("primary", !dirty && ahead > 0);

  approve.title = dirty ? "把這次的修改 commit 在本機，還不會上 GitHub" : "沒有未 commit 的修改";
  publish.title = dirty
    ? "先按「核准並 commit」"
    : ahead === 0
      ? "還沒有任何 commit 可以送出"
      : "push 並開 PR";

  el("stage").textContent = dirty ? "① 看內容 → ② 核准並 commit" : ahead > 0 ? "② 完成 → ③ 送出 PR" : "沒有變更";
}

async function loadPages() {
  const { body } = await api("/api/pages");
  el("branch").textContent = `${body.branch} · 跟 ${body.base} 比較`;
  setStage(body);

  const list = el("pages");
  list.innerHTML = "";
  const labels = { added: "新增", modified: "更新", deleted: "刪除" };

  for (const page of body.pages) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = page.path === current?.path ? "is-active" : "";
    button.innerHTML = `<span class="badge ${page.status}">${labels[page.status] ?? page.status}</span><span class="path"></span>`;
    button.querySelector(".path").textContent = page.path;
    button.addEventListener("click", () => openPage(page.path));
    item.append(button);
    list.append(item);
  }

  if (!current && body.pages.length > 0) openPage(body.pages[0].path);
  if (body.pages.length === 0) say("這次沒有改到任何頁面");
}

// ---------- one page ----------
async function openPage(path) {
  const { body } = await api(`/api/page?path=${encodeURIComponent(path)}`);
  current = body;
  dirty = false;
  editor.value = body.content;
  render(body.content);
  renderChecks(body.checks);
  renderDiff();
  renderSources(body.content);
  say("已載入");
  for (const button of document.querySelectorAll("nav button")) {
    button.classList.toggle("is-active", button.querySelector(".path")?.textContent === path);
  }
}

async function save() {
  if (!current || !dirty) return;
  const content = editor.value;
  const { status, body } = await api(`/api/page?path=${encodeURIComponent(current.path)}`, {
    method: "PUT",
    body: JSON.stringify({ content, base_hash: current.hash }),
  });

  if (status === 409) {
    el("conflict").hidden = false;
    current.theirs = body.current;
    current.theirHash = body.hash;
    say("檔案在外面被改過", "bad");
    return;
  }
  current.content = content;
  current.hash = body.hash;
  dirty = false;
  renderChecks(body.checks);
  renderDiff();
  say(`已存檔 ${new Date().toLocaleTimeString()}`);
}

editor.addEventListener("input", () => {
  dirty = true;
  render(editor.value);
  say("編輯中…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800); // autosave once typing stops
});

// ---------- tabs ----------
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    for (const other of document.querySelectorAll(".tab")) other.classList.toggle("is-active", other === tab);
    for (const panel of document.querySelectorAll(".panel")) {
      panel.classList.toggle("is-active", panel.dataset.panel === tab.dataset.tab);
    }
  });
}

function renderDiff() {
  const target = el("diff");
  if (!current) return;
  if (current.base === null) {
    target.textContent = "這是新的一頁，main 上還沒有。";
    return;
  }
  target.innerHTML = "";
  for (const part of diffLines(current.base, editor.value)) {
    const node = document.createElement(part.added ? "ins" : part.removed ? "del" : "span");
    node.textContent = part.value;
    target.append(node);
  }
}

function renderChecks(checks) {
  const target = el("checks");
  target.innerHTML = "";
  const failing = checks.filter((check) => check.level === "error");
  el("approve").dataset.blocked = failing.length > 0 ? "1" : "0";
  if (failing.length > 0) {
    el("approve").disabled = true;
    el("approve").title = `先修好「檢查結果」裡的 ${failing.length} 個錯誤`;
  }

  if (checks.length === 0) {
    target.innerHTML = '<div class="check ok">沒有問題</div>';
    return;
  }
  for (const check of checks) {
    const row = document.createElement("div");
    row.className = `check ${check.level}`;
    row.textContent = `${check.level === "error" ? "✗" : "!"} ${check.message}`;
    target.append(row);
  }
}

async function renderSources(content) {
  const target = el("sources");
  target.innerHTML = "";
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  const ids = match ? [...match[1].matchAll(/([0-9A-HJKMNP-TV-Z]{26})/g)].map((m) => m[1]) : [];

  if (ids.length === 0) {
    target.textContent = "這頁沒有列出來源紀錄。";
    return;
  }
  for (const id of ids) {
    const { status, body } = await api(`/api/source?id=${encodeURIComponent(id)}`);
    const block = document.createElement("div");
    block.className = "source";
    if (status !== 200) {
      block.innerHTML = `<code></code><p>找不到這筆紀錄</p>`;
      block.querySelector("code").textContent = id;
    } else {
      block.innerHTML = `<code></code><strong></strong><p></p>`;
      block.querySelector("code").textContent = `${id} · ${body.author ?? ""} · ${body.created_at ?? ""}`;
      block.querySelector("strong").textContent = body.title ?? "";
      block.querySelector("p").textContent = body.body ?? "";
    }
    target.append(block);
  }
}

// ---------- actions ----------
el("discard").addEventListener("click", async () => {
  if (!current || !confirm(`捨棄 ${current.path} 的修改？`)) return;
  const { body } = await api(`/api/discard?path=${encodeURIComponent(current.path)}`, { method: "POST" });
  say(body.removed ? "已刪除這一頁" : "已還原成 main 的版本");
  current = null;
  editor.value = "";
  render("");
  await loadPages();
});

function showTab(name) {
  for (const tab of document.querySelectorAll(".tab")) tab.classList.toggle("is-active", tab.dataset.tab === name);
  for (const panel of document.querySelectorAll(".panel")) panel.classList.toggle("is-active", panel.dataset.panel === name);
}

el("approve").addEventListener("click", async () => {
  await save();
  const { status, body } = await api("/api/approve", { method: "POST" });
  if (status === 422) {
    const target = el("checks");
    target.innerHTML = "";
    for (const file of body.failing) {
      const block = document.createElement("div");
      block.className = "failing";
      const name = document.createElement("strong");
      name.textContent = file.path;
      block.append(name);
      for (const check of file.checks) {
        const row = document.createElement("div");
        row.className = `check ${check.level}`;
        row.textContent = `${check.level === "error" ? "✗" : "!"} ${check.message}`;
        block.append(row);
      }
      block.addEventListener("click", () => openPage(file.path));
      target.append(block);
    }
    showTab("checks");
    say(`${body.failing.length} 個檔案沒通過檢查，看「檢查結果」`, "bad");
    return;
  }
  say(status === 200 ? "已 commit，還沒上 GitHub。可以按「送出 PR」了" : `commit 失敗：${body.error}`, status === 200 ? "good" : "bad");
  await loadPages();
});

el("publish").addEventListener("click", async () => {
  if (!confirm("送出 PR 會 push 到 GitHub。確定嗎？")) return;
  say("送出中…");
  const { status, body } = await api("/api/publish", { method: "POST" });
  if (status !== 200) {
    say(`送出失敗：${body.error}`, "bad");
    return;
  }
  say(body.url ? `已送出：${body.url}` : body.message, "good");
  if (body.url) window.open(body.url, "_blank", "noopener");
});

// ---------- outside edits ----------
el("take-theirs").addEventListener("click", () => {
  editor.value = current.theirs;
  current.hash = current.theirHash;
  current.content = current.theirs;
  dirty = false;
  render(editor.value);
  renderDiff();
  el("conflict").hidden = true;
  say("已載入外部的版本");
});

el("keep-mine").addEventListener("click", async () => {
  current.hash = current.theirHash; // overwrite deliberately, with the author's consent
  el("conflict").hidden = true;
  dirty = true;
  await save();
});

const events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
events.addEventListener("message", async (event) => {
  if (event.data === "ready") return;
  await loadPages();
  if (!current || !event.data.endsWith(current.path.split("/").at(-1))) return;

  if (dirty) {
    const { body } = await api(`/api/page?path=${encodeURIComponent(current.path)}`);
    if (body.hash !== current.hash) {
      current.theirs = body.content;
      current.theirHash = body.hash;
      el("conflict").hidden = false;
    }
    return;
  }
  await openPage(current.path); // no unsaved edits: just take the new version
});

loadPages();
