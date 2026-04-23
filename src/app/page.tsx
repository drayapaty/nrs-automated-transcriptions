export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 720 }}>
      <h1>nrs-automated-transcriptions</h1>
      <p>
        Internal API service. Transcribes audio (Deepgram → Claude cleanup),
        optionally translates (RU/UK), and indexes results to OpenSearch.
      </p>
      <h2>Endpoints</h2>
      <ul>
        <li>
          <code>POST /api/jobs</code> — create a transcription job
        </li>
        <li>
          <code>GET /api/jobs/:id</code> — poll job status / get result
        </li>
        <li>
          <code>POST /api/jobs/:id/translate</code> — request additional translations
        </li>
        <li>
          <code>POST /api/jobs/:id/index</code> — index transcript to OpenSearch
        </li>
        <li>
          <code>GET /api/health</code> — health check
        </li>
      </ul>
      <p>
        See <a href="https://github.com/drayapaty/nrs-automated-transcriptions">README</a> for
        request/response shapes and auth.
      </p>
    </main>
  );
}
