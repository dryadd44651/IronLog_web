// App State and Storage Management for IronLog Web
// Ported from iOS SwiftUI ContentView.swift and extended for Dedicated Customizable Daily Splits

const APPLE_REF_DATE_MS = 978307200000; // Jan 1, 2001 00:00:00 UTC

// Icon mappings from SF Symbols to Lucide Icons
const sfSymbolToLucide = {
    'figure.strengthtraining.traditional': 'dumbbell',
    'person.fill': 'user',
    'figure.arms.open': 'accessibility',
    'figure.cooldown': 'heart',
    'figure.mixed.cardio': 'zap',
    'figure.run': 'flame',
    'figure.core.training': 'target',
    'figure.walk': 'footprints',
    'leaf.fill': 'leaf',
    'scalemass.fill': 'scale',
    'bolt.shield.fill': 'zap',
    'battery.50': 'battery-medium',
    'square.grid.2x2.fill': 'layout-grid',
    'gearshape.fill': 'settings',
    'list.bullet': 'list',
    'plus.circle.fill': 'plus-circle',
    'checkmark.circle.fill': 'check-circle-2',
    'circle': 'circle',
    'pencil': 'edit',
    'trash': 'trash-2',
    'trophy.fill': 'trophy',
    'calendar.badge.clock': 'calendar',
    'eye.slash': 'eye-off',
    'info.circle.fill': 'info',
    'chevron.right': 'chevron-right',
    'square': 'square',
    'checkmark.square.fill': 'check-square',
    'plus.circle': 'plus-circle',
    'minus.circle': 'minus-circle',
    'arrow.counterclockwise.circle.fill': 'rotate-ccw',
    'square.and.arrow.up': 'upload',
    'square.and.arrow.down': 'download'
};

function getLucideIcon(symbolName) {
    return sfSymbolToLucide[symbolName] || symbolName || 'help-circle';
}

function normalizeIntensity(val) {
    if (!val) return 'medium';
    const clean = val.toLowerCase();
    if (clean.includes('light')) return 'light';
    if (clean.includes('medium') || clean.includes('balanced')) return 'medium';
    if (clean.includes('heavy') || clean.includes('strength')) return 'heavy';
    if (clean.includes('deload') || clean.includes('active')) return 'deload';
    return 'medium';
}

function getIntensityRawValue(key) {
    switch(key) {
        case 'light': return "Light (Recovery)";
        case 'heavy': return "Heavy (Strength)";
        case 'deload': return "Deload (Active Rest)";
        case 'medium':
        default:
            return "Medium (Balanced)";
    }
}

class AppStore {
    constructor() {
        this.plans = [];
        this.currentPlanId = null;
        this.globalMuscleGroups = [];
        this.globalExercises = [];
        this.planDataById = {}; // key: plan UUID string, value: PlanStoreData

        this.saveKey = "ironlog_data_v4";
        this.loadData();

        if (this.plans.length === 0) {
            const defaultPlanId = crypto.randomUUID();
            this.plans = [{ id: defaultPlanId, name: "Default Plan" }];
            this.currentPlanId = defaultPlanId;
        }

        if (!this.planDataById[this.currentPlanId]) {
            this.planDataById[this.currentPlanId] = {
                enabledExerciseIds: [],
                activeCycle: null,
                exerciseLogs: [],
                daysCount: 3,
                days: []
            };
        }

        if (this.globalMuscleGroups.length === 0 && this.globalExercises.length === 0) {
            this.seedInitialData();
        }

        // Auto-run daily splits migration on initialization
        this.migrateDaysForAllPlans();
    }

    get muscleGroups() {
        return this.globalMuscleGroups;
    }

    set muscleGroups(val) {
        this.globalMuscleGroups = val;
        this.saveData();
    }

    get exercises() {
        return this.globalExercises;
    }

    set exercises(val) {
        this.globalExercises = val;
        this.saveData();
    }

    get activeCycle() {
        return this.currentPlanData.activeCycle;
    }

    set activeCycle(val) {
        this.updateCurrentPlanData(data => {
            data.activeCycle = val;
        });
    }

    get exerciseLogs() {
        return this.currentPlanData.exerciseLogs || [];
    }

    set exerciseLogs(val) {
        this.updateCurrentPlanData(data => {
            data.exerciseLogs = val;
        });
    }

