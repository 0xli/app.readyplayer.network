// app.readyplayer.network — the member app.
//
// Sign in with Beagle, see the profile you already published in Beagle, add
// what only ReadyPlayer needs, pick a plan, and the entry points. No framework,
// no build step; the one bundled dependency is assets/vendor/beagle-connect.js
// (see app/vendor.sh for how it is made).
import { doors, exportSiteIdentity, readLaunch, setSiteName, signIn, siteIdentity, siteSignIn } from "./vendor/beagle-connect.js";
import { beagleChatUrl, isInstalledOrigin, isWebOrigin, openChat } from "./vendor/beagle-embed.js";

const API = window.RP.api;
const SITE_ORIGIN = window.RP.siteOrigin || "https://readyplayer.network";
const BRIDGE_URL = window.RP.bridgeUrl || "";
const EMBED_ASSETS = window.RP.embedAssets || {};
const TOKEN_KEY = "rp-token";

const $ = (id) => document.getElementById(id);
const zh = () => document.documentElement.getAttribute("data-lang") === "zh";
const t = (cn, en) => (zh() ? cn : en);

let me = null;
/** Whether the API has a mail transport at all. False means no "email me a
 *  code" button, because there is nothing behind it (server/lib/email.mjs). */
let canVerifyEmail = false;

// The bilingual labels for the server's closed lists (ROLES and PURPOSES in
// server/lib/config.mjs). The ids live there because they are validated there;
// the labels live here because zh/en is the app's business, not the API's.
// test/smoke.mjs fails if the two drift apart — a role the server rejects would
// otherwise sit in this dropdown looking selectable.
const ROLE_LABELS = [
  ["founder", "创始人", "Founder"],
  ["engineer", "工程师", "Engineer"],
  ["researcher", "研究员 / 科学家", "Researcher / scientist"],
  ["operations", "运营", "Operations"],
  ["marketing", "市场", "Marketing"],
  ["finance", "财务", "Finance"],
  ["investor", "投资人", "Investor"],
  ["user", "用户", "User"],
  ["other", "其他", "Other"],
];

const PURPOSE_LABELS = [
  ["partner", "找合伙人", "A partner"],
  ["job", "找工作", "A job"],
  ["founding-team", "组创始团队", "A founding team"],
  ["engineers", "找工程师", "Engineers"],
  ["ai-expert", "找 AI 专家", "An AI expert"],
  ["investment", "找投资", "Investment"],
  ["volunteer", "做志愿者", "To volunteer"],
  ["internship", "找实习", "An internship"],
];

const roleLabel = (id) => {
  const row = ROLE_LABELS.find((r) => r[0] === id);
  return row ? t(row[1], row[2]) : "";
};
const purposeLabel = (id) => {
  const row = PURPOSE_LABELS.find((r) => r[0] === id);
  return row ? t(row[1], row[2]) : id;
};

// ── which Beagle this browser uses ─────────────────────────────────────────
//
// There are two, and they hold DIFFERENT keys: the installed client (desktop or
// CLI, serving 127.0.0.1:8766) and the browser client at app.beagle.chat. The
// member picks explicitly instead of us probing, for two reasons:
//
//  - An https page cannot reliably detect a local http Beagle. Chrome blocks the
//    probe fetch to 127.0.0.1 in about 100 ms, so auto-detection silently falls
//    back to the web client — and a desktop user ends up signed in as a second
//    identity they never chose. Production showed exactly this.
//  - The choice is also where their chat lives, which is where "Open Beagle
//    chat" and "Edit in Beagle" have to point.
//
// Passing a single origin to signIn() skips the probe entirely: pickUiOrigin
// returns the last (here, only) candidate without fetching anything.
const BEAGLE = {
  local: "http://127.0.0.1:8766",
  web: "https://app.beagle.chat",
};
const UI_KEY = "rp-beagle-ui";

const isBeagleOrigin = (o) =>
  o === BEAGLE.web || /^http:\/\/(127\.0\.0\.1|localhost):87\d\d$/.test(o || "");

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

/** Which Beagle this member signed in with. The server's record first: it
 *  survives a new browser, a new device, and an Apps-tab launch. localStorage is
 *  the fallback for the moment between signing in and the record coming back. */
function beagleUi() {
  for (const v of [me?.uiOrigin, store.get(UI_KEY)]) if (isBeagleOrigin(v)) return v;
  return null;
}

// ── telling the apex site who is signed in ─────────────────────────────────
//
// readyplayer.network and app.readyplayer.network are different ORIGINS, so the
// apex cannot read this app's localStorage and cannot see the Bearer token. But
// they are the same SITE, so a cookie scoped to .readyplayer.network is readable
// by both.
//
// What goes in it is a display hint and nothing else: a name, an avatar URL, a
// truncated userid. No token, no address, nothing that authorises anything —
// because the apex is a static page with no way to verify a claim, exactly as
// its beagle.js greeting already says. Someone who forges this cookie changes
// what their own browser draws in their own nav bar. That is the whole blast
// radius, and it is why the token stays in localStorage where the apex cannot
// reach it.
const WHO_COOKIE = "rp_who";

function writeWho(user) {
  try {
    // Only put compact https:// avatar URLs in the cookie (data: URLs would exceed 4 KB).
    const cookieAvatar = typeof user.avatarUrl === "string" && /^https:\/\//i.test(user.avatarUrl) ? user.avatarUrl : null;
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({
      n: displayName(user),
      a: cookieAvatar,
      u: (user.userid || "").slice(0, 8),
    }))));
    // Lax, not None: this rides on top-level navigation to the apex, which is
    // the only journey that needs it.
    document.cookie = `${WHO_COOKIE}=${payload}; Domain=.readyplayer.network; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax; Secure`;
  } catch { /* private mode, or a browser refusing the domain — the nav just says Sign in */ }
}

function clearWho() {
  try {
    document.cookie = `${WHO_COOKIE}=; Domain=.readyplayer.network; Path=/; Max-Age=0; SameSite=Lax; Secure`;
  } catch { /* nothing to clear */ }
}

/** Explicit ReadyPlayer display name wins, then Beagle published name, then
 *  non-generic sign-in node name, then truncated userid. */
const displayName = (u) => {
  const pick = [u?.profile?.displayName, u?.displayName, u?.beagle?.displayName, u?.name]
    .map((v) => String(v || "").trim())
    .find((v) => v && !/^(visitor|member)$/i.test(v));
  return pick || (u?.userid ? `${u.userid.slice(0, 8)}…` : "");
};

