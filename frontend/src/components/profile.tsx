import { authClient } from "@/lib/auth-client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "./ui/button";
import { useNavigate } from "react-router";

export const Profile = () => {
  const { data: session, isPending } = authClient.useSession();
  let firstLetter = "";

  const navigate = useNavigate();

  if (isPending) return <p>Loading...</p>;
  if (session) {
    const name = session.user.name;

    console.log("name", name);

    firstLetter = name.charAt(0);

    console.log("first letter", firstLetter);
  }

  return (
    <div>
      {session ? (
        <Avatar size="lg">
          <AvatarFallback> {firstLetter} </AvatarFallback>
        </Avatar>
      ) : (
        <div>
          <Button> login </Button>
          <Button onClick={() => navigate("/signup")}> signup </Button>
        </div>
      )}
    </div>
  );
};