    get currentPlanData() {
        if (!this.currentPlanId || !this.planDataById[this.currentPlanId]) {
            return {
                enabledExerciseIds: [],
                activeCycle: null,
                exerciseLogs: [],
                daysCount: 3,
                days: []
            };
        }
        return this.planDataById[this.currentPlanId];
    }

    updateCurrentPlanData(mutate) {
        if (!this.currentPlanId) return;
        if (!this.planDataById[this.currentPlanId]) {
            this.planDataById[this.currentPlanId] = {
                enabledExerciseIds: [],
                activeCycle: null,
                exerciseLogs: [],
                daysCount: 3,
                days: []
            };
        }
        mutate(this.planDataById[this.currentPlanId]);
        this.saveData();
    }

    isExerciseEnabled(exerciseId) {
        const enabledIds = this.currentPlanData.enabledExerciseIds || [];
        return enabledIds.includes(exerciseId);
    }

    setExerciseEnabled(exerciseId, isEnabled) {
        this.updateCurrentPlanData(data => {
            if (!data.enabledExerciseIds) data.enabledExerciseIds = [];
            if (isEnabled) {
                if (!data.enabledExerciseIds.includes(exerciseId)) {
                    data.enabledExerciseIds.push(exerciseId);
                }
            } else {
                data.enabledExerciseIds = data.enabledExerciseIds.filter(id => id !== exerciseId);
                // Also remove from all days
                if (data.days) {
                    data.days.forEach(d => {
                        d.exerciseIds = d.exerciseIds.filter(id => id !== exerciseId);
                    });
                }
            }
        });
        this.checkAndAdvanceWeek();
    }

    calculatedTarget(exercise, weekIndex) {
        const currentGroup = this.muscleGroups.find(g => g.id === exercise.muscleGroupId);
        const rawIntensity = currentGroup ? this.getIntensity(currentGroup, weekIndex) : 'medium';
        const intensity = normalizeIntensity(rawIntensity);

        let multiplier = 0.65;
        let reps = "8";
        switch (intensity) {
            case 'light':
                multiplier = 0.55;
                reps = "10";
                break;
            case 'medium':
                multiplier = 0.65;
                reps = "8";
                break;
            case 'heavy':
                multiplier = 0.75;
                reps = "5";
                break;
            case 'deload':
                multiplier = 0.40;
                reps = "15";
                break;
        }

        const calculatedWeight = Math.round(exercise.personalRecord * multiplier);
        return { weight: `${calculatedWeight} lbs`, reps: reps };
    }

