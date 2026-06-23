import Composer from "./composer";

type InputProps = {
  id: string;
  sendMessage: (id: string) => void;
  handleMsgChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  newMessage: string;
  // Disabled while a streamed reply is in flight (Phase 2). Forwarded to the
  // shared Composer so the textarea + send button lock during streaming.
  disabled?: boolean;
};

const Input = ({
  id,
  sendMessage,
  newMessage,
  handleMsgChange,
  disabled = false,
}: InputProps) => {
  return (
    <Composer
      placeholder="ask follow up"
      value={newMessage}
      disabled={disabled}
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
