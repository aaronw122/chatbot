import Anthropic from "@anthropic-ai/sdk";

type Message = Anthropic.MessageParam;

type ChatProps = {
  message: Message;
};

const Chat = ({ message }: ChatProps) => {
  let content = "";

  //fix stylingn so its right aligned vs left aligned, etc.

  if (typeof message.content === "string") {
    content = message.content;
  } else {
    if (message.content[0].type === "text") {
      content = message.content[0].text;
    }
  }

  return message.role === "user" ? (
    <p>{content} :user</p>
  ) : (
    <p> assistant: {content} </p>
  );
};

export default Chat;
