import { useContext, createContext, useState } from "react";
import { type CleanMessage, type miniContext } from "../../../types/types";

const MiniContext = createContext<miniContext | null>(null);

export const useMini = () => {
  return useContext(MiniContext);
};

export const MiniProvider = ({ children }: { children: React.ReactNode }) => {
  const [miniMessage, setMiniMessage] = useState<null | string>(null);
  const [miniChatHistory, setMiniChatHistory] = useState<null | CleanMessage[]>(
    null,
  );
  const [miniOpen, setMiniOpen] = useState<true | false>(false);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [miniConvoId, setMiniConvoId] = useState<string | null>(null);

  return (
    <MiniContext.Provider
      value={{
        miniMessage,
        setMiniMessage,
        miniChatHistory,
        setMiniChatHistory,
        miniOpen,
        setMiniOpen,
        selectedText,
        setSelectedText,
        miniConvoId,
        setMiniConvoId,
      }}
    >
      {children}
    </MiniContext.Provider>
  );
};
