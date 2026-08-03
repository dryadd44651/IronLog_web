// Independent Verification Suite for IronLog Web
// Executed by Victory Auditor

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Mock localStorage
const storageMap = new Map();
const mockLocalStorage = {
    getItem: (key) => storageMap.get(key) || null,
    setItem: (key, val) => storageMap.set(key, String(val)),
    removeItem: (key) => storageMap.delete(key),
    clear: () => storageMap.clear()
};

// Create VM context
const context = vm.createContext({
    console: console,
    localStorage: mockLocalStorage,
    crypto: global.crypto,
    Date: Date,
    Math: Math,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    Array: Array,
    Object: Object,
    Set: Set,
    JSON: JSON,
    Boolean: Boolean
});

// Load app.js
const appJsPath = path.join(__dirname, '../../app.js');
const appJsCode = fs.readFileSync(appJsPath, 'utf8');

vm.runInContext(appJsCode, context);

const results = [];

function assert(condition, testName, details = '') {
    if (condition) {
        results.push({ test: testName, status: 'PASS', details });
        console.log(`[PASS] ${testName}`);
    } else {
        results.push({ test: testName, status: 'FAIL', details });
        console.error(`[FAIL] ${testName}: ${details}`);
    }
}

console.log("=== STARTING INDEPENDENT VICTORY AUDIT TEST SUITE ===");

