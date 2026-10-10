import { supabase } from './supabase'
export interface GscStatus {
  configured: boolean
  redirect_uri: string
  connections: { id: string; state: string; property_count: number; created_at: string }[]
  jobs: { site_id: string; next_at: string; last_success_at: string | null; last_error: string | null; running: boolean }[]
}
export async function gscAction<T>(action: string, payload: Record<string,unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('ยังไม่ได้ตั้งค่าการเชื่อมต่อข้อมูล')
  const { data, error } = await supabase.functions.invoke('seo-gsc', { body: { ...payload, action } })
  if (error) {
    try {
      const body = await error.context?.json()
      if (body?.error) throw new Error(body.error)
    } catch (detail) { if (detail instanceof Error && !(detail instanceof SyntaxError)) throw detail }
    throw new Error(error.message)
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}
