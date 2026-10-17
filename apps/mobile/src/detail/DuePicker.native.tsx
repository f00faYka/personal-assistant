import DateTimePicker from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, View } from "react-native";

import type { DuePickerProps } from "./due-picker-props";
import { localDate, localTime, parseLocalDue } from "./local-due";

export function DuePicker({ mode, date, time, onDateChange, onTimeChange, disabled }: DuePickerProps) {
  const [availableWidth, setAvailableWidth] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const scale = availableWidth > 0 && size.width > 0 ? Math.min(1, availableWidth / size.width) : 1;
  const measured = size.height > 0;
  const value = parseLocalDue(date, time) ?? parseLocalDue(date, "12:00");
  if (!value) return null;
  // UIDatePicker reports an intrinsic width even when its React Native parent
  // is narrower. Fit that whole surface, including the next-month button.
  return <View testID="due-picker-container"
    onLayout={({ nativeEvent }) => setAvailableWidth(nativeEvent.layout.width)}
    style={{ width: "100%", height: measured ? size.height * scale : undefined }}>
    <View testID="due-picker-content"
      onLayout={({ nativeEvent }) => {
        const { width, height } = nativeEvent.layout;
        setSize((previous) => previous.width === width && previous.height === height ? previous : { width, height });
      }}
      style={{ alignSelf: "flex-start", position: measured ? "absolute" : "relative", transformOrigin: "top left", transform: [{ scale }] }}>
    <DateTimePicker
    value={value}
    mode={mode}
    display={Platform.OS === "ios" ? mode === "date" ? "inline" : "spinner" : "default"}
    themeVariant="light"
    accentColor="#FF3B30"
    disabled={disabled}
    onValueChange={(_event, selected) => {
      if (disabled || Number.isNaN(selected.getTime())) return;
      if (mode === "date") onDateChange(localDate(selected));
      else onTimeChange(localTime(selected));
    }}
    onDismiss={() => undefined}
    style={{ alignSelf: "flex-start" }}
  />
    </View>
  </View>;
}
