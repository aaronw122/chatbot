type newChatType = {
  newChat: () => void;
};

const newChat = ({ newChat }: newChatType) => {
  return <button onClick={() => newChat()}> newChat </button>;
};

export default newChat;
