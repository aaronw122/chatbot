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
  const active = keys.find((k) => k.isActive);
  if (active) return { provider: active.provider, model: active.model };
  // No explicit active flag but a key exists — reflect the first configured one.
  const first = keys[0];
  return first ? { provider: first.provider, model: first.model } : null;
};

const ChatHeader = () => {
  const settings = useSettings();

  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [keys, setKeys] = useState<UserKeyMeta[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  // Reconcile local state from the backend's source of truth.
  const reconcile = async () => {
    try {
      const [fetchedModels, fetchedKeys] = await Promise.all([
        services.getModels(),
        services.getKeys(),
      ]);
      setModels(fetchedModels);
      setKeys(fetchedKeys);
      setSelection(selectionFromKeys(fetchedKeys));
    } catch (e) {
      console.error("failed to load header models/keys", e);
    }
  };

  useEffect(() => {
    void reconcile();
    // Re-sync when the Settings dialog closes — the user may have added/removed a
    // key or changed the active provider/model there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settingsOpen = settings?.open ?? false;
  useEffect(() => {
    if (!settingsOpen) void reconcile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOpen]);

  // Providers the user actually has a key for — only these can be switched to
  // (switching to an unconfigured provider would 404 on POST /api/keys/active).
  const configuredProviders = PROVIDERS.filter((p) =>
    keys.some((k) => k.provider === p),
  );
  const hasAnyKey = configuredProviders.length > 0;

  const openSettings = () => settings?.openSettings();

  const isSelected = (provider: Provider, model: string) =>
    selection?.provider === provider && selection?.model === model;

  const handleSelect = async (provider: Provider, model: string) => {
    if (isSelected(provider, model)) return;
    const previous = selection;
    // Optimistic update.
    setSelection({ provider, model });
    setError(null);
    setSwitching(true);
    try {
      await services.setActiveProvider(provider, model);
    } catch (e) {
      // Roll back the optimistic selection and surface a brief error, then
      // reconcile actual state from the backend.
      console.error("failed to switch provider/model", e);
      setSelection(previous);
      setError("Couldn't switch model. Try again.");
      void reconcile();
    } finally {
      setSwitching(false);
    }
  };

  // No key anywhere: subtle "Add a key" affordance that opens Settings (reuses the
  // settingsContext open handler, same surface the 409 gate uses).
  if (!hasAnyKey) {
    return (
      <header className="flex h-14 items-center gap-2 border-b border-border bg-background px-4">
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
          {configuredProviders.map((provider, idx) => {
            const providerModels = models?.[provider] ?? [];
            return (
              <div key={provider}>
                {idx > 0 && <DropdownMenuSeparator />}
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
                      onSelect={() => void handleSelect(provider, model)}
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