function initialsOf(name, userid) {
  const s = String(name || "").trim();
  if (!s || /…$/.test(s)) return String(userid || "RP").slice(0, 2).toUpperCase();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

// ── talking to the API ─────────────────────────────────────────────────────

const token = {
  get: () => store.get(TOKEN_KEY),
  set: (v) => store.set(TOKEN_KEY, v),
  clear: () => store.del(TOKEN_KEY),
};

async function api(method, path, body) {
  const headers = {};
  const tk = token.get();
  if (tk) headers.authorization = `Bearer ${tk}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await r.json(); } catch { /* empty body */ }
  if (r.status === 401) {
    // The token is gone or expired. Not an error to shout about — it is what
    // "signed out" looks like from here.
    token.clear();
    me = null;
    throw Object.assign(new Error(json?.error || "signed out"), { signedOut: true });
  }
  if (!r.ok) throw Object.assign(new Error(json?.error || `${method} ${path} → ${r.status}`), { fields: json?.fields });
  return json;
}

// ── screens ────────────────────────────────────────────────────────────────

function show(which) {
  for (const id of ["loading", "signedout", "member"]) $(id).hidden = id !== which;
  const navChat = $("nav-chat");
  if (navChat) navChat.hidden = which !== "member";
}

function say(msg, kind = "error") {
  const box = $("banner");
  box.hidden = !msg;
  box.className = `banner ${kind}`;
  box.textContent = msg || "";
}

/** Build DOM from text, never from HTML: every string here came from a member
 *  or from their public Beagle record, and either can contain markup. */
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") n.textContent = v;
    else if (k === "class") n.className = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
}

/** A link a member published, as something safe to click. Only http(s) and
 *  mailto survive; anything else renders as plain text. */
function linkHref(kind, value) {
  const v = String(value || "").trim();
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@/, "");
  switch (kind) {
    case "github": return `https://github.com/${encodeURIComponent(handle)}`;
    case "x": return `https://x.com/${encodeURIComponent(handle)}`;
    case "linkedin": return `https://www.linkedin.com/in/${encodeURIComponent(handle)}`;
    case "email": return /^[^\s@]+@[^\s@]+$/.test(v) ? `mailto:${v}` : null;
    case "site": return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(v) ? `https://${v}` : null;
    default: return null;
  }
}

const LINK_LABEL = { github: "GitHub", x: "X", linkedin: "LinkedIn", site: "Site", email: "Email" };

function linksNode(links) {
  if (!links?.length) return el("span", { class: "muted", text: "—" });
  const wrap = el("span");
  links.forEach((l, i) => {
    if (i) wrap.append(" · ");
    const href = linkHref(l.kind, l.value);
    const label = `${LINK_LABEL[l.kind] || l.kind}: ${l.value}`;
    wrap.append(href ? el("a", { href, target: "_blank", rel: "noopener", text: label }) : el("span", { text: label }));
  });
  return wrap;
}

function kv(rows) {
  const dl = el("dl", { class: "kv" });
  for (const [label, value] of rows) {
    dl.append(el("dt", { text: label }));
    const dd = el("dd");
    if (value instanceof Node) dd.append(value);
    else if (value) dd.textContent = value;
    else dd.append(el("span", { class: "muted", text: "—" }));
    dl.append(dd);
  }
  return dl;
}

// ── rendering the member ───────────────────────────────────────────────────

function renderMember() {
  const whoName = displayName(me);
  $("who").textContent = whoName;
  const av = $("avatar");
  const fb = $("avatar-fallback");
  const showFallback = () => {
    av.hidden = true;
    if (fb) {
      fb.textContent = initialsOf(whoName, me.userid);
      fb.hidden = false;
    }
  };
  if (me.avatarUrl) {
    av.src = me.avatarUrl;
    av.hidden = false;
    if (fb) fb.hidden = true;
    av.onerror = showFallback;
  } else {
    showFallback();
  }
  $("plan").textContent = me.plan;
  $("ens").textContent = me.beagle?.ens || "";
  $("userid").textContent = me.userid;
  $("addr").textContent = me.address || t("(未提供,加好友功能不可用)", "(not provided — add-friend is unavailable)");
  const siteCard = $("site-key-card");
  if (siteCard) siteCard.hidden = me.door !== "site";
  renderBeagleLinks();
  renderBeagle();
  renderRp();
  updateChatDockChrome();
  gate();
  show("member");
}

/** Every "open your Beagle" link points at the ONE client they signed in with. */
function renderBeagleLinks() {
  const ui = beagleUi();
  for (const id of ["open-beagle", "edit-in-beagle", "group-open", "mgr-open"]) {
    const node = $(id);
    if (!node) continue;
    if (ui) {
      if (id === "mgr-open" && mgrInfo?.address) node.href = beagleChatUrl(ui, mgrInfo.address);
      else if (id === "group-open" && group?.address) node.href = beagleChatUrl(ui, group.address);
      else node.href = `${ui}/`;
    } else {
      node.removeAttribute("href");
    }
    node.hidden = !ui;
  }
}

function renderBeagle() {
  const b = me.beagle;
  const view = $("beagle-view");
  view.textContent = "";
  $("beagle-empty").hidden = Boolean(b);
  if (!b) return;
  view.append(kv([
    [t("名字", "Name"), b.displayName],
    [t("简介", "Bio"), b.bio],
    [t("链接", "Links"), linksNode(b.links)],
    [t("Beagle 名", "Beagle name"), b.ens],
  ]));
}

/** The email address with the only badge on this page we have earned: it says
 *  verified ONLY after a code we mailed came back. */
function emailNode(p) {
  if (!p.email) return null;
  const wrap = el("span");
  wrap.append(el("span", { text: p.email }), " ");
  wrap.append(el("span", {
    class: `badge${me.emailVerified ? " yes" : ""}`,
    text: me.emailVerified ? t("已验证", "verified") : t("未验证", "unverified"),
  }));
  return wrap;
}

function resumeNode(p) {
  if (!p.resume) return null;
  const href = /^https?:\/\//i.test(p.resume) ? p.resume : `https://${p.resume}`;
  return el("a", { href, target: "_blank", rel: "noopener", text: p.resume });
}

function avatarNode(p) {
  const src = p.avatar || me?.avatarUrl;
  if (!src) return null;
  return el("img", { class: "kv-avatar", src, alt: "" });
}

// ── optional avatar picker (file upload resized to 160x160 or https URL) ──

const avatarDraft = { i: "", f: "" };

