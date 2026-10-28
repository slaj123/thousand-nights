import {
  nightOf, addDays, daysBetween, indexContent, nightView, stats, opSetMode, opCheck, TOTAL_SETS,
  opSwap, opShelfCheck, shelf, SWAP_MAX,
} from './logic.js';
import { createStore } from './sync.js';
import SETUP from './setup.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const START_DATE = SETUP.startDate; // night 1 of your challenge, from public/setup.js
const AHEAD_DAYS = 7;     // how far ahead you can front-load

let content = null;
let notes = {};
const openNotes = new Set(); // which notes are expanded (per session)
let store = null;
let snapshot = { state: null, pending: 0, status: 'idle' };
let viewDate = nightOf();
let playing = null;

// ---- theme (per-device convenience, so localStorage is fine) -----------------
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('theme').textContent = t === 'paper' ? 'Night theme' : 'Paper theme';
  document.querySelector('meta[name="theme-color"]').content = t === 'paper' ? '#F3EEE3' : '#12110F';
}
let theme = 'dark';
try { theme = localStorage.getItem('tn.theme') || 'dark'; } catch {}
applyTheme(theme);
$('theme').onclick = () => {
  theme = theme === 'paper' ? 'dark' : 'paper';
  try { localStorage.setItem('tn.theme', theme); } catch {}
  applyTheme(theme);
};

// ---- content ---------------------------------------------------------------
async function loadContent() {
  const manifest = await (await fetch('/content/index.json')).json();
  const dayFiles = await Promise.all(manifest.days.map((f) => fetch(`/content/${f}`).then((r) => r.json())));
  const light = await (await fetch(`/content/${manifest.light}`)).json();
  // After-reading notes are optional: a missing file just means no notes yet.
  const noteFiles = await Promise.all((manifest.notes || []).map((f) => fetch(`/content/${f}`).then((r) => r.json()).catch(() => ({}))));
  notes = Object.assign({}, ...noteFiles.map((n) => n.notes || {}));
  return indexContent(dayFiles, light);
}

// ---- rendering -----------------------------------------------------------
const fmtDate = (date, short = false) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, short ? { month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' });
};
const KIND_LABEL = { poem: 'Poem', story: 'Story', essay: 'Essay' };
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#12110F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

// The note shows only after the item is checked, and only if it was written
// for this exact work (a swapped-in backup must not inherit the old note).
function afterHtml(x) {
  const n = notes[x.item.id];
  if (!x.checked || !n || !x.item.title.startsWith(n.title)) return '';
  const open = openNotes.has(x.item.id);
  return `<button class="afterbtn" data-note="${esc(x.item.id)}" aria-expanded="${open}">After reading</button>${open ? `<p class="after">${esc(n.after)}</p>` : ''}`;
}

function itemHtml(x, i) {
  if (x.swapped) {
    return `<li class="item checked swapped">
    <div>
      <div class="kind"><b>${KIND_LABEL[x.slot]}</b><span>your pick</span></div>
      <span class="title">${esc(x.item.title)}</span>
      <div class="author">Instead of <i>${esc(x.skipped.title)}</i>, now saved for later</div>
      <div class="meta"><button class="listen" data-unswap="${i}">Undo swap</button></div>
    </div>
    <span class="check" role="img" aria-label="Done with your own pick">${CHECK_SVG}</span>
  </li>`;
  }
  const it = x.item;
  const audio = it.audio_url
    ? `<button class="listen" data-audio="${esc(it.audio_url)}" aria-pressed="${playing === it.audio_url}">${playing === it.audio_url ? 'Pause' : 'Listen'}</button>` : '';
  const login = it.requires_login ? `<span class="badge">Login · ${esc(it.login_source)}</span>` : '';
  return `<li class="item${x.checked ? ' checked' : ''}">
    <div>
      <div class="kind"><b>${KIND_LABEL[x.slot]}</b><span>${esc(it.tag)}</span></div>
      <a class="title" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>
      <div class="author">${esc(it.author)}</div>
      <div class="meta"><span>~${esc(it.est_minutes)} min</span>${audio}${login}${swapBtn(x, i)}</div>
      ${afterHtml(x)}
    </div>
    <button class="check" role="checkbox" aria-checked="${x.checked}" data-i="${i}"
      aria-label="Mark ${esc(KIND_LABEL[x.slot].toLowerCase())} ${esc(it.title)} as read">${CHECK_SVG}</button>
  </li>`;
}

