import "@arco-design/web-react/dist/css/arco.css";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import "./styles/glass.css";
import "./styles/layout.css";
import { registerPwa } from "./pwa";

createRoot(document.getElementById("root")!).render(<App />);
void registerPwa().catch(() => { /* Browser installation support does not block household access. */ });
