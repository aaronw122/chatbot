import Composer from "./composer";

type InputProps = {
  id: string;
  sendMessage: (id: string) => void;
  handleMsgChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  newMessage: string;
};

const Input = ({ id, sendMessage, newMessage, handleMsgChange }: InputProps) => {
  return (
    <Composer
      placeholder="ask follow up"
      value={newMessage}
      onChange={(value) =>
        handleMsgChange({
          target: { value },
        } as React.ChangeEvent<HTMLTextAreaElement>)
      }
      onSubmit={() => sendMessage(id)}
    />
  );
};

export default Input;
