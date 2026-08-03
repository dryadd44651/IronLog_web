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
    randomUUID: () => 'uuid-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now()
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
const runInGlobalScope = new Function(appJsContent + '\n global.AppStore = AppStore;\n global.sfSymbolToLucide = sfSymbolToLucide;\n global.getLucideIcon = getLucideIcon;\n global.normalizeIntensity = normalizeIntensity;');
runInGlobalScope();

console.log("=========================================================");
console.log("  M4 ADVERSARIAL STRESS TEST SUITE — IRONLOG WEB");
console.log("=========================================================");

let passed = 0;
let failed = 0;

function runTest(testName, fn) {
    try {
        localStorage.clear();
        fn();
        console.log(`✓ PASS: ${testName}`);
        passed++;
    } catch (err) {
        console.error(`❌ FAIL: ${testName}`);
        console.error(err.stack || err);
        failed++;
    }
}

// 1. Quote Escaping & Adversarial Character Safety
runTest("1. Quote Escaping & Adversarial Character Safety", () => {
    const store = new AppStore();
    const group = store.muscleGroups[0];
    
    // Add exercise with special characters: single quote, double quote, backtick, script tag
    const trickyName = "O'Hearn \"Heavy\" `Press` <script>alert(1)</script> & Co";
    store.addExercise(trickyName, group.id, "150");

    const added = store.exercises.find(e => e.name === trickyName);
    assert(added, "Tricky exercise name should be saved accurately in store");

    // Verify calculated target formats correctly without NaN
    const target = store.calculatedTarget(added, 0);
    assert(target.weight.includes("lbs") && !target.weight.includes("NaN"), "Target weight should render valid lbs string");

    // Inspect index.html template string escaping function
    const htmlPath = path.join(__dirname, '../../index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Check escapeHtml helper presence and usage
    assert(htmlContent.includes("function escapeHtml("), "escapeHtml helper must exist");
    assert(htmlContent.includes("&#039;"), "escapeHtml must escape single quotes to &#039;");
});

// 2. Zero Sets Boundary Test
runTest("2. Zero Sets Boundary & Empty Array Evaluation", () => {
    const store = new AppStore();
    const ex = store.exercises[0];
    const log = store.getLog(ex, 0);

    log.sets = [];
    log.isCompleted = true;
    store.updateLog(log);

    const group = store.muscleGroups.find(g => g.id === ex.muscleGroupId);
    assert.strictEqual(store.isMuscleGroupCompleted(group.id, 0), false, "Muscle group with 0-set exercise MUST be incomplete");

    const day = store.currentPlanData.days[0];
    day.exerciseIds = [ex.id];
    assert.strictEqual(store.isDayCompleted(day, 0), false, "Day with 0-set exercise MUST be incomplete");
});

// 3. NaN, Negative & Extreme Number PR Safeguards
runTest("3. NaN, Negative & Extreme Number PR Safeguards", () => {
    const store = new AppStore();
    const ex = store.exercises[0];

    // NaN update
    store.updateExercise({ id: ex.id, name: ex.name, personalRecord: NaN });
    let check = store.exercises.find(e => e.id === ex.id);
    assert(!isNaN(check.personalRecord) && check.personalRecord > 0, "PR updated with NaN should fall back to previous or default positive PR");

    // Negative update
    store.updateExercise({ id: ex.id, name: ex.name, personalRecord: -200 });
    check = store.exercises.find(e => e.id === ex.id);
    assert(!isNaN(check.personalRecord) && check.personalRecord > 0, "PR updated with negative value should fall back to positive PR");

    // Add with zero PR
    store.addExercise("Zero PR Move", store.muscleGroups[0].id, 0);
    const addedZero = store.exercises.find(e => e.name === "Zero PR Move");
    assert.strictEqual(addedZero.personalRecord, 100.0, "Zero PR should fall back to 100.0 default");

    // Add with string NaN
    store.addExercise("String NaN Move", store.muscleGroups[0].id, "not a number");
    const addedNaN = store.exercises.find(e => e.name === "String NaN Move");
    assert.strictEqual(addedNaN.personalRecord, 100.0, "Invalid text PR should fall back to 100.0 default");
});

// 4. Retrain Day & Week Advancement Desync Test
runTest("4. Retrain Day & Week Advancement Sync", () => {
    const store = new AppStore();
    const day = store.currentPlanData.days[0];
    const dayId = day.id;

    // Complete day 1 in Week 0
    store.markDayExercisesCompleted(dayId);
    
    // Advance currentWeekIndex to Week 1
    store.activeCycle.currentWeekIndex = 1;
    store.saveData();

    // Retrain day (from Week 1)
    store.markDayExercisesIncomplete(dayId);

    // Verify Week 0 log is reset and currentWeekIndex reverted to 0
    assert.strictEqual(store.activeCycle.currentWeekIndex, 0, "Cycle week should revert to 0 when retraining day completed in week 0");
    assert.strictEqual(store.isDayCompleted(day, 0), false, "Day 1 in Week 0 should now be incomplete");
});

// 5. Blank Day Rename Handling
runTest("5. Blank Day Rename Input Safeguard", () => {
    const store = new AppStore();
    const day = store.currentPlanData.days[0];
    const originalName = day.name;

    store.updateDayName(day.id, "     ");
    const after = store.currentPlanData.days.find(d => d.id === day.id);
    assert.strictEqual(after.name, originalName, "Whitespace-only day rename should restore original day name");
});

// 6. JSON Export/Import Roundtrip & Corruption Defense
runTest("6. JSON Export/Import Roundtrip & Corruption Defense", () => {
    const store = new AppStore();
    
    // Perform Export
    const exportedStr = store.exportToJSON();
    const parsed = JSON.parse(exportedStr);

    assert(typeof parsed.planDataById === 'object' && !Array.isArray(parsed.planDataById), "planDataById should be JSON object");
    assert(Array.isArray(parsed.plans), "plans should be array");
    assert(Array.isArray(parsed.globalMuscleGroups), "globalMuscleGroups should be array");
    assert(Array.isArray(parsed.globalExercises), "globalExercises should be array");

    // Test rejection of corrupted imports
    assert.strictEqual(store.importFromJSON(null), false, "null payload rejection");
    assert.strictEqual(store.importFromJSON("{ invalid json"), false, "invalid json rejection");
    assert.strictEqual(store.importFromJSON(JSON.stringify({ plans: 123 })), false, "schema mismatch rejection");

    // Test successful re-import
    const reImportSuccess = store.importFromJSON(exportedStr);
    assert.strictEqual(reImportSuccess, true, "Valid exported payload must re-import cleanly");
    assert(store.activeCycle.startDate instanceof Date, "startDate must be rehydrated into JS Date object");
});

// 7. Multi-Plan Cascading Deletion Audit
runTest("7. Multi-Plan Cascading Deletion Audit", () => {
    const store = new AppStore();
    
    // Create secondary plan
    store.createPlan("Hypertrophy Plan");
    const planAId = store.plans[0].id;
    const planBId = store.plans[1].id;

    // Pick muscle group and exercise
    const group = store.muscleGroups[0];
    const exInGroup = store.exercises.find(e => e.muscleGroupId === group.id);
    assert(exInGroup, "Should have exercise in group");

    // Remove muscle group
    store.removeMuscleGroup(group.id);

    // Verify purging across ALL plans in planDataById
    for (const pid of [planAId, planBId]) {
        const pData = store.planDataById[pid];
        assert(!pData.enabledExerciseIds.includes(exInGroup.id), `Exercise ${exInGroup.id} removed from plan ${pid}`);
        if (pData.activeCycle && pData.activeCycle.intensities) {
            const orphanIntensity = pData.activeCycle.intensities.find(i => i.muscleGroupId === group.id);
            assert(!orphanIntensity, `Orphan group intensity purged from plan ${pid}`);
        }
        if (pData.days) {
            pData.days.forEach(d => {
                assert(!d.exerciseIds.includes(exInGroup.id), `Exercise ${exInGroup.id} purged from day in plan ${pid}`);
            });
        }
    }
});

// 8. Custom Split Preservation in migrateDaysForPlan
runTest("8. Custom Split Preservation in migrateDaysForPlan", () => {
    const store = new AppStore();
    const currentPlan = store.currentPlanData;

    // Set custom 2-day split with empty exerciseIds
    currentPlan.days = [
        { id: "c-day-1", name: "Custom Upper Rest", exerciseIds: [] },
        { id: "c-day-2", name: "Custom Lower Rest", exerciseIds: [] }
    ];
    currentPlan.daysCount = 2;
    store.saveData();

    // Trigger migration
    store.migrateDaysForPlan(store.currentPlanId);

    assert.strictEqual(store.currentPlanData.days.length, 2, "Custom 2-day split preserved");
    assert.strictEqual(store.currentPlanData.days[0].name, "Custom Upper Rest", "Custom day name preserved");
});

// 9. Lucide Icon Safety Check in index.html
runTest("9. Lucide Icon Safety Check in index.html", () => {
    const htmlPath = path.join(__dirname, '../../index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    const lines = htmlContent.split('\n');
    lines.forEach((line, i) => {
        if (line.includes('lucide.createIcons()')) {
            const context = lines.slice(Math.max(0, i - 2), i + 1).join('\n');
            assert(context.includes("window.lucide && typeof lucide.createIcons === 'function'"), `lucide.createIcons() at line ${i + 1} must be safely guarded`);
        }
    });
});

// 10. Persistence & Reset State Recovery
runTest("10. Persistence & Reset State Recovery", () => {
    const store = new AppStore();
    store.resetAll();

    assert.strictEqual(store.plans.length, 1, "Reset creates default plan");
    assert(store.globalMuscleGroups.length >= 7, "Reset populates default muscle groups");
    assert(store.globalExercises.length >= 21, "Reset populates default global exercises");
    assert(store.activeCycle !== null, "Reset initializes default active cycle");
});

console.log("---------------------------------------------------------");
console.log(`FINAL ADVERSARIAL RESULTS: ${passed} PASSED, ${failed} FAILED.`);
console.log("=========================================================");

if (failed > 0) {
    process.exit(1);
}
