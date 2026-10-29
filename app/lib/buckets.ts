// Shared by server and browser code (no ".server" in the name, so the page can import it).
export const BUCKETS = ["0-30", "31-60", "61-90", "91-180", "180+", "pre-release"] as const;
