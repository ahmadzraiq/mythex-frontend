/**
 * Injects theme from config/theme.json as CSS variables.
 * Single source of truth - all theme values come from JSON, nothing in globals.css.
 */
import themeConfig from '@/config/theme.json';

function toCssVarName(key: string): string {
  return `--theme-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
}

export function ThemeStyles() {
  const vars: string[] = [];

  if (themeConfig.colors && typeof themeConfig.colors === 'object') {
    const colors = themeConfig.colors as Record<string, string>;
    for (const [key, value] of Object.entries(colors)) {
      vars.push(`${toCssVarName(key)}: ${value}`);
    }
    vars.push(`--background: ${colors.background ?? '#fafaf9'}`);
    vars.push(`--foreground: ${colors.text ?? '#1a1a1a'}`);
  }

  if (themeConfig.sections && typeof themeConfig.sections === 'object') {
    const sections = themeConfig.sections as Record<string, Record<string, string>>;
    for (const [sectionName, sectionColors] of Object.entries(sections)) {
      for (const [key, value] of Object.entries(sectionColors)) {
        vars.push(`--theme-${sectionName}-${key}: ${value}`);
      }
    }
  }

  const css = `:root { ${vars.join('; ')} }`;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
