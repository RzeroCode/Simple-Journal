const COLORS = ['#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#fb7185'];
const $ = id => document.getElementById(id);
const viewer = $('viewer');
let openCard = null, openEntryData = null;

// Local date, not toISOString(), which is UTC and can give yesterday's date.
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const longDate = date => new Date(date + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = date => new Date(date + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const shortTime = iso => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (res.status === 401) { location.replace('/login'); throw new Error('Not logged in'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Something went wrong. Please try again.');
  }
  return res.status === 204 ? null : res.json();
}

const showError = err => { $('error').textContent = err ? err.message || String(err) : ''; };

async function deleteEntry(id) {
  try { await api(`/api/entries/${id}`, { method: 'DELETE' }); showError(null); render(); }
  catch (err) { showError(err); }
}

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
  viewer.style.setProperty('--c', color);
  $('vDate').textContent = longDate(entry.date);
  $('vTime').textContent = `Written at ${shortTime(entry.created_at)}`;
  $('vText').textContent = entry.text;
  setEditing(false);
  card.style.viewTransitionName = 'entry';
  animate(() => {
    card.style.viewTransitionName = '';
    viewer.style.viewTransitionName = 'entry';
    viewer.showModal();
    $('vText').scrollTop = 0;
  });
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
const hasUnsavedEdit = () => editing && $('vEdit').value.trim() !== openEntryData.text;
const okToDiscard = () => !hasUnsavedEdit() || confirm('Discard your changes?');

function setEditing(on) {
  editing = on;
  $('vText').hidden = on;
  $('vEdit').hidden = !on;
  $('vDelete').hidden = $('vEditBtn').hidden = on;
  $('vSave').hidden = $('vCancel').hidden = $('vHint').hidden = !on;
  $('vError').textContent = '';
  if (on) {
    $('vEdit').value = openEntryData.text;
    $('vEdit').focus();
  }
}

function cancelEdit() {
  if (!okToDiscard()) return;
  setEditing(false);
  $('vEditBtn').focus();
}

async function saveEdit() {
  const text = $('vEdit').value.trim();
  if (!text) return $('vError').textContent = "An entry can't be empty.";
  if (text === openEntryData.text) return cancelEdit();
  $('vSave').disabled = true;
  try {
    const updated = await api(`/api/entries/${openEntryData.id}`, { method: 'PATCH', body: JSON.stringify({ text }) });
    openEntryData.text = updated.text; // same object the card's click handler holds
    $('vText').textContent = updated.text;
    if (openCard && openCard.isConnected) openCard.querySelector('.preview').textContent = updated.text;
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

viewer.addEventListener('cancel', ev => { ev.preventDefault(); editing ? cancelEdit() : closeViewer(); }); // Esc
viewer.addEventListener('close', () => { viewer.style.viewTransitionName = ''; });  // closed by any route
viewer.onclick = ev => { if (ev.target === viewer && !editing) closeViewer(); };   // backdrop; ignored mid-edit so a stray click can't lose text
$('vClose').onclick = () => { if (okToDiscard()) closeViewer(); };
$('vDelete').onclick = () => { viewer.close(); deleteEntry(openEntryData.id); };

// Shows the search results while the search box has text, otherwise the selected day.
async function render() {
  const date = $('date').value, q = $('q').value.trim();
  $('heading').textContent = q ? `Results for “${q}”` : date === todayStr() ? `Today · ${longDate(date)}` : longDate(date);

  let list;
  try { list = await api(q ? `/api/search?q=${encodeURIComponent(q)}` : `/api/entries?date=${encodeURIComponent(date)}`); }
  catch (err) { return showError(err); }
  if ($('date').value !== date || $('q').value.trim() !== q) return; // user changed the view while this was loading

  const cards = $('cards');
  cards.replaceChildren();
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = q ? 'No entries match your search.' : 'No entries for this day yet.';
    cards.append(p);
    return;
  }
  list.forEach((e, i) => {
    const color = COLORS[i % COLORS.length];
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

    const time = document.createElement('time');
    time.dateTime = e.created_at;
    time.textContent = q ? `${shortDate(e.date)} · ${shortTime(e.created_at)}` : shortTime(e.created_at);

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.setAttribute('aria-label', 'Delete entry');
    del.onclick = () => deleteEntry(e.id);

    card.onclick = ev => {
      if (ev.target.closest('.del') || getSelection().toString()) return;
      openEntry(card, e, color);
    };
    card.append(body, time, del);
    cards.append(card);
  });
}

$('form').onsubmit = async ev => {
  ev.preventDefault();
  const text = $('text').value.trim();
  if (!text) return;
  $('add').disabled = true;
  try {
    await api('/api/entries', { method: 'POST', body: JSON.stringify({ date: $('date').value, text }) });
    $('text').value = '';
    $('q').value = ''; // show the day the entry was added to
    showError(null);
    render();
  } catch (err) { showError(err); }
  finally { $('add').disabled = false; }
};
$('text').onkeydown = ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) $('form').requestSubmit(); };
$('date').onchange = () => { if (!$('date').value) $('date').value = todayStr(); $('q').value = ''; render(); };
$('today').onclick = () => { $('date').value = todayStr(); $('q').value = ''; render(); };
$('q').oninput = render;
$('logout').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.replace('/login'); };

api('/api/me').then(me => { $('who').textContent = `Signed in as ${me.email}`; }).catch(() => {});
$('date').value = todayStr();
render();
