import { ThemeContext, useThemeProvider } from './hooks/useTheme';
import { AppShell } from './components/AppShell';

// Top-level shell: provide the theme app-wide, then hand off to the router.
// The previous single-page body now lives in views/RosIntrospection.tsx.
export default function App() {
  const themeCtx = useThemeProvider();
  return (
    <ThemeContext.Provider value={themeCtx}>
      <AppShell />
    </ThemeContext.Provider>
  );
}
