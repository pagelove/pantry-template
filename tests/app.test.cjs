'use strict';
// Focused UI/HTTP contract tests. This in-memory adapter does not implement
// Pagelove authorization, shape validation or uniqueness enforcement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const appRoot = path.resolve(__dirname, '../site/pantry-demo');
const html = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(appRoot, 'app.js'), 'utf8');

async function until(predicate, message = 'UI did not settle') {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

async function harness(t) {
  const store = new JSDOM(html);
  const dom = new JSDOM(html, { url: 'http://localhost/pantry-demo/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => { dom.window.close(); store.window.close(); });
  const { window } = dom;
  const doc = window.document;
  const serverDoc = store.window.document;
  let version = 1;
  let loseNext = false;
  const writes = [];
  const etag = () => `"version-${version}"`;
  const raw = () => serverDoc.documentElement.outerHTML;
  window.CSS = { escape: value => String(value).replace(/["\\]/g, '\\$&') };
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  // Polling itself is covered in browser QA. Keep test versions deterministic.
  window.setInterval = () => 1;
  window.fetch = async (_url, options = {}) => {
    if (!options.method || options.method === 'GET') return new Response(raw(), { status: 206, headers: { ETag: etag(), 'X-Pagelove-Preview': 'local' } });
    const entry = { method: options.method, selector: options.headers.Range.slice('selector='.length), ifMatch: options.headers['If-Match'], status: 0 };
    writes.push(entry);
    if (options.headers['If-Match'] !== etag()) { entry.status = 412; return new Response('Version changed', { status: 412 }); }
    const target = serverDoc.querySelector(entry.selector);
    assert.ok(target, 'Mutation must target an existing raw collection/record');
    const fragment = JSDOM.fragment(options.body);
    if (options.method === 'POST') target.appendChild(fragment);
    else if (options.method === 'PUT') target.replaceWith(fragment);
    else assert.fail('Unexpected mutation method');
    version++;
    entry.status = 206;
    if (loseNext) { loseNext = false; throw new TypeError('Simulated lost response after storage'); }
    return new Response('', { status: 206, headers: { ETag: etag() } });
  };
  window.eval(source);
  await until(() => !doc.querySelector('#open-add').disabled);
  const $ = selector => doc.querySelector(selector);
  const input = (form, name, value) => { form.elements[name].value = value; form.elements[name].dispatchEvent(new window.Event('input', { bubbles: true })); };
  const submit = form => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const row = name => [...serverDoc.querySelectorAll('#pantry-items > li')].find(li => li.querySelector('[itemprop="pantryName"]').content === name);
  const quantity = name => Number(row(name).querySelector('[itemprop="pantryQuantity"]').content);
  const openStock = (name, mode) => {
    const button = [...doc.querySelectorAll('[data-stock]')].find(button => button.dataset.stock === mode && button.getAttribute('aria-label') === `${mode === 'use' ? 'Use some' : 'Restock'} ${name}`);
    assert.ok(button, `Missing ${mode} action for ${name}`);
    button.click();
    assert.equal($('#stock-dialog').open, true);
    return $('#stock-form');
  };
  const add = (name = 'Red lentils') => {
    $('#open-add').click();
    const form = $('#add-form');
    input(form, 'itemName', name);
    input(form, 'quantity', '1');
    input(form, 'threshold', '0.5');
    input(form, 'target', '2');
    input(form, 'unit', 'kg');
    return form;
  };
  return { window, doc, serverDoc, $, input, submit, row, quantity, openStock, add, writes,
    loseNextResponse() { loseNext = true; },
    externalQuantity(name, value) { row(name).querySelector('[itemprop="pantryQuantity"]').content = String(value); version++; }
  };
}

test('normalized duplicate names are rejected without a network write', async t => {
  const h = await harness(t);
  const form = h.add('  ROLLED\u3000OATS  ');
  h.submit(form);
  assert.match(h.$('#add-error').textContent, /already in your pantry/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.serverDoc.querySelectorAll('#pantry-items > li').length, 8);
});

test('add, use and restock retain exact decimal quantities and update the shopping list', async t => {
  const h = await harness(t);
  h.submit(h.add());
  await until(() => !h.$('#add-dialog').open && !h.$('#open-add').disabled);
  assert.equal(h.quantity('Red lentils'), 1);
  let form = h.openStock('Red lentils', 'use');
  h.input(form, 'amount', '0.6');
  h.submit(form);
  await until(() => !h.$('#stock-dialog').open && !h.$('#open-add').disabled);
  assert.equal(h.quantity('Red lentils'), 0.4);
  assert.match(h.$('#shopping-list').textContent, /Red lentils/);
  form = h.openStock('Red lentils', 'restock');
  assert.equal(form.elements.amount.value, '1.6');
  h.submit(form);
  await until(() => !h.$('#stock-dialog').open && !h.$('#open-add').disabled);
  assert.equal(h.quantity('Red lentils'), 2);
  assert.doesNotMatch(h.$('#shopping-list').textContent, /Red lentils/);
  assert.deepEqual(h.writes.map(x => x.status), [206, 206, 206]);
});

test('zero, over-use and overflowing stock changes are rejected before writing', async t => {
  const h = await harness(t);
  let form = h.openStock('Rolled oats', 'use');
  h.input(form, 'amount', '0'); h.submit(form);
  assert.match(h.$('#stock-error').textContent, /greater than zero/);
  h.input(form, 'amount', '0.31'); h.submit(form);
  assert.match(h.$('#stock-error').textContent, /Enter a smaller amount/);
  h.$('#stock-dialog').close();
  form = h.openStock('Rolled oats', 'restock');
  h.input(form, 'amount', '9999'); h.submit(form);
  assert.match(h.$('#stock-error').textContent, /between 0 and 9999/);
  h.input(form, 'amount', '0.001'); h.submit(form);
  assert.match(h.$('#stock-error').textContent, /two decimal places/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.quantity('Rolled oats'), 0.3);
});

test('stale ETag reloads current stock and requires an explicit reviewed retry', async t => {
  const h = await harness(t);
  const form = h.openStock('Rolled oats', 'use');
  h.input(form, 'amount', '0.1');
  h.externalQuantity('Rolled oats', 0.2);
  h.submit(form);
  await until(() => h.$('#stock-error').textContent.includes('another tab') && !h.$('#stock-submit').disabled);
  assert.equal(h.quantity('Rolled oats'), 0.2, 'A rejected stale mutation must not change stock');
  assert.equal(form.elements.amount.value, '0.1', 'The entered amount is preserved');
  assert.match(h.$('#stock-context').textContent, /0\.2 kg at home/);
  assert.deepEqual(h.writes.map(x => x.status), [412], 'No automatic mutation retry');
  h.submit(form);
  await until(() => !h.$('#stock-dialog').open && !h.$('#open-add').disabled);
  assert.equal(h.quantity('Rolled oats'), 0.1);
  assert.deepEqual(h.writes.map(x => x.status), [412, 206]);
  assert.notEqual(h.writes[0].ifMatch, h.writes[1].ifMatch);
});

test('lost create response reports uncertainty and cannot duplicate an already-saved item', async t => {
  const h = await harness(t);
  const form = h.add('Buckwheat flour');
  h.loseNextResponse(); h.submit(form);
  await until(() => h.$('#add-error').textContent.includes('may already') && !form.querySelector('[type="submit"]').disabled);
  assert.equal(h.quantity('Buckwheat flour'), 1, 'Server committed despite the lost response');
  assert.equal(form.elements.itemName.value, 'Buckwheat flour');
  assert.equal(h.$('#add-dialog').open, true);
  h.submit(form);
  await until(() => h.$('#add-error').textContent.includes('another tab') && !form.querySelector('[type="submit"]').disabled);
  assert.deepEqual(h.writes.map(x => x.status), [206, 412]);
  h.submit(form);
  assert.match(h.$('#add-error').textContent, /already in your pantry/);
  assert.equal(h.writes.length, 2, 'Duplicate is caught before a third request');
  assert.equal([...h.serverDoc.querySelectorAll('[itemprop="pantryName"]')].filter(el => el.content === 'Buckwheat flour').length, 1);
});

test('lost stock response leaves explicit uncertainty feedback and stale retry cannot repeat the delta', async t => {
  const h = await harness(t);
  const form = h.openStock('Rolled oats', 'use');
  h.input(form, 'amount', '0.1');
  h.loseNextResponse(); h.submit(form);
  await until(() => h.$('#stock-error').textContent.includes('may already') && !h.$('#stock-submit').disabled);
  assert.equal(h.quantity('Rolled oats'), 0.2);
  assert.match(h.$('#stock-error').textContent, /Refresh and check the inventory before repeating/);
  h.submit(form);
  await until(() => h.$('#stock-error').textContent.includes('another tab') && !h.$('#stock-submit').disabled);
  assert.equal(h.quantity('Rolled oats'), 0.2, 'Stale retry must not subtract again');
  assert.deepEqual(h.writes.map(x => x.status), [206, 412]);
});

test('inventory groups follow storage locations and omit groups with no matching items', async t => {
  const h = await harness(t);
  const groups = () => [...h.doc.querySelectorAll('.storage-group')];
  assert.deepEqual(groups().map(group => group.dataset.storage), ['Fridge', 'Cupboard', 'Freezer']);
  assert.equal(h.doc.querySelectorAll('.item-row').length, 8);
  for (const group of groups()) {
    const rows = [...group.querySelectorAll('.item-row')];
    assert.ok(rows.every(row => row.dataset.location === group.dataset.storage));
    assert.equal(group.querySelector('.storage-heading > span').textContent, `${rows.length} ${rows.length === 1 ? 'item' : 'items'}`);
  }
  h.$('#search').value = 'yogurt';
  h.$('#search').dispatchEvent(new h.window.Event('input', { bubbles: true }));
  assert.deepEqual(groups().map(group => group.dataset.storage), ['Fridge']);
  assert.equal(h.doc.querySelectorAll('.item-row').length, 1);
  h.$('#search').value = '';
  h.$('#search').dispatchEvent(new h.window.Event('input', { bubbles: true }));
  h.$('[data-filter="low"]').click();
  assert.deepEqual(groups().map(group => group.dataset.storage), ['Cupboard']);
  h.$('[data-filter="all"]').click();
  const form = h.add('Bananas');
  h.input(form, 'location', 'Counter');
  h.submit(form);
  await until(() => !h.$('#add-dialog').open && !h.$('#open-add').disabled);
  assert.deepEqual(groups().map(group => group.dataset.storage), ['Fridge', 'Cupboard', 'Freezer', 'Counter']);
  assert.match(h.$('[data-storage="Counter"]').textContent, /Bananas/);
  assert.equal(h.row('Bananas').querySelector('[itemprop="pantryLocation"]').content, 'Counter');
});

test('refresh preserves the focused stock action and safely handles unavailable rows', async t => {
  const h = await harness(t);
  const action = (list, name, mode = 'restock') => [...h.$(list).querySelectorAll('[data-stock]')].find(button => button.getAttribute('aria-label') === `${mode === 'use' ? 'Use some' : 'Restock'} ${name}`);
  const refresh = async previous => {
    h.doc.dispatchEvent(new h.window.Event('visibilitychange'));
    await until(() => !previous.isConnected && !h.$('#open-add').disabled);
  };
  let previous = action('#inventory-list', 'Spinach');
  previous.focus();
  await refresh(previous);
  assert.equal(h.doc.activeElement, action('#inventory-list', 'Spinach'), 'Inventory focus returns to the same item/action');
  assert.equal(h.doc.activeElement.disabled, false);

  previous = action('#shopping-list', 'Chickpeas');
  previous.focus();
  await refresh(previous);
  assert.equal(h.doc.activeElement, action('#shopping-list', 'Chickpeas'), 'Shopping focus must stay in the shopping list rather than jumping to its inventory copy');

  previous = action('#inventory-list', 'Spinach');
  previous.focus();
  h.doc.dispatchEvent(new h.window.Event('visibilitychange'));
  h.$('#search').focus();
  await until(() => !previous.isConnected && !h.$('#open-add').disabled);
  assert.equal(h.doc.activeElement, h.$('#search'), 'A refresh must not steal focus the user moved during the request');

  previous = action('#inventory-list', 'Spinach');
  previous.focus();
  h.row('Spinach').remove();
  await refresh(previous);
  assert.equal(h.doc.activeElement, h.$('#search'), 'A removed item falls back to the stable search control');

  previous = action('#inventory-list', 'Rolled oats', 'use');
  previous.focus();
  h.externalQuantity('Rolled oats', 0);
  await refresh(previous);
  assert.equal(action('#inventory-list', 'Rolled oats', 'use').disabled, true);
  assert.equal(h.doc.activeElement, h.$('#search'), 'An action disabled by changed stock cannot retain focus');

  h.$('[data-filter="low"]').click();
  previous = action('#inventory-list', 'Rolled oats');
  previous.focus();
  h.externalQuantity('Rolled oats', 2);
  await refresh(previous);
  assert.equal(action('#inventory-list', 'Rolled oats'), undefined);
  assert.equal(h.doc.activeElement, h.$('#search'), 'An item leaving the active filter uses the same safe fallback');
});