function renderAvatarPicker(prefix, value, nameHint) {
  avatarDraft[prefix] = value || "";
  const preview = $(`${prefix}-avatar-preview`);
  const input = $(`${prefix}-avatar`);
  const clearBtn = $(`${prefix}-avatar-clear`);
  if (input) {
    input.value = value && !value.startsWith("data:") ? value : "";
    input.placeholder = value && value.startsWith("data:")
      ? t("已上传图片（点「清除」可移除）", "Uploaded photo (click Remove to clear)")
      : "https://… (optional)";
  }
  if (clearBtn) clearBtn.hidden = !value;
  if (!preview) return;
  preview.textContent = "";
  if (value && (/^https:\/\//i.test(value) || /^data:image\//i.test(value))) {
    const img = el("img", { src: value, alt: "" });
    img.onerror = () => {
      preview.textContent = initialsOf(nameHint || displayName(me), me?.userid);
    };
    preview.append(img);
  } else {
    preview.textContent = initialsOf(nameHint || displayName(me), me?.userid);
  }
}

function readAvatarDraft(prefix) {
  const typed = ($(`${prefix}-avatar`)?.value || "").trim();
  if (typed) return typed;
  return avatarDraft[prefix] || "";
}

async function compressAvatarFile(file) {
  if (!file || (file.type && !file.type.startsWith("image/"))) {
    throw new Error(t("请选择图片文件（PNG / JPG / WebP / GIF）。", "Please pick an image file (PNG, JPG, WebP, or GIF)."));
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(t("无法读取这张图片。", "Could not read that image.")));
      i.src = url;
    });
    const size = 160;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const sx = Math.max(0, ((img.naturalWidth || img.width) - side) / 2);
    const sy = Math.max(0, ((img.naturalHeight || img.height) - side) / 2);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    let dataUrl = canvas.toDataURL("image/webp", 0.82);
    if (!dataUrl.startsWith("data:image/webp") || dataUrl.length > 60000) {
      dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    }
    if (dataUrl.length > 60000) {
      dataUrl = canvas.toDataURL("image/jpeg", 0.65);
    }
    if (dataUrl.length > 65000) {
      throw new Error(t("图片压缩后仍过大，请换一张更小的图片。", "Image is still too large after resizing — please choose a smaller photo."));
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function wireAvatarPicker(prefix) {
  const fileEl = $(`${prefix}-avatar-file`);
  const urlEl = $(`${prefix}-avatar`);
  const clearEl = $(`${prefix}-avatar-clear`);
  const nameEl = $(`${prefix}-displayName`);
  fileEl?.addEventListener("change", async () => {
    const file = fileEl.files?.[0];
    fileEl.value = "";
    if (!file) return;
    try {
      const dataUrl = await compressAvatarFile(file);
      renderAvatarPicker(prefix, dataUrl, nameEl?.value);
      say("");
    } catch (err) {
      say(String(err?.message || err));
    }
  });
  urlEl?.addEventListener("input", () => {
    const v = urlEl.value.trim();
    if (v) renderAvatarPicker(prefix, v, nameEl?.value);
    else if (!avatarDraft[prefix]?.startsWith("data:")) renderAvatarPicker(prefix, "", nameEl?.value);
  });
  nameEl?.addEventListener("input", () => {
    if (!readAvatarDraft(prefix)) renderAvatarPicker(prefix, "", nameEl.value);
  });
  clearEl?.addEventListener("click", () => {
    renderAvatarPicker(prefix, "", nameEl?.value);
  });
}

function renderRp() {
  const p = me.profile || {};
  const view = $("rp-view");
  view.textContent = "";
  const empty = !p.displayName && !p.avatar && !p.email && !p.resume && !p.city && !p.role && !(p.purpose || []).length
    && !p.oneLiner && !p.whatIBuild && !p.lookingFor && !(p.skills || []).length && !(p.links || []).length;
  if (empty) {
    view.append(el("p", { class: "muted", style: "margin:0",
      text: t("还没有。点「编辑」补上,或者直接告诉会员经理。", "Nothing yet. Hit Edit, or just tell the membership manager.") }));
  } else {
    view.append(kv([
      [t("显示名", "Display name"), p.displayName || me.displayName],
      [t("头像", "Avatar"), avatarNode(p)],
      [t("邮箱", "Email"), emailNode(p)],
      [t("LinkedIn / 简历", "LinkedIn / résumé"), resumeNode(p)],
      [t("所在地", "Location"), p.city],
      [t("你是", "You are"), roleLabel(p.role)],
      [t("来做什么", "Came for"), (p.purpose || []).map(purposeLabel).join(" · ")],
      [t("一句话", "One-liner"), p.oneLiner],
      [t("在做什么", "What I build"), p.whatIBuild],
      [t("在找什么", "Looking for"), p.lookingFor],
      [t("技能", "Skills"), (p.skills || []).join(", ")],
      [t("其他链接", "Other links"), (p.links || []).length ? linksNode(p.links) : null],
    ]));
  }
  renderEmailVerify();
  // The form mirrors the record; it is only shown when they ask to edit.
  const currentName = p.displayName || me.displayName || "";
  $("f-displayName").value = currentName;
  renderAvatarPicker("f", p.avatar || "", currentName);
  $("f-email").value = p.email || "";
  $("f-resume").value = p.resume || "";
  $("f-city").value = p.city || "";
  fillRole($("f-role"), p.role);
  fillPurpose($("f-purpose"), "f", p.purpose);
  $("f-oneLiner").value = p.oneLiner || "";
  $("f-whatIBuild").value = p.whatIBuild || "";
  $("f-lookingFor").value = p.lookingFor || "";
  $("f-skills").value = (p.skills || []).join(", ");
  $("f-links").value = (p.links || []).map((l) => `${l.kind}: ${l.value}`).join("\n");
}

// ── the two controls built from the closed lists ───────────────────────────

function fillRole(sel, chosen) {
  sel.textContent = "";
  sel.append(el("option", { value: "", text: t("— 选一个 —", "— pick one —") }));
  for (const [id, cn, en] of ROLE_LABELS) {
    const o = el("option", { value: id, text: t(cn, en) });
    if (id === chosen) o.setAttribute("selected", "selected");
    sel.append(o);
  }
  sel.value = chosen || "";
}

/** `prefix` keeps the intake form's checkboxes and the profile form's from
 *  sharing an id — two elements with one id and only the first is ever found. */
function fillPurpose(box, prefix, chosen) {
  const have = new Set(chosen || []);
  box.textContent = "";
  for (const [id, cn, en] of PURPOSE_LABELS) {
    const input = el("input", { type: "checkbox", id: `${prefix}-p-${id}`, value: id });
    if (have.has(id)) input.checked = true;
    box.append(el("label", { for: `${prefix}-p-${id}` }, input, el("span", { text: t(cn, en) })));
  }
}

const readPurpose = (box) => [...box.querySelectorAll("input:checked")].map((i) => i.value);

function editing(on) {
  $("profile").hidden = !on;
  $("rp-view").hidden = on;
  $("rp-edit").hidden = on;
  if (on) $("f-displayName").focus();
}

// ── the three things we have to ask for ────────────────────────────────────
//
// email, "LinkedIn or résumé", location. The server decides which are missing
// (profileGaps in server/lib/profile.mjs) and says so in `user.gaps`, so a
// LinkedIn already published in Beagle counts and is not asked for twice.
//
// WHERE THIS ASK BELONGS, EVENTUALLY: in the Beagle sign-in popup, next to the
// signature — one form, one submit, and the address lands on the member's own
// Beagle profile where every app they use can read it. That needs a change in
// the Beagle clients and in @decentnetwork/beagle-connect; it is specified in
// docs/DISPATCH-2026-10-31-beagle-signin-email.md. Until it ships, this card is
// the ask, and it stays afterwards as the fallback and as the place the
// verification code is entered.
const SKIP_KEY = "rp-intake-skipped";

/** sessionStorage, not localStorage, and that is the whole design of "Later":
 *  it lasts this tab's session, so the ask comes back at the next sign-in
 *  without ever becoming a wall between a member and the group they joined. */
const skipped = () => { try { return sessionStorage.getItem(SKIP_KEY) === "1"; } catch { return false; } };

function gate() {
  const gaps = me?.gaps || [];
  const blocked = Boolean(gaps.length) && !skipped();
  $("intake").hidden = !blocked;
  $("member-rest").hidden = blocked;
  if (!blocked) return;
  const p = me.profile || {};
  const initName = p.displayName || me.displayName || "";
  $("i-displayName").value = initName;
  renderAvatarPicker("i", p.avatar || "", initName);
  $("i-email").value = p.email || "";
  $("i-resume").value = p.resume || "";
  $("i-city").value = p.city || "";
  fillRole($("i-role"), p.role);
  fillPurpose($("i-purpose"), "i", p.purpose);
}

/** A whole profile with `over` applied.
 *
 *  PUT /api/me/profile replaces the profile entirely — that is deliberate, it
 *  is the only way a field can be cleared. So a form that posts only its own
 *  boxes wipes every field it does not carry, and the intake form carries five
 *  of them. This is what keeps "Save and continue" from erasing the skills
 *  somebody filled in last month.
 *
 *  It echoes back WHATEVER the API sent, rather than a list of field names.
 *  This used to be that list, and the list was the bug: the membership manager
 *  can now set fields by chat — `phone` first — and a build of this app that
 *  had never heard of `phone` would have dropped it on the next save, silently,
 *  because it was not one of the ten names typed here. A field this app does
 *  not render is still a field it must not destroy.
 *
 *  `links` are remapped because the API sends `verified`/`method` on each and
 *  takes only `kind`/`value`; `intake` is the matchmaker's and the API
 *  preserves it on its own. */
function profilePayload(over = {}) {
  const { intake: _intake, links, ...rest } = me?.profile || {};
  return {
    ...rest,
    links: (links || []).map((l) => ({ kind: l.kind, value: l.value })),
    ...over,
  };
}

/** Red-outline a form field and say why, right under it. Cleared as soon as the
 *  member types in it, so the red only ever means "this is still the problem". */
function markInvalid(inputId, message) {
  const input = $(inputId);
  if (!input) return;
  input.setAttribute("aria-invalid", "true");
  input.classList.add("field-invalid");
  let msg = input.parentElement.querySelector(`.field-msg[data-for="${inputId}"]`);
  if (!msg) {
    msg = el("p", { class: "field-msg", "data-for": inputId, role: "alert" });
    input.insertAdjacentElement("afterend", msg);
  }
  msg.textContent = message;
  const clear = () => {
    input.removeAttribute("aria-invalid");
    input.classList.remove("field-invalid");
    msg.remove();
    input.removeEventListener("input", clear);
  };
  input.addEventListener("input", clear);
}

function clearInvalid(formEl) {
  for (const n of formEl.querySelectorAll(".field-invalid")) {
    n.removeAttribute("aria-invalid");
    n.classList.remove("field-invalid");
  }
  for (const n of formEl.querySelectorAll(".field-msg")) n.remove();
}

/** Server field names -> intake input ids, for a 400 that names what it refused. */
const INTAKE_FIELD_IDS = { displayName: "i-displayName", avatar: "i-avatar", email: "i-email", resume: "i-resume", city: "i-city", role: "i-role", purpose: "i-purpose" };

async function saveIntake(e) {
  e.preventDefault();
  const form = $("intake-form");
  clearInvalid(form);
  const name = $("i-displayName").value.trim();
  const avatar = readAvatarDraft("i");
  const email = $("i-email").value.trim();
  const resume = $("i-resume").value.trim();
  const city = $("i-city").value.trim();
  // The server already told us whether a LinkedIn link or Beagle name already answers these.
  const nameAnswered = name || !(me?.gaps || []).includes("displayName");
  const resumeAnswered = resume || !(me?.gaps || []).includes("resume");
  const missing = [];
  if (!nameAnswered) { missing.push(t("显示名", "display name")); markInvalid("i-displayName", t("请填写显示名", "Display name is required")); }
  if (!email) { missing.push(t("邮箱", "email")); markInvalid("i-email", t("请填写邮箱", "Email is required")); }
  if (!resumeAnswered) { missing.push(t("LinkedIn 或简历", "LinkedIn or résumé")); markInvalid("i-resume", t("请填写 LinkedIn 或简历链接", "LinkedIn or résumé link is required")); }
  if (!city) { missing.push(t("所在地", "location")); markInvalid("i-city", t("请填写所在地", "Location is required")); }
  if (missing.length) {
    say(t(`还缺:${missing.join("、")}`, `Still missing: ${missing.join(", ")}`));
    const first = form.querySelector(".field-invalid");
    if (first) { first.scrollIntoView({ block: "center", behavior: "smooth" }); first.focus({ preventScroll: true }); }
    return;
  }
  $("intake-save").disabled = true;
  try {
    const res = await api("PUT", "/api/me/profile", profilePayload({
      displayName: name,
      avatar,
      email, resume, city,
      role: $("i-role").value,
      purpose: readPurpose($("i-purpose")),
    }));
    me = res.user;
    writeWho(me);
    renderMember();
    syncLiveChatProfile();
    loadAll();
    say(t("收到,谢谢。", "Got it, thank you."), "ok");
    setTimeout(() => say(""), 2500);
  } catch (err) {
    if (err.signedOut) show("signedout");
    else {
      say(String(err?.message || err));
      // The API names the fields it refused; point at them in the form too.
      for (const f of err.fields || []) {
        if (INTAKE_FIELD_IDS[f]) markInvalid(INTAKE_FIELD_IDS[f], t("这一项的格式不对", "This one could not be read"));
      }
    }
  } finally {
    $("intake-save").disabled = false;
  }
}

function skipIntake() {
  try { sessionStorage.setItem(SKIP_KEY, "1"); } catch { /* private mode: the ask simply stays */ }
  gate();
  loadAll();
  say(t("好 —— 下次登录再问。会员经理也可以帮你填。",
        "Fine — we will ask again next sign-in. The membership manager can also take it from you."), "ok");
  setTimeout(() => say(""), 4000);
}

// ── verifying the email address ────────────────────────────────────────────

function renderEmailVerify() {
  const box = $("email-verify");
  const addr = me?.profile?.email || "";
  // Nothing to verify, already done, or we have no way to send: stay down.
  if (!addr || me.emailVerified || !canVerifyEmail) { box.hidden = true; return; }
  box.hidden = false;
  const pending = me.emailPending === addr;
  $("ev-state").textContent = pending
    ? t(`验证码已发往 ${addr},填进去就完成了。`, `A code went to ${addr} — enter it to finish.`)
    : t(`${addr} 还没验证。`, `${addr} is not verified yet.`);
  $("ev-code").hidden = !pending;
  $("ev-check").hidden = !pending;
}

async function sendEmailCode() {
  $("ev-send").disabled = true;
  try {
    const r = await api("POST", "/api/me/email/code");
    me = { ...me, emailPending: r.sentTo };
    renderEmailVerify();
    $("ev-code").focus();
    say(t(`验证码已发到 ${r.sentTo},15 分钟内有效。`, `A code is on its way to ${r.sentTo}. It is good for 15 minutes.`), "ok");
  } catch (err) {
    if (!err.signedOut) say(String(err?.message || err));
  } finally {
    $("ev-send").disabled = false;
  }
}

async function checkEmailCode() {
  const code = $("ev-code").value.trim();
  if (!code) return;
  $("ev-check").disabled = true;
  try {
    me = (await api("POST", "/api/me/email/verify", { code })).user;
    $("ev-code").value = "";
    renderMember();
    say(t("邮箱已验证。", "Email verified."), "ok");
    setTimeout(() => say(""), 2500);
  } catch (err) {
    if (!err.signedOut) say(String(err?.message || err));
  } finally {
    $("ev-check").disabled = false;
  }
}

// ── sign in ────────────────────────────────────────────────────────────────

async function afterAuth(res) {
  token.set(res.token);
  canVerifyEmail = Boolean(res.canVerifyEmail);
  me = res.user;
  writeWho(me);
  renderMember();
  say("");
  loadAll();
}

function loadAll() {
  loadPlans();
  loadGroup();
  loadMeeting();
  loadManager();
  flushPendingChat();
}

async function doSiteSignIn() {
  for (const b of document.querySelectorAll("[data-signin]")) b.disabled = true;
  try {
    const { nonce } = await api("GET", "/api/auth/nonce");
    const who = await siteSignIn({ nonce });
    store.del(UI_KEY);
    await afterAuth(await api("POST", "/api/auth/sign-in", who));
  } catch (err) {
    const code = err?.code;
    if (code === "private-window") {
      say(t(
        "当前是无痕/隐私窗口,关闭后浏览器密钥会丢失。请改用普通窗口,或选下方桌面版 / 网页版 Beagle 登录。",
        "This looks like a private window where a browser key would be lost on close. Use a normal window or pick desktop / web Beagle below.",
      ));
    } else if (code === "cannot-store") {
      say(t(
        "浏览器阻止了本站本地存储,无法保存密钥。请改用桌面版或网页版 Beagle 登录。",
        "This browser blocks local storage for this site. Please sign in with desktop or web Beagle instead.",
      ));
    } else {
      say(String(err?.message || err));
    }
  } finally {
    for (const b of document.querySelectorAll("[data-signin]")) b.disabled = false;
  }
}

async function doSignIn(kind, btn) {
  if (kind === "site") return doSiteSignIn();
  // Opened SYNCHRONOUSLY, before any await, and parked on about:blank while
  // the nonce is fetched. A pop-up opened after an await has lost the user
  // gesture: Safari and Firefox block it outright and Chrome decides by
  // heuristic, so it passes on a developer's machine and fails for users,
  // looking exactly like "Beagle did not answer".
  const win = window.open("about:blank", "beagle-connect", "width=420,height=560");
  if (!win) {
    say(t("请允许本站弹出窗口,再点一次登录。", "Allow pop-ups for this site, then click sign in again."));
    return;
  }
  const origin = BEAGLE[kind];
  for (const b of document.querySelectorAll("[data-signin]")) b.disabled = true;
  try {
    const { nonce } = await api("GET", "/api/auth/nonce");
    const who = await signIn({ nonce, origins: [origin], existingWindow: win });
    store.set(UI_KEY, who.uiOrigin || origin);
    // Keep the current Bearer token (if any, e.g. from a site-made key) on the
    // request so beagle-service automatically links both identities and carries
    // over profile fields.
    await afterAuth(
      await api("POST", "/api/auth/sign-in", {
        userid: who.userid, nonce, sig: who.sig, origin: location.origin,
        address: who.address, name: who.name, punkId: who.punkId, avatar: who.avatar,
        uiOrigin: who.uiOrigin || origin,
      }),
    );
  } catch (err) {
    try { win.close(); } catch { /* already gone */ }
    const msg = String(err?.message || err);
    // A local Beagle that is not running never answers the popup. Say so, and
    // name the other door, instead of leaving "Beagle did not answer".
    say(kind === "local" && /did not answer/i.test(msg)
      ? t("这台电脑上的 Beagle 没有响应 —— 它在运行吗?也可以用 Beagle 网页版或免安装浏览器密钥登录。",
          "Beagle on this computer did not answer — is it running? You can also use Beagle web or the browser key.")
      : msg);
  } finally {
    for (const b of document.querySelectorAll("[data-signin]")) b.disabled = false;
  }
}

function exportKeyFile() {
  try {
    const file = exportSiteIdentity();
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `readyplayer-beagle-${(me?.userid || "key").slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(t("密钥文件已下载——请妥善保存，不要发给任何人。", "Key file downloaded — keep it safe and never share it."), "ok");
    setTimeout(() => say(""), 4000);
  } catch (err) {
    say(String(err?.message || err));
  }
}

async function signOut() {
  // Revoke the session server-side via beagle-service before clearing localStorage.
  if (token.get()) {
    try { await api("POST", "/api/auth/logout"); } catch { /* best effort */ }
  }
  closeChatDock({ destroy: true });
  token.clear();
  clearWho();
  me = null;
  show("signedout");
  say("");
}

// ── plan ───────────────────────────────────────────────────────────────────

/** Memberships and people are not comparable purchases, so they do not share a
 *  row. The server says which is which (`kind` in PLAN_CATALOG). */
const PLAN_GROUPS = [
  ["membership", "会员档位", "Membership"],
  ["position", "一个人,10% 的投入", "A person, at 10% of full time"],
];

async function loadPlans() {
  try {
    const r = await api("GET", "/api/plans");
    const box = $("plans");
    box.textContent = "";
    for (const [kind, cn, en] of PLAN_GROUPS) {
      const inGroup = r.plans.filter((p) => (p.kind || "membership") === kind);
      if (!inGroup.length) continue;
      const grid = el("div", { class: "plans" });
      for (const p of inGroup) grid.append(planCard(p, r));
      box.append(el("div", { class: "plan-group" }, el("p", { class: "gl", text: t(cn, en) }), grid));
    }
    const note = $("plan-note");
    note.hidden = !r.requested;
    if (r.requested) {
      const name = r.plans.find((p) => p.id === r.requested.plan)?.name || r.requested.plan;
      note.textContent = t(
        `已申请 ${name}。我们会在 Beagle 上联系你;确认之前你仍是 ${r.current} 档。`,
        `You asked for ${name}. We will reach you on Beagle; until it is confirmed you stay on ${r.current}.`,
      );
    }
  } catch (err) {
    if (!err.signedOut) $("plans").textContent = t("档位暂时读不到。", "Could not load plans right now.");
  }
}

function planCard(p, r) {
  const isCurrent = p.id === r.current;
  const isRequested = r.requested?.plan === p.id;
  const card = el("div", { class: `plan${isCurrent ? " current" : ""}${isRequested ? " requested" : ""}` },
    el("span", { class: "pname", text: p.name }),
    el("span", { class: "pprice", text: p.price }),
    // Where the 10% comes from. The number is the argument for the price;
    // without it $2,000/mo is just a number someone picked.
    p.fullTime ? el("span", { class: "pnote",
      text: t(`全职约 ${p.fullTime}`, `10% of ${p.fullTime} full time`) }) : null,
  );
  if (isCurrent) {
    card.append(el("span", { class: "ptag", text: t("✓ 你的档位", "✓ Your plan") }));
  } else if (isRequested) {
    card.append(el("span", { class: "ptag", text: t("已申请", "Requested") }));
    const b = el("button", { class: "btn-quiet", type: "button", text: t("撤回", "Withdraw") });
    b.onclick = () => requestPlan(r.current);
    card.append(b);
  } else {
    const b = el("button", { class: "btn-quiet", type: "button", text: t("选这个", "Choose") });
    b.onclick = () => requestPlan(p.id);
    card.append(b);
  }
  return card;
}

async function requestPlan(id) {
  try {
    await api("PUT", "/api/me/plan-request", { plan: id });
    await loadPlans();
  } catch (err) {
    say(String(err?.message || err));
  }
}

// ── why there is no "add as friend" button ─────────────────────────────────
//
// There was one, calling addFriend() so the member's own Beagle sent the
// request. Measured 2026-09-11: inbound friend requests never reach our peers
// (they run behind NAT on the Mac mini); only requests THEY send form
// friendships. So the button opened a popup that sent something that could not
// arrive. The group and the manager befriend each member themselves, once; the
// honest instruction is "accept the request ReadyPlayer sends you".

// ── the entry points ───────────────────────────────────────────────────────

let group = null;

async function loadGroup() {
  try {
    group = await api("GET", "/api/group/main");
    $("group-addr").textContent = group.address;
    $("group-copy").setAttribute("data-copy", group.address);
    $("group-note").textContent = group.relayNote;
    $("group-count").textContent = String(group.memberCount);
    $("group-join").hidden = group.joined;
    $("group-joined").hidden = !group.joined;
    const embedBtn = $("group-embed-open");
    if (embedBtn) embedBtn.hidden = !group.joined;
    renderBeagleLinks();
    $("group-open").hidden = !group.joined || !beagleUi();
    updateChatDockChrome();
    flushPendingChat();
  } catch (err) {
    if (!err.signedOut) $("group-note").textContent = t("群信息暂时读不到。", "Could not load the group right now.");
  }
}

async function joinGroup() {
  $("group-join").disabled = true;
  try {
    await api("POST", "/api/group/main/join");
    await loadGroup();
    if (group?.address) openChatTarget("group");
  } catch (err) {
    say(String(err?.message || err));
  } finally {
    $("group-join").disabled = false;
  }
}

async function loadMeeting() {
  try {
    const m = await api("GET", "/api/meeting");
    // No host or room id configured yet: hide the button rather than link
    // somewhere invented.
    $("meet-wrap").hidden = !m.ok;
    if (m.ok) {
      $("meet-link").href = m.url;
      for (const n of document.querySelectorAll(".meet-host")) n.textContent = m.host;
    }
  } catch {
    $("meet-wrap").hidden = true;
  }
}

let mgrInfo = null;

async function loadManager() {
  try {
    const m = await api("GET", "/api/manager");
    // Hidden until the manager's identity exists: a button that sends people to
    // an address nobody is running is worse than no button.
    $("mgr-wrap").hidden = !m.ok;
    if (!m.ok) { mgrInfo = null; updateChatDockChrome(); return; }
    mgrInfo = m;
    renderBeagleLinks();
    $("mgr-name").textContent = m.name.toUpperCase();
    $("mgr-addr").textContent = m.address;
    $("mgr-copy").setAttribute("data-copy", m.address);
    updateChatDockChrome();
    flushPendingChat();
  } catch {
    mgrInfo = null;
    $("mgr-wrap").hidden = true;
    updateChatDockChrome();
  }
}

// ── unified chat dock (single userid + single friends list) ────────────────
//
// Every entry point on readyplayer.network and app.readyplayer.network opens
// THIS panel under the signed-in member's exact userid — never minting a second
// browser key on another origin or silently falling back to a mismatched key.
//
// For same-origin browser-key sessions (`me.door === "site"`), the iframe stays
// mounted while hidden and switches between Friends / Manager / Main Group via
// hash navigation (`#/chat?address=...`), so the live P2P peer and friends list
// never restart or drift.
const chatDockState = { identity: "", sameOrigin: false, target: "friends" };
let pendingChat = null;

function readRequestedChat() {
  try {
    const u = new URL(location.href);
    const raw = (u.searchParams.get("chat") || "").trim().toLowerCase();
    if (!["friends", "manager", "group"].includes(raw)) return null;
    u.searchParams.delete("chat");
    history.replaceState(null, "", u.pathname + u.search + u.hash);
    return raw;
  } catch {
    return null;
  }
}

function currentChatIdentity() {
  if (!me?.userid) return "";
  return `${me.userid}:${me.door || "beagle"}:${beagleUi() || ""}`;
}

/** Guarantee beagle-web boots with the exact same keypair as beagle-connect (me.userid). */
function syncSiteIdentityMirror() {
  try {
    const raw = localStorage.getItem("beagle-connect:identity");
    if (!raw) return false;
    const file = JSON.parse(raw);
    if (!file || file.format !== "decent-peer-tox-keypair-v1" || typeof file.publicKey !== "string" || typeof file.secretKey !== "string") {
      return false;
    }
    const mirrorKey = "beagle-web:kv:identity";
    let existing = null;
    try { existing = JSON.parse(localStorage.getItem(mirrorKey) || "null"); } catch { existing = null; }
    if (existing?.v?.publicKey !== file.publicKey || existing?.v?.secretKey !== file.secretKey) {
      localStorage.setItem(mirrorKey, JSON.stringify({
        v: { format: file.format, publicKey: file.publicKey, secretKey: file.secretKey },
      }));
    }
    return true;
  } catch {
    return false;
  }
}

function chatTargetInfo(target) {
  if (target === "manager" && mgrInfo?.address) {
    return { target: "manager", address: mgrInfo.address, title: t("ReadyPlayer 会员经理", "ReadyPlayer Manager") };
  }
  if (target === "group" && group?.address) {
    return { target: "group", address: group.address, title: t("ReadyPlayer 总群", "ReadyPlayer Main Group") };
  }
  return { target: "friends", address: "", title: t("ReadyPlayer 对话", "ReadyPlayer Chat") };
}

function updateChatDockChrome() {
  const idEl = $("chat-dock-id");
  if (idEl) {
    idEl.textContent = me?.userid ? `${me.userid.slice(0, 8)}…` : "";
    idEl.title = me?.userid || "";
    idEl.hidden = !me?.userid;
  }
  const curId = currentChatIdentity();
  if (chatDockState.identity && curId && chatDockState.identity !== curId) {
    closeChatDock({ destroy: true });
  }
  for (const btn of document.querySelectorAll("[data-chat-target]")) {
    const k = btn.dataset.chatTarget;
    if (k === "manager") btn.hidden = !mgrInfo?.address;
    else if (k === "group") btn.hidden = !group?.address;
    btn.setAttribute("aria-pressed", String(k === chatDockState.target));
  }
  const titleEl = $("chat-dock-title");
  if (titleEl && me) titleEl.textContent = chatTargetInfo(chatDockState.target).title;
}

function closeChatDock({ destroy = false } = {}) {
  const dock = $("chat-dock");
  const body = $("chat-dock-body");
  if (dock) dock.hidden = true;
  if (destroy) {
    if (body) body.textContent = "";
    chatDockState.identity = "";
    chatDockState.sameOrigin = false;
    chatDockState.target = "friends";
  }
}

function renderDockFallback(body, message, links) {
  const wrap = el("div", { class: "chat-dock-fallback" }, el("p", { text: message }));
  if (links?.length) {
    const row = el("div", { class: "row" });
    for (const l of links) {
      row.append(el("a", { href: l.href, target: "_blank", rel: "noopener noreferrer", text: l.label }));
    }
    wrap.append(row);
  }
  body.replaceChildren(wrap);
}

function currentEmbedProfile() {
  const name = (me?.profile?.displayName || me?.displayName || me?.beagle?.displayName || me?.name || me?.profile?.email?.split("@")[0] || "Member").trim();
  const rawAvatar = me?.avatarUrl || me?.profile?.avatar || "";
  const avatarDataUrl = typeof rawAvatar === "string" && rawAvatar.startsWith("data:image/") ? rawAvatar : undefined;
  return { name, ...(avatarDataUrl ? { avatarDataUrl } : {}) };
}

function syncLiveChatProfile() {
  if (!me?.userid || me.door !== "site") return;
  const prof = currentEmbedProfile();
  if (prof.name) {
    try { setSiteName(prof.name); } catch { /* best effort */ }
  }
  const frame = $("chat-dock-body")?.querySelector("iframe");
  if (!frame || !chatDockState.sameOrigin) return;
  try {
    frame.contentWindow.fetch("/api/set-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: prof.name,
        description: me?.profile?.oneLiner || "",
        punkId: null,
        avatarDataUrl: prof.avatarDataUrl || null,
        onboarded: true,
      }),
    }).catch(() => {});
  } catch { /* cross-origin or frame still booting */ }
}

