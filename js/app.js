/* Studienplan – Module, Semester und ToDos.
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
  const MAX_SEM = 10;

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------- 1. Zustand ---------- */

  // sem:    { modulId: 1..10 | 0 }   (0 = bewusst ohne Semester; fehlt der Eintrag, gilt der Studienverlaufsplan)
  // todos:  { modulId: [{ id, text }] }
  // custom: { modulId: { title, lp } } (selbst angelegte Module im Wahlbereich)
  function normalize(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const out = { sem: {}, todos: {}, custom: {} };
    for (const [k, v] of Object.entries(s.sem || {})) if (Number.isInteger(v) && v >= 0 && v <= MAX_SEM) out.sem[k] = v;
    for (const [k, v] of Object.entries(s.todos || {})) {
      if (Array.isArray(v)) out.todos[k] = v.filter((t) => t && typeof t.text === 'string').map((t) => ({ id: String(t.id || uid()), text: t.text }));
    }
    for (const [k, v] of Object.entries(s.custom || {})) if (v && typeof v.title === 'string') out.custom[k] = { title: v.title, lp: Number(v.lp) || 0 };
    return out;
  }
  function loadLocal() {
    try { return normalize(JSON.parse(localStorage.getItem(LS_STATE))); } catch { return normalize(null); }
  }
  function saveLocal() {
    try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch { /* Speicher nicht verfügbar */ }
  }

  let state = loadLocal();
  const ui = { filter: 'all', q: '', open: new Set(['Pflichtbereich']) };
  try { const o = JSON.parse(localStorage.getItem(LS_OPEN)); if (Array.isArray(o)) ui.open = new Set(o); } catch { /* Standard */ }

  const customModules = () => Object.entries(state.custom).map(([id, c]) => ({ id, title: c.title, lp: c.lp, kind: 'Wahl', areas: ['Wahlbereich'], custom: true }));
  const allModules = () => MODULES.concat(customModules());
  const semOf = (m) => (m.id in state.sem ? state.sem[m.id] || null : m.defaultSemester || null);
  const todosOf = (id) => state.todos[id] || [];

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

  function cardHtml(m, secIdx) {
    const s = semOf(m);
    const todos = todosOf(m.id);
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
        ${todos.length ? `<ul class="todos">${todos.map((t) => `<li><label><input type="checkbox" data-todo="${esc(t.id)}"><span>${esc(t.text)}</span></label></li>`).join('')}</ul>` : ''}
        <form class="todo-add" data-act="add-todo"><input name="text" data-focus="todo:${esc(m.id)}:${secIdx}" placeholder="ToDo hinzufügen …" aria-label="ToDo für ${esc(m.title)} hinzufügen" autocomplete="off" enterkeyhint="done" maxlength="300"></form>
        ${m.custom ? '<button class="remove" data-act="remove-custom">Modul entfernen</button>' : ''}
      </article>`;
  }

  function sortModules(list) {
    return list.slice().sort((a, b) => (semOf(a) || 99) - (semOf(b) || 99) || a.title.localeCompare(b.title, 'de'));
  }

  function render() {
    // Fokus und Eingabe merken, damit beim Neuzeichnen (z. B. durch Sync) nichts verloren geht
    const active = document.activeElement;
    const keep = active && active.dataset && active.dataset.focus ? { key: active.dataset.focus, value: active.value, pos: active.selectionStart } : null;

    renderChips();
    const filtering = ui.filter !== 'all' || !!ui.q;
    const custom = customModules();
    let html = '';
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

    if (keep) {
      const el = document.querySelector(`[data-focus="${CSS.escape(keep.key)}"]`);
      if (el) { el.value = keep.value; el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.pos, keep.pos); } catch { /* number-Felder */ } }
    }
  }

  const fact = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value || '–')}</dd></div>`;
  const bullets = (items) => (Array.isArray(items) ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : `<p>${esc(items)}</p>`);

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
    render();
    sync.push(patch);
  }
  function setTodos(id, list) {
    if (list.length) state.todos[id] = list; else delete state.todos[id];
    commit({ todos: { [id]: list } });
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
    } else if (el.dataset.act === 'detail' && card) {
      openDetail(card.dataset.id);
    } else if (el.dataset.act === 'remove-custom' && card) {
      const id = card.dataset.id;
      const backup = { c: state.custom[id], s: state.sem[id], t: state.todos[id] };
      delete state.custom[id]; delete state.sem[id]; delete state.todos[id];
      commit({ custom: { [id]: sync.DELETE }, sem: { [id]: sync.DELETE }, todos: { [id]: sync.DELETE } });
      toast('Modul entfernt', () => {
        state.custom[id] = backup.c;
        if (backup.s !== undefined) state.sem[id] = backup.s;
        if (backup.t) state.todos[id] = backup.t;
        commit({ custom: { [id]: backup.c }, sem: { [id]: backup.s ?? 0 }, todos: { [id]: backup.t || [] } });
      });
    }
  });

  main.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('select.sem')) {
      const id = t.dataset.sem;
      state.sem[id] = Number(t.value);
      commit({ sem: { [id]: state.sem[id] } });
    } else if (t.matches('input[data-todo]')) {
      const id = t.closest('.card').dataset.id;
      const todoId = t.dataset.todo;
      // in allen sichtbaren Kopien des Kästchens ausblenden, dann entfernen
      document.querySelectorAll(`input[data-todo="${CSS.escape(todoId)}"]`).forEach((cb) => { cb.checked = true; cb.disabled = true; cb.closest('li').classList.add('done'); });
      setTimeout(() => {
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
      if (!text) return;
      const id = form.closest('.card').dataset.id;
      form.elements.text.value = '';
      setTodos(id, todosOf(id).concat({ id: uid(), text }));
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
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-act="close"]')) dlg.close(); });

  // Änderungen aus einem anderen Tab desselben Browsers übernehmen
  window.addEventListener('storage', (e) => { if (e.key === LS_STATE) { state = loadLocal(); render(); } });

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
      else if (status === 'in') el.innerHTML = `<span class="dot on"></span><span title="${esc(user.email || '')}">Synchronisiert</span><button class="btn ghost" data-sync="out">Abmelden</button>`;
      else el.innerHTML = '<span class="dot err"></span><span>Sync nicht erreichbar</span><button class="btn ghost" data-sync="retry">Neu laden</button>';
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
            render();
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
