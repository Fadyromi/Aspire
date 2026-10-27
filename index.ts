// Aspire CRM - admin-users Edge Function
// Lets ONLY a Super Admin create, update and delete user accounts.
// It runs on Supabase's servers, so the powerful service-role key never
// reaches the browser.
//
// Actions (POST JSON):
//   { action: 'create', email, password, full_name, role }
//   { action: 'update', user_id, full_name?, role?, active?, password? }
//   { action: 'delete', user_id }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-region, accept, accept-profile, content-profile, prefer',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ROLES = ['super_admin', 'supervisor', 'employee']

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // 1) Who is calling?
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: userData } = await caller.auth.getUser()
    const me = userData?.user
    if (!me) return json({ error: 'You are not signed in.' }, 401)

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // 2) Are they an active Super Admin?
    const { data: prof } = await admin
      .from('profiles').select('role, active').eq('id', me.id).single()
    if (!prof || !prof.active || prof.role !== 'super_admin') {
      return json({ error: 'Only a Super Admin can manage accounts.' }, 403)
    }

    const body = await req.json()

    // ---------------- create ----------------
    if (body.action === 'create') {
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const fullName = String(body.full_name ?? '').trim()
      const role = String(body.role ?? 'employee')
      if (!email || !fullName) return json({ error: 'Name and email are required.' }, 400)
      if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400)
      if (!ROLES.includes(role)) return json({ error: 'Invalid role.' }, 400)

      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      })
      if (error) return json({ error: error.message }, 400)

      // The DB trigger already made an 'employee' profile; set the real values.
      const { error: pErr } = await admin
        .from('profiles')
        .update({ full_name: fullName, role, email, active: true })
        .eq('id', data.user.id)
      if (pErr) return json({ error: pErr.message }, 400)

      return json({ ok: true, user_id: data.user.id })
    }

    // ---------------- update ----------------
    if (body.action === 'update') {
      const id = String(body.user_id ?? '')
      if (!id) return json({ error: 'user_id is required.' }, 400)

      const patch: Record<string, unknown> = {}
      if (typeof body.full_name === 'string' && body.full_name.trim()) patch.full_name = body.full_name.trim()
      if (body.role !== undefined) {
        if (!ROLES.includes(body.role)) return json({ error: 'Invalid role.' }, 400)
        if (id === me.id && body.role !== 'super_admin') {
          return json({ error: 'You cannot remove your own Super Admin role.' }, 400)
        }
        patch.role = body.role
      }
      if (body.active !== undefined) {
        if (id === me.id && body.active === false) {
          return json({ error: 'You cannot deactivate your own account.' }, 400)
        }
        patch.active = !!body.active
      }

      if (Object.keys(patch).length) {
        const { error } = await admin.from('profiles').update(patch).eq('id', id)
        if (error) return json({ error: error.message }, 400)
      }

      const authPatch: Record<string, unknown> = {}
      if (body.password !== undefined) {
        if (String(body.password).length < 8) {
          return json({ error: 'Password must be at least 8 characters.' }, 400)
        }
        authPatch.password = String(body.password)
      }
      if (body.active !== undefined) {
        // A deactivated user is also blocked from signing in.
        authPatch.ban_duration = body.active ? 'none' : '876000h'
      }
      if (Object.keys(authPatch).length) {
        const { error } = await admin.auth.admin.updateUserById(id, authPatch)
        if (error) return json({ error: error.message }, 400)
      }
      return json({ ok: true })
    }

    // ---------------- delete ----------------
    if (body.action === 'delete') {
      const id = String(body.user_id ?? '')
      if (!id) return json({ error: 'user_id is required.' }, 400)
      if (id === me.id) return json({ error: 'You cannot delete your own account.' }, 400)

      // Their leads stay in the system and become "Unassigned" (FK: on delete set null).
      const { error } = await admin.auth.admin.deleteUser(id)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unexpected error' }, 500)
  }
})
