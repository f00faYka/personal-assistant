import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { formatLocalDateHeading, loadCompleteMemberItems, localDateKey, type LocalDate } from "../day/selected-day";
import { SelectedDayTaskScreen } from "../day/SelectedDayTaskScreen";
import { tokens } from "../design-system";
import { createMemberItemsClient, type MemberItemsClient, type TaskListItem } from "../list/member-items";
import { calendarMonthDays, shiftCalendarMonth, type CalendarMonth } from "./calendar-dates";

interface CalendarScreenProps {
  readonly apiBaseUrl?: string;
  readonly memberId: string;
  readonly selectedDate: LocalDate;
  readonly timeZone: string;
  readonly client?: MemberItemsClient;
  readonly onSelectDate: (date: LocalDate) => void;
  readonly onReturnToToday: (date: LocalDate) => void;
}

type ActivityState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly tasks: readonly TaskListItem[] }
  | { readonly status: "error" };

export function CalendarScreen({ apiBaseUrl, memberId, selectedDate, timeZone, client: providedClient, onSelectDate, onReturnToToday }: CalendarScreenProps) {
  const client = useMemo(() => providedClient ?? createMemberItemsClient(apiBaseUrl ?? "http://127.0.0.1:3000"), [apiBaseUrl, providedClient]);
  const [visibleMonth, setVisibleMonth] = useState(() => calendarMonthForDate(selectedDate));
  const [activity, setActivity] = useState<ActivityState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const days = calendarMonthDays(visibleMonth);
  const monthTitle = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(visibleMonth.year, visibleMonth.month - 1, 15, 12)));
  const today = localDateKey(new Date(), timeZone);
  const scheduledDates = activity.status === "ready"
    ? new Set(activity.tasks.flatMap((task) => task.dueAt ? [localDateKey(task.dueAt, timeZone)] : []))
    : new Set<LocalDate>();

  useEffect(() => {
    let cancelled = false;
    setActivity({ status: "loading" });
    void loadCompleteMemberItems(client, memberId).then(({ items }) => {
      if (!cancelled) setActivity({ status: "ready", tasks: items.filter((item): item is TaskListItem => item.kind === "task") });
    }).catch(() => {
      if (!cancelled) setActivity({ status: "error" });
    });
    return () => { cancelled = true; };
  }, [client, memberId, reloadToken]);

  const goToToday = () => {
    const date = localDateKey(new Date(), timeZone);
    setVisibleMonth(calendarMonthForDate(date));
    onReturnToToday(date);
  };

  return <View style={styles.screen}>
    <View style={styles.fixedHeader}>
      <View style={styles.header}>
        <View style={styles.monthTitleWrap}>
          <Text style={styles.eyebrow}>Calendar</Text>
          <View style={styles.monthTitleLine}>
            <Text style={styles.monthTitle}>{monthTitle}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setVisibleMonth((month) => shiftCalendarMonth(month, -1))} style={styles.monthArrow}><Text style={styles.arrowText}>‹</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setVisibleMonth((month) => shiftCalendarMonth(month, 1))} style={styles.monthArrow}><Text style={styles.arrowText}>›</Text></Pressable>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Return to today" onPress={goToToday} style={styles.todayButton}><Text style={styles.todayText}>Today</Text></Pressable>
      </View>
    </View>
    <ScrollView style={styles.monthScroll} contentContainerStyle={styles.monthContent}>
      <View style={styles.calendar}>
        <View style={styles.weekdays}>{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}</View>
        <View style={styles.grid}>{days.map((date, index) => date ? <Pressable key={date}
          accessibilityRole="button"
          accessibilityLabel={`Select ${formatLocalDateHeading(date, timeZone)}${scheduledDates.has(date) ? " · scheduled tasks" : ""}`}
          accessibilityState={{ selected: date === selectedDate }}
          onPress={() => onSelectDate(date)}
          style={styles.dateCell}>
          <View style={[styles.dateNumber, date === selectedDate && styles.dateSelected, date === today && date !== selectedDate && styles.dateToday]}>
            <Text style={[styles.dateText, date === selectedDate && styles.dateTextSelected, date === today && date !== selectedDate && styles.dateTextToday]}>{calendarDayNumber(date)}</Text>
          </View>
          {scheduledDates.has(date) ? <View style={[styles.activityDot, date === selectedDate && styles.activityDotSelected]} /> : <View style={styles.activityPlaceholder} />}
        </Pressable> : <View key={`empty-${index}`} style={styles.dateCell} />)}</View>
        {activity.status === "loading" ? <View style={styles.activityStatus}><ActivityIndicator accessibilityLabel="Loading calendar activity" /><Text style={styles.statusText}>Loading scheduled activity…</Text></View> : null}
        {activity.status === "error" ? <View accessibilityRole="alert" style={styles.activityError}><Text style={styles.errorText}>Calendar activity is unavailable.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry calendar activity" onPress={() => setReloadToken((value) => value + 1)}><Text style={styles.retryText}>Try again</Text></Pressable></View> : null}
      </View>
    </ScrollView>
  </View>;
}

