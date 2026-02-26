import { authClient } from "@/lib/auth-client";
import { useState } from "react";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldError,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router";

const oauthCallbackURL =
  import.meta.env.VITE_OAUTH_CALLBACK_URL?.trim() ||
  (import.meta.env.DEV ? "http://localhost:5173/" : `${window.location.origin}/`);

const SignIn = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleEmailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
  };
  const handlePasswordChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(event.target.value);
  };

  const navigate = useNavigate();

  const handleSignIn = async () => {
    const { error } = await authClient.signIn.email({
      email,
      password,
    });

    if (error) {
      setError(error.message!);
    }
    navigate("/");
  };

  const handleGoogleLogin = async () => {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: oauthCallbackURL,
    });
  };

  return (
    <FieldSet className="w-full justify-center items-center flex flex-col">
      {error ? <FieldError>{error}</FieldError> : <></>}
      <Button onClick={() => handleGoogleLogin()}>sign in with google</Button>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">email</FieldLabel>
          <Input
            id="email"
            type="text"
            placeholder="example@email.com"
            onChange={handleEmailChange}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">password</FieldLabel>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            onChange={handlePasswordChange}
          />
        </Field>
        <Field orientation="responsive">
          <Button type="submit" onClick={handleSignIn}>
            {" "}
            create{" "}
          </Button>
        </Field>
        <Button variant="outline" onClick={() => navigate("/signup")}>
          sign up
        </Button>
      </FieldGroup>
    </FieldSet>
  );
};

export default SignIn;
