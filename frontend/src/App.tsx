import ConvoList from "./components/convoList";
import Session from "./components/session";
import { useState } from "react";

function App() {
  //websocket wikll automatically send back new message, update all messages

  const [currentView, setCurrentView] = useState<"newChat" | "chat">("newChat");
  const [convoId, setConvoId] = useState<string>("");

  const selectConvo = (id: string) => {
    setConvoId(id);
    setCurrentView("chat");
  };

  return (
    <div className="flex flex-row mx-10 my-5">
      <ConvoList selectConvo={selectConvo}></ConvoList>
      <div className="flex-1">
        {currentView === "newChat" ? (
          <div className="lg:mx-80 md:mx-20 sm:mx-15 my-5">
            <h1 className="flex items-center justify-center min-h-screen">
              {"  "}
              bubble{" "}
            </h1>
          </div>
        ) : (
          <div className="mx-10">
            <Session id={convoId} />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