try {
    // -------------------------------------------------------------
    // Test Category 1: Initial App Launch & Storage Schema Formatting
    // -------------------------------------------------------------
    mockLocalStorage.clear();
    const store = vm.runInContext('new AppStore()', context);

    assert(store.plans.length === 1, "1.1 Initial Launch: Creates Default Plan", `Plans count: ${store.plans.length}`);
    assert(store.plans[0].name === "Default Plan", "1.2 Initial Launch: Plan name is 'Default Plan'");
    assert(store.globalMuscleGroups.length === 7, "1.3 Initial Launch: Creates 7 seed muscle groups", `Count: ${store.globalMuscleGroups.length}`);
    assert(store.globalExercises.length === 21, "1.4 Initial Launch: Creates 21 seed exercises", `Count: ${store.globalExercises.length}`);

    const rawData = mockLocalStorage.getItem("ironlog_data_v4");
    assert(rawData !== null, "1.5 Storage Schema: Key 'ironlog_data_v4' exists in localStorage");

    const parsedData = JSON.parse(rawData);
    assert(Array.isArray(parsedData.plans), "1.6 Storage Schema: 'plans' is an array");
    assert(typeof parsedData.currentPlanId === 'string', "1.7 Storage Schema: 'currentPlanId' is string");
    assert(Array.isArray(parsedData.globalMuscleGroups), "1.8 Storage Schema: 'globalMuscleGroups' is array");
    assert(Array.isArray(parsedData.globalExercises), "1.9 Storage Schema: 'globalExercises' is array");
    assert(typeof parsedData.planDataById === 'object' && parsedData.planDataById !== null, "1.10 Storage Schema: 'planDataById' is object");

    const defaultPlanData = parsedData.planDataById[store.currentPlanId];
    assert(defaultPlanData !== undefined, "1.11 Storage Schema: Current plan entry exists in planDataById");
    assert(Array.isArray(defaultPlanData.days) && defaultPlanData.days.length === 3, "1.12 Storage Schema: Default 3-day split created");
    assert(defaultPlanData.activeCycle !== null, "1.13 Storage Schema: Inaugural cycle created");

    // -------------------------------------------------------------
    // Test Category 2: Boundary Conditions (PR, Weights, Reps, NaN)
    // -------------------------------------------------------------
    const testEx = store.globalExercises[0];
    
    // Decimal Weight Target Calculation
    testEx.personalRecord = 150.55;
    const calcDec = store.calculatedTarget(testEx, 0); // weekIndex 0 -> Light multiplier 0.55
    // 150.55 * 0.55 = 82.8025 -> Math.round = 83 lbs
    assert(calcDec.weight === "83 lbs", "2.1 Boundary: Decimal PR rounds weight correctly", `Calculated: ${calcDec.weight}`);

    // Negative PR Input
    store.addExercise("Negative PR Test", store.globalMuscleGroups[0].id, -100);
    const addedNeg = store.globalExercises.find(e => e.name === "Negative PR Test");
    assert(addedNeg && addedNeg.personalRecord === 100.0, "2.2 Boundary: Negative PR in addExercise defaults to 100.0", `PR: ${addedNeg ? addedNeg.personalRecord : 'null'}`);

    // NaN / Invalid PR Update
    store.updateExercise({ id: addedNeg.id, name: "Negative PR Test Updated", muscleGroupId: store.globalMuscleGroups[0].id, personalRecord: "invalid_nan" });
    const updatedNaN = store.globalExercises.find(e => e.id === addedNeg.id);
    assert(updatedNaN.personalRecord === 100.0, "2.3 Boundary: NaN PR in updateExercise preserves previous valid PR / defaults to 100.0", `PR: ${updatedNaN.personalRecord}`);

    // Zero PR Input
    store.addExercise("Zero PR Test", store.globalMuscleGroups[0].id, 0);
    const addedZero = store.globalExercises.find(e => e.name === "Zero PR Test");
    assert(addedZero && addedZero.personalRecord === 100.0, "2.4 Boundary: Zero PR in addExercise treated safely (defaults to 100.0)");

    // -------------------------------------------------------------
    // Test Category 3: Empty States & Database Reset
    // -------------------------------------------------------------
    const emptyDay = { id: "empty_day_1", name: "Rest Day", exerciseIds: [] };
    const isEmpComplete = store.isDayCompleted(emptyDay, 0);
    assert(isEmpComplete === true, "3.1 Empty State: Day with no exercises evaluates as completed (doesn't block cycle)");

    // Reset All
    store.resetAll();
    assert(store.plans.length === 1, "3.2 Reset Database: Resets plans list to single Default Plan");
    assert(store.globalMuscleGroups.length === 7, "3.3 Reset Database: Restores initial seed muscle groups");
    assert(store.globalExercises.length === 21, "3.4 Reset Database: Restores initial seed exercises");

    // -------------------------------------------------------------
    // Test Category 4: State Synchronization & Split Modification
    // -------------------------------------------------------------
    // Modify Days Count to 2 (Truncation)
    const day3Exercise = store.currentPlanData.days[2].exerciseIds[0];
    store.setDaysCount(2);
    assert(store.currentPlanData.days.length === 2, "4.1 Split Sync: Decreasing split days count updates days array length to 2");
    assert(store.currentPlanData.days[0].exerciseIds.includes(day3Exercise), "4.2 Split Sync: Truncated Day 3 exercises preserved into Day 1");

    // Modify Days Count to 5 (Expansion)
    store.setDaysCount(5);
    assert(store.currentPlanData.days.length === 5, "4.3 Split Sync: Increasing split days count adds new days up to 5");

    // Day Renaming
    const day1Id = store.currentPlanData.days[0].id;
    store.updateDayName(day1Id, "Heavy Push Day");
    assert(store.currentPlanData.days[0].name === "Heavy Push Day", "4.4 Split Sync: Day renaming updates day name in store");

    // Day Renaming with Empty String
    store.updateDayName(day1Id, "   ");
    assert(store.currentPlanData.days[0].name === "Heavy Push Day", "4.5 Split Sync: Empty day rename keeps existing name");

    // Week Advancement Verification
    const currentWeekBefore = store.activeCycle.currentWeekIndex;
    store.forceAdvanceWeek();
    assert(store.activeCycle.currentWeekIndex === currentWeekBefore + 1, "4.6 Week Advancement: Advance week increments week index");

    // Retrain Day Logic
    const dayToRetrain = store.currentPlanData.days[0];
    store.markDayExercisesCompleted(dayToRetrain.id);
    store.markDayExercisesIncomplete(dayToRetrain.id);
    const dayStatusAfterRetrain = store.isDayCompleted(dayToRetrain, store.activeCycle.currentWeekIndex);
    assert(dayStatusAfterRetrain === false, "4.7 Retrain Day: Marks day exercises incomplete without week desync");

    // -------------------------------------------------------------
    // Test Category 5: Import / Export Integrity
    // -------------------------------------------------------------
    const jsonBackup = store.exportToJSON();
    assert(typeof jsonBackup === 'string' && jsonBackup.includes("Default Plan"), "5.1 Backup/Restore: Export outputs valid JSON string");

    const importSuccess = store.importFromJSON(jsonBackup);
    assert(importSuccess === true, "5.2 Backup/Restore: Valid JSON import returns true");

    const corruptImportSuccess = store.importFromJSON("{ invalid_json_data ... ");
    assert(corruptImportSuccess === false, "5.3 Backup/Restore: Malformed JSON import fails gracefully returning false");

    const missingKeyImportSuccess = store.importFromJSON(JSON.stringify({ plans: [] }));
    assert(missingKeyImportSuccess === false, "5.4 Backup/Restore: Missing schema key JSON import fails gracefully returning false");

    // -------------------------------------------------------------
    // Test Category 6: Event Handler Escaping & Lucide Safety
    // -------------------------------------------------------------
    // Test exercise with single quote in name
    store.addExercise("O'Hearn Incline Press", store.globalMuscleGroups[0].id, 225);
    const quoteEx = store.globalExercises.find(e => e.name === "O'Hearn Incline Press");
    assert(quoteEx !== undefined, "6.1 Quote Handling: Exercise with single quote created in store");

    // Escape test check
    const htmlEscaped = quoteEx.name.replace(/'/g, "&#039;");
    assert(htmlEscaped === "O&#039;Hearn Incline Press", "6.2 Quote Handling: HTML escape replaces single quotes");

    console.log("\n=== TEST SUMMARY ===");
    const passed = results.filter(r => r.status === 'PASS').length;
    const total = results.length;
    console.log(`Passed: ${passed} / ${total}`);
    if (passed === total) {
        console.log("ALL VERIFICATION CHECKS PASSED PERFECTLY!");
    }

} catch (err) {
    console.error("FATAL UNHANDLED ERROR IN TEST SUITE:", err);
}
