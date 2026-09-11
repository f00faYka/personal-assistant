import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";

export const tokens = {
  colors: {
    background: "#F8F6F1",
    surface: "#FFFFFF",
    ink: "#24221F",
    muted: "#716B64",
    border: "#E5E0D8",
    green: "#173B2F",
    lime: "#D9F26A",
    butter: "#FFF0B8",
    lavender: "#E8DFFF",
    blue: "#D8ECF4",
    orange: "#F8D9C7",
  },
  radius: { card: 20, control: 14, pill: 999 },
  spacing: { xs: 6, sm: 10, md: 16, lg: 24, xl: 32 },
} as const;

export function ScreenLayout({ children }: { readonly children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Heading({ eyebrow, children }: { readonly eyebrow?: string; readonly children: ReactNode }) {
  return <View style={styles.heading}>{eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}<Text style={styles.title}>{children}</Text></View>;
}

export function Card({ children, tone = "white" }: { readonly children: ReactNode; readonly tone?: "white" | "butter" | "lavender" | "blue" | "orange" }) {
  const toneStyle = { white: styles.cardWhite, butter: styles.cardButter, lavender: styles.cardLavender, blue: styles.cardBlue, orange: styles.cardOrange }[tone];
  return <View style={[styles.card, toneStyle]}>{children}</View>;
}

export function Chip({ children }: { readonly children: ReactNode }) {
  return <View style={styles.chip}><Text style={styles.chipText}>{children}</Text></View>;
}

export function PrimaryButton({ label, onPress, accessibilityLabel = label }: { readonly label: string; readonly onPress?: () => void; readonly accessibilityLabel?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{label}</Text></Pressable>;
}

export function TaskRow({ title, detail, completed = false }: { readonly title: string; readonly detail?: string; readonly completed?: boolean }) {
  return <View style={styles.taskRow}><View style={[styles.checkbox, completed && styles.checkboxCompleted]}>{completed ? <Text style={styles.checkmark}>✓</Text> : null}</View><View style={styles.taskCopy}><Text style={[styles.taskTitle, completed && styles.taskCompleted]}>{title}</Text>{detail ? <Text style={styles.taskDetail}>{detail}</Text> : null}</View></View>;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: tokens.colors.background, flex: 1 },
  heading: { paddingHorizontal: tokens.spacing.lg, paddingTop: tokens.spacing.lg, paddingBottom: tokens.spacing.md },
  eyebrow: { color: tokens.colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase" },
  title: { color: tokens.colors.ink, fontSize: 34, fontWeight: "800", lineHeight: 40, marginTop: tokens.spacing.xs },
  card: { borderRadius: tokens.radius.card, marginHorizontal: tokens.spacing.lg, marginBottom: tokens.spacing.md, padding: tokens.spacing.lg },
  cardWhite: { backgroundColor: tokens.colors.surface },
  cardButter: { backgroundColor: tokens.colors.butter },
  cardLavender: { backgroundColor: tokens.colors.lavender },
  cardBlue: { backgroundColor: tokens.colors.blue },
  cardOrange: { backgroundColor: tokens.colors.orange },
  chip: { backgroundColor: "rgba(23, 59, 47, 0.08)", borderRadius: tokens.radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: tokens.colors.green, fontSize: 12, fontWeight: "700" },
  primaryButton: { alignItems: "center", backgroundColor: tokens.colors.green, borderRadius: tokens.radius.control, paddingHorizontal: tokens.spacing.md, paddingVertical: 13 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  taskRow: { alignItems: "center", flexDirection: "row", gap: 12 },
  checkbox: { borderColor: tokens.colors.green, borderRadius: 10, borderWidth: 2, height: 22, width: 22 },
  checkboxCompleted: { alignItems: "center", backgroundColor: tokens.colors.green, justifyContent: "center" },
  checkmark: { color: "#FFFFFF", fontSize: 14, fontWeight: "800" },
  taskCopy: { flex: 1 },
  taskTitle: { color: tokens.colors.ink, fontSize: 16, fontWeight: "700" },
  taskCompleted: { textDecorationLine: "line-through" },
  taskDetail: { color: tokens.colors.muted, fontSize: 13, marginTop: 4 },
});
