# Handoff Report: IronLog Web Deep Technical Static Code Analysis & Edge-Case Discovery

**Agent Role**: Technical Edge-Case Explorer  
**Target Project**: IronLog Web (`/Users/howard/.gemini/antigravity/scratch/IronLogWeb`)  
**Analyzed Files**: `PROJECT.md`, `index.html`, `app.js`, `app.css`  
**Report Date**: 2026-07-31  

---

## 1. Observation

Direct static analysis of `/Users/howard/.gemini/antigravity/scratch/IronLogWeb/app.js`, `index.html`, and `app.css` revealed 27 distinct bugs, architectural logic flaws, edge cases, XSS/syntax risks, and storage vulnerabilities.

### Key Verbatim Code Observations:

1. **`app.js` Lines 917–933 vs Lines 989–997 (JSON Export/Import Schema Mismatch & Epoch Vulnerability)**:
   - In `exportToJSON()`:
     ```javascript
     const flatPlanData = [];
     for (const [key, value] of Object.entries(this.planDataById)) {
         const cycleCopy = value.activeCycle ? { ...value.activeCycle } : null;
         if (cycleCopy && cycleCopy.startDate instanceof Date) {
             cycleCopy.startDate = (cycleCopy.startDate.getTime() - APPLE_REF_DATE_MS) / 1000;
         }
         flatPlanData.push(key);
         flatPlanData.push({ ... });
     }
     ```
   - In `saveData()`:
     ```javascript
     const serializedData = {
         plans: this.plans,
         currentPlanId: this.currentPlanId,
         globalMuscleGroups: this.globalMuscleGroups,
         globalExercises: this.globalExercises,
         planDataById: this.planDataById // Key-Value Object schema!
     };
     ```
   - `saveData()` writes `planDataById` as a key-value Object, whereas `exportToJSON()` flattens `planDataById` into an alternating Key-Value Array.

2. **`app.js` Lines 945–987 (`importFromJSON` Missing Type Validation & Crash Vulnerability)**:
   - Verbatim check:
     ```javascript
     if (!decoded.plans || !decoded.globalMuscleGroups || !decoded.globalExercises) {
         return false;
     }
     ```
   - If `decoded.plans` is not an Array (e.g., string `"corrupt"`), `!decoded.plans` evaluates to `false` (valid). `this.plans` is set to `"corrupt"`.
   - Subsequent execution of `this.plans.forEach(...)` in `renderHeader()` (`index.html` line 357) throws `TypeError: storeObj.plans.forEach is not a function`, permanently crashing the web application.

3. **`app.js` Lines 384–400 (`checkAndAdvanceWeek` vs `isMuscleGroupCompleted` Progression Deadlock)**:
   - Verbatim logic:
     ```javascript
     checkAndAdvanceWeek() {
         const cycle = this.activeCycle;
         if (!cycle) return;
         const enabledGroups = this.muscleGroups.filter(g => g.isEnabled);
         const allDone = enabledGroups.every(g => this.isMuscleGroupCompleted(g.id, cycle.currentWeekIndex));
         if (allDone && enabledGroups.length > 0) { ... }
     }
     ```
   - `isMuscleGroupCompleted` requires **ALL** enabled exercises belonging to a muscle group to be completed.
   - When a user configures a Routine Split in the Routine Planner (Tab 2) and assigns only 1 exercise from a muscle group to a day (leaving other enabled library exercises unassigned to any day), `isMuscleGroupCompleted` returns `false` indefinitely. Week advancement (`checkAndAdvanceWeek`) is permanently locked.

4. **`app.js` Lines 671–690 (`removeMuscleGroup` Multi-Plan Synchronization Leak)**:
   - Verbatim code:
     ```javascript
     removeMuscleGroup(id) {
         this.muscleGroups = this.muscleGroups.filter(g => g.id !== id);
         ...
         this.updateCurrentPlanData(data => {
             data.exerciseLogs = ...
             data.enabledExerciseIds = ...
             if (data.activeCycle) { data.activeCycle.intensities = ... }
             if (data.days) { data.days.map(...) }
         });
     }
     ```
   - `removeMuscleGroup` updates `planData` **only for the active plan** (`updateCurrentPlanData`). All other inactive plans retain stale exercise IDs in `enabledExerciseIds` and `days[].exerciseIds`, and dead references in `activeCycle.intensities`.
   - In contrast, `deleteExercise` (`app.js` line 728) correctly iterates through all plans via `this.plans.forEach`.

