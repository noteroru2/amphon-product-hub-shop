export const EVIDENCE_PUBLICATION_STATES = ['PENDING_SOURCE_PR','DRAFT_PR_OPEN','RELEASED','CANCELLED'] as const
export type EvidencePublicationState = typeof EVIDENCE_PUBLICATION_STATES[number]
export type PublicationTarget = { site_id: string; page_path: string }
export type PublicationEvidence = {
  status: string; permission_confirmed: boolean; privacy_reviewed: boolean;
  approved_at: string | null; transaction_verified: boolean; kind: 'purchase' | 'sale';
}
export type PublicationImage = { approved_for_public: boolean; storage_path: string; evidence_id: string }
const uuid = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i

export function validatePublicationTargets(input: unknown): PublicationTarget[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 14) throw Error('TARGET_COUNT_INVALID')
  const unique = new Set<string>()
  return input.map(value => {
    if (!value || typeof value !== 'object') throw Error('TARGET_INVALID')
    const { site_id, page_path } = value as Record<string, unknown>
    if (typeof site_id !== 'string' || !/^[a-z0-9_-]{2,24}$/.test(site_id)) throw Error('SITE_INVALID')
    if (typeof page_path !== 'string' || page_path.length > 2048 ||
      !page_path.startsWith('/') || page_path.startsWith('//') || /[?#\\\s<>]/.test(page_path) ||
      page_path.split('/').some(x => x === '..' || x === '.')) throw Error('PAGE_PATH_INVALID')
    const path = new URL(page_path, 'https://example.invalid').pathname.replace(/\/+$/, '') || '/'
    const key = site_id + ':' + path
    if (unique.has(key)) throw Error('DUPLICATE_TARGET')
    unique.add(key)
    return {site_id, page_path:path}
  })
}
export function assertPublicationEligible(e: PublicationEvidence, image: PublicationImage, evidenceId: string) {
  if (!uuid.test(evidenceId)) throw Error('EVIDENCE_ID_INVALID')
  if (e.status !== 'APPROVED' || !e.approved_at || !e.permission_confirmed || !e.privacy_reviewed)
    throw Error('EVIDENCE_APPROVAL_REQUIRED')
  if (!image || image.evidence_id !== evidenceId || !image.approved_for_public ||
      !image.storage_path.startsWith(evidenceId + '/') ||
      !/^[-\da-f]+\/[a-zA-Z0-9_.-]+\.(?:jpe?g|png|webp)$/i.test(image.storage_path))
    throw Error('IMAGE_NOT_APPROVED')
  // Assessment is not the same as an actual transaction; never infer purchase completion.
  return {claim_kind:e.transaction_verified?'VERIFIED_TRANSACTION':'ASSESSMENT_ONLY'}
}
export function publicMediaKey(evidenceId:string,imageId:string) {
  if (!uuid.test(evidenceId) || !uuid.test(imageId)) throw Error('INVALID_ID')
  return 'evidence/' + evidenceId + '/' + imageId + '.webp'
}
