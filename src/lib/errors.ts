export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint]
      .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()));
    if (parts.length) return [...new Set(parts)].join(' · ');
  }
  return 'ดำเนินการไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง';
}
