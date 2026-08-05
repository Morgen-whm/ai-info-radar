"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "trendhub-theme";
const THEME_EVENT = "trendhub-theme-change";

const subscribe = (onStoreChange: () => void) => {
  window.addEventListener(THEME_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
};

const getTheme = (): Theme =>
  document.documentElement.dataset.theme === "light" ? "light" : "dark";

const getServerTheme = (): Theme => "dark";

const applyTheme = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new Event(THEME_EVENT));
};

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getTheme, getServerTheme);

  return (
    <div className="theme-toggle" role="group" aria-label="页面颜色主题">
      <button
        type="button"
        aria-label="切换到日间浅色主题"
        aria-pressed={theme === "light"}
        onClick={() => applyTheme("light")}
      >
        <span className="theme-swatch theme-swatch-light" aria-hidden="true" />
        <span className="theme-option-label">日间</span>
      </button>
      <button
        type="button"
        aria-label="切换到夜间深色主题"
        aria-pressed={theme === "dark"}
        onClick={() => applyTheme("dark")}
      >
        <span className="theme-swatch theme-swatch-dark" aria-hidden="true" />
        <span className="theme-option-label">夜间</span>
      </button>
    </div>
  );
}
