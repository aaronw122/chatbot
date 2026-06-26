import { createContext, useContext, useEffect, useState } from "react";
import { onNoApiKey, onFreeTierGate } from "../services/index";

type SettingsContextValue = {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  // Set by the centralized 409 interceptor so the dialog can show a friendly
  // "add a key" prompt the next time it opens.
  noKeyPrompt: string | null;
  openSettings: (prompt?: string) => void;
  clearNoKeyPrompt: () => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export const useSettings = () => useContext(SettingsContext);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [noKeyPrompt, setNoKeyPrompt] = useState<string | null>(null);

  const openSettings = (prompt?: string) => {
    if (prompt !== undefined) setNoKeyPrompt(prompt);
    setOpen(true);
  };

  const clearNoKeyPrompt = () => setNoKeyPrompt(null);

  // Wire the centralized 409 no_api_key gate (CF1) to open Settings with a
  // friendly prompt. Any send path that hits the interceptor triggers this.
  // The free-tier gate (402 exhausted / 503 unavailable) reuses the SAME dialog +
  // noKeyPrompt banner; the server provides context-appropriate copy for each.
  useEffect(() => {
    onNoApiKey((error) => {
      setNoKeyPrompt(error.message);
      setOpen(true);
    });
    onFreeTierGate((error) => {
      setNoKeyPrompt(error.message);
      setOpen(true);
    });
    return () => {
      onNoApiKey(null);
      onFreeTierGate(null);
    };
  }, []);

  return (
    <SettingsContext.Provider
      value={{ open, setOpen, noKeyPrompt, openSettings, clearNoKeyPrompt }}
    >
      {children}
    </SettingsContext.Provider>
  );
}
