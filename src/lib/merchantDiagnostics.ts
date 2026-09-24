import { supabase } from './supabase'

export interface MerchantFeedDiagnostic {
  productId: string
  sku: string | null
  title: string
  feedEligible: boolean
  severity: 'PASS' | 'WARNING' | 'ERROR' | 'EXCLUDED'
  issueCodes: string[]
  imageCount: number
  coverWidth: number | null
  coverHeight: number | null
  price: number | null
  productStatus: string | null
  indexPolicy: string | null
  merchantEnabled: boolean
  checkedAt: string
}

export interface MerchantAccountIssue {
  id: string
  merchantAccountId: string | null
  itemId: string | null
  sku: string | null
  issueCode: string
  severity: 'INFO' | 'WARNING' | 'ERROR'
  issueTitle: string
  issueDetail: string | null
  destination: string | null
  observedAt: string
  resolvedAt: string | null
}

export interface MerchantSyncState {
  connected: boolean
  merchantAccountId: string | null
  lastSyncedAt: string | null
  statusMessage: string | null
}

export async function loadMerchantDiagnostics() {
  if (!supabase) throw new Error('Supabase is not configured')
  const [feed, issues, state] = await Promise.all([
    supabase
      .from('commerce_merchant_feed_diagnostics')
      .select('*')
      .order('severity', { ascending: true })
      .order('title', { ascending: true }),
    supabase
      .from('commerce_merchant_account_issues')
      .select('*')
      .is('resolved_at', null)
      .order('severity', { ascending: false })
      .order('observed_at', { ascending: false })
      .limit(100),
    supabase
      .from('commerce_merchant_sync_state')
      .select('*')
      .eq('id', 1)
      .maybeSingle(),
  ])
  if (feed.error) throw feed.error
  if (issues.error) throw issues.error
  if (state.error) throw state.error

  const feedItems: MerchantFeedDiagnostic[] = ((feed.data || []) as Array<Record<string, any>>).map((row) => ({
    productId: String(row.product_id),
    sku: row.sku ? String(row.sku) : null,
    title: String(row.title || ''),
    feedEligible: Boolean(row.feed_eligible),
    severity: row.severity,
    issueCodes: Array.isArray(row.issue_codes) ? row.issue_codes.map(String) : [],
    imageCount: Number(row.image_count || 0),
    coverWidth: row.cover_width === null ? null : Number(row.cover_width),
    coverHeight: row.cover_height === null ? null : Number(row.cover_height),
    price: row.price === null ? null : Number(row.price),
    productStatus: row.product_status ? String(row.product_status) : null,
    indexPolicy: row.index_policy ? String(row.index_policy) : null,
    merchantEnabled: Boolean(row.merchant_enabled),
    checkedAt: String(row.checked_at || ''),
  }))

  const accountIssues: MerchantAccountIssue[] = ((issues.data || []) as Array<Record<string, any>>).map((row) => ({
    id: String(row.id),
    merchantAccountId: row.merchant_account_id ? String(row.merchant_account_id) : null,
    itemId: row.item_id ? String(row.item_id) : null,
    sku: row.sku ? String(row.sku) : null,
    issueCode: String(row.issue_code || ''),
    severity: row.severity,
    issueTitle: String(row.issue_title || ''),
    issueDetail: row.issue_detail ? String(row.issue_detail) : null,
    destination: row.destination ? String(row.destination) : null,
    observedAt: String(row.observed_at || ''),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
  }))

  const rawState = state.data as Record<string, any> | null
  const syncState: MerchantSyncState = {
    connected: Boolean(rawState?.connected),
    merchantAccountId: rawState?.merchant_account_id ? String(rawState.merchant_account_id) : null,
    lastSyncedAt: rawState?.last_synced_at ? String(rawState.last_synced_at) : null,
    statusMessage: rawState?.status_message ? String(rawState.status_message) : null,
  }

  return { feedItems, accountIssues, syncState }
}
