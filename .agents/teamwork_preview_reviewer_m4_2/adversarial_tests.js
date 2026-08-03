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

// Mock crypto
global.crypto = {
    randomUUID: () => 'uuid-' + Math.random().toString(36).substring(2, 10)
};

// Mock window and document
global.window = {};
global.document = {
    getElementById: (id) => {
        if (!global.document._elements[id]) {
            global.document._elements[id] = { value: '', textContent: '', innerHTML: '' };
        }
        return global.document._elements[id];
    },
    _elements: {}
};

// Load app.js
const appJsPath = path.join(__dirname, '../../app.js');
const appJsContent = fs.readFileSync(appJsPath, 'utf8');
const runInGlobalScope = new Function(appJsContent + '\n global.AppStore = AppStore;');
runInGlobalScope();

console.log("=== ADVERSARIAL STRESS TESTS FOR STORAGE & CONCURRENCY ===");

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        localStorage.clear();
        fn();
        console.log(`✓ PASS: ${name}`);
        passed++;
    } catch (err) {
        console.error(`✗ FAIL: ${name}`);
        console.error(err);
        failed++;
    }
}

// Test 1: Corrupted Day Object during JSON Import (missing exerciseIds)
test("1. Import JSON with day missing exerciseIds array", () => {
    const store = new AppStore();
    const exportJson = JSON.parse(store.exportToJSON());
    const planId = exportJson.currentPlanId;
    exportJson.planDataById[planId].days = [
        { id: 'day-1', name: 'Broken Day' } // missing exerciseIds
    ];

    const result = store.importFromJSON(JSON.stringify(exportJson));
    assert.strictEqual(result, true, "Import should succeed");
    
    // Check if markDayExercisesCompleted or markDayExercisesIncomplete crashes
    assert.doesNotThrow(() => {
        store.markDayExercisesCompleted('day-1');
    }, "markDayExercisesCompleted should not throw even if exerciseIds is missing");
});

// Test 2: Import JSON with empty plans array or invalid currentPlanId
test("2. Import JSON with empty plans array or orphan currentPlanId", () => {
    const store = new AppStore();
    const exportJson = JSON.parse(store.exportToJSON());
    exportJson.plans = []; // empty plans
    exportJson.currentPlanId = 'non-existent-id';

    const result = store.importFromJSON(JSON.stringify(exportJson));
    // Verify whether import succeeds or fails, and if store recovers
    console.log("  Import with empty plans returned:", result);
    console.log("  store.plans.length after import:", store.plans.length);
    console.log("  store.currentPlanId after import:", store.currentPlanId);
});

// Test 3: Date Object Roundtrip & Apple Epoch Timestamp Import
test("3. Date Object Roundtrip & Apple Epoch Timestamp Import", () => {
    const store = new AppStore();
    const exportJson = JSON.parse(store.exportToJSON());
    const planId = exportJson.currentPlanId;
    
    // Inject Apple epoch timestamp (e.g. 700000000.0 seconds since Jan 1 2001)
    exportJson.planDataById[planId].activeCycle.startDate = 700000000;

    const result = store.importFromJSON(JSON.stringify(exportJson));
    assert.strictEqual(result, true, "Import should succeed");
    const activeCycle = store.activeCycle;
    assert(activeCycle.startDate instanceof Date, "startDate should be converted to Date instance");
    assert(!isNaN(activeCycle.startDate.getTime()), "startDate should be valid date");
});

// Test 4: Cross-plan Cascade Deletion Audit
test("4. Cross-plan Cascade Deletion Audit", () => {
    const store = new AppStore();
    store.createPlan("Plan 2");
    store.createPlan("Plan 3");

    const groupToDelete = store.muscleGroups[0];
    const groupExercises = store.exercises.filter(e => e.muscleGroupId === groupToDelete.id);
    const exerciseToDelete = store.exercises[1]; // from different group

    // Add log entries in multiple plans
    store.selectPlan(store.plans[0].id);
    store.getLog(exerciseToDelete, 0);
    store.selectPlan(store.plans[1].id);
    store.getLog(exerciseToDelete, 0);

    // Delete single exercise
    store.deleteExercise(exerciseToDelete.id);

    for (const pId of Object.keys(store.planDataById)) {
        const pData = store.planDataById[pId];
        assert(!pData.enabledExerciseIds.includes(exerciseToDelete.id), `Exercise should be removed from enabledExerciseIds in plan ${pId}`);
        assert(!pData.exerciseLogs.some(l => l.exerciseId === exerciseToDelete.id), `Logs should be removed from plan ${pId}`);
    }

    // Delete muscle group
    store.removeMuscleGroup(groupToDelete.id);

    for (const pId of Object.keys(store.planDataById)) {
        const pData = store.planDataById[pId];
        groupExercises.forEach(ex => {
            assert(!pData.enabledExerciseIds.includes(ex.id), `Exercise ${ex.id} should be purged from plan ${pId}`);
        });
        if (pData.activeCycle && Array.isArray(pData.activeCycle.intensities)) {
            assert(!pData.activeCycle.intensities.some(i => i.muscleGroupId === groupToDelete.id), `Muscle group intensity should be purged from activeCycle in plan ${pId}`);
        }
    }
});

// Test 5: Copy Plan Cloning Audit
test("5. Copy Plan Deep Clone Audit", () => {
    const store = new AppStore();
    const sourcePlanId = store.currentPlanId;
    
    // Set custom set in log
    const ex = store.exercises[0];
    const log = store.getLog(ex, 0);
    log.sets.push({ id: 'set-custom', isCompleted: true });
    log.isCompleted = true;
    store.updateLog(log);

    // Copy plan
    store.copyPlan(sourcePlanId);
    const newPlanId = store.currentPlanId;

    assert.notStrictEqual(newPlanId, sourcePlanId, "New plan ID should be different");
    const copiedData = store.planDataById[newPlanId];
    assert.strictEqual(copiedData.exerciseLogs.length, store.planDataById[sourcePlanId].exerciseLogs.length, "Logs length should match");
    assert.notStrictEqual(copiedData.exerciseLogs[0].id, log.id, "Log ID should be newly generated");
    assert.strictEqual(copiedData.exerciseLogs[0].isCompleted, false, "Copied log completion status should reset to false");
    assert.strictEqual(copiedData.exerciseLogs[0].sets[0].isCompleted, false, "Copied sets completion status should reset to false");
});

console.log(`\nRESULTS: ${passed} PASSED, ${failed} FAILED.`);
