const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Mock localStorage
const localStorageMap = new Map();
global.localStorage = {
    getItem: (k) => localStorageMap.get(k) || null,
    setItem: (k, v) => localStorageMap.set(k, String(v)),
    removeItem: (k) => localStorageMap.delete(k),
    clear: () => localStorageMap.clear()
};

global.crypto = {
    randomUUID: () => 'uuid-' + Math.random().toString(36).substring(2, 10)
};

// Mock DOM elements container
const elements = {};

function createMockElement(id, tag = 'div') {
    if (!elements[id]) {
        elements[id] = {
            id,
            tagName: tag.toUpperCase(),
            value: '',
            textContent: '',
            innerHTML: '',
            style: {},
            classList: {
                add: () => {},
                remove: () => {},
                contains: () => false
            },
            appendChild: (child) => child,
            querySelectorAll: () => [createMockElement('child1'), createMockElement('child2')],
            querySelector: () => createMockElement('child1'),
            addEventListener: () => {}
        };
    }
    return elements[id];
}

global.document = {
    getElementById: (id) => createMockElement(id),
    querySelectorAll: (sel) => [createMockElement('el1'), createMockElement('el2')],
    querySelector: (sel) => createMockElement('el1'),
    createElement: (tag) => createMockElement('created_' + Math.random(), tag),
    body: createMockElement('body'),
    addEventListener: () => {}
};

global.window = {
    addEventListener: (event, fn) => {
        if (event === 'DOMContentLoaded') {
            global.window.onDOMContentLoaded = fn;
        }
    }
};

global.lucide = {
    createIcons: () => {}
};

// Load app.js
const appJsPath = path.join(__dirname, '../../app.js');
const appJsContent = fs.readFileSync(appJsPath, 'utf8');

// Load index.html script content
const htmlPath = path.join(__dirname, '../../index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Extract script block inside index.html
const scriptMatch = htmlContent.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
assert(scriptMatch && scriptMatch[1], "Script block should be present in index.html");

const indexScript = scriptMatch[1];

console.log("=== RUNNING FULL INDEX.HTML DOM INTEGRATION TEST ===");

try {
    const combinedScript = `${appJsContent}\n${indexScript}\n global.switchTab = switchTab;\n global.renderAll = renderAll;\n global.renderDashboard = renderDashboard;\n global.renderTrain = renderTrain;\n global.renderRoutinePlanner = renderRoutinePlanner;\n global.renderExercises = renderExercises;\n global.renderSettings = renderSettings;`;
    const runInContext = new Function(combinedScript);
    runInContext();
    
    // Simulate DOMContentLoaded
    if (global.window.onDOMContentLoaded) {
        global.window.onDOMContentLoaded();
    }
    console.log("✓ DOMContentLoaded initialized store and rendered views without errors");

    // Test switchTab across all 5 tabs
    [0, 1, 2, 3, 4].forEach(tabIdx => {
        global.switchTab(tabIdx);
    });
    console.log("✓ Tab switching across all 5 tabs (Dashboard, Train, Day, Exercises, Settings) passed");

    // Test renderAll execution
    global.renderAll();
    console.log("✓ renderAll executed without console errors");

    console.log("=== INTEGRATION TEST PASSED SUCCESSFULLY ===");
} catch (err) {
    console.error("❌ INTEGRATION TEST FAILED:", err);
    process.exit(1);
}
