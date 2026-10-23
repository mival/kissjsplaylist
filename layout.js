// Page layout for HTML that the server streams. Keep it the same as public/index.html.

export const escapeHtml = value => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const layoutStart = title => `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} – Rádio playlist</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.1.11"></script>
</head>
<body class="min-h-screen flex flex-col bg-slate-50 text-slate-800">
  <header class="bg-white border-b border-slate-200">
    <div class="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/" class="text-lg font-semibold">Rádio playlist</a>
    </div>
  </header>

  <main class="flex-1 max-w-5xl w-full mx-auto px-4 py-10">
    <h1 class="text-3xl font-bold mb-6">${escapeHtml(title)}</h1>
`;

export const layoutEnd = () => `
  </main>

  <footer class="border-t border-slate-200 bg-white">
    <div class="max-w-5xl mx-auto px-4 py-4 text-sm text-slate-500">
      kissjsplaylist
    </div>
  </footer>
</body>
</html>
`;

export const message = (text, type = 'info') => {
  const classes = {
    info: 'border-slate-200 bg-white text-slate-700',
    success: 'border-green-200 bg-green-50 text-green-800',
    error: 'border-red-200 bg-red-50 text-red-800'
  };
  return `<div class="mb-6 rounded-xl border px-4 py-3 ${classes[type]}">${text}</div>`;
};
