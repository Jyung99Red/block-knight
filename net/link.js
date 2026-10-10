// The channel between two phones for a duel (design.md 8) or a shared
// adventure (design.md 10), carried over from the 2D version (tag v1-2d,
// pvp/pvp_net.js and pvp_room.js). A room is a 4-digit code; duels and
// shared adventures have rooms apart (`room`), so a code of one never
// finds the other. Both phones meet through a PeerJS signalling
// server (the free public one unless the address says ?peer=host:port,
// for a self-hosted PeerServer) and then talk directly over WebRTC; the
// server never carries the game. With ?link=local two tabs of one browser
// talk over a BroadcastChannel instead: no network at all, for trying a
// duel on one computer and for the browser tests.
//
// A link knows nothing about the game. on: { open() the channel is up,
// message(msg), close() it is gone, status(text) for the room screen }.
// host(code) resolves once the room exists and waits for one guest at a
// time: once one is gone (or let go: `drop`) the next may come, and the
// channel opens again. join(code) resolves once connected. Failures
// reject with an Error whose message is fit to show; `code: 'taken'`
// means pick another room code.
const netLink = (() => {
    const PREFIXES = { duel: 'blockduel-1-', coop: 'blockcoop-1-' };
    const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
    const params = () => new URLSearchParams(window.location.search);
    const kind = () => params().get('link') === 'local' ? 'local' : 'peer';
    const randomCode = () => String(Math.floor(1000 + Math.random() * 9000));
    const fail = (message, code) => Object.assign(new Error(message), { code });
    const timeoutSeconds = () => gameConfig.pvp.connectSeconds;

    // ---- PeerJS ----
    function peerOptions() {
        const at = params().get('peer'), options = { debug: 1, config: { iceServers: ICE } };
        if (!at) return options;
        const [host, port] = at.split(':');
        return { ...options, host, port: Number(port) || 9000, path: '/', secure: window.location.protocol === 'https:' && !/^(localhost|127\.)/.test(host) };
    }
    const PEER_ERRORS = {
        'peer-unavailable': '房间号不存在，或对方已经离开',
        'unavailable-id': '这个房间号正被占用',
        network: '连不上联机服务器，请检查网络',
        'server-error': '联机服务器出错，请稍后再试',
        'socket-error': '连不上联机服务器，请检查网络',
        'socket-closed': '和联机服务器的连接断了',
        'browser-incompatible': '这个浏览器不支持联机（WebRTC）',
        'webrtc': '两台设备之间没能直接连上'
    };
    const peerError = e => fail(PEER_ERRORS[e?.type] || e?.message || String(e), e?.type === 'unavailable-id' ? 'taken' : e?.type);

    function peerLink(on, PREFIX) {
        let peer = null, conn = null, closed = false;
        function attach(c) {
            conn = c;
            let up = false;
            const opened = () => { if (!up && conn === c && !closed) { up = true; on.open?.(); } };
            // A guest's connection is already open when it is attached. The
            // other side's first message can come before this side's 'open'
            // event: data means the channel is up, so it opens first.
            if (c.open) opened(); else c.on('open', opened);
            c.on('data', data => { opened(); if (conn === c && !closed) on.message?.(data); });
            c.on('close', () => { if (conn === c && !closed) { conn = null; on.close?.(); } });
            c.on('error', () => { /* a close follows */ });
        }
        function make(id) {
            if (typeof Peer !== 'function') throw fail('联机组件没有加载');
            const p = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
            // The signalling server dropped us: the data channel is not
            // affected, but a host still waiting needs the server back.
            p.on('disconnected', () => { if (!closed && !p.destroyed) { on.status?.('联机服务器断开，正在重连…'); try { p.reconnect(); } catch (_) { /* gone */ } } });
            return p;
        }
        function opened(p) {
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(fail('连接联机服务器超时，请检查网络')), timeoutSeconds() * 1000);
                p.on('open', id => { clearTimeout(timer); resolve(id); });
                p.on('error', e => { clearTimeout(timer); reject(peerError(e)); });
            });
        }
        return {
            kind: 'peer',
            async host(code) {
                peer = make(PREFIX + code);
                peer.on('connection', c => {
                    // One guest per room.
                    if (conn || closed) { c.on('open', () => c.close()); return; }
                    attach(c);
                });
                await opened(peer);
            },
            async join(code) {
                peer = make();
                await opened(peer);
                await new Promise((resolve, reject) => {
                    const c = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
                    const timer = setTimeout(() => reject(fail('连接超时：请确认房间号，以及对方还在等待')), timeoutSeconds() * 1000);
                    const done = error => { clearTimeout(timer); if (error) reject(error); else { attach(c); resolve(); } };
                    c.on('open', () => done());
                    c.on('error', e => done(peerError(e)));
                    peer.on('error', e => done(peerError(e)));
                });
            },
            send(msg) {
                if (!conn?.open) return false;
                try { conn.send(msg); return true; } catch (_) { return false; }
            },
            // Let the guest there is go; the room stays open.
            drop() {
                const c = conn;
                conn = null;
                try { c?.close(); } catch (_) { /* already gone */ }
            },
            close() {
                closed = true;
                try { conn?.close(); } catch (_) { /* already gone */ }
                try { peer?.destroy(); } catch (_) { /* already gone */ }
                conn = peer = null;
            }
        };
    }

    // ---- two tabs of one browser ----
    function localLink(on, PREFIX) {
        const me = Math.random().toString(36).slice(2);
        let channel = null, other = null, closed = false;
        const post = data => channel?.postMessage({ from: me, ...data });
        function listen(code, handle) {
            channel = new BroadcastChannel(`${PREFIX}${code}`);
            channel.onmessage = ({ data }) => { if (!closed && data && data.from !== me) handle(data); };
        }
        const bye = () => post({ kind: 'bye' });
        window.addEventListener('pagehide', bye);
        return {
            kind: 'local',
            async host(code) {
                // Someone already hosting this code answers a probe.
                let taken = false;
                listen(code, d => {
                    if (d.kind === 'taken' && d.to === me) taken = true;
                    else if (d.kind === 'probe' && !taken) post({ kind: 'taken', to: d.from });
                    else if (d.kind === 'join' && !other) { other = d.from; post({ kind: 'welcome', to: other }); on.open?.(); }
                    else if (d.kind === 'join') post({ kind: 'full', to: d.from });
                    else if (d.from === other) data(d);
                });
                post({ kind: 'probe' });
                await new Promise(resolve => setTimeout(resolve, 250));
                if (taken) { channel.close(); channel = null; throw fail('这个房间号正被占用', 'taken'); }
            },
            async join(code) {
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(fail('房间号不存在，或对方已经离开')), Math.min(3, timeoutSeconds()) * 1000);
                    listen(code, d => {
                        if (d.kind === 'welcome' && d.to === me && !other) { other = d.from; clearTimeout(timer); resolve(); on.open?.(); }
                        else if (d.kind === 'full' && d.to === me) { clearTimeout(timer); reject(fail('房间里已经有人了')); }
                        else if (d.from === other) data(d);
                    });
                    post({ kind: 'join' });
                });
            },
            send(msg) { if (!other || closed) return false; post({ kind: 'msg', to: other, msg }); return true; },
            drop() { if (!other || closed) return; bye(); other = null; },
            close() {
                if (closed) return;
                bye(); closed = true;
                window.removeEventListener('pagehide', bye);
                channel?.close(); channel = null;
            }
        };
        function data(d) {
            if (d.kind === 'msg' && d.to === me) on.message?.(d.msg);
            else if (d.kind === 'bye') { other = null; on.close?.(); }
        }
    }

    // A link of the kind the address asks for; `room`: 'duel' or 'coop'.
    function create(on = {}, { room = 'duel' } = {}) { return kind() === 'local' ? localLink(on, PREFIXES[room]) : peerLink(on, PREFIXES[room]); }
    return { create, randomCode, kind };
})();
