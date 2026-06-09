export function parsePageSelection(input: string, pageCount: number) {
  const normalized = input.replace(/\s+/g, '')
  if (!normalized) throw new Error('Digite as páginas. Ex: 1,3,5-8')

  const parts = normalized.split(',').filter(Boolean)
  const pages = new Set<number>()

  for (const part of parts) {
    const rangeMatch = /^(\d+)-(\d+)$/.exec(part)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < 1)
        throw new Error(`Intervalo inválido: "${part}"`)
      const a = Math.min(start, end)
      const b = Math.max(start, end)
      for (let p = a; p <= b; p++) pages.add(p)
      continue
    }

    const singleMatch = /^(\d+)$/.exec(part)
    if (singleMatch) {
      const p = Number(singleMatch[1])
      if (!Number.isFinite(p) || p < 1) throw new Error(`Página inválida: "${part}"`)
      pages.add(p)
      continue
    }

    throw new Error(`Formato inválido: "${part}"`)
  }

  const result = Array.from(pages).sort((a, b) => a - b)
  const outOfRange = result.find((p) => p > pageCount)
  if (outOfRange) throw new Error(`Página ${outOfRange} não existe (PDF tem ${pageCount}).`)
  return result
}

