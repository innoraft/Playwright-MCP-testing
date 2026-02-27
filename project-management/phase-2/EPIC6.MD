# EPIC-06 — Baseline Image Management

## Overview

**As a** team using this platform,  
**We want** to upload and manage reference design images through the UI,  
**So that** the visual regression engine always has the correct baseline to compare against without manually copying files to the server.

---

## Goal

Give users a dedicated space to upload, preview, and delete reference images. The system should guide users on naming conventions and make it impossible to upload an image with the wrong filename by auto-generating the correct name from the test and breakpoint.

---

## Persons

- QA Engineer
- UI Designer
- Team Lead

---

## Priority

🔴 **High**

---

## User Stories

---

### US-06.1 — Upload a Reference Image

**As a** QA Engineer,  
**I want** to upload a PNG reference image through the UI,  
**So that** the visual regression test has a baseline to compare the live screenshot against without me touching the server directly.

**Acceptance Criteria:**
- [ ] Upload button opens the system file picker
- [ ] Supports PNG, JPG, and JPEG formats
- [ ] Multiple files can be selected and uploaded in one action
- [ ] Files are saved to `files/baselines/` on the server
- [ ] Uploaded files appear in the list immediately after upload
- [ ] Success or error message shown after upload attempt

**Priority:** 🔴 High

---

### US-06.2 — Auto-Name the Baseline from Test and Breakpoint

**As a** QA Engineer,  
**I want** the system to automatically suggest or generate the correct baseline filename based on the test name and breakpoint I have configured,  
**So that** there is no chance of a filename mismatch between what I upload and what the runner expects.

**Acceptance Criteria:**
- [ ] When uploading from the test form, the expected filename is pre-filled automatically
- [ ] Filename follows the format: `{testname}_{breakpoint}.png`
- [ ] User is warned if the uploaded filename does not match the expected name
- [ ] System offers to rename the file automatically on upload if there is a mismatch

**Priority:** 🔴 High

---

### US-06.3 — Preview a Baseline Image

**As a** UI Designer,  
**I want** to click on any baseline image in the list to see a full preview,  
**So that** I can verify the correct reference image has been uploaded before running the test.

**Acceptance Criteria:**
- [ ] Clicking an image in the list shows it in a preview panel
- [ ] Preview scales the image to fit the panel without cropping
- [ ] Filename and file size are shown alongside the preview
- [ ] Preview updates instantly when switching between images

**Priority:** 🟡 Medium

---

### US-06.4 — Delete a Baseline Image

**As a** QA Engineer,  
**I want** to delete a baseline image that is no longer needed,  
**So that** the baselines folder stays organised and does not contain stale reference images.

**Acceptance Criteria:**
- [ ] Delete icon is shown next to each baseline in the list
- [ ] Clicking delete shows a confirmation dialog before proceeding
- [ ] File is deleted from `files/baselines/` on the server
- [ ] List refreshes automatically after deletion
- [ ] Preview panel clears if the deleted image was being previewed

**Priority:** 🟡 Medium

---

## Epic Summary

| Story   | Title                                        | Priority  |
|---------|----------------------------------------------|-----------|
| US-06.1 | Upload a Reference Image                     | 🔴 High   |
| US-06.2 | Auto-Name the Baseline from Test and Breakpoint | 🔴 High |
| US-06.3 | Preview a Baseline Image                     | 🟡 Medium |
| US-06.4 | Delete a Baseline Image                      | 🟡 Medium |
