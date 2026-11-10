/** Where the other Agrimate web apps live. Inlined at build time, like NEXT_PUBLIC_API_URL. */
export const FARMER_URL = (process.env.NEXT_PUBLIC_FARMER_URL ?? 'http://localhost:3002').replace(/\/$/, '');
/** The console app, which also hosts the transport desk. */
export const ADMIN_URL = (process.env.NEXT_PUBLIC_ADMIN_URL ?? 'http://localhost:3001').replace(/\/$/, '');