function syncChatDockThemeAndLang() {
  const theme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  const lang = document.documentElement.getAttribute("data-lang") === "zh" ? "zh" : "en";
  try {
    const prev = JSON.parse(localStorage.getItem("decentlan.tweaks") || "{}");
    localStorage.setItem("decentlan.tweaks", JSON.stringify({ ...prev, theme, lang }));
  } catch { /* private mode */ }
  const frame = $("chat-dock-body")?.querySelector("iframe");
  if (!frame || !chatDockState.sameOrigin) return;
  try {
    frame.contentDocument?.documentElement?.setAttribute("data-theme", theme);
    frame.contentWindow?.dispatchEvent(new CustomEvent("rp-sync-tweaks", { detail: { theme, lang } }));
  } catch { /* cross-origin or frame still booting */ }
}

/** On-demand @decentnetwork/beagle-embed@0.2.0 chat panel. Loads 0 bytes until opened. */
async function openChatTarget(requested = "friends") {
  if (!me?.userid) return;
  const { target, address, title } = chatTargetInfo(requested);
  const dock = $("chat-dock");
  const titleEl = $("chat-dock-title");
  const body = $("chat-dock-body");
  chatDockState.target = target;
  if (titleEl) titleEl.textContent = title;
  dock.hidden = false;
  updateChatDockChrome();

  const identityKey = currentChatIdentity();
  const existingFrame = body.querySelector("iframe");
  if (existingFrame && chatDockState.identity === identityKey && chatDockState.sameOrigin) {
    try {
      existingFrame.contentWindow.location.hash = address
        ? `#/chat?address=${encodeURIComponent(address)}&t=${Date.now()}`
        : "#/chat";
      return;
    } catch { /* fall through to remount */ }
  }

  const embedProfile = currentEmbedProfile();

  // Case 1: browser-made key on THIS origin (`app.readyplayer.network`).
  if (me.door === "site") {
    const localSite = siteIdentity();
    if (!localSite || localSite.userid !== me.userid || !syncSiteIdentityMirror()) {
      chatDockState.identity = "";
      chatDockState.sameOrigin = false;
      renderDockFallback(body, t(
        `当前会话身份为 ${me.userid.slice(0, 8)}…，但此浏览器本地密钥不匹配或已清除。为避免生成第二个身份，请先退出并重新登录。`,
        `Your session is ${me.userid.slice(0, 8)}…, but this browser's stored site key does not match or was cleared. Sign out and sign in again so we never create a second identity.`,
      ));
      return;
    }
    if (embedProfile.name) {
      try { setSiteName(embedProfile.name); } catch { /* best effort */ }
    }
    try { localStorage.setItem("rp-beagle-active-uid", me.userid); } catch { /* private mode */ }
    syncChatDockThemeAndLang();
    const result = await openChat(body, {
      address,
      clientOrigin: "",
      mode: "in-tab",
      frameUrl: "./beagle-frame.html",
      bridgeUrl: BRIDGE_URL,
      assets: EMBED_ASSETS,
      profile: embedProfile,
    });
    if (result.opened) {
      chatDockState.identity = identityKey;
      chatDockState.sameOrigin = true;
    } else {
      closeChatDock({ destroy: true });
      say(t("请先用浏览器密钥或 Beagle 登录再打开对话。", "Please sign in with a browser key or Beagle first."));
    }
    return;
  }

  // Case 2: external Beagle client (desktop 127.0.0.1:8766 or web app.beagle.chat).
  // NEVER fall back to this origin's site key — that would open a different userid.
  const ui = beagleUi();
  if (ui && (isInstalledOrigin(ui) || isWebOrigin(ui))) {
    const result = await openChat(body, {
      address,
      clientOrigin: ui,
      labels: {
        webClient: t(
          `你的身份 (${me.userid.slice(0, 8)}…) 和好友列表保存在 app.beagle.chat 标签页里，请直接去那里打开对话：`,
          `Your identity (${me.userid.slice(0, 8)}…) and friends list live in the app.beagle.chat tab. Open the chat there:`,
        ),
        openWeb: t("在 Beagle 网页版打开对话 ↗", "Open chat in Beagle web ↗"),
      },
    });
    chatDockState.identity = result.opened ? identityKey : "";
    chatDockState.sameOrigin = false;
    return;
  }

  chatDockState.identity = "";
  chatDockState.sameOrigin = false;
  renderDockFallback(
    body,
    t(
      `你的身份 (${me.userid.slice(0, 8)}…) 保存在你自己的 Beagle 客户端里（不是本页浏览器密钥）。请选择你登录用的 Beagle 打开对话，以保持同一个身份和好友列表：`,
      `Your identity (${me.userid.slice(0, 8)}…) lives in your own Beagle client (not a browser key here). Open the Beagle you signed in with to keep the same identity and friends list:`,
    ),
    [
      { href: beagleChatUrl(BEAGLE.local, address), label: t("本机桌面版 Beagle ↗", "Desktop Beagle (127.0.0.1:8766) ↗") },
      { href: beagleChatUrl(BEAGLE.web, address), label: t("Beagle 网页版 (app.beagle.chat) ↗", "Beagle web (app.beagle.chat) ↗") },
    ],
  );
}

