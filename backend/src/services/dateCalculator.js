// ── Chilean Business Days Calculator ─────────────────────────────────────────
// Calculates business days excluding weekends and Chilean public holidays.

// Chilean public holidays (fixed + known movable dates for 2025-2027)
const CHILEAN_HOLIDAYS = {
  2025: [
    '2025-01-01', // Año Nuevo
    '2025-04-18', // Viernes Santo
    '2025-04-19', // Sábado Santo
    '2025-05-01', // Día del Trabajo
    '2025-05-21', // Glorias Navales
    '2025-06-20', // Día Nacional de los Pueblos Indígenas
    '2025-06-29', // San Pedro y San Pablo (movido)
    '2025-07-16', // Virgen del Carmen
    '2025-08-15', // Asunción de la Virgen
    '2025-09-18', // Fiestas Patrias
    '2025-09-19', // Glorias del Ejército
    '2025-10-12', // Encuentro de Dos Mundos (movido)
    '2025-10-31', // Día de las Iglesias Evangélicas
    '2025-11-01', // Todos los Santos
    '2025-12-08', // Inmaculada Concepción
    '2025-12-25', // Navidad
  ],
  2026: [
    '2026-01-01',
    '2026-04-03', // Viernes Santo
    '2026-04-04', // Sábado Santo
    '2026-05-01',
    '2026-05-21',
    '2026-06-21', // Día Nacional de los Pueblos Indígenas
    '2026-06-29',
    '2026-07-16',
    '2026-08-15',
    '2026-09-18',
    '2026-09-19',
    '2026-10-12',
    '2026-10-31',
    '2026-11-01',
    '2026-12-08',
    '2026-12-25',
  ],
  2027: [
    '2027-01-01',
    '2027-03-26', // Viernes Santo
    '2027-03-27', // Sábado Santo
    '2027-05-01',
    '2027-05-21',
    '2027-06-21',
    '2027-06-28', // San Pedro y San Pablo (movido)
    '2027-07-16',
    '2027-08-15',
    '2027-09-17', // Viernes extra Fiestas Patrias
    '2027-09-18',
    '2027-09-19',
    '2027-10-11', // Encuentro de Dos Mundos (movido)
    '2027-10-31',
    '2027-11-01',
    '2027-12-08',
    '2027-12-25',
  ],
};

// Build a Set of all holiday strings for O(1) lookup
const holidaySet = new Set();
for (const year of Object.values(CHILEAN_HOLIDAYS)) {
  for (const date of year) {
    holidaySet.add(date);
  }
}

/**
 * Format a Date to YYYY-MM-DD string (local time).
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Check if a date is a business day (not weekend, not Chilean holiday).
 */
function isBusinessDay(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false; // Weekend
  if (holidaySet.has(formatDate(date))) return false; // Holiday
  return true;
}

/**
 * Add N business days to a start date.
 * @param {string|Date} startDate - Start date (YYYY-MM-DD or Date object)
 * @param {number} days - Number of business days to add
 * @returns {string} Resulting date as YYYY-MM-DD
 */
export function addBusinessDays(startDate, days) {
  const date = typeof startDate === 'string' ? new Date(startDate + 'T12:00:00') : new Date(startDate);
  let added = 0;

  while (added < days) {
    date.setDate(date.getDate() + 1);
    if (isBusinessDay(date)) {
      added++;
    }
  }

  return formatDate(date);
}

/**
 * Get the number of business days remaining until a deadline.
 * Returns negative if past deadline.
 * @param {string|Date} deadline - Deadline date (YYYY-MM-DD or Date object)
 * @param {string|Date} [fromDate] - Optional "today" date for testing
 * @returns {number} Business days remaining (negative = overdue)
 */
export function getBusinessDaysRemaining(deadline, fromDate = null) {
  const from = fromDate
    ? (typeof fromDate === 'string' ? new Date(fromDate + 'T12:00:00') : new Date(fromDate))
    : new Date();
  const target = typeof deadline === 'string' ? new Date(deadline + 'T12:00:00') : new Date(deadline);

  // Normalize both to midnight
  from.setHours(12, 0, 0, 0);
  target.setHours(12, 0, 0, 0);

  if (from.getTime() === target.getTime()) return 0;

  const direction = target > from ? 1 : -1;
  const current = new Date(from);
  let count = 0;

  while (true) {
    current.setDate(current.getDate() + direction);
    if (isBusinessDay(current)) {
      count += direction;
    }
    // Compare dates without time
    if (formatDate(current) === formatDate(target)) break;
  }

  return count;
}

/**
 * Determine the visual status of an order based on its deadline.
 * @param {object} order - Order with deadline and status fields
 * @returns {'green'|'yellow'|'red'|'pending'} Visual status
 */
export function getOrderVisualStatus(order) {
  if (order.status === 'completed') return 'green';
  if (!order.deadline) return 'pending';

  const remaining = getBusinessDaysRemaining(order.deadline);

  if (remaining < 0) return 'red';       // Overdue
  if (remaining <= 3) return 'yellow';    // Warning: 3 business days or less
  return 'pending';                       // On track
}