    seedInitialData() {
        this.globalMuscleGroups = [
            { id: crypto.randomUUID(), name: "Chest", iconName: "figure.strengthtraining.traditional", isEnabled: true },
            { id: crypto.randomUUID(), name: "Back", iconName: "person.fill", isEnabled: true },
            { id: crypto.randomUUID(), name: "Shoulders", iconName: "figure.arms.open", isEnabled: true },
            { id: crypto.randomUUID(), name: "Biceps", iconName: "figure.cooldown", isEnabled: true },
            { id: crypto.randomUUID(), name: "Triceps", iconName: "figure.mixed.cardio", isEnabled: true },
            { id: crypto.randomUUID(), name: "Legs", iconName: "figure.run", isEnabled: true },
            { id: crypto.randomUUID(), name: "Core", iconName: "figure.core.training", isEnabled: true }
        ];

        const g1 = this.globalMuscleGroups[0].id;
        const g2 = this.globalMuscleGroups[1].id;
        const g3 = this.globalMuscleGroups[2].id;
        const g4 = this.globalMuscleGroups[3].id;
        const g5 = this.globalMuscleGroups[4].id;
        const g6 = this.globalMuscleGroups[5].id;
        const g7 = this.globalMuscleGroups[6].id;

        this.globalExercises = [
            // Chest
            { id: crypto.randomUUID(), name: "Bench Press", muscleGroupId: g1, personalRecord: 185.0 },
            { id: crypto.randomUUID(), name: "Incline Dumbbell Press", muscleGroupId: g1, personalRecord: 130.0 },
            { id: crypto.randomUUID(), name: "Chest Fly", muscleGroupId: g1, personalRecord: 80.0 },
            // Back
            { id: crypto.randomUUID(), name: "Barbell Row", muscleGroupId: g2, personalRecord: 135.0 },
            { id: crypto.randomUUID(), name: "Pull-ups", muscleGroupId: g2, personalRecord: 150.0 },
            { id: crypto.randomUUID(), name: "Lat Pulldown", muscleGroupId: g2, personalRecord: 120.0 },
            // Shoulders
            { id: crypto.randomUUID(), name: "Overhead Press", muscleGroupId: g3, personalRecord: 115.0 },
            { id: crypto.randomUUID(), name: "Lateral Raise", muscleGroupId: g3, personalRecord: 40.0 },
            { id: crypto.randomUUID(), name: "Face Pulls", muscleGroupId: g3, personalRecord: 50.0 },
            // Biceps
            { id: crypto.randomUUID(), name: "Barbell Curl", muscleGroupId: g4, personalRecord: 75.0 },
            { id: crypto.randomUUID(), name: "Hammer Curl", muscleGroupId: g4, personalRecord: 60.0 },
            { id: crypto.randomUUID(), name: "Preacher Curl", muscleGroupId: g4, personalRecord: 65.0 },
            // Triceps
            { id: crypto.randomUUID(), name: "Cable Pushdown", muscleGroupId: g5, personalRecord: 80.0 },
            { id: crypto.randomUUID(), name: "Skull Crushers", muscleGroupId: g5, personalRecord: 65.0 },
            { id: crypto.randomUUID(), name: "Overhead Extension", muscleGroupId: g5, personalRecord: 50.0 },
            // Legs
            { id: crypto.randomUUID(), name: "Squat", muscleGroupId: g6, personalRecord: 225.0 },
            { id: crypto.randomUUID(), name: "Romanian Deadlift", muscleGroupId: g6, personalRecord: 185.0 },
            { id: crypto.randomUUID(), name: "Leg Press", muscleGroupId: g6, personalRecord: 360.0 },
            // Core
            { id: crypto.randomUUID(), name: "Hanging Leg Raise", muscleGroupId: g7, personalRecord: 150.0 },
            { id: crypto.randomUUID(), name: "Plank", muscleGroupId: g7, personalRecord: 150.0 },
            { id: crypto.randomUUID(), name: "Ab Wheel Rollout", muscleGroupId: g7, personalRecord: 150.0 }
        ];

        // Enable all exercises by default
        this.updateCurrentPlanData(data => {
            data.enabledExerciseIds = this.globalExercises.map(e => e.id);
        });

        this.startNewCycle("Inaugural Strength Phase");
    }

    startNewCycle(name) {
        const cycleId = crypto.randomUUID();
        const intensities = [];
        for (const group of this.muscleGroups) {
            intensities.push({ id: crypto.randomUUID(), muscleGroupId: group.id, weekIndex: 0, intensity: getIntensityRawValue('light') });
            intensities.push({ id: crypto.randomUUID(), muscleGroupId: group.id, weekIndex: 1, intensity: getIntensityRawValue('medium') });
            intensities.push({ id: crypto.randomUUID(), muscleGroupId: group.id, weekIndex: 2, intensity: getIntensityRawValue('heavy') });
            intensities.push({ id: crypto.randomUUID(), muscleGroupId: group.id, weekIndex: 3, intensity: getIntensityRawValue('deload') });
        }

        this.activeCycle = {
            id: cycleId,
            name: name,
            startDate: new Date(),
            currentWeekIndex: 0,
            intensities: intensities,
            isCompleted: false
        };

        this.exerciseLogs = [];
        this.saveData();
    }

    getIntensity(muscleGroup, weekIndex) {
        const cycle = this.activeCycle;
        if (!cycle) return "Medium (Balanced)";
        const match = cycle.intensities.find(i => i.muscleGroupId === muscleGroup.id && i.weekIndex === weekIndex);
        return match ? match.intensity : "Medium (Balanced)";
    }

    setIntensity(muscleGroupId, weekIndex, intensity) {
        const cycle = this.activeCycle;
        if (!cycle) return;
        const idx = cycle.intensities.findIndex(i => i.muscleGroupId === muscleGroupId && i.weekIndex === weekIndex);
        const rawVal = getIntensityRawValue(intensity);
        if (idx !== -1) {
            cycle.intensities[idx].intensity = rawVal;
        } else {
            cycle.intensities.push({ id: crypto.randomUUID(), muscleGroupId, weekIndex, intensity: rawVal });
        }
        this.activeCycle = cycle;
        this.saveData();
    }

