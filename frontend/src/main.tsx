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
import { SidebarProvider, useSidebar } from "./components/ui/sidebar.tsx";
import { MobileMenuButton } from "./components/mobileMenuButton.tsx";
import { authClient } from "./lib/auth-client.ts";
import SignUp from "./pages/signUp.tsx";

// Two-pane shell: fixed sidebar + flexible main column. The shell owns the
// two-pane geometry, the centered scroll region, and the column max-width +
// horizontal padding. Composer PLACEMENT is per-page (see frontend/DESIGN.md).
//
// Sidebar visibility:
//   - Desktop: persistent sidebar on chat pages; hidden on the landing/main
//     page ("/") and the login screen so those stay clean and full-width.
//   - Mobile: the sidebar renders as an off-canvas drawer (shadcn Sheet). We
//     keep it mounted on every authenticated screen so the hamburger can open
//     it (conversation list + New chat + account), matching ChatGPT's mobile web.
function AppShell() {
  const location = useLocation();
  const { data: session } = authClient.useSession();
  const { isMobile } = useSidebar();
  const isHome = location.pathname === "/";
  const showSidebar = !!session && (isMobile || !isHome);
  // The home page has no ChatHeader, so on mobile it needs its own slim top bar
  // to expose the menu button. Chat pages get the hamburger inside ChatHeader.
  const showMobileHomeBar = !!session && isHome;

  return (
    <div className="flex h-svh w-full overflow-hidden">
      {showSidebar && <ConvoList />}
      <main className="flex-1 flex flex-col h-svh min-w-0">
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
