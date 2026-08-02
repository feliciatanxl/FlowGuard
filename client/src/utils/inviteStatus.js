// Tenant-invite time helpers. Extracted from the TenantManagement page so the
// page file only exports its component (React Fast Refresh requirement) while
// tests and the page share one implementation.
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// "1 day 16 hours" / "3 hours 12 minutes" / "45 minutes" / "under 1 minute"
export const formatRemainingDuration = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (days > 0) return hours > 0 ? `${plural(days, 'day')} ${plural(hours, 'hour')}` : plural(days, 'day');
  if (hours > 0) return minutes > 0 ? `${plural(hours, 'hour')} ${plural(minutes, 'minute')}` : plural(hours, 'hour');
  if (minutes > 0) return plural(minutes, 'minute');
  return 'under 1 minute';
};

// The SERVER status stays authoritative; the local clock only downgrades a
// PENDING invite to EXPIRED the moment its server expiry time passes so an
// expired code never looks usable while waiting for the next refresh.
export const deriveInviteStatus = (invite, now = Date.now()) => {
  const serverStatus = invite.status || (invite.isUsed ? 'USED' : 'PENDING');
  if (serverStatus === 'PENDING' && invite.expiresAt && now >= new Date(invite.expiresAt).getTime()) {
    return 'EXPIRED';
  }
  return serverStatus;
};