    getLog(exercise, weekIndex) {
        const cycle = this.activeCycle;
        const cycleId = cycle ? cycle.id : crypto.randomUUID();
        const logs = this.exerciseLogs;
        
        const existing = logs.find(l => l.exerciseId === exercise.id && l.weekIndex === weekIndex && l.cycleId === cycleId);
        if (existing) {
            return existing;
        }

        // Return virtual lazy log
        return {
            exerciseId: exercise.id,
            weekIndex: weekIndex,
            cycleId: cycleId,
            sets: [
                { id: crypto.randomUUID(), isCompleted: false },
                { id: crypto.randomUUID(), isCompleted: false },
                { id: crypto.randomUUID(), isCompleted: false }
            ],
            isCompleted: false
        };
    }

    updateLog(updatedLog) {
        const logs = [...this.exerciseLogs];
        const idx = logs.findIndex(l => l.id === updatedLog.id || (l.exerciseId === updatedLog.exerciseId && l.weekIndex === updatedLog.weekIndex && l.cycleId === updatedLog.cycleId));
        if (idx !== -1) {
            logs[idx] = updatedLog;
        } else {
            if (!updatedLog.id) updatedLog.id = crypto.randomUUID();
            logs.push(updatedLog);
        }
        this.exerciseLogs = logs;
        this.saveData();
    }

    // --- DAILY SPLIT PLANNERS ---

    isDayCompleted(day, weekIndex) {
        if (!this.activeCycle) return false;
        if (!day.exerciseIds || day.exerciseIds.length === 0) return true; // empty day is complete

        for (const exId of day.exerciseIds) {
            const exercise = this.exercises.find(e => e.id === exId);
            if (!exercise) continue;
            // Only check if exercise is enabled in this plan
            if (!this.isExerciseEnabled(exId)) continue;

            const log = this.getLog(exercise, weekIndex);
            if (!log.isCompleted) {
                return false;
            }
        }
        return true;
    }

    // Restore original muscle group based week advancement check!
    checkAndAdvanceWeek() {
        const cycle = this.activeCycle;
        if (!cycle) return;

        const enabledGroups = this.muscleGroups.filter(g => g.isEnabled);
        const allDone = enabledGroups.every(g => this.isMuscleGroupCompleted(g.id, cycle.currentWeekIndex));

        if (allDone && enabledGroups.length > 0) {
            if (cycle.currentWeekIndex < 3) {
                cycle.currentWeekIndex += 1;
            } else {
                cycle.isCompleted = true;
            }
            this.activeCycle = cycle;
            this.saveData();
        }
    }

    forceAdvanceWeek() {
        const cycle = this.activeCycle;
        if (!cycle) return;
        if (cycle.currentWeekIndex < 3) {
            cycle.currentWeekIndex += 1;
        } else {
            cycle.isCompleted = true;
        }
        this.activeCycle = cycle;
        this.saveData();
    }

    setDaysCount(count) {
        count = parseInt(count) || 3;
        if (count < 1) count = 1;
        if (count > 7) count = 7;

        this.updateCurrentPlanData(data => {
            if (!data.days) data.days = [];
            data.daysCount = count;

            if (count > data.days.length) {
                // Add new empty days
                for (let i = data.days.length; i < count; i++) {
                    data.days.push({
                        id: crypto.randomUUID(),
                        name: `Day ${i + 1}`,
                        exerciseIds: []
                    });
                }
            } else if (count < data.days.length) {
                // Truncate days and move their exercises back to Day 1
                const exercisesToMove = [];
                for (let i = count; i < data.days.length; i++) {
                    exercisesToMove.push(...data.days[i].exerciseIds);
                }
                
                data.days = data.days.slice(0, count);
                
                // Add unique moved exercises to Day 1
                const day1 = data.days[0];
                if (day1) {
                    exercisesToMove.forEach(id => {
                        if (!day1.exerciseIds.includes(id)) {
                            day1.exerciseIds.push(id);
                        }
                    });
                }
            }
        });
        this.syncEnabledExercises();
        this.saveData();
    }

    updateDayName(dayId, newName) {
        const name = newName.trim();
        if (!name) return;
        this.updateCurrentPlanData(data => {
            const day = data.days.find(d => d.id === dayId);
            if (day) {
                day.name = name;
            }
        });
        this.saveData();
    }

    // Set day exercises in bulk (for modal checklists)
    setDayExercises(dayId, exerciseIds) {
        this.updateCurrentPlanData(data => {
            const day = data.days.find(d => d.id === dayId);
            if (day) {
                day.exerciseIds = exerciseIds || [];
            }
        });
        this.syncEnabledExercises();
        this.checkAndAdvanceWeek();
        this.saveData();
    }

