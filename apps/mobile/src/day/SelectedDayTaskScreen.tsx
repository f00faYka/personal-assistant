import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Heading, tokens } from "../design-system";
import { createMemberItemsClient, type MemberItemsClient, type TaskListItem } from "../list/member-items";
import { formatLocalDateHeading, loadCompleteMemberItems, tasksForLocalDate, type LocalDate } from "./selected-day";

interface SelectedDayTaskScreenProps {
  readonly apiBaseUrl?: string;
  readonly memberId: string;
  readonly selectedDate: LocalDate;
  readonly timeZone?: string;
  readonly client?: MemberItemsClient;
  readonly items?: readonly TaskListItem[];
  readonly renderTask: (task: TaskListItem) => ReactNode;
}

type ScreenState = { readonly status: "loading" } | { readonly status: "ready"; readonly items: readonly TaskListItem[] } | { readonly status: "error"; readonly message: string };

export function SelectedDayTaskScreen({ apiBaseUrl = "http://127.0.0.1:3000", memberId, selectedDate, timeZone, client: providedClient, items: providedItems, renderTask }: SelectedDayTaskScreenProps) {
  const [state, setState] = useState<ScreenState>(() => providedItems ? { status: "ready", items: providedItems } : { status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const client = useMemo(() => providedClient ?? createMemberItemsClient(apiBaseUrl), [apiBaseUrl, providedClient]);

  useEffect(() => {
    if (providedItems) { setState({ status: "ready", items: providedItems }); return; }
    let cancelled = false;
    setState({ status: "loading" });
    void loadCompleteMemberItems(client, memberId).then((result) => {
      if (!cancelled) setState({ status: "ready", items: result.items.filter((item): item is TaskListItem => item.kind === "task") });
    }).catch((error: unknown) => {
      if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "Unable to load Tasks" });
    });
    return () => { cancelled = true; };
  }, [client, memberId, providedItems, reloadToken]);

  const heading = formatLocalDateHeading(selectedDate, timeZone);
  return <ScrollView contentContainerStyle={styles.surface} accessibilityLabel={`Tasks for ${selectedDate}`}>
    <Heading eyebrow="Selected day">{heading}</Heading>
    {state.status === "loading" ? <View style={styles.state}><ActivityIndicator accessibilityLabel="Loading Tasks" /><Text style={styles.stateText}>Loading this day…</Text></View> : null}
    {state.status === "error" ? <View accessibilityRole="alert" style={styles.state}><Text style={styles.stateTitle}>Couldn’t load this day</Text><Text style={styles.stateText}>{state.message}</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry loading this day" onPress={() => setReloadToken((value) => value + 1)} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
    {state.status === "ready" ? <DayTaskList items={tasksForLocalDate(state.items, selectedDate, timeZone)} renderTask={renderTask} /> : null}
  </ScrollView>;
}

function DayTaskList({ items, renderTask }: { readonly items: readonly TaskListItem[]; readonly renderTask: (task: TaskListItem) => ReactNode }) {
  if (items.length === 0) return <View style={styles.state}><Text style={styles.stateTitle}>Nothing scheduled</Text><Text style={styles.stateText}>Undated and overdue Tasks stay in your full collection. They are not moved to this day.</Text></View>;
  return <View>{items.map((task) => <View key={task.id}>{renderTask(task)}</View>)}</View>;
}

const styles = StyleSheet.create({
  surface: { paddingBottom: tokens.spacing.lg },
  state: { alignItems: "center", paddingHorizontal: tokens.spacing.lg, paddingVertical: tokens.spacing.xl },
  stateTitle: { color: tokens.colors.ink, fontSize: 20, fontWeight: "800", textAlign: "center" },
  stateText: { color: tokens.colors.muted, fontSize: 15, lineHeight: 22, marginTop: 8, maxWidth: 340, textAlign: "center" },
  retry: { backgroundColor: tokens.colors.green, borderRadius: tokens.radius.control, marginTop: 20, paddingHorizontal: 20, paddingVertical: 12 },
  retryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
});
