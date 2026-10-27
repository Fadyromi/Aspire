/* Aspire CRM - front-end (vanilla JS + Supabase). No build step needed. */
(() => {
  'use strict';

  // ------------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------------
  const cfg = window.APP_CONFIG || {};

  // Pipeline order: New -> Not Reached / Contacted -> Interested -> Negotiating -> Signed | Not Interested
  const STATUSES = [
    { key: 'new',            label: 'New',            color: '#64748b' },
    { key: 'not_reached',    label: 'Not Reached',    color: '#94a3b8' },
    { key: 'contacted',      label: 'Contacted',      color: '#2563eb' },
    { key: 'interested',     label: 'Interested',     color: '#0d9488' },
    { key: 'negotiating',    label: 'Negotiating',    color: '#d97706' },
    { key: 'signed',         label: 'Signed',         color: '#16a34a' },
    { key: 'not_interested', label: 'Not Interested', color: '#dc2626' },
  ];
  const STATUS = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
  const CLOSED = ['signed', 'not_interested'];
  const ROLE_LABEL = { super_admin: 'Super Admin', supervisor: 'Supervisor', employee: 'Employee' };
  const SOURCES = ['Facebook', 'Seminar', 'Referral', 'Website', 'Walk-in', 'Other'];
  const PAGE_SIZE = 50;

  const ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    leads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7" r="4"/><path d="M21 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4z"/><path d="M9 12l2 2 4-4"/></svg>',
  };

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = document.getElementById('app');

  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const todayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
  const fmtDate = (d) => {
    if (!d) return '';
    const dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fmtDateTime = (d) =>
    new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const fmtMoney = (n) =>
    n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const initials = (name) =>
    (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  const digits = (s) => String(s || '').replace(/\D/g, '');

  function toast(msg, isErr = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), isErr ? 6000 : 3200);
  }

  function friendly(err) {
    const m = (err && err.message) || String(err);
    if (/no rows|multiple \(or no\) rows|JSON object requested/i.test(m)) return "You don't have permission to change that lead.";
    if (/row-level security|violates row-level/i.test(m)) return "You don't have permission to do that.";
    if (/Failed to fetch|NetworkError/i.test(m)) return 'Network problem - check your connection and try again.';
    return m;
  }

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------
  let sb = null;
  const state = {
    user: null,
    me: null,
    profiles: [],
    pmap: {},
    leads: [],
    filters: { q: '', status: '', assignee: '', source: '' },
    page: 1,
    selected: new Set(),
  };

  const isAdmin = () => state.me && state.me.role === 'super_admin';
  const canAssign = () => state.me && state.me.role !== 'employee';
  const nameOf = (id) => (id && state.pmap[id] ? state.pmap[id].full_name || state.pmap[id].email : '');

  // ------------------------------------------------------------------
  // Modal / confirm helpers
  // ------------------------------------------------------------------
  function openModal({ title, body, submitLabel = 'Save', danger = false, wide = false, onSubmit, hideSubmit = false }) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `
      <form class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <header><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-close aria-label="Close">&times;</button></header>
        <div class="modal-body">${body}</div>
        <footer>
          <div class="form-error" hidden></div>
          <button type="button" class="btn ghost" data-close>Cancel</button>
          ${hideSubmit ? '' : `<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submitLabel)}</button>`}
        </footer>
      </form>`;
    document.body.appendChild(wrap);
    const form = $('form', wrap);
    const errBox = $('.form-error', wrap);
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
    $$('[data-close]', wrap).forEach((b) => b.addEventListener('click', close));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const btn = $('button[type=submit]', form);
      if (btn) btn.disabled = true;
      try {
        await onSubmit(form);
        close();
      } catch (err) {
        errBox.textContent = friendly(err);
        errBox.hidden = false;
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    const first = $('input:not([type=hidden]), select, textarea', form);
    if (first) first.focus();
    return { close, form };
  }

  function confirmDialog(title, message, okLabel = 'Delete') {
    return new Promise((resolve) => {
      let done = false;
      const m = openModal({
        title,
        body: `<p style="margin:0 0 14px">${esc(message)}</p>`,
        submitLabel: okLabel,
        danger: true,
        onSubmit: async () => { done = true; resolve(true); },
      });
      const obs = new MutationObserver(() => {
        if (!document.body.contains(m.form)) { obs.disconnect(); if (!done) resolve(false); }
      });
      obs.observe(document.body, { childList: true });
    });
  }

  // ------------------------------------------------------------------
  // Boot / auth
  // ------------------------------------------------------------------
  async function boot() {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      renderLogin('Setup needed: open config.js and paste your Supabase URL and anon key (see README.md).');
      return;
    }
    if (!window.supabase) {
      renderLogin('Could not load the Supabase library. Check your internet connection and refresh.');
      return;
    }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    sb.auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_OUT') { state.user = null; state.me = null; renderLogin(); }
    });
    app.innerHTML = '<div class="loading">Loading…</div>';
    const { data } = await sb.auth.getSession();
    if (data && data.session) await enter(data.session.user);
    else renderLogin();
  }

  async function enter(user) {
    try {
      state.user = user;
      const { data: me, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
      if (error || !me || !me.active) {
        await sb.auth.signOut();
        renderLogin('This account is inactive or has no access. Please contact your administrator.');
        return;
      }
      state.me = me;
      await Promise.all([loadProfiles(), loadLeads()]);
      renderShell();
      route();
    } catch (err) {
      await sb.auth.signOut();
      renderLogin(friendly(err));
    }
  }

  function renderLogin(message = '') {
    const isSetup = message.startsWith('Setup needed');
    app.innerHTML = `
      <div class="login-wrap">
        <section class="login-art">
          <div class="logo-chip"><img src="logo.png" alt="Aspire Securities &amp; Bonds"></div>
          <div>
            <h2>Every lead, every follow-up, one pipeline.</h2>
            <p>Aspire's internal client-acquisition workspace. Authorised staff only.</p>
          </div>
          <small style="color:#8f99d6">&copy; ${new Date().getFullYear()} Aspire Securities &amp; Bonds</small>
        </section>
        <section class="login-form-side">
          <form class="login-card" id="loginForm">
            <h1>Sign in</h1>
            <p class="sub">Use the account your administrator created for you.</p>
            ${message ? `<div class="${isSetup ? 'notice' : 'form-error'}" style="margin-bottom:14px">${esc(message)}</div>` : ''}
            <label class="field">Email<input type="email" name="email" autocomplete="username" required ${isSetup ? 'disabled' : ''}></label>
            <label class="field">Password<input type="password" name="password" autocomplete="current-password" required ${isSetup ? 'disabled' : ''}></label>
            <div class="form-error" id="loginErr" hidden></div>
            <button class="btn primary" type="submit" ${isSetup ? 'disabled' : ''}>Sign in</button>
          </form>
        </section>
      </div>`;
    const form = $('#loginForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!sb) return;
      const btn = $('button', form);
      const err = $('#loginErr');
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      const { data, error } = await sb.auth.signInWithPassword({
        email: form.email.value.trim(),
        password: form.password.value,
      });
      if (error) {
        err.textContent = /invalid login/i.test(error.message) ? 'Wrong email or password.' : friendly(error);
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Sign in';
        return;
      }
      await enter(data.user);
    });
  }

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------
  async function loadProfiles() {
    const { data, error } = await sb.from('profiles').select('*').order('full_name');
    if (error) throw error;
    state.profiles = data;
    state.pmap = Object.fromEntries(data.map((p) => [p.id, p]));
  }

  async function loadLeads() {
    const size = 1000;
    let all = [];
    for (let from = 0; ; from += size) {
      const { data, error } = await sb
        .from('leads').select('*').order('created_at', { ascending: false }).range(from, from + size - 1);
      if (error) throw error;
      all = all.concat(data);
      if (data.length < size) break;
    }
    state.leads = all;
  }

  async function updateLead(id, patch) {
    const { data, error } = await sb.from('leads').update(patch).eq('id', id).select().single();
    if (error) throw error;
    const i = state.leads.findIndex((l) => l.id === id);
    if (i >= 0) state.leads[i] = data;
    return data;
  }

  async function callAdmin(body) {
    const { data, error } = await sb.functions.invoke('admin-users', { body });
    if (error) {
      let msg = error.message;
      try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch (_) { /* ignore */ }
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  // ------------------------------------------------------------------
  // Shell + routing
  // ------------------------------------------------------------------
  function renderShell() {
    const me = state.me;
    app.innerHTML = `
      <div class="shell">
        <aside class="side">
          <div class="brand"><img src="logo.png" alt="Aspire Securities &amp; Bonds"></div>
          <nav class="nav" aria-label="Main">
            <a href="#/dashboard" data-route="dashboard">${ICONS.dashboard}Dashboard</a>
            <a href="#/leads" data-route="leads">${ICONS.leads}Leads</a>
            ${isAdmin() ? `<a href="#/team" data-route="team">${ICONS.team}Team</a>` : ''}
          </nav>
          <div class="side-foot">
            <div class="me">
              <div class="avatar">${esc(initials(me.full_name))}</div>
              <div><b>${esc(me.full_name || me.email)}</b><small>${esc(ROLE_LABEL[me.role])}</small></div>
            </div>
            <button class="btn sm" id="btnPwd">Change password</button>
            <button class="btn sm" id="btnOut">Sign out</button>
          </div>
        </aside>
        <div class="main">
          <header class="top"><h1 id="pageTitle"></h1><span class="date">${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</span></header>
          <main id="view"></main>
        </div>
      </div>`;
    $('#btnOut').addEventListener('click', () => sb.auth.signOut());
    $('#btnPwd').addEventListener('click', changeOwnPassword);
    window.removeEventListener('hashchange', route);
    window.addEventListener('hashchange', route);
  }

  function route() {
    if (!state.me) return;
    let name = (location.hash.replace('#/', '') || 'dashboard').split('?')[0];
    if (!['dashboard', 'leads', 'team'].includes(name)) name = 'dashboard';
    if (name === 'team' && !isAdmin()) name = 'dashboard';
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
    const titles = { dashboard: state.me.role === 'employee' ? 'My dashboard' : 'Dashboard', leads: 'Leads', team: 'Team' };
    $('#pageTitle').textContent = titles[name];
    document.title = `${titles[name]} · Aspire CRM`;
    if (name === 'dashboard') renderDashboard();
    if (name === 'leads') renderLeadsPage();
    if (name === 'team') renderTeamPage();
  }

  function changeOwnPassword() {
    openModal({
      title: 'Change password',
      submitLabel: 'Update password',
      body: `
        <label class="field">New password<input type="password" name="p1" minlength="8" autocomplete="new-password" required></label>
        <label class="field">Repeat new password<input type="password" name="p2" minlength="8" autocomplete="new-password" required></label>`,
      onSubmit: async (f) => {
        if (f.p1.value !== f.p2.value) throw new Error('Passwords do not match.');
        const { error } = await sb.auth.updateUser({ password: f.p1.value });
        if (error) throw error;
        toast('Password updated');
      },
    });
  }

  // ------------------------------------------------------------------
  // Dashboard
  // ------------------------------------------------------------------
  function dueLeads() {
    const t = todayStr();
    return state.leads
      .filter((l) => l.next_follow_up && l.next_follow_up <= t && !CLOSED.includes(l.status))
      .sort((a, b) => a.next_follow_up.localeCompare(b.next_follow_up));
  }

  function renderDashboard() {
    const L = state.leads;
    const by = (k) => L.filter((l) => l.status === k).length;
    const due = dueLeads();
    const total = L.length;
    const max = Math.max(1, ...STATUSES.map((s) => by(s.key)));

    const funnel = STATUSES.map((s) => {
      const n = by(s.key);
      return `<div class="funnel-row">
        <button data-status="${s.key}" title="View ${esc(s.label)} leads">${esc(s.label)}</button>
        <div class="bar"><i style="width:${(n / max) * 100}%;background:${s.color}"></i></div>
        <small>${n}${total ? ` · ${Math.round((n / total) * 100)}%` : ''}</small>
      </div>`;
    }).join('');

    let team = '';
    if (canAssign()) {
      const rows = state.profiles
        .filter((p) => p.active && p.role !== 'super_admin')
        .map((p) => {
          const mine = L.filter((l) => l.assigned_to === p.id);
          const c = (k) => mine.filter((l) => l.status === k).length;
          const rate = mine.length ? Math.round((c('signed') / mine.length) * 100) : 0;
          return `<tr>
            <td><b>${esc(p.full_name || p.email)}</b><div class="sub">${esc(ROLE_LABEL[p.role])}</div></td>
            <td class="num">${mine.length}</td><td class="num">${c('interested')}</td>
            <td class="num">${c('negotiating')}</td><td class="num">${c('signed')}</td><td class="num">${rate}%</td></tr>`;
        });
      const un = L.filter((l) => !l.assigned_to);
      if (un.length) {
        rows.push(`<tr><td><b>Unassigned</b></td><td class="num">${un.length}</td>
          <td class="num">${un.filter((l) => l.status === 'interested').length}</td>
          <td class="num">${un.filter((l) => l.status === 'negotiating').length}</td>
          <td class="num">${un.filter((l) => l.status === 'signed').length}</td><td class="num">-</td></tr>`);
      }
      team = `<div class="card"><header><h2>Team performance</h2></header>
        <div class="table-wrap"><table><thead><tr><th>Member</th><th class="num">Leads</th><th class="num">Interested</th><th class="num">Negotiating</th><th class="num">Signed</th><th class="num">Conversion</th></tr></thead>
        <tbody>${rows.join('') || '<tr><td colspan="6" class="empty">No team members yet.</td></tr>'}</tbody></table></div></div>`;
    }

    const dueRows = due.slice(0, 8).map((l) => {
      const over = l.next_follow_up < todayStr();
      return `<tr><td><button class="link" data-open="${l.id}">${esc(l.full_name)}</button><div class="sub">${esc(l.phone || '')}</div></td>
        <td><span class="pill" style="--c:${STATUS[l.status].color}">${esc(STATUS[l.status].label)}</span></td>
        <td class="${over ? 'due-overdue' : 'due-today'}">${over ? 'Overdue · ' : 'Today · '}${esc(fmtDate(l.next_follow_up))}</td></tr>`;
    }).join('');

    $('#view').innerHTML = `
      <section class="page">
        <div class="stats">
          <div class="stat"><span>Total leads</span><b>${total}</b></div>
          <div class="stat"><span>Interested</span><b>${by('interested')}</b></div>
          <div class="stat"><span>Negotiating</span><b>${by('negotiating')}</b></div>
          <div class="stat"><span>Signed</span><b>${by('signed')}</b><i>${total ? Math.round((by('signed') / total) * 100) : 0}% of all leads</i></div>
          <div class="stat ${due.length ? 'hot' : ''}"><span>Follow-ups due</span><b>${due.length}</b><i>today or overdue</i></div>
        </div>
        <div class="cols">
          <div class="card"><header><h2>Pipeline</h2></header><div class="body">${funnel}</div></div>
          <div class="card"><header><h2>Follow-ups due</h2></header>
            ${due.length
              ? `<div class="table-wrap"><table><tbody>${dueRows}</tbody></table></div>${due.length > 8 ? `<div class="table-foot"><span>+ ${due.length - 8} more</span></div>` : ''}`
              : '<div class="empty">Nothing due. You are all caught up.</div>'}
          </div>
        </div>
        ${team}
      </section>`;

    $$('[data-status]', $('#view')).forEach((b) =>
      b.addEventListener('click', () => {
        state.filters = { q: '', status: b.dataset.status, assignee: '', source: '' };
        state.page = 1;
        location.hash = '#/leads';
      }));
    $$('[data-open]', $('#view')).forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.open)));
  }

  // ------------------------------------------------------------------
  // Leads page
  // ------------------------------------------------------------------
  function assigneeOptions(selected, { none = 'Unassigned' } = {}) {
    const opts = state.profiles
      .filter((p) => p.active || p.id === selected)
      .map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.full_name || p.email)}${p.role !== 'employee' ? ` (${esc(ROLE_LABEL[p.role])})` : ''}</option>`)
      .join('');
    return `<option value="">${esc(none)}</option>${opts}`;
  }

  function statusOptions(selected) {
    return STATUSES.map((s) => `<option value="${s.key}" ${s.key === selected ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
  }

  function filteredLeads() {
    const { q, status, assignee, source } = state.filters;
    const s = q.trim().toLowerCase();
    return state.leads.filter((l) => {
      if (status && l.status !== status) return false;
      if (source && (l.source || '') !== source) return false;
      if (assignee === '__none') { if (l.assigned_to) return false; }
      else if (assignee && l.assigned_to !== assignee) return false;
      if (s) {
        const hay = [l.full_name, l.phone, l.email, l.source].join(' ').toLowerCase();
        if (!hay.includes(s) && !(digits(s) && digits(l.phone).includes(digits(s)))) return false;
      }
      return true;
    });
  }

  function renderLeadsPage() {
    const assign = canAssign();
    const sources = Array.from(new Set(state.leads.map((l) => l.source).filter(Boolean))).sort();
    $('#view').innerHTML = `
      <section class="page">
        <div class="pipeline" id="pipe"></div>
        <div class="toolbar">
          <input type="search" id="fQ" placeholder="Search name, phone, email…" value="${esc(state.filters.q)}" aria-label="Search leads">
          <select id="fSource" aria-label="Filter by source"><option value="">All sources</option>${sources.map((s) => `<option ${s === state.filters.source ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          ${assign ? `<select id="fAssignee" aria-label="Filter by assignee"><option value="">All assignees</option><option value="__none" ${state.filters.assignee === '__none' ? 'selected' : ''}>Unassigned</option>${state.profiles.filter((p) => p.role !== 'super_admin' || state.leads.some((l) => l.assigned_to === p.id)).map((p) => `<option value="${p.id}" ${state.filters.assignee === p.id ? 'selected' : ''}>${esc(p.full_name || p.email)}</option>`).join('')}</select>` : ''}
          <span class="spacer"></span>
          <button class="btn ghost" id="btnExport">Export CSV</button>
          <button class="btn ghost" id="btnImport">Import CSV</button>
          <button class="btn primary" id="btnAdd">+ New lead</button>
        </div>
        <div class="bulk" id="bulk" hidden>
          <span id="bulkCount"></span>
          <select id="bulkAssignee" aria-label="Assign selected leads to">${assigneeOptions('', { none: 'Unassign' })}</select>
          <button class="btn" id="bulkApply">Assign selected</button>
          <span class="spacer"></span>
          <button class="btn" id="bulkClear">Clear</button>
        </div>
        <div class="table-card">
          <div class="table-wrap">
            <table>
              <thead><tr>
                ${assign ? '<th class="chk"><input type="checkbox" id="selAll" aria-label="Select all on this page"></th>' : ''}
                <th>Lead</th><th>Phone</th><th>Source</th><th class="num">Capital (EGP)</th><th>Status</th><th>Assigned to</th><th>Follow-up</th>
              </tr></thead>
              <tbody id="rows"></tbody>
            </table>
          </div>
          <div class="table-foot"><span id="foot"></span><div class="pager" id="pager"></div></div>
        </div>
      </section>`;


    $('#fQ').addEventListener('input', (e) => { state.filters.q = e.target.value; state.page = 1; renderRows(); });
    $('#fSource').addEventListener('change', (e) => { state.filters.source = e.target.value; state.page = 1; renderRows(); });
    if (assign) $('#fAssignee').addEventListener('change', (e) => { state.filters.assignee = e.target.value; state.page = 1; renderRows(); });
    $('#btnAdd').addEventListener('click', addLeadModal);
    $('#btnImport').addEventListener('click', importModal);
    $('#btnExport').addEventListener('click', exportCsv);

    const rows = $('#rows');
    rows.addEventListener('click', (e) => {
      const b = e.target.closest('[data-open]');
      if (b) openDrawer(b.dataset.open);
    });
    rows.addEventListener('change', async (e) => {
      const t = e.target;
      const tr = t.closest('tr');
      if (!tr) return;
      const id = tr.dataset.id;
      if (t.dataset.act === 'sel') {
        t.checked ? state.selected.add(id) : state.selected.delete(id);
        updateBulk();
      } else if (t.dataset.act === 'status') {
        try { await updateLead(id, { status: t.value }); toast('Status updated'); renderPipeline(); renderRows(); }
        catch (err) { toast(friendly(err), true); renderRows(); }
      } else if (t.dataset.act === 'assign') {
        try { await updateLead(id, { assigned_to: t.value || null }); toast('Lead assigned'); renderRows(); }
        catch (err) { toast(friendly(err), true); renderRows(); }
      }
    });
    if (assign) {
      $('#selAll').addEventListener('change', (e) => {
        pageSlice().forEach((l) => (e.target.checked ? state.selected.add(l.id) : state.selected.delete(l.id)));
        renderRows();
      });
      $('#bulkClear').addEventListener('click', () => { state.selected.clear(); renderRows(); });
      $('#bulkApply').addEventListener('click', bulkAssign);
    }
    renderPipeline();
    renderRows();
  }

  function pageSlice() {
    const list = filteredLeads();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    return list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
  }

  function renderPipeline() {
    const el = $('#pipe');
    if (!el) return;
    const counts = {};
    state.leads.forEach((l) => { counts[l.status] = (counts[l.status] || 0) + 1; });
    el.innerHTML =
      `<button class="chip ${state.filters.status === '' ? 'on' : ''}" data-s=""><i></i>All <b>${state.leads.length}</b></button>` +
      STATUSES.map((s) => `<button class="chip ${state.filters.status === s.key ? 'on' : ''}" style="--c:${s.color}" data-s="${s.key}"><i></i>${esc(s.label)} <b>${counts[s.key] || 0}</b></button>`).join('');
    $$('.chip', el).forEach((c) =>
      c.addEventListener('click', () => { state.filters.status = c.dataset.s; state.page = 1; renderPipeline(); renderRows(); }));
  }

  function renderRows() {
    const tbody = $('#rows');
    if (!tbody) return;
    const assign = canAssign();
    const list = filteredLeads();
    const slice = pageSlice();
    const t = todayStr();
    const cols = assign ? 8 : 7;

    tbody.innerHTML = slice.length
      ? slice.map((l) => {
          const st = STATUS[l.status] || STATUS.new;
          const dueCls = l.next_follow_up && !CLOSED.includes(l.status)
            ? (l.next_follow_up < t ? 'due-overdue' : l.next_follow_up === t ? 'due-today' : '') : '';
          return `<tr data-id="${l.id}">
            ${assign ? `<td class="chk"><input type="checkbox" data-act="sel" aria-label="Select ${esc(l.full_name)}" ${state.selected.has(l.id) ? 'checked' : ''}></td>` : ''}
            <td><button class="link" data-open="${l.id}">${esc(l.full_name)}</button>${l.email ? `<div class="sub">${esc(l.email)}</div>` : ''}</td>
            <td class="mono">${l.phone ? `<a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>` : '<span class="muted">-</span>'}</td>
            <td>${esc(l.source || '')}</td>
            <td class="num">${esc(fmtMoney(l.expected_capital))}</td>
            <td><select class="sel-status" style="--c:${st.color}" data-act="status" aria-label="Status of ${esc(l.full_name)}">${statusOptions(l.status)}</select></td>
            <td>${assign
              ? `<select class="sel-assign" data-act="assign" aria-label="Assign ${esc(l.full_name)}">${assigneeOptions(l.assigned_to)}</select>`
              : esc(nameOf(l.assigned_to))}</td>
            <td class="${dueCls}">${esc(fmtDate(l.next_follow_up)) || '<span class="muted">-</span>'}</td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="${cols}" class="empty">${state.leads.length ? 'No leads match these filters.' : 'No leads yet. Add one or import a CSV to get started.'}</td></tr>`;

    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    $('#foot').textContent = `${list.length} lead${list.length === 1 ? '' : 's'}`;
    $('#pager').innerHTML = pages > 1
      ? `<button class="btn sm" id="pPrev" ${state.page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${state.page} of ${pages}</span><button class="btn sm" id="pNext" ${state.page >= pages ? 'disabled' : ''}>Next</button>`
      : '';
    const prev = $('#pPrev'), next = $('#pNext');
    if (prev) prev.addEventListener('click', () => { state.page--; renderRows(); });
    if (next) next.addEventListener('click', () => { state.page++; renderRows(); });

    if (assign) {
      const all = $('#selAll');
      if (all) all.checked = slice.length > 0 && slice.every((l) => state.selected.has(l.id));
      updateBulk();
    }
  }

  function updateBulk() {
    const bulk = $('#bulk');
    if (!bulk) return;
    bulk.hidden = state.selected.size === 0;
    $('#bulkCount').textContent = `${state.selected.size} selected`;
  }

  async function bulkAssign() {
    const ids = Array.from(state.selected);
    const to = $('#bulkAssignee').value || null;
    const btn = $('#bulkApply');
    btn.disabled = true;
    try {
      for (let i = 0; i < ids.length; i += 100) {
        const { error } = await sb.from('leads').update({ assigned_to: to }).in('id', ids.slice(i, i + 100));
        if (error) throw error;
      }
      await loadLeads();
      state.selected.clear();
      toast(`${ids.length} lead${ids.length === 1 ? '' : 's'} ${to ? 'assigned to ' + nameOf(to) : 'unassigned'}`);
      renderRows();
    } catch (err) {
      toast(friendly(err), true);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------------- Add lead ----------------
  function leadFields(l = {}) {
    return `
      <label class="field">Full name<input type="text" name="full_name" value="${esc(l.full_name)}" required maxlength="120"></label>
      <div class="grid2">
        <label class="field">Phone<input type="tel" name="phone" value="${esc(l.phone)}" maxlength="30"></label>
        <label class="field">Email<input type="email" name="email" value="${esc(l.email)}" maxlength="120"></label>
        <label class="field">Source<input type="text" name="source" value="${esc(l.source)}" list="srcList" maxlength="60"><datalist id="srcList">${SOURCES.map((s) => `<option value="${s}">`).join('')}</datalist></label>
        <label class="field">Expected capital (EGP)<input type="number" name="expected_capital" value="${esc(l.expected_capital)}" min="0" step="1000"></label>
        <label class="field">Next follow-up<input type="date" name="next_follow_up" value="${esc(l.next_follow_up)}"></label>
      </div>`;
  }

  function readLeadForm(f) {
    const v = (n) => (f[n] && f[n].value.trim()) || null;
    return {
      full_name: f.full_name.value.trim(),
      phone: v('phone'),
      email: v('email'),
      source: v('source'),
      expected_capital: f.expected_capital.value === '' ? null : Number(f.expected_capital.value),
      next_follow_up: f.next_follow_up.value || null,
    };
  }

  function addLeadModal() {
    openModal({
      title: 'New lead',
      submitLabel: 'Add lead',
      wide: true,
      body: leadFields() + (canAssign()
        ? `<label class="field">Assign to<select name="assigned_to">${assigneeOptions('')}</select></label>`
        : '<p class="hint">This lead will be assigned to you.</p>'),
      onSubmit: async (f) => {
        const row = readLeadForm(f);
        if (row.phone) {
          const dup = state.leads.find((l) => digits(l.phone) && digits(l.phone) === digits(row.phone));
          if (dup) throw new Error(`A lead with this phone number already exists (${dup.full_name}).`);
        }
        row.status = 'new';
        row.assigned_to = canAssign() ? f.assigned_to.value || null : state.user.id;
        const { data, error } = await sb.from('leads').insert(row).select().single();
        if (error) throw error;
        state.leads.unshift(data);
        toast('Lead added');
        renderPipeline();
        renderRows();
      },
    });
  }

  // ---------------- Import / export ----------------
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const rows = [];
    let row = [], cur = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = ''; rows.push(row); row = [];
      } else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((x) => x.trim() !== ''));
  }

  function csvCell(v) {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // block spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function download(name, text) {
    const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportCsv() {
    const list = filteredLeads();
    if (!list.length) return toast('Nothing to export', true);
    const head = ['Name', 'Phone', 'Email', 'Source', 'Expected capital', 'Status', 'Assigned to', 'Next follow-up', 'Created'];
    const lines = [head.map(csvCell).join(',')].concat(
      list.map((l) => [l.full_name, l.phone, l.email, l.source, l.expected_capital, (STATUS[l.status] || {}).label, nameOf(l.assigned_to), l.next_follow_up, (l.created_at || '').slice(0, 10)].map(csvCell).join(',')));
    download(`aspire-leads-${todayStr()}.csv`, lines.join('\r\n'));
    toast(`Exported ${list.length} leads`);
  }

  function importModal() {
    const m = openModal({
      title: 'Import leads from CSV',
      submitLabel: 'Import',
      wide: true,
      body: `
        <p class="hint">Columns (first row = headers): <b>name</b> (required), <b>phone</b>, <b>email</b>, <b>source</b>, <b>capital</b>. Save from Excel as <i>CSV UTF-8</i>.
        <button type="button" class="link" id="tpl">Download template</button></p>
        <label class="field">CSV file<input type="file" name="file" accept=".csv,text/csv" required></label>
        ${canAssign() ? `<label class="field">Assign all imported leads to<select name="assigned_to">${assigneeOptions('', { none: 'Leave unassigned' })}</select></label>` : '<p class="hint">Imported leads will be assigned to you.</p>'}`,
      onSubmit: async (f) => {
        const file = f.file.files[0];
        if (!file) throw new Error('Choose a CSV file first.');
        const rows = parseCSV(await file.text());
        if (rows.length < 2) throw new Error('The file has no data rows.');
        const header = rows[0].map((h) => h.trim().toLowerCase());
        const find = (names) => header.findIndex((h) => names.includes(h));
        const ix = {
          name: find(['name', 'full name', 'full_name', 'client', 'client name']),
          phone: find(['phone', 'mobile', 'phone number', 'tel']),
          email: find(['email', 'e-mail']),
          source: find(['source', 'channel']),
          capital: find(['capital', 'expected capital', 'expected_capital', 'amount']),
        };
        if (ix.name < 0) throw new Error('Could not find a "name" column in the first row.');
        const assignTo = canAssign() ? f.assigned_to.value || null : state.user.id;
        const seen = new Set(state.leads.map((l) => digits(l.phone)).filter(Boolean));
        const out = [];
        let skipped = 0;
        for (const r of rows.slice(1)) {
          const get = (i) => (i >= 0 && r[i] ? r[i].trim() : '') || null;
          const name = get(ix.name);
          if (!name) { skipped++; continue; }
          const phone = get(ix.phone);
          const d = digits(phone);
          if (d && seen.has(d)) { skipped++; continue; }
          if (d) seen.add(d);
          const cap = get(ix.capital);
          out.push({
            full_name: name, phone, email: get(ix.email), source: get(ix.source),
            expected_capital: cap && !isNaN(Number(cap.replace(/,/g, ''))) ? Number(cap.replace(/,/g, '')) : null,
            status: 'new', assigned_to: assignTo,
          });
        }
        if (!out.length) throw new Error('Nothing to import (all rows were empty or duplicates).');
        for (let i = 0; i < out.length; i += 200) {
          const { error } = await sb.from('leads').insert(out.slice(i, i + 200));
          if (error) throw error;
        }
        await loadLeads();
        toast(`Imported ${out.length} lead${out.length === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped: empty or duplicate phone)` : ''}`);
        renderPipeline();
        renderRows();
      },
    });
    $('#tpl', m.form).addEventListener('click', () =>
      download('aspire-leads-template.csv', 'name,phone,email,source,capital\r\nAhmed Hassan,01001234567,ahmed@example.com,Facebook,150000'));
  }

  // ---------------- Lead drawer ----------------
  async function openDrawer(id) {
    const lead = state.leads.find((l) => l.id === id);
    if (!lead) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const drawer = document.createElement('aside');
    drawer.className = 'drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', 'Lead details');
    drawer.innerHTML = `
      <header>
        <div><h2 style="font-size:17px">${esc(lead.full_name)}</h2><span class="sub muted">Added ${esc(fmtDate(lead.created_at))}${lead.created_by ? ' by ' + esc(nameOf(lead.created_by)) : ''}</span></div>
        <div class="actions">${isAdmin() ? '<button class="btn sm danger" id="dDelete" type="button">Delete</button>' : ''}<button class="icon-btn" id="dClose" aria-label="Close">&times;</button></div>
      </header>
      <div class="scroll">
        <form id="dForm">
          ${leadFields(lead)}
          <div class="grid2">
            <label class="field">Status<select name="status">${statusOptions(lead.status)}</select></label>
            ${canAssign()
              ? `<label class="field">Assigned to<select name="assigned_to">${assigneeOptions(lead.assigned_to)}</select></label>`
              : `<label class="field">Assigned to<input type="text" value="${esc(nameOf(lead.assigned_to))}" disabled></label>`}
          </div>
          <div class="form-error" id="dErr" hidden></div>
          <button class="btn primary" type="submit">Save changes</button>
        </form>
        <h3>Notes &amp; activity</h3>
        <form id="nForm"><textarea name="body" placeholder="Log a call, a promise, a next step…" required maxlength="2000"></textarea>
          <div style="margin-top:8px"><button class="btn" type="submit">Add note</button></div></form>
        <div id="notes" style="margin-top:18px"><div class="muted">Loading…</div></div>
      </div>`;
    document.body.append(overlay, drawer);
    const close = () => { overlay.remove(); drawer.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', close);
    $('#dClose', drawer).addEventListener('click', close);

    const refreshViews = () => {
      const name = (location.hash.replace('#/', '') || 'dashboard');
      if (name === 'leads') { renderPipeline(); renderRows(); } else route();
    };

    $('#dForm', drawer).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const err = $('#dErr', drawer);
      err.hidden = true;
      const patch = { ...readLeadForm(f), status: f.status.value };
      if (canAssign()) patch.assigned_to = f.assigned_to.value || null;
      try {
        await updateLead(id, patch);
        toast('Lead saved');
        refreshViews();
        loadNotes();
      } catch (ex) { err.textContent = friendly(ex); err.hidden = false; }
    });

    $('#nForm', drawer).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const body = f.body.value.trim();
      if (!body) return;
      const { error } = await sb.from('lead_notes').insert({ lead_id: id, body, author_id: state.user.id });
      if (error) return toast(friendly(error), true);
      f.reset();
      loadNotes();
    });

    const del = $('#dDelete', drawer);
    if (del) del.addEventListener('click', async () => {
      if (!(await confirmDialog('Delete lead', `Permanently delete "${lead.full_name}" and all its notes?`))) return;
      const { error } = await sb.from('leads').delete().eq('id', id);
      if (error) return toast(friendly(error), true);
      state.leads = state.leads.filter((l) => l.id !== id);
      state.selected.delete(id);
      close();
      toast('Lead deleted');
      refreshViews();
    });

    async function loadNotes() {
      const box = $('#notes', drawer);
      if (!box) return;
      const { data, error } = await sb.from('lead_notes').select('*').eq('lead_id', id).order('created_at', { ascending: false });
      if (error) { box.innerHTML = `<div class="form-error">${esc(friendly(error))}</div>`; return; }
      box.innerHTML = data.length
        ? data.map((n) => `<div class="note ${n.kind === 'system' ? 'system' : ''}">
            <div class="meta">${esc(nameOf(n.author_id) || 'System')} · ${esc(fmtDateTime(n.created_at))}</div>
            <div class="text">${esc(n.body)}</div></div>`).join('')
        : '<div class="muted">No notes yet.</div>';
    }
    loadNotes();
  }

  // ------------------------------------------------------------------
  // Team page (Super Admin only)
  // ------------------------------------------------------------------
  function renderTeamPage() {
    const rows = state.profiles.map((p) => {
      const self = p.id === state.user.id;
      const count = state.leads.filter((l) => l.assigned_to === p.id).length;
      return `<tr data-id="${p.id}">
        <td><b>${esc(p.full_name || '-')}</b>${self ? ' <span class="muted">(you)</span>' : ''}<div class="sub">${esc(p.email)}</div></td>
        <td>${self
          ? `<span class="role super_admin">${esc(ROLE_LABEL[p.role])}</span>`
          : `<select class="sel-assign" data-act="role" aria-label="Role of ${esc(p.full_name)}">${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${k === p.role ? 'selected' : ''}>${v}</option>`).join('')}</select>`}</td>
        <td class="num">${count}</td>
        <td>${p.active ? '<span class="pill" style="--c:#16a34a">Active</span>' : '<span class="pill" style="--c:#94a3b8">Inactive</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          ${self ? '' : `<button class="btn sm" data-act="toggle">${p.active ? 'Deactivate' : 'Activate'}</button>
          <button class="btn sm" data-act="pwd">Reset password</button>
          <button class="btn sm danger" data-act="del">Delete</button>`}
        </td></tr>`;
    }).join('');

    $('#view').innerHTML = `
      <section class="page">
        <div class="toolbar"><p class="muted" style="margin:0">Create and remove accounts. Deleting a user keeps their leads and marks them <b>Unassigned</b>.</p><span class="spacer"></span>
          <button class="btn primary" id="btnNewUser">+ New user</button></div>
        <div class="table-card"><div class="table-wrap"><table>
          <thead><tr><th>User</th><th>Role</th><th class="num">Leads</th><th>Status</th><th></th></tr></thead>
          <tbody id="userRows">${rows}</tbody></table></div></div>
      </section>`;

    $('#btnNewUser').addEventListener('click', newUserModal);
    const tbody = $('#userRows');
    tbody.addEventListener('change', async (e) => {
      const t = e.target;
      if (t.dataset.act !== 'role') return;
      const id = t.closest('tr').dataset.id;
      try { await callAdmin({ action: 'update', user_id: id, role: t.value }); await loadProfiles(); toast('Role updated'); }
      catch (err) { toast(friendly(err), true); }
      renderTeamPage();
    });
    tbody.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const id = b.closest('tr').dataset.id;
      const p = state.pmap[id];
      try {
        if (b.dataset.act === 'toggle') {
          await callAdmin({ action: 'update', user_id: id, active: !p.active });
          await loadProfiles();
          toast(p.active ? 'Account activated' : 'Account deactivated');
          renderTeamPage();
        } else if (b.dataset.act === 'pwd') {
          resetPasswordModal(p);
        } else if (b.dataset.act === 'del') {
          if (!(await confirmDialog('Delete account', `Delete ${p.full_name || p.email}? They will no longer be able to sign in. Their leads stay and become Unassigned.`))) return;
          await callAdmin({ action: 'delete', user_id: id });
          await Promise.all([loadProfiles(), loadLeads()]);
          toast('Account deleted');
          renderTeamPage();
        }
      } catch (err) { toast(friendly(err), true); }
    });
  }

  function newUserModal() {
    openModal({
      title: 'New user',
      submitLabel: 'Create account',
      body: `
        <label class="field">Full name<input type="text" name="full_name" required maxlength="120"></label>
        <label class="field">Email (used to sign in)<input type="email" name="email" required autocomplete="off"></label>
        <label class="field">Temporary password<input type="text" name="password" minlength="8" required autocomplete="off" placeholder="At least 8 characters"></label>
        <label class="field">Role<select name="role"><option value="employee">Employee</option><option value="supervisor">Supervisor</option><option value="super_admin">Super Admin</option></select></label>
        <p class="hint">Share the email and password with the employee; they can change the password after signing in.</p>`,
      onSubmit: async (f) => {
        await callAdmin({ action: 'create', full_name: f.full_name.value.trim(), email: f.email.value.trim(), password: f.password.value, role: f.role.value });
        await loadProfiles();
        toast('Account created');
        renderTeamPage();
      },
    });
  }

  function resetPasswordModal(p) {
    openModal({
      title: `Reset password - ${p.full_name || p.email}`,
      submitLabel: 'Set password',
      body: `<label class="field">New password<input type="text" name="password" minlength="8" required autocomplete="off" placeholder="At least 8 characters"></label>`,
      onSubmit: async (f) => {
        await callAdmin({ action: 'update', user_id: p.id, password: f.password.value });
        toast('Password updated');
      },
    });
  }

  // ------------------------------------------------------------------
  boot();
})();
