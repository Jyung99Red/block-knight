// The item screens of the base's shop and smithy (design.md 7.3),
// landscape, two columns: a list on the left, what is picked on the right.
// The shop sells potions, a torch and the ring of stealth and buys materials; the smithy makes
// gear from materials and gold. (The bag is the menu's, ui/menu.js.) Every
// change goes through core/inventory.js on the world's progress;
// `changed(kind)` tells the page (it saves). Reads and writes no simulation
// state but that progress. `iconHtml` is an item's picture for any screen:
// gear drawn from its own model (render/figure_view.js), else its emoji.
const itemScreens = (() => {
    const SLOT_NAMES = Object.freeze({ main: '主手', offhand: '副手', armor: '护甲', accessory: '饰品' });
    const STAT_NAMES = Object.freeze({ maxHp: '生命', atk: '攻击', def: '防御' });
    const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    function iconHtml(id) {
        const url = figureView.icon(id);
        return url ? `<img class="item-icon" src="${url}" alt="">` : `<span class="item-icon">${gameConfig.items[id].icon}</span>`;
    }

    // hooks: progress() the world's progress; changed('trade'); closed().
    function attach(root, hooks) {
        const el = root.querySelector('[data-screen]'), $ = sel => el.querySelector(sel);
        const title = $('[data-screen-title]'), tabs = $('[data-screen-tabs]'), gold = $('[data-screen-gold]');
        const list = $('[data-screen-list]'), detail = $('[data-screen-detail]');
        const I = gameConfig.items, K = inventoryKit;
        let kind = null, tab = null, picked = null, note = '';

        const statLine = stats => K.STATS.filter(k => stats?.[k]).map(k => `${STAT_NAMES[k]} +${stats[k]}`).join('，');
        // The slot, and for a weapon its type (which decides the moves).
        const slotLine = item => SLOT_NAMES[item.slot] + (item.weapon ? ` · ${gameConfig.combo.weapons[item.weapon].name}` : '');
        const owned = id => K.count(hooks.progress(), id);
        const row = (id, sub, tag = '', dim = false) => ({ id, name: I[id].name, sub, tag, dim });

        // ---- what each screen shows: tabs, rows, and the picked row's detail ----
        const SCREENS = {
            shop: {
                title: '商店',
                tabs: [['buy', '买'], ['sell', '卖']],
                rows(t) {
                    if (t === 'buy') return K.forSale().map(id => row(id, `${I[id].price} 金币`, I[id].max > 1 ? `有 ${owned(id)}/${I[id].max}` : owned(id) ? '已有' : '', !!K.canBuy(hooks.progress(), id)));
                    return K.wanted().filter(id => owned(id) > 0).map(id => row(id, `× ${owned(id)} · 每个 ${I[id].sell}`));
                },
                detail(id, t) {
                    const p = hooks.progress(), item = I[id];
                    if (t === 'buy') return { lines: [item.desc, `价格 ${item.price} 金币`], actions: [{ id: 'buy', label: '买一个', primary: true, why: K.canBuy(p, id) }] };
                    const n = owned(id);
                    return {
                        lines: [item.desc, `每个 ${item.sell} 金币 · 有 ${n} 个`],
                        actions: [{ id: 'sell', label: '卖一个', primary: true, why: K.canSell(p, id) }, { id: 'sellAll', label: `全部卖掉（${n * item.sell} 金币）`, why: K.canSell(p, id) }]
                    };
                },
                act(action, id) {
                    const p = hooks.progress();
                    const why = action === 'buy' ? K.buy(p, id) : K.sell(p, id, action === 'sellAll' ? Infinity : 1);
                    if (!why) hooks.changed('trade');
                    return why || (action === 'buy' ? `买到了${I[id].name}` : `卖掉了${I[id].name}`);
                }
            },
            smithy: {
                title: '铁匠铺',
                tabs: [],
                rows() {
                    const p = hooks.progress();
                    // Bright when it can be made now; tagged when owned or ready.
                    return K.recipes().map(id => row(id, SLOT_NAMES[I[id].slot], owned(id) ? '已有' : K.canCraft(p, id) ? '' : '能打造', owned(id) > 0 || !!K.canCraft(p, id)));
                },
                detail(id) {
                    const p = hooks.progress(), item = I[id];
                    return {
                        lines: [item.desc, `${slotLine(item)} · ${statLine(item.stats)}`],
                        needs: K.needs(p, id).map(n => [n.id, I[n.id].name, n.have, n.need]),
                        actions: [{ id: 'craft', label: '打造', primary: true, why: K.canCraft(p, id) }]
                    };
                },
                act(action, id) {
                    const why = K.craft(hooks.progress(), id);
                    if (!why) hooks.changed('trade');
                    return why || `打造好了${I[id].name}，打开菜单装上`;
                }
            }
        };

        function render() {
            const S = SCREENS[kind], rows = S.rows(tab);
            if (!rows.some(r => r.id === picked)) picked = rows[0]?.id ?? null;
            title.textContent = S.title;
            gold.innerHTML = `${iconHtml('gold')} ${hooks.progress().inventory.gold}`;
            tabs.innerHTML = S.tabs.map(([id, label]) => `<button type="button" data-tab="${id}" class="${id === tab ? 'on' : ''}">${label}</button>`).join('');
            list.innerHTML = rows.length ? rows.map(r => `<li><button type="button" data-row="${r.id}" class="${r.id === picked ? 'on' : ''}${r.dim ? ' dim' : ''}">
                <span class="row-icon">${iconHtml(r.id)}</span><span class="row-name">${esc(r.name)}</span><span class="row-sub">${esc(r.sub)}</span>${r.tag ? `<em class="row-tag">${esc(r.tag)}</em>` : ''}</button></li>`).join('')
                : `<li class="empty">${kind === 'shop' && tab === 'sell' ? '没有可卖的材料' : '什么都没有'}</li>`;
            if (!picked) { detail.innerHTML = note ? `<p class="detail-note">${esc(note)}</p>` : ''; return; }
            const d = S.detail(picked, tab), item = I[picked];
            detail.innerHTML = `<h3><span class="row-icon">${iconHtml(picked)}</span>${esc(item.name)}</h3>
                ${d.lines.filter(Boolean).map(l => `<p>${esc(l)}</p>`).join('')}
                ${d.compare ? `<dl class="detail-stats">${d.compare.map(([k, a, b]) => `<div><dt>${k}</dt><dd>${a}${a !== b ? ` → <b class="${b > a ? 'up' : 'down'}">${b}</b>` : ''}</dd></div>`).join('')}</dl>` : ''}
                ${!d.compare && d.totals ? `<dl class="detail-stats">${d.totals.map(([k, a]) => `<div><dt>${k}</dt><dd>${a}</dd></div>`).join('')}</dl>` : ''}
                ${d.needs ? `<ul class="detail-needs">${d.needs.map(([id, name, have, need]) => `<li class="${have >= need ? 'ok' : 'short'}">${iconHtml(id)} ${esc(name)} <b>${have}/${need}</b></li>`).join('')}</ul>` : ''}
                <div class="detail-actions">${d.actions.map(a => `<button type="button" data-act="${a.id}" class="${a.primary ? 'primary' : ''}" ${a.why ? 'disabled' : ''}>${esc(a.label)}</button>`).join('')}</div>
                <p class="detail-note">${esc(note || d.actions.find(a => a.why)?.why || '')}</p>`;
        }
        function open(next) {
            kind = next; tab = SCREENS[next].tabs[0]?.[0] ?? null; picked = null; note = '';
            el.hidden = false;
            render();
            $('[data-screen-close]').focus({ preventScroll: true });
        }
        function close() {
            if (!kind) return;
            const was = { kind };
            kind = null; el.hidden = true;
            hooks.closed(was);
        }
        tabs.addEventListener('click', e => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (t) { tab = t; picked = null; note = ''; render(); } });
        list.addEventListener('click', e => { const r = e.target.closest('[data-row]')?.dataset.row; if (r) { picked = r; note = ''; render(); } });
        detail.addEventListener('click', e => {
            const a = e.target.closest('[data-act]');
            if (!a || a.disabled || !picked) return;
            note = SCREENS[kind].act(a.dataset.act, picked);
            render();
        });
        $('[data-screen-close]').addEventListener('click', close);
        // Escape closes; taken before the game sees it.
        window.addEventListener('keydown', e => {
            if (!kind || e.code !== 'Escape') return;
            e.preventDefault(); e.stopPropagation();
            if (!e.repeat) close();
        }, true);
        return { open, close, isOpen: () => !!kind, get kind() { return kind; }, render };
    }
    return { attach, SLOT_NAMES, STAT_NAMES, iconHtml };
})();
