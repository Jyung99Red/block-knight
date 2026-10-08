// Loads the game's classic scripts into one vm context, in manifest order,
// and hands back their globals. Browser-only scripts (render/, ui/, net/,
// vendor/) are left out unless asked for. `entry`: another page's scripts
// instead (client-assets.json).
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = () => JSON.parse(read('client-assets.json'));

function load({ entry = 'game', include = file => !/^(render|ui|net|vendor)\//.test(file), globals = {} } = {}) {
    const context = vm.createContext({ console, Math, ...globals });
    const files = manifest()[entry].scripts.filter(include);
    for (const file of files) vm.runInContext(read(file), context, { filename: file });
    const names = vm.runInContext('Object.keys(globalThis)', context);
    // Top-level `const` bindings are not context properties; read them by name.
    const pick = name => vm.runInContext(`typeof ${name} === 'undefined' ? undefined : ${name}`, context);
    return new Proxy({ context, files, names }, { get: (target, key) => key in target ? target[key] : pick(key) });
}
module.exports = { load, read, root, manifest };