function toggleChatDock() {
  const dock = $("chat-dock");
  if (!dock) return;
  if (dock.hidden) openChatTarget(chatDockState.target || "friends");
  else closeChatDock();
}

function flushPendingChat() {
  if (!pendingChat || !me) return;
  if (pendingChat === "manager" && !mgrInfo?.address) return;
  if (pendingChat === "group" && !group?.address) return;
  const target = pendingChat;
  pendingChat = null;
  openChatTarget(target);
}

function openManagerChat() {
  if (!mgrInfo?.address) return;
  openChatTarget("manager");
}

function openGroupChat() {
  if (!group?.address) return;
  openChatTarget("group");
}

// ── profile ────────────────────────────────────────────────────────────────

const LINK_KINDS = new Set(["x", "github", "linkedin", "site", "email"]);

/** One link per line. A textarea is the honest control for a list someone edits
 *  twice a year, and it needs no framework to make rows appear.
 *
 *  "github: https://…" is accepted, and so is a bare URL — because a bare URL
 *  is what people actually paste. Splitting every line on its first colon is
 *  what the first version did, and it turned "https://github.com/me" into kind
 *  "https", which the server then dropped without a word. So a prefix is only
 *  honoured when it names a kind we know; anything else goes over whole and the
 *  server names it. */
