# Half-Hourly Energy Matching SaaS Demo

Clickable demo for demonstrating a half-hourly energy matching platform to
company stakeholders. The React frontend calls a Python matching API for file
validation and half-hourly allocation calculations.

## Prerequisites

- Node.js 20 or later
- npm
- Python 3.10 or later

## Run Locally

Install the frontend dependencies and create the local template database:

```bash
npm install
npm run seed:templates
```

Start the Python API in one terminal:

```bash
npm run backend
```

Start the Vite frontend in a second terminal:

```bash
npm run dev
```

Open `http://localhost:5173` in a browser. The API runs locally at
`http://127.0.0.1:5174` and is proxied by Vite during development.

This repository is a demonstration application. Its authentication, email,
administration, and persistence features should not be treated as
production-ready services.

## Stack

- React
- TypeScript
- Tailwind CSS
- React Router
- Recharts
- Vite
- Python
- SQLite

## Matching Model

- Implemented in Python in `server/matching_model.py`.
- Accepts `.xlsx` and `.csv` consumption/generation templates.
- Calculates allocated generation, matched energy, unmatched consumption,
  excess allocated generation, and matching percentage for every half-hourly
  interval.
- The React app sends uploaded files to `/api/matching/run` and stores the
  returned result for the Results screens.
- Supports non-carry-forward matching, hourly carry-forward matching within
  each pair of half-hourly periods, and daily carry-forward matching that
  resets at the end of every spreadsheet date.

## Admin Sub-Functions

- Manage Users: Add User modal with username duplication validation, email
  validation, role dropdown, full users table, edit, and delete actions.
- Manage Role: role-permission matrix with checkboxes held in local React state.
- Audit Log: mock audit table ordered as User, Action Performed, Details,
  Modified Date and Time, Created Date and Time.

## Available Commands

```bash
npm install
npm run seed:templates
npm run backend
npm run dev
npm run build
npm run lint
```

Generated files such as `dist/`, `node_modules/`, Python bytecode, and the
seeded SQLite template database are intentionally excluded from Git. Run
`npm run seed:templates` whenever a fresh local database is required.
