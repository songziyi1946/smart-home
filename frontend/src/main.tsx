import "@arco-design/web-react/dist/css/arco.css";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import "./styles/glass.css";
import "./styles/layout.css";

createRoot(document.getElementById("root")!).render(<App />);
