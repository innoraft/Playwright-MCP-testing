# EPIC-01 — LLM Configuration & Setup

## Overview

**As a** Site Admin,  
**We want** to configure the AI provider settings for the entire platform from a restricted admin panel,  
**So that** all users benefit from a single centrally managed LLM configuration without being able to change it themselves.

---

## Goal

Restrict LLM configuration to Site Admins only. The admin selects the provider, model, API key, and temperature once — and that configuration is used by all users on the platform. Authenticated Users have no visibility into these settings.

---

## Personas

- Site Admin *(can configure)*
- Authenticated User *(uses the config, cannot see or change it)*

---

## Priority

🔴 **High**

---

## User Roles & Permissions

| Action                        | Site Admin | Authenticated User |
|-------------------------------|------------|--------------------|
| View LLM Config tab           | ✅ Yes     | ❌ No              |
| Select AI provider            | ✅ Yes     | ❌ No              |
| Enter API key                 | ✅ Yes     | ❌ No              |
| Select model                  | ✅ Yes     | ❌ No              |
| Set temperature               | ✅ Yes     | ❌ No              |
| Benefit from the config       | ✅ Yes     | ✅ Yes             |

---

## User Stories

---

### US-01.1 — Admin Selects AI Provider

**As a** Site Admin,  
**I want** to select the AI provider for the entire platform from a restricted admin panel,  
**So that** all users run their tests through the same centrally managed provider without being able to change it.

**Acceptance Criteria:**
- [ ] LLM Config tab is only visible to users with the Site Admin role
- [ ] A dropdown lists all supported providers (OpenAI, Claude, Gemini, Groq, Mistral, Cohere)
- [ ] Selecting a provider updates the model list to show only models for that provider
- [ ] Selection is persisted to `llm.config.js` on Save
- [ ] Previously saved provider is pre-selected on page load for the admin

**Priority:** 🔴 High

---

### US-01.2 — Admin Enters API Key Securely

**As a** Site Admin,  
**I want** to enter the API key in a password-masked input field with a show/hide toggle,  
**So that** the credentials are not exposed to anyone looking at my screen.

**Acceptance Criteria:**
- [ ] API key field is masked by default (`type="password"`)
- [ ] A show/hide eye icon toggles visibility
- [ ] Key is saved to `llm.config.js` only when admin clicks Save
- [ ] API key is never visible to Authenticated Users under any circumstance

**Priority:** 🔴 High

---

### US-01.3 — Admin Selects Model

**As a** Site Admin,  
**I want** to choose a specific model from a list filtered by the selected provider,  
**So that** all users on the platform use the model that best fits the team's cost and quality requirements.

**Acceptance Criteria:**
- [ ] Model dropdown is populated based on the selected provider
- [ ] Selected model is saved to config on Save
- [ ] Unsupported model combinations are not shown

**Priority:** 🔴 High

---

### US-01.4 — Admin Sets Temperature

**As a** Site Admin,  
**I want** to adjust the temperature slider between 0 and 2,  
**So that** I can tune how deterministic the AI planning is for all users on the platform.

**Acceptance Criteria:**
- [ ] Slider renders with range 0.0 to 2.0, step 0.1
- [ ] Current value displayed dynamically next to the label
- [ ] Labels "Precise", "Balanced", "Creative" shown at 0, 1, 2
- [ ] Value saved to `llm.config.js` on Save click

**Priority:** 🟡 Medium

---

## Epic Summary

| Story   | Title                    | Role       | Priority   |
|---------|--------------------------|------------|------------|
| US-01.1 | Admin Selects Provider   | Site Admin | 🔴 High    |
| US-01.2 | Admin Enters API Key     | Site Admin | 🔴 High    |
| US-01.3 | Admin Selects Model      | Site Admin | 🔴 High    |
| US-01.4 | Admin Sets Temperature   | Site Admin | 🟡 Medium  |
