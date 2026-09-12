/** Disposable, fixture-only implementation of the approved due-badge card direction. */
import { useRef, useState } from "react";
import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { tokens } from "../design-system";
import type { BrowserFixtureData, BrowserFixtureNote, BrowserFixtureTask } from "./fixture-data";

interface SharedProps {
  readonly fixture: BrowserFixtureData;
  readonly onPress: () => void;
}
export type CardSaveState = "saved" | "pending" | "error";

export function TaskCard({ task, fixture, onPress, onSetCompleted, saveState = "saved", onRetry, timeZone, today }: SharedProps & {
  readonly task: BrowserFixtureTask;
  readonly onSetCompleted?: (completed: boolean) => void;
  readonly saveState?: CardSaveState;
  readonly onRetry?: () => void;
  readonly timeZone: string;
  readonly today: string;
}) {
  const completed = task.status === "completed";
  const canComplete = !completed && saveState === "saved" && !!onSetCompleted;
  return <CardFrame kind="Task" title={task.title} badge={formatDue(task.dueAt, timeZone, today)} mutedBadge={!task.dueAt}
    completed={completed} onPress={onPress}
    onComplete={canComplete ? () => onSetCompleted?.(true) : undefined}
    onSetCompleted={completed && saveState === "saved" ? onSetCompleted : undefined}
    metadata={<Metadata fixture={fixture} spaceId={task.spaceId} tagIds={task.tagIds} />}
    status={saveState === "pending" ? <Text style={styles.pending} accessibilityLiveRegion="polite">Saving… · completion unavailable</Text> : saveState === "error" ? <View style={styles.errorRow}><Text style={styles.error} accessibilityRole="alert">Not saved · task still open</Text>{onRetry ? <Pressable accessibilityRole="button" accessibilityLabel={`Retry saving ${task.title}`} onPress={onRetry} style={styles.retry}><Text style={styles.error}>Retry</Text></Pressable> : null}</View> : completed ? <Text style={styles.completedLabel}>✓ Completed</Text> : null} />;
}

export function NoteCard({ note, fixture, onPress }: SharedProps & { readonly note: BrowserFixtureNote }) {
  return <CardFrame kind="Note" title={note.content} badge={note.reviewState === "needs_review" ? "Needs review" : undefined}
    onPress={onPress}
    metadata={<Metadata fixture={fixture} spaceId={note.spaceId} tagIds={note.tagIds} />} />;
}

