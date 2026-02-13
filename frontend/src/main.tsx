import { StrictMode } from "react";
import { BrowserRouter, Routes, Route } from "react-router";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import Session from "./components/session.tsx";
import { ConvoProvider } from "./context/convoContext.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvoProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/chat/:id" element={<Session />} />
        </Routes>
      </BrowserRouter>
    </ConvoProvider>
  </StrictMode>,
);
