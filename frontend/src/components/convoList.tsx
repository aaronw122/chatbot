import { useState, useEffect } from "react";
import { type Conversation } from "../../../types/types";
import services from "../services/index";
import ConvoTitle from "./convoTitle";
import { ScrollArea } from "./ui/scroll-area";

//state: conversations in array format, mapped using the id as key
// onClick, take them to a given session depending on convoId
// child comopnent convoTitle to hold title + onclick
// useEffect to generate conversations on render v
// for now assume userId === 1, in the future we will need to do something else

const ConvoList = ({ selectConvo }: { selectConvo: (id: string) => void }) => {
  const [convos, setConvos] = useState<null | Conversation[]>(null);

  useEffect(() => {
    services.getConvos().then((r) => setConvos(r));
  }, []);

  return (
    <div className="h-full">
      {convos !== null ? (
        <div className="flex flex-col h-full">
          <h4>Conversations</h4>
          <ScrollArea className="flex-1 overflow-hidden">
            <div className="flex flex-col">
              {convos.map((el) => (
                <ConvoTitle
                  key={el.id}
                  title={el.title}
                  id={el.id}
                  selectConvo={selectConvo}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      ) : (
        <p> loading </p>
      )}
    </div>
  );
};

export default ConvoList;
