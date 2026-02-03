// CRITICAL: Import fetch interceptor FIRST, before anything else
// This ensures all fetch calls are intercepted from the start
import "./pmtilesCache";

import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(<App />);
