import { useEffect, useState } from "react";
import { AlertCircle, Check, ChevronDown, KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/context/settingsContext";
import services from "../services/index";
import {
  PROVIDERS,
  PROVIDER_LABELS,
  type Provider,
  type UserKeyMeta,
  type ModelsResponse,
  type UsageResponse,
} from "../types/byok";

// Per-provider editable form state (the API key is write-only; we never receive
// the raw key back from the backend, only masked metadata).
type DraftState = Record<Provider, { apiKey: string; model: string }>;

const emptyDrafts = (): DraftState =>
  ({
    openai: { apiKey: "", model: "" },
    anthropic: { apiKey: "", model: "" },
  });

const Settings = () => {
  const settings = useSettings();

  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [keys, setKeys] = useState<UserKeyMeta[]>([]);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [drafts, setDrafts] = useState<DraftState>(emptyDrafts);
  const [busy, setBusy] = useState<Provider | "active" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = settings?.open ?? false;

  const keyFor = (provider: Provider): UserKeyMeta | undefined =>
    keys.find((k) => k.provider === provider);

  const activeProvider: Provider | null =
    keys.find((k) => k.isActive)?.provider ?? null;

  const refresh = async () => {
    setError(null);
    try {
      const [fetchedModels, fetchedKeys, fetchedUsage] = await Promise.all([
        services.getModels(),
        services.getKeys(),
        services.getUsage().catch(() => null),
      ]);
      setModels(fetchedModels);
      setKeys(fetchedKeys);
      setUsage(fetchedUsage);
      // Seed each provider's model dropdown: existing configured model, else the
      // first allow-listed model for that provider.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const provider of PROVIDERS) {
          const existing = fetchedKeys.find((k) => k.provider === provider);
          const seedModel =
            existing?.model ?? fetchedModels?.[provider]?.[0] ?? "";
          next[provider] = {
            apiKey: prev[provider]?.apiKey ?? "",
            model: prev[provider]?.model || seedModel,
          };
        }
        return next;
      });
    } catch (e) {
      console.error("failed to load settings", e);
      setError("Failed to load settings. Please try again.");
    }
  };

  useEffect(() => {
    if (open) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSave = async (provider: Provider) => {
    const draft = drafts[provider];
    if (!draft.apiKey.trim()) {
      setError(`Enter an API key for ${PROVIDER_LABELS[provider]}.`);
      return;
    }
    if (!draft.model) {
      setError(`Select a model for ${PROVIDER_LABELS[provider]}.`);
      return;
    }
    setBusy(provider);
    setError(null);
    try {
      await services.addKey({
        provider,
        model: draft.model,
        apiKey: draft.apiKey.trim(),
      });
      // Clear the write-only key field after saving; never keep raw key material.
      setDrafts((prev) => ({
        ...prev,
        [provider]: { ...prev[provider], apiKey: "" },
      }));
      await refresh();
      settings?.clearNoKeyPrompt();
    } catch (e) {
      console.error("failed to save key", e);
      setError(`Failed to save ${PROVIDER_LABELS[provider]} key.`);
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (provider: Provider) => {
    setBusy(provider);
    setError(null);
    try {
      await services.deleteKey(provider);
      await refresh();
    } catch (e) {
      console.error("failed to remove key", e);
      setError(`Failed to remove ${PROVIDER_LABELS[provider]} key.`);
    } finally {
      setBusy(null);
    }
  };

  const handleSetActive = async (provider: Provider) => {
    if (!keyFor(provider)) return;
    setBusy("active");
    setError(null);
    try {
      await services.setActiveProvider(provider);
      await refresh();
    } catch (e) {
      console.error("failed to set active provider", e);
      setError("Failed to switch active provider.");
    } finally {
      setBusy(null);
    }
  };

  const handleModelChange = (provider: Provider, model: string) => {
    setDrafts((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], model },
    }));
  };

  const handleKeyChange = (provider: Provider, apiKey: string) => {
    setDrafts((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], apiKey },
    }));
  };

  if (!settings) return null;

  return (
    <Dialog open={open} onOpenChange={settings.setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Add your own API keys for OpenAI and Anthropic, then pick which
            provider to chat with. Keys are encrypted and never shown again.
          </DialogDescription>
        </DialogHeader>

        {settings.noKeyPrompt && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted px-3 py-2.5 text-sm text-foreground">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{settings.noKeyPrompt}</span>
          </div>
        )}

        {/* Used-count reinforcement — ONLY for the exhaustion (402) case. A 503
            opens this dialog at freeUsed = 0, where this line would be misleading,
            so gate it on a fully-consumed balance. */}
        {usage?.freeTierEnabled &&
          !usage.hasOwnKey &&
          usage.freeRemaining <= 0 && (
            <p className="text-xs text-muted-foreground">
              You've used {usage.freeUsed} of {usage.freeLimit} free messages.
            </p>
          )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col gap-4">
          {PROVIDERS.map((provider) => {
            const meta = keyFor(provider);
            const draft = drafts[provider];
            const providerModels = models?.[provider] ?? [];
            const isBusy = busy === provider;
            const isActive = activeProvider === provider;

            return (
              <div
                key={provider}
                className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">
                      {PROVIDER_LABELS[provider]}
                    </span>
                    {isActive && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                        <Check className="size-3" />
                        Active
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {meta ? `${meta.maskedKey} · ${meta.model}` : "No key"}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${provider}-key`}>API key</Label>
                  <Input
                    id={`${provider}-key`}
                    type="password"
                    autoComplete="off"
                    placeholder={
                      meta ? "Enter a new key to replace" : "Paste your API key"
                    }
                    value={draft.apiKey}
                    onChange={(e) => handleKeyChange(provider, e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${provider}-model`}>Model</Label>
                  <div className="relative">
                    <select
                      id={`${provider}-model`}
                      className="border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full appearance-none rounded-md border px-3 py-1 pr-9 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
                      value={draft.model}
                      onChange={(e) =>
                        handleModelChange(provider, e.target.value)
                      }
                    >
                      {providerModels.length === 0 && (
                        <option value="">No models available</option>
                      )}
                      {providerModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2" />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    disabled={isBusy}
                    onClick={() => handleSave(provider)}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy || !meta}
                    onClick={() => handleRemove(provider)}
                  >
                    Remove
                  </Button>
                  <Button
                    size="sm"
                    variant={isActive ? "secondary" : "ghost"}
                    className="ml-auto"
                    disabled={busy === "active" || !meta || isActive}
                    onClick={() => handleSetActive(provider)}
                  >
                    {isActive ? "Active" : "Set active"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default Settings;
