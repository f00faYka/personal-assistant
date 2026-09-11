import { SafeAreaProvider } from "react-native-safe-area-context";

import { BrowserPreview } from "./src/web/BrowserPreview";

export default function App() {
  return <SafeAreaProvider><BrowserPreview /></SafeAreaProvider>;
}
