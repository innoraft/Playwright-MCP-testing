# EPIC-08 — Platform & Infrastructure

## Overview

**As a** team adopting this platform,  
**We want** the system to be easy to set up, stable to run, and structured in a way that supports team use,  
**So that** we can onboard quickly and run tests reliably without dealing with infrastructure complexity.

---

## Goal

Ensure the platform is simple to install, runs stably in a local or team environment, handles errors gracefully, and is structured in a way that keeps the frontend, backend, and test runner cleanly separated.

---

## Persons

- DevOps Engineer
- Tech Lead
- Team Lead

---

## Priority

🟡 **Medium**

---

## User Stories

---

### US-08.1 — Set Up the Platform Quickly

**As a** DevOps Engineer,  
**I want** to set up the entire platform by running a few install commands and starting two terminal processes,  
**So that** my team can onboard in minutes without needing complex infrastructure or cloud accounts.

**Acceptance Criteria:**
- [ ] README provides clear step-by-step setup instructions
- [ ] Three `npm install` commands cover all dependencies (runner, backend, frontend)
- [ ] Backend starts with: `cd backend && node server.js`
- [ ] Frontend starts with: `cd client && npm run dev`
- [ ] No Docker, database, or cloud account required to get started

**Priority:** 🔴 High

---

### US-08.2 — Run All Tests in a Folder

**As a** Team Lead,  
**I want** to point the runner at a folder and have it execute all YAML test files in that directory sequentially,  
**So that** I can run the full test suite in one command without listing each file individually.

**Acceptance Criteria:**
- [ ] Runner accepts a directory path as a CLI argument
- [ ] All `.yml` and `.yaml` files in the directory are discovered automatically
- [ ] Files are executed in alphabetical order
- [ ] A summary is printed at the end showing total, passed, and failed counts
- [ ] Exit code is `1` if any test fails — making it compatible with CI pipelines

**Priority:** 🟡 Medium

---

### US-08.3 — Frontend and Backend Work Together Without Manual CORS Setup

**As a** DevOps Engineer,  
**I want** the frontend and backend to communicate seamlessly out of the box,  
**So that** the system works on first run without any browser console errors or manual configuration.

**Acceptance Criteria:**
- [ ] Backend includes `cors()` middleware accepting all localhost ports
- [ ] Vite proxy configured in `vite.config.js` for `/api`, `/files`, and `/test-reports` routes
- [ ] No CORS errors appear in the browser console under normal operation
- [ ] Configuration works regardless of which port Vite assigns to the frontend

**Priority:** 🟡 Medium

---

### US-08.4 — Test Runner Runs in an Isolated Process

**As a** Tech Lead,  
**I want** the test runner to execute in a separate child process from the backend server,  
**So that** a crashed or long-running test does not block the API server or affect other users.

**Acceptance Criteria:**
- [ ] Backend uses `child_process.spawn()` to launch the runner
- [ ] A crash in the runner does not crash the Express server
- [ ] Multiple run requests are tracked independently via unique run IDs
- [ ] Runner `stdout` and `stderr` are captured and streamed to clients via SSE
- [ ] Runner `cwd` is set to the project root so all relative paths resolve correctly

**Priority:** 🔴 High

---

## Epic Summary

| Story   | Title                                              | Priority  |
|---------|----------------------------------------------------|-----------|
| US-08.1 | Set Up the Platform Quickly                        | 🔴 High   |
| US-08.2 | Run All Tests in a Folder                          | 🟡 Medium |
| US-08.3 | Frontend and Backend Work Together Without CORS Issues | 🟡 Medium |
| US-08.4 | Test Runner Runs in an Isolated Process            | 🔴 High   |
