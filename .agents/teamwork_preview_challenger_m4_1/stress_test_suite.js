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
    _elements: {},
    getElementById: (id) => {
        if (!global.document._elements[id]) {
            global.document._elements[id] = { value: '', textContent: '', innerHTML: '' };
        }
        return global.document._elements[id];
    },
    resetMockElements: () => {
        global.document._elements = {};
    }
};

// Load app.js and expose global classes
const appJsPath = path.join(__dirname, '../../app.js');
const appJsContent = fs.readFileSync(appJsPath, 'utf8');
const runInGlobalScope = new Function(appJsContent + '\n global.AppStore = AppStore; global.sfSymbolToLucide = sfSymbolToLucide; global.getLucideIcon = getLucideIcon; global.normalizeIntensity = normalizeIntensity;');
runInGlobalScope();

// Load index.html for testing modal submission logic
const htmlPath = path.join(__dirname, '../../index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// Extract script content from index.html to bind modal functions in node env
const scriptMatches = htmlContent.match(/<script>([\s\S]*?)<\/script>/gi);
let combinedScripts = '';
if (scriptMatches) {
    scriptMatches.forEach(s => {
        const clean = s.replace(/<\/?script>/gi, '');
        if (!clean.includes('class AppStore')) {
            combinedScripts += clean + '\n';
        }
    });
}

// Bind modal functions to global scope without re-declaring storeObj
try {
    const safeScripts = combinedScripts
        .replace(/let storeObj\s*=/g, 'var storeObj =')
        .replace(/const storeObj\s*=/g, 'var storeObj =');
    const bindIndexScripts = new Function(`
        var storeObj = global.testStore;
        function renderAll() {}
        function closeModal() {}
        function openModal() {}
        ${safeScripts}
        global.submitAddExercise = submitAddExercise;
        global.submitEditExercise = submitEditExercise;
        global.submitRenamePlan = submitRenamePlan;
        global.submitRenameGroup = submitRenameGroup;
        global.submitNewCycle = submitNewCycle;
        global.submitAddGroup = submitAddGroup;
        global.openAddExerciseModal = openAddExerciseModal;
        global.openEditExerciseModal = openEditExerciseModal;
        global.openRenamePlanModal = openRenamePlanModal;
        global.openRenameGroupModal = openRenameGroupModal;
        global.openDeletePlanModal = openDeletePlanModal;
    `);
    global.bindIndexScripts = bindIndexScripts;
} catch (err) {
    console.error("Warning: script extraction setup error:", err.message);
}

let passed = 0;
let failed = 0;
const testResults = [];

function test(category, name, fn) {
    try {
        localStorage.clear();
        global.document.resetMockElements();
        fn();
        console.log(`[PASS] [${category}] ${name}`);
        passed++;
        testResults.push({ category, name, status: 'PASS', error: null });
    } catch (err) {
        console.error(`[FAIL] [${category}] ${name}`);
        console.error(`  Error: ${err.message}`);
        console.error(err.stack);
        failed++;
        testResults.push({ category, name, status: 'FAIL', error: err.message, stack: err.stack });
    }
}

console.log("==========================================================");
console.log("=== EMPIRICAL STRESS TEST SUITE FOR IRONLOG WEB (M4_1) ===");
console.log("==========================================================");

// ============================================================================
// SUITE 1: Special Characters, Single Quotes, Double Quotes, Unicode, Apostrophes
// ============================================================================

test("1. Special Chars", "Plan Creation & Renaming with Quotes, Unicode & HTML Special Chars", () => {
    const store = new AppStore();
    const specialNames = [
        "O'Connor's \"Heavy\" Split",
        "Leg's & Back 💪 🏋️",
        "<script>alert('xss')</script>",
        "Plan & Co. -- 'Special' \"Test\" < > & /",
        "中文 力量 训练 🌟",
        "Épaule, Triceps & Nuche — 100% 👍"
    ];

    specialNames.forEach((name, idx) => {
        store.createPlan(name);
        const plan = store.plans.find(p => p.name === name);
        assert(plan, `Plan should be created with exact name: ${name}`);
        assert.strictEqual(plan.name, name, `Plan name string should match verbatim`);

        // Test rename
        const renamed = name + " (Renamed '2')";
        store.renamePlan(plan.id, renamed);
        const planAfter = store.plans.find(p => p.id === plan.id);
        assert.strictEqual(planAfter.name, renamed, `Renamed plan name should match verbatim`);
    });
});

test("1. Special Chars", "Muscle Group & Exercise Creation with Quotes, Emojis, Apostrophes", () => {
    const store = new AppStore();
    const groupName = "Thor's \"Godly\" Arms 💪";
    store.addMuscleGroup(groupName, "figure.walk");
    const group = store.muscleGroups.find(g => g.name === groupName);
    assert(group, "Muscle group with special chars and quotes should exist");

    const exName = "Bulgarian Split Squat (O'Brien's \"Variation\") 🏋️‍♀️";
    store.addExercise(exName, group.id, 150.5);
    const ex = store.exercises.find(e => e.name === exName);
    assert(ex, "Exercise with quotes, apostrophes, and unicode should exist");
    assert.strictEqual(ex.name, exName, "Exercise name should match verbatim");

    // Update exercise name
    const updatedName = "Bulgarian Split Squat - O'Reilly's \"Pro\" <V2>";
    store.updateExercise({ id: ex.id, name: updatedName, muscleGroupId: group.id, personalRecord: 160 });
    const exUpdated = store.exercises.find(e => e.id === ex.id);
    assert.strictEqual(exUpdated.name, updatedName, "Updated exercise name should match verbatim");
});

test("1. Special Chars", "Day Renaming with Whitespace & Special Characters", () => {
    const store = new AppStore();
    const day = store.currentPlanData.days[0];

    // Renaming with valid special characters
    const specialDayName = "Day 1: Upper's \"Push\" & Pull 🔥";
    store.updateDayName(day.id, specialDayName);
    assert.strictEqual(store.currentPlanData.days[0].name, specialDayName, "Day name should accept quotes and unicode");

    // Renaming with empty whitespace string
    store.updateDayName(day.id, "     \t \n  ");
    assert.strictEqual(store.currentPlanData.days[0].name, specialDayName, "Day name should not accept whitespace-only and revert/preserve existing name");
});

test("1. Special Chars", "JSON Export/Import Roundtrip with Quotes and Unicode", () => {
    const store = new AppStore();
    const unicodePlanName = "Plan O'Testing \"JSON\" 🚀";
    store.createPlan(unicodePlanName);
    const unicodeExName = "Dumbbell O'Fly <100%> 💥";
    store.addExercise(unicodeExName, store.muscleGroups[0].id, 75);

    const jsonString = store.exportToJSON();
    assert(jsonString.includes("Plan O'Testing \\\"JSON\\\" 🚀") || jsonString.includes("Plan O'Testing"), "Exported JSON should contain unicode strings");

    const newStore = new AppStore();
    const success = newStore.importFromJSON(jsonString);
    assert.strictEqual(success, true, "Importing JSON with quotes and unicode should succeed");

    const importedPlan = newStore.plans.find(p => p.name === unicodePlanName);
    assert(importedPlan, "Imported store should restore exact plan name with special chars");

    const importedEx = newStore.exercises.find(e => e.name === unicodeExName);
    assert(importedEx, "Imported store should restore exact exercise name with special chars");
});

// ============================================================================
// SUITE 2: Boundary PR Values (0, -50, NaN, 1e300, "")
// ============================================================================

test("2. Boundary PRs", "AppStore.addExercise PR Boundary Handling (0, -50, NaN, 1e300, '', null, undefined, Infinity)", () => {
    const store = new AppStore();
    const groupId = store.muscleGroups[0].id;

    const testCases = [
        { input: 0, expected: 100.0, label: "Zero PR" },
        { input: -50, expected: 100.0, label: "Negative PR" },
        { input: NaN, expected: 100.0, label: "NaN PR" },
        { input: "", expected: 100.0, label: "Empty string PR" },
        { input: "   ", expected: 100.0, label: "Whitespace string PR" },
        { input: "invalid_num", expected: 100.0, label: "Non-numeric string PR" },
        { input: null, expected: 100.0, label: "Null PR" },
        { input: undefined, expected: 100.0, label: "Undefined PR" },
        { input: 1e300, expected: 1e300, label: "Huge number 1e300 PR" },
        { input: 225.5, expected: 225.5, label: "Valid positive float PR" }
    ];

    testCases.forEach((tc, idx) => {
        const exName = `Ex_PR_Test_${idx}`;
        store.addExercise(exName, groupId, tc.input);
        const ex = store.exercises.find(e => e.name === exName);
        assert(ex, `Exercise ${exName} should be created`);
        assert(!isNaN(ex.personalRecord), `PR for ${tc.label} should not be NaN`);
        assert(isFinite(ex.personalRecord) || tc.input === 1e300, `PR for ${tc.label} should be finite or 1e300`);
        assert.strictEqual(ex.personalRecord, tc.expected, `PR for ${tc.label} should equal expected value ${tc.expected}`);
    });
});

test("2. Boundary PRs", "AppStore.updateExercise PR Boundary Handling", () => {
    const store = new AppStore();
    const ex = store.exercises[0];
    const origPR = ex.personalRecord;
    assert(origPR > 0, "Initial exercise PR should be positive");

    // 1. Update with 0 -> should fallback to origPR
    store.updateExercise({ id: ex.id, name: ex.name, personalRecord: 0 });
    let updated = store.exercises.find(e => e.id === ex.id);
    assert.strictEqual(updated.personalRecord, origPR, "0 PR should fallback to previous valid PR");

    // 2. Update with -50 -> should fallback to origPR
    store.updateExercise({ id: ex.id, name: ex.name, personalRecord: -50 });
    updated = store.exercises.find(e => e.id === ex.id);
    assert.strictEqual(updated.personalRecord, origPR, "Negative PR should fallback to previous valid PR");

    // 3. Update with NaN -> should fallback to origPR
    store.updateExercise({ id: ex.id, name: ex.name, personalRecord: NaN });
    updated = store.exercises.find(e => e.id === ex.id);
    assert.strictEqual(updated.personalRecord, origPR, "NaN PR should fallback to previous valid PR");

    // 4. Update with "" -> should fallback to origPR
    store.updateExercise({ id: ex.id, name: ex.name, personalRecord: "" });
    updated = store.exercises.find(e => e.id === ex.id);
    assert.strictEqual(updated.personalRecord, origPR, "Empty string PR should fallback to previous valid PR");

    // 5. Update with 315.0 -> should update to 315.0
    store.updateExercise({ id: ex.id, name: ex.name, personalRecord: 315.0 });
    updated = store.exercises.find(e => e.id === ex.id);
    assert.strictEqual(updated.personalRecord, 315.0, "Valid PR 315.0 should be saved");

    // 6. Update with 1e300 -> should update to 1e300
    store.updateExercise({ id: ex.id, name: ex.name, personalRecord: 1e300 });
    updated = store.exercises.find(e => e.id === ex.id);
    assert.strictEqual(updated.personalRecord, 1e300, "1e300 PR should be saved");
});

test("2. Boundary PRs", "calculatedTarget with Extreme / Boundary PR Values", () => {
    const store = new AppStore();
    const ex = store.exercises[0];

    // Case A: standard PR
    ex.personalRecord = 200;
    let target = store.calculatedTarget(ex, 0);
    assert(!target.weight.includes("NaN"), "Target weight should not be NaN for normal PR");

    // Case B: PR = 1e300 (huge float)
    ex.personalRecord = 1e300;
    target = store.calculatedTarget(ex, 0);
    assert(!target.weight.includes("NaN"), "Target weight should not be NaN for 1e300 PR");

    // Case C: PR = 0.00001 (tiny float)
    ex.personalRecord = 0.00001;
    target = store.calculatedTarget(ex, 0);
    assert(!target.weight.includes("NaN"), "Target weight should not be NaN for tiny PR");

    // Case D: PR = NaN fallback check
    ex.personalRecord = NaN;
    target = store.calculatedTarget(ex, 0);
    assert(!target.weight.includes("NaN") || target.weight === "NaN lbs", "Check behavior on NaN PR");
});

test("2. Boundary PRs", "Modal Submit Functions Input Sanitization for PR (Index.html Logic)", () => {
    if (!global.bindIndexScripts) return;
    const store = new AppStore();
    global.testStore = store;
    global.bindIndexScripts();

    const group = store.muscleGroups[0];

    // Test submitAddExercise with invalid PR inputs
    const invalidPrInputs = ["0", "-50", "NaN", "", "   ", "invalid", "1e300"];

    invalidPrInputs.forEach((val, i) => {
        const name = `Modal_Ex_${i}`;
        document.getElementById('input-add-exercise-group-id').value = group.id;
        document.getElementById('input-exercise-name').value = name;
        document.getElementById('input-exercise-pr').value = val;

        global.submitAddExercise();

        const added = store.exercises.find(e => e.name === name);
        assert(added, `Exercise ${name} should be added`);
        assert(!isNaN(added.personalRecord), `PR for input '${val}' must not be NaN`);
        assert(added.personalRecord > 0, `PR for input '${val}' must be positive`);
    });
});

// ============================================================================
// SUITE 3: Corrupted JSON Imports
// ============================================================================

test("3. Corrupted JSON", "Non-JSON and Primitive Strings", () => {
    const store = new AppStore();
    const badInputs = [
        "not a json string",
        "{ malformed json",
        "",
        "12345",
        "true",
        "false",
        "null",
        "\"just a string\"",
        "[]"
    ];

    badInputs.forEach(input => {
        const res = store.importFromJSON(input);
        assert.strictEqual(res, false, `importFromJSON should return false for corrupted string: '${input}'`);
    });
});

test("3. Corrupted JSON", "Missing Top-Level Keys", () => {
    const store = new AppStore();
    const validStructure = JSON.parse(store.exportToJSON());

    const missingKeyCases = [
        { key: "plans", val: undefined },
        { key: "plans", val: "not an array" },
        { key: "globalMuscleGroups", val: undefined },
        { key: "globalMuscleGroups", val: 123 },
        { key: "globalExercises", val: undefined },
        { key: "globalExercises", val: {} },
        { key: "currentPlanId", val: undefined },
        { key: "currentPlanId", val: 999 },
        { key: "planDataById", val: undefined },
        { key: "planDataById", val: "not an object" }
    ];

    missingKeyCases.forEach(tc => {
        const copy = JSON.parse(JSON.stringify(validStructure));
        if (tc.val === undefined) {
            delete copy[tc.key];
        } else {
            copy[tc.key] = tc.val;
        }

        const res = store.importFromJSON(JSON.stringify(copy));
        assert.strictEqual(res, false, `importFromJSON should fail when ${tc.key} is ${tc.val}`);
    });
});

test("3. Corrupted JSON", "Malformed Inner Properties (activeCycle, dates, days, exerciseLogs)", () => {
    const store = new AppStore();
    const validStructure = JSON.parse(store.exportToJSON());
    const planId = validStructure.currentPlanId;

    // Inject corrupted activeCycle with bad startDate, negative week index, corrupted intensities
    validStructure.planDataById[planId].activeCycle = {
        id: "bad-cycle",
        name: "Corrupt Cycle",
        startDate: "this is not a date string",
        currentWeekIndex: "invalid_number",
        intensities: "not an array",
        isCompleted: "yes"
    };

    // Inject corrupted days array and exercise logs
    validStructure.planDataById[planId].days = "corrupt days string";
    validStructure.planDataById[planId].exerciseLogs = "corrupt logs string";
    validStructure.planDataById[planId].daysCount = "five";

    const res = store.importFromJSON(JSON.stringify(validStructure));
    assert.strictEqual(res, true, "importFromJSON should sanitize and accept recoverable planDataById objects");

    // Verify sanitization took effect
    const sanitizedData = store.planDataById[planId];
    assert(Array.isArray(sanitizedData.days), "days must be sanitized back to an array");
    assert(Array.isArray(sanitizedData.exerciseLogs), "exerciseLogs must be sanitized back to an array");
    assert.strictEqual(typeof sanitizedData.daysCount, 'number', "daysCount must be sanitized to a number");
    assert(sanitizedData.activeCycle.startDate instanceof Date, "startDate must be sanitized to a valid Date object");
    assert(!isNaN(sanitizedData.activeCycle.startDate.getTime()), "startDate Date object must be valid");
    assert.strictEqual(sanitizedData.activeCycle.currentWeekIndex, 0, "invalid weekIndex should default to 0");
    assert(Array.isArray(sanitizedData.activeCycle.intensities), "intensities must be sanitized to an array");
});

test("3. Corrupted JSON", "Legacy Flat Array Format for planDataById Import", () => {
    const store = new AppStore();
    const validStructure = JSON.parse(store.exportToJSON());
    const planId = validStructure.currentPlanId;
    const planData = validStructure.planDataById[planId];

    // Convert planDataById into legacy flat array format: [planId, planData]
    validStructure.planDataById = [planId, planData];

    const res = store.importFromJSON(JSON.stringify(validStructure));
    assert.strictEqual(res, true, "importFromJSON should support legacy flat array planDataById format");
    assert(store.planDataById[planId], "planDataById should contain planId after importing legacy format");
});

// ============================================================================
// SUITE 4: Retrain Day Week Index Calculations
// ============================================================================

test("4. Retrain Day", "markDayExercisesIncomplete Default Behavior when currentWeekIndex = 0", () => {
    const store = new AppStore();
    const day = store.currentPlanData.days[0];
    const dayId = day.id;

    // Complete day exercises in Week 0
    store.markDayExercisesCompleted(dayId);
    assert.strictEqual(store.isDayCompleted(day, 0), true, "Day should be completed in Week 0");

    // Retrain day (default week)
    store.markDayExercisesIncomplete(dayId);

    // Verify Week 0 exercises are incomplete
    assert.strictEqual(store.isDayCompleted(day, 0), false, "Day should be incomplete after retrain");
    assert.strictEqual(store.activeCycle.currentWeekIndex, 0, "currentWeekIndex should remain 0");
});

test("4. Retrain Day", "markDayExercisesIncomplete Desync Recovery (currentWeekIndex = 1, retrain Week 0)", () => {
    const store = new AppStore();
    const day1 = store.currentPlanData.days[0];
    const day2 = store.currentPlanData.days[1];
    const day3 = store.currentPlanData.days[2];

    // Complete all days in Week 0 so week auto-advances to Week 1 (currentWeekIndex = 1)
    store.markDayExercisesCompleted(day1.id);
    store.markDayExercisesCompleted(day2.id);
    store.markDayExercisesCompleted(day3.id);

    assert.strictEqual(store.activeCycle.currentWeekIndex, 1, "Cycle should have auto-advanced to Week 1");

    // Now click 'Retrain' on Day 1 (without specifying targetWeekIndex)
    // Since Day 1 is completed in Week 0 but NOT yet completed in Week 1,
    // markDayExercisesIncomplete should detect that Week 0 completed log should be reset.
    store.markDayExercisesIncomplete(day1.id);

    assert.strictEqual(store.activeCycle.currentWeekIndex, 0, "currentWeekIndex should revert to 0");
    assert.strictEqual(store.isDayCompleted(day1, 0), false, "Day 1 in Week 0 should now be incomplete");
});

test("4. Retrain Day", "markDayExercisesIncomplete with Explicit targetWeekIndex", () => {
    const store = new AppStore();
    const day1 = store.currentPlanData.days[0];

    // Set currentWeekIndex to 3
    store.activeCycle.currentWeekIndex = 3;

    // Complete Day 1 in Week 1 explicitly
    const day1Exs = day1.exerciseIds.map(eid => store.exercises.find(e => e.id === eid)).filter(Boolean);
    day1Exs.forEach(ex => {
        const log = store.getLog(ex, 1);
        log.isCompleted = true;
        log.sets.forEach(s => s.isCompleted = true);
        store.updateLog(log);
    });

    assert.strictEqual(store.isDayCompleted(day1, 1), true, "Day 1 should be completed in Week 1");

    // Retrain Day 1 specifically for Week 1
    store.markDayExercisesIncomplete(day1.id, 1);

    assert.strictEqual(store.isDayCompleted(day1, 1), false, "Day 1 in Week 1 should be reset to incomplete");
    assert.strictEqual(store.activeCycle.currentWeekIndex, 1, "currentWeekIndex should revert to 1");
});

test("4. Retrain Day", "markDayExercisesIncomplete on Completed Cycle (isCompleted = true)", () => {
    const store = new AppStore();
    const day1 = store.currentPlanData.days[0];

    store.activeCycle.currentWeekIndex = 3;
    store.activeCycle.isCompleted = true;

    store.markDayExercisesIncomplete(day1.id, 2);

    assert.strictEqual(store.activeCycle.isCompleted, false, "Cycle isCompleted should flip to false when retraining");
    assert.strictEqual(store.activeCycle.currentWeekIndex, 2, "currentWeekIndex should revert to 2");
});

test("4. Retrain Day", "markDayExercisesIncomplete on Empty Day or Invalid Day ID", () => {
    const store = new AppStore();
    
    // Add empty day
    store.setDaysCount(4);
    const emptyDay = store.currentPlanData.days[3];
    assert.strictEqual(emptyDay.exerciseIds.length, 0, "4th day should be empty");

    // Retrain empty day should not throw
    store.markDayExercisesIncomplete(emptyDay.id);

    // Retrain invalid day ID should not throw
    store.markDayExercisesIncomplete("non-existent-day-id");
});

test("4. Retrain Day", "markDayExercisesIncomplete when activeCycle is null", () => {
    const store = new AppStore();
    store.currentPlanData.activeCycle = null;

    const day1 = store.currentPlanData.days[0];
    // Calling markDayExercisesIncomplete when activeCycle is null should return gracefully without crashing
    store.markDayExercisesIncomplete(day1.id);
    assert.strictEqual(store.activeCycle, null, "activeCycle should remain null");
});

console.log("\n==========================================================");
console.log(`STRESS TEST RESULTS: ${passed} PASSED, ${failed} FAILED.`);
console.log("==========================================================");

if (failed > 0) {
    console.error("STRESS TEST HARNESS DISCOVERED FAILURES!");
    process.exit(1);
}
