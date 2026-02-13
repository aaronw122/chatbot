import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ConvoProvider } from "./context/convoContext.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvoProvider>
      <App />
    </ConvoProvider>
  </StrictMode>,
);
