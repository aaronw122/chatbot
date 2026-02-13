import { useState, useEffect } from "react";
import { type Conversation } from "../../../types/types";
import services from "../services/index";
import ConvoTitle from "./convoTitle";
import { ScrollArea } from "./ui/scroll-area";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  useSidebar,
} from "./ui/sidebar";
// import { useConvo } from "@/context/convoContext";

//state: conversations in array format, mapped using the id as key
// onClick, take them to a given session depending on convoId
// child comopnent convoTitle to hold title + onclick
// useEffect to generate conversations on render v
// for now assume userId === 1, in the future we will need to do something else

const ConvoList = () => {
  const [convos, setConvos] = useState<null | Conversation[]>(null);

  const {
    state,
    open,
    setOpen,
    openMobile,
    setOpenMobile,
    isMobile,
    toggleSidebar,
  } = useSidebar();
  // const convo = useConvo();

  // if (!convo) throw new Error("useConvo not working");

  // const { selectConvo } = convo;

  useEffect(() => {
    services.getConversations().then((r) => setConvos(r));
  }, []);

  return (
    <div className="h-full">
      {convos !== null ? (
        <div className="flex flex-col h-full">
          <Sidebar collapsible="icon">
            <SidebarHeader>
              <div>
                <h4>Conversations</h4>
                <button onClick={() => toggleSidebar} />
              </div>
            </SidebarHeader>
            <SidebarContent>
              <div className="flex flex-col">
                {convos.map((el) => (
                  <ConvoTitle key={el.id} title={el.title} id={el.id} />
                ))}
              </div>
            </SidebarContent>
          </Sidebar>
        </div>
      ) : (
        <p> loading... </p>
      )}
    </div>
  );
};

export default ConvoList;
