import type { MessageProps } from "../../../types/types";
import TypingDots from "./typingDots";
import MarkdownContent from "./MarkdownContent";

const MiniMessage = ({ role, content }: MessageProps) => {
  return role === "user" ? (
    <div className="ml-auto max-w-[80%] rounded-2xl bg-card px-3.5 py-2 text-sm text-card-foreground whitespace-pre-wrap">
      {content}
    </div>
  ) : (
    <div className="prose prose-sm prose-neutral max-w-none text-foreground">
      {content.trim() === "" ? (
        <TypingDots />
      ) : (
        <MarkdownContent content={content} />
      )}
    </div>
  );
};

export default MiniMessage;
