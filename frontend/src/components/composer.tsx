import { useLayoutEffect, useRef } from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

type ComposerProps = {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
};

/**
 * Shared, PRESENTATIONAL composer.
 *
 * Owns no data logic — submission is injected via `onSubmit`.
 * - Auto-growing textarea (reset to auto, grow to scrollHeight, capped + scroll).
 * - Enter = send, Shift+Enter = newline, IME composition guarded.
 * - Send button inset right: green when enabled, disabled/muted when empty.
 */
const Composer = ({
  placeholder,
  value,
  onChange,
  onSubmit,
  disabled = false,
}: ComposerProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow: reset height then size to content. Runs on every value change
  // (covers typing, paste, and programmatic resets to empty).
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const canSend = !disabled && value.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    onSubmit();
  };

  return (
    <div
      className={cn(
        "flex items-end gap-2 rounded-2xl border border-input bg-background p-2 shadow-sm transition-shadow",
        "focus-within:shadow-lg",
      )}
    >
      <textarea
        ref={textareaRef}
        rows={1}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        className={cn(
          "flex-1 resize-none bg-transparent px-2 py-1.5 text-foreground",
          "placeholder:text-muted-foreground outline-none",
          "max-h-48 overflow-y-auto",
        )}
      />
      <button
        type="button"
        aria-label="Send message"
        disabled={!canSend}
        onClick={submit}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full transition-opacity",
          canSend
            ? "bg-primary text-primary-foreground hover:opacity-90"
            : "bg-muted text-muted-foreground cursor-not-allowed",
        )}
      >
        <Send className="size-4" />
      </button>
    </div>
  );
};

export default Composer;
