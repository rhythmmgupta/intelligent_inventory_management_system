const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(amount) {
  const numeric = Number(amount || 0);
  if (!Number.isFinite(numeric)) return '₹0.00';
  return inrFormatter.format(numeric);
}
