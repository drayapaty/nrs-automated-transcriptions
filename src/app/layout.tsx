export const metadata = {
  title: "NRS Automated Transcriptions",
  description: "Transcription + translation + indexing service",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
