/**
 * Returns ISO date bounds for IST (Asia/Kolkata) timezone.
 * Useful for filtering visitor logs and other timestamped data.
 */
export function getISTDateBounds(
  dateFilter: 'today' | 'yesterday' | 'week' | 'month' | 'custom' | 'all_time',
  customDateStr?: string
): { start: string; end: string } {
  const now = new Date();

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parts.find((p) => p.type === type)!.value;

  const currentYear = parseInt(getPart('year'));
  const currentMonth = parseInt(getPart('month')) - 1;
  const currentDay = parseInt(getPart('day'));

  let startUtc: Date;
  let endUtc: Date;

  // Handle all_time - return very wide date range
  if (dateFilter === 'all_time') {
    return {
      start: '2000-01-01T00:00:00.000Z',
      end: '2100-01-01T00:00:00.000Z'
    };
  }

  if (dateFilter === 'custom' && customDateStr) {
    // Handle custom date range format: "YYYY-MM-DD,YYYY-MM-DD"
    if (customDateStr.includes(',')) {
      const [fromStr, toStr] = customDateStr.split(',');
      const fromDate = new Date(fromStr);
      const toDate = new Date(toStr);
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        // Invalid date range, fall back to today
        startUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, -5, -30, 0, 0));
        endUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, 18, 29, 59, 999));
      } else {
        startUtc = new Date(Date.UTC(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate(), -5, -30, 0, 0));
        endUtc = new Date(Date.UTC(toDate.getFullYear(), toDate.getMonth(), toDate.getDate(), 18, 29, 59, 999));
      }
    } else {
      // Single custom date
      const d = new Date(customDateStr);
      if (isNaN(d.getTime())) {
        // Invalid date, fall back to today
        startUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, -5, -30, 0, 0));
        endUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, 18, 29, 59, 999));
      } else {
        startUtc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), -5, -30, 0, 0));
        endUtc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 18, 29, 59, 999));
      }
    }
  } else if (dateFilter === 'yesterday') {
    startUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay - 1, -5, -30, 0, 0));
    endUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay - 1, 18, 29, 59, 999));
  } else if (dateFilter === 'week') {
    startUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay - 7, -5, -30, 0, 0));
    endUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, 18, 29, 59, 999));
  } else if (dateFilter === 'month') {
    startUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay - 30, -5, -30, 0, 0));
    endUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, 18, 29, 59, 999));
  } else {
    // today
    startUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, -5, -30, 0, 0));
    endUtc = new Date(Date.UTC(currentYear, currentMonth, currentDay, 18, 29, 59, 999));
  }

  return { start: startUtc.toISOString(), end: endUtc.toISOString() };
}
