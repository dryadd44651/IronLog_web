# Software Architect Review Report: IronLog Web

**Project Root:** `/Users/howard/.gemini/antigravity/scratch/IronLogWeb`  
**Review Scope:** Architectural Logic & Storage Review (Requirement R2)  
**Date:** July 31, 2026  
**Status:** Completed  

---

## Executive Summary

IronLog Web is a client-side Single Page Application (SPA) built with standard Vanilla HTML5, CSS3, and modern JavaScript (ES6+). The system uses browser `localStorage` under the key `ironlog_data_v4` to persist application data, user training plans, daily workout splits, periodization intensity matrix values, and exercise completion logs.

While the app provides a responsive UI and intuitive workout tracking features, this architectural review has identified critical vulnerabilities, structural anti-patterns, data corruption vectors, and performance bottlenecks:

1. **Storage Schema & Migration Flaws**: The application lacks an explicit schema versioning header inside stored JSON payload files. The auto-migration mechanism (`migrateDaysForPlan`) destructively overwrites custom split schedules if any day lacks assigned exercises. Furthermore, `exportToJSON()` and `saveData()` use incompatible data formats for dates and plan dictionaries.
2. **State Flow & Multi-Source-of-Truth Disconnects**: Global exercise enabled statuses conflict directly with split day exercise scheduling (`syncEnabledExercises`). Virtual log generation in `getLog()` produces unstable transient objects with random UUIDs until saved. DOM elements double as transient state stores.
3. **Severe Rendering & Serialization Inefficiencies**: Every user interaction (such as toggling a single set checkmark) triggers a full application DOM tear-down and re-build via `renderAll()`, accompanied by synchronous `JSON.stringify()` serialization of the entire multi-plan dataset to `localStorage`.
4. **Data Corruption & Cascading Reference Leaks**: Deleting a muscle group cleans up references *only* in the currently active plan, leaving orphan UUIDs in all other plans. Reducing split days count permanently discards day assignments. Dual advancement logic checks muscle groups rather than scheduled split days, breaking auto-advancement for custom routines.

---

## 1. Storage Schema Analysis (`ironlog_data_v4`)

### 1.1 Data Model Specification

The persistence store is managed by `AppStore` in `app.js`. The top-level root object stored under `localStorage.getItem("ironlog_data_v4")` exhibits the following shape:

```typescript
interface IronLogStorageV4 {
  plans: PlanHeader[];                     // Array of plan metadata headers
  currentPlanId: string | null;           // UUID of currently active plan
  globalMuscleGroups: MuscleGroup[];       // Shared muscle group registry
  globalExercises: Exercise[];             // Shared exercise definitions & PRs
  planDataById: Record<string, PlanData>;  // Dictionary mapping plan UUID -> PlanData
}

interface PlanHeader {
  id: string;   // UUID
  name: string; // Display name
}

interface MuscleGroup {
  id: string;        // UUID
  name: string;      // Name (e.g. "Chest")
  iconName: string;  // SF Symbol or Lucide icon key
  isEnabled: boolean;// Global enablement toggle
}

interface Exercise {
  id: string;             // UUID
  name: string;           // Exercise name
  muscleGroupId: string;  // Reference to MuscleGroup.id
  personalRecord: number; // 1-Rep Max in lbs
}

interface PlanData {
  enabledExerciseIds: string[]; // Enabled exercise UUIDs for this plan
  activeCycle: Cycle | null;    // Current 4-week periodization cycle
  exerciseLogs: ExerciseLog[];  // Historical set completion logs
  daysCount: number;            // Number of split days (1..7)
  days: DaySplit[];             // Daily workout split schedules
}

interface Cycle {
  id: string;                 // UUID
  name: string;               // Cycle name
  startDate: string | Date;   // ISO String in localStorage, Date in memory
  currentWeekIndex: number;   // Index 0..3 (Week 1 to Week 4)
  intensities: IntensityItem[];// Matrix of muscle group weekly intensities
  isCompleted: boolean;       // Completion status flag
}

interface IntensityItem {
  id: string;
  muscleGroupId: string;
  weekIndex: number;          // 0..3
  intensity: string;          // e.g. "Medium (Balanced)", "Heavy (Strength)", etc.
}

interface ExerciseLog {
  id: string;
  exerciseId: string;
  weekIndex: number;
  cycleId: string;
  sets: SetLog[];
  isCompleted: boolean;
}

interface SetLog {
  id: string;
  isCompleted: boolean;
}

interface DaySplit {
  id: string;
  name: string;               // e.g. "Day 1 (Chest, Biceps, Core)"
  exerciseIds: string[];      // List of assigned exercise UUIDs
}
```

