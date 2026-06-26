import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/context/settingsContext";
import { authClient } from "@/lib/auth-client";
import SignIn from "@/pages/signIn";
import SignUp from "@/pages/signUp";

// Anonymous-first signup wall (§8). Surfaced when the free-tier exhaustion gate
// fires for an anonymous user (settingsContext branches here after a FRESH
// /api/usage read). It reuses the existing SignIn / SignUp surfaces inside a
// modal; their `signUp.email` / `signIn.social` calls auto-trigger the
// anonymous→real account link (the backend migrates the guest's data), so no
// extra wiring is needed here.
const SignupWall = () => {
  const settings = useSettings();
  const { data: session } = authClient.useSession();
  const [mode, setMode] = useState<"signup" | "signin">("signup");

  const open = settings?.signupWallOpen ?? false;
  const isAnonymous = session?.user?.isAnonymous ?? false;

  // Once the user is a real (non-anonymous) account, the wall has done its job —
  // close it. This also covers the link completing after social sign-in.
  useEffect(() => {
    if (open && session && !isAnonymous) {
      settings?.setSignupWallOpen(false);
    }
  }, [open, session, isAnonymous, settings]);

  if (!settings) return null;

  return (
    <Dialog open={open} onOpenChange={settings.setSignupWallOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keep chatting</DialogTitle>
          <DialogDescription>
            You've used your 5 free messages — sign up to keep chatting.
          </DialogDescription>
        </DialogHeader>

        {mode === "signup" ? <SignUp /> : <SignIn />}

        <div className="flex justify-center pt-2 text-sm text-muted-foreground">
          {mode === "signup" ? (
            <span>
              Already have an account?{" "}
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => setMode("signin")}
              >
                Log in
              </Button>
            </span>
          ) : (
            <span>
              Need an account?{" "}
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => setMode("signup")}
              >
                Sign up
              </Button>
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SignupWall;