function parseLinks(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(":");
      if (i > 0) {
        const kind = line.slice(0, i).trim().toLowerCase();
        if (LINK_KINDS.has(kind)) return { kind, value: line.slice(i + 1).trim() };
      }
      return { value: line };
    })
    .filter((l) => l.value);
}

const PROFILE_FIELD_IDS = { displayName: "f-displayName", avatar: "f-avatar", email: "f-email", resume: "f-resume", city: "f-city", role: "f-role", purpose: "f-purpose" };

async function saveProfile(e) {
  e.preventDefault();
  const form = $("profile");
  clearInvalid(form);
  $("save").disabled = true;
  try {
    const links = parseLinks($("f-links").value);
    const res = await api("PUT", "/api/me/profile", profilePayload({
      displayName: $("f-displayName").value,
      avatar: readAvatarDraft("f"),
      email: $("f-email").value,
      resume: $("f-resume").value,
      city: $("f-city").value,
      role: $("f-role").value,
      purpose: readPurpose($("f-purpose")),
      oneLiner: $("f-oneLiner").value,
      whatIBuild: $("f-whatIBuild").value,
      lookingFor: $("f-lookingFor").value,
      skills: $("f-skills").value.split(",").map((s) => s.trim()).filter(Boolean),
      links,
    }));
    me = res.user;
    writeWho(me);
    renderMember();
    syncLiveChatProfile();
    editing(false);
    // Never let a link disappear quietly. If the server could not name one, the
    // person who typed it is the only one who can fix it — so say which.
    const kept = (me.profile?.links || []).length;
    if (kept < links.length) {
      say(t(
        `已保存,但有 ${links.length - kept} 个链接没认出来,已忽略。每行写一个链接,或加上前缀:github: / x: / linkedin: / site: / email:`,
        `Saved, but ${links.length - kept} link(s) were not recognised and were left out. One link per line, or prefix it: github: / x: / linkedin: / site: / email:`,
      ));
    } else {
      say(t("已保存。", "Saved."), "ok");
      setTimeout(() => say(""), 2500);
    }
  } catch (err) {
    if (err.signedOut) show("signedout");
    else {
      say(String(err?.message || err));
      for (const f of err.fields || []) {
        if (PROFILE_FIELD_IDS[f]) markInvalid(PROFILE_FIELD_IDS[f], t("这一项的格式不对", "This one could not be read"));
      }
      const first = form.querySelector(".field-invalid");
      if (first) { first.scrollIntoView({ block: "center", behavior: "smooth" }); first.focus({ preventScroll: true }); }
    }
  } finally {
    $("save").disabled = false;
  }
}

