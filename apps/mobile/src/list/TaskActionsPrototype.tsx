/**
 * Throwaway #177 prototype: compare three horizontal Task action rows on the
 * existing card surface. Switch entry point between overflow and long-press.
 */
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { tokens } from "../design-system";

type Variant = "A" | "B" | "C";
type EntryPoint = "overflow" | "long-press";
const variants: readonly Variant[] = ["A", "B", "C"];
const names: Record<Variant, string> = { A: "Labeled row", B: "Icon tiles", C: "Compact strip" };

export function TaskActionsPrototype() {
  const [variant, setVariant] = useState<Variant>("C");
  const [entryPoint, setEntryPoint] = useState<EntryPoint>("overflow");
  const [open, setOpen] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [doneCompleted, setDoneCompleted] = useState(true);
  const [doneMenu, setDoneMenu] = useState(false);
  const cycle = (delta: number) => setVariant(variants[(variants.indexOf(variant) + delta + variants.length) % variants.length]!);
  const triggerProps = (isOpen: boolean, setIsOpen: (value: boolean) => void) => entryPoint === "overflow"
    ? { accessibilityRole: "button" as const, accessibilityLabel: "Show Task actions", onPress: () => setIsOpen(!isOpen), onLongPress: undefined, delayLongPress: undefined }
    : { accessibilityRole: "button" as const, accessibilityLabel: "Long press for Task actions", onPress: () => setIsOpen(!isOpen), onLongPress: () => setIsOpen(true), delayLongPress: 450 };
  return <View style={styles.screen}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.badge}>#177 · PROTOTYPE ONLY</Text>
      <Text style={styles.title}>Task card actions</Text>
      <Text style={styles.intro}>Compare horizontal action rows at a narrow phone width. Choose the entry point, then open either Task.</Text>
      <View style={styles.choiceRow}><Text style={styles.choiceLabel}>Entry point</Text>{(["overflow", "long-press"] as const).map((choice) => <Pressable key={choice} accessibilityRole="button" accessibilityState={{ selected: entryPoint === choice }} onPress={() => { setEntryPoint(choice); setOpen(false); setDoneMenu(false); }} style={[styles.choice, entryPoint === choice && styles.choiceSelected]}><Text style={[styles.choiceText, entryPoint === choice && styles.choiceTextSelected]}>{choice === "overflow" ? "Overflow" : "Long-press"}</Text></Pressable>)}</View>
      <Text style={styles.section}>OPEN TASK</Text>
      <View style={styles.card}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open Task Buy groceries" onPress={() => {}} onLongPress={entryPoint === "long-press" ? () => setOpen((value) => !value) : undefined} delayLongPress={450} style={styles.cardBody}>
          <Text style={styles.cardEyebrow}>TASK · {completed ? "COMPLETED" : "TODAY"}</Text><Text style={[styles.cardTitle, completed && styles.struck]}>Buy groceries for dinner</Text><Text style={styles.cardMeta}>Home · errands</Text>
        </Pressable>
        {entryPoint === "overflow" ? <Pressable {...triggerProps(open, setOpen)} style={styles.more}><Text style={styles.moreText}>⋯</Text></Pressable> : <Text style={styles.holdHint}>Hold card for actions</Text>}
        {open ? <ActionRow variant={variant} verb={completed ? "Reopen" : "Complete"} onAction={() => { setCompleted((value) => !value); setOpen(false); }} onEdit={() => setOpen(false)} /> : null}
      </View>
      <Text style={styles.section}>COMPLETED TASK</Text>
      <View style={styles.card}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open Task Book dentist" onPress={() => {}} onLongPress={entryPoint === "long-press" ? () => setDoneMenu((value) => !value) : undefined} delayLongPress={450} style={styles.cardBody}>
          <Text style={styles.cardEyebrow}>TASK · {doneCompleted ? "COMPLETED" : "OPEN"}</Text><Text style={[styles.cardTitle, doneCompleted && styles.struck]}>Book dentist appointment</Text><Text style={styles.cardMeta}>Personal · Health</Text>
        </Pressable>
        {entryPoint === "overflow" ? <Pressable {...triggerProps(doneMenu, setDoneMenu)} style={styles.more}><Text style={styles.moreText}>⋯</Text></Pressable> : <Text style={styles.holdHint}>Hold card for actions</Text>}
        {doneMenu ? <ActionRow variant={variant} verb={doneCompleted ? "Reopen" : "Complete"} onAction={() => { setDoneCompleted((value) => !value); setDoneMenu(false); }} onEdit={() => setDoneMenu(false)} /> : null}
      </View>
      <Text style={styles.state}>Prototype state: {JSON.stringify({ variant, entryPoint, openTaskCompleted: completed, completedTaskReopened: !doneCompleted, openMenu: open, completedMenu: doneMenu })}</Text>
      <Text style={styles.note}>VoiceOver: every icon has a visible action word plus a complete spoken label and action hint.</Text>
    </ScrollView>
    <View style={styles.switcher}><Pressable accessibilityRole="button" accessibilityLabel="Previous action row" onPress={() => cycle(-1)} style={styles.arrow}><Text style={styles.arrowText}>‹</Text></Pressable><View style={styles.switchLabel}><Text style={styles.switchTitle}>{variant} · {names[variant]}</Text><Text style={styles.switchHint}>Change action row</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Next action row" onPress={() => cycle(1)} style={styles.arrow}><Text style={styles.arrowText}>›</Text></Pressable></View>
  </View>;
}

