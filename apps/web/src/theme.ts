export type ThemePreference = "system" | "light" | "dark";
const KEY = "reparo360.theme";

// localStorage guarda só a preferência visual deste navegador (conveniência). Pode estar bloqueado:
// tudo é protegido por try/catch e a tela funciona sem ele.
export function readTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
  try {
    if (preference === "system") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, preference);
  } catch {
    /* sem armazenamento: a escolha vale só nesta sessão */
  }
}