    toggleExerciseInDay(dayId, exerciseId, assign) {
        this.updateCurrentPlanData(data => {
            const day = data.days.find(d => d.id === dayId);
            if (day) {
                if (assign) {
                    if (!day.exerciseIds.includes(exerciseId)) {
                        day.exerciseIds.push(exerciseId);
                    }
                } else {
                    day.exerciseIds = day.exerciseIds.filter(id => id !== exerciseId);
                }
            }
        });
        this.syncEnabledExercises();
        this.checkAndAdvanceWeek();
        this.saveData();
    }

    syncEnabledExercises() {
        this.updateCurrentPlanData(data => {
            const allIds = new Set();
            if (data.days) {
                data.days.forEach(day => {
                    day.exerciseIds.forEach(id => allIds.add(id));
                });
            }
            data.enabledExerciseIds = Array.from(allIds);
        });
    }

    migrateDaysForAllPlans() {
        this.plans.forEach(plan => {
            this.migrateDaysForPlan(plan.id);
        });
    }

    migrateDaysForPlan(planId) {
        if (!this.planDataById[planId]) {
            this.planDataById[planId] = {
                enabledExerciseIds: [],
                activeCycle: null,
                exerciseLogs: [],
                daysCount: 3,
                days: []
            };
        }
        
        const data = this.planDataById[planId];
        if (!data.daysCount || !data.days || data.days.length === 0) {
            data.daysCount = 3;
            const enabledIds = data.enabledExerciseIds || [];
            
            // Group exercises logically
            const day1ExIds = [];
            const day2ExIds = [];
            const day3ExIds = [];
            
            this.globalExercises.forEach(ex => {
                if (!enabledIds.includes(ex.id)) return;
                
                const group = this.globalMuscleGroups.find(g => g.id === ex.muscleGroupId);
                const gName = group ? group.name.toLowerCase() : '';
                
                if (gName.includes('chest') || gName.includes('biceps') || gName.includes('core')) {
                    day1ExIds.push(ex.id);
                } else if (gName.includes('back') || gName.includes('triceps') || gName.includes('shoulder')) {
                    day2ExIds.push(ex.id);
                } else if (gName.includes('legs')) {
                    day3ExIds.push(ex.id);
                } else {
                    day1ExIds.push(ex.id); // fallback
                }
            });

            data.days = [
                { id: crypto.randomUUID(), name: "Day 1 (Chest, Biceps, Core)", exerciseIds: day1ExIds },
                { id: crypto.randomUUID(), name: "Day 2 (Back, Triceps, Shoulders)", exerciseIds: day2ExIds },
                { id: crypto.randomUUID(), name: "Day 3 (Legs)", exerciseIds: day3ExIds }
            ];
            
            this.syncEnabledExercises();
            this.saveData();
        }
    }

    // --- ORIGINAL INTERFACES ---

    isMuscleGroupCompleted(muscleGroupId, weekIndex) {
        if (!this.activeCycle) return false;
        const groupExercises = this.exercises.filter(e => e.muscleGroupId === muscleGroupId && this.isExerciseEnabled(e.id));
        if (groupExercises.length === 0) return true;

        for (const exercise of groupExercises) {
            const log = this.getLog(exercise, weekIndex);
            if (!log.isCompleted) {
                return false;
            }
        }
        return true;
    }

    updateMuscleGroupStatus(id, isEnabled) {
        const idx = this.muscleGroups.findIndex(g => g.id === id);
        if (idx !== -1) {
            const groups = [...this.muscleGroups];
            groups[idx].isEnabled = isEnabled;
            this.muscleGroups = groups;
            this.checkAndAdvanceWeek();
        }
    }

    renameMuscleGroup(id, newName) {
        const name = newName.trim();
        if (!name) return;
        const dup = this.muscleGroups.some(g => g.id !== id && g.name.toLowerCase() === name.toLowerCase());
        if (dup) return;
        const idx = this.muscleGroups.findIndex(g => g.id === id);
        if (idx !== -1) {
            const groups = [...this.muscleGroups];
            groups[idx].name = name;
            this.muscleGroups = groups;
        }
    }

