import MiniMessage from "./miniMessage";
import type { CleanMessage } from "../../../types/types";

type MiniMessageHistoryProps = {
  history: CleanMessage[];
};

const MiniMessageHistory = ({ history }: MiniMessageHistoryProps) => {
  return (
    <div className="flex flex-col gap-1">
      {history.map((el) => (
        <MiniMessage key={el.id} content={el.content} role={el.role} />
      ))}
    </div>
  );
};

export default MiniMessageHistory;