// Only full sets swap; light items just recur, so there's nothing to save.
function swapBtn(x, i) {
  return render.mode === 'full' && !x.checked ? `<button class="listen" data-swap="${i}">Swap</button>` : '';
}

function shelfHtml(e, i) {
  const it = e.item;
  return `<li class="item">
    <div>
      <div class="kind"><b>${KIND_LABEL[e.slot]}</b><span>skipped ${esc(fmtDate(e.swappedOn))}</span></div>
      <a class="title" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a>
      <div class="author">${esc(it.author)}</div>
      <div class="meta"><span>~${esc(it.est_minutes)} min</span></div>
    </div>
    <button class="check" role="checkbox" aria-checked="false" data-shelf="${i}"
      aria-label="Mark ${esc(it.title)} as read">${CHECK_SVG}</button>
  </li>`;
}

const SYNC_TEXT = {
  idle: 'Saved on device', syncing: 'Syncing', synced: 'Synced', offline: 'Offline', error: 'Sync failed · retry', needkey: 'Add sync key',
};

function render() {
  if (!content || !snapshot.state) return;
  const today = nightOf();
  const view = nightView(snapshot.state, content, viewDate, today);
  const st = stats(snapshot.state, content, today, START_DATE);
  const isToday = viewDate === today;
  const allDone = view.items.length && view.items.every((x) => x.checked);

  // Date nav
  $('datelabel').textContent = isToday ? `Tonight · ${fmtDate(viewDate, true)}` : fmtDate(viewDate);
  $('prev').disabled = viewDate <= START_DATE; // catch up any night back to the start
  $('next').disabled = viewDate >= addDays(today, AHEAD_DAYS);

  // Hero
  const nightNo = daysBetween(START_DATE, viewDate) + 1;
  // Before night 1 (a start date in the future), say when it starts instead of a negative night.
  $('night').innerHTML = nightNo >= 1
    ? `Night <span class="n">${nightNo.toLocaleString()}</span>`
    : `Starts <span class="n">${esc(new Date(START_DATE + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</span>`;
  $('night').classList.toggle('done', !!allDone);
  const setLabel = view.mode === 'light'
    ? 'Light set · still counts as a night'
    : view.day ? `Full set · day ${view.day} of ${TOTAL_SETS.toLocaleString()} · essay: ${view.essayField}` : 'Full set';
  $('sub').textContent = allDone ? `${setLabel} · done` : setLabel;

  // Mode
  for (const b of document.querySelectorAll('.modebtn')) b.setAttribute('aria-checked', String(b.dataset.mode === view.mode));

  // Banner
  const banner = $('banner');
  if (viewDate > today) {
    banner.hidden = false;
    banner.textContent = `Front-loading ${fmtDate(viewDate)}. Read these now; that night counts once all three are checked.`;
  } else if (viewDate < today) {
    banner.hidden = false;
    banner.textContent = `Catching up on ${fmtDate(viewDate)}. Checks here count for that night.`;
  } else banner.hidden = true;

  // Items
  render.mode = view.mode;
  $('items').innerHTML = view.items.length
    ? view.items.map(itemHtml).join('')
    : '<li class="empty">No more curated full sets yet. Add the next batch to content/ and push.</li>';
  $('note').hidden = !view.note;
  $('note').textContent = view.note || '';

  // Saved for later
  const saved = shelf(snapshot.state, content);
  $('shelf').hidden = !saved.length;
  $('shelf-items').innerHTML = saved.map(shelfHtml).join('');
  render.shelf = saved;

  // Stats
  $('s-streak').textContent = st.streak;
  $('s-total').innerHTML = `${st.total}<small> of ${st.possible}</small>`;
  $('s-light').textContent = `${st.lightPct}%`;
  $('s-light30').textContent = `${st.lightPct30}% last 30 days`;
  $('s-full').textContent = st.fullDone;
  $('ahead').hidden = !st.frontLoadedAhead;
  $('ahead').textContent = `${st.frontLoadedAhead} night${st.frontLoadedAhead === 1 ? '' : 's'} front-loaded ahead.`;

  // Ember line: full sets done of 1,000 (a sliver even at zero so the flame shows)
  document.querySelector('.ember-fill').style.width = `${Math.max(0.6, (100 * st.fullDone) / TOTAL_SETS)}%`;

  // Sync pill
  const s = snapshot.status;
  const pill = $('sync');
  pill.dataset.s = s;
  pill.textContent = (s === 'offline' || s === 'error') && snapshot.pending
    ? `${s === 'offline' ? 'Offline' : 'Not synced'} · ${snapshot.pending} waiting`
    : SYNC_TEXT[s] || 'Saved on device';

  // Key panel: shown until this device has a working key.
  const needKey = s === 'needkey';
  if (needKey && !keyPanelShown) { $('keypanel').hidden = false; keyPanelShown = true; }
  if (s === 'synced') { $('keypanel').hidden = true; keyPanelShown = false; }
  $('keyerr').hidden = !(needKey && store?.hasKey);

  render.view = view;
}
let keyPanelShown = false;

