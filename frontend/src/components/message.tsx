import { Card } from "./ui/card";
import type { MessageProps } from "../../../types/types";

const Message = ({ role, content }: MessageProps) => {
  //fix styling so its right aligned vs left aligned, etc.

  //should be doing this modification on the backend in express, only send through content string

  return role === "user" ? (
    <Card className="ml-auto px-3.5">{content}</Card>
  ) : (
    <p className="my-3 mr-15">{content}</p>
  );
};

export default Message;
