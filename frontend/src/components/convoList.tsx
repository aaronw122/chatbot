import { useState, useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { type Conversation } from "../../../types/types";
import services from "../services/index";
import ConvoTitle from "./convoTitle";
import NewChat from "./newChat";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  useSidebar,
  SidebarFooter,
} from "./ui/sidebar";

import { useConvo } from "@/context/convoContext";
import { Profile } from "./profile";

//state: conversations in array format, mapped using the id as key
// onClick, take them to a given session depending on convoId
// child comopnent convoTitle to hold title + onclick
// useEffect to generate conversations on render v
// for now assume userId === 1, in the future we will need to do something else

const ConvoList = () => {
  const convo = useConvo();

  if (!convo) throw new Error("useConvo not working");

  const { convos, setConvos } = convo;

  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (session) {
      services.getConversations().then((r) => setConvos(r));
    }
  }, [session, setConvos]);

  return (
    <div className="h-full">
      <div className="flex flex-col h-full">
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex flex-col gap-2">
              <h4>EasyBranch</h4>
              <NewChat />
            </div>
          </SidebarHeader>
          <SidebarContent>
            {convos !== null ? (
              <div className="flex flex-col">
                {!convos ? (
                  <p>no convos yet.</p>
                ) : (
                  convos.map((el: Conversation) => (
                    <ConvoTitle key={el.id} title={el.title} id={el.id} />
                  ))
                )}
              </div>
            ) : (
              <p> loading... </p>
            )}
          </SidebarContent>
          <SidebarFooter>
            <Profile />
          </SidebarFooter>
        </Sidebar>
      </div>
    </div>
  );
};

export default ConvoList;