// ---- events ------------------------------------------------------------------
$('items').addEventListener('click', (e) => {
  const sw = e.target.closest('[data-swap]');
  if (sw) {
    const view = render.view;
    const x = view.items[Number(sw.dataset.swap)];
    const title = prompt(`What did you read instead of "${x.item.title}"?\n(e.g. The Awakening, ch. 1–15)`);
    if (!title || !title.trim()) return;
    store.dispatch(opSwap(view, x, title.trim().slice(0, SWAP_MAX), nightOf()));
    return;
  }
  const un = e.target.closest('[data-unswap]');
  if (un) {
    const view = render.view;
    const x = view.items[Number(un.dataset.unswap)];
    store.dispatch(opSwap(view, x, x.item.title, nightOf(), true));
    return;
  }
  const check = e.target.closest('button.check');
  if (check) {
    const view = render.view;
    const x = view.items[Number(check.dataset.i)];
    store.dispatch(opCheck(view, x, !x.checked, nightOf()));
    return;
  }
  const nb = e.target.closest('.afterbtn');
  if (nb) {
    const id = nb.dataset.note;
    openNotes.has(id) ? openNotes.delete(id) : openNotes.add(id);
    render();
    return;
  }
  const listen = e.target.closest('.listen');
  if (listen) {
    const player = $('player');
    const src = listen.dataset.audio;
    if (playing === src) { player.pause(); playing = null; }
    else { player.src = src; player.play().catch(() => {}); playing = src; }
    render();
  }
});
$('shelf-items').addEventListener('click', (e) => {
  const b = e.target.closest('[data-shelf]');
  if (!b) return;
  const entry = render.shelf[Number(b.dataset.shelf)];
  if (entry) store.dispatch(opShelfCheck(entry, nightOf()));
});

$('player').addEventListener('ended', () => { playing = null; render(); });

for (const b of document.querySelectorAll('.modebtn')) {
  b.addEventListener('click', () => {
    if (render.view?.mode !== b.dataset.mode) store.dispatch(opSetMode(viewDate, b.dataset.mode));
  });
}
$('prev').onclick = () => { viewDate = addDays(viewDate, -1); render(); };
$('next').onclick = () => { viewDate = addDays(viewDate, 1); render(); };
$('sync').onclick = () => {
  if (snapshot.status === 'needkey') { $('keypanel').hidden = false; $('keyinput').focus(); }
  else store.syncNow();
};
$('keypanel').addEventListener('submit', (e) => {
  e.preventDefault();
  store.setKey($('keyinput').value);
  $('keyinput').value = '';
});

$('export').onclick = () => {
  const blob = new Blob([store.exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `1000-nights-backup-${nightOf()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('import').onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const n = store.importJson(await file.text());
    alert(`Merged ${n} records from the backup.`);
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  }
};

// Roll over to the new night if the app stays open past the 3 a.m. cutoff.
let lastNight = nightOf();
setInterval(() => {
  const n = nightOf();
  if (n !== lastNight) { if (viewDate === lastNight) viewDate = n; lastNight = n; render(); }
}, 60000);

// ---- boot ------------------------------------------------------------------
store = createStore((snap) => { snapshot = snap; render(); });
try {
  content = await loadContent();
} catch {
  $('items').innerHTML = '<li class="empty">Could not load the reading list. Open the app once with a connection so it can be saved for offline use.</li>';
}
render();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