function ActionRow({ variant, verb, onAction, onEdit }: { readonly variant: Variant; readonly verb: string; readonly onAction: () => void; readonly onEdit: () => void }) {
  const actions = [{ icon: verb === "Complete" ? "✓" : "↶", label: verb, onPress: onAction }, { icon: "✎", label: "Edit", onPress: onEdit }];
  return <View style={[styles.actions, variant === "B" && styles.tileActions, variant === "C" && styles.compactActions]} accessibilityLabel="Task actions">
    {actions.map((action) => <Pressable key={action.label} accessibilityRole="button" accessibilityLabel={`${action.label} task`} accessibilityHint={`${action.label} this Task`} onPress={action.onPress} style={[styles.action, variant === "B" && styles.tile, variant === "C" && styles.compact]}>
      <Text style={styles.actionIcon}>{action.icon}</Text><Text style={[styles.actionLabel, variant === "C" && styles.compactLabel]}>{action.label}</Text>
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  screen: { backgroundColor: tokens.colors.background, flex: 1 }, content: { paddingBottom: 110, paddingHorizontal: 20, paddingTop: 18 },
  badge: { alignSelf: "flex-start", backgroundColor: tokens.colors.green, borderRadius: 16, color: tokens.colors.lime, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, paddingHorizontal: 11, paddingVertical: 7 },
  title: { color: tokens.colors.ink, fontSize: 27, fontWeight: "800", marginTop: 18 }, intro: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20, marginTop: 6 },
  choiceRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 20 }, choiceLabel: { color: tokens.colors.ink, fontSize: 13, fontWeight: "700", marginRight: 3 }, choice: { borderColor: tokens.colors.border, borderRadius: 18, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 }, choiceSelected: { backgroundColor: tokens.colors.green, borderColor: tokens.colors.green }, choiceText: { color: tokens.colors.ink, fontSize: 12, fontWeight: "700" }, choiceTextSelected: { color: tokens.colors.surface },
  section: { color: tokens.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 8, marginTop: 24 }, card: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 18, borderWidth: 1, marginBottom: 4, overflow: "hidden" }, cardBody: { padding: 16, paddingRight: 54 }, cardEyebrow: { color: tokens.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, marginBottom: 8 }, cardTitle: { color: tokens.colors.ink, fontSize: 17, fontWeight: "700", lineHeight: 23 }, struck: { color: tokens.colors.muted, textDecorationLine: "line-through" }, cardMeta: { color: tokens.colors.muted, fontSize: 12, marginTop: 10 }, more: { alignItems: "center", height: 44, justifyContent: "center", position: "absolute", right: 6, top: 6, width: 44 }, moreText: { color: tokens.colors.green, fontSize: 25 }, holdHint: { color: tokens.colors.muted, fontSize: 10, position: "absolute", right: 8, top: 9 },
  actions: { alignItems: "stretch", backgroundColor: "#F5F5F1", borderTopColor: tokens.colors.border, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 4, paddingVertical: 5 }, tileActions: { backgroundColor: "#EAF0E8", gap: 6, paddingHorizontal: 8, paddingVertical: 8 }, compactActions: { backgroundColor: tokens.colors.surface, paddingVertical: 1 }, action: { alignItems: "center", flex: 1, justifyContent: "center", minHeight: 54, minWidth: 0, paddingHorizontal: 2 }, tile: { backgroundColor: tokens.colors.surface, borderRadius: 12, minHeight: 62 }, compact: { flexDirection: "row", gap: 5, minHeight: 46 }, actionIcon: { color: tokens.colors.green, fontSize: 19, fontWeight: "800" }, actionLabel: { color: tokens.colors.ink, fontSize: 11, fontWeight: "700", marginTop: 3 }, compactLabel: { marginTop: 0 },
  state: { backgroundColor: "#F0EEE9", borderRadius: 12, color: tokens.colors.ink, fontSize: 11, lineHeight: 16, marginTop: 16, padding: 12 }, note: { color: tokens.colors.muted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  switcher: { alignItems: "center", alignSelf: "center", backgroundColor: tokens.colors.ink, borderRadius: 30, bottom: 14, elevation: 8, flexDirection: "row", minHeight: 58, paddingHorizontal: 8, position: "absolute", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 10 }, arrow: { alignItems: "center", height: 44, justifyContent: "center", width: 44 }, arrowText: { color: tokens.colors.surface, fontSize: 28 }, switchLabel: { alignItems: "center", minWidth: 132, paddingHorizontal: 8 }, switchTitle: { color: tokens.colors.surface, fontSize: 13, fontWeight: "800" }, switchHint: { color: "#CFD8D2", fontSize: 10, marginTop: 2 },
});