### 1.2 Defaults & Initialization Logic
- If `localStorage` is empty (`app.js:78-96`), a default plan is generated:
  - `plans = [{ id: defaultPlanId, name: "Default Plan" }]`
  - Seed muscle groups (7 items: Chest, Back, Shoulders, Biceps, Triceps, Legs, Core) and seed exercises (21 items with default PR values) are populated (`seedInitialData()`, `app.js:223-279`).
  - An inaugural cycle `"Inaugural Strength Phase"` is instantiated.

### 1.3 Schema Evolution & Versioning Issues
1. **Hardcoded Key without Embedded Version Metadata**:
   - `this.saveKey = "ironlog_data_v4"` (`app.js:75`) is hardcoded. The stored JSON payload itself contains no `version: 4` metadata property.
   - If future updates introduce `v5`, the application will have no structural mechanism to inspect the stored payload version and perform incremental migrations.
2. **Destructive Auto-Migration Bug in Daily Splits**:
   - `migrateDaysForPlan(planId)` (`app.js:560-607`) contains the following condition:
     ```javascript
     const hasExercisesInDays = days.some(d => d.exerciseIds && d.exerciseIds.length > 0);
     if (!data.daysCount || days.length === 0 || !hasExercisesInDays) {
         data.daysCount = 3;
         // Overwrite data.days with default 3-day split assignments
     }
     ```
   - **Flaw**: If a user creates a customized split or clears exercise assignments for a plan (e.g. creating custom rest days or empty split templates), `hasExercisesInDays` evaluates to `false`. On app startup or plan switching, `migrateDaysForPlan()` executes, wiping out the user's custom day names and resetting `daysCount` back to 3 with default exercise assignments.

### 1.4 Export/Import Format Disparity
`exportToJSON()` (`app.js:917-943`) and `saveData()` (`app.js:989-998`) write data in incompatible formats:
- **`saveData()`** writes `planDataById` as a JSON Object: `{"<planId>": { ... }}` and leaves `startDate` as standard `Date` / ISO string.
- **`exportToJSON()`** converts `planDataById` into a flat key-value Array: `["<planId>", { ... }, "<planId2>", { ... }]`. In addition, it converts `activeCycle.startDate` into Apple Reference Seconds (`(date.getTime() - 978307200000) / 1000`).
- **Impact**: Importing raw `localStorage` dumps directly via `importFromJSON()` fails or produces invalid date objects because `importFromJSON()` expects Apple epoch offsets if `typeof startDate === 'number'`. If an ISO string is passed, date parsing is skipped in `importFromJSON()`, leading to runtime errors during subsequent exports when `instanceof Date` checks fail (`app.js:921`).

---

## 2. State Flow & Architectural Evaluation

### 2.1 Central Store vs DOM State Coupling
The application uses an instance of `AppStore` (`storeObj`) as a central state manager. However, state flow is not strictly unidirectional:
1. **DOM as Primary Source of Truth**:
   - Form inputs, modal input fields, selected dropdown values (`settings-split-days`, `#header-plan-select`, `#input-exercise-name`, `#schedule-exercises-list input[type=checkbox]`) hold transient UI state outside `AppStore`.
   - Modals collect DOM values and pass them directly to mutation methods (`submitAddExercise`, `submitScheduleExercises`).
