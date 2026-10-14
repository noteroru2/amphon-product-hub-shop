/** Warranty dates are stored as Gregorian ISO (YYYY-MM-DD), never Buddhist years. */
const BE_OFFSET = 543
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Accept native date-input values (including accidentally entered Thai Buddhist years). */
export function normalizeWarrantyDateInput(value?: string | null): string {
  const raw = String(value ?? '').trim()
  const match = ISO_DATE.exec(raw)
  if (!match) return raw
  const year = Number(match[1])
  if (year >= 2500 && year <= 2643) {
    return `${String(year - BE_OFFSET).padStart(4, '0')}-${match[2]}-${match[3]}`
  }
  return raw
}

/** Reject impossible dates rather than saving or publishing an invented expiry. */
export function canonicalWarrantyDate(value?: string | null): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const iso = normalizeWarrantyDateInput(raw)
  const match = ISO_DATE.exec(iso)
  if (!match) throw new Error('วันหมดประกันไม่ถูกต้อง กรุณาระบุเป็นวันที่ ปี ค.ศ. หรือ พ.ศ.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 2000 || year > 2100) {
    throw new Error('ปีที่หมดประกันไม่ถูกต้อง กรุณาตรวจสอบปี พ.ศ./ค.ศ.')
  }
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('วันหมดประกันไม่ถูกต้อง กรุณาตรวจสอบวันและเดือน')
  }
  return iso
}

export function formatWarrantyThaiDate(value: string): string | null {
  try {
    const iso = canonicalWarrantyDate(value)
    if (!iso) return null
    return new Intl.DateTimeFormat('th-TH', {
      timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
    }).format(new Date(`${iso}T12:00:00Z`))
  } catch {
    return null
  }
}
