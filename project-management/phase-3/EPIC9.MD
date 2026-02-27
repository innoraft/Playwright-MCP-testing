# EPIC-09 — User Roles & Authentication

## Overview

**As a** platform serving multiple users,  
**We want** a role-based access control system with at least two roles — Site Admin and Authenticated User,  
**So that** sensitive configuration is restricted to admins while regular users can only access features relevant to their work.

---

## Goal

Introduce authentication and role management similar to Drupal's model — a user can have multiple roles, and permissions are granted per role. Site Admin controls platform-wide settings. Authenticated Users run tests and manage their own assets.

---

## Personas

- Site Admin
- Authenticated User

---

## Priority

🔴 **High**

---

## Role Definitions

| Role                | Description |
|---------------------|-------------|
| **Site Admin**      | Full access — manages LLM config, can see all users' files, manages users |
| **Authenticated User** | Can create and run tests, manage their own files and baselines only |

> A user can hold multiple roles (e.g. a person can be both Site Admin and Authenticated User).

---

## Permission Matrix

| Feature                        | Site Admin | Authenticated User |
|--------------------------------|------------|--------------------|
| Access LLM Config tab          | ✅         | ❌                 |
| Create / run tests             | ✅         | ✅                 |
| Upload baseline images         | ✅         | ✅ (own only)      |
| View own files                 | ✅         | ✅                 |
| View other users' files        | ✅         | ❌                 |
| Delete own files               | ✅         | ✅                 |
| Delete other users' files      | ✅         | ❌                 |
| Manage users                   | ✅         | ❌                 |
| View Reports                   | ✅         | ✅ (own only)      |

---

## User Stories

---

### US-09.1 — User Login

**As an** Authenticated User,  
**I want** to log in with my credentials,  
**So that** the platform knows who I am and shows me only my own assets and tests.

**Acceptance Criteria:**
- [ ] Login page accepts username/email and password
- [ ] Invalid credentials show a clear error message
- [ ] On success, user is redirected to the dashboard
- [ ] Session is persisted so user stays logged in on page refresh
- [ ] Logout option is available from the UI

**Priority:** 🔴 High

---

### US-09.2 — Role-Based Tab Visibility

**As a** Site Admin,  
**I want** the UI to show or hide tabs based on the logged-in user's role,  
**So that** Authenticated Users never see configuration options they are not allowed to use.

**Acceptance Criteria:**
- [ ] LLM Config tab is only visible to Site Admin role
- [ ] All other tabs are visible to Authenticated Users
- [ ] If an Authenticated User tries to access a restricted route directly, they are redirected
- [ ] Role is determined server-side — not just hidden on the frontend

**Priority:** 🔴 High

---

### US-09.3 — Admin Manages Users

**As a** Site Admin,  
**I want** to create, edit, and deactivate user accounts and assign roles,  
**So that** I control who has access to the platform and at what level.

**Acceptance Criteria:**
- [ ] Admin panel lists all registered users
- [ ] Admin can create a new user with a role assignment
- [ ] Admin can assign or remove roles from existing users (a user can have multiple roles)
- [ ] Admin can deactivate a user without deleting their data
- [ ] Deactivated users cannot log in

**Priority:** 🔴 High

---

### US-09.4 — User-Scoped Data Isolation

**As an** Authenticated User,  
**I want** my tests, baselines, screenshots, and reports to be isolated from other users,  
**So that** I cannot accidentally see or affect another user's work.

**Acceptance Criteria:**
- [ ] Test files, baselines, screenshots, diffs, and reports are stored in user-scoped paths
- [ ] API endpoints filter results by the currently logged-in user's ID
- [ ] One user's data is never returned in another user's API responses
- [ ] Site Admin can view all users' data when needed

**Priority:** 🔴 High

---

## Epic Summary

| Story   | Title                         | Priority |
|---------|-------------------------------|----------|
| US-09.1 | User Login                    | 🔴 High  |
| US-09.2 | Role-Based Tab Visibility     | 🔴 High  |
| US-09.3 | Admin Manages Users           | 🔴 High  |
| US-09.4 | User-Scoped Data Isolation    | 🔴 High  |