2. **Global Script Variables**:
   - Variables in `<script>` (`index.html:310-313`): `currentTab`, `selectedMuscleGroupId`, `exerciseSearchText`, `expandedDayIds`, `isPlannerInitialized`.
   - These global variables are not synchronized with `AppStore`. For instance, `expandedDayIds` retains deleted day UUIDs indefinitely when plans are switched or days are removed.

### 2.2 Conflicting Sources of Truth
- **Exercise Enablement Contradiction**:
  - In `AppStore`, exercise enablement can be toggled manually in the Exercise Library via `setExerciseEnabled(exerciseId, isEnabled)` (`app.js:173`).
  - However, scheduling exercises in Routine Planner calls `syncEnabledExercises()` (`app.js:542-552`), which overwrites `data.enabledExerciseIds` with all exercise IDs found in `data.days[].exerciseIds`.
  - **Conflict**: If a user enables an exercise in Exercise Library without assigning it to a split day, calling any Routine Planner function (such as `setDaysCount` or `setDayExercises`) immediately strips that exercise from `enabledExerciseIds`. Conversely, disabling an exercise in Exercise Library removes it from `days[].exerciseIds` (`app.js:183-187`), but `syncEnabledExercises()` then recalculates the list, leading to erratic state synchronization.

### 2.3 Virtual Log Instantiation & Lazy Object Allocation
- `getLog(exercise, weekIndex)` (`app.js:325-348`) returns an existing log object if found in `exerciseLogs`.
- If no log exists, it creates and returns a virtual lazy log object with fresh `crypto.randomUUID()` values for the log and sets.
- **Flaw**: Because the virtual log is not pushed into `exerciseLogs` until `updateLog()` is called, calling `getLog()` multiple times for an uncompleted exercise generates different object instances with different UUIDs, breaking reference equality checks.

### 2.4 State Persistence Synchronization & Save Timing
- `saveData()` (`app.js:989`) performs a synchronous `localStorage.setItem()` call.
- Every state mutation method in `AppStore` (`setIntensity`, `updateLog`, `setDaysCount`, `setDayExercises`, `addMuscleGroup`, `removeMuscleGroup`, `addExercise`, `deleteExercise`, `createPlan`, `copyPlan`, `selectPlan`, `renamePlan`, `deletePlan`) explicitly invokes `this.saveData()`.
- **Performance Impact**: Toggling a single set checkmark triggers synchronous JSON serialization of the full multi-plan state tree and a disk write to `localStorage`. There is no request-batching, debouncing, or asynchronous persistence pipeline.

---

## 3. Inefficiencies & Redundancies

### 3.1 Full-Tree Re-rendering Strategy (`renderAll()`)
Whenever any state change occurs in the application, `renderAll()` (`index.html:342-350`) is called:
```javascript
function renderAll() {
    renderHeader();
    renderDashboard();
    renderTrain();
    renderRoutinePlanner();
    renderExercises();
    renderSettings();
    lucide.createIcons();
}
```
- **Execution Overhead**:
  - `renderAll()` destroys and rebuilds the `innerHTML` of all 5 view containers (`#view-dashboard`, `#view-train`, `#view-routine`, `#view-exercises`, `#view-settings`) simultaneously, regardless of which tab is currently active.
  - Toggling a set checkmark in Train tab causes complete DOM re-parsing and re-rendering of Settings, Dashboard, Exercise Library, and Routine Planner.

### 3.2 Lucide Icon Re-initialization Overhead
- At the end of `renderAll()`, `lucide.createIcons()` scans the entire DOM body for `[data-lucide]` attributes and dynamically injects SVG elements.
- Re-executing DOM traversal and SVG parsing across hundreds of elements on every micro-click creates garbage collection pressure and noticeable frame drops on mobile browsers.

### 3.3 Event Handler Lifecycle & Race Conditions
- All view rendering functions generate HTML strings containing inline event handler attributes (`onclick="..."`, `onblur="..."`, `oninput="..."`).
- **Race Condition in Routine Planner**:
  - `onblur="handleDayRename('${day.id}', this.value)"` (`index.html:934`) triggers when input focus is lost.
  - If a user clicks an "Expand / Collapse" button (`onclick="toggleExpandDay('${day.id}')"`) while editing a day name, both `onblur` and `onclick` fire in quick succession. Each handler invokes `renderAll()`, causing duplicate DOM teardowns within milliseconds.

