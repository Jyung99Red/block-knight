const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

// node:vm cannot run a real dynamic import() without an experimental flag,
// so the boot source is run with import( renamed to a stub the test owns.
function harness(overrides = {}) {
    const nodes = [], listeners = {}, timers = new Map(), requests = [], imports = [];
    const root = { dataset: {} }; let timerId = 0, started = 0, tuned = 0, mapped = 0, c;
    const element = tag => ({
        tag, dataset: {}, style: {}, textContent: '', isConnected: false,
        remove() { this.isConnected = false; }, setAttribute() {}, addEventListener() {},
        appendChild(node) { node.isConnected = true; nodes.push(node); return node; }
    });
    const document = {
        documentElement: root, currentScript: { dataset: { entry: overrides.entry || 'game' } }, hidden: false, baseURI: 'http://game.test/',
        createElement: element, getElementById: id => nodes.find(n => n.id === id && n.isConnected),
        addEventListener(type, fn) { listeners[type] = fn; }, head: element('head'), body: element('body')
    };
    document.head.appendChild = node => { node.isConnected = true; nodes.push(node); node.sheet = { cssRules: [{}, {}] }; return node; };
    document.body.appendChild = node => {
        node.isConnected = true; nodes.push(node);
        if (node.tag === 'script' && !node.src) vm.runInContext(node.textContent, c);
        return node;
    };
    const manifest = overrides.manifest || { game: { modules: { THREE: 'vendor/three.js' }, styles: ['style.css'], scripts: ['first.js', 'second.js'] } };
    const responses = {
        'client-assets.json': JSON.stringify(manifest),
        'style.css': 'body { color: red; }', 'first.js': 'var order = [typeof THREE === "object" ? THREE.REVISION : "missing"];', 'second.js': 'order.push(2);',
        ...overrides.responses
    };
    c = vm.createContext({
        document, console: { error() {} }, AbortController, URL, location: { reload() {} },
        app: { start() { started++; } }, tuneApp: { start() { tuned++; } }, mapApp: { start() { mapped++; } },
        addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener(type) { delete listeners[type]; },
        getComputedStyle: () => ({ getPropertyValue: key => !overrides.invalidStyles && nodes.some(n => n.isConnected && n.tag === 'style' && n.textContent.includes(key)) ? 'ready' : '' }),
        setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
        fetch: async (url, options) => {
            requests.push({ url, options });
            if (overrides.fetch) { const value = await overrides.fetch(url, requests); if (value != null) return { ok: true, text: async () => value }; }
            return { ok: true, text: async () => responses[url] };
        },
        __import: async url => {
            imports.push(url);
            if (overrides.importFails) throw new Error('network');
            if (overrides.importStalls) return new Promise(() => {});
            return { REVISION: '186' };
        }
    });
    // As in a browser, `window` is the global object itself.
    vm.runInContext('globalThis.window = globalThis', c);
    return {
        c, document, nodes, listeners, timers, requests, imports, root, started: () => started, tuned: () => tuned, mapped: () => mapped,
        run: () => vm.runInContext(source('core/client_boot.js').replace(/\bimport\(/g, '__import('), c)
    };
}

test('boot imports modules onto window before running the ordered scripts', async () => {
    const h = harness(); await h.run();
    assert.equal(h.root.dataset.clientState, 'ready'); assert.equal(h.started(), 1);
    assert.deepEqual(h.imports, ['http://game.test/vendor/three.js']);
    // Scripts see the module global, in manifest order.
    assert.deepEqual(Array.from(vm.runInContext('order', h.c)), ['186', 2]);
    assert.ok(h.requests.every(r => r.options.cache === 'no-store' && !r.url.startsWith('http')));
    assert.equal(h.timers.size, 0);
});
test('a module that fails to import is retried once, then the game stays behind the retry panel', async () => {
    const h = harness({ importFails: true }); await h.run();
    assert.equal(h.imports.length, 2); assert.match(h.imports[1], /^http:\/\/game\.test\/vendor\/three\.js\?retry=\d+$/);
    assert.equal(h.started(), 0); assert.equal(h.root.dataset.clientState, 'loading');
    assert.match(h.document.getElementById('client-loading').textContent, /未能完整加载/);
});
test('a stalled module import times out instead of hanging on the loading screen', async () => {
    const h = harness({ importStalls: true }), done = h.run();
    for (let round = 0; round < 2; round++) {
        await new Promise(resolve => setImmediate(resolve));
        for (const [id, fn] of [...h.timers]) { h.timers.delete(id); fn(); }
    }
    await done;
    assert.equal(h.imports.length, 2);
    assert.equal(h.started(), 0);
    assert.match(h.document.getElementById('client-loading').textContent, /未能完整加载/);
});
test('remote or malformed module entries are rejected', async () => {
    for (const modules of [{ THREE: 'https://cdn.example/three.js' }, { THREE: '//cdn.example/three.js' }, { THREE: 'data:text/javascript,export default 1' }, { THREE: '/vendor/three.js' }, { 'not a name': 'vendor/three.js' }]) {
        const h = harness({ manifest: { game: { modules, styles: ['style.css'], scripts: ['first.js'] } } }); await h.run();
        assert.equal(h.started(), 0); assert.equal(h.imports.length, 0);
    }
});
test('boot retries invalid CSS responses and keeps a persistent failure behind loading screen', async () => {
    const h = harness({ fetch: (url, requests) => url === 'style.css' && requests.filter(r => r.url === url).length === 1 ? '<html>upstream error</html>' : null });
    await h.run(); assert.equal(h.started(), 1); assert.equal(h.requests.filter(r => r.url === 'style.css').length, 2);
    const broken = harness({ responses: { 'style.css': '' } }); await broken.run();
    assert.equal(broken.started(), 0); assert.equal(broken.root.dataset.clientState, 'loading');
    assert.match(broken.document.getElementById('client-loading').textContent, /未能完整加载/);
});
test('unapplied CSS blocks startup; pageshow restores missing styles without starting twice', async () => {
    const bad = harness({ invalidStyles: true }); await bad.run(); assert.equal(bad.started(), 0);
    const h = harness(); await h.run(); h.nodes.find(n => n.tag === 'style').remove();
    h.listeners.pageshow();
    assert.equal(h.nodes.filter(n => n.tag === 'style' && n.isConnected).length, 1); assert.equal(h.started(), 1);
});

test('the move tuner\'s page (entry "tune") starts its own app, not the game', async () => {
    const manifest = { tune: { styles: ['style.css'], scripts: ['first.js'] } };
    const h = harness({ entry: 'tune', manifest, responses: { 'first.js': 'var order = [];' } }); await h.run();
    assert.equal(h.root.dataset.clientState, 'ready');
    assert.deepEqual([h.tuned(), h.started()], [1, 0]);
});
test('the map preview\'s page (entry "map") lists no module and starts its own app', async () => {
    const manifest = { map: { styles: ['style.css'], scripts: ['first.js'] } };
    const h = harness({ entry: 'map', manifest, responses: { 'first.js': 'var order = [];' } }); await h.run();
    assert.equal(h.root.dataset.clientState, 'ready');
    assert.deepEqual([h.mapped(), h.tuned(), h.started(), h.imports.length], [1, 0, 0, 0]);
});

// The other tests build a synthetic manifest. `client_boot` mounts each
// listed partial into `#mount-<id>` and throws when the div is absent, so
// check the real files agree: each entry with its page (the game, the move
// tuner and the map preview).
const PAGES = { game: 'index.html', tune: 'tune.html', map: 'map.html' };
test('the manifest and the pages agree on every partial, module, script and stylesheet', () => {
    const manifest = JSON.parse(source('client-assets.json'));
    assert.deepEqual(Object.keys(manifest).sort(), Object.keys(PAGES).sort());
    for (const [entry, file] of Object.entries(PAGES)) {
        const assets = manifest[entry], page = source(file);
        assert.match(page, new RegExp(`data-entry="${entry}"`), `${file} boots the "${entry}" entry`);
        for (const id of assets.partials) {
            assert.ok(fs.existsSync(path.join(__dirname, '..', 'partials', `${id}.html`)), `partials/${id}.html is listed but missing`);
            assert.match(page, new RegExp(`id="mount-${id}"`), `${file} has no mount point for the "${id}" partial`);
        }
        for (const [, id] of page.matchAll(/id="mount-([^"]+)"/g))
            assert.ok(assets.partials.includes(id), `${file} mounts "${id}", which the manifest does not list`);
        for (const f of [...assets.styles, ...assets.scripts, ...Object.values(assets.modules || {})])
            assert.ok(fs.existsSync(path.join(__dirname, '..', f)), `${f} is listed but missing`);
    }
    assert.match(source('index.html'), /viewport-fit=cover/, 'the page must reach under notches so safe-area insets apply');
});
test('every script is listed once per page and on some page; core/, models/, the tuner\'s workbench and the map preview\'s plan stay free of the DOM and three.js', () => {
    const manifest = JSON.parse(source('client-assets.json')), listed = new Set();
    for (const assets of Object.values(manifest)) {
        assert.equal(new Set(assets.scripts).size, assets.scripts.length);
        assets.scripts.forEach(f => listed.add(f));
    }
    const onDisk = ['core', 'models', 'render', 'ui', 'tune', 'mapview'].flatMap(dir => fs.readdirSync(path.join(__dirname, '..', dir)).filter(f => f.endsWith('.js')).map(f => `${dir}/${f}`));
    for (const file of onDisk) if (file !== 'core/client_boot.js') assert.ok(listed.has(file), `${file} is not in client-assets.json`);
    // The game itself never loads the tuner or the map preview; the map
    // preview draws in 2D: no three.js, nothing of the game's own pages.
    assert.ok(!manifest.game.scripts.some(f => /^(tune|mapview)\//.test(f)));
    assert.ok(!manifest.map.modules && !manifest.map.scripts.some(f => /^(render|ui|net|vendor|tune)\//.test(f)));
    for (const file of [...listed].filter(f => /^(core|models)\//.test(f) || f === 'tune/lab.js' || f === 'mapview/plan.js'))
        assert.doesNotMatch(source(file), /\b(document|window|THREE)\s*[.[]/, `${file} must run in Node and on a PVP host`);
});
