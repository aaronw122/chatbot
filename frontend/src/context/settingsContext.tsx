import { createContext, useContext, useEffect, useState } from "react";
import services, { onNoApiKey, onFreeTierGate } from "../services/index";

type SettingsContextValue = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  // Set by the centralized 409 interceptor so the dialog can show a friendly
  // "add a key" prompt the next time it opens.
  noKeyPrompt: string | null;
  openSettings: (prompt?: string) => void;
  clearNoKeyPrompt: () => void;
  // Anonymous-first signup wall (§8). Opened when the free-tier exhaustion gate
  // fires for an anonymous user (they can't BYOK, so the path forward is signup).
  signupWallOpen: boolean;
  setSignupWallOpen: React.Dispatch<React.SetStateAction<boolean>>;
  openSignupWall: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export const useSettings = () => useContext(SettingsContext);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [noKeyPrompt, setNoKeyPrompt] = useState<string | null>(null);
  const [signupWallOpen, setSignupWallOpen] = useState(false);

  const openSettings = (prompt?: string) => {
    if (prompt !== undefined) setNoKeyPrompt(prompt);
    setOpen(true);
  };

  const clearNoKeyPrompt = () => setNoKeyPrompt(null);

  const openSignupWall = () => setSignupWallOpen(true);

  // Wire the centralized 409 no_api_key gate (CF1) to open Settings with a
  // friendly prompt. Any send path that hits the interceptor triggers this.
  useEffect(() => {
    onNoApiKey((error) => {
      setNoKeyPrompt(error.message);
      setOpen(true);
    });
    // Free-tier exhaustion/unavailable gate (§7). The destination depends on the
    // user TYPE, which we read FRESH from /api/usage at gate-fire time — NOT from a
    // session captured in this empty-deps effect (that closure is stale, so after a
    // successful signup it would still report "anonymous" and loop the user back to
    // the signup wall forever). Anonymous → signup wall (§8); real user → the BYOK
    // Settings dialog (existing behavior; they can add a key to keep chatting).
    onFreeTierGate(async (error) => {
      let isAnonymous = false;
      try {
        const usage = await services.getUsage();
        isAnonymous = usage.isAnonymous;
      } catch {
        // If the fresh fetch fails, fall back to the Settings dialog rather than
        // trapping a real user behind a signup wall they don't need.
        isAnonymous = false;
      }
      if (isAnonymous) {
        setSignupWallOpen(true);
      } else {
        setNoKeyPrompt(error.message);
        setOpen(true);
      }
    });
    return () => {
      onNoApiKey(null);
      onFreeTierGate(null);
    };
  }, []);

  return (
    <SettingsContext.Provider
      value={{
        open,
        setOpen,
        noKeyPrompt,
        openSettings,
        clearNoKeyPrompt,
        signupWallOpen,
        setSignupWallOpen,
        openSignupWall,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
