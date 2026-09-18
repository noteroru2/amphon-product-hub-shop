import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type AutoPublishQueueStatus =
  | 'pending'
  | 'processing'
  | 'published'
  | 'failed'
  | 'cancelled'

export interface AutoPublishQueueItem {
  productId: string
  eligibleAt: string
  publishAfter: string
  status: AutoPublishQueueStatus
  attemptCount: number
  lastError?: string
  publishedAt?: string
  updatedAt: string
}

function client() {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่า Supabase')
  return supabase
}

function mapQueue(row: any): AutoPublishQueueItem {
  return {
    productId: String(row.product_id),
    eligibleAt: String(row.eligible_at),
    publishAfter: String(row.publish_after),
    status: row.status as AutoPublishQueueStatus,
    attemptCount: Number(row.attempt_count || 0),
    lastError: row.last_error || undefined,
    publishedAt: row.published_at || undefined,
    updatedAt: String(row.updated_at),
  }
}

export async function listAutoPublishQueue(productIds?: string[]): Promise<AutoPublishQueueItem[]> {
  if (!supabase || (productIds && productIds.length === 0)) return []
  let query = client()
    .from('commerce_auto_publish_queue')
    .select('product_id,eligible_at,publish_after,status,attempt_count,last_error,published_at,updated_at')
    .order('publish_after', { ascending: true })

  if (productIds?.length) query = query.in('product_id', productIds)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(mapQueue)
}

export function subscribeAutoPublishQueue(onChange: () => void): RealtimeChannel | null {
  if (!supabase) return null
  return supabase
    .channel('commerce-auto-publish-live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'commerce_auto_publish_queue' },
      onChange,
    )
    .subscribe()
}

export async function removeAutoPublishRealtimeChannel(channel: RealtimeChannel) {
  if (!supabase) return
  await supabase.removeChannel(channel)
}
