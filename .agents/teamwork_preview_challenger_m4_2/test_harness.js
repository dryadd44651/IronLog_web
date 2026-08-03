// Test Harness for IronLog Web UI State & Split Sync
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Mock localStorage
const localStorageStore = new Map();
global.localStorage = {
    getItem: (key) => localStorageStore.get(key) || null,
    setItem: (key, val) => localStorageStore.set(key, String(val)),
    removeItem: (key) => localStorageStore.delete(key),
    clear: () => localStorageStore.clear()
};

// Mock crypto.randomUUID
if (!global.crypto) global.crypto = {};
if (!global.crypto.randomUUID) global.crypto.randomUUID = () => crypto.randomUUID();

// Mock lucide
global.lucide = { createIcons: () => {} };

// Mock Element class
class MockElement {
    constructor(tagName = 'div', id = '') {
        this.tagName = tagName.toUpperCase();
        this.id = id;
        this.value = '';
        this.textContent = '';
        this._innerHTML = '';
        this.style = {};
        this.classList = {
            _classes: new Set(),
            add: (...cls) => cls.forEach(c => this.classList._classes.add(c)),
            remove: (...cls) => cls.forEach(c => this.classList._classes.delete(c)),
            contains: (c) => this.classList._classes.has(c),
            toggle: (c) => this.classList._classes.has(c) ? this.classList._classes.delete(c) : this.classList._classes.add(c)
        };
        this.children = [];
        this.eventListeners = {};
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(html) {
        this._innerHTML = html;
        if (this.tagName === 'SELECT') {
            this.options = [];
            const optMatches = html.matchAll(/<option[^>]*value=["']([^"']*)["'][^>]*>([^<]*)<\/option>/g);
            for (const match of optMatches) {
                this.options.push({ value: match[1], textContent: match[2] });
            }
        }
    }

    addEventListener(event, fn) {
        if (!this.eventListeners[event]) this.eventListeners[event] = [];
        this.eventListeners[event].push(fn);
    }

    dispatchEvent(event) {
        const listeners = this.eventListeners[event.type || event] || [];
        listeners.forEach(fn => fn(event));
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    querySelectorAll(selector) {
        const results = [];
        if (selector === 'option' && this.options) {
            return this.options;
        }
        if (selector.includes('input[type="checkbox"]')) {
            const cbMatches = this._innerHTML.matchAll(/<input[^>]*type=["']checkbox["'][^>]*>/g);
            for (const match of cbMatches) {
                const isChecked = match[0].includes('checked');
                const valMatch = match[0].match(/value=["']([^"']*)["']/);
                const val = valMatch ? valMatch[1] : '';
                if (selector.includes(':checked') && !isChecked) continue;
                results.push({ value: val, checked: isChecked });
            }
        }
        return results;
    }

    querySelector(selector) {
        const list = this.querySelectorAll(selector);
        return list.length > 0 ? list[0] : null;
    }
}

const elementsById = new Map();

function getOrCreateElement(id) {
    if (!elementsById.has(id)) {
        elementsById.set(id, new MockElement('div', id));
    }
    return elementsById.get(id);
}

global.document = {
    getElementById: (id) => getOrCreateElement(id),
    querySelectorAll: (selector) => {
        if (selector === '.nav-tab') {
            return [new MockElement('button'), new MockElement('button'), new MockElement('button'), new MockElement('button'), new MockElement('button')];
        }
        if (selector === '.modal-container') {
            return [new MockElement('div'), new MockElement('div')];
        }
        return [];
    },
    createElement: (tag) => new MockElement(tag),
    body: new MockElement('body')
};

global.window = {
    eventListeners: {},
    addEventListener: (event, fn) => {
        if (!global.window.eventListeners[event]) global.window.eventListeners[event] = [];
        global.window.eventListeners[event].push(fn);
    },
    lucide: global.lucide
};

global.alert = (msg) => {};
global.confirm = (msg) => true;

// Load app.js and index.html inline script into vm / global context
const vm = require('vm');
const projectRoot = path.join(__dirname, '../..');
const appJsContent = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');
const indexHtmlContent = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

const scriptMatches = indexHtmlContent.split('<script>');
const inlineScript = scriptMatches[scriptMatches.length - 1].split('</script>')[0];

const context = vm.createContext(global);
vm.runInContext(appJsContent, context);
vm.runInContext(inlineScript, context);

// Trigger DOMContentLoaded
const domContentLoadedListeners = global.window.eventListeners['DOMContentLoaded'] || [];
domContentLoadedListeners.forEach(fn => fn());

console.log('App initialized.');
console.log('Store Plans:', storeObj.plans.length);
console.log('Current Plan ID:', storeObj.currentPlanId);
console.log('Current Plan Name:', storeObj.plans.find(p => p.id === storeObj.currentPlanId).name);
console.log('DOM Plan Select Options:', document.getElementById('header-plan-select').options);
