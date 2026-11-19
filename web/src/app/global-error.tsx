'use client';

// Last resort when the root layout itself fails: the app's CSS may not be loaded here, so styles are inline.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-IN">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f7f6f1', color: '#1c1917' }}>
        <main style={{ maxWidth: 420, margin: '15vh auto', padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#57534e', lineHeight: 1.5 }}>Agrimate couldn’t load. Please try again in a moment.</p>
          {error.digest && <p style={{ color: '#a8a29e', fontFamily: 'monospace', fontSize: 12 }}>Reference: {error.digest}</p>}
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 16, background: '#1f563d', color: '#fff', border: 0, borderRadius: 12, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
