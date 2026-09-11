import { SafeAreaProvider } from "react-native-safe-area-context";

import RealApp from "./App";
import { BrowserPreview } from "./src/web/BrowserPreview";

export default function App() {
  return process.env.EXPO_PUBLIC_UI_FIXTURE === "true"
    ? <SafeAreaProvider><BrowserPreview /></SafeAreaProvider>
    : <RealApp />;
}
