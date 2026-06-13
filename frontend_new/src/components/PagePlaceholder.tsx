import type { LucideIcon } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { TopBar } from './TopBar';

interface PagePlaceholderProps {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  tag?: string;
  children?: React.ReactNode;
}

// Styled, theme-aware empty state shared by the not-yet-built pages.
export function PagePlaceholder({ icon: Icon, title, subtitle, tag = 'Coming in a later phase', children }: PagePlaceholderProps) {
  const { theme } = useTheme();
  return (
    <div className="absolute inset-0" style={{ background: theme.bg }}>
      <TopBar title={title} icon={Icon} />
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
        style={{ background: `${theme.accentHex}15`, border: `1px solid ${theme.accentHex}40` }}>
        <Icon className="w-8 h-8" style={{ color: theme.accentHex }} strokeWidth={1.8} />
      </div>
      <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--page-text)' }}>{title}</h1>
      <p className="mt-2 text-sm max-w-md leading-relaxed" style={{ color: 'var(--page-text-muted)' }}>{subtitle}</p>
      {children && <div className="mt-6">{children}</div>}
      <div className="mt-8 text-[10px] font-mono uppercase tracking-[0.2em]" style={{ color: 'var(--page-text-dim)' }}>{tag}</div>
      </div>
    </div>
  );
}
