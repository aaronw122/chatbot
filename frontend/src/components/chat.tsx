import Anthropic from "@anthropic-ai/sdk";
import { Card } from "../components/ui/card";

type Message = Anthropic.MessageParam;

type ChatProps = {
  message: Message;
};

const Chat = ({ message }: ChatProps) => {
  let content = "";

  //fix stylingn so its right aligned vs left aligned, etc.

  //should be doing this modification on the backend in express, only send through content string
  if (typeof message.content === "string") {
    content = message.content;
  } else {
    if (message.content[0].type === "text") {
      content = message.content[0].text;
    }
  }

  return message.role === "user" ? (
    <Card className="ml-auto">{content}</Card>
  ) : (
    <p className="my-3 mr-15"> {content} </p>
  );
};

export default Chat;
