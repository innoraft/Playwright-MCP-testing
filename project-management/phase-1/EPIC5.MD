# EPIC-05 — Reports & Results

## Overview

**As a** team using this platform,  
**We want** to view rich, detailed test reports directly inside the dashboard,  
**So that** we can understand exactly what passed, what failed, and what changed visually — all in one place.

---

## Goal

Provide a clear and detailed HTML report after every test run that gives QA engineers, designers, and team leads full visibility into test outcomes, step-by-step actions, screenshots, and visual diffs — without needing to dig through log files.

---

## Persons

- QA Engineer
- UI Designer
- Team Lead
- Stakeholder

---

## Priority

🔴 **High**

---

## User Stories

---

### US-05.1 — View Report Embedded in the Dashboard

**As a** QA Engineer,  
**I want** to view the generated HTML report directly inside the web UI without opening a new tab,  
**So that** I have a single place to see everything — logs, results, and screenshots — without switching context.

**Acceptance Criteria:**
- [ ] Reports tab shows a list of all past reports in the left sidebar
- [ ] Clicking a report loads it in an iframe on the right
- [ ] Reports are listed newest first
- [ ] An "Open in new tab" link is available for full-screen viewing
- [ ] Report list refreshes automatically after a new test run completes

**Priority:** 🔴 High

---

### US-05.2 — See Reference, Actual, and Diff Side by Side

**As a** UI Designer,  
**I want** to see the reference image, actual screenshot, and diff image displayed side by side in the report,  
**So that** I can instantly understand what changed visually without switching between separate files.

**Acceptance Criteria:**
- [ ] Report shows three panels for each visual regression step: Reference | Actual | Diff
- [ ] Each panel has a clear label
- [ ] Images are clickable to open a full-screen modal
- [ ] Mismatch percentage is shown with a visual score bar below the panels
- [ ] Three-panel view only appears for visual regression steps — not for regular actions

**Priority:** 🔴 High

---

### US-05.3 — See a Step-by-Step Action Timeline

**As a** QA Engineer,  
**I want** to see a step-by-step log of every action taken during the test with pass/fail status and screenshots,  
**So that** I can trace exactly which step failed and understand why.

**Acceptance Criteria:**
- [ ] Timeline shows every action in execution order
- [ ] Each action shows the tool name, duration, and a pass/fail badge
- [ ] Expandable rows reveal parameters and any captured screenshots
- [ ] Failed steps are visually highlighted in red
- [ ] Filter buttons allow showing only assertions or only visual regression steps

**Priority:** 🔴 High

---

### US-05.4 — See a Test Summary at the Top

**As a** Team Lead,  
**I want** to see a summary section at the top of the report showing total steps, passed, failed, success rate, and total duration,  
**So that** I can assess the overall health of the test at a glance without reading through individual steps.

**Acceptance Criteria:**
- [ ] Summary shows: Total Steps, Passed, Failed, Success Rate, Duration
- [ ] Visual Checks count shown as a separate stat
- [ ] Stats are colour coded — green for pass, red for fail
- [ ] Summary is always visible at the top of the report and does not require scrolling

**Priority:** 🟡 Medium

---

## Epic Summary

| Story   | Title                                    | Priority  |
|---------|------------------------------------------|-----------|
| US-05.1 | View Report Embedded in the Dashboard    | 🔴 High   |
| US-05.2 | See Reference, Actual, and Diff Side by Side | 🔴 High |
| US-05.3 | See a Step-by-Step Action Timeline       | 🔴 High   |
| US-05.4 | See a Test Summary at the Top            | 🟡 Medium |
