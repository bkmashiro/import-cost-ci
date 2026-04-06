import { shouldAutoEnableHistory } from './history.js'

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

export function applyGitHubActionInputs(): void {
  const file = process.env.INPUT_FILE
  if (!file) {
    return
  }

  const args = [process.argv[0], process.argv[1], file]
  const limit = process.env.INPUT_LIMIT
  if (limit) {
    args.push('--limit', limit)
  }
  if (getActionBoolean('no-fail', false)) {
    args.push('--no-fail')
  }
  if (getActionBoolean('treemap', false)) {
    args.push('--treemap')
  }
  if (getActionBoolean('history', false) || shouldAutoEnableHistory()) {
    args.push('--history')
  }

  process.argv = args
}
