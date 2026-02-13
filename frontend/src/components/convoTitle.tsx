import { Button } from "./ui/button";

const ConvoTitle = ({
  id,
  title,
  selectConvo,
}: {
  id: string;
  title: string;
  selectConvo: (id: string) => void;
}) => {
  return (
    <Button variant="ghost" className="pl-0" onClick={() => selectConvo(id)}>
      {" "}
      {title}{" "}
    </Button>
  );
};

export default ConvoTitle;
