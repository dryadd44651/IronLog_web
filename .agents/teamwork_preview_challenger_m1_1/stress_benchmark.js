// Empirical Stress Testing Suite for IronLog Web
// Author: Challenger Subagent (m1_1)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

// Performance helper
const now = () => {
    if (typeof performance !== 'undefined' && performance.now) {
        return performance.now();
    }
    const hr = process.hrtime();
    return hr[0] * 1000 + hr[1] / 1e6;
};

// Mock localStorage with quota support
class MockLocalStorage {
    constructor(quotaBytes = 5 * 1024 * 1024) {
        this.store = new Map();
        this.quotaBytes = quotaBytes;
        this.currentBytes = 0;
    }

    getItem(key) {
        return this.store.get(key) || null;
    }

    setItem(key, value) {
        const valStr = String(value);
        const oldVal = this.store.get(key) || '';
        const addedBytes = valStr.length * 2 - oldVal.length * 2; // UTF-16 approx
        if (this.currentBytes + addedBytes > this.quotaBytes) {
            const err = new Error('QuotaExceededError: DOM Exception 22');
            err.name = 'QuotaExceededError';
            err.code = 22;
            throw err;
        }
        this.store.set(key, valStr);
        this.currentBytes += addedBytes;
    }

    removeItem(key) {
        const oldVal = this.store.get(key) || '';
        this.store.delete(key);
        this.currentBytes -= oldVal.length * 2;
    }

    clear() {
        this.store.clear();
        this.currentBytes = 0;
    }
}

// Global Mocks for DOM environment
const mockLS = new MockLocalStorage(10 * 1024 * 1024); // 10MB default
global.localStorage = mockLS;

if (!global.crypto) global.crypto = {};
if (!global.crypto.randomUUID) global.crypto.randomUUID = () => crypto.randomUUID();

