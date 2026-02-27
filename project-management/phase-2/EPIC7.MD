# EPIC-07 — Files & Asset Browser

## Overview

**As a** team using this platform,  
**We want** to browse and manage test assets — screenshots, diffs, and baselines — from the UI,  
**So that** we never need to open a terminal or file manager to inspect or clean up test output files.

---

## Goal

Give users a visual file browser scoped to their own assets. Each user can only see and manage the files they uploaded or generated. Baseline images are private to the user who uploaded them — another user cannot see, access, or overwrite them.

---

## Personas

- QA Engineer
- UI Designer

---

## Priority

🟡 **Medium**

---

## User Roles & Permissions

| Action                              | Site Admin | Authenticated User        |
|-------------------------------------|------------|---------------------------|
| Browse own screenshots and diffs    | ✅ Yes     | ✅ Yes                    |
| Browse own baseline images          | ✅ Yes     | ✅ Yes (own only)         |
| See another user's baseline images  | ✅ Yes     | ❌ No                     |
| Delete own files                    | ✅ Yes     | ✅ Yes (own only)         |
| Delete another user's files         | ✅ Yes     | ❌ No                     |

---

## User Stories

---

### US-07.1 — Browse My Files

**As a** QA Engineer,  
**I want** to browse the files directory in the UI and only see assets that belong to me,  
**So that** my workspace is not cluttered with other users' screenshots or baselines.

**Acceptance Criteria:**
- [ ] Root view shows top-level folders: `screenshots/`, `baselines/`, `diffs/`
- [ ] Files are scoped to the currently logged-in user — another user's files are not visible
- [ ] Clicking a folder navigates into it with breadcrumb navigation
- [ ] Files and folders shown with icons, names, and file sizes
- [ ] Folders are listed before files

**Priority:** 🟡 Medium

---

### US-07.2 — Baseline Images Are Private Per User

**As a** QA Engineer,  
**I want** the baseline images I upload to be visible and accessible only to me,  
**So that** other users cannot see, use, or accidentally overwrite my reference images.

**Acceptance Criteria:**
- [ ] Baseline images are stored in a user-scoped path (e.g. `files/baselines/{userId}/`)
- [ ] When a test runs, the runner looks for the baseline in the current user's scoped path
- [ ] Another logged-in user browsing the Baselines folder cannot see my images
- [ ] Site Admin can see all users' baselines if needed for support

**Priority:** 🔴 High

---

### US-07.3 — Preview Images Inline

**As a** UI Designer,  
**I want** to click any image file to preview it in a panel without downloading it,  
**So that** I can quickly inspect screenshots and diffs without leaving the tool.

**Acceptance Criteria:**
- [ ] Clicking a PNG or JPG file shows it in the preview panel on the right
- [ ] Preview scales the image to fit the panel
- [ ] Filename and file size shown with the preview
- [ ] Non-image files show a graceful fallback message
- [ ] Preview updates instantly when switching between files

**Priority:** 🟡 Medium

---

### US-07.4 — Delete My Files

**As a** QA Engineer,  
**I want** to delete individual files that belong to me,  
**So that** I can clean up old screenshots and diffs without using the terminal.

**Acceptance Criteria:**
- [ ] Delete icon shown next to each file in the list
- [ ] Clicking delete shows a confirmation dialog before proceeding
- [ ] User can only delete files that belong to them
- [ ] File list refreshes automatically after deletion
- [ ] Preview panel clears if the deleted file was being previewed

**Priority:** 🟢 Low

---

## Epic Summary

| Story   | Title                               | Priority  |
|---------|-------------------------------------|-----------|
| US-07.1 | Browse My Files                     | 🟡 Medium |
| US-07.2 | Baseline Images Are Private Per User| 🔴 High   |
| US-07.3 | Preview Images Inline               | 🟡 Medium |
| US-07.4 | Delete My Files                     | 🟢 Low    |
