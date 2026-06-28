export default function CheckEmail() {
  return (
    <main className="container">
      <header className="header">
        <div className="om">श्री</div>
        <h1>Check your inbox</h1>
        <p className="subtitle">A sign-in link is on its way. It expires in 24 hours and can be used once.</p>
      </header>
      <section className="card">
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          If you don&apos;t see the email within a minute, check spam or the &ldquo;Promotions&rdquo; tab. The sender is{" "}
          <strong>mailouts@niranjanaswami.net</strong>.
        </p>
      </section>
      <footer className="footer">
        Niranjana Swami — Transcribe · {new Date().getFullYear()}
      </footer>
    </main>
  );
}
