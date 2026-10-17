import { act, create } from "react-test-renderer";
import { expect, test, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("react-native", async () => {
  const React = await import("react");
  return { Platform: { OS: "ios" }, View: (props: { children?: React.ReactNode }) => React.createElement("View", props, props.children) };
});
vi.mock("@react-native-community/datetimepicker", async () => {
  const React = await import("react");
  return { default: (props: object) => React.createElement("NativePicker", props) };
});
import DateTimePicker from "@react-native-community/datetimepicker";
import { DuePicker } from "./DuePicker.native";

function renderPicker() {
  let renderer!: ReturnType<typeof create>;
  const onDateChange = vi.fn();
  const onTimeChange = vi.fn();
  act(() => { renderer = create(<DuePicker mode="date" date="2026-10-20" time="09:00" disabled={false} onDateChange={onDateChange} onTimeChange={onTimeChange} />); });
  return { renderer, onDateChange, onTimeChange };
}

test("fits the entire native calendar into a narrow detail card", () => {
  const { renderer } = renderPicker();
  act(() => { renderer.root.findByProps({ testID: "due-picker-container" }).props.onLayout({ nativeEvent: { layout: { width: 280 } } }); });
  act(() => { renderer.root.findByProps({ testID: "due-picker-content" }).props.onLayout({ nativeEvent: { layout: { width: 350, height: 360 } } }); });
  const content = renderer.root.findByProps({ testID: "due-picker-content" });
  expect(content.props.style.transform).toEqual([{ scale: 0.8 }]);
  expect(renderer.root.findByProps({ testID: "due-picker-container" }).props.style.height).toBe(288);
});

test("native date selection preserves the separate time and ignores dismissal", () => {
  const { renderer, onDateChange, onTimeChange } = renderPicker();
  const picker = renderer.root.findByType(DateTimePicker);
  act(() => { picker.props.onChange({ type: "dismissed" }, new Date("2026-10-25T09:00:00")); });
  expect(onDateChange).not.toHaveBeenCalled();
  act(() => { picker.props.onChange({ type: "set" }, new Date("2026-10-25T09:00:00")); });
  expect(onDateChange).toHaveBeenCalledWith("2026-10-25");
  expect(onTimeChange).not.toHaveBeenCalled();
});
