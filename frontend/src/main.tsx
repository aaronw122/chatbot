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
import { SettingsProvider } from "./context/settingsContext.tsx";
import { SidebarProvider } from "./components/ui/sidebar.tsx";
import SignUp from "./pages/signUp.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvoProvider>
      <MessageProvider>
        <MiniProvider>
          <SettingsProvider>
            <BrowserRouter>
              <SidebarProvider>
                {/* Two-pane shell: fixed sidebar + flexible main column.
                    The shell owns the two-pane geometry, the centered scroll
                    region, and the column max-width + horizontal padding.
                    Composer PLACEMENT is per-page (see frontend/DESIGN.md). */}
                <div className="flex h-svh w-full overflow-hidden">
                  <ConvoList />
                  <main className="flex-1 flex flex-col h-svh min-w-0">
                    {/* Centered scroll region: this element is the scroll
                        container; the inner div owns the centered column
                        (max-width + horizontal padding). */}
                    <div className="flex-1 overflow-y-auto">
                      <div className="mx-auto w-full max-w-3xl px-4 h-full">
                        <Routes>
                          <Route path="/" element={<App />} />
                          <Route path="/chat/:id" element={<Session />} />
                          <Route path="/signup" element={<SignUp />} />
                        </Routes>
                      </div>
                    </div>
                  </main>
                </div>
              </SidebarProvider>
            </BrowserRouter>
          </SettingsProvider>
        </MiniProvider>
      </MessageProvider>
    </ConvoProvider>
  </StrictMode>,
);
