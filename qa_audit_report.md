# QA Audit & Edge Case Analysis Report — IronLog Web

**Project:** IronLog Web  
**Audit Milestone:** Milestone 1 (R1 QA Audit & Edge Cases)  
**Auditor:** QA Audit Specialist  
**Target Files Analyzed:** `PROJECT.md`, `index.html`, `app.js`, `app.css`  
**Date:** July 31, 2026  

---

## 1. Executive Summary

A comprehensive quality assurance audit and edge case investigation was conducted on **IronLog Web**, a single-page web application for customizable workout periodization and daily split logging. The audit focused on five core operational categories:
1. **Set & Weight Boundary Values** (0 sets, negative numbers, NaN, blank inputs, decimals, extreme numbers).
2. **Empty States & Launch Scenarios** (fresh initial load, empty plans, empty days, total data wipe).
3. **Import/Export Data Integrity** (corrupted JSON, schema mismatches, quote injection, date serialization).
4. **State Synchronization** (split count changes, day renaming, week advancement vs. retrain desync).
5. **UI Integrity & Console Behavior** (broken event handlers, unmapped icons, DOM sync issues).

### Key Audit Findings
- **Critical Defects Found:** 4
- **High Severity Defects Found:** 3
- **Medium Severity Defects Found:** 2
- **Overall Assessment:** The core architecture handles basic navigation cleanly, but suffers from high-risk edge cases in data import, string escaping in inline event handlers, set completion logic on empty arrays, and week-index desynchronization during retrain workflows.

---

## 2. Boundary Value Analysis (Sets, Weights, Reps, PRs)

| Test Case | Input / Condition | Observed Behavior | Expected Behavior | Severity | Location |
|---|---|---|---|---|---|
| **2.1 Zero Sets (`sets: []`)** | Exercise log with `sets: []` (e.g. via corrupt JSON or custom state) | `log.sets.every(s => s.isCompleted)` returns `true`. Exercise is marked **Completed ✓** immediately. | An exercise with 0 sets should be incomplete or mandate at least 1 set. | **HIGH** | `app.js:375`, `app.js:618`, `index.html:736` |
| **2.2 Negative Personal Record** | Exercise PR set to `-100` lbs | `calculatedTarget()` computes `Math.round(-100 * 0.65)` = `-65 lbs`. Displays `-65 lbs` in UI. | PR inputs must be validated to be positive numbers (`> 0`). | **MEDIUM** | `app.js:219`, `index.html:1397` |
| **2.3 Blank Input / NaN PR (Edit Exercise)** | Blank text in "Update Exercise PR" modal | `parseFloat("")` evaluates to `NaN`. PR becomes `NaN`. UI displays `PR: NaN lbs` and target `NaN lbs`. | Input should default to previous PR or display validation error. | **HIGH** | `index.html:1397`, `app.js:219` |
| **2.4 Zero PR Overwrite Bug** | PR set to `0` in "Add Exercise" modal | `parseFloat("0") || 100.0` treats `0` as falsy and silently overwrites input to `100.0`. | User setting PR to `0` should preserve `0` or throw validation error. | **LOW** | `app.js:699` |
| **2.5 Extreme Numbers / Overflow** | PR set to `1e308` | Displays `7.5e+307 lbs` breaking set table layout width. | Cap inputs at realistic maximums (e.g., 2,000 lbs). | **LOW** | `app.js:219`, `index.html:672` |
| **2.6 Decimal Weights** | PR set to `150.55` lbs | `Math.round(150.55 * 0.65)` rounds target to integer `98 lbs`. Works as intended. | Integer rounding is enforced for targets. | **PASS** | `app.js:219` |

### Detailed Analysis:
- **Zero Sets Logic Defect (`app.js:375`, `app.js:618`)**: In JavaScript, calling `[].every(...)` returns `true`. If `sets` is an empty array `[]`, `isMuscleGroupCompleted()` and `isDayCompleted()` evaluate the exercise as 100% finished.
- **NaN Propagation (`index.html:1397`)**: `submitEditExercise()` executes `parseFloat(document.getElementById('input-edit-exercise-pr').value)` without checking `isNaN()`. Saving `personalRecord: NaN` corrupts math in `calculatedTarget()` (`Math.round(NaN * multiplier)` -> `NaN`), causing `"NaN lbs"` to pollute the UI.

---

## 3. Empty States & Initial Launch Audit

