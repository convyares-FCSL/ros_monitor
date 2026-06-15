// Small form primitives shared by the Settings page and the RosIntrospection
// Scene Settings modal, so the two stay visually identical.

export function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold text-[color:rgb(var(--fg-rgb)/0.6)]">{label}</span>
      {children}
    </div>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors duration-200
        ${checked ? 'bg-cyan-500/50' : 'bg-[rgb(var(--fg-rgb)/0.1)]'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-[rgb(var(--fg-rgb))] shadow transition-transform duration-200
        ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function SliderInput({ value, min, max, step, onChange, suffix, percent }: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; suffix: string; percent?: boolean;
}) {
  const safeValue = value ?? min;
  const display = percent ? `${(safeValue * 100).toFixed(0)}%` : `${safeValue.toFixed(step < 0.01 ? 3 : 1)}${suffix}`;
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={min} max={max} step={step} value={safeValue}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-28 h-1.5 rounded-full appearance-none bg-[rgb(var(--fg-rgb)/0.1)] cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[rgb(var(--fg-rgb)/0.9)] [&::-webkit-slider-thumb]:shadow-md"
      />
      <span className="text-xs font-mono text-[color:rgb(var(--fg-rgb)/0.4)] w-12 text-right">{display}</span>
    </div>
  );
}
