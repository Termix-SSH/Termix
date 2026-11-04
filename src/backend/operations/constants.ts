/** How many events or actions may lead to one another before the chain stops. */
export const MAX_EVENT_DEPTH = 3;

/** How long finished runs and events stay in history. */
export const RETENTION_DAYS = 90;

/** How long a cached table row or tile counts as fresh. */
export const RESOURCE_FRESH_MS = 60_000;
