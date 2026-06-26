import { useEffect, useState } from "react";
import { ChevronDown, KeyRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSettings } from "@/context/settingsContext";
import { MobileMenuButton } from "@/components/mobileMenuButton";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import services from "../services/index";
import {
  PROVIDERS,
  PROVIDER_LABELS,
  type Provider,
  type UserKeyMeta,
  type ModelsResponse,
} from "../types/byok";

// B4 — Header + model switcher.
//
// Self-contained: takes NO props so the chat surface can mount <ChatHeader /> blind.
// It owns its own data-fetching (GET /api/models + GET /api/keys) and the
// optimistic provider/model switch (POST /api/keys/active via the extended
// setActiveProvider service). Renders content-only (no mx-auto/max-w-* wrappers —
// column centering is shell-owned per DESIGN.md §2). Height is h-14 per DESIGN.md §3.

// The active (provider, model) the header reflects. Derived from the user's keys.
type Selection = { provider: Provider; model: string };

const selectionFromKeys = (keys: UserKeyMeta[]): Selection | null => {
  const activeKey = keys.find((key) => key.isActive);
  if (activeKey) {
    return { provider: activeKey.provider, model: activeKey.model };
  }
  // No explicit active flag but a key exists — reflect the first configured one.
  const firstKey = keys[0];
  return firstKey
    ? { provider: firstKey.provider, model: firstKey.model }
    : null;
};

const ChatHeader = () => {
  const settings = useSettings();
  const { state: sidebarState } = useSidebar();

  // Desktop collapse/expand lives inside the sidebar header when it's open
  // (matching ChatGPT). The header only surfaces the trigger to RE-open the
  // sidebar once it's collapsed, so the two controls never both show at once.
  const showSidebarTrigger = sidebarState === "collapsed";

  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [keys, setKeys] = useState<UserKeyMeta[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  // Reconcile local state from the backend's source of truth.
  const refreshHeaderStateFromBackend = async () => {
    try {
      const [fetchedModels, fetchedKeys] = await Promise.all([
        services.getModels(),
        services.getKeys(),
      ]);
      setModels(fetchedModels);
      setKeys(fetchedKeys);
      setSelection(selectionFromKeys(fetchedKeys));
    } catch (loadError) {
      console.error("failed to load header models/keys", loadError);
    }
  };

  useEffect(() => {
    void refreshHeaderStateFromBackend();
    // Re-sync when the Settings dialog closes — the user may have added/removed a
    // key or changed the active provider/model there.
  }, []);

  const settingsOpen = settings?.open ?? false;
  useEffect(() => {
    if (!settingsOpen) void refreshHeaderStateFromBackend();
  }, [settingsOpen]);

  // Providers the user actually has a key for — only these can be switched to
  // (switching to an unconfigured provider would 404 on POST /api/keys/active).
  const configuredProviders = PROVIDERS.filter((provider) =>
    keys.some((key) => key.provider === provider),
  );
  const hasAnyKey = configuredProviders.length > 0;

  const openSettings = () => settings?.openSettings();

  const isSelected = (provider: Provider, model: string) =>
    selection?.provider === provider && selection?.model === model;

  const handleModelSelect = async (provider: Provider, model: string) => {
    if (isSelected(provider, model)) return;
    const previousSelection = selection;
    // Optimistic update.
    setSelection({ provider, model });
    setError(null);
    setSwitching(true);
    try {
      await services.setActiveProvider(provider, model);
    } catch (switchError) {
      // Roll back the optimistic selection and surface a brief error, then
      // reconcile actual state from the backend.
      console.error("failed to switch provider/model", switchError);
      setSelection(previousSelection);
      setError("Couldn't switch model. Try again.");
      void refreshHeaderStateFromBackend();
    } finally {
      setSwitching(false);
    }
  };

  // No key anywhere: subtle "Add a key" affordance that opens Settings (reuses the
  // settingsContext open handler, same surface the 409 gate uses).
  if (!hasAnyKey) {
    return (
      <header className="flex h-14 items-center gap-2 border-b border-border bg-background px-4">
        {showSidebarTrigger && <SidebarTrigger className="hidden md:flex" />}
        <MobileMenuButton />
        <button
          type="button"
          onClick={openSettings}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <KeyRound className="size-4" />
          Add a key
        </button>
      </header>
    );
  }

  const triggerLabel = selection
    ? `${PROVIDER_LABELS[selection.provider]} · ${selection.model}`
    : "Select a model";

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4">
      {showSidebarTrigger && <SidebarTrigger className="hidden md:flex" />}
      <MobileMenuButton />
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={switching}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 disabled:pointer-events-none"
        >
          <span className="truncate max-w-[18rem]">{triggerLabel}</span>
          <ChevronDown className="size-4 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-56 rounded-lg border border-border shadow-md"
        >
          {configuredProviders.map((provider, providerIndex) => {
            const providerModels = models?.[provider] ?? [];
            return (
              <div key={provider}>
                {providerIndex > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {PROVIDER_LABELS[provider]}
                </DropdownMenuLabel>
                {providerModels.length === 0 ? (
                  <DropdownMenuItem disabled className="text-muted-foreground">
                    No models available
                  </DropdownMenuItem>
                ) : (
                  providerModels.map((model) => (
                    <DropdownMenuItem
                      key={`${provider}:${model}`}
                      onSelect={() => void handleModelSelect(provider, model)}
                      className={
                        isSelected(provider, model)
                          ? "bg-accent text-accent-foreground"
                          : undefined
                      }
                    >
                      <span className="truncate">{model}</span>
                    </DropdownMenuItem>
                  ))
                )}
              </div>
            );
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openSettings()}>
            <KeyRound className="size-4 text-muted-foreground" />
            Manage keys
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error && (
        <span className="text-xs text-destructive" role="alert">
          {error}
        </span>
      )}
    </header>
  );
};

export default ChatHeader;
