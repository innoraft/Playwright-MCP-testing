# EPIC-02 — Test Authoring & Management

## Overview

**As a** team using this platform,  
**We want** to create and manage tests through a guided form interface,  
**So that** we can author reliable automated tests without writing YAML manually or worrying about formatting mistakes.

---

## Goal

Provide two distinct test authoring experiences — a general test form for flexible scenario-based testing, and a dedicated Visual Regression form for QA engineers who only need to provide a URL and a reference image. YAML is never exposed to the user in either form. The system handles all file generation internally.

---

## Personas

- QA Engineer
- Manual Tester
- Business Analyst

---

## Priority

🔴 **High**

---

## User Stories

---

### US-02.1 — Create a General Test Using a Scenario Form

**As a** Manual Tester,  
**I want** to fill in a form with one or more Scenario + Test groups,  
**So that** I can describe my test cases in plain language without writing or seeing any YAML.

**Acceptance Criteria:**
- [ ] Form has a repeatable field group with two fields: Scenario (text field) and Test (textarea)
- [ ] An "Add More" button allows adding multiple Scenario + Test instances
- [ ] Each instance can be removed individually
- [ ] All fields are validated before saving or running
- [ ] YAML is generated automatically from the form values — user never sees or touches it
- [ ] Generated YAML is saved to `tests/` on Save

**Priority:** 🔴 High

---

### US-02.2 — Create a Visual Regression Test Using a Dedicated Form

**As a** QA Engineer,  
**I want** a separate, simpler form where I only provide a URL and upload a reference image,  
**So that** I can set up a visual regression test quickly without dealing with viewports, paths, or any technical fields.

**Acceptance Criteria:**
- [ ] A dedicated Visual Regression form is available as a separate tab or section
- [ ] Form has a repeatable group with two fields: URL (text field) and Reference Image (file upload)
- [ ] An "Add More" button allows adding multiple URL + Reference Image instances
- [ ] Each instance can be removed individually
- [ ] Baseline filename is auto-generated from the URL and saved to the correct path — user never types it
- [ ] YAML is generated automatically and saved — user never sees or touches it

**Priority:** 🔴 High

---

### US-02.3 — Auto-Generate Correct YAML from Either Form

**As a** QA Engineer,  
**I want** the system to automatically generate the correct YAML test file from my form inputs regardless of which form I used,  
**So that** screenshot paths, baseline filenames, and step order are always correct and consistent.

**Acceptance Criteria:**
- [ ] General form generates YAML from Scenario + Test field groups
- [ ] Visual Regression form generates YAML including: navigate, screenshot, and visual regression check steps
- [ ] Screenshot path is auto-set to `files/screenshots/{auto-name}`
- [ ] Baseline filename is auto-generated as `{derived-name}_{width}px.png` — no `.yml` suffix, no hyphens
- [ ] Generated YAML is saved to `tests/` folder on Save
- [ ] User never needs to type a file path manually

**Priority:** 🔴 High

---

### US-02.4 — Load and Edit an Existing Test

**As a** QA Engineer,  
**I want** to click on any saved test in the sidebar and have the form re-populate with its values,  
**So that** I can update an existing test without recreating it from scratch.

**Acceptance Criteria:**
- [ ] Sidebar lists all saved test files
- [ ] Clicking a test re-populates all form fields from the saved data
- [ ] Currently selected test is highlighted in the sidebar
- [ ] Saving after editing overwrites the existing file
- [ ] Adding or removing field group instances is supported during edit

**Priority:** 🔴 High

---

### US-02.5 — Delete a Test

**As a** QA Engineer,  
**I want** to delete a saved test from the sidebar with a confirmation prompt,  
**So that** I can keep the test list clean and remove outdated tests.

**Acceptance Criteria:**
- [ ] Delete icon shown next to each test in the sidebar
- [ ] Clicking delete shows a confirmation dialog before proceeding
- [ ] File is removed via `DELETE /api/tests/:name`
- [ ] Sidebar refreshes automatically after deletion
- [ ] If the deleted test was open in the form, the form is cleared

**Priority:** 🟡 Medium

---

### US-02.6 — Advanced Editor for Power Users

**As a** QA Engineer,  
**I want** access to a raw editor for tests that go beyond what the forms support,  
**So that** I still have full flexibility for complex or custom test scenarios.

**Acceptance Criteria:**
- [ ] Advanced Mode is accessible via a separate "Test Editor" tab — not inside either form
- [ ] No YAML is shown, previewed, or toggled inside the Visual Regression or General Test forms
- [ ] Changes made in Advanced Mode are saved as-is
- [ ] A clear warning is shown when entering Advanced Mode

**Priority:** 🟡 Medium

---

## Epic Summary

| Story   | Title                                      | Priority  |
|---------|--------------------------------------------|-----------|
| US-02.1 | Create a General Test via Scenario Form    | 🔴 High   |
| US-02.2 | Create a Visual Regression Test via Form   | 🔴 High   |
| US-02.3 | Auto-Generate Correct YAML from Either Form| 🔴 High   |
| US-02.4 | Load and Edit an Existing Test             | 🔴 High   |
| US-02.5 | Delete a Test                              | 🟡 Medium |
| US-02.6 | Advanced Editor for Power Users            | 🟡 Medium |
