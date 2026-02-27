# EPIC-04 — Visual Regression Engine

## Overview

**As a** team using this platform,  
**We want** the system to automatically compare live page screenshots against reference design images,  
**So that** we can detect visual changes on any webpage instantly without manual inspection.

---

## Goal

Provide a reliable pixel-level comparison engine that takes a screenshot during the test, compares it to the manually placed reference image, generates a visual diff, and clearly reports whether the page looks as expected.

---

## Persons

- QA Engineer
- UI Designer
- Tech Lead

---

## Priority

🔴 **High**

---

## User Stories

---

### US-04.1 — Compare Screenshot to Reference Image

**As a** QA Engineer,  
**I want** the platform to automatically compare a test screenshot against my reference image using pixel-level diffing,  
**So that** I can detect even subtle visual changes that human eyes might miss.

**Acceptance Criteria:**
- [ ] Pixelmatch is used to compare the reference and actual images
- [ ] Comparison runs automatically as part of the test execution
- [ ] Mismatched pixels are counted and expressed as a percentage
- [ ] Test passes if mismatch percentage is at or below the configured threshold
- [ ] Test fails if mismatch percentage exceeds the threshold

**Priority:** 🔴 High

---

### US-04.2 — Generate a Highlighted Diff Image

**As a** UI Designer,  
**I want** a diff PNG image to be generated that highlights the mismatched pixels in red,  
**So that** I can see exactly which part of the page changed at a glance without comparing two images manually.

**Acceptance Criteria:**
- [ ] Diff image is created using pixelmatch output
- [ ] Mismatched pixels are highlighted in red on the diff image
- [ ] Diff image is saved to `files/diffs/` with a consistent naming convention
- [ ] Diff image is referenced and displayed in the test report

**Priority:** 🔴 High

---

### US-04.3 — Test at Multiple Breakpoints

**As a** QA Engineer,  
**I want** to run visual regression checks at multiple viewport sizes within a single test,  
**So that** I can verify the responsive design across desktop, tablet, and mobile in one run.

**Acceptance Criteria:**
- [ ] Each breakpoint defined in the form produces its own screenshot and comparison
- [ ] Separate reference image is used per breakpoint
- [ ] Each breakpoint generates its own diff image
- [ ] Each breakpoint result is reported separately in the HTML report

**Priority:** 🔴 High

---

### US-04.4 — Clear Error When Reference Image Is Missing

**As a** QA Engineer,  
**I want** to see a clear, helpful error message if the reference image is not found,  
**So that** I know exactly what file is missing and where to place it, rather than getting a confusing crash.

**Acceptance Criteria:**
- [ ] Runner checks for the baseline image before attempting comparison
- [ ] If no baseline found, a clear error is thrown with the exact expected file path
- [ ] Error message is visible in the live log console and in the report
- [ ] No auto-save or auto-creation of baseline images — placement is always manual and intentional

**Priority:** 🔴 High

---

### US-04.5 — Configure Comparison Sensitivity

**As a** QA Engineer,  
**I want** to configure the pixel sensitivity threshold and the maximum allowed mismatch percentage,  
**So that** I can tune strictness for pages with animations or dynamic content that change slightly on every load.

**Acceptance Criteria:**
- [ ] `threshold` setting controls per-pixel sensitivity (0.0 = strictest, 1.0 = loosest)
- [ ] `failOnPercent` setting controls the maximum allowed mismatch percentage
- [ ] Both have sensible defaults (threshold: 0.1, failOnPercent: 1.0%)
- [ ] Anti-aliasing differences are excluded from comparison by default
- [ ] Images of different heights are handled gracefully by cropping to the smaller dimension

**Priority:** 🟡 Medium

---

## Epic Summary

| Story   | Title                                   | Priority  |
|---------|-----------------------------------------|-----------|
| US-04.1 | Compare Screenshot to Reference Image   | 🔴 High   |
| US-04.2 | Generate a Highlighted Diff Image       | 🔴 High   |
| US-04.3 | Test at Multiple Breakpoints            | 🔴 High   |
| US-04.4 | Clear Error When Reference Image Missing| 🔴 High   |
| US-04.5 | Configure Comparison Sensitivity        | 🟡 Medium |
