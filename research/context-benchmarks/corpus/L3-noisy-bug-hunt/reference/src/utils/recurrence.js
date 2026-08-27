'use strict'

// Daily recurrence math (UTC). The next run is the next occurrence of
// atHour:00 STRICTLY AFTER fromTimestamp, so a run exactly at fromTimestamp
// is not picked again.

const HOUR_MS = 3600000
const DAY_MS = 86400000

function nextDailyRun(atHour, fromTimestamp) {
  if (!Number.isInteger(atHour) || atHour < 0 || atHour > 23) {
    throw new RangeError('atHour must be between 0 and 23')
  }
  if (!Number.isFinite(fromTimestamp)) throw new TypeError('fromTimestamp must be finite')
  const dayStart = Math.floor(fromTimestamp / DAY_MS) * DAY_MS
  let candidate = dayStart + atHour * HOUR_MS
  if (candidate <= fromTimestamp) candidate += DAY_MS
  return candidate
}

module.exports = { nextDailyRun }
