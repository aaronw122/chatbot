import { StrictMode } from "react";
import { BrowserRouter, Routes, Route } from "react-router";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import Session from "./pages/session.tsx";
import ConvoList from "./components/convoList.tsx";
import { ConvoProvider } from "./context/convoContext.tsx";
import { SidebarProvider } from "./components/ui/sidebar.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvoProvider>
      <BrowserRouter>
        <SidebarProvider>
          <div className="w-fit m-10">
            <ConvoList />
          </div>
          <div className="flex-1 flex h-svh">
            <Routes>
              <Route path="/" element={<App />} />
              <Route path="/chat/:id" element={<Session />} />
            </Routes>
          </div>
        </SidebarProvider>
      </BrowserRouter>
    </ConvoProvider>
  </StrictMode>,
);
