/** Safe operator-facing readiness errors contain no SQL, credentials, or endpoint details. */
export class CatalogReadinessError extends Error {}
