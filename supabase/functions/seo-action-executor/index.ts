import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0'

const issuer = 'https://token.actions.githubusercontent.com'
const jwks = createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'))
const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const audience = `${supabaseUrl}/functions/v1/seo-action-executor`
const allowedRepository = 'noteroru2/amphon.co.th'
const expectedWorkflow = `${allowedRepository}/.github/workflows/seo-action-executor.yml@refs/heads/main`
const allowedEvents = new Set(['schedule', 'workflow_dispatch', 'push'])

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

function adminKey() {
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (modern) {
    try {
      const parsed = JSON.parse(modern)
      if (parsed?.default) return String(parsed.default)
    } catch {
      // Fall through to the legacy service-role key.
    }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  throw new Error('Supabase admin key is unavailable')
}

async function adminRpc(name: string, body: Record<string, unknown>) {
  const key = adminKey()
  const headers: Record<string, string> = {
    apikey: key,
    'content-type': 'application/json',
  }
  if (!key.startsWith('sb_secret_')) headers.authorization = `Bearer ${key}`

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const raw = await response.text()
  let data: unknown = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    data = raw
  }
  if (!response.ok) {
    throw new Error(`${name} failed (${response.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  }
  return data
}

async function authorize(req: Request) {
  const header = req.headers.get('authorization') || ''
  if (!header.startsWith('Bearer ')) throw new Error('Missing GitHub OIDC bearer token')
  const token = header.slice(7)
  const { payload } = await jwtVerify(token, jwks, {
    issuer,
    audience,
  })

  const repository = String(payload.repository || '')
  const ref = String(payload.ref || '')
  const workflowRef = String(payload.workflow_ref || '')
  const eventName = String(payload.event_name || '')

  if (repository !== allowedRepository) throw new Error('Repository is not allowed')
  if (ref !== 'refs/heads/main') throw new Error('Executor must run from main')
  if (workflowRef !== expectedWorkflow) throw new Error('Unexpected workflow identity')
  if (!allowedEvents.has(eventName)) throw new Error('Unexpected workflow event')

  return { repository, eventName, runId: String(payload.run_id || '') }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  try {
    const identity = await authorize(req)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const operation = String(body.operation || '')

    if (operation === 'claim') {
      const result = await adminRpc('claim_gsc_executor_jobs', {
        p_repository: identity.repository,
        p_limit: Math.max(1, Math.min(Number(body.limit || 2), 5)),
      })
      return json({ ok: true, identity, jobs: result || [] })
    }

    if (operation === 'pr_ready') {
      const result = await adminRpc('list_gsc_executor_pr_ready', {
        p_repository: identity.repository,
      })
      return json({ ok: true, identity, jobs: result || [] })
    }

    if (operation === 'finish') {
      const jobId = String(body.jobId || '')
      const outcome = String(body.outcome || '')
      if (!jobId || !outcome) return json({ error: 'MISSING_JOB_OR_OUTCOME' }, 400)

      const result = await adminRpc('finish_gsc_executor_job', {
        p_job_id: jobId,
        p_outcome: outcome,
        p_payload: typeof body.payload === 'object' && body.payload !== null ? body.payload : {},
      })
      return json({ ok: true, identity, job: result })
    }

    if (operation === 'health') {
      return json({ ok: true, identity, audience })
    }

    return json({ error: 'UNKNOWN_OPERATION' }, 400)
  } catch (error) {
    console.error('seo-action-executor', error)
    return json({ error: error instanceof Error ? error.message : String(error) }, 401)
  }
})
