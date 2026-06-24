import { StrictMode } from "react";
import { BrowserRouter, Routes, Route, useLocation } from "react-router";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import Session from "./pages/chat.tsx";
import ConvoList from "./components/convoList.tsx";
import { ConvoProvider } from "./context/convoContext.tsx";
import { MessageProvider } from "./context/messageContext.tsx";
import { MiniProvider } from "./context/miniContext.tsx";
import { SettingsProvider } from "./context/settingsContext.tsx";
import { SidebarProvider, SidebarTrigger } from "./components/ui/sidebar.tsx";
import { MobileMenuButton } from "./components/mobileMenuButton.tsx";
import { authClient } from "./lib/auth-client.ts";
import SignUp from "./pages/signUp.tsx";

// Two-pane shell: fixed sidebar + flexible main column. The shell owns the
// two-pane geometry, the centered scroll region, and the column max-width +
// horizontal padding. Composer PLACEMENT is per-page (see frontend/DESIGN.md).
//
// Sidebar visibility:
//   - Desktop: persistent sidebar on every authenticated screen, including the
//     landing/main page ("/"), matching ChatGPT which keeps its sidebar on the
//     new-chat screen. Only the login screen (no session) stays full-width.
//   - Mobile: the sidebar renders as an off-canvas drawer (shadcn Sheet). We
//     keep it mounted on every authenticated screen so the hamburger can open
//     it (conversation list + New chat + account), matching ChatGPT's mobile web.
function AppShell() {
  const location = useLocation();
  const { data: session } = authClient.useSession();
  const isHome = location.pathname === "/";
  const showSidebar = !!session;
  // The home page has no ChatHeader, so on mobile it needs its own slim top bar
  // to expose the menu button. Chat pages get the hamburger inside ChatHeader.
  const showMobileHomeBar = !!session && isHome;

  return (
    <div className="flex h-svh w-full overflow-hidden">
      {showSidebar && <ConvoList />}
      <main className="relative flex-1 flex flex-col h-svh min-w-0">
        {isHome && (
          // Desktop-only collapse/expand trigger for home. Absolutely positioned
          // so it consumes no layout space and the centered landing column does
          // not shift. The mobile home bar owns the hamburger on mobile.
          <SidebarTrigger className="hidden md:flex absolute left-3 top-3 z-20" />
        )}
        {showMobileHomeBar && (
          <header className="md:hidden flex h-14 items-center gap-2 border-b border-border bg-background px-3 shrink-0">
            <MobileMenuButton />
            <span className="font-bold tracking-tight text-primary">
              easybranch
            </span>
          </header>
        )}
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
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvoProvider>
      <MessageProvider>
        <MiniProvider>
          <SettingsProvider>
            <BrowserRouter>
              <SidebarProvider>
                <AppShell />
              </SidebarProvider>
            </BrowserRouter>
          </SettingsProvider>
        </MiniProvider>
      </MessageProvider>
    </ConvoProvider>
  </StrictMode>,
);
