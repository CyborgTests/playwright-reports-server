export default function RootLayout({
  children,
}: {
  children: string
}) {
  return (
    <html lang="en">
      <body>
            {children}
      </body>
    </html>
  );
}