export function CalendarSelectedDayScreen({ apiBaseUrl, memberId, selectedDate, timeZone, client, onBack, renderTask }: {
  readonly apiBaseUrl?: string;
  readonly memberId: string;
  readonly selectedDate: LocalDate;
  readonly timeZone: string;
  readonly client?: MemberItemsClient;
  readonly onBack: () => void;
  readonly renderTask: (task: TaskListItem) => ReactNode;
}) {
  return <SafeAreaView edges={["top", "bottom"]} style={styles.dayScreen}>
    <View style={styles.dayHeader}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Calendar" onPress={onBack} style={styles.backButton}><Text style={styles.backText}>‹  Calendar</Text></Pressable>
      <Text style={styles.homeLabel}>HOME</Text>
      <View style={styles.backSpacer} />
    </View>
    <SelectedDayTaskScreen {...(apiBaseUrl ? { apiBaseUrl } : {})} memberId={memberId} selectedDate={selectedDate} timeZone={timeZone} {...(client ? { client } : {})} renderTask={renderTask} />
  </SafeAreaView>;
}

function calendarMonthForDate(date: LocalDate): CalendarMonth {
  const [year, month] = date.split("-").map(Number);
  return { year: year!, month: month! };
}

function calendarDayNumber(date: LocalDate): number { return Number(date.slice(-2)); }

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: tokens.spacing.lg, paddingTop: tokens.spacing.md },
  fixedHeader: { paddingBottom: tokens.spacing.sm },
  monthScroll: { flex: 1 },
  monthContent: { paddingBottom: tokens.spacing.lg },
  header: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "space-between", marginBottom: tokens.spacing.md },
  monthTitleWrap: { flex: 1, minWidth: 0 },
  monthTitleLine: { alignItems: "center", flexDirection: "row", gap: 2 },
  eyebrow: { color: tokens.colors.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase" },
  monthTitle: { color: tokens.colors.ink, flexShrink: 1, fontSize: 22, fontWeight: "800", lineHeight: 29 },
  headerActions: { alignItems: "center", flexDirection: "row", flexShrink: 0 },
  todayButton: { borderColor: tokens.colors.border, borderRadius: tokens.radius.control, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 7 },
  todayText: { color: tokens.colors.green, fontSize: 13, fontWeight: "800" },
  monthArrow: { alignItems: "center", backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: 17, borderWidth: 1, height: 34, justifyContent: "center", width: 34 },
  arrowText: { color: tokens.colors.green, fontSize: 25, lineHeight: 29 },
  calendar: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: tokens.radius.card, borderWidth: 1, paddingHorizontal: 8, paddingTop: 13, paddingBottom: 9 },
  weekdays: { flexDirection: "row", justifyContent: "space-around", marginBottom: 7 },
  weekday: { color: tokens.colors.muted, fontSize: 12, fontWeight: "700", textAlign: "center", width: "14.2857%" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dateCell: { alignItems: "center", height: 45, justifyContent: "flex-start", paddingTop: 2, width: "14.2857%" },
  dateNumber: { alignItems: "center", borderRadius: 18, height: 34, justifyContent: "center", width: 34 },
  dateSelected: { backgroundColor: tokens.colors.green },
  dateToday: { borderColor: tokens.colors.green, borderWidth: 1.5 },
  dateText: { color: tokens.colors.ink, fontSize: 14, fontWeight: "600" },
  dateTextSelected: { color: "#FFFFFF", fontWeight: "800" },
  dateTextToday: { color: tokens.colors.green, fontWeight: "800" },
  activityDot: { backgroundColor: tokens.colors.green, borderRadius: 3, height: 5, marginTop: 2, width: 5 },
  activityDotSelected: { backgroundColor: tokens.colors.lime },
  activityPlaceholder: { height: 7 },
  activityStatus: { alignItems: "center", flexDirection: "row", gap: 8, justifyContent: "center", paddingBottom: 8, paddingTop: 5 },
  activityError: { alignItems: "center", borderTopColor: tokens.colors.border, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 7, paddingVertical: 11 },
  errorText: { color: tokens.colors.muted, fontSize: 13 },
  retryText: { color: tokens.colors.green, fontSize: 13, fontWeight: "800" },
  emptyTitle: { color: tokens.colors.ink, fontSize: 17, fontWeight: "700", textAlign: "center" },
  statusText: { color: tokens.colors.muted, fontSize: 14, lineHeight: 20, marginTop: 5, textAlign: "center" },
  dayScreen: { backgroundColor: tokens.colors.background, flex: 1 },
  dayHeader: { alignItems: "center", backgroundColor: tokens.colors.surface, borderBottomColor: tokens.colors.border, borderBottomWidth: 1, flexDirection: "row", height: 54, justifyContent: "space-between", paddingHorizontal: 16 },
  backButton: { minWidth: 92, paddingVertical: 8 },
  backText: { color: tokens.colors.green, fontSize: 16, fontWeight: "700" },
  homeLabel: { color: tokens.colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.8 },
  backSpacer: { minWidth: 92 },
});
