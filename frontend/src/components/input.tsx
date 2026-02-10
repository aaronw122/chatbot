type inputType = {
  sendMessage: () => void;
  handleMsgChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  newMessage: string;
};

const Input = ({ sendMessage, newMessage, handleMsgChange }: inputType) => {
  return (
    <div>
      <textarea value={newMessage} onChange={handleMsgChange}>
        {" "}
      </textarea>
      <button onClick={() => sendMessage()}> send </button>
    </div>
  );
};

export default Input;
