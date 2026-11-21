/**
 * The main featured placement has no timer: it stays until an administrator replaces or removes it.
 * It is stored in the existing `featured_until` column as a far-future instant (2100-01-01T00:00:00Z), so every
 * existing `featured_until > now` query keeps working and no schema migration is needed.
 *
 * Kept in its own module so the routes and the scheduled cleanup share one definition without importing each other.
 */
export const FEATURED_OPEN_ENDED_UNTIL = 4102444800;

/** True when the row currently holds the open-ended (no countdown) featured placement. */
export const isOpenEndedFeature = (featuredUntil: unknown): boolean => Number(featuredUntil || 0) >= FEATURED_OPEN_ENDED_UNTIL;
