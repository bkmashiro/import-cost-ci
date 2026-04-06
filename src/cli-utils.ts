export function parseLimit(raw: string): number {
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb)?$/i)
  if (!match) throw new Error(`Invalid size limit: ${raw}`)
  const value = parseFloat(match[1])
  const unit = (match[2] || 'b').toLowerCase()
  if (unit === 'kb') return Math.round(value * 1000)
  if (unit === 'mb') return Math.round(value * 1_000_000)
  return Math.round(value)
}

export function getActionBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`]
  if (!value) {
    return fallback
  }

  return value.toLowerCase() !== 'false'
}
