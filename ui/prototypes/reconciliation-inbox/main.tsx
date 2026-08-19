import { createRoot } from "react-dom/client"
import "@fontsource/ibm-plex-mono/latin-400.css"
import "@fontsource/ibm-plex-mono/latin-500.css"
import "@fontsource/ibm-plex-mono/latin-600.css"
import { PrototypeHarness } from "./prototype-harness"
import "./styles.css"

createRoot(document.getElementById("root")!).render(<PrototypeHarness />)