global.lucide = { createIcons: () => {} };

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

    get options() {
        return this.children.filter(c => c.tagName === 'OPTION');
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(html) {
        this._innerHTML = html;
        this.children = [];
        if (this.tagName === 'SELECT' && html) {
            const optMatches = html.matchAll(/<option[^>]*value=["']([^"']*)["'][^>]*>([^<]*)<\/option>/g);
            for (const match of optMatches) {
                const opt = new MockElement('option');
                opt.value = match[1];
                opt.textContent = match[2];
                this.children.push(opt);
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
        if (selector === 'option') return this.options;
        if (selector.includes('input[type="checkbox"]')) {
            const cbMatches = (this._innerHTML || '').matchAll(/<input[^>]*type=["']checkbox["'][^>]*>/g);
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

global.alert = () => {};
global.confirm = () => true;
global.console = console;

// Load App source code
const projectRoot = path.join(__dirname, '../..');
const appJsContent = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');
const indexHtmlContent = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

const scriptMatches = indexHtmlContent.split('<script>');
const inlineScript = scriptMatches[scriptMatches.length - 1].split('</script>')[0];

const context = vm.createContext(global);
vm.runInContext(appJsContent, context);
vm.runInContext(inlineScript, context);

// Initialize DOM
vm.runInContext(`
    const listeners = window.eventListeners['DOMContentLoaded'] || [];
    listeners.forEach(fn => fn());
`, context);

console.log("Environment initialized successfully.");

// Benchmark Suite Object to collect results
const results = {
    payloadBenchmarks: [],
    functionBenchmarks: [],
    storageLimits: [],
    rapidActions: [],
    failures: []
};

// --- TEST 1: HEAVY DATA PAYLOAD BENCHMARKS (1k, 5k, 10k entries) ---
function runPayloadBenchmarks() {
    console.log("\n=== 1. Heavy Data Payload Benchmarks ===");
    const counts = [1000, 5000, 10000];

    for (const count of counts) {
        // Reset store
        mockLS.clear();
        vm.runInContext(`storeObj = new AppStore();`, context);

        const planId = vm.runInContext(`storeObj.currentPlanId`, context);
        const exId = vm.runInContext(`storeObj.globalExercises[0].id`, context);
        const cycleId = vm.runInContext(`storeObj.activeCycle.id`, context);

        // Generate synthetic logs
        const startGen = now();
        const logs = [];
        for (let i = 0; i < count; i++) {
            logs.push({
                id: crypto.randomUUID(),
                exerciseId: exId,
                weekIndex: i % 4,
                cycleId: cycleId,
                sets: [
                    { id: crypto.randomUUID(), isCompleted: true },
                    { id: crypto.randomUUID(), isCompleted: true },
                    { id: crypto.randomUUID(), isCompleted: false }
                ],
                isCompleted: i % 2 === 0
            });
        }
        const genTime = now() - startGen;

        // Set logs in current plan
        vm.runInContext(`storeObj.planDataById['${planId}'].exerciseLogs = ${JSON.stringify(logs)};`, context);

        // Serialization benchmark (exportToJSON & saveData)
        const startSer = now();
        const jsonStr = vm.runInContext(`storeObj.exportToJSON();`, context);
        const serTime = now() - startSer;
        const payloadSizeBytes = Buffer.byteLength(jsonStr, 'utf8');
        const payloadSizeMB = (payloadSizeBytes / (1024 * 1024)).toFixed(2);

        // Deserialization benchmark (importFromJSON)
        const startDeser = now();
        const deserSuccess = vm.runInContext(`storeObj.importFromJSON(${JSON.stringify(jsonStr)});`, context);
        const deserTime = now() - startDeser;

        // Storage load benchmark (loadData)
        vm.runInContext(`storeObj.saveData();`, context);
        const startLoad = now();
        vm.runInContext(`storeObj.loadData();`, context);
        const loadTime = now() - startLoad;

        const res = {
            count,
            payloadSizeMB: `${payloadSizeMB} MB (${payloadSizeBytes} bytes)`,
            genTimeMs: genTime.toFixed(2),
            serTimeMs: serTime.toFixed(2),
            deserTimeMs: deserTime.toFixed(2),
            loadTimeMs: loadTime.toFixed(2),
            deserSuccess
        };
        results.payloadBenchmarks.push(res);
        console.log(`[${count} Logs] Payload: ${res.payloadSizeMB} | Stringify: ${res.serTimeMs}ms | Parse/Import: ${res.deserTimeMs}ms | LoadData: ${res.loadTimeMs}ms`);
    }
}

// --- TEST 2: FUNCTION & RENDERING EXECUTION TIMES ---
function runFunctionBenchmarks() {
    console.log("\n=== 2. Execution Time for Core Functions ===");

    // 2.1 Plate Calculator (calculatedTarget) Benchmark
    const startPlate = now();
    const iterCount = 10000;
    vm.runInContext(`
        const ex = storeObj.globalExercises[0];
        for (let i = 0; i < ${iterCount}; i++) {
            storeObj.calculatedTarget(ex, i % 4);
        }
    `, context);
    const plateTime = now() - startPlate;
    const avgPlateUs = ((plateTime / iterCount) * 1000).toFixed(2);
    results.functionBenchmarks.push({ name: 'Plate Calculator (calculatedTarget)', iterations: iterCount, totalTimeMs: plateTime.toFixed(2), avgPerOpUs: avgPlateUs });
    console.log(`[Plate Calc] ${iterCount} iterations in ${plateTime.toFixed(2)}ms (avg: ${avgPlateUs} µs/op)`);

    // 2.2 Search Filter Function Benchmark
    // Populate store with 5,000 exercises
    vm.runInContext(`
        const initialGroup = storeObj.globalMuscleGroups[0].id;
        const newExercises = [];
        for (let i = 0; i < 5000; i++) {
            newExercises.push({
                id: crypto.randomUUID(),
                name: 'Bench Press Variant ' + i,
                muscleGroupId: initialGroup,
                personalRecord: 100 + (i % 200)
            });
        }
        storeObj.globalExercises = newExercises;
    `, context);

    const searchQueries = ['bench', 'press', 'variant 499', 'nonexistent_xyz'];
    for (const q of searchQueries) {
        const startSearch = now();
        vm.runInContext(`
            document.getElementById('exercise-search').value = '${q}';
            handleExerciseSearch();
        `, context);
        const searchTime = now() - startSearch;
        results.functionBenchmarks.push({ name: `Exercise Search ('${q}')`, totalTimeMs: searchTime.toFixed(2) });
        console.log(`[Exercise Search '${q}'] Filtered 5,000 exercises in ${searchTime.toFixed(2)}ms`);
    }

    // 2.3 DOM Rendering Benchmarks (renderAll, renderRoutinePlanner, renderDashboard, renderTrain, renderExercises)
    const renderTargets = [
        { name: 'renderAll()', code: 'renderAll()' },
        { name: 'renderDashboard()', code: 'renderDashboard()' },
        { name: 'renderTrain()', code: 'renderTrain()' },
        { name: 'renderRoutinePlanner()', code: 'renderRoutinePlanner()' },
        { name: 'renderExercises()', code: 'renderExercises()' }
    ];

    for (const target of renderTargets) {
        const startRender = now();
        for (let r = 0; r < 50; r++) {
            vm.runInContext(target.code, context);
        }
        const totalRender = now() - startRender;
        const avgRender = (totalRender / 50).toFixed(2);
        results.functionBenchmarks.push({ name: target.name, iterations: 50, totalTimeMs: totalRender.toFixed(2), avgPerOpMs: avgRender });
        console.log(`[DOM Render] ${target.name} x50: ${totalRender.toFixed(2)}ms (avg: ${avgRender}ms/render)`);
    }
}

// --- TEST 3: STORAGE LIMITS & QUOTA EXCEPTION HANDLING ---
function runStorageLimitsBenchmarks() {
    console.log("\n=== 3. Storage Serialization Limits & Quota Exception Handling ===");

    // 3.1 Test Quota Exception Handling during saveData()
    // Set mock quota to 500 KB
    const smallLS = new MockLocalStorage(500 * 1024);
    global.localStorage = smallLS;
    vm.runInContext(`global.localStorage = mockLS;`, context); // update context global if needed

    // Fill storage up to limit
    let quotaHandled = false;
    let thrownError = null;

    try {
        // Create large logs to exceed 500 KB quota
        const largeLogs = [];
        for (let i = 0; i < 5000; i++) {
            largeLogs.push({
                id: crypto.randomUUID(),
                exerciseId: crypto.randomUUID(),
                weekIndex: 0,
                cycleId: crypto.randomUUID(),
                sets: [{ id: crypto.randomUUID(), isCompleted: true }],
                isCompleted: true
            });
        }
        vm.runInContext(`
            const pId = storeObj.currentPlanId;
            storeObj.planDataById[pId].exerciseLogs = ${JSON.stringify(largeLogs)};
            storeObj.saveData();
        `, context);
    } catch (err) {
        quotaHandled = true;
        thrownError = err;
    }

    results.storageLimits.push({
        testName: 'QuotaExceededError Handling in saveData()',
        quotaBytes: 500 * 1024,
        exceptionThrown: quotaHandled,
        errorName: thrownError ? thrownError.name : 'None',
        errorMessage: thrownError ? thrownError.message : 'No exception caught (Unhandled or silently ignored)',
        status: quotaHandled ? 'VULNERABILITY: Unhandled QuotaExceededError crashes execution' : 'Handled'
    });
    console.log(`[Quota Test] QuotaExceededError thrown unhandled: ${quotaHandled} (${thrownError ? thrownError.message : 'No Error'})`);

    // Reset mock localStorage to 10MB
    global.localStorage = mockLS;
    mockLS.clear();

    // 3.2 Test Malformed / Corrupted JSON Import
    const malformedInputs = [
        { name: 'Invalid JSON Syntax', input: '{ "plans": [ invalid json }' },
        { name: 'Null Input', input: 'null' },
        { name: 'Non-object JSON (Array)', input: '[1, 2, 3]' },
        { name: 'Missing Required Fields', input: JSON.stringify({ plans: [], globalMuscleGroups: [] }) },
        { name: 'Corrupted Types in planDataById', input: JSON.stringify({ plans: [{id:'p1', name:'P1'}], currentPlanId:'p1', globalMuscleGroups:[], globalExercises:[], planDataById: "not_an_object" }) }
    ];

    for (const item of malformedInputs) {
        const startImport = now();
        let success = false;
        let threw = false;
        let errMessage = '';
        try {
            success = vm.runInContext(`storeObj.importFromJSON(${JSON.stringify(item.input)});`, context);
        } catch (e) {
            threw = true;
            errMessage = e.message;
        }
        const importTime = now() - startImport;
        results.storageLimits.push({
            testName: `Malformed JSON: ${item.name}`,
            importSuccess: success,
            threwException: threw,
            errorMessage: errMessage,
            timeMs: importTime.toFixed(2)
        });
        console.log(`[Malformed JSON '${item.name}'] Success: ${success} | Threw: ${threw} | Time: ${importTime.toFixed(2)}ms`);
    }
}

// --- TEST 4: RAPID UI ACTION SIMULATION & RENDER LOOPS ---
function runRapidActionSimulations() {
    console.log("\n=== 4. Rapid UI Action Simulation & DOM Re-renders ===");

    // Reset store to fresh state
    mockLS.clear();
    vm.runInContext(`storeObj = new AppStore(); renderAll();`, context);

    // Track number of renderAll calls
    let renderCount = 0;
    vm.runInContext(`
        const origRenderAll = renderAll;
        renderAll = function() {
            renderCount++;
            return origRenderAll.apply(this, arguments);
        };
    `, context);

    // 4.1 Rapid Set Completion Toggles (1,000 rapid clicks)
    const exId = vm.runInContext(`storeObj.globalExercises[0].id`, context);
    const cycle = vm.runInContext(`storeObj.activeCycle`, context);
    const log = vm.runInContext(`storeObj.getLog(storeObj.globalExercises[0], ${cycle.currentWeekIndex})`, context);

    const startRapidSets = now();
    const clicks = 1000;
    vm.runInContext(`
        renderCount = 0;
        for (let i = 0; i < ${clicks}; i++) {
            toggleSetCompletion('${exId}', '${log.id}', 0);
        }
    `, context);
    const timeRapidSets = now() - startRapidSets;
    const actualRendersSets = vm.runInContext(`renderCount`, context);

    results.rapidActions.push({
        action: '1,000 Rapid Set Completion Toggles',
        totalTimeMs: timeRapidSets.toFixed(2),
        avgMsPerOp: (timeRapidSets / clicks).toFixed(2),
        totalDOMRendersTriggered: actualRendersSets,
        rendersPerOp: actualRendersSets / clicks
    });
    console.log(`[Rapid Sets] 1,000 toggles in ${timeRapidSets.toFixed(2)}ms | DOM Renders: ${actualRendersSets}`);

    // 4.2 Rapid Intensity Changes (1,000 rapid cycles)
    const groupId = vm.runInContext(`storeObj.globalMuscleGroups[0].id`, context);
    const startRapidIntensity = now();
    vm.runInContext(`
        renderCount = 0;
        for (let i = 0; i < ${clicks}; i++) {
            cycleWeeklyIntensity('${groupId}', 0, 'medium');
        }
    `, context);
    const timeRapidIntensity = now() - startRapidIntensity;
    const actualRendersIntensity = vm.runInContext(`renderCount`, context);

    results.rapidActions.push({
        action: '1,000 Rapid Intensity Cycle Changes',
        totalTimeMs: timeRapidIntensity.toFixed(2),
        avgMsPerOp: (timeRapidIntensity / clicks).toFixed(2),
        totalDOMRendersTriggered: actualRendersIntensity,
        rendersPerOp: actualRendersIntensity / clicks
    });
    console.log(`[Rapid Intensity] 1,000 intensity changes in ${timeRapidIntensity.toFixed(2)}ms | DOM Renders: ${actualRendersIntensity}`);

    // 4.3 Rapid Plan Copying (50 rapid plan copies)
    const pId = vm.runInContext(`storeObj.currentPlanId`, context);
    const startRapidCopy = now();
    const copyCount = 50;
    vm.runInContext(`
        renderCount = 0;
        for (let i = 0; i < ${copyCount}; i++) {
            storeObj.copyPlan('${pId}');
        }
    `, context);
    const timeRapidCopy = now() - startRapidCopy;
    const actualRendersCopy = vm.runInContext(`renderCount`, context);

    results.rapidActions.push({
        action: '50 Rapid Plan Copies',
        totalTimeMs: timeRapidCopy.toFixed(2),
        avgMsPerOp: (timeRapidCopy / copyCount).toFixed(2),
        totalDOMRendersTriggered: actualRendersCopy
    });
    console.log(`[Rapid Copy Plan] 50 copies in ${timeRapidCopy.toFixed(2)}ms | DOM Renders: ${actualRendersCopy}`);
}

// Run all test sections
runPayloadBenchmarks();
runFunctionBenchmarks();
runStorageLimitsBenchmarks();
runRapidActionSimulations();

console.log("\n=== BENCHMARK SUITE COMPLETE ===");

// Output formatted JSON for report generation
const outputPath = path.join(__dirname, 'benchmark_raw_results.json');
fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
console.log(`Raw results saved to ${outputPath}`);
