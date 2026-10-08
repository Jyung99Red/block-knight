// Download and validate local assets before exposing the game. ES modules
// listed under `modules` (three.js) are imported first and exposed as the
// named globals; everything else stays a classic global script.
const clientBoot = (() => {
    const root = document.documentElement;
    let styles = [], styleNodes = [], loaded = false;
    function loadingPanel() {
        let node = document.getElementById('client-loading');
        if (!node) {
            node = document.createElement('div'); node.id = 'client-loading';
            node.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#101b20;color:#e5efed;display:grid;place-content:center;gap:16px;text-align:center';
            document.body.appendChild(node);
        }
        node.setAttribute('role', 'status'); return node;
    }
    function fail(error) {
        console.error(error); root.dataset.clientState = 'loading';
        const node = loadingPanel(); node.textContent = '游戏资源未能完整加载，请检查连接后重试。';
        const retry = document.createElement('button'); retry.textContent = '重新加载';
        retry.addEventListener('click', () => location.reload()); node.appendChild(retry);
    }
    async function read(path) {
        for (let attempt = 0; attempt < 2; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            try {
                const response = await fetch(path, { cache: 'no-store', signal: controller.signal });
                if (!response.ok) throw new Error(`加载失败：${path} (${response.status})`);
                const body = await response.text();
                if (!body.trim() || (!path.endsWith('.html') && /^\s*<(?:!doctype|html|head|body)\b/i.test(body))) {
                    throw new Error(`资源内容无效：${path}`);
                }
                return body;
            } catch (error) {
                if (attempt === 1) throw error;
            } finally { clearTimeout(timer); }
        }
    }
    // A module cannot be fetched with an abort signal, so a stalled import
    // is raced against a timer; the retry adds a query so a failure the
    // browser remembers for that URL is not simply replayed.
    async function importModule(path) {
        const url = new URL(path, document.baseURI).href;
        for (let attempt = 0; attempt < 2; attempt++) {
            let timer;
            const stalled = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('超时')), 20000); });
            try {
                return await Promise.race([import(attempt ? `${url}?retry=${Date.now()}` : url), stalled]);
            } catch (error) {
                if (attempt === 1) throw new Error(`模块加载失败：${path}（${error.message}）`);
            } finally { clearTimeout(timer); }
        }
    }
    // Every asset is a document-relative path on this server.
    const isLocal = path => typeof path === 'string' && path.length > 0 && !/^([a-z][\w+.-]*:|[/\\])/i.test(path);
    function stylesReady() {
        const computed = getComputedStyle(root);
        return styleNodes.length === styles.length && styleNodes.every((node, i) => {
            try {
                return node.isConnected && !node.disabled && node.sheet?.cssRules.length > 1 &&
                    computed.getPropertyValue(`--client-style-${i}`).trim() === 'ready';
            } catch (_) { return false; }
        });
    }
    function installStyles() {
        styleNodes.forEach(node => node.remove());
        styleNodes = styles.map(([path, source], i) => {
            const node = document.createElement('style'); node.dataset.source = path;
            // A trailing marker must actually parse and apply before showing the shell.
            node.textContent = `${source}\n:root { --client-style-${i}: ready; }`;
            document.head.appendChild(node); return node;
        });
        if (!stylesReady()) throw new Error('样式未能完整应用');
    }
    function restoreStyles() {
        if (!loaded || document.hidden || stylesReady()) return;
        try { installStyles(); } catch (error) { fail(error); }
    }
    async function start(entry) {
        root.dataset.clientState = 'loading';
        loadingPanel().textContent = '正在加载游戏…';
        try {
            const assets = JSON.parse(await read('client-assets.json'))[entry];
            const modules = Object.entries(assets?.modules || {});
            if (!assets || !Array.isArray(assets.styles) || !assets.styles.length || !Array.isArray(assets.scripts) ||
                ![...assets.styles, ...assets.scripts, ...modules.map(([, path]) => path)].every(isLocal) ||
                !modules.every(([name]) => /^[A-Za-z_$][\w$]*$/.test(name))) {
                throw new Error('本地资源清单无效');
            }
            const paths = [...assets.styles, ...assets.scripts, ...(assets.partials || []).map(id => `partials/${id}.html`)];
            const [sources] = await Promise.all([
                Promise.all(paths.map(async path => [path, await read(path)])).then(list => new Map(list)),
                Promise.all(modules.map(async ([name, path]) => {
                    window[name] = await importModule(path);
                }))
            ]);
            styles = assets.styles.map(path => [path, sources.get(path)]); installStyles();
            for (const id of assets.partials || []) {
                const mount = document.getElementById(`mount-${id}`);
                if (!mount) throw new Error(`页面容器缺失：${id}`);
                mount.outerHTML = sources.get(`partials/${id}.html`);
            }
            for (const path of assets.scripts) {
                const script = document.createElement('script');
                let failure;
                const onError = event => { failure = event.error || new Error(event.message); };
                window.addEventListener('error', onError);
                try {
                    script.textContent = sources.get(path) + `\n//# sourceURL=${path}`;
                    document.body.appendChild(script);
                } finally { window.removeEventListener('error', onError); }
                if (failure) throw failure;
            }
            // Each page starts its own app: the game, the move tuner
            // (tune.html) or the map preview (map.html).
            ({ game: () => app.start(), tune: () => tuneApp.start(), map: () => mapApp.start() })[entry]?.();
            if (!stylesReady()) throw new Error('样式在初始化期间失效');
            loaded = true; root.dataset.clientState = 'ready'; loadingPanel().remove();
            window.addEventListener('pageshow', restoreStyles);
            document.addEventListener('visibilitychange', restoreStyles);
        } catch (error) { fail(error); }
    }
    return { start };
})();
clientBoot.start(document.currentScript.dataset.entry);
