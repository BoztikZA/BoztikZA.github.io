# Boztik Website v2.0 Roadmap

> Internal development roadmap for the Boztik website.
> This document tracks architecture, milestones, completed work, future ideas and release history.

---

# Project Vision

Boztik is more than a portfolio.

The long-term goal is to build an ecosystem for creative professionals that includes:

- Professional Portfolio
- Freelance Services
- Chrome Extension
- Client Delivery Platform (Boztik Deliver)
- Future Community Platform
- Future Freelancer Marketplace

Every component should strengthen the others.

---

# Current Version

v2.0.0 (Development)

---

# Current Phase

✅ Phase 1 — Website Architecture Audit

Status:
In Progress

---

# Development Principles

- Keep existing Boztik branding.
- Preserve current color palette.
- Mobile-first.
- Responsive.
- Modular JavaScript.
- Reusable CSS.
- No duplicated components.
- GitHub Pages compatible.
- Supabase compatible.
- Performance focused.
- Accessibility improvements where possible.

---

# Project Structure

(Current)

(To be documented during the architecture audit.)

---

# Planned Structure

/
│
├── index.html
├── about.html
├── portfolio.html
├── contact.html
│
├── deliver/
│   ├── index.html
│   ├── upload.html
│   ├── dashboard.html
│   ├── css/
│   ├── js/
│   └── assets/
│
├── assets/
├── css/
├── js/
└── images/

---

# Development Roadmap

## Phase 1

Website Architecture Audit

Objectives

- Audit all HTML pages
- Audit CSS
- Audit JavaScript
- Audit navigation
- Audit branding
- Audit performance
- Audit SEO
- Audit responsiveness

Deliverables

- Architecture report
- Folder recommendations
- Reusable components list
- Improvement plan

Status

In Progress

---

## Phase 2

Website Cleanup

Objectives

- Remove duplicated code
- Improve structure
- Improve SEO
- Improve accessibility
- Improve responsiveness
- Improve performance

---

## Phase 3

Boztik Deliver

Version 1

Features

- Secure Upload Dashboard
- Supabase Authentication
- ZIP Uploads
- Client Download Page
- Download Tracking
- Expiration Timer
- Delivery IDs
- Auto Delete
- Dashboard

---

## Phase 4

Marketing Integration

Client pages should promote

- Boztik Creative Toolkit
- Chrome Store
- Edge Store
- Portfolio
- Contact
- Hire Me
- PayPal
- Ko-fi
- Google Adsense

Without reducing usability.

---

## Phase 5

Performance & Polish

Objectives

- Speed improvements
- Image optimization
- Lighthouse improvements
- Accessibility improvements
- Animation polish

---

# Boztik Deliver

Mission

Replace Google Drive and WeTransfer with a professional branded delivery experience.

---

## Workflow

Client hires Boztik

↓

Project completed

↓

ZIP generated

↓

Upload to Supabase

↓

Generate Delivery ID

↓

Generate Client Link

↓

Client downloads

↓

Files automatically deleted after 24 hours

---

## Upload Dashboard

Private

Visible only to Clint.

Features

- Login
- Upload ZIP
- Client Name
- Project Name
- Notes
- Generate Delivery
- Copy Link
- Delete Delivery
- Download Stats
- Storage Usage

---

## Client Page

Displays

- Project Name
- Delivery ID
- File Size
- Expiration Countdown
- Download Button

Marketing

- Hire Me
- Portfolio
- Extension
- PayPal
- Ko-fi
- Adsense

---

## Security

Visitors

Cannot

- Upload
- Delete
- Edit
- Access Dashboard

Only authenticated admin may upload.

---

# Future Features

- Multiple Downloads
- Password Protection (Optional)
- Email Notifications
- Download Analytics
- Reviews
- Revision Requests
- Client Accounts
- Creator Accounts
- Marketplace Integration

---

# Release History

## v2.0.0

Project planning

Architecture audit

Roadmap created

---

# Ideas

This section is intentionally kept for future brainstorming.

Nothing is too small to add here.

---

# Notes

Always keep the website in a deployable state after every completed phase.

Never introduce duplicate code.

Prefer reusable components over new ones.

Every major feature should have its own commit.
