import type { DuePickerProps } from "./due-picker-props";

// Metro selects DuePicker.native on devices. The shared editor and its draft rules
// are identical for real and fixture data; browsers use their own system controls.
export function DuePicker({ mode, date, time, onDateChange, onTimeChange, disabled }: DuePickerProps) {
  return <input
    aria-label={mode === "date" ? "Due date" : "Due time"}
    type={mode}
    value={mode === "date" ? date : time}
    disabled={disabled}
    step={mode === "time" ? 60 : undefined}
    onChange={(event) => (mode === "date" ? onDateChange : onTimeChange)(event.currentTarget.value)}
    style={{ boxSizing: "border-box", width: "100%", minHeight: 48, fontSize: 17, padding: 10, border: "1px solid #D1D1D6", borderRadius: 8, background: "#FFFFFF", color: "#000000", colorScheme: "light" }}
  />;
}
