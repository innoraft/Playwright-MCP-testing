# EPIC-10 — Form Validation Test Builder (Sheet Upload)

---

# Overview

**As a** tester who needs to validate complex web forms,  
**We want** a dedicated "Form Validation" tab that provides a guided spreadsheet-driven test builder with configurable field mappings and validation rules,  
**So that** users can efficiently create bulk form validation scenarios without manually writing YAML or automation logic.

---

# Goal

Replace the Advanced Editor (raw YAML) tab with a structured Form Validation Test Builder.

The feature allows users to:

- Upload spreadsheet-based test datasets
- Use spreadsheet column headings as the identifiers for form fields
- Optionally configure mappings if auto-detection is insufficient
- Define field types (text, select, datepicker, checkbox, etc.)
- Configure validation expectations
- Auto-generate structured YAML execution contracts
- Execute intelligent form validation tests through the LLM runner

The system should support deterministic execution metadata instead of relying entirely on AI inference. By default, the column headings in the uploaded sheet will be used as the identifiers for the form fields.

---

# Personas

- QA Engineer
- SDET
- Authenticated User
- Non-technical Tester

---

# Priority

🔴 **High**

---

# Problem Statement

Current testing workflows require users to:

- manually write YAML
- manually define repetitive test steps
- repeatedly create similar validation scenarios
- rely on AI to infer field types dynamically

This becomes inefficient and unreliable for:

- large forms
- validation-heavy forms
- dropdowns
- datepickers
- checkbox groups
- bulk validation testing

The Form Validation Builder solves this by introducing:

- spreadsheet-driven datasets
- structured field metadata
- reusable execution contracts
- deterministic automation behavior

---

# Scope

## In Scope

- Spreadsheet upload (`.csv`, `.xlsx`)
- Field mapping configuration
- Field type configuration
- YAML auto-generation
- Form auto-detection
- Structured validation assertions
- Existing test editing
- Backend type detection
- LLM execution integration

## Out of Scope (Phase 1)

- CAPTCHA solving
- OTP verification
- payment gateway flows
- multi-step wizards
- shadow DOM forms
- drag-and-drop uploads
- file uploads larger than configured size limit
- iframe-cross-domain forms

---

# High-Level Architecture

```txt
┌────────────────────────────────────────────────────────────┐
│ Frontend — FormValidationSheetUpload.jsx                  │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Test Metadata                                       │   │
│ │----------------------------------------------------│   │
│ │ URL                                                 │   │
│ │ Test Name                                           │   │
│ │ Form Selector (optional)                            │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Sheet Upload                                         │   │
│ │----------------------------------------------------│   │
│ │ Upload CSV/XLSX                                      │   │
│ │ Parse Columns                                         │   │
│ │ Preview Rows                                          │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Field Mapping Configuration                          │   │
│ │----------------------------------------------------│   │
│ │ Sheet column headings are used as field identifiers  │   │
│ │ (Column → Selector Mapping, if needed)               │   │
│ │ Column → Field Type                                  │   │
│ │ Date Format / Select Strategy / Checkbox Config      │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Validation Configuration                             │   │
│ │----------------------------------------------------│   │
│ │ Pass Criteria                                        │   │
│ │ Fail Criteria                                        │   │
│ │ Assertion Rules                                      │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Preview & Save                                       │   │
│ │----------------------------------------------------│   │
│ │ YAML Preview                                         │   │
│ │ Execution Preview                                    │   │
│ │ Save Test                                             │   │
│ └──────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
                        │
                        │ POST /api/tests
                        ▼
┌────────────────────────────────────────────────────────────┐
│ Backend — server/index.js                                 │
│                                                            │
│ • Detects `form-validation:` type marker                  │
│ • Saves YAML execution contract                           │
│ • Parses YAML for edit mode                               │
│ • Returns test metadata                                   │
└────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌────────────────────────────────────────────────────────────┐
│ ai_test_runner.js                                         │
│                                                            │
│ • Reads structured YAML                                   │
│ • Executes dataset row-by-row                             │
│ • Uses field type metadata                                │
│ • Performs assertions                                     │
│ • Generates execution report                              │
└────────────────────────────────────────────────────────────┘
```

---

# User Stories

---

# US-10.1 — Replace Advanced Editor with Form Validation Tab

## Description

**As a** tester,  
**I want** to access a dedicated Form Validation tab instead of the Advanced Editor,  
**So that** I can create form validation tests using a guided UI.

## Acceptance Criteria

- [ ] Advanced Editor tab is removed
- [ ] New "Form Validation" tab is added
- [ ] Tab icon is 📝
- [ ] Tab ID is `form-validation`
- [ ] Selecting the tab renders `FormValidationSheetUpload`
- [ ] Existing navigation behavior remains unchanged

---

# US-10.2 — Form Validation Metadata UI

## Description

**As a** QA engineer,  
**I want** to configure form validation test metadata,  
**So that** the system knows which form to target.

## Acceptance Criteria

- [ ] Form includes:
  - Test Name
  - Target URL
  - Form Selector (optional)
- [ ] Form selector is auto-detected if blank
- [ ] URL is required
- [ ] Test Name is required
- [ ] Validation prevents incomplete submission

---

# US-10.3 — Spreadsheet Upload & Parsing

## Description

**As a** tester,  
**I want** to upload spreadsheet-based datasets,  
**So that** I can define multiple validation scenarios efficiently.