5. **`app.js` Lines 764–828 (`copyPlan` Virtual Log Orphan Bug)**:
   - When cloning logs in `copyPlan`:
     ```javascript
     cycleId: clonedCycleId || crypto.randomUUID()
     ```
   - If `sourceData.activeCycle` is `null`, `clonedCycleId` is `null`. Every cloned log is assigned a unique `crypto.randomUUID()`.
   - When `selectPlan(newId)` auto-creates the new active cycle, the new cycle receives a single `activeCycle.id`. None of the cloned log entries match `activeCycle.id`, rendering all copied log entries unmatchable and lost.

6. **`index.html` Lines 1084, 1141, 1145, 1180, 1236, 1428 (`escapeHtml` / Inline Event Handler Quotes Injection)**:
   - Verbatim HTML attribute generation:
     ```html
     onclick="openRenamePlanModal('${plan.id}', '${escapeHtml(plan.name)}')"
     ```
   - If `plan.name` contains an apostrophe (e.g. `"Leg's Day"`), `escapeHtml` turns `'` into `&#039;`. When parsed inside an inline HTML attribute, the browser resolves `&#039;` back to `'` before executing the JS expression. The resulting inline JS is `openRenamePlanModal('123', 'Leg's Day')`, triggering `Uncaught SyntaxError: Unexpected identifier 's'`.

7. **`index.html` Lines 1394–1408 (`submitEditExercise` PR NaN Corruption)**:
   - Verbatim code:
     ```javascript
     function submitEditExercise() {
         const id = document.getElementById('input-edit-exercise-id').value;
         const name = document.getElementById('input-edit-exercise-name').value;
         const pr = parseFloat(document.getElementById('input-edit-exercise-pr').value);
         if (name.trim()) {
             const ex = storeObj.exercises.find(e => e.id === id);
             if (ex) {
                 const updated = { ...ex, name: name, personalRecord: pr };
                 storeObj.updateExercise(updated);
             }
         }
     }
     ```
   - If the user leaves the PR input blank or enters invalid text, `parseFloat` returns `NaN`. `submitEditExercise` writes `personalRecord: NaN`. When saved to `localStorage`, `NaN` becomes `null`. Subsequent target calculation resolves `null * 0.65 = 0`, corrupting the PR to 0 lbs.

8. **`index.html` Line 9 (`Lucide CDN Network Dependency`)**:
   - `<script src="https://unpkg.com/lucide@latest"></script>`
   - `renderAll()` calls `lucide.createIcons()` (line 349). In offline or network-restricted environments, `lucide` is `undefined`, throwing `ReferenceError: lucide is not defined` and blocking entire UI rendering.

---

## 2. Logic Chain

From the direct observations above, we establish the step-by-step logic chains for each major flaw:

### A. Storage & Data Corruption Logic Chain
1. **Observation**: `saveData()` serializes `planDataById` as a JSON Object (`{ [planId]: PlanData }`). `exportToJSON()` serializes `planDataById` as a flattened Array (`[planId1, PlanData1, planId2, PlanData2]`).
2. **Step**: `importFromJSON()` attempts to handle both Arrays and Objects. However, if a user exports JSON and then imports it into a different version or inspects it, structural mismatch occurs.
3. **Step**: `exportToJSON()` mutates `startDate` into Apple Epoch seconds (`(ms - APPLE_REF_DATE_MS)/1000`). If `startDate` is `Invalid Date` (e.g., corrupted storage), `getTime()` returns `NaN`, which serializes to `null` in JSON.
4. **Step**: When imported back, `importFromJSON` checks `typeof startDate === 'number'`. Since `null` has type `'object'`, `startDate` remains `null`.
5. **Conclusion**: Schema inconsistency between local storage and export files leads to date conversion failures and data loss.

