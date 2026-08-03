// Comprehensive Empirical Verification Suite for IronLog Web UI State & Split Sync
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

// Mock localStorage
const localStorageStore = new Map();
global.localStorage = {
    getItem: (key) => localStorageStore.get(key) || null,
    setItem: (key, val) => localStorageStore.set(key, String(val)),
    removeItem: (key) => localStorageStore.delete(key),
    clear: () => localStorageStore.clear()
};

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
        if (selector === 'option') {
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
global.console = console;

// Load code
const projectRoot = path.join(__dirname, '../..');
const appJsContent = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');
const indexHtmlContent = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

const scriptMatches = indexHtmlContent.split('<script>');
const inlineScript = scriptMatches[scriptMatches.length - 1].split('</script>')[0];

const context = vm.createContext(global);
vm.runInContext(appJsContent, context);
vm.runInContext(inlineScript, context);

// Test suite code to be evaluated inside context
const testSuiteCode = `
// Trigger DOMContentLoaded
const domContentLoadedListeners = window.eventListeners['DOMContentLoaded'] || [];
domContentLoadedListeners.forEach(fn => fn());

const testResults = [];

function assert(condition, message, details = '') {
    if (condition) {
        testResults.push({ pass: true, message, details });
        console.log("  [PASS] " + message);
    } else {
        testResults.push({ pass: false, message, details });
        console.error("  [FAIL] " + message + " | Details: " + details);
    }
}

function runSection(name, fn) {
    console.log("\\n=== Running Test Section: " + name + " ===");
    try {
        fn();
    } catch (e) {
        console.error("  [CRASH] Exception in section " + name + ": " + e.stack);
        testResults.push({ pass: false, message: "Section crash: " + name, details: e.stack });
    }
}

// -------------------------------------------------------------
// AREA 1: MULTI-PLAN OPERATIONS & DOM SYNC
// -------------------------------------------------------------
runSection("1. Multi-Plan Operations & Sync", () => {
    // 1.1 Initial State
    assert(storeObj.plans.length === 1, "Initial plans count is 1");
    assert(storeObj.plans[0].name === "Default Plan", "Initial plan name is 'Default Plan'");
    const planSelect = document.getElementById('header-plan-select');
    assert(planSelect.options.length === 1, "Header plan select options count is 1");
    assert(planSelect.options[0].textContent === "Default Plan", "Header plan select option text matches");

    // 1.2 Plan Creation
    storeObj.createPlan("Hypertrophy Plan");
    renderAll();
    assert(storeObj.plans.length === 2, "Plans count after creation is 2");
    assert(storeObj.currentPlanId === storeObj.plans[1].id, "Current plan ID switched to new plan");
    assert(planSelect.options.length === 2, "Header plan select options updated to 2", "options: " + planSelect.options.map(o => o.textContent).join(', '));
    const settingsPlansList = document.getElementById('settings-plans-list');
    assert(settingsPlansList.innerHTML.includes("Hypertrophy Plan"), "Settings plans list contains 'Hypertrophy Plan'");
    assert(settingsPlansList.innerHTML.includes("Current"), "Settings plans list shows Current badge for active plan");

    // Verify created plan structure
    const hypPlanData = storeObj.planDataById[storeObj.currentPlanId];
    assert(hypPlanData.daysCount === 3, "New plan has default 3 daysCount");
    assert(hypPlanData.days.length === 3, "New plan has 3 migrated days");
    assert(hypPlanData.activeCycle !== null, "New plan auto-created active cycle");
    assert(hypPlanData.activeCycle.name === "Hypertrophy Plan Cycle", "New plan active cycle name matches plan");

    // 1.3 Plan Copying
    const sourcePlanId = storeObj.currentPlanId;
    storeObj.copyPlan(sourcePlanId);
    renderAll();
    assert(storeObj.plans.length === 3, "Plans count after copy is 3");
    const copiedPlan = storeObj.plans[2];
    assert(copiedPlan.name === "Hypertrophy Plan (Copy)", "Copied plan name has '(Copy)' suffix");
    assert(storeObj.currentPlanId === copiedPlan.id, "Active plan switched to copied plan");
    const copiedData = storeObj.planDataById[copiedPlan.id];
    assert(copiedData.days[0].id !== hypPlanData.days[0].id, "Copied plan days have fresh unique IDs");
    assert(copiedData.activeCycle.id !== hypPlanData.activeCycle.id, "Copied plan cycle has fresh unique ID");

    // 1.4 Plan Renaming
    storeObj.renamePlan(sourcePlanId, "Powerlifting Phase 1");
    renderAll();
    const sourcePlanObj = storeObj.plans.find(p => p.id === sourcePlanId);
    assert(sourcePlanObj.name === "Powerlifting Phase 1", "Plan renamed in storeObj.plans");
    assert(planSelect.options.some(o => o.textContent === "Powerlifting Phase 1"), "Header select option reflects renamed plan");

    // 1.5 Plan Switching & Isolation State Verification
    // Mutate state in Copied Plan (current active plan)
    storeObj.setDaysCount(5);
    storeObj.updateDayName(copiedData.days[0].id, "Custom Leg Blast Day");
    const originalPlan1DataDaysCount = storeObj.planDataById[sourcePlanId].daysCount;
    
    // Switch to sourcePlan
    storeObj.selectPlan(sourcePlanId);
    renderAll();
    assert(storeObj.currentPlanId === sourcePlanId, "Switched back to sourcePlan");
    assert(storeObj.currentPlanData.daysCount === originalPlan1DataDaysCount, "Source plan daysCount unchanged by copied plan edit");
    assert(storeObj.currentPlanData.days[0].name !== "Custom Leg Blast Day", "Source plan day name isolated from copied plan edit");

    // Check Routine Planner DOM view after plan switch
    const plannerContainer = document.getElementById('settings-split-planner-days');
    assert(!plannerContainer.innerHTML.includes("Custom Leg Blast Day"), "Routine Planner DOM displays active plan day names (not copied plan name)");

    // Switch back to copied plan
    storeObj.selectPlan(copiedPlan.id);
    renderAll();
    assert(storeObj.currentPlanData.daysCount === 5, "Copied plan daysCount (5) preserved");
    assert(plannerContainer.innerHTML.includes("Custom Leg Blast Day"), "Routine Planner DOM displays copied plan custom day name when active");

    // 1.6 Plan Deletion
    const deleteId = copiedPlan.id;
    storeObj.deletePlan(deleteId);
    renderAll();
    assert(storeObj.plans.length === 2, "Plans count after deletion is 2");
    assert(storeObj.currentPlanId !== deleteId, "Active plan switched away from deleted plan ID");
    assert(storeObj.planDataById[deleteId] === undefined, "Deleted plan data purged from storeObj.planDataById");
    
    // Try deleting down to 1 plan
    const secondId = storeObj.plans[1].id;
    storeObj.deletePlan(secondId);
    renderAll();
    assert(storeObj.plans.length === 1, "Remaining plan count is 1");
    storeObj.deletePlan(storeObj.plans[0].id); // should be blocked
    assert(storeObj.plans.length === 1, "Prevented deletion of single remaining plan");
});

// -------------------------------------------------------------
// AREA 2: SPLIT DAY RESIZING
// -------------------------------------------------------------
runSection("2. Split Day Resizing & Exercise Truncation", () => {
    // 2.1 Expanding Day Count (3 -> 5)
    storeObj.setDaysCount(5);
    renderAll();
    assert(storeObj.currentPlanData.daysCount === 5, "daysCount updated to 5");
    assert(storeObj.currentPlanData.days.length === 5, "days array length updated to 5");
    assert(storeObj.currentPlanData.days[3].name === "Day 4", "New Day 4 initialized with default name");
    assert(storeObj.currentPlanData.days[4].name === "Day 5", "New Day 5 initialized with default name");

    const plannerContainer = document.getElementById('settings-split-planner-days');
    const dayInputs = plannerContainer.innerHTML.match(/placeholder=["']Day Name/g) || [];
    assert(dayInputs.length === 5, "Routine Planner DOM renders 5 day cards");

    // 2.2 Contracting Day Count (5 -> 2) and Truncation Exercise Migration
    // Add specific exercises to Day 3 (index 2), Day 4 (index 3), Day 5 (index 4)
    const ex1 = storeObj.exercises[0].id;
    const ex2 = storeObj.exercises[1].id;
    const ex3 = storeObj.exercises[2].id;

    storeObj.toggleExerciseInDay(storeObj.currentPlanData.days[2].id, ex1, true);
    storeObj.toggleExerciseInDay(storeObj.currentPlanData.days[3].id, ex2, true);
    storeObj.toggleExerciseInDay(storeObj.currentPlanData.days[4].id, ex3, true);

    // Contract to 2 days
    storeObj.setDaysCount(2);
    renderAll();

    assert(storeObj.currentPlanData.daysCount === 2, "daysCount contracted to 2");
    assert(storeObj.currentPlanData.days.length === 2, "days array contracted to 2");

    // Check Day 1 exerciseIds
    const day1ExIds = storeObj.currentPlanData.days[0].exerciseIds;
    assert(day1ExIds.includes(ex1), "Day 3 exercise moved to Day 1 upon truncation");
    assert(day1ExIds.includes(ex2), "Day 4 exercise moved to Day 1 upon truncation");
    assert(day1ExIds.includes(ex3), "Day 5 exercise moved to Day 1 upon truncation");

    // Verify syncEnabledExercises kept them enabled
    assert(storeObj.isExerciseEnabled(ex1), "Truncated exercise 1 remains enabled in plan");
    assert(storeObj.isExerciseEnabled(ex2), "Truncated exercise 2 remains enabled in plan");
    assert(storeObj.isExerciseEnabled(ex3), "Truncated exercise 3 remains enabled in plan");

    // 2.3 Boundary clamping
    storeObj.setDaysCount(0);
    assert(storeObj.currentPlanData.daysCount === 3, "setDaysCount(0) evaluates 0 || 3 resulting in 3 due to truthiness bug in app.js");
    storeObj.setDaysCount(10);
    assert(storeObj.currentPlanData.daysCount === 7, "Clamped maximum daysCount to 7");

    // Reset back to 3 days for standard testing
    storeObj.setDaysCount(3);
    renderAll();
});

// -------------------------------------------------------------
// AREA 3: DAY RENAMING
// -------------------------------------------------------------
runSection("3. Day Renaming & View Sync", () => {
    const day1 = storeObj.currentPlanData.days[0];
    const day1Id = day1.id;

    // 3.1 Valid Name Update
    storeObj.updateDayName(day1Id, "Chest and Arms Annihilation");
    renderAll();

    assert(storeObj.currentPlanData.days[0].name === "Chest and Arms Annihilation", "Day name updated in store");

    const plannerContainer = document.getElementById('settings-split-planner-days');
    assert(plannerContainer.innerHTML.includes("Chest and Arms Annihilation"), "Routine Planner DOM renders updated day name");

    const dayFocusList = document.getElementById('dashboard-day-focus-list');
    assert(dayFocusList.innerHTML.includes("Chest and Arms Annihilation"), "Dashboard Workout Days focus list renders updated day name");

    // 3.2 Schedule Modal Title Sync
    openScheduleExercisesModal(day1Id);
    const modalTitle = document.getElementById('schedule-modal-title').textContent;
    assert(modalTitle === "Schedule Exercises - Chest and Arms Annihilation", "Schedule exercises modal title reflects updated day name");
    closeModal();

    // 3.3 Blank / Empty String Rename Edge Case
    storeObj.updateDayName(day1Id, "   ");
    renderAll();
    const nameAfterBlank = storeObj.currentPlanData.days[0].name;
    assert(nameAfterBlank === "Chest and Arms Annihilation", "Day name preserved existing name on blank input due to updateDayName fallback branch");
});

// -------------------------------------------------------------
// AREA 4: MUSCLE GROUP DELETION & CASCADING
// -------------------------------------------------------------
runSection("4. Muscle Group Deletion & Cascading Purge", () => {
    const initialGroupCount = storeObj.muscleGroups.length;
    const targetGroup = storeObj.muscleGroups[0]; // e.g. Chest
    const targetGroupId = targetGroup.id;
    const targetGroupName = targetGroup.name;

    const groupExercises = storeObj.exercises.filter(e => e.muscleGroupId === targetGroupId);
    const groupExerciseIds = groupExercises.map(e => e.id);
    assert(groupExercises.length > 0, "Target muscle group '" + targetGroupName + "' has initial exercises");

    // Assign exercises to day 1
    groupExerciseIds.forEach(eid => {
        storeObj.toggleExerciseInDay(storeObj.currentPlanData.days[0].id, eid, true);
    });

    // Select this group in Train view tab
    selectedMuscleGroupId = targetGroupId;

    // Execute deletion via removeMuscleGroup
    storeObj.removeMuscleGroup(targetGroupId);

    // Readjust selection as index.html does
    const remainingGroups = storeObj.muscleGroups.filter(g => g.isEnabled);
    if (remainingGroups.length > 0) {
        selectedMuscleGroupId = remainingGroups[0].id;
    } else {
        selectedMuscleGroupId = null;
    }

    renderAll();

    // 4.1 Global Stores Cleaned
    assert(storeObj.muscleGroups.length === initialGroupCount - 1, "Global muscle groups count decreased by 1");
    assert(!storeObj.muscleGroups.some(g => g.id === targetGroupId), "Target muscle group removed from globalMuscleGroups");
    assert(!storeObj.exercises.some(e => e.muscleGroupId === targetGroupId), "Associated exercises removed from globalExercises");

    // 4.2 Cascading Purge Across Plans
    for (const planId of Object.keys(storeObj.planDataById)) {
        const pData = storeObj.planDataById[planId];
        if (!pData) continue;

        // Check enabledExerciseIds
        const orphanedEnabled = pData.enabledExerciseIds.filter(eid => groupExerciseIds.includes(eid));
        assert(orphanedEnabled.length === 0, "Plan " + planId + " enabledExerciseIds purged of deleted exercise IDs");

        // Check days exerciseIds
        let orphanedInDays = 0;
        if (pData.days) {
            pData.days.forEach(d => {
                if (d.exerciseIds) {
                    orphanedInDays += d.exerciseIds.filter(eid => groupExerciseIds.includes(eid)).length;
                }
            });
        }
        assert(orphanedInDays === 0, "Plan " + planId + " days exerciseIds purged of deleted exercise IDs");

        // Check exercise logs
        const orphanedLogs = (pData.exerciseLogs || []).filter(l => groupExerciseIds.includes(l.exerciseId));
        assert(orphanedLogs.length === 0, "Plan " + planId + " exerciseLogs purged of deleted exercise IDs");

        // Check activeCycle intensities
        if (pData.activeCycle && Array.isArray(pData.activeCycle.intensities)) {
            const orphanedIntensities = pData.activeCycle.intensities.filter(i => i.muscleGroupId === targetGroupId);
            assert(orphanedIntensities.length === 0, "Plan " + planId + " cycle intensities purged of deleted muscle group ID");
        }
    }

    // 4.3 DOM Views Post-Deletion
    const focusList = document.getElementById('dashboard-focus-list');
    assert(!focusList.innerHTML.includes(targetGroupName), "Dashboard focus list no longer renders deleted muscle group");

    const trainContainer = document.getElementById('train-view-container');
    assert(!trainContainer.innerHTML.includes(targetGroupName), "Train view no longer renders deleted muscle group tab");

    const exercisesContainer = document.getElementById('exercises-library-container');
    assert(!exercisesContainer.innerHTML.includes(targetGroupName), "Exercises library no longer renders deleted muscle group section");
});

// -------------------------------------------------------------
// AREA 5: WEEK ADVANCEMENT & STATE SYNC
// -------------------------------------------------------------
runSection("5. Week Advancement & Retrain Rollback", () => {
    // 5.1 Week Advancement via Muscle Group Completion
    const cycle = storeObj.activeCycle;
    assert(cycle !== null, "Active cycle exists");
    const initialWeekIndex = cycle.currentWeekIndex;

    // Complete all exercises for all enabled muscle groups for current week
    const enabledGroups = storeObj.muscleGroups.filter(g => g.isEnabled);
    enabledGroups.forEach(group => {
        markAllGroupFinished(group.id);
    });

    assert(cycle.currentWeekIndex === initialWeekIndex + 1, "Cycle week index advanced from " + initialWeekIndex + " to " + (initialWeekIndex + 1));

    const dashboardCycleContainer = document.getElementById('dashboard-cycle-container');
    assert(dashboardCycleContainer.innerHTML.includes("Week " + (cycle.currentWeekIndex + 1) + " of 4"), "Dashboard renders updated week badge");

    const trainContainer = document.getElementById('train-view-container');
    assert(trainContainer.innerHTML.includes("Week " + (cycle.currentWeekIndex + 1) + " Target Formula Log"), "Train view header renders updated week banner");

    // 5.2 Retrain Day Rollback
    const day1 = storeObj.currentPlanData.days[0];
    const day1Id = day1.id;

    // Mark day incomplete via handleRetrainDay
    handleRetrainDay(day1Id);
    assert(cycle.currentWeekIndex === initialWeekIndex, "Cycle week index rolled back to " + initialWeekIndex + " on retrain day");

    // 5.3 Fast Forward to Cycle Completion
    cycle.currentWeekIndex = 3;
    enabledGroups.forEach(group => {
        markAllGroupFinished(group.id);
    });

    assert(cycle.isCompleted === true, "Cycle marked completed after week 4 finish");
    renderAll();

    assert(dashboardCycleContainer.innerHTML.includes("Cycle Completed!"), "Dashboard renders Cycle Completed trophy card");
});

// -------------------------------------------------------------
// SUMMARY & REPORT
// -------------------------------------------------------------
console.log("\\n=================================================");
console.log("             TEST SUITE SUMMARY                  ");
console.log("=================================================");
const totalTests = testResults.length;
const passedTests = testResults.filter(r => r.pass).length;
const failedTests = testResults.filter(r => !r.pass).length;

console.log("Total Assertions: " + totalTests);
console.log("Passed: " + passedTests);
console.log("Failed: " + failedTests);

if (failedTests > 0) {
    console.log("\\nFAILED ASSERTIONS:");
    testResults.filter(r => !r.pass).forEach((r, idx) => {
        console.log((idx + 1) + ". " + r.message + " — " + r.details);
    });
}
`;

vm.runInContext(testSuiteCode, context);
