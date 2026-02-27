# EPIC-03 — Test Execution & Live Monitoring

## Overview

**As a** team using this platform,  
**We want** to trigger test runs from the browser and watch them execute in real time,  
**So that** we can monitor progress, catch failures immediately, and get results without using a terminal.

---

## Goal

Give users a simple one-click test execution experience with a live log console that streams output in real time, clear pass/fail indicators, and automatic navigation to the report when done.

---

## Persons

- QA Engineer
- Team Lead
- DevOps Engineer

---

## Priority

🔴 **High**

---

## User Stories

---

### US-03.1 — Select and Run a Test

**As a** QA Engineer,  
**I want** to select a test from a dropdown and click Run Test to execute it,  
**So that** I can trigger an automated test run without touching the terminal.

**Acceptance Criteria:**
- [ ] Dropdown is populated with all saved test files from `tests/`
- [ ] Run Test button is disabled until a test is selected
- [ ] Clicking Run calls `POST /api/runner/run` with the selected test name
- [ ] Run button changes to a Stop button while the test is running
- [ ] A new run clears the previous log output

**Priority:** 🔴 High

---

### US-03.2 — Watch Live Logs in Real Time

**As a** QA Engineer,  
**I want** to see each log line appear in the console as the test executes without refreshing the page,  
**So that** I know exactly what is happening at every step and can spot issues immediately.

**Acceptance Criteria:**
- [ ] Log console is visible below the run controls
- [ ] Logs stream in via SSE (EventSource) in real time
- [ ] Console auto-scrolls to the latest log line
- [ ] Each log line is color-coded by type — green for pass, red for fail, blue for LLM activity, purple for step marker
- [ ] If the user connects after the run has already started, buffered logs are replayed from the beginning

**Priority:** 🔴 High

---

### US-03.3 — See Overall Pass or Fail Result

**As a** Team Lead,  
**I want** to see a clear PASSED or FAILED status badge when the test finishes,  
**So that** I can immediately understand the outcome without reading through all the logs.

**Acceptance Criteria:**
- [ ] Green "All Tests Passed" badge shown on success
- [ ] Red "Tests Failed" badge shown on failure
- [ ] Status badge is shown next to the Run/Stop button
- [ ] Status clears when a new run is started

**Priority:** 🔴 High

---

### US-03.4 — Auto-Navigate to Report After Run

**As a** QA Engineer,  
**I want** to be automatically taken to the Reports tab when the test run finishes,  
**So that** I don't have to manually navigate to find the report — I see it straight away.

**Acceptance Criteria:**
- [ ] When SSE sends `done: true` with a `reportFile`, the UI switches to the Reports tab automatically
- [ ] The latest report is pre-selected and loaded in the iframe
- [ ] Behaviour works for both passed and failed runs

**Priority:** 🟡 Medium

---

## Epic Summary

| Story   | Title                              | Priority  |
|---------|------------------------------------|-----------|
| US-03.1 | Select and Run a Test              | 🔴 High   |
| US-03.2 | Watch Live Logs in Real Time       | 🔴 High   |
| US-03.3 | See Overall Pass or Fail Result    | 🔴 High   |
| US-03.4 | Auto-Navigate to Report After Run  | 🟡 Medium |
