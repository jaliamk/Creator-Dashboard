export function threshold(level: number, factor: number) {
  return factor * (level - 1) * level
}

export function progression(xp: number, factor: number) {
  const level = Math.floor((1 + Math.sqrt(1 + 4 * xp / factor)) / 2)
  const current = xp - threshold(level, factor)
  const target = threshold(level + 1, factor) - threshold(level, factor)
  return { level, current, target, percent: (100 * current) / target }
}
