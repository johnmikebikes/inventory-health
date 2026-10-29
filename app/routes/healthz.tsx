// Health check for the host (Render). No auth, no database.
export const loader = () => new Response("ok", { status: 200 });
