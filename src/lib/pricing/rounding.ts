/**
 * Exact Round Half Away From Zero implementation using integer / BigInt arithmetic.
 *
 * Guarantees 100% bit-exact mathematical parity with PostgreSQL `round(numeric)`:
 * - Positive ties: 2070.5 rounds away from zero to 2071.
 * - Negative ties: -20.5 rounds away from zero to -21 (unlike Math.round which rounds to -20).
 * - Avoids any IEEE-754 floating point imprecision.
 */
export function roundHalfAwayFromZero(
  numerator: bigint | number,
  denominator: bigint | number = BigInt(10000)
): number {
  const num = BigInt(numerator);
  const den = BigInt(denominator);
  const zero = BigInt(0);
  const two = BigInt(2);

  if (den === zero) {
    throw new Error("Division by zero in roundHalfAwayFromZero");
  }

  const isNegative = (num < zero) !== (den < zero);
  const absNum = num < zero ? -num : num;
  const absDen = den < zero ? -den : den;

  // Add half of denominator to round half away from zero:
  // e.g. for den = 10000, half is 5000.
  // Integer division truncates towards zero.
  const half = absDen / two;
  const quotient = (absNum + half) / absDen;

  return Number(isNegative ? -quotient : quotient);
}

/**
 * Applies percentage BPS adjustment using exact Round Half Away From Zero.
 * Formula: unitPrice * (10000 + bps) / 10000
 */
export function applyPercentageAdjustment(
  unitPrice: number,
  percentageBps: number
): number {
  const numerator = BigInt(unitPrice) * BigInt(10000 + percentageBps);
  return roundHalfAwayFromZero(numerator, BigInt(10000));
}

/**
 * Calculates B2B commission using exact Round Half Away From Zero.
 * Formula: supplierBaseAmount * commissionRateBps / 10000
 */
export function calculateB2BCommission(
  supplierBaseAmount: number,
  commissionRateBps: number
): number {
  const numerator = BigInt(supplierBaseAmount) * BigInt(commissionRateBps);
  return roundHalfAwayFromZero(numerator, BigInt(10000));
}
