# Half-Hourly Energy Matching SaaS Demo

Clickable demo for demonstrating a half-hourly energy matching platform to
company stakeholders. The React frontend calls a Python matching API for file
validation and half-hourly allocation calculations.

## Prerequisites

- [Git](https://git-scm.com/downloads)
- [Node.js 20 or later](https://nodejs.org/) (npm is included)
- [Python 3.10 or later](https://www.python.org/downloads/)

No additional Python packages are required; the backend uses Python's standard
library.

## macOS Installation

### 1. Install the prerequisites

Install Git, Node.js and Python using their official installers, or with
[Homebrew](https://brew.sh/):

```bash
brew install git node python
```

Confirm that the commands are available:

```bash
git --version
node --version
npm --version
python3 --version
```

### 2. Download and prepare the project

```bash
git clone https://github.com/stefani-gh/MSIN0114EnergyMatchingSystem.git
cd MSIN0114EnergyMatchingSystem
npm install
npm run seed:templates
```

The template-seeding command creates the local SQLite database under
`server/data/`. The database is intentionally excluded from GitHub.

Create `login.txt` in the project root and add one account per line:

```text
username|password|admin|active
username|password|standard|active
```

On the first successful login, the backend automatically replaces each plain
password with a salted PBKDF2 hash. The local `login.txt` file is excluded from
GitHub and must not be committed.

### 3. Start the application

Open two Terminal windows or tabs in the project directory.

In the first terminal, start the Python backend:

```bash
npm run backend
```

In the second terminal, start the React frontend:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in a browser.

## Windows Installation

These instructions use PowerShell.

### 1. Install the prerequisites

Install:

- Git for Windows.
- The Node.js Long-Term Support (LTS) release.
- Python 3.10 or later.

When installing Python, select **Add Python to PATH**. Close and reopen
PowerShell after installation, then verify the tools:

```powershell
git --version
node --version
npm --version
py --version
```

If PowerShell prevents npm scripts from running, execute the following command
for the current user, then reopen PowerShell:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### 2. Download and prepare the project

```powershell
git clone https://github.com/stefani-gh/MSIN0114EnergyMatchingSystem.git
Set-Location MSIN0114EnergyMatchingSystem
npm install
py server/seed_template_db.py
```

Create a file named `login.txt` in the project root and add one account per
line:

```text
username|password|admin|active
username|password|standard|active
```

On first successful use, each plain password is automatically replaced with a
salted PBKDF2 hash. The file is excluded from GitHub and remains local.

The project npm scripts use the macOS/Linux command `python3`. Windows users
should therefore use the `py` commands shown in this guide for Python tasks.

### 3. Start the application

Open two PowerShell windows in the project directory.

In the first window, start the Python backend:

```powershell
py server/server.py
```

In the second window, start the React frontend:

```powershell
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in a browser.

## Local Services

| Service | Address | Purpose |
|---|---|---|
| React frontend | `http://localhost:5173` | User interface |
| Python API | `http://127.0.0.1:5174` | Validation, matching and local persistence |

Vite automatically proxies frontend requests beginning with `/api` to the
Python backend. Keep both terminal processes running while using the system.
Press `Ctrl+C` in each terminal to stop the services.

## Troubleshooting

### The frontend opens but API requests fail

Confirm that the Python backend is running and displays:

```text
Python template and matching API listening on http://127.0.0.1:5174
```

### Port 5173 or 5174 is already in use

Stop the previous frontend or backend process with `Ctrl+C`. The backend port
can also be changed before startup:

macOS:

```bash
PORT=5175 npm run backend
VITE_API_PROXY_TARGET=http://127.0.0.1:5175 npm run dev
```

Windows PowerShell:

```powershell
$env:PORT="5175"
py server/server.py
```

Then, in the second PowerShell window:

```powershell
$env:VITE_API_PROXY_TARGET="http://127.0.0.1:5175"
npm run dev
```

### Reset the local template database

Delete `server/data/template-store.sqlite`, then recreate it.

macOS:

```bash
npm run seed:templates
```

Windows:

```powershell
py server/seed_template_db.py
```

Deleting the database also removes locally stored calendar settings, customer
profiles and persistent test results.

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
- Supports half-hourly matching, hourly aggregation across each pair of
  half-hourly periods, and daily aggregation across all intervals on each
  spreadsheet date. Aggregate modes net consumption and allocated generation
  inside the selected period, irrespective of their order within that period.

## Admin Sub-Functions

- Manage Users: Add User modal with username duplication validation, email
  validation, role dropdown, full users table, edit, and delete actions.
- Manage Role: role-permission matrix with checkboxes held in local React state.
- Audit Log: mock audit table ordered as User, Action Performed, Details,
  Modified Date and Time, Created Date and Time.

## Available Commands

macOS/Linux npm commands:

```bash
npm install
npm run seed:templates
npm run backend
npm run dev
npm run build
npm run lint
```

Windows equivalents for the Python commands:

```powershell
py server/seed_template_db.py
py server/server.py
```

Generated files such as `dist/`, `node_modules/`, Python bytecode, and the
seeded SQLite template database are intentionally excluded from Git. Run
`npm run seed:templates` whenever a fresh local database is required.
