export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const digits = i === 0 ? 0 : i === 1 ? 1 : 2
  return `${v.toFixed(digits)} ${units[i]}`
}

