const COLORS = ['#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#fb7185'];
const MOODS = { great: '😄', good: '🙂', okay: '😐', low: '😕', sad: '😢', angry: '😠' }; // keys match the server's
const moodName = key => key[0].toUpperCase() + key.slice(1);
const $ = id => document.getElementById(id);
const viewer = $('viewer');
let openCard = null, openEntryData = null, openColor = null, showDates = false;

// Local date, not toISOString(), which is UTC and can give yesterday's date.
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => isoDate(new Date());
const longDate = date => new Date(date + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = date => new Date(date + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const shortTime = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (res.status === 401) { location.replace('/login'); throw new Error('Not logged in'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // A string for the app's own errors; a list for invalid input (e.g. a bad tag).
    const detail = typeof body.detail === 'string' ? body.detail : body.detail?.[0]?.msg?.replace(/^Value error, /, '');
    throw new Error(detail || 'Something went wrong. Please try again.');
  }
  return res.status === 204 ? null : res.json();
}

const showError = err => { $('error').textContent = err ? err.message || String(err) : ''; };

async function deleteEntry(id) {
  try { await api(`/api/entries/${id}`, { method: 'DELETE' }); showError(null); render(); loadDates(); }
  catch (err) { showError(err); }
}

// ----- mood and tags -----
// Mirrors the server's clean-up closely enough to tell whether an edit changed anything.
const parseTags = s => [...new Set(s.split(/[\s,]+/).map(t => t.replace(/^#+/, '').toLowerCase()).filter(Boolean))];

// A row of toggle buttons; pressing the chosen mood again clears it.
function moodPicker(group) {
  let value = null;
  const buttons = Object.entries(MOODS).map(([key, emoji]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mood';
    b.textContent = emoji;
    b.title = b.ariaLabel = moodName(key);
    b.onclick = () => set(value === key ? null : key);
    return b;
  });
  const set = v => { value = v; Object.keys(MOODS).forEach((key, i) => { buttons[i].ariaPressed = String(key === v); }); };
  group.replaceChildren(...buttons);
  set(null);
  return { get: () => value, set };
}
const newMood = moodPicker($('mood')), editMood = moodPicker($('vMood'));

function tagChips(tags, clickable) {
  return tags.map(tag => {
    const el = document.createElement(clickable ? 'button' : 'span');
    el.className = 'tag';
    el.textContent = '#' + tag;
    if (clickable) {
      el.type = 'button';
      el.ariaLabel = `Show entries tagged ${tag}`;
      el.onclick = () => { $('q').value = '#' + tag; render(); };
    }
    return el;
  });
}

// ----- month calendar: a dot marks each day that has entries -----
let entryCounts = {}, calMonth = new Date();
// The locale's first day of the week (1 = Monday ... 7 = Sunday); Monday where the browser can't tell.
const FIRST_DAY = (() => { const l = new Intl.Locale(navigator.language); return (l.getWeekInfo?.() ?? l.weekInfo)?.firstDay ?? 1; })() % 7;
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  new Date(2026, 0, 4 + FIRST_DAY + i).toLocaleDateString(undefined, { weekday: 'short' })); // Jan 4 2026 is a Sunday

function drawCalendar() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth(), selected = $('date').value;
  $('calTitle').textContent = calMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const cells = WEEKDAYS.map(name => {
    const s = document.createElement('span');
    s.className = 'wd';
    s.ariaHidden = 'true'; // each day button already says its full date
    s.textContent = name;
    return s;
  });
  const lead = (new Date(y, m, 1).getDay() - FIRST_DAY + 7) % 7;
  for (let i = 0; i < lead; i++) cells.push(document.createElement('span'));
  for (let d = 1, days = new Date(y, m + 1, 0).getDate(); d <= days; d++) {
    const date = isoDate(new Date(y, m, d)), n = entryCounts[date] || 0;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = n ? 'day has' : 'day';
    b.textContent = d;
    b.ariaLabel = n ? `${longDate(date)}, ${n} ${n === 1 ? 'entry' : 'entries'}` : longDate(date);
    b.ariaPressed = String(date === selected);
    if (date === todayStr()) b.ariaCurrent = 'date';
    b.onclick = () => selectDate(date);
    cells.push(b);
  }
  const hadFocus = $('calGrid').contains(document.activeElement);
  $('calGrid').replaceChildren(...cells);
  if (hadFocus) $('calGrid').querySelector('[aria-pressed=true]')?.focus(); // keep keyboard users in place
}

async function loadDates() {
  try { entryCounts = await api('/api/entry-dates'); drawCalendar(); }
  catch (err) { showError(err); }
}

// Every way of picking a day goes through here, so the calendar, search box and cards stay in step.
function selectDate(date) {
  $('date').value = date;
  $('q').value = '';
  calMonth = new Date(date + 'T00:00');
  drawCalendar();
  render();
}

$('calPrev').onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); drawCalendar(); };
$('calNext').onclick = () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); drawCalendar(); };

