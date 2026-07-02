export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        backgroundColor: '#131416',
        color: '#F5F6F7',
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <p style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
        GYM Tracker API · The GM Method —{' '}
        <span style={{ color: '#FF3B30' }}>running</span>
      </p>
      <p style={{ fontSize: 14, color: '#9BA0A6', margin: 0 }}>
        POST /api/auth/register · POST /api/auth/login · GET /api/me · POST
        /api/auth/logout
      </p>
    </main>
  );
}
