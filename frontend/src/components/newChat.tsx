type newChatType = {
  newChat: () => void;
};

const NewChat = ({ newChat }: newChatType) => {
  return <button onClick={() => newChat()}> newChat </button>;
};

export default NewChat;
