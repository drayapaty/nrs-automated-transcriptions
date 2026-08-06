Read `DECISIONS.md` before re-deciding anything (Groq-primary transcription, no whisper-1, Russian style rules, summary prompt location). Pipeline detail in `PIPELINE.md`. Zoom-class → Evernote + transcription distribution pipeline (not yet built): `ZOOM-PIPELINE.md`.

Step 4 ("Elaborate", `src/lib/pipeline/elaborate.ts`) has a hard rule (2026-08-06, see `DECISIONS.md`): never hand-edit/abridge Mahārāja's first-person book-voice output — always regenerate through the model with the VOICE calibration preserved, no exceptions.
