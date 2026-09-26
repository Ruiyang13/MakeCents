// Dark-mode toggle. The initial theme is stamped by an inline script in layout.pug.
document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-bs-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* private mode: theme just won't persist */
    }
  });
});

// Language toggle (English / 中文): remembered in a cookie the server reads, then reload.
document.querySelectorAll('[data-lang-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.cookie = `lang=${btn.dataset.langToggle}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  });
});
