export interface DuePickerProps {
  readonly mode: "date" | "time";
  readonly date: string;
  readonly time: string;
  readonly onDateChange: (date: string) => void;
  readonly onTimeChange: (time: string) => void;
  readonly disabled: boolean;
}
