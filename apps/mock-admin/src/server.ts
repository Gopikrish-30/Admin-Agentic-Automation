import express, { type Request, type Response } from 'express';

interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: 'employee' | 'admin';
  active: boolean;
  license: 'none' | 'starter' | 'pro' | 'enterprise';
  lastPasswordResetAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface AuditEntry {
  id: string;
  action: string;
  detail: string;
  timestamp: string;
}

const app = express();
const port = Number(process.env.MOCK_ADMIN_PORT || 4010);

app.use(express.urlencoded({ extended: false }));

const users = new Map<string, UserRecord>();
const auditLog: AuditEntry[] = [];

seed();

function nowIso(): string {
  return new Date().toISOString();
}

function addAudit(action: string, detail: string): void {
  auditLog.unshift({
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    action,
    detail,
    timestamp: nowIso(),
  });
}

function layout(title: string, content: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root {
        --ink: #152338;
        --muted: #5b6f87;
        --line: #d9e3ef;
        --brand: #1e4ed8;
        --brand-strong: #173fae;
        --danger: #c62828;
      }
      * { box-sizing: border-box; }
      body {
        font-family: "DM Sans", "Avenir Next", "Segoe UI", sans-serif;
        margin: 0;
        color: var(--ink);
        min-height: 100vh;
        background:
          radial-gradient(1200px 550px at 5% -20%, #dbe8ff 0%, transparent 70%),
          radial-gradient(900px 500px at 95% -20%, #d8f3ff 0%, transparent 70%),
          linear-gradient(180deg, #f6f9ff, #edf3f9);
      }
      header {
        position: sticky;
        top: 0;
        z-index: 9;
        color: white;
        padding: 16px 18px;
        border-bottom: 1px solid rgba(198, 216, 246, 0.2);
        background: linear-gradient(135deg, rgba(20, 36, 58, 0.94), rgba(22, 58, 120, 0.9));
        backdrop-filter: blur(8px);
      }
      .header-wrap {
        max-width: 1180px;
        margin: 0 auto;
        display: grid;
        gap: 10px;
      }
      .brand {
        margin: 0;
        font-size: 21px;
        font-weight: 800;
        letter-spacing: 0.02em;
      }
      .subhead {
        margin: 4px 0 0;
        color: rgba(224, 237, 255, 0.88);
        font-size: 13px;
      }
      nav {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      nav a {
        color: #dceaff;
        text-decoration: none;
        font-weight: 700;
        font-size: 13px;
        border: 1px solid rgba(220, 234, 255, 0.3);
        border-radius: 999px;
        padding: 7px 12px;
        transition: transform 120ms ease, background-color 120ms ease;
      }
      nav a:hover {
        transform: translateY(-1px);
        background: rgba(228, 238, 255, 0.12);
      }
      nav a.active {
        background: #eff4ff;
        color: #0f2853;
        border-color: #eff4ff;
      }
      main {
        max-width: 1180px;
        margin: 20px auto;
        border-radius: 18px;
        padding: 22px;
        border: 1px solid var(--line);
        background: linear-gradient(180deg, #ffffff, #fbfdff);
        box-shadow: 0 12px 34px rgba(24, 50, 88, 0.12);
        animation: reveal-up 260ms ease-out;
      }
      @keyframes reveal-up {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .page-title { margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -0.015em; }
      .hint { color: var(--muted); font-size: 14px; margin: 6px 0 0; }
      .notice { background: linear-gradient(180deg, #f0fbf5, #e8f8f0); border: 1px solid #b9e5c8; border-radius: 12px; padding: 10px; margin: 14px 0; }
      .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
      .stat-card { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: #f8fbff; }
      .stat-label { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
      .stat-value { font-size: 24px; font-weight: 800; line-height: 1; }
      .toolbar { margin-top: 12px; display: flex; gap: 8px; align-items: center; justify-content: space-between; }
      .toolbar-actions { display: flex; gap: 8px; flex-shrink: 0; }
      .search-input { flex: 1; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; table-layout: fixed; }
      th, td { border-bottom: 1px solid #dde7f2; padding: 12px 10px; text-align: left; font-size: 14px; vertical-align: middle; }
      th { background: #f6faff; text-transform: uppercase; letter-spacing: 0.02em; font-size: 12px; color: #496389; }
      .users-table th:nth-child(1), .users-table td:nth-child(1) { width: 19%; }
      .users-table th:nth-child(2), .users-table td:nth-child(2) { width: 14%; }
      .users-table th:nth-child(3), .users-table td:nth-child(3) { width: 9%; }
      .users-table th:nth-child(4), .users-table td:nth-child(4) { width: 9%; }
      .users-table th:nth-child(5), .users-table td:nth-child(5) { width: 9%; }
      .users-table th:nth-child(6), .users-table td:nth-child(6) { width: 13%; }
      .users-table th:nth-child(7), .users-table td:nth-child(7) { width: 27%; }
      form.inline { display: inline-flex; align-items: center; gap: 6px; margin: 0; }
      .row-actions button, .btn, select, input { font-size: 13px; }
      button, .btn {
        border: 0;
        border-radius: 10px;
        padding: 8px 11px;
        background: linear-gradient(180deg, var(--brand), var(--brand-strong));
        color: white;
        cursor: pointer;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        transition: transform 120ms ease, box-shadow 120ms ease;
      }
      .btn.secondary { background: linear-gradient(180deg, #334a6c, #24364f); }
      .toolbar-actions .btn,
      .toolbar-actions button { min-width: 118px; }
      button:hover, .btn:hover { transform: translateY(-1px); box-shadow: 0 8px 18px rgba(23, 63, 176, 0.25); }
      button.danger { background: linear-gradient(180deg, #de4343, var(--danger)); }
      .pill { display: inline-block; border-radius: 999px; padding: 3px 8px; font-size: 12px; font-weight: 700; background: #eff4ff; border: 1px solid #d7e3f8; text-transform: capitalize; }
      .pill.status-active { color: #12724f; background: #e9f8f1; border-color: #c0e9d6; }
      .pill.status-inactive { color: #7c2430; background: #fcedef; border-color: #f1c9cf; }
      .pill.role-admin { color: #4937a5; background: #ece9ff; border-color: #d5cdf9; }
      .pill.license-enterprise { color: #1c4e89; background: #eaf5ff; border-color: #c9e1fb; }
      .table-wrap { overflow: auto; border: 1px solid var(--line); border-radius: 14px; background: #fff; margin-top: 12px; }
      .email-text { color: #1c3760; font-weight: 600; word-break: break-word; }
      .name-text { color: #152338; font-weight: 700; }
      .row-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .inline-license { flex: 1 1 230px; min-width: 220px; }
      .inline-license select { flex: 1; min-width: 92px; }
      .empty-row { color: var(--muted); padding: 14px 8px; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .create-form { max-width: 760px; }
      .field label { display: block; font-weight: 700; margin-bottom: 6px; }
      .field input, .field select, .search-input { width: 100%; box-sizing: border-box; border: 1px solid #c6d6e8; border-radius: 10px; padding: 9px; }
      .field input:focus, .field select:focus, .search-input:focus { outline: none; border-color: #7aa8ff; box-shadow: 0 0 0 3px rgba(74, 131, 244, 0.2); }
      .form-actions { display: flex; align-items: center; gap: 8px; }
      .form-actions.full-width { grid-column: 1 / -1; margin-top: 4px; }
      .visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
      @media (max-width: 960px) {
        .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .toolbar { flex-direction: column; align-items: stretch; }
        .toolbar-actions { width: 100%; }
        .toolbar-actions .btn,
        .toolbar-actions button { width: 100%; }
      }
      @media (max-width: 760px) {
        main { margin: 0; border-radius: 0; border-left: 0; border-right: 0; }
        .grid, .stats { grid-template-columns: 1fr; }
        .create-form { max-width: none; }
        table, thead, tbody, th, td, tr { display: block; }
        th { display: none; }
        td { border-bottom: 0; }
        tr { border-bottom: 1px solid #dde7f2; margin-bottom: 10px; padding-bottom: 10px; }
        .row-actions { display: grid; grid-template-columns: 1fr; }
        .inline-license { min-width: 0; }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="header-wrap">
        <h2 class="brand">Mock Admin Control Panel</h2>
        <p class="subhead">Manage accounts, licenses, and audit trails in one place.</p>
        <nav>
          <a class="${title === 'Mock Admin Panel' ? 'active' : ''}" href="/">Dashboard</a>
          <a class="${title === 'Create User' ? 'active' : ''}" href="/users/new">Create User</a>
          <a class="${title === 'Audit Log' ? 'active' : ''}" href="/audit">Audit Log</a>
        </nav>
      </div>
    </header>
    <main>${content}</main>
  </body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function statusPillClass(active: boolean): string {
  return active ? 'status-active' : 'status-inactive';
}

function rolePillClass(role: UserRecord['role']): string {
  return role === 'admin' ? 'role-admin' : '';
}

function licensePillClass(license: UserRecord['license']): string {
  return license === 'enterprise' ? 'license-enterprise' : '';
}

function findByEmail(email: string): UserRecord | undefined {
  const normalized = email.trim().toLowerCase();
  for (const user of users.values()) {
    if (user.email.toLowerCase() === normalized) {
      return user;
    }
  }
  return undefined;
}

function seed(): void {
  const initial: Array<Omit<UserRecord, 'id' | 'createdAt' | 'updatedAt'>> = [
    {
      email: 'john@company.com',
      name: 'John Carter',
      role: 'employee',
      active: true,
      license: 'starter',
      lastPasswordResetAt: undefined,
    },
    {
      email: 'lina.admin@company.com',
      name: 'Lina Admin',
      role: 'admin',
      active: true,
      license: 'enterprise',
      lastPasswordResetAt: undefined,
    },
  ];

  for (const item of initial) {
    const id = cryptoRandomId();
    users.set(id, {
      id,
      ...item,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

app.get('/', (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const notice = typeof req.query.notice === 'string' ? req.query.notice : '';
  const allUsers = [...users.values()];

  const filteredUsers = allUsers.filter((u) => {
    if (!q) {
      return true;
    }
    return (
      u.email.toLowerCase().includes(q) ||
      u.name.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q) ||
      u.license.toLowerCase().includes(q)
    );
  });

  const userRows = filteredUsers
    .map((u) => {
      return `<tr>
        <td><span class="email-text">${escapeHtml(u.email)}</span></td>
        <td><span class="name-text">${escapeHtml(u.name)}</span></td>
        <td><span class="pill ${rolePillClass(u.role)}">${escapeHtml(u.role)}</span></td>
        <td><span class="pill ${licensePillClass(u.license)}">${escapeHtml(u.license)}</span></td>
        <td><span class="pill ${statusPillClass(u.active)}">${u.active ? 'Active' : 'Inactive'}</span></td>
        <td>${u.lastPasswordResetAt ? escapeHtml(u.lastPasswordResetAt) : '-'}</td>
        <td class="row-actions">
          <form class="inline" action="/users/${encodeURIComponent(u.id)}/reset-password" method="post">
            <button type="submit">Reset Password</button>
          </form>
          <form class="inline inline-license" action="/users/${encodeURIComponent(u.id)}/license" method="post">
            <select name="license" aria-label="License level">
              <option value="none" ${u.license === 'none' ? 'selected' : ''}>None</option>
              <option value="starter" ${u.license === 'starter' ? 'selected' : ''}>Starter</option>
              <option value="pro" ${u.license === 'pro' ? 'selected' : ''}>Pro</option>
              <option value="enterprise" ${u.license === 'enterprise' ? 'selected' : ''}>Enterprise</option>
            </select>
            <button type="submit">Update License</button>
          </form>
          <form class="inline" action="/users/${encodeURIComponent(u.id)}/toggle" method="post">
            <button type="submit">${u.active ? 'Deactivate' : 'Activate'}</button>
          </form>
          <form class="inline" action="/users/${encodeURIComponent(u.id)}/delete" method="post">
            <button type="submit" class="danger">Delete</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');

  const activeCount = allUsers.filter((u) => u.active).length;
  const adminCount = allUsers.filter((u) => u.role === 'admin').length;
  const enterpriseCount = allUsers.filter((u) => u.license === 'enterprise').length;

  const content = `
    <h1 class="page-title">User Administration</h1>
    <p class="hint">Use this panel to create users, reset passwords, assign licenses, and remove accounts.</p>
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Total Users</div>
        <div class="stat-value">${allUsers.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Accounts</div>
        <div class="stat-value">${activeCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Admins</div>
        <div class="stat-value">${adminCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Enterprise Licenses</div>
        <div class="stat-value">${enterpriseCount}</div>
      </div>
    </div>
    ${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}
    <form action="/" method="get" class="toolbar">
      <label for="search" class="visually-hidden">Search users</label>
      <input id="search" class="search-input" name="q" value="${escapeHtml(q)}" placeholder="Search by email, name, role, license" />
      <div class="toolbar-actions">
        <button type="submit">Search</button>
        <a class="btn secondary" href="/users/new">Create User</a>
      </div>
    </form>
    <div class="table-wrap">
      <table class="users-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Role</th>
            <th>License</th>
            <th>Status</th>
            <th>Last Password Reset</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filteredUsers.length > 0 ? userRows : '<tr><td class="empty-row" colspan="7">No users found.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  res.send(layout('Mock Admin Panel', content));
});

app.get('/users/new', (_req: Request, res: Response) => {
  const content = `
    <h1 class="page-title">Create User</h1>
    <p class="hint">Add a new account and assign the right role and license from day one.</p>
    <form action="/users" method="post" class="grid create-form">
      <div class="field">
        <label for="email">Email</label>
        <input id="email" name="email" type="email" required />
      </div>
      <div class="field">
        <label for="name">Full Name</label>
        <input id="name" name="name" required />
      </div>
      <div class="field">
        <label for="role">Role</label>
        <select id="role" name="role">
          <option value="employee">Employee</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div class="field">
        <label for="license">Initial License</label>
        <select id="license" name="license">
          <option value="none">None</option>
          <option value="starter">Starter</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>
      <div class="form-actions full-width">
        <button type="submit">Create User</button>
        <a class="btn secondary" href="/">Back to Dashboard</a>
      </div>
    </form>
  `;

  res.send(layout('Create User', content));
});

app.post('/users', (req: Request, res: Response) => {
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();
  const name = String(req.body.name || '').trim();
  const role = req.body.role === 'admin' ? 'admin' : 'employee';
  const license = parseLicense(req.body.license);

  if (!email || !name) {
    return res.redirect(
      '/?notice=' + encodeURIComponent('Creation failed: name and email are required.'),
    );
  }

  const existing = findByEmail(email);
  if (existing) {
    return res.redirect('/?notice=' + encodeURIComponent(`User already exists: ${email}`));
  }

  const id = cryptoRandomId();
  const user: UserRecord = {
    id,
    email,
    name,
    role,
    license,
    active: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  users.set(id, user);
  addAudit('CREATE_USER', `Created ${email} with role=${role}, license=${license}`);
  return res.redirect('/?notice=' + encodeURIComponent(`User created: ${email}`));
});

app.post('/users/:id/reset-password', (req: Request, res: Response) => {
  const userId = getParamId(req.params.id);
  const user = users.get(userId);
  if (!user) {
    return res.redirect('/?notice=' + encodeURIComponent('Reset failed: user not found.'));
  }

  user.lastPasswordResetAt = nowIso();
  user.updatedAt = nowIso();
  addAudit('RESET_PASSWORD', `Reset password for ${user.email}`);
  return res.redirect('/?notice=' + encodeURIComponent(`Password reset for ${user.email}`));
});

app.post('/users/:id/license', (req: Request, res: Response) => {
  const userId = getParamId(req.params.id);
  const user = users.get(userId);
  if (!user) {
    return res.redirect('/?notice=' + encodeURIComponent('License update failed: user not found.'));
  }

  const nextLicense = parseLicense(req.body.license);
  user.license = nextLicense;
  user.updatedAt = nowIso();
  addAudit('ASSIGN_LICENSE', `Assigned ${nextLicense} license to ${user.email}`);
  return res.redirect('/?notice=' + encodeURIComponent(`License updated for ${user.email}`));
});

app.post('/users/:id/toggle', (req: Request, res: Response) => {
  const userId = getParamId(req.params.id);
  const user = users.get(userId);
  if (!user) {
    return res.redirect('/?notice=' + encodeURIComponent('Status update failed: user not found.'));
  }

  user.active = !user.active;
  user.updatedAt = nowIso();
  addAudit('TOGGLE_USER', `${user.active ? 'Activated' : 'Deactivated'} ${user.email}`);
  return res.redirect(
    '/?notice=' +
      encodeURIComponent(`User ${user.active ? 'activated' : 'deactivated'}: ${user.email}`),
  );
});

app.post('/users/:id/delete', (req: Request, res: Response) => {
  const userId = getParamId(req.params.id);
  const user = users.get(userId);
  if (!user) {
    return res.redirect('/?notice=' + encodeURIComponent('Delete failed: user not found.'));
  }

  users.delete(userId);
  addAudit('DELETE_USER', `Deleted ${user.email}`);
  return res.redirect('/?notice=' + encodeURIComponent(`Deleted user: ${user.email}`));
});

app.get('/audit', (_req: Request, res: Response) => {
  const rows = auditLog
    .map((entry) => {
      return `<tr>
        <td>${escapeHtml(entry.timestamp)}</td>
        <td>${escapeHtml(entry.action)}</td>
        <td>${escapeHtml(entry.detail)}</td>
      </tr>`;
    })
    .join('');

  const content = `
    <h1 class="page-title">Audit Log</h1>
    <p class="hint">Recent administrative actions are listed below.</p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time (UTC)</th>
            <th>Action</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td class="empty-row" colspan="3">No audit records yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  res.send(layout('Audit Log', content));
});

function parseLicense(value: unknown): UserRecord['license'] {
  switch (String(value || '').toLowerCase()) {
    case 'starter':
      return 'starter';
    case 'pro':
      return 'pro';
    case 'enterprise':
      return 'enterprise';
    default:
      return 'none';
  }
}

function getParamId(rawId: string | string[] | undefined): string {
  if (Array.isArray(rawId)) {
    return rawId[0] || '';
  }
  return rawId || '';
}

app.listen(port, () => {
  console.log(`[Mock Admin] running on http://127.0.0.1:${port}`);
});
