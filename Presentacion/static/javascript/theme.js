(function () {
  const KEY = "ui-theme";
  const root = document.documentElement;

  function getSavedTheme() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }

  function applyTheme(theme) {
    const dark = theme === "dark";
    document.body.classList.toggle("dark-theme", dark);
    root.setAttribute("data-theme", dark ? "dark" : "light");
  }

  function saveTheme(theme) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      // ignore write failures (private mode / restrictions)
    }
  }

  function buttonLabel(isDark) {
    return isDark ? "☀ Modo claro" : "🌙 Modo oscuro";
  }

  function setupToggle() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle";
    btn.id = "btn-theme-toggle";
    const isDark = document.body.classList.contains("dark-theme");
    btn.textContent = buttonLabel(isDark);
    btn.addEventListener("click", () => {
      const nowDark = !document.body.classList.contains("dark-theme");
      applyTheme(nowDark ? "dark" : "light");
      saveTheme(nowDark ? "dark" : "light");
      btn.textContent = buttonLabel(nowDark);
    });
    document.body.appendChild(btn);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const saved = getSavedTheme();
    applyTheme(saved === "dark" ? "dark" : "light");
    setupToggle();
  });
})();