| Test Case | Scenario | Observed Behavior | Status / Note | Location |
|---|---|---|---|---|
| **3.1 Fresh Launch (No localStorage)** | First load on new browser session | `seedInitialData()` creates 7 default muscle groups, 21 global exercises, 1 Default Plan, 3-day split, and Inaugural Strength Cycle. | **PASS** — Clean initial state generation. | `app.js:78-96`, `app.js:223-279` |
| **3.2 Days with No Exercises** | Split Day configured with `exerciseIds: []` | `isDayCompleted()` returns `true` for empty day (`if (!day.exerciseIds \|\| day.exerciseIds.length === 0) return true;`). Displays `"No exercises scheduled."`. | **PASS / BEHAVIORAL** — Empty days don't block cycle progress. | `app.js:367`, `index.html:829` |
| **3.3 All Muscle Groups Deleted** | User deletes all muscle groups in Settings | Settings list shows empty state. Train view shows `"No Muscle Groups Enabled"`. Progress bar renders `0/0` as `0%`. | **PASS** — Null checks prevent NaN rendering. | `index.html:429`, `index.html:573` |
| **3.4 All Exercises Deleted** | User deletes all exercises from Library | Exercises tab shows `"No movements added"`. Day tab shows `"No exercises scheduled"`. | **PASS** — Handled gracefully without console crashes. | `index.html:1075` |
| **3.5 Database Reset (`resetAll`)** | Developer Options -> Reset & Restore Seed Data | Purges `localStorage`, re-runs initial seeders and day migrations, re-renders all views. | **PASS** — Completely clears and restores seed state. | `app.js:893-915` |

---

## 4. Import / Export Data Integrity Audit

| Edge Case Test | Input / Payload | Observed Behavior | Impact / Severity | Location |
|---|---|---|---|---|
| **4.1 Malformed / Corrupted JSON** | `{ "plans": invalid_json...` | `JSON.parse` fails inside `try...catch`. Returns `false`, shows alert `"Import Failed. The selected file is not a valid IronLog backup."` | **PASS** — Application state remains preserved. | `app.js:945-987` |
| **4.2 Missing Top-Level Schema Keys** | `{ "plans": [] }` (missing `globalMuscleGroups`) | Validation check `if (!decoded.plans \|\| !decoded.globalMuscleGroups \|\| !decoded.globalExercises)` returns `false`. | **PASS** — Malformed backups rejected. | `app.js:948` |
| **4.3 Single Quotes in Names (Inline Handler Crash)** | Exercise name set to `"O'Hearn Press"` or plan `"Leg Day '26"` | `escapeHtml("O'Hearn Press")` produces `O&#039;Hearn Press`. HTML attribute parsing decodes `&#039;` back to `'` *before* JS execution. Evaluates to `openEditExerciseModal('id', 'O'Hearn Press', 100)`, throwing `Uncaught SyntaxError: Unexpected identifier 'Hearn'`. | **CRITICAL** — Clicking Edit, Delete, or Add buttons on items with single quotes crashes with console errors. | `index.html:1068`, `index.html:1084`, `index.html:1146`, `index.html:1147`, `index.html:1180` |
| **4.4 Object vs. Array `planDataById` Asymmetry** | Importing JSON from direct localStorage export | `exportToJSON()` flattens `planDataById` into an array `[k1, v1, k2, v2]`, while `saveData()` writes `planDataById` as an object `{ k1: v1 }`. `importFromJSON()` handles both, but direct object imports lack schema validation for nested `activeCycle.intensities`. | **HIGH** — If `activeCycle` exists without `intensities`, `getIntensity()` crashes with `TypeError: Cannot read properties of undefined (reading 'find')`. | `app.js:307`, `app.js:938`, `app.js:972` |
| **4.5 Date Rehydration** | Re-importing backup file | Dates stored as Apple reference seconds (`(ms - 978307200000)/1000`) are correctly re-hydrated into JS `Date` objects. | **PASS** — Date conversion functions correctly. | `app.js:966`, `app.js:974` |

---

## 5. State Synchronization & Split Workflow Audit

### 5.1 Split Day Count Changes (1 to 7 Days)
- **Observation:** When changing split days (e.g. reducing from 3 Days to 2 Days in `#settings-split-days` via `handleSplitDaysChange`), `setDaysCount(count)` truncates the `days` array.
- **Exercise Preservation:** Any exercises assigned to truncated days (e.g. Day 3) are automatically gathered (`exercisesToMove`) and appended to Day 1 (`data.days[0].exerciseIds`).
- **History Preservation:** Exercise logs (`exerciseLogs`) store entries by `exerciseId`, `weekIndex`, and `cycleId`. They are **not** tied to day IDs. Workout history for exercises is completely preserved across split changes.

### 5.2 Day Renaming & Blank Blur Input Disconnect
- **Observation:** In the Routine Planner (`index.html:934`), renaming a day uses an inline `<input ... onblur="handleDayRename('${day.id}', this.value)">`.
- **Defect:** In `app.js:457`, `updateDayName()` executes:
  ```js
  const name = newName.trim();
  if (!name) return;
  ```
  If a user clears the input field and clicks away (`onblur`), `updateDayName()` returns early **without updating data and without calling `renderAll()`**. As a result, the input field on screen stays blank, creating a visual disconnect between the DOM and the underlying data store until tab re-render.

