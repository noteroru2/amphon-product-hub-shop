import { supabase } from './supabase'

export interface TrustReviewRow {
  inviteId: string
  publicToken: string
  orderId: string
  productId: string
  sku: string
  productTitle: string
  expiresAt: string
  usedAt: string | null
  inviteCreatedAt: string
  reviewId: string | null
  rating: number | null
  reviewTitle: string | null
  reviewBody: string | null
  displayName: string | null
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED' | null
  submittedAt: string | null
  moderatedAt: string | null
  moderationNote: string | null
}

function mapRow(row: Record<string, any>): TrustReviewRow {
  return {
    inviteId: String(row.invite_id),
    publicToken: String(row.public_token),
    orderId: String(row.order_id),
    productId: String(row.product_id),
    sku: String(row.sku || ''),
    productTitle: String(row.product_title || ''),
    expiresAt: String(row.expires_at || ''),
    usedAt: row.used_at ? String(row.used_at) : null,
    inviteCreatedAt: String(row.invite_created_at || ''),
    reviewId: row.review_id ? String(row.review_id) : null,
    rating: row.rating === null ? null : Number(row.rating),
    reviewTitle: row.review_title ? String(row.review_title) : null,
    reviewBody: row.review_body ? String(row.review_body) : null,
    displayName: row.display_name ? String(row.display_name) : null,
    reviewStatus: row.review_status || null,
    submittedAt: row.submitted_at ? String(row.submitted_at) : null,
    moderatedAt: row.moderated_at ? String(row.moderated_at) : null,
    moderationNote: row.moderation_note ? String(row.moderation_note) : null,
  }
}

export async function listTrustReviews(): Promise<TrustReviewRow[]> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('commerce_review_admin_v')
    .select('*')
    .order('invite_created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return ((data || []) as Array<Record<string, any>>).map(mapRow)
}

export async function moderateTrustReview(
  reviewId: string,
  status: 'APPROVED' | 'REJECTED',
  note?: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.rpc('moderate_verified_review', {
    p_review_id: reviewId,
    p_status: status,
    p_note: note?.trim() || null,
  })
  if (error) throw error
}
