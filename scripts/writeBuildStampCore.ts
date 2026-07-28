// [INPUT] (none — pure Date formatting)
// [OUTPUT] formatSparkleBuildStamp: YYYY.MMDD.HHMM build stamp string
// [POS] 构建标识格式 SSOT；dev/build/upgrade 写入 src/shared/buildStamp.ts。

/** YYYY.MMDD.HHMM — local build time, minute precision (UI display SSOT). */
export function formatSparkleBuildStamp(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}.${month}${day}.${hour}${minute}`
}
