import { useState } from "react"
import { useLocation } from "react-router-dom"
import { BareMessage } from "../components/ui/Bare"
import { LinkButton } from "../components/ui/Button"
import { DayCalendar, type CalendarLevel } from "../components/ui/Grids"

const WEEKS = 17
// Three columns by five rows per digit, drawn in the darkest days.
const DIGITS: Array<[number, string[]]> = [
  [3, ["101", "101", "111", "001", "001"]],
  [7, ["111", "101", "101", "101", "111"]],
  [11, ["101", "101", "111", "001", "001"]],
]
const MONTH = new Intl.DateTimeFormat("en-US", { month: "short" })

// A made-up spending calendar for the 17 weeks up to today; the busiest days spell 404.
// The same seed draws the same light days on every visit.
function notFoundCalendar(now: Date) {
  const digitDays = new Set<number>()
  for (const [firstWeek, rows] of DIGITS) {
    rows.forEach((row, rowIndex) => {
      ;[...row].forEach((bit, column) => {
        if (bit === "1") digitDays.add((firstWeek + column) * 7 + rowIndex + 1)
      })
    })
  }
  let seed = 11
  const random = () => (seed = (seed * 9301 + 49297) % 233280) / 233280
  const todayIndex = (WEEKS - 1) * 7 + ((now.getDay() + 6) % 7)
  const days: Array<CalendarLevel | null> = []
  const twinkle: number[] = []
  for (let index = 0; index < WEEKS * 7; index++) {
    const week = Math.floor(index / 7)
    const day = index % 7
    const value = random()
    const insideDigits = week >= 3 && week <= 13 && day >= 1 && day <= 5
    const level: CalendarLevel = digitDays.has(index)
      ? value > 0.12 ? 4 : 3
      : insideDigits
        ? value < 0.88 ? 0 : 1
        : value < 0.55 ? 0 : value < 0.93 ? 1 : 2
    if (!digitDays.has(index) && level > 0 && random() < 0.3) twinkle.push(index)
    days.push(index > todayIndex ? null : level)
  }
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - (WEEKS - 1) * 7)
  const months: Array<{ week: number; label: string }> = []
  let previousMonth = -1
  for (let week = 0; week < WEEKS; week++) {
    const date = new Date(monday)
    date.setDate(monday.getDate() + week * 7)
    if (date.getMonth() !== previousMonth) {
      previousMonth = date.getMonth()
      months.push({ week, label: MONTH.format(date) })
    }
  }
  // The first month's label would crowd the next one when that month starts within three weeks.
  if (months.length > 1 && months[1].week < 3) months.shift()
  return { days, months, today: todayIndex, twinkle }
}

function NotFoundPage() {
  const location = useLocation()
  const [now] = useState(() => new Date())
  const calendar = notFoundCalendar(now)
  return (
    <BareMessage
      art={
        <DayCalendar
          days={calendar.days}
          months={calendar.months}
          today={calendar.today}
          twinkle={calendar.twinkle}
          legend={["Less", "More"]}
          entrance
        />
      }
      title="This page does not exist"
      detail={`${location.pathname}${location.search}`}
      action={
        <LinkButton variant="primary" to="/">
          Go to dashboard
        </LinkButton>
      }
    />
  )
}

export default NotFoundPage