function CardFrame({ kind, title, badge, mutedBadge = false, completed = false, onPress, onComplete, onSetCompleted, metadata, status }: {
  readonly kind: "Task" | "Note";
  readonly title: string;
  readonly badge?: string | undefined;
  readonly mutedBadge?: boolean;
  readonly completed?: boolean;
  readonly onPress: () => void;
  readonly onComplete?: (() => void) | undefined;
  readonly onSetCompleted?: ((completed: boolean) => void) | undefined;
  readonly metadata: ReactNode;
  readonly status?: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const [dragX, setDragX] = useState(0);
  const swipeDx = useRef(0);
  const [menu, setMenu] = useState(false);
  const suppressPress = useRef(false);
  const note = kind === "Note";
  const shouldCaptureSwipe = (_: unknown, gesture: { readonly dx: number; readonly dy: number }) =>
    !!onComplete && Math.abs(gesture.dx) > 14 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5;
  const swipe = PanResponder.create({
    onMoveShouldSetPanResponder: shouldCaptureSwipe,
    onMoveShouldSetPanResponderCapture: shouldCaptureSwipe,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { suppressPress.current = true; swipeDx.current = 0; setDragX(0); },
    onPanResponderMove: (_, gesture) => { swipeDx.current = gesture.dx; setDragX(Math.max(-88, Math.min(0, gesture.dx))); },
    onPanResponderRelease: (_, gesture) => {
      const dx = swipeDx.current || gesture.dx;
      setRevealed(dx < -40 || (revealed && dx <= 40));
      swipeDx.current = 0;
      setDragX(0);
    },
    onPanResponderTerminate: () => { suppressPress.current = true; swipeDx.current = 0; setDragX(0); },
  });
  const complete = () => { setRevealed(false); setMenu(false); onComplete?.(); };
  const toggleCompleted = () => { setMenu(false); onSetCompleted?.(!completed); };
  return <View style={styles.wrapper}>
    <View style={styles.clip}>
      {revealed && onComplete ? <Pressable accessibilityRole="button" accessibilityLabel={`Complete Task ${title}`} onPress={complete} style={styles.swipeAction}><Text style={styles.swipeCheck}>✓</Text><Text style={styles.swipeText}>Complete</Text></Pressable> : null}
      <View
        {...swipe.panHandlers}
        style={[styles.card, note && styles.note, onComplete && { transform: [{ translateX: revealed ? -88 : dragX }] }]}
      >
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${kind} ${title}`} onPressIn={() => { suppressPress.current = false; }}
          onPress={() => { if (!suppressPress.current) { if (revealed) setRevealed(false); else onPress(); } }}
          delayLongPress={500} onLongPress={() => { suppressPress.current = true; setMenu(true); }} style={styles.body}>
          <View style={styles.header}><ItemIcon note={note} />{badge ? <Text numberOfLines={1} style={[styles.badge, note && styles.review, mutedBadge && styles.mutedBadge]}>{badge}</Text> : null}</View>
          <Text numberOfLines={note ? 3 : 2} style={[styles.title, note && styles.preview, completed && styles.struck]}>{title}</Text>
          {metadata}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${kind} ${title}`} accessibilityState={{ expanded: menu }} onPress={() => setMenu(true)} style={styles.more}><Text style={styles.moreText}>⋯</Text></Pressable>
        {status}
      </View>
    </View>
    <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss card actions" onPress={() => setMenu(false)} style={styles.backdrop} />
        <View accessibilityViewIsModal style={styles.menu}>
          <Text numberOfLines={2} style={styles.menuTitle}>{title}</Text>
          {onComplete ? <Pressable accessibilityRole="button" onPress={complete} accessibilityLabel={`Mark complete ${title}`} style={styles.menuAction}><Text style={styles.menuText}>✓  Mark complete</Text></Pressable> : onSetCompleted ? <Pressable accessibilityRole="button" onPress={toggleCompleted} accessibilityLabel={`Mark incomplete ${title}`} style={styles.menuAction}><Text style={styles.menuText}>↶  Mark incomplete</Text></Pressable> : null}
          <Pressable accessibilityRole="button" onPress={() => { setMenu(false); onPress(); }} style={styles.menuAction}><Text style={styles.menuText}>Edit {kind.toLowerCase()}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setMenu(false)} style={styles.menuAction}><Text style={styles.meta}>Cancel</Text></Pressable>
        </View>
      </View>
    </Modal>
  </View>;
}

/** Match the shell's existing View-based outline icons without a new dependency. */
function ItemIcon({ note }: { readonly note: boolean }) {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.icon, note && styles.noteIcon]}>{note ? <View style={styles.fold} /> : <View style={styles.clipboardTop} />}<View style={styles.iconLine} /><View style={styles.iconLine} /><View style={[styles.iconLine, styles.shortLine]} /></View>;
}

function Metadata({ fixture, spaceId, tagIds }: { readonly fixture: BrowserFixtureData; readonly spaceId: string | undefined; readonly tagIds: readonly string[] }) {
  const [width, setWidth] = useState(0);
  const space = spacePath(fixture, spaceId);
  // Tags have their own bounded row, independent of the Space path length.
  const first = fixture.tags.find((tag) => tag.id === tagIds[0]);
  const showTag = !!first && width >= Math.min(first.name.length * 7 + 24, 106) + (tagIds.length > 1 ? 42 : 0);
  const remaining = tagIds.length - (showTag && first ? 1 : 0);
  return <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.metadata}>
    <Text numberOfLines={1} style={styles.space}>{space}</Text>
    {tagIds.length > 0 ? <View style={styles.tagRow}>
      {showTag && first ? <Text numberOfLines={1} style={styles.tag}>#{first.name}</Text> : null}
      {remaining > 0 ? <Text style={styles.tag} accessibilityLabel={`${remaining} more tags`}>+{remaining}</Text> : null}
    </View> : null}
  </View>;
}

