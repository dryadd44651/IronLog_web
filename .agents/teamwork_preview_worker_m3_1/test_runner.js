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

// Load app.js and expose global classes
const appJsPath = path.join(__dirname, '../../app.js');
const appJsContent = fs.readFileSync(appJsPath, 'utf8');
const runInGlobalScope = new Function(appJsContent + '\n global.AppStore = AppStore;');
runInGlobalScope();

console.log("=== RUNNING VERIFICATION TESTS FOR IRONLOG WEB M3 FIXES ===");

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

// 1. Single Quote Escaping in index.html
test("1. Inline Event Listener Single-Quote Escaping in index.html", () => {
    const htmlPath = path.join(__dirname, '../../index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    assert(!htmlContent.includes("openAddExerciseModal('${group.id}',"), "openAddExerciseModal should not pass group.name inline");
    assert(!htmlContent.includes("openEditExerciseModal('${exercise.id}',"), "openEditExerciseModal should not pass exercise.name inline");
    assert(!htmlContent.includes("openRenamePlanModal('${plan.id}',"), "openRenamePlanModal should not pass plan.name inline");
    assert(!htmlContent.includes("openDeletePlanModal('${plan.id}',"), "openDeletePlanModal should not pass plan.name inline");
    assert(!htmlContent.includes("openRenameGroupModal('${group.id}',"), "openRenameGroupModal should not pass group.name inline");
});

// 2. Retrain Day Week Index Desync
test("2. Retrain Day Week Index Desync", () => {
    const store = new AppStore();
    const day = store.currentPlanData.days[0];
    const dayId = day.id;

    // Complete day 1 exercises in Week 0
    day.exerciseIds.forEach(exId => {
        const ex = store.exercises.find(e => e.id === exId);
        const log = store.getLog(ex, 0);
        log.isCompleted = true;
        log.sets.forEach(s => s.isCompleted = true);
        store.updateLog(log);
    });

    // Advance currentWeekIndex to 1 (Week 2)
    store.activeCycle.currentWeekIndex = 1;

    // Retrain day (should affect Week 0, not Week 1)
    store.markDayExercisesIncomplete(dayId);

    // Verify Week 0 log is incomplete
    const ex = store.exercises.find(e => e.id === day.exerciseIds[0]);
    const logW0 = store.getLog(ex, 0);
    assert.strictEqual(logW0.isCompleted, false, "Week 0 log should be incomplete after retrain");
    assert.strictEqual(store.activeCycle.currentWeekIndex, 0, "currentWeekIndex should revert to 0");
});

// 3. NaN Personal Record (PR) Input Handling
test("3. NaN PR Input Handling", () => {
    const store = new AppStore();
    const ex = store.exercises[0];

    // Try updating PR with NaN or negative
    store.updateExercise({ id: ex.id, name: ex.name, personalRecord: NaN });
    const updated = store.exercises.find(e => e.id === ex.id);
    assert(!isNaN(updated.personalRecord), "PR should not be NaN");
    assert(updated.personalRecord > 0, "PR should be positive");

    // Try adding exercise with negative PR
    store.addExercise("Test Ex", store.muscleGroups[0].id, -50);
    const added = store.exercises.find(e => e.name === "Test Ex");
    assert(!isNaN(added.personalRecord), "Added PR should not be NaN");
    assert.strictEqual(added.personalRecord, 100.0, "Negative PR should default to 100.0");
});

// 4. Zero-Set Completion Bug
test("4. Zero-Set Completion Bug", () => {
    const store = new AppStore();
    const ex = store.exercises[0];
    const log = store.getLog(ex, 0);

    // Set sets to empty array
    log.sets = [];
    log.isCompleted = true;
    store.updateLog(log);

    const group = store.muscleGroups.find(g => g.id === ex.muscleGroupId);
    assert.strictEqual(store.isMuscleGroupCompleted(group.id, 0), false, "Muscle group with 0-set exercise should evaluate as incomplete");

    const day = store.currentPlanData.days[0];
    day.exerciseIds = [ex.id];
    assert.strictEqual(store.isDayCompleted(day, 0), false, "Day with 0-set exercise should evaluate as incomplete");
});

// 5. Guard Lucide Icon Calls
test("5. Guard Lucide Icon Calls in index.html", () => {
    const htmlPath = path.join(__dirname, '../../index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    const lines = htmlContent.split('\n');
    const createIconsLines = lines.filter(l => l.includes('lucide.createIcons()'));
    assert(createIconsLines.length > 0, "Must contain lucide.createIcons()");

    // Check that every createIcons call is preceded by the guard in nearby lines
    lines.forEach((line, idx) => {
        if (line.includes('lucide.createIcons()')) {
            const prevLines = lines.slice(Math.max(0, idx - 2), idx + 1).join('\n');
            assert(prevLines.includes("window.lucide && typeof lucide.createIcons === 'function'"), `Line ${idx + 1} must be guarded by window.lucide check`);
        }
    });
});

// 6. Day Rename Blank Input Disconnect
test("6. Day Rename Blank Input Disconnect", () => {
    const store = new AppStore();
    const day = store.currentPlanData.days[0];
    const origName = day.name;

    store.updateDayName(day.id, "   ");
    const dayAfter = store.currentPlanData.days[0];
    assert(dayAfter.name.length > 0, "Day name should not be set to empty whitespace");
    assert.strictEqual(dayAfter.name, origName, "Day name should revert to original name if cleared");
});

// 7. Standardize JSON Export / Import Format & Validation
test("7. Standardize JSON Export / Import Format & Validation", () => {
    const store = new AppStore();
    const jsonStr = store.exportToJSON();
    const parsed = JSON.parse(jsonStr);

    assert(typeof parsed.planDataById === 'object' && !Array.isArray(parsed.planDataById), "planDataById must be serialized as an object");

    // Test import validation on corrupt JSON
    assert.strictEqual(store.importFromJSON('invalid json'), false, "Invalid JSON string should return false");
    assert.strictEqual(store.importFromJSON(JSON.stringify({ plans: "corrupt" })), false, "Corrupt plans schema should return false");

    // Test successful re-import
    assert.strictEqual(store.importFromJSON(jsonStr), true, "Valid JSON import should return true");
});

// 8. Cascading Deletion Across All Plans
test("8. Cascading Deletion Across All Plans", () => {
    const store = new AppStore();
    store.createPlan("Plan B");
    const group = store.muscleGroups[0];
    const exInGroup = store.exercises.filter(e => e.muscleGroupId === group.id);
    assert(exInGroup.length > 0, "Should have exercises in muscle group");

    const exId = exInGroup[0].id;

    // Delete muscle group
    store.removeMuscleGroup(group.id);

    // Verify deleted across ALL plans in planDataById
    for (const pId of Object.keys(store.planDataById)) {
        const pData = store.planDataById[pId];
        assert(!pData.enabledExerciseIds.includes(exId), `Exercise ${exId} should be purged from plan ${pId}`);
        if (pData.days) {
            pData.days.forEach(d => {
                assert(!d.exerciseIds.includes(exId), `Exercise ${exId} should be purged from day in plan ${pId}`);
            });
        }
    }
});

// 9. Fix Destructive Auto-Migration in migrateDaysForPlan
test("9. Fix Destructive Auto-Migration in migrateDaysForPlan", () => {
    const store = new AppStore();
    const planData = store.currentPlanData;

    // Set custom days with empty exerciseIds
    planData.days = [
        { id: 'custom-1', name: 'Custom Day 1', exerciseIds: [] },
        { id: 'custom-2', name: 'Custom Day 2', exerciseIds: [] }
    ];
    planData.daysCount = 2;

    store.migrateDaysForPlan(store.currentPlanId);

    assert.strictEqual(store.currentPlanData.days.length, 2, "Custom days array should not be reset to 3 days");
    assert.strictEqual(store.currentPlanData.days[0].name, 'Custom Day 1', "Custom day name should be preserved");
});

console.log(`\nRESULTS: ${passed} PASSED, ${failed} FAILED.`);
if (failed > 0) {
    process.exit(1);
}
