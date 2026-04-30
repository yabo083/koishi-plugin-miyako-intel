export interface CronParts {
  minute: number
  hour: number
  day: number
  month: number
  weekday: number
}

export function matchesCronExpression(expression: string, parts: CronParts) {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return false

  return matchCronField(fields[0], parts.minute, 0, 59)
    && matchCronField(fields[1], parts.hour, 0, 23)
    && matchCronField(fields[2], parts.day, 1, 31)
    && matchCronField(fields[3], parts.month, 1, 12)
    && matchCronField(fields[4], parts.weekday, 0, 7, true)
}

function matchCronField(field: string, value: number, min: number, max: number, sundayAlias = false) {
  return field.split(',').some((part) => matchCronPart(part.trim(), value, min, max, sundayAlias))
}

function matchCronPart(part: string, value: number, min: number, max: number, sundayAlias: boolean) {
  if (!part) return false
  const [rangePart, stepPart] = part.split('/')
  const step = stepPart === undefined ? 1 : Number(stepPart)
  if (!Number.isInteger(step) || step <= 0) return false

  let start: number
  let end: number
  if (rangePart === '*') {
    start = min
    end = max
  } else if (rangePart.includes('-')) {
    const [rawStart, rawEnd] = rangePart.split('-').map(Number)
    start = normalizeCronValue(rawStart, sundayAlias)
    end = normalizeCronValue(rawEnd, sundayAlias)
  } else {
    start = normalizeCronValue(Number(rangePart), sundayAlias)
    end = start
  }

  if (!Number.isInteger(start) || !Number.isInteger(end)) return false
  if (start < min || end > max || start > end) return false

  const normalizedValue = sundayAlias && value === 0 && start === 7 ? 7 : value
  return normalizedValue >= start && normalizedValue <= end && (normalizedValue - start) % step === 0
}

function normalizeCronValue(value: number, sundayAlias: boolean) {
  if (sundayAlias && value === 7) return 7
  return value
}