### 3.4 Serialization Overhead
- `saveData()` serializes all plans, all muscle groups, all exercises, and all historical set logs into a single string.
- As workout log history grows over months of usage, `localStorage.setItem()` payload size scales linearly, compounding the frame latency of every user interaction.

### 3.5 Memory Leak & Heap Growth Vectors
1. **Accumulation in `expandedDayIds`**:
   - `expandedDayIds` (`index.html:799`) is a global `Set` holding expanded day UUIDs. When a plan or day is deleted, its UUID remains in `expandedDayIds` indefinitely.
2. **Uncollected Intensity Objects**:
   - `addMuscleGroup()` (`app.js:648-669`) appends 4 intensity items to `activeCycle.intensities`. If a muscle group is removed via `removeMuscleGroup()`, intensity cleanup occurs only in `currentPlanData`. Inactive plans retain orphan intensity records in their `activeCycle.intensities` arrays.

---

## 4. Data Corruption & Edge Case Risks

### 4.1 Missing Input Validation on Load & Import
- `loadData()` (`app.js:1000-1026`) uses a basic `try...catch` block. It reads data from `localStorage` without verifying property types or array structures.
- `importFromJSON()` (`app.js:945-987`) checks only for the presence of `plans`, `globalMuscleGroups`, and `globalExercises`. It fails to validate:
  - Non-numeric or negative values for `personalRecord`.
  - Corrupt or missing UUID strings.
  - Unexpected or malformed data types in `planDataById`.
  - If `planDataById` in the imported JSON is a flat array with an odd number of items, `importFromJSON` assigns `undefined` values as plan data objects, crashing the application upon subsequent access.

### 4.2 Cascading Reference Integrity Violations

#### A. Muscle Group Deletion Cleanup Bug
`removeMuscleGroup(id)` (`app.js:671-690`) executes the following code:
```javascript
removeMuscleGroup(id) {
    this.muscleGroups = this.muscleGroups.filter(g => g.id !== id);
    const toRemoveExercises = this.exercises.filter(e => e.muscleGroupId === id);
    const toRemoveExerciseIds = toRemoveExercises.map(e => e.id);
    this.exercises = this.exercises.filter(e => e.muscleGroupId !== id);

    this.updateCurrentPlanData(data => {
        data.exerciseLogs = (data.exerciseLogs || []).filter(l => !toRemoveExerciseIds.includes(l.exerciseId));
        data.enabledExerciseIds = (data.enabledExerciseIds || []).filter(eid => !toRemoveExerciseIds.includes(eid));
        if (data.activeCycle) {
            data.activeCycle.intensities = data.activeCycle.intensities.filter(i => i.muscleGroupId !== id);
        }
        if (data.days) {
            data.days.forEach(d => {
                d.exerciseIds = d.exerciseIds.filter(id => !toRemoveExerciseIds.includes(id));
            });
        }
    });
    this.checkAndAdvanceWeek();
}
```
- **CRITICAL BUG**: `this.updateCurrentPlanData(...)` updates **ONLY** the currently active plan.
- **Consequence**: All other plans stored in `this.planDataById` retain dangling exercise IDs in `enabledExerciseIds`, dangling exercise logs in `exerciseLogs`, dangling day assignments in `days[].exerciseIds`, and dangling intensity objects in `activeCycle.intensities`. When the user switches to another plan, rendering crashes or displays blank missing entries.

#### B. Exercise Deletion Partial Cleanup
`deleteExercise(exerciseId)` (`app.js:726-741`) iterates over `this.plans` to clean up exercise references. However:
- If a plan exists in `this.plans` but has not yet had its entry created in `this.planDataById`, it is skipped.
- Historical logs referencing `exerciseId` in archived or completed cycles are not removed, leaving orphan logs whose `exerciseId` points to non-existent global exercises.

