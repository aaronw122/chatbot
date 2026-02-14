import type { MessageProps } from "../../../types/types";
import { Card } from "./ui/card";
import Markdown from "react-markdown";

const MiniMessage = ({ role, content }: MessageProps) => {
  return role === "user" ? (
    <Card className="ml-auto px-3.5">{content}</Card>
  ) : (
    <div className="my-2 prose prose-sm dark:prose-invert max-w-none">
      <Markdown>{content}</Markdown>
    </div>
  );
};

export default MiniMessage;