function spacePath(fixture: BrowserFixtureData, id?: string): string {
  const names: string[] = [];
  const visited = new Set<string>();
  let current = fixture.spaces.find((space) => space.id === id);
  while (current && !visited.has(current.id)) { visited.add(current.id); names.unshift(current.name); current = fixture.spaces.find((space) => space.id === current?.parentId); }
  return names.join(" › ") || "No Space";
}
function formatDue(value: string | undefined, timeZone: string, today: string): string {
  if (!value) return "No due date";
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const dayKey = ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
  const day = dayKey === today ? "Today" : new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(date);
  return `${day} · ${new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(date)}`;
}

const styles = StyleSheet.create({
  wrapper: { marginHorizontal: tokens.spacing.lg, marginBottom: 12 },
  clip: { overflow: "hidden", borderRadius: tokens.radius.card, backgroundColor: tokens.colors.green },
  card: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: tokens.radius.card, borderWidth: 1 },
  note: { backgroundColor: tokens.colors.lavender },
  body: { padding: 16 }, header: { flexDirection: "row", alignItems: "center", gap: 10, paddingRight: 34, minHeight: 28, marginBottom: 10 },
  badge: { flexShrink: 1, overflow: "hidden", borderRadius: 10, backgroundColor: "#E3EEDD", color: tokens.colors.green, paddingHorizontal: 10, paddingVertical: 5, fontSize: 13, fontWeight: "600" },
  review: { backgroundColor: tokens.colors.butter, color: tokens.colors.ink }, mutedBadge: { backgroundColor: "#EEF0F1", color: tokens.colors.muted },
  title: { color: tokens.colors.ink, fontSize: 18, fontWeight: "700", lineHeight: 24 }, preview: { fontWeight: "400" }, struck: { textDecorationLine: "line-through", color: tokens.colors.muted },
  metadata: { gap: 8, marginTop: 13 }, tagRow: { flexDirection: "row", alignItems: "center", gap: 8 }, space: { flexShrink: 1, color: tokens.colors.muted, fontSize: 13 }, meta: { color: tokens.colors.muted, fontSize: 13 },
  tag: { flexShrink: 0, maxWidth: 106, overflow: "hidden", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "rgba(23,59,47,0.06)", color: tokens.colors.green, fontSize: 12 },
  more: { position: "absolute", top: 8, right: 6, width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12 }, moreText: { color: tokens.colors.green, fontSize: 25, lineHeight: 30 },
  icon: { width: 19, height: 23, borderColor: tokens.colors.green, borderWidth: 1.7, borderRadius: 3, justifyContent: "center", paddingHorizontal: 3, gap: 3 }, noteIcon: { borderTopRightRadius: 7 },
  clipboardTop: { position: "absolute", top: -4, left: 4, width: 8, height: 5, backgroundColor: tokens.colors.surface, borderColor: tokens.colors.green, borderWidth: 1.5, borderRadius: 2 },
  fold: { position: "absolute", top: 0, right: 0, width: 6, height: 6, borderBottomWidth: 1.5, borderLeftWidth: 1.5, borderColor: tokens.colors.green },
  iconLine: { height: 1.5, backgroundColor: tokens.colors.green }, shortLine: { width: 6 },
  swipeAction: { position: "absolute", top: 0, bottom: 0, right: 0, width: 88, alignItems: "center", justifyContent: "center", gap: 6 }, swipeCheck: { color: "#FFFFFF", fontSize: 26 }, swipeText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  pending: { backgroundColor: tokens.colors.butter, color: "#71521C", padding: 12, fontSize: 12 },
  errorRow: { backgroundColor: "#FFF0EA", paddingLeft: 14, paddingRight: 6, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }, error: { color: "#9B392B", fontSize: 12 }, retry: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" }, completedLabel: { paddingHorizontal: 16, paddingBottom: 12, color: tokens.colors.green, fontSize: 12 },
  modalRoot: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }, backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(36,34,31,0.18)" },
  menu: { width: "100%", maxWidth: 340, padding: 12, backgroundColor: tokens.colors.surface, borderRadius: 18, borderWidth: 1, borderColor: tokens.colors.border }, menuTitle: { color: tokens.colors.muted, fontSize: 13, padding: 12 }, menuAction: { minHeight: 44, paddingHorizontal: 12, justifyContent: "center" }, menuText: { color: tokens.colors.green, fontSize: 15 },
});
