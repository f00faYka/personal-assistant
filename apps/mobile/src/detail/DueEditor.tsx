import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { DuePicker } from "./DuePicker";
import { localDate, localTime, parseLocalDue } from "./local-due";

interface DueEditorProps {
  readonly dueAt: string | null;
  readonly editing: boolean;
  readonly disabled: boolean;
  readonly setEditing: (editing: boolean) => void;
  readonly setDueAt: (dueAt: string | null) => void;
}

export function DueEditor({ dueAt, editing, disabled, setEditing, setDueAt }: DueEditorProps) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [cleared, setCleared] = useState(false);
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const saved = dueAt ? new Date(dueAt) : null;
  const validSaved = saved && !Number.isNaN(saved.getTime()) ? saved : null;
  const draft = parseLocalDue(date, time);
  const visible = editing ? (cleared ? null : draft) : validSaved;
  const open = (mode: "date" | "time") => {
    if (editing && picker === mode) {
      setPicker(null);
      setEditing(false);
      return;
    }
    if (!editing) {
      const initial = validSaved ?? new Date();
      setDate(localDate(initial));
      setTime(localTime(initial));
      setCleared(false);
      setEditing(true);
    }
    setPicker(mode);
    setCleared(false);
  };
  const invalid = editing && !cleared && !draft;
  const applyDate = (value: string) => {
    setDate(value);
    const next = parseLocalDue(value, time);
    const unchanged = validSaved && value === localDate(validSaved) && time === localTime(validSaved);
    if (next && !unchanged) setDueAt(next.toISOString());
  };
  const applyTime = (value: string) => {
    setTime(value);
    const next = parseLocalDue(date, value);
    const unchanged = validSaved && date === localDate(validSaved) && value === localTime(validSaved);
    if (next && !unchanged) setDueAt(next.toISOString());
  };
  return <View style={styles.group}>
    <View style={styles.row}>
      <Text style={styles.label}>Due</Text>
      <View style={styles.values}>
        <Pressable accessibilityRole="button" accessibilityLabel={editing ? "Choose due date" : "Edit Due information"} disabled={disabled} onPress={() => open("date")} style={styles.value}>
          <Text style={[styles.valueText, editing && picker === "date" && styles.active]}>{visible ? visible.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : cleared || !editing ? "No due date" : date}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Choose due time" disabled={disabled} onPress={() => open("time")} style={styles.value}>
          <Text style={[styles.valueText, editing && picker === "time" && styles.active]}>{visible ? localTime(visible) : editing && !cleared ? time : "Set time"}</Text>
        </Pressable>
      </View>
    </View>
    {editing ? <>
      {!cleared && picker ? <DuePicker mode={picker} date={date} time={time} onDateChange={applyDate} onTimeChange={applyTime} disabled={disabled} /> : null}
      {invalid ? <Text accessibilityRole="alert" style={styles.error}>Enter a valid date and time (00:00–23:59). This local time must exist.</Text> : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Clear due information" disabled={disabled || cleared} onPress={() => { setCleared(true); setDueAt(null); setPicker(null); setEditing(false); }}><Text style={styles.active}>Clear</Text></Pressable>
      </View>
    </> : null}
  </View>;
}

const styles = StyleSheet.create({
  group: { backgroundColor: "#FFFFFF", borderRadius: 12, borderTopColor: "#D1D1D6", borderTopWidth: 1, overflow: "hidden", paddingBottom: 0, paddingTop: 4 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, paddingVertical: 4 },
  label: { fontSize: 17, color: "#000000", flexGrow: 1 },
  values: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  value: { backgroundColor: "#F2F2F7", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  valueText: { fontSize: 17, color: "#000000" },
  active: { color: "#FF3B30", fontSize: 17 },
  actions: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 4 },
  disabled: { opacity: 0.4 },
  error: { color: "#9B392B", fontSize: 13, marginVertical: 8 },
});