async function refreshBeagle() {
  $("beagle-refresh").disabled = true;
  try {
    me = (await api("POST", "/api/me/beagle-refresh")).user;
    writeWho(me);
    renderMember();
  } catch (err) {
    if (!err.signedOut) say(String(err?.message || err));
  } finally {
    $("beagle-refresh").disabled = false;
  }
}

// ── boot ───────────────────────────────────────────────────────────────────

async function boot() {
  const homeLink = $("site-home-link");
  if (homeLink) homeLink.href = SITE_ORIGIN;
  pendingChat = readRequestedChat();

  for (const b of document.querySelectorAll("[data-signin]")) {
    b.addEventListener("click", () => doSignIn(b.dataset.signin, b));
  }
  for (const b of document.querySelectorAll("[data-chat-target]")) {
    b.addEventListener("click", () => openChatTarget(b.dataset.chatTarget));
  }
  $("nav-chat")?.addEventListener("click", toggleChatDock);
  $("open-chat")?.addEventListener("click", () => openChatTarget("friends"));
  $("signout").addEventListener("click", signOut);
  $("key-export")?.addEventListener("click", exportKeyFile);
  $("mgr-embed-open")?.addEventListener("click", openManagerChat);
  $("group-embed-open")?.addEventListener("click", openGroupChat);
  $("chat-dock-close")?.addEventListener("click", () => closeChatDock());
  $("group-join").addEventListener("click", joinGroup);
  $("profile").addEventListener("submit", saveProfile);
  $("rp-edit").addEventListener("click", () => editing(true));
  $("rp-cancel").addEventListener("click", () => { renderRp(); editing(false); });
  $("beagle-refresh").addEventListener("click", refreshBeagle);
  $("intake-form").addEventListener("submit", saveIntake);
  $("intake-later").addEventListener("click", skipIntake);
  wireAvatarPicker("i");
  wireAvatarPicker("f");
  $("ev-send").addEventListener("click", sendEmailCode);
  $("ev-check").addEventListener("click", checkEmailCode);
  $("ev-code").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); checkEmailCode(); } });

  // Everything this file draws is built with t() at render time, so it keeps
  // whichever language it was built in. Half a page in the other language is
  // worse than a redraw: hook the shared toggle and redraw (and sync the chat iframe).
  syncChatDockThemeAndLang();
  const setLang = window.rpSetLang;
  window.rpSetLang = (l) => {
    setLang(l);
    syncChatDockThemeAndLang();
    if (me) { renderMember(); loadPlans(); }
  };
  const toggleTheme = window.rpToggleTheme;
  window.rpToggleTheme = () => {
    toggleTheme();
    syncChatDockThemeAndLang();
  };
  window.addEventListener("pageshow", syncChatDockThemeAndLang);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncChatDockThemeAndLang();
  });

  // readLaunch FIRST. Someone who opened this app from inside their own
  // Beagle is already signed in, and asking them again is absurd.
  try {
    const launched = await readLaunch();
    if (launched) {
      // Which Beagle launched us: the referrer is its origin when there is one
      // (a Beagle UI on http://127.0.0.1 navigating to us is an upgrade, so the
      // browser sends it). No referrer => leave it unknown and offer both.
      try {
        const ref = document.referrer ? new URL(document.referrer).origin : "";
        if (isBeagleOrigin(ref)) store.set(UI_KEY, ref);
      } catch { /* no usable referrer */ }
      await afterAuth(
        await api("POST", "/api/auth/beagle-launch", {
          userid: launched.userid, ts: launched.ts, sig: launched.sig, origin: location.origin,
          address: launched.address, name: launched.name, punkId: launched.punkId, avatar: launched.avatar,
          ui: beagleUi() || undefined,
        }),
      );
      return;
    }
  } catch (err) {
    // A fragment that was present and did not check out is worth surfacing —
    // then fall through to the buttons, because they can still sign in.
    say(String(err?.message || err));
  }

  if (token.get()) {
    try {
      const mine = await api("GET", "/api/me");
      canVerifyEmail = Boolean(mine.canVerifyEmail);
      me = mine.user;
      writeWho(me);
      renderMember();
      loadAll();
      return;
    } catch { /* stale token; api() already cleared it */ }
  }

  if (pendingChat) {
    try {
      const avail = await doors();
      if (avail.site?.made) {
        await doSiteSignIn();
        return;
      }
    } catch { /* fall through to explicit sign-in choices */ }
  }

  show("signedout");
  if (pendingChat) {
    say(t(
      "选一个登录方式，登录完成后会自动打开对话（如果你平时用桌面版或网页版 Beagle，请选对应入口以保持同一个身份和好友列表）。",
      "Pick how to sign in to open chat — if you already use desktop or web Beagle, pick that one to keep your same userid and friends list.",
    ), "ok");
  }
}

boot();