// Animates the DOM change with the View Transitions API where supported; otherwise applies it instantly.
function animate(update) {
  if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return Promise.resolve();
  }
  return document.startViewTransition(update).finished;
}

// The shared view-transition-name moves from the card to the dialog, so the card morphs into it.
function openEntry(card, entry, color) {
  if (viewer.open) return;
  openCard = card;
  openEntryData = entry;
  openColor = color;
  viewer.style.setProperty('--c', color);
  fillViewer();
  setEditing(false);
  card.style.viewTransitionName = 'entry';
  animate(() => {
    card.style.viewTransitionName = '';
    viewer.style.viewTransitionName = 'entry';
    viewer.showModal();
    $('vText').scrollTop = 0;
  });
}

function fillViewer() {
  const e = openEntryData;
  $('vDate').textContent = longDate(e.date);
  $('vTime').textContent = `Written at ${shortTime(e.created_at)}` + (e.mood ? ` · ${MOODS[e.mood]} ${moodName(e.mood)}` : '');
  $('vText').textContent = e.text;
  $('vTags').replaceChildren(...tagChips(e.tags, false));
}

function closeViewer() {
  if (!viewer.open) return;
  const card = openCard && openCard.isConnected ? openCard : null;
  animate(() => {
    viewer.close();
    viewer.style.viewTransitionName = '';
    if (card) card.style.viewTransitionName = 'entry';
  }).then(() => {
    if (!card) return;
    card.style.viewTransitionName = '';
    card.querySelector('.body').focus({ preventScroll: true });
  });
}

// ----- editing inside the expanded view -----
let editing = false;
const editedFields = () => ({ text: $('vEdit').value.trim(), mood: editMood.get(), tags: parseTags($('vTagsInput').value) });
const unchanged = f => f.text === openEntryData.text && f.mood === openEntryData.mood && f.tags.join() === openEntryData.tags.join();
const hasUnsavedEdit = () => editing && !unchanged(editedFields());
const okToDiscard = () => !hasUnsavedEdit() || confirm('Discard your changes?');

function setEditing(on) {
  editing = on;
  $('vText').hidden = $('vTags').hidden = on;
  $('vEdit').hidden = $('vMeta').hidden = !on;
  $('vDelete').hidden = $('vEditBtn').hidden = on;
  $('vSave').hidden = $('vCancel').hidden = $('vHint').hidden = !on;
  $('vError').textContent = '';
  if (on) {
    $('vEdit').value = openEntryData.text;
    editMood.set(openEntryData.mood);
    $('vTagsInput').value = openEntryData.tags.join(', ');
    $('vEdit').focus();
  }
}

function cancelEdit() {
  if (!okToDiscard()) return;
  setEditing(false);
  $('vEditBtn').focus();
}

async function saveEdit() {
  const fields = editedFields();
  if (!fields.text) return $('vError').textContent = "An entry can't be empty.";
  if (unchanged(fields)) return cancelEdit();
  $('vSave').disabled = true;
  try {
    const updated = await api(`/api/entries/${openEntryData.id}`, { method: 'PATCH', body: JSON.stringify(fields) });
    Object.assign(openEntryData, updated); // same object the card's click handler holds
    fillViewer();
    if (openCard && openCard.isConnected) {
      const fresh = makeCard(openEntryData, openColor);
      openCard.replaceWith(fresh);
      openCard = fresh; // so closing the viewer morphs back into the updated card
    }
    setEditing(false);
    $('vEditBtn').focus();
  } catch (err) {
    $('vError').textContent = err.message;
  } finally {
    $('vSave').disabled = false;
  }
}