## Acceptance Criteria

- [ ] Supports `.csv` and `.xlsx`
- [ ] Spreadsheet rows are parsed
- [ ] Column headers are extracted
- [ ] Parsed data preview is shown
- [ ] Invalid files show validation error
- [ ] Upload is required before save

---

# US-10.4 — Field Mapping & Field Type Configuration

## Description

**As a** tester,  
**I want** the spreadsheet column headings to serve as the identifiers for form fields, and to configure field types,  
**So that** the runner can interact with the form correctly.

## Acceptance Criteria

- [ ] System uses spreadsheet column headings as field identifiers by default
- [ ] System displays uploaded columns
- [ ] Each column supports:
  - field selector (optional override)
  - field type
- [ ] Supported field types:
  - text
  - textarea
  - email
  - password
  - number
  - select
  - multiselect
  - checkbox
  - radio
  - datepicker
  - autocomplete
- [ ] Datepicker supports configurable date format
- [ ] Select supports:
  - visibleText
  - value
  - index
- [ ] Checkbox fields support boolean values
- [ ] Mapping configuration is persisted in YAML
- [ ] Required mappings must be resolved before save

---

# US-10.5 — Form Auto-Detection

## Description

**As a** tester,  
**I want** the system to auto-detect forms and fields from the target page,  
**So that** manual configuration effort is reduced.

## Acceptance Criteria

- [ ] System scans page DOM
- [ ] Detects:
  - forms
  - inputs
  - textareas
  - selects
  - submit buttons
- [ ] Multiple forms show selectable dropdown
- [ ] Auto-suggested mappings are generated
- [ ] User can manually override mappings

---

# US-10.6 — Validation Criteria & Assertions

## Description

**As a** tester,  
**I want** to configure pass/fail assertions,  
**So that** the runner can verify expected behavior.

## Acceptance Criteria

- [ ] Supports success assertions
- [ ] Supports failure assertions
- [ ] Assertion types include:
  - text-visible
  - field-error
  - element-visible
  - URL-change
- [ ] Validation messages can be configured
- [ ] Assertions are stored in YAML

---

# US-10.7 — YAML Generation

## Description

**As a** tester,  
**I want** the system to generate structured YAML automatically,  
**So that** tests can execute without manual YAML authoring.

## Acceptance Criteria

- [ ] YAML starts with:

```yaml
form-validation:
```

- [ ] YAML contains:
  - target metadata
  - field mappings
  - dataset
  - assertions
  - execution metadata
- [ ] YAML is deterministic and machine-readable
- [ ] Generated YAML is saved via existing API

---

# US-10.8 — Existing Test Parsing & Editing

## Description

**As a** tester,  
**I want** previously saved tests to reload into the UI,  
**So that** I can edit and re-save them.

## Acceptance Criteria

- [ ] Clicking saved test opens Form Validation tab
- [ ] YAML is parsed back into UI state
- [ ] All mappings/configurations reload correctly
- [ ] Edited tests can be re-saved

---

# US-10.9 — Execution Reporting

## Description

**As a** tester,  
**I want** row-level execution reports,  
**So that** I can identify validation failures quickly.

## Acceptance Criteria

- [ ] Each row has PASS/FAIL status
- [ ] Failed rows capture:
  - screenshot
  - validation message
- [ ] Reports are downloadable
- [ ] Reports are linked to test history

---

# YAML Output Format

```yaml
schemaVersion: 1

form-validation: Contact Form Validation

target:
  url: https://example.com/contact
  formSelector: "#contact-form"

fieldMappings:

  Full Name:
    selector: "#name"
    type: text

  Email:
    selector: "#email"
    type: email

  Country:
    selector: "#country"
    type: select
    selectBy: visibleText

  Date of Birth:
    selector: "#dob"
    type: datepicker
    format: "DD/MM/YYYY"

  Terms Accepted:
    selector: "#terms"
    type: checkbox

dataset:
  columns:
    - Full Name
    - Email
    - Country
    - Date of Birth
    - Terms Accepted
    - ExpectedResult
    - ExpectedMessage

  rows:
    - ["John Doe", "john@test.com", "India", "10/01/1998", true, "PASS", "Submission successful"]

    - ["Jane", "invalid-email", "India", "12/02/1995", true, "FAIL", "Invalid email address"]

assertions:

  success:
    - type: text-visible
      value: "Submission successful"

  failure:
    - type: field-error
      field: "Email"
      value: "Invalid email address"

execution:
  resetBetweenRows: true
  stopOnFailure: false
  screenshotOnFailure: true
```

---

# Technical Notes

- `form-validation:` differentiates this test type from:
  - `name:` (visual-regression)
  - `Test:` (general)
- `fieldMappings:` enables deterministic interaction logic
- YAML acts as a structured execution contract
- The LLM interprets execution strategy instead of inferring form behavior dynamically
- Existing `POST /api/tests` endpoint is reused
- No new API endpoints required for Phase 1

---

# Non-Functional Requirements

## Performance

- Sheet parsing must complete within acceptable UI response time
- Large datasets should not freeze the UI

## Security

- Uploaded files must be validated
- Unsupported MIME types rejected
- Spreadsheet formula injection sanitized

## Reliability

- Invalid mappings must block execution
- Missing selectors must show validation errors
