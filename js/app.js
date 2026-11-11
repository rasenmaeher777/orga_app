/* Uni Organisator – Module, Semester und ToDos.
   Aufbau:
   1. Zustand (Semester, ToDos, eigene Module) + Speichern
   2. Darstellung (Filter, Bereiche, Kästchen, Detailansicht)
   3. Bedienung (Klicks, Eingaben)
   4. Firestore-Sync (nur aktiv, wenn js/firebase-config.js ausgefüllt ist) */
(() => {
  'use strict';

  const MODULES = window.MODULES || [];
  const AREAS = window.AREAS || [];
  const LS_STATE = 'uniapp-state-v1';
  const LS_OPEN = 'uniapp-open-v1';
  const LS_ALL = 'uniapp-alltodos-v1';
  const MAX_SEM = 10;

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------- Datum (immer lokale Zeit, nie toISOString/UTC) ---------- */

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  // gibt "YYYY-MM-DD" zurück, wenn es ein echtes Kalenderdatum ist, sonst ''
  function validDate(v) {
    if (typeof v !== 'string' || !/^2\d{3}-\d{2}-\d{2}$/.test(v)) return '';
    return ymd(fromYmd(v)) === v ? v : '';
  }
  function dayInfo() {
    const n = new Date();
    return { today: ymd(n), tomorrow: ymd(new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1)), year: n.getFullYear() };
  }
  let now = dayInfo(); // wird bei jedem Zeichnen aktualisiert
  const fmtLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtShort = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const fmtShortYear = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  // "Fr., 13.11." – mit Jahreszahl, wenn die Frist nicht im laufenden Jahr liegt
  const dueText = (due) => { const d = fromYmd(due); return (d.getFullYear() === now.year ? fmtShort : fmtShortYear).format(d); };
  // Fristen von heute, morgen und aus der Vergangenheit werden hervorgehoben
  const dueStatus = (due) => (!due ? '' : due < now.today ? 'überfällig' : due === now.today ? 'heute' : due === now.tomorrow ? 'morgen' : '');
  // nach Frist aufsteigend, ohne Frist ans Ende (sort() ist stabil, die Reihenfolge der Eingabe bleibt sonst erhalten)
  const byDue = (a, b) => { const x = a.due || '9', y = b.due || '9'; return x < y ? -1 : x > y ? 1 : 0; };

  /* ---------- 1. Zustand ---------- */

  // sem:    { modulId: 1..10 | 0 }   (0 = bewusst ohne Semester; fehlt der Eintrag, gilt der Studienverlaufsplan)
  // todos:  { modulId: [{ id, text, due? }] }   (due = Frist "YYYY-MM-DD"; ohne Frist fehlt das Feld)
  // custom: { modulId: { title, lp } } (selbst angelegte Module im Wahlbereich)
  // exams:  { modulId: { t1?, t2? } }  (1. und 2. Klausurtermin als "YYYY-MM-DD"; ohne Termin fehlt das Feld)
  const EXAM_KEYS = ['t1', 't2'];
  // Firestore lehnt undefined ab: due wird nur gesetzt, wenn es eine gültige Frist gibt
  function todoItem(id, text, due) {
    const item = { id, text };
    if (validDate(due)) item.due = due;
    return item;
  }
  function normalize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const out = { sem: {}, todos: {}, custom: {}, exams: {} };
    for (const [k, v] of Object.entries(s.sem || {})) if (Number.isInteger(v) && v >= 0 && v <= MAX_SEM) out.sem[k] = v;
    for (const [k, v] of Object.entries(s.todos || {})) {
      if (Array.isArray(v)) out.todos[k] = v.filter((t) => t && typeof t.text === 'string').map((t) => todoItem(String(t.id || uid()), t.text, t.due));
    }
    for (const [k, v] of Object.entries(s.custom || {})) if (v && typeof v.title === 'string') out.custom[k] = { title: v.title, lp: Number(v.lp) || 0 };
    for (const [k, v] of Object.entries(s.exams || {})) {
      const e = {};
      for (const key of EXAM_KEYS) if (v && validDate(v[key])) e[key] = v[key];
      if (Object.keys(e).length) out.exams[k] = e;
    }
    return out;
  }
  function loadLocal() {
    try { return normalize(JSON.parse(localStorage.getItem(LS_STATE))); } catch { return normalize(null); }
  }
  function saveLocal() {
    try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch { /* Speicher nicht verfügbar */ }
  }

  let state = loadLocal();
  // done: gerade abgehakte ToDos, die noch kurz durchgestrichen zu sehen sind
  const ui = { filter: 'all', q: '', open: new Set(['Pflichtbereich']), allOpen: false, done: new Set() };
  try { const o = JSON.parse(localStorage.getItem(LS_OPEN)); if (Array.isArray(o)) ui.open = new Set(o); } catch { /* Standard */ }
  try { ui.allOpen = localStorage.getItem(LS_ALL) === '1'; } catch { /* Standard */ }

  const customModules = () => Object.entries(state.custom).map(([id, c]) => ({ id, title: c.title, lp: c.lp, kind: 'Wahl', areas: ['Wahlbereich'], custom: true }));
  const allModules = () => MODULES.concat(customModules());
  const semOf = (m) => (m.id in state.sem ? state.sem[m.id] || null : m.defaultSemester || null);
  const todosOf = (id) => state.todos[id] || [];
  const examsOf = (id) => state.exams[id] || {};
  // Nur Module mit Klausur bekommen in der Detailansicht die Klausurtermine. Bei Portfolioprüfungen ist oft
  // ein schriftlicher Test dabei; eigene Module haben keine Angabe zur Prüfungsform und sind deshalb auch dabei.
  const KLAUSUR_FORMS = ['Schriftliche Prüfung', 'Portfolioprüfung'];
  const hasKlausur = (m) => !!m.custom || KLAUSUR_FORMS.includes(m.exam);

  /* ---------- 2. Darstellung ---------- */

  function matches(m) {
    if (ui.filter === 'none' && semOf(m) !== null) return false;
    if (typeof ui.filter === 'number' && semOf(m) !== ui.filter) return false;
    if (ui.filter === 'todo' && !todosOf(m.id).length) return false;
    if (ui.q) {
      const hay = [m.title, m.exam, m.moses && m.moses.verantwortlich, m.moses && m.moses.fachgebiet].filter(Boolean).join(' ').toLowerCase();
      if (!ui.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  function renderChips() {
    const mods = allModules();
    const lp = {}; let maxSem = 6; let todoCount = 0;
    for (const m of mods) {
      const s = semOf(m);
      if (s) { lp[s] = (lp[s] || 0) + (m.lp || 0); maxSem = Math.max(maxSem, s); }
      todoCount += todosOf(m.id).length;
    }
    const chip = (value, label, extra = '', style = '') =>
      `<button class="chip" data-filter="${value}" aria-pressed="${String(ui.filter) === String(value)}" ${style}>${label}${extra}</button>`;
    let html = chip('all', 'Alle');
    for (let s = 1; s <= maxSem; s++) html += chip(s, `<i></i>${s}. Sem.`, `<small>${lp[s] || 0} LP</small>`, `style="--sem:var(--s${s})"`);
    html += chip('none', 'Ohne Semester');
    html += chip('todo', 'Mit ToDos', `<small>${todoCount}</small>`);
    $('#chips').innerHTML = html;
  }

  function semSelect(m) {
    const cur = semOf(m);
    let opts = `<option value="0"${cur ? '' : ' selected'}>–</option>`;
    for (let s = 1; s <= MAX_SEM; s++) opts += `<option value="${s}"${cur === s ? ' selected' : ''}>${s}</option>`;
    return `<select class="sem" data-sem="${esc(m.id)}" aria-label="Semester für ${esc(m.title)}" title="Semester">${opts}</select>`;
  }

  const ICON_CAL = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/></svg>';
  const ICON_PLUS = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';

  // Fristanzeige eines ToDos. Darüber liegt ein unsichtbares Datumsfeld (siehe .datebtn in style.css),
  // ein Klick oder Tipp öffnet also direkt die Datumsauswahl des Geräts.
  const dueClass = (due) => { const st = dueStatus(due); return `datebtn due${due ? '' : ' none'}${st ? ' urgent' : ''}${st === 'morgen' ? ' soon' : ''}`; };
  const dueInner = (due) => { const st = dueStatus(due); return (st ? `<b class="due-tag">${st}</b>` : ICON_CAL) + (due ? `<span>${esc(dueText(due))}</span>` : ''); };
  // im schmalen Formular "ToDo hinzufügen" ohne Wochentag: "13.11."
  const newDueInner = (due) => ICON_CAL + (due ? `<span>${esc(`${due.slice(8)}.${due.slice(5, 7)}.${due.startsWith(now.year + '-') ? '' : due.slice(0, 4)}`)}</span>` : '');

  function todoRow(m, t, withModule) {
    const done = ui.done.has(t.id);
    const dateBtn = `<span class="${dueClass(t.due)}" data-due-for="${esc(t.id)}" title="${t.due ? 'Frist ändern' : 'Frist festlegen'}"><span class="due-label">${dueInner(t.due)}</span><input type="date" data-due="${esc(t.id)}" value="${esc(t.due || '')}" aria-label="Frist für ${esc(t.text)} ${t.due ? 'ändern' : 'festlegen'}"></span>`;
    const meta = [];
    if (t.due) meta.push(dateBtn, `<button class="due-clear" data-act="clear-due" data-todo-id="${esc(t.id)}" aria-label="Frist für ${esc(t.text)} entfernen" title="Frist entfernen">×</button>`);
    if (withModule) meta.push(`<span class="todo-mod">${esc(m.title)}</span>`);
    return `<li class="${dueStatus(t.due) ? 'urgent' : ''}${done ? ' done' : ''}" data-mod="${esc(m.id)}">
        <label><input type="checkbox" data-todo="${esc(t.id)}"${done ? ' checked disabled' : ''}><span>${esc(t.text)}</span></label>
        ${t.due ? '' : dateBtn}
        ${meta.length ? `<div class="todo-meta">${meta.join('')}</div>` : ''}
      </li>`;
  }

  // Kopfzeile des Inhalts: heutiges Datum und aufklappbare Liste aller offenen ToDos
  function todayHtml() {
    const rows = [];
    for (const m of allModules()) for (const t of todosOf(m.id)) rows.push({ m, t });
    rows.sort((a, b) => byDue(a.t, b.t));
    const list = rows.length
      ? `<ul class="todos all-list">${rows.map((r) => todoRow(r.m, r.t, true)).join('')}</ul>`
      : '<p class="note">Keine offenen ToDos.</p>';
    return `
      <section class="today">
        <div class="today-row">
          <time class="today-date" datetime="${now.today}">${esc(fmtLong.format(new Date()))}</time>
          <button class="all-toggle" data-act="toggle-all" data-focus="all-toggle" aria-expanded="${ui.allOpen}"><span class="chev"></span>Alle ToDos (${rows.length})</button>
        </div>
        ${ui.allOpen ? `<div class="all-panel">${list}</div>` : ''}
      </section>`;
  }

  function cardHtml(m, secIdx) {
    const s = semOf(m);
    const todos = todosOf(m.id).slice().sort(byDue);
    const meta = [`<span class="kind">${esc(m.kind)}</span>`];
    if (m.lp) meta.push(`<span class="sep">${m.lp} LP</span>`);
    if (m.exam) meta.push(`<span class="sep">${esc(m.exam)}</span>`);
    if (m.graded === false) meta.push('<span class="sep">unbenotet</span>');
    return `
      <article class="card${s ? ' has-sem' : ''}" data-id="${esc(m.id)}"${s ? ` style="--sem:var(--s${s})"` : ''}>
        <div class="card-head">
          <button class="card-title" data-act="detail" title="Details anzeigen">${esc(m.title)}</button>
          ${semSelect(m)}
        </div>
        <div class="meta">${meta.join('')}</div>
        ${todos.length ? `<ul class="todos">${todos.map((t) => todoRow(m, t, false)).join('')}</ul>` : ''}
        <form class="todo-add" data-act="add-todo">
          <input name="text" data-focus="todo:${esc(m.id)}:${secIdx}" placeholder="ToDo hinzufügen …" aria-label="ToDo für ${esc(m.title)} hinzufügen" autocomplete="off" enterkeyhint="done" maxlength="300">
          <span class="datebtn new" title="Frist (optional)"><span class="due-label">${ICON_CAL}</span><input type="date" name="due" data-focus="tododue:${esc(m.id)}:${secIdx}" aria-label="Frist für das neue ToDo (optional)"></span>
          <button type="button" class="due-clear" data-act="clear-new-due" aria-label="Frist wieder entfernen" title="Frist entfernen">×</button>
          <button class="add-btn" aria-label="ToDo hinzufügen" title="ToDo hinzufügen">${ICON_PLUS}</button>
        </form>
        ${m.custom ? '<button class="remove" data-act="remove-custom">Modul entfernen</button>' : ''}
      </article>`;
  }

  function sortModules(list) {
    return list.slice().sort((a, b) => (semOf(a) || 99) - (semOf(b) || 99) || a.title.localeCompare(b.title, 'de'));
  }

  // Solange ein Datumsfeld den Fokus hat (Datumsauswahl offen), wird nicht neu gezeichnet:
  // sonst würde die Auswahl mitten in der Bedienung geschlossen. Nachgeholt wird beim Verlassen des Feldes.
  let renderPending = false;
  const dateBusy = () => { const a = document.activeElement; return !!a && a.tagName === 'INPUT' && a.type === 'date'; };
  function refresh() {
    if (dateBusy()) { renderPending = true; return; }
    render();
  }

  function render() {
    renderPending = false;
    now = dayInfo();
    // Fokus und angefangene Eingaben merken, damit beim Neuzeichnen (z. B. durch Sync) nichts verloren geht
    const active = document.activeElement;
    const keep = active && active.dataset && active.dataset.focus ? { key: active.dataset.focus, pos: active.selectionStart } : null;
    const drafts = [...document.querySelectorAll('#main input[data-focus]')].filter((el) => el.value).map((el) => [el.dataset.focus, el.value]);

    renderChips();
    const filtering = ui.filter !== 'all' || !!ui.q;
    const custom = customModules();
    let html = todayHtml();
    let shown = 0;

    AREAS.forEach((area, idx) => {
      const base = area.custom ? custom : area.match === 'Pflicht' ? MODULES.filter((m) => m.kind === 'Pflicht') : MODULES.filter((m) => m.areas.includes(area.name));
      const list = sortModules(base.filter(matches));
      if (filtering && !list.length) return;
      shown += list.length;
      const open = filtering || ui.open.has(area.name);
      const planned = base.filter((m) => semOf(m));
      const plannedLp = planned.reduce((sum, m) => sum + (m.lp || 0), 0);
      const count = filtering ? `${list.length} von ${base.length}` : `${base.length} ${base.length === 1 ? 'Modul' : 'Module'}`;
      const metaParts = [count, `${area.lp} zu belegen`];
      if (area.kind !== 'Pflicht' && planned.length) metaParts.push(`${plannedLp} LP eingeplant`);
      html += `
        <section class="section${open ? ' open' : ''}">
          <button class="sec-head" data-act="toggle" data-area="${esc(area.name)}" aria-expanded="${open}">
            <span class="chev"></span>
            <span class="sec-titles"><h2>${esc(area.name)}</h2><span class="sec-meta">${esc(metaParts.join(' · '))}</span></span>
            <span class="spacer"></span>
            <span class="tag">${esc(area.kind)}</span>
          </button>
          ${open ? `
            ${area.custom && !filtering ? `<form class="add-custom" data-act="add-custom">
              <input name="title" data-focus="custom:title" placeholder="Eigenes Modul, z. B. Sprachkurs" aria-label="Titel des Moduls" maxlength="120" required>
              <input name="lp" data-focus="custom:lp" type="number" min="0" max="30" placeholder="LP" aria-label="Leistungspunkte" inputmode="numeric">
              <button class="btn primary">Hinzufügen</button>
            </form>` : ''}
            ${list.length ? `<div class="grid">${list.map((m) => cardHtml(m, idx)).join('')}</div>` : ''}` : ''}
        </section>`;
    });

    if (!shown && filtering) html += '<p class="empty">Keine Module für diese Auswahl.</p>';
    $('#main').innerHTML = html;
    paintExams(); // falls die Detailansicht offen ist und ein Termin z. B. per Sync kam

    for (const [key, value] of drafts) {
      const el = document.querySelector(`[data-focus="${CSS.escape(key)}"]`);
      if (el) { el.value = value; if (el.type === 'date') paintNewDue(el); }
    }
    if (keep) {
      const el = document.querySelector(`[data-focus="${CSS.escape(keep.key)}"]`);
      if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.pos, keep.pos); } catch { /* Felder ohne Textcursor */ } }
    }
  }

  // Anzeige neben dem Datumsfeld im Formular "ToDo hinzufügen" aktualisieren
  function paintNewDue(input) {
    const due = validDate(input.value);
    const box = input.parentElement;
    box.classList.toggle('has', !!due);
    $('.due-label', box).innerHTML = newDueInner(due);
  }
  // Fristanzeige eines ToDos an Ort und Stelle aktualisieren (in allen sichtbaren Kopien), ohne neu zu zeichnen
  function paintDue(todoId, due) {
    document.querySelectorAll(`[data-due-for="${CSS.escape(todoId)}"]`).forEach((box) => {
      box.className = dueClass(due);
      $('.due-label', box).innerHTML = dueInner(due);
      box.closest('li').classList.toggle('urgent', !!dueStatus(due));
    });
  }

  const fact = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value || '–')}</dd></div>`;
  const bullets = (items) => (Array.isArray(items) ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : `<p>${esc(items)}</p>`);

  // Klausurtermin in der Detailansicht: gleiche Technik wie bei den Fristen (.datebtn)
  const examInner = (date) => ICON_CAL + `<span>${date ? esc(fmtShortYear.format(fromYmd(date))) : 'Termin eintragen'}</span>`;
  function examsHtml(m) {
    const e = examsOf(m.id);
    return `<h3>Klausurtermin</h3><dl class="facts exams">${EXAM_KEYS.map((key, i) => `<div><dt>${i + 1}. Termin</dt><dd>
        <span class="datebtn exam${e[key] ? '' : ' none'}" data-exam-for="${key}" title="Termin ${e[key] ? 'ändern' : 'eintragen'}"><span class="due-label">${examInner(e[key])}</span><input type="date" data-exam="${key}" value="${esc(e[key] || '')}" aria-label="${i + 1}. Klausurtermin für ${esc(m.title)}"></span>
        <button class="due-clear" data-act="clear-exam" data-key="${key}" aria-label="${i + 1}. Klausurtermin entfernen" title="Termin entfernen"${e[key] ? '' : ' hidden'}>×</button>
      </dd></div>`).join('')}</dl>`;
  }
  // Anzeige eines Termins in der geöffneten Detailansicht an Ort und Stelle aktualisieren
  function paintExams() {
    const dlg = $('#detail');
    if (!dlg.open) return;
    const e = examsOf(dlg.dataset.id);
    dlg.querySelectorAll('[data-exam-for]').forEach((box) => {
      const date = e[box.dataset.examFor] || '';
      const input = $('input', box);
      box.classList.toggle('none', !date);
      box.title = `Termin ${date ? 'ändern' : 'eintragen'}`;
      $('.due-label', box).innerHTML = examInner(date);
      box.nextElementSibling.hidden = !date;
      if (document.activeElement !== input) input.value = date;
    });
  }

  function openDetail(id) {
    const m = allModules().find((x) => x.id === id);
    if (!m) return;
    const d = m.moses || {};
    const s = semOf(m);
    const dlg = $('#detail');
    const kind = m.custom ? 'Wahlmodul (selbst angelegt)' : `${m.kind}modul laut StuPO · ${m.areas.join(' / ')}`;
    const exam = [d.pruefungsform || m.exam, d.dauer].filter(Boolean).join(', ');
    let body = `<dl class="facts">
        ${fact('Semester', s ? `${s}. Semester` : 'nicht eingeplant')}
        ${fact('Leistungspunkte', m.lp ? `${m.lp} LP` : '')}
        ${fact('Benotung', m.graded === undefined ? d.benotung : m.graded ? 'Benotet' : 'Unbenotet')}
        ${fact('Prüfungsform und Dauer', exam)}
        ${m.custom ? '' : fact('Gültigkeit', d.gueltigkeit) + fact('Sprache', d.sprache) + fact('Lehrsprache', d.lehrsprache)
          + fact('Modulverantwortliche*r', d.verantwortlich) + fact('Fakultät', d.fakultaet) + fact('Institut', d.institut) + fact('Fachgebiet', d.fachgebiet)}
      </dl>`;
    if (hasKlausur(m)) body += examsHtml(m);
    if (!m.custom) {
      if (!m.moses) body += '<p class="note">Die Details aus Moses (Verantwortliche, Lehrinhalte, Modulbestandteile …) sind für dieses Modul noch nicht hinterlegt.</p>';
      if (d.lernergebnisse && d.lernergebnisse.length) body += `<h3>Lernergebnisse</h3>${bullets(d.lernergebnisse)}`;
      if (d.lehrinhalte && d.lehrinhalte.length) body += `<h3>Lehrinhalte</h3>${bullets(d.lehrinhalte)}`;
      if (d.bestandteile && d.bestandteile.length) {
        body += `<h3>Modulbestandteile</h3><table class="parts"><thead><tr><th>Art</th><th>Veranstaltung</th><th>SWS</th><th class="hide-s">Turnus</th><th class="hide-s">Sprache</th></tr></thead><tbody>${d.bestandteile.map((b) =>
          `<tr><td class="art">${esc(b.art)}</td><td>${esc(b.name)}${b.wahl ? ' <span class="note">(Wahl)</span>' : ''}</td><td>${esc(b.sws)}</td><td class="hide-s">${esc(b.turnus)}</td><td class="hide-s">${esc(b.sprache)}</td></tr>`).join('')}</tbody></table>`;
      }
      if (d.hinweis) body += `<p class="note" style="margin-top:14px">${esc(d.hinweis)}</p>`;
      if (d.url) body += `<a class="moses-link" href="${esc(d.url)}" target="_blank" rel="noopener">Modulbeschreibung in Moses öffnen ↗</a>`;
    }
    dlg.innerHTML = `<div class="detail-inner"${s ? ` style="--sem:var(--s${s})"` : ''}>
        <div class="detail-head"><h2>${esc(m.title)}<span class="sub">${esc(kind)}</span></h2><button class="close" data-act="close" aria-label="Schließen">×</button></div>
        <div class="detail-body">${body}</div>
      </div>`;
    dlg.dataset.id = id;
    if (!dlg.open) dlg.showModal();
    $('.detail-body', dlg).scrollTop = 0;
  }

  let toastTimer;
  function toast(text, undo) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(text)}</span>${undo ? '<button>Rückgängig</button>' : ''}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
    if (undo) $('button', el).onclick = () => { el.hidden = true; undo(); };
  }

  /* ---------- 3. Bedienung ---------- */

  // Änderung übernehmen: lokal speichern, neu zeichnen, an Firestore schicken
  function commit(patch) {
    saveLocal();
    refresh();
    sync.push(patch);
  }
  function setTodos(id, list) {
    if (list.length) state.todos[id] = list; else delete state.todos[id];
    commit({ todos: { [id]: list } });
  }
  // Klausurtermin setzen (date = "YYYY-MM-DD") oder entfernen (date = ''); key ist 't1' oder 't2'
  function setExam(id, key, date) {
    const cur = { ...examsOf(id) };
    if ((cur[key] || '') === date) return;
    if (date) cur[key] = date; else delete cur[key];
    if (Object.keys(cur).length) state.exams[id] = cur; else delete state.exams[id];
    commit({ exams: { [id]: { [key]: date || sync.DELETE } } });
  }
  // Frist eines ToDos setzen (due = "YYYY-MM-DD") oder entfernen (due = '')
  function setDue(modId, todoId, due) {
    const before = todosOf(modId);
    const old = before.find((x) => x.id === todoId);
    if (!old || (old.due || '') === due) return;
    paintDue(todoId, due);
    setTodos(modId, before.map((x) => (x === old ? todoItem(x.id, x.text, due) : x)));
  }

  const main = $('#main');

  main.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const card = el.closest('.card');
    if (el.dataset.act === 'toggle') {
      const a = el.dataset.area;
      if (ui.filter !== 'all' || ui.q) return; // beim Filtern sind alle Treffer sichtbar
      ui.open.has(a) ? ui.open.delete(a) : ui.open.add(a);
      try { localStorage.setItem(LS_OPEN, JSON.stringify([...ui.open])); } catch { /* egal */ }
      render();
    } else if (el.dataset.act === 'toggle-all') {
      ui.allOpen = !ui.allOpen;
      try { localStorage.setItem(LS_ALL, ui.allOpen ? '1' : '0'); } catch { /* egal */ }
      render();
    } else if (el.dataset.act === 'clear-due') {
      const modId = el.closest('[data-mod]').dataset.mod;
      const todoId = el.dataset.todoId;
      const old = todosOf(modId).find((x) => x.id === todoId);
      if (!old || !old.due) return;
      setDue(modId, todoId, '');
      toast('Frist entfernt', () => setDue(modId, todoId, old.due));
    } else if (el.dataset.act === 'clear-new-due') {
      const input = el.closest('form').elements.due;
      input.value = '';
      paintNewDue(input);
    } else if (el.dataset.act === 'detail' && card) {
      openDetail(card.dataset.id);
    } else if (el.dataset.act === 'remove-custom' && card) {
      const id = card.dataset.id;
      const backup = { c: state.custom[id], s: state.sem[id], t: state.todos[id], e: state.exams[id] };
      delete state.custom[id]; delete state.sem[id]; delete state.todos[id]; delete state.exams[id];
      commit({ custom: { [id]: sync.DELETE }, sem: { [id]: sync.DELETE }, todos: { [id]: sync.DELETE }, exams: { [id]: sync.DELETE } });
      toast('Modul entfernt', () => {
        state.custom[id] = backup.c;
        if (backup.s !== undefined) state.sem[id] = backup.s;
        if (backup.t) state.todos[id] = backup.t;
        if (backup.e) state.exams[id] = backup.e;
        commit({ custom: { [id]: backup.c }, sem: { [id]: backup.s ?? 0 }, todos: { [id]: backup.t || [] }, exams: { [id]: backup.e || sync.DELETE } });
      });
    }
  });

  main.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('select.sem')) {
      const id = t.dataset.sem;
      state.sem[id] = Number(t.value);
      commit({ sem: { [id]: state.sem[id] } });
    } else if (t.matches('input[data-due]')) {
      // Frist eines bestehenden ToDos geändert. Leer = Frist entfernt (z. B. "Zurücksetzen" in der Datumsauswahl).
      // Unfertige Zwischenstände beim Tippen (Jahr "0002") werden übersprungen.
      if (t.value && !validDate(t.value)) return;
      setDue(t.closest('[data-mod]').dataset.mod, t.dataset.due, t.value);
    } else if (t.matches('.todo-add input[type="date"]')) {
      paintNewDue(t);
    } else if (t.matches('input[data-todo]')) {
      const id = t.closest('[data-mod]').dataset.mod;
      const todoId = t.dataset.todo;
      // in allen sichtbaren Kopien (Kästchen und Gesamtliste) ausblenden, dann entfernen
      ui.done.add(todoId);
      document.querySelectorAll(`input[data-todo="${CSS.escape(todoId)}"]`).forEach((cb) => { cb.checked = true; cb.disabled = true; cb.closest('li').classList.add('done'); });
      setTimeout(() => {
        ui.done.delete(todoId);
        const before = todosOf(id);
        const index = before.findIndex((x) => x.id === todoId);
        if (index < 0) return;
        const item = before[index];
        setTodos(id, before.filter((x) => x.id !== todoId));
        toast(`Erledigt: ${item.text}`, () => {
          const cur = todosOf(id).slice();
          cur.splice(Math.min(index, cur.length), 0, item);
          setTodos(id, cur);
        });
      }, 320);
    }
  });

  main.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.act === 'add-todo') {
      const text = form.elements.text.value.trim();
      if (!text) { form.elements.text.focus(); return; }
      const id = form.closest('.card').dataset.id;
      const due = form.elements.due.value;
      if (document.activeElement === form.elements.due) form.elements.text.focus({ preventScroll: true }); // Enter im Datumsfeld
      form.reset();
      setTodos(id, todosOf(id).concat(todoItem(uid(), text, due)));
    } else if (form.dataset.act === 'add-custom') {
      const title = form.elements.title.value.trim();
      if (!title) return;
      const id = 'x-' + uid();
      state.custom[id] = { title, lp: Math.max(0, Math.min(30, parseInt(form.elements.lp.value, 10) || 0)) };
      form.reset();
      commit({ custom: { [id]: state.custom[id] } });
    }
  });

  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filter]');
    if (!b) return;
    const v = b.dataset.filter;
    const next = /^\d+$/.test(v) ? Number(v) : v;
    ui.filter = ui.filter === next ? 'all' : next; // erneutes Antippen hebt den Filter auf
    render();
    window.scrollTo({ top: 0 });
  });

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { ui.q = e.target.value.trim(); render(); }, 120);
  });

  const dlg = $('#detail');
  dlg.addEventListener('click', (e) => {
    const clear = e.target.closest('[data-act="clear-exam"]');
    if (clear) { setExam(dlg.dataset.id, clear.dataset.key, ''); paintExams(); }
    else if (e.target === dlg || e.target.closest('[data-act="close"]')) dlg.close();
  });
  // Klausurtermin in der Detailansicht geändert. Leer = Termin entfernt; unfertige Zwischenstände beim Tippen überspringen.
  dlg.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.matches('input[data-exam]') || (t.value && !validDate(t.value))) return;
    setExam(dlg.dataset.id, t.dataset.exam, t.value);
    paintExams();
  });

  // Datumsfeld verlassen: aufgeschobenes Neuzeichnen nachholen. Kurz warten, damit der Klick,
  // der das Feld verlassen hat, noch sein Ziel trifft (die Liste wird beim Zeichnen neu sortiert).
  document.addEventListener('focusout', (e) => {
    if (renderPending && e.target.matches('input[type="date"]')) setTimeout(() => { if (renderPending) refresh(); }, 300);
  });
  // Sicherheitsnetz fürs iPhone: Tipp neben ein noch fokussiertes Datumsfeld gibt den Fokus frei
  document.addEventListener('pointerdown', (e) => {
    const a = document.activeElement;
    if (dateBusy() && a !== e.target) a.blur();
  }, true);

  // Änderungen aus einem anderen Tab desselben Browsers übernehmen
  window.addEventListener('storage', (e) => { if (e.key === LS_STATE) { state = loadLocal(); refresh(); } });

  // Tageswechsel: Seite bleibt über Mitternacht offen oder kommt wieder in den Vordergrund
  const checkDay = () => { if (ymd(new Date()) !== now.today) refresh(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });
  window.addEventListener('pageshow', checkDay);
  window.addEventListener('focus', checkDay);
  setInterval(checkDay, 30000);

  /* ---------- 4. Firestore-Sync ---------- */

  const sync = (() => {
    const cfg = window.FIREBASE_CONFIG || {};
    const el = $('#sync');
    const DELETE = { __delete: true }; // Platzhalter, wird beim Senden durch deleteField() ersetzt
    let fb = null, ref = null, user = null, unsub = null, status = cfg.apiKey ? 'loading' : 'local';

    function draw() {
      if (status === 'local') el.innerHTML = '<span class="dot"></span><span title="Daten liegen nur in diesem Browser. Sync: siehe README.">Nur auf diesem Gerät</span>';
      else if (status === 'loading') el.innerHTML = '<span class="dot"></span><span>Verbinde …</span>';
      else if (status === 'out') el.innerHTML = '<button class="btn primary" data-sync="in">Mit Google anmelden</button>';
      else if (status === 'in') el.innerHTML = `<span class="dot on"></span><span title="Synchronisiert${user.email ? ' · ' + esc(user.email) : ''}">Sync.</span><button class="btn ghost" data-sync="out">Abmelden</button>`;
      else el.innerHTML = '<span class="dot err"></span><span title="Sync nicht erreichbar">Sync-Fehler</span><button class="btn ghost" data-sync="retry">Neu laden</button>';
    }

    function prepare(patch) {
      // {__delete:true} → deleteField(); undefined entfernen
      const out = {};
      for (const [k, v] of Object.entries(patch)) {
        if (v === DELETE) out[k] = fb.deleteField();
        else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = prepare(v);
        else if (v !== undefined) out[k] = v;
      }
      return out;
    }

    function push(patch) {
      if (!ref) return;
      fb.setDoc(ref, prepare(patch), { merge: true }).catch((err) => { console.error('Sync fehlgeschlagen', err); status = 'error'; draw(); });
    }

    async function init() {
      try {
        const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
        const [app, auth, fs] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
        fb = { ...auth, ...fs };
        const fbApp = app.initializeApp(cfg);
        const a = auth.getAuth(fbApp);
        const db = fs.getFirestore(fbApp);
        fb.auth = a;
        auth.onAuthStateChanged(a, (u) => {
          user = u;
          if (unsub) { unsub(); unsub = null; }
          ref = null;
          if (!u) { status = 'out'; draw(); return; }
          ref = fs.doc(db, 'users', u.uid, 'state', 'main');
          status = 'in'; draw();
          unsub = fs.onSnapshot(ref, (snap) => {
            if (snap.metadata.hasPendingWrites) return; // eigene, noch nicht bestätigte Änderung
            if (!snap.exists()) { fs.setDoc(ref, state); return; } // erste Anmeldung: lokalen Stand hochladen
            state = normalize(snap.data());
            saveLocal();
            refresh();
            if (status !== 'in') { status = 'in'; draw(); }
          }, (err) => { console.error('Sync-Fehler', err); status = 'error'; draw(); });
        });
      } catch (err) {
        console.error('Firebase konnte nicht geladen werden', err);
        status = 'error'; draw();
      }
    }

    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sync]');
      if (!b) return;
      if (b.dataset.sync === 'in') fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider()).catch((err) => { if (err.code !== 'auth/popup-closed-by-user') toast('Anmeldung fehlgeschlagen'); console.error(err); });
      else if (b.dataset.sync === 'out') fb.signOut(fb.auth);
      else location.reload();
    });

    draw();
    if (cfg.apiKey) init();
    return { push, DELETE };
  })();

  render();
})();
