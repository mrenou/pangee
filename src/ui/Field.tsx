import type { ReactNode } from 'react';

interface FieldProps {
  readonly id: string;
  readonly label: ReactNode;
  readonly value: ReactNode;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly current: number;
  readonly onChange: (value: number) => void;
}

/** Un curseur avec son libellé et sa valeur lue, toujours accompagnée de son unité. */
export function Field({ id, label, value, min, max, step, current, onChange }: FieldProps) {
  return (
    <div className="mt-3">
      <label className="flex items-baseline justify-between text-sm" htmlFor={id}>
        <span>{label}</span>
        <span className="tabular-nums text-ink-soft">{value}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="mt-1 w-full accent-ink-soft"
      />
    </div>
  );
}