    addMuscleGroup(name, iconName) {
        const trimmed = name.trim();
        if (!trimmed) return;
        const dup = this.muscleGroups.some(g => g.name.toLowerCase() === trimmed.toLowerCase());
        if (dup) return;

        const newId = crypto.randomUUID();
        const newGroup = { id: newId, name: trimmed, iconName: iconName || "figure.walk", isEnabled: true };
        
        const groups = [...this.muscleGroups];
        groups.push(newGroup);
        this.muscleGroups = groups;

        const cycle = this.activeCycle;
        if (cycle) {
            for (let week = 0; week < 4; week++) {
                cycle.intensities.push({ id: crypto.randomUUID(), muscleGroupId: newId, weekIndex: week, intensity: getIntensityRawValue('medium') });
            }
            this.activeCycle = cycle;
        }
        this.saveData();
    }

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

    addExercise(name, muscleGroupId, personalRecord) {
        const trimmed = name.trim();
        if (!trimmed) return;
        const newEx = {
            id: crypto.randomUUID(),
            name: trimmed,
            muscleGroupId: muscleGroupId,
            personalRecord: parseFloat(personalRecord) || 100.0
        };
        const list = [...this.exercises];
        list.push(newEx);
        this.exercises = list;

        this.updateCurrentPlanData(data => {
            if (!data.enabledExerciseIds) data.enabledExerciseIds = [];
            data.enabledExerciseIds.push(newEx.id);
            
            // Add to first day by default
            if (data.days && data.days.length > 0) {
                data.days[0].exerciseIds.push(newEx.id);
            }
        });
        this.saveData();
    }

    updateExercise(updatedExercise) {
        const list = [...this.exercises];
        const idx = list.findIndex(e => e.id === updatedExercise.id);
        if (idx !== -1) {
            list[idx] = updatedExercise;
            this.exercises = list;
        }
    }

    deleteExercise(exerciseId) {
        this.exercises = this.exercises.filter(e => e.id !== exerciseId);
        this.plans.forEach(plan => {
            const data = this.planDataById[plan.id];
            if (data) {
                data.enabledExerciseIds = (data.enabledExerciseIds || []).filter(id => id !== exerciseId);
                data.exerciseLogs = (data.exerciseLogs || []).filter(l => l.exerciseId !== exerciseId);
                if (data.days) {
                    data.days.forEach(d => {
                        d.exerciseIds = d.exerciseIds.filter(id => id !== exerciseId);
                    });
                }
            }
        });
        this.saveData();
    }

    createPlan(name) {
        const trimmed = name.trim();
        if (!trimmed) return;
        const newId = crypto.randomUUID();
        this.plans.push({ id: newId, name: trimmed });
        
        // Share exercises enabled in the first plan
        const firstPlan = this.plans[0];
        const firstEnabled = (firstPlan && this.planDataById[firstPlan.id]) ? this.planDataById[firstPlan.id].enabledExerciseIds : this.globalExercises.map(e => e.id);
        
        this.planDataById[newId] = {
            enabledExerciseIds: [...firstEnabled],
            activeCycle: null,
            exerciseLogs: [],
            daysCount: 3,
            days: []
        };
        this.migrateDaysForPlan(newId);
        this.selectPlan(newId);
    }

    renamePlan(id, newName) {
        const trimmed = newName.trim();
        if (!trimmed) return;
        const idx = this.plans.findIndex(p => p.id === id);
        if (idx !== -1) {
            this.plans[idx].name = trimmed;
            this.saveData();
        }
    }

    deletePlan(id) {
        if (this.plans.length <= 1) return;
        if (this.currentPlanId === id) {
            const remaining = this.plans.filter(p => p.id !== id);
            this.currentPlanId = remaining[0].id;
        }
        this.plans = this.plans.filter(p => p.id !== id);
        delete this.planDataById[id];
        this.saveData();
    }

    selectPlan(id) {
        this.currentPlanId = id;
        if (!this.planDataById[id]) {
            const firstPlan = this.plans[0];
            const firstEnabled = (firstPlan && this.planDataById[firstPlan.id]) ? this.planDataById[firstPlan.id].enabledExerciseIds : this.globalExercises.map(e => e.id);
            this.planDataById[id] = {
                enabledExerciseIds: [...firstEnabled],
                activeCycle: null,
                exerciseLogs: [],
                daysCount: 3,
                days: []
            };
        }
        this.migrateDaysForPlan(id);
        this.saveData();
    }