$('vEditBtn').onclick = () => setEditing(true);
$('vSave').onclick = saveEdit;
$('vCancel').onclick = cancelEdit;
$('vEdit').onkeydown = ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) saveEdit(); };
$('vTagsInput').onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); saveEdit(); } };

viewer.addEventListener('cancel', ev => { ev.preventDefault(); editing ? cancelEdit() : closeViewer(); }); // Esc
viewer.addEventListener('close', () => { viewer.style.viewTransitionName = ''; });  // closed by any route
viewer.onclick = ev => { if (ev.target === viewer && !editing) closeViewer(); };   // backdrop; ignored mid-edit so a stray click can't lose text
$('vClose').onclick = () => { if (okToDiscard()) closeViewer(); };
$('vDelete').onclick = () => { viewer.close(); deleteEntry(openEntryData.id); };

function makeCard(e, color) {
  const card = document.createElement('article');
  card.className = 'card';
  card.style.setProperty('--c', color);

  const body = document.createElement('button'); // keyboard access; its click bubbles to the card
  body.type = 'button';
  body.className = 'body';
  body.setAttribute('aria-haspopup', 'dialog');
  const preview = document.createElement('span');
  preview.className = 'preview';
  preview.textContent = e.text; // textContent, never innerHTML: user text is not markup
  body.append(preview);

  const foot = document.createElement('div');
  foot.className = 'foot';
  const time = document.createElement('time');
  time.dateTime = e.created_at;
  time.textContent = showDates ? `${shortDate(e.date)} · ${shortTime(e.created_at)}` : shortTime(e.created_at);
  foot.append(time);
  if (e.mood) {
    const mood = document.createElement('span');
    mood.className = 'card-mood';
    mood.role = 'img';
    mood.title = mood.ariaLabel = `Mood: ${moodName(e.mood)}`;
    mood.textContent = MOODS[e.mood];
    foot.append(mood);
  }
  foot.append(...tagChips(e.tags, true));

  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '×';
  del.setAttribute('aria-label', 'Delete entry');
  del.onclick = () => deleteEntry(e.id);

  card.onclick = ev => {
    if (ev.target.closest('.del, .tag') || getSelection().toString()) return;
    openEntry(card, e, color);
  };
  card.append(body, foot, del);
  return card;
}

// Shows search results while the search box has text ("#word" lists that tag), otherwise the selected day.
async function render() {
  const date = $('date').value, q = $('q').value.trim();
  const tag = /^#[^\s#]+$/.test(q) ? q.slice(1) : null;
  $('heading').textContent = tag ? `Tagged #${tag}` : q ? `Results for “${q}”` : date === todayStr() ? `Today · ${longDate(date)}` : longDate(date);

  let list;
  const url = tag ? `/api/search?tag=${encodeURIComponent(tag)}`
    : q ? `/api/search?q=${encodeURIComponent(q)}`
    : `/api/entries?date=${encodeURIComponent(date)}`;
  try { list = await api(url); }
  catch (err) { return showError(err); }
  if ($('date').value !== date || $('q').value.trim() !== q) return; // user changed the view while this was loading

  showDates = Boolean(q);
  const cards = $('cards');
  cards.replaceChildren();
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = tag ? 'No entries with this tag.' : q ? 'No entries match your search.' : 'No entries for this day yet.';
    cards.append(p);
    return;
  }
  cards.append(...list.map((e, i) => makeCard(e, COLORS[i % COLORS.length])));
}

$('form').onsubmit = async ev => {
  ev.preventDefault();
  const text = $('text').value.trim();
  if (!text) return;
  $('add').disabled = true;
  try {
    await api('/api/entries', { method: 'POST', body: JSON.stringify({
      date: $('date').value, text, mood: newMood.get(), tags: parseTags($('tags').value),
    }) });
    $('text').value = $('tags').value = '';
    newMood.set(null);
    $('q').value = ''; // show the day the entry was added to
    showError(null);
    render();
    loadDates();
  } catch (err) { showError(err); }
  finally { $('add').disabled = false; }
};
$('text').onkeydown = ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) $('form').requestSubmit(); };
$('date').onchange = () => selectDate($('date').value || todayStr());
$('today').onclick = () => selectDate(todayStr());
$('q').oninput = render;
$('logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.replace('/login'); };

api('/api/me').then(me => { $('who').textContent = `Signed in as ${me.email}`; }).catch(() => {});
selectDate(todayStr());
loadDates();
