const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/** New Hired Trainees batch code, e.g. `NHT-OCT26-03`. */
export function buildBatchCode(month: number, year: number, batchNumber: number): string {
  const label = MONTHS[month - 1];
  if (!label) {
    throw new Error(`Invalid month: ${month}`);
  }
  const yy = String(year % 100).padStart(2, "0");
  return `NHT-${label}${yy}-${String(batchNumber).padStart(2, "0")}`;
}