    resetAll() {
        localStorage.removeItem(this.saveKey);
        this.plans = [];
        this.currentPlanId = null;
        this.planDataById = {};
        this.globalExercises = [];
        this.globalMuscleGroups = [];

        const defaultPlanId = crypto.randomUUID();
        this.plans = [{ id: defaultPlanId, name: "Default Plan" }];
        this.currentPlanId = defaultPlanId;
        this.planDataById[defaultPlanId] = {
            enabledExerciseIds: [],
            activeCycle: null,
            exerciseLogs: [],
            daysCount: 3,
            days: []
        };

        this.seedInitialData();
        this.migrateDaysForAllPlans();
        this.saveData();
    }

    exportToJSON() {
        const flatPlanData = [];
        for (const [key, value] of Object.entries(this.planDataById)) {
            const cycleCopy = value.activeCycle ? { ...value.activeCycle } : null;
            if (cycleCopy && cycleCopy.startDate instanceof Date) {
                cycleCopy.startDate = (cycleCopy.startDate.getTime() - APPLE_REF_DATE_MS) / 1000;
            }

            flatPlanData.push(key);
            flatPlanData.push({
                enabledExerciseIds: value.enabledExerciseIds || [],
                activeCycle: cycleCopy,
                exerciseLogs: value.exerciseLogs || [],
                daysCount: value.daysCount || 3,
                days: value.days || []
            });
        }

        const payload = {
            plans: this.plans,
            currentPlanId: this.currentPlanId,
            planDataById: flatPlanData,
            globalMuscleGroups: this.globalMuscleGroups,
            globalExercises: this.globalExercises
        };
        return JSON.stringify(payload, null, 2);
    }

    importFromJSON(jsonString) {
        try {
            const decoded = JSON.parse(jsonString);
            if (!decoded.plans || !decoded.globalMuscleGroups || !decoded.globalExercises) {
                return false;
            }

            this.plans = decoded.plans;
            this.currentPlanId = decoded.currentPlanId;
            this.globalMuscleGroups = decoded.globalMuscleGroups;
            this.globalExercises = decoded.globalExercises;

            this.planDataById = {};
            const flatPlanData = decoded.planDataById;
            
            if (Array.isArray(flatPlanData)) {
                for (let i = 0; i < flatPlanData.length; i += 2) {
                    const key = flatPlanData[i];
                    const value = flatPlanData[i + 1];
                    if (key && value) {
                        if (value.activeCycle && typeof value.activeCycle.startDate === 'number') {
                            value.activeCycle.startDate = new Date(APPLE_REF_DATE_MS + value.activeCycle.startDate * 1000);
                        }
                        this.planDataById[key] = value;
                    }
                }
            } else if (typeof flatPlanData === 'object' && flatPlanData !== null) {
                for (const [key, val] of Object.entries(flatPlanData)) {
                    if (val.activeCycle && typeof val.activeCycle.startDate === 'number') {
                        val.activeCycle.startDate = new Date(APPLE_REF_DATE_MS + val.activeCycle.startDate * 1000);
                    }
                    this.planDataById[key] = val;
                }
            }

            this.migrateDaysForAllPlans();
            this.saveData();
            return true;
        } catch (e) {
            console.error("Failed to parse JSON backup:", e);
            return false;
        }
    }

    saveData() {
        const serializedData = {
            plans: this.plans,
            currentPlanId: this.currentPlanId,
            globalMuscleGroups: this.globalMuscleGroups,
            globalExercises: this.globalExercises,
            planDataById: this.planDataById
        };
        localStorage.setItem(this.saveKey, JSON.stringify(serializedData));
    }

    loadData() {
        try {
            const raw = localStorage.getItem(this.saveKey);
            if (raw) {
                const data = JSON.parse(raw);
                this.plans = data.plans || [];
                this.currentPlanId = data.currentPlanId || null;
                this.globalMuscleGroups = data.globalMuscleGroups || [];
                this.globalExercises = data.globalExercises || [];
                
                this.planDataById = data.planDataById || {};
                for (const id in this.planDataById) {
                    const pData = this.planDataById[id];
                    if (pData.activeCycle && pData.activeCycle.startDate) {
                        pData.activeCycle.startDate = new Date(pData.activeCycle.startDate);
                    }
                }
                return;
            }
        } catch (e) {
            console.error("Failed to load local storage:", e);
        }

        this.plans = [];
        this.currentPlanId = null;
        this.planDataById = {};
    }
}
