// Animated "assistant is typing" indicator. Shown in place of an assistant
// message body while its content is still empty (the pre-first-token gap during
// streaming), so the user gets immediate feedback that a reply is coming.
const TypingDots = () => {
  return (
    <div
      className="flex items-center gap-1 py-1"
      role="status"
      aria-label="Assistant is typing"
    >
      <span className="size-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
      <span className="size-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
      <span className="size-2 animate-bounce rounded-full bg-muted-foreground" />
    </div>
  );
};

export default TypingDots;