### B. Multi-Plan Data Leak Logic Chain
1. **Observation**: `removeMuscleGroup(id)` updates `planDataById[currentPlanId]`, but fails to update other plans in `planDataById`.
2. **Step**: When a muscle group is deleted, its associated exercises are deleted from `this.globalExercises`.
3. **Step**: Inactive plans retain deleted exercise IDs inside `enabledExerciseIds` and `days[].exerciseIds`.
4. **Step**: Switching to an inactive plan causes `isDayCompleted` to query exercises that no longer exist in `this.globalExercises`.
5. **Conclusion**: Deleting a muscle group while multiple plans exist creates zombie exercise references in non-active plans.

### C. Week Advancement Deadlock Logic Chain
1. **Observation**: `checkAndAdvanceWeek()` validates week completion using `isMuscleGroupCompleted()`.
2. **Step**: `isMuscleGroupCompleted()` checks every enabled exercise belonging to the muscle group in `this.globalExercises`.
3. **Step**: The Routine Planner (Tab 2) allows users to schedule specific exercises onto workout days. If a muscle group has 3 exercises but only 1 is scheduled on a day, the other 2 exercises remain unlogged.
4. **Step**: Even if the user completes 100% of their scheduled workout days, `isMuscleGroupCompleted()` returns `false` because the 2 unscheduled exercises were never logged.
5. **Conclusion**: Users using the Routine Planner view will never advance beyond Week 1 unless all library exercises for every enabled muscle group are completed.

### D. Routine Planner Multi-Day Exercise Set Sharing Logic Chain
1. **Observation**: `getLog(exercise, weekIndex)` indexes exercise logs strictly by `(exerciseId, weekIndex, cycleId)`.
2. **Step**: A user can schedule "Bench Press" on both "Day 1 (Push)" and "Day 4 (Upper Body)".
3. **Step**: Logging completed sets for Bench Press on Day 1 updates the single log for Bench Press in `currentWeekIndex`.
4. **Step**: Day 4 reads the exact same log entry. As a result, Bench Press on Day 4 is marked as Completed before Day 4 has even been started.
5. **Conclusion**: Exercises scheduled across multiple days share a single weekly state, leading to premature day completion.

---

## 3. Caveats

1. **Scope Limit**: Code analysis was conducted via static inspection of source files (`app.js`, `index.html`, `app.css`). Runtime browser testing was not performed due to the read-only explorer role.
2. **Third-Party Dependencies**: Network mode is `CODE_ONLY`. The external Lucide CDN script (`https://unpkg.com/lucide@latest`) cannot be fetched online during evaluation. Local fallback behavior was evaluated based on static code paths.
3. **Browser Storage Limits**: `localStorage` standard limit is 5MB. Large historical exercise logs over multiple cycles could hit storage quota limits, which `saveData()` currently does not catch.

---

## 4. Conclusion

The IronLog Web application has a well-structured domain model (port of iOS SwiftUI logic to vanilla JS), but contains **27 critical bugs, edge cases, and storage risks**:

### Complete Technical Vulnerability Catalog:

