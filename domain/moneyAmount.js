// Strict parsing of a typed money amount into exact integer centavos.
// Used at the persistence boundary (services) and by the UI so that what the user sees, what is saved,
// what is optimized and what is exported are always the same number.
//
// Accepted: digits with up to two decimals and optional, correctly grouped thousands commas
//   "1250.50", "1,250.50", "12,500", "1,234,567.89", "0.50", "0", " 25 " (surrounding spaces are trimmed)
// Rejected (never guessed): "12,34.50", "1,250.999", "1,,250", "abc123", "-500", ".5", "5.", "1e3", "NaN", "Infinity", "₱5"
// Blank (empty or whitespace only) is not an error: callers decide whether a blank amount is allowed.
export const maximumMoneyCents = 999999999999; // 9,999,999,999.99 — the capacity of the numeric(12,2) receipts column

const amountPattern = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;
const example = 'Use digits with up to two decimals and optional thousands commas, for example 1,250.50.';

const reasonFor = text => {
  if (/^-/.test(text)) return 'Amounts cannot be negative.';
  if (/^\d[\d,]*\.\d{3,}$/.test(text)) return 'Use at most two decimal places.';
  if (/,/.test(text) && /^[\d,.]+$/.test(text)) return 'Thousands commas must group exactly three digits (1,250.50) and cannot follow the decimal point.';
  if (/\..*\./.test(text)) return 'Use only one decimal point.';
  return example;
};

export class InvalidMoneyAmountError extends Error {
  constructor(raw, reason) {
    super(`Invalid amount "${String(raw).trim()}". ${reason}`);
    this.name = 'InvalidMoneyAmountError';
    this.rawAmount = String(raw);
    this.reason = reason;
  }
}

// Returns { blank: true } | { valid: true, cents, amount, canonical } | { valid: false, reason, message }
export function parseMoneyAmount(raw) {
  if (raw === null || raw === undefined) return { blank: true };
  const text = typeof raw === 'number' ? (Number.isFinite(raw) ? String(raw) : 'NaN') : String(raw).trim();
  if (!text) return { blank: true };
  const invalid = reason => ({ valid: false, reason, message: new InvalidMoneyAmountError(text, reason).message });
  const match = amountPattern.exec(text);
  if (!match) return invalid(reasonFor(text));
  const whole = match[1].replaceAll(',', '').replace(/^0+(?=\d)/, '');
  if (whole.length > 10) return invalid(`Amounts cannot exceed 9,999,999,999.99.`);
  const cents = Number(whole) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > maximumMoneyCents) return invalid('Amounts cannot exceed 9,999,999,999.99.');
  const canonical = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
  return { valid: true, cents, amount: Number(canonical), canonical };
}

// For persistence: returns the numeric amount to store, or null for a blank amount; throws InvalidMoneyAmountError for malformed non-blank input.
export function normalizeMoneyAmount(raw) {
  const parsed = parseMoneyAmount(raw);
  if (parsed.blank) return null;
  if (!parsed.valid) throw new InvalidMoneyAmountError(raw, parsed.reason);
  return parsed.amount;
}