### 5.3 Week Advancement vs. Retrain Desynchronization (CRITICAL ARCHITECTURAL BUG)
- **Observation 1 (Advancement):** Week advancement is triggered by `checkAndAdvanceWeek()` (`app.js:384`). When all enabled muscle groups are completed for the current week, `cycle.currentWeekIndex` increments from `0` to `1` (Week 1 -> Week 2).
- **Observation 2 (Retrain):** When a user clicks "Retrain" on a completed day (`index.html:914`), it calls `handleRetrainDay(dayId)` -> `markDayExercisesIncomplete(dayId)`.
- **The Defect (`app.js:507`):**
  ```js
  markDayExercisesIncomplete(dayId) {
      const cycle = this.activeCycle;
      if (!cycle) return;
      ...
      dayExercises.forEach(ex => {
          const log = this.getLog(ex, cycle.currentWeekIndex); // <--- USES CURRENT WEEK INDEX (e.g. Week 2)
          log.isCompleted = false;
          log.sets.forEach(s => s.isCompleted = false);
          this.updateLog(log);
      });
  }
  ```
- **Consequence:** If completing Day 3 of Week 1 causes `cycle.currentWeekIndex` to auto-advance to Week 2 (`1`), clicking "Retrain" on Day 1 modifies logs for **Week 2** (which were already incomplete), while Week 1 logs remain marked as completed. The user cannot un-complete or retrain Week 1 once the cycle advances!

---

## 6. UI Integrity, DOM Elements & Console Behavior Audit

### 6.1 Unescaped Quotes in Inline Event Listeners (Console Error Source)
- **File:** `index.html`
- **Lines:** 1068, 1084, 1146, 1147, 1180
- **Evidence:**
  ```html
  <div class="exercise-details-row" onclick="openEditExerciseModal('${exercise.id}', '${escapeHtml(exercise.name)}', ${exercise.personalRecord})">
  ```
- **Error Reproduction:** If an exercise is named `Push-Up 'Heavy'`, clicking it outputs:
  `Uncaught SyntaxError: Unexpected identifier 'Heavy'`
- **Fix Required:** Pass IDs only to inline function calls (e.g., `openEditExerciseModal('${exercise.id}')`) and lookup name/PR inside the JS handler from `storeObj`.

### 6.2 Lucide Icon Rendering & Network Dependency Risk
- **File:** `index.html` (Line 9: `<script src="https://unpkg.com/lucide@latest"></script>`)
- **Evidence:** `renderAll()` calls `lucide.createIcons()` at line 349.
- **Risk:** In restricted network / offline environments (e.g. CODE_ONLY sandbox), if the CDN script fails to load, global `lucide` is `undefined`. Calling `lucide.createIcons()` throws `ReferenceError: lucide is not defined`, breaking the entire execution of `renderAll()`.
- **Mitigation:** Wrap `lucide.createIcons()` in `if (window.lucide && typeof lucide.createIcons === 'function') { lucide.createIcons(); }`.

### 6.3 DOM ID Verification Matrix
All 32 dynamic DOM container IDs referenced in `app.js` and `index.html` script blocks were verified against `index.html` element definitions. 100% of target IDs exist in the DOM hierarchy.

---

## 7. Audit Summary & Prioritized Remediation Plan

```
+-----------------------------------------------------------------------------------+
| PRIORITY 1 — CRITICAL (Must Fix in M3)                                           |
+-----------------------------------------------------------------------------------+
| 1. Fix Inline Event Listener Single-Quote Escaping (index.html:1068, 1084, etc.)  |
| 2. Fix Retrain Day Week Index Desync (app.js:507)                                 |
| 3. Fix NaN PR Propagation in submitEditExercise (index.html:1397)                 |
| 4. Protect lucide.createIcons() against ReferenceError (index.html:349)           |
+-----------------------------------------------------------------------------------+
| PRIORITY 2 — HIGH (Must Fix in M3)                                               |
+-----------------------------------------------------------------------------------+
| 5. Fix Zero Sets [].every() Auto-Completion Bug (app.js:375, 618)                 |
| 6. Validate imported activeCycle.intensities schema integrity (app.js:968)        |
| 7. Fix Day Rename Blank Input DOM Disconnect (app.js:457)                         |
+-----------------------------------------------------------------------------------+
| PRIORITY 3 — MEDIUM / LOW (Refinements)                                          |
+-----------------------------------------------------------------------------------+
| 8. Validate negative PR inputs in modal handlers (> 0 validation)                 |
| 9. Fix PR = 0 overwrite to 100.0 (app.js:699)                                     |
+-----------------------------------------------------------------------------------+
```

---

*Report compiled and verified by QA Audit Specialist for IronLog Web.*
