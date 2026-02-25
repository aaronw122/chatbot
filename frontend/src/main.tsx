import { StrictMode } from "react";
import { BrowserRouter, Routes, Route } from "react-router";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import Session from "./pages/chat.tsx";
import ConvoList from "./components/convoList.tsx";
import { ConvoProvider } from "./context/convoContext.tsx";
import { MessageProvider } from "./context/messageContext.tsx";
import { MiniProvider } from "./context/miniContext.tsx";
import { SidebarProvider } from "./components/ui/sidebar.tsx";
import SignUp from "./pages/signUp.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvoProvider>
      <MessageProvider>
        <MiniProvider>
          <BrowserRouter>
          <SidebarProvider>
          <div className="w-fit m-10">
            <ConvoList />
          </div>
          <div className="flex-1 flex h-svh justify-center">
            <Routes>
              <Route path="/" element={<App />} />
              <Route path="/chat/:id" element={<Session />} />
              <Route path="/signup" element={<SignUp />} />
            </Routes>
          </div>
          </SidebarProvider>
          </BrowserRouter>
        </MiniProvider>
      </MessageProvider>
    </ConvoProvider>
  </StrictMode>,
);
