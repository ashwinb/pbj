export function formatMonth(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function daysInMonth(month: string) {
  const [year, monthPart] = month.split('-').map(Number)
  return new Date(year, monthPart, 0).getDate()
}

export function monthLabel(month: string) {
  const [year, monthPart] = month.split('-').map(Number)
  return new Date(year, monthPart - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
