(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const PAGE = new URL('index.html', location.href).pathname;
  const MAX = 9999;
  const state = { items: [], etag: '', loading: false, writing: false, loaded: false, filter: 'all', stock: null, addEtag: '' };
  const unitOptions = ['items', 'kg', 'grams', 'litres', 'ml', 'cans', 'jars', 'packs', 'tubs', 'bottles'];
  const locations = ['Cupboard', 'Fridge', 'Freezer', 'Counter'];
  const storageOrder = ['Fridge', 'Cupboard', 'Freezer', 'Counter'];
  let toastTimer;
  let focusedBeforeDialog;

  function escape(value) {
    return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const format = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function validDate(value) {
    if (!value) return true;
    const date = new Date(`${value}T12:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function daysUntil(value) {
    return value ? Math.round((Date.parse(`${value}T12:00:00Z`) - Date.parse(`${today()}T12:00:00Z`)) / 86400000) : null;
  }
  function isLow(item) { return item.quantity <= item.threshold; }
  function isSoon(item) { const d = daysUntil(item.bestBefore); return item.quantity > 0 && d !== null && d >= 0 && d <= 7; }
  function isPast(item) { const d = daysUntil(item.bestBefore); return item.quantity > 0 && d !== null && d < 0; }
  function normalizedName(value) { return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }
  function itemKey(name) { return PAGE + ':' + encodeURIComponent(normalizedName(name)); }
  function number(value, label) {
    const result = Number(value);
    if (String(value).trim() === '' || !Number.isFinite(result) || result < 0 || result > MAX || Math.abs(result - round(result)) > 0.0000001) {
      throw new Error(`${label} must be between 0 and ${MAX}, with up to two decimal places.`);
    }
    return result;
  }
  function validate(item) {
    if (!item.name || item.name.length > 80) throw new Error('Use an item name between 1 and 80 characters.');
    ['quantity', 'threshold', 'target'].forEach(key => number(item[key], key));
    if (item.target <= item.threshold) throw new Error('The restock target must be higher than the low-stock mark.');
    if (!unitOptions.includes(item.unit) || !locations.includes(item.location)) throw new Error('Choose a listed unit and location.');
    if (!validDate(item.bestBefore)) throw new Error('Enter a valid best-before date or leave it blank.');
    return item;
  }
  function parseItems(doc) {
    const list = $('#pantry-items', doc);
    if (!list) throw new Error('This response does not contain the pantry. Check the server, then refresh.');
    const result = [...list.children].map(row => {
      const prop = name => $(`[itemprop="pantry${name}"]`, row)?.getAttribute('content') || '';
      const item = validate({ key: prop('ItemKey'), name: prop('Name'), quantity: number(prop('Quantity'), 'Quantity'), threshold: number(prop('Threshold'), 'Low-stock mark'), target: number(prop('Target'), 'Restock target'), unit: prop('Unit'), location: prop('Location'), bestBefore: prop('BestBefore') });
      if (!item.key || row.dataset.key !== item.key) throw new Error('An inventory item has an invalid key. The saved data needs review.');
      return item;
    });
    if (new Set(result.map(x => x.key)).size !== result.length) throw new Error('Duplicate inventory keys were returned. The saved data needs review.');
    return result;
  }
  function fragment(item) {
    const fields = { ItemKey: item.key, Name: item.name, Quantity: item.quantity, Threshold: item.threshold, Target: item.target, Unit: item.unit, Location: item.location };
    if (item.bestBefore) fields.BestBefore = item.bestBefore;
    return `<li data-key="${escape(item.key)}" itemscope itemtype="https://wef.pantry/Item">${Object.entries(fields).map(([key, value]) => `<meta itemprop="pantry${key}" content="${escape(value)}">`).join('')}</li>`;
  }
  function dateLabel(item) {
    if (!item.bestBefore) return '';
    const date = new Date(item.bestBefore + 'T12:00:00');
    const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    const delta = daysUntil(item.bestBefore);
    if (item.quantity > 0 && delta < 0) return `<span class="date-tag past">Past date · ${escape(label)}</span>`;
    if (item.quantity > 0 && delta === 0) return '<span class="date-tag">Best before today</span>';
    return `<span class="${isSoon(item) ? 'date-tag' : ''}">Best before ${escape(label)}</span>`;
  }
  function say(message, bad = false) {
    clearTimeout(toastTimer);
    const el = $('#feedback');
    el.textContent = message;
    el.classList.toggle('is-error', bad);
    el.hidden = false;
    toastTimer = setTimeout(() => { el.hidden = true; }, bad ? 12000 : 6500);
  }
  function formError(id, error) {
    const el = $(id);
    el.textContent = error || '';
    el.hidden = !error;
  }
  function sync(message, bad = false) {
    $('#sync-state').textContent = message;
    $('#sync-state').classList.toggle('is-error', bad);
  }
  function lockControls() {
    const locked = !state.etag || state.loading || state.writing;
    $('#open-add').disabled = locked;
    $$('[data-stock]').forEach(button => { button.disabled = locked || (button.dataset.stock === 'use' && Number(button.dataset.quantity) <= 0); });
    $('#refresh').disabled = state.loading || state.writing;
    $$('#add-form button[type="submit"], #stock-form button[type="submit"]').forEach(button => { button.disabled = state.writing || state.loading || !state.etag; });
    $$('dialog [data-close]').forEach(button => { button.disabled = state.writing; });
  }
  function ingredientArt(item) {
    const name = normalizedName(item.name);
    if (/oat/.test(name)) return 'oats';
    if (/yogurt|yoghurt/.test(name)) return 'yogurt';
    if (/chickpea|garbanzo/.test(name)) return 'chickpeas';
    if (/lemon|lime|citrus/.test(name)) return 'lemons';
    if (/rice/.test(name)) return 'rice';
    if (/spinach|kale|greens/.test(name)) return 'spinach';
    if (/oil/.test(name)) return 'oil';
    if (/peas/.test(name)) return 'peas';
    return 'jar';
  }
  function itemCard(item) {
    const low = isLow(item);
    return `<article class="item-row${low ? ' is-low' : ''}" data-location="${escape(item.location)}"><div class="item-visual"><div class="ingredient-art" data-art="${ingredientArt(item)}" aria-hidden="true"></div></div><div class="item-main"><div class="item-top"><h4 class="item-name">${escape(item.name)}</h4>${low ? `<span class="stock-tag${item.quantity === 0 ? ' out' : ''}">${item.quantity === 0 ? 'Out of stock' : 'Low stock'}</span>` : ''}</div><p class="item-date">${dateLabel(item) || '<span>No date set</span>'}</p></div><div class="quantity">${format(item.quantity)} <small>${escape(item.unit)}</small><span class="stock-target">Target ${format(item.target)} ${escape(item.unit)}</span></div><div class="item-buttons"><button data-stock="use" data-key="${escape(item.key)}" data-quantity="${item.quantity}" aria-label="Use some ${escape(item.name)}">Use some</button><button class="restock" data-stock="restock" data-key="${escape(item.key)}" aria-label="Restock ${escape(item.name)}">Restock</button></div></article>`;
  }
  function storageGroups(items) {
    return storageOrder.map(location => {
      const group = items.filter(item => item.location === location);
      if (!group.length) return '';
      const headingId = 'storage-' + location.toLowerCase();
      return `<section class="storage-group" data-storage="${location}" aria-labelledby="${headingId}"><div class="storage-heading"><h3 id="${headingId}">${location}</h3><span>${group.length} ${group.length === 1 ? 'item' : 'items'}</span></div><div class="storage-rows">${group.map(itemCard).join('')}</div></section>`;
    }).join('');
  }
  function captureListFocus() {
    const element = document.activeElement;
    const list = element?.closest('#inventory-list, #shopping-list');
    return list ? { element, listId: list.id, key: element.dataset.key, mode: element.dataset.stock, id: element.id } : null;
  }
  function restoreListFocus(previous) {
    if (!previous || (document.activeElement !== document.body && document.activeElement !== previous.element)) return;
    const list = document.getElementById(previous.listId);
    const replacement = previous.key
      ? $$('[data-stock]', list).find(button => button.dataset.key === previous.key && button.dataset.stock === previous.mode)
      : previous.id ? document.getElementById(previous.id) : null;
    // A removed, filtered-out or disabled action cannot retain focus. Search is
    // stable and lets the user find the updated item without moving the viewport.
    const target = replacement && !replacement.disabled ? replacement : $('#search');
    target.focus({ preventScroll: true });
  }
  function render() {
    const previousFocus = captureListFocus();
    const shopping = state.items.filter(isLow).sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name));
    $('#total-count').textContent = state.items.length;
    $('#low-count').textContent = shopping.length;
    $('#soon-count').textContent = state.items.filter(item => isSoon(item) || isPast(item)).length;
    $('#shopping-count').textContent = shopping.length;
    const query = normalizedName($('#search').value);
    const predicates = { all: () => true, low: isLow, soon: isSoon, past: isPast };
    const visible = state.items.filter(item => predicates[state.filter](item) && normalizedName(item.name + ' ' + item.location).includes(query));
    const priority = item => isPast(item) ? 0 : isSoon(item) ? 1 : isLow(item) ? 2 : 3;
    visible.sort((a, b) => priority(a) - priority(b) || a.name.localeCompare(b.name));
    $('#inventory-list').innerHTML = visible.length ? storageGroups(visible) : `<div class="empty-state"><div class="ingredient-art empty-art" data-art="jar" aria-hidden="true"></div><h3>${state.items.length ? 'No matching items' : 'Your pantry is empty'}</h3><p>${state.items.length ? 'Try another filter or a different search.' : 'Add your first sample item to start your pantry.'}</p>${state.items.length ? '<button id="clear-filters">Show all items</button>' : '<button id="empty-add">Add an item</button>'}</div>`;
    $('#inventory-list').setAttribute('aria-busy', 'false');
    $('#shopping-list').innerHTML = shopping.length ? shopping.map(item => `<li><span class="shopping-name">${escape(item.name)}</span><span class="shopping-amount">+${format(round(item.target - item.quantity))} ${escape(item.unit)}</span><span class="shopping-sub">${format(item.quantity)} at home · target ${format(item.target)}</span><button data-stock="restock" data-key="${escape(item.key)}" aria-label="Restock ${escape(item.name)}">Restock</button></li>`).join('') : '<li class="shopping-empty">No items to buy. Items appear here when they reach their low-stock mark.</li>';
    lockControls();
    if (!state.loading && !state.writing) restoreListFocus(previousFocus);
  }
  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try { return await fetch(url, { ...options, signal: controller.signal, credentials: 'same-origin', cache: 'no-store' }); }
    catch (error) { throw new Error(error.name === 'AbortError' ? 'The request timed out. Refresh before trying again.' : 'Could not reach the pantry. Check your connection and refresh.'); }
    finally { clearTimeout(timeout); }
  }
  async function reload({ quiet = false } = {}) {
    if (state.loading) return false;
    // Capture before disabling controls, which can blur the focused action.
    const previousFocus = captureListFocus();
    state.loading = true;
    lockControls();
    if (!quiet) sync('Refreshing inventory…');
    try {
      const res = await request(`${PAGE}?cb=${Date.now()}`, { headers: { Range: 'selector=body' } });
      if (!res.ok) throw new Error(`Inventory could not be loaded (${res.status}). Your current view has been kept.`);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const items = parseItems(doc);
      const etag = res.headers.get('ETag') || '';
      state.items = items;
      state.loaded = true;
      state.etag = /^"[^"\r\n]+"$/.test(etag) ? etag : '';
      $('#preview-note').innerHTML = res.headers.get('X-Pagelove-Preview') === 'local'
        ? '<strong>Local preview</strong> · Changes stay on this computer.'
        : '<strong>Public sample</strong> · Use made-up inventory only.';
      render();
      sync(state.etag ? `Checked ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · refreshes every 15 seconds` : 'Read-only: this server did not provide a strong ETag. Safe stock edits need one.', !state.etag);
      return true;
    } catch (error) {
      state.etag = '';
      sync(error.message, true);
      if (!state.loaded) {
        $('#inventory-list').innerHTML = '<div class="empty-state is-error"><h3>Inventory could not load</h3><p>Check your connection, then use Refresh to try again.</p></div>';
        $('#inventory-list').setAttribute('aria-busy', 'false');
        $('#shopping-list').innerHTML = '<li class="shopping-empty">Your list will appear when the inventory loads.</li>';
      }
      return false;
    } finally { state.loading = false; lockControls(); restoreListFocus(previousFocus); }
  }
  async function write(method, selector, item, etag) {
    if (!etag) throw new Error('Refresh the pantry before saving. A current version is required.');
    let res;
    try {
      res = await request(PAGE, { method, headers: { Range: 'selector=' + selector, 'Content-Type': 'text/html', 'If-Match': etag }, body: fragment(item) });
    } catch (error) {
      throw new Error('The save could not be confirmed and may already have been applied. Refresh and check the inventory before repeating this change.');
    }
    if (res.status === 409 || res.status === 412) {
      await reload();
      const error = new Error('The pantry changed in another tab. Latest stock has been loaded. Review the updated amount and save again.');
      error.conflict = true;
      throw error;
    }
    if (!res.ok) {
      const body = await res.text();
      if (/uniqueness|duplicate/i.test(body)) throw new Error('An item with that name already exists. Restock the existing item instead.');
      throw new Error(res.status === 401 || res.status === 403 ? 'The server did not allow this change. Your entry has been kept.' : `The server rejected this change (${res.status}). Your entry has been kept.`);
    }
  }
  function openDialog(id) { focusedBeforeDialog = document.activeElement; $(id).showModal(); }
  function openAdd() {
    if (!state.etag || state.writing || state.loading) return;
    state.addEtag = state.etag;
    formError('#add-error', '');
    openDialog('#add-dialog');
    $('#add-form [name="itemName"]').focus();
  }
  function stockPreview() {
    if (!state.stock) return;
    const { item, mode } = state.stock;
    const raw = $('#stock-form').elements.amount.value;
    const amount = Number(raw);
    const next = round(item.quantity + (mode === 'use' ? -amount : amount));
    $('#stock-result').textContent = raw && Number.isFinite(next) ? `After this change: ${format(next)} ${item.unit} at home.` : 'Enter the amount you used or received.';
  }
  function stockContext() {
    const { item, mode } = state.stock;
    $('#stock-title').textContent = item.name;
    $('#stock-art').dataset.art = ingredientArt(item);
    $('#stock-context').textContent = `${format(item.quantity)} ${item.unit} at home · restock target ${format(item.target)} ${item.unit}`;
    $('#stock-eyebrow').textContent = mode === 'use' ? 'Record use' : 'Restock item';
    $('#amount-label').firstChild.textContent = `${mode === 'use' ? 'Amount used' : 'Amount received'} (${item.unit})`;
    $('#stock-date-field').hidden = mode === 'use';
    $('#stock-submit').textContent = mode === 'use' ? 'Record use' : 'Restock item';
    stockPreview();
  }
  function openStock(key, mode) {
    if (!state.etag || state.loading || state.writing) return;
    const item = state.items.find(item => item.key === key);
    if (!item || (mode === 'use' && item.quantity <= 0)) return;
    state.stock = { item: { ...item }, mode, etag: state.etag };
    const form = $('#stock-form');
    // Numeric form values use decimal dots independently of display locale.
    form.elements.amount.value = mode === 'use' ? Math.min(item.quantity, item.unit === 'kg' || item.unit === 'litres' ? 0.1 : 1) : Math.max(0.01, round(item.target - item.quantity));
    form.elements.bestBefore.value = item.bestBefore;
    formError('#stock-error', '');
    stockContext();
    openDialog('#stock-dialog');
    form.elements.amount.focus();
    form.elements.amount.select();
  }

  function markSection() {
    const current = location.hash === '#shopping-title' ? '#shopping-title' : '#inventory-title';
    $$('.app-nav a').forEach(link => {
      link.classList.toggle('active', link.hash === current);
      if (link.hash === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  window.addEventListener('hashchange', markSection);
  markSection();
  $('#open-add').addEventListener('click', openAdd);
  $('#refresh').addEventListener('click', () => reload());
  $('#search').addEventListener('input', render);
  $('.filters').addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    state.filter = button.dataset.filter;
    $$('[data-filter]').forEach(el => el.setAttribute('aria-pressed', String(el === button)));
    render();
  });
  document.addEventListener('click', event => {
    const stock = event.target.closest('[data-stock]');
    if (stock) openStock(stock.dataset.key, stock.dataset.stock);
    if (event.target.closest('#clear-filters')) {
      state.filter = 'all'; $('#search').value = '';
      $$('[data-filter]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.filter === 'all')));
      render(); $('#search').focus();
    }
    if (event.target.closest('#empty-add')) openAdd();
    const close = event.target.closest('[data-close]');
    if (close && !state.writing) close.closest('dialog').close();
  });
  $$('dialog').forEach(dialog => {
    dialog.addEventListener('cancel', event => { if (state.writing) event.preventDefault(); });
    dialog.addEventListener('close', () => {
      state.stock = null;
      if (focusedBeforeDialog?.isConnected) focusedBeforeDialog.focus();
      else $('#open-add').focus();
    });
  });
  $('#stock-form').elements.amount.addEventListener('input', stockPreview);
  $('#add-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (state.writing || state.loading) return;
    const form = event.currentTarget;
    formError('#add-error', '');
    try {
      const name = form.elements.itemName.value.trim().replace(/\s+/g, ' ');
      const item = validate({ key: itemKey(name), name, quantity: number(form.elements.quantity.value, 'Quantity'), threshold: number(form.elements.threshold.value, 'Low-stock mark'), target: number(form.elements.target.value, 'Restock target'), unit: form.elements.unit.value, location: form.elements.location.value, bestBefore: form.elements.bestBefore.value });
      if (state.items.some(existing => normalizedName(existing.name) === normalizedName(name))) throw new Error('That item is already in your pantry. Restock it instead.');
      state.writing = true; lockControls();
      await write('POST', '#pantry-items', item, state.addEtag);
      $('#add-dialog').close(); form.reset();
      const refreshed = await reload();
      say(refreshed ? `Added ${name} to your pantry.` : `${name} was saved. Refresh to load the updated pantry.`, !refreshed);
    } catch (error) {
      if (error.conflict) state.addEtag = state.etag;
      formError('#add-error', error.message);
    } finally { state.writing = false; lockControls(); }
  });
  $('#stock-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (state.writing || state.loading || !state.stock) return;
    const form = event.currentTarget;
    formError('#stock-error', '');
    try {
      const { item, mode, etag } = state.stock;
      const amount = number(form.elements.amount.value, 'Amount');
      if (amount <= 0) throw new Error('Enter an amount greater than zero.');
      if (mode === 'use' && amount > item.quantity) throw new Error(`You have ${format(item.quantity)} ${item.unit}. Enter a smaller amount.`);
      const updated = validate({ ...item, quantity: round(item.quantity + (mode === 'use' ? -amount : amount)), bestBefore: mode === 'restock' ? form.elements.bestBefore.value : item.bestBefore });
      state.writing = true; lockControls();
      await write('PUT', `#pantry-items > li[data-key="${CSS.escape(item.key)}"]`, updated, etag);
      $('#stock-dialog').close();
      const refreshed = await reload();
      say(refreshed ? `${item.name}: ${format(updated.quantity)} ${item.unit} now at home.` : 'Stock was saved. Refresh to load the updated pantry.', !refreshed);
    } catch (error) {
      if (error.conflict && state.stock) {
        const latest = state.items.find(item => item.key === state.stock.item.key);
        if (latest) { state.stock.item = { ...latest }; state.stock.etag = state.etag; stockContext(); }
        else { state.stock.etag = ''; }
      }
      formError('#stock-error', error.message);
    } finally { state.writing = false; lockControls(); }
  });
  $('#today-label').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  // The initial document already carries its inventory. Render that snapshot
  // synchronously, then acquire a fresh version before enabling edits. This
  // avoids a short loading list expanding into the real shelves after paint.
  try {
    state.items = parseItems(document);
    state.loaded = true;
    render();
  } catch (error) {
    // A malformed initial snapshot keeps the loading/error path available.
  }
  reload();
  setInterval(() => { if (!document.hidden && !state.writing) reload({ quiet: true }); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.writing) reload({ quiet: true }); });
})();
