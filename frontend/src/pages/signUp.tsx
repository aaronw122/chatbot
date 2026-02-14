import { authClient } from "@/lib/auth-client";
import { useState } from "react";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router";

const SignUp = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleNameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
  };
  const handleEmailChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
  };
  const handlePasswordChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(event.target.value);
  };

  const navigate = useNavigate();

  const handleSignUp = async () => {
    const { data, error } = await authClient.signUp.email({
      name,
      email,
      password,
    });
    if (error) {
      console.error(error.message);
    } else {
      console.log("user created", data.user);
    }
    navigate("/");
  };

  return (
    <FieldSet className="w-full max-w-xs justify-center items-center flex flex-col">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="name">name</FieldLabel>
          <Input
            id="name"
            type="text"
            placeholder="john doe"
            onChange={handleNameChange}
          />
          <FieldDescription>add your full name</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="email">email</FieldLabel>
          <Input
            id="email"
            type="text"
            placeholder="example@email.com"
            onChange={handleEmailChange}
          />
          <FieldDescription>choose an email for your account</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="password">password</FieldLabel>
          <FieldDescription>
            must be at least 8 characters long.
          </FieldDescription>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            onChange={handlePasswordChange}
          />
        </Field>
        <Field orientation="responsive">
          <Button type="submit" onClick={handleSignUp}>
            {" "}
            create{" "}
          </Button>
        </Field>
      </FieldGroup>
    </FieldSet>
  );
};

export default SignUp;
