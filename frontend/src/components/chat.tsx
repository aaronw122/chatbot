import Anthropic from "@anthropic-ai/sdk";
import { Card } from "../components/ui/card";
import type { CleanMessage } from "../../../types/types";

const Chat = ({ role, content }: CleanMessage) => {
  //fix stylingn so its right aligned vs left aligned, etc.

  //should be doing this modification on the backend in express, only send through content string

  return role === "user" ? (
    <Card className="ml-auto">{content}</Card>
  ) : (
    <p className="my-3 mr-15"> {content} </p>
  );
};

export default Chat;