### 4.3 Split Count Resizing & Destructive Data Loss
`setDaysCount(count)` (`app.js:414-454`) adjusts the number of workout days in the current split:
- When `count` is decreased (e.g. from 5 days to 3 days), days beyond `count` are sliced off: `data.days = data.days.slice(0, count)`.
- Exercises from truncated days are extracted (`exercisesToMove`) and pushed into `Day 1`.
- **Data Loss Risk**:
  - The custom names and day structure of truncated days are permanently destroyed.
  - If `Day 1` already contains an exercise from a truncated day, the duplicate check (`!day1.exerciseIds.includes(id)`) suppresses the move, silently dropping the exercise assignment altogether.
  - Increasing the split count back to 5 generates empty default days ("Day 4", "Day 5"); original configurations cannot be restored.

### 4.4 Dual Progress Tracking & Advancement Disconnect
The application maintains two parallel concepts of workout structure:
1. **Muscle Group Focus** (Periodization model: Chest, Back, Legs, etc.)
2. **Workout Split Focus** (Daily routine model: Day 1 Push, Day 2 Pull, Day 3 Legs)

- `checkAndAdvanceWeek()` (`app.js:384-400`) evaluates week completion using **muscle groups only**:
  ```javascript
  const enabledGroups = this.muscleGroups.filter(g => g.isEnabled);
  const allDone = enabledGroups.every(g => this.isMuscleGroupCompleted(g.id, cycle.currentWeekIndex));
  ```
- **Logic Disconnect**: Users complete workouts by clicking "Finish Day" in the Routine Planner (`markDayExercisesCompleted(dayId)`). However, if an enabled muscle group contains exercises that are NOT assigned to any split day in Routine Planner, `isMuscleGroupCompleted` returns `false`.
- **Result**: The user completes all scheduled workout days in Routine Planner, but the cycle fails to advance to the next week because unassigned exercises in enabled muscle groups remain incomplete.

---

## 5. Architectural Recommendations & Remediation Plan

To address these vulnerabilities, the following architectural refactoring plan is recommended for implementation in Milestone 3 (R3):

### 5.1 Storage & Schema Standardization
1. **Embed Version Header**: Wrap stored payload in a versioned envelope:
   ```json
   {
     "version": 4,
     "timestamp": "2026-07-31T19:49:21Z",
     "payload": { ... }
   }
   ```
2. **Safe Migration Guards**: Modify `migrateDaysForPlan()` to check for explicit unitialized plan state rather than `!hasExercisesInDays`, preventing accidental overwrites of user-cleared split days.
3. **Unify Export Format**: Align `exportToJSON()` to output standard ISO 8601 strings and standard JSON objects for `planDataById`, eliminating Apple Epoch conversions.

### 5.2 State Management & Reactive UI
1. **Selective Tab Rendering**: Refactor `renderAll()` to re-render *only* the active tab container (`views[currentTab]`) instead of tearing down all 5 tabs on every interaction.
2. **Debounced Persistence Pipeline**: Implement a debounced save mechanism (`saveDataThrottled`) with a 300ms timer to batch multiple rapid state updates into a single `localStorage.setItem()` call.
3. **Single Source of Truth**: Eliminate conflict between `setExerciseEnabled` and `syncEnabledExercises`. Derive `enabledExerciseIds` dynamically or maintain explicit sync flags.

### 5.3 Referential Integrity Enforcement
1. **Global Cascade on Deletion**: Update `removeMuscleGroup(id)` to iterate over *all* entries in `this.planDataById` (not just `currentPlanData`), purging exercise IDs, logs, intensities, and day assignments across every plan.
2. **Orphan Log Purging**: Ensure `deleteExercise()` purges all exercise logs across all historical cycles.

### 5.4 Unified Advancement Logic
1. **Split-Aware Week Advancement**: Update `checkAndAdvanceWeek()` to check completion status based on scheduled split days in `currentPlanData.days` when split mode is active.

---

**Report Prepared By:** Software Architect Reviewer  
**Status:** Approved for Handoff  
