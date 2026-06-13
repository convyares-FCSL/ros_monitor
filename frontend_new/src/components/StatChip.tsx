// Icon + value + label chip used in the page top bars. Shared by the ROS
// Introspection header (Nodes/Topics/Services/Actions) and the Behavior Tree
// header (Trees/Nodes/status) so the two tops read identically.
export function Stat({ icon, label, value, colorHex }: {
  icon: React.ReactNode; label: string; value: number; colorHex: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: colorHex }} className="opacity-70">{icon}</span>
      <div>
        <div className="text-sm font-bold font-mono leading-none" style={{ color: colorHex }}>{value}</div>
        <div className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--menu-text-dim)' }}>{label}</div>
      </div>
    </div>
  );
}