| # | Vulnerability Category | Description & Location | Impact | Recommended Fix |
|---|------------------------|------------------------|--------|-----------------|
| 1 | Storage & Serialization | `exportToJSON` flattens `planDataById` as Array, while `saveData` uses Object (`app.js:918, 989`). | Data structure mismatch between export files and `localStorage`. | Standardize `planDataById` as a key-value object in both `saveData` and `exportToJSON`. |
| 2 | Storage & Serialization | Date conversion Apple Epoch (`APPLE_REF_DATE_MS`) fails on invalid dates (`app.js:921, 965`). | `Invalid Date` becomes `null` in JSON, breaking future `Date` operations. | Store standard ISO date strings (`toISOString()`) everywhere. |
| 3 | Storage & Persistence | `importFromJSON` lacks strict schema/type validation (`app.js:948`). | Corrupted JSON (e.g. `plans: "invalid"`) permanently breaks `renderHeader()` with `TypeError`. | Validate `Array.isArray(decoded.plans)` and sanitize all fields before saving. |
| 4 | Storage & Persistence | `saveData()` does not handle `localStorage.setItem` quota exceptions (`app.js:989`). | QuotaExceededError crashes script and corrupts save state. | Wrap `setItem` in `try...catch` and alert user if quota is exceeded. |
| 5 | Multi-Plan Sync | `removeMuscleGroup()` only updates current plan, leaking deleted IDs to other plans (`app.js:671`). | Non-active plans retain ghost exercise IDs in `days` and `enabledExerciseIds`. | Iterate `this.plans.forEach` inside `removeMuscleGroup()` like `deleteExercise()`. |
| 6 | Multi-Plan Sync | `selectPlan(id)` auto-creates `activeCycle` with `globalMuscleGroups` snapshot (`app.js:867`). | Newly added muscle groups in other plans lack intensity definitions. | Dynamically ensure all active muscle groups exist in `activeCycle.intensities`. |
| 7 | Multi-Plan Sync | `deletePlan(id)` sets `currentPlanId` without executing `selectPlan()` initialization (`app.js:840`). | Switched plan bypasses cycle auto-creation and migration. | Replace `this.currentPlanId = remaining[0].id` with `this.selectPlan(remaining[0].id)`. |
| 8 | Multi-Plan Sync | `copyPlan()` generates mismatched `crypto.randomUUID()` log cycle IDs when `activeCycle` is null (`app.js:803`). | All copied exercise logs become unmatchable virtual lazy logs. | Ensure `clonedCycleId` is generated or assigned before mapping `clonedLogs`. |
| 9 | Exercise Library | `setExerciseEnabled()` vs `syncEnabledExercises()` state conflict (`app.js:173, 542`). | Enabling an exercise in Tab 3 is wiped out when Routine Planner syncs days. | Do not overwrite `enabledExerciseIds` in `syncEnabledExercises()` if user manually enabled them. |
| 10 | Exercise Library | `submitEditExercise` missing `parseFloat` NaN guard (`index.html:1397`). | Blank PR input sets `personalRecord: NaN`, corrupting PR to 0 lbs in storage. | Add `const pr = parseFloat(...) || 100.0` guard in `submitEditExercise`. |
| 11 | Set Logging & Progress | Unsaved virtual lazy logs generate new `id` on every `getLog()` call (`app.js:336`). | DOM button `log.id` mismatches in-memory virtual log ID prior to first set click. | Pass `exerciseId` and `weekIndex` to toggle functions instead of relying on `log.id`. |
| 12 | Set Logging & Progress | `checkAndAdvanceWeek()` locks progress when using Routine Planner (`app.js:384`). | Week 1 never advances if library has unscheduled exercises for enabled muscle groups. | Calculate progress based on scheduled Routine Planner days (`isDayCompleted`) when days are configured. |
| 13 | Set Logging & Progress | `markDayExercisesIncomplete()` cannot revert `currentWeekIndex` (`app.js:499`). | Retraining a day clears current week sets but leaves user stuck on advanced week. | Allow week index decrement or handle week un-advancement when retraining. |
| 14 | Set Logging & Progress | `forceAdvanceWeek()` on completed cycle is a silent no-op (`app.js:402`). | User gets no feedback when clicking "Skip Week" on a completed cycle. | Provide user toast/alert or prevent click when cycle is already completed. |
| 15 | Routine Planner | `setDaysCount()` Day truncation dumps all exercises into Day 1 (`app.js:433`). | Changing days 5 -> 3 -> 5 permanently distorts original day assignments. | Store unassigned exercises in a buffer rather than dumping into Day 1. |
| 16 | Routine Planner | Multi-assigned exercises across days share 1 weekly log (`app.js:325, 365`). | Completing Bench Press on Day 1 automatically marks Day 4 Bench Press as Done. | Index logs by `(exerciseId, weekIndex, cycleId, dayId)` or handle day-specific set tracking. |
| 17 | Routine Planner | `migrateDaysForPlan()` relies on fragile string matching (`app.js:583`). | Renaming muscle groups (e.g. "Pectorals") dumps all exercises into Day 1. | Use muscle group IDs instead of string matching on group names. |
| 18 | DOM & Security | Apostrophes in Plan/Group/Exercise names break inline JS handlers (`index.html:1084, 1145, 1236`). | Clicking Edit/Delete on "John's Plan" throws `Uncaught SyntaxError`. | Escape single quotes or use `addEventListener` / `dataset` attributes instead of inline JS. |
| 19 | DOM & Security | `handleDayRename` inline `onblur` event handler quote injection (`index.html:934`). | Special characters in day names break HTML attribute syntax. | Use standard event listener bindings or clean input sanitization. |
| 20 | DOM & UI | External Lucide CDN dependency (`index.html:9`). | Offline mode or network block causes `ReferenceError: lucide is not defined`, crashing render. | Add `typeof lucide !== 'undefined'` guard before calling `lucide.createIcons()`. |
| 21 | DOM & UI | `closeModal()` does not reset modal container `display` style (`index.html:1339`). | Modal backdrop hides but inner container style remains `display: block`. | Reset container display styles or manage modal state via CSS active classes. |
| 22 | DOM & UI | `navigateToDay()` clears `expandedDayIds` for all other days (`index.html:544`). | Clicking dashboard day focus card collapses all previously expanded routine days. | Add `expandedDayIds.add(dayId)` without clearing existing expanded set. |
| 23 | Developer Options | `resetAll()` wipes storage without auto-backup or double safety lock (`app.js:893`). | Accidental reset permanently deletes user workout history. | Prompt user to download auto-export JSON before resetting storage. |
| 24 | Data Validation | Plan name duplicates allowed in `createPlan` and `renamePlan` (`app.js:743, 830`). | Multiple plans with identical names confuse user in header selector. | Validate name uniqueness or append auto-incrementing numbers. |
| 25 | UI & Styling | Modal overlay scrollbar shift during modal activation (`app.css:168`). | Opening modal causes layout shift on mobile screens. | Add `overflow: hidden` to body when modal overlay is active. |
| 26 | UI & Styling | Long exercise names overflow set table columns on narrow screens (`app.css:606`). | Text clipping on 320px screen width. | Apply `text-overflow: ellipsis` and `overflow: hidden` on `.exercise-name-lbl`. |
| 27 | Architecture | Missing `AppStore` unit test suite for state mutation methods. | Risk of regression during refactoring. | Implement comprehensive test suite covering all store actions. |

