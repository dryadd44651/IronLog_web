# Context Index — IronLog Web

## Codebase Map
- `/Users/howard/.gemini/antigravity/scratch/IronLogWeb/index.html`: Main HTML file for IronLog Web application UI.
- `/Users/howard/.gemini/antigravity/scratch/IronLogWeb/app.js`: Application logic, state management, storage handler, and DOM interactions.
- `/Users/howard/.gemini/antigravity/scratch/IronLogWeb/app.css`: App styles, UI layout, themes, responsiveness.

## Key Storage Schema
- `localStorage` key: `ironlog_data_v4`

## Target Deliverables
- `qa_audit_report.md`: Comprehensive QA audit detailing test cases, boundary values, empty states, corrupted JSON import/export behavior, state sync when changing splits/renaming days/advancing weeks.
- `architect_review.md`: Architectural review of state flow, `ironlog_data_v4` schema, logic inefficiencies, redundancies, data corruption risks.
- Bug fixes in `app.js`, `index.html`, `app.css` resolving all R1 and R2 findings.