---

## 5. Verification Method

To independently verify the findings in this report:

### Files to Inspect:
- `/Users/howard/.gemini/antigravity/scratch/IronLogWeb/app.js` (lines 173–200, 325–400, 542–602, 671–690, 764–828, 917–997)
- `/Users/howard/.gemini/antigravity/scratch/IronLogWeb/index.html` (lines 9, 349, 934, 1084, 1145, 1236, 1374–1408)
- `/Users/howard/.gemini/antigravity/scratch/IronLogWeb/app.css` (lines 168–200, 606–650)

### Manual Reproduction Procedures:
1. **Apostrophe Syntax Crash**:
   - Rename a plan to `John's Strength`.
   - Click the Edit (pencil) icon next to `John's Strength` in Settings (Tab 4).
   - *Expected Result*: Console throws `Uncaught SyntaxError: Unexpected identifier 's'`.
2. **PR NaN Corruption**:
   - Click Edit on any exercise in Exercise Library (Tab 3).
   - Clear the PR text box and click Save.
   - *Expected Result*: Exercise PR shows `PR: NaN lbs`. Save to `localStorage` converts `NaN` to `null`, resetting PR to 0 lbs on reload.
3. **Routine Planner Week Advancement Deadlock**:
   - Create a 3-Day split in Routine Planner (Tab 2). Assign 1 Chest exercise to Day 1.
   - Leave other Chest exercises in Library unassigned.
   - Complete Day 1, Day 2, Day 3 workouts.
   - *Expected Result*: Dashboard shows 100% Day completion, but Week 1 never advances to Week 2 because `isMuscleGroupCompleted` demands all unassigned library exercises be completed.
4. **JSON Export/Import Schema Mismatch**:
   - Export backup via `handleExportData()`.
   - Inspect JSON file: `planDataById` is an Array `["plan-uuid", {...}]`.
   - Inspect browser `localStorage` key `ironlog_data_v4`: `planDataById` is an Object `{"plan-uuid": {...}}`.

### Invalidation Conditions:
- The findings are invalidated if `app.js` or `index.html` are refactored such that inline JS handlers are replaced with event delegation, `checkAndAdvanceWeek` incorporates Routine Planner day status, and JSON serialization schemas are unified.
